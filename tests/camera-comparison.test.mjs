import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const c=vm.createContext({});vm.runInContext(readFileSync(new URL('../static/camera-comparison.js',import.meta.url),'utf8'),c);
const observation=(id,t=1000,present=true)=>({timestamp:t,hand:{present},targetId:id});
test('two cameras agree on independently calibrated target IDs, never on raw world axes',()=>{
  const a=observation('cover'),b=observation('cover',1100);a.hand.direction={x:1,y:0,z:0};b.hand.direction={x:-1,y:0,z:0};
  assert.equal(c.CasaCameraComparison.compare(a,b,1150).consensus,'cover');
  assert.equal(c.CasaCameraComparison.compare(a,observation('lamp',1100),1150).conflict,true);
});
test('stale, missing, future and unsynchronized frames cannot authorize a selection',()=>{
  const compare=c.CasaCameraComparison.compare;
  for(const b of [null,observation('cover',0),observation('cover',1400),observation('cover',1000,false),observation(null)])assert.equal(compare(observation('cover'),b,1100).consensus,null);
  assert.equal(compare(observation('cover',900),observation('cover',1251),1300).consensus,null);
});
test('guided trial counts both wrong agreements and missed selections without reporting a false accuracy gain',()=>{
  const meter=c.CasaCameraComparison.meter('cover');
  meter.add(observation('cover'),observation('cover'),1000);meter.add(observation('cover'),observation('cover'),1001);
  meter.add(observation('lamp',1100),observation('lamp',1100),1100);
  meter.add(observation('cover',1200),observation(null,1200,false),1200);
  const r=meter.result();assert.equal(r.samples,3);assert.equal(r.echoCorrect,2);assert.equal(r.consensusCorrect,1);assert.equal(r.consensusWrong,1);assert.equal(r.macVisible,2);
});
