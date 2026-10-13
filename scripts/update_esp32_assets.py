"""Update public UI over USB, preserving the ESP32's state and Firebase identity."""
import argparse
import base64
import gzip
import hashlib
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT))
from casa.esp32_setup import USB

ASSETS=('index.html','app.js','style.css','sw.js','manifest.webmanifest','icon.svg',
        'apple-touch-icon.png','icon-192.png','icon-512.png')

def update(usb):
    for name in ASSETS:
        raw=(ROOT/'static'/name).read_bytes()
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
