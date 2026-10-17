import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const cv=createRequire(import.meta.url)('jsfeat');
const context=vm.createContext({});vm.runInContext(readFileSync(new URL('../static/wrist-flow.js',import.meta.url),'utf8'),context);
const width=160,height=120;
function image(dx=0,dy=0,texture=true){const data=new Uint8ClampedArray(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const px=x-dx,py=y-dy;const value=texture&&px>=50&&px<92&&py>=38&&py<80?(((px*7+py*11)^(px*py*3))%200)+30:30;const i=(y*width+x)*4;data[i]=data[i+1]=data[i+2]=value;data[i+3]=255;}return data;}
test('wrist continuity measures real image displacement during a brief pose loss',()=>{
  const flow=context.CasaWristFlow.create(cv);flow.update(image(),width,height,{x:70/width,y:58/height},1000);
  const point=flow.update(image(3,-2),width,height,null,1100);
  assert.ok(point);assert.equal(point.source,'image-flow');assert.ok(point.points>=5);assert.ok(Math.abs(point.x-73/width)<.01);assert.ok(Math.abs(point.y-56/height)<.01);
});
test('flat images, stale frames and ambiguous people never produce a wrist position',()=>{
  const flow=context.CasaWristFlow.create(cv);flow.update(image(0,0,false),width,height,{x:.5,y:.5},1000);
  assert.equal(flow.update(image(0,0,false),width,height,null,1100),null);
  flow.update(image(),width,height,{x:70/width,y:58/height},1200);
  assert.equal(flow.update(image(3,-2),width,height,null,1700),null);
  flow.update(image(),width,height,{x:70/width,y:58/height},1800);
  assert.equal(flow.update(image(3,-2),width,height,null,1900,{ambiguous:true}),null);
});
test('image continuity expires and cannot survive a cut to another image',()=>{
  const flow=context.CasaWristFlow.create(cv);flow.update(image(),width,height,{x:70/width,y:58/height},1000);
  assert.equal(flow.update(image(0,0,false),width,height,null,1100),null);
  flow.update(image(),width,height,{x:70/width,y:58/height},1200);
  for(let t=1300;t<=3000;t+=100)flow.update(image(),width,height,null,t);
  assert.equal(flow.update(image(),width,height,null,3100),null);
});
