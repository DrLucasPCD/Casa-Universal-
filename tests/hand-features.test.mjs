import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const context=vm.createContext({});
vm.runInContext(readFileSync(new URL('../static/hand-features.js',import.meta.url),'utf8'),context);
const {features,match,calibration}=context.CasaHandFeatures;
function hand() {
  const points=Array.from({length:21},()=>({x:.5,y:.5,z:0}));
  points[5]={x:.45,y:.5,z:0};points[17]={x:.6,y:.5,z:0};
  const world=Array.from({length:21},()=>({x:0,y:0,z:0}));
  world[5]={x:0,y:.04,z:0};world[6]={x:0,y:.07,z:0};
  world[8]={x:0,y:.12,z:0};world[17]={x:.07,y:.04,z:0};world[4]={x:-.05,y:.05,z:0};
  return {landmarks:[points],worldLandmarks:[world]};
}
test('a complete hand provides pointing and pinch features independently',()=>{
  const data=hand(),open=features(data);
  assert.equal(open.present,true);assert.equal(open.pointing,true);assert.ok(open.pinchRatio>.5);
  data.worldLandmarks[0][4]={...data.worldLandmarks[0][8]};
  assert.equal(features(data).pinchRatio,0);
});
test('small and clipped hands remain drawable but cannot select targets',()=>{
  const data=hand();data.landmarks[0][17].x=.46;
  const small=features(data);assert.equal(small.reason,'too-small');assert.equal(small.visibleHands[0].length,21);
  data.landmarks[0][8].x=1.01;
  const clipped=features(data);assert.equal(clipped.present,false);assert.equal(clipped.reason,'incomplete-hand');assert.equal(clipped.visibleHands.length,1);
});
test('multiple hands remain visible without choosing a person or a target',()=>{
  const data=hand();data.landmarks.push(data.landmarks[0]);
  const result=features(data);assert.equal(result.present,false);assert.equal(result.reason,'multiple-hands');assert.equal(result.visibleHands.length,2);
});
test('missing, malformed and nonfinite coordinates fail closed',()=>{
  assert.equal(features({}).reason,'no-hand');
  const data=hand();data.landmarks[0][8].x=NaN;
  assert.equal(features(data).visibleHands.length,0);assert.equal(features(data).present,false);
  const noWorld=hand();delete noWorld.worldLandmarks;
  assert.equal(features(noWorld).reason,'no-direction');assert.equal(features(noWorld).visibleHands.length,1);
});
test('target selection rejects ambiguity, distant directions and invalid vectors',()=>{
  const direction={x:0,y:1,z:0},targets=[{id:'lamp',direction},{id:'fan',direction:{x:1,y:0,z:0}}];
  assert.equal(match(direction,targets).id,'lamp');
  assert.equal(match(direction,[...targets,{id:'other',direction}]),null);
  assert.equal(match({x:0,y:-1,z:0},targets),null);
  assert.equal(match({x:NaN,y:1,z:0},targets),null);
  assert.equal(match(direction,[{id:'bad',direction:{x:0,y:0,z:0}}]),null);
});
test('calibration requires enough stable unit directions',()=>{
  const samples=Array.from({length:8},()=>({x:0,y:1,z:0}));
  assert.equal(calibration(samples).direction.y,1);
  assert.throws(()=>calibration(samples.slice(0,7)));
  assert.throws(()=>calibration([...samples,{x:1,y:0,z:0}]));
  assert.throws(()=>calibration([...samples,{x:0,y:2,z:0}]));
});

test('palm tracking accepts curled/limited fingers without a pinch or straight index',()=>{
  const data=hand();data.worldLandmarks[0][9]={x:.02,y:.04,z:0};
  data.worldLandmarks[0][8]={x:0,y:.015,z:0};data.landmarks[0][8].x=1.01;
  const result=features(data,{tracker:'palm'});assert.equal(result.present,true);assert.equal(result.pointing,true);assert.ok(Number.isFinite(result.direction.y));
});
function pose(){const points=Array.from({length:33},()=>({x:.5,y:.5,z:0,visibility:.95}));points[14]={x:.5,y:.65,z:0,visibility:.95};points[16]={x:.5,y:.4,z:0,visibility:.95};return {landmarks:[],poseLandmarks:[points],poseWorldLandmarks:[structuredClone(points)]};}
test('arm tracking does not require detected hand landmarks or fingers',()=>{
  const result=features(pose(),{tracker:'arm',side:'right'});assert.equal(result.present,true);assert.equal(result.arm.length,2);assert.equal(result.visibleHands.length,0);assert.equal(result.y,.4);
});
test('left arm uses its own shoulder, elbow and wrist even when the right arm is absent',()=>{
  const data=pose(),p=data.poseLandmarks[0];
  p[11]={x:.65,y:.4,z:0,visibility:.95};p[12]={x:.35,y:.4,z:0,visibility:.95};
  p[13]={x:.7,y:.65,z:0,visibility:.95};p[15]={x:.8,y:.3,z:0,visibility:.95};
  p[14].visibility=p[16].visibility=0;
  data.poseWorldLandmarks=[structuredClone(p)];
  const result=features(data,{tracker:'arm',side:'left'});
  assert.equal(result.present,true);assert.equal(result.x,.8);assert.equal(result.arm[0].x,.7);
  assert.ok(result.direction.y<0);assert.ok(result.motion.x>0);
  assert.equal(features(data,{tracker:'arm',side:'right'}).present,false);
});
test('arm tracking rejects an occluded wrist and multiple people',()=>{
  const data=pose();data.poseLandmarks[0][16].visibility=.1;assert.equal(features(data,{tracker:'arm',side:'right'}).present,false);
  data.poseLandmarks.push(data.poseLandmarks[0]);assert.equal(features(data,{tracker:'arm',side:'right'}).reason,'multiple-people');
});

