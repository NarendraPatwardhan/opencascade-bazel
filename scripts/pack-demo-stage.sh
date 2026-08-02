#!/usr/bin/env bash
# Pack a self-contained browser demo stage tarball for GitHub Releases / Dokploy.
#
# Heavy OCCT Wasm is built with bb (BuildBuddy RBE) — not on the deploy host.
# AgentOS kernel/loom/mc-core come from the pinned agent-os GitHub release.
#
# Output (default): dist/cad-demo-stage.tar.gz
#
#   ./scripts/pack-demo-stage.sh
#   SKIP_WASM_BUILD=1 ./scripts/pack-demo-stage.sh   # reuse vendor/occ
#   OUT=dist/foo.tar.gz ./scripts/pack-demo-stage.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AGENT_OS="$ROOT/agent-os"
STAGE="${STAGE_OUT:-$AGENT_OS/_stage}"
OUT="${OUT:-$ROOT/dist/cad-demo-stage.tar.gz}"
REPO="${MC_RELEASE_REPO:-NarendraPatwardhan/opencascade-bazel}"

: "${AGENT_OS_KERNEL:=$AGENT_OS/vendor/kernel.wasm}"
: "${AGENT_OS_LOOM:=$AGENT_OS/vendor/loom.tar}"
: "${AGENT_OS_MC_CORE:=$AGENT_OS/vendor/mc-core.mjs}"
: "${AGENT_OS_CATALOG:=$AGENT_OS/vendor/catalog-compiler.wasm}"
: "${AGENT_OS_GIT_ENGINE:=$AGENT_OS/vendor/git-engine.tar}"
: "${OCC_JS:=$AGENT_OS/vendor/occ/libocc_c.js}"
: "${OCC_WASM:=$AGENT_OS/vendor/occ/libocc_c.wasm}"
: "${SOLID_LUAU:=$AGENT_OS/src/batteries/solid.luau}"

cd "$ROOT"

echo "== pack-demo-stage =="
echo "  repo:  $REPO"
echo "  stage: $STAGE"
echo "  out:   $OUT"

# 1) AgentOS release assets (curl; no Bazel)
if [[ ! -f "$AGENT_OS_KERNEL" || ! -f "$AGENT_OS_LOOM" || ! -f "$AGENT_OS_MC_CORE" || ! -f "$AGENT_OS_CATALOG" ]]; then
  echo "fetching AgentOS release assets…"
  "$AGENT_OS/scripts/fetch-release.sh"
fi

# 2) Browser-safe mc-core (release artifact is Node-first)
if [[ ! -f "$AGENT_OS/vendor/mc-core.browser.mjs" ]]; then
  echo "browserifying mc-core…"
  "$AGENT_OS/scripts/browserify-mc-core.sh" "$AGENT_OS_MC_CORE" "$AGENT_OS/vendor/mc-core.browser.mjs"
fi
export AGENT_OS_MC_CORE_BROWSER="$AGENT_OS/vendor/mc-core.browser.mjs"

# 3) OCCT Wasm via BuildBuddy RBE (unless already staged and SKIP_WASM_BUILD=1)
if [[ "${SKIP_WASM_BUILD:-0}" != "1" || ! -f "$OCC_JS" || ! -f "$OCC_WASM" ]]; then
  if ! command -v bb >/dev/null 2>&1; then
    echo "error: bb (BuildBuddy CLI) required to build //api:libocc_c_wasm" >&2
    echo "  install: https://www.buildbuddy.io/docs/cli  then: bb login" >&2
    echo "  or set SKIP_WASM_BUILD=1 with pre-populated agent-os/vendor/occ/" >&2
    exit 1
  fi
  echo "bb build --config=buildbuddy //api:libocc_c_wasm …"
  # Prefer full download of product outputs (remote_download_minimal would omit bytes).
  bb build --config=buildbuddy --remote_download_outputs=all //api:libocc_c_wasm
  mkdir -p "$AGENT_OS/vendor/occ"
  # bazel-bin may be a symlink into the output tree
  cp -fL "$ROOT/bazel-bin/api/libocc_c.js" "$ROOT/bazel-bin/api/libocc_c.wasm" "$AGENT_OS/vendor/occ/"
  OCC_JS="$AGENT_OS/vendor/occ/libocc_c.js"
  OCC_WASM="$AGENT_OS/vendor/occ/libocc_c.wasm"
fi

for f in "$AGENT_OS_KERNEL" "$AGENT_OS_LOOM" "$AGENT_OS_MC_CORE" "$AGENT_OS_CATALOG" \
  "$AGENT_OS_MC_CORE_BROWSER" "$OCC_JS" "$OCC_WASM" "$SOLID_LUAU"; do
  if [[ ! -f "$f" ]]; then
    echo "missing required file: $f" >&2
    exit 1
  fi
done

# 4) Stage tree (self-contained: batteries, src, demo, serve.mjs, wasm, …)
export STAGE_OUT="$STAGE"
export AGENT_OS_KERNEL AGENT_OS_LOOM AGENT_OS_MC_CORE AGENT_OS_CATALOG
export AGENT_OS_GIT_ENGINE
export OCC_JS OCC_WASM SOLID_LUAU
export SRC_DIR="$AGENT_OS/src"
export DEMO_DIR="$AGENT_OS/demo"
export AGENT_OS_MC_CORE_BROWSER
node "$AGENT_OS/scripts/stage.mjs"

# stamp for operators
{
  echo "repo=$REPO"
  echo "pack_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "git=$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
  echo "agent_os_assets=v0.5.0"
} >"$STAGE/STAGE_INFO.txt"

# 5) Tarball (contents at archive root = stage root)
mkdir -p "$(dirname "$OUT")"
tar -C "$STAGE" -czf "$OUT" .
BYTES=$(wc -c <"$OUT" | tr -d ' ')
echo "wrote $OUT ($BYTES bytes)"
echo "sha256: $(sha256sum "$OUT" | awk '{print $1}')"
