import {mkdir, readFile, writeFile, rename, chmod} from 'node:fs/promises';
import {resolve, join} from 'node:path';
const TYPES = new Set(['switch','projector','curtain']);
const REASONS=new Set(['tracked','no-hand','multiple-hands','incomplete-hand','too-small','no-direction','no-arm','no-wrist','wrist-only','image-flow','multiple-people']);
const ID = /^[a-zA-Z0-9_-]{1,100}$/;
const coordinate = x => Number.isFinite(x) && x >= 0 && x <= 1;
const PROFILE_KEYS=new Set(['arm_right','arm_left','palm','finger']);
function unitDirection(value){
  if(!value||!['x','y','z'].every(k=>Number.isFinite(value[k]))||Math.abs(Math.hypot(value.x,value.y,value.z)-1)>.01)throw new Error('Direção de calibração inválida.');
  return {x:value.x,y:value.y,z:value.z};
}
function point(value) {
  if (!value || !coordinate(value.x) || !coordinate(value.y)) throw new Error('Posição de calibração inválida.');
  return {x:value.x,y:value.y};
}
export function accessibility(value={}) {
  const settings={tracker:'arm',selection:'point',side:'right',dwellMs:600,stability:.065,movement:.035,confidence:.4,motionMode:'stroke',projectorConfirm:'push',curtainPulseMs:1000,...value};
  if(!['stroke','continuous'].includes(settings.motionMode)||!['push','dwell'].includes(settings.projectorConfirm))throw new Error('Gestos: modo de movimento inválido.');
  if(!Number.isInteger(settings.curtainPulseMs)||settings.curtainPulseMs<350||settings.curtainPulseMs>1500)throw new Error('Gestos: use movimento da cortina de 350 a 1500 ms.');
  if(!['point','manual','direction'].includes(settings.selection)||!['arm','palm','finger'].includes(settings.tracker)||!['left','right'].includes(settings.side)||!Number.isFinite(settings.dwellMs)||settings.dwellMs<400||settings.dwellMs>6000||!Number.isFinite(settings.stability)||settings.stability<.02||settings.stability>.15||!Number.isFinite(settings.movement)||settings.movement<.03||settings.movement>.25||!Number.isFinite(settings.confidence)||settings.confidence<.3||settings.confidence>.8)throw new Error('Gestos: ajustes de reconhecimento inválidos.');
  return Object.fromEntries(['tracker','selection','side','dwellMs','stability','movement','confidence','motionMode','projectorConfirm','curtainPulseMs'].map(k=>[k,settings[k]]));
}
function binding(value) {
  if(value==null)return null;
  if(typeof value.deviceId!=='string'||!ID.test(value.deviceId)||(value.channel!=null&&(!Number.isInteger(value.channel)||value.channel<1||value.channel>16)))throw new Error('Gestos: vínculo de aparelho inválido.');
  const keys={};for(const key of ['power','up','down','left','right','ok'])if(value.keys?.[key]){if(typeof value.keys[key]!=='string'||!ID.test(value.keys[key])||['unlock','lock'].includes(value.keys[key]))throw new Error('Gestos: botão inválido.');keys[key]=value.keys[key];}
  return {deviceId:value.deviceId,channel:value.channel??null,keys};
}
export function validateCalibration(value) {
  if (!value || value.version!==1 || !Array.isArray(value.targets) || value.targets.length>12 || (value.cameraId!==null && (typeof value.cameraId!=='string'||!ID.test(value.cameraId)))) throw new Error('Calibração inválida.');
  const ids=new Set(),settings=accessibility(value.settings);
  const targets=value.targets.map(target=>{
    if (!target || typeof target.id!=='string' || !ID.test(target.id) || ids.has(target.id) || !TYPES.has(target.type) || typeof target.name!=='string' || !target.name.trim() || target.name.trim().length>60) throw new Error('Alvo de calibração inválido.');
    ids.add(target.id);if(target.tracker!=null&&!['arm','palm','finger'].includes(target.tracker))throw new Error('Gestos: fonte de calibração inválida.');
    let direction=null;
    if(target.direction!==null) {
      direction=unitDirection(target.direction);
    }
    const directionProfiles={};
    if(target.directionProfiles!=null){
      if(typeof target.directionProfiles!=='object'||Array.isArray(target.directionProfiles)||Object.keys(target.directionProfiles).some(k=>!PROFILE_KEYS.has(k)))throw new Error('Perfis de braço inválidos.');
      for(const [key,profile]of Object.entries(target.directionProfiles)){
        if(!profile||typeof profile!=='object')throw new Error('Perfil de braço inválido.');
        directionProfiles[key]={direction:unitDirection(profile.direction),tolerance:Number.isFinite(profile.tolerance)?Math.min(36,Math.max(12,profile.tolerance)):24};
      }
    }
    // Migrate the current direction before a user switches arms. Other-arm
    // profiles are retained, but never substituted for an uncalibrated arm.
    if(direction&&target.tracker===settings.tracker){const key=settings.tracker==='arm'?'arm_'+settings.side:settings.tracker;directionProfiles[key]={direction:{...direction},tolerance:Number.isFinite(target.tolerance)?Math.min(36,Math.max(12,target.tolerance)):24};}
    if(target.position!==null&&(!Number.isFinite(target.position)||target.position<0||target.position>100))throw new Error('Abertura inicial inválida.');
    return {id:target.id,name:target.name.trim(),type:target.type,anchor:target.anchor===null?null:point(target.anchor),direction,directionProfiles,position:target.position===null?null:target.position,binding:binding(target.binding),tracker:target.tracker??null,radius:Number.isFinite(target.radius)?Math.min(.16,Math.max(.025,target.radius)):.085,tolerance:Number.isFinite(target.tolerance)?Math.min(36,Math.max(12,target.tolerance)):24};
  });
  return {version:1,cameraId:value.cameraId,targets,settings};
}
export class GestureStore {
  constructor({directory=resolve('data/gestures')}={}) {
    this.directory=directory; this.config={version:1,cameraId:null,targets:[]}; this.report=null; this.writes=Promise.resolve();
  }
  async load() {
    try {this.config=validateCalibration(JSON.parse(await readFile(join(this.directory,'calibration.json'),'utf8')));} catch {}
    return structuredClone(this.config);
  }
  async save(value) {
    const config=validateCalibration(value);
    const save=async()=>{
      await mkdir(this.directory,{recursive:true,mode:0o700}); await chmod(this.directory,0o700);
      const temporary=join(this.directory,'calibration.json.tmp');
      await writeFile(temporary,JSON.stringify(config),{mode:0o600}); await chmod(temporary,0o600);
      await rename(temporary,join(this.directory,'calibration.json')); this.config=config;
      return structuredClone(config);
    };
    const writing=this.writes.then(save); this.writes=writing.catch(()=>{}); return writing;
  }
  update(value) {
    if (!value || value.mode!=='preview' || !['loading','ready','tracking','stopped','error'].includes(value.phase) || typeof value.handPresent!=='boolean') throw new Error('Estado de gestos inválido.');
    const target=this.config.targets.find(t=>t.id===value.targetId);
    const inferenceMs=Number.isFinite(value.inferenceMs)?Math.max(0,Math.min(60000,Math.round(value.inferenceMs))):null;
    this.report={mode:'preview',phase:value.phase,handPresent:value.handPresent,targetId:target?.id||null,inferenceMs,detectedHands:Number.isInteger(value.detectedHands)?Math.max(0,Math.min(2,value.detectedHands)):0,reason:REASONS.has(value.reason)?value.reason:null,receivedAt:Date.now()};
    return this.status();
  }
  status(now=Date.now()) {
    const fresh=this.report&&now-this.report.receivedAt<2000;
    return {mode:'preview',phase:fresh?this.report.phase:'stopped',handPresent:Boolean(fresh&&this.report.handPresent),
      targetId:fresh?this.report.targetId:null,inferenceMs:fresh?this.report.inferenceMs:null,
      detectedHands:fresh?this.report.detectedHands:0,reason:fresh?this.report.reason:null,
      calibratedTargets:this.config.targets.filter(t=>this.config.settings?.selection==='point'?t.anchor&&t.binding:t.direction&&t.binding).length,
      lastReportAt:this.report?new Date(this.report.receivedAt).toISOString():null,commandsEnabled:false};
  }
}
