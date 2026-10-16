import {connect as connectHTTP2} from 'node:http2';
import {createHash, randomUUID} from 'node:crypto';

const MARKETS = new Set(['amazon.com', 'amazon.com.br', 'amazon.ca', 'amazon.com.mx', 'amazon.de', 'amazon.co.uk', 'amazon.fr', 'amazon.it', 'amazon.es', 'amazon.co.jp', 'amazon.com.au', 'amazon.in']);
const UA = 'AmazonWebView/Amazon Alexa/2.2.651540.0/iOS/18.3.1/iPhone';
export const GATEWAYS = Object.freeze({modern: 'https://alexa.na.gateway.devices.a2z.com', legacy: 'https://avs-alexa-13-na.amazon.com', push: 'https://bob-dispatch-prod-na.amazon.com'});

export class MultipartDirectives {
  constructor(contentType, onJSON, maxBytes = 2 * 1024 * 1024) {
    const boundary = /boundary\s*=\s*(?:"([^"\r\n]+)"|([^;\s]+))/i.exec(contentType || '');
    const value = boundary?.[1] || boundary?.[2];
    if (!value || value.length > 200) throw new Error('Resposta sem limite multipart válido.');
    this.delimiter = Buffer.from('--' + value); this.buffer = Buffer.alloc(0);
    this.onJSON = onJSON; this.maxBytes = maxBytes; this.headers = null; this.started = false; this.ended = false;
  }
  write(chunk) {
    if (this.ended) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > this.maxBytes) throw new Error('Parte multipart excedeu o limite.');
    while (true) {
      if (!this.started) {
        const at = this.buffer.indexOf(this.delimiter);
        if (at < 0) return;
        this.buffer = this.buffer.subarray(at); this.started = true;
      }
      if (this.headers === null) {
        if (this.buffer.length < this.delimiter.length + 2) return;
        if (!this.buffer.subarray(0, this.delimiter.length).equals(this.delimiter)) throw new Error('Sequência multipart inválida.');
        const suffix = this.buffer.subarray(this.delimiter.length, this.delimiter.length + 2).toString();
        if (suffix === '--') { this.ended = true; this.buffer = Buffer.alloc(0); return; }
        if (suffix !== '\r\n') throw new Error('Separador multipart inválido.');
        const end = this.buffer.indexOf('\r\n\r\n');
        if (end < 0) { if (this.buffer.length > 8192) throw new Error('Cabeçalho muito grande.'); return; }
        this.headers = this.buffer.subarray(this.delimiter.length + 2, end).toString('utf8');
        this.buffer = this.buffer.subarray(end + 4);
      }
      const next = this.buffer.indexOf(Buffer.concat([Buffer.from('\r\n'), this.delimiter]));
      if (next < 0) return;
      if (/content-type:\s*application\/json\b/i.test(this.headers)) {
        const value = JSON.parse(this.buffer.subarray(0, next).toString('utf8'));
        this.onJSON(value);
      }
      this.buffer = this.buffer.subarray(next + 2); this.headers = null;
    }
  }
}

