#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

PORT="${HERMES_BRIDGE_PORT:-18765}"
PID="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
if [[ -n "$PID" ]]; then
  echo "Bridge already listening on port $PORT (pid: $PID)"
  exit 0
fi

nohup /opt/homebrew/bin/node bridge/server.js > /tmp/edge-hermes-copilot.log 2>&1 &
echo $! > /tmp/edge-hermes-copilot.pid
echo "Started bridge pid $(cat /tmp/edge-hermes-copilot.pid)"
echo "Log: /tmp/edge-hermes-copilot.log"
