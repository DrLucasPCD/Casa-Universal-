import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=name=>readFileSync(new URL('../static/'+name,import.meta.url),'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function harness({targets=[],settings={tracker:'palm'},reportStatus=null,armSession=null}={}) {
  const nodes=new Map(),requests=[],workers=[],frames=new Map(),events={};let now=1000,id=0,tick,arcs=0;
  function element() {return {getContext:()=>ctx,textContent:'',value:'',setAttribute(){},dataset:{},children:[],addEventListener(name,fn){this[name]=fn;},replaceChildren(){this.children=[];},append(e){this.children.push(e);},prepend(e){this.children.unshift(e);}};}
  const document={hidden:false,getElementById(id){if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);},createElement:element,addEventListener(name,fn){events[name]=fn;}};
  const video={readyState:4,videoWidth:1280,videoHeight:720,srcObject:{getVideoTracks:()=>[{readyState:'live'}]},addEventListener(){},requestVideoFrameCallback(fn){frames.set(++id,fn);return id;},cancelVideoFrameCallback(id){frames.delete(id);}};
  const ctx=new Proxy({arc(){arcs++;}},{get:(o,k)=>o[k]??(()=>{})});
  const canvas={...element(),getContext:()=>ctx,getBoundingClientRect:()=>({left:0,top:0,width:1280,height:720})};
  const context={structuredClone,window:{},document,performance:{now:()=>now},crypto:{randomUUID:()=>'target'},addEventListener(){},setInterval(fn){tick=fn;return 1;},clearInterval(){tick=null;},
    createImageBitmap:async()=>({close(){}}),Worker:class {constructor(){workers.push(this);}postMessage(){}terminate(){this.terminated=true;}},
    fetch:async(path,options)=>{requests.push({path,body:options?.body?JSON.parse(options.body):null});return{ok:true,json:async()=>path==='/api/gestures/config'?(options?.body?JSON.parse(options.body):{version:1,cameraId:null,targets,settings}):path==='/api/gestures/arm'?{sessionId:armSession}:path==='/api/gestures/report'&&reportStatus?reportStatus:path==='/api/gestures/central'?{address:'http://192.168.68.117',devices:[]}:{}};}};
  vm.createContext(context);for(const file of ['pointing-selector.js','motion-gestures.js','accessible-gestures.js','hand-features.js','gesture-preview.js'])vm.runInContext(source(file),context);
  const client=context.window.CasaGesturePreview.create({video,canvas});
  return {client,document,video,canvas,requests,workers,nodes,events,frames,get arcs(){return arcs;},setNow(value){now=value;},tick:()=>tick?.(),click:id=>nodes.get(id).click(),result(data){workers.at(-1).onmessage({data});}};
}
test('preview needs a live decoded video and starts the model only explicitly',async()=>{
  const h=harness();await flush();assert.equal(h.workers.length,0);
  h.video.readyState=0;await h.click('hand-start');assert.equal(h.workers.length,0);
  h.video.readyState=4;await h.click('hand-start');assert.equal(h.workers.length,1);
  h.client.stop();assert.equal(h.workers[0].terminated,true);
});
test('a session stopped by the central is visibly disarmed instead of continuing to show active control',async()=>{
  const h=harness({armSession:'session',reportStatus:{commandsEnabled:false,lastResult:{ok:false,message:'Parada não confirmada.'}}});
  await flush();h.client.setCamera('camera');await h.click('hand-start');h.result({type:'ready'});
  await h.click('enable-control');await flush();
  assert.match(h.nodes.get('control-mode').textContent,/MODO PRÉVIA/);
  assert.equal(h.nodes.get('command-status').textContent,'Parada não confirmada.');h.client.stop();
});
test('ineligible small hands draw points and report diagnostics without landmarks or commands',async()=>{
  const h=harness();await flush();await h.click('hand-start');h.result({type:'ready'});
  const points=Array.from({length:21},()=>({x:.5,y:.5,z:0}));points[17].x=.505;
  h.result({type:'result',timestamp:1000,elapsedMs:35,landmarks:[points],worldLandmarks:[points]});
  assert.ok(h.arcs>=21);assert.match(h.nodes.get('hand-diagnostic').textContent,/Aproxime/);
  h.setNow(1100);h.tick();await flush();
  const report=h.requests.filter(r=>r.path==='/api/gestures/report').at(-1).body;
  assert.equal(report.handPresent,false);assert.equal(report.reason,'too-small');assert.equal(report.landmarks,undefined);
  assert.ok(h.requests.every(r=>['/api/gestures/config','/api/gestures/report','/api/gestures/stop','/api/gestures/central'].includes(r.path)));
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

test('one-time location setup persists all marks without sending device commands',async()=>{
  const targets=['curtain','lamp'].map((id,i)=>({id,name:id,type:i?'switch':'curtain',anchor:null,direction:null,position:null,tracker:'arm',binding:{deviceId:id}}));
  const h=harness({targets,settings:{tracker:'arm',selection:'point',motionMode:'continuous'}});await flush();
  assert.equal(h.nodes.get('manual-target-row').hidden,true);
  await h.click('setup-locations');h.canvas.pointerdown({clientX:900,clientY:200});h.canvas.pointerdown({clientX:200,clientY:400});await flush();
  const saved=h.requests.filter(r=>r.path==='/api/gestures/config'&&r.body).at(-1).body;
  assert.equal(saved.targets[0].anchor.x,900/1280);assert.equal(saved.targets[1].anchor.y,400/720);
  assert.equal(saved.settings.selection,'point');assert.ok(!h.requests.some(r=>r.path==='/api/gestures/execute'));
  assert.match(h.nodes.get('setup-status').textContent,/2 aparelhos/);
});
test('switching arms restores each learned direction and saves the inactive profile',async()=>{
  const target={id:'cover',name:'Cortina',type:'curtain',tracker:'arm',anchor:{x:.5,y:.2},direction:{x:0,y:-1,z:0},tolerance:30,binding:{deviceId:'cover'}};
  const h=harness({targets:[target],settings:{tracker:'arm',side:'right',selection:'direction'}});await flush();
  const side=h.nodes.get('tracking-side');side.value='left';side.change();await flush();
  assert.equal(target.direction,null);assert.match(h.nodes.get('setup-status').textContent,/0\/1/);
  await h.click('save-calibration');
  let saved=h.requests.filter(r=>r.path==='/api/gestures/config'&&r.body).at(-1).body;
  assert.equal(saved.settings.side,'left');assert.equal(saved.targets[0].directionProfiles.arm_right.direction.y,-1);
  side.value='right';side.change();await flush();
  assert.match(h.nodes.get('setup-status').textContent,/1\/1/);
  await h.click('save-calibration');saved=h.requests.filter(r=>r.path==='/api/gestures/config'&&r.body).at(-1).body;
  assert.equal(saved.targets[0].direction.y,-1);assert.equal(saved.targets[0].tolerance,30);
  assert.ok(!h.requests.some(r=>r.path==='/api/gestures/execute'));
});
test('an appliance outside the camera remains unmarked when explicitly skipped',async()=>{
  const h=harness({targets:[{id:'lamp',name:'Lamp',type:'switch',anchor:null,binding:{deviceId:'lamp'}}],settings:{tracker:'arm',selection:'point',motionMode:'continuous'}});await flush();
  await h.click('setup-locations');await h.click('skip-location');await flush();
  const saved=h.requests.filter(r=>r.path==='/api/gestures/config'&&r.body).at(-1).body;assert.equal(saved.targets[0].anchor,null);assert.match(h.nodes.get('setup-status').textContent,/falta marcar/);
});
function armFrame(timestamp,{elbow=true,y=.4}={}){
  const points=Array.from({length:33},()=>({x:.5,y:.5,z:0,visibility:.95}));
  points[14]={x:.5,y:.65,z:0,visibility:elbow?.95:.1};points[16]={x:.5,y,z:0,visibility:.95};
  return {type:'result',timestamp,elapsedMs:50,poseLandmarks:[points],poseWorldLandmarks:[structuredClone(points)]};
}
function pointedTarget(type='curtain'){return{id:'appliance',name:'Aparelho',type,anchor:{x:.5,y:.1},binding:{deviceId:'appliance'}};}
test('experiment interlock prevents arming and a secondary-camera veto prevents dwell activation',async()=>{
  const h=harness({targets:[pointedTarget('switch')],settings:{tracker:'arm',selection:'point'},armSession:'session'});
  await flush();h.client.setCamera('camera');await h.click('hand-start');h.result({type:'ready'});
  h.client.setExperimentLock(true);await h.click('enable-control');
  assert.ok(!h.requests.some(r=>r.path==='/api/gestures/arm'));assert.equal(h.nodes.get('enable-control').disabled,true);
  h.client.setExperimentLock(false);h.client.setSelectionValidator(()=>false);
  for(let now=1000;now<=2500;now+=100){h.setNow(now);h.result(armFrame(now));}
  assert.equal((h.nodes.get('gesture-events')?.children||[]).length,0);h.client.stop();
});
test('saving MacBook directions never overwrites either Echo arm profile',async()=>{
  const target={...pointedTarget(),tracker:'arm',direction:{x:0,y:-1,z:0},directionProfiles:{arm_left:{direction:{x:0,y:-1,z:0},tolerance:30},arm_right:{direction:{x:1,y:0,z:0},tolerance:26}}};
  const h=harness({targets:[target],settings:{tracker:'arm',side:'left',selection:'direction'}});await flush();
  await h.client.saveSecondary('mac-device',{appliance:{direction:{x:0,y:0,z:-1},tolerance:28}});
  const saved=h.requests.filter(r=>r.path==='/api/gestures/config'&&r.body).at(-1).body;
  assert.equal(saved.secondaryCameraId,'mac-device');assert.equal(saved.targets[0].direction.y,-1);assert.equal(saved.targets[0].directionProfiles.arm_right.direction.x,1);assert.equal(saved.targets[0].directionProfiles.mac_arm_left.direction.z,-1);
});
test('new preview recognizes a projector stroke once, ignores its return, and never sends dwell OK',async()=>{
  const h=harness({targets:[pointedTarget('projector')],settings:{tracker:'arm',selection:'point'}});
  await flush();await h.click('hand-start');h.result({type:'ready'});
  for(let now=1000;now<=1600;now+=100){h.setNow(now);h.result(armFrame(now));}
  for(let now=1700;now<=2200;now+=100){h.setNow(now);h.result(armFrame(now,{y:.3}));}
  for(let now=2300;now<=4000;now+=100){h.setNow(now);h.result(armFrame(now));}
  const notes=h.nodes.get('gesture-events').children.map(e=>e.textContent);
  assert.equal(notes.length,1);assert.match(notes[0],/Cima.*prévia/);
  assert.ok(!h.requests.some(r=>r.path==='/api/gestures/execute'));h.client.stop();
});
test('preview continues wrist curtain control when the elbow disappears',async()=>{
  const h=harness({targets:[pointedTarget()],settings:{tracker:'arm',selection:'point',motionMode:'continuous'}});await flush();await h.click('hand-start');h.result({type:'ready'});
  for(let now=1000;now<=1600;now+=100){h.setNow(now);h.result(armFrame(now));}
  h.setNow(1700);h.result(armFrame(1700,{elbow:false,y:.3}));
  assert.match(h.nodes.get('hand-diagnostic').textContent,/Punho acompanhado/);
  assert.equal(h.nodes.get('selected-target').textContent,'Aparelho');
  assert.match(h.nodes.get('gesture-events').children[0].textContent,/abrir um pouco/);
  assert.ok(!h.requests.some(r=>r.path==='/api/gestures/execute'));h.client.stop();
});
test('a delayed model frame never clears the one-shot switch latch',async()=>{
  const h=harness({targets:[pointedTarget('switch')],settings:{tracker:'arm',selection:'point',motionMode:'continuous'}});await flush();await h.click('hand-start');h.result({type:'ready'});
  for(let now=1000;now<=1600;now+=100){h.setNow(now);h.result(armFrame(now));}
  assert.equal(h.nodes.get('gesture-events').children.length,1);
  h.setNow(2300);h.result(armFrame(1700));
  for(let now=2400;now<=4000;now+=100){h.setNow(now);h.result(armFrame(now));}
  assert.equal(h.nodes.get('gesture-events').children.length,1);h.client.stop();
});

 test('guided 3D calibration saves world direction vectors rather than wrist positions',async()=>{
  const targets=[{id:'cover',name:'Cortina',type:'curtain',anchor:null,direction:null,position:null,binding:{deviceId:'cover'}},{id:'lamp',name:'Luz',type:'switch',anchor:null,direction:null,position:null,binding:{deviceId:'lamp'}}];
  const h=harness({targets,settings:{tracker:'arm',selection:'point',motionMode:'continuous'}});await flush();await h.click('hand-start');h.result({type:'ready'});await h.click('learn-pointing');
  for(let now=4000;now<=5500;now+=100){h.setNow(now);h.result(armFrame(now));}
  for(let now=8500;now<=10000;now+=100){h.setNow(now);const frame=armFrame(now);frame.poseWorldLandmarks[0][16]={x:.8,y:.5,z:.3};h.result(frame);}
  await flush();
  const saved=h.requests.filter(r=>r.path==='/api/gestures/config'&&r.body).at(-1)?.body;
  assert.ok(saved);assert.equal(saved.settings.selection,'direction');assert.ok(saved.targets[1].direction.z>.3);assert.ok(saved.targets[0].direction.y<-.9);
  assert.equal(saved.targets[0].aim,undefined);assert.ok(!h.requests.some(r=>r.path==='/api/gestures/execute'));h.client.stop();
});

 test('3D target selection distinguishes depth even when wrist pixels never change',async()=>{
  const size=Math.hypot(.1,-.2,.3),direction={x:.1/size,y:-.2/size,z:.3/size};
  const targets=[{id:'front',name:'Frente',type:'switch',direction,tracker:'arm',anchor:null,binding:{deviceId:'front'}},{id:'back',name:'Fundo',type:'switch',direction:{...direction,z:-direction.z},tracker:'arm',anchor:null,binding:{deviceId:'back'}}];
  const h=harness({targets,settings:{tracker:'arm',selection:'direction'}});await flush();await h.click('hand-start');h.result({type:'ready'});
  for(let now=1000;now<=1600;now+=100){h.setNow(now);const frame=armFrame(now);frame.poseWorldLandmarks[0][14]={x:0,y:0,z:0};frame.poseWorldLandmarks[0][16]={x:.1,y:-.2,z:.3};h.result(frame);}
  assert.equal(h.nodes.get('selected-target').textContent,'Frente');assert.match(h.nodes.get('direction-values').textContent,/Z 0.80/);
  for(let now=1700;now<=3500;now+=100){h.setNow(now);const frame=armFrame(now);frame.poseWorldLandmarks[0][14]={x:0,y:0,z:0};frame.poseWorldLandmarks[0][16]={x:.1,y:-.2,z:-.3};h.result(frame);}
  assert.equal(h.nodes.get('selected-target').textContent,'Fundo');assert.match(h.nodes.get('direction-values').textContent,/Z -0.80/);h.client.stop();
});
