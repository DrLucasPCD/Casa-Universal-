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
      pinchRatio:distance(world[4],world[8])/palm,landmarks:points};
  }
  function features(result) {
    return {...observation(result),...eligible(result)};
  }
  function match(direction, targets, tolerance=18, margin=6) {
    if (!unit(direction)||!Array.isArray(targets)) return null;
    const ranked=targets.filter(t=>unit(t.direction)).map(t=>({id:t.id,angle:angle(direction,t.direction)})).sort((a,b)=>a.angle-b.angle);
    if (!ranked.length||ranked[0].angle>tolerance||(ranked[1]&&ranked[1].angle-ranked[0].angle<margin)) return null;
    return ranked[0];
  }
  function calibration(samples) {
    if (!Array.isArray(samples)||samples.length<8||samples.some(p=>!finite(p)||Math.abs(length(p)-1)>0.01)) throw new Error('Aponte por mais tempo, com a mão inteira visível.');
    const direction=normalize(samples.reduce((s,p)=>({x:s.x+p.x,y:s.y+p.y,z:s.z+p.z}),{x:0,y:0,z:0}));
    if (!direction) throw new Error('A direção não ficou estável. Tente novamente.');
    const spread=Math.max(...samples.map(p=>angle(direction,p)));
    if(spread>12)throw new Error('A direção variou muito. Segure a mão parada e tente novamente.');
    return {direction,spread};
  }
  root.CasaHandFeatures={features,match,calibration,angle};
})(globalThis);
