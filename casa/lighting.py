"""Typed HSV12 Tuya light settings. A setting never implies measured power."""
import colorsys
import math
import re
from .controller import DeviceError

def decode_hsv(raw):
    if not isinstance(raw,str) or not re.fullmatch(r'[0-9a-fA-F]{12}',raw):raise DeviceError('Valor HSV12 da luz inválido.')
    h,s,v=(int(raw[i:i+4],16) for i in (0,4,8))
    if h>360 or s>1000 or v>1000:raise DeviceError('Valor HSV12 fora do intervalo.')
    return h,s,v

def readings(raw,mode=None):
    try:h,s,v=decode_hsv(raw)
    except DeviceError:return {}
    rgb=colorsys.hsv_to_rgb(h/360,s/1000,1)
    result={'brightness_percent':v/10,'color_hue':h,'color_saturation':s/10,'color_hex':'#'+''.join(f'{round(n*255):02x}' for n in rgb)}
    if mode in ('colour','white','scene','music'):result['light_mode']=mode
    return result

def light_values(raw,params):
    if not any(k in params for k in ('color','brightness','hue','saturation')):raise DeviceError('Informe cor ou intensidade.')
    if 'color' in params and any(k in params for k in ('hue','saturation')):raise DeviceError('Escolha HEX ou matiz/saturação.')
    for k,maximum in (('brightness',100),('hue',360),('saturation',100)):
        if k in params and (isinstance(params[k],bool) or not isinstance(params[k],(int,float)) or not math.isfinite(params[k]) or not 0<=params[k]<=maximum):raise DeviceError('Ajuste de luz fora do intervalo.')
    color=params.get('color')
    if 'color' in params and (not isinstance(color,str) or not re.fullmatch(r'#[0-9a-fA-F]{6}',color)):raise DeviceError('Use cor #RRGGBB.')
    mode=params.get('mode','colour')
    if mode not in ('colour','white','scene','music'):raise DeviceError('Modo da luz inválido.')
    h,s,v=decode_hsv(raw)
    if color:
        hue,sat,_=colorsys.rgb_to_hsv(*(int(color[i:i+2],16)/255 for i in (1,3,5)))
        h,s=round(hue*360),round(sat*1000)
    if 'hue' in params:h=round(params['hue'])
    if 'saturation' in params:s=round(params['saturation']*10)
    if 'brightness' in params:v=round(params['brightness']*10)
    if color=='#000000':v=0
    return mode,f'{h:04x}{s:04x}{v:04x}'
