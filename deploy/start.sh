#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_HOME="${NODE_HOME:-/workspace/.tools/node-v20}"
PORT="${PORT:-3210}"

export PATH="$NODE_HOME/bin:$PATH"
cd "$PROJECT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "未找到 Node.js，请先安装到 $NODE_HOME" >&2
  exit 1
fi

npm ci --prefix frontend
npm run build --prefix frontend
npm ci --omit=dev --prefix backend

mkdir -p db logs run

if [[ -f run/server.pid ]]; then
  OLD_PID="$(cat run/server.pid)"
  if kill -0 "$OLD_PID" 2>/dev/null; then
    kill "$OLD_PID"
    for _ in {1..20}; do
      kill -0 "$OLD_PID" 2>/dev/null || break
      sleep 0.25
    done
  fi
fi

HOST=0.0.0.0 PORT="$PORT" nohup node backend/server.js > logs/server.log 2>&1 &
SERVER_PID=$!
echo "$SERVER_PID" > run/server.pid

for _ in {1..30}; do
  if curl --fail --silent "http://127.0.0.1:$PORT/health" >/dev/null; then
    echo "WriteHere 已启动，PID=$SERVER_PID，端口=$PORT"
    exit 0
  fi
  sleep 1
done

echo "服务启动失败，最近日志：" >&2
tail -n 50 logs/server.log >&2
exit 1
