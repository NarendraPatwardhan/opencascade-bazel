#!/bin/sh
# Fetch private GitHub release stage tarball via REST API, then serve.
#
# Dokploy env (set once — never touch per release):
#   GITHUB_TOKEN            — PAT Contents: Read (private repo)
#   CAD_RELEASE_TAG=latest  — newest demo-v* with the stage asset
#   CAD_RELEASE_PREFIX=demo-v
#
# After ./scripts/release-demo.sh --tag demo-v… : restart the container.
# Entrypoint re-resolves latest and re-fetches when the asset stamp changes.
#
# Pin only to freeze: CAD_RELEASE_TAG=demo-v0.3.4
set -eu

STAGE_DIR="${STAGE_DIR:-/app/stage}"
PORT="${PORT:-8765}"
HOST="${HOST:-0.0.0.0}"
export PORT HOST
export CACHE_MODE="${CACHE_MODE:-release}"

REPO="${CAD_RELEASE_REPO:-NarendraPatwardhan/opencascade-bazel}"
ASSET_NAME="${CAD_RELEASE_ASSET:-cad-demo-stage.tar.gz}"
TAG_RAW="${CAD_RELEASE_TAG:-latest}"
PREFIX="${CAD_RELEASE_PREFIX:-demo-v}"
API="https://api.github.com"
API_VERSION="2022-11-28"

log() { echo "entrypoint: $*" >&2; }

token() {
  printf '%s' "${GITHUB_TOKEN:-${GH_TOKEN:-}}"
}

is_floating_tag() {
  case "$1" in
    ""|latest|LATEST|latest-demo|auto) return 0 ;;
    *) return 1 ;;
  esac
}

