"""Only scans advertisements. Does not connect, pair, read keys, write GATT or unlock."""
import asyncio
import json


async def scan():
    from bleak import BleakScanner
    found = await BleakScanner.discover(timeout=8, return_adv=True)
    devices = []
    for device, adv in found.values():
        name = adv.local_name or device.name or "Bluetooth sem nome"
        services = [str(s).lower() for s in adv.service_uuids]
        # FFE0 is observed in HAHA, but is also used by unrelated BLE hardware.
        candidate = any("0000ffe0-" in s for s in services) or any(s in name.lower() for s in ("haha", "lock", "fechadura", "lck1", "lck2"))
        devices.append({"identifier": device.address, "name": name[:100], "rssi": adv.rssi,
                        "services": services[:20], "lock_candidate": candidate})
    return sorted(devices, key=lambda d: (not d["lock_candidate"], -d["rssi"]))


if __name__ == "__main__":
    try:
        print(json.dumps({"devices": asyncio.run(scan())}))
    except Exception:
        print(json.dumps({"error": "Sem acesso ao Bluetooth. Confira a permissão do macOS, aproxime o Mac e acorde a fechadura. Feche o HAHA Lock durante a busca, se ele estiver conectado à fechadura."}))
