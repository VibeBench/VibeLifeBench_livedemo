#!/usr/bin/env bash
# Local debug server for the drip-commerce cockpit (does not touch github.io).
#
# Usage:
#   ./start_ecom.sh              # http://127.0.0.1:8081/?scenario=ecom
#   PORT=8090 ./start_ecom.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

PORT="${PORT:-8081}"
PYTHON="${PYTHON:-python3}"
if ! command -v "$PYTHON" >/dev/null 2>&1; then
  PYTHON=python
fi

URL="http://127.0.0.1:${PORT}/?scenario=ecom"
echo "==> Ecom debug:  ${URL}"
echo "    (travel:     http://127.0.0.1:${PORT}/?scenario=travel )"
echo "    Ctrl+C to stop."
echo ""
exec "$PYTHON" -m http.server "$PORT" --bind 127.0.0.1
