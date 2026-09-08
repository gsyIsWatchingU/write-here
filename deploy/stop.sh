#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="$PROJECT_DIR/run/server.pid"

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
