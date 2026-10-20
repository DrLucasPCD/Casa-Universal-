(function(root) {
  'use strict';
  const finite = p => p && ['x','y','z'].every(k => Number.isFinite(p[k]));
  const subtract = (a,b) => ({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
  const length = p => Math.hypot(p.x,p.y,p.z);
  const distance = (a,b) => length(subtract(a,b));
  function normalize(p) {const size=length(p);return size>1e-7?{x:p.x/size,y:p.y/size,z:p.z/size}:null;}
  function angle(a,b) {return Math.acos(Math.max(-1,Math.min(1,a.x*b.x+a.y*b.y+a.z*b.z)))*180/Math.PI;}
  const unit = p => finite(p) && Math.abs(length(p)-1)<=0.01;
  // Detection remains visible even when a hand cannot safely select a target.
  function observation(result) {
    const hands=Array.isArray(result?.landmarks)?result.landmarks:[];
    const visibleHands=hands.filter(points=>Array.isArray(points)&&points.length===21&&points.every(finite));
    return {detectedHands:hands.length,visibleHands};
  }
  function eligible(result) {
    const hands = result?.landmarks;
    if (!Array.isArray(hands) || hands.length !== 1) return {present:false,reason:hands?.length>1?'multiple-hands':'no-hand'};
    const points = hands[0];
    if (!Array.isArray(points) || points.length!==21 || !points.every(finite) || points.some(p=>p.x<0||p.x>1||p.y<0||p.y>1)) return {present:false,reason:'incomplete-hand'};
    const palmSize = Math.hypot(points[5].x-points[17].x,points[5].y-points[17].y);
    if (palmSize<0.035) return {present:false,reason:'too-small'};
    const world=result.worldLandmarks?.[0];
    if (!Array.isArray(world)||world.length!==21||!world.every(finite)) return {present:false,reason:'no-direction'};
    const palm=distance(world[5],world[17]);
    if (palm<1e-5) return {present:false,reason:'no-direction'};
    const direction=normalize(subtract(world[8],world[5]));
    const lower=normalize(subtract(world[5],world[6])),upper=normalize(subtract(world[8],world[6]));
    if (!direction||!lower||!upper) return {present:false,reason:'no-direction'};
    const pointing=angle(lower,upper)>150 && distance(world[8],world[0])>distance(world[6],world[0])*1.08;
    return {present:true,reason:'tracked',x:points[8].x,y:points[8].y,direction,pointing,
      pinchRatio:distance(world[4],world[8])/palm,ray:{origin:{x:points[5].x,y:points[5].y},tip:{x:points[8].x,y:points[8].y}},landmarks:points};
  }
  function accessible(result,settings) {
    if(settings.tracker==='arm') {
      const poses=result.poseLandmarks||[];
      const tracked=result.trackedWrist;
      const flowing=poses.length<=1&&tracked?.source==='image-flow'&&finite(tracked)&&tracked.x>=0&&tracked.x<=1&&tracked.y>=0&&tracked.y<=1&&tracked.points>=5&&tracked.ageMs<=1800;
      if(flowing&&!poses[0]?.length)return {present:true,reason:'image-flow',tracker:'arm',ray:null,x:tracked.x,y:tracked.y,direction:null,pointing:true,pinchRatio:Infinity,visibleHands:[],detectedHands:1,arm:null};
      if(poses.length!==1)return {present:false,reason:poses.length>1?'multiple-people':'no-arm',visibleHands:[],detectedHands:0};
      const [elbow,wrist]=settings.side==='left'?[13,15]:[14,16],points=poses[0].slice(),world=result.poseWorldLandmarks?.[0];
      if(flowing)points[wrist]={...tracked,visibility:.8};
      const visible=p=>finite(p)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1&&p.visibility>=.35;
      if(!visible(points?.[wrist]))return {present:false,reason:'no-wrist',visibleHands:[],detectedHands:0};
      const ray=!flowing&&visible(points?.[elbow])?{origin:{x:points[elbow].x,y:points[elbow].y},tip:{x:points[wrist].x,y:points[wrist].y}}:null;
      const direction=!flowing&&visible(points?.[elbow])&&finite(world?.[elbow])&&finite(world?.[wrist])?normalize(subtract(world[wrist],world[elbow])):null;
      // Body-relative motion survives a change of distance and ignores torso translation.
      // World landmarks are estimates, so a missing joint never supplies a synthetic Z.
      const shoulder=settings.side==='left'?11:12,other=shoulder===11?12:11;
      const aspect=Number.isFinite(result.imageAspect)&&result.imageAspect>.1&&result.imageAspect<10?result.imageAspect:1;
      const scale=finite(points[shoulder])&&finite(points[other])?Math.hypot((points[shoulder].x-points[other].x)*aspect,points[shoulder].y-points[other].y):0;
      let motion=null;
      if(scale>.04&&points[shoulder].visibility>=.5&&points[other].visibility>=.5&&points[wrist].visibility>=.5){
        motion={x:(points[wrist].x-points[shoulder].x)*aspect/scale,y:(points[wrist].y-points[shoulder].y)/scale,reach:null};
        if(!flowing&&visible(points[elbow])&&[shoulder,elbow,wrist].every(i=>finite(world?.[i]))){
          const armLength=distance(world[shoulder],world[elbow])+distance(world[elbow],world[wrist]);
          if(armLength>=.2&&armLength<=1.3){const v=subtract(world[wrist],world[shoulder]);motion.reach={x:v.x/armLength,y:v.y/armLength,z:v.z/armLength};}
        }
      }
      return {present:true,reason:flowing?'image-flow':ray?'tracked':'wrist-only',tracker:'arm',motion,armLowered:Boolean(visible(points[elbow])&&points[wrist].y>points[elbow].y+.04),ray,x:points[wrist].x,y:points[wrist].y,direction,pointing:true,pinchRatio:Infinity,visibleHands:[],detectedHands:1,arm:visible(points?.[elbow])?[points[elbow],points[wrist]]:null};
    }
    const view=observation(result),points=view.visibleHands[0],world=result.worldLandmarks?.[0];
    if(view.detectedHands!==1)return {...view,present:false,reason:view.detectedHands>1?'multiple-hands':'no-hand'};
    const palm=[0,5,9,17];
    if(!points||!palm.every(i=>finite(world?.[i])&&points[i].x>=0&&points[i].x<=1&&points[i].y>=0&&points[i].y<=1))return {...view,present:false,reason:'incomplete-hand'};
    if(Math.hypot(points[5].x-points[17].x,points[5].y-points[17].y)<.015)return {...view,present:false,reason:'too-small'};
    const center={x:(world[5].x+world[9].x+world[17].x)/3,y:(world[5].y+world[9].y+world[17].y)/3,z:(world[5].z+world[9].z+world[17].z)/3};
    const direction=normalize(subtract(center,world[0]));
    if(!direction)return {...view,present:false,reason:'no-direction'};
    return {...view,present:true,reason:'tracked',tracker:'palm',ray:{origin:{x:points[0].x,y:points[0].y},tip:{x:points[9].x,y:points[9].y}},x:palm.reduce((v,i)=>v+points[i].x,0)/4,y:palm.reduce((v,i)=>v+points[i].y,0)/4,direction,pointing:true,pinchRatio:Infinity};
  }
  function features(result,settings={tracker:'finger'}) {
    return settings.tracker==='finger'?{...observation(result),...eligible(result),tracker:'finger'}:accessible(result,settings);
  }
  function selectDirection(direction,targets,tolerance=18,margin=6){
    if(!unit(direction)||!Array.isArray(targets))return {match:null,reason:'no-direction'};
    const ranked=targets.filter(t=>unit(t.direction)).map(t=>({id:t.id,angle:angle(direction,t.direction),tolerance:Number.isFinite(t.tolerance)?t.tolerance:tolerance})).sort((a,b)=>a.angle-b.angle);
    if(!ranked.length||ranked[0].angle>ranked[0].tolerance)return {match:null,reason:'no-target'};
    const separation=ranked[1]?angle(targets.find(t=>t.id===ranked[0].id).direction,targets.find(t=>t.id===ranked[1].id).direction):180;
    const requiredMargin=margin==='adaptive'?Math.max(1.5,Math.min(4,separation*.15)):margin;
    if(ranked[1]&&ranked[1].angle-ranked[0].angle<requiredMargin)return {match:null,reason:'ambiguous'};
    return {match:ranked[0],reason:'matched'};
  }
  function match(direction,targets,tolerance=18,margin=6){return selectDirection(direction,targets,tolerance,margin).match;}
  function calibration(samples) {
    if (!Array.isArray(samples)||samples.length<8||samples.some(p=>!finite(p)||Math.abs(length(p)-1)>0.01)) throw new Error('Aponte por mais tempo, com a mão inteira visível.');
    const direction=normalize(samples.reduce((s,p)=>({x:s.x+p.x,y:s.y+p.y,z:s.z+p.z}),{x:0,y:0,z:0}));
    if (!direction) throw new Error('A direção não ficou estável. Tente novamente.');
    const spread=Math.max(...samples.map(p=>angle(direction,p)));
    if(spread>12)throw new Error('A direção variou muito. Segure a mão parada e tente novamente.');
    return {direction,spread};
  }
  function comfortableCalibration(samples) {
    const valid=samples.filter(unit);
    if(valid.length<12)throw new Error('Ainda faltam amostras com o punho visível.');
    const medoid=valid.reduce((best,p)=>{const score=valid.map(q=>angle(p,q)).sort((a,b)=>a-b)[Math.floor(valid.length/2)];return !best||score<best.score?{p,score}:best;},null).p;
    const ranked=valid.map(p=>({p,angle:angle(p,medoid)})).sort((a,b)=>a.angle-b.angle),kept=ranked.slice(0,Math.max(10,Math.ceil(ranked.length*.8)));
    const direction=normalize(kept.reduce((sum,{p})=>({x:sum.x+p.x,y:sum.y+p.y,z:sum.z+p.z}),{x:0,y:0,z:0}));
    if(!direction)throw new Error('Tente novamente na posição confortável de uso.');
    const spread=Math.max(...kept.map(({p})=>angle(direction,p)));
    if(spread>28)throw new Error('A direção ainda variou muito. Use a seleção do aparelho na tela ou tente novamente.');
    return {direction,spread,tolerance:Math.max(24,Math.min(36,spread+8))};
  }
  root.CasaHandFeatures={features,match,selectDirection,calibration,comfortableCalibration,angle};
})(globalThis);
