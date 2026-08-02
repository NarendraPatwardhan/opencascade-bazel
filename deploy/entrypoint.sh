#!/bin/sh
# Fetch (or use baked) cad-demo-stage.tar.gz and serve it.
#
# This repo is private. GitHub returns 404 on anonymous (and often even on
# browser_download_url) for private release assets. Use the REST asset API:
#
#   GITHUB_TOKEN or GH_TOKEN   — PAT with Contents: Read
#   CAD_RELEASE_TAG            — e.g. demo-v0.1.0  (preferred with token)
#   CAD_RELEASE_REPO           — default NarendraPatwardhan/opencascade-bazel
#   CAD_RELEASE_ASSET          — default cad-demo-stage.tar.gz
#
# Or a direct API asset URL:
#   CAD_RELEASE_URL=https://api.github.com/repos/.../releases/assets/123
#
# Public repos may still use the browser download URL without a token.
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

need_fetch=1
if [ -f "${STAGE_DIR}/libocc_c.wasm" ] && [ -f "${STAGE_DIR}/demo/index.html" ]; then
  need_fetch=0
fi

token() {
  printf '%s' "${GITHUB_TOKEN:-${GH_TOKEN:-}}"
}

# Download $1 (URL) to $2. Uses Bearer auth when token is set.
# For api.github.com/.../releases/assets/ID, Accept: application/octet-stream is required.
curl_download() {
  url="$1"
  out="$2"
  tok="$(token)"
  if [ -n "$tok" ]; then
    echo "entrypoint: fetching (auth) ${url}"
    curl -fsSL --retry 3 --retry-delay 2 \
      -H "Authorization: Bearer ${tok}" \
      -H "Accept: application/octet-stream" \
      -H "X-GitHub-Api-Version: ${API_VERSION}" \
      -o "$out" "$url"
  else
    echo "entrypoint: fetching ${url}"
    curl -fsSL --retry 3 --retry-delay 2 -o "$out" "$url" || {
      echo "entrypoint: download failed (HTTP error)." >&2
      echo "  Private repos need GITHUB_TOKEN + CAD_RELEASE_TAG (API asset download)." >&2
      return 1
    }
  fi
}

# Resolve release tag + asset name → API asset download URL (…/releases/assets/{id}).
resolve_asset_api_url() {
  tok="$(token)"
  tag="$1"
  if [ -z "$tok" ]; then
    echo "entrypoint: CAD_RELEASE_TAG set but GITHUB_TOKEN/GH_TOKEN missing" >&2
    return 1
  fi
  meta="/tmp/release-meta.json"
  echo "entrypoint: resolve ${REPO} @ ${tag} asset ${ASSET_NAME}"
  curl -fsSL --retry 3 \
    -H "Authorization: Bearer ${tok}" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: ${API_VERSION}" \
    -o "$meta" \
    "${API}/repos/${REPO}/releases/tags/$(printf '%s' "$tag" | sed 's|/|%2F|g')"

  # Prefer node if present (alpine node image has it); else awk/sed-free python; else busybox sed.
  if command -v node >/dev/null 2>&1; then
    asset_id="$(node -e '
      const fs=require("fs");
      const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
      const want=process.argv[2];
      const a=(j.assets||[]).find(x=>x.name===want);
      if(!a){console.error("asset not found: "+want); process.exit(2);}
      process.stdout.write(String(a.id));
    ' "$meta" "$ASSET_NAME")"
  else
    echo "entrypoint: node required to parse release JSON" >&2
    return 1
  fi

  if [ -z "$asset_id" ]; then
    echo "entrypoint: could not resolve asset id for ${ASSET_NAME}" >&2
    return 1
  fi
  printf '%s' "${API}/repos/${REPO}/releases/assets/${asset_id}"
}

if [ "$need_fetch" = "1" ]; then
  tmp="/tmp/cad-demo-stage.tar.gz"
  mkdir -p "${STAGE_DIR}"

  download_url=""
  if [ -n "${CAD_RELEASE_TAG:-}" ]; then
    download_url="$(resolve_asset_api_url "${CAD_RELEASE_TAG}")"
  elif [ -n "${CAD_RELEASE_URL:-}" ]; then
    # If URL is a browser download path and we have a token, prefer resolving via API.
    case "${CAD_RELEASE_URL}" in
      *"/releases/download/"*)
        if [ -n "$(token)" ]; then
          # …/releases/download/<tag>/<file>
          tag_from_url="$(printf '%s' "${CAD_RELEASE_URL}" | sed -n 's|.*/releases/download/\([^/]*\)/.*|\1|p')"
          file_from_url="$(printf '%s' "${CAD_RELEASE_URL}" | sed -n 's|.*/releases/download/[^/]*/||p')"
          if [ -n "$tag_from_url" ]; then
            ASSET_NAME="${file_from_url:-$ASSET_NAME}"
            download_url="$(resolve_asset_api_url "$tag_from_url")"
          else
            download_url="${CAD_RELEASE_URL}"
          fi
        else
          download_url="${CAD_RELEASE_URL}"
        fi
        ;;
      *)
        download_url="${CAD_RELEASE_URL}"
        ;;
    esac
  else
    echo "entrypoint: set CAD_RELEASE_TAG=demo-v0.1.0 (and GITHUB_TOKEN) or CAD_RELEASE_URL" >&2
    exit 1
  fi

  if ! curl_download "$download_url" "$tmp"; then
    exit 1
  fi

  if ! gzip -t "$tmp" 2>/dev/null; then
    echo "entrypoint: downloaded file is not gzip (auth/URL wrong? first bytes:)" >&2
    head -c 200 "$tmp" >&2 || true
    echo >&2
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
