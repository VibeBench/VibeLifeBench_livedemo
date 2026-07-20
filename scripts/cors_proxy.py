#!/usr/bin/env python3
"""Tiny CORS proxy for browser → DeepSeek (github.io cannot call the API directly).

  export DEEPSEEK_API_KEY=sk-...   # optional; browser can still send its own key
  python scripts/cors_proxy.py     # http://127.0.0.1:8787

In the demo console set API Base to: http://127.0.0.1:8787
"""
from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

UPSTREAM = os.environ.get("DEEPSEEK_BASE", "https://api.deepseek.com").rstrip("/")
PORT = int(os.environ.get("PORT", "8787"))


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length)
        auth = self.headers.get("Authorization") or ""
        if not auth and os.environ.get("DEEPSEEK_API_KEY"):
            auth = "Bearer " + os.environ["DEEPSEEK_API_KEY"]
        url = UPSTREAM + self.path
        req = Request(url, data=body, method="POST")
        req.add_header("Content-Type", self.headers.get("Content-Type") or "application/json")
        if auth:
            req.add_header("Authorization", auth)
        try:
            with urlopen(req, timeout=300) as resp:
                data = resp.read()
                self.send_response(resp.status)
                self._cors()
                self.send_header("Content-Type", resp.headers.get("Content-Type") or "application/json")
                self.end_headers()
                self.wfile.write(data)
        except HTTPError as e:
            data = e.read()
            self.send_response(e.code)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(data or json.dumps({"error": str(e)}).encode())
        except URLError as e:
            self.send_response(502)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e.reason)}).encode())

    def log_message(self, fmt, *args):
        print("[proxy]", self.command, self.path, "-", fmt % args)


if __name__ == "__main__":
    httpd = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"CORS proxy → {UPSTREAM}")
    print(f"Listening on http://127.0.0.1:{PORT}")
    print("Set demo API Base to this URL.")
    httpd.serve_forever()
