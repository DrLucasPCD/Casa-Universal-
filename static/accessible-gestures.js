(function(root){
  'use strict';
  function create({dwellMs=600,stability=.065,movement=.035,automatic=false}={}) {
    let target=null,anchor=null,since=null,confirmed=false,latched=false,lastFrame=-Infinity,lastTime=-Infinity,lastAction=-Infinity,releaseAt=null,okLatched=false,missingAt=null,nextId=null,nextSince=null;
    const state={progress:0,phase:'idle',targetId:null};
    function reset(){nextId=null;nextSince=null;missingAt=null;target=null;anchor=null;since=null;confirmed=false;latched=false;releaseAt=null;okLatched=false;Object.assign(state,{progress:0,phase:'idle',targetId:null});}
    function lose(now){nextId=null;nextSince=null;if(missingAt===null)missingAt=now;if(latched){if(releaseAt===null)releaseAt=now;if(now-releaseAt>=1200){latched=false;confirmed=false;target=null;state.targetId=null;state.phase='idle';}else state.phase='release';state.progress=0;return;}if(confirmed&&now-missingAt<900){state.phase='paused';state.progress=0;return;}target=null;anchor=null;since=null;confirmed=false;state.progress=0;state.targetId=null;state.phase=latched?'release':'idle';if(releaseAt===null)releaseAt=now;if(now-releaseAt>=1200){latched=false;state.phase='idle';}}
    function tick(now){if(now-lastFrame>600){if(latched){state.phase='paused';state.progress=0;}else lose(now);}return {...state};}
    function sample(hand,selection,now){
      if(!Number.isFinite(now)||now<=lastTime)return [];lastTime=now;
      if(!hand?.present||!Number.isFinite(hand.x)||!Number.isFinite(hand.y)||hand.x<0||hand.x>1||hand.y<0||hand.y>1){lose(now);return [];}
      const gap=now-lastFrame;
      if(confirmed&&gap<900&&missingAt!==null){anchor={x:hand.x,y:hand.y};since=now;}
      missingAt=null;
      if(gap>900){if(!latched)target=null;anchor=null;since=null;confirmed=false;state.progress=0;}
      lastFrame=now;
      if(automatic&&hand.pointingAmbiguous){nextId=null;nextSince=null;releaseAt=null;state.phase='ambiguous';state.progress=0;return [];}
      if(automatic&&(confirmed||latched)&&selection&&selection.id!==target?.id){
        if(nextId!==selection.id){nextId=selection.id;nextSince=now;}
        state.phase='switching';state.targetId=selection.id;state.progress=Math.min(1,(now-nextSince)/dwellMs);
        if(now-nextSince<Math.min(300,dwellMs))return [];
        target=selection;anchor={x:hand.x,y:hand.y};since=nextSince;confirmed=false;latched=false;okLatched=false;nextId=null;nextSince=null;releaseAt=null;
      }else {nextId=null;nextSince=null;if(target)state.targetId=target.id;}
      if(automatic&&latched&&!selection){
        if(releaseAt===null)releaseAt=now;
        state.phase='release';state.progress=0;
        if(now-releaseAt>=700){target=null;anchor=null;since=null;confirmed=false;latched=false;state.targetId=null;state.phase='idle';}
        return [];
      }
      if(latched){state.phase='release';releaseAt=null;return [];}
      releaseAt=null;
      if(!confirmed){
        if(!selection){target=null;anchor=null;since=null;Object.assign(state,{phase:'idle',progress:0,targetId:null});return [];}
        if(target?.id!==selection.id){target=selection;anchor={x:hand.x,y:hand.y};since=now;state.progress=0;}
        state.targetId=target.id;state.phase='dwelling';
        if(Math.hypot(hand.x-anchor.x,hand.y-anchor.y)>stability){anchor={x:hand.x,y:hand.y};since=now;}
        state.progress=Math.min(1,(now-since)/dwellMs);
        if(state.progress<1)return [];
        confirmed=true;anchor={x:hand.x,y:hand.y};since=now;state.phase='controlling';state.progress=1;
        if(target.type==='switch'){latched=true;state.phase='release';return [{type:'activate',targetId:target.id}];}
        return [];
      }
      const dx=hand.x-anchor.x,dy=hand.y-anchor.y;
      if(target.type==='curtain'){
        state.phase='curtain';state.progress=0;
        if(Math.abs(dy)<movement||now-lastAction<900)return [];
        anchor={x:hand.x,y:hand.y};lastAction=now;
        return [{type:'curtain-motion',targetId:target.id,direction:dy<0?'open':'close'}];
      }
      if(target.type==='projector'){
        if(Math.max(Math.abs(dx),Math.abs(dy))>=movement){
          since=now;state.progress=0;okLatched=false;
          if(now-lastAction<900)return [];
          const key=Math.abs(dx)>Math.abs(dy)?(dx>0?'right':'left'):(dy>0?'down':'up');
          anchor={x:hand.x,y:hand.y};lastAction=now;return [{type:'projector-key',targetId:target.id,key}];
        }
        state.progress=okLatched?0:Math.min(1,(now-since)/dwellMs);state.phase='projector';
        if(!okLatched&&state.progress===1&&now-lastAction>=900){okLatched=true;lastAction=now;return [{type:'projector-key',targetId:target.id,key:'ok'}];}
      }
      return [];
    }
    return {sample,tick,reset,report:()=>({...state})};
  }
  root.CasaAccessibleGestures={create};
})(globalThis);
