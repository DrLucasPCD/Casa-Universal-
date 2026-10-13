"""Loopback-only USB setup; Wi-Fi passwords never enter logs, URLs or Git."""
import argparse
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import serial
from .remote_setup import prepare, DIRECTORY, SITE
from .sonoff_setup import SonoffSetup
import urllib.request
import urllib.error

ROOT=Path(__file__).resolve().parent.parent
PAGE='''<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Casa · Configurar ESP32</title>
<style>body{background:#101416;color:#eeeae1;font:16px system-ui;margin:0;padding:28px}main{max-width:580px;margin:35px auto}h1{font-size:38px;letter-spacing:-1.7px}p{color:#b7beb9;line-height:1.6}section{background:#202629;border:1px solid #353d3d;border-radius:24px;padding:25px;margin:22px 0}label{display:block;margin:18px 0}input{box-sizing:border-box;width:100%;padding:14px;border-radius:12px;background:#151b1d;border:1px solid #46504c;color:white;margin-top:8px;font:inherit}button,a.button{display:inline-block;border:0;border-radius:13px;padding:15px 20px;background:#d9cbb0;color:#111719;font-weight:650;cursor:pointer;text-decoration:none}button:disabled{opacity:.5}#code{font-family:monospace;overflow-wrap:anywhere;color:#d9cbb0}#msg{white-space:pre-wrap}small{color:#adb4ac}</style>
<main><small>CASA UNIVERSAL · CENTRAL ESP32</small><h1>Sua casa, sem o Mac ligado.</h1><p>Conecte a placa ao Wi-Fi de casa. Os dados são enviados somente pelo USB para seu ESP32.</p>
<section><h2>Wi-Fi de casa</h2><form id="wifi"><label>Nome da rede (2,4 GHz)<input name="ssid" autocomplete="off" maxlength="32" required></label><label>Senha do Wi-Fi<input type="password" name="password" autocomplete="new-password" maxlength="63"></label><button>Conectar a central</button></form><p id="msg" role="status"></p></section>
<section><h2>Seu painel</h2><p id="status">Consultando a placa…</p><div id="link"></div><details><summary>Mostrar chave de conexão MCP</summary><p id="code">—</p></details><small>Esta chave é usada pelo cliente MCP. O painel abre diretamente, sem código. Os controles salvos permanecem na placa ao desligar o Mac.</small></section>
<section><h2>Sonoff · conectar eWeLink</h2><p>Importe seus interruptores usando SonoffLAN. O login é enviado por HTTPS ao serviço oficial eWeLink; a senha e o token da conta não são salvos. Somente as chaves dos aparelhos escolhidos ficam no ESP32.</p><form id="sonoff-login"><label>E-mail ou telefone eWeLink<input name="username" autocomplete="username" required maxlength="200"></label><label>Senha eWeLink<input name="password" type="password" autocomplete="current-password" required maxlength="200"></label><label>Código do país<input name="country" value="+55" required maxlength="8"></label><label><input name="consent" type="checkbox" required style="width:auto"> Autorizo o login no serviço oficial eWeLink para importar meus aparelhos.</label><button>Importar meus Sonoff</button></form><p id="sonoff-message" role="status"></p><div id="sonoff-devices"></div></section>
<section><h2>Casa Universal no ChatGPT</h2><p>Ative uma vez a conexão remota. Depois, o ESP32 funciona sem o Mac ligado.</p><ol><li>Clique em <b>Preparar conexão</b>.</li><li>Baixe o arquivo privado e importe no Netlify: <b>Project configuration → Environment variables → Add a variable → Import from a .env file</b>. Use o contexto <b>Production</b> e o escopo <b>Functions</b> (ou All scopes).</li><li>Faça um novo deploy no Netlify e clique em <b>Ativar no ESP32</b>.</li><li>No ChatGPT pelo navegador, adicione <b>https://casa-universal.netlify.app/mcp</b> com autenticação OAuth. Na autorização, use a chave ChatGPT abaixo.</li></ol><button id="prepare">Preparar conexão</button><div id="remote-files" hidden><p><a class="button" href="/remote/env" download="casa-netlify.env">Baixar configuração privada do Netlify</a></p><details><summary>Mostrar chave ChatGPT</summary><input id="pairing-key" type="password" readonly autocomplete="off"><button id="show-key" type="button">Mostrar</button><p>Use esta chave somente na página de autorização da Casa Universal. Ela é diferente da chave MCP local.</p></details><p><button id="enable">Ativar no ESP32</button> <button id="disable">Desativar conexão remota</button></p></div><p id="remote-message" role="status"></p><small>O arquivo contém chaves privadas desta conexão. Importe somente no seu projeto Netlify; ele não deve ir para o GitHub. O painel local continua abrindo sem código.</small></section>
<p>Samsung, BroadLink e SonoffLAN têm drivers locais. Sonoff requer a device key pessoal do aparelho. Fechadura HAHA e Tuya permanecem pendentes. O catálogo possui 387 perfis para testar e confirmar no aparelho.</p></main>
<script src="/setup.js"></script></html>'''
SCRIPT='''let busy=false;async function info(){if(busy)return;try{const r=await fetch('/info'),d=await r.json();if(!r.ok)throw new Error(d.error);document.querySelector('#code').textContent=d.access_key;document.querySelector('#status').textContent=d.wifi_connected?'Central conectada: '+d.ip+' · '+d.devices+' aparelhos cadastrados':'A placa está pronta. Preencha o Wi-Fi acima.';const link=document.querySelector('#link');link.replaceChildren();if(d.wifi_connected){const a=document.createElement('a');a.href='http://'+d.ip;a.className='button';a.textContent='Abrir Casa Universal';link.append(a);}}catch(e){document.querySelector('#status').textContent=e.message;}}
document.querySelector('#wifi').addEventListener('submit',async e=>{e.preventDefault();busy=true;const b=e.target.querySelector('button');b.disabled=true;try{const r=await fetch('/wifi',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ssid:e.target.ssid.value,password:e.target.password.value})}),d=await r.json();if(!r.ok)throw new Error(d.error);e.target.password.value='';document.querySelector('#msg').textContent='Dados enviados pelo USB. Aguardando conexão com o roteador…';}catch(error){document.querySelector('#msg').textContent=error.message;}finally{busy=false;b.disabled=false;info();}});info();setInterval(info,3000);
async function remote(op){busy=true;const msg=document.querySelector('#remote-message');msg.textContent='Verificando conexão…';try{const r=await fetch('/remote/'+op,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),d=await r.json();if(!r.ok)throw new Error(d.error);if(d.pairing_key){document.querySelector('#pairing-key').value=d.pairing_key;document.querySelector('#remote-files').hidden=false;}msg.textContent=d.message;}catch(e){msg.textContent=e.message;}finally{busy=false;}}
document.querySelector('#prepare').addEventListener('click',()=>remote('prepare'));document.querySelector('#enable').addEventListener('click',()=>remote('enable'));document.querySelector('#disable').addEventListener('click',()=>remote('disable'));document.querySelector('#show-key').addEventListener('click',e=>{const input=document.querySelector('#pairing-key');input.type=input.type==='password'?'text':'password';e.target.textContent=input.type==='password'?'Mostrar':'Ocultar';});'''

