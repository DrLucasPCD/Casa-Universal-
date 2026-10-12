"""Generate separate remote credentials locally; never print or publish them."""
import hashlib
import json
import os
import secrets
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIRECTORY = ROOT / 'data/esp32'
SITE = 'https://casa-universal.netlify.app'


def prepare():
    DIRECTORY.mkdir(mode=0o700, parents=True, exist_ok=True)
    path = DIRECTORY / 'remote-private.json'
    if path.exists():
        settings = json.loads(path.read_text())
    else:
        settings = {
            'url': SITE,
            'token': secrets.token_urlsafe(32),
            'oauth_secret': secrets.token_urlsafe(32),
            'pairing_key': secrets.token_urlsafe(32),
        }
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'w') as stream:
            json.dump(settings, stream)
    if settings.get('url') != SITE or any(len(settings.get(key, '')) != 43 for key in ('token', 'oauth_secret', 'pairing_key')):
        raise ValueError('Configuração remota local inválida; preserve o arquivo para recuperação.')
    path.chmod(0o600)
    values = {
        'CASA_PUBLIC_URL': SITE,
        'CASA_BRIDGE_TOKEN': settings['token'],
        'CASA_OAUTH_SECRET': settings['oauth_secret'],
        'CASA_PAIRING_HASH': hashlib.sha256(settings['pairing_key'].encode()).hexdigest(),
    }
    env_path = DIRECTORY / 'netlify.env'
    descriptor = os.open(env_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, 'w') as stream:
        stream.write(''.join(f'{key}={value}\n' for key, value in values.items()))
    env_path.chmod(0o600)
    return settings
