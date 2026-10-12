import json
import os
import secrets
import sqlite3
from contextlib import contextmanager
from pathlib import Path

from .cloud_data import serialize, digest

ROOT = Path(__file__).resolve().parent.parent
DATA = Path(os.environ.get("CASA_DATA_DIR", ROOT / "data"))


class Store:
    def __init__(self, directory=DATA):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.directory.chmod(0o700)
        self.path = self.directory / "casa.sqlite3"
        with self.connect() as db:
            db.execute("CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, payload TEXT NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS cloud_outbox (id TEXT PRIMARY KEY, payload TEXT NOT NULL, hash TEXT NOT NULL, version INTEGER NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS cloud_saved (id TEXT PRIMARY KEY, hash TEXT NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, timestamp TEXT DEFAULT CURRENT_TIMESTAMP, device TEXT, action TEXT, result TEXT)")
            db.execute("INSERT OR IGNORE INTO settings VALUES (?, ?)", ("confirmation_key", secrets.token_urlsafe(32)))
            defaults = [
                ("tv", "Samsung DU8000 · 50″", "Sala", "tv"),
                ("broadlink", "Controle BroadLink", "Sala", "remote"),
                ("tuya", "Tomada Tuya", "Casa", "switch"),
                ("sonoff", "Sonoff Basic 2", "Casa", "switch"),
                ("sonoff_tx1c", "Sonoff TX1C", "Casa", "switch"),
                ("sonoff_tx3c", "Sonoff TX3C", "Casa", "switch"),
                ("curtain", "Cortina", "Casa", "cover"),
                ("lock", "Fechadura HAHA", "Entrada", "lock"),
            ]
            for id_, name, room, kind in defaults:
                item = {"id": id_, "name": name, "room": room, "kind": kind, "adapter": "pending", "config": {}}
                db.execute("INSERT OR IGNORE INTO devices VALUES (?, ?)", (id_, json.dumps(item)))
            for row in db.execute("SELECT payload FROM devices").fetchall():
                self._queue_cloud(db,json.loads(row[0]))
        self.path.chmod(0o600)

    @contextmanager
    def connect(self):
        connection = sqlite3.connect(self.path, timeout=10)
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def setting(self, key, default=None):
        with self.connect() as db:
            row = db.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
            return row[0] if row else default

    def set_setting(self, key, value):
        with self.connect() as db:
            db.execute("INSERT OR REPLACE INTO settings VALUES (?,?)",(key,str(value)))

    def _queue_cloud(self, db, device):
        payload=serialize(device); hash_=digest(payload)
        saved=db.execute("SELECT hash FROM cloud_saved WHERE id=?",(device['id'],)).fetchone()
        if saved and saved[0]==hash_:
            # If a pending change was reversed before upload, keep the cloud copy as-is.
            db.execute("DELETE FROM cloud_outbox WHERE id=?",(device['id'],))
            return
        db.execute("INSERT INTO cloud_outbox VALUES (?,?,?,1) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,hash=excluded.hash,version=cloud_outbox.version+1 WHERE cloud_outbox.hash!=excluded.hash",(device['id'],payload,hash_))

    def cloud_pending(self):
        with self.connect() as db:
            db.row_factory=sqlite3.Row
            return [dict(row) for row in db.execute("SELECT * FROM cloud_outbox ORDER BY rowid")]

    def cloud_ack(self, row):
        with self.connect() as db:
            db.execute("INSERT OR REPLACE INTO cloud_saved VALUES (?,?)",(row['id'],row['hash']))
            db.execute("DELETE FROM cloud_outbox WHERE id=? AND version=? AND hash=?",(row['id'],row['version'],row['hash']))
            current=db.execute("SELECT payload FROM devices WHERE id=?",(row['id'],)).fetchone()
            if current:self._queue_cloud(db,json.loads(current[0]))

    def devices(self):
        with self.connect() as db:
            return [json.loads(row[0]) for row in db.execute("SELECT payload FROM devices ORDER BY rowid")]

    def get(self, id_):
        with self.connect() as db:
            row = db.execute("SELECT payload FROM devices WHERE id = ?", (id_,)).fetchone()
        if row is None:
            raise ValueError("Dispositivo não cadastrado.")
        return json.loads(row[0])

    def save(self, device):
        with self.connect() as db:
            db.execute("INSERT INTO devices VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload", (device["id"], json.dumps(device)))
            self._queue_cloud(db,device)

    def update_config(self, id_, changes):
        # Merge inside the transaction so independent MCP/panel processes preserve each other's changes.
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT payload FROM devices WHERE id = ?", (id_,)).fetchone()
            device = json.loads(row[0])
            device["config"].update(changes)
            db.execute("UPDATE devices SET payload = ? WHERE id = ?", (json.dumps(device), id_))
            self._queue_cloud(db,device)

    def audit(self, device, action, result):
        with self.connect() as db:
            db.execute("INSERT INTO audit (device, action, result) VALUES (?, ?, ?)", (device, action, result))

    def put_ir_button(self, id_, button_id, packet, source=None):
        # Update one key, preserving every other button even during concurrent configuration.
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row=db.execute("SELECT payload FROM devices WHERE id = ?",(id_,)).fetchone()
            device=json.loads(row[0])
            commands=device["config"].setdefault("commands",{})
            if packet is None:commands.pop(button_id,None)
            else:commands[button_id]=packet
            if device.get("generic_remote"):
                sources=device["generic_remote"].setdefault("sources",{})
                if packet is None:sources.pop(button_id,None)
                else:sources[button_id]=source or {"method":"learned","confirmed":False}
            db.execute("UPDATE devices SET payload = ? WHERE id = ?",(json.dumps(device),id_))
            self._queue_cloud(db,device)

    def history(self):
        with self.connect() as db:
            db.row_factory = sqlite3.Row
            return [dict(row) for row in db.execute("SELECT timestamp, device, action, result FROM audit ORDER BY id DESC LIMIT 30")]
