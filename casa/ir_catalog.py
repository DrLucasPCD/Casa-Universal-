import base64
import json
import re
import secrets
import time

from .controller import DeviceError
from .store import ROOT


def index():
    return json.loads((ROOT / "catalog/index.json").read_text())


def profile(id_):
    if not isinstance(id_, str) or not re.fullmatch(r"(?:climate|media_player|fan|light)_\d+", id_):
        raise DeviceError("Perfil infravermelho inválido.")
    file = ROOT / "catalog/profiles" / (id_ + ".json")
    if not file.is_file():
        raise DeviceError("Perfil não encontrado no catálogo local.")
    return json.loads(file.read_text())


class CatalogFlow:
    def __init__(self, controller):
        self.controller = controller
        self.tests = {}

    def test(self, profile_id, command):
        data = profile(profile_id)
        if not isinstance(command, str) or command not in data["commands"]:
            raise DeviceError("Selecione um botão deste perfil.")
        controller = self.controller
        hardware = controller.store.get("broadlink")
        if hardware["adapter"] != "broadlink":
            raise DeviceError("Configure o BroadLink encontrado no Wi-Fi antes de testar códigos.")
        try:
            with controller.device_lock("broadlink"):
                controller._broadlink(hardware).send_data(base64.b64decode(data["commands"][command], validate=True))
            controller.store.audit("broadlink", "teste:" + profile_id + ":" + command, "sent")
        except Exception:
            controller.store.audit("broadlink", "teste:" + profile_id + ":" + command, "error")
            raise DeviceError("Não foi possível enviar o teste. Confira o BroadLink.") from None
        key = secrets.token_urlsafe(24)
        with controller.lock_guard:
            self.tests = {k:v for k,v in self.tests.items() if v["expires"] > time.time()}
            self.tests[key] = {"profile":profile_id, "command":command, "expires":time.time()+600}
        return {"test_id":key, "message":"Sinal enviado. Verifique no aparelho se este botão funcionou. A resposta do BroadLink não confirma a reação do aparelho."}

    def save(self, payload):
        profile_id = payload.get("profile_id")
        data = profile(profile_id)
        name, room = str(payload.get("name", "")).strip(), str(payload.get("room", "Sala")).strip()
        if not name or len(name)>80 or not room or len(room)>60:
            raise DeviceError("Informe o nome do aparelho e o cômodo.")
        if payload.get("confirmed") is not True:
            raise DeviceError("Confirme que o aparelho respondeu aos testes.")
        with self.controller.lock_guard:
            tested = self.tests.get(payload.get("test_id", ""))
            if not tested or tested["profile"] != profile_id or tested["expires"] < time.time():
                raise DeviceError("Teste um botão deste perfil antes de salvar. O teste vale por dez minutos.")
            if len(self.controller.store.devices()) >= 100:
                raise DeviceError("Limite de aparelhos cadastrados atingido.")
            cfg = {k:v for k,v in self.controller.store.get("broadlink")["config"].items() if k in ("ip","mac","devtype")}
            cfg.update(commands=data["commands"], parent_id="broadlink")
            device = {"id":"ir_"+secrets.token_hex(6), "name":name, "room":room, "kind":"remote", "adapter":"broadlink", "config":cfg,
                      "ir_profile":{"id":profile_id,"brand":data["brand"],"category":data["category"],"models":data["models"],"source":data["source"]}}
            self.controller.store.save(device)
            self.tests.pop(payload["test_id"])
        return self.controller.public(device)
