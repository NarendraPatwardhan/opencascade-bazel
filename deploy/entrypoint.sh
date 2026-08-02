#!/bin/sh
# Fetch private GitHub release stage tarball via REST API, then serve.
#
# Private repos: browser_download_url returns 404. Use API asset download:
#   GITHUB_TOKEN     — PAT Contents: Read
#   CAD_RELEASE_TAG  — e.g. demo-v0.1.0
# Optional: CAD_RELEASE_REPO, CAD_RELEASE_ASSET, CAD_RELEASE_URL (rewritten to API when token set)
set -eu

STAGE_DIR="${STAGE_DIR:-/app/stage}"
PORT="${PORT:-8765}"
HOST="${HOST:-0.0.0.0}"
export PORT HOST
export CACHE_MODE="${CACHE_MODE:-release}"

REPO="${CAD_RELEASE_REPO:-NarendraPatwardhan/opencascade-bazel}"
ASSET_NAME="${CAD_RELEASE_ASSET:-cad-demo-stage.tar.gz}"
API="https://api.github.com"
API_VERSION="2022-11-28"

log() { echo "entrypoint: $*" >&2; }

token() {
  printf '%s' "${GITHUB_TOKEN:-${GH_TOKEN:-}}"
}

# Desired release identity (tag preferred; else full URL). Used so changing
# CAD_RELEASE_TAG / CAD_RELEASE_URL forces a re-download even if stage exists.
release_want() {
  if [ -n "${CAD_RELEASE_TAG:-}" ]; then
    printf '%s\n' "${REPO}|${CAD_RELEASE_TAG}|${ASSET_NAME}"
  elif [ -n "${CAD_RELEASE_URL:-}" ]; then
    printf '%s\n' "${CAD_RELEASE_URL}"
  else
    printf '\n'
  fi
}

STAMP_FILE="${STAGE_DIR}/.release-stamp"
WANT="$(release_want | tr -d '\r\n')"
need_fetch=1
if [ -f "${STAGE_DIR}/libocc_c.wasm" ] && [ -f "${STAGE_DIR}/demo/index.html" ]; then
  # CACHE_MODE=persist: keep existing stage forever (dev only).
  # CACHE_MODE=release (default): re-fetch when tag/url stamp differs.
  if [ "${CACHE_MODE}" = "persist" ]; then
    need_fetch=0
    log "CACHE_MODE=persist — reusing existing stage"
  elif [ -n "$WANT" ] && [ -f "$STAMP_FILE" ] && [ "$(cat "$STAMP_FILE" 2>/dev/null | tr -d '\r\n')" = "$WANT" ]; then
    need_fetch=0
    log "stage stamp matches (${WANT}) — skip download"
  else
    log "stage missing or stamp mismatch — will fetch (want: ${WANT:-none})"
  fi
fi

curl_download() {
  url="$1"
  out="$2"
  tok="$(token)"
  if [ -n "$tok" ]; then
    log "fetching (auth) ${url}"
    curl -fsSL --retry 3 --retry-delay 2 \
      -H "Authorization: Bearer ${tok}" \
      -H "Accept: application/octet-stream" \
      -H "X-GitHub-Api-Version: ${API_VERSION}" \
      -o "$out" "$url"
  else
    log "fetching ${url}"
    curl -fsSL --retry 3 --retry-delay 2 -o "$out" "$url" || {
      log "download failed — private repos need GITHUB_TOKEN + CAD_RELEASE_TAG"
      return 1
    }
  fi
}

# Prints only the API asset URL on stdout (logs on stderr).
resolve_asset_api_url() {
  tok="$(token)"
  tag="$1"
  if [ -z "$tok" ]; then
    log "CAD_RELEASE_TAG set but GITHUB_TOKEN/GH_TOKEN missing"
    return 1
  fi
  meta="/tmp/release-meta.json"
  log "resolve ${REPO} @ ${tag} asset ${ASSET_NAME}"
  curl -fsSL --retry 3 \
    -H "Authorization: Bearer ${tok}" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: ${API_VERSION}" \
    -o "$meta" \
    "${API}/repos/${REPO}/releases/tags/${tag}"

  asset_id="$(node -e '
    const fs=require("fs");
    const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    const want=process.argv[2];
    const a=(j.assets||[]).find(x=>x.name===want);
    if(!a){ console.error("asset not found: "+want); process.exit(2); }
    process.stdout.write(String(a.id));
  ' "$meta" "$ASSET_NAME")"

  if [ -z "$asset_id" ]; then
    log "could not resolve asset id for ${ASSET_NAME}"
    return 1
  fi
  printf '%s\n' "${API}/repos/${REPO}/releases/assets/${asset_id}"
}

if [ "$need_fetch" = "1" ]; then
  tmp="/tmp/cad-demo-stage.tar.gz"
  mkdir -p "${STAGE_DIR}"

  download_url=""
  if [ -n "${CAD_RELEASE_TAG:-}" ]; then
    download_url="$(resolve_asset_api_url "${CAD_RELEASE_TAG}" | tr -d '\r\n')"
  elif [ -n "${CAD_RELEASE_URL:-}" ]; then
    case "${CAD_RELEASE_URL}" in
      *"/releases/download/"*)
        if [ -n "$(token)" ]; then
          tag_from_url="$(printf '%s' "${CAD_RELEASE_URL}" | sed -n 's|.*/releases/download/\([^/]*\)/.*|\1|p')"
          file_from_url="$(printf '%s' "${CAD_RELEASE_URL}" | sed -n 's|.*/releases/download/[^/]*/||p')"
          if [ -n "$tag_from_url" ]; then
            ASSET_NAME="${file_from_url:-$ASSET_NAME}"
            download_url="$(resolve_asset_api_url "$tag_from_url" | tr -d '\r\n')"
          else
            download_url="${CAD_RELEASE_URL}"
          fi
        else
          download_url="${CAD_RELEASE_URL}"
        fi
        ;;
      *"/releases/assets/"*)
        download_url="${CAD_RELEASE_URL}"
        ;;
      *)
        download_url="${CAD_RELEASE_URL}"
        ;;
    esac
  else
    log "set CAD_RELEASE_TAG=demo-v0.1.0 and GITHUB_TOKEN (or CAD_RELEASE_URL)"
    exit 1
  fi

  if [ -z "$download_url" ]; then
    log "empty download URL"
    exit 1
  fi

  if ! curl_download "$download_url" "$tmp"; then
    exit 1
  fi

  if ! gzip -t "$tmp" 2>/dev/null; then
    log "downloaded file is not gzip (first bytes:)"
    head -c 200 "$tmp" >&2 || true
    echo >&2
    exit 1
  fi

  rm -rf "${STAGE_DIR:?}/"*
  tar -xzf "$tmp" -C "${STAGE_DIR}"
  rm -f "$tmp"
fi

if [ ! -f "${STAGE_DIR}/libocc_c.wasm" ]; then
  log "stage missing libocc_c.wasm under ${STAGE_DIR}"
  exit 1
fi

export DEMO_ROOT="${DEMO_ROOT:-${STAGE_DIR}/demo}"
export AGENT_OS_ROOT="${AGENT_OS_ROOT:-${STAGE_DIR}}"

SERVE="${STAGE_DIR}/serve.mjs"
if [ ! -f "$SERVE" ]; then
  SERVE="${STAGE_DIR}/demo/serve.mjs"
fi
if [ ! -f "$SERVE" ]; then
  log "serve.mjs not found in stage"
  exit 1
fi

log "serving ${STAGE_DIR} on ${HOST}:${PORT}"
exec node "$SERVE"
