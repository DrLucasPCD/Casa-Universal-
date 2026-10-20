(function(root){
  'use strict';
  const valid=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
  const vector=p=>valid(p)&&Number.isFinite(p.z);
  const norm=p=>Math.hypot(p.x,p.y,p.z);
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  const median=a=>a.slice().sort((a,b)=>a-b)[Math.floor(a.length/2)];
  function create({movement=.035,projectorConfirm='push'}={}){
    const threshold=Math.max(.1,Math.min(.6,movement*6));
    let home=null,point=null,last=null,history=[],prepared=[],candidate=null,returning=false,firedAt=-Infinity,neutralAt=null,lastKey=null,blocked=false,space=null,jump=null,paused=false;
    let status='ready';
    function reset(){home=point=last=candidate=neutralAt=lastKey=jump=null;history=[];prepared=[];returning=false;blocked=false;paused=false;space=null;status='ready';}
    function pause(){paused=true;history=[];candidate=null;neutralAt=null;status='uncertain';}
    function coordinates(hand){
      if(valid(hand.motion))return {...hand.motion,space:'body'};
      // Optical flow can keep a selected control usable without inventing depth.
      return {x:hand.x*4,y:hand.y*4,reach:null,space:'image'};
    }
    function prepare(hand,now){
      if(!hand?.present||!valid(hand))return;
      prepared.push({...coordinates(hand),time:now});prepared=prepared.filter(p=>now-p.time<=400).slice(-5);
    }
    function anchor(hand,now){
      const p=coordinates(hand),neutral=prepared.filter(q=>now-q.time<=400&&q.space===p.space&&distance(p,q)<.25).concat(p);
      const reaches=neutral.filter(q=>vector(q.reach));
      const origin={...p,x:median(neutral.map(q=>q.x)),y:median(neutral.map(q=>q.y)),reach:vector(p.reach)&&reaches.length?Object.fromEntries(['x','y','z'].map(k=>[k,median(reaches.map(q=>q.reach[k]))])):null};
      reset();home=point=origin;space=p.space;last=now;
    }
    function sample(hand,type,now,{actionsEnabled=true}={}){
      if(!hand?.present||!valid(hand)||!Number.isFinite(now)){reset();return null;}
      if(last!==null&&now<=last)return null;
      let p=coordinates(hand);
      if(paused){paused=false;if(!returning){anchor(hand,now);return null;}last=now;point=p;history=[];status='returning';return null;}
      if(!actionsEnabled){blocked=true;last=now;point=p;history=[];candidate=null;status='waiting';return null;}
      if(blocked){
        blocked=false;
        if(!returning){anchor(hand,now);return null;}
        // Sending a command cannot rearm its return stroke.
        last=now;point=p;history=[];status='returning';return null;
      }
      if(returning&&home&&p.space!==space){last=now;history=[];status='uncertain';return null;}
      if(returning&&now-last>450){last=now;point=p;history=[];status='uncertain';return null;}
      if(!home||p.space!==space||now-last>450||now<=last){anchor(hand,now);return null;}
      const elapsed=now-last;last=now;
      // A pose jump must not be interpreted as a swipe or a forward press.
      if(distance(p,point)>Math.max(.4,elapsed*.006)){
        if(jump&&now-jump.since<=350&&distance(p,jump.point)<.25){history=[];jump=null;}
        else {jump={point:p,since:now};history=[];candidate=null;status='uncertain';return null;}
      }else jump=null;
      history.push(p);if(history.length>3)history.shift();
      const reach=history.filter(q=>vector(q.reach));
      p={...p,x:median(history.map(q=>q.x)),y:median(history.map(q=>q.y)),reach:vector(p.reach)&&reach.length===history.length?Object.fromEntries(['x','y','z'].map(k=>[k,median(reach.map(q=>q.reach[k]))])):null};
      point=p;
      if(returning){
        status='returning';candidate=null;
        const depthReturned=lastKey!=='ok'||vector(p.reach)&&vector(home.reach)&&Math.hypot(...['x','y','z'].map(k=>p.reach[k]-home.reach[k]))<.08;
        if(distance(p,home)<threshold*.6&&depthReturned){
          if(neutralAt===null)neutralAt=now;
          if(now-firedAt>=700&&now-neutralAt>=250){returning=false;home=p;history=[];neutralAt=null;status='ready';}
        }else neutralAt=null;
        return null;
      }
      const dx=p.x-home.x,dy=p.y-home.y;
      let key=null;
      if(type==='projector'&&projectorConfirm==='push'&&vector(p.reach)&&vector(home.reach)){
        const h=home.reach,r=p.reach,n=norm(h),v={x:r.x-h.x,y:r.y-h.y,z:r.z-h.z};
        const along=n>.1?(v.x*h.x+v.y*h.y+v.z*h.z)/n:0;
        const across=Math.sqrt(Math.max(0,norm(v)**2-along**2));
        // Extension along the original arm direction, supported on consecutive
        // frames. Curled fingers are allowed; one noisy depth sample is not OK.
        if(norm(r)-n>=.035&&along>=.035&&across<=along*1.2&&Math.hypot(dx,dy)<.4)key='ok';
      }
      if(!key){
        if(type==='curtain'&&Math.abs(dy)>=threshold&&Math.abs(dy)>=Math.abs(dx)*.8)key=dy<0?'open':'close';
        if(type==='projector'&&Math.max(Math.abs(dx),Math.abs(dy))>=threshold&&Math.max(Math.abs(dx),Math.abs(dy))>=Math.min(Math.abs(dx),Math.abs(dy))*1.25)key=Math.abs(dx)>Math.abs(dy)?(dx<0?'left':'right'):(dy<0?'up':'down');
      }
      if(!key){candidate=null;status='ready';return null;}
      if(candidate?.key!==key){candidate={key,since:now,frames:1};status='recognizing';return null;}
      candidate.frames++;status='recognizing';
      if(candidate.frames<2||now-candidate.since<80||now-firedAt<900)return null;
      firedAt=now;returning=true;neutralAt=null;lastKey=key;status='returning';candidate=null;return key;
    }
    return {sample,anchor,prepare,pause,reset,report:()=>({phase:status,returning})};
  }
  root.CasaMotionGestures={create};
})(globalThis);
