(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const defaults={tracker:'arm',selection:'point',side:'right',dwellMs:600,stability:.065,movement:.035,confidence:.4,motionMode:'stroke',projectorConfirm:'push',curtainPulseMs:1000};
  const connections=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];
  const reasons={'no-hand':'Mostre a mão em sua posição confortável.','multiple-hands':'Deixe apenas uma mão no enquadramento.','too-small':'Aproxime um pouco a mão.','incomplete-hand':'Deixe a palma e o punho dentro da imagem.','no-direction':'A direção ainda não ficou definida.','image-flow':'Punho acompanhado pelo movimento da imagem · recuperando o braço.','no-wrist':'Reencontrando seu punho. Mantenha-o dentro da imagem.','wrist-only':'Punho acompanhado. Mostre o cotovelo apenas para apontar para outro aparelho.','no-arm':'Mostre seu punho e antebraço em posição confortável.','multiple-people':'Há mais de uma pessoa no enquadramento; seleção suspensa.'};
  const presets=[['Cortina','curtain','curtain'],['Ventilador','switch','tuya_fan'],['Projetor','projector',null],['Luminária','switch','sonoff'],['Luz do quarto','switch','sonoff_tx1c']];
  const keyNames={power:'Energia',up:'Cima',down:'Baixo',left:'Esquerda',right:'Direita',ok:'OK'};
  function create({video,canvas,onObservation=()=>{}}) {
    const ctx=canvas.getContext('2d');
    let config={version:1,cameraId:null,targets:[],settings:{...defaults}},cameraId=null,engine=CasaAccessibleGestures.create({...defaults,automatic:true});
    let worker=null,generation=0,active=false,ready=false,timer=null,frameCallback=null,frameBusy=false,lastCapture=-Infinity,lastResult=-Infinity,lastHand=null,inferenceMs=null,lastReport=0;
    let marking=false,capture=null,devices=[],sessionId=null,sequence=0,commandBusy=false,selected=null,previousPoint=null,previousRay=null,stopping=false,dirtyConfig=false,setup=null,pointingReason=null,personalSetup=null,previousDirection=null;
    let selectionValidator=null,experimentLock=false;
    const say=text=>{$('hand-status').textContent=text;};
    const chosen=()=>config.targets.find(t=>t.id===$('gesture-target').value);
    const directionKey=()=>config.settings.tracker==='arm'?'arm_'+config.settings.side:config.settings.tracker;
    function rememberDirections(){const key=directionKey();for(const t of config.targets)if(t.direction&&t.tracker===config.settings.tracker){t.directionProfiles??={};t.directionProfiles[key]={direction:{...t.direction},tolerance:t.tolerance??24};}}
    function restoreDirections(){const key=directionKey();for(const t of config.targets){const profile=t.directionProfiles?.[key];t.direction=profile?{...profile.direction}:null;t.tolerance=profile?.tolerance??24;t.tracker=config.settings.tracker;}}
    const dirty=()=>{dirtyConfig=true;$('calibration-state').textContent='Alterações ainda não salvas neste Mac.';};
    async function post(path,body={}){const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await response.json();if(!response.ok){const error=new Error(result.error||'Não foi possível concluir.');error.controlActive=result.controlActive===true;throw error;}return result;}
    function mode(){ $('enable-control').textContent=config.settings.selection==='manual'?'Ativar comandos reais':'Ativar gestos da casa';$('control-mode').textContent=sessionId?'COMANDOS REAIS ATIVOS · APONTE E CONTROLE':'MODO PRÉVIA · COMANDOS REAIS DESATIVADOS';$('enable-control').disabled=!ready||experimentLock||Boolean(sessionId)||Boolean(personalSetup)||(config.settings.selection==='direction'&&!config.targets.some(t=>t.direction&&t.binding));}
    async function disable(){const had=sessionId;sessionId=null;mode();try{await post('/api/gestures/stop');$('command-status').textContent=had?'Comandos desativados. Cortina: parada solicitada, se estava em movimento.':'Prévia ativa. Nenhum comando será enviado.';}catch(error){$('command-status').textContent=error.message;}}
    function reset(){engine.reset();pointingReason=null;$('auto-target').textContent='Aponte para um aparelho';selected=null;previousPoint=null;previousRay=null;previousDirection=null;$('selected-target').textContent='Nenhum aparelho selecionado';$('dwell-progress').value=0;}
    function note(text){const row=document.createElement('li');row.textContent=text;$('gesture-events').prepend(row);while($('gesture-events').children.length>6)$('gesture-events').lastChild.remove();return row;}
    async function dispatch(intent,timestamp){
      const target=config.targets.find(t=>t.id===intent.targetId);if(!target)return;
      const label=intent.type==='activate'?'alternar energia':intent.type==='curtain-motion'?(intent.direction==='open'?'abrir um pouco e parar':'fechar um pouco e parar'):keyNames[intent.key];
      const row=note(`${target.name} · ${label}${sessionId?' · enviando…':' · prévia'}`);
      $('gesture-intention').textContent=`${sessionId?'Comando':'Prévia'}: ${target.name} → ${label}.`;
      if(!sessionId||experimentLock)return;
      if(commandBusy){row.textContent=`${target.name} · aguarde o comando anterior.`;return;}
      const current=sessionId;commandBusy=true;
      try{
        const result=await post('/api/gestures/execute',{...intent,sessionId:current,sequence:++sequence,ageMs:performance.now()-timestamp});
        row.textContent=`${target.name} · ${result.message}`;
        $('command-status').textContent=result.message+(result.confirmed?` Estado informado: ${result.state}.`:'');
        if(Number.isFinite(result.position)){$('preview-position').textContent=result.position+'%';$('preview-meter').value=result.position;}else{$('preview-position').textContent='Sem leitura atual';$('preview-meter').value=0;}
      }catch(error){row.textContent=`${target.name} · ${error.message}`;$('command-status').textContent=error.message;if(!(config.settings.selection!=='manual'&&error.controlActive)){sessionId=null;mode();post('/api/gestures/stop').catch(()=>{});reset();}}
      finally{commandBusy=false;}
    }
    function showGuide(){
      const s=config.settings;
      $('guide-curtain').textContent=s.motionMode==='continuous'?'Aponte, espere o destaque e suba/desça o punho para abrir/fechar. Este modo repete pulsos durante o deslocamento.':'Aponte e espere o nome destacar. Suba o punho para abrir um pouco; desça para fechar um pouco. Cada gesto move e para.';
      $('guide-projector').textContent=s.projectorConfirm==='push'?'Após selecionar, mova o punho na direção desejada. Para OK, avance o punho como se pressionasse um botão. Não precisa abrir os dedos. Deixe ombro, cotovelo e punho visíveis.':'Após selecionar, mova o punho na direção desejada. Mantenha parado pelo tempo de confirmação para enviar OK uma vez.';
      $('guide-return').textContent=s.motionMode==='stroke'?'Voltar à posição inicial não envia outro comando. Espere “Pronto para outro gesto”. Para trocar de aparelho, abaixe o braço por um instante.':'No modo contínuo, cada deslocamento pode enviar outro comando. Abaixe o braço para sair da cortina.';
      $('guide-switch').textContent=`Aponte e mantenha por ${String(s.dwellMs/1000).replace('.',',')} segundo(s) para alternar uma vez. Depois aponte para outro aparelho ou para fora dos locais marcados.`;
    }
    function showSettings(){const settings={...defaults,...config.settings};config.settings=settings;showGuide();for(const [id,key]of [['selection-method','selection'],['tracking-source','tracker'],['tracking-side','side'],['dwell-time','dwellMs'],['stability','stability'],['movement','movement'],['confidence','confidence'],['motion-mode','motionMode'],['projector-confirm','projectorConfirm'],['curtain-pulse','curtainPulseMs']])$(id).value=String(settings[key]);engine=CasaAccessibleGestures.create({...settings,automatic:settings.selection!=='manual'});}
    function allowedDevice(d,target){return d.adapter!=='pending'&&(target?.type==='curtain'?d.kind==='cover':target?.type==='projector'?['remote','tv'].includes(d.kind):['switch','light','remote','tv'].includes(d.kind));}
    function selectOptions(select,values,selectedValue){select.replaceChildren();for(const [value,label]of values){const option=document.createElement('option');option.value=value;option.textContent=label;select.append(option);}select.value=selectedValue||'';}
    function showBinding(){
      const target=chosen();
      selectOptions($('target-device'),[['','Selecione o aparelho'],...devices.filter(d=>allowedDevice(d,target)).map(d=>[d.id,d.name])],target?.binding?.deviceId);
      const device=devices.find(d=>d.id===target?.binding?.deviceId),channels=device?.actions.filter(a=>/^on_\d+$/.test(a)).map(a=>Number(a.slice(3)))||[];
      $('target-channel-row').hidden=!channels.length;
      selectOptions($('target-channel'),[['','Escolha o canal'],...channels.map(ch=>[String(ch),'Canal '+ch])],String(target?.binding?.channel||''));
      $('projector-bindings').replaceChildren();
      if(target&&device&&['remote','tv'].includes(device.kind))for(const key of target.type==='projector'?Object.keys(keyNames):['power']){
        const label=document.createElement('label'),select=document.createElement('select');label.textContent=keyNames[key]+' · botão aprendido';select.setAttribute('aria-label',keyNames[key]+' · botão aprendido');
        selectOptions(select,[['','Configure o botão'],...device.actions.map(a=>[a,a])],target.binding?.keys?.[key]);
        select.addEventListener('change',()=>{disable();target.binding.keys[key]=select.value;dirty();});label.append(select);$('projector-bindings').append(label);
      }
    }
    function bindDevice(target,id){const device=devices.find(d=>d.id===id);target.binding=device?{deviceId:id,channel:null,keys:{}}:null;if(device){for(const key of Object.keys(keyNames)){const action=key==='ok'?(device.actions.includes('enter')?'enter':'ok'):key;if(device.actions.includes(action))target.binding.keys[key]=action;}}}
    async function connect(){try{$('central-status').textContent='Buscando a central…';const result=await post('/api/gestures/central',{address:$('central-address').value.trim()||null});devices=result.devices;$('central-address').value=result.address;$('central-status').textContent=`Central conectada · ${devices.length} aparelhos. Escolha o aparelho de cada alvo.`;sessionId=null;mode();showBinding();}catch(error){$('central-status').textContent=error.message;}}
    function renderTargets(){const old=$('gesture-target').value;selectOptions($('gesture-target'),config.targets.map(t=>[t.id,t.name+(config.settings.selection==='point'?(t.binding&&t.anchor?' · local marcado':' · marcar local'):config.settings.selection==='manual'?(t.binding?' · pronto':' · vincular aparelho'):(t.anchor&&t.direction?' · calibrado':' · a calibrar'))]),old||config.targets[0]?.id);selectOptions($('setup-target'),config.targets.map(t=>[t.id,t.name]),$('gesture-target').value);$('manual-target-row').hidden=config.settings.selection!=='manual';updateSetupStatus();showTarget();}
    function showTarget(){const target=chosen();$('target-name').value=target?.name||'';$('target-kind').value=target?.type||'switch';$('curtain-start-row').hidden=true;$('curtain-position').hidden=config.settings.selection!=='manual'||target?.type!=='curtain';$('curtain-buttons').hidden=config.settings.selection!=='manual'||target?.type!=='curtain';
      $('target-calibration').textContent=!target?'Adicione um aparelho para calibrar.':config.settings.selection==='point'?(target.binding&&target.anchor?'Local marcado. Basta apontar; não precisa aprender uma direção.':'Vincule o aparelho e marque seu local na imagem uma vez.'):config.settings.selection==='manual'?(target.binding?'Pronto para selecionar na tela e confirmar por permanência. A direção não precisa ser calibrada.':'Vincule o aparelho real e salve. Não é preciso calibrar a direção neste modo.'):target.anchor&&target.direction?'Posição marcada e direção aprendida.':'Marque a posição e ensine sua direção confortável.';
      for(const id of ['target-name','target-kind','remove-target'])$(id).disabled=!target;
      $('learn-direction').disabled=!target||!ready||!target.anchor;$('mark-target').disabled=!target||video.readyState<2;$('setup-locations').disabled=video.readyState<2||!config.targets.some(t=>t.binding);showBinding();draw();}
    function setCamera(id){if(cameraId!==id){stop();cameraId=id;}const mismatch=cameraId&&config.cameraId&&config.cameraId!==cameraId;$('camera-calibration-note').textContent=mismatch?'Esta calibração pertence a outra câmera. Recalibre antes de continuar.':'Mantenha a Echo fixa e use a posição confortável em que calibrou os alvos.';$('use-camera').hidden=!mismatch;}
    function report(phase){const current=sessionId;const fresh=performance.now()-lastResult<600;post('/api/gestures/report',{mode:'preview',phase,sessionId,handPresent:Boolean(fresh&&lastHand?.present),targetId:fresh?selected:null,inferenceMs,detectedHands:fresh?lastHand?.detectedHands:0,reason:fresh?lastHand?.reason:null}).then(value=>{if(current&&current===sessionId&&value.commandsEnabled===false){sessionId=null;mode();reset();$('command-status').textContent=value.lastResult?.ok===false?value.lastResult.message:'A sessão de comandos terminou. Ative novamente para continuar.';}}).catch(()=>{});}
    function stop(){generation++;active=false;ready=false;clearInterval(timer);timer=null;if(frameCallback!==null)video.cancelVideoFrameCallback?.(frameCallback);frameCallback=null;worker?.terminate();worker=null;frameBusy=false;lastHand=null;lastResult=-Infinity;capture=null;setup=null;if(personalSetup)config.settings.selection=personalSetup.beforeSelection;personalSetup=null;$('cancel-pointing').hidden=true;marking=false;canvas.dataset.marking='false';$('skip-location').hidden=true;reset();draw();$('hand-start').disabled=false;$('hand-stop').disabled=true;$('learn-direction').disabled=true;$('hand-pose').textContent='Reconhecimento parado';$('hand-latency').textContent='Modelo local';$('hand-diagnostic').textContent='';showDirection(null);inferenceMs=null;say('Reconhecimento desativado.');mode();if(!stopping){stopping=true;disable().finally(()=>{stopping=false;});}report('stopped');}
    async function start(){
      if(video.readyState<2||!video.srcObject?.getVideoTracks().some(t=>t.readyState==='live')){say('Abra o vídeo da Echo antes de iniciar.');return;}
      if(config.cameraId&&config.cameraId!==cameraId){say('Recalibre para esta câmera.');return;}
      stop();const current=generation;active=true;$('hand-start').disabled=true;$('hand-stop').disabled=false;say('Carregando reconhecimento local…');report('loading');
      const model=worker=new Worker('/hand-worker.js');model.onerror=()=>{if(current===generation){stop();say('Falha no reconhecimento local.');}};
      model.onmessage=({data})=>{
        if(current!==generation||!active)return;
        if(data.type==='error'){stop();say(data.message);return;}
        if(data.type==='ready'){ready=true;say(config.settings.tracker==='arm'?'Mostre o punho e o cotovelo em posição confortável.':'Mostre a mão em posição confortável.');showTarget();mode();schedule(current);return;}
        if(data.type!=='result')return;frameBusy=false;const now=performance.now();
        if(now-data.timestamp>550){lastHand=null;previousPoint=null;previousRay=null;engine.tick(now);draw();say('Imagem atrasada. Rastreio pausado, sem comandar.');return;}
        lastResult=data.timestamp;inferenceMs=Math.round(data.elapsedMs);lastHand=CasaHandFeatures.features({...data,imageAspect:video.videoWidth/video.videoHeight},config.settings);
        if(lastHand.present){if(previousPoint&&previousPoint.tracker===lastHand.tracker){lastHand.x=.65*lastHand.x+.35*previousPoint.x;lastHand.y=.65*lastHand.y+.35*previousPoint.y;}previousPoint={x:lastHand.x,y:lastHand.y,tracker:lastHand.tracker};}else {previousPoint=null;previousRay=null;}
        if(lastHand.ray){if(previousRay)for(const end of ['origin','tip'])for(const key of ['x','y'])lastHand.ray[end][key]=.35*lastHand.ray[end][key]+.65*previousRay[end][key];previousRay={origin:{...lastHand.ray.origin},tip:{...lastHand.ray.tip}};}else previousRay=null;
        if(lastHand.direction){if(previousDirection){const v=Object.fromEntries(['x','y','z'].map(k=>[k,.45*lastHand.direction[k]+.55*previousDirection[k]])),size=Math.hypot(v.x,v.y,v.z);if(size>.01)lastHand.direction={x:v.x/size,y:v.y/size,z:v.z/size};}previousDirection={...lastHand.direction};}else previousDirection=null;
        $('hand-latency').textContent=inferenceMs+' ms · processamento local';$('hand-diagnostic').textContent=lastHand.present?(config.settings.tracker==='arm'?(lastHand.reason==='image-flow'?reasons['image-flow']:lastHand.ray?'Punho e antebraço acompanhados · sem exigir os dedos':reasons['wrist-only']):'Mão acompanhada · confirmação por tempo'):(lastHand.reason==='no-arm'&&config.settings.selection==='manual'?'Deixe o punho visível para a Echo.':reasons[lastHand.reason]||'Aguardando');onObservation({hand:lastHand,timestamp:data.timestamp,inferenceMs,settings:{...config.settings}});process(lastHand,data.timestamp,now);draw();
      };
      model.postMessage({type:'init',settings:config.settings});
      timer=setInterval(()=>{const now=performance.now();engine.tick(now);if(capture&&now-capture.started>=15000)finishCapture();if(now-lastResult>600){lastHand=null;selected=engine.report().targetId;$('selected-target').textContent=config.targets.find(t=>t.id===selected)?.name||'Aguardando mão ou punho';$('hand-diagnostic').textContent='Reencontrando o punho · comandos pausados';showDirection(null);$('dwell-progress').value=0;draw();}if(video.readyState<2||!video.srcObject?.getVideoTracks().some(t=>t.readyState==='live')){stop();return;}if(now-lastReport>=1000){lastReport=now;report(ready?'tracking':'loading');}},100);
    }
    function schedule(current){frameCallback=video.requestVideoFrameCallback(async now=>{if(current!==generation||!active||!ready)return;if(!frameBusy&&now-lastCapture>=100&&video.readyState>=2){frameBusy=true;lastCapture=now;try{const width=Math.min(1280,video.videoWidth),bitmap=await createImageBitmap(video,{resizeWidth:width,resizeHeight:Math.round(width*video.videoHeight/video.videoWidth),resizeQuality:'high'});if(current!==generation||!active){bitmap.close();return;}worker.postMessage({type:'frame',bitmap,timestamp:now},[bitmap]);}catch{frameBusy=false;stop();say('Não foi possível ler a imagem.');return;}}if(current===generation&&active)schedule(current);});}
    function finishCapture(){const job=capture;if(!job)return;capture=null;const target=config.targets.find(t=>t.id===job.id);try{const learned=CasaHandFeatures.comfortableCalibration(job.samples);if(target){target.direction=learned.direction;target.tolerance=learned.tolerance;target.tracker=config.settings.tracker;dirty();renderTargets();say(`Direção de ${target.name} aprendida. Salve a calibração.`);$('capture-progress').textContent=`Direção de ${target.name} aprendida com ${job.samples.length} amostras. Salve a calibração.`;}}catch(error){say(error.message);$('capture-progress').textContent=error.message+' Você pode usar “Escolher na tela”, sem calibrar a direção.';}}
    function process(hand,timestamp,now){
      showDirection(hand.direction);
      $('hand-pose').textContent=hand.present?(config.settings.tracker==='arm'?`Punho ${config.settings.side==='left'?'esquerdo':'direito'} visível`:'Mão confortável visível'):`Aguardando ${config.settings.tracker==='arm'?'punho '+(config.settings.side==='left'?'esquerdo':'direito'):'mão'}`;
      if(personalSetup){learnPersonal(hand,now);return;}
      if(marking||setup){say(setup?`Configuração ${setup.index+1}/${setup.ids.length}: clique na imagem onde fica ${chosen()?.name}.`:'Clique na imagem sobre o aparelho.');return;}
      if(capture){const elapsed=now-capture.started;say(!hand.present?reasons[hand.reason]:elapsed<3000?`Posicione-se para ${capture.name}. Começando em ${Math.ceil((3000-elapsed)/1000)}…`:'Mantenha sua direção confortável…');if(elapsed>=3000&&hand.present&&hand.direction)capture.samples.push(hand.direction);$('capture-progress').textContent=`Captura: ${capture.samples.length}/16 amostras · ${hand.present?'punho acompanhado':'ajuste o punho no enquadramento'}`;if(capture.samples.length>=16||elapsed>=15000)finishCapture();return;}
      const pointing=hand.present&&config.settings.selection==='point'?CasaPointingSelector.select(hand.ray,config.targets,video.videoWidth/video.videoHeight):null;
      const spatial=hand.present&&config.settings.selection==='direction'?CasaHandFeatures.selectDirection(hand.direction,config.targets.filter(t=>t.binding&&t.direction&&t.tracker===config.settings.tracker),24,'adaptive'):null;
      pointingReason=(config.settings.selection==='direction'?spatial?.reason:pointing?.reason)||null;
      hand.pointingAmbiguous=pointingReason==='ambiguous';
      hand.pointingUnavailable=config.settings.selection==='direction'?!hand.direction:config.settings.selection==='point'&&['no-ray','short-ray'].includes(pointingReason);
      let target=config.settings.selection==='manual'?chosen():config.settings.selection==='point'?pointing?.target:config.targets.find(t=>t.id===spatial?.match?.id);
      if(selectionValidator&&target&&!selectionValidator(target,timestamp)){target=null;hand.pointingUnavailable=true;}
      const intents=engine.sample(hand,target,now,{actionsEnabled:!commandBusy}),state=engine.report();selected=state.targetId;$('selected-target').textContent=config.targets.find(t=>t.id===selected)?.name||'Aponte para um aparelho';$('auto-target').textContent=config.targets.find(t=>t.id===selected)?.name||'Nenhum aparelho apontado';$('dwell-progress').value=Math.round(state.progress*100);const activeTarget=config.targets.find(t=>t.id===selected);$('curtain-buttons').hidden=activeTarget?.type!=='curtain';$('curtain-position').hidden=activeTarget?.type!=='curtain';
      const messages={idle:config.settings.selection==='manual'?'Escolha o aparelho acima e mostre o punho confortavelmente.':config.settings.selection==='direction'?(config.targets.some(t=>t.direction)?'Aponte como ensinou em 3D, com punho e cotovelo na imagem.':'Clique em Ensinar direções em 3D para associar seu gesto aos aparelhos.'):pointingReason==='short-ray'?'Deixe o antebraço visível de lado para a câmera.':'Aponte para um aparelho com local marcado.',dwelling:`Mantenha confortável e parado · ${Math.round(state.progress*100)}%`,release:config.settings.selection==='manual'?'Confirmado uma vez. Retire a mão por 1,2 s ou use Rearmar.':'Confirmado. Aponte para outro aparelho ou para fora dos locais marcados para repetir.',controlling:'Alvo confirmado. Agora mova o punho.',curtain:config.settings.motionMode==='continuous'?'Cortina selecionada: suba para abrir; desça para fechar.':'Pronto para outro gesto: suba para abrir um pouco; desça para fechar um pouco.',releasing:'Soltando a cortina. Depois aponte para outro aparelho.',switching:'Trocando para o aparelho apontado…',ambiguous:'Dois aparelhos na mesma direção. Ajuste um pouco o braço, sem acionar.',paused:hand.present?'Punho acompanhado. Mostre o antebraço para selecionar ou repetir.':'Falha breve no rastreio. Alvo mantido, comandos pausados.',projector:config.settings.projectorConfirm==='dwell'?'Mova para navegar; mantenha parado para OK.':hand.motion?.reach?'Pronto para outro gesto: mova para navegar; avance o punho para OK.':'Setas disponíveis. Para OK por avanço, deixe ombro, cotovelo e punho visíveis.',returning:'Gesto enviado. Volte à posição inicial; o retorno não aciona outro comando.',recognizing:'Reconhecendo seu movimento…',uncertain:'Movimento incerto. Reposicione o punho com calma antes de tentar.',waiting:'Aguardando o aparelho. Nenhum gesto ficará na fila.'};
      $('dwell-label').textContent=messages[state.phase];say(commandBusy?'Acompanhando o punho · aguardando a resposta do aparelho.':hand.present?messages[state.phase]:hand.reason==='no-arm'&&config.settings.selection==='manual'?'Deixe o punho visível para a Echo.':reasons[hand.reason]||'Aguardando');for(const intent of intents)dispatch(intent,timestamp);
    }
    function draw(){const width=video.videoWidth||1280,height=video.videoHeight||720;if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}ctx.clearRect(0,0,width,height);if(config.cameraId&&cameraId&&config.cameraId!==cameraId)return;
      for(const target of config.targets){if(!target.anchor)continue;const x=target.anchor.x*width,y=target.anchor.y*height;ctx.strokeStyle=target.id===selected?'#e1ffac':'#a4b9a0';ctx.fillStyle='#e1ffac';ctx.lineWidth=3;ctx.beginPath();ctx.arc(x,y,config.settings.selection==='point'?CasaPointingSelector.radius(target,config.targets,width/height)*height:target.id===selected?20:11,0,Math.PI*2);ctx.stroke();ctx.font='600 '+Math.max(16,width/65)+'px system-ui';ctx.fillText(target.name,Math.min(x+22,width-180),Math.max(24,y-15));}
      if(setup&&chosen()){
        ctx.fillStyle='rgba(12,18,10,.9)';ctx.fillRect(16,16,width-32,66);ctx.fillStyle='#f5ffe7';ctx.font='600 '+Math.max(22,width/38)+'px system-ui';ctx.fillText(`${setup.index+1}/${setup.ids.length} · Clique onde fica ${chosen().name.slice(0,40)}`,32,60);
      }
      if(personalSetup){const target=config.targets.find(t=>t.id===personalSetup.ids[personalSetup.index]);ctx.fillStyle='rgba(12,18,10,.9)';ctx.fillRect(16,16,width-32,66);ctx.fillStyle='#f5ffe7';ctx.font='600 '+Math.max(22,width/38)+'px system-ui';ctx.fillText(`Aponte do seu jeito: ${target.name}`,32,60);}
      if(!lastHand||performance.now()-lastResult>600)return;ctx.strokeStyle=lastHand.present?'#d4edab':'#ffc36d';ctx.fillStyle='#f5ffe7';ctx.lineWidth=Math.max(2,width/350);
      for(const points of lastHand.visibleHands||[]){for(const [a,b]of connections){ctx.beginPath();ctx.moveTo(points[a].x*width,points[a].y*height);ctx.lineTo(points[b].x*width,points[b].y*height);ctx.stroke();}for(const p of points){ctx.beginPath();ctx.arc(p.x*width,p.y*height,Math.max(3,width/260),0,Math.PI*2);ctx.fill();}}
      if(lastHand.ray&&config.settings.selection==='point'){
        const a=lastHand.ray.origin,b=lastHand.ray.tip,dx=(b.x-a.x)*width,dy=(b.y-a.y)*height,scale=Math.hypot(width,height)/Math.max(1,Math.hypot(dx,dy));
        ctx.strokeStyle=pointingReason==='ambiguous'?'#ffc36d':'#c4e3ff';ctx.setLineDash([10,8]);ctx.beginPath();ctx.moveTo(b.x*width,b.y*height);ctx.lineTo(b.x*width+dx*scale,b.y*height+dy*scale);ctx.stroke();ctx.setLineDash([]);
      }
      if(lastHand.arm){ctx.beginPath();ctx.moveTo(lastHand.arm[0].x*width,lastHand.arm[0].y*height);ctx.lineTo(lastHand.arm[1].x*width,lastHand.arm[1].y*height);ctx.stroke();}
      if(lastHand.present){const x=lastHand.x*width,y=lastHand.y*height;ctx.beginPath();ctx.arc(x,y,18,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.lineWidth=7;ctx.arc(x,y,25,-Math.PI/2,-Math.PI/2+Math.PI*2*engine.report().progress);ctx.stroke();}
    }
    function showDirection(direction){
      const surface=$('direction-3d'),paint=surface.getContext('2d'),origin={x:120,y:80};paint.clearRect(0,0,240,150);
      const project=p=>({x:origin.x+p.x*70-p.z*38,y:origin.y+p.y*52+p.z*28});
      for(const [name,vector,color]of [['X',{x:1,y:0,z:0},'#e9a59e'],['Y',{x:0,y:1,z:0},'#b9df8e'],['Z',{x:0,y:0,z:1},'#9fc6f2']]){
        const end=project(vector);paint.strokeStyle=color;paint.fillStyle=color;paint.lineWidth=2;paint.beginPath();paint.moveTo(origin.x,origin.y);paint.lineTo(end.x,end.y);paint.stroke();paint.font='14px system-ui';paint.fillText(name,end.x+4,end.y+4);
      }
      if(!direction){$('direction-values').textContent='X / Y / Z: leitura incerta. Mostre o punho e o cotovelo.';return;}
      const end=project(direction);paint.strokeStyle='#f5ffe7';paint.fillStyle='#f5ffe7';paint.lineWidth=5;paint.beginPath();paint.moveTo(origin.x,origin.y);paint.lineTo(end.x,end.y);paint.stroke();paint.beginPath();paint.arc(end.x,end.y,5,0,Math.PI*2);paint.fill();
      $('direction-values').textContent=`Direção estimada · X ${direction.x.toFixed(2)} · Y ${direction.y.toFixed(2)} · Z ${direction.z.toFixed(2)}`;
    }
    function beginPersonalTarget(){
      const job=personalSetup,target=config.targets.find(t=>t.id===job.ids[job.index]);
      job.started=performance.now();job.samples=[];mode();
      $('personal-status').textContent=`${job.index+1}/${job.ids.length} · Aponte do seu jeito para ${target.name}. Você tem 3 segundos para se posicionar.`;
      $('operation').textContent=`Aprendendo seu gesto: ${target.name}. Mostre punho e cotovelo.`;
    }
    function learnPersonal(hand,now){
      const job=personalSetup,target=config.targets.find(t=>t.id===job.ids[job.index]);
      const elapsed=now-job.started;
      if(elapsed<3000){say(`Aponte do seu jeito para ${target.name} · ${Math.ceil((3000-elapsed)/1000)}…`);return;}
      if(!hand.present||!hand.direction){say(`Aprendendo ${target.name}: deixe punho e cotovelo na imagem, sem precisar esticar os dedos.`);return;}
      job.samples.push({...hand.direction});if(job.samples.length>16)job.samples.shift();
      $('personal-status').textContent=`${job.index+1}/${job.ids.length} · Aprendendo ${target.name}: ${job.samples.length}/16 direções 3D. Mantenha sua posição confortável.`;
      if(job.samples.length<16)return;
      let learned;try{learned=CasaHandFeatures.comfortableCalibration(job.samples);}catch(error){say(error.message);return;}
      const overlap=Object.entries(job.learned).find(([id,p])=>CasaHandFeatures.angle(p.direction,learned.direction)<10);
      if(overlap){$('personal-status').textContent=`Essa direção ficou parecida com ${config.targets.find(t=>t.id===overlap[0]).name}. Para ${target.name}, ajuste um pouco a direção confortável do braço.`;return;}
      job.learned[target.id]=learned;job.index++;
      if(job.index<job.ids.length){beginPersonalTarget();return;}
      for(const t of config.targets)if(job.learned[t.id]){t.direction=job.learned[t.id].direction;t.tolerance=job.learned[t.id].tolerance;t.tracker=config.settings.tracker;}
      personalSetup=null;$('cancel-pointing').hidden=true;dirty();reset();
      saveLocal().then(()=>{$('personal-status').textContent='Direções 3D salvas. Aponte como ensinou; a seleção é automática nos três eixos.';say('Direções X, Y e Z aprendidas. Ative os gestos da casa.');$('operation').textContent='Direções 3D salvas.';}).catch(error=>say(error.message));
    }
    $('learn-pointing').addEventListener('click',async()=>{
      if(!ready){say('Inicie o reconhecimento antes de ensinar seu gesto.');return;}
      await disable();reset();capture=null;setup=null;marking=false;canvas.dataset.marking='false';
      const ids=config.targets.filter(t=>t.binding).map(t=>t.id);if(!ids.length){say('Vincule os aparelhos primeiro.');return;}
      const beforeSelection=config.settings.selection;config.settings.selection='direction';$('selection-method').value='direction';engine=CasaAccessibleGestures.create({...config.settings,automatic:true});
      personalSetup={ids,index:0,learned:{},beforeSelection};$('cancel-pointing').hidden=false;beginPersonalTarget();
    });
    $('cancel-pointing').addEventListener('click',()=>{if(personalSetup){config.settings.selection=personalSetup.beforeSelection;$('selection-method').value=config.settings.selection;}personalSetup=null;mode();$('cancel-pointing').hidden=true;$('personal-status').textContent='Aprendizado cancelado. A configuração anterior foi mantida.';reset();});
    function updateSetupStatus(){const bound=config.targets.filter(t=>t.binding),missing=bound.filter(t=>!t.anchor);$('setup-status').textContent=config.settings.selection==='direction'?`${bound.filter(t=>t.direction).length}/${bound.length} direções 3D aprendidas. ${bound.some(t=>!t.direction)?'Clique em Ensinar direções em 3D.':'Aponte como ensinou, com punho e cotovelo visíveis.'}`:missing.length?`Configuração única: falta marcar ${missing.map(t=>t.name).join(', ')} na imagem.`:`${bound.length} aparelhos com local marcado. Depois de ativar os gestos, basta apontar.`;}
    async function saveLocal(){if(cameraId)config.cameraId=cameraId;rememberDirections();config=await post('/api/gestures/config',config);dirtyConfig=false;mode();$('calibration-state').textContent='Locais, ajustes, perfis dos braços e vínculos salvos neste Mac.';renderTargets();}
    function advanceSetup(){
      setup.index++;
      if(setup.index>=setup.ids.length){setup=null;marking=false;canvas.dataset.marking='false';$('skip-location').hidden=true;saveLocal().then(()=>{say('Locais salvos. Ative os gestos da casa e aponte.');$('operation').textContent='Locais salvos. Aponte para o aparelho que deseja controlar.';}).catch(error=>{$('setup-status').textContent=error.message;});return;}
      $('gesture-target').value=setup.ids[setup.index];$('setup-target').value=$('gesture-target').value;showTarget();marking=true;canvas.dataset.marking='true';say(`Configuração ${setup.index+1}/${setup.ids.length}: clique na imagem onde fica ${chosen()?.name}.`);$('operation').textContent=`Marcação ${setup.index+1}/${setup.ids.length}: clique sobre ${chosen()?.name} na imagem.`;draw();
    }
    $('setup-locations').addEventListener('click',async()=>{await disable();reset();capture=null;config.settings.selection='point';$('selection-method').value='point';engine=CasaAccessibleGestures.create({...config.settings,automatic:true});setup={ids:config.targets.filter(t=>t.binding).map(t=>t.id),index:-1};if(!setup.ids.length){setup=null;return;}$('skip-location').hidden=false;dirty();advanceSetup();});
    $('skip-location').addEventListener('click',()=>{if(!setup)return;const target=chosen();if(target)target.anchor=null;dirty();advanceSetup();});
    canvas.addEventListener('pointerdown',event=>{if(!marking)return;const target=chosen();if(!target)return;const box=canvas.getBoundingClientRect(),width=video.videoWidth,height=video.videoHeight,scale=Math.min(box.width/width,box.height/height),x=(event.clientX-box.left-(box.width-width*scale)/2)/(width*scale),y=(event.clientY-box.top-(box.height-height*scale)/2)/(height*scale);if(x<0||x>1||y<0||y>1)return;target.anchor={x,y};dirty();if(setup){advanceSetup();return;}marking=false;canvas.dataset.marking='false';renderTargets();saveLocal().then(()=>say('Local salvo. Basta apontar para este aparelho.')).catch(error=>say(error.message));});
    $('hand-start').addEventListener('click',start);$('hand-stop').addEventListener('click',stop);
    $('gesture-rearm').addEventListener('click',()=>{reset();say('Pronto para selecionar novamente.');});
    $('setup-target').addEventListener('change',()=>{$('gesture-target').value=$('setup-target').value;disable();reset();capture=null;marking=false;canvas.dataset.marking='false';showTarget();});
    $('gesture-target').addEventListener('change',()=>{disable();reset();capture=null;marking=false;canvas.dataset.marking='false';showTarget();});
    $('add-target').addEventListener('click',()=>{if(config.targets.length>=12){say('Use até 12 alvos.');return;}disable();reset();const [name,type,deviceId]=presets[Number($('new-target').value)],target={id:crypto.randomUUID(),name,type,anchor:null,direction:null,position:null,tracker:config.settings.tracker,binding:null};config.targets.push(target);if(deviceId)bindDevice(target,deviceId);config.cameraId=cameraId;dirty();renderTargets();$('gesture-target').value=target.id;showTarget();});
    $('remove-target').addEventListener('click',()=>{const target=chosen();if(!target)return;disable();reset();config.targets=config.targets.filter(t=>t.id!==target.id);dirty();renderTargets();});
    $('target-name').addEventListener('change',()=>{const t=chosen();if(!t)return;t.name=$('target-name').value.trim().slice(0,60)||t.name;dirty();renderTargets();});
    $('target-kind').addEventListener('change',()=>{const t=chosen();if(!t)return;disable();reset();t.type=$('target-kind').value;t.binding=null;dirty();showTarget();});
    $('target-device').addEventListener('change',()=>{const t=chosen();if(!t)return;disable();reset();bindDevice(t,$('target-device').value);dirty();showBinding();});
    $('target-channel').addEventListener('change',()=>{const t=chosen();if(!t?.binding)return;disable();reset();t.binding.channel=Number($('target-channel').value)||null;dirty();});
    $('central-connect').addEventListener('click',connect);
    $('mark-target').addEventListener('click',()=>{disable();reset();marking=true;canvas.dataset.marking='true';say('Clique na imagem sobre o aparelho.');});
    $('learn-direction').addEventListener('click',()=>{const target=chosen();if(!ready||!target?.anchor)return;disable();reset();capture={id:target.id,name:target.name,started:performance.now(),samples:[]};say('Posicione-se confortavelmente. A captura começa em 3 segundos.');});
    $('save-calibration').addEventListener('click',async()=>{try{await disable();await saveLocal();}catch(error){$('calibration-state').textContent=error.message;}});
    $('use-camera').addEventListener('click',()=>{stop();config.cameraId=cameraId;for(const t of config.targets){t.anchor=null;t.direction=null;t.directionProfiles={};}dirty();setCamera(cameraId);renderTargets();});
    for(const [id,key]of [['selection-method','selection'],['tracking-source','tracker'],['tracking-side','side'],['dwell-time','dwellMs'],['stability','stability'],['movement','movement'],['confidence','confidence'],['motion-mode','motionMode'],['projector-confirm','projectorConfirm'],['curtain-pulse','curtainPulseMs']])$(id).addEventListener('change',()=>{const before=config.settings[key];if(['tracker','side'].includes(key))rememberDirections();config.settings[key]=['tracker','side','selection','motionMode','projectorConfirm'].includes(key)?$(id).value:Number($(id).value);stop();engine=CasaAccessibleGestures.create({...config.settings,automatic:config.settings.selection!=='manual'});if(['tracker','side'].includes(key)&&config.settings[key]!==before)restoreDirections();dirty();showGuide();renderTargets();say('Ajustes aplicados. Inicie o reconhecimento novamente.');});
    $('enable-control').addEventListener('click',async()=>{if(experimentLock){$('command-status').textContent='Ensaio de câmeras em andamento. Comandos reais pausados.';return;}if(!ready||!cameraId){$('command-status').textContent='Inicie a câmera e o reconhecimento primeiro.';return;}if(dirtyConfig){$('command-status').textContent='Salve a calibração e os vínculos antes de ativar.';return;}try{const result=await post('/api/gestures/arm',{cameraId,manualTargetId:config.settings.selection==='manual'?chosen()?.id:null});if(experimentLock){await post('/api/gestures/stop');return;}sessionId=result.sessionId;sequence=0;reset();$('gesture-events').replaceChildren();note(config.settings.selection==='manual'?'Comandos reais ativados para '+(chosen()?.name||'alvo')+'.':'Gestos da casa ativos. Aponte para trocar de aparelho automaticamente.');mode();$('command-status').textContent=config.settings.selection==='manual'?'Comandos reais ativos. Mantenha parado para confirmar.':'Gestos ativos. Aponte para o aparelho: o nome aparece e o círculo confirma.';report('tracking');}catch(error){$('command-status').textContent=error.message;}});
    for(const [id,direction]of [['curtain-open','open'],['curtain-close','close']])$(id).addEventListener('click',()=>{const target=config.settings.selection==='manual'?chosen():config.targets.find(t=>t.id===selected);if(!target||!sessionId){$('command-status').textContent='Ative os comandos reais primeiro.';return;}dispatch({type:'curtain-motion',targetId:target.id,direction},performance.now());});
    $('disable-control').addEventListener('click',()=>{reset();disable();});
    document.addEventListener('visibilitychange',()=>{if(document.hidden&&active)stop();});addEventListener('pagehide',()=>{if(active)stop();});video.addEventListener('loadeddata',showTarget);video.addEventListener('emptied',()=>{if(active)stop();});
    fetch('/api/gestures/config').then(r=>{if(!r.ok)throw new Error();return r.json();}).then(value=>{config={...value,settings:{...defaults,...value.settings}};showSettings();renderTargets();setCamera(cameraId);$('calibration-state').textContent=config.targets.length?'Calibração carregada deste Mac.':'Adicione os aparelhos da imagem.';return connect();}).catch(()=>say('Não foi possível carregar a configuração local.'));
    async function saveSecondary(cameraDeviceId,profiles){
      await disable();
      if(config.secondaryCameraId&&config.secondaryCameraId!==cameraDeviceId)for(const t of config.targets)for(const key of Object.keys(t.directionProfiles||{}))if(key.startsWith('mac_'))delete t.directionProfiles[key];
      const key='mac_'+directionKey();
      for(const t of config.targets)if(profiles[t.id]){t.directionProfiles??={};t.directionProfiles[key]=profiles[t.id];}
      config.secondaryCameraId=cameraDeviceId;dirty();await saveLocal();
    }
    showSettings();renderTargets();mode();return {stop,setCamera,stopCommands:disable,saveSecondary,getSnapshot:()=>structuredClone(config),setExperimentLock(value){experimentLock=value;if(value)disable();reset();mode();},setSelectionValidator(fn){disable();reset();selectionValidator=fn;}};
  }
  window.CasaGesturePreview={create};
})();
