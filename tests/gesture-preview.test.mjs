import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=name=>readFileSync(new URL('../static/'+name,import.meta.url),'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function harness() {
  const nodes=new Map(),requests=[],workers=[],frames=new Map(),events={};let now=1000,id=0,tick,arcs=0;
  function element() {return {textContent:'',value:'',dataset:{},children:[],addEventListener(name,fn){this[name]=fn;},replaceChildren(){this.children=[];},append(e){this.children.push(e);},prepend(e){this.children.unshift(e);}};}
  const document={hidden:false,getElementById(id){if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);},createElement:element,addEventListener(name,fn){events[name]=fn;}};
  const video={readyState:4,videoWidth:1280,videoHeight:720,srcObject:{getVideoTracks:()=>[{readyState:'live'}]},addEventListener(){},requestVideoFrameCallback(fn){frames.set(++id,fn);return id;},cancelVideoFrameCallback(id){frames.delete(id);}};
  const ctx=new Proxy({arc(){arcs++;}},{get:(o,k)=>o[k]??(()=>{})});
  const canvas={...element(),getContext:()=>ctx};
  const context={window:{},document,performance:{now:()=>now},crypto:{randomUUID:()=>'target'},addEventListener(){},setInterval(fn){tick=fn;return 1;},clearInterval(){tick=null;},
    createImageBitmap:async()=>({close(){}}),Worker:class {constructor(){workers.push(this);}postMessage(){}terminate(){this.terminated=true;}},
    fetch:async(path,options)=>{requests.push({path,body:options?.body?JSON.parse(options.body):null});return{ok:true,json:async()=>path==='/api/gestures/config'?{version:1,cameraId:null,targets:[]}: {}};}};
  vm.createContext(context);for(const file of ['gesture-engine.js','hand-features.js','gesture-preview.js'])vm.runInContext(source(file),context);
  const client=context.window.CasaGesturePreview.create({video,canvas});
  return {client,document,video,requests,workers,nodes,events,frames,get arcs(){return arcs;},setNow(value){now=value;},tick:()=>tick?.(),click:id=>nodes.get(id).click(),result(data){workers.at(-1).onmessage({data});}};
}
test('preview needs a live decoded video and starts the model only explicitly',async()=>{
  const h=harness();await flush();assert.equal(h.workers.length,0);
  h.video.readyState=0;await h.click('hand-start');assert.equal(h.workers.length,0);
  h.video.readyState=4;await h.click('hand-start');assert.equal(h.workers.length,1);
  h.client.stop();assert.equal(h.workers[0].terminated,true);
});
test('ineligible small hands draw points and report diagnostics without landmarks or commands',async()=>{
  const h=harness();await flush();await h.click('hand-start');h.result({type:'ready'});
  const points=Array.from({length:21},()=>({x:.5,y:.5,z:0}));points[17].x=.51;
  h.result({type:'result',timestamp:1000,elapsedMs:35,landmarks:[points],worldLandmarks:[]});
  assert.ok(h.arcs>=21);assert.match(h.nodes.get('hand-diagnostic').textContent,/1 mão/);
  h.setNow(1100);h.tick();await flush();
  const report=h.requests.filter(r=>r.path==='/api/gestures/report').at(-1).body;
  assert.equal(report.handPresent,false);assert.equal(report.reason,'too-small');assert.equal(report.landmarks,undefined);
  assert.ok(h.requests.every(r=>['/api/gestures/config','/api/gestures/report'].includes(r.path)));
  h.client.stop();
});
test('late model messages after stop cannot resurrect hand tracking',async()=>{
  const h=harness();await flush();await h.click('hand-start');const worker=h.workers[0];
  h.client.stop();worker.onmessage({data:{type:'ready'}});
  assert.equal(h.frames.size,0);assert.equal(h.nodes.get('hand-start').disabled,false);
  assert.equal(h.nodes.get('hand-pose').textContent,'Reconhecimento parado');
});
test('hiding the page stops the worker and cancels queued frame callbacks',async()=>{
  const h=harness();await flush();await h.click('hand-start');h.result({type:'ready'});assert.equal(h.frames.size,1);
  h.document.hidden=true;h.events.visibilitychange();assert.equal(h.frames.size,0);assert.equal(h.workers[0].terminated,true);
});
