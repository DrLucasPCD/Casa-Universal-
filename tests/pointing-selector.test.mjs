import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const context=vm.createContext({});vm.runInContext(readFileSync(new URL('../static/pointing-selector.js',import.meta.url),'utf8'),context);
const select=context.CasaPointingSelector.select;
const target=(id,x,y)=>({id,anchor:{x,y},binding:{deviceId:id}});
const ray={origin:{x:.2,y:.5},tip:{x:.4,y:.5}};
test('forearm ray selects a marked appliance without a learned direction or menu',()=>{
  const result=select(ray,[target('lamp',.8,.5),target('fan',.7,.8)]);assert.equal(result.target.id,'lamp');
});
test('opposite side and behind-wrist targets cannot be selected',()=>{
  assert.equal(select(ray,[target('behind',.1,.5),target('elbow',.21,.5)]).target,null);
});
test('aligned objects are ambiguous instead of silently picking the nearest',()=>{
  const result=select(ray,[target('lamp',.6,.5),target('fan',.9,.5)]);assert.equal(result.target,null);assert.equal(result.reason,'ambiguous');
});
test('missing, nonfinite, out-of-frame and foreshortened rays do not select',()=>{
  for(const invalid of [null,{origin:{x:NaN,y:.2},tip:ray.tip},{origin:{x:-1,y:.5},tip:ray.tip},{origin:ray.tip,tip:ray.tip}])assert.equal(select(invalid,[target('x',.8,.5)]).target,null);
});
test('image aspect ratio is accounted for when testing a diagonal ray',()=>{
  const r={origin:{x:.2,y:.3},tip:{x:.4,y:.4}};
  for(const aspect of [.5625,1,16/9])assert.equal(select(r,[target('diagonal',.8,.6)],aspect).target.id,'diagonal');
});
test('only marked, bound targets in the visible pointing corridor participate',()=>{
  const targets=[{id:'no-binding',anchor:{x:.8,y:.5}},target('far',.8,.95),{id:'no-marker',binding:{deviceId:'x'}}];
  assert.equal(select(ray,targets).target,null);
});
