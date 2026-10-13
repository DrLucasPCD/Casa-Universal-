import hashlib
import hmac
import json
import time
import unittest
from unittest.mock import Mock, patch
from casa.tuya_setup import TuyaSetup, fetch_devices, signature, model_mapping

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
    def test_extra_targets_register_once_before_configuring_and_sensor_has_readings(self):
        self.imported()
        self.setup.save({'target':'tuya_sensor','device_id':DEVICE,'ip':'192.168.68.116','temperature_dp':3,'humidity_dp':4,'temperature_divisor':10})
        calls=[c.args[0] for c in self.usb.request.call_args_list]
        self.assertEqual(calls[-2],{'op':'add_tuya','id':'tuya_sensor'})
        self.assertEqual(calls[-1]['config']['humidity_dp'],4)
        self.assertEqual(calls[-1]['config']['temperature_divisor'],10)
        with self.assertRaises(ValueError):self.setup.save({'target':'tuya_sensor','device_id':DEVICE,'ip':'192.168.68.116','humidity_divisor':0})
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
    def test_offline_sensor_key_saved_without_guessed_ip_and_later_auto_discovered(self):
        self.imported()
        self.setup.save({'target':'tuya_sensor','device_id':DEVICE,'ip':''})
        cfg=self.usb.request.call_args.args[0]['config']
        self.assertEqual(cfg['ip'],'');self.assertTrue(cfg['auto_discover']);self.assertEqual(cfg['local_key'],KEY)
        with self.assertRaises(ValueError):self.setup.save({'target':'tuya','device_id':DEVICE,'ip':''})
        self.assertNotIn(KEY,json.dumps(self.setup.public_records()))
    def test_inspect_only_reads_status_filters_bad_metrics_and_closes_socket(self):
        self.imported()
        with patch('tinytuya.OutletDevice') as factory:
            device=factory.return_value;device.status.return_value={'dps':{'1':False,'2':float('nan'),'bad':KEY}}
            result=self.setup.inspect({'device_id':DEVICE,'ip':'192.168.68.116','version':'3.4'})
            self.assertEqual(result['dps'],{'1':False});self.assertNotIn(KEY,json.dumps(result))
            device.set_dpsUsed.assert_called_once_with({'1':None});device.status.assert_called_once();device.close.assert_called_once()
            device.set_status.assert_not_called();device.set_value.assert_not_called()
            for bad in ({'ip':'8.8.8.8'},{'dps':[True]},{'dps':[256]}):
                with self.assertRaises(ValueError):self.setup.inspect({'device_id':DEVICE,'ip':'192.168.68.116',**bad})
    def test_three_four_and_specs_survive_public_import_without_keys(self):
        self.usb.request.return_value={'devices':[{'device_id':DEVICE,'ip':'192.168.68.112','version':'3.4'}]}
        mapping=[{'dp_id':1,'code':'control','type':'Enum','values':'{"range":["open","stop","close"]}'}]
        with patch('casa.tuya_setup.fetch_devices',return_value=[{'id':DEVICE,'local_key':KEY,'name':'Cortina','dp_mapping':mapping}]):
            public=self.setup.connect(self.payload)
        self.assertEqual(public['devices'][0]['dp_mapping'],mapping)
        self.setup.save({'target':'curtain','device_id':DEVICE,'ip':'192.168.68.112'})
        self.assertEqual(self.usb.request.call_args.args[0]['config']['version'],'3.4')
    def test_model_ids_do_not_use_array_order_or_control_target_as_measured_position(self):
        properties=[{'abilityId':101,'code':'va_temperature','typeSpec':{'type':'value','scale':1}},
                    {'abilityId':2,'code':'percent_control','typeSpec':{'type':'value'}},
                    {'abilityId':True,'code':'bad'},{'abilityId':256,'code':'bad'}]
        mapped=model_mapping({'model':json.dumps({'services':[{'properties':properties}]})})
        self.assertEqual([(d['dp_id'],d['code']) for d in mapped],[(101,'va_temperature'),(2,'percent_control')])
        self.assertEqual(model_mapping({'model':'invalid'}),[])

if __name__=='__main__':unittest.main()
