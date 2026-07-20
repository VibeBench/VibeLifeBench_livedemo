#!/usr/bin/env bash
# Start the VibeLifeBench travel-agent demo (static server + DeepSeek CORS proxy).
#
# Usage:
#   ./start.sh              # http://127.0.0.1:8080  + proxy :8787
#   ./start.sh --no-proxy   # static only
#   PORT=8090 PROXY_PORT=8788 ./start.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

PORT="${PORT:-8080}"
PROXY_PORT="${PROXY_PORT:-8787}"
WITH_PROXY=1
for arg in "$@"; do
  case "$arg" in
    --no-proxy) WITH_PROXY=0 ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
  esac
done

PYTHON="${PYTHON:-python3}"
if ! command -v "$PYTHON" >/dev/null 2>&1; then
  PYTHON=python
fi

pids=()
cleanup() {
  for pid in "${pids[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT INT TERM

echo "==> Demo static:  http://127.0.0.1:${PORT}/"
"$PYTHON" -m http.server "$PORT" --bind 127.0.0.1 &
pids+=($!)

if [[ "$WITH_PROXY" -eq 1 ]]; then
  echo "==> CORS proxy:   http://127.0.0.1:${PROXY_PORT}/  (console API Base)"
  PORT="$PROXY_PORT" "$PYTHON" "$ROOT/scripts/cors_proxy.py" &
  pids+=($!)
  echo ""
  echo "Open the demo, then in 演示控制台 set:"
  echo "  API Base = http://127.0.0.1:${PROXY_PORT}"
else
  echo ""
  echo "(proxy skipped — browser may hit DeepSeek CORS; use -- without --no-proxy for local API)"
fi

echo ""
echo "Ctrl+C to stop."
wait
