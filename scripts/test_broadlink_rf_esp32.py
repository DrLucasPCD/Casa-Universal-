"""Independent python-broadlink crypto oracle; all signals go to a Mac simulator.

Temporarily redirects the public BroadLink connection, restores it in finally,
and refuses to overwrite the reserved test button or an active learned signal.
"""
import argparse
import json
import socketserver
import struct
import threading
import urllib.request
import urllib.error
import broadlink

SESSION=bytes(range(16));RF=b'\xd7\0\x02\0\x0d\x05';IR=b'\x26\0\x02\0\x0d\x05';BUTTON='rf_oracle_test'

class Sim(socketserver.BaseRequestHandler):
    calls=[];transport='rf';frequency_checks=0;packet_checks=0;bad_checksum=False
    def handle(self):
        packet,sock=self.request;assert len(packet)>=56
        expected=int.from_bytes(packet[32:34],'little');check=bytearray(packet);check[32:34]=b'\0\0';assert (sum(check)+0xbeaf)&0xffff==expected
        kind=int.from_bytes(packet[38:40],'little');device=broadlink.gendevice(0x279d,('127.0.0.1',80),bytes.fromhex('001122334455'))
        if kind!=0x65:device.update_aes(SESSION)
        payload=device.decrypt(packet[56:]);assert (sum(payload)+0xbeaf)&0xffff==int.from_bytes(packet[52:54],'little')
        error=0
        if kind==0x65:
            raw=struct.pack('<I',1)+SESSION
        else:
            cmd=struct.unpack('<I',payload[:4])[0];self.calls.append((cmd,payload[4:]));raw=struct.pack('<I',cmd)
            if cmd==0x19:self.frequency_checks=0;self.__class__.frequency_checks=0;self.__class__.transport='rf';self.__class__.packet_checks=0
            elif cmd==3:self.__class__.transport='ir';self.__class__.packet_checks=0
            elif cmd==0x1a:
                self.__class__.frequency_checks+=1;raw+=bytes([self.frequency_checks>1])+struct.pack('<I',433920)
            elif cmd==4:
                self.__class__.packet_checks+=1
                if self.packet_checks==1:error=0xfff6
                else:raw+=RF if self.transport=='rf' else IR
            elif cmd==2:assert payload[4:10] in (RF,IR)
            else:assert cmd in (0x1b,0x1e)
        raw+=bytes((-len(raw))%16);reply=bytearray(packet[:56]);reply[32:34]=b'\0\0';reply[34:36]=struct.pack('<H',error);reply[52:54]=struct.pack('<H',(sum(raw)+0xbeaf)&0xffff);reply.extend(device.encrypt(raw));
        if self.bad_checksum:reply[52]^=1
        reply[32:34]=struct.pack('<H',(sum(reply)+0xbeaf)&0xffff);sock.sendto(reply,self.client_address)

class UDP(socketserver.ThreadingUDPServer):allow_reuse_address=True;daemon_threads=True

def run(central,host):
    def api(path,p=None):
        req=urllib.request.Request(central+path,data=json.dumps(p).encode() if p is not None else None,headers={'Origin':central,'Content-Type':'application/json'})
        try:
            with urllib.request.urlopen(req,timeout=35) as r:return json.load(r)
        except urllib.error.HTTPError as e:
            print(path, e.read().decode(),flush=True)
            raise
    original=next(d for d in api('/api/devices')['devices'] if d['id']=='broadlink')
    assert not original['config']['commands'].get(BUTTON),'Reserved test button already exists.'
    server=UDP(('0.0.0.0',80),Sim);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start();saved=False;session=None
    try:
        api('/api/configure',{'id':'broadlink','adapter':'broadlink','config':{'ip':host,'mac':'001122334455','devtype':0x279d}})
        assert api('/api/status',{'id':'broadlink'})['devices'][0]['available'],'Fresh authentication failed'
        for transport in ('rf','ir'):
            started=api('/api/learn/start',{'id':'broadlink','name':BUTTON,'transport':transport});session=started['session_id']
            for _ in range(8):
                result=api('/api/learn/poll',{'session_id':session})
                if result['phase']=='saved':saved=True;session=None;break
            else:raise AssertionError('Capture did not finish')
            assert api('/api/action',{'id':'broadlink','action':BUTTON})['sent']
            assert any(cmd==2 and raw[:6]==(RF if transport=='rf' else IR) for cmd,raw in Sim.calls)
            api('/api/remotes/clear-button',{'id':'broadlink','button_id':BUTTON});saved=False
        assert all(cmd in (3,4,0x19,0x1a,0x1b,0x1e,2) for cmd,_ in Sim.calls)
        print('PASS: ESP32 RF frequency/capture, IR capture, waiting status and single send match python-broadlink.',flush=True)
        Sim.bad_checksum=True;assert not api('/api/status',{'id':'broadlink'})['devices'][0]['available'];Sim.bad_checksum=False
        print('PASS: corrupted decrypted payload checksum is rejected.',flush=True)
        before=len(Sim.calls)
        try:api('/api/learn/start',{'id':'broadlink','name':BUTTON,'transport':'bluetooth'});raise AssertionError('Invalid transport accepted')
        except urllib.error.HTTPError as e:assert e.code==400;e.close()
        assert len(Sim.calls)==before
    finally:
        try:
            if session:
                try:api('/api/learn/cancel',{'session_id':session})
                except urllib.error.HTTPError:pass # A failed poll already invalidates its nonce.
            if saved:api('/api/remotes/clear-button',{'id':'broadlink','button_id':BUTTON})
            api('/api/configure',{'id':'broadlink','adapter':'broadlink','config':original['config']})
            restored=next(d for d in api('/api/devices')['devices'] if d['id']=='broadlink')
            assert restored==original
            print('PASS: BroadLink connection and saved buttons restored; no real signal sent.',flush=True)
        finally:server.shutdown();server.server_close();thread.join()

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--central',required=True);p.add_argument('--host',required=True);a=p.parse_args();run(a.central.rstrip('/'),a.host)
