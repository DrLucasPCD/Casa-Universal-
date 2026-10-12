"""Static APK inspection with REA. Never installs or executes the Android applications."""
import hashlib
import json
import os
import re
import subprocess
import zipfile
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent
DOWNLOADS = Path.home() / "Downloads"
APPS = {
    "broadlink": "BroadLink+-Universal+TV+Remote_1.8.40.c4f7cf3c1_APKPure.apk",
    "ewelink": "eWeLink+-+Smart+Home_5.29.1_APKPure.xapk",
    "haha": "HAHA+Lock_1.1.5_APKPure.xapk",
    "smartlife": "SmartLife-+Smart+Living_7.11.6_APKPure.xapk",
    "smartthings": "SmartThings_1.8.51.30_APKPure.apk",
}


def dex_strings(data):
    if not data.startswith(b"dex\n"):
        return
    count = int.from_bytes(data[56:60], "little")
    offset = int.from_bytes(data[60:64], "little")
    for i in range(count):
        p = int.from_bytes(data[offset + i * 4:offset + i * 4 + 4], "little")
        while data[p] & 128:
            p += 1
        p += 1
        end = data.index(0, p)
        yield data[p:end].decode("utf-8", errors="replace")


def run_rea(args, label, env):
    evidence = ROOT / "research" / "evidence"
    with (evidence / (label + ".json")).open("w") as out, (evidence / (label + ".log")).open("w") as err:
        try:
            p = subprocess.run(["npx", "-y", "rea-agents@6.4.0", *args, "--json"], env=env, stdout=out, stderr=err, timeout=360)
            print(label, "exit", p.returncode, flush=True)
            return p.returncode
        except subprocess.TimeoutExpired:
            print(label, "timeout; partial output preserved", flush=True)
            return -1


def main():
    evidence = ROOT / "research" / "evidence"
    apks = ROOT / "research" / "apks"
    apks.mkdir(parents=True, exist_ok=True)
    evidence.mkdir(exist_ok=True)
    env = os.environ.copy()
    env["JAVA_HOME"] = str(next((ROOT / ".tools" / "jdk").glob("*/Contents/Home")))
    env["REA_JADX_MCP_JAR"] = str(ROOT / ".tools" / "jadx-headless-mcp-0.7.1-all.jar")
    jar_hash = hashlib.file_digest(Path(env["REA_JADX_MCP_JAR"]).open("rb"), "sha256").hexdigest()
    assert jar_hash == "6e5eacf500b64292bfb73c49797c1958f6ee44646e43e868039ae7feb573ff75"
    env["JAVA_TOOL_OPTIONS"] = "-Xmx4096m"
    inventory = []
    for app, filename in APPS.items():
        source = DOWNLOADS / filename
        item = {"app": app, "source": str(source), "sha256": hashlib.file_digest(source.open("rb"), "sha256").hexdigest()}
        apk = source
        if source.suffix == ".xapk":
            with zipfile.ZipFile(source) as z:
                manifest = json.loads(z.read("manifest.json"))
                name = next(e["file"] for e in manifest["split_apks"] if e["id"] == "base")
                apk = apks / (app + ".apk")
                apk.write_bytes(z.read(name))
                item.update(base_apk_member=name, package=manifest["package_name"], version=manifest["version_name"], split_count=len(manifest["split_apks"]), split_limit="REA analysis selects only the base APK; native ABI and language splits are not decompiled.")
        item["base_sha256"] = hashlib.file_digest(apk.open("rb"), "sha256").hexdigest()
        urls, classes = set(), set()
        pattern = re.compile(r"(?:broadlink|coolkit|tuya|smartthings|samsung|lock).*?(?:socket|mqtt|ble|bluetooth|lan|control|service|http|client|device)", re.I)
        with zipfile.ZipFile(apk) as z:
            dex_entries = [n for n in z.namelist() if re.fullmatch(r"classes\d*\.dex", n)]
            item["dex_files"] = len(dex_entries)
            for name in dex_entries:
                for s in dex_strings(z.read(name)):
                    if s.startswith("L") and s.endswith(";") and "/" in s and pattern.search(s):
                        classes.add(s[1:-1].replace("/", "."))
                    if s.startswith(("https://", "http://", "wss://", "ws://")) and len(s) < 500:
                        try:
                            u = urlsplit(s)
                            if u.hostname:
                                urls.add(f"{u.scheme}://{u.hostname}{':' + str(u.port) if u.port else ''}{u.path}")
                        except ValueError:
                            pass
        item["url_literals_without_queries"] = sorted(urls)
        item["candidate_classes"] = sorted(classes)
        (evidence / (app + "-dex-inventory.json")).write_text(json.dumps(item, indent=2, ensure_ascii=False))
        print(app, "DEX files", item["dex_files"], "protocol candidates", len(classes), "URL literals", len(urls), flush=True)
        item["rea_exit"] = run_rea(["inspect-android-package", str(apk)], app + "-package", env)
        inventory.append({k: v for k, v in item.items() if k not in ("candidate_classes", "url_literals_without_queries")})
        (evidence / "apk-inventory.json").write_text(json.dumps(inventory, indent=2, ensure_ascii=False))
    print("Package analysis completed for all supplied apps.", flush=True)


if __name__ == "__main__":
    main()
