import base64
import io
import json
import tempfile
import unittest
from unittest.mock import Mock, patch

from casa.controller import Controller, DeviceError
from casa.discovery import probe_samsung
from casa.ir_catalog import CatalogFlow, index, profile
from casa.store import Store


class CatalogDiscoveryTests(unittest.TestCase):
    def test_samsung_discovery_validates_device_type_and_uses_local_ip(self):
        opener=Mock()
        opener.open.return_value=io.BytesIO(json.dumps({'device':{'type':'Samsung SmartTV','name':'Tv','modelName':'UN50DU8000GXZD','wifiMac':'c8:a6:ef:84:e6:e2'}}).encode())
        with patch('casa.discovery.urllib.request.build_opener',return_value=opener):
            found=probe_samsung('192.168.1.104')
            self.assertEqual(found['model'],'UN50DU8000GXZD')
            self.assertEqual(found['mac'],'c8a6ef84e6e2')
            self.assertIsNone(probe_samsung('203.0.113.219'))
            self.assertEqual(opener.open.call_count,1)

    def test_catalog_contains_only_bounded_ir_packets(self):
        for entry in index()['profiles']:
            data=profile(entry['id'])
            self.assertIsInstance(data['models'],list)
            for encoded in data['commands'].values():
                packet=base64.b64decode(encoded,validate=True)
                self.assertEqual(packet[0],0x26)
                self.assertLessEqual(len(packet),4096)
        with self.assertRaises(DeviceError):profile('../../data/casa')

    def test_test_then_confirm_saves_separate_remote_and_tracks_parent(self):
        with tempfile.TemporaryDirectory() as directory:
            c=Controller(Store(directory));flow=CatalogFlow(c)
            c.configure('broadlink',{'adapter':'broadlink','config':{'ip':'192.168.1.101','mac':'001122334455','devtype':'0x279d'}})
            id_='media_player_1060';data=profile(id_);command=next(iter(data['commands']))
            payload={'profile_id':id_,'confirmed':True,'name':'TV IR','room':'Sala'}
            with self.assertRaises(DeviceError):flow.save(payload)
            remote=Mock()
            with patch.object(c,'_broadlink',return_value=remote):
                result=flow.test(id_,command)
                remote.send_data.assert_called_once_with(base64.b64decode(data['commands'][command]))
            payload['test_id']=result['test_id'];saved=flow.save(payload)
            self.assertTrue(saved['id'].startswith('ir_'))
            self.assertEqual(saved['config']['parent_id'],'broadlink')
            self.assertEqual(c.store.get('broadlink')['config']['commands'],{})
            with self.assertRaises(DeviceError):flow.save(payload)
            c.configure('broadlink',{'config':{'ip':'192.168.1.120'}})
            with patch('broadlink.gendevice',return_value=Mock(auth=Mock(return_value=True))) as factory:
                c._broadlink(c.store.get(saved['id']))
                self.assertEqual(factory.call_args.args[1][0],'192.168.1.120')
