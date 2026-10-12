"""Build an offline catalog from licensed public data, not proprietary app databases."""
import base64
import hashlib
import json
import re
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "research/ir-source"
OUT = ROOT / "catalog"
ALIASES = {"volumeUp":"volume_up","volumeDown":"volume_down","previousChannel":"channel_down","nextChannel":"channel_up","off":"power_off","on":"power_on"}


def flatten(value, prefix="", result=None):
    result = {} if result is None else result
    if isinstance(value, dict):
        for name, child in value.items():
            key = ALIASES.get(name, name) if not prefix else name
            key = re.sub(r"[^a-z0-9]+", "_", key.lower()).strip("_")
            flatten(child, prefix + "_" + key if prefix else key, result)
    elif isinstance(value, str) and re.fullmatch(r"[a-z0-9_]{1,80}", prefix):
        try:
            packet = base64.b64decode(value, validate=True)
            if 6 <= len(packet) <= 4096 and packet[0] == 0x26:
                result[prefix] = value
        except ValueError:
            pass
    # Lists may represent sequences: omit instead of sending only the first step.
    return result


def main():
    OUT.mkdir(exist_ok=True)
    (OUT / "profiles").mkdir(exist_ok=True)
    revision = subprocess.check_output(["git", "-C", str(SOURCE), "rev-parse", "HEAD"], text=True).strip()
    index, skipped = [], []
    for file in sorted((SOURCE / "codes").glob("*/*.json")):
        try:
            data = json.loads(file.read_text())
        except ValueError:
            skipped.append({"file": str(file.relative_to(SOURCE)), "reason":"invalid JSON"})
            continue
        if data.get("supportedController") != "Broadlink" or data.get("commandsEncoding") != "Base64":
            continue
        commands = flatten(data.get("commands", {}))
        if not commands:
            continue
        id_ = file.parent.name + "_" + file.stem
        entry = {"id":id_, "category":file.parent.name, "brand":data.get("manufacturer", ""),
                 "models":data.get("supportedModels", []), "command_count":len(commands),
                 "source":f"https://github.com/smartHomeHub/SmartIR/blob/{revision}/{file.relative_to(SOURCE)}",
                 "source_sha256":hashlib.sha256(file.read_bytes()).hexdigest()}
        index.append(entry)
        (OUT / "profiles" / (id_ + ".json")).write_text(json.dumps({**entry,"commands":commands}, ensure_ascii=False, separators=(",",":")))
    (OUT / "index.json").write_text(json.dumps({"source_revision":revision,"profiles":index,"skipped":skipped}, ensure_ascii=False, indent=2))
    shutil.copyfile(SOURCE / "LICENSE", OUT / "LICENSE-SmartIR.txt")
    print(f"{len(index)} profiles; {len({p['brand'] for p in index})} brands; {sum(p['command_count'] for p in index)} commands; {len(skipped)} invalid JSON files omitted")


if __name__ == "__main__":main()
