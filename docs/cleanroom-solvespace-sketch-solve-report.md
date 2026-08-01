# Clean-Room Learning Report: Parametric Sketch & Geometric Constraint Solving

**Document type:** Architecture & capability specification (Team A readers · Team B implementers)  
**Audience:** Implementers of our Luau libraries, portable IR, sketch solver, and `occ_c` / OCCT stack  
**Date:** 2026-08-01  
**Source analyzed:** [github.com/solvespace/solvespace](https://github.com/solvespace/solvespace) — study tree `/mnt/workspace/SolveSpace` at commit `81f473ff18e2b1ffa7de389b7cf76daf1ac739c2` (shallow clone; **GPLv3 or later**). Reader reference only — **not** a product dependency.  
**Method:** Clean-room architecture read of the SolveSpace sketch model and geometric constraint solver; dual-goal prioritization against our AI-BOOST and 6-DOF robot goals.  
**Sister document:** Solids, features, host op façade, dual-goal solid matrix → [`docs/cleanroom-featurescript-std-report.md`](cleanroom-featurescript-std-report.md). **This document is the authority for Sketch2D / SolveSketch only** (closes FS §6.6 **A1**).

**Product goals (every matrix column):**

1. **AI-BOOST** — Challenge 2: agentic CAD for industrial **piping / compressor skids**, including constraint extraction, parametric 3D, mesh/sim prep, human oversight  
2. **6-DOF robot arm** — simplified serial robot **assembly** (links, revolute joints, flanges, frames, FK pose, STEP/mesh/URDF-style export)

**This document is not implementation code.** It specifies what to learn, what to build under **our** names, and what to ignore. Implementers code from **this file + OCCT/`occ_c` + hand-authored tests**. Do **not** open SolveSpace sources while coding.

**License red line:** SolveSpace is **GPLv3 or later**. **Hard reject:** link, embed, static/dynamic load, Wasm import, or co-ship of `libslvs` / `slvs.js` / any SolveSpace binary with Apache `api/`, `//api:libocc_c`, `//api:libocc_c_wasm`, or Apache examples. Clean-room reimplementation only. Details: **§1**.

**Product law (dual goals):**

| Track | Law |
|-------|-----|
| **Ship demos / CI** | Must pass on **ExplicitCoords** + existing construct/extrude/pipe/member APIs. **Do not block** AI-BOOST or robot smoke on Newton. |
| **Kernel completeness (FS A1)** | Parametric Sketch2D + SolveSketch is the largest remaining **unimplemented C** hole — additive, not a demo gate. |
| **Parallel work** | Product eng: IR freeze, recipes, ExplicitCoords demos. Kernel eng: thin SolveSketch (MVP below). Both advance together. |

---

## Table of contents

0. How to read this report  
1. Legal & provenance  
2. Product map (full CAD vs embeddable solver vs what we learn)  
3. Architecture lessons  
4. Entity surface (our names)  
5. Constraint catalog (MVP · P0 · P1 · P2)  
6. Capability matrix  
7. Recipe patterns  
8. IR design for Sketch2D / SolveSketch  
9. Proposed C / API surface (illustrative, not a twin ABI)  
10. What not to learn / not to port  
11. Gaps outside sketch  
12. Repository mapping + recommended build order  
13. Clean-room process checklist  
14. Pedagogical walkthroughs  
15. Pedagogical summary  
Appendix A — Constraint table (compact)  
Appendix B — Residual cheat sheet (P0 / MVP)  
Appendix C — Source anchors for readers only  
Appendix D — Related repository docs

---

## 0. How to read this report

### 0.1 What “clean-room” means here

| Role | Allowed | Forbidden |
|------|---------|-----------|
| **Team A readers** (this report) | Open SolveSpace tree; extract architecture, taxonomies, residual *geometry*, recipes *in abstract* | Shipping SolveSpace source as ours; pasting residual DAGs into product |
| **Team B implementers** | Build from **this** document + OCCT + our conventions + tests | Looking at SolveSpace `.cpp` / `slvs.h` while writing sketch / `occ_c` / Luau |
| **Optional oracle / QA** | Run GPL `libslvs` **out of process** on synthetic cases; compare numbers only | Embedding GPL in the Apache ship graph; asserting against `SLVS_*` codes; shared process with `//api` tests |

Unlike the FeatureScript std study (MIT), SolveSpace is **GPLv3+**. You **must not** copy or link it. Strategy matches the FS report’s product shape: own IR, own C ABI, OCCT solids — original surface, not a clone. Full firewall: **§1**.

### 0.2 Three layers (never conflate them)

```text
┌──────────────────────────────────────────────────────────────┐
│  Luau + namespaces + well-defined libraries                   │
│  (author/agent surface — sketch IR, recipes, params)         │
└────────────────────────────┬─────────────────────────────────┘
                             │ emits / lowers
┌────────────────────────────▼─────────────────────────────────┐
│  Portable IR  (Sketch2D / SolveSketch / solid ops)           │
│  + clean-room sketch solver (params, residuals, DOF)         │
└────────────────────────────┬─────────────────────────────────┘
                             │ materializes solved UV → wires
┌────────────────────────────▼─────────────────────────────────┐
│  Host ops  →  occ_c / OCCT  (extrude, boolean, STEP, mesh)   │
└──────────────────────────────────────────────────────────────┘
```

| Layer | Owns | Does **not** own |
|-------|------|------------------|
| **Solver** | Params, entity graph (solver sense), constraint residuals, Jacobian/Newton, DOF / status | BREP topology, booleans, STEP |
| **IR** | `Sketch2D` / `SolveSketch`, plane refs, construction flags, macros, feature stacking | Numeric Newton internals; OCCT types |
| **`occ_c`** | Plane POD, edges/wires/faces from **numeric** coords, extrude/revolve/boolean/mesh | Constraint equations, DOF, drag |

FeatureScript’s `std` is a façade over a proprietary kernel (FS cleanroom). SolveSpace’s `libslvs` is a **separable sketch solver** with **no solids**. Our solids already live under Apache `occ_c`. The learning target is **solver + sketch IR architecture**, not SS solid/NURBS.

### 0.3 Dual product goals (sketch-specific “done”)

| Goal | Sketch “done” | What SS study helps | What SS does **not** give |
|------|---------------|---------------------|---------------------------|
| **AI-BOOST skid** | Parametric flange plates, bolt patterns (prefer pattern ops), pipe sections; agent can re-dim and re-solve profiles | Constraint taxonomy, group freeze, DOF feedback | Process fittings catalog, FEA, NL intake, OCCT STEP |
| **6-DOF arm** | Link plate / tube sections, flange blanks, mounting hole rings; re-solve section dims | 2D frame + dimensions; same residual families | True assembly mates, FK product, URDF packaging (FS + `occ_c` frames) |

### 0.4 Thesis

> **SolveSpace proves that a parametric CAD stack can isolate a geometric constraint solver (params + residuals + Newton + rank/DOF) from solid modeling; we reimplement that *architecture* under our names, feed solved profiles into `occ_c`, and never link or twin the GPLv3 `libslvs` ABI. Dual-goal demos ship on ExplicitCoords; SolveSketch is kernel completeness, not a smoke-test blocker.**

### 0.5 Ownership vs FeatureScript cleanroom

| Topic | Owner document |
|-------|----------------|
| Solids, extrude/boolean/sweep, frames, session, recipes for skid/robot solids | [FS cleanroom](cleanroom-featurescript-std-report.md) |
| Sketch2D, SolveSketch, residual catalog, sketch C surface, DOF | **This document** |
| FS §6.6 **A1** gap id | Specified here as **§12** phases (closure plan) |

---

## 1. Legal & provenance

| Item | Value |
|------|--------|
| License | **GNU GPL v3 or later** (README / CONTRIBUTING). `COPYING.txt` is the GPLv3 body; no Program-level linking exception. |
| Upstream | [github.com/solvespace/solvespace](https://github.com/solvespace/solvespace) |
| Study revision | `/mnt/workspace/SolveSpace` @ `81f473ff18e2b1ffa7de389b7cf76daf1ac739c2` (shallow; pin before implementer freeze if the tree moves) |
| Embeddable solver | `libslvs` + `include/slvs.h` — **project GPLv3+** (header has copyright only, not a separate permissive grant) |
| Packaging metadata | **Root** `pyproject.toml` classifier claims **MIT** — **unsafe / incorrect** for wrapped GPLv3+ sources. `package.json` says “GNU GPL V3” (omits “or later”). **Do not trust packaging metadata** as a relicense. |
| Study surface | Constraint/entity **semantics**, group layering, solve outcomes, residual *geometry* (abstract) |

### Practical rules (Apache product)

1. **Do not** add SolveSpace as a Bazel dep of `//api` or Apache examples.  
2. **Do not** copy `slvs.h` types, numeric IDs, or solver sources into Apache trees.  
3. **Do not** ship `slvs.js`, `libslvs`, or any SolveSpace binary **as part of** the Apache product (`libocc_c.js` / Wasm / examples / `api/` release artifacts). Quarantine any GPL oracle in a **separate** repo/tree/CI job that never appears in Apache ship graphs or fused browser modules. “Same CDN folder” or “one product zip” is **not** a safe workaround.  
4. Clean-room **behavioral** specs (this document) are OK; implementers code only from them.  
5. Optional GPL **oracle process** may exist **outside** the Apache ship graph — separate process, separate CI; compare only final param vectors / success-fail on hand-authored cases. Do **not** link oracle into `//api` tests, parse `slvs.h`, or assert against `SLVS_*` result codes.  
6. Solids/mesh/STEP stay on **OCCT via `occ_c`** — never reimplement SolveSpace `srf/*` or its STEP writer.

Elsewhere in this document: see **§1** — do not restate the firewall.

---

## 2. Product map (full CAD vs embeddable solver vs what we learn)

### 2.1 Scale of the study product

SolveSpace is a **full parametric 2D/3D CAD application** that **also** ships an embeddable geometric constraint solver.

```text
┌─────────────────────────────────────────────────────────────┐
│  solvespace / solvespace-cli / experimental Emscripten GUI  │
│  platform, render, UI, file I/O, styles, TTF, undo          │
├─────────────────────────────────────────────────────────────┤
│  solvespace-core                                            │
│  groups, requests, generate, groupmesh, srf/* (NURBS),      │
│  mesh, export*, import*, polygon/BSP                        │
├──────────────────────┬──────────────────────────────────────┤
│  slvs-solver core    │  used by app for live sketch solve   │
│  expr + system + …   │                                      │
└──────────────────────┴──────────────────────────────────────┘
           ▲
           │ same solver sources + thin C wrapper
┌──────────┴──────────────────────────────────────────────────┐
│  libslvs (shared) / Python / Wasm JS                        │
│  Public surface: slvs.h — NO solid / NURBS / STEP           │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 What is separable (learn this)

| Layer | Role |
|-------|------|
| Params + entities + constraints | Sketch document model |
| Expression residuals \(e = 0\) | Constraint → equations |
| Substitution + alone-solve + joint Newton | Numeric solve (one known architecture — **not** a required port) |
| Sparse Jacobian + rank | DOF / redundancy |
| Soft drag column weights | Interactive preference |
| Group-scoped unknowns; prior params **known** | Parametric history |

### 2.3 What is **not** sketch-solver scope (use `occ_c` instead)

| SolveSpace app area | Our path |
|---------------------|----------|
| Extrude / lathe / revolve / helix groups | `occ_extrude_*`, revolve, pipe, member sweep |
| NURBS shell boolean (`srf/*`) | OCCT BRep booleans via `occ_c` |
| Triangle mesh / STL / STEP writers | `occ_mesh_*`, STEP writers |
| `.slvs` file format | **Do not clone** |
| GUI, styles, TTF, undo | Host UI / AgentOS |
| LINKED assembly as full product | IR assembly + frames (FS cleanroom) |

### 2.4 Integration options by license safety

| Rank | Option | Verdict |
|------|--------|---------|
| **1** | Clean-room reimplement solver **behavior** under Apache (or BSL host-only) | **Primary path** |
| **2** | Separate GPL process (IPC oracle) outside Apache trees | Research / optional QA only |
| **3** | Link, embed, Wasm-import, or co-bundle `libslvs` / `slvs.js` with Apache product | **Hard reject** |

### 2.5 Product-owner takeaways

1. Only the **constraint-solver subsystem** is worth clean-room comparison.  
2. **Do not link or co-ship** it with Apache product artifacts (**§1**).  
3. Solids stay **`occ_c`**.  
4. **ExplicitCoords first** for dual-goal demos; invent SolveSketch when parametric re-solve is a measured need.

---

## 3. Architecture lessons

### 3.1 Handles, not live pointers

Everything is referenced by opaque integer handles (params, entities, constraints, groups). Zero means “none.” **Our design:** `occ_sk_id_t` / IR string ids — **do not** copy SS bit-packing schemes.

### 3.2 Param = scalar unknown (or frozen constant)

| Concept | Meaning |
|---------|---------|
| Value | Current numeric estimate |
| Known / frozen | Prior history stages fold to **constants** |
| Free (post-solve) | Optional unbound detection (UI highlight ≠ DOF count) |
| Dragged (soft) | Prefer small motion via column weights in least-squares |

Solver working set is typically a **copy** of the active stage’s params; success writes back. Reported DOF is only \(n - \mathrm{rank}(J)\) on the **reduced** joint system — not free-param scan size.

### 3.3 Equation = residual \(e = 0\)

No separate LHS/RHS storage. Generators emit geometric measures minus targets (or pure predicates). Multi-eq constraints pack vector components (2 in-plane for most P0 types).

### 3.4 Residuals and derivatives (implementation choice)

Symbolic trees, automatic differentiation, or **hand-coded residual + Jacobian rows** are all acceptable if residual *geometry* matches Appendix B. An expression DAG is an **allowed** implementation, not a required product architecture for v1 — hand-coded P0 residuals are enough to ship MVP.

### 3.5 Solve pipeline (abstract capability — not a port)

Any correct nonlinear geometric constraint system (GCS) pipeline is acceptable. The bullet list below is **one known architecture** observed in the study tree; it is **not** a required stage order and must **not** be implemented by replaying GPL source structure. Invent our control flow and constants.

```text
1. Generate residuals for the active sketch stage
   (user constraints + entity-implicit eqs + hard pins)
2. Optional identity substitution on pure PARAM−PARAM differences
   (prefer keeping dragged params as representatives)
3. Optional alone-solves (single-unknown Newton subsystems;
   remove those eqs/params from the joint system)
4. Joint weighted least-squares / min-norm Gauss–Newton
5. Rank / DOF on the reduced joint system (post-alone)
6. Freeze stage params as known for later stages
```

#### Newton step (abstract — implement with our sparse stack)

```text
Form residual vector F and Jacobian A of free params
  (optional: scale drag columns, e.g. weight ~ 1/20 — tunable policy)
Underdetermined / square: min-norm step via normal equations on A A^T
  Solve (A A^T) z = F  (e.g. SparseQR),  X = A^T z, unscale,  x ← x − X
Overdetermined: least-squares residual reduction (same LS family)
Rank / DOF: SparseQR (or equivalent) on joint J after reduction:
  dof = n_joint − rank(J_joint)
No classical line-search / Armijo / Levenberg–Marquardt required for parity.
Optional LM later is our enhancement, not a study mandate.
```

#### Status concepts (product meaning — original codes)

Cover success, hard conflict, numeric failure, size limit, and optional “solved with redundancy” as **product concepts**. Use **our** names and **non-matching** numeric values (do **not** assign 0..4 in any public-solver result order). Prefer structured out-params over a five-int enum that maps 1:1 onto a foreign ABI.

| IR / product concept | Meaning |
|----------------------|---------|
| OK | Converged ∧ (rank suppressed ∨ full **row** rank) |
| RedundantOK | Converged ∧ rank \(< m\) (redundant equations; still a solution) — **not** a failure when product allows redundancy |
| NoConverge | Did not converge; structure may still look OK |
| Failed / Inconsistent | Conflict structure and/or no usable solution (e.g. rank issues + no converge) |
| SizeLimit | Assembled residual count exceeds our guard |

**Well-constrained** ⇔ converge ∧ \(\mathrm{dof}=0\) ∧ full row rank. **Underconstrained** well-posed systems can still be OK with \(\mathrm{dof}>0\).

**Size guard:** reference study behavior trips on **equation row count** after assembly (order of ~2048 eqs), not unknown count alone. Choose **our** limit deliberately and document it.

**Tolerances:** choose and document **our** length merge eps and residual stop for industrial mm-scale models. Do **not** copy study-tree magic numbers into product headers. Order-of-magnitude guidance only: geometry merge coarser than solver residual stop; max iters on the order of tens; angles unit-consistent (prefer radians internally). Residuals mix length, length² (2D parallel cross), and dimensionless cosines — prefer length-homogeneous residuals in clean-room where practical.

**Dimension seeding:** when creating metric constraints, initialize \(d/\theta\) from the **current** geometry measure so Newton starts in basin (abstract algorithm; invent our seeding).

### 3.6 Soft drag vs hard pin

| Mechanism | Hard? | Role |
|-----------|-------|------|
| Soft drag weights | No | Interactive: column scale on dragged params (tunable; study order-of-magnitude ~1/20); substitution should **keep dragged** representatives |
| `Pin` / `LockPoint` (**MVP / P0**) | Yes | Residual \(\mathrm{coord} - \mathrm{coord}_{\mathrm{frozen}} = 0\) at equation-build time — kills rigid-body DOF |

Never implement soft drag by injecting pins. Hard pin freezes numbers at build time; soft drag does **not** remove DOF.

### 3.7 Groups / stages: sequential freeze (critical)

Parametric history is a **linear stack of simultaneous-solve batches**, not one giant system:

```text
[refs known] → [sketch A solve → known] → [solid A via occ_c]
             → [sketch B on face solve → known] → …
```

- Constraints in stage *G* may **reference** earlier geometry.  
- Only params **owned by G** are free unknowns.  
- Earlier params fold to constants (**known**).  
- DOF is **per stage**: \(\mathrm{dof} = n - \mathrm{rank}(J)\) after reduction, not global model mobility.

**Map to us:** IR feature/history stages + freeze; session `created_by` is **provenance for reselect**, not automatically a constraint batch. Dirty edit of stage *k* invalidates *k..end*.

### 3.8 Workplane / sketch frame

A sketch frame is origin + orthonormal U, V, N (or equivalent). Points in-plane own **(u, v)**. “Horizontal / vertical” mean equal **v** or **u** in that frame — not screen axes unless the frame is the drawing plane.

Free-in-3D sketching exists in the study product but is **P2** for dual goals.

### 3.9 Intent vs state vs solid

User intent (sketch commands) → solver state (entity + param + constraint graph) → solid (**`occ_c` only** after profile harvest). Points own DOF; curves reference points. Shared vertices = identity or coincidence. Construction flag excludes geometry from solid loops but keeps it in the solver graph. (Layer split: **§0.2**.)

### 3.10 Patterns and assemblies (sketch-adjacent)

- **Step patterns:** shared step params + transformed clones; constrain last instance via stable keys — pitch becomes a few DOF, not N independent sketches.  
- **Bolt circles for product:** prefer **polar pattern of drills outside sketch** (recipe R3), not N constrained circles.  
- **Assembly pose:** rigid SE(3) + mates live in **IR + frames**, not sketch v1.

### 3.11 Public embed API lesson (do not twin)

Embeddable solvers often expose batch arrays and stateful add/solve with guesses, drag sets, DOF, and failed lists. **We learn the *capability*, not the ABI.** Our surface follows `occ_c` conventions (opaque handles, `int` status, out-params). See **§1** for license.

---

## 4. Entity surface (our names)

Names are **new**. Semantics are clean-room equivalents.

### 4.1 Dual-goal core (P0)

| Our type | Params / DOF (in-plane) | Topology role |
|----------|-------------------------|---------------|
| `Point2` | u, v | Shared vertices |
| `LineSeg` | refs 2 points | Edge |
| `Circle2` | center `Point2` + **owned** radius scalar | Closed edge |
| `Arc2` | center, start, end `Point2`; **pick one radius model in Phase 1** (implicit equal radii, **or** owned r + two on-circle eqs) | Open edge |
| `Polyline2` | ordered `Point2[]` | Macro → lines |
| `Rect2` | corner+size or opposite corners; axis-aligned in frame | Macro → 4 lines |
| `Annulus2` | center, r_outer, r_inner | Outer + hole wires |
| `SketchFrame` | origin + U,V,N | Plane of sketch |
| `is_construction` | flag | Omit from solid loops |

**Radius story:** Circle owns scalar \(r\). Arc model is a Phase-1 design choice (a or b above) — document the pick so `Diameter` / `EqualRadius` / harvest stay consistent.

### 4.2 Deferred entity zoo (P2 / never)

| Item | Action |
|------|--------|
| Cubic / periodic splines | P2; unconstrained B-spline already in construct |
| TTF text / image quads | Never as kernel sketch entities |
| Free-in-3D points for all tools | P2 |
| Transform-copy entity family | Feature-history layer, not sketch IR v1 |

### 4.3 Ownership rule

Prefer **points as shared nodes** so polyline and rectangle corners share DOF. Macros expand for the solver or lower directly to OCC wires in ExplicitCoords mode.

### 4.4 Pipeline after solve

```text
Sketch IR (entities + constraints)
  → SolveSketch (optional)
  → ProfileWires { outer, holes[] }   // construction stripped
  → occ_c: existing planar face / extrude / revolve / pipe / boolean
```

**Invariant:** both ExplicitCoords and SolveSketch share the **same** lower into construct helpers. Phase 0 must not invent a second solid stack.

---

## 5. Constraint catalog

The study tree’s public C header defines **38** geometric constraint type IDs (study snapshot). We do **not** number-match those IDs. Priorities use **dual goals**. Residual math lives only in **Appendix B**.

### 5.0 MVP-A1 (ship first for dual-goal parametric win)

Thinner than full P0 — enough for plate + flange:

| IR name | Why first |
|---------|-----------|
| `CoincidentPoints` | Shared centers / vertices |
| `DistancePoints` | Width / height / pitch |
| `Horizontal` / `Vertical` | Axis-aligned rect |
| `Diameter` (or radius dim) | Flange OD/ID |
| **`Pin` / `LockPoint`** (or origin-corner pin recipe) | Kill 2D rigid-body DOF (2 trans + rot) |

**Pin recipe alternative:** if a first-class pin is deferred one sprint, require `CoincidentPoints` (or `DistancePoints` + H/V) to a **construction origin** with known UV — still MVP, still Phase 1a.

### 5.1 P0 — complete 2D set after MVP

| IR name | Geometric meaning | Product note |
|---------|-------------------|--------------|
| All of MVP-A1 | — | Includes **Pin** |
| `Parallel` / `Perpendicular` | Directions | Slot / angle plates |
| `Angle` | \(\angle = \theta\) | Degrees in IR record; radians inside \(\cos\) |
| `PointOnLine` | On infinite line | **Net DOF ≈ −1** in 2D (see App A) |
| `AtMidpoint` | Point = segment midpoint | Stronger than on-line |
| `EqualLength` | Equal segment lengths | Symmetry lite |
| `EqualRadius` | \(r_1 = r_2\) | Concentric fillets |
| `PointOnCircle` | On circle | **Our v1: planar radial**; study 3D form is cylindrical (axial free) — defer |
| `TangentArcLine` | Line ⊥ radius at arc end | Does **not** glue endpoints alone |
| `DistancePointLine` | Offset to line | **Signed** in plane for P0 |

**Fillet sketch rule:** coincident endpoints **plus** `TangentArcLine` (plus equal radius as needed). Arc–arc fillets need `TangentCurveCurve` (P1) or ExplicitCoords centers.

### 5.2 P1 — production sketch + light 3D/assembly

| IR name | Why |
|---------|-----|
| `LengthRatio` / `LengthDifference` | Parametric proportions |
| `SymmetricAboutLine` / H / V | Mirror sketches |
| `EqualAngle` | Symmetric angles |
| `TangentCurveCurve` | Arc–arc fillets |
| `PointOnPlane` / `DistancePointPlane` | Multi-plane / datum |
| `SameOrientation` / projected distances | Prefer **assembly IR + frames**, not sketch v1 |
| Soft drag policy | Interactive UX — **not** dual-goal P0 |

**Reference dimensions:** a **flag** (`driving: false`), not a constraint type — no residuals.

### 5.3 P2 — parity / niche

Arc-length ratio/difference family; cubic tangency; free-3D parallel with free scale; full cylinder semantics of point-on-circle beyond planar sketches.

### 5.4 Never as geometric solver constraints

| Item | Reason |
|------|--------|
| Comment / annotation | UI only |
| Soft drag set | Solver policy, not a residual type |
| OCCT C++ types in public surface | Product mission |

### 5.5 Entity-implicit equations (not user menu items)

| Entity | Implicit residual | Notes |
|--------|-------------------|-------|
| Arc (model a) | equal distance center→start and center→end | Skip when endpoints already coincident (full circle) or when center is not a native in-plane point (transformed copies) — blind always-on overconstrains |
| Arc (model b) | owned r + two on-circle | Alternative; no equal-radii implicit |
| Free 3D orientation (if ever) | unit quaternion | Out of sketch v1 |

### 5.6 Workplane projection classes

| Class | Examples |
|-------|----------|
| Projectible (honor frame UV) | coincident, distances, H/V, parallel/perp/angle, on-line, midpoint, equal length, pin |
| Non-projectible (curve-native) | diameter, equal radius, point-on-circle, arc–line tangent |

---

## 6. Capability matrix

**Legend** (every matrix cell uses only these tokens)

| Cell | Meaning |
|------|---------|
| **Y** | Present / specified as product path |
| **P** | Partial |
| **N** | Missing / not in this layer |
| **—** | Not applicable |
| **done** | Available in Apache `occ_c` today |
| **invent** | Clean-room build |
| **use_occ** | Lower to existing solid APIs |
| **never** | License or scope reject |
| **Pri** | P0 / P1 / P2 product priority |

**Scoring note:** Both goals value sketch long-term, but medium-term dual-goal demos (**SYSTEM** success slices) already run on ExplicitCoords. “Y P0 invent” for SolveSketch means **kernel completeness**, not “blocks Challenge 2 / robot smoke.”

### 6.1 Sketch document & solve

| Capability | AI-BOOST | Robot | Pri | solver | IR | occ_c | Luau |
|------------|----------|-------|-----|--------|----|-------|------|
| ExplicitCoords profile (today) | Y | Y | P0 | — | invent | **done** | Y |
| Sketch graph (entities + constraints) | Y | Y | P0 | invent | invent `Sketch2D` | N | Y |
| Sketch frame / plane | Y | Y | P0 | invent | invent | **P** (plane POD) | Y |
| Construction flag | Y | Y | P0 | invent | invent | — | Y |
| Sequential freeze (prior known) | Y | Y | P0 | invent | invent | N | P |
| Nonlinear SolveSketch | Y | Y | P0† | invent | `SolveSketch` | N | Y |
| DOF + status (with first solve) | Y | Y | P0 | invent | report | N | Y |
| Failed constraint ids | Y | P | P0‡ | invent | report | N | Y |
| Soft drag | P | P | P1 | invent | session | N | P |
| Reference-only dims | P | P | P1 | invent | flag | N | P |
| Free-in-3D full sketch | N | N | P2 | N | N | N | — |
| GPL libslvs embed / co-ship | — | — | — | **never** | **never** | **never** | **never** |

† Kernel completeness P0; **not** dual-goal demo gate.  
‡ Prefer shipping failed-id list with first solve (agent loops), before soft drag.

### 6.2 Entities & constraints (summary)

| Capability | AI-BOOST | Robot | Pri | solver | IR | occ_c | Luau |
|------------|----------|-------|-----|--------|----|-------|------|
| Point2 / LineSeg / Circle / Arc | Y | Y | P0 | invent | invent | **P** (fixed XYZ edges) | Y |
| Rect / Polyline / Annulus macros | Y | Y | P0 | invent | invent | **P** (fixed builders) | Y |
| MVP-A1 constraints (§5.0) | Y | Y | P0 | invent | invent | N | Y |
| Full P0 set (§5.1) | Y | Y | P0 | invent | invent | N | Y |
| P1 symmetry / ratios / arc–arc | P | P | P1 | invent | invent | N | Y |
| Assembly same-orientation / face mates | P | Y | P2 | N (v1) | asm IR | frames **done** | Y |

### 6.3 Profile harvest → solid

| Capability | AI-BOOST | Robot | Pri | solver | IR | occ_c | Luau |
|------------|----------|-------|-----|--------|----|-------|------|
| Closed loops, strip construction | Y | Y | P0 | harvest | invent | wires **done** | — |
| Outer + holes | Y | Y | P0 | harvest | invent | **P** (cut path **done**) | Y |
| Extrude / revolve / pipe / boolean | Y | Y | P0 | — | solid ops | **done** | Y |
| Mesh / STEP | Y | Y | P0 | — | export | **done** | Y |

### 6.4 Without vs with solver

| Profile | Without solver (today — **ship path**) | With thin SolveSketch |
|---------|----------------------------------------|------------------------|
| Rect plate | `occ_make_face_rectangle` + extrude | width/height + pin re-solve |
| Circle / hole | face circle + drill | diameter-driven |
| Annulus flange | extrude + `occ_drill_*` | concentric + OD/ID |
| Bolt circle | polar drill pattern | avoid N-circle sketch |
| Pipe OD on path | `occ_pipe_annulus` | OD fixed; path sketch optional |
| Rect tube link | `occ_member_sweep_rect` | optional section sketch |

---

## 7. Recipe patterns

Names are **ours**. Each recipe has **ExplicitCoords** (works today — default dual-goal path) and optional **SolveSketch**. Solid recipe detail for pipe/flange lives in [FS cleanroom §7](cleanroom-featurescript-std-report.md); this section only covers **profile** intent.

Canonical lower:

```text
[A] ExplicitCoords → ProfileWires → occ_c solid op     ← dual-goal default
[B] entities + constraints → SolveSketch → same ProfileWires → same occ_c path
```

**Invariant:** `occ_c` never becomes a constraint engine.

### R1 — Fully constrained rectangle → extrude plate

- **IR:** `Rect2` or 4 lines + H/V + width/height + **Pin**.  
- **Explicit:** `occ_make_face_rectangle` / UV polygon + `occ_extrude_*`.  
- **Use:** skid pads/baseplates; robot link plates.  
- **First parametric win** after MVP solve.

### R2 — Annulus / flange bore

- **IR:** `Annulus2` or two circles + coincident centers + two diameters + pin center.  
- **Explicit today:** extrude outer disk + `occ_drill_hole_through`.  
- **Use:** flanges, hollow joint rings. See FS §7.4–7.5 for solid flange recipes.  
- **Second parametric win.**

### R3 — Bolt circle (prefer pattern **outside** sketch)

- **IR:** polar pattern of hole cuts; **not** N constrained sketch circles.  
- **Explicit:** centers or `occ_pattern_polar*` + drill/cut.  
- Stays ExplicitCoords / pattern forever unless a demo demands constrained pitch angles.

### R4 — Pipe OD on path frame

- **IR:** route path + circle/annulus section in start frame.  
- **Explicit:** `occ_make_route_*` + `occ_pipe_annulus` / `occ_pipe_solid` (FS pipe recipes).  
- SolveSketch only if the **centerline plan** is constrained — OD is usually a number.

### R5 — Robot rectangular tube section

- **IR:** rect section along link spine from FK frames.  
- **Explicit:** `occ_member_sweep_rect`. Optional SolveSketch for section dims only.

### R6 — ExplicitCoords vs SolveSketch fork

| Situation | Choose |
|-----------|--------|
| Agent emits final numbers / BOM geometry | **ExplicitCoords** |
| Dual-goal smoke / CI | **ExplicitCoords** |
| User/agent edits a driving dim, rebuild sketch | SolveSketch |
| Bolt N, R from standards table | Pattern (R3) |
| Pipe nodes + bend R | Route APIs |
| Interactive drag with H/V locks | SolveSketch + soft drag (P1) |

Suggested sugar names: `RecipeRectPlate`, `RecipeAnnulusPlate`, `RecipeBoltCircleHoles`, `RecipePipeAlongRoute`, `RecipeRectTubeLink`, `SketchExplicit`, `SketchSolve`.

---

## 8. IR design for Sketch2D / SolveSketch

Sketch ops sit inside the portable IR envelope defined in [FS cleanroom §10](cleanroom-featurescript-std-report.md) (document graph, op nodes, determinism). This section specifies what Sketch2D **adds**.

### 8.1 Document graph (sketch chapter)

```text
FeatureGraph
  Sketch[]                 // planar authoring units
  Pattern[]                // often outside any Sketch
  SolidFeature[]           // extrude / pipe / cut / hole / member
```

### 8.2 Sketch2D (node)

| Field | Role |
|-------|------|
| `id` | Stable string op id |
| `frame` | `SketchFrame` or ref to plane / face frame |
| `entities[]` | Point2, LineSeg, Circle2, Arc2, macros |
| `constraints[]` | MVP+ set; optional `driving` on metrics |
| `construction` | per-entity flag |
| `guesses` | seed map for free params (multi-root geometry) |
| `mode` | `explicit` \| `constrained` |

### 8.3 SolveSketch (eval op)

| Input | Output |
|-------|--------|
| Sketch id / inline graph | Status, DOF, updated UV/radii, optional failed ids |
| Optional drag set | Soft weights (P1) |

On success: materialize `ProfileWires` → solid ops. On failure: surface status + which constraint ids residual-failed.

### 8.4 Stage freeze semantics

```text
stage k solved → freeze numeric entity state
stage k+1 may reference frozen geometry as constants
edit k → invalidate k..end
```

### 8.5 Macros vs atomic edges

| Macro | Expand for solver | Direct lower ExplicitCoords |
|-------|-------------------|-----------------------------|
| `Rect2` | 4 pts + 4 lines + H/V + dims + pin | rectangle wire/face |
| `Polyline2` | N lines, shared points | polygon wire |
| `Annulus2` | 2 circles + coincident centers | circle + drill / face holes |

### 8.6 Units

Store SI length (document **mm** for dual-goal industrial data). Angles: degrees in IR records if desired; convert to radians for \(\cos\) residuals. Prefer length-homogeneous residuals where practical.

### 8.7 What IR must not encode

- Foreign solver type numbers or handle packing  
- `.slvs` fidelity  
- Solid group types as sketch ops (extrude is a **solid** IR op → `occ_c`)

---

## 9. Proposed C / API surface (illustrative — not a twin ABI)

**Proposed only** until headers exist under `api/`. Not compiled product ABI.

Design goals:

1. Match **`occ_c` conventions**: pure C, opaque handles, `int` status, out-params, ownership docs.  
2. **Do not** mirror foreign layouts, type names, or numeric IDs (**§1**).  
3. Solver optional: unconstrained UV → wires without Newton.  
4. After solve, call **existing** construct/sweep/boolean only — thin UV→wire lowerer, not a second construct surface.

Naming is product vocabulary. Final home: `api/include/occ_c_sketch.h` (or sibling Apache module) + `_OCC_C_EXPORTS` when symbols ship. Prefer keeping constraint types out of core `occ_c.h`.

### 9.1 Types (illustrative)

```c
/* Proposed — original ABI; not a foreign solver twin */

typedef struct occ_sketch_s* occ_sketch_t;
typedef uint32_t             occ_sk_id_t;   /* 0 = none */

/* Status values must NOT mirror any foreign 0..4 order.
   Prefer coarse status + detail flags / fields. */
enum {
  OCC_SK_STATUS_OK         = 1,
  OCC_SK_STATUS_FAILED     = 2,  /* detail: flags / last_error / failed ids */
  OCC_SK_STATUS_SIZE_LIMIT = 3
};
/* optional flags: OCC_SK_F_REDUNDANT, OCC_SK_F_NO_CONVERGE,
   OCC_SK_F_INCONSISTENT, OCC_SK_F_UNDERCONSTRAINED, ... */

typedef struct occ_sk_solve_info_s {
  int status;     /* OCC_SK_STATUS_* */
  int flags;      /* OCC_SK_F_* bitset */
  int dof;        /* free DOF after reduce; -1 if unknown */
  int n_failed;   /* count of residual-failed constraint ids */
} occ_sk_solve_info_t;

/* Reuse occ_plane_t from construct — do not invent a workplane twin */
```

| Product concept (§3.5) | C reporting |
|------------------------|-------------|
| OK | `OCC_SK_STATUS_OK`, flags clear or underconstrained only |
| RedundantOK | `OCC_SK_STATUS_OK` + `OCC_SK_F_REDUNDANT` |
| NoConverge | `OCC_SK_STATUS_FAILED` + `OCC_SK_F_NO_CONVERGE` |
| Inconsistent / conflict | `OCC_SK_STATUS_FAILED` + `OCC_SK_F_INCONSISTENT` |
| SizeLimit | `OCC_SK_STATUS_SIZE_LIMIT` |

### 9.2 API surface by phase (exit criteria → **§12.2**)

| Phase | Proposed surface (summary) |
|-------|----------------------------|
| **0** | `create`/`free`; add point/line/circle/arc/polyline/rect; construction; get/set UV; `build_wires` / thin face lower via **existing** construct |
| **1** | Constraint adders (MVP then full P0); `Pin`; `solve` + `occ_sk_solve_info_t`; failed ids; `occ_last_error` pattern |
| **2** | Soft drag begin/move/end; symmetry; curve–curve tangent; length ratio/diff; remove + orphan policy |
| **3** | Multi-plane only if proven necessary; mate-ish constraints **default skip** (assembly IR) |

### 9.3 Host vs `occ_c` placement

| Piece | Suggested home | License |
|-------|----------------|---------|
| Residual solver + sketch graph | Apache module under/next to `api/` | Apache-2.0 |
| Public C header + Wasm exports | `occ_c_sketch.h` + export list discipline | Apache-2.0 |
| Materialize to BREP | call existing construct helpers | Apache-2.0 |
| IR eval `Sketch2D` / `SolveSketch` | AgentOS host and/or open IR runner | BSL if `agent-os/`; Apache if open runner |
| GPL oracle | Outside ship graph | GPLv3 isolated |

**Wasm product note:** a full Newton + sparse stack may fight size limits. Option: solve on **host**, materialize numeric coords into Wasm construct; keep ExplicitCoords on browser path.

**Optional host tool:** AgentOS may call sketch solve via host tools; guest holds shape/entity **IDs** only (`AGENTS.md`).

### 9.4 Explicit non-API

| Reject | Why |
|--------|-----|
| Foreign `*System` / entity / constraint layouts | ABI twinning |
| Foreign `*_E_*` / `*_C_*` numeric IDs | Clone fingerprint |
| Public Jacobian / expression DAG | Internal only |
| Solid group types in sketch header | Use solid `occ_*` |
| `.slvs` round-trip guarantee | Out of scope |

---

## 10. What not to learn / not to port

License firewall: **§1**. Additionally:

1. **Any GPL source text** — copy-paste, transliteration of distinctive control flow, vendoring.  
2. **UI / platform / undo / styles / TTF.**  
3. **Mesh & shell kernel** (`srf/*`, groupmesh) — use OCCT.  
4. **`.slvs` format**, DXF/IDF importers, SS STEP writer.  
5. **Foreign public API names** and numeric type IDs in our headers.  
6. **Handle bit-packing / 16-bit remap limits** — use our id space.  
7. **Conflating session `created_by` with sketch solve batches.**  
8. **Patterns of solids without cut/drill** as “holes.”  
9. **Treating packaging MIT classifiers as a relicense** (root `pyproject.toml`).  
10. **Stage-for-stage twin** of substitution/alone/joint pipeline or copied epsilons as product `#define`s.  
11. **Five-way status enum** in foreign 0..4 order.

**Allowed:** independent reimplementation of standard numerical methods (Gauss–Newton, sparse QR rank, geometric residuals), standard constraint semantics, Eigen or other sparse solvers as **independent** deps, our own tests and IR.

---

## 11. Gaps outside sketch

This document does **not** reopen the solid gap list. See FS cleanroom §6.5–§6.6.

| Area | Status for dual goals |
|------|------------------------|
| Extrude / boolean / pipe / member / hole / pattern / frames / session / STEP / mesh | Largely **done** in `occ_c` |
| **A1 Sketch + solve** | **This report** — invent clean-room; demos do not wait |
| A2 richer construction planes/axes | Separate construct work |
| A3 selector depth | Session/query |
| Assembly mate **solver** / URDF / fittings catalog | IR / AgentOS / host (FS cleanroom) |

**One-liner:** close **A1** with a clean-room 2D parametric sketch layer that **emits into** today’s construct/extrude APIs — not by vendoring SolveSpace and not by turning OCCT into a constraint engine.

---

## 12. Repository mapping + recommended build order

### 12.1 Layer mapping

| Concept | Repository landing |
|---------|-------------------|
| Solids, mesh, STEP, frames, session | `api/` (`occ_c`) — Apache-2.0 |
| Sketch solver + optional `occ_c_sketch` | Apache module (in or beside `api/`) — clean-room only |
| Luau sketch IR / host tools | `agent-os/` — BSL; may call sketch + `occ_c` |
| FS solids pedagogy | `docs/cleanroom-featurescript-std-report.md` |
| This sketch pedagogy | `docs/cleanroom-solvespace-sketch-solve-report.md` |
| SolveSpace tree | Local reference only — **not** a Bazel dep |

### 12.2 Recommended build order (canonical phase tree)

**Two parallel tracks** (do not serialize product demos behind Newton):

```text
Track D — Dual-goal product (today → ongoing)
  D0  Keep //examples smoke_* green on ExplicitCoords + construct
  D1  IR freeze + recipe lowers to existing occ_* (SYSTEM §11)
  D2  Agent/NL → structured dim params → ExplicitCoords rebuild
  D3  When measured: upgrade R1/R2 recipes to SolveSketch driving dims

Track S — Solver / kernel (FS A1; additive)
  Phase 0  Sketch handle + points/lines/circles/arcs + construction
           + build_wires via existing construct helpers
           Exit: scaffolding only — dual-goal value ≈ ExplicitCoords;
                 do not treat as A1 closed

  Phase 1a MVP-A1: Pin + Coincident + H/V + Distance + Diameter
           + solve + status + dof + failed ids
           Exit: constrained rect re-solves on width change (R1);
                 flange OD/ID re-solve (R2) optional same milestone

  Phase 1b Equal length, angle, on-line, midpoint
           Exit: polygon / slot skeletons

  Phase 1c Equal radius, on-circle (planar), arc-line tangent
           Exit: rounded-corner / fillet sketch path
           (arc–arc still ExplicitCoords or Phase 2)

  Phase 2  Soft drag, symmetry, curve–curve tangent, ratios
           Exit: interactive / AgentOS edit polish

  Phase 3  Multi-plane / mate-ish — DEFAULT SKIP
           Assembly stays IR + frames
```

**Priority reconciliation:** FS §6.6 ranks A1 as next *C* eng work; SYSTEM §11 still ranks portable IR + recipe demos above solver depth for *product* sequence. Both are correct on different axes — run Track D and Track S in parallel.

**First parametric recipe order:** R1 (rect plate) → R2 (flange OD/ID) → R3–R5 remain ExplicitCoords unless requested.

### 12.3 Testing strategy

- Hand-authored sketches (JSON/IR) with known analytic solutions.  
- Pure-C examples under Apache — never require GPL.  
- Optional black-box compare to out-of-process `libslvs` on **abstract** cases (numbers only); **separate** CI job/workspace.  
- Do not import SS golden `.slvs` fixtures into Apache trees; do not assert against foreign result codes.

### 12.4 Dual-goal smoke path

| Today (ExplicitCoords — required) | Tomorrow (SolveSketch — additive) |
|-----------------------------------|-------------------------------------|
| `//examples:smoke_flange_bolt_circle` et al. | Same recipes with driving dims on sketch graph |
| `//examples:smoke_pipe_skid`, `smoke_robot_6dof` | Section/profile re-solve where parametric |

---

## 13. Clean-room process checklist

### Team A — readers (complete for this report)

- [x] Study tree available; license identified as GPLv3 or later  
- [x] Entity / constraint inventories abstracted under our names  
- [x] Architecture (params, residuals, stages, DOF) captured  
- [x] Dual-goal prioritization + ExplicitCoords-first law written  
- [x] This report is sufficient without internal working notes  

### Team B — implementers (open)

- [ ] Code only from this report + OCCT + our tests — **no SS sources open**  
- [ ] No foreign solver type names or numeric IDs in product headers  
- [ ] No Bazel dep on SolveSpace for Apache targets; no Wasm co-ship (**§1**)  
- [ ] Residuals from Appendix B geometry (invent algebra; do not copy DAGs)  
- [ ] Solver control flow and constants are **ours** (no stage-for-stage twin; no copied study eps as product `#define`s)  
- [ ] Status codes use original `OCC_SK_*` semantics (**§9.1**), not foreign 0..4 order  
- [ ] Solids only via `occ_c`; shared ProfileWires lower  
- [ ] `Pin` in MVP; PointOnLine net-DOF tests; planar PointOnCircle  
- [ ] Dual-goal CI remains green without SolveSketch  
- [ ] Optional GPL oracle quarantined (separate process/CI)  
- [ ] Wasm export list updated if new `OCC_API` symbols ship  

### Optional Team C — compliance

- [ ] Packaging / similarity review: no `libslvs` adjacency in Apache artifacts  
- [ ] Confirm root-level packaging metadata of study project is not treated as relicense  

---

## 14. Pedagogical walkthroughs

### 14.1 Constrained flange profile (SolveSketch path) — implements **R2** (+ **R3** bolts)

**Goal:** Parametric flange blank: OD, ID, thickness t; bolt circle via R3 (not sketch).

1. **Frame:** sketch on world XY (or face plane): origin at flange center, N = plate normal.  
2. **Entities:** `Point2` C; outer/inner `Circle2` sharing C (or second center + `CoincidentPoints`).  
3. **Constraints (MVP):** `Pin(C)` to origin; `Diameter(outer)=OD`, `Diameter(inner)=ID`.  
4. **SolveSketch** → expect DOF = 0 (circles are rotationally symmetric).  
5. **Harvest:** `ProfileWires { outer, holes: [inner] }` **or** extrude outer + `occ_drill_hole_through` (shipped path).  
6. **Solid:** extrude thickness t.  
7. **Bolts (R3):** polar pattern / drill — **outside** the sketch solver.

**Agent edit:** change OD → re-solve → rebuild solid.

### 14.2 Agent ExplicitCoords path (no solver) — implements **R2** / **R3** today

**Goal:** Same flange when all numbers are known (BOM / datasheet / CI).

1. Outer face: `occ_make_face_circle` radius OD/2.  
2. Extrude to t.  
3. `occ_drill_hole_through` diameter ID.  
4. Loop bolt drills at \(P_k = C + R(\cos\phi_k\,U + \sin\phi_k\,V)\).  
5. Export STEP/mesh as today.

**When to prefer:** codegen, standards tables, CI smoke, first AgentOS demos. Upgrade to §14.1 when driving dimensions and DOF feedback are required.

### 14.3 Constrained rectangle plate — implements **R1** (minimal A1 proof)

1. Four `Point2`, four `LineSeg` (or `Rect2` macro).  
2. H/V on opposite edges; `DistancePoints` = width/height; **`Pin` one corner** (or pin-to-origin recipe).  
3. Solve → UV known → face → extrude.  
4. Change width → solve → regenerate solid only after OK status.

Without a pin (or equivalent), a planar rigid body retains residual DOF (2 translation + rotation). Soft drag does **not** fix this.

---

## 15. Pedagogical summary

| Judgment | Detail |
|----------|--------|
| **What SS teaches** | Separable GCS: params, residuals, optional substitution/alone-solve, weighted LS Gauss–Newton, sparse rank DOF, group freeze, soft drag ≠ hard pin |
| **What we build** | Clean-room Sketch2D / SolveSketch under our names; **MVP-A1 first** (pin + dims + diameter); full P0 after |
| **Ship law** | ExplicitCoords + existing solids = dual-goal demos; SolveSketch = additive kernel completeness |
| **What we never do** | Link/embed/co-ship GPLv3 libslvs; twin foreign ABI/status orders; reimplement SS solids |
| **Shared lower** | Both forks → ProfileWires → `occ_c` |
| **Bolt circles & routes** | Pattern/route APIs **outside** the sketch solver |

**Thesis:** Learn the architecture of parametric sketch solving; invent the implementation under Apache/BSL boundaries; keep solids on OCCT; keep the license firewall absolute (**§1**); keep demos unblocked.

---

## Appendix A — Constraint table (compact)

Normative compact form of §5. Residual geometry: Appendix B.

| Pri | IR name | #eq plane | Extra free | Net DOF Δ | Projectible | Notes |
|-----|---------|----------:|-----------:|----------:|:-----------:|-------|
| MVP | Pin / LockPoint | 2 | 0 | −2 | Y | Hard freeze; kills translation (pair with H/V or second pin for rotation as needed) |
| MVP | CoincidentPoints | 2 | 0 | −2 | Y | Substitution-friendly |
| MVP | DistancePoints | 1 | 0 | −1 | Y | |
| MVP | Horizontal | 1 | 0 | −1 | Y | workplane UV |
| MVP | Vertical | 1 | 0 | −1 | Y | |
| MVP | Diameter | 1 | 0 | −1 | N | curve-native |
| P0 | Parallel | 1 | 0 | −1 | Y | residual ~ length² scale |
| P0 | Perpendicular | 1 | 0 | −1 | Y | no angle gain mult |
| P0 | Angle | 1 | 0 | −1 | Y | optional rank gain near 0°/180° |
| P0 | PointOnLine | 2 | **1** (\(t\)) | **≈ −1** | Y | free \(t\) always allocated |
| P0 | AtMidpoint | 2 | 0 | −2 | Y | |
| P0 | EqualLength | 1 | 0 | −1 | Y | |
| P0 | EqualRadius | 1 | 0 | −1 | N | |
| P0 | PointOnCircle | 1 | 0 | −1 | N | planar radial in v1 |
| P0 | TangentArcLine | 1 | 0 | −1 | N | + coincident for fillets |
| P0 | DistancePointLine | 1 | 0 | −1 | Y | **signed** in plane |
| P1 | LengthRatio / Difference | 1 | 0 | −1 | Y | |
| P1 | Symmetric* | 2 | 0 | −2 | Y | line / H / V |
| P1 | EqualAngle | 1 | 0 | −1 | Y | |
| P1 | TangentCurveCurve | 1 | 0 | −1 | Y | arc–arc |
| P1 | PointOnPlane etc. | 1+ | mix | mix | mix | prefer assembly IR |
| P2 | Arc length family | 1 | mix | mix | mix | niche |
| — | Comment | 0 | — | — | — | never solver |

---

## Appendix B — Residual cheat sheet (P0 / MVP)

All residuals are \(F = 0\). Workplane set ⇒ use UV unless noted. **Invent algebra; do not copy expression DAGs from study sources.**

| IR | Residual sketch |
|----|-----------------|
| Pin / LockPoint | \(u - u_0 = 0\), \(v - v_0 = 0\) (frozen at equation build) |
| CoincidentPoints | \(u_A-u_B=0\), \(v_A-v_B=0\) |
| DistancePoints | \(\sqrt{(u_A-u_B)^2+(v_A-v_B)^2} - d = 0\) |
| Horizontal | \(v_A - v_B = 0\) |
| Vertical | \(u_A - u_B = 0\) |
| Parallel | \(a_u b_v - a_v b_u = 0\) (optional: normalize directions if scales stress tol) |
| Perpendicular | \(\widehat{a}\cdot\widehat{b} = 0\) |
| Angle | \(\mathrm{mult}\cdot(\widehat{a}\cdot\widehat{b} - \cos\theta) = 0\); \(\theta\) from degrees→radians; `other` sense may negate one direction; mult is optional rank stabilizer near \(|\cos\theta|\approx 1\), not a geometry change |
| PointOnLine | \(A + t(B-A) - P = 0\) (2 comps **+ free \(t\)** ⇒ net ~1 DOF removed) |
| AtMidpoint | \(P = (A+B)/2\) (2 comps) |
| EqualLength | \(\mathrm{len}_A - \mathrm{len}_B = 0\) |
| Diameter | \(2r - d = 0\) |
| EqualRadius | \(r_1 - r_2 = 0\) |
| PointOnCircle (v1 planar) | \(\sqrt{(u-u_c)^2+(v-v_c)^2} - r = 0\); study 3D semantics are cylindrical (axial free) — defer |
| TangentArcLine | \(\mathrm{dir}_{line}\cdot(C-E) = 0\) at chosen end E |
| DistancePointLine | signed 2D point–line distance \(- d = 0\) (P0 in-plane signed only) |

**Solver policy (abstract):** optional structural substitution of pure PARAM−PARAM identities (keep dragged reps); soft column weights for drag; joint Gauss–Newton as in §3.5; DOF \(= n - \mathrm{rank}(J)\) **after** alone-solve reduction; residual tol tighter than geometric merge eps — **our** numbers.

---

## Appendix C — Source anchors for readers only

**If you are writing product code, stop.** Do not use this table as a study checklist or “clarify residuals” list. Residual *geometry* is in Appendix B; invent algebra there. Readers only — path:concept, **no large GPL quotes.**

| Topic | Path (under SolveSpace tree) |
|-------|------------------------------|
| License | `COPYING.txt`, README, CONTRIBUTING |
| Public C API (study contract) | `include/slvs.h`, `exposed/DOC.txt` |
| Entity / group / constraint types | `src/sketch.h` |
| Entity eval / implicit eqs | `src/entity.cpp` |
| Constraint residuals | `src/constrainteq.cpp` |
| Expression / param | `src/expr.*`, `src/param.h` |
| System solve / Newton / rank / substitution | `src/system.cpp` |
| Group generate / patterns | `src/group.cpp`, `src/generate.cpp` |
| libslvs wrapper | `src/slvs/lib.cpp` |
| Epsilons | `src/defs.h` |

---

## Appendix D — Reader notes (non-normative)

Internal working drafts under `docs/` with underscore prefixes are **not** part of the implementer contract and may be deleted. This published report is self-contained for Team B.

**Related:** [FS cleanroom](cleanroom-featurescript-std-report.md) — solids, host ops, dual-goal matrix, §6.6 A1 gap id. [SYSTEM.md](../SYSTEM.md) — dual goals, prioritization law, medium-term demos without sketch solver.

---

*End of clean-room sketch/solve report. Architecture documentation only; no SolveSpace source is product code. Implementers must not open GPL solver sources while coding.*
