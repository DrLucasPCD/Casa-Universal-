(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const gestures = window.CasaGesturePreview.create({video: byId('echo-video'), canvas: byId('hand-overlay')});
  const rtc = window.CasaAlexaRTC.create({video: byId('echo-video'), message: byId('rtc-status'), onStop: () => gestures.stop()});
  const messages = {disconnected: 'Conexão ainda não iniciada.', starting: 'Preparando a página de login…', awaiting_login: 'A página de login está pronta. Toque em Continuar login e entre na sua conta Amazon.', authenticated: 'Login concluído. Cliente Amazon registrado; o vídeo ainda será verificado.', authenticated_memory: 'Login concluído. Sessão disponível apenas na memória.', refreshing: 'Renovando a conexão salva…', login_expired: 'A Amazon não renovou o acesso. Reinicie a ponte para entrar novamente.', login_failed: 'O login não foi concluído. Você pode tentar novamente.'};
  let opening = false, busy = false, operationId = 0, deviceFingerprint = '', lastAuthenticated = null, latestState = {};
  async function post(path, body = {}) {
    const response = await fetch(path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Operação indisponível.');
    return result;
  }
  async function operate(path, body = {}, interrupt = false) {
    if (busy && !interrupt) return;
    const current = ++operationId;
    if (path === '/api/channel/stop') {rtc.stop(); byId('rtc-status').textContent = 'Transmissão encerrada neste navegador.';}
    busy = true; byId('operation').textContent = 'Aguardando resposta da Amazon…';
    await status();
    try {
      await post(path, body);
      if (current === operationId) {
        if (path === '/api/camera/start') {rtc.start(); gestures.setCamera(body.id);}
        byId('operation').textContent = 'Consulta concluída. Veja o resultado abaixo.';
      }
    }
    catch (error) {if (current === operationId) byId('operation').textContent = error.message;}
    finally {if (current === operationId) busy = false; await status();}
  }
  function render(state) {
    latestState = state;
    if (lastAuthenticated !== state.authenticated) {byId('login-panel').open = !state.authenticated; lastAuthenticated = state.authenticated;}
    byId('open-camera').disabled = !state.authenticated || busy || ['requesting','awaiting_directive','session_received','streaming','stalled'].includes(state.video?.phase);
    byId('status').textContent = messages[state.phase] || 'Verificando conexão…';
    byId('connection').textContent = state.authenticated ? 'Amazon: cliente registrado.' : 'Amazon: aguardando login.';
    const link = byId('open-login');
    link.hidden = !state.loginUrl;
    if (state.loginUrl) link.href = state.loginUrl;
    byId('login').disabled = opening || ['starting', 'awaiting_login', 'refreshing'].includes(state.phase) || state.authenticated;
    byId('remember').disabled = state.authenticated || ['starting', 'awaiting_login'].includes(state.phase);
    byId('discover').disabled = !state.authenticated || busy;
    byId('channel').disabled = !state.authenticated || busy;
    const channel = state.channel || {};
    byId('channel-status').textContent = 'Canal Amazon: ' + (channel.phase || 'disconnected') + (channel.httpStatus ? ' · HTTP ' + channel.httpStatus : '');
    const phases = {disconnected: 'ainda não conectado', requesting: 'solicitando à Amazon', awaiting_directive: 'solicitação enviada; aguardando sessão', session_received: 'sessão recebida; negociação do vídeo pendente', rejected: 'a Amazon recusou a solicitação', ended: 'sessão encerrada pela Amazon', streaming: 'recebendo imagem', stalled: 'imagem sem atualização recente'};
    byId('video').textContent = 'Vídeo: ' + (phases[state.video?.phase] || 'ainda não conectado') + (state.video?.frames ? ` · ${state.video.frames} frames verificados no navegador.` : '. Nenhuma imagem recebida.');
    byId('diagnostic').textContent = JSON.stringify({login: state.phase, discovery: state.discoveryPhase, channel, video: state.video, lastEvent: state.lastEvent, recentDirectives: state.recentDirectives || []}, null, 2);
    const fingerprint = JSON.stringify([state.devices || [], channel.phase, busy]);
    if (fingerprint !== deviceFingerprint) {
      deviceFingerprint = fingerprint; byId('devices').replaceChildren();
      for (const device of state.devices || []) {
        const article = document.createElement('article'), label = document.createElement('p'), button = document.createElement('button');
        label.textContent = device.name + (device.model ? ' · ' + device.model : '');
        button.textContent = device.cameraEndpointAvailable ? 'Solicitar vídeo desta câmera' : 'Endpoint de câmera ainda não identificado';
        button.disabled = busy || channel.phase !== 'ready' || !device.cameraEndpointAvailable;
        button.addEventListener('click', () => operate('/api/camera/start', {id: device.id}));
        article.append(label, button); byId('devices').append(article);
      }
    }
  }
  async function status() {
    if (document.hidden) return;
    try {const response = await fetch('/api/status'); if (!response.ok) throw new Error(); render(await response.json());}
    catch {byId('status').textContent = 'A ponte local está indisponível. Deixe o processo aberto neste Mac.';}
  }
  byId('login').addEventListener('click', async () => {
    opening = true; byId('login').disabled = true;
    try {
      const response = await fetch('/api/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({remember: byId('remember').checked})});
      if (!response.ok) throw new Error(); render(await response.json());
    } catch {byId('status').textContent = 'Não foi possível abrir o login manual.';}
    finally {opening = false; await status();}
  });
  byId('discover').addEventListener('click', () => operate('/api/discover'));
  byId('open-camera').addEventListener('click', async () => {
    if (busy) return;
    busy = true; const current = ++operationId;
    byId('operation').textContent = 'Preparando a câmera da Echo…'; await status();
    try {
      let devices = latestState.devices || [];
      if (!devices.length) devices = (await post('/api/discover')).devices;
      if (current !== operationId) return;
      const cameras = devices.filter(d => d.manufacturer === 'Amazon' && d.cameraEndpointAvailable);
      if (cameras.length !== 1) throw new Error('Escolha a câmera em “Fonte de vídeo e diagnóstico”.');
      if (latestState.channel?.phase !== 'ready') await post('/api/channel', {profile:'modern'});
      if (current !== operationId) return;
      await post('/api/camera/start', {id:cameras[0].id});
      if (current === operationId) {rtc.start(); gestures.setCamera(cameras[0].id); byId('operation').textContent = 'Câmera solicitada. Aguardando a imagem…';}
    } catch (error) {if (current === operationId) byId('operation').textContent = error.message;}
    finally {if (current === operationId) busy = false; await status();}
  });
  byId('channel').addEventListener('click', () => operate('/api/channel', {profile: byId('gateway').value}));
  byId('stop-channel').addEventListener('click', () => operate('/api/channel/stop', {}, true));
  status(); setInterval(status, 2000);
})();
