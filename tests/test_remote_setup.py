import hashlib
import json
import tempfile
import threading
import unittest
import urllib.error
import http.client
from pathlib import Path
from unittest.mock import patch

from casa.esp32_setup import Server
from casa.remote_setup import prepare


class FakeUSB:
    def __init__(self): self.calls=[]
    def request(self,payload): self.calls.append(payload);return {'ok':True}


class RemoteSetupTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.directory=Path(self.tmp.name)
        self.patch=patch('casa.remote_setup.DIRECTORY',self.directory);self.patch.start()
        self.setup_patch=patch('casa.esp32_setup.DIRECTORY',self.directory);self.setup_patch.start()
        self.usb=FakeUSB();self.server=Server(0,self.usb)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.port=self.server.server_port
    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join()
        self.patch.stop();self.setup_patch.stop();self.tmp.cleanup()
    def post(self,path,origin=None):
        connection=http.client.HTTPConnection('127.0.0.1',self.port)
        connection.request('POST',path,'{}',{'Origin':origin or f'http://127.0.0.1:{self.port}','Content-Type':'application/json'})
        response=connection.getresponse();value=json.loads(response.read());status=response.status;connection.close();return status,value
    def test_credentials_are_private_stable_and_pairing_key_is_not_in_env(self):
        first=prepare();second=prepare();self.assertEqual(first,second)
        for name in ('remote-private.json','netlify.env'):self.assertEqual((self.directory/name).stat().st_mode&0o777,0o600)
        env=(self.directory/'netlify.env').read_text()
        self.assertNotIn(first['pairing_key'],env)
        self.assertIn(hashlib.sha256(first['pairing_key'].encode()).hexdigest(),env)
        self.assertEqual(len(set(first[key] for key in ('token','oauth_secret','pairing_key'))),3)
    def test_external_site_cannot_prepare_or_activate_bridge(self):
        for path in ('/remote/prepare','/remote/enable','/remote/disable'):
            self.assertEqual(self.post(path,'https://evil.example')[0],403)
        self.assertEqual(self.usb.calls,[]);self.assertEqual(list(self.directory.iterdir()),[])
    def test_cloud_credentials_must_be_confirmed_before_activating_esp32(self):
        with patch('casa.esp32_setup.urllib.request.urlopen',side_effect=urllib.error.URLError('test offline')):
            status,data=self.post('/remote/enable')
        self.assertEqual(status,409);self.assertEqual(self.usb.calls,[])
        self.assertNotIn(prepare()['token'],json.dumps(data))
    def test_disabling_bridge_leaves_wifi_and_device_configuration_untouched(self):
        status,_=self.post('/remote/disable')
        self.assertEqual(status,200);self.assertEqual(self.usb.calls,[{'op':'remote','enabled':False}])


if __name__=='__main__':unittest.main()
