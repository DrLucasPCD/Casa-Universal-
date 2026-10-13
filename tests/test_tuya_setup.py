import hashlib
import hmac
import json
import time
import unittest
from unittest.mock import Mock, patch
from casa.tuya_setup import TuyaSetup, fetch_devices, signature

DEVICE='eb0000000000000000test';KEY='1234567890123456'

class TuyaSetupTests(unittest.TestCase):
    def setUp(self):
        self.usb=Mock();self.usb.request.return_value={'devices':[{'device_id':DEVICE,'ip':'192.168.68.116','version':'3.3'}]}
        self.setup=TuyaSetup(self.usb)
        self.payload={'client_id':'testclient','secret':'testsecret','region':'us','device_id':DEVICE,'consent':True}
    def tearDown(self):
        if self.setup.timer:self.setup.timer.cancel()
    def imported(self):
        with patch('casa.tuya_setup.fetch_devices',return_value=[{'id':DEVICE,'local_key':KEY,'name':'Tomada'}]):return self.setup.connect(self.payload)
    def test_import_hides_keys_and_only_sends_selected_key_over_usb(self):
        public=self.imported();self.assertNotIn(KEY,json.dumps(public));self.assertNotIn('secret',public)
        self.setup.save({'target':'tuya','device_id':DEVICE,'ip':'192.168.68.116','dp':1})
        call=self.usb.request.call_args.args[0]
        self.assertEqual(call['config']['local_key'],KEY);self.assertEqual(call['id'],'tuya');self.assertEqual(call['op'],'configure')
    def test_expiry_targets_public_ip_and_invalid_dp_are_rejected(self):
        self.imported()
        base={'target':'tuya','device_id':DEVICE,'ip':'192.168.68.116','dp':1}
        for invalid in ({'target':'lock'},{'ip':'187.21.13.219'},{'dp':True},{'dp':'1.5'},{'position_dp':256}):
            with self.assertRaises(ValueError):self.setup.save({**base,**invalid})
        self.setup.expires=time.monotonic()-1
        with self.assertRaises(ValueError):self.setup.save(base)
        self.assertEqual(self.setup.records,{})
    def test_consent_and_fixed_region_required_before_cloud(self):
        with patch('casa.tuya_setup.fetch_devices') as cloud:
            for extra in ({'consent':False},{'region':'evil.example'},{'device_id':'../../secret'}):
                with self.assertRaises(ValueError):self.setup.connect({**self.payload,**extra})
            cloud.assert_not_called()
    def test_cloud_is_read_only_no_redirect_and_does_not_echo_error_secrets(self):
        def response(value,status=200):
            m=Mock(status_code=status);m.__enter__=Mock(return_value=m);m.__exit__=Mock(return_value=False)
            m.iter_content.return_value=[json.dumps(value).encode()];return m
        values=[{'success':True,'result':{'access_token':'private-token'}},{'success':True,'result':{'uid':'user123'}},{'success':True,'result':[]}]
        with patch('requests.get',side_effect=[response(v) for v in values]) as get:
            self.assertEqual(fetch_devices('testclient','testsecret','us',DEVICE),[])
            self.assertEqual([c.args[0] for c in get.call_args_list],['https://openapi.tuyaus.com/v1.0/token?grant_type=1','https://openapi.tuyaus.com/v1.0/devices/'+DEVICE,'https://openapi.tuyaus.com/v1.0/users/user123/devices'])
            for call in get.call_args_list:
                self.assertFalse(call.kwargs['allow_redirects']);self.assertEqual(call.kwargs['timeout'],12);self.assertNotIn('secret',call.kwargs['headers'])
        with patch('requests.get',return_value=response({'success':False,'msg':'private-token testsecret'})):
            with self.assertRaises(ValueError) as error:fetch_devices('testclient','testsecret','us',DEVICE)
            self.assertNotIn('testsecret',str(error.exception));self.assertNotIn('private-token',str(error.exception))
    def test_signature_canonical_empty_body_and_token_are_included(self):
        path='/v1.0/token?grant_type=1';canonical='GET\n'+hashlib.sha256(b'').hexdigest()+'\n\n'+path
        expected=hmac.new(b'testsecret',('testclient1588925778000'+canonical).encode(),hashlib.sha256).hexdigest().upper()
        self.assertEqual(signature('testclient','testsecret','1588925778000',path),expected)
        self.assertNotEqual(signature('testclient','testsecret','1588925778000',path,'token'),expected)

if __name__=='__main__':unittest.main()
