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

# 3b) Portable CAD IR (cad.ir/v0) — validate/bind units + Path A demos
node agent-os/smoke/ir_unit_smoke.mjs   # bind/validate/canonical + eval_pose
node agent-os/smoke/ir_smoke.mjs        # box-cut + pipe skid + robot FK via require("ir")

# 3c) Dual-goal Luau surface (route/frames/query/cad + solid.* → IR)
node agent-os/smoke/solid_api_smoke.mjs

# 4) Browser demo (stages + serves)
./agent-os/scripts/dev.sh
# open http://127.0.0.1:8765/  → Warm (optional) → Run Luau
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

**`solid.*` always lowers to IR** (tape → `cad.ir` eval → host). There is no direct-host Path B for solid authoring. **`route` / `frames`** remain host-backed tools for pipe runs and FK place.

```luau
local solid = require("solid")
local a = solid.box({ dx = 20, dy = 10, dz = 8 })
local b = solid.cylinder({ radius = 2, height = 10, origin = { 10, 5, -1 } })
local part = solid.cut(a, b)
solid.finish(part)  -- evaluates IR tape, emits mesh marker
```

Host meshes the finished root and returns positions/normals/indices to the page.
