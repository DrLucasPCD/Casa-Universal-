"""Keep Samsung's authorized websocket open between button presses."""
import logging
import threading

logging.getLogger("samsungtvws").setLevel(logging.CRITICAL)


class TVSession:
    def __init__(self, config, save_token, timeout=8):
        from samsungtvws import SamsungTVWS
        self.tv = SamsungTVWS(host=config["ip"], port=config["port"], token=config.get("token"), name="Casa Universal", timeout=timeout)
        self.save_token = save_token
        self.stop = threading.Event()
        try:
            self.tv.open()
            if self.tv.token:
                save_token(self.tv.token)
            self.identity = (config["ip"], config["port"], self.tv.token)
            self.thread = threading.Thread(target=self._receive, daemon=True)
            self.thread.start()
        except Exception:
            self.tv.close()
            raise

    def _receive(self):
        from websocket import WebSocketTimeoutException
        import json
        connection = self.tv.connection
        while not self.stop.is_set() and connection and connection.connected:
            try:
                raw = connection.recv()
                if not raw:
                    break
                response = json.loads(raw)
                token = response.get("data", {}).get("token")
                if token and token != self.tv.token:
                    self.tv.token = token
                    self.save_token(token)
                    self.identity = (self.tv.host, self.tv.port, token)
            except WebSocketTimeoutException:
                try:
                    connection.ping()
                except Exception:
                    break
            except Exception:
                break
        if connection:
            connection.close()

    def alive(self):
        return self.tv.is_alive() and not self.stop.is_set()

    def close(self):
        self.stop.set()
        self.tv.close()

    def send_key(self, key):
        self.tv.send_key(key)
