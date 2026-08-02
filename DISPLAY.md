# DISPLAY.md — Browser CAD viewport & camera

**Repository:** [`NarendraPatwardhan/opencascade-bazel`](https://github.com/NarendraPatwardhan/opencascade-bazel)  
**Document type:** Display / review-UI specification — what to build, what to steal, what to refuse  
**Audience:** Humans and agents implementing the mesh review panel next to Monaco / AgentOS  
**Status:** Living — update when viewport scope changes  
**Last restated:** 2026-07-31  
**Related:** [`SYSTEM.md`](SYSTEM.md) (north star) · [`REACTIVITY.md`](REACTIVITY.md) (params / gimbals / CADAM **param** steals) · [`AGENTS.md`](AGENTS.md) (coding rules) · [`docs/README.md`](docs/README.md) · [`agent-os/src/mesh-view.js`](agent-os/src/mesh-view.js) (current implementation)

---

## 0. One-sentence mission

> Ship a **WebGL2 CAD review viewport** that consumes **`occ_mesh_*` buffers**, navigates like an **industrial editor** (not a product-turntable), and includes a **true infinite ground grid (shader plane)** — without adopting Bevy, `<model-viewer>`, or WebGPU as the runtime.

---

## 0.1 Doc split rule

| Question | Document |
|----------|----------|
| Does it change the **model** or **when we re-eval**? | [`REACTIVITY.md`](REACTIVITY.md) |
| Does it change how we **see / navigate** a given mesh? | **This file (DISPLAY)** |

CADAM **view cube, ortho/persp, lighting, grid intent** → here.  
CADAM **parameter sheet, debounce, smart updates** → REACTIVITY only.

---

## 1. Context: what we have today

| Item | Location / fact |
|------|-----------------|
| Geometry truth | `occ_c` → `occ_mesh_compute` → positions / normals / indices |
| Host bridge | `agent-os/src/occ-bridge.js`, `runtime-worker.js` |
| Current viewer | [`agent-os/src/mesh-view.js`](agent-os/src/mesh-view.js) — **three.js + WebGL**, not model-viewer |
| Camera today | LMB spherical orbit about bbox center + wheel dolly (toy-grade) |
| Fallback | SVG bbox when WebGL missing (keep for CI / headless) |
| Kernel Wasm | Heavy piece; viewer must stay **thin** |

**Important correction:** the demo already uses **three.js**, not Google `<model-viewer>`. Upgrades replace/extend `mesh-view.js` (or a small `view/` package), not a web-component migration.

---

## 2. What this document is vs is not

| Document | Purpose |
|----------|---------|
| **`DISPLAY.md` (this file)** | Viewport, camera, infinite grid, view chrome steals, non-goals, implementation order |
| **`REACTIVITY.md`** | Params, tiered re-eval, param sheet, scene **param** gimbals |
| **`SYSTEM.md`** | Product intent, IR, trust boundary, dual goals |
| **`api/include/` + `api/src/`** | **Kernel** C API (comments teach the expansion) |

---

## 3. Stack decision

| Choice | Decision | Rationale |
|--------|----------|-----------|
| Renderer | **WebGL2 via three.js** (default) | Already in demo; mature lights/edges/picking |
| Camera math | **Custom TS `EditorCam`** | Port *ideas* from `bevy_editor_cam`, not Bevy ECS |
| Ground | **Option B — infinite shader plane** | True infinite look; no tiled finite mesh as long-term solution |
| WebGPU | **Not required** for Spark / dual-goal review | CAD meshes are not GPU-bound; browser matrix still uneven |
| Bevy in browser | **No** | Wrong cost next to Monaco + `libocc_c` Wasm |
| `<model-viewer>` | **No** as architecture | Product glTF player; wrong camera contract |

### WebGPU — when to revisit

| Revisit if… | Until then… |
|-------------|--------------|
| Multi-million-tri assemblies + heavy post | Stay on WebGL2 |
| GPU compute sectioning / huge point clouds | Prefer three’s backend later, not a custom stack |

---

## 4. Source map (what to read)

| Source | Role | License-ish note |
|--------|------|------------------|
| [`aevyrie/bevy_editor_cam`](https://github.com/aevyrie/bevy_editor_cam) | **Camera contract** — anchor, pan, zoom-to-cursor, limits, momentum | MIT/Apache — reimplement in TS |
| [Bevy infinite grid example](https://bevy.org/examples/dev-tools/infinite-grid/) | Editor ground intent + settings surface (`InfiniteGrid` / `InfiniteGridSettings`) | Steal API *shape* and UX |
| Community infinite-grid crates (e.g. historical `bevy_infinite_grid` lineage) | Shader fade / true-infinite fragment patterns | Reimplement shader; do not vendor Bevy |
| [google/model-viewer](https://github.com/google/model-viewer) `SmoothControls` / `Damper` | **Only** damper curves, multi-touch bookkeeping | Skip AR, staging, web component |
| [Adam-CAD/CADAM](https://github.com/Adam-CAD/CADAM) viewer | **View cube**, ortho toggle, lighting polish (steal list **D**) | GPL app — reimplement patterns; param sheet → REACTIVITY |
| Our `mesh-view.js` | Buffer upload, edges, lights, fallback | Keep and grow |

**Steal means:** reimplement behavior under **our** names. Do not paste Bevy plugins into the browser. Do not depend on Bevy at runtime. Do not vendor CADAM GPL sources without a license decision.

---

## 5. Ground grid — definition (Option B)

By **ground grid** we mean an **editor infinite ground plane**, not a small finite pad.

| Piece | Spec |
|-------|------|
| Plane | Default **Y = 0** (three.js Y-up); document if OCCT/display uses Z-up later |
| Lines | **Minor** + **major** cells (e.g. 0.1 m / 1.0 m) in **world XZ** |
| Infinity | **Visual** — shader samples world coords so edges never run out |
| Fade | Distance-based opacity / density so the horizon is not moiré soup |
| Axes (optional) | Emphasize world X / Z through origin |
| Interaction | **Not** a physics collider; pure viz |
| Depth | Depth-write off or careful test so **solids always win** over grid |

| Approach | Status in this project |
|----------|------------------------|
| **A** — large finite `GridHelper` / line mesh (~±500 m) | Acceptable **bootstrap only** |
| **B** — camera-relative or large plane + **custom `ShaderMaterial`** world-grid | **Chosen long-term** |

---

## 6. Steal list A — camera (`bevy_editor_cam`)

Priority: **P0** = must for “not a toy”; **P1** = strong polish; **P2** = later.

| # | Steal | Pri | Why it matters | Target module |
|---|--------|-----|----------------|---------------|
| A1 | Motion state machine: Stationary → UserControlled → Momentum | P0 | Clean ownership; no stuck drags | `editor-cam.ts` |
| A2 | `start_orbit` / `start_pan` / `start_zoom` + `end_move` | P0 | Explicit gestures | same |
| A3 | **Anchor in view space** (hit under pointer, or last depth) | P0 | Orbit/pan/zoom about *what you clicked* | same |
| A4 | **Last-known depth fallback** on pick miss | P0 | No fly-away over empty sky | same |
| A5 | **Pixel-perfect pan** (world point stuck to cursor) | P0 | CAD muscle memory | same |
| A6 | **Zoom toward cursor** (scale along ray; anchor direction fixed) | P0 | Works at skid and bolt scale | same |
| A7 | **Size-per-pixel zoom limits** (`min_size_per_pixel` / `max_size_per_pixel`) | P0 | Stable at mm and 100 m | same |
| A8 | Optional **zoom-through-objects** at min limit | P2 | Off by default | same |
| A9 | Screenspace input queues + **light** smoothing | P1 | Responsive, not floaty | same |
| A10 | **Momentum** on release (orbit/pan), tunable / disable | P2 | CAD users often want snappy stop | same |
| A11 | **Input debounce** after trackpad / two-finger quirks | P1 | Avoid accidental scroll fights | same |
| A12 | **Orbit constraint** — prefer **turntable + world up** | P0 | Industrial convention | same |
| A13 | Separate **perspective** vs **orthographic** settings | P1 | Prep for engineering views | same |
| A14 | **Persp ↔ ortho without view jump** (warp about anchor) | P1 | Drawing-like views | `projection-morph.ts` |
| A15 | **f64 math on CPU**, f32 on GPU | P1 | Large assemblies / tiny holes | same |
| A16 | Documented **bindings contract** | P0 | See §10 | `bindings.ts` |

### A — do not steal from Bevy cam

| Skip | Why |
|------|-----|
| Bevy ECS / plugins | Wrong runtime |
| `bevy_picking` wiring as dependency | Use three raycast / later custom pick |
| `TransformAdapter` API as-is | Rebind to three `Camera.position` / quaternion |

---

## 7. Steal list B — infinite ground (Option B)

| # | Steal | Pri | Why | Target |
|---|--------|-----|-----|--------|
| B1 | Infinite grid as **editor ground** (not toy pad) | P0 | Orientation + scale | `ground-grid.ts` |
| B2 | Settings surface like `InfiniteGrid` + `InfiniteGridSettings` | P0 | Spacing, colors, fade, visible | same |
| B3 | World-plane shading (**Y = 0**, grid in XZ) | P0 | Matches three default | same |
| B4 | **Major / minor** cell sizes (metric defaults) | P0 | 1.0 m / 0.1 m starting point | same |
| B5 | Section vs grid **colors + opacities** | P0 | Readable on dark UI (`#1a1d23`) | same |
| B6 | **Distance fade** (start/end or density) | P0 | Clean horizon | shader |
| B7 | **AA lines** via screen derivatives (`fwidth`) | P0 | Stable under zoom | shader |
| B8 | Large / camera-relative plane sampling **world** XZ | P0 | True infinite look | same |
| B9 | **Depth write off**; solids occlude grid correctly | P0 | No z-fight with mesh | same |
| B10 | Optional **axis emphasis** (X red, Z blue) | P1 | Instant orientation | same |
| B11 | **Visibility toggle** (UI + hotkey, e.g. `G`) | P0 | Dense models / screenshots | same |
| B12 | Optional screen-space **line thickness** ~1 px | P1 | Constant readability | shader |
| B13 | Community infinite-grid **fade / plane-distance** terms | P1 | Polished editor floor | shader |

### B — shader sketch (normative intent, not final GLSL)

```text
// Fragment (conceptual):
//   worldPos on plane Y=0
//   minor = aa_line(fract(world.xz / minorCell))
//   major = aa_line(fract(world.xz / majorCell))
//   alpha *= fade(distance(camera, worldPos))
//   optional axis boost when abs(x)<eps or abs(z)<eps
```

### B — do not steal

| Skip | Why |
|------|-----|
| Bevy `InfiniteGridPlugin` runtime | Port settings + math only |
| Finite tiled grid as final design | Bootstrap only (§5 approach A) |
| Physics / shadow-catcher floor as P0 | Optional later contact shadows |

---

## 8. Steal list C — model-viewer (thin only)

| # | Steal | Pri | Skip entirely |
|---|--------|-----|----------------|
| C1 | `Damper` settle curves | P2 | Whole `<model-viewer>` element |
| C2 | Touch mapping patterns (1-finger orbit, 2-finger pan/pinch) | P1 | AR / WebXR menu |
| C3 | Multi-pointer bookkeeping / pointer capture habits | P1 | Env HDR / staging product pipeline |
| C4 | Resize + **DPR clamp** (e.g. `min(devicePixelRatio, 2)`) | P0 | Fixed-target spherical model as *only* camera |

model-viewer’s `SmoothControls` is a **fixed-target spherical orbit** — fine for e-commerce, **insufficient** as the sole CAD controller. Prefer list **A**.

---

## 9. Steal list D — [CADAM](https://github.com/Adam-CAD/CADAM) (**view chrome only**)

CADAM’s viewer (`src/components/viewer/*`) is a strong reference for **orientation chrome** and **presentation**.  
**Parameter sheet / debounce / AI-free rebuild** are **not** listed here — see [`REACTIVITY.md` §7](REACTIVITY.md).

| # | Steal | Pri | Where in CADAM | Our mapping |
|---|--------|-----|----------------|-------------|
| D1 | **View cube gizmo** with **canonical snap** (avoid camera.up drift after face clicks) | P1 | `ViewGizmo.tsx` (`GizmoHelper` + `GizmoViewcube` + custom onClick) | `view-cube.ts`; reconcile with editor-cam target/up |
| D2 | **Orthographic ↔ perspective toggle** without losing the model framing intent | P1 | `OrthographicPerspectiveToggle.tsx`, `ThreeScene.tsx` | Complements A13–A14 |
| D3 | **Lighting rig** (multi directional + ambient; optional env) | P2 | `ThreeScene.tsx`, `LightingControls.tsx` | Optional quality preset; industrial default can stay simpler |
| D4 | **Infinite grid intent** in a web CAD viewer | P0 (as reminder) | Commented `Grid` / `infiniteGrid` in `ThreeScene.tsx` | Implement via **Option B shader** (§5–§7), **not** drei `Grid` as final |

### D — pick vs camera (param handles)

Scene **param** gimbals (rotate rings, arrows) are specified in [`REACTIVITY.md` §9](REACTIVITY.md). Display rules:

| Rule | Detail |
|------|--------|
| Handle hit | Suppress orbit/pan start for that gesture |
| Handle miss | Normal editor-cam bindings (§10) |
| Drawing | Handles rendered in viewport layer; **values** owned by param store |

### D — do not steal from CADAM (display scope)

| Skip | Why |
|------|-----|
| OpenSCAD / their mesh pipeline | Our buffers come from `occ_mesh_*` |
| GPL vendoring of their React tree | Reimplement; license review if ever copying |
| Param slider components | **REACTIVITY** |
| drei `Stage` as mandatory | Optional polish only |
| OrbitControls as long-term camera | Prefer steal list **A** |

---

## 10. Input bindings (default contract)

| Input | Action | Notes |
|-------|--------|-------|
| LMB drag | **Orbit** about anchor | Turntable + world up (A12); yield to param handle if hit (D pick rules) |
| MMB drag | **Pan** (pixel-perfect) | Fallback: **Shift + LMB** |
| Wheel | **Zoom to cursor** | Not FOV-only zoom |
| RMB drag | Optional pan or orbit (pick one; document) | Avoid fighting context menu |
| Double-click | Optional focus / set anchor | P1 |
| `F` | Fit all | P0 |
| `G` | Toggle ground grid | P0 |
| `O` / `5` | Toggle ortho / persp | P1 |
| View cube faces | Snap camera to orthographic-ish dirs | D1 |
| `Numpad 1/3/7` or buttons | Front / Right / Top (optional) | P2 / E3 |
| `Escape` | Blur param chrome → focus canvas | P1 |
| Touch: 1 finger | Orbit | C2 |
| Touch: 2 finger drag | Pan | C2 |
| Touch: pinch | Zoom to midpoint | C2 |

### 10.1 Focus policy (view command routing)

Single-key view cmds fire **unless** focus is **text entry**:

| Text entry (do **not** steal F/G/…) | Not text entry (F still fits) |
|------------------------------------|-------------------------------|
| Monaco `hasTextFocus()` | Custom param slider (`.cad-slider`) |
| Native `input` / `textarea` / `select` (text-like) | Param switch / toggle / group trigger |
| `contenteditable` / ancestor | Viewport canvas |

Implementation: [`agent-os/src/view/command-router.js`](agent-os/src/view/command-router.js); editor exposes `hasTextFocus()`; viewport receives `isEditorFocused` probe from `main.js`.

---

## 11. CAD chrome (build ourselves — not in cam/grid repos)

| # | Feature | Pri | Notes |
|---|---------|-----|--------|
| E1 | World **triad** (corner or origin) | P1 | Independent of grid |
| E2 | **Fit all** / frame bbox with padding | P0 | After every successful Run / rebuild |
| E3 | View presets (Top / Front / Right / Iso) | P2 | Uses same `EditorCam`; cube (D1) is related |
| E4 | **Named frames** as axis gizmos | P1 | Draw only; **param binding** in REACTIVITY |
| E5 | **Clash paint** (multi-mesh colors) | P1 | Dual-goal KPI |
| E6 | Ray pick → body/face id | P2 | Better anchors than bbox; feeds A3 |
| E7 | Section plane | P2 | Not required for Spark narrative |
| E8 | Per-body visibility / isolate | P2 | Assemblies |

---

## 12. Keep list K — current `mesh-view.js`

| # | Keep | Upgrade path |
|---|------|----------------|
| K1 | Upload `positions` / `normals` / `indices` from `occ_mesh_*` | Multi-body `Group` later |
| K2 | `WebGLRenderer` + ambient/key/fill lights | Optional CADAM-like rig (D3) |
| K3 | `MeshStandardMaterial` + double-side | Per-body color / clash materials |
| K4 | `EdgesGeometry` overlay | Tunable threshold; body-colored edges |
| K5 | ResizeObserver + aspect | Keep; DPR clamp (C4) |
| K6 | SVG bbox **fallback** when no WebGL | Keep for smoke/CI |
| K7 | Simple spherical orbit | **Replace** with §6 EditorCam |

---

## 13. Target module layout

```text
agent-os/src/view/
  cad-viewport.ts      # scene, renderer, resize, public showMesh / setMeshes
  editor-cam.ts        # §6 A1–A16
  ground-grid.ts       # §7 B1–B13 (Option B shader)
  view-cube.ts         # §9 D1
  bindings.ts          # §10
  fit.ts               # E2
  triad.ts             # E1
  gimbals.ts           # draw + pick; values from REACTIVITY param store
  fallback.ts          # K6
  materials.ts         # optional shared materials
```

| Public API (stable intent) | Role |
|----------------------------|------|
| `showMesh(container, mesh)` | Drop-in replacement for today’s entry | 
| `setMeshes(meshes[])` | Multi-body / clash (P1) |
| `setFrames(frames[])` | Named SE(3) gizmos (P1) |
| `setOptions({ grid, bindings, … })` | Settings |
| `dispose()` | Same lifecycle as current return cleanup |

Mesh payload (unchanged kernel contract):

```ts
{
  positions: Float32Array,  // xyz
  normals?: Float32Array,
  indices: Uint32Array,
  bbox?: { min: number[]; max: number[] },
  volume?: number,
  color?: string,
}
```

---

## 14. Implementation order

| Phase | Work | Exit criteria |
|-------|------|----------------|
| **0** | Extract `view/` from `mesh-view.js` without behavior change | Demo still runs |
| **1** | **B** infinite grid shader + toggle `G` | Visible infinite floor under solid |
| **2** | **A3–A6, A12, A16** orbit/pan/zoom-to-cursor + turntable | Feels like editor, not product spin |
| **3** | **A4, A7, A9** fallback depth, zoom limits, light smoothing | No fly-away; stable scales |
| **4** | **E2 fit** + **K4 edges** polish + triad **E1** | Run → frame → readable BRep |
| **5** | **D1 view cube** + **D2 / A13–A14** ortho path | CADAM-level orientation chrome |
| **6** | **E4 frames** draw + **E5 clash** multi-mesh | Dual-goal demos |
| **7** | Param handle **pick vs cam** (with REACTIVITY R4+) | Handles and orbit coexist |
| **8** | **A10 momentum**, **C1 damper**, pick **E6** | Polish only |

---

## 15. Quality bar (viewport)

| Check | Pass condition |
|-------|----------------|
| WebGL path | Solid visible, grid optional, no console errors |
| Fallback path | No WebGL → SVG/stats still show success |
| Orbit | Anchor under cursor (or last depth); world-up preserved |
| Pan | Clicked feature tracks pointer |
| Zoom | Toward cursor; limited by size-per-pixel |
| Grid | Infinite look; fades; no z-fight with mesh |
| Fit | `F` / auto-fit frames whole bbox with margin |
| View cube | Face click → stable canonical orientation (D1) |
| Mobile | Touch orbit/pan/pinch usable ~390 px width |
| Perf | 60 fps class for typical demo meshes (not 10M tris) |
| Bundle | No Bevy; three stays loadable (CDN or pinned dep) |

---

## 16. Explicit non-goals

| Non-goal | Why |
|----------|-----|
| Bevy (or any game engine) as browser shell | Kernel Wasm + Monaco already heavy |
| `<model-viewer>` as host component | Wrong abstraction layer |
| WebGPU for v1 display | Not the bottleneck; portability cost |
| Finite grid as final ground | Option B is normative |
| In-kernel rendering / OCCT AIS in Wasm | Display is host JS |
| Full CAD sketcher in WebGL | Authoring is Luau/IR + kernel |
| Pixel-perfect print drawings | Different product |
| Param sheet / rebuild policy | **REACTIVITY** sole owner |

---

## 17. Dual-goal display checklist

| Goal | Viewport needs |
|------|----------------|
| **AI-BOOST skid** | Infinite ground for elevation read; multi-body colors; clash red/green; fit whole skid; optional nozzle frames |
| **6-DOF robot** | Joint **frame gizmos**; base on ground; pan/orbit around links; fit arm; optional TCP triad |
| **Shared** | Editor cam (A), infinite grid (B), fit, edges, dark industrial chrome, view cube (D1) |

---

## 18. Relationship to trust boundary

```text
Untrusted Luau (AgentOS guest)
    → host tools → occ_c (trusted)
        → mesh buffers (numbers only)
            → DISPLAY viewport (trusted UI process)
```

| Rule | Detail |
|------|--------|
| Viewport never calls OCCT directly from the guest | Only host-provided buffers / ids |
| No ambient FS from viewer | Load paths stay in host |
| Run / approve stays in UI | Display does not auto-execute scripts |
| Param writes | Host / REACTIVITY — display only reflects |

---

## 19. Change log

| Date | Change |
|------|--------|
| 2026-07-31 | Initial DISPLAY.md: WebGL2/three decision, Option B infinite grid, steal tables A–C, keep list, module layout, phased plan |
| 2026-07-31 | **CADAM view steals (D1–D4)** moved here; param steals stay in REACTIVITY; doc split rule §0.1 |

---

*If chat and this file disagree on display scope, update this file or explicitly amend it — do not leave two truths.*
