'use strict';
let detector = null;
self.onmessage = async ({data}) => {
  if (data.type === 'init') {
    try {
      importScripts('/vision/vision_bundle.js');
      const {FilesetResolver, HandLandmarker} = self.CasaMediaPipe;
      const files = await FilesetResolver.forVisionTasks('/vision/wasm');
      detector = await HandLandmarker.createFromOptions(files, {
        baseOptions: {modelAssetPath: '/vision/hand_landmarker.task', delegate: 'CPU'},
        runningMode: 'VIDEO', numHands: 2, minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5,
      });
      self.postMessage({type: 'ready'});
    } catch {self.postMessage({type: 'error', message: 'Não foi possível iniciar o modelo local de mãos.'});}
    return;
  }
  if (data.type !== 'frame' || !data.bitmap) return;
  try {
    if (!detector) throw new Error();
    const started = performance.now();
    const result = detector.detectForVideo(data.bitmap, data.timestamp);
    self.postMessage({type: 'result', timestamp: data.timestamp, landmarks: result.landmarks,
      worldLandmarks: result.worldLandmarks, elapsedMs: performance.now() - started});
  } catch {self.postMessage({type: 'error', message: 'O reconhecimento de mãos foi interrompido.'});}
  finally {data.bitmap.close();}
};