SCRIPT+='''
document.querySelector('#sonoff-login').addEventListener('submit',async e=>{e.preventDefault();busy=true;const b=e.target.querySelector('button'),msg=document.querySelector('#sonoff-message'),list=document.querySelector('#sonoff-devices');b.disabled=true;msg.textContent='Consultando seus dispositivos no eWeLink…';list.replaceChildren();try{const payload={username:e.target.username.value.trim(),password:e.target.password.value,country:e.target.country.value.trim(),consent:e.target.consent.checked};e.target.password.value='';const r=await fetch('/sonoff/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}),d=await r.json();if(!r.ok)throw new Error(d.error);msg.textContent=d.devices.length?d.message:'Nenhum interruptor compatível com chave LAN foi retornado pela conta.';for(const device of d.devices){const form=document.createElement('form'),title=document.createElement('h3'),ip=document.createElement('input'),select=document.createElement('select'),save=document.createElement('button');title.textContent=device.name+' · '+device.device_id+' · '+device.channels+' canal(is)';ip.value=device.ip||'';ip.placeholder='IP local do Sonoff';ip.required=true;ip.setAttribute('aria-label','IP de '+device.name);select.setAttribute('aria-label','Controle para '+device.name);for(const [id,name] of [['sonoff','Basic 2'],['sonoff_tx1c','TX1C'],['sonoff_tx3c','TX3C']]){const o=document.createElement('option');o.value=id;o.textContent=name;select.append(o);}if(device.channels===3)select.value='sonoff_tx3c';save.textContent='Salvar na central';form.append(title,ip,select,save);form.addEventListener('submit',async event=>{event.preventDefault();busy=true;save.disabled=true;try{const r=await fetch('/sonoff/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({target:select.value,device_id:device.device_id,ip:ip.value.trim()})}),d=await r.json();if(!r.ok)throw new Error(d.error);msg.textContent=d.message;}catch(error){msg.textContent=error.message;}finally{busy=false;save.disabled=false;}});list.append(form);}}catch(error){msg.textContent=error.message;}finally{busy=false;b.disabled=false;}});
'''

