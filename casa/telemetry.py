"""Only publish typed readings explicitly supplied by a device/integration."""
import math


def number(value, minimum, maximum):
    if isinstance(value,bool):return None
    if not isinstance(value,(int,float)) or not math.isfinite(value) or not minimum<=value<=maximum:return None
    return value


def homeassistant(result):
    attrs=result.get("attributes",{})
    if not isinstance(attrs,dict):return {}
    values={}
    for source,target,low,high in [("current_temperature","temperature",-100,200),("temperature","target_temperature",-100,200),("current_position","position_percent",0,100),("battery_level","battery_percent",0,100),("current_humidity","humidity_percent",0,100)]:
        value=number(attrs.get(source),low,high)
        if value is not None:values[target]=value
    unit=attrs.get("temperature_unit",attrs.get("unit_of_measurement"))
    if unit in ("°C","°F","C","F"):values["temperature_unit"]=unit
    action=attrs.get("hvac_action")
    if action in ("off","idle","heating","cooling","drying","fan"):values["activity"]=action
    return values


def tuya(result,cfg):
    values={};dps=result.get("dps",{})
    if not isinstance(dps,dict):return values
    for field,target,low,high in [("temperature_dp","temperature",-100,200),("target_temperature_dp","target_temperature",-100,200),("position_dp","position_percent",0,100),("humidity_dp","humidity_percent",0,100)]:
        if cfg.get(field):
            value=dps.get(str(cfg[field]))
            if isinstance(value,(int,float)) and not isinstance(value,bool) and "temperature" in field:
                value=value/float(cfg.get("temperature_divisor",1))
            elif field=='humidity_dp' and isinstance(value,(int,float)) and not isinstance(value,bool):
                value=value/float(cfg.get('humidity_divisor',1))
            value=number(value,low,high)
            if value is not None:values[target]=value
    if "temperature" in values or "target_temperature" in values:
        values["temperature_unit"]=cfg.get("temperature_unit","°C")
    return values
