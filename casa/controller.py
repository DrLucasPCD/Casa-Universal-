import base64
import hashlib
import hmac
import ipaddress
import json
import re
import secrets
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from .store import Store


class DeviceError(ValueError):
    pass


TV_KEYS = {
    "power": "KEY_POWER", "power_off": "KEY_POWEROFF", "up": "KEY_UP", "down": "KEY_DOWN",
    "left": "KEY_LEFT", "right": "KEY_RIGHT", "enter": "KEY_ENTER", "back": "KEY_RETURN",
    "home": "KEY_HOME", "volume_up": "KEY_VOLUP", "volume_down": "KEY_VOLDOWN", "mute": "KEY_MUTE",
    "channel_up": "KEY_CHUP", "channel_down": "KEY_CHDOWN", "source": "KEY_SOURCE",
    "play": "KEY_PLAY", "pause": "KEY_PAUSE",
}
SECRET_FIELDS = {"local_key", "token", "device_key", "feedback_token"}
FIELDS = {
    "pending": {"bluetooth_id", "bluetooth_name"},
    "samsung": {"ip", "port", "mac", "token"},
    "broadlink": {"ip", "mac", "devtype", "commands", "feedback_url", "feedback_entity", "feedback_token", "feedback_enabled"},
    "tuya": {"ip", "device_id", "local_key", "version", "dp", "cover_type", "temperature_dp", "target_temperature_dp", "position_dp", "temperature_divisor", "temperature_unit"},
    "sonoff_diy": {"ip", "port", "device_id", "diy_confirmed"},
    "sonoff_lan": {"ip", "port", "device_id", "device_key", "channels"},
    "homeassistant": {"url", "token", "entity_id", "commands", "remote_device"},
}


