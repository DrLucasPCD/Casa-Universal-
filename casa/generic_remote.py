"""Remote layouts are editable button slots, not claims of IR compatibility."""
import re
import secrets

from .controller import DeviceError


def buttons(section, pairs):
    return [{"id":id_,"label":label,"section":section} for id_,label in pairs]


POWER = [("power","Liga / desliga"),("power_on","Ligar"),("power_off","Desligar")]
NAV = [("up","↑"),("left","←"),("enter","OK"),("right","→"),("down","↓"),("back","Voltar"),("menu","Menu"),("home","Início")]
TV = buttons("Energia",POWER)+buttons("Navegação",NAV)+buttons("Som e canais",[("volume_up","Volume +"),("volume_down","Volume −"),("mute","Mudo"),("channel_up","Canal +"),("channel_down","Canal −"),("source","Entrada")])+buttons("Números",[(f"digit_{i}",str(i)) for i in range(10)])
TEMPLATES = {
    "tv":{"label":"TV","buttons":TV},
    "climate":{"label":"Ar-condicionado","buttons":buttons("Energia",POWER)+buttons("Ajustes",[("cool_24","Resfriar · 24 °C"),("cool_22","Resfriar · 22 °C"),("heat_24","Aquecer · 24 °C"),("auto_mode","Automático"),("dry_mode","Desumidificar"),("temperature_up","Temperatura +"),("temperature_down","Temperatura −"),("fan_speed","Velocidade"),("swing","Oscilar"),("sleep","Dormir")])},
    "projector":{"label":"Projetor","buttons":buttons("Energia",POWER)+buttons("Navegação",NAV)+buttons("Imagem",[("source","Entrada"),("hdmi","HDMI"),("focus_up","Foco +"),("focus_down","Foco −"),("zoom_up","Zoom +"),("zoom_down","Zoom −"),("keystone_up","Correção +"),("keystone_down","Correção −"),("picture_mode","Modo de imagem")])+buttons("Som",[("volume_up","Volume +"),("volume_down","Volume −"),("mute","Mudo")])},
    "fan":{"label":"Ventilador","buttons":buttons("Principal",POWER+[("speed","Velocidade"),("swing","Oscilar"),("timer","Temporizador"),("mode","Modo")])},
    "audio":{"label":"Som / receiver","buttons":buttons("Principal",POWER+[("volume_up","Volume +"),("volume_down","Volume −"),("mute","Mudo"),("source","Entrada"),("play","Reproduzir"),("pause","Pausar"),("next","Próxima"),("previous","Anterior")])},
    "light":{"label":"Iluminação / fita LED","buttons":buttons("Energia",POWER)+buttons("Luz",[("brightness_up","Brilho +"),("brightness_down","Brilho −"),("red","Vermelho"),("green","Verde"),("blue","Azul"),("white","Branco"),("scene","Cena"),("color_next","Próxima cor")])},
    "cover":{"label":"Cortina / persiana","buttons":buttons("Movimento",[("open","Abrir"),("stop","Parar"),("close","Fechar")])+buttons("Posições",[("position_25","25% aberta"),("position_50","50% aberta"),("position_75","75% aberta")])},
    "switch":{"label":"Tomada / interruptor","buttons":buttons("Energia",POWER)+buttons("Canais",[("channel_1","Canal 1"),("channel_2","Canal 2"),("channel_3","Canal 3"),("timer","Temporizador")])},
    "other":{"label":"Outro aparelho","buttons":buttons("Principal",POWER)},
}


