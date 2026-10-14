"""Update public UI over USB, preserving the ESP32's state and Firebase identity."""
import argparse
import base64
import gzip
import hashlib
import json
import subprocess
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT))
from casa.esp32_setup import USB
from casa.generic_remote import TEMPLATES

ASSETS=('index.html','app.js','style.css','sw.js','manifest.webmanifest','icon.svg',
        'apple-touch-icon.png','icon-192.png','icon-512.png','templates.json','mcp-tools.json','catalog-index.json','profiles/climate_3000.json')

def update(usb):
    for name in ASSETS:
        if name=='templates.json':raw=json.dumps({'templates':TEMPLATES},ensure_ascii=False).encode()
        elif name=='mcp-tools.json':raw=subprocess.check_output(['node','--input-type=module','-e','import {TOOL_CATALOG} from "./netlify/lib/bridge.mjs"; process.stdout.write(JSON.stringify({tools:TOOL_CATALOG}));'],cwd=ROOT)
        elif name=='catalog-index.json':raw=(ROOT/'catalog/index.json').read_bytes()
        elif name.startswith('profiles/'):
            data=json.loads((ROOT/'catalog'/name).read_text());data['actions']=list(data['commands']);raw=json.dumps(data,ensure_ascii=False,separators=(',',':')).encode()
        else:raw=(ROOT/'static'/name).read_bytes()
        if name=='app.js':raw=raw.decode().replace('Mac','ESP32').replace('Ponte no ESP32','Central ESP32').encode()
        data=gzip.compress(raw,mtime=0)
        usb.request({'op':'asset_begin','name':name+'.gz','size':len(data),
                     'sha256':hashlib.sha256(data).hexdigest()})
        for offset in range(0,len(data),2048):
            usb.request({'op':'asset_chunk','offset':offset,
                         'data':base64.b64encode(data[offset:offset+2048]).decode()})
        usb.request({'op':'asset_finish'})
        print(f'{name}: atualizado e hash verificado.',flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--port',default='/dev/cu.usbmodem101')
    usb=USB(parser.parse_args().port)
    try:update(usb)
    finally:usb.serial.close()