test('comfortable calibration tolerates limited variation and discards isolated outliers',()=>{
  const samples=Array.from({length:16},(_,i)=>({x:Math.sin((i%3-1)*.15),y:Math.cos((i%3-1)*.15),z:0}));samples.push({x:1,y:0,z:0});
  const result=context.CasaHandFeatures.comfortableCalibration(samples);assert.ok(result.direction.y>.98);assert.ok(result.tolerance>=24);
  assert.throws(()=>context.CasaHandFeatures.comfortableCalibration(samples.slice(0,5)));
});

test('manual selection tracks a visible wrist even when the elbow is occluded',()=>{
  const data=pose();data.poseLandmarks[0][14].visibility=.1;
  const result=features(data,{tracker:'arm',side:'right',selection:'manual'});assert.equal(result.present,true);assert.equal(result.arm,null);
  assert.equal(features(data,{tracker:'arm',side:'right',selection:'direction'}).present,true);assert.equal(features(data,{tracker:'arm',side:'right',selection:'direction'}).direction,null);
});

 test('automatic pointing retains the wrist when only the elbow is hidden',()=>{
  const data=pose();data.poseLandmarks[0][14].visibility=.1;
  const result=features(data,{tracker:'arm',side:'right',selection:'point'});
  assert.equal(result.present,true);assert.equal(result.reason,'wrist-only');assert.equal(result.ray,null);assert.equal(result.direction,null);assert.equal(result.y,.4);
  data.poseLandmarks[0][16].visibility=.1;assert.equal(features(data,{tracker:'arm',selection:'point'}).present,false);
});

 test('measured wrist continuity works without a visible body but cannot override multiple people',()=>{
  const trackedWrist={x:.4,y:.6,z:0,source:'image-flow',points:8,ageMs:300};
  assert.equal(features({poseLandmarks:[],trackedWrist},{tracker:'arm',selection:'point'}).reason,'image-flow');
  assert.equal(features({poseLandmarks:[],trackedWrist:{...trackedWrist,ageMs:1801}},{tracker:'arm',selection:'point'}).present,false);
  assert.equal(features({poseLandmarks:[[],[]],trackedWrist},{tracker:'arm',selection:'point'}).present,false);
});

 test('pointing direction uses all three world axes independently of identical screen coordinates',()=>{
  const a=pose(),b=pose();
  a.poseWorldLandmarks[0][14]={x:0,y:0,z:0};b.poseWorldLandmarks[0][14]={x:0,y:0,z:0};
  a.poseWorldLandmarks[0][16]={x:.1,y:-.2,z:.3};b.poseWorldLandmarks[0][16]={x:.1,y:-.2,z:-.3};
  const first=features(a,{tracker:'arm',selection:'direction'}),second=features(b,{tracker:'arm',selection:'direction'});
  assert.equal(first.x,second.x);assert.equal(first.y,second.y);assert.ok(first.direction.z>0);assert.ok(second.direction.z<0);
  const targets=[{id:'front',direction:first.direction},{id:'back',direction:second.direction}];
  assert.equal(match(first.direction,targets).id,'front');assert.equal(match(second.direction,targets).id,'back');
  assert.equal(context.CasaHandFeatures.selectDirection(first.direction,[targets[0],{id:'same',direction:first.direction}]).reason,'ambiguous');
});

 test('close calibrated 3D directions allow comfortable variation but still reject the midpoint',()=>{
  const vector=degrees=>({x:Math.sin(degrees*Math.PI/180),y:Math.cos(degrees*Math.PI/180),z:0});
  const targets=[{id:'cover',direction:vector(0)},{id:'lamp',direction:vector(13)}];
  assert.equal(context.CasaHandFeatures.selectDirection(vector(5),targets,24,7).reason,'ambiguous');
  assert.equal(context.CasaHandFeatures.selectDirection(vector(5),targets,24,'adaptive').match.id,'cover');
  assert.equal(context.CasaHandFeatures.selectDirection(vector(6.5),targets,24,'adaptive').reason,'ambiguous');
});
