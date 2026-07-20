#!/usr/bin/env python3
"""CORS proxy for browser → any OpenAI-compatible Chat Completions API.

  python scripts/cors_proxy.py     # http://127.0.0.1:8787

Demo console:
  - API Base = http://127.0.0.1:8787
  - Send header X-Upstream-Base: https://api.deepseek.com  (or openai / openrouter / …)
  - Or set env UPSTREAM / DEEPSEEK_BASE as the default upstream
"""
from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

DEFAULT_UPSTREAM = os.environ.get("UPSTREAM") or os.environ.get("DEEPSEEK_BASE") or "https://api.deepseek.com"
DEFAULT_UPSTREAM = DEFAULT_UPSTREAM.rstrip("/")
PORT = int(os.environ.get("PORT", "8787"))
ALLOWED_UPSTREAM_HOSTS = {
    "api.deepseek.com",
    "api.openai.com",
    "openrouter.ai",
    "api.siliconflow.cn",
    "api.moonshot.cn",
    "dashscope.aliyuncs.com",
    "127.0.0.1",
    "localhost",
}


def _host_ok(url: str) -> bool:
    try:
        from urllib.parse import urlparse

        host = (urlparse(url).hostname or "").lower()
        if host in ALLOWED_UPSTREAM_HOSTS:
            return True
        # allow *.openrouter.ai etc. for known suffixes
        return any(host.endswith("." + h) for h in ALLOWED_UPSTREAM_HOSTS if "." in h)
    except Exception:
        return False


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header(
            "Access-Control-Allow-Headers",
            "Authorization, Content-Type, X-Upstream-Base, HTTP-Referer, X-Title",
        )
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Expose-Headers", "X-Proxy-Upstream")

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
        if not auth and os.environ.get("OPENAI_API_KEY"):
            auth = "Bearer " + os.environ["OPENAI_API_KEY"]

        upstream = (self.headers.get("X-Upstream-Base") or DEFAULT_UPSTREAM).rstrip("/")
        if not _host_ok(upstream):
            self.send_response(400)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": f"upstream host not allowed: {upstream}"}).encode())
            return

        url = upstream + self.path
        req = Request(url, data=body, method="POST")
        req.add_header("Content-Type", self.headers.get("Content-Type") or "application/json")
        if auth:
            req.add_header("Authorization", auth)
        # Pass through optional OpenRouter headers
        for h in ("HTTP-Referer", "X-Title", "X-Title"):
            if self.headers.get(h):
                req.add_header(h, self.headers.get(h))
        referer = self.headers.get("Referer") or self.headers.get("HTTP-Referer")
        if referer and not self.headers.get("HTTP-Referer"):
            req.add_header("HTTP-Referer", referer)

        try:
            with urlopen(req, timeout=300) as resp:
                data = resp.read()
                self.send_response(resp.status)
                self._cors()
                self.send_header("Content-Type", resp.headers.get("Content-Type") or "application/json")
                self.send_header("X-Proxy-Upstream", upstream)
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
    print(f"CORS proxy default upstream → {DEFAULT_UPSTREAM}")
    print(f"Listening on http://127.0.0.1:{PORT}")
    print("Browser may send X-Upstream-Base to override per request.")
    httpd.serve_forever()
