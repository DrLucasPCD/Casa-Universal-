(function (root) {
  'use strict';
  const descriptions = {
    NotAllowedError: 'O navegador ou o sistema negou a permissão. Isso pode ser uma configuração ou uma restrição da Echo; ainda não confirma acesso à câmera.',
    NotFoundError: 'O navegador não encontrou uma câmera disponível para esta página.',
    NotReadableError: 'A câmera não pôde ser lida. Verifique a tampa física e se ela está em uso em outra função.',
    OverconstrainedError: 'A câmera não aceitou os parâmetros de vídeo solicitados.',
    SecurityError: 'O sistema bloqueou a captura de vídeo nesta página.',
    NoFrames: 'O navegador abriu um fluxo, mas não entregou imagem em 10 segundos. O acesso ainda não está confirmado.',
    StreamEnded: 'O sistema encerrou o vídeo. A câmera está parada.',
    PreviewError: 'Não foi possível exibir o vídeo recebido. O acesso ainda não está confirmado.'
  };

  function createProbe({video, mediaDevices, secureContext, onChange, userAgent = '', frameTimeout = 10000}) {
    let generation = 0, stream = null, cancelPreview = null;
    let state = {phase: 'idle', code: '', width: 0, height: 0};
    function report() {
      return {...state, secureContext: !!secureContext,
        cameraAPI: typeof mediaDevices?.getUserMedia === 'function',
        browser: String(userAgent).slice(0, 320), audioRequested: false,
        imagesUploaded: false};
    }
    function emit(phase, code = '', dimensions = {}) {
      state = {phase, code, width: 0, height: 0, ...dimensions};
      onChange(report());
    }
    function release() {
      if (cancelPreview) cancelPreview();
      cancelPreview = null;
      if (stream) stream.getTracks().forEach(track => track.stop());
      stream = null;
      video.pause();
      video.srcObject = null;
    }
    function stop() {
      generation++;
      release();
      emit('stopped');
    }
    function framesReady(token) {
      return new Promise((resolve, reject) => {
        let timer, settled = false;
        function finish(error) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          ['loadeddata', 'playing', 'resize'].forEach(name => video.removeEventListener(name, check));
          video.removeEventListener('error', failed);
          cancelPreview = null;
          error ? reject(error) : resolve();
        }
        function check() {
          if (token === generation && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) finish();
        }
        function failed() { finish({name: 'PreviewError'}); }
        cancelPreview = () => finish({name: 'Cancelled'});
        ['loadeddata', 'playing', 'resize'].forEach(name => video.addEventListener(name, check));
        video.addEventListener('error', failed);
        timer = setTimeout(() => finish({name: 'NoFrames'}), frameTimeout);
        // Do not wait indefinitely for play(): some embedded browsers never settle it.
        try { Promise.resolve(video.play()).then(check, failed); } catch (_) { failed(); }
        check();
      });
    }
    async function start() {
      const token = ++generation;
      release();
      if (!secureContext) return emit('blocked', 'InsecureContext');
      if (typeof mediaDevices?.getUserMedia !== 'function') return emit('blocked', 'NoCameraAPI');
      emit('requesting');
      try {
        const candidate = await mediaDevices.getUserMedia({audio: false, video: {
          facingMode: {ideal: 'user'}, width: {ideal: 640}, height: {ideal: 480}, frameRate: {ideal: 15, max: 30}
        }});
        if (token !== generation) {
          candidate.getTracks().forEach(track => track.stop());
          return;
        }
        stream = candidate;
        video.srcObject = stream;
        stream.getVideoTracks().forEach(track => track.addEventListener('ended', () => {
          if (token === generation) { generation++; release(); emit('error', 'StreamEnded'); }
        }, {once: true}));
        emit('waiting');
        await framesReady(token);
        if (token !== generation) return;
        if (!stream.getVideoTracks().some(track => track.readyState === 'live')) throw {name: 'StreamEnded'};
        emit('ready', '', {width: video.videoWidth, height: video.videoHeight});
      } catch (error) {
        if (token !== generation) return;
        release();
        // Never include arbitrary system error messages or device identifiers in the report.
        emit('error', Object.prototype.hasOwnProperty.call(descriptions, error?.name) ? error.name : 'UnknownError');
      }
    }
    onChange(report());
    return {start, stop, report};
  }
  root.CasaCameraProbe = {create: createProbe};
  if (typeof document === 'undefined' || !document.getElementById('camera-probe')) return;
  const byId = id => document.getElementById(id);
  const titles = {idle: 'Aguardando seu toque', requesting: 'Aguardando permissão', waiting: 'Aguardando imagem', ready: 'Câmera com imagem!', stopped: 'Câmera parada', blocked: 'Acesso indisponível', error: 'Teste sem confirmação'};
  const phases = {idle: 'PRONTO PARA TESTAR', requesting: 'PERMISSÃO', waiting: 'VERIFICANDO VÍDEO', ready: 'VÍDEO CONFIRMADO', stopped: 'CAPTURA ENCERRADA', blocked: 'NAVEGADOR', error: 'RESULTADO DO TESTE'};
  const messages = {
    idle: 'A câmera só será solicitada ao tocar no botão abaixo.',
    requesting: 'Se o sistema mostrar uma solicitação de câmera, permita o vídeo. Se nada acontecer, você pode tocar em Parar.',
    waiting: 'O sistema forneceu um fluxo. Verificando se ele entrega imagem…',
    ready: 'O navegador deste aparelho está exibindo vídeo. Conte em qual aparelho você abriu a página; só um teste na Echo confirma a câmera dela.',
    stopped: 'A captura foi encerrada. Toque em Testar câmera para tentar novamente.',
    InsecureContext: 'Abra https://casa-universal.netlify.app/camera na própria Echo. Um endereço HTTP da rede local não libera esta API.',
    NoCameraAPI: 'Este navegador não disponibiliza a API de câmera nesta página. Isso impede o teste por este caminho.',
    UnknownError: 'O sistema retornou um erro não identificado. Copie o resultado técnico para continuarmos a investigação.'
  };
  const probe = createProbe({video: byId('camera-video'), mediaDevices: navigator.mediaDevices,
    secureContext: root.isSecureContext, userAgent: navigator.userAgent,
    onChange(report) {
      byId('camera-title').textContent = titles[report.phase];
      byId('camera-phase').textContent = phases[report.phase];
      byId('camera-message').textContent = descriptions[report.code] || messages[report.code] || messages[report.phase];
      byId('camera-placeholder').hidden = report.phase === 'ready';
      byId('camera-start').disabled = ['requesting', 'waiting', 'ready'].includes(report.phase);
      byId('camera-stop').disabled = !['requesting', 'waiting', 'ready'].includes(report.phase);
      byId('camera-report').textContent = JSON.stringify(report, null, 2);
    }});
  byId('camera-start').addEventListener('click', () => probe.start());
  byId('camera-stop').addEventListener('click', () => probe.stop());
  byId('camera-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(probe.report(), null, 2));
      byId('copy-result').textContent = 'Resultado copiado. Você pode colá-lo na conversa.';
    } catch (_) {
      byId('copy-result').textContent = 'A cópia automática não está disponível. Abra Resultado técnico e informe a fase e o código exibidos.';
      document.querySelector('details').open = true;
    }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) probe.stop(); });
  root.addEventListener('pagehide', () => probe.stop());
})(globalThis);
