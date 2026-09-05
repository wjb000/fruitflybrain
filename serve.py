#!/usr/bin/env python3
"""Serve the live connectome UI and the MuJoCo body plant."""

from __future__ import annotations

import argparse
import functools
import json
import os
import sys
import threading
import traceback
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(ROOT, "web")

_plant = None
_plant_err = None
_init_lock = threading.Lock()


def get_plant():
    global _plant, _plant_err
    with _init_lock:
        if _plant is not None or _plant_err:
            return _plant, _plant_err
        try:
            from physics import Plant

            _plant = Plant()
        except Exception as e:
            _plant_err = f"{type(e).__name__}: {e}"
            traceback.print_exc()
        return _plant, _plant_err


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".bin": "application/octet-stream",
        ".mesh": "application/octet-stream",
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".json": "application/json",
        ".wasm": "application/wasm",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if self.path.split("?", 1)[0] == "/physics/health":
            plant, err = get_plant()
            if plant is None:
                return self._json({"ok": False, "error": err or "no plant"}, 503)
            return self._json(plant.health())
        return super().do_GET()

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if not path.startswith("/physics/"):
            self.send_error(404)
            return
        plant, err = get_plant()
        if plant is None:
            return self._json({"ok": False, "error": err or "no plant"}, 503)
        try:
            body = self._read_json()
            if path == "/physics/spawn":
                pose = plant.spawn(
                    str(body["id"]),
                    float(body.get("x") or 0),
                    float(body.get("z") or 0),
                    float(body.get("yaw") or 0),
                )
                return self._json({"ok": True, "pose": pose})
            if path == "/physics/despawn":
                plant.despawn(str(body["id"]))
                return self._json({"ok": True})
            if path == "/physics/reset":
                pose = plant.reset(
                    str(body["id"]),
                    float(body.get("x") or 0),
                    float(body.get("z") or 0),
                    float(body.get("yaw") or 0),
                )
                return self._json({"ok": True, "pose": pose})
            if path == "/physics/step":
                flies = plant.step(float(body.get("dt") or 0.016), body.get("flies") or {})
                return self._json({"ok": True, "flies": flies})
            return self._json({"ok": False, "error": "unknown physics route"}, 404)
        except Exception as e:
            traceback.print_exc()
            return self._json({"ok": False, "error": f"{type(e).__name__}: {e}"}, 500)

    def _read_json(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b"{}"
        if not raw:
            return {}
        return json.loads(raw.decode("utf-8"))

    def _json(self, obj, code=200):
        data = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        SimpleHTTPRequestHandler.end_headers(self)
        self.wfile.write(data)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8787)
    ap.add_argument("--no-open", action="store_true")
    args = ap.parse_args()

    needed = os.path.join(WEB, "data", "connectome.bin")
    if not os.path.exists(needed):
        sys.exit("Missing web/data/connectome.bin — run:  python prepare.py")

    handler = functools.partial(Handler, directory=WEB)
    httpd = ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    url = f"http://127.0.0.1:{args.port}/"
    print(f"Male CNS simulation  {url}", flush=True)
    print("MuJoCo plant          /physics/health", flush=True)
    if not args.no_open:
        webbrowser.open(url)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")


if __name__ == "__main__":
    main()
