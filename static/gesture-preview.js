(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const connections = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];
  const reasons = {'no-hand':'Mostre uma mão inteira para a Echo.','multiple-hands':'Use apenas uma mão no enquadramento.','too-small':'Aproxime a mão da Echo.','incomplete-hand':'Mantenha a mão inteira dentro da imagem.','no-direction':'Não foi possível estimar a direção da mão.'};
  const presets = [['Cortina','curtain'],['Ventilador','switch'],['Projetor','projector'],['Luminária','switch'],['Luz do quarto','switch']];
  function create({video, canvas}) {
    const ctx = canvas.getContext('2d'), engine = CasaGestureEngine.create();
    let config = {version:1,cameraId:null,targets:[]}, cameraId=null, worker=null, generation=0, active=false, ready=false;
    let timer=null, frameCallback=null, frameBusy=false, lastCapture=-Infinity, lastResult=-Infinity, lastHand=null;
    let pinch=false, selected=null, candidate=null, candidateAt=0, latched=false, marking=false, capture=null;
    let inferenceMs=null, lastReport=0;
    const say = text => {$('hand-status').textContent=text;};
    const chosen = () => config.targets.find(t=>t.id===$('gesture-target').value);
    const dirty = () => {$('calibration-state').textContent='Alterações ainda não salvas neste Mac.';};
    async function post(path, body) {
      const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const result=await response.json();if(!response.ok)throw new Error(result.error||'Não foi possível salvar.');return result;
    }
    function log(intent) {
      const target=config.targets.find(t=>t.id===intent.targetId);
      if(!target)return;
      const text=intent.type==='activate'?'alternar energia':intent.type==='projector-key'?({up:'cima',down:'baixo',left:'esquerda',right:'direita',ok:'OK'})[intent.key]:intent.type==='curtain-position'?`abertura proposta: ${intent.position}%`:'parar cortina';
      const row=document.createElement('li');row.textContent=`${target.name} · ${text}`;
      $('gesture-events').prepend(row);while($('gesture-events').children.length>6)$('gesture-events').lastChild.remove();
      $('gesture-intention').textContent=`Prévia: ${target.name} → ${text}. Nenhum comando enviado.`;
      if(intent.type==='activate')latched=true;
      if(intent.type==='curtain-position'){$('preview-position').textContent=intent.position+'%';$('preview-meter').value=intent.position;}
    }
    const dispatch = intents => {for(const intent of intents)log(intent);};
    function disarm() {dispatch(engine.disarm(performance.now()));selected=null;candidate=null;pinch=false;$('selected-target').textContent='Nenhum aparelho selecionado';}
    function renderTargets() {
      const old=$('gesture-target').value; $('gesture-target').replaceChildren();
      for(const target of config.targets) {const option=document.createElement('option');option.value=target.id;option.textContent=target.name+(target.anchor&&target.direction?' · calibrado':' · a calibrar');$('gesture-target').append(option);}
      if(config.targets.some(t=>t.id===old))$('gesture-target').value=old;
      showTarget();
    }
    function showTarget() {
      const target=chosen();
      $('target-name').value=target?.name||'';$('target-kind').value=target?.type||'switch';
      $('curtain-start').value=target?.position===null?'':target?.position??'';
      $('curtain-start-row').hidden=target?.type!=='curtain';
      $('target-calibration').textContent=!target?'Adicione um aparelho para calibrar.':target.anchor&&target.direction?'Posição marcada e direção aprendida.':'Marque a posição na imagem e ensine a direção de apontar.';
      for(const id of ['mark-target','learn-direction','remove-target','target-name','target-kind'])$(id).disabled=!target;
      $('learn-direction').disabled=!target||!ready||!target.anchor;
      $('mark-target').disabled=!target||video.readyState<2;
      draw();
    }
    function setCamera(id) {
      if(cameraId!==id) {stop();cameraId=id;}
      const mismatch=cameraId&&config.cameraId&&config.cameraId!==cameraId;
      $('camera-calibration-note').textContent=mismatch?'Esta calibração pertence a outra câmera. Use “Recalibrar nesta câmera” antes de continuar.':'Mantenha a Echo fixa. Se mudar a câmera ou sua posição na sala, refaça a calibração.';
      $('use-camera').hidden=!mismatch;
    }
    function stop() {
      generation++;active=false;ready=false;clearInterval(timer);timer=null;
      if(frameCallback!==null)video.cancelVideoFrameCallback?.(frameCallback);frameCallback=null;
      worker?.terminate();worker=null;frameBusy=false;lastHand=null;lastResult=-Infinity;capture=null;marking=false;
      canvas.dataset.marking='false';disarm();draw();$('hand-pose').textContent='Reconhecimento parado';$('hand-latency').textContent='Modelo local';$('hand-diagnostic').textContent='';inferenceMs=null;
      $('hand-start').disabled=false;$('hand-stop').disabled=true;$('learn-direction').disabled=true;
      say('Reconhecimento desativado.');report('stopped');
    }
    function report(phase) {
      const fresh=performance.now()-lastResult<500;
      post('/api/gestures/report',{mode:'preview',phase,handPresent:Boolean(fresh&&lastHand?.present),targetId:fresh?selected:null,inferenceMs,detectedHands:fresh?lastHand?.detectedHands:0,reason:fresh?lastHand?.reason:null}).catch(()=>{});
    }
    async function start() {
      if(video.readyState<2||!video.srcObject?.getVideoTracks().some(t=>t.readyState==='live')) {say('Abra o vídeo da Echo antes de iniciar o reconhecimento.');return;}
      if(config.cameraId&&config.cameraId!==cameraId){say('Recalibre os alvos para esta câmera antes de iniciar.');return;}
      stop();const current=generation;active=true;$('hand-start').disabled=true;$('hand-stop').disabled=false;say('Carregando o modelo local de mãos…');report('loading');
      const model = worker = new Worker('/hand-worker.js');
      model.onerror=()=>{if(current===generation){stop();say('Falha ao carregar o reconhecimento local. Confira o diagnóstico do navegador.');}};
      model.onmessage=({data})=>{
        if(current!==generation||!active)return;
        if(data.type==='error'){stop();say(data.message);return;}
        if(data.type==='ready') {ready=true;say('Modelo pronto. Mostre uma mão para a Echo.');showTarget();schedule(current);return;}
        if(data.type!=='result')return;
        frameBusy=false;const now=performance.now();
        if(now-data.timestamp>450){lastHand=null;disarm();draw();$('hand-pose').textContent='Frame atrasado';say('Reconhecimento lento. Aguarde ou feche outras tarefas pesadas.');return;}
        lastResult=data.timestamp;inferenceMs=Math.round(data.elapsedMs);lastHand=CasaHandFeatures.features(data);
        $('hand-latency').textContent=inferenceMs+' ms · processamento local';
        $('hand-diagnostic').textContent=`${lastHand.detectedHands} mão(s) encontrada(s) · análise em ${Math.min(1280,video.videoWidth)} px · ${lastHand.present?'pronta para gestos':reasons[lastHand.reason]||'aguardando'}`;
        process(lastHand,data.timestamp,now);draw();
      };
      model.postMessage({type:'init'});
      timer=setInterval(()=>{
        const now=performance.now();dispatch(engine.tick(now));
        if(capture&&now-capture.started>=5500)finishCapture();
        if(now-lastResult>500){lastHand=null;if(selected)disarm();$('hand-pose').textContent=ready?'Aguardando imagem recente':'Carregando modelo';draw();}
        if(video.readyState<2||!video.srcObject?.getVideoTracks().some(t=>t.readyState==='live')){stop();return;}
        if(now-lastReport>=1000){lastReport=now;report(ready?'tracking':'loading');}
      },100);
    }
    function schedule(current) {
      frameCallback=video.requestVideoFrameCallback(async now=>{
        if(current!==generation||!active||!ready)return;
        if(!frameBusy&&now-lastCapture>=100&&video.readyState>=2){
          frameBusy=true;lastCapture=now;
          try {
            const width=Math.min(1280,video.videoWidth);
            const bitmap=await createImageBitmap(video,{resizeWidth:width,resizeHeight:Math.round(width*video.videoHeight/video.videoWidth),resizeQuality:'high'});
            if(current!==generation||!active){bitmap.close();return;}
            worker.postMessage({type:'frame',bitmap,timestamp:now},[bitmap]);
          } catch {frameBusy=false;stop();say('Não foi possível ler os frames do vídeo para reconhecer a mão.');return;}
        }
        if(current===generation&&active)schedule(current);
      });
    }
    function finishCapture() {
      const job=capture;if(!job)return;capture=null;
      const target=config.targets.find(t=>t.id===job.id);
      try {const learned=CasaHandFeatures.calibration(job.samples);if(target){target.direction=learned.direction;dirty();renderTargets();say(`Direção de ${target.name} aprendida. Salve e teste apontando e fazendo uma pinça.`);}}
      catch(error){say(error.message);}
    }
    function process(hand,timestamp,now) {
      if(!hand.present){if(selected)dispatch(engine.sample({timestamp,present:false},now));disarm();latched=false;$('hand-pose').textContent=hand.detectedHands?'Mão detectada · ajuste o enquadramento':'Sem mão detectada';if(!capture)say(reasons[hand.reason]||'Mostre uma mão para a Echo.');return;}
      pinch=hand.pinchRatio<(pinch?0.45:0.28);
      $('hand-pose').textContent=pinch?'Pinça fechada':hand.pointing?'Indicador estendido':'Mão visível';
      if(capture){
        const elapsed=now-capture.started;
        say(elapsed<3000?`Aponte para ${capture.name}. Começando em ${Math.ceil((3000-elapsed)/1000)}…`:'Segure a direção por dois segundos…');
        if(elapsed>=3000&&elapsed<5000&&hand.pointing&&!pinch)capture.samples.push(hand.direction);
        if(elapsed>=5000)finishCapture();
        return;
      }
      if(!selected&&(!hand.pointing||pinch))candidate=null;
      if(!selected&&!latched&&hand.pointing&&!pinch){
        const match=CasaHandFeatures.match(hand.direction,config.targets.filter(t=>t.anchor));
        if(!match){candidate=null;say('Direção sem alvo ou ambígua. Calibre os aparelhos e aponte novamente.');return;}
        if(candidate!==match.id){candidate=match.id;candidateAt=now;}
        if(now-candidateAt<300){say('Mantenha a direção para selecionar o aparelho…');return;}
        const target=config.targets.find(t=>t.id===match.id);
        if(target.type==='curtain'&&target.position===null){say('Informe a abertura inicial da cortina antes de testar o arraste.');return;}
        dispatch(engine.arm({id:target.id,type:target.type,...(target.type==='curtain'?{position:target.position}:{})},now));
        selected=target.id;$('selected-target').textContent=target.name;say(`Selecionado: ${target.name}. Faça uma pinça para confirmar; na cortina, segure e mova a mão.`);
      }
      if(selected)dispatch(engine.sample({timestamp,present:true,targetId:selected,x:hand.x,y:hand.y,confirm:pinch,drag:pinch},now));
    }
    function draw() {
      const width=video.videoWidth||1280,height=video.videoHeight||720;
      if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
      ctx.clearRect(0,0,width,height);
      if(config.cameraId&&cameraId&&config.cameraId!==cameraId)return;
      for(const target of config.targets){if(!target.anchor)continue;const x=target.anchor.x*width,y=target.anchor.y*height;
        ctx.strokeStyle=target.id===selected?'#e1ffac':'#a4b9a0';ctx.fillStyle=target.id===selected?'#e1ffac':'#d5ddd0';ctx.lineWidth=3;
        ctx.beginPath();ctx.arc(x,y,target.id===selected?18:11,0,Math.PI*2);ctx.stroke();
        ctx.font='600 '+Math.max(16,width/65)+'px system-ui';ctx.fillText(target.name,Math.min(x+22,width-180),Math.max(24,y-15));}
      if(!lastHand||performance.now()-lastResult>500)return;
      ctx.strokeStyle=!lastHand.present?'#ffc36d':pinch?'#f4d47e':'#d4edab';ctx.fillStyle='#f5ffe7';ctx.lineWidth=Math.max(2,width/450);
      for(const points of lastHand.visibleHands){
        for(const [a,b]of connections){ctx.beginPath();ctx.moveTo(points[a].x*width,points[a].y*height);ctx.lineTo(points[b].x*width,points[b].y*height);ctx.stroke();}
        for(const p of points){ctx.beginPath();ctx.arc(p.x*width,p.y*height,Math.max(3,width/260),0,Math.PI*2);ctx.fill();}
        ctx.beginPath();ctx.arc(points[8].x*width,points[8].y*height,lastHand.present&&pinch?20:13,0,Math.PI*2);ctx.stroke();
      }
    }
    canvas.addEventListener('pointerdown',event=>{
      if(!marking)return;const target=chosen();if(!target)return;
      const box=canvas.getBoundingClientRect(),width=video.videoWidth,height=video.videoHeight,scale=Math.min(box.width/width,box.height/height);
      const x=(event.clientX-box.left-(box.width-width*scale)/2)/(width*scale),y=(event.clientY-box.top-(box.height-height*scale)/2)/(height*scale);
      if(x<0||x>1||y<0||y>1)return;
      target.anchor={x,y};marking=false;canvas.dataset.marking='false';dirty();renderTargets();say(`Posição de ${target.name} marcada. Agora ensine a direção de apontar.`);
    });
    $('hand-start').addEventListener('click',start);$('hand-stop').addEventListener('click',()=>stop());
    $('gesture-rearm').addEventListener('click',()=>{disarm();latched=false;say('Pronto para selecionar um aparelho novamente.');});
    $('gesture-target').addEventListener('change',()=>{disarm();marking=false;capture=null;canvas.dataset.marking='false';showTarget();});
    $('add-target').addEventListener('click',()=>{if(config.targets.length>=12){say('Use até 12 alvos por câmera.');return;}const [name,type]=presets[Number($('new-target').value)];const id=crypto.randomUUID();config.targets.push({id,name,type,anchor:null,direction:null,position:null});config.cameraId=cameraId;dirty();renderTargets();$('gesture-target').value=id;showTarget();});
    $('remove-target').addEventListener('click',()=>{const target=chosen();if(!target)return;disarm();config.targets=config.targets.filter(t=>t.id!==target.id);dirty();renderTargets();});
    $('target-name').addEventListener('change',()=>{const target=chosen();if(!target)return;target.name=$('target-name').value.trim().slice(0,60)||target.name;dirty();renderTargets();});
    $('target-kind').addEventListener('change',()=>{const target=chosen();if(!target)return;disarm();target.type=$('target-kind').value;dirty();showTarget();});
    $('curtain-start').addEventListener('change',()=>{const target=chosen();if(!target)return;const value=$('curtain-start').value;target.position=value===''?null:Math.max(0,Math.min(100,Number(value)));disarm();dirty();});
    $('mark-target').addEventListener('click',()=>{marking=true;canvas.dataset.marking='true';say('Clique na imagem sobre o aparelho selecionado.');});
    $('learn-direction').addEventListener('click',()=>{const target=chosen();if(!ready||!target?.anchor)return;disarm();capture={id:target.id,name:target.name,started:performance.now(),samples:[]};say(`Aponte para ${target.name}. A captura começa em três segundos.`);});
    $('save-calibration').addEventListener('click',async()=>{try{if(cameraId)config.cameraId=cameraId;config=await post('/api/gestures/config',config);$('calibration-state').textContent='Calibração salva neste Mac.';}catch(error){$('calibration-state').textContent=error.message;}});
    $('use-camera').addEventListener('click',()=>{stop();config.cameraId=cameraId;for(const target of config.targets){target.anchor=null;target.direction=null;}dirty();setCamera(cameraId);renderTargets();});
    document.addEventListener('visibilitychange',()=>{if(document.hidden&&active)stop();});
    addEventListener('pagehide',()=>{if(active)stop();});
    video.addEventListener('loadeddata',showTarget);
    video.addEventListener('emptied',()=>{if(active)stop();});
    fetch('/api/gestures/config').then(r=>{if(!r.ok)throw new Error();return r.json();}).then(value=>{config=value;renderTargets();setCamera(cameraId);$('calibration-state').textContent=config.targets.length?'Calibração carregada deste Mac.':'Adicione os aparelhos que aparecem na imagem.';}).catch(()=>say('Não foi possível carregar a calibração local.'));
    renderTargets();
    return {stop,setCamera};
  }
  window.CasaGesturePreview={create};
})();
