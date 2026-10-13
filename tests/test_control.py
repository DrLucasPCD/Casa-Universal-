import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from unittest.mock import Mock, PropertyMock, patch

from casa.controller import Controller, DeviceError
from casa.server import CasaServer, Handler
from casa.sonoff import decrypt_data, encrypt_payload
from casa.store import Store


class ControllerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = Store(self.tmp.name)
        self.c = Controller(self.store)

    def tearDown(self):
        self.tmp.cleanup()

    def ha(self, id_, entity):
        self.c.configure(id_, {"adapter": "homeassistant", "config": {"url": "http://homeassistant.local:8123", "entity_id": entity, "token": "private-ha-token"}})

    def test_unconfigured_device_never_sends(self):
        with patch('casa.controller.read_json') as network:
            with self.assertRaises(DeviceError):
                self.c.execute('tv', 'power')
            network.assert_not_called()

    def test_samsung_pairing_saves_token_and_reuses_authorized_session(self):
        self.c.configure('tv',{'adapter':'samsung','config':{'ip':'192.168.1.50','port':8002}})
        session=Mock(identity=('192.168.1.50',8002,'owner-token'))
        session.tv.token='owner-token';session.alive.return_value=True
        def factory(cfg,save_token,timeout):
            save_token('owner-token')
            return session
        with patch('casa.samsung.TVSession',side_effect=factory) as create:
            self.assertTrue(self.c.pair_samsung('tv')['paired'])
            session.send_key.assert_not_called()
            self.c.execute('tv','volume_up')
            self.c.execute('tv','volume_down')
            self.assertEqual(create.call_count,1)
            session.close.assert_not_called()
        self.assertEqual(self.store.get('tv')['config']['token'],'owner-token')
        self.assertNotIn('owner-token',json.dumps(self.c.devices()))

    def test_public_ip_rejected(self):
        with self.assertRaises(DeviceError):
            self.c.configure('tv', {'adapter':'samsung', 'config':{'ip':'203.0.113.219'}})

    def samsung(self):
        self.c.configure('tv', {'adapter':'samsung','config':{'ip':'192.168.1.50','token':'test-token','mac':'c8a6ef84e6e2'}})

    def test_samsung_explicit_power_uses_observed_state_and_standard_key(self):
        self.samsung();session=Mock()
        with patch('casa.controller.read_json', return_value={'device':{'PowerState':'standby'}}), patch.object(self.c,'_samsung_session',return_value=session):
            self.assertTrue(self.c.execute('tv','power_on')['sent'])
            session.send_key.assert_called_once_with('KEY_POWER')
        session.reset_mock()
        with patch('casa.controller.read_json', return_value={'device':{'PowerState':'on'}}), patch.object(self.c,'_samsung_session',return_value=session):
            self.assertTrue(self.c.execute('tv','power_off')['sent'])
            session.send_key.assert_called_once_with('KEY_POWER')

    def test_samsung_already_in_requested_state_never_toggles(self):
        self.samsung()
        for action,state in [('power_on','on'),('power_off','standby'),('power_off','off')]:
            with patch('casa.controller.read_json',return_value={'device':{'PowerState':state}}), patch.object(self.c,'_samsung_session') as session:
                self.assertFalse(self.c.execute('tv',action)['sent']);session.assert_not_called()

    def test_samsung_unknown_or_unreachable_off_never_toggles(self):
        self.samsung()
        for response in ({'device':{}}, DeviceError('unreachable')):
            with patch('casa.controller.read_json',side_effect=response if isinstance(response,Exception) else None,return_value=response), patch.object(self.c,'_samsung_session') as session:
                with self.assertRaises(DeviceError):self.c.execute('tv','power_off')
                session.assert_not_called()

    def test_samsung_unreachable_on_uses_wol_without_delayed_toggle(self):
        self.samsung()
        with patch('casa.controller.read_json',side_effect=DeviceError('unreachable')), patch('casa.controller.socket.socket') as udp, patch.object(self.c,'_samsung_session') as session:
            self.assertTrue(self.c.execute('tv','power_on')['sent'])
            udp.return_value.__enter__.return_value.sendto.assert_called_once_with(b'\xff'*6+bytes.fromhex('c8a6ef84e6e2')*16,('255.255.255.255',9))
            session.assert_not_called()

    def test_secrets_hidden_and_blank_keeps_saved_secret(self):
        self.ha('tuya', 'switch.tomada')
        public = self.c.devices()
        self.assertNotIn('private-ha-token', json.dumps(public))
        self.c.configure('tuya', {'config': {'token': ''}, 'name': 'Tomada'})
        self.assertEqual(self.store.get('tuya')['config']['token'], 'private-ha-token')
        self.assertEqual(self.store.path.stat().st_mode & 0o777, 0o600)

    def test_service_mapping_and_target_for_cover(self):
        self.ha('curtain', 'cover.cortina')
        with patch('casa.controller.read_json', return_value=[]) as network:
            result = self.c.execute('curtain', 'close')
        self.assertTrue(result['sent'])
        network.assert_called_once_with('http://homeassistant.local:8123/api/services/cover/close_cover', data={'entity_id':'cover.cortina'}, token='private-ha-token')

    def test_no_arbitrary_home_assistant_service(self):
        self.ha('tuya', 'switch.tomada')
        with patch('casa.controller.read_json') as network:
            with self.assertRaises(DeviceError):self.c.execute('tuya', 'delete')
            network.assert_not_called()

    def test_unlock_requires_panel_confirmation_and_token_is_single_use(self):
        self.ha('lock', 'lock.porta')
        with patch('casa.controller.read_json', return_value=[]) as network:
            with self.assertRaises(DeviceError):self.c.execute('lock', 'unlock')
            with self.assertRaises(DeviceError):self.c.execute('lock', 'unlock', source='panel')
            token=self.c.confirmation('lock')
            self.c.execute('lock', 'unlock', source='panel', confirmation=token)
            with self.assertRaises(DeviceError):self.c.execute('lock', 'unlock', source='panel', confirmation=token)
            network.assert_called_once()

    def test_network_failure_does_not_report_success(self):
        self.ha('tuya', 'switch.tomada')
        with patch('casa.controller.read_json', side_effect=DeviceError('Sem conexão')):
            with self.assertRaises(DeviceError):self.c.execute('tuya', 'on')
            self.assertEqual(self.c.status('tuya')['state'], 'unavailable')
        self.assertEqual(self.store.history()[0]['result'], 'error')

    def test_tuya_explicit_false_is_off_not_unavailable(self):
        self.c.configure('tuya', {'adapter':'tuya','config':{'ip':'192.168.1.52','device_id':'my-device-id','local_key':'1234567890123456','version':3.3,'dp':1}})
        with patch.object(self.c, '_tuya', return_value=Mock(status=Mock(return_value={'dps':{'1':False}}))):
            self.assertEqual(self.c.status('tuya')['state'], 'off')
        with patch.object(self.c, '_tuya', return_value=Mock(status=Mock(return_value={'Error':'invalid key'}))):
            self.assertFalse(self.c.status('tuya')['available'])

    def test_cover_sends_configured_enum_and_observes_response(self):
        import tinytuya
        self.c.configure('curtain', {'adapter':'tuya','config':{'ip':'192.168.1.57','device_id':'curtain-id','local_key':'1234567890123456','dp':1,'cover_type':7}})
        cover=Mock(COVER_TYPES=tinytuya.CoverDevice.COVER_TYPES)
        cover.set_value.return_value={'dps':{'1':'down'}}
        with patch.object(self.c,'_tuya',return_value=cover):
            self.assertTrue(self.c.execute('curtain','close')['sent'])
            cover.set_value.assert_called_once_with(1,'down')
            cover.set_value.return_value={'Error':'key rejected'}
            with self.assertRaises(DeviceError):self.c.execute('curtain','close')

    def test_sonoff_encrypted_payload_and_channel_target(self):
        key='owner-device-key-for-testing'
        self.c.configure('sonoff_tx3c', {'adapter':'sonoff_lan','config':{'ip':'192.168.1.55','device_id':'1000abcdef','device_key':key,'channels':3}})
        with patch('casa.controller.read_json', return_value={'error':0}) as network:
            self.c.execute('sonoff_tx3c','on_2')
        args=network.call_args.args
        self.assertEqual(args[0], 'http://192.168.1.55:8081/zeroconf/switches')
        self.assertTrue(args[1]['encrypt'])
        self.assertEqual(decrypt_data(args[1]['data'],args[1]['iv'],key),{'switches':[{'outlet':1,'switch':'on'}]})
        self.assertNotIn(key,json.dumps(self.c.devices()))

    def test_sonoff_unsupported_state_does_not_invent_state(self):
        self.c.configure('sonoff', {'adapter':'sonoff_lan','config':{'ip':'192.168.1.56','device_id':'1000abcdef','device_key':'owner-device-key-for-testing'}})
        with patch('casa.controller.read_json', return_value={'error':400}):
            self.assertEqual(self.c.status('sonoff')['state'],'unknown')
            with self.assertRaises(DeviceError):self.c.execute('sonoff','on')


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.server=CasaServer(('127.0.0.1',0),Controller(Store(self.tmp.name)))
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.base=f'http://127.0.0.1:{self.server.server_port}'

    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join();self.tmp.cleanup()

    def request(self,path,data=None,**headers):
        if data is not None:headers={'Content-Type':'application/json','Origin':self.base,**headers}
        req=urllib.request.Request(self.base+path,data=None if data is None else json.dumps(data).encode(),headers=headers)
        return urllib.request.urlopen(req,timeout=5)

    def test_devices_open_without_code_or_cookie_on_mac_and_lan(self):
        with self.request('/api/devices') as r:self.assertEqual(len(json.load(r)['devices']),8)
        with patch.object(Handler, 'local', new_callable=PropertyMock, return_value=False):
            with self.request('/api/devices') as r:self.assertEqual(len(json.load(r)['devices']),8)
            with self.request('/api/network') as r:self.assertFalse(json.load(r)['local'])

    def test_lan_actions_work_without_code_and_configuration_stays_local(self):
        with patch.object(Handler, 'local', new_callable=PropertyMock, return_value=False), patch.object(self.server.controller, 'execute', return_value={'sent':True}) as execute:
            with self.request('/api/action',{'id':'tuya','action':'on'}) as r:self.assertTrue(json.load(r)['sent'])
            execute.assert_called_once_with('tuya','on',source='panel',confirmation='')
            with self.assertRaises(urllib.error.HTTPError) as ctx:self.request('/api/configure',{'id':'tuya'})
            self.assertEqual(ctx.exception.code,403)

    def test_cross_origin_action_blocked(self):
        with patch.object(self.server.controller, 'execute') as execute:
            with self.assertRaises(urllib.error.HTTPError) as ctx:self.request('/api/action',{'id':'tuya','action':'on'},Origin='https://evil.example')
            execute.assert_not_called()
        self.assertEqual(ctx.exception.code,403)

    def test_access_code_routes_removed(self):
        for path,data in [('/api/access',None),('/api/login',{}),('/api/local-session',{})]:
            with self.subTest(path=path):
                with self.assertRaises(urllib.error.HTTPError) as ctx:self.request(path,data)
                self.assertEqual(ctx.exception.code,404)

    def test_dns_rebinding_host_blocked(self):
        with self.assertRaises(urllib.error.HTTPError) as ctx:self.request('/api/session',Host=f'evil.example:{self.server.server_port}')
        self.assertEqual(ctx.exception.code,403)

    def test_only_fixed_static_assets_are_served(self):
        with self.assertRaises(urllib.error.HTTPError) as ctx:self.request('/data/casa.sqlite3')
        self.assertEqual(ctx.exception.code,404)
        with self.request('/app.js') as r:self.assertEqual(r.status,200)


if __name__=='__main__':unittest.main()
