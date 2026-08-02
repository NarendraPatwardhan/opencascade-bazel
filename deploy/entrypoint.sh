#!/bin/sh
# Fetch (or use baked) cad-demo-stage.tar.gz and serve it.
#
# Required unless STAGE_DIR already contains libocc_c.wasm:
#   CAD_RELEASE_URL=https://github.com/<owner>/<repo>/releases/download/<tag>/cad-demo-stage.tar.gz
#
# Private repos (this one is private): anonymous browser_download_url returns 404.
# Set GITHUB_TOKEN or GH_TOKEN (fine-grained: Contents read) so curl can auth.
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

auth_header() {
  tok="${GITHUB_TOKEN:-${GH_TOKEN:-}}"
  if [ -n "$tok" ]; then
    printf '%s' "Authorization: Bearer ${tok}"
  fi
}

download_release() {
  url="$1"
  out="$2"
  hdr="$(auth_header)"
  if [ -n "$hdr" ]; then
    echo "entrypoint: fetching (authenticated) ${url}"
    curl -fsSL --retry 3 --retry-delay 2 \
      -H "$hdr" \
      -H "Accept: application/octet-stream" \
      -o "$out" "$url"
  else
    echo "entrypoint: fetching ${url}"
    if ! curl -fsSL --retry 3 --retry-delay 2 -o "$out" "$url"; then
      echo "entrypoint: download failed." >&2
      echo "  If the GitHub repo is private, set GITHUB_TOKEN or GH_TOKEN" >&2
      echo "  (Contents: Read) — anonymous release URLs return HTTP 404." >&2
      echo "  CAD_RELEASE_URL=${url}" >&2
      return 1
    fi
  fi
}

if [ "$need_fetch" = "1" ]; then
  if [ -z "${CAD_RELEASE_URL:-}" ]; then
    echo "entrypoint: set CAD_RELEASE_URL to a GitHub Release cad-demo-stage.tar.gz URL" >&2
    exit 1
  fi
  mkdir -p "${STAGE_DIR}"
  tmp="/tmp/cad-demo-stage.tar.gz"
  if ! download_release "${CAD_RELEASE_URL}" "$tmp"; then
    exit 1
  fi
  # Basic sanity: gzip magic
  if ! gzip -t "$tmp" 2>/dev/null; then
    echo "entrypoint: downloaded file is not a valid gzip (wrong URL or HTML error page?)" >&2
    ls -la "$tmp" >&2
    head -c 200 "$tmp" >&2 || true
    exit 1
  fi
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
