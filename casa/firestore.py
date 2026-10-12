"""Firestore backup through Firebase user authentication; never uses an admin credential."""
import base64
import json
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import zlib
from datetime import datetime, timezone

from .cloud_data import digest, portable
from .store import ROOT


class CloudError(ValueError):
    pass


class ResponseError(Exception):
    def __init__(self, status, code):
        self.status, self.code = status, code


def request_json(url, method='GET', data=None, token=None, form=False):
    if urllib.parse.urlsplit(url).hostname not in {'identitytoolkit.googleapis.com','securetoken.googleapis.com','firestore.googleapis.com'}:
        raise CloudError('Destino Firebase inválido.')
    headers={'Content-Type':'application/x-www-form-urlencoded' if form else 'application/json'}
    if token:headers['Authorization']='Bearer '+token
    body=None if data is None else (urllib.parse.urlencode(data).encode() if form else json.dumps(data).encode())
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*args,**kwargs):return None
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
    try:
        with opener.open(urllib.request.Request(url,data=body,headers=headers,method=method),timeout=12) as response:
            raw=response.read(2_000_001)
        if len(raw)>2_000_000:raise CloudError('Resposta Firebase acima do limite.')
        return json.loads(raw)
    except urllib.error.HTTPError as error:
        with error:
            try:problem=json.loads(error.read(32768))
            except ValueError:problem={}
        code=problem.get('error',{}).get('status') or problem.get('error',{}).get('message','')
        raise ResponseError(error.code,code) from None
    except (OSError,ValueError):
        raise CloudError('Sem conexão com o Firebase. Alterações continuam salvas no Mac.') from None


def document(row):
    data=json.loads(row['payload'])
    encoded=base64.b64encode(zlib.compress(row['payload'].encode())).decode()
    if len(encoded)>850_000:raise CloudError('Este controle excede o limite da cópia no Firestore. A cópia local foi mantida.')
    fields={k:{'stringValue':str(data[k])} for k in ('name','room','kind')}
    fields.update(schema={'integerValue':'1'},encoding={'stringValue':'zlib+base64'},data={'stringValue':encoded},digest={'stringValue':row['hash']},savedAt={'timestampValue':datetime.now(timezone.utc).isoformat()})
    return {'fields':fields}


def decode_document(doc):
    fields=doc['fields']
    if fields.get('schema',{}).get('integerValue')!='1' or fields.get('encoding',{}).get('stringValue')!='zlib+base64':
        raise CloudError('Formato de controle na nuvem desconhecido.')
    raw=base64.b64decode(fields['data']['stringValue'],validate=True)
    decoder=zlib.decompressobj();payload=decoder.decompress(raw,8_000_001)
    if len(payload)>8_000_000 or not decoder.eof or decoder.unused_data:raise CloudError('Controle na nuvem excede os limites.')
    payload=payload.decode()
    if digest(payload)!=fields['digest']['stringValue']:raise CloudError('A cópia do controle na nuvem está inconsistente.')
    return json.loads(payload)


