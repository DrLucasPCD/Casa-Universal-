import http.client
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from casa.esp32_setup import Server


class FakeUSB:
    def __init__(self):
        self.calls = []

    def request(self, payload):
        self.calls.append(payload)
        if payload['op'] == 'wifi':
            return {'ok': True}
        return {'ok': True, 'wifi_connected': False, 'access_key': 'test-only-code',
                'ap_password': 'test-only-ap-password', 'ip': '0.0.0.0', 'devices': 9}


class ESPSetupTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root_patch = patch('casa.esp32_setup.ROOT', Path(self.directory.name))
        self.root_patch.start()
        self.usb = FakeUSB()
        self.server = Server(0, self.usb)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.server.server_port

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.root_patch.stop()
        self.directory.cleanup()

    def request(self, method, path, payload=None, headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.port)
        body = json.dumps(payload) if payload is not None else None
        connection.request(method, path, body, headers or {})
        response = connection.getresponse()
        status, value = response.status, response.read()
        connection.close()
        return status, json.loads(value)

    def test_rebinding_host_cannot_read_code(self):
        status, data = self.request('GET', '/info', headers={'Host': 'evil.example'})
        self.assertEqual(status, 403)
        self.assertNotIn('access_key', data)
        self.assertEqual(self.usb.calls, [])

    def test_external_origin_cannot_change_wifi(self):
        status, _ = self.request('POST', '/wifi', {'ssid': 'test', 'password': 'test'},
                                {'Origin': 'https://evil.example', 'Content-Type': 'application/json'})
        self.assertEqual(status, 403)
        self.assertEqual(self.usb.calls, [])

    def test_external_origin_cannot_import_ewelink_credentials(self):
        with patch.object(self.server.sonoff,'connect') as cloud:
            status,_=self.request('POST','/sonoff/connect',{'username':'owner','password':'private'},
                {'Origin':'https://evil.example','Content-Type':'application/json'})
            self.assertEqual(status,403);cloud.assert_not_called()

    def test_external_origin_cannot_import_tuya_credentials(self):
        with patch.object(self.server.tuya,'connect') as cloud:
            status,_=self.request('POST','/tuya/connect',{'client_id':'owner','secret':'private'},
                {'Origin':'https://evil.example','Content-Type':'application/json'})
            self.assertEqual(status,403);cloud.assert_not_called()

    def test_valid_wifi_is_sent_only_to_usb_without_echo(self):
        payload = {'ssid': 'Rede teste', 'password': 'test-only-password'}
        status, data = self.request('POST', '/wifi', payload,
                                   {'Origin': f'http://127.0.0.1:{self.port}', 'Content-Type': 'application/json'})
        self.assertEqual(status, 200)
        self.assertEqual(data, {'ok': True})
        self.assertEqual(self.usb.calls, [{'op': 'wifi', **payload}])
        self.assertFalse((Path(self.directory.name) / 'data').exists())

    def test_utf8_ssid_byte_limit(self):
        status, _ = self.request('POST', '/wifi', {'ssid': 'é' * 17, 'password': ''},
                                {'Origin': f'http://127.0.0.1:{self.port}', 'Content-Type': 'application/json'})
        self.assertEqual(status, 400)
        self.assertEqual(self.usb.calls, [])

    def test_diagnostics_keep_private_file_and_hide_ap_password(self):
        status, data = self.request('GET', '/info')
        self.assertEqual(status, 200)
        self.assertNotIn('ap_password', data)
        self.assertEqual(data['access_key'], 'test-only-code')
        path = Path(self.directory.name) / 'data/esp32/connection.json'
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertIn('ap_password', json.loads(path.read_text()))


if __name__ == '__main__':
    unittest.main()
