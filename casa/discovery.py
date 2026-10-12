"""Bounded local discovery; no pairing reset, credentials or actuator commands."""
import json
import re
import socket
import subprocess
import sys
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from .controller import Controller, DeviceError, private_ip
from .store import ROOT

_locks = {name: threading.Lock() for name in ("samsung", "broadlink", "tuya", "sonoff", "bluetooth")}


def probe_samsung(ip):
    try:
        ip = private_ip(ip)
        request = urllib.request.Request(f"http://{ip}:8001/api/v2/")
        # Do not follow a device's redirect to a different address.
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args, **kwargs):
                return None
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        with opener.open(request, timeout=2) as response:
            data = json.loads(response.read(65_536))
        d = data.get("device", {})
        if not isinstance(d, dict) or "samsung" not in str(d.get("type", "")).lower() or "tv" not in str(d.get("type", "")).lower():
            return None
        mac = re.sub("[:-]", "", str(d.get("wifiMac", "")))
        return {"ip": ip, "name": str(d.get("name", "TV Samsung"))[:100], "model": str(d.get("modelName", ""))[:100],
                "mac": mac.lower() if re.fullmatch(r"[a-fA-F0-9]{12}", mac) else "", "port": 8002}
    except (OSError, ValueError, TypeError, AttributeError):
        return None


def samsung():
    candidates = set()
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP) as sock:
        sock.settimeout(0.4)
        sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 2)
        sock.bind(("", 0))
        for target in ("urn:samsung.com:device:RemoteControlReceiver:1", "ssdp:all"):
            request = f'M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: {target}\r\n\r\n'
            sock.sendto(request.encode(), ("239.255.255.250", 1900))
        deadline = time.monotonic() + 4
        while time.monotonic() < deadline and len(candidates) < 32:
            try:
                _, address = sock.recvfrom(8192)
                candidates.add(private_ip(address[0]))
            except socket.timeout:
                continue
            except DeviceError:
                continue
    # Probe a previously configured TV too: some TVs stop replying to multicast.
    for device in Controller().store.devices():
        if device["adapter"] == "samsung":
            candidates.add(device["config"]["ip"])
    with ThreadPoolExecutor(max_workers=8) as pool:
        return [d for d in pool.map(probe_samsung, sorted(candidates)) if d]


def tuya():
    import tinytuya
    found = tinytuya.deviceScan(verbose=False, maxretry=6, color=False, poll=False, forcescan=False)
    curtain_mac = Controller().store.get("curtain")["config"].get("mac", "").lower().replace(":", "").replace("-", "")
    macs = {}
    if sys.platform == "darwin":
        result = subprocess.run(["/usr/sbin/arp", "-an"], capture_output=True, text=True, timeout=3)
        for ip, mac in re.findall(r"\((\d+\.\d+\.\d+\.\d+)\) at ([0-9a-f:]+)", result.stdout, re.I):
            parts = mac.split(":")
            if len(parts) == 6:
                macs[ip] = "".join(p.zfill(2) for p in parts).lower()
    devices = []
    for ip, d in found.items():
        try:
            ip = private_ip(ip)
        except DeviceError:
            continue
        devices.append({"ip": ip, "device_id": str(d.get("gwId", d.get("id", "")))[:80],
                        "version": str(d.get("version", "3.3"))[:10], "mac": macs.get(ip, ""),
                        "likely_curtain": bool(curtain_mac) and macs.get(ip) == curtain_mac})
    return devices


def bluetooth():
    # CoreBluetooth can terminate a process when macOS permissions are missing.
    # Isolate it so a permission failure cannot stop the house-control server.
    process = subprocess.run([sys.executable, "-m", "casa.bluetooth_worker"], cwd=ROOT, capture_output=True, text=True, timeout=18)
    if process.returncode:
        raise DeviceError("Bluetooth indisponível. Ligue o Bluetooth e permita o acesso para Terminal/Codex em Ajustes do Sistema → Privacidade e Segurança → Bluetooth. Aproxime o Mac da fechadura.")
    try:
        result = json.loads(process.stdout)
        if result.get("error"):
            raise DeviceError(result["error"])
        return result["devices"]
    except (ValueError, KeyError):
        raise DeviceError("A busca Bluetooth não retornou uma lista válida.") from None


def discover(provider):
    if provider not in _locks:
        raise DeviceError("Escolha Samsung, BroadLink, Tuya, Sonoff ou Bluetooth.")
    if not _locks[provider].acquire(blocking=False):
        raise DeviceError("Esta busca já está em andamento. Aguarde o resultado.")
    try:
        if provider == "broadlink":
            return Controller().discover_broadlink()
        if provider == "sonoff":
            from .sonoff import discover as sonoff
            return sonoff()
        return {"samsung": samsung, "tuya": tuya, "bluetooth": bluetooth}[provider]()
    finally:
        _locks[provider].release()
