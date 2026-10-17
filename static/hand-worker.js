'use strict';
let detector=null,tracker='arm',flow=null,canvas=null,context=null,side='right';
self.onmessage = async ({data}) => {
  if (data.type === 'init') {
    try {
      importScripts('/vision/vision_bundle.js','/vision/jsfeat.js','/wrist-flow.js');
      flow=CasaWristFlow.create(self.jsfeat);side=data.settings?.side==='left'?'left':'right';
      const {FilesetResolver, HandLandmarker, PoseLandmarker} = self.CasaMediaPipe;
      const files = await FilesetResolver.forVisionTasks('/vision/wasm');
      tracker=['arm','palm','finger'].includes(data.settings?.tracker)?data.settings.tracker:'arm';
      const confidence=Math.min(.8,Math.max(.3,Number(data.settings?.confidence)||.4));
      // MediaPipe enables stream landmark smoothing only with one pose.
      // Requesting two for a single user also reruns body detection each frame.
      detector=tracker==='arm'?await PoseLandmarker.createFromOptions(files,{
        baseOptions:{modelAssetPath:'/vision/pose_landmarker_full.task',delegate:'CPU'},runningMode:'VIDEO',numPoses:1,outputSegmentationMasks:false,
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
    let trackedWrist=null;
    if(tracker==='arm'){
      const width=640,height=Math.round(width*data.bitmap.height/data.bitmap.width);
      if(!canvas||canvas.width!==width||canvas.height!==height){canvas=new OffscreenCanvas(width,height);context=canvas.getContext('2d',{willReadFrequently:true});}
      context.drawImage(data.bitmap,0,0,width,height);
      const point=result.landmarks?.length===1?result.landmarks[0][side==='left'?15:16]:null;
      const measurement=point?.visibility>=.35?point:null;
      trackedWrist=flow.update(context.getImageData(0,0,width,height).data,width,height,measurement,data.timestamp,{ambiguous:result.landmarks?.length>1});
    }
    self.postMessage({type: 'result', timestamp: data.timestamp, tracker,trackedWrist,landmarks:tracker==='arm'?[]:result.landmarks,poseLandmarks:tracker==='arm'?result.landmarks:[],
      worldLandmarks:tracker==='arm'?[]:result.worldLandmarks,poseWorldLandmarks:tracker==='arm'?result.worldLandmarks:[], elapsedMs: performance.now() - started});
  } catch {self.postMessage({type: 'error', message: 'O reconhecimento de mãos foi interrompido.'});}
  finally {data.bitmap.close();}
};
