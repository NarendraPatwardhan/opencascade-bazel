# AgentOS CAD scripting (BSL 1.1)

Browser/Node product: **AgentOS `loom` Luau** drives geometry through **host tools** into
Apache-2.0 **`libocc_c` Wasm**.

| Layer | License |
|-------|---------|
| This directory (`agent-os/`) | **BSL 1.1** — [LICENSE](LICENSE) |
| `../api` (`occ_c`, Wasm) | **Apache-2.0** |

## Architecture

```text
Browser main (demo) ──postMessage──► runtime-worker
                                        ├─ mc-core + kernel + loom
                                        ├─ host tool "cad call"
                                        ├─ luau-analyze (markers, no OCCT)
                                        └─ createOccModule (libocc_c)
                                             └─ mesh → main → Three.js view
```

### Editor (Phase A / B)

| Feature | How |
|---------|-----|
| Completions / hover | Closed catalog in `src/cad-api-catalog.js` → Monaco providers |
| Squiggles | Worker stages `/tmp/cad/{main,solid,route,frames,query,cad,ir/**,tools,json}.luau` and runs `luau-analyze` (debounced); markers are for **user** `main.luau` only |
| Module graph | Analyzer follows real batteries + `ir/` + typed stubs under `batteries/analyze/` (runtime still uses AgentOS builtins for `tools`/`json`) |
| Run | Executes via `vm.luau` + host mesh; analyze does not block Run yet |

## Quick start

**Bazel compiles/links: use `bb --config=buildbuddy` only on the project agent host.**

```bash
# 1) AgentOS release assets (curl; no Bazel)
./agent-os/scripts/fetch-release.sh
./agent-os/scripts/browserify-mc-core.sh   # browser-safe mc-core

# 2) OCCT Wasm via RBE
bb build --config=buildbuddy //api:libocc_c_wasm
mkdir -p agent-os/vendor/occ
cp -fL bazel-bin/api/libocc_c.js bazel-bin/api/libocc_c.wasm agent-os/vendor/occ/

# 3) Node smoke (Luau → boolean → mesh)
export AGENT_OS_KERNEL=$PWD/agent-os/vendor/kernel.wasm
export AGENT_OS_LOOM=$PWD/agent-os/vendor/loom.tar
export AGENT_OS_MC_CORE=$PWD/agent-os/vendor/mc-core.mjs
export AGENT_OS_CATALOG=$PWD/agent-os/vendor/catalog-compiler.wasm
export OCC_BASE=$PWD/agent-os/vendor/occ
export SOLID_LUAU=$PWD/agent-os/src/batteries/solid.luau
node agent-os/smoke/node_smoke.mjs

# 3b) Portable CAD IR (cad.ir/v0) — validate/bind units + document demos
node agent-os/smoke/ir_unit_smoke.mjs   # bind/validate/canonical + eval_pose
node agent-os/smoke/ir_smoke.mjs        # box-cut + pipe skid + robot FK via require("ir")

# 3c) Luau batteries surface (route/frames/query/cad + solid.* → IR tape)
node agent-os/smoke/solid_api_smoke.mjs

# 3d) Host params pipeline (resolve/extract/infer/inject — no OCCT)
node agent-os/smoke/params_smoke.mjs

# 4) Browser demo (stages + serves)
./agent-os/scripts/dev.sh
# open http://127.0.0.1:8765/  → Warm (optional) → Run Luau

# 5) Production pack + GitHub Release (bb builds Wasm; Dokploy only downloads tarball)
#    See ../docs/DEPLOY.md
# ./scripts/pack-demo-stage.sh
# ./scripts/release-demo.sh --tag demo-v0.1.0 --notes "…"
```

### Portable IR (`cad.ir/v0`)

| Piece | Path |
|-------|------|
| Design | [`../docs/cad-ir-v0-design.md`](../docs/cad-ir-v0-design.md) |
| Examples / goldens | [`../docs/ir/`](../docs/ir/) (Apache) |
| Luau runtime | [`src/batteries/ir/`](src/batteries/ir/) (`require("ir")`) |
| Host lowers | [`src/occ-bridge.js`](src/occ-bridge.js) — route, pipe_annulus, compose_chain, trsf_apply |

```luau
local ir = require("ir")
local doc = ir.load(json_string)  -- or table
local res = ir.run_demo(doc)      -- eval + __OCC_CAD_RESULT__ like solid.finish
```

## Bazel

Release assets are pinned in root `MODULE.bazel` (`@agent_os_*` `http_file` targets, tag **v0.4.0**).

```bash
bazel build //agent-os:release_assets
bazel build //api:libocc_c_wasm
bazel run //agent-os/smoke:node_smoke   # after wasm build
```

## Layout

```text
agent-os/
  src/               # protocol, occ-bridge, runtime-worker, main UI, batteries
  demo/              # index.html + static server
  smoke/             # Node vertical slice
  scripts/           # fetch-release, stage, dev
  TASKS.md           # implementation checklist
  vendor/            # gitignored local downloads
```

## Luau surface (v0)

**Batteries author through IR tape only** (`solid` / `route` / `frames` / `query` → `cad.ir` ops → eval → host). Guest handles are IR string op ids end-to-end; `solid.finish` evaluates the tape. Features (fillet, drill, shell, revolve, member sweep, mass/mesh, STEP, …) are registered IR ops. `solid.realize` is rare interop only.

```luau
local solid = require("solid")
local a = solid.box({ dx = 20, dy = 10, dz = 8 })
local b = solid.cylinder({ radius = 2, height = 10, origin = { 10, 5, -1 } })
local part = solid.cut(a, b)
solid.finish(part)  -- evaluates IR tape, emits mesh marker
```

Host meshes the finished root and returns positions/normals/indices to the page.

## Parameters (framework)

Parametric scripts use a **host-owned store** + **inject-only** guest binding (see root [`REACTIVITY.md`](../REACTIVITY.md) §16).

| Piece | Path |
|-------|------|
| Resolve / extract / infer / inject | [`src/params/`](src/params/) (`resolveParams`, `injectParamsPrelude`) |
| Sheet + store | `src/params/sheet.js`, `store.js` |
| Battery | [`src/batteries/params.luau`](src/batteries/params.luau) — `require("params")` |
| Demo | `src/demos/block-hole-params.js` — Luau `--[[params]]` + `params.width` |

```luau
--[[params
width = { value=40, min=16, max=120, unit="mm", group="Size" }
]]
local solid = require("solid")
local w = params.width                    -- host inject + battery __index
-- or: local w = params.number("width", { default = 40, min = 16, max = 120 })
```

Schema is resolved from source (explicit block / `@param` / `P.number(...)` / conservative header inference). Values come from the sheet store and are **injected** after any `--!` hot comments — the editor is not rewritten on every scrub. Demo seed is applied only in demo mode, not onto unrelated editor buffers.

## View command focus

Viewport shortcuts (F fit, G grid, …) use [`src/view/command-router.js`](src/view/command-router.js): fire unless focus is **text entry** (Monaco `hasTextFocus()`, native input/textarea, contenteditable). Param chrome (sliders/switches) is **not** text entry — F still fits after scrubbing. Escape blurs param controls and focuses the canvas.
