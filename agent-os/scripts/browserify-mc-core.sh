#!/usr/bin/env bash
# Produce a browser-loadable mc-core from the Node-oriented release artifact.
# Uses bun (available on the agent host). Output: vendor/mc-core.browser.mjs
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IN="${1:-$ROOT/vendor/mc-core.mjs}"
OUT="${2:-$ROOT/vendor/mc-core.browser.mjs}"
if [[ ! -f "$IN" ]]; then
  echo "missing $IN — run fetch-release.sh first" >&2
  exit 1
fi
command -v bun >/dev/null || { echo "bun required to browserify mc-core" >&2; exit 1; }
bun build "$IN" --outfile="$OUT" --target=browser --format=esm
echo "wrote $OUT ($(wc -c <"$OUT") bytes)"