class GenericRemotes:
    def __init__(self, controller):
        self.c=controller

    def get(self, id_):
        device=self.c.store.get(id_)
        if device["adapter"]!="broadlink" or not device.get("generic_remote"):
            raise DeviceError("Escolha um controle genérico criado no painel.")
        return device

    def create(self, payload):
        type_=payload.get("type")
        if type_ not in TEMPLATES:
            raise DeviceError("Tipo de controle desconhecido.")
        name=str(payload.get("name","")).strip();room=str(payload.get("room","Sala")).strip()
        if not name or len(name)>80 or not room or len(room)>60:
            raise DeviceError("Informe um nome e um cômodo curtos.")
        with self.c.lock_guard:
            if len(self.c.store.devices())>=100:
                raise DeviceError("Limite de aparelhos cadastrados atingido.")
            cfg={k:v for k,v in self.c.store.get("broadlink")["config"].items() if k in ("ip","mac","devtype")}
            cfg.update(commands={},parent_id="broadlink")
            device={"id":"generic_"+secrets.token_hex(6),"name":name,"room":room,"kind":"remote","adapter":"broadlink","config":cfg,
                    "generic_remote":{"type":type_,"buttons":[b.copy() for b in TEMPLATES[type_]["buttons"]],"sources":{}}}
            self.c.store.save(device)
        return self.c.public(device)

    def require_button(self,id_,button_id):
        device=self.get(id_)
        if not any(b["id"]==button_id for b in device["generic_remote"]["buttons"]):
            raise DeviceError("Esse botão não existe no controle.")
        return device

    def add_button(self,id_,label):
        label=str(label).strip()
        if not label or len(label)>60:
            raise DeviceError("Informe um nome de botão de até 60 caracteres.")
        with self.c.device_lock(id_):
            device=self.get(id_)
            if len(device["generic_remote"]["buttons"])>=80:
                raise DeviceError("Limite de 80 botões por controle.")
            button_id="custom_"+secrets.token_hex(5)
            device["generic_remote"]["buttons"].append({"id":button_id,"label":label,"section":"Meus botões"})
            self.c.store.save(device)
        return self.c.public(device)

    def climate_slot(self,payload):
        id_=payload.get('id');mode=payload.get('mode');fan=payload.get('fan');swing=payload.get('swing','stop');temp=payload.get('temperature')
        if type(temp)!=int or not 16<=temp<=32 or mode not in ('cool','heat','auto','dry','fan_only') or fan not in ('auto','low','medium','high') or swing not in ('stop','swing'):raise DeviceError('Ajuste de ar-condicionado inválido.')
        with self.c.device_lock(id_):
            device=self.get(id_)
            if device['generic_remote']['type']!='climate':raise DeviceError('Escolha um ar-condicionado personalizado.')
            slot=f'{mode}_{fan}_{swing}_{temp}';items=device['generic_remote']['buttons']
            if not any(b['id']==slot for b in items):
                if len(items)>=80:raise DeviceError('Limite de 80 botões por controle.')
                modes={'cool':'Resfriar','heat':'Aquecer','auto':'Automático','dry':'Desumidificar','fan_only':'Ventilar'}
                fans={'auto':'Auto','low':'Baixa','medium':'Média','high':'Alta'}
                items.append({'id':slot,'label':f'{modes[mode]} · {temp} °C · {fans[fan]} · '+('Parada' if swing=='stop' else 'Oscilando'),'section':'Meus ajustes','preset':{'temperature':temp,'mode':mode,'fan':fan,'swing':swing}})
                self.c.store.save(device)
        return {'button_id':slot,'message':'Ajuste preparado. Aprenda o sinal completo do controle físico.'}

    def rename_button(self,id_,button_id,label):
        label=str(label).strip()
        if not label or len(label)>60:
            raise DeviceError("Informe um nome de botão de até 60 caracteres.")
        with self.c.device_lock(id_):
            device=self.require_button(id_,button_id)
            next(b for b in device["generic_remote"]["buttons"] if b["id"]==button_id)["label"]=label
            self.c.store.save(device)
        return self.c.public(device)

    def clear_button(self,id_,button_id):
        with self.c.device_lock(id_):
            self.require_button(id_,button_id)
            self.c.store.put_ir_button(id_,button_id,None)
        return self.c.public(self.c.store.get(id_))

    def map_catalog(self,payload,flow):
        from .ir_catalog import profile
        id_,button_id=payload.get("id"),payload.get("button_id")
        profile_id,command=payload.get("profile_id"),payload.get("command")
        data=profile(profile_id)
        if not isinstance(command,str) or command not in data["commands"]:
            raise DeviceError("Selecione um comando válido do perfil.")
        if payload.get("confirmed") is not True:
            raise DeviceError("Confirme que este botão funcionou no aparelho.")
        with self.c.device_lock(id_):
            self.require_button(id_,button_id)
            with self.c.lock_guard:
                tested=flow.tests.get(payload.get("test_id",""))
                import time
                if not tested or tested["profile"]!=profile_id or tested.get("command")!=command or tested["expires"]<time.time():
                    raise DeviceError("Teste este código e confirme sua resposta antes de associar o botão.")
                self.c.store.put_ir_button(id_,button_id,data["commands"][command],{"method":"catalog","profile_id":profile_id,"command":command,"confirmed":True})
                flow.tests.pop(payload["test_id"])
        return self.c.public(self.c.store.get(id_))
