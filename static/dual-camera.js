(function(root){
  'use strict';
  const $=id=>document.getElementById(id);
  const key=s=>'mac_'+(s.tracker==='arm'?'arm_'+s.side:s.tracker);
  const settingsKey=s=>s.tracker+'/'+s.side;
  function create({client}){
    const video=$('mac-video'),canvas=$('mac-overlay'),context=canvas.getContext('2d');
    let stream=null,worker=null,ready=false,busy=false,generation=0,frameId=null,lastCapture=-Infinity;
    let cameraDeviceId=null,settings=null,primary=null,secondary=null,learning=null,trial=null,timer=null,permissionTimer=null;
    const name=id=>client.getSnapshot().targets.find(t=>t.id===id)?.name||'Nenhum';
    function snapshot(){return client.getSnapshot();}
    function classify(hand,mac=false){
      const config=snapshot(),profileKey=key(config.settings);
      const targets=config.targets.filter(t=>t.binding).map(t=>mac?{...t,...t.directionProfiles?.[profileKey],direction:config.secondaryCameraId===cameraDeviceId?t.directionProfiles?.[profileKey]?.direction:null}:t);
      return root.CasaHandFeatures.selectDirection(hand?.direction,targets.filter(t=>t.direction),24,'adaptive').match?.id||null;
    }
    function calibrated(){const c=snapshot();return c.secondaryCameraId===cameraDeviceId&&c.targets.some(t=>t.binding&&t.direction&&t.directionProfiles?.[key(c.settings)]);}
    function render(now=performance.now()){
      const targets=snapshot().targets.filter(t=>t.binding&&t.direction),signature=targets.map(t=>t.id+':'+t.name).join('|');
      if($('camera-test-target').dataset.targets!==signature){const old=$('camera-test-target').value;$('camera-test-target').replaceChildren();for(const t of targets){const option=document.createElement('option');option.value=t.id;option.textContent=t.name;$('camera-test-target').append(option);}if(targets.some(t=>t.id===old))$('camera-test-target').value=old;$('camera-test-target').dataset.targets=signature;}
      const c=root.CasaCameraComparison.compare(primary,secondary,now);
      $('echo-observation').textContent=c.echo.present?'Punho visível · '+name(c.echo.targetId):'Sem leitura recente';
      $('mac-observation').textContent=c.mac.present?'Punho visível · '+name(c.mac.targetId):'Sem leitura recente';
      $('camera-consensus').textContent=c.consensus?'As duas apontam para '+name(c.consensus):c.conflict?'As câmeras discordam · seleção bloqueada no modo conjunto':!calibrated()?'Ensine as direções na câmera do MacBook.':!c.paired?'Aguardando leituras recentes das duas câmeras.':'Ainda sem um alvo em comum.';
      $('mac-calibrate').disabled=!ready||Boolean(learning)||Boolean(trial);
      $('mac-calibrate-target').disabled=!ready||!targets.length||Boolean(learning)||Boolean(trial);
      $('camera-test').disabled=!ready||!calibrated()||Boolean(learning)||Boolean(trial);
      $('require-consensus').disabled=!ready||!calibrated()||snapshot().settings.selection!=='direction'||Boolean(learning)||Boolean(trial);
      $('camera-experiment-cancel').hidden=!learning&&!trial;
      if($('require-consensus').checked&&(!calibrated()||snapshot().settings.selection!=='direction'))setConsensus(false);
      if(trial&&now>=trial.started&&now<trial.ends)trial.meter.add(primary,secondary,now);
    }
    function setConsensus(enabled){
      $('require-consensus').checked=enabled;
      client.setSelectionValidator(enabled?(target,now)=>{
        if(!calibrated()||snapshot().settings.selection!=='direction')return false;
        return root.CasaCameraComparison.compare(primary,secondary,now).consensus===target.id;
      }:null);
    }
    function stop(message='Câmera do MacBook encerrada.'){
      generation++;ready=false;busy=false;learning=null;trial=null;primary=null;secondary=null;
      if(frameId!==null)video.cancelVideoFrameCallback?.(frameId);frameId=null;
      worker?.terminate();worker=null;stream?.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;
      clearTimeout(permissionTimer);permissionTimer=null;
      clearInterval(timer);timer=null;context.clearRect(0,0,canvas.width,canvas.height);
      setConsensus(false);client.setExperimentLock(false);$('mac-start').disabled=false;$('mac-stop').disabled=true;$('mac-status').textContent=message;render();
    }
    async function start(){
      stop();const current=generation;$('mac-start').disabled=true;$('mac-stop').disabled=false;
      $('mac-status').textContent='Aguardando acesso à câmera do MacBook. Confirme “Permitir” se o navegador solicitar.';
      permissionTimer=setTimeout(()=>{if(current===generation&&!ready)stop('O navegador não concluiu a abertura da câmera. Depois de permitir o acesso, tente novamente.');},25000);
      try{
        if(!navigator.mediaDevices?.getUserMedia)throw new Error('Este navegador não disponibiliza a câmera. Abra este painel no Safari ou Chrome do Mac.');
        let deviceId=$('mac-camera').value||null;
        let acquired=await navigator.mediaDevices.getUserMedia({audio:false,video:deviceId?{deviceId:{exact:deviceId},width:{ideal:1280},height:{ideal:720}}:{facingMode:'user',width:{ideal:1280},height:{ideal:720}}});
        if(current!==generation){acquired.getTracks().forEach(t=>t.stop());return;}
        stream=acquired;video.srcObject=stream;await video.play();
        if(current!==generation)return;
        $('mac-status').textContent='Imagem do MacBook recebida. Identificando a câmera…';
        const cameras=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');
        if(current!==generation){acquired.getTracks().forEach(t=>t.stop());return;}
        const builtIn=cameras.find(d=>/FaceTime|MacBook|Built.in|integrada/i.test(d.label));
        if(!deviceId&&builtIn&&builtIn.deviceId!==stream.getVideoTracks()[0].getSettings().deviceId){
          stream.getTracks().forEach(t=>t.stop());stream=null;
          acquired=await navigator.mediaDevices.getUserMedia({audio:false,video:{deviceId:{exact:builtIn.deviceId},width:{ideal:1280},height:{ideal:720}}});
          if(current!==generation){acquired.getTracks().forEach(t=>t.stop());return;}stream=acquired;
        }
        if(current!==generation){stream?.getTracks().forEach(t=>t.stop());return;}
        cameraDeviceId=stream.getVideoTracks()[0].getSettings().deviceId;
        if(!cameraDeviceId)throw new Error('O navegador não identificou esta câmera. Selecione a câmera integrada e tente novamente.');
        $('mac-camera').replaceChildren();
        for(const camera of cameras){const option=document.createElement('option');option.value=camera.deviceId;option.textContent=camera.label||'Câmera';$('mac-camera').append(option);}
        $('mac-camera').value=cameraDeviceId;
        video.srcObject=stream;await video.play();
        if(current!==generation)return;
        settings={...snapshot().settings};
        $('mac-stop').disabled=false;$('mac-status').textContent='Carregando o rastreio local da câmera do MacBook…';
        const model=worker=new Worker('/hand-worker.js');
        model.onerror=()=>{if(current===generation)stop('Falha no rastreio da segunda câmera.');};
        model.onmessage=({data})=>{
          if(current!==generation)return;
          if(data.type==='ready'){ready=true;clearTimeout(permissionTimer);permissionTimer=null;$('mac-status').textContent='MacBook conectado · somente vídeo · processamento local';schedule(current);render();return;}
          if(data.type==='error'){stop(data.message);return;}
          if(data.type!=='result')return;busy=false;const now=performance.now();
          if(settingsKey(settings)!==settingsKey(snapshot().settings)){stop('O braço de controle mudou. Inicie a câmera do MacBook novamente.');return;}
          if(now-data.timestamp>500){secondary=null;render(now);return;}
          const hand=root.CasaHandFeatures.features({...data,imageAspect:video.videoWidth/video.videoHeight},settings);
          secondary={hand,timestamp:data.timestamp,targetId:classify(hand,true)};
          draw(hand);learn(hand,now);render(now);
        };
        model.postMessage({type:'init',settings});
        timer=setInterval(()=>{const now=performance.now();render(now);if(trial)updateTrial(now);if(learning&&now-learning.started>20000){learning=null;client.setExperimentLock(false);$('mac-learning').textContent='Faltou uma direção estável. As direções anteriores foram preservadas.';render(now);}},250);
      }catch(error){if(current!==generation)return;stop(error.name==='NotAllowedError'?'Permita o acesso à câmera do MacBook no navegador e tente novamente.':error.message||'Não foi possível abrir a câmera do MacBook.');}
    }
    function schedule(current){frameId=video.requestVideoFrameCallback(async now=>{
      if(current!==generation||!ready)return;
      if(!busy&&now-lastCapture>=125&&video.readyState>=2){busy=true;lastCapture=now;
        try{const width=Math.min(960,video.videoWidth),bitmap=await createImageBitmap(video,{resizeWidth:width,resizeHeight:Math.round(width*video.videoHeight/video.videoWidth)});
          if(current!==generation){bitmap.close();return;}worker.postMessage({type:'frame',bitmap,timestamp:now},[bitmap]);
        }catch{busy=false;stop('A imagem da câmera do MacBook foi interrompida.');return;}
      }
      if(current===generation)schedule(current);
    });}
    function draw(hand){
      canvas.width=video.videoWidth||1280;canvas.height=video.videoHeight||720;context.clearRect(0,0,canvas.width,canvas.height);
      if(!hand.present)return;context.strokeStyle='#c4e3ff';context.lineWidth=4;
      if(hand.arm){context.beginPath();context.moveTo(hand.arm[0].x*canvas.width,hand.arm[0].y*canvas.height);context.lineTo(hand.arm[1].x*canvas.width,hand.arm[1].y*canvas.height);context.stroke();}
      context.beginPath();context.arc(hand.x*canvas.width,hand.y*canvas.height,20,0,Math.PI*2);context.stroke();
    }
    function beginTarget(){learning.started=performance.now();learning.samples=[];$('mac-learning').textContent=`${learning.index+1}/${learning.targets.length} · Aponte para ${learning.targets[learning.index].name}. Posicione-se por 3 segundos e mantenha a direção confortável.`;}
    function learn(hand,now){
      if(!learning||now-learning.started<3000||!hand.present||!hand.direction)return;
      learning.samples.push({...hand.direction});if(learning.samples.length>16)learning.samples.shift();if(learning.samples.length<16)return;
      let profile;try{profile=root.CasaHandFeatures.comfortableCalibration(learning.samples);}catch{return;}
      const currentId=learning.targets[learning.index].id;
      const others=Object.values(learning.profiles);
      if(learning.single&&snapshot().secondaryCameraId===cameraDeviceId)for(const t of snapshot().targets)if(t.id!==currentId&&t.directionProfiles?.[key(settings)])others.push(t.directionProfiles[key(settings)]);
      if(others.some(p=>root.CasaHandFeatures.angle(p.direction,profile.direction)<10)){$('mac-learning').textContent='Esta direção ficou parecida com outra. Ajuste um pouco o braço para o aparelho indicado.';return;}
      learning.profiles[learning.targets[learning.index].id]={direction:profile.direction,tolerance:profile.tolerance};learning.index++;
      if(learning.index<learning.targets.length){beginTarget();return;}
      const profiles=learning.profiles;learning=null;
      client.saveSecondary(cameraDeviceId,profiles).then(()=>{$('mac-learning').textContent='Direções do MacBook salvas. O mapeamento da Echo foi preservado.';render();}).catch(error=>{$('mac-learning').textContent=error.message;}).finally(()=>client.setExperimentLock(false));
    }
    function updateTrial(now){
      if(now<trial.started){$('camera-test-status').textContent=`Aponte para ${name(trial.expected)} · medição em ${Math.ceil((trial.started-now)/1000)}…`;return;}
      $('camera-test-status').textContent=`Mantenha a direção de ${name(trial.expected)} · ${Math.max(0,Math.ceil((trial.ends-now)/1000))} s.`;
      if(now<trial.ends)return;
      const result=trial.meter.result();trial=null;client.setExperimentLock(false);
      const text=(correct,wrong)=>`${correct} correspondem ao alvo · ${wrong} outros alvos · ${result.samples-correct-wrong} sem seleção`;
      $('test-echo').textContent=text(result.echoCorrect,result.echoWrong);$('test-mac').textContent=text(result.macCorrect,result.macWrong);$('test-both').textContent=text(result.consensusCorrect,result.consensusWrong);
      $('camera-test-status').textContent=result.samples?`Alvo: ${name(result.expected)}. ${result.samples} observações no ensaio. Echo: punho em ${result.echoVisible}; MacBook: ${result.macVisible}. Discordâncias: ${result.conflicts}. Compare os acertos e as ausências; concordância pode reduzir erros e também deixar mais gestos sem seleção. O modo conjunto permanece desligado.`:'Não houve leituras recentes. Abra a Echo e inicie os dois reconhecimentos antes de repetir.';render(now);
    }
    $('mac-start').addEventListener('click',start);$('mac-stop').addEventListener('click',()=>stop());$('mac-camera').addEventListener('change',start);
    $('camera-experiment-cancel').addEventListener('click',()=>{learning=null;trial=null;client.setExperimentLock(false);$('mac-learning').textContent='Aprendizado cancelado. As direções salvas foram preservadas.';$('camera-test-status').textContent='Ensaio cancelado. Nenhum comando foi enviado.';render();});
    $('require-consensus').addEventListener('change',()=>setConsensus($('require-consensus').checked));
    async function beginLearning(single=false){await client.stopCommands();setConsensus(false);const targets=snapshot().targets.filter(t=>t.binding&&t.direction&&(!single||t.id===$('camera-test-target').value));if(!targets.length){$('mac-learning').textContent='Ensine as direções dos aparelhos na Echo primeiro.';return;}client.setExperimentLock(true);learning={targets,single,index:0,profiles:{},samples:[],started:0};beginTarget();render();}
    $('mac-calibrate').addEventListener('click',()=>beginLearning());
    $('mac-calibrate-target').addEventListener('click',()=>beginLearning(true));
    $('camera-test').addEventListener('click',async()=>{
      await client.stopCommands();setConsensus(false);const expected=$('camera-test-target').value;if(!expected)return;
      client.setExperimentLock(true);trial={expected,started:performance.now()+3000,ends:performance.now()+13000,meter:root.CasaCameraComparison.meter(expected)};render();
    });
    $('camera-test-target').addEventListener('focus',()=>{const previous=$('camera-test-target').value;$('camera-test-target').replaceChildren();for(const t of snapshot().targets.filter(t=>t.binding&&t.direction)){const option=document.createElement('option');option.value=t.id;option.textContent=t.name;$('camera-test-target').append(option);}if(previous)$('camera-test-target').value=previous;});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});root.addEventListener('pagehide',()=>stop());
    render();return {primary(value){primary={...value,targetId:classify(value.hand)};render();},stop};
  }
  root.CasaDualCamera={create};
})(globalThis);
