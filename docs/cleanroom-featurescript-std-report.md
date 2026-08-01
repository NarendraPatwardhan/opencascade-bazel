# Clean-Room Learning Report: Onshape FeatureScript Standard Library

**Document type:** Architecture & capability specification (Team A / readers)  
**Audience:** Implementers of our Luau libraries, portable IR, and `occ_c` / OCCT stack  
**Date:** 2026-07-31 · **occ_c status refresh:** 2026-08-01  
**Source analyzed:** [javawizard/onshape-std-library-mirror](https://github.com/javawizard/onshape-std-library-mirror) (MIT, PTC FeatureScript `std`, **265** `.fs` files including **~101** `*.gen.fs`, std version **2960.0**)  
**Method:** Multi-agent clean-room read — foundational modules, full feature inventory, dual-goal prioritization, assembly/IR annex  
**Product goals used in every matrix column:**

1. **AI-BOOST** — Challenge 2: agentic CAD for industrial **piping / compressor skids** (SIAD), including constraint extraction, parametric 3D, mesh/sim prep, human oversight  
2. **6-DOF robot arm** — model a simplified serial robot **assembly** (links, revolute joints, flanges, frames, FK pose, STEP/mesh/URDF-style export)

**This document is not implementation code.** It is the expected clean-room deliverable: what to learn, what to build under **our** names, and what to ignore.

**Implementation note (2026-08-01):** The Apache `occ_c` host has grown substantially beyond the original §4.3 snapshot (~213 `OCC_API` symbols across `api/include/occ_c*.h`). Matrix column **`occ_c`** and §6.5–§6.6 reflect **current code**, not the 2026-07-31 gap list. Dual-goal smoke demos: `//examples:smoke_pipe_skid`, `//examples:smoke_robot_6dof`, `//examples:smoke_flange_bolt_circle`, `//examples:c_api_session_smoke`.

---

## Table of contents

0. How to read this report (pedagogy)  
1. Legal & provenance  
2. Library map  
3. Architecture lessons (the real gold)  
4. Complete op / measure surface  
5. Feature inventory (user-facing)  
6. Capability matrix (AI-BOOST × Robot × Priority × occ_c × IR × Luau)  
7. Recipe patterns (abstract)  
8. End-to-end IR sketches (robot + skid)  
9. Luau library layout (conventions only)  
10. IR design requirements  
11. What not to learn / not to port  
12. Gaps outside any CAD std  
13. Mapping to this repository  
14. Clean-room process checklist  
15. Pedagogical walkthroughs (agent authoring)  
16. Pedagogical summary  
Appendix A–E — inventories, anchors, AI-BOOST PDF mapping, host op table, feature table  

---

## 0. How to read this report (pedagogy)

### 0.1 What “clean-room” means here

| Role | Allowed | Forbidden |
|------|---------|-----------|
| **Readers** (this report) | Open MIT `std`; extract architecture, taxonomies, recipes *in abstract* | Shipping Onshape source as ours |
| **Implementers** | Build from **this** document + OCCT + our conventions | Looking at `std` source while writing Luau/`occ_c` |

The FeatureScript **standard library is MIT-licensed**. Legally you *could* copy it. Strategically we **do not**: we need an open **OCCT** evaluator, a portable **IR**, browser/AgentOS deployment, and original product surface—not an Onshape clone.

### 0.2 Three layers (never conflate them)

```text
┌──────────────────────────────────────────────────────────────┐
│  Luau + conventions + well-defined libraries                   │
│  (author/agent surface — NOT a new language name)            │
└────────────────────────────┬─────────────────────────────────┘
                             │ emits / lowers
┌────────────────────────────▼─────────────────────────────────┐
│  Portable IR  (serializable op graph — our “LLVM” layer)     │
└────────────────────────────┬─────────────────────────────────┘
                             │ evaluates
┌────────────────────────────▼─────────────────────────────────┐
│  Host ops  →  occ_c / OCCT  (and later STEP / proprietary)   │
└──────────────────────────────────────────────────────────────┘
```

FeatureScript’s `std` is almost entirely the **middle and top of this stack on someone else’s kernel**. Their `op*` / `ev*` calls are **thin wrappers** around proprietary host builtins (Parasolid-backed). Our equivalent host is **`occ_c`**.

### 0.3 Dual product goals (why every matrix has two columns)

| Goal | What “done” looks like | What std helps with | What std does **not** give |
|------|------------------------|---------------------|----------------------------|
| **AI-BOOST skid** | Route process lines, place equipment, structure skid steel, clash check, mesh prep, STEP export, human gate | Solids, sweep, routing curve, frames (structure), patterns, holes, import, measures | NL/2D intake, fittings catalog, FEA solve, assembly mate solver |
| **6-DOF arm** | Parametric links + flanges, joint frames, revolute pose, limits, self-clash, STEP + collision meshes | Solids, revolve, patterns, holes, mate **connectors** (frames), transforms, mass props | True assembly mates, FK product, URDF packaging, joint limits API |

### 0.4 One sentence thesis

> **Their std is a scriptable feature façade over a history-aware kernel; we learn the façade’s architecture and feature taxonomy, then reimplement recipes on OCCT under our IR and Luau libraries — with an assembly layer we invent for the 6-DOF arm and skid placement.**

---

## 1. Legal & provenance

| Item | Value |
|------|--------|
| License | **MIT** (PTC Inc., 2013–Present) — see mirror `LICENSE.txt` |
| Upstream | Onshape public document `std` |
| Mirror used | Community auto-updating GitHub mirror (analysis convenience), commit around version **2960.0** |
| What is open | **Feature implementations and helpers in FeatureScript** |
| What is **not** open | FeatureScript **language runtime**, Part Studio host, Parasolid geometry engine, query engine internals, Assembly mate solver |

**Implication:** Studying parameter *shapes* and multi-op *recipes* is correct. Porting `@opExtrude` behavior bit-for-bit is impossible without their host—and unnecessary if we target OCCT honestly.

---

## 2. Library map (what you open first)

### 2.1 Scale

| Kind | Approx. count | Role |
|------|---------------|------|
| Hand-written `.fs` | ~164 | Features, math, query builders, recipes |
| Generated `*.gen.fs` | ~101 | Enums, error catalogs, version pins, huge tables (e.g. holes) |
| Total | **265** | Entire Part Studio modeling std |

**Largest modules (order-of-magnitude signal):**

| Module | ~Size | Note |
|--------|-------|------|
| `holetables.gen.fs` | 2.1 MB | Generated standards data — **do not port as code** |
| `hole.fs` | 218 KB / ~5k LOC | Extreme feature complexity |
| `sheetMetalFlange.fs` | 182 KB | SM suite — P2 for us |
| `geomOperations.fs` | 103 KB | **64** host `op*` façades |
| `frame.fs` | 96 KB | Structural members |
| `query.fs` | 82 KB | Selection language |
| `boolean.fs` | 84 KB | Merge semantics |
| `routingCurve.fs` | 75 KB | Path routing (pipes) |
| `evaluate.fs` | 61 KB | **49** `ev*` measures |
| `extrude.fs` | 58 KB | Multi-op feature archetype |
| `feature.fs` | 49 KB | Lifecycle |

### 2.2 Layering (dependency picture)

```text
Host builtins  (@op*, @ev*, @startFeature, query engine, BREP history)
        ▲
context.fs + Id hierarchy + version pin
        ▲
query.fs (selectors)     units / math / vector / transform / coordSystem
        ▲
evaluate.fs (read)       geomOperations.fs (write — thin op wrappers)
        ▲
feature.fs (defineFeature lifecycle, errors, subfeatures)
        ▲
Feature modules (extrude, fillet, frame, …) + aggregators (common.fs, geometry.fs)
```

### 2.3 Foundational modules (must understand)

| Module | Role in plain language |
|--------|------------------------|
| **`context.fs`** | Opaque **world**: bodies, topology, variables, feature status, library version |
| **`feature.fs`** | **`defineFeature`**: transaction start/commit/abort, defaults, subfeature status |
| **`geomOperations.fs`** | **Logic-free** wrappers: each `opX` calls host `@opX` (**64** ops) |
| **`query.fs`** | Lazy, serializable **selection programs** (not live ID lists) |
| **`evaluate.fs`** | Read-only measures (`ev*`, **49** functions) |
| **`error.fs`** | Regen errors, WARNING/INFO/ERROR, faulty parameters, highlight entities |
| **`units.fs` + `math.fs` + `vector.fs` + `transform.fs` + `coordSystem.fs`** | Quantities with dimensions; frames; tolerant compares |
| **`attributes.fs`** | Metadata on topology that survives some ops |
| **`primitives.fs`** | Teaching examples: cube/cylinder = sketch + extrude recipes |
| **`common.fs` / `geometry.fs`** | Import aggregators (light vs kitchen-sink) |
| **`defaultFeatures.fs` / `partStudio.fs`** | Bootstrap origin + Front/Top/Right planes |

### 2.4 Generated vs hand-written

- **`.gen.fs`:** “DO NOT EDIT” — enums (`BoundingType`, boolean ops, SM styles), `ErrorStringEnum`, version chronology, hole tables.  
- **Hand-written features:** orchestration only: validate params → call ops → boolean merge → status.

**For us:** generate IR enums/tables from *our* schema; never hand-maintain thousand-line error catalogs.

---

## 3. Architecture lessons (the real gold)

### 3.1 Context = the document world

A **Context** holds:

- Bodies: solid, sheet, wire, point, composite, mate-connector  
- Topology: vertex / edge / face  
- Variables, attributes, feature error state  
- **Version pin** so old documents can “hold back” behavior  

**Our requirement:** one opaque world object per model (or Part Studio analogue), passed into every mutate/measure call. In browser/AgentOS this is the host side of `cad.call` + shape table; in IR eval it is the evaluator state.

### 3.2 Id = hierarchical operation identity

Ids are paths of string components (`parent + "extrude1" + "boolean"`).

**Rules that matter:**

1. Every op needs a **unique** id under its parent.  
2. History under a prefix should stay **contiguous** (loop index placement matters: prefer `parent + index + "opName"`).  
3. Ids feed **history-based selection** (“created by this op”).  
4. Subfeatures nest under the parent id.  
5. **Unstable** path components (loop indices) need **entity disambiguation** so parametric references survive.

**Our IR:** every node has a stable string `id`. Sub-ops use `parent/child` paths. Do not reuse leaf ids after abort.

### 3.3 Feature vs operation

| Concept | Meaning | Their pattern |
|---------|---------|----------------|
| **Operation (`op*`)** | Atomic kernel mutation | `opExtrude`, `opBoolean`, … |
| **Feature** | Product tool: UI params + multi-op recipe | `extrude` = extrude ± draft ± boolean |
| **Evaluation (`ev*`)** | Measure without changing design intent | `evBox3d`, `evDistance`, … |

**Pedagogical example:** User-facing **Extrude** is *not* one kernel call. Internally it tends to:

1. `opExtrude` (create body)  
2. optional `opBoolean` (add/remove/intersect into targets)  
3. optional `opDraft`  
4. cleanup (`opDeleteBodies` for helper sketches)

**Our Luau libraries** should expose high-level functions; **IR** should record either expanded ops or high-level ops with a defined expansion.

### 3.4 `defineFeature` lifecycle (behavioral spec)

Abstract regeneration wrapper:

1. Merge call-time defaults into definition map.  
2. **Start feature transaction** (token); record parameters/queries for UI.  
3. Run body `(context, id, definition)`.  
4. If ERROR → **abort** (rollback) for top-level.  
5. Else **commit**.  
6. On throw → record status, abort if started, rethrow if nested.  
7. Subfeatures: copy child status onto parent; remap faulty parameter names.

**Status ladder:** OK / INFO / WARNING / ERROR (only ERROR aborts top-level commit).

**Our analogue:** IR eval steps are transactional where OCCT allows; Luau host tools report status without killing the page.

### 3.5 Definition maps + preconditions

Features take a **string-keyed map**: lengths, booleans, enums, queries, arrays of nested maps.

**Preconditions** declare UI/schema (types, bounds, selection filters)—separate from runtime geometry.

**Our analogue:**

- IR: typed JSON/Protobuf params  
- Luau: documented tables  
- Optional later: schema for agent tool-calling  

### 3.6 Queries: the hard lesson (persistent naming)

A **Query** is a **program** that finds topology when evaluated—not a permanent face integer.

Two families:

1. **Historical** — “created by op id X”, caps of extrude, sketch regions  
2. **State-based** — “edges adjacent to cylindrical faces”, “largest face”, set algebra  

**Taxonomy of query kinds (conceptual):**

| Family | Examples |
|--------|----------|
| Nullary / global | everything, all solids, nothing |
| Historical | createdBy, extrude caps, named entity, sketch region |
| Set algebra | union, intersection, subtraction |
| Topology | entity/body type, ownedBy, adjacent, edge topology |
| Geometry class | plane, cylinder, line, mesh… |
| Attributes | has name / value / map match |
| Spatial | contains point, closest, largest measure, parallel… |
| Tracking | entities derived after watermark Id |

**Our IR refs must prefer:**

```text
{ "ref": "created_by", "op": "housing", "entity": "face", "filter": "max_area" }
```

over:

```text
{ "face_index": 7 }
```

Index-based topology is acceptable only inside a single eval step after a query.

### 3.7 Units and tolerance

- Quantities carry **dimensions** (length, angle, …) as `ValueWithUnits`.  
- Storage mentally SI; UI units are conversions.  
- Geometry uses **tolerant** equality—never raw float compare for lengths/angles.  
- Frames: `CoordSystem = { origin, xAxis, zAxis }` with Y recovered as `z × x`.  
- Transforms: `{ linear 3×3, translation }` — linear first, then translation.

**Our IR:** always store SI + unit metadata; Luau libraries accept mm/inch at edges if desired.

### 3.8 Errors as product UX

Severity ladder: INFO / WARNING / ERROR.  
ERROR can attach **faulty parameter names** and **entities to highlight**.  
Failed top-level features roll back; warnings do not.

**Our product:** agent runs must surface which IR node failed and why—competition “explainability / rework hours” KPI.

### 3.9 Pattern / transform remainder

Feature patterns push transforms; well-written features apply only the **remainder** transform not already implied by geometric dependencies.

**Our IR:** pattern ops explicitly list seed + transform list; avoid silent double-transform.

### 3.10 Mate connectors ≠ assemblies (critical for robot goal)

| Layer | What std provides | What we still invent |
|-------|-------------------|----------------------|
| **Part Studio** | Named SE(3) frames on bodies (`opMateConnector`), pure `Transform`/`CoordSystem` math, composite grouping, instantiator (batch place configured parts), connector-to-connector placement `T = B * inv(A)` | — |
| **Assembly product** | Only `MateDOFType` **labels** (Tx, Ty, Tz, Rz, Ryp, Rzp) | Occurrences, mate graph, joint limits, FK, URDF |

```text
┌─────────────────────────────────────────────────────────────┐
│  ASSEMBLY LAYER (we must invent)                            │
│  occurrences · mate graph · joint state · FK · limits       │
└───────────────────────────┬─────────────────────────────────┘
                            │ places via RigidXform / Mate*
┌───────────────────────────▼─────────────────────────────────┐
│  PART / BODY LAYER (std-like + our IR)                      │
│  solids · frames(AttachFrame) · composites · catalog spawn  │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│  KERNEL (occ_c / OCCT)                                      │
│  BREP ops · measures · clash · STEP/mesh                    │
└─────────────────────────────────────────────────────────────┘
```

**Mate connector ≅ our `AttachFrame`.**  
**Mate solver ≅ our `asm` module — greenfield.**  
**Instantiator ≅ our `catalog.spawn` + `pattern` batching.**

### 3.11 Pipe ≠ frame (critical for AI-BOOST)

| | **Fluid pipe** | **Structural frame** |
|--|----------------|----------------------|
| Intent | Process/utility fluid | Welded/bolted steel |
| Path | Routing curve / 3D path | Layout edges |
| Profile | Circular OD/ID annulus | Catalog I/C/L/SHS sketch |
| Ends | Flanges, fittings | Miter/butt/cope + cutlist |
| FS feature | **No dedicated Pipe** — compose route + sweep | First-class **Frame** |

**Rule of thumb for SIAD skids:** skid steel → Frame (+ Gusset); process piping → Routing curve + Sweep (+ fittings catalog we own).

---

## 4. Complete op / measure surface (observed kernel façade)

These are **host operations** the std *calls*. They define the real power of the platform. Implement **subsets** on OCCT; do not chase parity with sheet metal.

### 4.1 All 64 host mutators (`@op*` via `geomOperations.fs`)

| Host op | Conceptual role | Dual-goal note |
|---------|-----------------|----------------|
| `opExtrude` | Sweep faces/profiles along direction | **P0 both** |
| `opRevolve` | Revolve profiles about axis | **P0 both** |
| `opSweep` | Sweep profile along path | **P0** pipe + tubular links |
| `opLoft` | Loft sections | P1–P2 |
| `opBoolean` | Union/sub/int | **P0 both** |
| `opBooleanedPattern` | Pattern with boolean | P1 |
| `opFillet` / `opFullRoundFillet` / `opModifyFillet` | Edge blends | P1 |
| `opChamfer` | Edge bevel | P1 |
| `opShell` | Hollow solid | P1 |
| `opThicken` | Sheet → solid | P2 |
| `opDraft` / `opBodyDraft` | Mold draft | P2 |
| `opHole` | Hole geometry from axis+profile | **P0 simple** |
| `opPattern` | Copy by transforms | **P0 both** |
| `opTransform` | Rigid/affine move | **P0 both** |
| `opMateConnector` | Named frame body | **P0 both** |
| `opPlane` / `opPoint` | Construction | **P0** |
| `opSphere` | Primitive sphere | P0 |
| `opHelix` | Helical wire | P2 |
| `opFitSpline` / `opCreateBSplineCurve` / `opSplineThroughEdges` | Curves | P1 |
| `opPolyline` | Polyline wire (+ bend radii in routing) | **P0** routes |
| `opDeleteBodies` / `opDeleteFace` | Cleanup | P1 |
| `opSplitPart` / `opSplitFace` / `opSplitEdges` | Split | P1 |
| `opImportForeign` | Import CAD blob | **P0 both** |
| `opCreateCompositePart` / `opModifyCompositePart` | Group bodies | P1 |
| `opMergeContexts` | Import another context | catalog/derive |
| `opNameEntity` | Persistent names | P1 |
| `opMoveFace` / `opOffsetFace` / `opReplaceFace` | Face edit | P2 |
| `opExtractSurface` / `opExtractWires` | Extract | P2 |
| `opFillSurface` / `opBoundarySurface` / `opConstrainedSurface` / `opRuledSurface` | Surfaces | P2 |
| `opFaceBlend` / `opWrap` / `opCreateIsocline` | Advanced | P2+ |
| `opEnclose` | Solid from sheets | P2 |
| `opExtendSheetBody` / `opMoveCurveBoundary` / `opEditCurve` / `opOffsetWire` | Curve/sheet edit | P2 |
| `opIntersectFaces` / `opDropCurve` / `opCreateCurvesOnFace` | Curve from surfaces | P2 |
| `opEdgeChange` / `opFlipOrientation` | Topology tweak | P2 |
| `opTessellatedLoft` | Discrete loft | P2 |
| `opSMFlatOperation` | Sheet-metal flat | **skip P0** |

### 4.2 All 49 evaluators (`ev*` via `evaluate.fs`)

**P0 for us:** `evBox3d`, `evVolume`, `evArea`, `evApproximateCentroid` / mass props, `evDistance`, `evCollision`, `evVertexPoint`, `evLength`, `evPlane`, `evAxis`, `evMateConnector` / `evMateConnectorCoordSystem`, `evLine`, `evEdgeTangentLine`.

**P1+:** curvature family, raycast, surface/curve definitions, B-spline approx, tolerances, mesh points, SM tool bodies.

### 4.3 What `occ_c` already covers (snapshot, 2026-08-01)

Public surface: **`occ_c.h` + modules** (`occ_c_frames`, `occ_c_session`, `occ_c_route`, `occ_c_pattern`, `occ_c_hole`, `occ_c_query`, `occ_c_construct`, `occ_c_boolean`, `occ_c_sweep`, `occ_c_trsf`, …) — include via `occ_c_all.h` when needed. ~**213** exported `OCC_API` symbols.

| Area | Present today |
|------|----------------|
| Primitives | box, cylinder, sphere, cone, torus, wedge |
| Booleans | fuse, cut, intersect, section; fuse/cut many; compound pack/explode; plane/shape split |
| Features | fillet (all/edges), chamfer, shell, offset_3d / face / wire-2d, thicken shell, sew |
| Sweeps | extrude (blind/sym/through), revolve, loft (+ruled/solid), pipe (+annulus/shell/solid), profile-along-wire, member sweep circle/rect |
| Curves / profiles | polyline, polygon, arcs, circle/rect wires, planar face from wire, B-spline through points, helix, spring solid |
| Routing | `make_route_polyline`, `make_route_with_bends`, `route_node_frames` |
| Holes | through / blind / counterbore / countersink; hole-on-face-center |
| Patterns | linear, polar, along-path, from-transforms; boolean fuse-pattern helper |
| Frames / place | `occ_frame_t` POD, world/axes/z/euler, invert/multiply/displacement, edge/wire/face frames; place shape at frame; 4×3 / 4×4 trsf |
| Session / history v0 | op stack, register shape, `created_by` / name find, kind filter, set ops on ids, attach named frames, world planes |
| Transforms | translate, rotate, scale, mirror (+copy), compose chain / DH FK |
| Query / clash | bbox, volume, area, COM, mass_properties; distance, clash (+clearance, all-pairs); ray cast; planar/area/parallel face select; edge length filters |
| IO | STEP, BREP, STL, glTF, OBJ |
| Mesh | compute + vertex/normal/index buffers (host zig/BRepMesh alignment can skip STL path on some toolchains) |

**Still open for dual goals (see §6.6):** sketch + constraint solve; richer construction entities; topology attributes; face-edit/draft/rib; full hole standards **data**; mate **solver** / URDF writer / fittings catalog / FEA MeshPrep / NL (mostly **not** pure `occ_c`, or optional thin C).

---

## 5. Feature inventory (user-facing std)

~**88** UI features with “Feature Type Name” (including examples/SM). Grouped for pedagogy.

### 5.1 Solids (create / modify)

Extrude, Revolve, Sweep, Loft, Boolean, Thicken, Shell, Fillet, Chamfer, Modify fillet, Draft, Body draft, Rib, Hole, Wrap, Split, Delete part/face, Move face, Replace face, Enclose, Primitives (Cube/Sphere/…), Transform/Copy, Mirror, Composite part.

### 5.2 Surfaces

Fill, Boundary surface, Constrained surface, Ruled, Face blend, Offset surface, Move boundary, Mutual trim.

### 5.3 Curves

Fit spline, Bridging curve, Composite curve, Edit curve, Trim curve, Offset on face, Projected curve, Intersection curve, Isoparametric, Isocline, Helix, **Routing curve**.

### 5.4 Sketch

Sketch host module (tools largely UI-driven on top). Constraint vocabulary is rich (coincident, parallel, dim, etc.).

### 5.5 Patterns

Linear, Circular, Curve pattern; Mirror; Transform/Copy.

### 5.6 Frames (structural—not fluid pipe catalog)

**Frame**, Frame trim, Gusset, End cap, Cut list.

### 5.7 Sheet metal (~16 features)

Start/finish, flange, hem, bend, corner, rip, tab, loft, form, pattern, joint, relief… **P2** for AI-BOOST/robot unless skid panels appear.

### 5.8 Construction / frames for assembly

Plane, Point, **Mate connector** (local SE(3) frame on geometry).

### 5.9 Import / catalog

Import foreign, Derived/instantiate patterns.

### 5.10 Variables / metadata

Variables, query variables, name entity, tag, tables, properties, mass.

### 5.11 Explicit non-coverage in Part Studio std

| Need | In FS Part Studio std? | Who needs it |
|------|------------------------|--------------|
| True assembly mates (revolute, fastened, limits solver) | **No** (connectors + DOF *enum* only) | **Robot Y**, AI-BOOST Y |
| FK chain / pose driver | **No** | **Robot Y** |
| P&ID / drawing understanding | **No** | AI-BOOST |
| NL planning | **No** | AI-BOOST |
| FEA mesher/solver | **No** | AI-BOOST |
| ASME fittings catalog | **No** | AI-BOOST |
| Robotics URDF export | **No** | **Robot** |
| Dedicated fluid Pipe feature | **No** (route+sweep) | AI-BOOST |

---

## 6. Capability matrix

### 6.1 Legend

| Symbol | Meaning |
|--------|---------|
| **AI-BOOST** | Y / N / P (partial) — industrial piping skid challenge |
| **Robot** | Y / N / P — simplified **6-DOF robot arm assembly** |
| **Pri** | P0 blocking · P1 quality · P2 later |
| **occ_c** | Y present · P partial · N missing |
| **IR op** | **Our** clean-room name |
| **Luau** | Suggested library module (conventions, not a dialect name) |

### 6.2 Master matrix

`occ_c` column = **2026-08-01** host status (Y present · P partial · N missing).  
Rows marked **†** are **not** pure-kernel obligations (host/IR/product data); listed for dual-goal completeness.

| Capability | AI-BOOST | Robot | Pri | occ_c | IR op (ours) | Luau module |
|------------|----------|-------|-----|-------|--------------|-------------|
| Sketch 2D + constraints | Y | Y | P0 | **N** | `Sketch2D`, `SolveSketch` | `sketch` |
| Construction plane | Y | Y | P0 | **P** | `MakePlane` | `construction` |
| Construction point | Y | Y | P0 | **P** | `MakePoint` | `construction` |
| Named frames (mate connector analogue) | Y | Y | P0 | **Y** | `AttachFrame` | `frames` |
| Rigid transform | Y | Y | P0 | Y | `RigidXform` | `xform` |
| Connector-to-connector place | Y | Y | P0 | **Y** | `RigidXform` (`B*inv(A)`) | `frames` |
| Box / cylinder / sphere primitives | Y | Y | P0 | Y | `PrimBox`, `PrimCylinder`, `PrimSphere` | `primitives` |
| Extrude (blind / through) | Y | Y | P0 | Y | `PushPull` | `solid` |
| Revolve | Y | Y | P0 | Y | `SpinSolid` | `solid` |
| Boolean union/sub/int | Y | Y | P0 | Y | `BoolCombine` | `boolean` |
| Sweep along path | Y (pipe) | P | P0 | Y | `SweepAlong` | `solid` |
| Routing centerline (poly + bend R) | Y | N/P | P0 | **Y** | `RoutePath` | `route` |
| Structural frame member | Y (skid steel) | P | P1 | **Y** | `MemberSweep` | `structure` |
| Gusset plate | Y | N | P1 | **N** | `GussetPlate` | `structure` |
| Loft | P | P | P2 | Y | `LoftSections` | `solid` |
| Helix | P | P | P2 | **Y** | `MakeHelix` | `curves` |
| Fillet | Y (sim prep) | Y | P1 | Y | `RoundEdge` | `blend` |
| Chamfer | P | Y | P1 | Y | `BevelEdge` | `blend` |
| Shell / hollow | P | P | P1 | Y | `HollowBody` | `solid` |
| Hole (simple) | Y | Y | P0 | **Y** | `DrillHole` | `holes` |
| Hole (full standards tables) | P | P | P2 | **N**† | (data + recipe) | `holes` |
| Linear pattern | Y | Y | P0 | **Y** | `PatternLinear` | `pattern` |
| Circular pattern | Y | Y | P0 | **Y** | `PatternPolar` | `pattern` |
| Pattern along path | Y | N | P1 | **Y** | `PatternAlongPath` | `pattern` |
| Mirror | P | P | P1 | Y | `MirrorCopy` | `pattern` |
| Split body | P | P | P1 | **Y** | `SplitBody` | `topo` |
| Delete / cleanup | Y | Y | P1 | **P** | `RemoveEntity` | `topo` |
| Composite / group bodies | Y | Y | P1 | **Y** | `GroupBodies` | `group` |
| Import BREP/STEP | Y | Y | P0 | Y | `ImportBrep` | `io` |
| Export STEP/mesh | Y | Y | P0 | Y | `ExportBrep`, `ExportMesh` | `io` |
| Catalog instance place | Y | Y | P0 | **N**† | `SpawnPart` | `catalog` |
| Measure bbox/volume/COM | Y | Y | P0 | Y | `QueryGeom` | `query` |
| Clash / distance | Y | Y | P0 | **Y** | `QueryClash` | `query` |
| Mass + material | Y | Y | P1 | **P** | `AssignMaterial`, `ComputeMass` | `props` |
| Topology query language | Y | Y | P0 | **P** | `Ref` / selectors | `query` |
| Assembly mates (3D) | Y | Y | P0 | **N**† | `MateConcentric`, `MateFasten`, … | `asm` |
| Joint DOF + limits | P | Y | P0 | **N**† | `DeclareJoint`, `MateLimits` | `asm` |
| FK chain / pose | N | Y | P0 | **Y** | `ComposeChain` | `asm` |
| URDF / robot package export | N | Y | P0 | **N**† | `ExportRobotPackage` | `io` |
| Piping fittings catalog | Y | N | P0 | **N**† | `FittingElbow`, … | `piping` |
| Sheet metal suite | P | N | P2 | N | — | — |
| Gears / belts | N | P | P2 | N | — | — |
| FEA mesh/solve | Y | N | P0* | **P**† mesh viz only | `MeshPrep` | `sim` |
| NL → constraints | Y | P | P0* | N† | `ParseIntent` | `ai` |
| 2D drawing parse | Y | P | P0* | N† | `ParseDrawing` | `ai` |

\*P0 for **product/competition pipeline**, not for pure solid kernel.  
† Prefer IR/host/catalog implementation; optional thin C only if geometry-native.

### 6.3 Feature-family dual-goal scores (from multi-agent inventory)

| Feature family | AI-BOOST | Robot | Pri |
|----------------|:--------:|:-----:|:---:|
| extrude | Y | Y | P0 |
| revolve | Y | Y | P0 |
| loft | P | P | P1–P2 |
| sweep | Y | Y | P0 |
| primitives | Y | Y | P0 |
| boolean | Y | Y | P0 |
| fillet | P | P | P1 |
| chamfer | P | P | P1 |
| shell | Y | P | P1 |
| hole | Y | Y | P0/P1 |
| linear/circular pattern | Y | Y | P0 |
| mirror | Y | P | P0–P1 |
| frame | Y | P | P1 |
| gusset | Y | N | P1 |
| mateConnector | Y | Y | P0 |
| routingCurve | Y | P | P0 |
| compositeCurve | Y | P | P1 |
| helix | P | P | P2 |
| fitSpline | Y | P | P1 |
| transform/copy | Y | Y | P0 |
| import/derive | Y | Y | P0 |
| compositePart | Y | Y | P1 |
| mass/properties | Y | Y | P0/P1 |
| sketch | Y | Y | P0 |
| split | P | P | P1 |
| thicken | P | P | P2 |
| draft | N | N | P2 |
| sheet metal suite | P | N | P2 |

### 6.4 Intersection kernel (build first) — status 2026-08-01

Shared **P0 CAD kernel** for **both** goals:

```text
Sketch2D, SolveSketch          ← still MISSING in occ_c
MakePlane, MakePoint           ← PARTIAL (rect plane / world planes / vertex; no sketch graph)
AttachFrame                    ← DONE (session + freestanding frames)
PrimBox, PrimCylinder, PrimSphere  ← DONE (+ cone/torus/wedge)
PushPull, SpinSolid, SweepAlong    ← DONE
BoolCombine                    ← DONE
DrillHole (simple)             ← DONE
PatternLinear, PatternPolar    ← DONE
RigidXform                     ← DONE
ImportBrep, ExportBrep, ExportMesh ← DONE
QueryGeom + QueryClash         ← DONE
```

**AI-BOOST-only P0 extensions:** `RoutePath` **DONE**; fittings catalog **not** kernel; housing fit via clash **DONE**; mesh-prep / NL / 2D agents **outside** `occ_c`.

**Robot-only P0 extensions:** FK `ComposeChain` **DONE**; assembly mates + joint limits + URDF packaging **outside** thin BREP C (or optional later).

### 6.5 Closed P0 kernel gaps (was open 2026-07-31)

| Gap (historical) | Status | Primary symbols / modules |
|------------------|--------|---------------------------|
| Stable entity ids + history selectors | **Y** v0 | `occ_c_session.h` — `created_by`, names, kind filters, set ops |
| Named frames on bodies | **Y** | `occ_session_attach_frame` / `get_frame`; freestanding `occ_frame_*` |
| Clash / min-distance | **Y** | `occ_clash`, `occ_distance`, `occ_clash_all_pairs`, `occ_min_distance_to_set` |
| Linear + polar patterns | **Y** | `occ_pattern_linear*`, `occ_pattern_polar*` |
| Pattern along path | **Y** | `occ_pattern_along_path` |
| Simple hole | **Y** | `occ_drill_hole_*`, `occ_hole_on_face_center` |
| RoutePath + bend R + node frames | **Y** | `occ_make_route_*`, `occ_route_node_frames` |
| Annulus / pipe recipes | **Y** | `occ_pipe_annulus`, `occ_pipe_*` |
| Structural members | **Y** | `occ_member_sweep_circle/rect` |
| Connector-to-connector place | **Y** | `occ_place_shape_at_frame`, frame displacement / trsf |
| ComposeChain / DH FK | **Y** | `occ_compose_chain`, `occ_compose_chain_dh` |
| Group / compound | **Y** | `occ_make_compound`, `occ_explode_compound` |
| Split body | **Y** | `occ_split_by_plane`, `occ_split_by_shape` |
| Helix | **Y** | `occ_make_helix_wire*` |
| Mass properties (inertia) | **Y** | `occ_mass_properties` (material density still host-side) |

### 6.6 Remaining work that **depends on `occ_c`** but is **unimplemented**

Only items where a **new or substantially richer C ABI** is required (or current C is too thin to host the IR op honestly). Product/IR-only work is listed separately and is **out of scope for “finish occ_c”**.

#### A. Must-have / high leverage for dual goals (true C gaps)

| # | Missing capability | Clean-room IR | Why C (not just Luau) | Suggested `occ_*` shape |
|---|--------------------|---------------|------------------------|-------------------------|
| **A1** | **2D sketch entities + constraint solver** | `Sketch2D`, `SolveSketch` | Profiles, flanges, custom sections without hand-built wires; parametric re-solve | Sketch handle; add line/arc/circle; constraints (coincident, distance, horizontal/vertical, equal); `solve` → planar wire/face. **Authority for A1 design, residual catalog, phases, and license firewall:** [`docs/cleanroom-solvespace-sketch-solve-report.md`](cleanroom-solvespace-sketch-solve-report.md) (this FS report keeps A1 as the gap id only). |
| **A2** | **Richer construction geometry** | `MakePlane`, `MakePoint` (full) | World planes exist as thin faces; no infinite plane entity, midpoints, axes-as-topology, offset plane from face | Construction handles or POD+shape helpers: plane from face offset, point midpoint, axis from edge |
| **A3** | **Selector / history depth beyond v0** | `Ref` filters | Session has `created_by` + kind + basic geometric selects; not adjacency, “edges of face”, stable topology after fillet, attribute tags | `occ_session_*` / query: `faces_of`, `edges_of`, `adjacent`, optional topology hash rebind |
| **A4** | **Topology attributes / name survival** | `opNameEntity` analogue | Session names exist; no general key/value attrs on faces/edges that survive boolean | `occ_attr_set/get` on entity id or shape+index |

#### B. Useful CAD completeness (P1) — C if recipe is kernel-hard

| # | Missing capability | Pri | Notes |
|---|--------------------|-----|--------|
| **B1** | **Gusset plate** (`GussetPlate`) | P1 | Can be IR recipe (plane rect + extrude + cut); dedicated C only if we want a one-call solid |
| **B2** | **Draft** / body draft | P2 | No `occ_draft_*` |
| **B3** | **Rib** | P2 | No `occ_rib_*` |
| **B4** | **Face edit** — move / offset / replace / delete face | P2 | Offset face exists; not full FS face suite |
| **B5** | **Full-round / modify fillet** | P2 | Only radius fillet on edges/all |
| **B6** | **Surface fill / boundary / constrained / ruled** | P2 | Dual-goal ROI low; skip unless requested |
| **B7** | **Delete face / body cleanup ops** | P1 | Free handles + session release only; no `occ_delete_face` |
| **B8** | **Curvature / advanced evals** | P1+ | Ray cast yes; no curvature, no full surface/curve def dumps |
| **B9** | **Hole standards tables** | P2 | **Data** (JSON/CSV) + existing drill APIs; not new solid kernels |
| **B10** | **Mesh reliability** | P0 host | Symbols exist; fix BRepMesh/zig alignment so STL/mesh export is trustworthy on hermetic toolchain |

#### C. Often requested with dual goals but **not** primarily `occ_c`

Implement in IR / AgentOS / host tables. Thin C optional only if packing binary blobs.

| Capability | Why not blocking on new C |
|------------|---------------------------|
| Assembly **mate solver**, joint limits policy | Graph + solver state; use existing frames + `compose_chain` for FK |
| **URDF** / robot package writer | Text packaging of meshes + joint table |
| **SpawnPart** / fittings **catalog** | Part library + instance transforms; geometry already importable |
| **AssignMaterial** density table | Host map → `mass_properties(density)` |
| **MeshPrep** FEA seeds / NL / drawing parse | Agents + external tools; mesh buffers already exportable |
| Portable **IR** document + eval | Highest product gap; lowers to **existing** `occ_c` |

#### D. Recommended next C work order

```text
1. A1 Sketch2D + minimal SolveSketch (or unconstrained sketch → wire first)
2. A2 Construction completeness (offset plane, midpoint, axis helpers)
3. A3 Selector depth (faces_of / edges_of / adjacency) on session entities
4. B10 Mesh path reliability on zig-cc
5. A4 Attributes if IR needs surviving tags
6. B1 Gusset only if skid demos demand a first-class op
7. Defer B2–B6 (draft/rib/face suite/surfaces) unless a concrete demo requires them
```

**Explicit one-liner:** for dual-goal **kernel** completeness, the only large **unimplemented, occ_c-dependent** capability left is **sketch (+ constraints)**; everything else in §6.4 is done or intentionally non-C.

---

## 7. Recipe patterns (abstract—reimplement, don’t translate)

### 7.1 Cross-cutting solid feature skeleton

Almost every body-creating feature is:

1. **Resolve queries** (profiles, axes, paths, extents)  
2. **Call low-level `op*`** (geometry)  
3. **Boolean merge** with scope (new / add / remove / intersect)  
4. Optional **pattern remainder transform**, cleanup of temp helpers  

### 7.2 Primitive box (teaching recipe)

Observed pattern in primitives: **sketch rectangle on plane → extrude → delete sketch bodies**.

**Our IR expansion example:**

```yaml
- id: box1/sketch
  op: Sketch2D
  plane: world_xy
  entities: [rectangle corners...]
- id: box1/solid
  op: PushPull
  profile: {created_by: box1/sketch, entity: face}
  extent: {kind: blind, depth_m: 0.08}
- id: box1/cleanup
  op: RemoveEntity
  ref: {created_by: box1/sketch, entity: body}
```

Or collapse to high-level `PrimBox` with the same lowering inside the evaluator.

### 7.3 User extrude feature (parameter taxonomy)

Abstract buckets:

- Profile (faces/regions)  
- Direction / flip  
- Extent: blind | symmetric | through-all | up-to-*  
- Optional second direction  
- Optional draft  
- Boolean mode: new | add | remove | intersect  
- Body kind: solid | surface | thin  

**Expansion:** extrude op → optional boolean → optional draft → cleanup.

### 7.4 Pipe run (AI-BOOST)

FS does **not** give `pipe.fs`. Industrial pattern:

```text
1. PATH   : RoutePath / polyline with bend radius / fitSpline
2. SECTION: circle OD or annulus (sketch or param)
3. SOLID  : SweepAlong / occ_pipe
4. Optional OD sweep − ID sweep boolean for lumen
5. JOINTS : flanges, SpawnPart fittings, Mate*
6. SUPPORT: structure members + clamps along path
7. CLASH  : QueryClash vs housing
8. META   : properties (spec, DN, material)
```

**Two modes:**

| Mode | Geometry | Fittings |
|------|----------|----------|
| `continuous_sweep` (P0) | Bends baked into centerline; one solid | BOM/visualization optional |
| `segment_and_fittings` (P1) | Straight sweeps | Catalog elbows at corners |

Structural skid steel uses **MemberSweep** (frame-like), not the fluid pipe path.

### 7.5 Flange bolt circle (both goals)

```text
AttachFrame on flange face
PatternPolar (n bolts, radius = PCD/2)
DrillHole through/blind on each instance
```

### 7.6 Revolute joint interface (robot)

```text
PrimCylinder shaft on parent
BoolCombine subtract bore on child
AttachFrame joint axis (Z = revolute)
MateRevolute + MateLimits(angle)
PatternPolar + DrillHole on flanges
# Pose:
T_child = T_parent * T_axis * RotZ(θ) * T_child_geom
```

### 7.7 Connector-to-connector placement

```text
T = toWorld(dest) * inverse(toWorld(src))
RigidXform(bodies, T)
```

### 7.8 Catalog instance batch (instantiator idea)

```text
group by (part_id, config)
  Import/build once
  Pattern transforms list
delete temps
```

### 7.9 Feature composition family table

| Family | Typical composition |
|--------|---------------------|
| Solid create + merge | create → boolean into targets |
| Thin wall | surface create → thicken → boolean |
| Pattern | transforms → pattern instances |
| Pipe fluid | route → sweep → fittings → mates |
| Structure | path → profile sweep → trim/gusset |
| Rib-like | path prep → extrude/thicken → draft → boolean |
| Robot link | prims → booleans → frames → group → mate |

---

## 8. End-to-end IR sketches

### 8.0 Shared document envelope

```yaml
# ir_schema: "cad.ir/v0"
document:
  id: "doc_example"
  version: "0.1.0"
  units: { length: meter, angle: radian, store: SI }
  params: {}
  frames: {}
  bodies: {}
  assembly: null
  ops: []
  meta:
    author: agent|human
    lib_versions: { luau_cad: "…", occ_c: "…", ir: "0.1.0" }
    goals: [robot_arm|pipe_skid]
```

**Op node:**

```yaml
- id: string                 # hierarchical ok: "link2/bore"
  op: EnumOpName             # our names, not FeatureScript
  params: {}                 # SI quantities
  refs: {}                   # selectors
  deps: []
  meta: { feature: string?, source: luau|agent|import }
```

**Selector v0 examples:**

```yaml
{ created_by: "base_box", entity: body }
{ created_by: "base_box", entity: face, filter: { planar: true, max_area: true } }
{ body: "link2" }
{ frame: "J3" }
{ nth: { of: { created_by: "holes", entity: face }, i: 0 } }
```

### 8.1 Simplified 6-DOF robot arm

```yaml
document:
  id: "robot_6dof_v0"
  version: "0.1.0"
  units: { length: meter, angle: radian, store: SI }
  goals: [robot_arm]

  params:
    L1: 0.15
    L2: 0.35
    L3: 0.30
    L4: 0.08
    L5: 0.08
    L6: 0.06
    sec_w: 0.06
    sec_h: 0.06
    sec_t: 0.004
    shaft_r: 0.018
    bore_r: 0.019
    flange_r: 0.045
    flange_t: 0.012
    bolt_n: 6
    bolt_pcd: 0.070
    bolt_d: 0.005
    th1: 0.0
    th2: -0.4
    th3: 0.8
    th4: 0.0
    th5: 0.6
    th6: 0.0
    lim1: [-3.14, 3.14]
    lim2: [-1.8, 1.8]
    lim3: [-2.4, 2.4]
    lim4: [-3.14, 3.14]
    lim5: [-2.0, 2.0]
    lim6: [-3.14, 3.14]
    base_xy: 0.20
    base_z: 0.03

  assembly:
    root: base_occ
    occurrences:
      base_occ:  { part: base_part,  parent: null }
      link1_occ: { part: link1_part, parent: base_occ }
      link2_occ: { part: link2_part, parent: link1_occ }
      link3_occ: { part: link3_part, parent: link2_occ }
      link4_occ: { part: link4_part, parent: link3_occ }
      link5_occ: { part: link5_part, parent: link4_occ }
      link6_occ: { part: link6_part, parent: link5_occ }
    joints:
      - { id: J1, type: revolute, parent: base_occ,  child: link1_occ, axis_frame: F_J1, angle: {param: th1}, limits: {param: lim1} }
      - { id: J2, type: revolute, parent: link1_occ, child: link2_occ, axis_frame: F_J2, angle: {param: th2}, limits: {param: lim2} }
      - { id: J3, type: revolute, parent: link2_occ, child: link3_occ, axis_frame: F_J3, angle: {param: th3}, limits: {param: lim3} }
      - { id: J4, type: revolute, parent: link3_occ, child: link4_occ, axis_frame: F_J4, angle: {param: th4}, limits: {param: lim4} }
      - { id: J5, type: revolute, parent: link4_occ, child: link5_occ, axis_frame: F_J5, angle: {param: th5}, limits: {param: lim5} }
      - { id: J6, type: revolute, parent: link5_occ, child: link6_occ, axis_frame: F_J6, angle: {param: th6}, limits: {param: lim6} }
    tcp: { name: tool0, frame: F_TCP, occurrence: link6_occ }

  ops:
    - { id: world_xy, op: MakePlane, params: { origin: [0,0,0], normal: [0,0,1], x: [1,0,0] } }

    - id: base_box
      op: PrimBox
      params: { size: [{param: base_xy}, {param: base_xy}, {param: base_z}], corner: centered_xy_bottom }
      meta: { part: base_part }

    - id: F_base
      op: AttachFrame
      params: { name: F_base, origin_mode: face_centroid, z: face_normal }
      refs: { on: { created_by: base_box, entity: face, filter: { max_z: true } } }

    - id: base_column
      op: PrimCylinder
      params: { radius: 0.04, height: {param: L1}, axis: z }
      refs: { frame: F_base }

    - id: base_union
      op: BoolCombine
      params: { mode: union }
      refs:
        tools:
          - { created_by: base_box, entity: body }
          - { created_by: base_column, entity: body }

    - id: F_J1
      op: AttachFrame
      params: { name: F_J1, origin_mode: axis_top, z: axis }
      refs: { on: { created_by: base_column, entity: face, filter: { cylindrical: true } } }

    # LINK TEMPLATE (agent expands for i=1..6):
    #   PrimBox / HollowBody
    #   PrimCylinder flange + bore boolean
    #   AttachFrame F_Ji / F_J{i+1}
    #   PatternPolar + DrillHole
    #   GroupBodies → link_i_part

    - id: link2_tube
      op: PrimBox
      params: { size: [{param: sec_w}, {param: sec_h}, {param: L2}], corner: bottom_center }
      meta: { part: link2_part }

    - id: link2_hollow
      op: HollowBody
      params: { thickness: {param: sec_t}, faces: open_ends }
      refs: { body: { created_by: link2_tube, entity: body } }

    - id: link2_prox_flange
      op: PrimCylinder
      params: { radius: {param: flange_r}, height: {param: flange_t} }

    - id: link2_bore
      op: PrimCylinder
      params: { radius: {param: bore_r}, height: {expr: "flange_t + 0.002"} }

    - id: link2_cut_bore
      op: BoolCombine
      params: { mode: subtract }
      refs:
        target: { created_by: link2_prox_flange, entity: body }
        tools: [{ created_by: link2_bore, entity: body }]

    - id: link2_bolts
      op: PatternPolar
      params: { count: {param: bolt_n}, axis: z, radius: {expr: "bolt_pcd / 2"} }

    - id: link2_holes
      op: DrillHole
      params: { diameter: {param: bolt_d}, extent: through }
      refs:
        positions: { created_by: link2_bolts, entity: point }
        target: { created_by: link2_prox_flange, entity: body }

    - id: F_J2
      op: AttachFrame
      params: { name: F_J2 }
      refs: { on: link2_prox_flange }

    - id: F_J3
      op: AttachFrame
      params: { name: F_J3 }
      refs: { on: link2_dist_flange }

    - id: link2_group
      op: GroupBodies
      params: { closed: true, part_id: link2_part }
      refs: { bodies: { all_of_feature_prefix: "link2_" } }

    - id: fk
      op: ComposeChain
      params:
        root: base_occ
        joints: [J1, J2, J3, J4, J5, J6]
      # T_child = T_parent * T_axis_frame * RotZ(angle) * T_child_geometry_from_axis
      # ERROR if angle outside limits

    - id: F_TCP
      op: AttachFrame
      params: { name: tool0 }
      refs: { on: { occurrence: link6_occ, frame: flange_face } }

    - id: self_clash
      op: QueryClash
      params: { pairs: adjacent_links_skip_mated, clearance: 0.001 }
      refs: { bodies: { all_occurrences: true } }

    - id: export_step
      op: ExportBrep
      params: { path: "out/robot_6dof.step", format: step }
      refs: { bodies: { all_parts: true } }

    - id: export_collision_meshes
      op: ExportMesh
      params: { path: "out/robot_6dof_collision/", format: stl, lod: collision, per_occurrence: true }

    - id: export_urdf_hook
      op: ExportRobotPackage
      params: { format: urdf, mesh_dir: "meshes/", tcp: tool0 }
```

**Success criteria:** parametric angles update poses without remaking BREP; limits errors; STEP/mesh export; TCP 4×4 queryable; optional self-clash.

### 8.2 Piping skid (AI-BOOST-shaped)

```yaml
document:
  id: "skid_line_A_v0"
  version: "0.1.0"
  units: { length: meter, angle: radian, store: SI }
  goals: [pipe_skid]

  params:
    pipe_od: 0.1143
    pipe_id: 0.1023
    bend_r: 0.2286
    min_clearance: 0.025
    support_spacing: 1.5
    flange_dn: 100
    piping_mode: continuous_sweep

  catalog:
    elbow_90: { type: FittingElbow, ports: [P1, P2], angle: 1.57079632679 }
    flange_wn: { type: FittingFlange, ports: [FACE], bolt_n: 8, bolt_pcd: 0.190 }
    clamp_u:   { type: SupportUBolt, ports: [PIPE_AXIS] }

  assembly:
    root: skid_root
    occurrences:
      skid_root:   { part: skid_frame_part }
      equipment_1: { part: compressor_housing, parent: skid_root }
      pipe_A:      { part: pipe_run_A, parent: skid_root }

  ops:
    - id: housing
      op: ImportBrep
      params: { path: "in/compressor_envelope.step" }
      meta: { part: compressor_housing }

    - id: skid_origin
      op: AttachFrame
      params: { name: skid_origin, origin: [0,0,0], x: [1,0,0], z: [0,0,1] }

    # Structure (steel) — NOT fluid pipe
    - id: beam_route
      op: RoutePath
      params:
        style: ortho
        nodes:
          - { p: [0, 0, 0] }
          - { p: [3.0, 0, 0] }
          - { p: [3.0, 2.0, 0] }
          - { p: [0, 2.0, 0] }
        closed: true
        bend_r: 0.0
      meta: { role: structure }

    - id: beams
      op: MemberSweep
      params: { profile: { catalog: "C150x75" }, merge_tangent: true }
      refs: { path: { created_by: beam_route, entity: wire } }
      meta: { part: skid_frame_part }

    # Process centerline (from NL/2D agent or human)
    - id: route_A
      op: RoutePath
      params:
        style: polyline_bend
        bend_r: { param: bend_r }
        nodes:
          - { id: N0, p: [0.50, 0.40, 0.80], port: { occurrence: equipment_1, frame: nozzle_OUT } }
          - { id: N1, p: [0.50, 0.40, 1.60] }
          - { id: N2, p: [2.20, 0.40, 1.60] }
          - { id: N3, p: [2.20, 1.80, 1.60] }
          - { id: N4, p: [2.20, 1.80, 0.90], port: { occurrence: equipment_1, frame: nozzle_IN_B } }
      meta: { role: fluid_centerline, line_tag: "A" }

    - id: pipe_A_solid
      op: SweepAlong
      params:
        profile_kind: annulus
        od: { param: pipe_od }
        id: { param: pipe_id }
        orientation: follow_path
      refs: { path: { created_by: route_A, entity: wire } }
      meta: { part: pipe_run_A }

    - id: flg_start
      op: SpawnPart
      params: { catalog: flange_wn, dn: { param: flange_dn } }
      refs: { at: { path_node_frame: { route: route_A, node: N0, kind: tangent } } }

    - id: mate_flg_start
      op: MateFasten
      params: { align: face_normal_opposite }
      refs:
        a: { body: flg_start, port: FACE }
        b: { body: housing, frame: nozzle_OUT }

    - id: support_stations
      op: PatternAlongPath
      params: { spacing: { param: support_spacing }, start_offset: 0.3 }
      refs: { path: { created_by: route_A, entity: wire } }

    - id: supports
      op: SpawnPart
      params: { catalog: clamp_u }
      refs: { at_each: { created_by: support_stations, entity: frame } }

    - id: clash_pipe_equipment
      op: QueryClash
      params: { clearance: { param: min_clearance }, report: detailed }
      refs:
        tools: { created_by: pipe_A_solid, entity: body }
        targets:
          - { created_by: housing, entity: body }
          - { created_by: beams, entity: body }

    - id: meshprep
      op: MeshPrep
      params:
        domains:
          - { name: structure, bodies: beams, size: 0.02 }
          - { name: pipe, bodies: pipe_A_solid, size: 0.01 }
        seeds:
          - { from: wall_thickness, value: { expr: "(pipe_od-pipe_id)/2" } }
        export: "out/mesh_seeds.json"

    - id: export_step
      op: ExportBrep
      params: { path: "out/skid_line_A.step" }
      refs:
        bodies:
          - { created_by: pipe_A_solid, entity: body }
          - { created_by: beams, entity: body }
          - { created_by: housing, entity: body }
```

**Success criteria:** route rebuilds when nodes move; clash KPI for human gate; continuous sweep works on day-1 `occ_pipe`; structure ≠ fluid path; MeshPrep seed JSON for external FEA.

---

## 9. Proposed Luau library layout (conventions only)

Plain **Luau modules**, versioned, documented—no new language branding.  
Naming: `cad.<module>.<function>(world, id, params) → result_refs`

| Module | Responsibility | Key IR ops |
|--------|----------------|------------|
| `primitives` | box, cylinder, sphere | `PrimBox`, … |
| `solid` | extrude, revolve, sweep, loft, shell | `PushPull`, `SpinSolid`, `SweepAlong`, … |
| `boolean` | fuse/cut/intersect | `BoolCombine` |
| `blend` | fillet/chamfer | `RoundEdge`, `BevelEdge` |
| `sketch` | 2D entities + constraints + solve | `Sketch2D`, `SolveSketch` |
| `construction` | planes, points | `MakePlane`, `MakePoint` |
| `frames` | attach named SE(3) frames | `AttachFrame` |
| `xform` | transforms, math | `RigidXform` |
| `holes` | simple holes first | `DrillHole` |
| `pattern` | linear/polar/mirror/along-path | `PatternLinear`, … |
| `route` | centerlines, bend R | `RoutePath` |
| `structure` | structural members | `MemberSweep` |
| `query` | measures, selectors, clash | `QueryGeom`, `QueryClash` |
| `io` | STEP/mesh import export | `ImportBrep`, `ExportBrep`, `ExportMesh` |
| `catalog` | spawn configured parts | `SpawnPart` |
| `piping` | fittings catalog + pipe runs | recipes on route+sweep |
| `asm` | mates, joints, FK | `Mate*`, `ComposeChain` |
| `sim` | mesh prep hooks | `MeshPrep` |
| `units` | SI conversion helpers | pure |
| `props` | materials, mass | `AssignMaterial` |

**Convention rules (std discipline):**

1. Geometry only via host/IR—never raw kernel pointers in Luau.  
2. Every mutating call takes / returns stable **ids**.  
3. Prefer query/refs over integer topology in cross-op data.  
4. Pure helpers OK; world mutation only through approved APIs.  
5. Library version pinned in IR metadata for reproducibility (Bazel-friendly).  
6. Errors carry `op_id`, `param`, `severity`, optional entity highlights.

---

## 10. IR design requirements (from std learning)

### 10.1 Document shape

```text
ModelDocument
  version: ir_semver
  units: SI
  params: map<string, Quantity|number|bool|string>
  frames: ...
  ops: ordered list | DAG with explicit deps
  assemblies?: mate graph + occurrences + joints
  catalog?: fitting/part registry
  metadata: hashes (script, kernel, lib)
```

### 10.2 Op node shape

```text
Op {
  id: string
  op: enum
  params: map
  refs: map of selectors
  meta?: { source: "luau"|"agent"|"import", feature?: string }
}
```

### 10.3 Selector algebra (minimal v0)

- `created_by(op_id, entity_kind)`  
- `body(id)` / `all_solids`  
- `nth(sub, i)`  
- `filter(sub, {planar, largest_area, ...})`  
- set ops: union, subtract (as needed)  
- `frame(name)` / path node frames  

### 10.4 Determinism

Same document + same library/kernel versions → same B-rep within OCCT tolerances. Record versions in IR footer (competition reproducibility).

### 10.5 Pose vs topology (robot)

Changing joint angles should prefer **transform-only** updates of occurrences (`ComposeChain`), not re-extruding links. Topology rebuild only when link geometry params change.

---

## 11. What not to learn / not to port

| Avoid | Why |
|-------|-----|
| Sheet metal as P0 | Huge; not core to skid piping or robot arm v1 |
| Full hole standards megatables | Start simple holes + patterns; tables are **data** later |
| Face blend / wrap / isocline / decal depth | Low dual-goal ROI |
| Exact FeatureScript syntax or `defineFeature` clone | We use Luau + IR |
| UI manipulators / UIHint / editing logic | Host UX; agents use params |
| Assuming Parasolid edge cases | We use OCCT—test on OCCT |
| Claiming FeatureScript compatibility | False and strategic own-goal |
| Treating `MateDOFType` as a solver | Labels only; build real `asm` |
| Porting instantiator source | Reimplement batching under `catalog` |
| Full 100+ query types day one | Selector v0; expand by need |
| Implementing FEA solver inside CAD std | Integrate external solver; prep only |
| Gears/belts kinematics packs | Robot v1 is pure serial revolute |
| Generated error string catalogs bit-for-bit | Our error codes |

---

## 12. Gaps outside any CAD std (still required)

| Gap | Needed by | Notes |
|-----|-----------|--------|
| NL → structured intent | AI-BOOST | Agent planner; outputs IR/Luau |
| 2D drawing / P&ID vision | AI-BOOST | Nodes, dims, tags |
| Assembly mate **solver** | Both | Not in Part Studio std |
| Piping fittings standards | AI-BOOST | Catalog product data |
| FEA meshing + convergence | AI-BOOST | External; CAD supplies geometry + seeds |
| URDF / robotics package | Robot | Frames + meshes + joints |
| Human review UX | Both | Already architectural priority in repo |
| Bazel reproducibility manifests | Both / agents | Script hash, kernel hash, IR hash |

---

## 13. Mapping to this repository today (2026-08-01)

| Repo area | Role relative to this report |
|-----------|------------------------------|
| `api/` (`occ_c`) | Host mutators/measures — **P0 solid spine largely done**; remaining C gaps in **§6.6 A–B** |
| `examples/smoke_*` | Dual-goal vertical slices: pipe skid, 6-DOF robot, flange bolt circle, session |
| `agent-os/` Luau `solid.*` / OccBridge | Subset of host ops — **grow** toward full C surface |
| Portable IR | **Not yet a first-class artifact** — highest **product** novelty gap |
| `SYSTEM.md` | Trust boundary + north star — IR plugs in as “intent stage” |
| BuildBuddy + Starlark | Reproducible builds of kernel + future IR golden tests |
| `scripts/gen_occ_exports.py` | Keep Wasm `EXPORTED_FUNCTIONS` aligned with `OCC_API` |

**Recommended implementation order (updated):**

1. **Sketch** minimal C API (§6.6 A1) — last big dual-goal kernel hole.  
2. Freeze IR schema v0 + selector v0 (§10); lower IR → **existing** `occ_c`; golden tests.  
3. Selector depth + construction helpers (A2–A3) as IR reselect needs them.  
4. Grow AgentOS bridge / Luau modules to match C (no new C required for most ops).  
5. Host catalogs + mate policy + URDF writer + MeshPrep seeds (mostly non-C).  
6. Agent NL → IR (competition path).  
7. Optional P1 C: gusset, delete-face, draft only if demos require.

---

## 14. Clean-room process checklist (reuse)

**Team A — readers**

- [x] Clone MIT mirror (`onshape-std-library-mirror`, version 2960.0)  
- [x] Map modules / layers  
- [x] Inventory features (~88 Feature Type Names; 80 `defineFeature` exports)  
- [x] List op/ev surface (64 ops, 49 evals)  
- [x] Dual-goal capability matrix (**AI-BOOST** + **6-DOF robot arm**)  
- [x] Abstract recipes + IR sketches  
- [x] Assembly gap analysis (mate connectors ≠ mate solver)  
- [x] Write this report  

**Team B — implementers (next)**

- [ ] No `std` sources in working tree while coding  
- [ ] Implement from this report only  
- [ ] Original API names  
- [ ] OCCT-first tests  

**Team C — compliance (optional)**

- [ ] No large-scale source similarity  
- [ ] Public docs cite MIT study, not “FeatureScript compatible”  

---

## 15. Pedagogical walkthroughs (how an agent authors)

### 15.1 How an agent authors a 6-DOF robot arm

1. **Clarify kinematics** — serial 6R; collect `L1…L6`, joint limits, flange PCD, section sizes into `document.params` first.  
2. **Create world + base** — `MakePlane` → `PrimBox` base → `PrimCylinder` column → `BoolCombine` → `AttachFrame` `F_J1`.  
3. **Author each link** (i = 1…6): solid + flanges + bore boolean + `PatternPolar`/`DrillHole` + proximal/distal frames + `GroupBodies`.  
4. **Build assembly graph** — occurrences parent/child; `MateRevolute` on each `F_Ji` with `th_i` + limits.  
5. **Drive pose** — set angles; `ComposeChain` updates transforms (**do not** re-extrude). Query TCP 4×4.  
6. **Validate** — limits check; `QueryClash` non-adjacent links.  
7. **Export** — STEP; per-link collision meshes; `ExportRobotPackage` (URDF-style). Record IR + kernel hashes.  
8. **Rework** — if clash, adjust lengths/angles/section; human gate before freeze.

**Anti-patterns:** baking joint angles into BREP extrude directions; integer face indices across ops; skipping frames for pure world coordinates.

### 15.2 How an agent authors a pipe skid (AI-BOOST)

1. **Intake intent** — NL/2D → nodes, DN, bend radius, nozzles, clearance → `params` + catalog keys.  
2. **Place equipment** — `ImportBrep` or proxy box; `AttachFrame` on each nozzle.  
3. **Skid structure** — ortho `RoutePath` + `MemberSweep` (+ gusset P1).  
4. **Process route** — `RoutePath` snapped to nozzles; choose continuous_sweep (P0) vs segment_and_fittings (P1).  
5. **Pipe solid** — annulus `SweepAlong`.  
6. **Fittings & flanges** — `SpawnPart` + mates.  
7. **Supports** — `PatternAlongPath` + clamps.  
8. **Clash KPI** — pipe vs housing/beams; min gap vs `min_clearance`.  
9. **Sim prep + export** — optional rounds; `MeshPrep`; STEP + viz mesh; **human approval gate**.  
10. **Rework** — move nodes, raise elevation, increase bend_r; keep IR audit trail.

**Teach agents:** fluid pipe uses `route`+`piping`; steel uses `structure`; never conflate Frame cutlist with process BOM.

### 15.3 Extrude-then-fillet under the architecture

1. Bootstrap context + Front/Top/Right/Origin.  
2. Sketch feature creates wires under `sketch1`.  
3. Extrude feature: remainder pattern transform → `opExtrude` → optional boolean → commit.  
4. Fillet: query `createdBy(extrude1, EDGE)` ∩ selection → fillet op.  
5. On fillet fail: ERROR marks radius param; abort restores BREP; highlights may remain.  
6. Downstream features stay stable via history queries—not edge index 3.

---

## 16. Pedagogical summary

1. **std ≠ kernel.** Features are recipes; ops are the real geometry API.  
2. **History + queries** beat raw indices for parametric CAD.  
3. **Extrude-class tools** are multi-step (create, boolean, draft, cleanup).  
4. **Pipe ≠ frame.** Routing+sweep for fluids; frame for structure.  
5. **Assemblies are a separate layer.** Mate connectors ≠ mate solvers — critical for **6-DOF robot**.  
6. **Both product goals share a small solid kernel**; differentiators are routing/catalog/sim (**AI-BOOST**) vs mates/FK/URDF (**robot**).  
7. **We already have a strong `occ_c` core**; the missing product spine is **IR + selectors + Luau libraries + assembly/routing**.  
8. Learn architecture; **build originals** on OCCT.

---

## Appendix A — Observed `defineFeature` exports (file names)

`bodyDraft`, `booleanBodies`, `bridgingCurve`, `boundarySurface`, `chamfer`, `circularPattern`, `compositeCurve`, `compositePart`, `constrainedSurface`, `cPlane`, `cPoint`, `curvePattern`, `cutlist`, `decal`, `deleteBodies`, `deleteFace`, `derivedMirror`, `draft`, `editCurve`, `enclose`, `endcap`, `extendSurface`, `externalThread`, `extrude`, `faceBlend`, `intersectionCurve`, `fill`, `fillet`, `fitSpline`, `frame`, `frameTrim`, `gusset`, `helix`, `importDerived`, `importForeign`, `isocline`, `isoparametricCurve`, `linearPattern`, `loft`, `mateConnector`, `mirror`, `modifyFillet`, `trimCurve`, `moveFace`, `mutualTrim`, `nameEntity`, `offsetCurveOnFace`, `offsetSurface`, primitives (`cube`, `fSphere`, `fCuboid`, `fCylinder`, `fCone`, `fEllipsoid`), `projectCurves`, `queryVariable`, `replaceFace`, `revolve`, `rib`, `routingCurve`, `ruledSurface`, `sectionPart` (+ variants), `shell`, `splitPart`, `sweep`, `tag`, `thicken`, `copyPart`, `assignVariable`, `wrap`, plus sheet-metal family via `defineSheetMetalFeature` helpers.

## Appendix B — Source anchors

| Path in mirror | Why it matters |
|----------------|----------------|
| `feature.fs` | Feature lifecycle |
| `context.fs` | Context + Id model |
| `geomOperations.fs` | Full op façade (64) |
| `query.fs` | Selection language |
| `evaluate.fs` | Measures (49) |
| `extrude.fs` | Multi-op feature archetype |
| `primitives.fs` | Minimal recipes |
| `routingCurve.fs` | Path routing for pipes |
| `frame.fs` | Structural members |
| `mateConnector.fs` | Frames |
| `matedoftype.gen.fs` | DOF **labels only** |
| `instantiator.fs` / `derive.fs` | Catalog placement pattern |
| `compositePart.fs` | Grouping ≠ assembly |
| `transform.fs` / `coordSystem.fs` | SE(3) math |
| `transformCopy.fs` | Connector-to-connector place |
| `hole.fs` | Extreme feature complexity |
| `boolean.fs` | Merge semantics |
| `sweep.fs` | Primary pipe solid primitive |

## Appendix C — Relationship to AI-BOOST PDF objectives

| Challenge objective | Covered by this learning? |
|---------------------|---------------------------|
| NL engineering requirements | Gap → `ai` layer; IR is the structured target |
| Extract geometric/assembly constraints | Queries + mates + drawing/NL fusion |
| Parametric CAD components/piping | Kernel P0 + RoutePath + catalog |
| Mesh / seed / convergence | `MeshPrep` + external solver; CAD measures help |
| Expert validation / integration | Human Run, IR audit trail, STEP export |

## Appendix D — Full Feature Type Name list (UI, non-exhaustive of SM internals)

3D fit spline, Bend, Bend relief, Body draft, Boolean, Boundary surface, Bridging curve, Chamfer, Circular pattern, Composite curve, Composite part, Constrained surface, Copy part, Corner, Corner break, Cube, Curve pattern, Cut list, Decal, Delete face, Delete part, Derived, Derived mirror, Draft, Edit curve, Enclose, End cap, External thread, Extrude, Face blend, Fill, Fillet, Finish sheet metal model, Flange, Form, Frame, Frame trim, Gusset, Helix, Hem, Hole, Import, Intersection curve, Isocline, Isoparametric curve, Linear pattern, Loft, Make joint, Mate connector, Mirror, Modify fillet, Modify joint, Move boundary, Move face, Mutual trim, Name entity, Offset curve, Offset surface, Plane, Point, Projected curve, Query variable, Recognize, Replace face, Revolve, Rib, Rip, Routing curve, Ruled surface, Sheet metal loft, Sheet metal model, Shell, Sketch, Sphere, Split, Sweep, Tab, Tag, Thicken, Transform, Trim curve, Variable, Wrap.

## Appendix E — One-page dual-goal thesis

1. **Part Studio std ends at frames + placed bodies** — mate connectors, composites, instantiator, transforms.  
2. **True assemblies are our product layer** — occurrences, mates, joint limits, FK (**6-DOF robot**).  
3. **Pipe ≠ frame** — routing+annulus sweep vs structural member sweep (**AI-BOOST**).  
4. **Dual goals share** frames, booleans, sweep/pipe, patterns, holes, clash, STEP/mesh.  
5. **Differentiating P0:** robot = `asm` + FK + URDF pack; skid = `RoutePath` + piping catalog + clash KPI + MeshPrep.  
6. **Do not port** sheet metal, manipulators, hole megatables, FS runtime.  
7. **IR is the contract** between agents, Luau, and `occ_c` — stable ids, SI, selectors, version pins.

---

*End of clean-room report. Implementers: build from here; do not open the mirror while coding.*
