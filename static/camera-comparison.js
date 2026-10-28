(function(root){
  'use strict';
  // Compare target IDs in independently calibrated camera frames. Camera-space
  // vectors must never be averaged without an extrinsic camera calibration.
  function view(observation,now){
    const fresh=Boolean(observation&&Number.isFinite(observation.timestamp)&&now-observation.timestamp>=0&&now-observation.timestamp<=500);
    return {fresh,present:Boolean(fresh&&observation.hand?.present),targetId:fresh&&observation.hand?.present?observation.targetId||null:null};
  }
  function compare(primary,secondary,now){
    const echo=view(primary,now),mac=view(secondary,now);
    const paired=echo.fresh&&mac.fresh&&Math.abs(primary.timestamp-secondary.timestamp)<=250;
    const consensus=paired&&echo.targetId&&echo.targetId===mac.targetId?echo.targetId:null;
    return {echo,mac,paired,consensus,conflict:Boolean(paired&&echo.targetId&&mac.targetId&&echo.targetId!==mac.targetId)};
  }
  function meter(expected){
    let last=null;
    const counts={samples:0,echoVisible:0,macVisible:0,echoCorrect:0,macCorrect:0,echoWrong:0,macWrong:0,consensusCorrect:0,consensusWrong:0,conflicts:0};
    function add(primary,secondary,now){
      const key=`${primary?.timestamp}/${secondary?.timestamp}`;
      if(key===last)return;last=key;
      const c=compare(primary,secondary,now);if(!c.echo.fresh&&!c.mac.fresh)return;
      counts.samples++;
      if(c.echo.present)counts.echoVisible++;if(c.mac.present)counts.macVisible++;
      for(const [name,v]of [['echo',c.echo],['mac',c.mac]])if(v.targetId)counts[name+(v.targetId===expected?'Correct':'Wrong')]++;
      if(c.consensus)counts[c.consensus===expected?'consensusCorrect':'consensusWrong']++;
      if(c.conflict)counts.conflicts++;
    }
    return {add,result:()=>({...counts,expected})};
  }
  root.CasaCameraComparison={compare,meter};
})(globalThis);