# → "tag_name\tasset_id\tupdated_at_ms" on stdout
resolve_latest_release() {
  tok="$(token)"
  if [ -z "$tok" ]; then
    log "latest resolution needs GITHUB_TOKEN"
    return 1
  fi
  meta="/tmp/releases-list.json"
  log "resolve latest release tag repo=${REPO} prefix=${PREFIX} asset=${ASSET_NAME}"
  curl -fsSL --retry 3 \
    -H "Authorization: Bearer ${tok}" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: ${API_VERSION}" \
    -o "$meta" \
    "${API}/repos/${REPO}/releases?per_page=30"

  node -e '
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
      .map((rel) => {
        const a = (rel.assets || []).find((x) => x.name === asset);
        if (!a) return null;
        const t = String(rel.tag_name || "");
        if (prefix && !t.startsWith(prefix)) return null;
        return {
          tag: t,
          assetId: a.id,
          ts: Date.parse(a.updated_at || a.created_at || rel.published_at || rel.created_at || 0),
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.ts - a.ts);
    if (!candidates.length) {
      console.error("no release found matching prefix=" + prefix + " asset=" + asset);
      process.exit(2);
    }
    const c = candidates[0];
    process.stdout.write(c.tag + "\t" + c.assetId + "\t" + c.ts);
  ' "$meta" "$PREFIX" "$ASSET_NAME"
}

# → "tag\tasset_id\tupdated_at_ms"
resolve_pinned_release() {
  tag="$1"
  tok="$(token)"
  if [ -z "$tok" ]; then
    log "GITHUB_TOKEN required for private release download"
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

  node -e '
    const fs = require("fs");
    const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const want = process.argv[2];
    const tag = process.argv[3];
    const a = (j.assets || []).find((x) => x.name === want);
    if (!a) {
      console.error("asset not found: " + want);
      process.exit(2);
    }
    const ts = Date.parse(a.updated_at || a.created_at || j.published_at || j.created_at || 0);
    process.stdout.write(tag + "\t" + a.id + "\t" + ts);
  ' "$meta" "$ASSET_NAME" "$tag"
}

if is_floating_tag "$TAG_RAW"; then
  resolved="$(resolve_latest_release | tr -d '\r')"
else
  resolved="$(resolve_pinned_release "$TAG_RAW" | tr -d '\r')"
fi

CONCRETE_TAG="$(printf '%s' "$resolved" | cut -f1)"
ASSET_ID="$(printf '%s' "$resolved" | cut -f2)"
ASSET_TS="$(printf '%s' "$resolved" | cut -f3)"

if [ -z "$CONCRETE_TAG" ] || [ -z "$ASSET_ID" ]; then
  log "could not determine release (GITHUB_TOKEN + CAD_RELEASE_TAG=latest)"
  exit 1
fi

if is_floating_tag "$TAG_RAW"; then
  log "latest matching tag: ${CONCRETE_TAG} asset_id=${ASSET_ID}"
else
  log "pinned tag: ${CONCRETE_TAG} asset_id=${ASSET_ID}"
fi

# Stamp includes asset id + update time so new tags and re-uploads re-fetch.
WANT="${REPO}|${CONCRETE_TAG}|${ASSET_NAME}|${ASSET_ID}|${ASSET_TS}"
STAMP_FILE="${STAGE_DIR}/.release-stamp"
POLL_SECONDS="${CAD_POLL_SECONDS:-90}"

fetch_stage() {
  tmp="/tmp/cad-demo-stage.tar.gz"
  mkdir -p "${STAGE_DIR}"
  download_url="${API}/repos/${REPO}/releases/assets/${ASSET_ID}"
  tok="$(token)"
  if [ -z "$tok" ]; then
    log "GITHUB_TOKEN required for private release download"
    return 1
  fi
  log "fetching (auth) ${download_url}"
  curl -fsSL --retry 3 --retry-delay 2 \
    -H "Authorization: Bearer ${tok}" \
    -H "Accept: application/octet-stream" \
    -H "X-GitHub-Api-Version: ${API_VERSION}" \
    -o "$tmp" "$download_url"

  if ! gzip -t "$tmp" 2>/dev/null; then
    log "downloaded file is not gzip (first bytes:)"
    head -c 200 "$tmp" >&2 || true
    echo >&2
    return 1
  fi

  rm -rf "${STAGE_DIR:?}/"*
  tar -xzf "$tmp" -C "${STAGE_DIR}"
  rm -f "$tmp"
  printf '%s\n' "$WANT" > "${STAMP_FILE}"
  log "wrote stamp ${WANT}"
}

ensure_stage() {
  need_fetch=1
  if [ -f "${STAGE_DIR}/libocc_c.wasm" ] && [ -f "${STAGE_DIR}/demo/index.html" ]; then
    if [ "${CACHE_MODE}" = "persist" ]; then
      need_fetch=0
      log "CACHE_MODE=persist — reusing existing stage"
    elif [ -f "$STAMP_FILE" ] && [ "$(cat "$STAMP_FILE" 2>/dev/null | tr -d '\r\n')" = "$WANT" ]; then
      need_fetch=0
      log "stage stamp matches (${CONCRETE_TAG} asset ${ASSET_ID}) — skip download"
    else
      old="$(cat "$STAMP_FILE" 2>/dev/null | tr -d '\r\n' || true)"
      log "stage missing or stamp mismatch — will fetch"
      log "  have: ${old:-<none>}"
      log "  want: ${WANT}"
    fi
  else
    log "stage incomplete — will fetch (want: ${CONCRETE_TAG})"
  fi

  if [ "$need_fetch" = "1" ]; then
    fetch_stage || return 1
  fi

  if [ ! -f "${STAGE_DIR}/libocc_c.wasm" ]; then
    log "stage missing libocc_c.wasm under ${STAGE_DIR}"
    return 1
  fi

  if [ -f "${STAGE_DIR}/demo/index.html" ]; then
    if grep -qE '/agent-os/app/[a-f0-9]+/main\.js' "${STAGE_DIR}/demo/index.html" 2>/dev/null; then
      log "stage UI: versioned app tree /agent-os/app/<hash>/"
    elif grep -qE 'main\.[a-f0-9]+\.js' "${STAGE_DIR}/demo/index.html" 2>/dev/null; then
      log "stage UI: main.<hash>.js only (pre-0.3.6)"
    elif grep -q 'history-trigger' "${STAGE_DIR}/demo/index.html" 2>/dev/null; then
      log "stage UI: history-trigger, bare main.js"
    else
      log "stage UI: OLD stage"
    fi
  fi
}

write_version() {
  export DEMO_ROOT="${STAGE_DIR}/demo"
  export AGENT_OS_ROOT="${STAGE_DIR}"
  export CAD_RESOLVED_TAG="${CONCRETE_TAG}"
  {
    echo "tag=${CONCRETE_TAG}"
    echo "asset_id=${ASSET_ID}"
    echo "mode=$(is_floating_tag "$TAG_RAW" && echo floating || echo pinned)"
    echo "resolved_at_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    if [ -f "${STAGE_DIR}/STAGE_INFO.txt" ]; then
      cat "${STAGE_DIR}/STAGE_INFO.txt"
    fi
    if [ -f "${STAGE_DIR}/APP_HASH" ]; then
      cat "${STAGE_DIR}/APP_HASH"
    fi
    if [ -f "${STAGE_DIR}/demo/index.html" ]; then
      entry="$(grep -oE '/agent-os/app/[a-f0-9]+/main\.js|/agent-os/src/main[^"]+\.js' "${STAGE_DIR}/demo/index.html" | head -1 || true)"
      echo "html_entry=${entry:-unknown}"
    fi
  } > "${STAGE_DIR}/VERSION"
  log "VERSION:"
  cat "${STAGE_DIR}/VERSION" >&2 || true
}

ensure_stage || exit 1

# Serve loop: when CAD_RELEASE_TAG=latest, poll GitHub and hot-swap stage
# without requiring a manual Dokploy restart.
while true; do
  write_version

  SERVE="${STAGE_DIR}/serve.mjs"
  if [ ! -f "$SERVE" ]; then
    SERVE="${STAGE_DIR}/demo/serve.mjs"
  fi
  if [ ! -f "$SERVE" ]; then
    log "serve.mjs not found in stage"
    exit 1
  fi

  log "serving ${STAGE_DIR} tag=${CONCRETE_TAG} on ${HOST}:${PORT}"
  node "$SERVE" &
  SERVE_PID=$!

  recycled=0
  while kill -0 "$SERVE_PID" 2>/dev/null; do
    sleep "$POLL_SECONDS" || true
    if ! is_floating_tag "$TAG_RAW"; then
      continue
    fi
    if [ "${CACHE_MODE}" = "persist" ]; then
      continue
    fi
    new_resolved="$(resolve_latest_release 2>/dev/null | tr -d '\r' || true)"
    if [ -z "$new_resolved" ]; then
      continue
    fi
    nt="$(printf '%s' "$new_resolved" | cut -f1)"
    ni="$(printf '%s' "$new_resolved" | cut -f2)"
    ns="$(printf '%s' "$new_resolved" | cut -f3)"
    nw="${REPO}|${nt}|${ASSET_NAME}|${ni}|${ns}"
    if [ "$nw" != "$WANT" ]; then
      log "new release detected: ${nt} (was ${CONCRETE_TAG}) — recycling server"
      CONCRETE_TAG="$nt"
      ASSET_ID="$ni"
      ASSET_TS="$ns"
      WANT="$nw"
      kill "$SERVE_PID" 2>/dev/null || true
      wait "$SERVE_PID" 2>/dev/null || true
      ensure_stage || log "fetch after recycle failed; will retry"
      recycled=1
      break
    fi
  done

  if [ "$recycled" = "1" ]; then
    continue
  fi

  # Serve exited unexpectedly
  wait "$SERVE_PID" || true
  log "serve exited — restarting in 3s"
  sleep 3
done
