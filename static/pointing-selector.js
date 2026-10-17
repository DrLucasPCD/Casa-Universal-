(function(root){
  'use strict';
  const point=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1;
  // A projected forearm ray selects a marked location. It does not identify
  // objects, infer room depth, or resolve objects aligned in the camera view.
  function radius(target,targets,aspect=16/9){
    let nearest=Infinity;
    for(const other of targets)if(other.id!==target.id&&point(other.anchor)&&other.binding)nearest=Math.min(nearest,Math.hypot((other.anchor.x-target.anchor.x)*aspect,other.anchor.y-target.anchor.y));
    return Math.max(Number.isFinite(target.radius)?Math.min(.18,Math.max(.025,target.radius)):.085,Math.min(.18,nearest*.45));
  }
  function select(ray,targets,aspect=16/9){
    if(!point(ray?.origin)||!point(ray?.tip)||!Number.isFinite(aspect)||aspect<=0)return {target:null,reason:'no-ray'};
    const dx=(ray.tip.x-ray.origin.x)*aspect,dy=ray.tip.y-ray.origin.y,length=Math.hypot(dx,dy);
    if(length<.025)return {target:null,reason:'short-ray'};
    const ux=dx/length,uy=dy/length,hits=[];
    for(const target of targets){
      if(!point(target.anchor)||!target.binding)continue;
      const x=(target.anchor.x-ray.origin.x)*aspect,y=target.anchor.y-ray.origin.y;
      const along=x*ux+y*uy,perpendicular=Math.abs(x*uy-y*ux),angle=Math.atan2(perpendicular,along)*180/Math.PI;
      const tolerance=radius(target,targets,aspect);
      if(along<length*.6||perpendicular>tolerance||angle>28)continue;
      hits.push({target,angle,perpendicular,along});
    }
    hits.sort((a,b)=>a.angle-b.angle);
    if(!hits.length)return {target:null,reason:'no-target'};
    if(hits[1]&&hits[1].angle-hits[0].angle<4)return {target:null,reason:'ambiguous'};
    return {...hits[0],reason:'matched'};
  }
  root.CasaPointingSelector={select,radius};
})(globalThis);
