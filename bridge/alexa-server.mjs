import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {AlexaLogin} from './alexa-login.mjs';
import {AlexaCloud} from './alexa-cloud.mjs';
import {GestureCommands} from './gesture-commands.mjs';
import {GestureStore} from './gesture-store.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

export function createAlexaBridge({port = 8877, login = new AlexaLogin(), cloud = new AlexaCloud(login), gestures = new GestureStore(), restore = true} = {}) {
  const commands=new GestureCommands({store:gestures});
  const assets = {'/': ['alexa-setup.html', 'text/html; charset=utf-8'],
    '/alexa-setup.js': ['alexa-setup.js', 'text/javascript; charset=utf-8'],
    '/alexa-webrtc.js': ['alexa-webrtc.js', 'text/javascript; charset=utf-8'],
    '/hand-worker.js': ['hand-worker.js', 'text/javascript; charset=utf-8'],
    '/wrist-flow.js': ['wrist-flow.js','text/javascript; charset=utf-8'],
    '/hand-features.js': ['hand-features.js', 'text/javascript; charset=utf-8'],
    '/pointing-selector.js': ['pointing-selector.js','text/javascript; charset=utf-8'],
    '/accessible-gestures.js': ['accessible-gestures.js', 'text/javascript; charset=utf-8'],
    '/motion-gestures.js': ['motion-gestures.js', 'text/javascript; charset=utf-8'],
    '/gesture-engine.js': ['gesture-engine.js', 'text/javascript; charset=utf-8'],
    '/gesture-preview.js': ['gesture-preview.js', 'text/javascript; charset=utf-8'],
    '/camera-comparison.js': ['camera-comparison.js','text/javascript; charset=utf-8'],
    '/dual-camera.js': ['dual-camera.js','text/javascript; charset=utf-8'],
    '/gesture-preview.css': ['gesture-preview.css', 'text/css; charset=utf-8'],
    '/alexa-setup.css': ['echo-camera.css', 'text/css; charset=utf-8']};
  const visionAssets = {'/vision/jsfeat.js': [resolve(ROOT,'data/vision/jsfeat.js'),'text/javascript; charset=utf-8'],'/vision/vision_bundle.js': [resolve(ROOT, 'data/vision/vision_bundle.js'), 'text/javascript; charset=utf-8'],
    '/vision/pose_landmarker_full.task': [resolve(ROOT,'data/vision/pose_landmarker_full.task'),'application/octet-stream'],
    '/vision/pose_landmarker_lite.task': [resolve(ROOT,'data/vision/pose_landmarker_lite.task'),'application/octet-stream'],
    '/vision/hand_landmarker.task': [resolve(ROOT, 'data/vision/hand_landmarker.task'), 'application/octet-stream']};
  for (const file of ['vision_wasm_internal.js','vision_wasm_internal.wasm','vision_wasm_nosimd_internal.js','vision_wasm_nosimd_internal.wasm']) visionAssets['/vision/wasm/'+file]=[resolve(ROOT,'node_modules/@mediapipe/tasks-vision/wasm',file),file.endsWith('.wasm')?'application/wasm':'text/javascript; charset=utf-8'];
  const server = createServer(async (request, response) => {
    const actualPort = server.address().port;
    const origin = `http://127.0.0.1:${actualPort}`;
    function send(status, body, type = 'application/json; charset=utf-8') {
      response.writeHead(status, {'Content-Type': type, 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});
      response.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
    }
    if (request.headers.host !== `127.0.0.1:${actualPort}` || !['127.0.0.1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress)) {
      return send(403, {error: 'Abra este painel no próprio Mac, pelo endereço 127.0.0.1.'});
    }
    const path = new URL(request.url, origin).pathname;
    if (request.method === 'GET') {
      if (path === '/api/status') return send(200, {...login.status(), ...cloud.status(), gestures:{...gestures.status(),...commands.status()}});
      if (path === '/api/gestures/config') return send(200, structuredClone(gestures.config));
      if (path === '/api/gestures/status') return send(200,{...gestures.status(),...commands.status()});
      if (path === '/api/rtc') {
        try {return send(200, cloud.signaling(Number(new URL(request.url, origin).searchParams.get('after') || 0)));}
        catch {return send(400, {error: 'Cursor RTC inválido.'});}
      }
      const asset = assets[path];
      const visionAsset = visionAssets[path];
      if (visionAsset) {
        try {return send(200,await readFile(visionAsset[0]),visionAsset[1]);}
        catch {return send(404,{error:'Modelo local indisponível. Execute npm run vision:prepare no Mac.'});}
      }
      if (!asset) return send(404, {error: 'Página não encontrada.'});
      try { return send(200, await readFile(resolve(ROOT, 'static', asset[0])), asset[1]); }
      catch { return send(404, {error: 'Arquivo indisponível.'}); }
    }
    if (request.method !== 'POST') return send(405, {error: 'Método não permitido.'});
    if (request.headers.origin !== origin) return send(403, {error: 'Origem não autorizada.'});
    if (request.headers['content-type']?.split(';')[0] !== 'application/json') return send(415, {error: 'Envie JSON.'});
    try {
      let body = '';
      for await (const chunk of request) { body += chunk; if (Buffer.byteLength(body) > (path === '/api/rtc/offer' ? 65536 : path === '/api/gestures/config' ? 16384 : 2048)) return send(413, {error: 'Solicitação muito grande.'}); }
      const payload = JSON.parse(body);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error();
      if (path === '/api/login') return send(200, await login.begin({remember: payload.remember === true}));
      if (path === '/api/gestures/config') {await commands.stop();return send(200, await gestures.save(payload));}
      if (path === '/api/gestures/central') return send(200,await commands.connect(payload.address));
      if (path === '/api/gestures/arm') return send(200,commands.arm(payload.cameraId,payload.manualTargetId));
      if (path === '/api/gestures/stop') return send(200,await commands.stop());
      if (path === '/api/gestures/execute') return send(200,await commands.execute(payload));
      if (path === '/api/gestures/report') {if(payload.phase==='stopped'||payload.phase==='error')await commands.stop();else commands.heartbeat(payload.sessionId);return send(200, {...gestures.update(payload),...commands.status()});}
      if (path === '/api/discover') return send(200, await cloud.discover());
      if (path === '/api/channel') return send(200, await cloud.openChannel(payload.profile));
      if (path === '/api/camera/start') return send(200, await cloud.startCamera(payload.id));
      if (path === '/api/rtc/offer') return send(200, await cloud.offer(payload.sessionId, payload.sdp));
      if (path === '/api/rtc/connected') return send(200, await cloud.rtcEvent(payload.sessionId, 'SessionConnected'));
      if (path === '/api/rtc/frames') return send(200, cloud.reportFrames(payload));
      if (path === '/api/channel/stop') {const result = await cloud.stopCamera(); return send(200, {...cloud.status(), ...result});}
      return send(404, {error: 'Operação não encontrada.'});
    } catch (error) {
      const safe = typeof error?.message === 'string' && /^(A Amazon |Faça login |Escolha uma câmera |Encerre a solicitação |Conecte o canal |O canal |Canal inválido|Conexão cancelada|Falha na conexão segura|Resposta de diretivas|Falha ao interpretar|O fluxo de diretivas|O envio do evento|Resposta do evento|Não foi possível enviar|Resposta Amazon muito grande|A Amazon devolveu|Região Amazon|Sessão RTC |Oferta RTC |Relato de imagem|Posição de calibração|Calibração inválida|Alvo de calibração|Direção de calibração|Abertura inicial inválida|Estado de gestos inválido|Gestos:|Central:)/.test(error.message);
      return send(400, {...(path==='/api/gestures/execute'?{controlActive:commands.status().commandsEnabled}:{}),error: safe ? error.message : 'Não foi possível concluir a operação. Confira a conexão da ponte com a Amazon.'});
    }
  });
  return {server, login, cloud, async start() {
    await gestures.load();
    await new Promise((done, fail) => {server.once('error', fail); server.listen(port, '127.0.0.1', done);});
    if (restore) await login.restore();
    return originURL(server.address().port);
  }, async close() {try {await commands.stop();await cloud.stopCamera?.();} finally {cloud.stop(); login.close(); await new Promise(done => server.close(done));}}};
}
function originURL(port) { return `http://127.0.0.1:${port}/`; }
