# Documentation index

Canonical docs for this repository. Prefer **one home per topic**.

| Document | Role |
|----------|------|
| [`../SYSTEM.md`](../SYSTEM.md) | **North star** — product intent, architecture, trust boundary, dual goals |
| [`../DISPLAY.md`](../DISPLAY.md) | **Viewport** — WebGL UI, editor camera, infinite ground |
| [`../REACTIVITY.md`](../REACTIVITY.md) | **Params / gimbals** — reactive scripts, tiered re-eval |
| [`../AGENTS.md`](../AGENTS.md) | How to code here (C ABI, Bazel/bb, license boundary) |
| [`../README.md`](../README.md) | User-facing product overview |
| [`cleanroom-featurescript-std-report.md`](cleanroom-featurescript-std-report.md) | Clean-room capability matrix + IR sketches (solids / host façade) |
| [`cleanroom-solvespace-sketch-solve-report.md`](cleanroom-solvespace-sketch-solve-report.md) | Clean-room **Sketch2D / SolveSketch** — parametric 2D + constraint solve design |
| [`sketch-solve-constitution.md`](sketch-solve-constitution.md) | **Binding** sketch/solve process — depth-first Active Slice, exceptional Seal bar, MAS rules |
| [`browser-demo.png`](browser-demo.png) | Browser vertical-slice screenshot |

## Where the C API is taught

**In the code.** Start at:

1. [`api/include/occ_c.h`](../api/include/occ_c.h) — contract, ownership, units  
2. [`api/include/occ_c_all.h`](../api/include/occ_c_all.h) — full module map / reading order  
3. [`api/internal/occ_c_internal.hxx`](../api/internal/occ_c_internal.hxx) — C↔C++ boundary  
4. Matching `api/src/occ_c_*.cc` — algorithm walk-throughs in comments  

There is no separate “literate-sections” tree. Comments in headers and sources
are the teaching surface.

## Removed / subsumed (do not recreate)

| Former path | Absorbed into |
|-------------|----------------|
| `docs/literate-sections/*` | Comments in `api/include` + `api/src` |
| `docs/occ-c-literate-api.md` | `occ_c.h` / `occ_c_all.h` guides |
| `docs/aiboost-agentic-cad.md` | `SYSTEM.md` |
| `docs/process-decisions.md` | `SYSTEM.md` § Design decisions |

## Read order for agents

1. `SYSTEM.md` — why / what / refuse  
2. `AGENTS.md` — how to change code  
3. `api/include/occ_c.h` — C ABI contract  
4. Task-specific: `DISPLAY.md` / `REACTIVITY.md` / clean-room report  
