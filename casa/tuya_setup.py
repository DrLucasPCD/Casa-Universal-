"""Read-only Tuya cloud key import. Account secrets never persist or reach the ESP32."""
import hashlib
import hmac
import ipaddress
import json
import math
import re
import threading
import time

HOSTS = {'us':'openapi.tuyaus.com', 'us-e':'openapi-ueaz.tuyaus.com',
         'eu':'openapi.tuyaeu.com', 'eu-w':'openapi-weaz.tuyaeu.com',
         'cn':'openapi.tuyacn.com', 'in':'openapi.tuyain.com', 'sg':'openapi-sg.iotbing.com'}
IDENTIFIER = re.compile(r'[a-zA-Z0-9]{16,40}')
TARGETS={'tuya','curtain','tuya_fan','tuya_led','tuya_sensor'}

def model_mapping(result):
    """Map numeric property IDs only; no action model or cached state."""
    if not isinstance(result,dict):return []
    model=result.get('model',{})
    if isinstance(model,str):
        try:model=json.loads(model)
        except (ValueError,TypeError):return []
    if not isinstance(model,dict) or not isinstance(model.get('services'),list):return []
    mapping=[]
    for service in model['services'][:20]:
        if not isinstance(service,dict) or not isinstance(service.get('properties'),list):continue
        for prop in service['properties'][:100]:
            if not isinstance(prop,dict):continue
            n=prop.get('abilityId');code=prop.get('code');spec=prop.get('typeSpec',{})
            if type(n)!=int or not 1<=n<=255 or not isinstance(code,str) or len(code)>80 or not isinstance(spec,dict):continue
            mapping.append({'dp_id':n,'code':code,'type':spec.get('type',''),'values':json.dumps(spec,ensure_ascii=False),'access_mode':prop.get('accessMode','')})
    return mapping

def signature(client, secret, timestamp, path, token=''):
    canonical = 'GET\n' + hashlib.sha256(b'').hexdigest() + '\n\n' + path
    return hmac.new(secret.encode(), (client+token+timestamp+canonical).encode(), hashlib.sha256).hexdigest().upper()

def fetch_devices(client, secret, region, sample):
    import requests
    def get(path, token=''):
        # Paths are constructed only from validated identifiers. No arbitrary endpoint or command.
        stamp = str(int(time.time()*1000))
        headers = {'client_id':client, 't':stamp, 'sign_method':'HMAC-SHA256',
                   'sign':signature(client,secret,stamp,path,token)}
        if token:headers['access_token']=token
        with requests.get('https://'+HOSTS[region]+path, headers=headers, timeout=12,
                          allow_redirects=False, stream=True) as response:
            if response.status_code!=200:raise ValueError('Tuya não respondeu. Confira a região do projeto.')
            raw=bytearray()
            for chunk in response.iter_content(65536):
                raw.extend(chunk)
                if len(raw)>2*1024*1024:raise ValueError('Resposta Tuya excedeu o limite.')
            value=json.loads(raw)
        if value.get('success') is not True:
            raise ValueError('Tuya recusou a consulta. Confira Access ID/Secret, região, vínculo Smart Life e permissão IoT Core.')
        return value['result']
    token=get('/v1.0/token?grant_type=1')['access_token']
    details=get('/v1.0/devices/'+sample, token)
    uid=details.get('uid','')
    if not isinstance(uid,str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,100}',uid):raise ValueError('Conta Tuya sem identificador válido.')
    records=get('/v1.0/users/'+uid+'/devices',token)
    if not isinstance(records,list):raise ValueError('Tuya retornou uma lista inválida.')
    for item in records[:20]:
        if not isinstance(item,dict) or not IDENTIFIER.fullmatch(str(item.get('id',''))) or 'fechadura' in str(item.get('name','')).lower():continue
        try:spec=get('/v1.0/devices/'+item['id']+'/specifications',token)
        except ValueError:continue
        if not isinstance(spec,dict):continue
        mapping=[]
        for section in ('functions','status'):
            section_values=spec.get(section,[])
            if not isinstance(section_values,list):continue
            for dp in section_values[:100]:
                if not isinstance(dp,dict):continue
                mapping.append({k:dp[k] for k in ('dp_id','code','type','values') if k in dp})
        if not any(type(dp.get('dp_id'))==int for dp in mapping):
            try:numeric=model_mapping(get('/v2.0/cloud/thing/'+item['id']+'/model',token))
            except ValueError:numeric=[]
            if numeric:mapping=numeric
        item['dp_mapping']=mapping
    return records

