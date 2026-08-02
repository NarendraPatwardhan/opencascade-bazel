#!/bin/sh
# Fetch private GitHub release stage tarball via REST API, then serve.
#
# Recommended Dokploy env (no tag churn):
#   GITHUB_TOKEN          — PAT Contents: Read (private repo)
#   CAD_RELEASE_TAG=latest  (default) — pick newest release matching CAD_RELEASE_PREFIX
#   CAD_RELEASE_PREFIX=demo-v
#
# Pin a tag only if you must freeze:
#   CAD_RELEASE_TAG=demo-v0.3.1
#
# Private repos: browser_download_url is 404. Always use API asset download.
set -eu

STAGE_DIR="${STAGE_DIR:-/app/stage}"
PORT="${PORT:-8765}"
HOST="${HOST:-0.0.0.0}"
export PORT HOST
export CACHE_MODE="${CACHE_MODE:-release}"

REPO="${CAD_RELEASE_REPO:-NarendraPatwardhan/opencascade-bazel}"
ASSET_NAME="${CAD_RELEASE_ASSET:-cad-demo-stage.tar.gz}"
# "latest" | "latest-demo" | empty → resolve via API; concrete tag otherwise
TAG_RAW="${CAD_RELEASE_TAG:-latest}"
PREFIX="${CAD_RELEASE_PREFIX:-demo-v}"
API="https://api.github.com"
API_VERSION="2022-11-28"

log() { echo "entrypoint: $*" >&2; }

token() {
  printf '%s' "${GITHUB_TOKEN:-${GH_TOKEN:-}}"
}

# Resolve CAD_RELEASE_TAG=latest → concrete tag name (stdout only).
resolve_concrete_tag() {
  raw="$1"
  case "$raw" in
    ""|latest|LATEST|latest-demo|auto)
      tok="$(token)"
      if [ -z "$tok" ]; then
        log "latest resolution needs GITHUB_TOKEN"
        return 1
      fi
      meta="/tmp/releases-list.json"
      log "resolve latest release tag repo=${REPO} prefix=${PREFIX} asset=${ASSET_NAME}"
      # per_page=30 is enough; we pick the first matching non-draft with the asset.
      curl -fsSL --retry 3 \
        -H "Authorization: Bearer ${tok}" \
        -H "Accept: application/vnd.github+json" \
        -H "X-GitHub-Api-Version: ${API_VERSION}" \
        -o "$meta" \
        "${API}/repos/${REPO}/releases?per_page=30"

      # Sort by created_at ourselves — GitHub often returns the non-prerelease
      # "latest" first even when newer prereleases exist (our demo-v* stream).
      tag="$(node -e '
        const fs = require("fs");
        const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
        const prefix = process.argv[2];
        const asset = process.argv[3];
        if (!Array.isArray(j)) {
          console.error("releases list is not an array");
          process.exit(2);
        }
        const candidates = j
          .filter((rel) => !rel.draft)
          .filter((rel) => {
            const t = String(rel.tag_name || "");
            if (prefix && !t.startsWith(prefix)) return false;
            return (rel.assets || []).some((a) => a.name === asset);
          })
          .sort((a, b) => {
            const ta = Date.parse(a.created_at || a.published_at || 0);
            const tb = Date.parse(b.created_at || b.published_at || 0);
            return tb - ta;
          });
        if (!candidates.length) {
          console.error("no release found matching prefix=" + prefix + " asset=" + asset);
          process.exit(2);
        }
        process.stdout.write(String(candidates[0].tag_name));
      ' "$meta" "$PREFIX" "$ASSET_NAME")"
      if [ -z "$tag" ]; then
        log "could not resolve latest tag"
        return 1
      fi
      log "latest matching tag: ${tag}"
      printf '%s\n' "$tag"
      ;;
    *)
      printf '%s\n' "$raw"
      ;;
  esac
}

# Tag from CAD_RELEASE_URL if set and TAG is latest/empty.
tag_from_url() {
  printf '%s' "${CAD_RELEASE_URL:-}" | sed -n 's|.*/releases/download/\([^/]*\)/.*|\1|p'
}

CONCRETE_TAG=""
if [ -n "${CAD_RELEASE_URL:-}" ] && { [ -z "${CAD_RELEASE_TAG:-}" ] || [ "${CAD_RELEASE_TAG}" = "latest" ]; }; then
  # URL pin without explicit tag: use tag embedded in URL (still needs token for private).
  u_tag="$(tag_from_url)"
  if [ -n "$u_tag" ] && [ "$u_tag" != "latest" ]; then
    CONCRETE_TAG="$u_tag"
    log "tag from CAD_RELEASE_URL: ${CONCRETE_TAG}"
  fi
