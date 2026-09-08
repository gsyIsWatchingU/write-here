#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUPERVISOR_CONFIG="${SUPERVISOR_CONFIG:-/workspace/etc/supervisord.conf}"
NODE_HOME="${NODE_HOME:-/workspace/.tools/node-v20}"

cd "$PROJECT_DIR"

for _ in {1..9}; do
  APP_STATE="$(supervisorctl -c "$SUPERVISOR_CONFIG" status write-here | awk '{print $2}')"
  TUNNEL_STATE="$(supervisorctl -c "$SUPERVISOR_CONFIG" status cloudflared-write-here | awk '{print $2}')"
  if [[ "$APP_STATE" == "RUNNING" && "$TUNNEL_STATE" == "RUNNING" ]] && bash deploy/public-url.sh >/dev/null 2>&1; then
    break
  fi
  sleep 5
done

supervisorctl -c "$SUPERVISOR_CONFIG" status write-here cloudflared-write-here
PUBLIC_URL="$(bash deploy/public-url.sh)"
echo "公网地址：$PUBLIC_URL"

export PATH="$NODE_HOME/bin:$PATH"
BASE_URL="$PUBLIC_URL" node deploy/verify.js
