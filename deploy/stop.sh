#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="$PROJECT_DIR/run/server.pid"
SUPERVISOR_CONFIG="${SUPERVISOR_CONFIG:-/workspace/etc/supervisord.conf}"

if command -v supervisorctl >/dev/null 2>&1 && supervisorctl -c "$SUPERVISOR_CONFIG" status write-here 2>/dev/null | grep -q '^write-here'; then
  supervisorctl -c "$SUPERVISOR_CONFIG" stop cloudflared-write-here write-here
  echo "WriteHere 与公网隧道已由 Supervisor 停止"
  exit 0
fi

if [[ ! -f "$PID_FILE" ]]; then
  echo "未找到运行中的 WriteHere 进程"
  exit 0
fi

SERVER_PID="$(cat "$PID_FILE")"
if kill -0 "$SERVER_PID" 2>/dev/null; then
  kill "$SERVER_PID"
  echo "WriteHere 已停止，PID=$SERVER_PID"
else
  echo "WriteHere 进程已不在运行"
fi

rm -f "$PID_FILE"
