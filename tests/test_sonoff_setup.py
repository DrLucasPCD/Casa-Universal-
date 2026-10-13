import asyncio
import json
import unittest
from unittest.mock import AsyncMock, Mock, patch

from casa.sonoff_setup import SafeAPI, SonoffSetup, fetch_devices

KEY='owner-key-for-test-only'
RECORD={'deviceid':'1000casa00','devicekey':KEY,'name':'TX três',
        'params':{'switches':[{'outlet':i,'switch':'off'} for i in range(3)]}}

class SonoffSetupTests(unittest.TestCase):
    def setUp(self):
        self.usb=Mock();self.usb.request.return_value={'devices':[{'device_id':'1000casa00','ip':'192.168.1.44','port':8081}]}
        self.setup=SonoffSetup(self.usb)

    def connect(self):
        with patch('casa.sonoff_setup.fetch_devices',new=AsyncMock(return_value=[RECORD])):
            return self.setup.connect({'username':'owner@example.test','password':'password-test-only','country':'+55','consent':True})

    def test_explicit_consent_before_login(self):
        with patch('casa.sonoff_setup.fetch_devices',new=AsyncMock()) as cloud:
            with self.assertRaises(ValueError):self.setup.connect({'username':'owner','password':'test'})
            cloud.assert_not_called();self.usb.request.assert_not_called()

    def test_public_response_excludes_keys_and_login_credentials(self):
        public=json.dumps(self.connect())
        for value in (KEY,'password-test-only','owner@example.test'):self.assertNotIn(value,public)
        self.assertEqual(self.setup.records['1000casa00']['channels'],3)
        self.assertFalse(hasattr(self.setup,'password'))

    def test_key_sent_only_to_selected_usb_device(self):
        self.connect();self.usb.reset_mock()
        public=self.setup.save({'device_id':'1000casa00','target':'sonoff_tx3c','ip':'192.168.1.44'})
        self.usb.request.assert_called_once_with({'op':'configure','id':'sonoff_tx3c','adapter':'sonoff_lan',
            'config':{'device_id':'1000casa00','device_key':KEY,'channels':3,'ip':'192.168.1.44','port':8081}})
        self.assertNotIn(KEY,json.dumps(public))

    def test_expired_cache_and_public_ip_cannot_send_keys(self):
        self.connect();self.usb.reset_mock()
        with self.assertRaises(ValueError):self.setup.save({'device_id':'1000casa00','target':'sonoff','ip':'8.8.8.8'})
        self.setup.expires=0
        with self.assertRaises(ValueError):self.setup.save({'device_id':'1000casa00','target':'sonoff','ip':'192.168.1.44'})
        self.assertEqual(self.setup.records,{});self.usb.request.assert_not_called()

    def test_other_devices_are_not_reconfigured(self):
        self.connect();self.usb.reset_mock()
        with self.assertRaises(ValueError):self.setup.save({'device_id':'1000casa00','target':'tv','ip':'192.168.1.44'})
        self.usb.request.assert_not_called()

    def test_cloud_errors_do_not_echo_password(self):
        with patch('casa.sonoff_setup.fetch_devices',new=AsyncMock(side_effect=ValueError(KEY))):
            with self.assertRaises(ValueError) as error:self.setup.connect({'username':'owner','password':'password-test-only','country':'+55','consent':True})
        self.assertNotIn(KEY,str(error.exception));self.assertEqual(self.setup.records,{})

    def test_upstream_client_login_and_all_homes_then_discards_token(self):
        registry=Mock(auth={'at':'account-test-only'},login=AsyncMock(),get_homes=AsyncMock(return_value={'h1':'Casa','h2':'Outra'}),get_devices=AsyncMock(return_value=[RECORD]))
        with patch('casa.sonoff_setup.XRegistryCloud',return_value=registry):
            result=asyncio.run(fetch_devices('owner','password-test-only','+55'))
        self.assertEqual(result,[RECORD]);registry.login.assert_awaited_once_with('owner','password-test-only','+55')
        registry.get_devices.assert_awaited_once_with(['h1','h2']);self.assertIsNone(registry.auth)

    def test_upstream_adapter_blocks_redirect_destinations_and_actuator_api(self):
        session=Mock();api=SafeAPI(session)
        for url in ('http://us-apia.coolkit.cc/v2/user/login','https://evil.example/v2/user/login','https://us-apia.coolkit.cc/v2/device/thing/status','https://us-apia.coolkit.cc@evil.example/v2/user/login'):
            with self.assertRaises(ValueError):asyncio.run(api.get(url))
        session.request.assert_not_called()