def private_ip(value):
    try:
        parsed = ipaddress.IPv4Address(value)
    except (ValueError, TypeError):
        raise DeviceError("Informe o endereço IPv4 local do dispositivo.") from None
    if not any(parsed in ipaddress.IPv4Network(block) for block in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")):
        raise DeviceError("Use o IP da rede de casa, como 192.168.1.50.")
    return str(parsed)


def read_json(url, data=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    request = urllib.request.Request(url, data=None if data is None else json.dumps(data).encode(), headers=headers)
    # Never forward credentials to a redirect or to an ambient proxy.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(request, timeout=6) as response:
            raw = response.read(2_000_001)
        if len(raw) > 2_000_000:
            raise DeviceError("Resposta maior que o limite do painel.")
        return json.loads(raw)
    except urllib.error.HTTPError as exc:
        raise DeviceError("A central recusou a solicitação. Confira a autenticação e a entidade." if exc.code in (401, 403) else "O serviço retornou erro HTTP.") from None
    except (OSError, ValueError):
        raise DeviceError("Sem resposta do dispositivo. Confira o IP, o Wi-Fi e as credenciais.") from None


class Controller:
    def __init__(self, store=None):
        self.store = store or Store()
        self.locks = {}
        self.lock_guard = threading.Lock()
        self.used_confirmations = set()
        self.tv_sessions = {}

    def device_lock(self, id_):
        with self.lock_guard:
            return self.locks.setdefault(id_, threading.RLock())

    def actions(self, device):
        adapter, kind, cfg = device["adapter"], device["kind"], device["config"]
        if adapter == "pending":
            return []
        if adapter == "samsung":
            return list(TV_KEYS) + (["power_on"] if cfg.get("mac") else [])
        if adapter == "broadlink":
            if device.get("generic_remote"):
                slots={b["id"] for b in device["generic_remote"]["buttons"]}
                return sorted(k for k in cfg.get("commands",{}) if k in slots)
            return sorted(cfg.get("commands", {}))
        if adapter == "sonoff_lan" and int(cfg.get("channels", 1)) > 1:
            return [f"{a}_{ch}" for ch in range(1, cfg["channels"] + 1) for a in ("on", "off")]
        if adapter == "tuya" and kind == "cover":
            return ["open", "close"] + ([] if cfg.get("cover_type", 1) in (2, 5) else ["stop"])
        if adapter in ("tuya", "sonoff_diy", "sonoff_lan"):
            return ["on", "off"]
        if adapter == "homeassistant":
            return {"switch": ["on", "off"], "light": ["on", "off"], "lock": ["lock", "unlock"],
                    "tv": ["power_on", "power_off", "volume_up", "volume_down", "play", "pause"],
                    "cover": ["open", "close", "stop"],
                    "remote": sorted(cfg.get("commands", {}))}.get(kind, [])
        return []

    def public(self, device):
        cfg = {k: v for k, v in device["config"].items() if k not in SECRET_FIELDS and k != "commands"}
        cfg["command_names"] = sorted(device["config"].get("commands", {}))
        cfg["has_secret"] = any(device["config"].get(k) for k in SECRET_FIELDS)
        return {**device, "config": cfg, "actions": self.actions(device), "state": "not_configured" if device["adapter"] == "pending" else "unknown", "available": False}

    def devices(self):
        return [self.public(d) for d in self.store.devices()]

    def configure(self, id_, payload):
        device = self.store.get(id_)
        adapter = payload.get("adapter", device["adapter"])
        if adapter not in FIELDS:
            raise DeviceError("Integração desconhecida.")
        kind = device["kind"]
        if (adapter == "samsung" and kind != "tv") or (adapter == "broadlink" and kind != "remote") or (adapter == "tuya" and kind not in ("switch", "cover")) or (adapter in ("sonoff_diy", "sonoff_lan") and kind != "switch"):
            raise DeviceError("Esta integração não corresponde ao tipo do dispositivo.")
        cfg = device["config"].copy() if device["adapter"] == adapter else {}
        supplied = payload.get("config", {})
        if not isinstance(supplied, dict) or set(supplied) - FIELDS[adapter]:
            raise DeviceError("Campos de configuração inválidos.")
        for key, value in supplied.items():
            if key in SECRET_FIELDS and value == "":
                continue
            cfg[key] = value
        if adapter == "pending" and cfg:
            if kind != "lock" or not re.fullmatch(r"[a-zA-Z0-9:-]{12,64}", str(cfg.get("bluetooth_id", ""))):
                raise DeviceError("Identificador Bluetooth inválido.")
            cfg["bluetooth_name"] = str(cfg.get("bluetooth_name", "Fechadura"))[:100]
        if adapter=="broadlink" and cfg.get("parent_id"):
            parent=self.store.get(cfg["parent_id"])
            for key in ("ip","mac","devtype"):
                if not cfg.get(key) and parent["config"].get(key):cfg[key]=parent["config"][key]
        if adapter in ("samsung", "broadlink", "tuya", "sonoff_diy", "sonoff_lan"):
            cfg["ip"] = private_ip(cfg.get("ip"))
        if adapter == "samsung":
            cfg["port"] = int(cfg.get("port", 8002))
            if cfg["port"] not in (8001, 8002):
                raise DeviceError("A Samsung utiliza a porta 8001 ou 8002.")
        if adapter in ("broadlink", "samsung") and cfg.get("mac"):
            mac = re.sub("[:-]", "", cfg["mac"])
            if not re.fullmatch("[a-fA-F0-9]{12}", mac):
                raise DeviceError("Endereço MAC inválido.")
            cfg["mac"] = mac.lower()
        if adapter == "broadlink":
            if not cfg.get("mac"):
                raise DeviceError("Informe o MAC do BroadLink.")
            cfg["devtype"] = int(str(cfg.get("devtype", "0x51da")), 0)
            cfg.setdefault("commands", {})
            if supplied.get("feedback_enabled") is False:
                for key in ("feedback_url","feedback_entity","feedback_token"):cfg.pop(key,None)
            if any(cfg.get(k) for k in ("feedback_url","feedback_entity","feedback_token")):
                url=urllib.parse.urlsplit(cfg.get("feedback_url",""))
                if url.scheme not in ("http","https") or not url.hostname or url.username or url.password or url.query or url.fragment or url.path not in ("","/"):
                    raise DeviceError("Informe a URL da central que reporta os estados.")
                if not re.fullmatch(r"(?:climate|media_player|switch|light|cover|lock)\.[a-z0-9_]+",cfg.get("feedback_entity","")) or not cfg.get("feedback_token"):
                    raise DeviceError("Informe uma entidade de estado e o token da sua central.")
                cfg["feedback_url"]=cfg["feedback_url"].rstrip("/")
        if adapter == "tuya":
            if not cfg.get("device_id") or len(cfg.get("local_key", "")) != 16:
                raise DeviceError("A Tuya precisa do device ID e da local key de 16 caracteres.")
            cfg["version"] = float(cfg.get("version", 3.3))
            if cfg["version"] not in (3.1, 3.2, 3.3, 3.4, 3.5):
                raise DeviceError("Versão de protocolo Tuya inválida.")
            cfg["dp"] = int(cfg.get("dp", 1))
            if not 1 <= cfg["dp"] <= 255:
                raise DeviceError("DP deve ficar entre 1 e 255.")
            for key in ("temperature_dp","target_temperature_dp","position_dp"):
                if cfg.get(key) not in (None,""):
                    cfg[key]=int(cfg[key])
                    if not 1<=cfg[key]<=255:raise DeviceError("DP de leitura deve ficar entre 1 e 255.")
                else:cfg.pop(key,None)
            cfg["temperature_divisor"]=float(cfg.get("temperature_divisor",1) or 1)
            if cfg["temperature_divisor"] not in (1,10,100):raise DeviceError("Divisor de temperatura deve ser 1, 10 ou 100.")
            cfg["temperature_unit"]=cfg.get("temperature_unit","°C")
            if cfg["temperature_unit"] not in ("°C","°F"):raise DeviceError("Use °C ou °F.")
            if kind == "cover":
                cfg["cover_type"] = int(cfg.get("cover_type", 1))
                if cfg["cover_type"] not in range(1, 9):
                    raise DeviceError("Selecione o tipo de comando da cortina (1 a 8).")
        if adapter == "sonoff_diy":
            if cfg.get("diy_confirmed") is not True:
                raise DeviceError("Confirme que este modelo já está em modo DIY. Para eWeLink padrão, use Home Assistant/SonoffLAN.")
            cfg["port"] = int(cfg.get("port", 8081))
            if not 1 <= cfg["port"] <= 65535:
                raise DeviceError("Porta inválida.")
        if adapter == "sonoff_lan":
            if not re.fullmatch(r"[a-zA-Z0-9]{8,40}", cfg.get("device_id", "")) or not isinstance(cfg.get("device_key"), str) or not 16 <= len(cfg["device_key"]) <= 128:
                raise DeviceError("Informe o device ID e a device key do seu aparelho eWeLink.")
            cfg["port"] = int(cfg.get("port", 8081))
            cfg["channels"] = int(cfg.get("channels", 1))
            if not 1 <= cfg["port"] <= 65535 or cfg["channels"] not in (1, 2, 3, 4):
                raise DeviceError("Confira a porta e o número de canais (1 a 4).")
        if adapter == "homeassistant":
            url = urllib.parse.urlsplit(cfg.get("url", ""))
            if url.scheme not in ("http", "https") or not url.hostname or url.username or url.password or url.query or url.fragment or url.path not in ("", "/"):
                raise DeviceError("Informe a URL da central, como http://homeassistant.local:8123.")
            cfg["url"] = cfg["url"].rstrip("/")
            if not cfg.get("token"):
                raise DeviceError("Informe um token do Home Assistant.")
            entity = cfg.get("entity_id", "")
            expected = {"tv": "media_player", "remote": "remote", "switch": "switch", "lock": "lock", "light": "light", "cover": "cover"}[kind]
            if not re.fullmatch(expected + r"\.[a-z0-9_]+", entity):
                raise DeviceError("Entidade incompatível; use uma entidade " + expected + ".")
            commands = cfg.get("commands", {})
            if not isinstance(commands, dict) or any(not isinstance(v, str) or not v for v in commands.values()):
                raise DeviceError("Use nomes de comandos aprendidos no Home Assistant.")
            cfg.setdefault("commands", {})
        if "commands" in cfg and (not isinstance(cfg["commands"], dict) or any(not re.fullmatch(r"[a-z0-9_-]{1,80}", k) for k in cfg["commands"])):
            raise DeviceError("Nomes de comandos devem usar letras minúsculas, números, hífen ou sublinhado.")
        if adapter == "broadlink":
            try:
                for value in cfg["commands"].values():
                    packet = base64.b64decode(value, validate=True)
                    if not 4 <= len(packet) <= 4096:
                        raise ValueError()
            except (TypeError, ValueError):
                raise DeviceError("Pacote BroadLink inválido.") from None
        name = str(payload.get("name", device["name"])).strip()
        room = str(payload.get("room", device["room"])).strip()
        if not name or len(name) > 80 or not room or len(room) > 60:
            raise DeviceError("Informe um nome e um cômodo curtos.")
        device.update(adapter=adapter, config=cfg, name=name, room=room)
        self.store.save(device)
        return self.public(device)

    def _broadlink(self, device):
        import broadlink
        cfg = device["config"]
        if cfg.get("parent_id"):
            parent = self.store.get(cfg["parent_id"])
            if parent["adapter"] != "broadlink":
                raise DeviceError("Reconecte o BroadLink que envia os sinais deste controle.")
            cfg = parent["config"]
        remote = broadlink.gendevice(cfg["devtype"], (cfg["ip"], 80), bytes.fromhex(cfg["mac"]))
        remote.timeout = 5
        if not remote.auth():
            raise DeviceError("BroadLink recusou a conexão. Confira o bloqueio do dispositivo no app BroadLink.")
        if not hasattr(remote, "send_data"):
            raise DeviceError("Este BroadLink não é um controle RM compatível.")
        return remote

    def pair_samsung(self, id_):
        device = self.store.get(id_)
        if device["adapter"] != "samsung":
            raise DeviceError("Configure primeiro a TV encontrada no Wi-Fi.")
        cfg = device["config"]
        with self.device_lock(id_):
            try:
                session = self._samsung_session(id_, cfg, timeout=35)
                if not session.tv.token:
                    raise DeviceError("A TV não forneceu um token. Confira a porta 8002 e a autorização na TV.")
                return {"paired":True,"message":"TV autorizada. Os controles já podem ser testados."}
            except Exception:
                raise DeviceError("Pareamento não concluído. Na TV, aceite Casa Universal. Confira em Configurações → Conexão → Gerenciador de Dispositivos Externos → Gerenciador de Conexão de Dispositivos, se disponível neste firmware.") from None

    def _samsung_session(self, id_, cfg, timeout=8):
        from .samsung import TVSession
        current = self.tv_sessions.get(id_)
        identity = (cfg["ip"], cfg["port"], cfg.get("token"))
        if current and current.identity == identity and current.alive():
            return current
        if current:
            current.close()
            self.tv_sessions.pop(id_, None)
        session = TVSession(cfg, lambda token:self.store.update_config(id_, {"token":token}), timeout=timeout)
        self.tv_sessions[id_] = session
        return session

    def close(self):
        for session in list(self.tv_sessions.values()):
            session.close()
        self.tv_sessions.clear()

    def _tuya(self, device):
        import tinytuya
        cfg = device["config"]
        cls = tinytuya.CoverDevice if device["kind"] == "cover" else tinytuya.OutletDevice
        plug = cls(cfg["device_id"], cfg["ip"], cfg["local_key"], version=cfg["version"])
        plug.set_socketTimeout(4)
        plug.set_socketRetryLimit(1)
        return plug

    @staticmethod
    def _tuya_result(result):
        if not isinstance(result, dict) or result.get("Error") or result.get("Err"):
            raise DeviceError("Tuya recusou a comunicação. Confira a local key, o IP e a versão do protocolo.")
        return result

    def _sonoff(self, device, operation, data):
        cfg = device["config"]
        response = read_json(f"http://{cfg['ip']}:{cfg['port']}/zeroconf/{operation}", {"deviceid": cfg.get("device_id", ""), "data": data})
        if not isinstance(response, dict) or response.get("error") != 0:
            raise DeviceError("Sonoff não confirmou o comando DIY. Verifique modelo e modo de operação.")
        return response.get("data", {})

    def _sonoff_lan(self, device, operation, data):
        from .sonoff import decrypt_data, encrypt_payload
        cfg = device["config"]
        response = read_json(f"http://{cfg['ip']}:{cfg['port']}/zeroconf/{operation}", encrypt_payload(data, cfg["device_id"], cfg["device_key"]))
        if not isinstance(response, dict):
            raise DeviceError("Resposta eWeLink inválida.")
        if operation == "getState" and response.get("error") != 0:
            return {}  # Some stock devices do not implement getState; never invent an on/off state.
        if response.get("error") != 0:
            raise DeviceError("eWeLink recusou o comando LAN. Confira a device key e o modo LAN.")
        value = response.get("data", {})
        if response.get("iv") and isinstance(value, str):
            return decrypt_data(value, response["iv"], cfg["device_key"])
        return value if isinstance(value, dict) else {}

    def status(self, id_):
        from .telemetry import homeassistant as ha_telemetry, tuya as tuya_telemetry
        from datetime import datetime, timezone
        device = self.store.get(id_)
        public = self.public(device)
        public["observed_at"]=datetime.now(timezone.utc).isoformat()
        if device["adapter"] == "pending":
            public["message"] = "Bluetooth: integração HAHA pendente de validação." if device["kind"] == "lock" else "Adicione a conexão deste dispositivo."
            return public
        try:
            with self.device_lock(device["config"].get("parent_id",id_)), self.device_lock(id_):
                cfg, adapter = device["config"], device["adapter"]
                if adapter == "samsung":
                    result=read_json(f"http://{cfg['ip']}:8001/api/v2/")
                    details=result.get("device",{}) if isinstance(result,dict) else {}
                    power=details.get("PowerState") if isinstance(details,dict) else None
                    state=power if power in ("on","off","standby") else "unknown"
                    public.update(available=True,state=state,state_source="Samsung · API local",message="Energia informada pela TV." if state!="unknown" else "TV respondeu pela rede. Estado de energia não confirmado.")
                elif adapter == "broadlink":
                    self._broadlink(device)
                    public.update(available=True, state="unknown", message="Controle disponível. Infravermelho não informa o estado do aparelho.")
                elif adapter == "tuya":
                    result = self._tuya_result(self._tuya(device).status())
                    public["telemetry"]=tuya_telemetry(result,cfg)
                    value = result.get("dps", {}).get(str(cfg["dp"]))
                    if device["kind"] == "cover":
                        # Directional DP values are commands/motion, not proof of fully open/closed position.
                        public.update(available=True, state="unknown", message="Cortina respondeu. A posição final não foi confirmada pelo DP de movimento.")
                    else:
                        public.update(available=True, state="on" if value is True else "off" if value is False else "unknown")
                elif adapter == "sonoff_diy":
                    result = self._sonoff(device, "info", {})
                    value = result.get("switch")
                    public.update(available=True, state=value if value in ("on", "off") else "unknown")
                elif adapter == "homeassistant":
                    result = read_json(cfg["url"] + "/api/states/" + cfg["entity_id"], token=cfg["token"])
                    value = result.get("state", "unknown")
                    public.update(available=value not in ("unknown", "unavailable"), state=value, updated_at=result.get("last_updated"))
                    if value not in ("unknown","unavailable"):
                        public["telemetry"]=ha_telemetry(result)
                        public["state_source"]="Home Assistant"
                elif adapter == "sonoff_lan":
                    result = self._sonoff_lan(device, "getState", {})
                    value = result.get("switch")
                    public.update(available=True, state=value if value in ("on", "off") else "unknown")
                    if isinstance(result.get("switches"), list):
                        public["channels"] = [{"channel": int(s["outlet"]) + 1, "state": s["switch"]} for s in result["switches"] if isinstance(s, dict) and isinstance(s.get("outlet"), int) and s.get("switch") in ("on", "off")]
                    if public["state"] == "unknown":
                        public["message"] = "Resposta LAN recebida. O firmware não confirmou um estado único; consulte os canais quando disponíveis."
        except Exception as exc:
            public.update(available=False, state="unavailable", message=str(exc) if isinstance(exc, DeviceError) else "Falha de comunicação. Confira a conexão e as credenciais.")
        if device["adapter"]=="broadlink" and device["config"].get("feedback_entity"):
            cfg=device["config"]
            try:
                result=read_json(cfg["feedback_url"]+"/api/states/"+cfg["feedback_entity"],token=cfg["feedback_token"])
                value=result.get("state","unknown")
                public.update(state=value,state_source="Home Assistant",updated_at=result.get("last_updated"),state_available=value not in ("unknown","unavailable"))
                public["telemetry"]=ha_telemetry(result) if value not in ("unknown","unavailable") else {}
                public["message"]="Estado consultado na central. Os comandos IR são enviados pelo BroadLink."
            except Exception:
                public.update(state="unknown",telemetry={},state_available=False,message="BroadLink envia IR; a fonte de estado não respondeu.")
        public["observed_at"]=datetime.now(timezone.utc).isoformat()
        return public

    def statuses(self):
        with ThreadPoolExecutor(max_workers=5) as pool:
            return list(pool.map(self.status, [d["id"] for d in self.store.devices()]))

    def confirmation(self, id_):
        device = self.store.get(id_)
        if "unlock" not in self.actions(device):
            raise DeviceError("Esta fechadura ainda não tem integração de abertura.")
        raw = json.dumps({"device": id_, "action": "unlock", "expires": time.time() + 30, "nonce": secrets.token_hex(16)}, separators=(",", ":")).encode()
        encoded = base64.urlsafe_b64encode(raw).decode()
        sig = hmac.new(self.store.setting("confirmation_key").encode(), encoded.encode(), hashlib.sha256).hexdigest()
        return encoded + "." + sig

    def _confirm(self, id_, token):
        try:
            encoded, sig = token.split(".")
            expected = hmac.new(self.store.setting("confirmation_key").encode(), encoded.encode(), hashlib.sha256).hexdigest()
            data = json.loads(base64.urlsafe_b64decode(encoded))
            valid = hmac.compare_digest(sig, expected) and data["device"] == id_ and data["action"] == "unlock" and data["expires"] > time.time()
            with self.lock_guard:
                if not valid or token in self.used_confirmations:
                    raise ValueError()
                self.used_confirmations.add(token)
        except (ValueError, KeyError, TypeError):
            raise DeviceError("Confirme a abertura no painel antes de continuar.") from None

    def execute(self, id_, action, *, source="mcp", confirmation=""):
        device = self.store.get(id_)
        if not isinstance(action, str) or action not in self.actions(device):
            raise DeviceError("Comando indisponível para este dispositivo.")
        if action == "unlock":
            if source != "panel":
                raise DeviceError("Abra a fechadura pelo painel com confirmação presencial nesta versão.")
            self._confirm(id_, confirmation)
        try:
            with self.device_lock(device["config"].get("parent_id",id_)), self.device_lock(id_):
                cfg, adapter = device["config"], device["adapter"]
                if adapter == "samsung":
                    if action == "power_on":
                        mac = bytes.fromhex(cfg["mac"])
                        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
                            sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
                            sock.sendto(b"\xff" * 6 + mac * 16, ("255.255.255.255", 9))
                    else:
                        if not cfg.get("token"):
                            raise DeviceError("Toque em Parear com a TV e aceite Casa Universal na tela da Samsung antes de enviar botões.")
                        try:
                            self._samsung_session(id_, cfg).send_key(TV_KEYS[action])
                        except Exception:
                            session = self.tv_sessions.pop(id_, None)
                            if session:
                                session.close()
                            raise
                elif adapter == "broadlink":
                    self._broadlink(device).send_data(base64.b64decode(cfg["commands"][action], validate=True))
                elif adapter == "tuya":
                    plug = self._tuya(device)
                    if device["kind"] == "cover":
                        # CoverDevice convenience methods discard the response in TinyTuya 1.20.
                        # Send the explicitly configured enum via set_value so errors stay observable.
                        command = plug.COVER_TYPES[cfg["cover_type"]][action]
                        self._tuya_result(plug.set_value(cfg["dp"], command))
                    else:
                        self._tuya_result(plug.set_status(action == "on", switch=cfg["dp"]))
                elif adapter == "sonoff_diy":
                    self._sonoff(device, "switch", {"switch": action})
                elif adapter == "sonoff_lan":
                    if "_" in action:
                        operation, ch = action.split("_")
                        self._sonoff_lan(device, "switches", {"switches": [{"outlet": int(ch) - 1, "switch": operation}]})
                    else:
                        self._sonoff_lan(device, "switch", {"switch": action})
                elif adapter == "homeassistant":
                    domain = cfg["entity_id"].split(".")[0]
                    service = {"on": "turn_on", "off": "turn_off", "power_on": "turn_on", "power_off": "turn_off", "play": "media_play", "pause": "media_pause", "open": "open_cover", "close": "close_cover", "stop": "stop_cover"}.get(action, action)
                    data = {"entity_id": cfg["entity_id"]}
                    if domain == "remote":
                        service = "send_command"
                        data.update(command=cfg["commands"][action], device=cfg.get("remote_device", "tv"))
                    read_json(cfg["url"] + f"/api/services/{domain}/{service}", data=data, token=cfg["token"])
            self.store.audit(id_, action, "sent")
            return {"device": id_, "action": action, "sent": True, "message": "Comando enviado. O estado será consultado novamente; envio não confirma a ação física."}
        except Exception as exc:
            self.store.audit(id_, action, "error")
            if isinstance(exc, DeviceError):
                raise
            raise DeviceError("Comando não confirmado. Confira a conexão; na TV, aceite Casa Universal na tela de autorização.") from None

    def learn(self, id_, name):
        device = self.store.get(id_)
        if device["adapter"] != "broadlink" or not re.fullmatch(r"[a-z0-9_-]{1,40}", name):
            raise DeviceError("Escolha um BroadLink configurado e um nome como volume_up.")
        if device.get("generic_remote"):
            from .generic_remote import GenericRemotes
            GenericRemotes(self).require_button(id_,name)
        with self.device_lock(device["config"].get("parent_id",id_)), self.device_lock(id_):
            try:
                import broadlink.exceptions
                remote = self._broadlink(device)
                remote.enter_learning()
                deadline = time.monotonic() + 25
                while time.monotonic() < deadline:
                    time.sleep(0.6)
                    try:
                        packet = remote.check_data()
                    except broadlink.exceptions.StorageError:
                        continue
                    if packet:
                        if packet[0]!=0x26 or not 6<=len(packet)<=4096:
                            raise DeviceError("O sinal recebido não é um pacote infravermelho válido.")
                        self.store.put_ir_button(id_,name,base64.b64encode(packet).decode())
                        return {"learned": name, "message": "Comando infravermelho salvo."}
                raise DeviceError("Nenhum sinal recebido. Tente novamente apontando o controle físico para o BroadLink.")
            except Exception as exc:
                if isinstance(exc, DeviceError):
                    raise
                raise DeviceError("Não foi possível aprender o sinal. Confira o BroadLink e o bloqueio no app.") from None

    def discover_broadlink(self):
        import broadlink
        try:
            found = broadlink.discover(timeout=4)
            return [{"ip": d.host[0], "mac": d.mac.hex(), "devtype": d.devtype, "model": d.model} for d in found]
        except Exception:
            raise DeviceError("A descoberta BroadLink falhou. Confira se o Mac está no Wi-Fi de casa.") from None
