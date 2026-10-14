import base64
import json
import tempfile
import unittest
from unittest.mock import patch

from casa.cloud_data import digest,serialize
from casa.firestore import FirestoreSync,ResponseError,document,decode_document
from casa.store import Store


class FirestoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.store=Store(self.tmp.name)
        self.store.set_setting('firebase_uid','test-owner')
        self.store.set_setting('firebase_refresh_token','private-refresh')
        self.cloud=FirestoreSync(self.store,{'apiKey':'test-key','projectId':'test-project'})
        self.cloud.token='test-token';self.cloud.expires=10**12
    def tearDown(self):self.tmp.cleanup()

    def network(self,url,method='GET',data=None,token=None,**kwargs):
        if token is None:raise ResponseError(403,'PERMISSION_DENIED')
        if method=='PATCH':return data
        return {'documents':[]}

    def test_secret_exclusion_round_trip_and_restart_persistence(self):
        d=self.store.get('tv');d['config']={'token':'private-tv-token','local_key':'private-key','device_key':'private-sonoff','feedback_token':'private-ha','ip':'192.168.1.4','commands':{'power':'JgAGAAECAwQ='}}
        self.store.save(d);row=next(r for r in self.store.cloud_pending() if r['id']=='tv')
        decoded=decode_document(document(row));raw=json.dumps(decoded)
        for secret in ('private-tv-token','private-key','private-sonoff','private-ha','private-refresh'):self.assertNotIn(secret,raw)
        self.assertEqual(decoded['config']['commands']['power'],'JgAGAAECAwQ=')
        with patch('casa.firestore.request_json',side_effect=self.network):self.assertEqual(self.cloud.sync_once()['phase'],'synced')
        reopened=Store(self.tmp.name)
        self.assertEqual(reopened.cloud_pending(),[])
        self.assertEqual(reopened.get('tv')['config']['token'],'private-tv-token')

    def test_open_rules_never_upload_and_offline_keeps_pending(self):
        with patch('casa.firestore.request_json',return_value={'documents':[]}) as network:
            self.assertEqual(self.cloud.sync_once()['phase'],'pending')
            self.assertEqual(network.call_count,1)
            self.assertEqual(network.call_args.kwargs,{})
        count=len(self.store.cloud_pending())
        with patch('casa.firestore.request_json',side_effect=ResponseError(503,'UNAVAILABLE')):
            self.cloud.sync_once()
        self.assertEqual(len(self.store.cloud_pending()),count)
        with patch('casa.firestore.request_json',side_effect=self.network):self.cloud.sync_once()
        self.assertEqual(self.store.cloud_pending(),[])

    def test_ack_preserves_concurrent_change_and_inflight_reversal(self):
        initial=next(r for r in self.store.cloud_pending() if r['id']=='tv');self.store.cloud_ack(initial)
        d=self.store.get('tv');d['name']='TV alterada';self.store.save(d)
        inflight=next(r for r in self.store.cloud_pending() if r['id']=='tv')
        d['name']='TV nova';self.store.save(d);self.store.cloud_ack(inflight)
        row=next(r for r in self.store.cloud_pending() if r['id']=='tv');self.assertEqual(json.loads(row['payload'])['name'],'TV nova')
        # A change can also be reverted while its previous value is being uploaded.
        d['name']=json.loads(inflight['payload'])['name'];self.store.save(d)
        d['name']=json.loads(row['payload'])['name'];self.store.save(d)
        self.store.cloud_ack(inflight)
        self.assertEqual(json.loads(next(r for r in self.store.cloud_pending() if r['id']=='tv')['payload'])['name'],'TV nova')
        current=next(r for r in self.store.cloud_pending() if r['id']=='tv');self.store.cloud_ack(current)
        d['name']='Mudança em trânsito';self.store.save(d)
        transient=next(r for r in self.store.cloud_pending() if r['id']=='tv')
        d['name']='TV nova';self.store.save(d)
        self.assertFalse(any(r['id']=='tv' for r in self.store.cloud_pending()))
        self.store.cloud_ack(transient)
        self.assertEqual(json.loads(next(r for r in self.store.cloud_pending() if r['id']=='tv')['payload'])['name'],'TV nova')

    def test_restore_missing_ir_buttons_never_imports_cloud_network_credentials(self):
        d={'id':'ir_123456abcdef','name':'TV IR','room':'Sala','kind':'remote','adapter':'broadlink','config':{'ip':'8.8.8.8','mac':'deadbeef','token':'evil','commands':{'power':base64.b64encode(b'\x26\x00\x06\x00\x01\x02').decode()}},'ir_profile':{'category':'media_player'}}
        payload=serialize(d);doc=document({'payload':payload,'hash':digest(payload)});doc['name']='projects/test/databases/(default)/documents/casas/test-owner/controles/'+d['id']
        self.cloud.restore_missing([doc]);saved=self.store.get(d['id'])
        self.assertEqual(set(saved['config']),{'parent_id','commands'})
        self.assertEqual(saved['config']['parent_id'],'broadlink')
        saved['name']='Nome local';self.store.save(saved);self.cloud.restore_missing([doc])
        self.assertEqual(self.store.get(d['id'])['name'],'Nome local')

    def test_secret_only_change_does_not_queue_cloud_write(self):
        row=next(r for r in self.store.cloud_pending() if r['id']=='tv');self.store.cloud_ack(row)
        self.store.update_config('tv',{'token':'new-secret'})
        self.assertFalse(any(r['id']=='tv' for r in self.store.cloud_pending()))

    def test_climate_preset_and_rf_survive_restore_and_invalid_preset_is_rejected(self):
        d={'id':'generic_123456abcdef','name':'Ar aprendido','room':'Sala','kind':'remote','adapter':'broadlink','config':{'commands':{'cool_auto_stop_24':base64.b64encode(b'\xd7\0\x02\0\x01\x02').decode()}},'generic_remote':{'type':'climate','buttons':[{'id':'cool_auto_stop_24','label':'24 °C','section':'Meus ajustes','preset':{'temperature':24,'mode':'cool','fan':'auto','swing':'stop'}}]}}
        def cloud_doc(device):
            payload=serialize(device);doc=document({'payload':payload,'hash':digest(payload)});doc['name']='projects/test/databases/(default)/documents/casas/test-owner/controles/'+device['id'];return doc
        self.cloud.restore_missing([cloud_doc(d)])
        self.assertEqual(self.store.get(d['id'])['generic_remote']['buttons'][0]['preset']['temperature'],24)
        d['id']='generic_abcdef123456';d['generic_remote']['buttons'][0]['preset']['temperature']=True
        from casa.firestore import CloudError
        with self.assertRaises(CloudError):self.cloud.restore_missing([cloud_doc(d)])
