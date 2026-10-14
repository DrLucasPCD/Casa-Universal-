"""Prepare the ESP filesystem. The generated directory includes private data."""
import gzip
import hashlib
import json
import shutil
import ssl
import subprocess
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from casa.store import Store
from casa.generic_remote import TEMPLATES


def build():
    target = ROOT / 'firmware/esp32/data'
    target.mkdir(parents=True, exist_ok=True, mode=0o700)
    target.chmod(0o700)
    for name in ('index.html','app.js','visuals.js','style.css','sw.js','manifest.webmanifest','icon.svg',
                 'apple-touch-icon.png','icon-192.png','icon-512.png'):
        raw=(ROOT/'static'/name).read_bytes()
        if name=='app.js':
            text=raw.decode().replace('Mac','ESP32').replace('Ponte no ESP32','Central ESP32')
            raw=text.encode()
        (target / (name+'.gz')).write_bytes(gzip.compress(raw,mtime=0))
    for name in ('index.json','LICENSE-SmartIR.txt'):
        shutil.copyfile(ROOT/'catalog'/name,target/('catalog-'+name))
    profiles=target/'profiles';profiles.mkdir(exist_ok=True)
    largest=0
    for source in (ROOT/'catalog/profiles').glob('*.json'):
        data=json.loads(source.read_text());data['actions']=list(data['commands'])
        raw=json.dumps(data,ensure_ascii=False,separators=(',',':')).encode()
        largest=max(largest,len(raw))
        (profiles/(source.stem+'.json.gz')).write_bytes(gzip.compress(raw,mtime=0))
    (target/'templates.json').write_text(json.dumps({'templates':TEMPLATES},ensure_ascii=False))
    tools=subprocess.check_output(['node','--input-type=module','-e','import {TOOL_CATALOG} from "./netlify/lib/bridge.mjs"; process.stdout.write(JSON.stringify({tools:TOOL_CATALOG}));'],cwd=ROOT)
    (target/'mcp-tools.json.gz').write_bytes(gzip.compress(tools,mtime=0))
    store=Store();devices=store.devices()
    cert=ROOT/'data/esp32/tv-cert.pem'
    if cert.exists():
        pin=hashlib.sha256(ssl.PEM_cert_to_DER_cert(cert.read_text())).hexdigest()
        for d in devices:
            if d['adapter']=='samsung':d['config']['tls_pin']=pin
    (target/'state.json').write_text(json.dumps({'devices':devices},ensure_ascii=False,separators=(',',':')))
    (target/'state.json').chmod(0o600)
    if store.setting('firebase_uid') and store.setting('firebase_refresh_token'):
        cloud=json.loads((ROOT/'firebase/config.json').read_text())
        cloud.update(uid=store.setting('firebase_uid'),refresh_token=store.setting('firebase_refresh_token'))
        path=target/'cloud.json';path.write_text(json.dumps(cloud));path.chmod(0o600)
    print(f'ESP32: {len(devices)} cadastros; {len(list(profiles.glob("*.gz")))} perfis; '
          f'{sum(p.stat().st_size for p in target.rglob("*") if p.is_file())} bytes; maior perfil {largest} bytes.')
    print('Credenciais presentes somente no diretório privado de gravação, ignorado pelo Git.')


if __name__=='__main__':build()
