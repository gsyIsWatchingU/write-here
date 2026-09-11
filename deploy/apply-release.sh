#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="${1:?缺少发布包目录}"
TARGET_DIR="${2:?缺少项目目录}"

SOURCE_DIR="$(cd "$SOURCE_DIR" && pwd -P)"
TARGET_DIR="$(cd "$TARGET_DIR" && pwd -P)"
EXPECTED_TARGET="${WRITE_HERE_DEPLOY_TARGET:-/workspace/projects/write-here}"

if [[ "$TARGET_DIR" != "$EXPECTED_TARGET" ]]; then
  echo "拒绝更新非预期目录：$TARGET_DIR" >&2
  exit 1
fi

NEW_MANIFEST="$SOURCE_DIR/.deploy-manifest"
OLD_MANIFEST="$TARGET_DIR/.deploy-manifest"

if [[ ! -f "$NEW_MANIFEST" ]]; then
  echo "发布包缺少 .deploy-manifest" >&2
  exit 1
fi

validate_path() {
  local relative_path="$1"

  if [[ -z "$relative_path" || "$relative_path" == /* || "$relative_path" == *".."* ]]; then
    echo "发布清单包含非法路径：$relative_path" >&2
    exit 1
  fi

  case "$relative_path" in
    db|db/*|logs|logs/*|run|run/*|node_modules|node_modules/*|*/node_modules|*/node_modules/*)
      echo "发布清单包含受保护路径：$relative_path" >&2
      exit 1
      ;;
  esac

  case "$relative_path" in
    .env|.env.*|*/.env|*/.env.*)
      if [[ "$relative_path" != *.example ]]; then
        echo "发布清单包含环境变量文件：$relative_path" >&2
        exit 1
      fi
      ;;
  esac
}

while IFS= read -r relative_path; do
  validate_path "$relative_path"
done < "$NEW_MANIFEST"

if [[ -f "$OLD_MANIFEST" ]]; then
  while IFS= read -r relative_path; do
    validate_path "$relative_path"
    if ! grep -Fqx -- "$relative_path" "$NEW_MANIFEST"; then
      rm -f -- "$TARGET_DIR/$relative_path"
    fi
  done < "$OLD_MANIFEST"
fi

tar -C "$SOURCE_DIR" --verbatim-files-from -cf - -T "$NEW_MANIFEST" | tar -C "$TARGET_DIR" -xf -
install -m 0644 "$NEW_MANIFEST" "$OLD_MANIFEST"
