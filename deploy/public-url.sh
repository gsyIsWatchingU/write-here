#!/usr/bin/env bash
set -euo pipefail

LOG_DIR="/workspace/projects/write-here/logs"
PUBLIC_URL="$(grep -Eho 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG_DIR"/cloudflared.out.log "$LOG_DIR"/cloudflared.err.log 2>/dev/null | tail -1 || true)"

if [[ -z "$PUBLIC_URL" ]]; then
  echo "尚未发现公网地址，请检查 cloudflared-write-here 状态和日志。" >&2
  exit 1
fi

echo "$PUBLIC_URL"
