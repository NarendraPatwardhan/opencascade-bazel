# AgentOS CAD demo — task tracker

Scratch items with `[x]` as they land. Goal: **browser demo** where Luau runs in AgentOS `loom`, geometry runs on host `libocc_c_wasm`, and a solid is visible in 3D.

## Legend

- `[ ]` todo · `[~]` in progress · `[x]` done · `[-]` cancelled / deferred

---

## 0. Housekeeping

- [x] Choose AgentOS path (not freestanding Luau)
- [x] `agent-os/` BSL LICENSE + README boundary
- [x] `scripting/` gitignored for local design notes
- [x] Rename `//examples/c_smoke` → `//examples/c_api`
- [x] Create this `TASKS.md`

## 1. Release pins (AgentOS v0.4.0)

- [x] `http_file` for `kernel.wasm` (sha256 pinned)
- [x] `http_file` for `loom.tar`
- [x] `http_file` for `mc-core.mjs`
- [x] `http_file` for `catalog-compiler.wasm`
- [x] Bazel `filegroup` `//agent-os:release_assets`
- [x] `scripts/fetch-release.sh` (raw GitHub download + sha256)

## 2. OCCT Wasm host surface

- [x] Loader supports classic MODULARIZE glue (wrap-as-ESM) + maps `*.wasm` → `libocc_c.wasm`
- [x] `EXPORT_ES6` flag added on `//api:libocc_c_wasm` (rebuild via **bb only** when needed)
- [x] `occ-bridge.js` — handle table + mesh extract
- [x] Ops: make_box, make_cylinder, make_sphere, fuse, cut, translate, fillet_all, free, volume, bbox, mesh
- [x] Demo uses built `libocc_c` Wasm artifact (vendor/occ or bazel-bin via stage)

## 3. CadEngine core (BSL)

- [x] Message protocol (`config` / `warm` / `execute` + mesh transferables)
- [x] Host tool kit (`cad call` → `host.org.main.cad.call`)
- [x] Runtime worker: AgentOS `mc.create` + tools + OCC bridge
- [x] Luau batteries `/opt/cad/solid.luau` staged via `vm.fs`
- [x] Result contract: `__OCC_CAD_RESULT__` + host mesh

## 4. Demo UI

- [x] Static page: Luau editor + Run + status + log
- [x] **Monaco + Luau Monarch** (`monaco-luau-language.js` from icebearc/monaco-luau MIT; `luau-editor.js`; Mod-Enter)
      - Checked: no first-party Monaco “lang-luau” npm package; built-in is Lua-only; vendored Luau Monarch instead
- [x] 3D view (Three.js CDN BufferGeometry + orbit)
- [x] Tiny service worker script (optional; not required for first green)
- [x] `demo/serve.mjs` + `scripts/dev.sh` stage+serve

## 5. Bazel / Node entrypoints

- [x] `//agent-os:stage` genrule (manual; uses **bb**)
- [x] `//agent-os/smoke:node_smoke` (manual; **bb run**)
- [x] `scripts/dev.sh` browser demo on localhost
- [x] `agent-os/README.md` runbook

## 6. Acceptance (demo “green”)

- [x] Node smoke: real loom Luau + real OCC cut + mesh (`node_smoke PASS`, 130 verts / 120 tris)
- [x] Browser: page loads, Run default Luau, status `OK — N verts…` (headless Chromium CDP e2e)
- [x] Boolean sample works in browser (default `block_hole` cut script)
- [x] Viewer: Three.js when WebGL available; SVG bbox fallback when not (headless)
- [x] Failure path: bad Luau surfaces in UI (`luau: … Incomplete statement…`) without killing the tab

## 7. Follow-ups (after first green — not blocking demo)

- [ ] Integrity manifest (search-experience style sha256 map)
- [ ] `pkg_tar` one-directory release under `agent-os/`
- [ ] GLB export + `<model-viewer>` path
- [ ] `luau-analyze` gate before execute
- [ ] Param re-run / Adam-like chrome

---

## Agent build policy

**Agents on this host: only `bb … --config=buildbuddy` for Bazel.**  
Never fall back to local `bazel build` (end users with better rigs may).

## Runbook

```bash
# Fetch AgentOS release (no Bazel)
./agent-os/scripts/fetch-release.sh

# Build OCCT Wasm on RBE only
bb build --config=buildbuddy //api:libocc_c_wasm
mkdir -p agent-os/vendor/occ
cp -fL bazel-bin/api/libocc_c.js bazel-bin/api/libocc_c.wasm agent-os/vendor/occ/

# Node smoke (no Bazel once artifacts exist)
export AGENT_OS_KERNEL=$PWD/agent-os/vendor/kernel.wasm
export AGENT_OS_LOOM=$PWD/agent-os/vendor/loom.tar
export AGENT_OS_MC_CORE=$PWD/agent-os/vendor/mc-core.mjs
export AGENT_OS_CATALOG=$PWD/agent-os/vendor/catalog-compiler.wasm
export OCC_BASE=$PWD/agent-os/vendor/occ
export SOLID_LUAU=$PWD/agent-os/src/batteries/solid.luau
node agent-os/smoke/node_smoke.mjs

# Or via RBE-built runfiles
bb run --config=buildbuddy //agent-os/smoke:node_smoke

# Browser demo
./agent-os/scripts/dev.sh
# open http://127.0.0.1:8765/
```