fi
if [ -z "$CONCRETE_TAG" ]; then
  CONCRETE_TAG="$(resolve_concrete_tag "$TAG_RAW" | tr -d '\r\n')"
fi
if [ -z "$CONCRETE_TAG" ]; then
  log "could not determine release tag (set GITHUB_TOKEN; CAD_RELEASE_TAG=latest or a concrete tag)"
  exit 1
fi

# Stamp identity is always the concrete tag so "latest" re-fetches when a new demo-v* appears.
WANT="${REPO}|${CONCRETE_TAG}|${ASSET_NAME}"
STAMP_FILE="${STAGE_DIR}/.release-stamp"

need_fetch=1
if [ -f "${STAGE_DIR}/libocc_c.wasm" ] && [ -f "${STAGE_DIR}/demo/index.html" ]; then
  if [ "${CACHE_MODE}" = "persist" ]; then
    need_fetch=0
    log "CACHE_MODE=persist — reusing existing stage"
  elif [ -f "$STAMP_FILE" ] && [ "$(cat "$STAMP_FILE" 2>/dev/null | tr -d '\r\n')" = "$WANT" ]; then
    need_fetch=0
    log "stage stamp matches (${WANT}) — skip download"
  else
    log "stage missing or stamp mismatch — will fetch (want: ${WANT})"
  fi
else
  log "stage incomplete — will fetch (want: ${WANT})"
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
      log "download failed — private repos need GITHUB_TOKEN"
      return 1
    }
  fi
}

# Prints only the API asset URL on stdout (logs on stderr).
resolve_asset_api_url() {
  tok="$(token)"
  tag="$1"
  if [ -z "$tok" ]; then
    log "GITHUB_TOKEN/GH_TOKEN required for private release download"
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

  download_url="$(resolve_asset_api_url "${CONCRETE_TAG}" | tr -d '\r\n')"
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
  printf '%s\n' "$WANT" > "${STAMP_FILE}"
  log "wrote stamp ${WANT}"
fi

if [ ! -f "${STAGE_DIR}/libocc_c.wasm" ]; then
  log "stage missing libocc_c.wasm under ${STAGE_DIR}"
  exit 1
fi

if [ -f "${STAGE_DIR}/demo/index.html" ]; then
  if grep -q 'history-trigger' "${STAGE_DIR}/demo/index.html" 2>/dev/null; then
    log "stage UI: history-trigger present (demo-v0.3+)"
  else
    log "stage UI: no history-trigger — OLD stage (pre-history)"
  fi
fi

export DEMO_ROOT="${DEMO_ROOT:-${STAGE_DIR}/demo}"
export AGENT_OS_ROOT="${AGENT_OS_ROOT:-${STAGE_DIR}}"
export CAD_RESOLVED_TAG="${CONCRETE_TAG}"

# Fingerprint for GET /version (and operators grepping logs).
{
  echo "tag=${CONCRETE_TAG}"
  echo "resolved_at_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if [ -f "${STAGE_DIR}/STAGE_INFO.txt" ]; then
    cat "${STAGE_DIR}/STAGE_INFO.txt"
  fi
  if [ -f "${STAGE_DIR}/demo/index.html" ]; then
    entry="$(grep -oE '/agent-os/src/main[^"]+\.js' "${STAGE_DIR}/demo/index.html" | head -1 || true)"
    echo "html_entry=${entry:-unknown}"
  fi
} > "${STAGE_DIR}/VERSION"
log "VERSION file:"
cat "${STAGE_DIR}/VERSION" >&2 || true

SERVE="${STAGE_DIR}/serve.mjs"
if [ ! -f "$SERVE" ]; then
  SERVE="${STAGE_DIR}/demo/serve.mjs"
fi
if [ ! -f "$SERVE" ]; then
  log "serve.mjs not found in stage"
  exit 1
fi

# Guard: old stages still long-cache bare main.js — refuse silently shipping them
# without a content-addressed entry when CAD_REQUIRE_HASHED_ENTRY=1 (optional).
if [ "${CAD_REQUIRE_HASHED_ENTRY:-0}" = "1" ]; then
  if ! grep -qE 'main\.[a-f0-9]{8,}\.js' "${STAGE_DIR}/demo/index.html" 2>/dev/null; then
    log "ERROR: index.html has no content-addressed main.<hash>.js entry (stage too old)"
    exit 1
  fi
fi

log "serving ${STAGE_DIR} tag=${CONCRETE_TAG} on ${HOST}:${PORT}"
log "probe after deploy: curl -sS https://<host>/version"
exec node "$SERVE"
