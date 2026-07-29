#!/usr/bin/env bash
set -euo pipefail

# Resolve runfiles (Bazel 6+/7 layout).
if [[ -n "${RUNFILES_DIR:-}" && -d "${RUNFILES_DIR}" ]]; then
  RF="$RUNFILES_DIR"
elif [[ -f "${BASH_SOURCE[0]}.runfiles_manifest" ]]; then
  # older layout — not expected
  RF=""
else
  RF="${BASH_SOURCE[0]}.runfiles"
fi

MAIN="${RF:+$RF/_main}"
if [[ -z "${MAIN}" || ! -d "$MAIN" ]]; then
  # When executed via bazel run, cwd is often the runfiles workspace
  if [[ -d "_main" ]]; then MAIN="_main"
  elif [[ -d "agent-os" ]]; then MAIN="."
  else MAIN="${BUILD_WORKSPACE_DIRECTORY:-.}"; fi
fi

find_file() {
  local rel="$1"
  local c
  for c in \
    "$MAIN/$rel" \
    "${RUNFILES_DIR:-}/_main/$rel" \
    "${BUILD_WORKSPACE_DIRECTORY:-}/$rel" \
    "$rel"
  do
    if [[ -f "$c" ]]; then echo "$c"; return 0; fi
  done
  # http_file external repos
  return 1
}

find_external() {
  local name="$1"  # e.g. agent_os_kernel_wasm/file/kernel.wasm
  local c
  for c in \
    "${RUNFILES_DIR:-}/$name" \
    "${RUNFILES_DIR:-}/_main/../$name" \
    "${RUNFILES_DIR:-}/$name"
  do
    if [[ -f "$c" ]]; then echo "$c"; return 0; fi
  done
  # glob search under runfiles
  local hit
  hit=$(find "${RUNFILES_DIR:-/nonexistent}" -path "*${name##*/}" 2>/dev/null | head -1 || true)
  if [[ -n "$hit" && -f "$hit" ]]; then echo "$hit"; return 0; fi
  return 1
}

# Prefer external http_file paths by short name
locate_asset() {
  local basename="$1"
  local hit
  hit=$(find "${RUNFILES_DIR:-}" -name "$basename" 2>/dev/null | head -1 || true)
  if [[ -n "$hit" ]]; then echo "$hit"; return 0; fi
  hit=$(find "${MAIN:-.}" -name "$basename" 2>/dev/null | head -1 || true)
  if [[ -n "$hit" ]]; then echo "$hit"; return 0; fi
  return 1
}

KERNEL=$(locate_asset kernel.wasm)
LOOM=$(locate_asset loom.tar)
MC=$(locate_asset mc-core.mjs)
CAT=$(locate_asset catalog-compiler.wasm)
OCC_JS=$(find_file "api/libocc_c.js" || locate_asset libocc_c.js || true)
OCC_WASM=$(find_file "api/libocc_c.wasm" || locate_asset libocc_c.wasm || true)
# api pick_file outputs under bazel-bin paths in runfiles:
if [[ -z "${OCC_JS:-}" ]]; then OCC_JS=$(find "${RUNFILES_DIR:-}" -name 'libocc_c.js' 2>/dev/null | head -1); fi
if [[ -z "${OCC_WASM:-}" ]]; then OCC_WASM=$(find "${RUNFILES_DIR:-}" -name 'libocc_c.wasm' 2>/dev/null | head -1); fi

SOLID=$(find_file "agent-os/src/batteries/solid.luau" || true)
SMOKE_JS=$(find_file "agent-os/smoke/node_smoke.mjs" || true)

if [[ -z "${KERNEL:-}" || -z "${LOOM:-}" || -z "${MC:-}" || -z "${CAT:-}" ]]; then
  echo "Could not locate AgentOS release assets in runfiles" >&2
  echo "RUNFILES_DIR=${RUNFILES_DIR:-}" >&2
  exit 1
fi
if [[ -z "${OCC_JS:-}" || -z "${OCC_WASM:-}" ]]; then
  echo "Could not locate libocc_c.js / libocc_c.wasm — build //api:libocc_c_wasm first" >&2
  exit 1
fi
if [[ -z "${SOLID:-}" || -z "${SMOKE_JS:-}" ]]; then
  echo "Could not locate solid.luau or node_smoke.mjs" >&2
  exit 1
fi

OCC_BASE="$(dirname "$OCC_JS")"
# Ensure wasm sits next to js
if [[ ! -f "$OCC_BASE/libocc_c.wasm" ]]; then
  STAGE=$(mktemp -d)
  cp "$OCC_JS" "$STAGE/libocc_c.js"
  cp "$OCC_WASM" "$STAGE/libocc_c.wasm"
  OCC_BASE="$STAGE"
fi

export AGENT_OS_KERNEL="$KERNEL"
export AGENT_OS_LOOM="$LOOM"
export AGENT_OS_MC_CORE="$MC"
export AGENT_OS_CATALOG="$CAT"
export OCC_BASE
export SOLID_LUAU="$SOLID"

echo "kernel=$KERNEL"
echo "loom=$LOOM"
echo "occ=$OCC_BASE"
exec node "$SMOKE_JS"
