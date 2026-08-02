#!/bin/sh
# Fetch (or use baked) cad-demo-stage.tar.gz and serve it.
# Required unless STAGE_DIR already contains libocc_c.wasm:
#   CAD_RELEASE_URL=https://github.com/<owner>/<repo>/releases/download/<tag>/cad-demo-stage.tar.gz
set -eu

STAGE_DIR="${STAGE_DIR:-/app/stage}"
PORT="${PORT:-8765}"
HOST="${HOST:-0.0.0.0}"
export PORT HOST
export CACHE_MODE="${CACHE_MODE:-release}"

need_fetch=1
if [ -f "${STAGE_DIR}/libocc_c.wasm" ] && [ -f "${STAGE_DIR}/demo/index.html" ]; then
  need_fetch=0
fi

if [ "$need_fetch" = "1" ]; then
  if [ -z "${CAD_RELEASE_URL:-}" ]; then
    echo "entrypoint: set CAD_RELEASE_URL to a GitHub Release cad-demo-stage.tar.gz URL" >&2
    echo "  example: https://github.com/NarendraPatwardhan/opencascade-bazel/releases/download/demo-v0.1.0/cad-demo-stage.tar.gz" >&2
    exit 1
  fi
  echo "entrypoint: fetching ${CAD_RELEASE_URL}"
  mkdir -p "${STAGE_DIR}"
  tmp="/tmp/cad-demo-stage.tar.gz"
  curl -fsSL --retry 3 --retry-delay 2 -o "$tmp" "${CAD_RELEASE_URL}"
  # Wipe previous partial extract
  rm -rf "${STAGE_DIR:?}/"*
  tar -xzf "$tmp" -C "${STAGE_DIR}"
  rm -f "$tmp"
fi

if [ ! -f "${STAGE_DIR}/libocc_c.wasm" ]; then
  echo "entrypoint: stage missing libocc_c.wasm under ${STAGE_DIR}" >&2
  exit 1
fi

export DEMO_ROOT="${DEMO_ROOT:-${STAGE_DIR}/demo}"
export AGENT_OS_ROOT="${AGENT_OS_ROOT:-${STAGE_DIR}}"

SERVE="${STAGE_DIR}/serve.mjs"
if [ ! -f "$SERVE" ]; then
  SERVE="${STAGE_DIR}/demo/serve.mjs"
fi
if [ ! -f "$SERVE" ]; then
  echo "entrypoint: serve.mjs not found in stage" >&2
  exit 1
fi

echo "entrypoint: serving ${STAGE_DIR} on ${HOST}:${PORT}"
exec node "$SERVE"
