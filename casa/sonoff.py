"""Authenticated local eWeLink transport; protocol cross-checked with SonoffLAN.

Original implementation. Requires the owner's device key, never a vendor app secret.
"""
import base64
import hashlib
import json
import os
import threading
import time

from cryptography.hazmat.primitives import padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes


def encrypt_payload(data, device_id, device_key):
    raw = json.dumps(data, separators=(",", ":")).encode()
    key = hashlib.md5(device_key.encode()).digest()
    iv = os.urandom(16)
    padder = padding.PKCS7(128).padder()
    padded = padder.update(raw) + padder.finalize()
    cipher = Cipher(algorithms.AES(key), modes.CBC(iv)).encryptor()
    encrypted = cipher.update(padded) + cipher.finalize()
    return {"deviceid": device_id, "sequence": str(time.time_ns() // 1_000_000), "selfApikey": "123", "encrypt": True, "iv": base64.b64encode(iv).decode(), "data": base64.b64encode(encrypted).decode()}


def decrypt_data(data, iv, device_key):
    key = hashlib.md5(device_key.encode()).digest()
    decryptor = Cipher(algorithms.AES(key), modes.CBC(base64.b64decode(iv, validate=True))).decryptor()
    padded = decryptor.update(base64.b64decode(data, validate=True)) + decryptor.finalize()
    unpadder = padding.PKCS7(128).unpadder()
    return json.loads(unpadder.update(padded) + unpadder.finalize())


def discover(timeout=4):
    from zeroconf import ServiceBrowser, Zeroconf
    found = {}
    guard = threading.Lock()

    class Listener:
        def add_service(self, zc, type_, name):
            self.update_service(zc, type_, name)

        def update_service(self, zc, type_, name):
            info = zc.get_service_info(type_, name, timeout=1500)
            if not info:
                return
            props = {k.decode(errors="replace"): v.decode(errors="replace") if isinstance(v, bytes) else v for k, v in info.properties.items()}
            addresses = info.parsed_addresses()
            if not addresses:
                return
            item = {"device_id": props.get("id", ""), "ip": addresses[0], "port": info.port, "type": props.get("type", ""), "encrypted": props.get("encrypt") == "true"}
            with guard:
                found[name] = item

        def remove_service(self, *args):
            pass

    zc = Zeroconf()
    browser = ServiceBrowser(zc, "_ewelink._tcp.local.", Listener())
    try:
        time.sleep(timeout)
        with guard:
            return list(found.values())
    finally:
        browser.cancel()
        zc.close()
