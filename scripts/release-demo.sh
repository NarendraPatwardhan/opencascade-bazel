#!/usr/bin/env bash
# Build (bb) + pack cad-demo-stage.tar.gz + publish a GitHub Release via REST.
#
# Mirrors agent-os //bazel/tools/gh-release (no `gh` CLI) and nml token discipline
# (token file or env; never commit secrets; never put tokens in Bazel flags).
#
# Usage:
#   ./scripts/release-demo.sh --tag demo-v0.1.0 --notes-file notes.md
#   ./scripts/release-demo.sh --tag demo-v0.1.0 --notes "…" --draft
#   ./scripts/release-demo.sh --tag demo-v0.1.0 --notes "…" --dry-run
#
# Token (one of):
#   export GITHUB_TOKEN=ghp_…          # classic PAT with contents:write (or repo)
#   --token-file ../github.release.key # file next to the monorepo (gitignored)
#   default probe: $ROOT/../github.release.key then $ROOT/../github.packages.key
#
# Prereqs: bb login, node, bun (for mc-core browserify), clean preferred.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="${MC_RELEASE_REPO:-NarendraPatwardhan/opencascade-bazel}"
OUT="${OUT:-$ROOT/dist/cad-demo-stage.tar.gz}"
PUBLISH_JS="$ROOT/tools/gh-release/publish.mjs"

TAG=""
NOTES=""
NOTES_FILE=""
NAME=""
TARGET=""
DRAFT=0
PRERELEASE=0
DRY_RUN=0
TOKEN_FILE=""
SKIP_PACK=0

die() { echo "release-demo: $*" >&2; exit 1; }

usage() {
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag) TAG="${2:-}"; shift 2 ;;
    --notes) NOTES="${2:-}"; shift 2 ;;
    --notes-file) NOTES_FILE="${2:-}"; shift 2 ;;
    --name) NAME="${2:-}"; shift 2 ;;
    --target) TARGET="${2:-}"; shift 2 ;;
    --draft) DRAFT=1; shift ;;
    --prerelease) PRERELEASE=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --token-file) TOKEN_FILE="${2:-}"; shift 2 ;;
    --skip-pack) SKIP_PACK=1; shift ;;
    --repo) REPO="${2:-}"; shift 2 ;;
    -h|--help) usage 0 ;;
    *) die "unknown arg: $1 (try --help)" ;;
  esac
done

[[ -n "$TAG" ]] || die "missing --tag (e.g. demo-v0.1.0)"
if [[ -z "$NOTES" && -z "$NOTES_FILE" ]]; then
  die "release notes required: --notes or --notes-file"
fi

cd "$ROOT"

if [[ "$SKIP_PACK" != "1" ]]; then
  OUT="$OUT" MC_RELEASE_REPO="$REPO" "$ROOT/scripts/pack-demo-stage.sh"
else
  [[ -f "$OUT" ]] || die "--skip-pack but missing $OUT"
fi

# Resolve token file if not provided and no env token
if [[ -z "${GITHUB_TOKEN:-}" && -z "${GH_TOKEN:-}" && -z "$TOKEN_FILE" ]]; then
  for cand in \
    "$ROOT/../github.release.key" \
    "$ROOT/../github.packages.key" \
    "${GITHUB_TOKEN_FILE:-}"; do
    if [[ -n "$cand" && -r "$cand" ]]; then
      TOKEN_FILE="$cand"
      break
    fi
  done
fi

export MC_RELEASE_REPO="$REPO"
export MC_RELEASE_ASSETS
MC_RELEASE_ASSETS="$(node -e 'const p=process.argv[1]; console.log(JSON.stringify({"cad-demo-stage.tar.gz":p}))' "$OUT")"

args=(--tag "$TAG")
if [[ -n "$NOTES_FILE" ]]; then
  args+=(--notes-file "$NOTES_FILE")
else
  args+=(--notes "$NOTES")
fi
[[ -n "$NAME" ]] && args+=(--name "$NAME")
[[ -n "$TARGET" ]] && args+=(--target "$TARGET")
[[ "$DRAFT" == "1" ]] && args+=(--draft)
[[ "$PRERELEASE" == "1" ]] && args+=(--prerelease)
[[ "$DRY_RUN" == "1" ]] && args+=(--dry-run)
[[ -n "$TOKEN_FILE" ]] && args+=(--token-file "$TOKEN_FILE")

echo "== publish $REPO @ $TAG =="
node "$PUBLISH_JS" "${args[@]}"

if [[ "$DRY_RUN" != "1" ]]; then
  echo
  echo "Dokploy / compose pin:"
  echo "  CAD_RELEASE_URL=https://github.com/${REPO}/releases/download/${TAG}/cad-demo-stage.tar.gz"
fi
