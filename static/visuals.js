/* Product scenes rendered locally. Visual previews never issue device commands. */
(function () {
  'use strict';
  let serial = 0, frame = 0, lastFrame = 0;
  const scenes = new Set(), observations = new Map();
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const finite = (n, lo, hi) => typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi;
  function stateFor(device, preview = false) {
    const telemetry = device.telemetry || {}, state = device.state;
    const available = device.available === true && !['unknown','unavailable','not_configured'].includes(state);
    const running = available && (['on','playing','cool','heat','heating','cooling','fan_only'].includes(state) || ['cooling','heating','fan','drying'].includes(telemetry.activity));
    return {
      active: preview || running, preview, confirmed: available,
      position: finite(telemetry.position_percent,0,100) ? telemetry.position_percent : null,
      brightness: finite(telemetry.brightness_percent,0,100) ? telemetry.brightness_percent : 70,
      color: /^#[0-9a-fA-F]{6}$/.test(telemetry.color_hex || '') ? telemetry.color_hex : '#eddbb7',
      temperature: finite(telemetry.target_temperature,0,100) ? telemetry.target_temperature : null,
      mode: telemetry.activity === 'heating' || state === 'heat' ? 'heat' : 'cool', fan: 'auto', swing: 'stop'
    };
  }
  function definitions(id) {
    return `<defs>
      <linearGradient id="${id}-porcelain" x1="0" y1="0" x2=".1" y2="1"><stop stop-color="#fafaf6"/><stop offset=".17" stop-color="#e7e8e4"/><stop offset=".64" stop-color="#c6c8c5"/><stop offset="1" stop-color="#8b908f"/></linearGradient>
      <linearGradient id="${id}-top" x2=".8" y2="1"><stop stop-color="#fffefa"/><stop offset=".65" stop-color="#eeefeb"/><stop offset="1" stop-color="#c4c8c5"/></linearGradient>
      <linearGradient id="${id}-side" x2="1" y2=".2"><stop stop-color="#858b88"/><stop offset=".35" stop-color="#d2d6d1"/><stop offset=".7" stop-color="#edf0e9"/><stop offset="1" stop-color="#9fa6a0"/></linearGradient>
      <linearGradient id="${id}-metal" x1="0" y1="0" x2="1" y2=".15"><stop stop-color="#4a5151"/><stop offset=".2" stop-color="#9da5a2"/><stop offset=".42" stop-color="#ebede7"/><stop offset=".58" stop-color="#727b78"/><stop offset=".84" stop-color="#adb5b0"/><stop offset="1" stop-color="#4a5450"/></linearGradient>
      <linearGradient id="${id}-black" x2=".65" y2="1"><stop stop-color="#454c4f"/><stop offset=".28" stop-color="#242a2d"/><stop offset=".8" stop-color="#101517"/><stop offset="1" stop-color="#070b0c"/></linearGradient>
      <linearGradient id="${id}-glass" x2=".7" y2="1"><stop stop-color="#5a6869" stop-opacity=".48"/><stop offset=".42" stop-color="#050a0b" stop-opacity=".1"/><stop offset="1" stop-color="#000" stop-opacity=".45"/></linearGradient>
      <linearGradient id="${id}-sky" x2="0" y2="1"><stop stop-color="#7b9eaa"/><stop offset=".48" stop-color="#c6cac1"/><stop offset="1" stop-color="#465b59"/></linearGradient>
      <radialGradient id="${id}-shade"><stop stop-color="#000" stop-opacity=".65"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
      <radialGradient id="${id}-lens"><stop stop-color="#728d93"/><stop offset=".23" stop-color="#163841"/><stop offset=".53" stop-color="#193037"/><stop offset=".8" stop-color="#050a0d"/><stop offset="1" stop-color="#3d4b50"/></radialGradient>
      <linearGradient id="${id}-cloth"><stop stop-color="#7e857e"/><stop offset=".2" stop-color="#e3e2d6"/><stop offset=".44" stop-color="#8e968e"/><stop offset=".63" stop-color="#edede2"/><stop offset=".83" stop-color="#9ea69b"/><stop offset="1" stop-color="#d5d9cd"/></linearGradient>
      <pattern id="${id}-folds" width="21" height="180" patternUnits="userSpaceOnUse"><rect width="21" height="180" fill="url(#${id}-cloth)"/><path d="M2 0Q8 86 2 180" stroke="#ffffff" opacity=".12" fill="none"/></pattern>
      <filter id="${id}-glow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="6"/></filter>
    </defs>`;
  }
  function model(type, d, id, s) {
    const floor = '<ellipse cx="190" cy="211" rx="142" ry="15" fill="url(#'+id+'-shade)"/>';
    const plastic = 'url(#'+id+'-porcelain)', top = 'url(#'+id+'-top)', metal = 'url(#'+id+'-metal)', dark = 'url(#'+id+'-black)';
    if (type === 'climate') return `<g class="product-body ac-body">
      <path d="M88 55Q87 48 95 46L282 58Q291 59 292 66L292 121Q291 126 286 126L94 112Q88 111 88 104Z" fill="${plastic}" stroke="#a7aca8" stroke-width=".6"/>
      <path d="M95 46L107 36L300 49Q305 50 305 56L292 66L282 58Z" fill="${top}"/>
      <path d="M292 65L305 56V114Q306 121 292 126Z" fill="url(#${id}-side)" stroke="#d8ddd5" stroke-width=".4"/>
      <path d="M98 47L280 60Q287 61 288 68L288 105L95 91V53" fill="none" stroke="#fff" opacity=".36" stroke-width=".7"/>
      <path d="M91 98L287 112V123L94 110Z" fill="#151a1b"/>
      <g class="ac-vanes">${Array.from({length:26},(_,i)=>`<path d="M${96+i*7.1} ${101+i*.5}l1 9" stroke="#717c78" stroke-width="1.1"/>`).join('')}</g>
      <path class="ac-flap" d="M92 106L288 120L287 127L94 113Z" fill="${top}" stroke="#aaa" stroke-width=".5"/>
      <path d="M292 70L298 66V112L295 115" stroke="#79817c" fill="none" stroke-width="1.1"/>
      <path d="M143 43l12 1M161 44l5 .5" stroke="#a4aaa4" stroke-width=".8"/>
      <text class="ac-mini-temperature" x="261" y="84" transform="rotate(4 261 84)" text-anchor="middle" fill="#a8c4bc" font-size="7" font-family="system-ui">${s.temperature ?? ''}</text>
      <circle class="product-indicator" cx="277" cy="87" r="1.3" fill="#bdd6c3"/>
    </g>`;
    if (type === 'tv' || type === 'media_player') return floor+`<g class="product-body television">
      <path d="M155 163l-34 41h11l42-40M224 163l38 41h-11l-44-40" fill="url(#${id}-metal)"/>
      <path d="M57 26L321 38L321 178L57 166Z" fill="#090d0f" stroke="#646f6e" stroke-width="1.4"/>
      <path d="M321 38l7-5v139l-7 6z" fill="#444c4e"/>
      <clipPath id="${id}-tvclip"><path d="M61 30L317 42V173L61 162Z"/></clipPath>
      <g clip-path="url(#${id}-tvclip)" class="tv-picture"><rect x="58" y="29" width="269" height="150" fill="url(#${id}-sky)"/>
      <g class="tv-landscape"><path d="M51 117l54-34 22 19 26-10 37 26 34-43 26 38 27-14 50 27v70H51Z" fill="#3b626c"/>
      <path d="M51 143l56-33 54 13 26-10 62 38 31-19 47 27v30H51Z" fill="#264d4e"/>
      <path d="M51 153q72-19 132 8t143-8v32H51Z" fill="#182f35"/>
      <path d="M112 99l18 6 26-9 32 21M208 101l19-24 19 30" fill="none" stroke="#b8c6bd" stroke-width="2" opacity=".3"/></g></g>
      <path d="M61 30L317 42V173L61 162Z" fill="url(#${id}-glass)"/><path d="M61 30l132 6-132 67Z" fill="#fff" opacity=".025"/>
      <circle class="product-indicator" cx="189" cy="173" r="1.2" fill="#d7d5c3"/></g>`;
    if (type === 'fan') return floor+`<g class="product-body fan-body"><path d="M187 138v56" stroke="${metal}" stroke-width="10"/><ellipse cx="191" cy="199" rx="47" ry="11" fill="${dark}" stroke="#5b6563"/>
      <circle cx="190" cy="86" r="70" fill="${dark}" stroke="#9ea9a4" stroke-width="4"/>
      <g class="fan-rotor">${[0,120,240].map(a=>`<path transform="rotate(${a} 190 86)" d="M190 87C158 78 130 39 151 31C178 18 203 54 190 87Z" fill="${plastic}" stroke="#cbd0ca" stroke-width=".6"/>`).join('')}</g>
      <g opacity=".56" stroke="#a8b4ae" fill="none" stroke-width=".65">${[17,29,41,53,64].map(r=>`<circle cx="190" cy="86" r="${r}"/>`).join('')}${Array.from({length:16},(_,i)=>`<path d="M190 19v134" transform="rotate(${i*11.25} 190 86)"/>`).join('')}</g>
      <circle cx="190" cy="86" r="13" fill="${dark}" stroke="#bec6bf"/><circle cx="187" cy="83" r="7" fill="#414c4d"/>
    </g>`;
    if (type === 'cover') {
      const w=s.position === null ? 73 : 13+(100-s.position)*.97;
      return floor+`<g class="product-body curtain-body"><rect x="78" y="26" width="225" height="174" rx="3" fill="url(#${id}-sky)" stroke="#8b9894" stroke-width="5"/>
        <path d="M80 174l43-37 24 17 27-39 41 40 25-20 58 43v20H80Z" fill="#2d4d4b"/>
        <path d="M190 28v171M80 116h221" stroke="#d1d7cd" stroke-width="3"/>
        <rect x="84" y="30" width="213" height="165" fill="url(#${id}-glass)"/>
        <g class="curtain-left" style="--cloth-width:${w/110}"><path d="M75 26H185L177 114L185 200Q132 205 75 201Z" fill="url(#${id}-folds)"/><path d="M75 30H185" stroke="#fbfbef" opacity=".5"/></g>
        <g class="curtain-right" style="--cloth-width:${w/110}"><path d="M307 26H197L205 114L197 200Q252 205 307 201Z" fill="url(#${id}-folds)"/><path d="M197 30H307" stroke="#fbfbef" opacity=".5"/></g>
        <path d="M69 23H313" stroke="${metal}" stroke-width="5" stroke-linecap="round"/>
        <circle cx="70" cy="23" r="4" fill="#bec8bc"/><circle cx="312" cy="23" r="4" fill="#bec8bc"/>
      </g>`;
    }
    if (type === 'led' || type === 'light') return floor+`<g class="product-body strip-body">
      <ellipse cx="190" cy="91" rx="90" ry="61" fill="${dark}" stroke="#5e6762" stroke-width=".8"/>
      <ellipse cx="190" cy="91" rx="60" ry="40" fill="#080d0e" stroke="#3c4643" stroke-width="3"/>
      <ellipse cx="190" cy="91" rx="17" ry="12" fill="${metal}"/><ellipse cx="190" cy="91" rx="8" ry="6" fill="#131819"/>
      ${[0,120,240].map(a=>`<path d="M190 57v18" transform="rotate(${a} 190 91)" stroke="#424d49" stroke-width="7"/>`).join('')}
      <path d="M100 105C100 174 297 157 288 189C280 218 88 191 70 167" stroke="#cecbbc" stroke-width="14" fill="none"/>
      <path class="led-halo" d="M100 105C100 174 297 157 288 189C280 218 88 191 70 167" stroke="var(--light-color)" stroke-width="20" fill="none" filter="url(#${id}-glow)"/>
      <path d="M100 105C100 174 297 157 288 189C280 218 88 191 70 167" stroke="#8a8978" stroke-width=".8" fill="none"/>
      <g class="strip-diodes">${[[108,125],[132,140],[164,146],[203,151],[241,160],[273,174],[274,197],[237,200],[193,196],[148,188],[107,180],[78,169]].map(([x,y],i)=>`<rect x="${x-3}" y="${y-2}" width="7" height="5" rx="1.2" fill="var(--light-color)"/><path d="M${x-8} ${y-5}v9M${x+8} ${y-4}v9" stroke="#aa8b53" stroke-width="1.5"/>`).join('')}</g>
      <path d="M69 168l-14 15 1 22" stroke="#333c36" stroke-width="4" fill="none"/>
    </g>`;
    if (type === 'lock') return floor+`<g class="product-body lock-body"><path d="M115 18H266V211H115Z" fill="#49423b"/><path d="M120 18v193M260 18v193" stroke="#5f564b" stroke-width="1"/>
      <rect x="155" y="32" width="69" height="159" rx="14" fill="${metal}"/>
      <rect x="159" y="36" width="61" height="151" rx="12" fill="${dark}" stroke="#7c8983" stroke-width=".5"/>
      <circle cx="190" cy="64" r="12" fill="#141c1d" stroke="#8c9c91"/><circle class="product-indicator" cx="190" cy="64" r="6" fill="#a6bdaf"/>
      ${Array.from({length:9},(_,i)=>`<circle cx="${178+(i%3)*12}" cy="${89+Math.floor(i/3)*11}" r="1.1" fill="#8c9d93"/>`).join('')}
      <g class="lock-handle"><path d="M180 132h71q10 0 10 7t-10 7h-71Z" fill="${metal}" stroke="#6a7772" stroke-width=".7"/><path d="M186 133h62" stroke="#e3e9df" opacity=".45"/></g>
      <circle cx="190" cy="167" r="7" fill="#38403c"/><path d="M190 163v8" stroke="#aaa" stroke-width="2"/>
    </g>`;
    if (type === 'sensor') {
      const t=d.telemetry || {}, temperature=finite(t.temperature,-100,200)?t.temperature+'°':'—°', humidity=finite(t.humidity_percent,0,100)?t.humidity_percent+'%':'—%';
      return floor+`<g class="product-body sensor-body"><path d="M123 26H251Q267 28 267 45V184L257 198H125Q110 194 110 176V46Z" fill="url(#${id}-side)"/>
      <rect x="110" y="26" width="144" height="171" rx="24" fill="${plastic}" stroke="#dedfd7" stroke-width=".6"/>
      <rect x="128" y="47" width="108" height="90" rx="7" fill="#444f46"/><rect x="131" y="50" width="102" height="84" rx="6" fill="#a0ae99"/>
      <text x="182" y="86" text-anchor="middle" fill="#27372b" font-size="27" font-family="monospace">${temperature}</text><text x="182" y="118" text-anchor="middle" fill="#27372b" font-size="19" font-family="monospace">${humidity}</text>
      ${Array.from({length:5},(_,i)=>`<path d="M144 ${156+i*5}h76" stroke="#727e71" stroke-width="1.4" stroke-linecap="round"/>`).join('')}
      <path d="M119 49V173" stroke="#fff" opacity=".4" stroke-width="1"/></g>`;
    }
    if (type === 'projector') return floor+`<g class="product-body projector-body">
      <path class="projector-beam" d="M253 116L377 76V211L253 143Z" fill="url(#${id}-sky)" opacity=".15"/>
      <path d="M82 74L250 52L304 91V167L134 191L82 164Z" fill="${plastic}"/><path d="M82 74L250 52L304 91L134 116Z" fill="${top}"/>
      <path d="M134 116L304 91V167L134 191Z" fill="url(#${id}-side)"/>
      <ellipse cx="251" cy="135" rx="29" ry="30" fill="#181f22" stroke="#778681" stroke-width="2"/><ellipse cx="251" cy="135" rx="22" ry="24" fill="url(#${id}-lens)"/><ellipse cx="244" cy="129" rx="5" ry="9" fill="#9cafb1" opacity=".4"/>
      ${Array.from({length:7},(_,i)=>`<path d="M145 ${136+i*6}l49-7" stroke="#3e4946" stroke-width="2.2"/>`).join('')}<path d="M93 95l2 54" stroke="#fff" opacity=".45"/>
      <circle class="product-indicator" cx="179" cy="78" r="2" fill="#b4ccba"/></g>`;
    if (type === 'audio') return floor+`<g class="product-body speaker-body">${[102,232].map(x=>`<path d="M${x} 27l69 4 10 7v165l-79-4Z" fill="${dark}" stroke="#4c5852"/>
      <path d="M${x+69} 32l10 6v165l-10-5Z" fill="#35403c"/><circle cx="${x+35}" cy="70" r="17" fill="#101819" stroke="#68766c"/>
      <circle cx="${x+35}" cy="70" r="9" fill="${metal}"/>
      <g class="speaker-cone" style="transform-origin:${x+35}px 143px"><circle cx="${x+35}" cy="143" r="31" fill="#090f11" stroke="#465650" stroke-width="4"/><circle cx="${x+35}" cy="143" r="25" fill="${dark}" stroke="#617268"/><circle cx="${x+35}" cy="143" r="11" fill="#3d5049"/></g>`).join('')}</g>`;
    if (type === 'bridge' || type === 'remote') return floor+`<g class="product-body bridge-body"><path d="M104 113Q100 90 119 84L248 79Q270 81 278 98L282 152Q211 185 111 157Z" fill="${dark}"/>
      <path d="M119 84Q111 85 108 100L120 143Q198 166 274 142L276 98Q270 83 248 79Z" fill="#293134" stroke="#5a6460" stroke-width=".5"/>
      <path d="M119 86L251 82" stroke="#b3bdb7" opacity=".12"/><path d="M175 117q17-7 34-2" stroke="#7b8781" stroke-width="1.3" fill="none"/><circle class="bridge-signal" cx="192" cy="158" r="2" fill="#a5c8b1"/></g>`;
    if (d.id?.startsWith('sonoff')) {
      const count=d.id==='sonoff_tx3c'?3:1;
      return floor+`<g class="product-body switch-body"><path d="M122 25L258 32L268 43V196L122 189L113 179V38Z" fill="url(#${id}-side)"/><path d="M122 25L255 32V186L122 178Z" fill="${plastic}" stroke="#e3e7dd"/>
      <path d="M128 41L247 48V166L128 159Z" fill="#dfe2dc"/>${Array.from({length:count},(_,i)=>`<path d="M${132+i*108/count} ${49+i*2}l${99/count} 1v100l-${99/count} -1Z" fill="${top}" stroke="#bcc5ba" stroke-width=".6"/><circle cx="${132+(i+.5)*108/count}" cy="128" r="2" fill="${(d.channels?.find(c=>c.channel===i+1)?.state||d.state)==='on'?'#84bdb4':'#aaa'}"/>`).join('')}</g>`;
    }
    if (type === 'other') return floor+`<g class="product-body remote-body"><path d="M151 17L216 22Q230 27 230 43V191Q229 207 214 207L150 201Q139 196 139 181V37Q139 19 151 17Z" fill="${metal}"/>
      <rect x="144" y="22" width="77" height="177" rx="21" fill="${dark}"/><circle cx="183" cy="52" r="10" fill="#9dada1"/>
      <circle cx="183" cy="104" r="28" fill="#5e6b63"/><circle cx="183" cy="104" r="12" fill="#26322c"/>${[151,166,181].map(y=>`<rect x="161" y="${y}" width="15" height="7" rx="3" fill="#859487"/><rect x="190" y="${y}" width="15" height="7" rx="3" fill="#859487"/>`).join('')}</g>`;
    return floor+`<g class="product-body outlet-body"><path d="M139 33L225 42Q238 46 241 61V190L225 198L142 189Q129 184 129 171V52Z" fill="url(#${id}-side)"/>
      <path d="M143 33L221 41Q230 43 230 57V182Q229 195 217 194L141 187Q130 184 130 171V49Q131 36 143 33Z" fill="${plastic}"/>
      <path d="M145 65L216 72Q222 73 222 83V152Q220 161 211 161L145 155Q138 154 138 145V75Q138 66 145 65Z" fill="${top}" stroke="#b0b9ae"/>
      <path d="M161 91v16M201 94v16" stroke="#353f3b" stroke-width="4.4" stroke-linecap="round"/>
      <circle cx="182" cy="130" r="4.5" fill="#3b4540"/><circle class="product-indicator" cx="181" cy="175" r="2" fill="#a4ceb7"/>
      <path d="M135 54v117" stroke="#fff" opacity=".4" stroke-width="1"/></g>`;
  }
  const observer = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(entries=>{entries.forEach(e=>{e.target._casaVisible=e.isIntersecting;});kick();}) : null;
  function setScene(box,s) {
    box._casaState=s;
    box.classList.toggle('running',s.active);
    box.classList.toggle('visual-preview',s.preview);
    box.style.setProperty('--light-color',s.color);
    box.style.setProperty('--light-level',String(s.brightness/100));
    box.style.setProperty('--fan-duration',s.fan==='high'?'.48s':s.fan==='low'?'1.55s':'.82s');
    box.dataset.flow=s.mode;
    box.dataset.swing=s.swing;
    if(box._casaCanvas&&!s.active)drawFlow(box,0);
  }
  function drawFlow(box,time) {
    const canvas=box._casaCanvas,ctx=canvas.getContext('2d'),s=box._casaState;
    if (!ctx) return;
    ctx.clearRect(0,0,760,460);
    if (!s.active) return;
    ctx.save();ctx.scale(2,2);ctx.globalCompositeOperation='screen';
    const speed=s.fan==='high'?.46:s.fan==='low'?.21:.31;
    const drift=s.swing==='swing'?Math.sin(time*.65)*17:0;
    const rgb=s.mode==='heat'?'211,182,145':'177,198,197';
    const volume=ctx.createLinearGradient(0,115,0,225);
    volume.addColorStop(0,`rgba(${rgb},0)`);volume.addColorStop(.25,`rgba(${rgb},.025)`);volume.addColorStop(1,`rgba(${rgb},0)`);
    ctx.fillStyle=volume;ctx.beginPath();ctx.moveTo(96,112);ctx.lineTo(290,126);ctx.bezierCurveTo(300+drift,156,324+drift,211,315+drift,226);ctx.lineTo(61+drift,214);ctx.bezierCurveTo(83+drift,183,95,139,96,112);ctx.fill();
    for(let i=0;i<36;i++) {
      const origin=97+i*5.3,exit=112+i*.38;
      const gradient=ctx.createLinearGradient(0,exit,0,225);
      gradient.addColorStop(0,`rgba(${rgb},0)`);gradient.addColorStop(.14,`rgba(${rgb},.145)`);gradient.addColorStop(.57,`rgba(${rgb},.09)`);gradient.addColorStop(1,`rgba(${rgb},0)`);
      ctx.strokeStyle=gradient;ctx.lineWidth=1.8+(i%4)*.4;ctx.lineCap='round';ctx.globalAlpha=.5+Math.sin(i*.81-time*1.4)*.23;ctx.beginPath();
      for(let j=0;j<=20;j++) {
        const p=j/20,wave=Math.sin(i*.59+p*6-time*speed*6)*3.1*p;
        const x=origin+(origin-190)*p*.32+drift*p+wave,y=exit+p*(225-exit);
        if(!j)ctx.moveTo(x,y);else ctx.lineTo(x,y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
  function animate(now) {
    frame=0;
    if (document.hidden || reduced.matches) return;
    if(now-lastFrame>31) {
      lastFrame=now;
      for(const box of scenes) {
        if(!box.isConnected){observer?.unobserve(box);scenes.delete(box);continue;}
        if(box._casaVisible!==false&&box._casaState.active)drawFlow(box,now/1000);
      }
    }
    if([...scenes].some(box=>box.isConnected&&box._casaVisible!==false&&box._casaState.active))frame=requestAnimationFrame(animate);
  }
  function kick(){if(!frame&&!document.hidden&&!reduced.matches&&[...scenes].some(box=>box._casaVisible!==false&&box._casaState.active))frame=requestAnimationFrame(animate);}
  function create(device,type,large=false) {
    const id='scene-'+(++serial),s=stateFor(device),box=document.createElement('div');
    box.className='appliance-art product-scene art-'+type+(large?' large':'')+' state-'+(device.state||'unknown');
    box.setAttribute('aria-hidden','true');
    box.innerHTML=`<svg viewBox="0 0 380 230" focusable="false">${definitions(id)}${model(type,device,id,s)}</svg>`;
    box._casaMeasured=s;setScene(box,s);
    if(type==='cover'&&s.position!==null) {
      const previous=observations.get(device.id+(large?'-large':'-card'));
      observations.set(device.id+(large?'-large':'-card'),s.position);
      if(previous!==undefined&&previous!==s.position) {
        const parts=box.querySelectorAll('.curtain-left,.curtain-right');
        parts.forEach(p=>p.style.setProperty('--cloth-from',String((13+(100-previous)*.97)/110)));
        box.classList.add('position-transition');
      }
    }
    if(type==='climate') {
      const canvas=document.createElement('canvas');canvas.width=760;canvas.height=460;canvas.className='air-volume';box.append(canvas);box._casaCanvas=canvas;
      scenes.add(box);observer?.observe(box);drawFlow(box,0);kick();
    }
    if(large) {
      box.addEventListener('pointermove',event=>{
        if(event.pointerType!=='mouse'||reduced.matches)return;
        const r=box.getBoundingClientRect();
        box.style.setProperty('--scene-y',((event.clientX-r.left)/r.width-.5)*7+'deg');
        box.style.setProperty('--scene-x',-((event.clientY-r.top)/r.height-.5)*5+'deg');
      });
      box.addEventListener('pointerleave',()=>{box.style.setProperty('--scene-x','0deg');box.style.setProperty('--scene-y','0deg');});
    }
    return box;
  }
  function updateClimate(box,draft,preview=false) {
    const previous=box._casaMeasured;
    setScene(box,{...previous,...draft,preview,active:preview||previous.active});
    const display=box.querySelector('.ac-mini-temperature');if(display)display.textContent=preview||previous.active?String(draft.temperature):'';
    if(reduced.matches)drawFlow(box,0);else kick();
  }
  function preview(box,on) {
    const original=box._casaOriginal || (box._casaOriginal={...box._casaState});
    setScene(box,{...original,preview:on,active:on||original.active});
    if(reduced.matches&&box._casaCanvas)drawFlow(box,0);
    kick();
  }
  document.addEventListener('visibilitychange',kick);
  reduced.addEventListener('change',()=>{for(const box of scenes)drawFlow(box,0);kick();});
  window.CasaVisuals=Object.freeze({create,updateClimate,preview,stateFor});
}());
