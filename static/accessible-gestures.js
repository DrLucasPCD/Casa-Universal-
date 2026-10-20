(function(root){
  'use strict';
  function create({dwellMs=600,stability=.065,movement=.035,automatic=false,motionMode='stroke',projectorConfirm='push'}={}) {
    const motion=root.CasaMotionGestures.create({movement,projectorConfirm});
    let target=null,anchor=null,since=null,confirmed=false,latched=false,lastFrame=-Infinity,lastTime=-Infinity,lastAction=-Infinity,releaseAt=null,okLatched=false,missingAt=null,nextId=null,nextSince=null,awaitRaised=false;
    const state={progress:0,phase:'idle',targetId:null};
    function reset(){motion.reset();awaitRaised=false;nextId=null;nextSince=null;missingAt=null;target=null;anchor=null;since=null;confirmed=false;latched=false;releaseAt=null;okLatched=false;Object.assign(state,{progress:0,phase:'idle',targetId:null});}
    function lose(now){if(confirmed)motion.pause();else motion.reset();nextId=null;nextSince=null;if(missingAt===null)missingAt=now;if(latched){if(automatic){releaseAt=null;state.phase='paused';state.progress=0;return;}if(releaseAt===null)releaseAt=now;if(now-releaseAt>=1200){latched=false;confirmed=false;target=null;state.targetId=null;state.phase='idle';}else state.phase='release';state.progress=0;return;}if(target&&now-missingAt<(confirmed?900:450)){state.phase='paused';return;}target=null;anchor=null;since=null;confirmed=false;state.progress=0;state.targetId=null;state.phase=latched?'release':'idle';if(releaseAt===null)releaseAt=now;if(now-releaseAt>=1200){latched=false;state.phase='idle';}}
    function tick(now){if(now-lastFrame>600){if(latched){state.phase='paused';state.progress=0;}else {if(!confirmed){target=null;anchor=null;since=null;state.targetId=null;}lose(now);}}return {...state};}
    function sample(hand,selection,now,{actionsEnabled=true}={}){
      if(!Number.isFinite(now)||now<=lastTime)return [];lastTime=now;
      if(!hand?.present||!Number.isFinite(hand.x)||!Number.isFinite(hand.y)||hand.x<0||hand.x>1||hand.y<0||hand.y>1){lose(now);return [];}
      if(awaitRaised){lastFrame=now;if(hand.armLowered){state.phase='releasing';return [];}awaitRaised=false;}
      const gap=now-lastFrame;
      if(automatic&&!confirmed&&!latched&&!selection&&!hand.pointingAmbiguous){lastFrame=now;lose(now);return [];}
      if(automatic&&hand.pointingUnavailable&&!selection){
        nextId=null;nextSince=null;releaseAt=null;
        if(latched){lastFrame=now;state.phase='paused';return [];}
        if(!confirmed){lastFrame=now;lose(now);return [];}
      }
      if(!confirmed&&missingAt!==null&&target){if(now-missingAt<450&&selection?.id===target.id)since+=now-missingAt;else {target=null;anchor=null;since=null;state.progress=0;state.targetId=null;}}
      if(confirmed&&gap<900&&missingAt!==null){anchor={x:hand.x,y:hand.y};since=now;}
      missingAt=null;
      if(gap>900){if(!latched)target=null;anchor=null;since=null;confirmed=false;state.progress=0;}
      lastFrame=now;
      // Keep the cover selected while the forearm direction changes during a drag.
      // Lowering the arm deliberately releases it without choosing a menu.
      const strokeTarget=motionMode==='stroke'||target?.type==='projector'&&projectorConfirm==='push';
      const locked=automatic&&confirmed&&(target?.type==='curtain'||strokeTarget&&target?.type==='projector');
      if(locked){
        if(hand.armLowered){
          if(releaseAt===null)releaseAt=now;
          state.phase='releasing';state.progress=0;
          if(now-releaseAt>=(strokeTarget?750:350)){reset();awaitRaised=strokeTarget;return [];}
          if(!strokeTarget)return [];
        }else {
          releaseAt=null;
        }
        selection=target;
      }
      if(automatic&&hand.pointingAmbiguous&&!locked){motion.reset();nextId=null;nextSince=null;releaseAt=null;state.phase='ambiguous';state.progress=0;return [];}
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
      if(!locked)releaseAt=null;
      if(!confirmed){
        if(!selection){target=null;anchor=null;since=null;Object.assign(state,{phase:'idle',progress:0,targetId:null});return [];}
        if(target?.id!==selection.id){motion.reset();target=selection;anchor={x:hand.x,y:hand.y};since=now;state.progress=0;}
        state.targetId=target.id;state.phase='dwelling';
        if(Math.hypot(hand.x-anchor.x,hand.y-anchor.y)>stability){anchor={x:hand.x,y:hand.y};since=now;}
        motion.prepare(hand,now);
        state.progress=Math.min(1,(now-since)/dwellMs);
        if(state.progress<1||!actionsEnabled)return [];
        confirmed=true;anchor={x:hand.x,y:hand.y};motion.anchor(hand,now);since=now;state.phase='controlling';state.progress=1;
        if(target.type==='switch'){latched=true;state.phase='release';return [{type:'activate',targetId:target.id}];}
        return [];
      }
      const dx=hand.x-anchor.x,dy=hand.y-anchor.y;
      if(strokeTarget&&['curtain','projector'].includes(target.type)){
        const key=motion.sample(hand,target.type,now,{actionsEnabled});
        const phase=motion.report().phase;
        state.phase=['returning','recognizing','uncertain','waiting'].includes(phase)?phase:target.type;state.progress=0;
        if(key){lastAction=now;since=now;okLatched=false;return [target.type==='curtain'?{type:'curtain-motion',targetId:target.id,direction:key}:{type:'projector-key',targetId:target.id,key}];}
        if(target.type==='projector'&&projectorConfirm==='dwell'&&phase==='ready'){
          state.progress=okLatched?0:Math.min(1,(now-since)/dwellMs);
          if(actionsEnabled&&!okLatched&&state.progress===1&&now-lastAction>=900){okLatched=true;lastAction=now;return [{type:'projector-key',targetId:target.id,key:'ok'}];}
        }else since=now;
        return [];
      }
      if(target.type==='curtain'){
        state.phase='curtain';state.progress=0;
        if(Math.abs(dy)<movement||now-lastAction<900||!actionsEnabled)return [];
        anchor={x:hand.x,y:hand.y};lastAction=now;
        return [{type:'curtain-motion',targetId:target.id,direction:dy<0?'open':'close'}];
      }
      if(target.type==='projector'){
        if(Math.max(Math.abs(dx),Math.abs(dy))>=movement){
          since=now;state.progress=0;okLatched=false;
          if(now-lastAction<900||!actionsEnabled)return [];
          const key=Math.abs(dx)>Math.abs(dy)?(dx>0?'right':'left'):(dy>0?'down':'up');
          anchor={x:hand.x,y:hand.y};lastAction=now;return [{type:'projector-key',targetId:target.id,key}];
        }
        state.progress=okLatched?0:Math.min(1,(now-since)/dwellMs);state.phase='projector';
        if(projectorConfirm==='dwell'&&actionsEnabled&&!okLatched&&state.progress===1&&now-lastAction>=900){okLatched=true;lastAction=now;return [{type:'projector-key',targetId:target.id,key:'ok'}];}
      }
      return [];
    }
    return {sample,tick,reset,report:()=>({...state})};
  }
  root.CasaAccessibleGestures={create};
})(globalThis);
