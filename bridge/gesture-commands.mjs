import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {isIP} from 'node:net';
import {lookup} from 'node:dns/promises';
const KEYS=['up','down','left','right','ok','power'];
const privateIP=host=>isIP(host)===4&&(/^(10\.|192\.168\.)/.test(host)||(/^172\.(1[6-9]|2\d|3[01])\./.test(host)));
export function centralURL(value) {
  const url=new URL(value);
  if(url.protocol!=='http:'||url.username||url.password||url.search||url.hash||url.pathname!=='/'||!['','80'].includes(url.port)||!(url.hostname==='casa-universal.local'||privateIP(url.hostname)))throw new Error('Central: use casa-universal.local ou o IP privado da central.');
  return url.origin;
}
export class GestureCommands {
  constructor({store,fetchImpl=fetch,now=()=>Date.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms)),address=null,lookupImpl=lookup}={}) {
    this.store=store;this.fetch=fetchImpl;this.lookup=lookupImpl;this.now=now;this.sleep=sleep;this.address=address;this.session=null;this.busy=false;this.lastCommandAt=-Infinity;this.lastResult=null;this.activeCover=null;this.timer=null;this.stopPending=null;
  }
  async request(path,body) {
    if(!this.address)throw new Error('Central: conecte a central antes de ativar os comandos.');
    const response=await this.fetch(this.address+path,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(8000),headers:body?{'Content-Type':'application/json',Origin:this.address}:{},...(body?{body:JSON.stringify(body)}:{})});
    const text=await response.text();if(text.length>1000000)throw new Error('Central: resposta muito grande.');
    let data;try{data=JSON.parse(text);}catch{throw new Error('Central: resposta inválida.');}
    if(!response.ok||data.error)throw new Error('Central: o aparelho não confirmou o envio. Verifique a conexão e os botões configurados.');return data;
  }
  async connect(value) {
    await this.stop();
    const candidates=[];
    if(value)candidates.push(centralURL(value));
    else {
      if(this.address)candidates.push(this.address);
      try{const saved=JSON.parse(await readFile('data/esp32/connection.json','utf8'));if(saved.ip)candidates.push(centralURL('http://'+saved.ip));}catch{}
      candidates.push('http://casa-universal.local');
    }
    for(const address of [...new Set(candidates)]) {
      this.address=address;
      try{
        // Resolve once at connection time: repeated macOS mDNS lookups can cost
        // five seconds per request, including the curtain's critical Stop.
        if(new URL(address).hostname==='casa-universal.local'){const resolved=await this.lookup('casa-universal.local',{family:4});this.address=centralURL('http://'+resolved.address);}
        const data=await this.request('/api/devices');if(!Array.isArray(data.devices))throw new Error();await this.refreshSonoffAddresses(data.devices);return {address:this.address,devices:data.devices.map(d=>this.public(d))};}catch{}
    }
    this.address=null;throw new Error('Central: sem resposta. Confira o Wi-Fi ou informe o IP atual.');
  }
  async refreshSonoffAddresses(devices) {
    const configured=devices.filter(d=>['sonoff_lan','sonoff_diy'].includes(d.adapter)&&d.config?.device_id);
    if(!configured.length)return;
    // Match the owner's saved device ID, never an IP guessed from a name.
    let discovered;try{discovered=await this.request('/api/discover/sonoff',{});}catch{return;}
    for(const d of configured){
      const matches=(discovered.devices||[]).filter(x=>x.device_id===d.config.device_id);
      if(matches.length!==1)continue;
      const found=matches[0];
      if(!privateIP(found.ip)||!Number.isInteger(found.port)||found.port<1||found.port>65535||found.ip===d.config.ip&&found.port===(d.config.port||8081))continue;
      try{await this.request('/api/configure',{id:d.id,config:{ip:found.ip,port:found.port}});d.config.ip=found.ip;d.config.port=found.port;}catch{}
    }
  }
  public(d) {return {id:d.id,name:d.name,kind:d.kind,adapter:d.adapter,actions:Array.isArray(d.actions)?d.actions:[],state:d.state||'unknown',available:d.available===true,channels:d.channels?.map(c=>({channel:c.channel,state:c.state})),position:d.telemetry?.position_percent??null};}
  status() {return {mode:this.session?'control':'preview',commandsEnabled:Boolean(this.session&&this.session.expiresAt>this.now()),address:this.address,busy:this.busy,lastResult:this.lastResult};}
  arm(cameraId,manualTargetId=null) {
    const selection=this.store.config.settings?.selection,manual=selection==='manual';
    const calibrated=t=>t.binding&&(manual?t.id===manualTargetId:selection==='point'?Boolean(t.anchor):t.direction&&t.tracker===this.store.config.settings?.tracker);
    if(!this.address||!cameraId||cameraId!==this.store.config.cameraId||!this.store.config.targets.some(calibrated))throw new Error('Gestos: salve a câmera, a calibração e o vínculo do aparelho antes de ativar.');
    this.session={id:randomUUID(),cameraId,selection,manualTargetId:manual?manualTargetId:null,expiresAt:this.now()+5000,sequence:0};
    clearInterval(this.timer);this.timer=setInterval(()=>{if(this.session&&this.session.expiresAt<=this.now())this.stop().catch(()=>{});},250);this.timer.unref?.();
    return {sessionId:this.session.id,...this.status()};
  }
  heartbeat(id) {if(this.session?.id===id&&this.session.expiresAt>this.now())this.session.expiresAt=this.now()+5000;}
  async stop() {this.session=null;clearInterval(this.timer);this.timer=null;await this.stopCover();return this.status();}
  async stopCover() {
    if(this.stopPending)return this.stopPending;
    const id=this.activeCover;if(!id)return;
    this.stopPending=(async()=>{
      // Stop is idempotent. A transient Tuya connection failure may retry Stop,
      // never Open/Close. Concurrent cancellation shares this same operation.
      for(let attempt=0;attempt<2;attempt++){
        try{const result=await this.request('/api/action',{id,action:'stop'});if(result.sent!==true)throw new Error();this.activeCover=null;return;}
        catch{if(attempt===0)await this.sleep(150);}
      }
      this.lastResult={ok:false,message:'A parada da cortina não foi confirmada. Use o controle da cortina para pará-la.'};throw new Error('Gestos: parada da cortina não confirmada.');
    })();
    try{await this.stopPending;}finally{this.stopPending=null;}
  }
  async state(id) {const data=await this.request('/api/status',{id});const device=data.devices?.find(d=>d.id===id);if(!device)throw new Error('Gestos: aparelho não encontrado na central.');return this.public(device);}
  async execute(value) {
    const session=this.session;
    if(!session||value.sessionId!==session.id||session.expiresAt<=this.now())throw new Error('Gestos: ative novamente os comandos reais.');
    if(!Number.isInteger(value.sequence)||value.sequence<=session.sequence)throw new Error('Gestos: comando repetido ou fora de ordem.');
    session.sequence=value.sequence;
    if(!Number.isFinite(value.ageMs)||value.ageMs<0||value.ageMs>700)throw new Error('Gestos: reconhecimento atrasado. Nenhum comando enviado.');
    const target=this.store.config.targets.find(t=>t.id===value.targetId);
    if(!target?.binding||(session.manualTargetId?target.id!==session.manualTargetId:session.selection==='point'?!target.anchor:!target.direction||target.tracker!==this.store.config.settings?.tracker)||this.store.config.cameraId!==session.cameraId)throw new Error('Gestos: alvo sem vínculo ou calibração salva.');
    if(this.busy||this.now()-this.lastCommandAt<700)throw new Error('Gestos: aguarde o comando anterior.');
    this.busy=true;this.lastCommandAt=this.now();
    try {
      const device=await this.state(target.binding.deviceId);
      if(this.session!==session||session.expiresAt<=this.now())throw new Error('Gestos: comando cancelado.');
      let action;
      if(value.type==='activate'&&target.type==='switch'&&['switch','light','tv','remote'].includes(device.kind)) {
        const channel=target.binding.channel;
        const state=channel?device.channels?.find(c=>c.channel===channel)?.state:device.state;
        if(['switch','light'].includes(device.kind)) {
          if(state!=='on'&&state!=='off')throw new Error('Gestos: estado desconhecido. Consulte o aparelho antes de alternar.');
          action=(state==='on'?'off':'on')+(channel?'_'+channel:'');
        }else action=target.binding.keys?.power;
      }else if(value.type==='projector-key'&&target.type==='projector'&&KEYS.includes(value.key)&&['remote','tv'].includes(device.kind))action=target.binding.keys?.[value.key];
      else if(value.type==='curtain-motion'&&target.type==='curtain'&&device.kind==='cover'&&['open','close'].includes(value.direction))action=value.direction;
      if(!action||!device.actions.includes(action)||['unlock','lock'].includes(action))throw new Error('Gestos: configure este botão ou comando na central.');
      if(target.type==='curtain'&&!device.actions.includes('stop'))throw new Error('Gestos: esta cortina precisa oferecer o comando Parar.');
      const cover=target.type==='curtain';
      if(cover)this.activeCover=device.id;
      let result;
      const pulse=Math.max(350,Math.min(1500,this.store.config.settings?.curtainPulseMs??1000));
      try {
        result=await this.request('/api/action',{id:device.id,action});
        if(result.sent!==true)throw new Error('Central: envio do comando não confirmado.');
        if(cover)await this.sleep(pulse);
      } finally {if(cover)await this.stopCover();}
      const ir=device.adapter==='broadlink';
      let observed=null;
      if(!ir&&this.session===session)try{observed=await this.state(device.id);}catch{}
      const observedState=target.binding.channel?observed?.channels?.find(c=>c.channel===target.binding.channel)?.state:observed?.state;
      const expected=/^on(?:_|$)/.test(action)?'on':/^off(?:_|$)/.test(action)?'off':null;
      this.lastResult={ok:true,targetId:target.id,action,sent:result.sent===true,confirmed:Boolean(expected&&observed?.available===true&&observedState===expected),state:observedState||'unknown',position:observed?.position??null,message:ir?'Sinal IR/RF enviado. O estado físico não é confirmado.':cover?`Movimento de ${pulse/1000} s enviado; comando Parar confirmado pela central.`:'Comando enviado à central.'};
      return this.lastResult;
    }catch(error){if(this.activeCover){this.session=null;clearInterval(this.timer);this.timer=null;}this.lastResult={ok:false,message:error.message?.startsWith('Gestos:')||error.message?.startsWith('Central:')?error.message:'Central: comunicação interrompida; confira o aparelho antes de repetir.'};throw new Error(this.lastResult.message);}
    finally {this.busy=false;}
  }
}
