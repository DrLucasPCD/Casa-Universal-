import test from 'node:test';
import assert from 'node:assert/strict';
import {GestureCommands,centralURL} from '../bridge/gesture-commands.mjs';
function harness({type='switch',kind='switch',state='off',actions=['on','off'],adapter='tuya'}={}){
  const calls=[],target={id:'target',type,tracker:'arm',anchor:{x:.5,y:.5},direction:{x:0,y:1,z:0},binding:{deviceId:'device',keys:{ok:'enter',power:'power',up:'up'}}};
  const store={config:{cameraId:'camera',settings:{tracker:'arm'},targets:[target]}};let now=0,failAction=false,release=null;
  const commands=new GestureCommands({store,address:'http://192.168.68.117',now:()=>now,sleep:async()=>{},fetchImpl:async(url,options)=>{
    const body=options.body?JSON.parse(options.body):null;calls.push({url,body,origin:options.headers?.Origin});
    if(url.endsWith('/api/status'))return new Response(JSON.stringify({devices:[{id:'device',name:'Device',kind,adapter,state,available:true,actions}]}));
    if(release)await new Promise(r=>{release=r;});
    if(failAction&&body.action!=='stop')throw new Error('network');if(body.action==='on')state='on';if(body.action==='off')state='off';
    return new Response(JSON.stringify({sent:true}));
  }});
  const arm=()=>commands.arm('camera');
  const send=(extra={})=>commands.execute({sessionId:commands.session?.id,sequence:1,ageMs:40,targetId:'target',type:'activate',...extra});
  return {commands,calls,store,target,arm,send,setNow:v=>{now=v;},fail:()=>{failAction=true;}};
}
test('central address is restricted to a local ESP32 destination',()=>{
  assert.equal(centralURL('http://casa-universal.local/'),'http://casa-universal.local');
  for(const value of ['https://example.com','http://127.0.0.1','http://192.168.1.1:8878','http://user:secret@192.168.1.1','http://192.168.1.1/path'])assert.throws(()=>centralURL(value));
});
test('explicit live session and saved matching calibration are required',async()=>{
  const h=harness();await assert.rejects(h.send());assert.equal(h.calls.length,0);
  h.target.tracker='palm';assert.throws(h.arm);h.target.tracker='arm';h.arm();
  h.setNow(5001);await assert.rejects(h.send());assert.equal(h.calls.length,0);await h.commands.stop();
});
test('switch reads physical state, sends one allowed action and rejects replay',async()=>{
  const h=harness();h.arm();const result=await h.send();assert.equal(result.action,'on');assert.equal(result.confirmed,true);
  assert.equal(h.calls.filter(c=>c.url.endsWith('/api/action')).length,1);assert.equal(h.calls[1].origin,'http://192.168.68.117');
  await assert.rejects(h.send());await h.commands.stop();
});
test('unknown state, missing button and unsupported locks cannot become toggles',async()=>{
  for(const options of [{state:'unknown'},{kind:'lock',actions:['unlock']},{kind:'remote',adapter:'broadlink',actions:[]}]){
    const h=harness(options);h.arm();await assert.rejects(h.send());assert.ok(!h.calls.some(c=>c.url.endsWith('/api/action')));await h.commands.stop();
  }
});
test('curtain pulse always sends stop, including an uncertain movement send',async()=>{
  for(const fail of [false,true]){
    const h=harness({type:'curtain',kind:'cover',state:'partial',actions:['open','close','stop']});h.arm();if(fail)h.fail();
    const promise=h.send({type:'curtain-motion',direction:'open'});if(fail)await assert.rejects(promise);else await promise;
    assert.deepEqual(h.calls.filter(c=>c.url.endsWith('/api/action')).map(c=>c.body.action),['open','stop']);await h.commands.stop();
  }
});
test('old or duplicate observations, and malformed direction, cause no action',async()=>{
  for(const extra of [{ageMs:701},{ageMs:NaN},{sequence:0},{type:'curtain-motion',direction:'unlock'}]){
    const h=harness();h.arm();await assert.rejects(h.send(extra));assert.ok(!h.calls.some(c=>c.url.endsWith('/api/action')));await h.commands.stop();
  }
});
test('IR result says sent without inventing physical state; heartbeat cannot revive expiration',async()=>{
  const h=harness({type:'projector',kind:'remote',state:'unknown',actions:['enter'],adapter:'broadlink'});h.arm();
  const result=await h.send({type:'projector-key',key:'ok'});assert.equal(result.confirmed,false);assert.equal(result.state,'unknown');
  h.setNow(5001);h.commands.heartbeat(h.commands.session.id);await assert.rejects(h.send({sequence:2}));await h.commands.stop();
});