class TuyaSetup:
    def __init__(self,usb):
        self.usb=usb;self.records={};self.expires=0;self.lock=threading.Lock();self.timer=None
    def clear_expired(self):
        with self.lock:
            if time.monotonic()>=self.expires:self.records={}
    def public_records(self):
        with self.lock:
            if time.monotonic()>=self.expires:self.records={}
            return {'devices':[{k:v for k,v in d.items() if k!='local_key'} for d in self.records.values()]}
    def inspect(self,payload):
        """Read-only LAN probe using an imported key; never sends a switch/cover value."""
        with self.lock:
            if time.monotonic()>=self.expires:self.records={};raise ValueError('Importação expirada. Importe novamente as chaves.')
            record=self.records.get(payload.get('device_id'))
            if not record:raise ValueError('Escolha um aparelho importado.')
            try:
                ip=ipaddress.IPv4Address(payload.get('ip',''))
                if not any(ip in ipaddress.ip_network(n) for n in ('10.0.0.0/8','172.16.0.0/12','192.168.0.0/16')):raise ValueError()
            except (ValueError,TypeError):raise ValueError('Informe um IP privado encontrado na sua rede.') from None
            version=str(payload.get('version',record.get('version') or '3.3'))
            if version not in ('3.1','3.2','3.3','3.4','3.5'):raise ValueError('Protocolo de consulta inválido.')
            # A device22 status request carries only null values for explicitly listed DPs.
            requested=payload.get('dps',[1])
            if not isinstance(requested,list) or not 1<=len(requested)<=16 or any(type(i)!=int or not 1<=i<=255 for i in requested):raise ValueError('Lista de DPs de consulta inválida.')
            import tinytuya
            device=tinytuya.OutletDevice(record['device_id'],str(ip),record['local_key'],version=float(version))
            device.set_socketTimeout(2);device.set_socketRetryLimit(1);device.set_retry(False)
            device.set_dpsUsed({str(i):None for i in requested})
            try:result=device.status()
            except Exception:raise ValueError('O aparelho não confirmou uma consulta local autenticada.') from None
            finally:device.close()
            if not isinstance(result,dict) or not isinstance(result.get('dps'),dict):
                code=str(result.get('Err','')) if isinstance(result,dict) else ''
                code=code if re.fullmatch(r'[0-9]{1,4}',code) else 'desconhecido'
                raise ValueError('Sem estado LAN válido (código '+code+'). Confira IP, protocolo e se o Smart Life mantém uma conexão aberta.')
            dps={}
            for key,value in result['dps'].items():
                if not isinstance(key,str) or not re.fullmatch(r'[0-9]{1,3}',key) or not 1<=int(key)<=255:continue
                if isinstance(value,bool) or isinstance(value,(int,float)) and math.isfinite(value):dps[key]=value
                elif isinstance(value,str) and len(value)<=128:dps[key]=value
            record.update(ip=str(ip),version=version)
            return {'device_id':record['device_id'],'ip':str(ip),'version':version,'dps':dps,'message':'Consulta autenticada; nenhum comando de atuação foi enviado.'}
    def connect(self,payload):
        client=payload.get('client_id','');secret=payload.get('secret','');region=payload.get('region');sample=payload.get('device_id','')
        if payload.get('consent') is not True:raise ValueError('Autorize a consulta no serviço oficial Tuya no formulário local.')
        if not isinstance(client,str) or not re.fullmatch(r'[a-zA-Z0-9]{8,100}',client) or not isinstance(secret,str) or not re.fullmatch(r'[a-zA-Z0-9]{8,128}',secret) or region not in HOSTS or not isinstance(sample,str) or not IDENTIFIER.fullmatch(sample):
            raise ValueError('Confira Access ID, Access Secret, região e Device ID do projeto Tuya.')
        if not self.lock.acquire(blocking=False):raise ValueError('Aguarde a importação em andamento.')
        try:
            self.records={};self.expires=0
            if self.timer:self.timer.cancel()
            try:records=fetch_devices(client,secret,region,sample)
            except ValueError:raise
            except Exception:raise ValueError('Não foi possível consultar a Tuya. Confira as credenciais, o projeto e a conexão.') from None
            if not isinstance(records,list):raise ValueError('Tuya retornou uma lista inválida.')
            for item in records[:200]:
                if not isinstance(item,dict):continue
                id_=item.get('id');key=item.get('local_key')
                if not isinstance(id_,str) or not IDENTIFIER.fullmatch(id_) or not isinstance(key,str) or len(key.encode())!=16:continue
                if 'fechadura' in str(item.get('name','')).lower():continue
                self.records[id_]={'device_id':id_,'local_key':key,'name':str(item.get('name','Smart Life'))[:80], 'category':str(item.get('category',''))[:40], 'dp_mapping':item.get('dp_mapping',[])}
            self.expires=time.monotonic()+900
            self.timer=threading.Timer(900,self.clear_expired);self.timer.daemon=True;self.timer.start()
            try:found=self.usb.request({'op':'discover','provider':'tuya'}).get('devices',[])
            except Exception:found=[]
            for item in found:
                if item.get('device_id') in self.records:self.records[item['device_id']].update(ip=item.get('ip',''),version=item.get('version',''))
            return {'devices':[{k:v for k,v in d.items() if k!='local_key'} for d in self.records.values()],
                    'message':'Chaves importadas por 15 minutos. Escolha o aparelho e os DPs confirmados antes de salvar. Nenhum comando foi enviado.'}
        finally:self.lock.release()
    def save(self,payload):
        with self.lock:
            if time.monotonic()>=self.expires:self.records={};raise ValueError('Importação expirada. Importe novamente as chaves.')
            target=payload.get('target');record=self.records.get(payload.get('device_id'))
            if target not in TARGETS or not record:raise ValueError('Escolha um aparelho importado e seu controle.')
            try:
                address=payload.get('ip','')
                ip='' if target=='tuya_sensor' and address=='' else ipaddress.IPv4Address(address)
                if ip!='' and not any(ip in ipaddress.ip_network(n) for n in ('10.0.0.0/8','172.16.0.0/12','192.168.0.0/16')):raise ValueError()
            except (ValueError,TypeError):raise ValueError('Informe o IP privado do aparelho no Wi-Fi.') from None
            version=record.get('version','3.3') or '3.3'
            if version not in ('3.3','3.4'):raise ValueError('O ESP32 suporta protocolos Tuya 3.3 e 3.4 nesta versão.')
            cfg={'ip':str(ip),'device_id':record['device_id'],'local_key':record['local_key'],'version':version,'auto_discover':True}
            for field,default,limit in (('dp',1,255),('cover_type',1,8),('position_dp',None,255),('temperature_dp',None,255),('humidity_dp',None,255)):
                value=payload.get(field,default)
                if value in ('',None):
                    if default is None:continue
                    value=default
                if isinstance(value,bool) or not re.fullmatch(r'[0-9]{1,3}',str(value)) or not 1<=int(value)<=limit:raise ValueError('Confira DP, tipo da cortina e DP de posição.')
                cfg[field]=int(value)
            for field in ('temperature_divisor','humidity_divisor'):
                value=payload.get(field,1)
                if isinstance(value,bool) or not re.fullmatch(r'(1|10|100)',str(value)):raise ValueError('Escolha divisor 1, 10 ou 100 para as leituras.')
                cfg[field]=int(value)
            if target.startswith('tuya_'):self.usb.request({'op':'add_tuya','id':target})
            self.usb.request({'op':'configure','id':target,'adapter':'tuya','config':cfg})
            return {'message':'Tuya salva no ESP32. Consulte o estado no painel antes de testar os botões.'}