class FirestoreSync:
    def __init__(self, store, config=None):
        self.store=store
        self.config=config or json.loads((ROOT/'firebase/config.json').read_text())
        self.token=None;self.expires=0;self.checked=False;self.loaded=False
        self.stop_event=threading.Event();self.wake=threading.Event();self.mutex=threading.Lock();self.thread=None
        self.phase='connecting';self.message='Conectando ao Firestore…'

    def status(self):
        pending=len(self.store.cloud_pending());queued=self.phase=='synced' and pending>0
        return {'configured':True,'project':self.config['projectId'],'phase':'queued' if queued else self.phase,'message':'Alterações salvas no Mac, aguardando envio ao Firestore.' if queued else self.message,'pending':pending,'last_synced':self.store.setting('firebase_last_synced')}

    def authenticate(self):
        if self.token and self.expires>time.time()+60:return self.token
        key=self.config['apiKey'];refresh=self.store.setting('firebase_refresh_token')
        if refresh:
            if self.store.setting('firebase_project',self.config['projectId'])!=self.config['projectId']:
                raise CloudError('A identidade salva pertence a outro projeto Firebase.')
            result=request_json('https://securetoken.googleapis.com/v1/token?key='+key,'POST',{'grant_type':'refresh_token','refresh_token':refresh},form=True)
            token,uid,refresh,expires=result['id_token'],result['user_id'],result['refresh_token'],result['expires_in']
            if uid!=self.store.setting('firebase_uid'):raise CloudError('A identidade Firebase não corresponde à central.')
        else:
            result=request_json('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key='+key,'POST',{'returnSecureToken':True})
            token,uid,refresh,expires=result['idToken'],result['localId'],result['refreshToken'],result['expiresIn']
            self.store.set_setting('firebase_uid',uid)
        self.store.set_setting('firebase_refresh_token',refresh);self.store.set_setting('firebase_project',self.config['projectId'])
        self.token=token;self.expires=time.time()+int(expires)
        return token

    def collection(self):
        uid=self.store.setting('firebase_uid','')
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,128}',uid):raise CloudError('Identidade Firebase inválida.')
        project=self.config['projectId']
        if not re.fullmatch(r'[a-z0-9-]{6,63}',project):raise CloudError('Projeto Firebase inválido.')
        return f'https://firestore.googleapis.com/v1/projects/{project}/databases/(default)/documents/casas/{uid}/controles'

    def check_private(self):
        # Do not upload household configuration into an openly readable collection.
        try:request_json(self.collection()+'?pageSize=1')
        except ResponseError as error:
            if error.status in (401,403) and error.code in ('PERMISSION_DENIED','UNAUTHENTICATED'):
                self.checked=True;return
            raise
        raise CloudError('O Firestore permite acesso sem login. Publique as regras privadas antes de sincronizar.')

    def restore_missing(self, docs):
        # Restore portable IR layouts, never execute imported network addresses or replace local credentials.
        local={d['id']:d for d in self.store.devices()}
        for doc in docs:
            data=decode_document(doc);id_=data.get('id','')
            if doc['name'].rsplit('/',1)[-1]!=id_ or not re.fullmatch(r'(?:ir|generic)_[a-f0-9]{12}',id_) or id_ in local:continue
            if len(local)>=100:raise CloudError('Limite de controles atingido durante a restauração.')
            name,room=data.get('name'),data.get('room')
            if not isinstance(name,str) or not 1<=len(name)<=80 or not isinstance(room,str) or not 1<=len(room)<=60:raise CloudError('Nome de controle na nuvem inválido.')
            if data.get('kind')!='remote' or data.get('adapter')!='broadlink':continue
            commands=data.get('config',{}).get('commands',{})
            if not isinstance(commands,dict) or len(commands)>3000:raise CloudError('Botões na nuvem inválidos.')
            for key,value in commands.items():
                if not isinstance(key,str) or not 1<=len(key)<=100:raise CloudError('Nome de botão na nuvem inválido.')
                packet=base64.b64decode(value,validate=True)
                if not 6<=len(packet)<=4096 or packet[0]!=0x26:raise CloudError('Sinal infravermelho na nuvem inválido.')
            restored={'id':id_,'name':name,'room':room,'kind':'remote','adapter':'broadlink','config':{'parent_id':'broadlink','commands':commands}}
            if data.get('generic_remote'):
                meta=data['generic_remote'];buttons=meta.get('buttons',[])
                if meta.get('type') not in ('tv','climate','projector','fan','audio','other') or not isinstance(buttons,list) or not 1<=len(buttons)<=80:raise CloudError('Modelo de controle na nuvem inválido.')
                ids=set()
                for b in buttons:
                    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}',b.get('id','')) or b['id'] in ids or not isinstance(b.get('label'),str) or not 1<=len(b['label'])<=60 or not isinstance(b.get('section'),str) or len(b['section'])>80:raise CloudError('Botão de controle na nuvem inválido.')
                    ids.add(b['id'])
                if set(commands)-ids:raise CloudError('A nuvem contém botões fora do modelo.')
                restored['generic_remote']={'type':meta['type'],'buttons':buttons,'sources':meta.get('sources',{})}
            if data.get('ir_profile'):
                profile=data['ir_profile']
                if not isinstance(profile,dict) or profile.get('category') not in ('climate','media_player','fan','light'):raise CloudError('Perfil na nuvem inválido.')
                restored['ir_profile']=profile
            self.store.save(restored);local[id_]=restored

    def sync_once(self):
        with self.mutex:
            try:
                token=self.authenticate()
                self.check_private() # Recheck before every batch in case rules changed.
                if not self.loaded:
                    docs=[];page=''
                    while True:
                        result=request_json(self.collection()+'?pageSize=2'+('&pageToken='+urllib.parse.quote(page,safe='') if page else ''),token=token)
                        docs.extend(result.get('documents',[]));page=result.get('nextPageToken','')
                        if len(docs)>100:raise CloudError('A nuvem excede o limite de 100 controles.')
                        if not page:break
                    self.restore_missing(docs);self.loaded=True
                self.phase='syncing';self.message='Salvando controles no Firestore…'
                for row in self.store.cloud_pending():
                    if self.stop_event.is_set():return self.status()
                    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}',row['id']):raise CloudError('Identificador de controle inválido.')
                    request_json(self.collection()+'/'+row['id'],'PATCH',document(row),token=token)
                    self.store.cloud_ack(row)
                now=datetime.now(timezone.utc).isoformat();self.store.set_setting('firebase_last_synced',now)
                self.phase='synced';self.message='Controles salvos no Firestore. As credenciais dos aparelhos permanecem no Mac.'
            except ResponseError as error:
                self.phase='setup_required'
                if error.code in ('CONFIGURATION_NOT_FOUND','OPERATION_NOT_ALLOWED'):self.message='Ative Authentication → Método de login → Anônimo no Firebase.'
                elif error.status in (401,403):self.message='O Firebase recusou o acesso. Confira as regras privadas e a autenticação da central.'
                elif error.status==404:self.message='Crie o banco Firestore (default) no projeto Firebase.'
                else:self.message='O Firebase não concluiu a sincronização. A cópia local está preservada.'
            except (CloudError,ValueError,KeyError,TypeError,zlib.error):
                import sys
                error=sys.exception();self.phase='pending';self.message=str(error) if isinstance(error,CloudError) else 'A cópia na nuvem não passou pela validação. A cópia local está preservada.'
            return self.status()

    def start(self):
        def run():
            while not self.stop_event.is_set():
                if self.phase!='synced' or self.store.cloud_pending():self.sync_once()
                self.wake.wait(5 if self.phase=='synced' else 45);self.wake.clear()
        self.thread=threading.Thread(target=run,name='casa-firestore',daemon=True);self.thread.start()

    def retry(self):
        self.phase='connecting';self.wake.set();return self.status()

    def close(self):
        self.stop_event.set();self.wake.set()
        if self.thread:self.thread.join(timeout=2)
