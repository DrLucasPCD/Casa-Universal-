// ESP firmware customization; leaves the Mac interface and its preferences alone.
function espLogin(){
 main.replaceChildren();const box=node('section','login');box.append(node('p','eyebrow','CASA UNIVERSAL · ESP32'),node('h1',null,'Sua central está pronta.'),node('p','subtext','Entre com o código exibido na configuração USB do ESP32.'));
 const form=node('form'),f=field('Código da central','key','','password','Código exibido no Mac'),err=node('p','error'),submit=button('Entrar',()=>{},'button primary');submit.type='submit';form.append(f,err,submit);
 form.addEventListener('submit',async e=>{e.preventDefault();submit.disabled=true;try{await api('/api/login',{key:form.elements.key.value});await load();}catch(error){err.textContent=error.message;}finally{submit.disabled=false;}});box.append(form);main.append(box);$('#connection').textContent='Central ESP32';
}
