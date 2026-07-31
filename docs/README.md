# Documentation index

Canonical docs for this repository. Prefer **one home per topic** — do not reintroduce thin pointer files.

| Document | Role |
|----------|------|
| [`../SYSTEM.md`](../SYSTEM.md) | **North star** — product intent, architecture, trust boundary, design decisions (D1–D9), dual goals |
| [`../DISPLAY.md`](../DISPLAY.md) | **Viewport** — WebGL review UI, editor camera, infinite ground grid, steal lists |
| [`../REACTIVITY.md`](../REACTIVITY.md) | **Params / gimbals** — reactive scripts, tiered re-eval, CADAM steal list |
| [`../AGENTS.md`](../AGENTS.md) | How to code here (C ABI, Bazel/bb, license boundary) |
| [`../README.md`](../README.md) | User-facing product overview |
| [`cleanroom-featurescript-std-report.md`](cleanroom-featurescript-std-report.md) | Clean-room FeatureScript std learning + dual-goal capability matrix + IR sketches |
| [`occ-c-literate-api.md`](occ-c-literate-api.md) | Hub for the literate `occ_c` expansion (sources in `literate-sections/`) |
| [`literate-sections/`](literate-sections/) | **Authoritative** extractable C sources (Parts 00–08) |
| [`browser-demo.png`](browser-demo.png) | Browser vertical-slice screenshot |

## Removed / subsumed (do not recreate)

| Former path | Absorbed into |
|-------------|----------------|
| `docs/aiboost-agentic-cad.md` | `SYSTEM.md` (architecture, trust, vertical slice) |
| `docs/process-decisions.md` | `SYSTEM.md` § Design decisions |
| `docs/occ-c-p0-literate-api.md` | `literate-sections/` + this hub (v1 pointer deleted) |
| Full-text duplicate of literate assembly in one giant file | `literate-sections/*` only (extract concatenates) |

## Read order for agents

1. `SYSTEM.md` — why / what / refuse  
2. `AGENTS.md` — how to change code  
3. `DISPLAY.md` — browser mesh viewport / camera / grid  
4. `REACTIVITY.md` — live parameters / gimbals  
5. Task doc: clean-room report and/or `literate-sections/` as needed  
