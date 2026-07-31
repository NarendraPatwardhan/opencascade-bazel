# `occ_c` literate API — hub

**Status:** Active  
**OCCT pin:** 7.9.3  
**Checklist:** [`cleanroom-featurescript-std-report.md`](cleanroom-featurescript-std-report.md)  
**North star:** [`../SYSTEM.md`](../SYSTEM.md)

This hub is the **entry point**. Authoritative, extractable source lives only under
[`literate-sections/`](literate-sections/) (Parts 00–08). There is no second full-text
copy of those sections in this file.

## How to extract

```bash
# Single part
python3 scripts/extract_literate.py docs/literate-sections/04-route-pipe-member.md --root .

# All parts (concat in order, then extract)
cat docs/literate-sections/0{0,1,2,3,4,5,6,7,8}-*.md > /tmp/occ-c-literate-all.md
python3 scripts/extract_literate.py /tmp/occ-c-literate-all.md --root .
```

The extractor script itself is embedded in
[`literate-sections/08-smoke-dual-goal.md`](literate-sections/08-smoke-dual-goal.md)
(`// === file: scripts/extract_literate.py`). Extract that first if `scripts/` is empty.

## Parts (source of truth)

| Part | File | Contents |
|------|------|----------|
| 00 | [`literate-sections/00-front-matter.md`](literate-sections/00-front-matter.md) | Checklist map, internal glue, status codes |
| 01 | [`literate-sections/01-session-history.md`](literate-sections/01-session-history.md) | Session, history, `created_by`, names, frames |
| 02 | [`literate-sections/02-construction.md`](literate-sections/02-construction.md) | Wires, faces, planes, arcs, bspline |
| 03 | [`literate-sections/03-frames-trsf.md`](literate-sections/03-frames-trsf.md) | SE(3) frames, place, FK / DH chain |
| 04 | [`literate-sections/04-route-pipe-member.md`](literate-sections/04-route-pipe-member.md) | Route bends, annulus, pipe shell, members |
| 05 | [`literate-sections/05-patterns-holes-split.md`](literate-sections/05-patterns-holes-split.md) | Patterns, holes, compound, split |
| 06 | [`literate-sections/06-query-measure.md`](literate-sections/06-query-measure.md) | Clash, distance, mass, selectors |
| 07 | [`literate-sections/07-sweeps-helix-ext.md`](literate-sections/07-sweeps-helix-ext.md) | Extrude extents, helix, thicken, sew |
| 08 | [`literate-sections/08-smoke-dual-goal.md`](literate-sections/08-smoke-dual-goal.md) | Skid + robot + flange smokes, extract script |

## Conventions

- Blocks tagged `// === file: <path>` (or `# === file:` for Python/Starlark) are authoritative.
- Units: **meters**, **radians**, topology indices **1-based**.
- Baseline shipped API remains `api/include/occ_c.h` + `api/src/occ_c.cc`; literate parts are **additive**.
- Do not copy FeatureScript; implement from clean-room report + OCCT only.

## Coverage

Kernel P0/P1 items from the clean-room matrix are covered in Parts 01–07
(session, construction, frames, route/pipe, patterns/holes, query, sweeps).
Product-layer items (mate solver, NL parse, catalog DB, URDF package) stay out of C —
see `SYSTEM.md`.