test('manual selection needs an explicitly bound target but no fabricated direction',async()=>{
  const h=harness();h.store.config.settings.selection='manual';h.target.direction=null;h.target.anchor=null;
  assert.throws(()=>h.commands.arm('camera'));
  h.commands.arm('camera','target');const result=await h.send();assert.equal(result.action,'on');
  await h.commands.stop();h.commands.arm('camera','target');h.store.config.targets.push({...h.target,id:'another'});
  await assert.rejects(h.send({targetId:'another'}));await h.commands.stop();
});
test('failed physical readback never confirms a switch merely because the send succeeded',async()=>{
  const h=harness();h.arm();h.commands.state=async()=>({id:'device',kind:'switch',adapter:'tuya',state:'off',available:true,actions:['on','off']});
  const result=await h.send();assert.equal(result.confirmed,false);assert.equal(result.state,'off');await h.commands.stop();
});

test('pointing session controls different marked devices without manual rearming',async()=>{
  const h=harness();h.store.config.settings.selection='point';h.target.direction=null;
  h.commands.arm('camera');const result=await h.send();assert.equal(result.action,'on');
  h.setNow(800);h.store.config.targets.push({...h.target,id:'second'});
  assert.equal((await h.send({targetId:'second',sequence:2})).action,'off');
  h.setNow(1600);h.store.config.targets[1].anchor=null;
  await assert.rejects(h.send({targetId:'second',sequence:3}));await h.commands.stop();
});

 test('automatic central discovery resolves mDNS once and uses the private IP for all commands',async()=>{
  let lookups=0;const calls=[];
  const commands=new GestureCommands({store:{config:{}},lookupImpl:async(host,options)=>{lookups++;assert.equal(host,'casa-universal.local');assert.equal(options.family,4);return {address:'192.168.68.115'};},fetchImpl:async(url,options)=>{calls.push({url,origin:options.headers?.Origin});return new Response(JSON.stringify({devices:[]}));}});
  assert.equal((await commands.connect('http://casa-universal.local')).address,'http://192.168.68.115');
  await commands.request('/api/status',{id:'cover'});await commands.request('/api/action',{id:'cover',action:'stop'});
  assert.equal(lookups,1);assert.ok(calls.every(c=>c.url.startsWith('http://192.168.68.115/')));assert.equal(calls.at(-1).origin,'http://192.168.68.115');
});
 test('mDNS resolving outside the private network cannot become an actuator destination',async()=>{
  const calls=[];const commands=new GestureCommands({store:{config:{}},lookupImpl:async()=>({address:'8.8.8.8'}),fetchImpl:async url=>{calls.push(url);throw new Error();}});
  await assert.rejects(commands.connect('http://casa-universal.local'));assert.ok(!calls.includes('http://8.8.8.8/api/devices'));
});

 test('connection repairs Sonoff DHCP changes by exact saved identity and preserves device secrets',async()=>{
  const calls=[],device={id:'lamp',adapter:'sonoff_lan',config:{device_id:'owner-device',ip:'192.168.1.20',port:8081}};
  const commands=new GestureCommands({store:{config:{}},fetchImpl:async(url,options)=>{
    const body=options.body?JSON.parse(options.body):null;calls.push({url,body});
    return new Response(JSON.stringify(url.endsWith('/api/devices')?{devices:[device]}:url.endsWith('/api/discover/sonoff')?{devices:[{device_id:'other-device',ip:'192.168.1.25',port:8081},{device_id:'owner-device',ip:'192.168.1.30',port:8081}]}:{}));
  }});
  await commands.connect('http://192.168.1.10');
  const saves=calls.filter(c=>c.url.endsWith('/api/configure'));
  assert.equal(saves.length,1);assert.deepEqual(saves[0].body,{id:'lamp',config:{ip:'192.168.1.30',port:8081}});
});

 test('3D pointing accepts a learned world direction without inventing an image anchor',async()=>{
  const h=harness();h.store.config.settings.selection='direction';h.target.anchor=null;
  h.arm();assert.equal((await h.send()).action,'on');await h.commands.stop();
});
