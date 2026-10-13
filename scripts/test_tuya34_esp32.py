"""Independent TinyTuya oracle for ESP32 3.4 session crypto; simulated devices only."""
import argparse
import hashlib
import hmac
import json
import os
from pathlib import Path
import socket
import socketserver
import struct
import sys
import threading
import urllib.error
import urllib.request

sys.path.insert(0,str(Path(__file__).resolve().parent.parent))
from tinytuya.core import AESCipher, TuyaMessage, pack_message, unpack_message, parse_header

KEY=b'1234567890123456';DEVICE='eb00000000000000test34'

class Sim(socketserver.BaseRequestHandler):
    calls=[];mode='normal';nonces=set()
    def exact(self,n):
        raw=b''
        while len(raw)<n:
            part=self.request.recv(n-len(raw))
            if not part:raise EOFError()
            raw+=part
        return raw
    def recv(self,key):
        raw=self.exact(16);header=parse_header(raw);raw+=self.exact(header.length)
        msg=unpack_message(raw,hmac_key=key,no_retcode=True);assert msg.crc_good
        return msg,AESCipher(key).decrypt(msg.payload,use_base64=False,decode_text=False,verify_padding=True)
    def send(self,key,msg,payload,mode='normal'):
        if mode=='bad_padding':payload=b'\0'*16;encrypted=AESCipher(key).encrypt(payload,use_base64=False,pad=False)
        else:encrypted=AESCipher(key).encrypt(payload,use_base64=False)
        packet=pack_message(TuyaMessage(msg.seqno,msg.cmd,0,struct.pack('>I',1 if mode=='rejected' else 0)+encrypted,0),hmac_key=key)
        if mode=='bad_hmac':packet=packet[:-36]+bytes([packet[-36]^1])+packet[-35:]
        self.request.sendall(packet)
    def handle(self):
        self.request.settimeout(5)
        try:
            msg,local=self.recv(KEY);assert msg.cmd==3 and len(local)==16
            assert local not in self.nonces;self.nonces.add(local)
            remote=os.urandom(16);proof=hmac.new(KEY,local,hashlib.sha256).digest()
            if self.mode=='bad_proof':proof=b'\0'*32
            self.send(KEY,msg._replace(cmd=4),remote+proof)
            if self.mode=='bad_proof':return
            msg,finish=self.recv(KEY);assert msg.cmd==5 and finish==hmac.new(KEY,remote,hashlib.sha256).digest()
            session=AESCipher(KEY).encrypt(bytes(a^b for a,b in zip(local,remote)),use_base64=False,pad=False)
            msg,body=self.recv(session)
            if msg.cmd==13:
                assert body[:15]==b'3.4'+b'\0'*12;body=body[15:]
            payload=json.loads(body);self.calls.append((msg.cmd,payload))
            if msg.cmd==13:assert payload['protocol']==5 and isinstance(payload['t'],int) and payload['data']['dps']=={'1':'open'}
            else:assert msg.cmd==16 and payload=={}
            self.send(session,msg,b'3.4'+b'\0'*12+json.dumps({'data':{'dps':{'1':'stop','2':75}}}).encode(),self.mode)
        except EOFError:pass

class TCP(socketserver.ThreadingTCPServer):allow_reuse_address=True;daemon_threads=True

def run(central,host):
    def api(path,payload=None):
        req=urllib.request.Request(central+path,data=json.dumps(payload).encode() if payload is not None else None,headers={'Origin':central,'Content-Type':'application/json'})
        with urllib.request.urlopen(req,timeout=40) as response:return json.load(response)
    original=api('/api/devices')['devices'];curtain=next(d for d in original if d['id']=='curtain')
    assert curtain['adapter']=='pending' and not curtain['config'].get('has_secret'),'Will not replace a configured curtain.'
    baseline=[d for d in original if d['id']!='curtain']
    server=TCP((host,0),Sim);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    cfg={'ip':host,'port':server.server_address[1],'device_id':DEVICE,'local_key':KEY.decode(),'version':'3.4','dp':1,'cover_type':1,'position_dp':2}
    try:
        result=api('/api/configure',{'id':'curtain','adapter':'tuya','config':cfg});assert KEY.decode() not in json.dumps(result)
        observed=api('/api/status',{'id':'curtain'})['devices'][0]
        assert observed['available'] and observed['telemetry']['position_percent']==75 and observed['telemetry']['movement']=='stop',observed
        assert api('/api/action',{'id':'curtain','action':'open'})['sent']
        print('PASS: native 3.4 handshake, nonce proof, session key, HMAC, read and write match TinyTuya.',flush=True)
        for mode in ('bad_proof','bad_hmac','bad_padding','rejected'):
            Sim.mode=mode;assert not api('/api/status',{'id':'curtain'})['devices'][0]['available']
            before=len(Sim.calls)
            try:api('/api/action',{'id':'curtain','action':'open'});raise AssertionError('Invalid authentication accepted')
            except urllib.error.HTTPError as e:assert e.code==400;e.close()
            assert len(Sim.calls)-before==(0 if mode=='bad_proof' else 1),'Actuation was retried'
        print('PASS: bad proof/HMAC/padding and rejection fail without command retries.',flush=True)
        # Modern UDP packet, independently encoded by TinyTuya GCM.
        Sim.mode='normal';udpkey=hashlib.md5(b'yGAdlopoPVldABfn').digest()
        discovered='eb00000000000000udp34'
        api('/api/configure',{'id':'curtain','adapter':'tuya','config':{**cfg,'ip':'','device_id':discovered,'auto_discover':True}})
        message=TuyaMessage(1,0x23,None,json.dumps({'gwId':discovered,'version':'3.4'}).encode(),0,prefix=0x6699,iv=os.urandom(12))
        packet=pack_message(message,hmac_key=udpkey)
        with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as sender:
            sender.bind((host,0));sender.sendto(packet,(central.split('://')[1].split(':')[0],7000))
        found=api('/api/discover/tuya',{})['devices']
        assert any(d['device_id']==discovered and d['ip']==host and d['version']=='3.4' for d in found),found
        observed=next(d for d in api('/api/devices')['devices'] if d['id']=='curtain')
        assert observed['config']['ip']==host
        # A different valid JSON with a broken tag must not replace the known IP/version.
        packet=pack_message(message._replace(payload=json.dumps({'gwId':discovered,'version':'3.3'}).encode(),iv=os.urandom(12)),hmac_key=udpkey)
        packet=packet[:-20]+bytes([packet[-20]^1])+packet[-19:]
        with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as sender:sender.sendto(packet,(central.split('://')[1].split(':')[0],7000))
        observed=next(d for d in api('/api/devices')['devices'] if d['id']=='curtain');assert observed['config']['version']=='3.4'
        print('PASS: 6699 GCM discovery resolves configured device ID; bad tag rejected.',flush=True)
    finally:
        try:
            api('/api/configure',{'id':'curtain','name':curtain['name'],'room':curtain['room'],'adapter':'pending','config':curtain['config']})
            restored=api('/api/devices')['devices'];assert [d for d in restored if d['id']!='curtain']==baseline
            print('PASS: pending curtain restored; all other controls preserved.',flush=True)
        finally:server.shutdown();server.server_close();thread.join()

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--central',required=True);parser.add_argument('--host',required=True);args=parser.parse_args();run(args.central.rstrip('/'),args.host)
