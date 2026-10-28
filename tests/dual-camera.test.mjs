import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
function harness({reject=false,pending=false}={}){
  let now=1000,stopped=0,resolveMedia,tick,validator,locked=false;
  const elements=new Map(),workers=[],mediaCalls=[],frames=new Map(),events={},saves=[];
  const context2d=new Proxy({},{get:()=>()=>{}});
  const element=()=>({value:'',textContent:'',dataset:{},children:[],getContext:()=>context2d,replaceChildren(){this.children=[];},append(e){this.children.push(e);if(!this.value)this.value=e.value;},addEventListener(n,f){this[n]=f;}});
  const document={hidden:false,getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},createElement:element,addEventListener(n,f){events[n]=f;}};
  const video=document.getElementById('mac-video');Object.assign(video,{readyState:4,videoWidth:1280,videoHeight:720,play:async()=>{},requestVideoFrameCallback(f){frames.set(1,f);return 1;},cancelVideoFrameCallback(){frames.clear();}});
  const stream={getTracks:()=>[{stop(){stopped++;}}],getVideoTracks:()=>[{getSettings:()=>({deviceId:'mac-id'})}]};
  const config={settings:{tracker:'arm',side:'left',selection:'direction'},secondaryCameraId:'mac-id',targets:[{id:'cover',name:'Cortina',binding:{deviceId:'motor'},direction:{x:1,y:0,z:0},directionProfiles:{mac_arm_left:{direction:{x:-1,y:0,z:0},tolerance:24}}}]};
  const client={getSnapshot:()=>structuredClone(config),stopCommands:async()=>{},saveSecondary:async(...args)=>{saves.push(args);},setSelectionValidator(fn){validator=fn;},setExperimentLock(value){locked=value;}};
  const c=vm.createContext({document,performance:{now:()=>now},navigator:{mediaDevices:{getUserMedia:async options=>{mediaCalls.push(options);if(reject)throw Object.assign(new Error(),{name:'NotAllowedError'});if(pending)await new Promise(r=>{resolveMedia=r;});return stream;},enumerateDevices:async()=>[{kind:'videoinput',deviceId:'mac-id',label:'FaceTime HD Camera'}]}},Worker:class{constructor(){workers.push(this);}postMessage(){}terminate(){this.terminated=true;}},createImageBitmap:async()=>({close(){}}),setTimeout(){return 2;},clearTimeout(){},setInterval(fn){tick=fn;return 1;},clearInterval(){tick=null;},addEventListener(n,f){events[n]=f;}});
  for(const file of ['hand-features','camera-comparison','dual-camera'])vm.runInContext(readFileSync(new URL(`../static/${file}.js`,import.meta.url),'utf8'),c);
  c.CasaHandFeatures.features=d=>d.hand;
  const api=c.CasaDualCamera.create({client});
  return {api,config,elements,mediaCalls,workers,events,frames,saves,get stopped(){return stopped;},get locked(){return locked;},setNow:t=>{now=t;},tick:()=>tick?.(),get validator(){return validator;},resolveMedia:()=>resolveMedia(),click:id=>elements.get(id).click(),result:data=>workers.at(-1).onmessage({data})};
}
test('second camera requests video only, tracks independently, and releases camera/worker on stop',async()=>{
  const h=harness();await h.click('mac-start');h.result({type:'ready'});
  assert.equal(h.mediaCalls[0].audio,false);assert.equal(h.workers.length,1);assert.equal(h.frames.size,1);
  assert.match(h.elements.get('mac-status').textContent,/MacBook conectado/);
  h.api.stop();assert.equal(h.stopped,1);assert.equal(h.workers[0].terminated,true);assert.equal(h.frames.size,0);assert.equal(h.validator,null);
});
test('a late camera permission response cannot resurrect a stopped session',async()=>{
  const h=harness({pending:true});const start=h.click('mac-start');await Promise.resolve();h.api.stop();h.resolveMedia();await start;
  assert.equal(h.stopped,1);assert.equal(h.workers.length,0);
});
test('camera refusal leaves a recoverable explanation and no worker or stream',async()=>{
  const h=harness({reject:true});await h.click('mac-start');assert.match(h.elements.get('mac-status').textContent,/Permita/);assert.equal(h.workers.length,0);assert.equal(h.elements.get('mac-start').disabled,false);
});
test('consensus vetoes stale frames and arm changes; guided trials lock real commands',async()=>{
  const h=harness();await h.click('mac-start');h.result({type:'ready'});
  h.result({type:'result',timestamp:1000,hand:{present:true,direction:{x:-1,y:0,z:0},x:.5,y:.5}});
  h.api.primary({timestamp:1000,hand:{present:true,direction:{x:1,y:0,z:0}}});
  const box=h.elements.get('require-consensus');box.checked=true;box.change();
  assert.equal(h.validator({id:'cover'},1100),true);assert.equal(h.validator({id:'cover'},1600),false);
  h.elements.get('camera-test-target').value='cover';await h.click('camera-test');assert.equal(h.locked,true);
  h.setNow(15000);h.tick();assert.equal(h.locked,false);
  h.config.settings.side='right';h.result({type:'result',timestamp:15000,hand:{present:true,x:.5,y:.5}});assert.equal(h.stopped,1);assert.match(h.elements.get('mac-status').textContent,/braço de controle mudou/);
});

test('canceling calibration preserves saved directions and unlocks commands without enabling them',async()=>{
  const h=harness();await h.click('mac-start');h.result({type:'ready'});
  await h.click('mac-calibrate');assert.equal(h.locked,true);
  await h.click('camera-experiment-cancel');assert.equal(h.locked,false);assert.equal(h.saves.length,0);
  assert.match(h.elements.get('mac-learning').textContent,/preservadas/);
});
test('a single-target recalibration writes only that target and camera identity gates consensus',async()=>{
  const h=harness();await h.click('mac-start');h.result({type:'ready'});
  h.config.targets.push({id:'lamp',name:'Luz',binding:{deviceId:'lamp'},direction:{x:0,y:1,z:0},directionProfiles:{mac_arm_left:{direction:{x:0,y:1,z:0},tolerance:24}}});
  h.elements.get('camera-test-target').value='cover';await h.click('mac-calibrate-target');assert.equal(h.locked,true);
  for(let i=0;i<16;i++){const t=4100+i*125;h.setNow(t);h.result({type:'result',timestamp:t,hand:{present:true,direction:{x:-1,y:0,z:0},x:.5,y:.5}});}
  await Promise.resolve();await Promise.resolve();
  assert.equal(h.saves.length,1);assert.equal(h.saves[0][0],'mac-id');assert.deepEqual(Object.keys(h.saves[0][1]),['cover']);
  const t=6000;h.setNow(t);h.result({type:'result',timestamp:t,hand:{present:true,direction:{x:-1,y:0,z:0},x:.5,y:.5}});
  h.api.primary({timestamp:t,hand:{present:true,direction:{x:1,y:0,z:0}}});
  const box=h.elements.get('require-consensus');box.checked=true;box.change();assert.equal(h.validator({id:'cover'},t),true);
  h.config.secondaryCameraId='other-camera';assert.equal(h.validator({id:'cover'},t),false);
});
