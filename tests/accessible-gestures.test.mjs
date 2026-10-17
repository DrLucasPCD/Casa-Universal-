import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const context=vm.createContext({});vm.runInContext(readFileSync(new URL('../static/accessible-gestures.js',import.meta.url),'utf8'),context);
const create=()=>context.CasaAccessibleGestures.create({dwellMs:1500,stability:.07,movement:.05});
const hand=(extra={})=>({present:true,x:.5,y:.5,...extra});
const target=(type='switch')=>({id:'test',type});
function dwell(engine,t=target(),start=0){let out=[];for(let now=start;now<=start+1500;now+=100)out.push(...engine.sample(hand(),t,now));return out;}
test('comfortable hand confirms once by dwell without finger or pinch requirements',()=>{
  const engine=create();assert.equal(dwell(engine)[0].type,'activate');
  for(let now=1600;now<5000;now+=100)assert.equal(engine.sample(hand(),target(),now).length,0);
  assert.equal(engine.report().phase,'release');
});
test('brief recognition loss cannot repeat a switch; deliberate absence rearms',()=>{
  const engine=create();dwell(engine);engine.sample({present:false},null,1600);
  assert.equal(dwell(engine,target(),1700).length,0);
  engine.sample({present:false},null,3300);engine.sample({present:false},null,4600);
  assert.equal(dwell(engine,target(),4700)[0].type,'activate');
});
test('small movements are tolerated but drift or a changed target resets dwell',()=>{
  const engine=create();engine.sample(hand(),target(),0);
  for(let now=100;now<=1400;now+=100)engine.sample(hand({x:.52}),target(),now);
  engine.sample(hand({x:.7}),target(),1500);assert.equal(engine.report().progress,0);
  engine.sample(hand({x:.7}),{id:'other',type:'switch'},1600);assert.equal(engine.report().progress,0);
});
test('curtain requires dwell before motion and creates bounded-rate directional pulses',()=>{
  const engine=create(),t=target('curtain');assert.equal(dwell(engine,t).length,0);
  assert.equal(engine.sample(hand({y:.4}),t,1600)[0].direction,'open');
  assert.equal(engine.sample(hand({y:.2}),t,1700).length,0);
  for(let now=1800;now<=2400;now+=100)engine.sample(hand({y:.4}),t,now);
  assert.equal(engine.sample(hand({y:.6}),t,2500)[0].direction,'close');
  engine.sample({present:false},null,2600);assert.equal(engine.report().phase,'paused');engine.sample({present:false},null,3600);assert.equal(engine.report().targetId,null);
});
test('projector navigation and OK use movement and dwell, not pinch',()=>{
  const engine=create(),t=target('projector');dwell(engine,t);
  assert.equal(engine.sample(hand({x:.6}),t,1600)[0].key,'right');
  let events=[];for(let now=1700;now<=3200;now+=100)events.push(...engine.sample(hand({x:.6}),t,now));
  assert.equal(events.filter(e=>e.key==='ok').length,1);
  for(let now=3300;now<=5000;now+=100)assert.equal(engine.sample(hand({x:.6}),t,now).length,0);
});
test('old frames and lost video cannot complete a dwell',()=>{
  const engine=create();engine.sample(hand(),target(),1000);assert.equal(engine.sample(hand(),target(),900).length,0);
  engine.tick(1700);assert.equal(engine.report().targetId,null);
  assert.equal(engine.sample(hand(),target(),1800).length,0);assert.equal(engine.report().progress,0);
});

test('default fast confirmation completes in 600 ms and still fires once',()=>{
  const engine=context.CasaAccessibleGestures.create();let events=[];
  for(let now=0;now<=600;now+=100)events.push(...engine.sample(hand(),target(),now));
  assert.equal(events.length,1);assert.equal(events[0].type,'activate');
  for(let now=700;now<2000;now+=100)assert.equal(engine.sample(hand(),target(),now).length,0);
});

test('brief occlusion pauses a confirmed target and reanchors without sending a jump',()=>{
  const engine=create(),t=target('curtain');dwell(engine,t);
  engine.sample({present:false},null,1600);assert.equal(engine.report().phase,'paused');
  assert.equal(engine.sample(hand({y:.3}),t,1700).length,0);
  assert.equal(engine.sample(hand({y:.2}),t,1800)[0].direction,'open');
});
