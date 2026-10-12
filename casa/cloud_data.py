"""Portable control configuration. Device credentials and live states never leave the bridge."""
import hashlib
import json

CONFIG_FIELDS = {
    'ip','mac','port','devtype','commands','parent_id','device_id','version','dp','cover_type',
    'temperature_dp','target_temperature_dp','position_dp','temperature_divisor','temperature_unit',
    'channels','diy_confirmed','bluetooth_id','bluetooth_name','url','entity_id','remote_device',
    'feedback_url','feedback_entity','feedback_enabled',
}


def portable(device):
    result = {k:device[k] for k in ('id','name','room','kind','adapter')}
    result['config'] = {k:v for k,v in device.get('config',{}).items() if k in CONFIG_FIELDS}
    for key in ('generic_remote','ir_profile'):
        if key in device:result[key] = device[key]
    return result


def serialize(device):
    return json.dumps(portable(device),ensure_ascii=False,sort_keys=True,separators=(',',':'))


def digest(payload):
    return hashlib.sha256(payload.encode()).hexdigest()
