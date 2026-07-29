#!/usr/bin/env bash
# Download AgentOS v0.4.0 release assets into agent-os/vendor/ (gitignored).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
V=v0.4.0
BASE="https://github.com/NarendraPatwardhan/agent-os/releases/download/${V}"
DEST="$ROOT/vendor"
mkdir -p "$DEST"

download() {
  local name="$1"
  local sha="$2"
  local out="$DEST/$name"
  if [[ -f "$out" ]]; then
    echo "have $name"
    return
  fi
  echo "GET $name"
  curl -fsSL -A "opencascade-bazel" -o "$out.tmp" "$BASE/$name"
  if command -v sha256sum >/dev/null; then
    echo "$sha  $out.tmp" | sha256sum -c -
  fi
  mv "$out.tmp" "$out"
}

download kernel.wasm 522f6dd571d5c0bafaf8160e7e131f0e6735cf58a949a7bb6bd7986eedae2b32
download loom.tar 020cab5db9592b6a846ab4e0d8e410a206584886c28a12d02d0fd983f4305997
download mc-core.mjs 331d9356ee1190e794a7668bc9a417e34e31ce99abf34929153469576b1f73fa
download catalog-compiler.wasm 90205ce7e67767b395f221b01fd18c9fab45d95a88eb512ec1566887ad873de4
echo "AgentOS $V → $DEST"
