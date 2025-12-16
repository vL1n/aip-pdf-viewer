#!/usr/bin/env sh
set -eu

ROOT="${AIP_ROOT:-/data}"
STATE_DIR="${AIP_STATE_DIR:-/state}"
DB="${AIP_DB:-${STATE_DIR}/index.sqlite}"
FAV_DB="${AIP_FAV_DB:-${STATE_DIR}/favorites.sqlite}"
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-13001}"

SERVE_WEB="${AIP_SERVE_WEB:-1}"
WEB_DIST="${AIP_WEB_DIST:-/app/web}"
REBUILD_DB="${AIP_REBUILD_DB:-0}"

if [ ! -d "${ROOT}" ]; then
  echo "[docker] AIP_ROOT 不存在或未挂载：${ROOT}" >&2
  echo "[docker] 运行示例：" >&2
  echo "  docker run --rm -p 13001:13001 -v \"/你的/eaip根目录:/data:ro\" -v \"$(pwd)/state:/state\" eaip-pdf-viewer:local" >&2
  exit 1
fi

mkdir -p "${STATE_DIR}"

ARGS="--root \"${ROOT}\" --db \"${DB}\" --fav-db \"${FAV_DB}\" --host \"${HOST}\" --port \"${PORT}\""
if [ "${REBUILD_DB}" = "1" ]; then
  ARGS="${ARGS} --rebuild-db"
fi
if [ "${SERVE_WEB}" != "0" ]; then
  ARGS="${ARGS} --serve-web --web-dist \"${WEB_DIST}\""
fi

echo "[docker] 启动 aip-server：root=${ROOT} port=${PORT} db=${DB} favDb=${FAV_DB} serveWeb=${SERVE_WEB}" >&2

# shellcheck disable=SC2086
exec sh -lc "node /app/packages/server/dist/index.js ${ARGS} $*"

