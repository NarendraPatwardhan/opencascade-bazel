#!/usr/bin/env bash
# Local / Bazel-friendly stage + serve for the CAD demo.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
AGENT_OS="$ROOT/agent-os"
STAGE="${STAGE_OUT:-$AGENT_OS/_stage}"
PORT="${PORT:-8765}"
# Prefer loopback so the browser is a secure origin (crypto.subtle for AgentOS).
# Docker/Dokploy sets HOST=0.0.0.0; local demo should use 127.0.0.1 unless overridden.
HOST="${HOST:-127.0.0.1}"

# Prefer Bazel-provided env; else vendor/ after scripts/fetch-release.sh
: "${AGENT_OS_KERNEL:=$AGENT_OS/vendor/kernel.wasm}"
: "${AGENT_OS_LOOM:=$AGENT_OS/vendor/loom.tar}"
: "${AGENT_OS_MC_CORE:=$AGENT_OS/vendor/mc-core.mjs}"
: "${AGENT_OS_CATALOG:=$AGENT_OS/vendor/catalog-compiler.wasm}"
: "${OCC_JS:=$AGENT_OS/vendor/occ/libocc_c.js}"
: "${OCC_WASM:=$AGENT_OS/vendor/occ/libocc_c.wasm}"
: "${SOLID_LUAU:=$AGENT_OS/src/batteries/solid.luau}"

for f in "$AGENT_OS_KERNEL" "$AGENT_OS_LOOM" "$AGENT_OS_MC_CORE" "$AGENT_OS_CATALOG" "$OCC_JS" "$OCC_WASM"; do
  if [[ ! -f "$f" ]]; then
    echo "missing $f" >&2
    echo "Run: agent-os/scripts/fetch-release.sh && bb build --config=buildbuddy //api:libocc_c_wasm" >&2
    echo "then: mkdir -p agent-os/vendor/occ && cp -fL bazel-bin/api/libocc_c.{js,wasm} agent-os/vendor/occ/" >&2
    exit 1
  fi
done

# Browser needs a rebundled mc-core (release artifact is Node-first).
if [[ ! -f "$AGENT_OS/vendor/mc-core.browser.mjs" ]]; then
  "$AGENT_OS/scripts/browserify-mc-core.sh" "$AGENT_OS_MC_CORE" "$AGENT_OS/vendor/mc-core.browser.mjs"
fi
export AGENT_OS_MC_CORE_BROWSER="$AGENT_OS/vendor/mc-core.browser.mjs"

export AGENT_OS_KERNEL AGENT_OS_LOOM AGENT_OS_MC_CORE AGENT_OS_CATALOG
export OCC_JS OCC_WASM SOLID_LUAU
export STAGE_OUT="$STAGE"
export SRC_DIR="$AGENT_OS/src"
export DEMO_DIR="$AGENT_OS/demo"

node "$AGENT_OS/scripts/stage.mjs"

export DEMO_ROOT="$STAGE/demo"
export AGENT_OS_ROOT="$STAGE"
export PORT HOST
if [[ "$HOST" != "127.0.0.1" && "$HOST" != "localhost" && "$HOST" != "::1" ]]; then
  echo "note: open via http://127.0.0.1:${PORT}/ if the page errors on crypto.subtle / digest" >&2
fi
exec node "$AGENT_OS/demo/serve.mjs"
