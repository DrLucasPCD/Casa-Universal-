"""Hardware compatibility check with a simulated Sonoff, no real actuator commands.

Requires the TX3C slot to still be pending. Restores it in finally. This uses the
unmodified SonoffLAN encrypt/decrypt functions as an independent protocol oracle.
"""
import argparse
import json
import socket
import secrets
import sys
import threading
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT))
from casa.vendor.sonofflan.local import encrypt,decrypt
from zeroconf import Zeroconf,ServiceInfo

KEY='simulated-sonoff-key-only'
DEVICE='1000'+secrets.token_hex(3)  # separate mDNS identity avoids stale fixtures across runs
STATE={'switches':[{'outlet':i,'switch':'on' if i==1 else 'off'} for i in range(3)]}

class Simulator(BaseHTTPRequestHandler):
    calls=[];mode='encrypted';reply_error=0
    def log_message(self,*args):pass
    def do_POST(self):
        payload=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        assert payload['deviceid']==DEVICE and payload['selfApikey']=='123' and payload['encrypt'] is True
        params=json.loads(decrypt(payload,KEY));self.calls.append((self.path,params,payload['iv']))
        if self.path.endswith('/getState') and self.mode=='html':
            self.send_response(200);self.send_header('Content-Type','text/html');self.end_headers();self.wfile.write(b'<html>Not supported</html>');return
        if self.path.endswith('/getState'):
            response=encrypt({'data':STATE,'error':0,'seq':payload['sequence']},KEY)
            if self.mode=='bad_padding':response['data']='AAAAAAAAAAAAAAAAAAAAAA=='
        else:response={'error':self.reply_error}
        self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(json.dumps(response).encode())

def run(central,host,allow_missing_mdns=False):
    def api(path,payload=None):
        body=json.dumps(payload).encode() if payload is not None else None
        headers={'Origin':central,'Content-Type':'application/json'}
        with urllib.request.urlopen(urllib.request.Request(central+path,data=body,headers=headers),timeout=30) as r:return json.load(r)
    devices=api('/api/devices')['devices'];original=next(d for d in devices if d['id']=='sonoff_tx3c')
    assert original['adapter']=='pending' and not original['config'].get('has_secret'),'Will not replace an already configured Sonoff.'
    baseline={d['id']:d for d in devices if d['id']!='sonoff_tx3c'}
    server=ThreadingHTTPServer((host,0),Simulator);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    zc=Zeroconf(interfaces=[host]);service=None
    def status():return next(d for d in api('/api/status')['devices'] if d['id']=='sonoff_tx3c')
    try:
        cfg={'ip':host,'port':server.server_port,'device_id':DEVICE,'device_key':KEY,'channels':3}
        saved=api('/api/configure',{'id':'sonoff_tx3c','adapter':'sonoff_lan','config':cfg})
        assert KEY not in json.dumps(saved) and len(saved['actions'])==6 and len(saved['channels'])==3
        for _ in range(2):assert api('/api/action',{'id':'sonoff_tx3c','action':'on_2'})['sent']
        commands=[p for p in Simulator.calls if p[0].endswith('/switches')]
        assert all(p[1]=={'switches':[{'outlet':1,'switch':'on'}]} for p in commands) and commands[0][2]!=commands[1][2]
        print('PASS: ESP32 AES matches upstream SonoffLAN; outlet 1 targets UI channel 2; random IVs.',flush=True)
        calls=len(Simulator.calls)
        try:api('/api/action',{'id':'sonoff_tx3c','action':'on_4'});raise AssertionError('invalid channel accepted')
        except urllib.error.HTTPError as error:assert error.code==400;error.close()
        assert len(Simulator.calls)==calls
        observed=status();assert [c['state'] for c in observed['channels']]==['off','on','off'],{k:observed.get(k) for k in ('state','available','channels','message')}
        print('PASS: three confirmed channel states decrypted; invalid channel never sent.',flush=True)
        Simulator.reply_error=40001
        try:api('/api/action',{'id':'sonoff_tx3c','action':'off_2'});raise AssertionError('rejected command accepted')
        except urllib.error.HTTPError as error:assert error.code==400;error.close()
        Simulator.reply_error=0;Simulator.mode='bad_padding'
        assert status()['state']=='unavailable'
        print('PASS: device rejection and invalid encrypted padding do not report success.',flush=True)
        # Clear cached states, then prove LAN presence alone does not imply on/off.
        api('/api/configure',{'id':'sonoff_tx3c','adapter':'sonoff_lan','config':cfg});Simulator.mode='html'
        empty=status();assert empty['available'] and all(c['state']=='unknown' for c in empty['channels'])
        announcement=encrypt({'data':STATE},KEY);raw=announcement['data'];props={'id':DEVICE,'type':'switches','encrypt':'true','iv':announcement['iv'],'seq':'1'}
        for n in range(4):
            part=raw[n*220:(n+1)*220]
            if part:props['data'+str(n+1)]=part
        service=ServiceInfo('_ewelink._tcp.local.','eWeLink_'+DEVICE+'._ewelink._tcp.local.',addresses=[socket.inet_aton(host)],port=server.server_port,properties=props,server='casa-sonoff-test.local.')
        zc.register_service(service)
        found=api('/api/discover/sonoff',{})['devices']
        if any(d['device_id']==DEVICE for d in found):
            observed=status();assert [c['state'] for c in observed['channels']]==['off','on','off']
            print('PASS: unsupported getState stays unknown; mDNS encrypted TXT reports real channel states.',flush=True)
        else:
            assert allow_missing_mdns,'Simulator not discovered: mDNS path requires further validation on this network.'
            print('SKIP: mDNS simulator not observed; multicast discovery/state path remains unvalidated on this network.',flush=True)
        # Single-channel variant uses switch, never switches or guessed toggle.
        cfg['channels']=1;api('/api/configure',{'id':'sonoff_tx3c','adapter':'sonoff_lan','config':cfg})
        assert api('/api/action',{'id':'sonoff_tx3c','action':'off'})['sent']
        assert Simulator.calls[-1][:2]==('/zeroconf/switch',{'switch':'off'})
        print('PASS: Basic/TX1C command format is compatible with upstream decryption.',flush=True)
    finally:
        try:
            api('/api/configure',{'id':original['id'],'name':original['name'],'room':original['room'],'adapter':'pending','config':{}})
            restored=api('/api/devices')['devices']
            assert {d['id']:d for d in restored if d['id']!='sonoff_tx3c'}==baseline
            assert next(d for d in restored if d['id']=='sonoff_tx3c')['adapter']=='pending'
            print('PASS: pending TX3C restored; all other saved controls preserved.',flush=True)
        finally:
            if service:zc.unregister_service(service)
            zc.close();server.shutdown();server.server_close();thread.join()

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--central',required=True);parser.add_argument('--host',required=True);parser.add_argument('--allow-missing-mdns',action='store_true');args=parser.parse_args()
    run(args.central.rstrip('/'),args.host,args.allow_missing_mdns)
