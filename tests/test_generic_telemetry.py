import base64
import json
import tempfile
import unittest
from unittest.mock import Mock, patch

from casa.controller import Controller, DeviceError
from casa.generic_remote import GenericRemotes
from casa.ir_catalog import CatalogFlow, profile
from casa.store import Store
from casa.telemetry import homeassistant, tuya


class GenericTelemetryTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.c=Controller(Store(self.tmp.name));self.remotes=GenericRemotes(self.c);self.flow=CatalogFlow(self.c)
        self.c.configure('broadlink',{'adapter':'broadlink','config':{'ip':'192.168.1.101','mac':'001122334455','devtype':'0x279d'}})

    def tearDown(self):self.tmp.cleanup()

    def create(self,type_='tv'):
        return self.remotes.create({'type':type_,'name':'Meu aparelho','room':'Sala'})

    def test_templates_do_not_invent_ir_codes_and_unconfigured_slot_cannot_send(self):
        for type_ in ['tv','climate','projector','fan','audio','other']:
            remote=self.create(type_)
            self.assertEqual(remote['actions'],[])
            with patch.object(self.c,'_broadlink') as transport:
                with self.assertRaises(DeviceError):self.c.execute(remote['id'],'power')
                transport.assert_not_called()

    def test_mapping_binds_test_to_exact_code_and_preserves_other_slots(self):
        remote=self.create();id_=remote['id'];data=profile('media_player_1060');commands=list(data['commands'])[:2]
        for slot,command in zip(['power_on','power_off'],commands):
            with patch.object(self.c,'_broadlink',return_value=Mock()):tested=self.flow.test(data['id'],command)
            payload={'id':id_,'button_id':slot,'profile_id':data['id'],'command':commands[1] if command==commands[0] else commands[0],'test_id':tested['test_id'],'confirmed':True}
            with self.assertRaises(DeviceError):self.remotes.map_catalog(payload,self.flow)
            payload['command']=command;self.remotes.map_catalog(payload,self.flow)
        saved=self.c.store.get(id_)
        self.assertEqual(set(saved['config']['commands']),{'power_on','power_off'})
        self.remotes.clear_button(id_,'power_on')
        self.assertEqual(self.c.store.get(id_)['config']['commands'],{'power_off':data['commands'][commands[1]]})
        self.assertEqual(self.c.store.get('broadlink')['config']['commands'],{})

    def test_learning_configures_one_slot_without_marking_physical_response(self):
        remote=self.create('projector');id_=remote['id']
        self.c.store.put_ir_button(id_,'power_on',base64.b64encode(b'\x26\x00\x02\x00\x0d\x05').decode())
        packet=b'\x26\x00\x04\x00\x20\x30\x0d\x05'
        fake=Mock(check_data=Mock(return_value=packet))
        with patch.object(self.c,'_broadlink',return_value=fake),patch('casa.controller.time.sleep'):
            self.c.learn(id_,'focus_up')
        saved=self.c.store.get(id_)
        self.assertEqual(set(saved['config']['commands']),{'power_on','focus_up'})
        self.assertFalse(saved['generic_remote']['sources']['focus_up']['confirmed'])
        with self.assertRaises(DeviceError):self.c.learn(id_,'nonexistent_slot')

    def test_custom_button_keeps_identity_when_renamed(self):
        remote=self.create('other');added=self.remotes.add_button(remote['id'],'HDMI 2');slot=added['generic_remote']['buttons'][-1]['id']
        renamed=self.remotes.rename_button(remote['id'],slot,'Entrada da sala')
        self.assertEqual(renamed['generic_remote']['buttons'][-1]['id'],slot)
        self.assertEqual(renamed['generic_remote']['buttons'][-1]['label'],'Entrada da sala')

    def test_actual_telemetry_distinguishes_measured_target_and_cover_position(self):
        readings=homeassistant({'attributes':{'current_temperature':25.2,'temperature':22,'temperature_unit':'°C','current_position':45,'battery_level':90,'hvac_action':'cooling','token':'do-not-publish'}})
        self.assertEqual(readings['temperature'],25.2);self.assertEqual(readings['target_temperature'],22);self.assertEqual(readings['position_percent'],45)
        self.assertNotIn('token',readings)
        self.assertEqual(homeassistant({'attributes':{'current_temperature':float('nan'),'temperature':True,'current_position':150}}),{})
        self.assertEqual(tuya({'dps':{'2':251,'3':22,'4':60}},{'temperature_dp':2,'temperature_divisor':10,'position_dp':4}),{'temperature':25.1,'temperature_unit':'°C','position_percent':60})
        self.assertEqual(tuya({'dps':{'1':253,'2':657}},{'temperature_dp':1,'temperature_divisor':10,'humidity_dp':2,'humidity_divisor':10}),{'temperature':25.3,'temperature_unit':'°C','humidity_percent':65.7})
        self.assertEqual(tuya({'dps':{'2':True}},{'humidity_dp':2}),{})
        self.assertEqual(tuya({'dps':{'2':101}},{'humidity_dp':2}),{})

    def test_feedback_reports_real_state_and_hides_token_without_copying_it_to_new_remote(self):
        remote=self.create('climate');id_=remote['id']
        self.c.configure(id_,{'config':{'feedback_url':'http://homeassistant.local:8123','feedback_entity':'climate.ar','feedback_token':'owner-feedback-token'}})
        with patch.object(self.c,'_broadlink',return_value=Mock()),patch('casa.controller.read_json',return_value={'state':'cool','attributes':{'current_temperature':25,'temperature':22}}):
            actual=self.c.status(id_)
        self.assertEqual(actual['state'],'cool');self.assertEqual(actual['telemetry']['temperature'],25)
        self.assertNotIn('owner-feedback-token',json.dumps(actual))
        self.assertNotIn('feedback_entity',self.create('climate')['config'])
        with patch.object(self.c,'_broadlink',return_value=Mock()),patch('casa.controller.read_json',side_effect=DeviceError('offline')):
            failed=self.c.status(id_)
        self.assertEqual(failed['state'],'unknown');self.assertEqual(failed['telemetry'],{})

    def test_ir_without_feedback_never_claims_device_is_on_or_temperature_known(self):
        remote=self.create('climate')
        with patch.object(self.c,'_broadlink',return_value=Mock()):actual=self.c.status(remote['id'])
        self.assertEqual(actual['state'],'unknown');self.assertNotIn('telemetry',actual)

    def test_tv_uses_explicit_power_reading_but_never_infers_off_from_failure(self):
        self.c.configure('tv',{'adapter':'samsung','config':{'ip':'192.168.1.104','port':8002}})
        with patch('casa.controller.read_json',return_value={'device':{'PowerState':'standby'}}):
            self.assertEqual(self.c.status('tv')['state'],'standby')
        with patch('casa.controller.read_json',return_value={'device':{}}):
            self.assertEqual(self.c.status('tv')['state'],'unknown')
        with patch('casa.controller.read_json',side_effect=DeviceError('network error')):
            self.assertEqual(self.c.status('tv')['state'],'unavailable')