class USB:
    def __init__(self,port):
        self.lock=threading.Lock()
        self.serial=serial.Serial(port=None,baudrate=115200,timeout=.2)
        self.serial.dtr=False;self.serial.rts=False;self.serial.port=port;self.serial.open()

    def request(self,payload):
        with self.lock:
            self.serial.reset_input_buffer()
            self.serial.write(json.dumps(payload,separators=(',',':')).encode()+b'\n')
            deadline=time.monotonic()+12
            while time.monotonic()<deadline:
                line=self.serial.readline()
                if line.startswith(b'CASA_JSON:'):
                    result=json.loads(line[len(b'CASA_JSON:'):])
                    if 'error' in result:raise ValueError(result['error'])
                    return result
        raise ValueError('ESP32 não respondeu pelo USB. Confira o cabo e a gravação.')

class Server(ThreadingHTTPServer):
    daemon_threads=True
    def __init__(self,port,usb):
        self.usb=usb
        self.sonoff=SonoffSetup(usb)
        super().__init__(('127.0.0.1',port),Handler)

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def allowed(self):return self.headers.get('Host') in (f'127.0.0.1:{self.server.server_port}',f'localhost:{self.server.server_port}')
    def send(self,status,value,kind='application/json'):
        body=json.dumps(value).encode() if kind=='application/json' else value.encode()
        self.send_response(status);self.send_header('Content-Type',kind);self.send_header('Content-Length',str(len(body)))
        self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff');self.send_header('Referrer-Policy','no-referrer')
        self.send_header('Content-Security-Policy',"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
        self.end_headers()
        try:self.wfile.write(body)
        except (BrokenPipeError,ConnectionResetError):pass
    def do_GET(self):
        if not self.allowed():return self.send(403,{'error':'Abra a configuração neste Mac.'})
        if self.path=='/':return self.send(200,PAGE,'text/html; charset=utf-8')
        if self.path=='/setup.js':return self.send(200,SCRIPT,'application/javascript')
        if self.path=='/remote/env':
            if self.headers.get('Sec-Fetch-Site')=='cross-site':return self.send(403,{'error':'Use a página local de configuração.'})
            path=DIRECTORY/'netlify.env'
            if not path.exists():return self.send(404,{'error':'Prepare a conexão primeiro.'})
            return self.send(200,path.read_text(),'text/plain; charset=utf-8')
        if self.path=='/remote/status':
            try:return self.send(200,self.server.usb.request({'op':'remote_status'}))
            except (ValueError,serial.SerialException):return self.send(503,{'error':'A placa ainda não respondeu pelo USB.'})
        if self.path=='/info':
            try:
                info=self.server.usb.request({'op':'info'})
                directory=ROOT/'data/esp32';directory.mkdir(mode=0o700,parents=True,exist_ok=True)
                path=directory/'connection.json';path.write_text(json.dumps(info));path.chmod(0o600)
                info.pop('ap_password',None)
                return self.send(200,info)
            except (ValueError,serial.SerialException):return self.send(503,{'error':'A placa ainda não respondeu pelo USB. Confira o cabo.'})
        return self.send(404,{'error':'Página não encontrada.'})
    def do_POST(self):
        if not self.allowed() or self.headers.get('Origin')!='http://'+self.headers.get('Host','') or self.headers.get('Content-Type')!='application/json':return self.send(403,{'error':'Use o formulário local.'})
        try:
            size=int(self.headers.get('Content-Length','0'))
            if self.path.startswith('/sonoff/'):
                if not 0<size<2048:raise ValueError('Solicitação Sonoff inválida.')
                payload=json.loads(self.rfile.read(size))
                if not isinstance(payload,dict):raise ValueError('Envie um objeto JSON.')
                try:
                    if self.path=='/sonoff/connect':return self.send(200,self.server.sonoff.connect(payload))
                    if self.path=='/sonoff/save':return self.send(200,self.server.sonoff.save(payload))
                    raise ValueError('Operação Sonoff inválida.')
                except ValueError as error:return self.send(400,{'error':str(error)})
            if self.path.startswith('/remote/'):
                if not 0<size<2048:raise ValueError('Solicitação inválida.')
                json.loads(self.rfile.read(size))
                if self.path=='/remote/prepare':
                    settings=prepare()
                    return self.send(200,{'pairing_key':settings['pairing_key'],'message':'Arquivo privado pronto. Importe no Netlify e faça um novo deploy antes de ativar a placa.'})
                if self.path=='/remote/disable':
                    self.server.usb.request({'op':'remote','enabled':False})
                    return self.send(200,{'message':'Conexão remota desativada. O painel local continua disponível.'})
                if self.path=='/remote/enable':
                    settings=prepare()
                    request=urllib.request.Request(SITE+'/bridge/status',headers={'Authorization':'Bearer '+settings['token']})
                    try:
                        with urllib.request.urlopen(request,timeout=12) as response:
                            state=json.load(response)
                        if not state.get('configured'):raise ValueError('Ponte ainda não está pronta.')
                    except (urllib.error.URLError,ValueError,TimeoutError):
                        return self.send(409,{'error':'O Netlify ainda não confirmou a configuração. Importe o arquivo privado nas variáveis de Production/Functions e faça um novo deploy.'})
                    self.server.usb.request({'op':'remote','enabled':True,'url':SITE,'token':settings['token']})
                    return self.send(200,{'message':'ESP32 ativado. Aguarde até 15 segundos e conecte Casa Universal no ChatGPT com OAuth.'})
                raise ValueError('Operação inválida.')
            if self.path!='/wifi' or not 0<size<2048:raise ValueError('Solicitação inválida.')
            payload=json.loads(self.rfile.read(size));ssid=payload['ssid'];password=payload['password']
            if not isinstance(ssid,str) or not 1<=len(ssid.encode())<=32 or not isinstance(password,str) or len(password)>63:raise ValueError('Confira nome e senha da rede.')
            result=self.server.usb.request({'op':'wifi','ssid':ssid,'password':password})
            return self.send(200,result)
        except (ValueError,KeyError,TypeError,serial.SerialException):return self.send(400,{'error':'Não foi possível enviar o Wi-Fi. Confira os campos e o USB.'})

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--port',default='/dev/cu.usbmodem101');parser.add_argument('--http-port',type=int,default=8866);args=parser.parse_args()
    os.umask(0o077);usb=USB(args.port);server=Server(args.http_port,usb)
    print(f'Configuração USB: http://127.0.0.1:{args.http_port}',flush=True)
    try:server.serve_forever()
    finally:server.server_close();usb.serial.close()

if __name__=='__main__':main()
