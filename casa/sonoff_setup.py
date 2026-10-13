"""One-time eWeLink import using SonoffLAN; credentials never persist or enter logs."""
import asyncio
import ipaddress
import json
import re
import threading
import time
from urllib.parse import urlsplit

from .vendor.sonofflan.cloud import API, REGIONS, XRegistryCloud

TARGETS={'sonoff','sonoff_tx1c','sonoff_tx3c'}

class JsonResponse:
    def __init__(self,value):self.value=value
    async def json(self):return self.value

class SafeAPI:
    """Limit the upstream importer to TLS, fixed API hosts and read-only endpoints."""
    def __init__(self,session):self.session=session
    async def call(self,method,url,**kwargs):
        parsed=urlsplit(url)
        if parsed.scheme!='https' or parsed.netloc not in {urlsplit(v).netloc for v in API.values()} or parsed.path not in {'/v2/user/login','/v2/user/profile','/v2/family','/v2/device/thing'}:
            raise ValueError('Destino eWeLink inválido.')
        async with self.session.request(method,url,allow_redirects=False,**kwargs) as response:
            if response.status!=200:raise ValueError('eWeLink indisponível.')
            raw=bytearray()
            async for chunk in response.content.iter_chunked(65536):
                raw.extend(chunk)
                if len(raw)>2*1024*1024:raise ValueError('Resposta eWeLink grande demais.')
            return JsonResponse(json.loads(raw))
    async def post(self,url,**kwargs):return await self.call('POST',url,**kwargs)
    async def get(self,url,**kwargs):return await self.call('GET',url,**kwargs)

async def fetch_devices(username,password,country):
    import aiohttp
    async with aiohttp.ClientSession() as session:
        registry=XRegistryCloud(SafeAPI(session))
        try:
            await registry.login(username,password,country)
            homes=await registry.get_homes()
            return await registry.get_devices(list(homes))
        finally:registry.auth=None  # no saved account token, password or cloud command connection

class SonoffSetup:
    def __init__(self,usb):
        self.usb=usb;self.records={};self.expires=0;self.lock=threading.Lock();self.timer=None
    def clear_expired(self):
        with self.lock:
            if time.monotonic()>=self.expires:self.records={}
    def connect(self,payload):
        if payload.get('consent') is not True:raise ValueError('Autorize o login no serviço oficial eWeLink no formulário local.')
        username=payload.get('username','');password=payload.get('password','');country=payload.get('country','+55')
        if not isinstance(username,str) or not 1<=len(username)<=200 or not isinstance(password,str) or not 1<=len(password)<=200 or country not in REGIONS or username=='token':
            raise ValueError('Confira sua conta eWeLink e o código do país.')
        if not self.lock.acquire(blocking=False):raise ValueError('Aguarde a importação em andamento.')
        try:
            self.records={};self.expires=0
            if self.timer:self.timer.cancel()
            try:records=asyncio.run(fetch_devices(username,password,country))
            except Exception:raise ValueError('O eWeLink não confirmou o login. Confira a conta/senha e tente novamente; nenhum aparelho foi acionado.') from None
            for item in records[:200]:
                if not isinstance(item,dict):continue
                id_=item.get('deviceid');key=item.get('devicekey');params=item.get('params',{})
                if not isinstance(params,dict) or not isinstance(id_,str) or not re.fullmatch('[a-zA-Z0-9]{8,40}',id_) or not isinstance(key,str) or not 16<=len(key)<=128:continue
                switches=params.get('switches');count=len(switches) if isinstance(switches,list) else 1
                if params.get('switch') not in ('on','off') and not (isinstance(switches,list) and 1<=count<=4):continue
                self.records[id_]={'device_id':id_,'device_key':key,'channels':count,'name':str(item.get('name','Sonoff'))[:80],'model':str(item.get('productModel',''))[:80]}
            self.expires=time.monotonic()+900
            self.timer=threading.Timer(900,self.clear_expired);self.timer.daemon=True;self.timer.start()
            try:found=self.usb.request({'op':'discover','provider':'sonoff'}).get('devices',[])
            except Exception:found=[]
            for item in found:
                if item.get('device_id') in self.records:self.records[item['device_id']].update(ip=item.get('ip',''),port=item.get('port',8081))
            return {'devices':[{k:v for k,v in d.items() if k!='device_key'} for d in self.records.values()],
                    'message':'Escolha qual aparelho corresponde ao Basic 2, TX1C ou TX3C. As chaves ficam em memória por 15 minutos, até você salvar na placa.'}
        finally:self.lock.release()
    def save(self,payload):
        with self.lock:
            if time.monotonic()>=self.expires:self.records={};raise ValueError('Importação expirada. Entre novamente no eWeLink.')
            target=payload.get('target');record=self.records.get(payload.get('device_id'))
            if target not in TARGETS or not record:raise ValueError('Selecione um Sonoff importado e o controle correspondente.')
            try:
                ip=ipaddress.IPv4Address(payload.get('ip',record.get('ip','')))
                if not (ip in ipaddress.ip_network('10.0.0.0/8') or ip in ipaddress.ip_network('172.16.0.0/12') or ip in ipaddress.ip_network('192.168.0.0/16')):raise ValueError()
            except (ValueError,TypeError):raise ValueError('Informe o IP privado do aparelho encontrado no Wi-Fi.') from None
            cfg={k:record[k] for k in ('device_id','device_key','channels')};cfg.update(ip=str(ip),port=record.get('port',8081))
            self.usb.request({'op':'configure','id':target,'adapter':'sonoff_lan','config':cfg})
            return {'message':'Conexão SonoffLAN salva no ESP32. Consulte os estados no painel da casa.'}
