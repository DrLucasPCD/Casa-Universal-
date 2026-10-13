"""ESP32 LAN interoperability against unmodified TinyTuya crypto; no real actuation.

Uses only pending Tuya/curtain slots and restores them in finally. Run on the Mac
in the same LAN with --central http://IP_ESP32 --host IP_MAC.
"""
import argparse
import json
from pathlib import Path
import socketserver
import struct
import sys
import threading
import urllib.request
import urllib.error

sys.path.insert(0,str(Path(__file__).resolve().parent.parent))
from tinytuya.core import AESCipher, TuyaMessage, pack_message, unpack_message, parse_header

KEY=b'1234567890123456';DEVICE='eb00000000000000test01'

class Sim(socketserver.BaseRequestHandler):
    calls=[];mode='normal';dps={'1':False,'2':50,'3':235}
    def exact(self,n):
        raw=b''
        while len(raw)<n:
            part=self.request.recv(n-len(raw))
            if not part:raise ValueError('truncated')
            raw+=part
        return raw
    def handle(self):
        self.request.settimeout(4)
        raw=self.exact(16);header=parse_header(raw);raw+=self.exact(header.length)
        message=unpack_message(raw,no_retcode=True);assert message.crc_good
        body=message.payload
        if message.cmd in (7,13):assert body[:15]==b'3.3'+b'\0'*12;body=body[15:]
        payload=json.loads(AESCipher(KEY).decrypt(body,use_base64=False,verify_padding=True))
        assert payload['devId']==DEVICE
        self.calls.append((message.cmd,payload))
        if self.mode=='device22' and message.cmd==10:text=b'json obj data unvalid'
        else:text=json.dumps({'dps':self.dps}).encode()
        if message.cmd==13:assert all(v is None for v in payload['dps'].values())
        if self.mode=='bad_padding':encrypted=AESCipher(KEY).encrypt(b'\0'*16,use_base64=False,pad=False)
        else:encrypted=AESCipher(KEY).encrypt(text,use_base64=False)
        retcode=1 if self.mode=='rejected' else 0
        packet=pack_message(TuyaMessage(message.seqno,message.cmd,0,struct.pack('>I',retcode)+b'3.3'+b'\0'*12+encrypted,0))
        if self.mode=='bad_crc':packet=packet[:-8]+bytes([packet[-8]^1])+packet[-7:]
        self.request.sendall(packet)

class TCP(socketserver.ThreadingTCPServer):allow_reuse_address=True;daemon_threads=True

def run(central,host):
    def api(path,payload=None):
        req=urllib.request.Request(central+path,data=json.dumps(payload).encode() if payload is not None else None,
                                   headers={'Origin':central,'Content-Type':'application/json'})
        with urllib.request.urlopen(req,timeout=40) as response:return json.load(response)
    original=api('/api/devices')['devices'];targets={d['id']:d for d in original if d['id'] in ('tuya','curtain')}
    assert len(targets)==2 and all(d['adapter']=='pending' and not d['config'].get('has_secret') for d in targets.values()),'Will not replace configured Tuya devices.'
    baseline={d['id']:d for d in original if d['id'] not in targets}
    server=TCP((host,0),Sim);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    cfg={'ip':host,'port':server.server_address[1],'device_id':DEVICE,'local_key':KEY.decode(),'version':'3.3','dp':1}
    def configure(id_,extra=None):return api('/api/configure',{'id':id_,'adapter':'tuya','config':{**cfg,**(extra or {})}})
    def status(id_):return next(d for d in api('/api/status',{'id':id_})['devices'] if d['id']==id_)
    try:
        assert KEY.decode() not in json.dumps(configure('tuya',{'temperature_dp':3,'temperature_divisor':10}))
        observed=status('tuya');assert observed['state']=='off' and observed['telemetry']['temperature']==23.5,observed
        Sim.dps['1']=True;assert status('tuya')['state']=='on'
        for action,value in [('on',True),('off',False)]:
            assert api('/api/action',{'id':'tuya','action':action})['sent']
            assert Sim.calls[-1][0]==7 and Sim.calls[-1][1]['dps']=={'1':value}
        print('PASS: ESP32 AES, packet CRC and on/off match TinyTuya; false means off; temperature scale.',flush=True)
        configure('curtain',{'cover_type':7,'position_dp':2});Sim.dps['1']='down'
        observed=status('curtain');assert observed['state']=='partial' and observed['telemetry']['position_percent']==50
        assert api('/api/action',{'id':'curtain','action':'close'})['sent'];assert Sim.calls[-1][1]['dps']=={'1':'down'}
        configure('curtain',{'position_dp':''});assert status('curtain')['state']=='unknown'
        print('PASS: configured cover enum; movement alone never reports fully closed.',flush=True)
        Sim.mode='device22';assert status('tuya')['available'];assert Sim.calls[-1][0]==13
        print('PASS: device22 read fallback sends only null DPs.',flush=True)
        for mode in ('bad_crc','bad_padding','rejected'):
            Sim.mode=mode;assert status('tuya')['state']=='unavailable'
            before=len(Sim.calls)
            try:api('/api/action',{'id':'tuya','action':'on'});raise AssertionError('Malformed/rejected response reported success')
            except urllib.error.HTTPError as e:assert e.code==400;e.close()
            assert len(Sim.calls)==before+1,'Actuation retried'
        print('PASS: bad CRC, padding and device rejection fail; no automatic command retry.',flush=True)
    finally:
        try:
            for id_,d in targets.items():api('/api/configure',{'id':id_,'name':d['name'],'room':d['room'],'adapter':'pending','config':d['config']})
            restored=api('/api/devices')['devices']
            assert {d['id']:d for d in restored if d['id'] not in targets}==baseline
            assert all(d['adapter']=='pending' and not d['config']['has_secret'] for d in restored if d['id'] in targets)
            print('PASS: pending Tuya slots restored; other controls preserved.',flush=True)
        finally:server.shutdown();server.server_close();thread.join()

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--central',required=True);parser.add_argument('--host',required=True);args=parser.parse_args()
    run(args.central.rstrip('/'),args.host)
