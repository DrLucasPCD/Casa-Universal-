import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,stat,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {GestureStore,validateCalibration,accessibility} from '../bridge/gesture-store.mjs';
import {createAlexaBridge} from '../bridge/alexa-server.mjs';
const config=()=>({version:1,cameraId:'camera-1',targets:[{id:'curtain',name:' Cortina ',type:'curtain',anchor:{x:.4,y:.5},direction:{x:0,y:1,z:0},position:0}]});
test('old calibration gains stroke/push defaults without losing learned directions or bindings',()=>{
  const input=config();input.targets[0].binding={deviceId:'motor',keys:{}};
  const clean=validateCalibration(input);
  assert.equal(clean.settings.motionMode,'stroke');assert.equal(clean.settings.projectorConfirm,'push');
  assert.equal(clean.settings.curtainPulseMs,1000);assert.throws(()=>accessibility({curtainPulseMs:5000}));
  assert.deepEqual(clean.targets[0].direction,input.targets[0].direction);assert.equal(clean.targets[0].binding.deviceId,'motor');
  assert.equal(accessibility({motionMode:'continuous',projectorConfirm:'dwell'}).projectorConfirm,'dwell');
  assert.throws(()=>accessibility({projectorConfirm:'guess'}));assert.throws(()=>accessibility({motionMode:'guess'}));
});
test('arm direction profiles preserve the right arm while the left remains uncalibrated',async()=>{
  const value=config();value.targets[0].tracker='arm';
  const right=validateCalibration(value),original=right.targets[0].direction;
  assert.deepEqual(right.targets[0].directionProfiles.arm_right.direction,original);
  right.settings.side='left';right.targets[0].direction=null;
  const directory=await mkdtemp(join(tmpdir(),'casa-sides-'));
  try{
    const store=new GestureStore({directory});await store.save(right);
    const loaded=await new GestureStore({directory}).load();
    assert.equal(loaded.settings.side,'left');assert.equal(loaded.targets[0].direction,null);
    assert.deepEqual(loaded.targets[0].directionProfiles.arm_right.direction,original);
    loaded.targets[0].directionProfiles.arm_left={direction:{x:1,y:0,z:0},tolerance:28};
    const both=validateCalibration(loaded);assert.equal(both.targets[0].directionProfiles.arm_left.tolerance,28);
    both.targets[0].directionProfiles.arm_left.direction.x=3;assert.throws(()=>validateCalibration(both));
    const invalid=config();invalid.targets[0].directionProfiles={unexpected:{direction:original}};assert.throws(()=>validateCalibration(invalid));
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('secondary camera calibration keeps distinct world directions and rejects malformed camera identifiers',()=>{
  const value=config();value.secondaryCameraId='mac-camera-123';value.targets[0].directionProfiles={mac_arm_left:{direction:{x:1,y:0,z:0},tolerance:28}};
  const clean=validateCalibration(value);assert.equal(clean.secondaryCameraId,'mac-camera-123');assert.equal(clean.targets[0].direction.y,1);assert.equal(clean.targets[0].directionProfiles.mac_arm_left.direction.x,1);
  value.secondaryCameraId='https://invalid/camera';assert.throws(()=>validateCalibration(value));
});
test('calibration validates every target and strips unrelated data',()=>{
  const value=config();value.accessToken='must-not-save';value.targets[0].frame='must-not-save';
  const clean=validateCalibration(value);assert.equal(clean.targets[0].name,'Cortina');assert.ok(!JSON.stringify(clean).includes('must-not-save'));
  for(const mutate of [v=>v.targets.push(v.targets[0]),v=>v.targets[0].direction.y=2,v=>v.targets[0].anchor.x=-1,v=>v.targets[0].position=101,v=>v.targets[0].type='lock',v=>v.cameraId=3]) {
    const invalid=config();mutate(invalid);assert.throws(()=>validateCalibration(invalid));
  }
});
test('calibration persists privately and invalid writes preserve the previous configuration',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'casa-gesture-'));
  try {
    const store=new GestureStore({directory});await store.save(config());
    assert.equal((await stat(join(directory,'calibration.json'))).mode&0o777,0o600);
    assert.equal((await stat(directory)).mode&0o777,0o700);
    const invalid=config();invalid.targets[0].position=Infinity;await assert.rejects(store.save(invalid));
    const restored=new GestureStore({directory});await restored.load();assert.equal(restored.config.targets[0].position,0);
    assert.equal(JSON.parse(await readFile(join(directory,'calibration.json'))).cameraId,'camera-1');
  } finally {await rm(directory,{recursive:true,force:true});}
});
test('telemetry expires and never exposes arbitrary landmarks or enables commands',()=>{
  const store=new GestureStore();store.config=validateCalibration(config());
  store.update({mode:'preview',phase:'tracking',handPresent:true,targetId:'curtain',detectedHands:1,reason:'tracked',inferenceMs:38,commandsEnabled:true,landmarks:['private-frame']});
  const result=store.status(store.report.receivedAt+100);assert.equal(result.handPresent,true);assert.equal(result.commandsEnabled,false);assert.equal(result.detectedHands,1);
  assert.ok(!JSON.stringify(result).includes('private-frame'));
  const stale=store.status(store.report.receivedAt+2001);assert.equal(stale.handPresent,false);assert.equal(stale.phase,'stopped');assert.equal(stale.targetId,null);assert.equal(stale.reason,null);
  assert.throws(()=>store.update({mode:'control',phase:'tracking',handPresent:true}));
});
test('gesture HTTP API stores calibration with origin checks and rejects commands without an active session',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'casa-gesture-http-'));
  const gestures=new GestureStore({directory}),login={status:()=>({authenticated:false}),close(){}},cloud={status:()=>({}),stop(){}};
  const bridge=createAlexaBridge({port:0,login,cloud,gestures,restore:false}),url=await bridge.start();
  const post=(path,body,origin=url.slice(0,-1))=>fetch(url+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
  try {
    assert.equal((await post('api/gestures/config',config(),'https://other.invalid')).status,403);
    assert.equal((await post('api/gestures/config',config())).status,200);
    const invalid=config();invalid.targets[0].position=-1;
    const rejected=await post('api/gestures/config',invalid);assert.equal(rejected.status,400);assert.match((await rejected.json()).error,/Abertura/);
    assert.equal((await post('api/gestures/execute',{targetId:'curtain'})).status,400);
    const status=await(await fetch(url+'api/gestures/status')).json();assert.equal(status.commandsEnabled,false);assert.equal(status.calibratedTargets,0);
    const worker=await fetch(url+'hand-worker.js');assert.equal(worker.status,200);assert.match(worker.headers.get('content-security-policy'),/worker-src 'self'/);
    assert.equal((await fetch(url+'motion-gestures.js')).status,200);
    assert.equal((await fetch(url+'vision/registration.json')).status,404);
  } finally {await bridge.close();await rm(directory,{recursive:true,force:true});}
});

 test('pointing marks and wrist continuity are reported without raw images or coordinates',()=>{
  const store=new GestureStore();store.config=validateCalibration(config());store.config.settings={selection:'point'};store.config.targets[0].direction=null;store.config.targets[0].binding={deviceId:'cover'};
  store.update({mode:'preview',phase:'tracking',handPresent:true,reason:'image-flow'});
  assert.equal(store.status().calibratedTargets,1);assert.equal(store.status().reason,'image-flow');
});
