import {mkdir, readFile, writeFile, rename, chmod} from 'node:fs/promises';
import {resolve, join} from 'node:path';
const TYPES = new Set(['switch','projector','curtain']);
const REASONS=new Set(['tracked','no-hand','multiple-hands','incomplete-hand','too-small','no-direction']);
const ID = /^[a-zA-Z0-9_-]{1,100}$/;
const coordinate = x => Number.isFinite(x) && x >= 0 && x <= 1;
function point(value) {
  if (!value || !coordinate(value.x) || !coordinate(value.y)) throw new Error('Posição de calibração inválida.');
  return {x:value.x,y:value.y};
}
export function validateCalibration(value) {
  if (!value || value.version!==1 || !Array.isArray(value.targets) || value.targets.length>12 || (value.cameraId!==null && (typeof value.cameraId!=='string'||!ID.test(value.cameraId)))) throw new Error('Calibração inválida.');
  const ids=new Set();
  const targets=value.targets.map(target=>{
    if (!target || typeof target.id!=='string' || !ID.test(target.id) || ids.has(target.id) || !TYPES.has(target.type) || typeof target.name!=='string' || !target.name.trim() || target.name.trim().length>60) throw new Error('Alvo de calibração inválido.');
    ids.add(target.id);
    let direction=null;
    if(target.direction!==null) {
      if (!target.direction || !['x','y','z'].every(k=>Number.isFinite(target.direction[k])) || Math.abs(Math.hypot(target.direction.x,target.direction.y,target.direction.z)-1)>0.01) throw new Error('Direção de calibração inválida.');
      direction={x:target.direction.x,y:target.direction.y,z:target.direction.z};
    }
    if(target.position!==null&&(!Number.isFinite(target.position)||target.position<0||target.position>100))throw new Error('Abertura inicial inválida.');
    return {id:target.id,name:target.name.trim(),type:target.type,anchor:target.anchor===null?null:point(target.anchor),direction,position:target.position===null?null:target.position};
  });
  return {version:1,cameraId:value.cameraId,targets};
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
      calibratedTargets:this.config.targets.filter(t=>t.anchor&&t.direction).length,
      lastReportAt:this.report?new Date(this.report.receivedAt).toISOString():null,commandsEnabled:false};
  }
}
