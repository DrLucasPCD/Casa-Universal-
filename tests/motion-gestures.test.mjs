import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const context=vm.createContext({});
for(const file of ['motion-gestures','accessible-gestures','hand-features'])vm.runInContext(readFileSync(new URL(`../static/${file}.js`,import.meta.url),'utf8'),context);
const create=context.CasaMotionGestures.create;
const hand=(x=0,y=0,reach={x:0,y:0,z:-.65})=>({present:true,x:.5+x*.1,y:.5+y*.1,motion:{x,y,reach}});
function feed(engine,points,type='projector',start=100){return points.flatMap((p,i)=>{const key=engine.sample(p,type,start+i*100);return key?[key]:[];});}
test('each cardinal gesture sends once; its return and endpoint hold send nothing',()=>{
  for(const [x,y,key]of [[1,0,'right'],[-1,0,'left'],[0,-1,'up'],[0,1,'down']]){
    const e=create();e.anchor(hand(),0);
    const path=[.05,.12,.2,.3,.4,.4,...Array(15).fill(.4),.3,.2,.1,0,0,0,0].map(v=>hand(x*v,y*v));
    assert.deepEqual(feed(e,path),[key]);
    assert.deepEqual(feed(e,[.1,.2,.3,.4,.4].map(v=>hand(x*v,y*v)),'projector',2900),[key]);
  }
});
test('curtain up/down strokes ignore lateral tremor and the returning arm',()=>{
  for(const [sign,key] of [[-1,'open'],[1,'close']]){
    const e=create();e.anchor(hand(),0);
    assert.deepEqual(feed(e,[.03,.1,.2,.3,.4,.4,.3,.2,.1,0].map((v,i)=>hand(i%2*.02,sign*v)),'curtain'),[key]);
  }
});
test('projector OK requires a deliberate 3D push, not stationary dwell or one depth spike',()=>{
  const e=create();e.anchor(hand(),0);
  assert.deepEqual(feed(e,Array.from({length:30},()=>hand())),[]);
  assert.deepEqual(feed(e,[hand(0,0,{x:0,y:0,z:-.85}),hand(),hand(),hand()],'projector',3100),[]);
  assert.deepEqual(feed(e,[.68,.72,.76,.79,.79,.79].map(z=>hand(0,0,{x:0,y:0,z:-z})),'projector',3500),['ok']);
  assert.deepEqual(feed(e,Array.from({length:30},()=>hand(0,0,{x:0,y:0,z:-.79})),'projector',4100),[]);
  assert.equal(e.report().returning,true);
  feed(e,Array.from({length:6},()=>hand()),'projector',7100);
  assert.equal(e.report().returning,false);
});
test('missing depth never confirms OK; optical flow still permits planar navigation',()=>{
  const e=create();e.anchor(hand(0,0,null),0);
  assert.deepEqual(feed(e,Array.from({length:25},()=>hand(0,0,null))),[]);
  assert.deepEqual(feed(e,[.05,.12,.2,.3,.4,.4].map(x=>hand(x,0,null)),'projector',2600),['right']);
});
test('diagonal uncertainty, pose jumps, stale observations and a busy device do not queue commands',()=>{
  const e=create();e.anchor(hand(),0);
  assert.deepEqual(feed(e,[.05,.12,.2,.3,.4].map(v=>hand(v,v))),[]);
  e.anchor(hand(),1000);assert.equal(e.sample(hand(2,0),'projector',1100),null);
  assert.equal(e.report().phase,'uncertain');
  e.anchor(hand(),2000);assert.equal(e.sample(hand(.5,0),'projector',3000),null);
  e.anchor(hand(),4000);
  for(let i=1;i<6;i++)assert.equal(e.sample(hand(i*.08,0),'projector',4000+i*100,{actionsEnabled:false}),null);
  assert.equal(e.sample(hand(.4,0),'projector',4600),null);
  assert.deepEqual(feed(e,Array.from({length:10},()=>hand(.4,0)),'projector',4700),[]);
});
test('selected projector stays locked while swiping across another target',()=>{
  const e=context.CasaAccessibleGestures.create({automatic:true}),projector={id:'projector',type:'projector'},lamp={id:'lamp',type:'switch'};
  for(let t=0;t<=600;t+=100)e.sample(hand(),projector,t);
  const events=[];
  for(let i=0;i<8;i++)events.push(...e.sample(hand(i*.06,0),lamp,700+i*100));
  assert.equal(events.length,1);assert.equal(events[0].key,'right');assert.equal(e.report().targetId,'projector');
  for(let t=1600;t<=2500;t+=100)e.sample({...hand(),armLowered:true},lamp,t);
  assert.equal(e.report().targetId,null);
});
test('waiting for delivery preserves the return latch instead of issuing the opposite command',()=>{
  const e=create();e.anchor(hand(),0);
  assert.deepEqual(feed(e,[.1,.2,.3,.4,.4,.4].map(x=>hand(x,0))),['right']);
  for(let t=700;t<=1600;t+=100)e.sample(hand(.4,0),'projector',t,{actionsEnabled:false});
  assert.equal(e.sample(hand(.4,0),'projector',1700),null);
  assert.deepEqual(feed(e,[.3,.2,.1,0,0,0,0].map(x=>hand(x,0)),'projector',1800),[]);
  assert.equal(e.report().returning,false);
});
test('an isolated position spike cannot rebase the gesture; a sustained fast stroke is accepted',()=>{
  const e=create();e.anchor(hand(),0);
  assert.equal(e.sample(hand(2,0),'projector',100),null);
  assert.deepEqual(feed(e,[hand(),hand(),hand()],'projector',200),[]);
  assert.equal(e.sample(hand(0,-.8),'projector',500),null);
  assert.deepEqual(feed(e,[hand(0,-.8),hand(0,-.8),hand(0,-.8)],'projector',600),['up']);
  assert.equal(e.sample(hand(2,0),'projector',400),null);
  assert.equal(e.report().returning,true);
});
test('brief wrist loss preserves the return lock across resumed camera frames',()=>{
  const e=context.CasaAccessibleGestures.create({automatic:true}),t={id:'cover',type:'curtain'};
  for(let now=0;now<=600;now+=100)e.sample(hand(),t,now);
  const events=[];for(let i=0;i<6;i++)events.push(...e.sample(hand(0,-i*.1),t,700+i*100));
  assert.equal(events.length,1);assert.equal(events[0].direction,'open');
  e.sample({present:false},null,1300);
  for(let i=0;i<9;i++)assert.equal(e.sample(hand(0,-.4+i*.05),t,1400+i*100).length,0);
});
test('neutral is measured during selection instead of relying on one jittery initial frame',()=>{
  const e=context.CasaAccessibleGestures.create({automatic:true}),t={id:'projector',type:'projector'};
  for(let i=0;i<=6;i++)e.sample({...hand(0,i===0?.18:0),x:.5,y:.5},t,i*100);
  for(let now=700;now<=2400;now+=100)assert.equal(e.sample(hand(),t,now).length,0);
});
test('body-relative features ignore torso translation and adapt to image aspect and distance',()=>{
  function frame(scale=1,shift=0){
    const points=Array.from({length:33},()=>({x:.5,y:.5,z:0,visibility:.95}));
    points[11].x=.7;points[12].x=.3;points[14].x=.2;points[16].x=.2;points[16].y=.3;
    const world=structuredClone(points);
    for(const p of points){p.x=.5+(p.x-.5)*scale+shift;p.y=.5+(p.y-.5)*scale;}
    return {imageAspect:16/9,poseLandmarks:[points],poseWorldLandmarks:[world]};
  }
  const features=context.CasaHandFeatures.features;
  const a=features(frame(),{tracker:'arm'}).motion,b=features(frame(.7,.1),{tracker:'arm'}).motion;
  assert.ok(Math.abs(a.x-b.x)<1e-6);assert.ok(Math.abs(a.y-b.y)<1e-6);
  const missing=frame();missing.poseLandmarks[0][14].visibility=.1;
  assert.equal(features(missing,{tracker:'arm'}).motion.reach,null);
});
