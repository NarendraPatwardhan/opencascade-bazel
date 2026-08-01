# SYSTEM.md — Product North Star

**Repository:** [`NarendraPatwardhan/opencascade-bazel`](https://github.com/NarendraPatwardhan/opencascade-bazel)  
**Document type:** System intent, architecture thesis, and non-negotiable constraints  
**Audience:** Humans and AI agents working on this project  
**Status:** Living document — update when intent changes; do not silently drift  
**Last restated:** 2026-07-31  
**Related:** [`AGENTS.md`](AGENTS.md) (how to code here) · [`DISPLAY.md`](DISPLAY.md) (viewport / camera / grid) · [`REACTIVITY.md`](REACTIVITY.md) (params / gimbals) · [`docs/README.md`](docs/README.md) (doc index) · [`docs/cleanroom-featurescript-std-report.md`](docs/cleanroom-featurescript-std-report.md) (CAD façade learning) · [`api/include/occ_c.h`](api/include/occ_c.h) (C ABI taught in-code)

---

## 0. One-sentence mission

> Build a **free, browser-capable, open-kernel CAD stack** whose geometry truth is **OCCT via a stable C ABI (`occ_c`)**, whose agent/author surface is **plain Luau + conventions + libraries** (never a proprietary dialect brand), and whose **portable intermediate representation (IR)** is the “LLVM of CAD” — so agents can plan industrial models (especially **AI-BOOST SIAD piping skids**) and assemblies (especially a **6-DOF robot arm**) with human oversight, reproducible builds, and industrial export.

---

## 1. Retelling the owner’s intent (canonical restatement)

This section is the authoritative paraphrase of what the product owner has asked for across research, clean-room analysis, and repo design. If an agent’s local plan conflicts with this section, **this section wins**.

### 1.1 What we are building

We are **not** building “another CAD app UI clone” or “Python CAD in the browser.” We are building a **layered system**:

```text
  Human / agent intent  (NL, drawings, parameters, Luau)
            │
            ▼
  Luau + conventions + well-defined libraries   ← author surface
            │  emits / lowers
            ▼
  Portable CAD IR  (serializable op graph)     ← novelty spine / “LLVM-like”
            │  evaluates
            ▼
  Host ops → occ_c → OCCT 7.9.3                ← geometry truth
            │
            ▼
  Mesh / STEP / BREP / collision pack / review UI
```

### 1.2 Why this exists (problems we refuse to accept)

CAD automation usually fails in one of these ways:

1. **Hallucinated geometry** — the model invents shapes the kernel cannot represent or verify.  
2. **Wrong runtime** — desktop Python/C++ stacks that do not fit secure or **browser** deployment.  
3. **No trust boundary** — untrusted agent code shares ambient authority with the host (FS, network, credentials).  
4. **Proprietary lock-in** — kernels (Parasolid, ShapeManager) and languages (FeatureScript runtime) that cannot be open, free, or self-hosted.  
5. **No portable intermediate form** — scripts are tied to one vendor’s history/document model; there is no clean “compile target” for agents.

We want the opposite: **parametric intent in a real language**, **BRep truth in open OCCT**, a **clear trust boundary**, and an **IR** that agents and humans can inspect, version, and re-evaluate.

### 1.3 Dual product goals (both are first-class)

Every capability matrix, prioritization, and “is this P0?” decision should be scored against **both**:

| # | Goal | What “done enough” looks like |
|---|------|-------------------------------|
| **1** | **AI-BOOST Challenge 2** — agentic CAD for industrial **piping / compressor skids** (SIAD Macchine Impianti) | From engineering intent (NL and/or 2D), produce parametric 3D of process lines + structure + equipment envelopes; clash/clearance; mesh/sim prep hooks; **human oversight** before export; competition KPIs (time, rework, explainability). Deadline context: **Challenge 2 closes ~25 Aug 2026**; prize tiers SPARK / ADVANCE. |
| **2** | **6-DOF robot arm assembly** (auxiliary but serious) | Simplified serial **R–R–R–R–R–R** arm: link solids, flanges, bolt patterns, **named joint frames**, revolute joints with limits, **FK pose** from joint angles, self-clash optional, **STEP + collision meshes + URDF-style package**. |

These goals share a **small solid kernel** and diverge in **differentiating layers**:

| Shared P0 kernel | AI-BOOST-only P0 | Robot-only P0 |
|------------------|------------------|---------------|
| Primitives, extrude/revolve/sweep, booleans | `RoutePath` (centerline + bend R) | Assembly occurrences + mates |
| Named frames (`AttachFrame`) | Piping fittings catalog | Joint variables + limits |
| Patterns, simple holes | Clash vs housing KPI | `ComposeChain` FK |
| Import/export STEP/mesh | MeshPrep seeds for FEA | Per-link mesh + robot package |
| Measures (bbox, volume, COM) | NL/2D → structured IR | TCP frame query |
| Stable ids / selectors | Structural skid frame members | — |

### 1.4 Explicit brand / naming rules (owner-enforced)

| Allowed | Forbidden |
|---------|-----------|
| “Luau + conventions + libraries” | Calling the product **FeatureLuau**, “our FeatureScript”, or implying FS language compatibility |
| “Portable IR” / “CAD IR” / “op graph” | Claiming FeatureScript source compatibility or Parasolid parity |
| “Inspired by FeatureScript **std architecture**” (MIT study) | Shipping Onshape std sources as ours, or bit-porting recipes while looking at `std` |
| Original IR op names (`PushPull`, `SweepAlong`, `AttachFrame`, …) | Copying Onshape UI names as our public API surface without need |
| Clean-room implementers working from **our reports only** | Implementers open `onshape-std-mirror` while coding |

**FeatureScript std is MIT-licensed** (features + helpers). The FeatureScript **language runtime, Part Studio host, Parasolid-backed builtins, and query engine internals are not open**. We study **architecture and recipes in abstract**; we reimplement on **OCCT** under **our** IR and Luau modules.

### 1.5 What the owner wants from commercial CAD research

Deep research into **SolidWorks / Onshape / Fusion** was requested to inform an **IR design**, not to reimplement those products:

| System | Kernel (typical) | What we take | What we reject |
|--------|------------------|--------------|----------------|
| **SolidWorks** | Parasolid | Feature history mental model; industrial feature taxonomy | Closed kernel; desktop-only product shape |
| **Onshape** | Parasolid + FeatureScript | **Std library architecture** (feature vs op, queries, mate connectors, routing+sweep, frames); cloud document versioning ideas | FS runtime; proprietary host; “clone Onshape” |
| **Fusion** | ShapeManager (Autodesk) | Parametric + direct hybrid lessons; manufacturing-adjacent workflows | Closed kernel; product surface clone |

**Thesis:** Their power is not “the language”; it is **history-aware kernel ops + scriptable feature façade + assembly layer**. We keep **OCCT** as kernel, invent **our IR**, and grow **Luau libraries** as the façade.

### 1.6 Platform / engineering non-negotiables (owner-stated)

1. **Bazel + hermetic OCCT** — reproducible; BuildBuddy RBE for heavy Wasm on agent hosts.  
2. **Open OCCT** (pinned **7.9.3**) — not Parasolid, not ShapeManager.  
3. **Stable C ABI (`occ_c`)** — Apache-2.0; opaque handles; no C++ public API.  
4. **Browser-capable free web kernel** — `libocc_c` Wasm + AgentOS loom path.  
5. **Industrial formats** — STEP/BREP in/out; mesh for viz/collision; later robot package.  
6. **IR novelty** — serializable, versioned, evaluable op graph (the strategic differentiator).  
7. **Win AI-BOOST Challenge 2** as a forcing function — trust boundary + human Run + measurable KPIs.  
8. **AgentOS Luau sandbox** — guest holds **shape IDs only**; geometry via host tools `cad.call` → `occ_*`.  
9. **License split** — Apache kernel vs BSL AgentOS product path; never mix wrong way.

### 1.7 What “success” means (acceptance, not vibes)

**Near-term (repo already partially met):**

- Real Luau in real AgentOS calling real `occ_*` producing a non-empty mesh in browser; failures leave the page usable.

**Medium-term (dual-goal demos):**

1. **Pipe skid slice:** route polyline + bend R → annulus sweep (or OD−ID boolean) → clash report vs equipment box → STEP export; IR audit trail.  
2. **6-DOF arm slice:** six links + joint frames + parametric θᵢ → FK poses without remaking BREP → STEP + per-link collision mesh + joint table.

**Strategic:**

- Agents emit **IR** (or Luau that tapes IR), humans approve, kernel evaluates deterministically under version pins.  
- Competition narrative: open stack, explainable ops, rework = edit IR params / nodes — not opaque black-box mesh.

---

## 2. What this document is vs is not

| Document | Purpose |
|----------|---------|
| **`SYSTEM.md` (this file)** | **Why** we exist, **what** we build, **what we refuse**, dual goals, stack thesis, **design decisions**, prioritization law |
| **`AGENTS.md`** | **How** to code in this repo (C ABI rules, Bazel/bb, license boundary, anti-patterns) |
| **`DISPLAY.md`** | Browser **mesh viewport**: WebGL2/three, editor camera, infinite ground grid, steal lists |
| **`REACTIVITY.md`** | Reactive **params / gimbals**: tiered re-eval, CADAM + Ao steal lists |
| **`docs/README.md`** | Index of remaining docs (no pointer-only stubs) |
| **`docs/cleanroom-featurescript-std-report.md`** | Team A clean-room learning: FS std architecture, dual-goal capability matrix, IR sketches |
| **`api/include/occ_c*.h` + `api/src/`** | C kernel expansion — taught via in-code comments (not a separate literate tree) |
| **`agent-os/TASKS.md`** | Implementation checklist for the browser scripting vertical slice |
| **`README.md`** | User-facing C-API-first overview |

Agents should read **SYSTEM → AGENTS → task-specific docs** in that order.

---

## 3. System architecture (detailed)

### 3.1 Layer diagram

```text
┌──────────────────────────────────────────────────────────────────────────┐
│  PLANNING / INTAKE (untrusted content, trusted host mediation)           │
│  · NL requirements · 2D drawing / P&ID vision · human param forms        │
│  · Outputs: structured intent, params map, draft Luau or IR nodes        │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │
┌─────────────────────────────────▼────────────────────────────────────────┐
│  AUTHOR SURFACE                                                          │
│  · Luau (language only) + conventions + libraries (cad.solid, cad.route…)│
│  · Optional Monaco UX, analyze markers, catalog-driven completion        │
│  · NEVER a new language name / dialect brand                             │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │ emit / lower (optional live host calls)
┌─────────────────────────────────▼────────────────────────────────────────┐
│  PORTABLE IR  (the “LLVM of CAD”)                                        │
│  · Document: params, ops list/DAG, assembly graph, catalog, meta hashes  │
│  · Ops: original names; SI units; stable string ids; selectors           │
│  · Determinism: same IR + lib/kernel versions → same BRep within tol     │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │ evaluate
┌─────────────────────────────────▼────────────────────────────────────────┐
│  HOST BRIDGE                                                             │
│  · AgentOS tools allowlist (cad.call) · shape table · status / fuel      │
│  · OR native evaluator process for batch/golden tests                    │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │
┌─────────────────────────────────▼────────────────────────────────────────┐
│  KERNEL: occ_c (Apache-2.0) → OCCT 7.9.3                                 │
│  · C ABI, opaque occ_shape_t / occ_mesh_t                                │
│  · Primitives, booleans, features, sweeps, transforms, measure, IO, mesh │
│  · Native .so and Wasm (Emscripten + wasm-opt)                           │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │
┌─────────────────────────────────▼────────────────────────────────────────┐
│  DELIVERABLES                                                            │
│  · Review UI mesh · STEP/BREP · collision STL/glTF · robot package       │
│  · Clash reports · MeshPrep seed JSON · IR audit trail for humans        │
└──────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Trust boundary (non-negotiable)

| Layer | Trust | Rule |
|-------|-------|------|
| Agent / guest Luau | **Untrusted** | No ambient host FS/network; only allowlisted tools |
| Host CAD tools | **Trusted mediation** | Translate tool calls → `occ_*`; hold real handles |
| `occ_c` / OCCT | **Trusted kernel** | Geometry truth; never executes guest language |
| Human Run / export gate | **Oversight** | Especially AI-BOOST: person still approves critical steps |

**Guest never holds raw OCCT pointers** — only integer/string **shape IDs** into the host table.

### 3.3 Three things that must not be conflated

| Concept | Meaning | Where it lives |
|---------|---------|----------------|
| **Operation** | Atomic kernel mutation/measure | `occ_*` / IR op / host builtin |
| **Feature / recipe** | Multi-op product tool (extrude+boolean+cleanup) | Luau library function or IR macro expansion |
| **Assembly** | Occurrences, mates, joint state, FK | **Product layer we invent** — not Part Studio std, not inside thin `occ_c` forever |

Commercial FeatureScript **std** is almost entirely a **feature façade over someone else’s host ops**. Their `op*` calls are thin wrappers around proprietary builtins. Our host is **`occ_c`**.

### 3.4 Pipe ≠ frame (product law)

| | Fluid **pipe** | Structural **frame** |
|--|----------------|----------------------|
| Intent | Process/utility fluid conveyance | Skid steel, supports, platforms |
| Path | Routing centerline + bend radius | Layout edges / ortho members |
| Section | Circle OD / annulus OD−ID | Catalog beam (C, L, I, SHS…) |
| Ends | Flanges, fittings, welds | Miter/butt/cope, cutlist |
| Our modules | `cad.route` + `cad.piping` | `cad.structure` |
| IR | `RoutePath` + `SweepAlong` | `MemberSweep` |

Onshape std has **no dedicated Pipe feature**; industrial pipe is **routing + sweep**. **Frame** is structural. Agents and docs must never conflate them.

### 3.5 Mate connector ≠ mate solver

| Part Studio–style **frame** | True **assembly** |
|-----------------------------|-------------------|
| Named SE(3) frame on a body (`AttachFrame` / mate connector analogue) | Instance tree, constraint graph, DOF, joint limits, FK |
| Available as modeling primitive | **Greenfield** in our `cad.asm` + IR `assembly` section |
| FS `MateDOFType` is labels only | We implement real revolute/fasten semantics for robot + skid |

---

## 4. Portable IR (design law)

### 4.1 Why IR exists

- Agents need a **stable compile target** better than free-form prose.  
- Humans need **diffable, reviewable** design history.  
- Bazel/golden tests need **determinism** (script hash + kernel hash + IR hash).  
- Multiple front-ends (Luau, NL planner, importers) share one evaluator.

### 4.2 Document envelope (v0 conceptual)

```text
ModelDocument
  ir_schema: "cad.ir/v0"
  version: semver
  units: SI store (meter, radian, …)
  params: map<string, Quantity|number|bool|string|array>
  catalog?: fitting/part registry
  frames?: named frame registry
  assembly?: { occurrences, joints, tcp }
  ops: ordered list | DAG with explicit deps
  meta: { author, lib_versions, kernel_version, goals[], hashes }
```

### 4.3 Op node shape

```text
Op {
  id: string                 # hierarchical OK: "link2/bore"
  op: EnumOpName             # OUR names
  params: map                # SI quantities
  refs: map of selectors     # created_by, body, filter, frame…
  deps?: string[]
  meta?: { source, feature }
}
```

### 4.4 Selectors beat raw indices

Prefer:

```text
{ created_by: "housing", entity: "face", filter: { max_area: true } }
```

over:

```text
{ face_index: 7 }
```

Index-based topology is allowed only **inside a single eval step** after a query materializes.

### 4.5 Naming examples (ours, not FeatureScript)

| Family | Example IR ops |
|--------|----------------|
| Construction | `MakePlane`, `MakePoint`, `AttachFrame` |
| Solids | `PrimBox`, `PushPull`, `SpinSolid`, `SweepAlong`, `LoftSections`, `HollowBody` |
| Boolean | `BoolCombine` |
| Blend | `RoundEdge`, `BevelEdge` |
| Pattern | `PatternLinear`, `PatternPolar`, `MirrorCopy` |
| Route/structure | `RoutePath`, `MemberSweep` |
| Holes | `DrillHole` |
| Query | `QueryGeom`, `QueryClash` |
| IO | `ImportBrep`, `ExportBrep`, `ExportMesh`, `ExportRobotPackage` |
| Assembly | `MateRevolute`, `MateConcentric`, `MateFasten`, `MateLimits`, `ComposeChain` |
| Product/AI | `SpawnPart`, `MeshPrep`, `ParseIntent` (planner-side) |

### 4.6 Evaluation rules

1. **SI at the IR boundary**; UI units convert at edges.  
2. **Transactional features** where OCCT allows; surface which op_id failed.  
3. **Version pins** in meta — behavioral changes need new IR/lib versions.  
4. Prefer **transform-only** pose updates for robot joint angles (do not bake θ into BREP).  
5. Same document + same library/kernel versions → same BRep within OCCT tolerances.

---

## 5. Luau surface (conventions, not a dialect)

### 5.1 Principle

Use **plain Luau** as the programming language. Product power lives in:

1. **Conventions** (ids, SI, no raw handles, error shape)  
2. **Versioned libraries** (`cad.solid`, `cad.route`, `cad.asm`, …)  
3. Optional **IR tape** for reproducibility  

Do **not** invent or market a new language.

### 5.2 Suggested module map

| Module | Responsibility |
|--------|----------------|
| `cad.units` | Quantity helpers; to/from SI |
| `cad.sketch` | 2D entities, constraints, solve |
| `cad.construction` | Planes, points |
| `cad.frames` | Attach/query named SE(3) frames |
| `cad.primitives` / `cad.solid` | Box/cyl/…, extrude, revolve, sweep, loft, shell |
| `cad.boolean` | Fuse/cut/intersect |
| `cad.blend` | Fillet/chamfer |
| `cad.pattern` | Linear/polar/mirror/along-path |
| `cad.holes` | Simple holes first; standards tables later as data |
| `cad.route` | Centerlines, bend R, node frames |
| `cad.structure` | Structural members, trim, cutlist meta |
| `cad.piping` | Fluid runs + fittings recipes (product) |
| `cad.catalog` | Register/spawn configured parts |
| `cad.asm` | Occurrences, mates, limits, FK |
| `cad.query` | Measures, selectors, clash |
| `cad.io` | STEP/mesh/robot package |
| `cad.sim` | MeshPrep hooks only (no FEA solver in-kernel) |

### 5.3 Guest rules

1. Geometry only via host/IR — **never** raw kernel pointers in Luau.  
2. Every mutating call takes a stable **id**.  
3. Prefer selectors/refs over integer topology across ops.  
4. Pure math helpers OK; world mutation only through approved APIs.  
5. Library version pinned in IR metadata.

### 5.4 Present seed

Today’s vertical slice: `agent-os` batteries `solid.luau` + host tools for box/cylinder/cut/finish → mesh. That is the **seed**, not the full module map.

---

## 6. Kernel: `occ_c` + OCCT

### 6.1 Contract priorities

| Priority | Artifact |
|----------|----------|
| P0 | `api/include/occ_c.h` — pure C contract |
| P0 | `api/src/occ_c.cc` — thin OCCT mapping |
| P0 | `examples/c_api` — pure-C demo |
| P0 | `//api:libocc_c_wasm` — browser kernel |
| P1 | AgentOS integration under `agent-os/` (BSL) |
| P1 | OCCT subset generation (`gen_bazel.py`) |

### 6.2 C ABI laws (summary — full detail in AGENTS.md)

- Pure C header; opaque handles; `int` status + out-params.  
- Ownership transfer for new shapes/meshes; free APIs.  
- Exceptions caught at boundary; `occ_last_error()`.  
- Topology indices **1-based**.  
- Grow **C surface**, never “just call OCCT C++ from users.”  
- Surface inspiration: **build123d-class modeling ops**, not OCCT class dump.

### 6.3 Present capability (snapshot)

Primitives (box/cyl/sphere/cone/torus/wedge), booleans, fillet/chamfer/shell/offset, extrude/revolve/loft/pipe, transforms, measure (volume/area/COM/bbox), topology counts/extract, STEP/BREP/STL/glTF/OBJ, mesh buffers.

### 6.4 Dual-goal gaps (kernel / host)

**Done in `occ_c` (2026-08-01):** history session v0 + named frames, clash/distance, patterns, simple holes, RoutePath + pipe annulus, compose_chain FK, compounds/split, mass props. See clean-room report **§6.5–§6.6**.

**Still `occ_c`-dependent and open:** primarily **Sketch2D + constraints**; richer construction; deeper selectors/attrs; optional P1 face-edit/gusset/draft.  

**Host/IR (not pure C):** assembly mate solver, catalogs/URDF, MeshPrep/NL, instance tables.

See clean-room report §6–§8 / §6.6 for the authoritative remaining list.

### 6.5 Build / RBE

- Hermetic Bazel; OCCT **7.9.3**.  
- Agent hosts: **`bb … --config=buildbuddy` only** (no local compile assumption).  
- Wasm always **opt** + Binaryen size pipeline; export list must stay in sync when API grows.

---

## 7. AI-BOOST alignment (Challenge 2)

### 7.1 What the challenge cares about (product interpretation)

| Theme | Our mapping |
|-------|-------------|
| NL engineering requirements | Planner/agent → params + IR/Luau (**outside** kernel) |
| Geometric / assembly constraints | Selectors, mates, frames, dimensions in IR |
| Parametric 3D components / piping | `RoutePath`, `SweepAlong`, catalog, structure |
| Mesh / simulation prep | `MeshPrep` seeds + external FEA — not solve-in-kernel |
| Expert validation / integration | Human Run, clash reports, STEP, IR audit trail |
| Explainability / rework hours | Failed **op_id** + params; edit IR and re-eval |

### 7.2 Trust story for judges

```text
Untrusted agent text
  → structured IR (reviewable)
    → sandboxed Luau optional
      → allowlisted cad.call
        → open OCCT BRep
          → mesh/STEP
            → human gate
```

### 7.3 Deadline discipline

Challenge timing is a **forcing function**. Prefer:

1. Demoable vertical slices over perfect feature parity.  
2. IR + clash + export over sheet metal / hole megatables / UI polish.  
3. Honest OCCT behavior over fake Parasolid compatibility claims.

---

## 8. 6-DOF robot arm goal (detailed)

### 8.1 Scope (v1)

- Serial **6 revolute** joints.  
- Simplified link geometry (box tube / cylinders), not full industrial robot CAD.  
- Flange bolt circles via polar pattern + simple holes.  
- Joint frames Z = revolute axis.  
- Params: `L1…L6`, `th1…th6`, limits, section, PCD.  
- FK pose; TCP `tool0`.  
- Export STEP + collision meshes + joint/frame table (URDF-style).

### 8.2 Anti-patterns

- Baking joint angles into extrude directions (breaks parametric pose).  
- Integer face indices across features.  
- Skipping frames / using only world coordinates.  
- Expecting FeatureScript std to provide assembly DOF solving (it does not).

### 8.3 Minimal IR story

```text
parts (BREP recipes per link)
  + AttachFrame F_Ji
  + assembly.occurrences
  + joints revolute (angle param + limits)
  + ComposeChain
  + Export*
```

---

## 9. Clean-room policy (FeatureScript std)

### 9.1 Roles

| Role | Allowed | Forbidden |
|------|---------|-----------|
| **Readers** | Open MIT mirror; write architecture specs | Shipping their sources as product |
| **Implementers** | Build from **SYSTEM + clean-room report + AGENTS** | Opening `std` sources while coding |
| **Compliance (optional)** | Similarity review | Claiming “FeatureScript compatible” |

### 9.2 What we learn vs what we port

| Learn | Do not port |
|-------|-------------|
| Context + hierarchical Id + feature transaction | FS language / `defineFeature` runtime |
| Feature = multi-op recipe | Parasolid edge-case parity |
| Query/history selectors | Full 100+ query zoo on day one |
| Mate connector as **frame** | Fake DOF enum as a solver |
| Routing + sweep for pipe; frame for steel | Sheet metal suite as P0 |
| Instantiator batching idea | Instantiator source code |
| Units + tolerant compare | Hole megatables as P0 |
| Error severity + faulty params | Error string catalogs bit-for-bit |

### 9.3 Mirror policy

- Community mirror may be cloned **outside** product trees for reading.  
- **Do not commit** Onshape std sources into `opencascade-bazel`.  
- Do not add the mirror as a Bazel dep.

---

## 10. License architecture

| Tree | License | Contents |
|------|---------|----------|
| `api/`, `examples/`, `third_party/occt/`, `bazel/`, root product docs | **Apache-2.0** | Geometry kernel consumers can depend on this alone |
| `agent-os/` | **BSL 1.1** | Loom integration, CadEngine, browser demo |
| Local `scripting/`, research trees (`OCCT/`, `OCP/`, `build123d/`) | gitignored / local | Research only — not shipped |

**Rules:**

1. Apache consumers must never need `agent-os/`.  
2. AgentOS may depend on `//api:libocc_c` / Wasm; **reverse is forbidden**.  
3. Do not put BSL code under `api/` or `examples/`.  
4. README license table must stay accurate.

---

## 11. Prioritization law (how to say no)

When someone proposes a feature, score:

1. **Blocks AI-BOOST demo?**  
2. **Blocks 6-DOF arm demo?**  
3. **Is it already in `occ_c`?**  
4. **Is it architecture (IR/selectors/frames) vs chrome (UI/manipulators)?**  
5. **Can it be a Luau recipe on existing ops?** Prefer recipe before kernel growth.  
6. **Is it sheet metal / GD&T / full hole standards / gears?** → P2 unless newly justified.

### 11.1 Recommended implementation order

```text
1. Freeze IR schema v0 + selector v0
2. Lower IR → existing occ_c; golden tests (Bazel-friendly)
3. AttachFrame + RigidXform + created_by selectors
4. RoutePath + SweepAlong demo (pipe) AND joint RotZ demo (robot)
5. QueryClash
6. Patterns + DrillHole (or documented cut recipe)
7. GroupBodies + SpawnPart catalog
8. cad.asm ComposeChain + limits
9. MeshPrep hooks + ExportRobotPackage writer
10. NL/2D → IR agents (competition path)
11. Sketch solver depth, frame members, fittings catalog richness
```

### 11.2 Explicit non-goals (system-level)

- C++ public API or C++ sample suite as product surface.  
- Python / OCP / build123d inside the Bazel product graph.  
- Freestanding Luau World as the product path (AgentOS loom is the choice).  
- Running full OCCT as a wasmi guest inside AgentOS.  
- Multiplayer CAD server (unless later explicitly scoped).  
- Claiming FeatureScript or SolidWorks file compatibility as a product promise.  
- FEA solver inside the CAD kernel.  
- Defaulting product work to games or unrelated app scaffolds.

---

## 12. Current state (honest snapshot as of last restatement)

### 12.1 Done / vertical slice green

- Hermetic Bazel OCCT **7.9.3** + `occ_c` C ABI + Wasm pipeline.  
- Pure-C example.  
- AgentOS path: Luau → host tools → `occ_*` → mesh; browser Monaco + viewer; node smoke.  
- Analyze markers path (Phase A/B largely done).  
- Architecture docs consolidated into **SYSTEM.md** + **clean-room FS report**; C API taught in `api/` comments.

### 12.2 Not done (the real spine)

- First-class **portable IR** artifact + evaluator.  
- Full Luau module map (only `solid.*` seed).  
- Assembly layer / FK.  
- RoutePath / piping catalog / structural frame recipes.  
- Clash API.  
- History selectors / frames as host primitives.  
- Competition-grade NL/2D intake.  
- Integrity manifests / one-directory release polish.

### 12.3 Novelty claim (how we talk about it)

We claim novelty in:

1. **Open OCCT + stable C ABI + browser Wasm** as the geometry backend for agents.  
2. **Sandboxed Luau** with a hard trust boundary.  
3. A **portable CAD IR** as the agent/human contract (not locked to a vendor document DB).  
4. Dual demos proving the same kernel serves **process skids** and **serial robot assemblies**.

We do **not** claim: “open-source FeatureScript” or “Parasolid replacement complete.”

---

## 13. Working agreements for agents and collaborators

1. Read **SYSTEM.md** before large designs; read **AGENTS.md** before code.  
2. Prefer **editing docs + IR design + kernel gaps** over UI chrome when tradeoffs bite.  
3. On agent build hosts: **`bb --config=buildbuddy` only**.  
4. Keep license trees pure.  
5. When studying Onshape std: **readers only**; write abstract specs; implementers stay clean-room.  
6. Name things with **our** IR/Luau vocabulary in product code.  
7. Every substantial capability should answer: **AI-BOOST? Robot? Pri? occ_c? IR op? Luau module?**  
8. Ship **demoable slices** with export + failure surfacing; do not infinite-polish sheet metal.  
9. Update this file when the owner changes intent — do not leave SYSTEM lying.

---

## 14. Glossary

| Term | Meaning here |
|------|----------------|
| **`occ_c`** | Apache C ABI over OCCT |
| **OCCT** | Open CASCADE Technology (BRep kernel), pinned 7.9.3 |
| **AgentOS / loom** | Sandboxed guest runtime used for Luau + tools broker |
| **IR** | Portable CAD intermediate representation (op graph) |
| **Feature** | Multi-op recipe (product-level) |
| **Operation** | Atomic kernel mutator/measure |
| **Selector / Query** | Declarative topology reference re-resolved on eval |
| **AttachFrame** | Our mate-connector analogue (named SE(3) on a body) |
| **ComposeChain** | FK evaluation over revolute (etc.) joints |
| **RoutePath** | Centerline path with bend radius for piping (and similar) |
| **MemberSweep** | Structural profile along path (skid steel) |
| **MeshPrep** | Seeds/tags for external FEA — not the solver |
| **AI-BOOST** | EU challenge context for agentic industrial CAD (SIAD skids) |
| **Clean-room** | Readers study MIT std; implementers build from our specs only |
| **BSL path** | `agent-os/` product scripting — separate from Apache kernel |

---

## 15. Owner intent — ultra-short card (pin this)

```text
OPEN KERNEL:     OCCT via occ_c (C + Wasm), Bazel/BuildBuddy hermetic
AUTHOR:          Luau + conventions + libraries (NOT "FeatureLuau")
SPINE:           Portable CAD IR (LLVM-like op graph)
GOALS:           (1) AI-BOOST piping/skids  (2) 6-DOF robot arm
ASSEMBLY:        We invent (std only gives frames)
PIPE ≠ FRAME:    route+sweep vs structural members
TRUST:           sandbox guest · allowlisted tools · human gate
LEARN FROM:      SW / Onshape / Fusion architecture — reimplement on OCCT
DO NOT:          port FS runtime · commit std sources · claim FS compatibility
WIN CONDITION:   reviewable IR → real BRep → export + clash + demos
```

---


---

## 15b. Design decisions (absorbed from former `process-decisions.md`)

Short record of structural choices. Prefer this over digging through chat history.

### D1 — C ABI is the public product

**Decision:** Ship `occ_c` (opaque handles, status codes, no C++ in the header).  
**Why:** Polyglot FFI, browser Wasm, and host tools need a stable boundary. Full OCCT class graphs do not.  
**Consequence:** New capability → extend `occ_c` and exercise it in pure C first.

### D2 — AgentOS for scripting

**Decision:** Use AgentOS **loom** release artifacts and host tools for Luau CAD scripting.  
**Why:** Filesystem, tools broker, analyze, and fuel already exist; a freestanding Luau World would rebuild them.  
**Note:** Freestanding designs may exist as notes; they are not the product path.

### D3 — OCCT stays on the Emscripten host

**Decision:** Do not freestanding-port or run full OCCT under wasmi as an AgentOS guest.  
**Why:** Exceptions, MEMFS, large binary; nested interpretation is not viable.  
**Consequence:** Two Wasm modules (AgentOS kernel + `libocc_c`) joined by host tools and shape IDs.

### D4 — License split

**Decision:** Apache-2.0 for kernel and examples; BSL only under `agent-os/`.  
**Why:** Kernel consumers need not take AgentOS; scripting product can still use it.

### D5 — Remote builds for heavy work on constrained hosts

**Decision:** Prefer BuildBuddy RBE (`bb --config=buildbuddy`) for OCCT/Wasm compiles when the machine is not a build rig.  
**Why:** Full toolkit links dominate small laptops; end users with stronger machines can still use bare `bazel`.

### D6 — Pin AgentOS releases

**Decision:** Consume GitHub release **v0.4.0** by digest (`http_file` / fetch script); do not rebuild AgentOS in this repo.  
**Why:** Hermetic, reviewable platform version.

### D7 — Monaco + Luau Monarch

**Decision:** Editor is Monaco; language is a Monarch Luau definition adapted from icebearc/monaco-luau (MIT).  
**Why:** No first-party Monaco Luau package; built-in language is Lua-only. Monarch is Monaco’s supported tokenizer API.

### D8 — Prove the bridge before domain depth

**Decision:** Ship Luau → boolean solid → mesh → browser UI before assemblies, drawings, or FEA.  
**Why:** Later automation is worthless if the geometry path is not real BRep under a sandbox.

### D9 — Oversight is structural

**Decision:** Guest has no ambient host access; UI owns Run; errors do not take down the page.  
**Why:** Untrusted scripts and planners must not share the host’s authority.

### Vertical slice (from former `aiboost-agentic-cad.md`)

Proof we cleared:

> Real Luau, in real AgentOS, calling real `occ_*`, producing a non-empty mesh, visible in a browser; failures leave the page usable.

Demo path: Luau box + cylinder cut → host `cad.call` → `occ_*` → `occ_mesh_compute` → Monaco + mesh panel. Screenshot: [`docs/browser-demo.png`](docs/browser-demo.png).

Rejected alternatives (same file, condensed): expose OCCT C++ to the browser; run full OCCT as wasmi guest; freestanding Luau World as product path; Python/OCP/build123d in the Bazel graph.


## 16. Change log

| Date | Change |
|------|--------|
| 2026-07-31 | Initial SYSTEM.md: restated owner intent, dual goals, IR/Luau/kernel laws, clean-room + AI-BOOST + robot scope, prioritization order |
| 2026-07-31 | Doc consolidation: absorbed `process-decisions.md` + `aiboost-agentic-cad.md`; C API expansion lives in `api/` with in-code teaching comments |
| 2026-07-31 | Added **DISPLAY.md** (viewport / camera / Option B infinite grid) |
| 2026-07-31 | Added **REACTIVITY.md** (Ao-style params, CADAM gimbals/sheet patterns) |
| 2026-07-31 | Split CADAM steals: params → REACTIVITY, view chrome → DISPLAY |

---

*If this file and day-to-day chat disagree, update this file or explicitly amend intent — do not leave two truths.*
