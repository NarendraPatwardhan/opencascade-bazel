#!/usr/bin/env bash
# Download AgentOS v0.5.0 release assets into agent-os/vendor/ (gitignored).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
V=v0.5.0
BASE="https://github.com/NarendraPatwardhan/agent-os/releases/download/${V}"
DEST="$ROOT/vendor"
mkdir -p "$DEST"

download() {
  local name="$1"
  local sha="$2"
  local out="$DEST/$name"
  if [[ -f "$out" ]]; then
    # Re-verify when present so a stale v0.4 file is not left silently.
    if command -v sha256sum >/dev/null; then
      if echo "$sha  $out" | sha256sum -c - >/dev/null 2>&1; then
        echo "have $name"
        return
      fi
      echo "refresh $name (sha mismatch)"
      rm -f "$out"
    else
      echo "have $name"
      return
    fi
  fi
  echo "GET $name"
  curl -fsSL -A "opencascade-bazel" -o "$out.tmp" "$BASE/$name"
  if command -v sha256sum >/dev/null; then
    echo "$sha  $out.tmp" | sha256sum -c -
  fi
  mv "$out.tmp" "$out"
}

# Digests from https://github.com/NarendraPatwardhan/agent-os/releases/download/v0.5.0/SHA256SUMS
download kernel.wasm ab20b493f4d2fdd90a4e40b005d495d3cb15af4121167ce977a719beffe77008
download loom.tar b92a703ed5c5a5f06a72cd88060af88d57a88fa67526bebba7909b02f9d6fd87
download mc-core.mjs cd6e07185c79a642eadcaa29f477ebc273b5852395f957443e5cff736e96aa42
download catalog-compiler.wasm 90205ce7e67767b395f221b01fd18c9fab45d95a88eb512ec1566887ad873de4
download git-engine.tar a7462aa830e127e9a3a2020866da95b7a75307a362b2ab536d27e4d1ee3fd52c
echo "AgentOS $V → $DEST"
echo "note: run scripts/browserify-mc-core.sh for browser-safe mc-core.browser.mjs"