export function liveViewEvent(endpoint, now = new Date(), uuid = randomUUID) {
  if (typeof endpoint !== 'string' || !/^amzn1\.alexa\.endpoint\.[A-Za-z0-9._:-]{1,500}$/.test(endpoint)) throw new Error('Endpoint de câmera inválido.');
  return {header: {namespace: 'Alexa.Camera.LiveViewController', name: 'RequestStartLiveView', messageId: uuid()},
    payload: {sessionType: 'SINGLEVIEW', targets: [endpoint], requestId: uuid(), deviceRequestStartTime: now.toISOString()}};
}
export function eventBody(event, boundary = 'casa-' + randomUUID()) {
  return {contentType: `multipart/form-data; boundary=${boundary}`,
    body: Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json; charset=utf-8\r\n\r\n${JSON.stringify({event})}\r\n--${boundary}--\r\n`)};
}

async function jsonResponse(response) {
  const chunks = []; let size = 0;
  for await (const chunk of response.body || []) {
    size += chunk.length; if (size > 4 * 1024 * 1024) throw new Error('Resposta Amazon muito grande.'); chunks.push(chunk);
  }
  if (!response.ok) throw Object.assign(new Error(`Amazon respondeu HTTP ${response.status}.`), {status: response.status});
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('A Amazon devolveu uma página em vez de dados de dispositivos.'); }
}

export class AlexaCloud {
  constructor(login, {fetchImpl = fetch, connectImpl = connectHTTP2} = {}) {
    this.login = login; this.fetch = fetchImpl; this.connectHTTP2 = connectImpl;
    this.targets = new Map(); this.devices = []; this.discoveryPhase = 'idle';
    this.channel = {phase: 'disconnected', profile: null, httpStatus: null};
    this.client = null; this.stream = null; this.directives = []; this.lastLiveView = null;
    this.token = null; this.tokenExpires = 0; this.connectionGeneration = 0;
    this.rawCameraDirectives = []; this.pendingCancel = null;
  }
  status() {
    return {discoveryPhase: this.discoveryPhase, devices: this.devices, channel: {...this.channel},
      recentDirectives: [...this.directives], video: {phase: this.lastLiveView?.phase || 'disconnected', frames: 0,
        ...(this.lastLiveView?.error ? {error: this.lastLiveView.error} : {})}};
  }
  async website(path, query) {
    const data = this.login.registration;
    if (!data?.localCookie) throw new Error('Faça login na Amazon primeiro.');
    const market = data.amazonPage || 'amazon.com.br';
    if (!MARKETS.has(market)) throw new Error('Região Amazon ainda não suportada.');
    const response = await this.fetch(`https://alexa.${market}${path}`, {
      method: query ? 'POST' : 'GET', redirect: 'manual', signal: AbortSignal.timeout(15000),
      headers: {'User-Agent': UA, 'Accept': 'application/json', Cookie: data.localCookie,
        ...(data.csrf ? {csrf: data.csrf} : {}), ...(query ? {'Content-Type': 'application/json'} : {})},
      ...(query ? {body: JSON.stringify(query)} : {})});
    return jsonResponse(response);
  }
  async discover() {
    this.discoveryPhase = 'querying';
    try {
      const query = 'query Endpoints { endpoints { items { endpointId id friendlyName displayCategories { primary { value } } legacyIdentifiers { dmsIdentifier { deviceType { value { text } } deviceSerialNumber { value { text } } } } legacyAppliance { manufacturerName modelName entityId friendlyName } } } }';
      const [echoes, graph] = await Promise.allSettled([this.website('/api/devices-v2/device?cached=true'), this.website('/nexus/v1/graphql', {query})]);
      const rows = graph.status === 'fulfilled' ? graph.value?.data?.endpoints?.items : null;
      this.targets.clear(); this.devices = [];
      if (Array.isArray(rows)) {
        for (const row of rows) {
          const legacy = row.legacyAppliance || {};
          const name = row.friendlyName || legacy.friendlyName || 'Dispositivo';
          const category = row.displayCategories?.primary?.value || '';
          const type = row.legacyIdentifiers?.dmsIdentifier?.deviceType?.value?.text;
          if (category !== 'CAMERA' && !['A15996VY63BQ2D', 'A1Z88NGR2BK6A2', 'A2UONLFQW0PADH'].includes(type)) continue;
          let endpoint = row.endpointId;
          if (!endpoint?.startsWith('amzn1.alexa.endpoint.') && typeof legacy.entityId === 'string' && /^[a-f0-9-]{36}$/i.test(legacy.entityId)) endpoint = 'amzn1.alexa.endpoint.' + legacy.entityId;
          const id = createHash('sha256').update(String(row.id || endpoint || name)).digest('hex').slice(0, 20);
          this.targets.set(id, {endpoint, name});
          this.devices.push({id, name, category, manufacturer: legacy.manufacturerName || '', model: legacy.modelName || '', cameraEndpointAvailable: typeof endpoint === 'string' && endpoint.startsWith('amzn1.alexa.endpoint.')});
        }
      }
      const echoCount = echoes.status === 'fulfilled' && Array.isArray(echoes.value?.devices) ? echoes.value.devices.length : 0;
      this.discoveryPhase = rows ? 'ready' : 'endpoint_query_failed';
      if (echoes.status === 'rejected' && graph.status === 'rejected') throw new Error('A Amazon não autorizou a consulta dos dispositivos com esta sessão.');
      return {devices: this.devices, accountDeviceCount: echoCount, discoveryPhase: this.discoveryPhase};
    } catch (error) {this.discoveryPhase = 'failed'; throw error;}
  }
  async accessToken() {
    if (this.token && Date.now() < this.tokenExpires) return this.token;
    const data = this.login.registration;
    if (!data?.refreshToken) throw new Error('Faça login na Amazon primeiro.');
    const body = new URLSearchParams({app_name: data.deviceAppName || 'Casa Universal', app_version: '2.2.651540.0',
      'di.sdk.version': '6.12.4', source_token: data.refreshToken, package_name: 'com.amazon.echo',
      'di.hw.version': 'iPhone', platform: 'iOS', requested_token_type: 'access_token', source_token_type: 'refresh_token',
      'di.os.name': 'iOS', 'di.os.version': '18.3.1', current_version: '6.12.4', previous_version: '6.12.4'});
    const response = await this.fetch('https://api.amazon.com/auth/token', {method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(15000), headers: {'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA}, body: body.toString()});
    const result = await jsonResponse(response);
    if (typeof result.access_token !== 'string' || result.token_type !== 'bearer') throw new Error('A Amazon não forneceu um token válido para o cliente.');
    this.token = result.access_token; this.tokenExpires = Date.now() + Math.max(0, Math.min(Number(result.expires_in) || 0, 3600) - 30) * 1000;
    return this.token;
  }
  onJSON(value) {
    const directive = value?.directive;
    const header = directive?.header;
    if (!header || typeof header.namespace !== 'string' || typeof header.name !== 'string') return;
    this.directives.push({namespace: header.namespace.slice(0, 120), name: header.name.slice(0, 100), receivedAt: new Date().toISOString()});
    this.directives = this.directives.slice(-16);
    if (/^Alexa\.(?:Camera\.LiveViewController|RTCSessionController)$/.test(header.namespace)) {
      this.rawCameraDirectives.push(directive); this.rawCameraDirectives = this.rawCameraDirectives.slice(-8);
      if (header.name === 'RequestStartLiveViewFailed') this.lastLiveView = {phase: 'rejected', error: 'A Amazon recusou o início da transmissão.'};
      else if (header.name === 'StartLiveView') this.lastLiveView = {phase: 'session_received', sessionId: directive.payload?.sessionId};
    }
  }
  async openChannel(profile = 'modern') {
    if (!Object.hasOwn(GATEWAYS, profile)) throw new Error('Canal inválido.');
    if (['requesting', 'awaiting_directive', 'session_received'].includes(this.lastLiveView?.phase)) throw new Error('Encerre a solicitação de vídeo atual antes de trocar o canal.');
    this.stop();
    const generation = this.connectionGeneration;
    this.channel = {phase: 'connecting', profile, httpStatus: null};
    let token;
    try {token = await this.accessToken();}
    catch (error) {if (generation === this.connectionGeneration) this.channel.phase = 'failed'; throw error;}
    if (generation !== this.connectionGeneration) throw new Error('Conexão cancelada.');
    return new Promise((resolveResult, reject) => {
      const client = this.client = this.connectHTTP2(GATEWAYS[profile]);
      let settled = false;
      const timeout = setTimeout(() => fail(new Error('O canal de diretivas não respondeu em 15 segundos.')), 15000);
      this.pendingCancel = () => {clearTimeout(timeout); if (!settled) {settled = true; reject(new Error('Conexão cancelada.'));}};
      const fail = error => {
        if (generation !== this.connectionGeneration) return;
        clearTimeout(timeout); this.pendingCancel = null; this.channel.phase = 'failed';
        if (!settled) {settled = true; reject(error);}
        client.destroy();
      };
      client.on('error', () => fail(new Error('Falha na conexão segura com a Amazon.')));
      client.once('connect', () => {
        const stream = this.stream = client.request({':method': 'GET', ':path': '/v20160207/directives', authorization: 'Bearer ' + token, 'user-agent': UA});
        let parser;
        stream.on('response', headers => {
          if (generation !== this.connectionGeneration) return;
          this.channel.httpStatus = headers[':status'];
          if (headers[':status'] !== 200) return fail(new Error('A Amazon respondeu HTTP ' + headers[':status'] + ' ao canal de diretivas.'));
          try {parser = new MultipartDirectives(headers['content-type'], value => this.onJSON(value));}
          catch {return fail(new Error('Resposta de diretivas em formato não suportado.'));}
          clearTimeout(timeout); this.pendingCancel = null; this.channel.phase = 'ready'; settled = true; resolveResult(this.status());
        });
        stream.on('data', chunk => {if (generation === this.connectionGeneration && parser) {try {parser.write(chunk);} catch {fail(new Error('Falha ao interpretar as diretivas.'));}}});
        stream.on('error', () => fail(new Error('O fluxo de diretivas apresentou um erro.')));
        stream.once('close', () => {if (generation === this.connectionGeneration && this.channel.phase === 'ready') this.channel.phase = 'disconnected';});
      });
    });
  }
  async sendEvent(event) {
    if (this.channel.phase !== 'ready' || !this.client) throw new Error('Conecte o canal de diretivas primeiro.');
    const token = await this.accessToken(); const {body, contentType} = eventBody(event);
    return new Promise((resolveResult, reject) => {
      const stream = this.client.request({':method': 'POST', ':path': '/v20160207/events', authorization: 'Bearer ' + token, 'content-type': contentType, 'content-length': body.length, 'user-agent': UA});
      let status, parser, size = 0;
      const timer = setTimeout(() => {stream.close(); reject(new Error('O envio do evento expirou.'));}, 15000);
      stream.on('response', headers => {
        status = headers[':status'];
        if (String(headers['content-type']).includes('multipart/')) {try {parser = new MultipartDirectives(headers['content-type'], value => this.onJSON(value));} catch {}}
      });
      stream.on('data', chunk => {
        size += chunk.length;
        if (size > 4 * 1024 * 1024) {stream.close(); clearTimeout(timer); reject(new Error('Resposta do evento muito grande.')); return;}
        if (parser) {try {parser.write(chunk);} catch {stream.close(); clearTimeout(timer); reject(new Error('Resposta do evento inválida.'));}}
      });
      stream.on('end', () => {clearTimeout(timer); status >= 200 && status < 300 ? resolveResult({httpStatus: status}) : reject(new Error('A Amazon respondeu HTTP ' + status + ' ao evento.'));});
      stream.on('error', () => {clearTimeout(timer); reject(new Error('Não foi possível enviar o evento.'));});
      stream.end(body);
    });
  }
  async startCamera(id) {
    if (['requesting', 'awaiting_directive', 'session_received'].includes(this.lastLiveView?.phase)) throw new Error('Encerre a solicitação de vídeo atual antes de iniciar outra.');
    const target = this.targets.get(id);
    if (!target?.endpoint) throw new Error('Escolha uma câmera com endpoint identificado na conta.');
    this.lastLiveView = {phase: 'requesting'};
    try {
      const response = await this.sendEvent(liveViewEvent(target.endpoint));
      if (this.lastLiveView?.phase === 'requesting') this.lastLiveView.phase = 'awaiting_directive';
      return {...response, video: this.status().video};
    } catch (error) {this.lastLiveView = {phase: 'rejected', error: 'A solicitação de vídeo não foi aceita.'}; throw error;}
  }
  async stopCamera() {
    const sessionId = this.lastLiveView?.sessionId;
    try {
      if (typeof sessionId === 'string' && sessionId.length) {
        await this.sendEvent({header: {namespace: 'Alexa.Camera.LiveViewController', name: 'RequestStopLiveView', messageId: randomUUID()}, payload: {sessionId}});
      }
      return {stopEventSent: Boolean(sessionId)};
    } finally {
      // Closing this receiver is distinct from confirmation by the Echo itself.
      this.stop(); this.lastLiveView = {phase: 'disconnected'};
      this.rawCameraDirectives = [];
    }
  }
  stop() {
    this.pendingCancel?.(); this.pendingCancel = null;
    this.connectionGeneration++;
    this.stream?.close(); this.client?.destroy(); this.stream = null; this.client = null;
    this.channel = {phase: 'disconnected', profile: null, httpStatus: null};
  }
}
