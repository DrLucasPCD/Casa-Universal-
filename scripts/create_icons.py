"""Generate simple original home glyph icons, without third-party graphics dependencies."""
import math
import struct
import zlib
from pathlib import Path


def distance(x, y, a, b):
    vx, vy = b[0]-a[0], b[1]-a[1]
    t = max(0, min(1, ((x-a[0])*vx+(y-a[1])*vy)/(vx*vx+vy*vy)))
    return math.hypot(x-a[0]-t*vx, y-a[1]-t*vy)


def write_icon(path, size):
    bg, fg, accent = (25, 30, 31), (216, 200, 173), (163, 182, 159)
    lines = [((140,248),(140,385)),((140,385),(372,385)),((372,385),(372,248)),((372,248),(256,142)),((256,142),(140,248)),((224,385),(224,286)),((288,286),(288,385))]
    raw = bytearray()
    for iy in range(size):
        raw.append(0)
        for ix in range(size):
            x,y=(ix+.5)*512/size,(iy+.5)*512/size
            color=bg
            if min(distance(x,y,a,b) for a,b in lines)<9 or (y<=286 and abs(math.hypot(x-256,y-286)-32)<8):color=fg
            if math.hypot(x-289,y-147)<14:color=accent
            raw.extend(color)
    def chunk(name,data):return struct.pack('!I',len(data))+name+data+struct.pack('!I',zlib.crc32(name+data))
    png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!2I5B',size,size,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(raw))+chunk(b'IEND',b'')
    path.write_bytes(png)


if __name__ == '__main__':
    root=Path(__file__).resolve().parent.parent/'static'
    for filename,size in [('apple-touch-icon.png',180),('icon-192.png',192),('icon-512.png',512)]:write_icon(root/filename,size)
