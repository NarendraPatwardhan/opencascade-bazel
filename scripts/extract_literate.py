# === file: scripts/extract_literate.py
#!/usr/bin/env python3
"""extract_literate.py — write literate code fences to real files.

Usage:
  python3 scripts/extract_literate.py docs/literate-sections/08-smoke-dual-goal.md
  python3 scripts/extract_literate.py docs/occ-c-literate-api.md --root . --force
  python3 scripts/extract_literate.py section.md --dry-run --list

A fenced block is extractable iff its first non-empty line matches:
  // === file: RELPATH   (C/C++/headers)
  # === file: RELPATH    (Python/Starlark)
The mark line is kept in the output. Paths must be relative (no parent hops).
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path
from typing import Iterable, List, Optional, Tuple

FILE_MARK = re.compile(
    r"^[ \t]*(?://|#) === file:[ \t]*(?P<path>\S+)\s*$"
)
FENCE_OPEN = re.compile(r"^```([a-zA-Z0-9_+-]*)\s*$")
FENCE_CLOSE = re.compile(r"^```\s*$")


def iter_fences(lines: List[str]) -> Iterable[Tuple[str, List[str]]]:
    i, n = 0, len(lines)
    while i < n:
        m = FENCE_OPEN.match(lines[i])
        if not m:
            i += 1
            continue
        lang = m.group(1) or ""
        i += 1
        body: List[str] = []
        while i < n and not FENCE_CLOSE.match(lines[i]):
            body.append(lines[i].rstrip("\n"))
            i += 1
        if i < n:
            i += 1
        yield lang, body


def first_file_mark(body: List[str]) -> Optional[str]:
    for line in body:
        if line.strip() == "":
            continue
        m = FILE_MARK.match(line)
        return m.group("path") if m else None
    return None


def safe_join(root: Path, rel: str) -> Path:
    if os.path.isabs(rel) or any(p == ".." for p in Path(rel).parts):
        raise ValueError(f"unsafe path: {rel}")
    out = (root / rel).resolve()
    out.relative_to(root.resolve())
    return out


def extract_from_text(
    text: str, root: Path, force: bool, dry_run: bool, source: str
) -> List[Tuple[str, Path, int]]:
    written: List[Tuple[str, Path, int]] = []
    for lang, body in iter_fences(text.splitlines()):
        rel = first_file_mark(body)
        if not rel:
            continue
        content = "\n".join(body)
        if content and not content.endswith("\n"):
            content += "\n"
        try:
            dest = safe_join(root, rel)
        except ValueError as ex:
            print(f"error: {source}: {ex}", file=sys.stderr)
            continue
        nbytes = len(content.encode("utf-8"))
        if dry_run:
            print(f"DRY  {rel}  ({nbytes} B, lang={lang or '-'})")
            written.append((rel, dest, nbytes))
            continue
        if dest.exists() and not force:
            print(f"skip {rel}  (exists; use --force)")
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(content, encoding="utf-8")
        if rel.startswith("scripts/") and rel.endswith(".py"):
            dest.chmod(dest.stat().st_mode | 0o111)
        print(f"write {rel}  ({nbytes} B)")
        written.append((rel, dest, nbytes))
    return written


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("markdown", nargs="+", help="Markdown sources")
    ap.add_argument("--root", default=".", help="Output root (default cwd)")
    ap.add_argument("--force", action="store_true", help="Overwrite existing")
    ap.add_argument("--dry-run", action="store_true", help="Plan only")
    ap.add_argument("--list", action="store_true", help="List paths and sizes")
    ap.add_argument("--require", action="store_true", help="Fail if zero files")
    args = ap.parse_args(argv)

    root = Path(args.root).resolve()
    if not root.is_dir():
        print(f"error: root not a directory: {root}", file=sys.stderr)
        return 1

    total: List[Tuple[str, Path, int]] = []
    for md in args.markdown:
        p = Path(md)
        if not p.is_file():
            print(f"error: not a file: {md}", file=sys.stderr)
            return 1
        dry = args.dry_run or args.list
        total.extend(
            extract_from_text(
                p.read_text(encoding="utf-8"), root, args.force, dry, str(p)
            )
        )

    if args.list:
        for rel, _d, n in total:
            print(f"{rel}\t{n}")
        return 0 if total or not args.require else 2

    print(f"-- {len(total)} file(s) from {len(args.markdown)} source(s)")
    return 2 if (args.require and not total) else 0


if __name__ == "__main__":
    sys.exit(main())
