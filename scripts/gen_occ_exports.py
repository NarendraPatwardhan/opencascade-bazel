#!/usr/bin/env python3
"""Generate Emscripten EXPORTED_FUNCTIONS list for occ_c.

Scans every public header under api/include/*.h for OCC_API function
declarations and prints the comma-joined export string used by
api/BUILD.bazel (_OCC_C_EXPORTS).

Usage:
  python3 scripts/gen_occ_exports.py
  python3 scripts/gen_occ_exports.py --format starlark   # BUILD snippet
  python3 scripts/gen_occ_exports.py --check             # exit 1 if BUILD drifts

Always includes _malloc and _free so JS can allocate buffers for path/string IO.
"""

from __future__ import annotations

import argparse
import pathlib
import re
import sys

# OCC_API <return type possibly with *> name(
_OCC_API_RE = re.compile(
    r"OCC_API\s+"
    r"(?:const\s+)?"
    r"(?:unsigned\s+)?"
    r"(?:void|int|double|float|char|long|size_t|int32_t|uint32_t|occ_\w+_t)"
    r"(?:\s+const)?\s*\*?\s*"
    r"(occ_\w+)\s*\(",
)

# Fallback: anything OCC_API ... occ_name(
_OCC_API_FALLBACK_RE = re.compile(r"OCC_API\s+[\w\s\*]+?\b(occ_\w+)\s*\(")

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
INCLUDE_DIR = REPO_ROOT / "api" / "include"
BUILD_FILE = REPO_ROOT / "api" / "BUILD.bazel"


def collect_occ_symbols() -> list[str]:
    names: set[str] = set()
    for header in sorted(INCLUDE_DIR.glob("*.h")):
        text = header.read_text(encoding="utf-8")
        for m in _OCC_API_RE.finditer(text):
            names.add(m.group(1))
        # Catch odd return types (e.g. multi-token) missed by the strict RE.
        for m in _OCC_API_FALLBACK_RE.finditer(text):
            names.add(m.group(1))
    return sorted(names)


def export_list(symbols: list[str]) -> list[str]:
    return ["_malloc", "_free"] + [f"_{s}" for s in symbols]


def format_join(exports: list[str]) -> str:
    return ",".join(exports)


def format_starlark(exports: list[str]) -> str:
    lines = [
        "# Keep in sync with OCC_API symbols in api/include/*.h",
        "# (regenerate: python3 scripts/gen_occ_exports.py --format starlark).",
        "# malloc/free let JS allocate for paths.",
        '_OCC_C_EXPORTS = ",".join([',
    ]
    for e in exports:
        lines.append(f'    "{e}",')
    lines.append("])")
    return "\n".join(lines) + "\n"


def parse_build_exports() -> list[str]:
    text = BUILD_FILE.read_text(encoding="utf-8")
    m = re.search(r'_OCC_C_EXPORTS\s*=\s*","\.join\(\[(.*?)\]\)', text, re.S)
    if not m:
        raise SystemExit(f"could not find _OCC_C_EXPORTS in {BUILD_FILE}")
    return re.findall(r'"(_[^"]+)"', m.group(1))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--format",
        choices=("join", "starlark", "list"),
        default="join",
        help="Output format (default: join string for EXPORTED_FUNCTIONS)",
    )
    ap.add_argument(
        "--check",
        action="store_true",
        help="Exit 1 if api/BUILD.bazel _OCC_C_EXPORTS does not match headers",
    )
    ap.add_argument(
        "--write",
        action="store_true",
        help="Rewrite _OCC_C_EXPORTS in api/BUILD.bazel from headers",
    )
    args = ap.parse_args()

    symbols = collect_occ_symbols()
    exports = export_list(symbols)

    if args.check or args.write:
        current = parse_build_exports()
        if current == exports:
            print(
                f"OK: {len(exports)} exports "
                f"({len(symbols)} OCC_API + malloc/free) match BUILD",
                file=sys.stderr,
            )
            if not args.write:
                return 0
        elif args.check and not args.write:
            print("DRIFT: _OCC_C_EXPORTS does not match api/include/*.h", file=sys.stderr)
            cur, exp = set(current), set(exports)
            missing = sorted(exp - cur)
            extra = sorted(cur - exp)
            if missing:
                print("  missing from BUILD:", ", ".join(missing), file=sys.stderr)
            if extra:
                print("  extra in BUILD:", ", ".join(extra), file=sys.stderr)
            return 1

        if args.write:
            text = BUILD_FILE.read_text(encoding="utf-8")
            new_block = format_starlark(exports)
            # Replace from comment block through closing ])
            pat = re.compile(
                r"# Keep in sync with OCC_API symbols.*?_OCC_C_EXPORTS = \",\"\.join\(\[.*?\]\)\n",
                re.S,
            )
            # Also accept older single-line comment variants
            if not pat.search(text):
                pat = re.compile(
                    r"(?:# [^\n]*\n)*_OCC_C_EXPORTS = \",\"\.join\(\[.*?\]\)\n",
                    re.S,
                )
            new_text, n = pat.subn(new_block, text, count=1)
            if n != 1:
                raise SystemExit("failed to locate _OCC_C_EXPORTS block for --write")
            BUILD_FILE.write_text(new_text, encoding="utf-8")
            print(
                f"Wrote {len(exports)} exports to {BUILD_FILE.relative_to(REPO_ROOT)}",
                file=sys.stderr,
            )
            return 0

    if args.format == "join":
        print(format_join(exports))
    elif args.format == "list":
        for e in exports:
            print(e)
        print(f"# count={len(exports)}", file=sys.stderr)
    else:
        sys.stdout.write(format_starlark(exports))
    return 0


if __name__ == "__main__":
    sys.exit(main())
