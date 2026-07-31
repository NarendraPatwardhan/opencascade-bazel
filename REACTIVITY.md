# REACTIVITY.md — Parametric scripts, live params, gimbals

**Repository:** [`NarendraPatwardhan/opencascade-bazel`](https://github.com/NarendraPatwardhan/opencascade-bazel)  
**Document type:** Authoring / UI reactivity specification  
**Audience:** Humans and agents implementing Luau/IR parameters, live re-eval, and scene handles  
**Status:** Living  
**Last restated:** 2026-07-31  
**Related:** [`SYSTEM.md`](SYSTEM.md) · [`DISPLAY.md`](DISPLAY.md) · [`AGENTS.md`](AGENTS.md) · Matt Keeter [Ao](https://www.mattkeeter.com/projects/ao/) / [libfive Studio](https://libfive.com/) · [Adam-CAD/CADAM](https://github.com/Adam-CAD/CADAM)

---

## 0. One-sentence mission

> Treat the **model as a program with free parameters**; bind **sliders and scene gimbals** to those parameters; re-evaluate on a **tiered** path (`view` / `xform` / `rebuild`) so humans and agents can scrub intent without fighting the trust boundary or remeshing on every mouse pixel.

---

## 1. The idea (Matt Keeter lineage)

In **Ao → libfive / Studio**, a solid is a **script**. Free variables are first-class. The UI does not only edit text: it **binds widgets to parameters** and **re-runs the evaluator** when they move. Antimony is the same idea as a **node graph** (tweak a port → graph re-executes).

| Piece | Role |
|-------|------|
| **Script / IR** | Source of truth |
| **Free parameters** | Named numbers (and enums/bools) in the program |
| **Gimbals / sliders** | Views onto those parameters — not a second parallel model |
| **Re-eval** | Param change → evaluator → new solid / mesh / poses |
| **Direct modeling (Studio-hard)** | Some edits rewrite the script/tree (out of scope for P0) |

```text
  script / IR  (free vars in params{})
       ▲                         │
       │ bind (never raw BREP)   │ re-eval (tiered)
       │                         ▼
  sliders + scene gimbals  →  mesh / instance xforms / DISPLAY
```

**We already have:** parametric Luau/IR and a Run → `occ_*` → mesh path.  
**We do not yet have:** live param binding, tiered scrub, and scene handles as a product loop.

| Already true | Still to build |
|--------------|----------------|
| Params in scripts / IR sketches | Structured `params` metadata (`min`/`max`/`scrub`) |
| Full re-eval on **Run** | Debounced live rebuild + instant **xform** tier |
| Mesh refresh after success | Gimbals at **AttachFrame** / route nodes |
| Human oversight (Run) | Optional **Live** mode with clear stale/error states |

---

## 2. Why this matters for dual goals

| Goal | Reactive params |
|------|-----------------|
| **AI-BOOST skid** | Scrub bend radius, elevation, clearance; clash KPI updates |
| **6-DOF robot** | Scrub \(θ_i\) with **xform-only** FK (no BREP rebuild) |
| **Agents** | Emit IR + `params{}`; human explores with gimbals; freeze → export |
| **IR novelty** | Same op graph; only parameter values change — explainable rework |

---

## 3. Parameter contract

### 3.1 Canonical shape (IR / host JSON / Luau conventions)

```yaml
params:
  bend_r_m:
    value: 0.15
    default: 0.15
    min: 0.05
    max: 0.40
    step: 0.005
    unit: m
    scrub: rebuild          # view | xform | rebuild
    group: Piping
    display_name: Bend radius
  theta_2:
    value: 0.30
    min: -2.8
    max: 2.8
    unit: rad
    scrub: xform
    frame: F_J2             # optional: bind rotate gimbal to this frame
    axis: z
    group: Joints
  show_grid:
    value: true
    scrub: view
```

| Field | Purpose |
|-------|---------|
| `value` / `default` | Current vs authored default (reset control) |
| `min` / `max` / `step` | Slider / gimbal range |
| `unit` | SI discipline in UI |
| `scrub` | Evaluation tier (§4) |
| `frame` / `axis` | Scene gimbal placement |
| `group` / `display_name` | Parameter sheet UX |
| `options` | Enum / discrete (CADAM-style) |

### 3.2 Rules

| Rule | Detail |
|------|--------|
| Luau reads params only | Libraries take `params.bend_r_m`, never invent hidden globals |
| Gimbals edit params only | Never drag raw B-rep vertices in P0 |
| IR ids stay stable | Param scrub does not rename ops |
| Bare magic numbers | Linter / agent style: promote feature dimensions to `params` |

---

## 4. Evaluation tiers

| Tier | `scrub` | Trigger | Pipeline | Latency target |
|------|---------|---------|----------|----------------|
| **view** | `view` | Grid, colors, camera chrome | DISPLAY only | < 1 frame |
| **xform** | `xform` | Joint angles, occurrence poses | `ComposeChain` / instance matrices → redraw | < 1–2 frames |
| **rebuild** | `rebuild` | Dimensions that change BREP | IR → `occ_*` → mesh (debounce) | 50–200 ms debounce + worker time |

| Example | Tier |
|---------|------|
| Robot \(θ_1…θ_6\) | **xform** |
| Equipment placement pose | **xform** |
| Pipe OD / bend R / hole count | **rebuild** |
| Ground grid toggle | **view** |

**B-rep reality:** full OCCT rebuild every mousemove is wrong. Tiering is mandatory (unlike pure f-rep Ao where “re-eval tree” was the whole game).

---

## 5. Control surface types

| Control | Binds to | Scene / UI behavior |
|---------|----------|---------------------|
| **Slider + numeric** | Scalar param | Parameter sheet |
| **Checkbox / enum** | Bool / options | Sheet |
| **Rotate gimbal** | Angle param | Ring about `frame` + `axis` |
| **Translate arrow** | Length / offset | Arrow along frame axis |
| **Point handle** | Route node coords | Drag node → rebuild `RoutePath` |
| **View cube / triad** | Camera only | Not a model param (see CADAM §7) |
| **Reset to default** | `default` field | Per-param or per-group |

**P0 product rule:** handles edit **parameters / IR inputs**, not arbitrary topology. (Studio-style direct modeling that rewrites scripts is P2+.)

---

## 6. Trust boundary (aligns with SYSTEM D9)

```text
Untrusted Luau (guest)
    → may read params snapshot
Host UI / tools
    → owns param writes, Live toggle, Run, export
occ_c
    → only via host tools
DISPLAY
    → mesh + gimbals; no ambient guest FS
```

| Allowed | Forbidden |
|---------|-----------|
| UI writes `params` → host re-eval | Guest pokes Wasm mesh memory |
| Live **xform** always reasonable | Silent STEP export on every scrub |
| Live **rebuild** behind explicit **Live** toggle | Unbounded rebuild storms on drag |
| Stale mesh banner if rebuild fails | Page crash on OCCT error |

---

## 7. Steal list — [CADAM](https://github.com/Adam-CAD/CADAM) (Adam-CAD)

CADAM is an open-source **text → parametric OpenSCAD** web app (three.js / R3F viewer + parameter sheet). It is **not** our kernel, but its **param + viewer UX** is excellent reference.  
Inspected tree: `src/components/parameter/*`, `src/components/viewer/*`, `shared/types.ts` (`Parameter`), `shared/parseParameters.ts`.

### 7.1 What CADAM does well

| # | Steal | Where in CADAM | Our mapping |
|---|--------|----------------|-------------|
| C1 | **Structured `Parameter` type** — name, displayName, value, defaultValue, type, range, options, group, description | `shared/types.ts` | §3.1 param contract |
| C2 | **Parameter extraction from code** — parse adjustable dimensions from generated script (OpenSCAD customizer-style) | `parseParameters` / README “Parameter Extraction” | Extract from Luau tables + IR `params` (agents must emit metadata) |
| C3 | **Smart updates without re-prompting AI** — param change recompiles model only | README “Smart Updates” | Param scrub never re-calls NL planner |
| C4 | **Slider `onValueChange` vs `onValueCommit`** — live UI value while dragging; commit for heavier work | `ParameterSlider.tsx` | change → local state; commit / debounce → xform or rebuild |
| C5 | **Debounced rebuild (~200 ms)** + flush pending on unmount | `ParameterSection.tsx` | Same pattern for `scrub: rebuild` |
| C6 | **Group params** (dimensions vs colors; collapsible sections) | `ParameterSection.tsx` | `group: Piping \| Joints \| Display` |
| C7 | **Range / step helpers** from param magnitude | `parameterUtils` | Auto step from unit/scale if missing |
| C8 | **View cube gizmo** (orientation preset) with **canonical snap** (fix drei drift) | `ViewGizmo.tsx` + comment on camera.up drift | Port idea into DISPLAY view presets; not a model param |
| C9 | **Ortho / perspective toggle** | `OrthographicPerspectiveToggle.tsx`, `ThreeScene.tsx` | DISPLAY A13–A14 |
| C10 | **OrbitControls damping** + staged lighting / environment | `ThreeScene.tsx` | Optional; prefer DISPLAY editor-cam long-term |
| C11 | **Infinite grid commented intent** (`infiniteGrid={true}` on drei Grid) | `ThreeScene.tsx` (commented) | We use **Option B shader** per DISPLAY.md — not drei Grid |
| C12 | **Export after param explore** (STL/SCAD/DXF) | Download menu + parameter section | STEP/mesh/robot package after human gate |
| C13 | **Default marker on slider** (show authored default) | Slider `defaultValue` / default marker | Reset affordance |
| C14 | **Worker / async compile** so UI stays responsive | OpenSCAD wasm worker path | Keep eval on AgentOS / occ worker; never block Monaco |

### 7.2 CADAM “gimbals” — clarify terminology

| User language | In CADAM codebase | Steal as |
|---------------|-------------------|----------|
| **View gimbal / view cube** | `ViewGizmo` (`GizmoHelper` + `GizmoViewcube`) | Camera orientation widget (DISPLAY) |
| **Parametric controls** | `ParameterSlider` / `ParameterInput` sheet | Primary reactive surface (this doc) |
| **3D transform gimbals on the part** | **Not** a first-class CADAM feature in the inspected tree | We still want **rotate/translate handles at frames** (Matt Ao + robot) as **our** P1 |

CADAM’s strength is **sheet-driven parametric scrub + polished view chrome**, not libfive-style in-scene dimension gimbals. We steal the former; we **design** the latter.

### 7.3 CADAM patterns to copy almost verbatim

```text
drag slider
  → onValueChange: update displayed value only (cheap)
  → debounce 200ms OR onValueCommit
       → onParameterChange(full param list)
            → recompile / re-mesh in worker
            → swap geometry in viewer
```

| Pattern | Why |
|---------|-----|
| Change vs commit | Avoid rebuild-per-pixel |
| Debounce + unmount flush | No lost last edit |
| Full param list replace | Simple, serializable, agent-friendly |
| No AI on param path | Planner ≠ evaluator (our trust story) |

### 7.4 Do not steal from CADAM

| Skip | Why |
|------|-----|
| OpenSCAD as geometry kernel | We are OCCT / `occ_c` B-rep |
| Text-to-CAD planner as core | Optional intake; not reactivity itself |
| GPL entanglement of their UI code | Reimplement patterns; don’t copy large GPL sources into Apache tree without license review |
| drei `Stage`+HDR as required | Nice; not P0 for industrial review |
| Finite/comment-only grid | DISPLAY Option B |

---

## 8. Steal list — Matt Keeter (Ao / Studio / Antimony)

| # | Steal | Source idea | Our mapping |
|---|--------|-------------|-------------|
| M1 | Script is the model | Ao Scheme | Luau + IR |
| M2 | Free vars as UI hinges | Studio sliders | `params{}` |
| M3 | Re-eval on param change | Ao / Studio | Tiered §4 |
| M4 | Graph ports as params | Antimony | IR node inputs |
| M5 | Homoiconic clarity | Ao | Prefer explicit params over hidden closure state |
| M6 | Direct modeling rewrites program | Studio (hard) | **Out of P0** |

F-rep kernel ideas stay **out** of `occ_c`; only the **reactive parameter** product idea transfers.

---

## 9. Scene gimbals (our design — beyond CADAM sheet)

| Gimbal | Param types | Placement | Pick vs camera |
|--------|-------------|-----------|----------------|
| **Rotate ring** | angle rad/deg | At `AttachFrame`, about local axis | Priority over orbit when handle hit |
| **Axis arrow** | length / offset | Frame origin → axis | same |
| **Point** | `vec3` node | World position of route node | same |
| **Composite joint** | robot \(θ_i\) | At joint frame | xform tier only |

| Implementation note | Detail |
|---------------------|--------|
| Hit testing | Separate handle pick layer; DISPLAY editor-cam ignores orbit when handle active |
| Units | Draw scale from bbox so handles stay ~visible |
| Feedback | Ghost previous pose optional; live mesh for xform |
| Rebuild handles | Show spinner / dim mesh while worker runs |

---

## 10. Host loop (normative)

```text
1. Load document: Luau and/or IR + params{}
2. Materialize UI:
     - Parameter sheet from params metadata (CADAM C1–C7)
     - Scene gimbals from params with frame/axis (§9)
3. On param event:
     a. Validate min/max/step
     b. Write params store (host)
     c. switch scrub:
          view    → DISPLAY options
          xform   → recompute poses; upload matrices; redraw
          rebuild → debounce → worker: lower IR → occ_* → mesh → showMesh
4. On failure: keep last good mesh; error line; do not clear gimbals
5. Export: only from last good eval + human action
```

| Live mode | Behavior |
|-----------|----------|
| **Off** (default for rebuild) | Sliders update values; Apply / Run triggers rebuild |
| **On** | Debounced rebuild while dragging |
| **xform** | Always live (cheap) |

---

## 11. Module layout (suggested)

```text
agent-os/src/
  params/
    types.ts           # Parameter type (C1)
    store.ts           # host param state
    extract.ts         # from IR / Luau metadata (C2)
    sheet.tsx          # CADAM-like section/slider (C4–C7)
  eval/
    tiers.ts           # view | xform | rebuild
    debounce.ts        # C5
    run-rebuild.ts     # worker occ path
    run-xform.ts       # ComposeChain / instances
  view/
    gimbals.ts         # §9 scene handles
    view-cube.ts       # C8
    ...                # DISPLAY.md modules
```

Apache tree: reimplement in our code. Do not vendor CADAM GPL sources without a conscious license decision.

---

## 12. Implementation order

| Phase | Work | Exit criteria |
|-------|------|----------------|
| **R0** | `params` types + sheet bound to demo script | Change number → shows in UI |
| **R1** | Debounced rebuild on commit (CADAM C4–C5) | Drag slider → remesh without AI |
| **R2** | `scrub: xform` for one robot joint | Instant pose, no remesh |
| **R3** | Live toggle for rebuild | Default off; on = debounced |
| **R4** | One rotate gimbal at `AttachFrame` | Drag ring → param → xform |
| **R5** | Route node point handles | Drag → rebuild pipe |
| **R6** | View cube (C8) + param groups | CADAM-level chrome |
| **R7** | Agent emits full `params{}` metadata | No bare dimensions in P0 demos |

---

## 13. Quality bar

| Check | Pass |
|-------|------|
| Param path never calls NL/planner | C3 |
| Rebuild not on every pointermove | debounce / commit |
| xform joint scrub ≥ interactive | no full OCCT |
| Failed rebuild keeps last mesh | no blank viewport |
| Export gated | human action |
| Gimbals don’t steal camera when not hit | DISPLAY bindings |
| Params serializable in IR | round-trip JSON/YAML |

---

## 14. Non-goals

| Non-goal | Why |
|----------|-----|
| F-rep kernel | Different product; we stay B-rep OCCT |
| Full Studio direct modeling | Rewriting scripts from freeform drags is P2+ |
| Copy CADAM GPL UI into Apache tree blindly | License boundary |
| Rebuild-everything reactivity | Kills Wasm UX |
| Params only in closure locals | Not inspectable by sheet/agents |

---

## 15. Relationship to other docs

| Doc | Boundary |
|-----|----------|
| **SYSTEM.md** | Why IR + Luau + trust exist |
| **DISPLAY.md** | How we draw mesh, camera, infinite grid |
| **REACTIVITY.md** (this) | How params drive re-eval and handles |
| **literate-sections/** | Kernel ops that rebuild/xform call |

```text
Agent / human
    → params + IR/Luau     (REACTIVITY)
        → occ_c eval       (literate / api)
            → mesh buffers
                → viewport (DISPLAY)
```

---

## 16. Change log

| Date | Change |
|------|--------|
| 2026-07-31 | Initial REACTIVITY.md: Ao-style reactive scripts, tiered eval, param contract, CADAM steal tables (sheet + view gizmo), scene gimbal plan |

---

*If chat and this file disagree on live param behavior, update this file or explicitly amend it — do not leave two truths.*
