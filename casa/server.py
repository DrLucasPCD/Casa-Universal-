import argparse
import ipaddress
import json
import mimetypes
import os
import socket
import ssl
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, parse_qs

from .controller import Controller, DeviceError
from .store import ROOT


class CasaServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, controller=None):
        super().__init__(address, Handler)
        self.controller = controller or Controller()
        from .ir_catalog import CatalogFlow
        self.ir_flow = CatalogFlow(self.controller)
        from .generic_remote import GenericRemotes
        self.generic_remotes = GenericRemotes(self.controller)
        self.cloud = None
        self.use_tls = False
        self.allowed_hosts = {"localhost", "127.0.0.1"}
        try:
            self.allowed_hosts.update(x[4][0] for x in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET))
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.connect(("192.0.2.1", 80))
                self.allowed_hosts.add(s.getsockname()[0])
        except OSError:
            pass


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # No request bodies, tokens, cookies or URL query strings in logs.
        pass

    @property
    def local(self):
        return ipaddress.ip_address(self.client_address[0]).is_loopback

    def send(self, status, body, content_type="application/json"):
        data = json.dumps(body, ensure_ascii=False).encode() if content_type == "application/json" else body
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store" if content_type == "application/json" else "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass  # A closed browser tab is not a server error.

    def valid_host(self):
        try:
            host = urlsplit("http://" + self.headers.get("Host", ""))
            return host.hostname in self.server.allowed_hosts and host.port == self.server.server_port
        except ValueError:
            return False

    def do_GET(self):
        if not self.valid_host():
            return self.send(403, {"error": "Endereço do painel não autorizado."})
        path = urlsplit(self.path).path
        if path == "/api/session":
            return self.send(200, {"authenticated": True, "local": self.local})
        if path.startswith("/api/"):
            controller = self.server.controller
            if path == "/api/devices":
                return self.send(200, {"devices": controller.devices()})
            if path == "/api/status":
                return self.send(200, {"devices": controller.statuses()})
            if path == "/api/cloud":
                return self.send(200,self.server.cloud.status() if self.server.cloud else {"configured":False,"phase":"disabled","message":"Sincronização não iniciada."})
            if path == "/api/history":
                return self.send(200, {"history": controller.store.history()})
            if path == "/api/ir/catalog":
                from .ir_catalog import index
                return self.send(200, index())
            if path == "/api/remotes/templates":
                from .generic_remote import TEMPLATES
                return self.send(200, {"templates":TEMPLATES})
            if path == "/api/ir/profile":
                from .ir_catalog import profile
                try:
                    result = profile(parse_qs(urlsplit(self.path).query).get("id", [""])[0])
                    return self.send(200, {k:v for k,v in result.items() if k != "commands"} | {"actions":list(result["commands"])})
                except DeviceError as exc:
                    return self.send(400, {"error":str(exc)})
            if path == "/api/network":
                scheme = "https" if self.server.use_tls else "http"
                enabled = self.server.server_address[0] == "0.0.0.0"
                urls = [f"{scheme}://{ip}:{self.server.server_port}" for ip in self.server.allowed_hosts if ip not in ("localhost", "127.0.0.1")]
                return self.send(200, {"lan": enabled, "urls": sorted(urls), "tls": self.server.use_tls, "local": self.local})
            return self.send(404, {"error": "Rota não encontrada."})
        files = {"/": "index.html", "/index.html": "index.html", "/app.js": "app.js", "/visuals.js": "visuals.js", "/style.css": "style.css", "/manifest.webmanifest": "manifest.webmanifest", "/sw.js": "sw.js", "/icon.svg": "icon.svg", "/apple-touch-icon.png": "apple-touch-icon.png", "/icon-192.png": "icon-192.png", "/icon-512.png": "icon-512.png"}
        name = files.get(path)
        if name is None:
            return self.send(404, {"error": "Arquivo não encontrado."})
        file = ROOT / "static" / name
        if not file.exists():
            return self.send(404, {"error": "Arquivo não encontrado."})
        content_type = mimetypes.guess_type(name)[0] or "application/octet-stream"
        if name.endswith(".webmanifest"):
            content_type = "application/manifest+json"
        self.send(200, file.read_bytes(), content_type)

    def do_POST(self):
        if not self.valid_host():
            return self.send(403, {"error": "Endereço não autorizado."})
        scheme = "https" if self.server.use_tls else "http"
        if self.headers.get("Origin") != scheme + "://" + self.headers.get("Host", ""):
            return self.send(403, {"error": "Origem não autorizada."})
        if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
            return self.send(415, {"error": "Envie JSON."})
        try:
            length = int(self.headers.get("Content-Length", 0))
            if not 0 < length <= 32_768:
                raise DeviceError("Solicitação inválida.")
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                raise DeviceError("Envie um objeto JSON.")
            path = urlsplit(self.path).path
            controller = self.server.controller
            if path == "/api/cloud/sync":
                if not self.local or not self.server.cloud:
                    return self.send(403,{"error":"Gerencie a sincronização neste Mac."})
                return self.send(200,self.server.cloud.retry())
            if path == "/api/configure":
                if not self.local:
                    return self.send(403, {"error": "Configure as credenciais no painel aberto neste Mac."})
                return self.send(200, controller.configure(payload["id"], payload))
            if path == "/api/action":
                return self.send(200, controller.execute(payload["id"], payload["action"], source="panel", confirmation=payload.get("confirmation", "")))
            if path == "/api/light":
                return self.send(200,controller.adjust_light(payload['id'],payload))
            if path == "/api/unlock-confirmation":
                return self.send(200, {"confirmation": controller.confirmation(payload["id"])})
            if path == "/api/learn":
                return self.send(200, controller.learn(payload["id"], payload["name"]))
            if path == "/api/pair/samsung":
                return self.send(200, controller.pair_samsung(payload["id"]))
            if path == "/api/ir/test":
                return self.send(200, self.server.ir_flow.test(payload["profile_id"], payload["command"]))
            if path == "/api/ir/save":
                return self.send(200, self.server.ir_flow.save(payload))
            if path == "/api/remotes/create":
                return self.send(200,self.server.generic_remotes.create(payload))
            if path == "/api/remotes/climate-slot":
                return self.send(200,self.server.generic_remotes.climate_slot(payload))
            if path == "/api/remotes/map-button":
                return self.send(200,self.server.generic_remotes.map_catalog(payload,self.server.ir_flow))
            if path == "/api/remotes/add-button":
                return self.send(200,self.server.generic_remotes.add_button(payload["id"],payload["label"]))
            if path == "/api/remotes/rename-button":
                return self.send(200,self.server.generic_remotes.rename_button(payload["id"],payload["button_id"],payload["label"]))
            if path == "/api/remotes/clear-button":
                return self.send(200,self.server.generic_remotes.clear_button(payload["id"],payload["button_id"]))
            if path.startswith("/api/discover/"):
                from .discovery import discover
                return self.send(200, {"devices": discover(path.rsplit("/", 1)[1])})
            return self.send(404, {"error": "Rota não encontrada."})
        except (DeviceError, ValueError, KeyError, TypeError):
            import sys
            exc = sys.exception()
            return self.send(400, {"error": str(exc) if isinstance(exc, DeviceError) else "Revise os campos da solicitação."})
        except Exception:
            return self.send(502, {"error": "A conexão falhou. Confira o dispositivo e tente novamente."})


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description="Painel Casa Universal")
    parser.add_argument("--lan", action="store_true", help="Permite acesso direto no Wi-Fi de casa")
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--open", action="store_true", help="Abre o painel no navegador")
    parser.add_argument("--cert", help="Certificado TLS para HTTPS")
    parser.add_argument("--key", help="Chave privada TLS")
    args = parser.parse_args()
    if bool(args.cert) != bool(args.key):
        parser.error("Use --cert e --key juntos.")
    server = CasaServer(("0.0.0.0" if args.lan else "127.0.0.1", args.port))
    from .firestore import FirestoreSync
    server.cloud=FirestoreSync(server.controller.store)
    server.cloud.start()
    if args.cert:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(args.cert, args.key)
        server.socket = context.wrap_socket(server.socket, server_side=True)
        server.use_tls = True
    print(f"Casa Universal: {'https' if args.cert else 'http'}://127.0.0.1:{args.port}", flush=True)
    print("Disponível no Wi-Fi de casa." if args.lan else "Acesso apenas neste Mac. Use --lan para testar no iPhone.", flush=True)
    if args.open:
        import webbrowser
        webbrowser.open(f"{'https' if args.cert else 'http'}://127.0.0.1:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        if server.cloud:server.cloud.close()
        server.controller.close()
        server.server_close()


if __name__ == "__main__":
    main()
