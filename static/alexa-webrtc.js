(() => {
  'use strict';
  // Receive-only camera client. Never requests the Mac's camera or microphone.
  function create({video, message}) {
    let active = false, generation = 0, peer = null, sessionId = null, cursor = 0, timer = null;
    let frames = 0, lastReport = -Infinity, frameCallback = null, notifiedConnected = false;
    const say = text => {message.textContent = text;};
    async function post(path, body, keepalive = false) {
      const response = await fetch(path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body), keepalive});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Falha na negociação RTC.');
      return result;
    }
    function stop(notify = false) {
      active = false; generation++; clearTimeout(timer); timer = null;
      if (frameCallback !== null && video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(frameCallback);
      frameCallback = null;
      if (peer) {peer.ontrack = null; peer.onconnectionstatechange = null; peer.close(); peer = null;}
      if (video.srcObject) {for (const track of video.srcObject.getTracks()) track.stop(); video.srcObject = null;}
      sessionId = null;
      if (notify) post('/api/channel/stop', {}, true).catch(() => {});
    }
    function fail(error, current) {
      if (current !== generation || !active) return;
      say(error.message || 'Não foi possível negociar o vídeo.'); stop(true);
    }
    function watchFrames(current) {
      if (!video.requestVideoFrameCallback) throw new Error('Este navegador não permite verificar os frames do vídeo.');
      const next = now => {
        if (current !== generation || !active) return;
        const live = video.srcObject?.getVideoTracks().some(track => track.readyState === 'live');
        if (live && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
          frames++;
          if (now - lastReport >= 1000) {
            lastReport = now;
            say(`Imagem recebida · ${video.videoWidth} × ${video.videoHeight} · ${frames} frames verificados. Sem reprodução de áudio e sem acesso ao microfone do Mac.`);
            post('/api/rtc/frames', {sessionId, frames, width: video.videoWidth, height: video.videoHeight}).catch(error => fail(error, current));
          }
        }
        frameCallback = video.requestVideoFrameCallback(next);
      };
      frameCallback = video.requestVideoFrameCallback(next);
    }
    function gather(connection, current) {
      if (connection.iceGatheringState === 'complete') return Promise.resolve();
      return new Promise((resolve, reject) => {
        const finish = error => {clearTimeout(timeout); connection.removeEventListener('icegatheringstatechange', changed); error ? reject(error) : resolve();};
        const changed = () => {if (current !== generation) finish(new Error('Negociação cancelada.')); else if (connection.iceGatheringState === 'complete') finish();};
        const timeout = setTimeout(() => finish(new Error('A coleta de endereços ICE não terminou.')), 15000);
        connection.addEventListener('icegatheringstatechange', changed);
      });
    }
    async function initiate(payload, current) {
      if (peer || current !== generation) return;
      if (payload.keyExchange !== 'DTLS' || payload.trickleICE !== false) throw new Error('A Echo solicitou um modo RTC ainda não suportado.');
      if (typeof RTCPeerConnection !== 'function') throw new Error('Este navegador não oferece WebRTC.');
      sessionId = payload.sessionId;
      const iceServers = (payload.iceServers || []).map(server => {
        if (typeof server.url !== 'string' || !/^(?:stun|stuns|turn|turns):/i.test(server.url)) throw new Error('Servidor ICE em formato não suportado.');
        return {urls: server.url, ...(server.username ? {username: server.username} : {}), ...(server.credential ? {credential: server.credential} : {})};
      });
      const connection = peer = new RTCPeerConnection({iceServers, bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require'});
      connection.addTransceiver('audio', {direction: 'sendrecv'}); // No sender track: no microphone capture.
      connection.addTransceiver('video', {direction: 'recvonly'});
      for (const data of payload.mediaStreams?.data || []) if (typeof data.label === 'string') connection.createDataChannel(data.label);
      connection.ontrack = event => {
        if (current !== generation || !active || event.track.kind !== 'video') return;
        video.srcObject = new MediaStream([event.track]); video.muted = true;
        event.track.onended = () => fail(new Error('A Echo encerrou a trilha de vídeo.'), current);
        video.play().catch(error => fail(error, current));
        watchFrames(current);
      };
      connection.onconnectionstatechange = () => {
        if (current !== generation || !active) return;
        if (connection.connectionState === 'connected' && !notifiedConnected) {
          notifiedConnected = true;
          post('/api/rtc/connected', {sessionId}).catch(error => fail(error, current));
        } else if (['failed', 'closed'].includes(connection.connectionState)) fail(new Error('A conexão WebRTC foi encerrada.'), current);
      };
      say('Preparando oferta WebRTC e endereços ICE…');
      await connection.setLocalDescription(await connection.createOffer());
      await gather(connection, current);
      if (current !== generation || !active) return;
      await post('/api/rtc/offer', {sessionId, sdp: connection.localDescription.sdp});
      if (current === generation) say('Oferta enviada. Aguardando resposta da Echo…');
    }
    async function signal(item, current) {
      if (item.name === 'InitiateSession') return initiate(item.payload, current);
      if (item.name === 'StopLiveView' || (item.name === 'DisconnectSession' && item.payload?.sessionId === sessionId)) {
        say('A Amazon encerrou a sessão da câmera.'); stop(true); return;
      }
      if (item.name === 'StartPeerConnection' && item.payload?.sessionId === sessionId) {
        const answer = item.payload.answer;
        if (!peer || String(answer?.format).toUpperCase() !== 'SDP' || typeof answer.value !== 'string') throw new Error('Resposta WebRTC em formato não suportado.');
        if (item.payload.isProvisional) throw new Error('A Echo solicitou resposta provisória ainda não suportada.');
        await peer.setRemoteDescription({type: 'answer', sdp: answer.value});
        say('Resposta recebida. Conectando a imagem…');
      }
    }
    async function poll(current) {
      if (current !== generation || !active) return;
      try {
        const response = await fetch('/api/rtc?after=' + cursor);
        if (!response.ok) throw new Error('A ponte RTC está indisponível.');
        const result = await response.json();
        for (const item of result.signals || []) {
          if (current !== generation || !active) return;
          cursor = Math.max(cursor, item.sequence);
          await signal(item, current);
        }
        if (current === generation && active) timer = setTimeout(() => poll(current), 300);
      } catch (error) {fail(error, current);}
    }
    function start() {
      stop(); active = true; cursor = 0; frames = 0; lastReport = -Infinity; notifiedConnected = false;
      say('Aguardando a sessão WebRTC da Echo…'); poll(generation);
    }
    addEventListener('pagehide', () => {if (active) stop(true);});
    document.addEventListener('visibilitychange', () => {if (document.hidden && active) {say('Câmera encerrada ao sair da aba.'); stop(true);}});
    return {start, stop};
  }
  window.CasaAlexaRTC = {create};
})();
