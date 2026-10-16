'use strict';
let detector=null,tracker='arm';
self.onmessage = async ({data}) => {
  if (data.type === 'init') {
    try {
      importScripts('/vision/vision_bundle.js');
      const {FilesetResolver, HandLandmarker, PoseLandmarker} = self.CasaMediaPipe;
      const files = await FilesetResolver.forVisionTasks('/vision/wasm');
      tracker=['arm','palm','finger'].includes(data.settings?.tracker)?data.settings.tracker:'arm';
      const confidence=Math.min(.8,Math.max(.3,Number(data.settings?.confidence)||.4));
      detector=tracker==='arm'?await PoseLandmarker.createFromOptions(files,{
        baseOptions:{modelAssetPath:'/vision/pose_landmarker_lite.task',delegate:'CPU'},runningMode:'VIDEO',numPoses:2,outputSegmentationMasks:false,
        minPoseDetectionConfidence:confidence,minPosePresenceConfidence:confidence,minTrackingConfidence:confidence,
      }):await HandLandmarker.createFromOptions(files,{
        baseOptions:{modelAssetPath:'/vision/hand_landmarker.task',delegate:'CPU'},runningMode:'VIDEO',numHands:2,
        minHandDetectionConfidence:confidence,minHandPresenceConfidence:confidence,minTrackingConfidence:confidence,
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
    self.postMessage({type: 'result', timestamp: data.timestamp, tracker,landmarks:tracker==='arm'?[]:result.landmarks,poseLandmarks:tracker==='arm'?result.landmarks:[],
      worldLandmarks:tracker==='arm'?[]:result.worldLandmarks,poseWorldLandmarks:tracker==='arm'?result.worldLandmarks:[], elapsedMs: performance.now() - started});
  } catch {self.postMessage({type: 'error', message: 'O reconhecimento de mãos foi interrompido.'});}
  finally {data.bitmap.close();}
};
