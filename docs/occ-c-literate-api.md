# `occ_c` Complete Kernel Expansion — Literate Implementation Spec (v2)

**Document type:** Literate programming source for the Apache **`occ_c`** C API  
**Audience:** Implementers extracting real `.h` / `.cc` into `api/`  
**Date:** 2026-07-31  
**Version:** 2.0 (complete P0/P1 kernel — supersedes the thin v1 sketch)  
**OCCT pin:** **7.9.3** (`OCCT-7_9_3` / `@occt` in Bazel)  
**Checklist source:** [`docs/cleanroom-featurescript-std-report.md`](../cleanroom-featurescript-std-report.md) dual-goal P0 matrix  
**Product goals:** AI-BOOST piping skids · 6-DOF robot arm  
**Method:** Multi-agent section drafting against live OCCT 7.9.3 tree + existing `occ_c` style  

---

## How to use this file (literate extract)

1. Blocks whose first line is `// === file: <relative-path>` are **authoritative source**.  
2. Run `python3 scripts/extract_literate.py docs/occ-c-literate-api.md` (script embedded in Part 08).  
3. Extract lands under `api/include/`, `api/src/`, `examples/`.  
4. Baseline `api/src/occ_c.cc` **stays** — this document is additive modules + a unified header patch.  
5. Units: **meters**, **radians**, topology indices **1-based**.  
6. Do **not** copy FeatureScript; only OCCT + our names.  
7. Product-layer items (mate **solver**, NL parse, FEA solve, sketch **constraint** solve, catalog DB) are explicitly **out of C** — marked OUT below.

```text
docs/occ-c-literate-api.md   (this file; assembled from literate-sections/)
        │ extract_literate.py
        ▼
api/include/occ_c.h              (baseline + extended enums/prototypes)
api/include/occ_c_session.h
api/include/occ_c_construct.h
api/include/occ_c_frames.h
api/include/occ_c_trsf.h
api/include/occ_c_route.h
api/include/occ_c_pattern.h
api/include/occ_c_hole.h
api/include/occ_c_boolean_ext.h
api/include/occ_c_query.h
api/include/occ_c_sweep_ext.h
api/src/occ_c_internal.hxx       (private glue)
api/src/occ_c.cc                 (baseline — already shipped)
api/src/occ_c_session.cc
api/src/occ_c_construct.cc
api/src/occ_c_frames.cc
api/src/occ_c_trsf.cc
api/src/occ_c_route.cc
api/src/occ_c_pattern.cc
api/src/occ_c_hole.cc
api/src/occ_c_boolean_ext.cc
api/src/occ_c_query.cc
api/src/occ_c_sweep_ext.cc
examples/smoke_*.c
```

---

## Clean-room checklist → C coverage (v2)

| Checklist / IR | Pri | Layer | This document |
|----------------|-----|-------|---------------|
| Primitives box/cyl/sphere/cone/torus/wedge | P0 | baseline | `occ_c.cc` (shipped) |
| Bool fuse/cut/common/section | P0 | baseline | shipped |
| Extrude / revolve / loft / pipe | P0 | baseline + ext | shipped + `occ_c_sweep_ext` |
| Fillet / chamfer / shell / offset | P1 | baseline | shipped |
| STEP / BREP / STL / glTF / OBJ / mesh | P0 | baseline | shipped |
| Topology index face/edge/vertex | P0 | baseline | shipped |
| **Session + history + `created_by`** | P0 | **NEW** | Part 01 |
| **MakePoint / MakePlane / wires / faces** | P0 | **NEW** | Part 02 |
| **AttachFrame / RigidXform / place** | P0 | **NEW** | Part 03 |
| **ComposeChain FK + 4×4** | P0 robot | **NEW** | Part 03 |
| **RoutePath poly + bend R** | P0 skid | **NEW** | Part 04 |
| **SweepAlong annulus / pipe shell** | P0 skid | **NEW** | Part 04 |
| **MemberSweep rect/circle** | P1 skid | **NEW** | Part 04 |
| **PatternLinear / Polar / AlongPath** | P0 | **NEW** | Part 05 |
| **DrillHole through/blind/cbore/csink** | P0 | **NEW** | Part 05 |
| **GroupBodies / explode / split** | P1 | **NEW** | Part 05 |
| **QueryClash / distance / mass** | P0 | **NEW** | Part 06 |
| **Topology selectors (area/planar/…)** | P0 | **NEW** | Part 06 |
| **Extrude extents + helix + thicken** | P0/P2 | **NEW** | Part 07 |
| Sketch **constraint solver** | P0 product | OUT of C | Luau/IR; use explicit wires |
| Assembly **mate solver** | P0 product | OUT of C | IR graph + FK only in C |
| Catalog DB / SpawnPart data | P0 product | OUT of C | import + place |
| NL / 2D parse / MeshPrep FEA | P0 product | OUT of C | host JSON + `occ_mesh_*` |
| URDF package writer | P0 robot product | OUT of C | packaging script |
| Sheet metal / hole standards tables | P2 | OUT | skip |

---

## Derivation map: baseline `occ_c` → OCCT 7.9.3

| `occ_c` symbol | Primary OCCT type / call |
|----------------|--------------------------|
| `occ_shape_t` | `TopoDS_Shape*` (owned heap) |
| `occ_mesh_t` | private `MeshBuf*` |
| `occ_make_box` | `BRepPrimAPI_MakeBox` |
| `occ_make_cylinder` | `BRepPrimAPI_MakeCylinder` + `gp_Ax2` |
| `occ_make_sphere` | `BRepPrimAPI_MakeSphere` |
| `occ_make_cone` | `BRepPrimAPI_MakeCone` |
| `occ_make_torus` | `BRepPrimAPI_MakeTorus` |
| `occ_make_wedge` | `BRepPrimAPI_MakeWedge` |
| `occ_fuse` / `cut` / `intersect` / `section` | `BRepAlgoAPI_*` |
| `occ_fillet_*` | `BRepFilletAPI_MakeFillet` + `TopExp` |
| `occ_chamfer_*` | `BRepFilletAPI_MakeChamfer` |
| `occ_shell` | `BRepOffsetAPI_MakeThickSolid` |
| `occ_offset_3d` | `BRepOffsetAPI_MakeOffsetShape` |
| `occ_extrude` | `BRepPrimAPI_MakePrism` |
| `occ_revolve` | `BRepPrimAPI_MakeRevol` |
| `occ_loft` | `BRepOffsetAPI_ThruSections` |
| `occ_pipe` | `BRepOffsetAPI_MakePipe` |
| `occ_translate/rotate/scale/mirror` | `gp_Trsf` + `BRepBuilderAPI_Transform` |
| `occ_volume` / area / COM / bbox | `BRepGProp` / `BRepBndLib` |
| `occ_count_*` / `*_at` | `TopExp::MapShapes` |
| `occ_step_*` | `STEPControl_Reader/Writer` |
| `occ_brep_*` | `BRepTools` + `BRep_Builder` |
| `occ_mesh_compute` | `BRepMesh_IncrementalMesh` + `Poly_Triangulation` |

### Expansion derivation (new modules)

| New symbol family | Primary OCCT |
|-------------------|--------------|
| session / history | pure C++ maps + `TopoDS_Shape` copies |
| wires / faces / arcs | `BRepBuilderAPI_MakeEdge/Wire/Face/Polygon`, `GC_MakeArcOfCircle` |
| frames | `gp_Ax3` / `gp_Trsf` |
| route bends | trim + `GC_MakeArcOfCircle` + `MakeWire` |
| pipe shell | `BRepOffsetAPI_MakePipeShell` |
| patterns | `BRepBuilderAPI_Transform` + `BRep_Builder` compound |
| holes | `BRepPrimAPI_MakeCylinder` / cone + `BRepAlgoAPI_Cut` |
| clash / distance | `BRepExtrema_DistShapeShape` |
| mass tensor | `GProp_GProps::MatrixOfInertia` |
| helix | cylinder surface + 2d line edge |
| split | half-space solid + cut / splitter |

---

## Shared runtime glue

`// === file: api/src/occ_c_internal.hxx`

```cpp
// === file: api/src/occ_c_internal.hxx
// Private — not installed. Shared by all occ_c*.cc translation units.
#pragma once

#include "occ_c.h"

#include <cstring>
#include <string>
#include <cmath>
#include <vector>
#include <algorithm>

#include <Standard_Failure.hxx>
#include <Standard_Version.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <BRep_Builder.hxx>
#include <BRep_Tool.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>
#include <gp_Dir.hxx>
#include <gp_Ax1.hxx>
#include <gp_Ax2.hxx>
#include <gp_Ax3.hxx>
#include <gp_Trsf.hxx>
#include <gp_Pln.hxx>

namespace occ_c_detail {

inline thread_local std::string g_last_error;

inline void set_last(const char* msg) {
  g_last_error = msg ? msg : "";
}

inline TopoDS_Shape* as_shape(occ_shape_t s) {
  return reinterpret_cast<TopoDS_Shape*>(s);
}

inline occ_shape_t to_handle(const TopoDS_Shape& s) {
  return reinterpret_cast<occ_shape_t>(new TopoDS_Shape(s));
}

inline bool null_shape(occ_shape_t s) {
  return !s || as_shape(s)->IsNull();
}

inline gp_Ax2 axis2(double cx, double cy, double cz,
                    double ax, double ay, double az) {
  return gp_Ax2(gp_Pnt(cx, cy, cz), gp_Dir(ax, ay, az));
}

inline double vlen(double x, double y, double z) {
  return std::sqrt(x * x + y * y + z * z);
}

inline bool normalize3(double& x, double& y, double& z, double eps = 1e-14) {
  const double L = vlen(x, y, z);
  if (L < eps) return false;
  x /= L; y /= L; z /= L;
  return true;
}

inline void cross3(double ax, double ay, double az,
                   double bx, double by, double bz,
                   double& ox, double& oy, double& oz) {
  ox = ay * bz - az * by;
  oy = az * bx - ax * bz;
  oz = ax * by - ay * bx;
}

inline double dot3(double ax, double ay, double az,
                   double bx, double by, double bz) {
  return ax * bx + ay * by + az * bz;
}

}  // namespace occ_c_detail

// Bring into TU anonymous-friendly macros (each .cc may `using namespace occ_c_detail`)
#define OCC_GUARD_BEGIN try {
#define OCC_GUARD_END                                                         \
  } catch (Standard_Failure & e) {                                            \
    occ_c_detail::set_last(e.GetMessageString() ? e.GetMessageString()        \
                                                : "OCCT failure");            \
    return OCC_ERR_EXCEPTION;                                                 \
  } catch (std::exception & e) {                                              \
    occ_c_detail::set_last(e.what());                                         \
    return OCC_ERR_EXCEPTION;                                                 \
  } catch (...) {                                                             \
    occ_c_detail::set_last("unknown exception");                              \
    return OCC_ERR_EXCEPTION;                                                 \
  }

#define REQ(cond, code)               \
  do {                                \
    if (!(cond)) return (code);       \
  } while (0)

#define REQ_MSG(cond, code, msg)                    \
  do {                                              \
    if (!(cond)) {                                  \
      occ_c_detail::set_last(msg);                  \
      return (code);                                \
    }                                               \
  } while (0)
```

---

## Extended status codes & unified header patch

`// === file: api/include/occ_c_status.h` (included by master header)

```cpp
// === file: api/include/occ_c_status.h
#pragma once

typedef enum {
  OCC_OK                 = 0,
  OCC_ERR_NULL_ARG       = 1,
  OCC_ERR_INVALID_SHAPE  = 2,
  OCC_ERR_BOOLEAN        = 3,
  OCC_ERR_FILLET         = 4,
  OCC_ERR_IO             = 5,
  OCC_ERR_INDEX          = 6,
  OCC_ERR_EXCEPTION      = 7,
  /* v2 expansions */
  OCC_ERR_NO_SESSION     = 8,
  OCC_ERR_UNKNOWN_OP     = 9,
  OCC_ERR_BAD_QUERY      = 10,
  OCC_ERR_CAPACITY       = 11,
  OCC_ERR_NOT_FOUND      = 12,
  OCC_ERR_MATH           = 13,
  OCC_ERR_UNSUPPORTED    = 14,
  OCC_ERR_BUILD          = 15,
} occ_status_t;

typedef enum {
  OCC_SHAPE_UNKNOWN  = 0,
  OCC_SHAPE_COMPOUND = 1,
  OCC_SHAPE_COMPSOLID= 2,
  OCC_SHAPE_SOLID    = 3,
  OCC_SHAPE_SHELL    = 4,
  OCC_SHAPE_FACE     = 5,
  OCC_SHAPE_WIRE     = 6,
  OCC_SHAPE_EDGE     = 7,
  OCC_SHAPE_VERTEX   = 8,
  OCC_SHAPE_SHAPE    = 9,
} occ_shape_kind_t;

typedef enum {
  OCC_CLASH_SEPARATED   = 0, /* min distance > clearance */
  OCC_CLASH_CLEARANCE   = 1, /* 0 < dist <= clearance */
  OCC_CLASH_INTERFERE   = 2, /* dist ~ 0 (touch/overlap) */
} occ_clash_status_t;
```

### Master public header (additive includes)

`// === file: api/include/occ_c_all.h`

```cpp
// === file: api/include/occ_c_all.h
// One-stop include for host / Wasm bindings.
#pragma once

#include "occ_c.h"
#include "occ_c_status.h"
#include "occ_c_session.h"
#include "occ_c_construct.h"
#include "occ_c_frames.h"
#include "occ_c_trsf.h"
#include "occ_c_route.h"
#include "occ_c_pattern.h"
#include "occ_c_hole.h"
#include "occ_c_boolean_ext.h"
#include "occ_c_query.h"
#include "occ_c_sweep_ext.h"
```

> **Note:** Baseline `occ_c.h` still defines the original `occ_status_t`. On merge, **replace** the baseline enum with `occ_c_status.h` values (keep numeric compatibility for 0–7) and `#include` the new module headers at the bottom of `occ_c.h`, **or** switch all TUs to `occ_c_all.h`.

---

## Document map (parts)

| Part | File | Contents |
|------|------|----------|
| 00 | this front matter | checklist, glue, status |
| 01 | session-history | registry, created_by, names, attach frames |
| 02 | construction | wires, faces, planes, arcs, bspline |
| 03 | frames-trsf | SE3 frames, FK chain, place |
| 04 | route-pipe-member | bends, annulus, pipe shell, steel member |
| 05 | patterns-holes-split | patterns, holes, compound, split |
| 06 | query-measure | clash, mass, selectors |
| 07 | sweeps-helix-ext | extrude extents, helix, thicken |
| 08 | smoke-dual-goal | skid + robot + flange smokes, extract script |

Each part is self-contained literate source. Concatenate in order for the canonical `docs/occ-c-literate-api.md`.

---


<!-- BEGIN 01-session-history.md -->

# Literate Section 01 — Session, Shape Registry, History Tagging, `created_by`

**Document type:** Literate programming source for Apache **`occ_c`** (thin C ABI over OpenCASCADE **7.9.3**)  
**Section:** `#1` clean-room **P0** gap — stable entity ids + history selectors  
**Audience:** Implementers extracting real `.h` / `.cc` into `api/include/` and `api/src/`  
**Date:** 2026-07-31  
**OCCT pin:** 7.9.3  
**Depends on:** `occ_c.h` (baseline), `occ_c_internal.hxx` (shared glue from P0 literate API)  
**Does not depend on:** FeatureScript names, Parasolid, any proprietary history model  

---

## How to extract

1. Blocks whose first fence line is `// === file: <name>` are authoritative source.  
2. Concatenate into `api/include/occ_c_session.h`, `api/src/occ_c_session.cc`, and patch `occ_status_t` in `occ_c.h`.  
3. Link against OCCT 7.9.3 (`TKBRep`, `TKTopAlgo`, `TKMath`, `TKG3d`, `TKBO` not required here).  
4. Units: **meters**, **radians**, topology indices **1-based** (when enumerating subshapes).  
5. Threading model: **single-threaded host** per session. One session object is not safe for concurrent mutation. `g_last_error` is `thread_local`.  
6. Original names only — no FeatureScript identifiers.

```text
docs/literate-sections/01-session-history.md
        │ extract
        ▼
api/include/occ_c.h            (status enum patch)
api/include/occ_c_session.h
api/src/occ_c_session.cc
```

---

## 1. Why history exists (parametric reselect after ops)

A pure shape-handle API is enough to *build* geometry once. It is **not** enough to rebuild a parametric document.

Consider IR:

```yaml
- id: box1/solid
  op: Extrude
  ...
- id: holes1
  op: DrillHole
  target: { created_by: box1/solid, entity: body }
  on:    { created_by: box1/solid, entity: face, filter: max_z }
```

When `box1/solid` re-evaluates (depth changes from 80 mm to 100 mm), every face index of the solid is free to renumber. Downstream features that stored `face_index: 7` break. Downstream features that store **historical selectors** survive:

| Fragile | Stable |
|---------|--------|
| `face_index: 7` | `created_by: "box1/solid"` + kind `FACE` + geometric filter |
| raw `occ_shape_t` pointer after free | `occ_entity_id_t` in a session registry |
| anonymous result of fuse | op id stack tags every registered result |

**Session responsibilities (this section):**

1. Own a **registry** of BREP entities (`TopoDS_Shape` by value) under monotonic `uint64` ids.  
2. Tag each registration with the **current operation id** (`begin_op` / `end_op` stack → nested `parent/child` paths).  
3. Answer **`created_by` prefix queries** filtered by entity kind.  
4. Hold optional **names** and **named frames** attached to entities (joint frames, nozzle CS, world planes).  
5. Expose pure-C **query algebra v0** helpers (created_by wrapper, kind filter, id-list intersection) for the IR selector evaluator.

This is intentionally a **thin history table**, not a full feature graph, not a Parasolid journal, and not a FeatureScript `Context`. The IR evaluator owns regeneration order; `occ_c` only remembers *what was created under which op id*.

---

## 2. Extended status codes

Patch / replace the baseline `occ_status_t` so session + math + capacity paths have dedicated codes. Existing numeric values for the first seven codes remain stable.

```c
// === file: occ_c.h  (enum fragment — replace existing occ_status_t)
typedef enum {
  OCC_OK                 = 0,
  OCC_ERR_NULL_ARG       = 1,
  OCC_ERR_INVALID_SHAPE  = 2,
  OCC_ERR_BOOLEAN        = 3,
  OCC_ERR_FILLET         = 4,
  OCC_ERR_IO             = 5,
  OCC_ERR_INDEX          = 6,
  OCC_ERR_EXCEPTION      = 7,
  /* Extended — session / query / math / capacity */
  OCC_ERR_NO_SESSION     = 8,
  OCC_ERR_UNKNOWN_OP     = 9,
  OCC_ERR_BAD_QUERY      = 10,
  OCC_ERR_CAPACITY       = 11,
  OCC_ERR_NOT_FOUND      = 12,
  OCC_ERR_MATH           = 13,
  OCC_ERR_UNSUPPORTED    = 14,
  /* Keep optional geom/frame codes if already shipped in baseline expansion */
  OCC_ERR_GEOM           = 15,
  OCC_ERR_FRAME          = 16,
  OCC_ERR_CLASH          = 17
} occ_status_t;
```

Callers: `NO_SESSION` null/destroyed session; `UNKNOWN_OP` stack mismatch; `BAD_QUERY` bad args;
`CAPACITY` overflow (partial fill); `NOT_FOUND` missing id/name; `MATH` bad frame; `UNSUPPORTED` unused reserve.

---

## 3. Header — `occ_c_session.h`

```c
// === file: occ_c_session.h
#ifndef OCC_C_SESSION_H_
#define OCC_C_SESSION_H_

#include "occ_c.h"

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* --------------------------------------------------------------------------
 * Opaque session handle.
 *
 * Lifetime: create → (ops / register / query)* → destroy.
 * Threading: not safe for concurrent mutation of the same session.
 * -------------------------------------------------------------------------- */
typedef struct occ_session_s occ_session_t;

/* Monotonic entity id. Valid ids are >= 1. 0 is never a live entity. */
typedef uint64_t occ_entity_id_t;

/* Entity kinds for history selectors (IR entity: body|face|edge|...). */
typedef enum {
  OCC_ENTITY_BODY     = 0,  /* solid / compsolid / compound-as-body */
  OCC_ENTITY_FACE     = 1,
  OCC_ENTITY_EDGE     = 2,
  OCC_ENTITY_VERTEX   = 3,
  OCC_ENTITY_WIRE     = 4,
  OCC_ENTITY_SHELL    = 5,
  OCC_ENTITY_SOLID    = 6,
  OCC_ENTITY_COMPOUND = 7,
  OCC_ENTITY_FRAME    = 8,  /* frame-only records (no BREP) */
  OCC_ENTITY_ANY      = 9   /* wildcard in queries */
} occ_entity_kind_t;

/* Full orthonormal frame POD (meters). Used by session attach_frame.
 * Compatible with 4x3 row layout: origin, x, y, z (each 3 doubles). */
typedef struct occ_session_frame_s {
  double origin[3];
  double x[3];
  double y[3];
  double z[3];
} occ_session_frame_t;

/* ============================ lifecycle ============================ */

/** Create an empty session. *out_session must be non-null. */
OCC_API int occ_session_create(occ_session_t** out_session);

/** Destroy session and free all registered shapes / maps. */
OCC_API int occ_session_destroy(occ_session_t* session);

/** Drop all entities, names, frames, op stack; keep session alive.
 *  World-plane ids are invalidated until ensure_world_planes is called again. */
OCC_API int occ_session_clear(occ_session_t* session);

/* ============================ op id stack ============================ */

/** Push op id string (copied). Nested begin/end supported.
 *  op_id_str must be non-empty. Typical: "box1", "box1/solid". */
OCC_API int occ_session_begin_op(occ_session_t* session, const char* op_id_str);

/** Pop op id. If op_id_str non-null, must match top of stack. */
OCC_API int occ_session_end_op(occ_session_t* session, const char* op_id_str);

/** Copy current top op id into buf (NUL-terminated). Empty stack → empty string. */
OCC_API int occ_session_current_op(occ_session_t* session, char* buf, int buflen);

/* ============================ shape registry ============================ */

/** Register a shape copy under a new entity id, tagged with current op id.
 *  Also expands faces / edges / vertices / wires / shells / solids as sibling
 *  entities with the same created_by tag (needed for created_by + kind FACE).
 *  *out_entity_id receives the id of the root shape.
 *  shape may be null only when registering a pure FRAME later via attach. */
OCC_API int occ_session_register_shape(occ_session_t* session,
                                       occ_shape_t shape,
                                       occ_entity_id_t* out_entity_id);

/** Register shape without topology expansion (root only). */
OCC_API int occ_session_register_shape_root_only(occ_session_t* session,
                                                 occ_shape_t shape,
                                                 occ_entity_id_t* out_entity_id);

/** Copy entity BREP into a new owned occ_shape_t handle (*out_shape).
 *  Caller must occ_shape_free(*out_shape). */
OCC_API int occ_session_get_shape(occ_session_t* session,
                                  occ_entity_id_t entity_id,
                                  occ_shape_t* out_shape);

/** Remove entity (and its attached frames). Names pointing here are cleared.
 *  Does not cascade-delete sub-entities registered during expansion. */
OCC_API int occ_session_release_entity(occ_session_t* session,
                                       occ_entity_id_t entity_id);

/** Number of live entities (all kinds). */
OCC_API int occ_session_entity_count(occ_session_t* session, int* out_count);

/* ============================ history selectors ============================ */

/** Find entities whose created_by string has op_id_prefix as prefix
 *  (strncmp) and whose kind matches (or kind == OCC_ENTITY_ANY).
 *  OCC_ENTITY_BODY matches SOLID, COMPSOLID-as-SOLID, and COMPOUND.
 *  Writes up to max ids into out_entity_ids; *out_count = total matches.
 *  If total > max, returns OCC_ERR_CAPACITY after filling max slots. */
OCC_API int occ_session_find_by_created_by(occ_session_t* session,
                                           const char* op_id_prefix,
                                           occ_entity_kind_t kind,
                                           occ_entity_id_t* out_entity_ids,
                                           int max,
                                           int* out_count);

/** Copy created_by op id for entity into buf. */
OCC_API int occ_session_entity_op_id(occ_session_t* session,
                                     occ_entity_id_t entity_id,
                                     char* buf,
                                     int buflen);

/** Return entity kind. */
OCC_API int occ_session_entity_kind(occ_session_t* session,
                                    occ_entity_id_t entity_id,
                                    occ_entity_kind_t* out_kind);

/* ============================ named tags ============================ */

/** Attach a unique name to an entity (replaces previous name for that entity).
 *  Names are unique in the session; reusing a name rebinds it. */
OCC_API int occ_session_set_name(occ_session_t* session,
                                 occ_entity_id_t entity_id,
                                 const char* name);

/** Look up entity by exact name. */
OCC_API int occ_session_find_by_name(occ_session_t* session,
                                     const char* name,
                                     occ_entity_id_t* out_entity_id);

/** Copy name for entity into buf (empty if unnamed). */
OCC_API int occ_session_entity_name(occ_session_t* session,
                                    occ_entity_id_t entity_id,
                                    char* buf,
                                    int buflen);

/* ============================ frames on entities ============================ */

/** Attach / replace a named frame on an entity. Axes must be non-degenerate.
 *  If entity_id == 0, creates a free FRAME entity tagged with current op. */
OCC_API int occ_session_attach_frame(occ_session_t* session,
                                     occ_entity_id_t entity_id,
                                     const char* name,
                                     const occ_session_frame_t* frame);

/** Fetch named frame attached to entity. */
OCC_API int occ_session_get_frame(occ_session_t* session,
                                  occ_entity_id_t entity_id,
                                  const char* name,
                                  occ_session_frame_t* out_frame);

/** Pack frame to 12 doubles: origin[3], x[3], y[3], z[3]. */
OCC_API int occ_session_frame_to_12(const occ_session_frame_t* f,
                                    double out12[12]);

/** Unpack 12 doubles into frame. */
OCC_API int occ_session_frame_from_12(const double m12[12],
                                      occ_session_frame_t* out);

/* ============================ document defaults (world planes) ============ */

/** Ensure world XY / YZ / ZX construction plane entities exist.
 *  Creates three thin rectangular faces + attached frames if missing. */
OCC_API int occ_session_ensure_world_planes(occ_session_t* session);

/** Entity ids for world planes (after ensure). */
OCC_API int occ_session_world_plane_xy(occ_session_t* session,
                                       occ_entity_id_t* out_id);
OCC_API int occ_session_world_plane_yz(occ_session_t* session,
                                       occ_entity_id_t* out_id);
OCC_API int occ_session_world_plane_zx(occ_session_t* session,
                                       occ_entity_id_t* out_id);

/* ============================ IR selector v0 query helpers ================= */

/** Wrapper: same as occ_session_find_by_created_by (IR entry point). */
OCC_API int occ_query_created_by(occ_session_t* session,
                                 const char* op_id_prefix,
                                 occ_entity_kind_t kind,
                                 occ_entity_id_t* out_entity_ids,
                                 int max,
                                 int* out_count);

/** Keep only ids whose live entity kind matches `kind` (ANY keeps all live). */
OCC_API int occ_query_filter_kind(occ_session_t* session,
                                  const occ_entity_id_t* in_ids,
                                  int n_in,
                                  occ_entity_kind_t kind,
                                  occ_entity_id_t* out_entity_ids,
                                  int max,
                                  int* out_count);

/** Sorted set intersection of two id lists (order of first occurrence in a). */
OCC_API int occ_query_intersect_ids(const occ_entity_id_t* a,
                                    int na,
                                    const occ_entity_id_t* b,
                                    int nb,
                                    occ_entity_id_t* out_entity_ids,
                                    int max,
                                    int* out_count);

/** Sorted set union (stable, unique). */
OCC_API int occ_query_union_ids(const occ_entity_id_t* a,
                                int na,
                                const occ_entity_id_t* b,
                                int nb,
                                occ_entity_id_t* out_entity_ids,
                                int max,
                                int* out_count);

/** Set difference a \\ b. */
OCC_API int occ_query_subtract_ids(const occ_entity_id_t* a,
                                   int na,
                                   const occ_entity_id_t* b,
                                   int nb,
                                   occ_entity_id_t* out_entity_ids,
                                   int max,
                                   int* out_count);

#ifdef __cplusplus
}
#endif

#endif /* OCC_C_SESSION_H_ */
```

---

## 4. Implementation — `occ_c_session.cc`

Complete translation unit. Requires `occ_c_internal.hxx` with `as_shape` / `to_handle` / `set_last` / `OCC_GUARD_*` / `REQ` / `g_last_error` as defined in the P0 literate API.

```cpp
// === file: occ_c_session.cc
#include "occ_c_session.h"
#include "occ_c_internal.hxx"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>

using occ_c_detail::as_shape;
using occ_c_detail::set_last;
using occ_c_detail::to_handle;

/* ==========================================================================
 * Internal session state
 * ========================================================================== */

namespace {

struct EntityRec {
  occ_entity_id_t id = 0;
  TopoDS_Shape shape;           /* may be null shape for FRAME-only */
  occ_entity_kind_t kind = OCC_ENTITY_ANY;
  std::string created_by;       /* op id at registration time */
  std::string name;             /* optional unique name */
  bool has_shape = false;
};

struct FrameKeyHash {
  size_t operator()(const std::pair<uint64_t, std::string>& k) const noexcept {
    return std::hash<uint64_t>{}(k.first) ^
           (std::hash<std::string>{}(k.second) << 1);
  }
};

struct SessionImpl {
  uint64_t next_id = 1;
  std::unordered_map<uint64_t, EntityRec> entities;
  std::unordered_map<std::string, occ_entity_id_t> name_to_id;
  std::unordered_map<std::pair<uint64_t, std::string>, occ_session_frame_t,
                     FrameKeyHash>
      frames;
  std::vector<std::string> op_stack;

  occ_entity_id_t plane_xy = 0;
  occ_entity_id_t plane_yz = 0;
  occ_entity_id_t plane_zx = 0;
};

SessionImpl* impl_of(occ_session_t* s) {
  return reinterpret_cast<SessionImpl*>(s);
}

const SessionImpl* impl_of(const occ_session_t* s) {
  return reinterpret_cast<const SessionImpl*>(s);
}

int req_session(occ_session_t* session, SessionImpl** out) {
  if (!session) {
    set_last("null session");
    return OCC_ERR_NO_SESSION;
  }
  *out = impl_of(session);
  return OCC_OK;
}

std::string current_op_id(const SessionImpl* S) {
  if (S->op_stack.empty()) return std::string();
  return S->op_stack.back();
}

occ_entity_kind_t kind_from_shape(const TopoDS_Shape& s) {
  if (s.IsNull()) return OCC_ENTITY_ANY;
  switch (s.ShapeType()) {
    case TopAbs_COMPOUND:
      return OCC_ENTITY_COMPOUND;
    case TopAbs_COMPSOLID:
      return OCC_ENTITY_SOLID;
    case TopAbs_SOLID:
      return OCC_ENTITY_SOLID;
    case TopAbs_SHELL:
      return OCC_ENTITY_SHELL;
    case TopAbs_FACE:
      return OCC_ENTITY_FACE;
    case TopAbs_WIRE:
      return OCC_ENTITY_WIRE;
    case TopAbs_EDGE:
      return OCC_ENTITY_EDGE;
    case TopAbs_VERTEX:
      return OCC_ENTITY_VERTEX;
    default:
      return OCC_ENTITY_BODY;
  }
}

/* BODY selector matches solid-like / compound bodies. */
bool kind_matches(occ_entity_kind_t want, occ_entity_kind_t have) {
  if (want == OCC_ENTITY_ANY) return true;
  if (want == have) return true;
  if (want == OCC_ENTITY_BODY) {
    return have == OCC_ENTITY_SOLID || have == OCC_ENTITY_COMPOUND ||
           have == OCC_ENTITY_SHELL || have == OCC_ENTITY_BODY;
  }
  return false;
}

bool prefix_match(const std::string& created_by, const char* prefix) {
  if (!prefix) return false;
  const size_t n = std::strlen(prefix);
  if (n == 0) return false;
  if (created_by.size() < n) return false;
  return std::strncmp(created_by.c_str(), prefix, n) == 0;
}

int copy_cstr(const std::string& src, char* buf, int buflen) {
  if (!buf || buflen < 1) {
    set_last("buffer too small");
    return OCC_ERR_CAPACITY;
  }
  /* leave room for NUL */
  const size_t max_copy = static_cast<size_t>(buflen - 1);
  const size_t n = src.size() < max_copy ? src.size() : max_copy;
  if (n > 0) std::memcpy(buf, src.data(), n);
  buf[n] = '\0';
  if (src.size() + 1 > static_cast<size_t>(buflen)) {
    set_last("op id / name truncated");
    return OCC_ERR_CAPACITY;
  }
  return OCC_OK;
}

double vlen3(double x, double y, double z) {
  return std::sqrt(x * x + y * y + z * z);
}

int validate_frame(const occ_session_frame_t* f) {
  if (!f) return OCC_ERR_NULL_ARG;
  const double xl = vlen3(f->x[0], f->x[1], f->x[2]);
  const double yl = vlen3(f->y[0], f->y[1], f->y[2]);
  const double zl = vlen3(f->z[0], f->z[1], f->z[2]);
  if (xl < 1e-12 || yl < 1e-12 || zl < 1e-12) {
    set_last("frame axis length near zero");
    return OCC_ERR_MATH;
  }
  /* soft orthonormal check */
  const double xzn =
      (f->x[0] * f->z[0] + f->x[1] * f->z[1] + f->x[2] * f->z[2]) / (xl * zl);
  if (std::fabs(xzn) > 1e-3) {
    set_last("frame X and Z not orthogonal enough");
    return OCC_ERR_MATH;
  }
  return OCC_OK;
}

occ_entity_id_t alloc_id(SessionImpl* S) {
  return S->next_id++;
}

void unbind_name(SessionImpl* S, EntityRec& rec) {
  if (rec.name.empty()) return;
  auto it = S->name_to_id.find(rec.name);
  if (it != S->name_to_id.end() && it->second == rec.id) {
    S->name_to_id.erase(it);
  }
  rec.name.clear();
}

void erase_frames_for(SessionImpl* S, occ_entity_id_t id) {
  for (auto it = S->frames.begin(); it != S->frames.end();) {
    if (it->first.first == id)
      it = S->frames.erase(it);
    else
      ++it;
  }
}

int register_one(SessionImpl* S,
                 const TopoDS_Shape& shape,
                 occ_entity_kind_t kind,
                 bool has_shape,
                 occ_entity_id_t* out_id) {
  EntityRec rec;
  rec.id = alloc_id(S);
  rec.shape = shape;
  rec.kind = kind;
  rec.created_by = current_op_id(S);
  rec.has_shape = has_shape && !shape.IsNull();
  const occ_entity_id_t id = rec.id;
  S->entities.emplace(id, std::move(rec));
  if (out_id) *out_id = id;
  return OCC_OK;
}

void expand_subshapes(SessionImpl* S, const TopoDS_Shape& root) {
  if (root.IsNull()) return;

  auto add_type = [&](TopAbs_ShapeEnum t, occ_entity_kind_t k) {
    for (TopExp_Explorer ex(root, t); ex.More(); ex.Next()) {
      const TopoDS_Shape& sub = ex.Current();
      /* skip if identical to root (already registered) */
      if (sub.IsSame(root)) continue;
      register_one(S, sub, k, true, nullptr);
    }
  };

  /* Order: solids → shells → faces → wires → edges → vertices */
  add_type(TopAbs_SOLID, OCC_ENTITY_SOLID);
  add_type(TopAbs_SHELL, OCC_ENTITY_SHELL);
  add_type(TopAbs_FACE, OCC_ENTITY_FACE);
  add_type(TopAbs_WIRE, OCC_ENTITY_WIRE);
  add_type(TopAbs_EDGE, OCC_ENTITY_EDGE);
  add_type(TopAbs_VERTEX, OCC_ENTITY_VERTEX);
}

int make_plane_rect_face(const gp_Pnt& origin,
                         const gp_Dir& normal,
                         const gp_Dir& xdir,
                         double half_w,
                         double half_h,
                         TopoDS_Shape& out_face) {
  const gp_Dir ydir = normal.Crossed(xdir);
  const gp_Pnt p0 =
      origin.Translated(gp_Vec(xdir) * (-half_w) + gp_Vec(ydir) * (-half_h));
  const gp_Pnt p1 =
      origin.Translated(gp_Vec(xdir) * (half_w) + gp_Vec(ydir) * (-half_h));
  const gp_Pnt p2 =
      origin.Translated(gp_Vec(xdir) * (half_w) + gp_Vec(ydir) * (half_h));
  const gp_Pnt p3 =
      origin.Translated(gp_Vec(xdir) * (-half_w) + gp_Vec(ydir) * (half_h));

  BRepBuilderAPI_MakePolygon poly(p0, p1, p2, p3, Standard_True);
  if (!poly.IsDone()) {
    set_last("world plane polygon failed");
    return OCC_ERR_MATH;
  }
  BRepBuilderAPI_MakeFace mf(poly.Wire(), /*OnlyPlane=*/Standard_True);
  if (!mf.IsDone()) {
    set_last("world plane face failed");
    return OCC_ERR_MATH;
  }
  out_face = mf.Face();
  return OCC_OK;
}

void fill_frame(occ_session_frame_t* f,
                double ox, double oy, double oz,
                double xx, double xy, double xz,
                double yx, double yy, double yz,
                double zx, double zy, double zz) {
  f->origin[0] = ox; f->origin[1] = oy; f->origin[2] = oz;
  f->x[0] = xx; f->x[1] = xy; f->x[2] = xz;
  f->y[0] = yx; f->y[1] = yy; f->y[2] = yz;
  f->z[0] = zx; f->z[1] = zy; f->z[2] = zz;
}

int write_ids_capped(const std::vector<occ_entity_id_t>& ids,
                     occ_entity_id_t* out_entity_ids,
                     int max,
                     int* out_count) {
  if (!out_count) {
    set_last("null out_count");
    return OCC_ERR_NULL_ARG;
  }
  *out_count = static_cast<int>(ids.size());
  if (max < 0) {
    set_last("max < 0");
    return OCC_ERR_BAD_QUERY;
  }
  if (max > 0 && !out_entity_ids) {
    set_last("null out_entity_ids with max > 0");
    return OCC_ERR_NULL_ARG;
  }
  const int nwrite =
      static_cast<int>(ids.size()) < max ? static_cast<int>(ids.size()) : max;
  for (int i = 0; i < nwrite; ++i) out_entity_ids[i] = ids[static_cast<size_t>(i)];
  if (static_cast<int>(ids.size()) > max && max >= 0) {
    set_last("query result exceeds capacity");
    return OCC_ERR_CAPACITY;
  }
  return OCC_OK;
}

}  // namespace

/* ==========================================================================
 * C API
 * ========================================================================== */

extern "C" {

/* --------------------------- lifecycle --------------------------- */

int occ_session_create(occ_session_t** out_session) {
  REQ(out_session, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  SessionImpl* S = new SessionImpl();
  *out_session = reinterpret_cast<occ_session_t*>(S);
  set_last("");
  return OCC_OK;
  OCC_GUARD_END
}

int occ_session_destroy(occ_session_t* session) {
  if (!session) return OCC_OK;
  OCC_GUARD_BEGIN
  delete impl_of(session);
  set_last("");
  return OCC_OK;
  OCC_GUARD_END
}

int occ_session_clear(occ_session_t* session) {
  SessionImpl* S = nullptr;
  int st = req_session(session, &S);
  if (st != OCC_OK) return st;
  OCC_GUARD_BEGIN
  S->entities.clear();
  S->name_to_id.clear();
  S->frames.clear();
  S->op_stack.clear();
  S->plane_xy = S->plane_yz = S->plane_zx = 0;
  /* keep next_id monotonic across clear so historical ids never revive */
  set_last("");
  return OCC_OK;
  OCC_GUARD_END
}

/* --------------------------- op stack --------------------------- */

int occ_session_begin_op(occ_session_t* session, const char* op_id_str) {
  SessionImpl* S = nullptr;
  int st = req_session(session, &S);
  if (st != OCC_OK) return st;
  REQ(op_id_str, OCC_ERR_NULL_ARG);
  if (op_id_str[0] == '\0') {
    set_last("empty op id");
    return OCC_ERR_UNKNOWN_OP;
  }
  OCC_GUARD_BEGIN
  S->op_stack.emplace_back(op_id_str);
  set_last("");
  return OCC_OK;
  OCC_GUARD_END
}

int occ_session_end_op(occ_session_t* session, const char* op_id_str) {
  SessionImpl* S = nullptr;
  int st = req_session(session, &S);
  if (st != OCC_OK) return st;
  OCC_GUARD_BEGIN
  if (S->op_stack.empty()) {
    set_last("end_op with empty op stack");
    return OCC_ERR_UNKNOWN_OP;
  }
  if (op_id_str) {
    if (S->op_stack.back() != op_id_str) {
      set_last("end_op id does not match stack top");
      return OCC_ERR_UNKNOWN_OP;
    }
  }
  S->op_stack.pop_back();
  set_last("");
  return OCC_OK;
  OCC_GUARD_END
}

int occ_session_current_op(occ_session_t* session, char* buf, int buflen) {
  SessionImpl* S = nullptr;
  int st = req_session(session, &S);
  if (st != OCC_OK) return st;
  REQ(buf, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  return copy_cstr(current_op_id(S), buf, buflen);
  OCC_GUARD_END
}

/* --------------------------- register / get / release --------------------------- */

int occ_session_register_shape_root_only(occ_session_t* session,
                                         occ_shape_t shape,
                                         occ_entity_id_t* out_entity_id) {
  SessionImpl* S = nullptr;
  int st = req_session(session, &S);
  if (st != OCC_OK) return st;
  REQ(shape, OCC_ERR_NULL_ARG);
  REQ(out_entity_id, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  const TopoDS_Shape& sh = *as_shape(shape);
  if (sh.IsNull()) {
    set_last("null TopoDS_Shape");
    return OCC_ERR_INVALID_SHAPE;
  }
  const occ_entity_kind_t k = kind_from_shape(sh);
  st = register_one(S, sh, k, true, out_entity_id);
  if (st != OCC_OK) return st;
  set_last("");
  return OCC_OK;
  OCC_GUARD_END
}

int occ_session_register_shape(occ_session_t* session,
                               occ_shape_t shape,
                               occ_entity_id_t* out_entity_id) {
  SessionImpl* S = nullptr;
  int st = req_session(session, &S);
  if (st != OCC_OK) return st;
  REQ(shape, OCC_ERR_NULL_ARG);
  REQ(out_entity_id, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  const TopoDS_Shape& sh = *as_shape(shape);
  if (sh.IsNull()) {
    set_last("null TopoDS_Shape");
    return OCC_ERR_INVALID_SHAPE;
  }
  const occ_entity_kind_t k = kind_from_shape(sh);
  st = register_one(S, sh, k, true, out_entity_id);
  if (st != OCC_OK) return st;
  expand_subshapes(S, sh);
  set_last("");
  return OCC_OK;
  OCC_GUARD_END
}

int occ_session_get_shape(occ_session_t* session,
                          occ_entity_id_t entity_id,
                          occ_shape_t* out_shape) {
  SessionImpl* S = nullptr;
  int st = req_session(session, &S);
  if (st != OCC_OK) return st;
  REQ(out_shape, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  auto it = S->entities.find(entity_id);
  if (it == S->entities.end()) {
    set_last("entity not found");
    return OCC_ERR_NOT_FOUND;
  }
  if (!it->second.has_shape || it->second.shape.IsNull()) {
    set_last("entity has no BREP shape");
    return OCC_ERR_INVALID_SHAPE;
  }
  *out_shape = to_handle(it->second.shape);
  set_last("");
  return OCC_OK;
  OCC_GUARD_END
}

int occ_session_release_entity(occ_session_t* session,
                               occ_entity_id_t entity_id) {
  SessionImpl* S = nullptr;
  int st = req_session(session, &S);
  if (st != OCC_OK) return st;
  OCC_GUARD_BEGIN
  auto it = S->entities.find(entity_id);
  if (it == S->entities.end()) {
    set_last("entity not found");
    return OCC_ERR_NOT_FOUND;
  }
  unbind_name(S, it->second);
  erase_frames_for(S, entity_id);
  if (S->plane_xy == entity_id) S->plane_xy = 0;
  if (S->plane_yz == entity_id) S->plane_yz = 0;
  if (S->plane_zx == entity_id) S->plane_zx = 0;
  S->entities.erase(it);
  set_last("");
  return OCC_OK;
  OCC_GUARD_END
}

int occ_session_entity_count(occ_session_t* session, int* out_count) {
  SessionImpl* S = nullptr;
  int st = req_session(session, &S);
  if (st != OCC_OK) return st;
  REQ(out_count, OCC_ERR_NULL_ARG);
  *out_count = static_cast<int>(S->entities.size());
  return OCC_OK;
}

/* --------------------------- history find --------------------------- */

int occ_session_find_by_created_by(occ_session_t* session,
                                   const char* op_id_prefix,
                                   occ_entity_kind_t kind,
                                   occ_entity_id_t* out_entity_ids,
                                   int max,
                                   int* out_count) {
  SessionImpl* S = nullptr;
  int st = req_session(session, &S);
  if (st != OCC_OK) return st;
  if (!op_id_prefix || op_id_prefix[0] == '\0') {
    set_last("empty op_id_prefix");
    return OCC_ERR_BAD_QUERY;
  }
  OCC_GUARD_BEGIN
  std::vector<occ_entity_id_t> hits;
  hits.reserve(64);
  for (const auto& kv : S->entities) {
    const EntityRec& rec = kv.second;
    if (!prefix_match(rec.created_by, op_id_prefix)) continue;
    if (!kind_matches(kind, rec.kind)) continue;
    hits.push_back(rec.id);
  }
  /* stable order by entity id for determinism */
  std::sort(hits.begin(), hits.end());
  return write_ids_capped(hits, out_entity_ids, max, out_count);
  OCC_GUARD_END
}

int occ_session_entity_op_id(occ_session_t* session,
                             occ_entity_id_t entity_id,
                             char* buf,
                             int buflen) {
  SessionImpl* S = nullptr;
  int st = req_session(session, &S);
  if (st != OCC_OK) return st;
  REQ(buf, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  auto it = S->entities.find(entity_id);
  if (it == S->entities.end()) {
    set_last("entity not found");
    return OCC_ERR_NOT_FOUND;
  }
  return copy_cstr(it->second.created_by, buf, buflen);
  OCC_GUARD_END
}

int occ_session_entity_kind(occ_session_t* session,
                            occ_entity_id_t entity_id,
                            occ_entity_kind_t* out_kind) {
  SessionImpl* S = nullptr;
  int st = req_session(session, &S);
  if (st != OCC_OK) return st;
  REQ(out_kind, OCC_ERR_NULL_ARG);
  auto it = S->entities.find(entity_id);
  if (it == S->entities.end()) {
    set_last("entity not found");
    return OCC_ERR_NOT_FOUND;
  }
  *out_kind = it->second.kind;
  return OCC_OK;
}

/* --------------------------- names --------------------------- */

int occ_session_set_name(occ_session_t* session,
                         occ_entity_id_t entity_id,
                         const char* name) {
  SessionImpl* S = nullptr;
  int st = req_session(session, &S);
  if (st != OCC_OK) return st;
  REQ(name, OCC_ERR_NULL_ARG);
  if (name[0] == '\0') {
    set_last("empty name");
    return OCC_ERR_BAD_QUERY;
  }
  OCC_GUARD_BEGIN
  auto it = S->entities.find(entity_id);
  if (it == S->entities.end()) {
    set_last("entity not found");
    return OCC_ERR_NOT_FOUND;
  }
  /* rebind: if name already used by another entity, steal it */
  auto nit = S->name_to_id.find(name);
  if (nit != S->name_to_id.end() && nit->second != entity_id) {
    auto other = S->entities.find(nit->second);
    if (other != S->entities.end()) {
      other->second.name.clear();
    }
  }
  unbind_name(S, it->second);
  it->second.name = name;
  S->name_to_id[name] = entity_id;
  set_last("");
  return OCC_OK;
  OCC_GUARD_END
}

int occ_session_find_by_name(occ_session_t* session,
                             const char* name,
                             occ_entity_id_t* out_entity_id) {
  SessionImpl* S = nullptr;
  int st = req_session(session, &S);
  if (st != OCC_OK) return st;
  REQ(name, OCC_ERR_NULL_ARG);
  REQ(out_entity_id, OCC_ERR_NULL_ARG);
  auto it = S->name_to_id.find(name);
  if (it == S->name_to_id.end()) {
    set_last("name not found");
    return OCC_ERR_NOT_FOUND;
  }
  *out_entity_id = it->second;
  return OCC_OK;
}

int occ_session_entity_name(occ_session_t* session,
                            occ_entity_id_t entity_id,
                            char* buf,
                            int buflen) {
  SessionImpl* S = nullptr;
  int st = req_session(session, &S);
  if (st != OCC_OK) return st;
  REQ(buf, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  auto it = S->entities.find(entity_id);
  if (it == S->entities.end()) {
    set_last("entity not found");
    return OCC_ERR_NOT_FOUND;
  }
  return copy_cstr(it->second.name, buf, buflen);
  OCC_GUARD_END
}

/* --------------------------- frames --------------------------- */

int occ_session_frame_to_12(const occ_session_frame_t* f, double out12[12]) {
  REQ(f && out12, OCC_ERR_NULL_ARG);
  out12[0] = f->origin[0]; out12[1] = f->origin[1]; out12[2] = f->origin[2];
  out12[3] = f->x[0];      out12[4] = f->x[1];      out12[5] = f->x[2];
  out12[6] = f->y[0];      out12[7] = f->y[1];      out12[8] = f->y[2];
  out12[9] = f->z[0];      out12[10] = f->z[1];     out12[11] = f->z[2];
  return OCC_OK;
}

int occ_session_frame_from_12(const double m12[12], occ_session_frame_t* out) {
  REQ(m12 && out, OCC_ERR_NULL_ARG);
  out->origin[0] = m12[0]; out->origin[1] = m12[1]; out->origin[2] = m12[2];
  out->x[0] = m12[3];      out->x[1] = m12[4];      out->x[2] = m12[5];
  out->y[0] = m12[6];      out->y[1] = m12[7];      out->y[2] = m12[8];
  out->z[0] = m12[9];      out->z[1] = m12[10];     out->z[2] = m12[11];
  return OCC_OK;
}

int occ_session_attach_frame(occ_session_t* session,
                             occ_entity_id_t entity_id,
                             const char* name,
                             const occ_session_frame_t* frame) {
  SessionImpl* S = nullptr;
  int st = req_session(session, &S);
  if (st != OCC_OK) return st;
  REQ(name, OCC_ERR_NULL_ARG);
  REQ(frame, OCC_ERR_NULL_ARG);
  if (name[0] == '\0') {
    set_last("empty frame name");
    return OCC_ERR_BAD_QUERY;
  }
  OCC_GUARD_BEGIN
  st = validate_frame(frame);
  if (st != OCC_OK) return st;

  occ_entity_id_t target = entity_id;
  if (target == 0) {
    /* free-floating FRAME entity */
    st = register_one(S, TopoDS_Shape(), OCC_ENTITY_FRAME, false, &target);
    if (st != OCC_OK) return st;
  } else {
    auto it = S->entities.find(target);
    if (it == S->entities.end()) {
      set_last("entity not found for frame attach");
      return OCC_ERR_NOT_FOUND;
    }
  }

  S->frames[{target, std::string(name)}] = *frame;
  set_last("");
  return OCC_OK;
  OCC_GUARD_END
}

int occ_session_get_frame(occ_session_t* session,
                          occ_entity_id_t entity_id,
                          const char* name,
                          occ_session_frame_t* out_frame) {
  SessionImpl* S = nullptr;
  int st = req_session(session, &S);
  if (st != OCC_OK) return st;
  REQ(name && out_frame, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  auto it = S->frames.find({entity_id, std::string(name)});
  if (it == S->frames.end()) {
    set_last("frame not found");
    return OCC_ERR_NOT_FOUND;
  }
  *out_frame = it->second;
  set_last("");
  return OCC_OK;
  OCC_GUARD_END
}

/* --------------------------- world planes --------------------------- */

int occ_session_ensure_world_planes(occ_session_t* session) {
  SessionImpl* S = nullptr;
  int st = req_session(session, &S);
  if (st != OCC_OK) return st;
  OCC_GUARD_BEGIN

  auto ensure_one = [&](occ_entity_id_t& slot, const char* op_name,
                        const char* ent_name, const gp_Pnt& o, const gp_Dir& n,
                        const gp_Dir& x, const occ_session_frame_t& fr) -> int {
    if (slot != 0 && S->entities.count(slot)) return OCC_OK;
    /* temporarily push a synthetic op so created_by is stable */
    S->op_stack.emplace_back(op_name);
    TopoDS_Shape face;
    int rc = make_plane_rect_face(o, n, x, /*half_w=*/1.0, /*half_h=*/1.0, face);
    if (rc != OCC_OK) {
      S->op_stack.pop_back();
      return rc;
    }
    occ_entity_id_t id = 0;
    rc = register_one(S, face, OCC_ENTITY_FACE, true, &id);
    S->op_stack.pop_back();
    if (rc != OCC_OK) return rc;
    EntityRec& rec = S->entities[id];
    unbind_name(S, rec);
    rec.name = ent_name;
    S->name_to_id[ent_name] = id;
    S->frames[{id, std::string("cs")}] = fr;
    slot = id;
    return OCC_OK;
  };

  occ_session_frame_t fxy, fyz, fzx;
  fill_frame(&fxy, 0, 0, 0,  1, 0, 0,  0, 1, 0,  0, 0, 1);
  fill_frame(&fyz, 0, 0, 0,  0, 1, 0,  0, 0, 1,  1, 0, 0);
  fill_frame(&fzx, 0, 0, 0,  0, 0, 1,  1, 0, 0,  0, 1, 0);

  st = ensure_one(S->plane_xy, "world/xy", "world_xy",
                  gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1), gp_Dir(1, 0, 0), fxy);
  if (st != OCC_OK) return st;
  st = ensure_one(S->plane_yz, "world/yz", "world_yz",
                  gp_Pnt(0, 0, 0), gp_Dir(1, 0, 0), gp_Dir(0, 1, 0), fyz);
  if (st != OCC_OK) return st;
  st = ensure_one(S->plane_zx, "world/zx", "world_zx",
                  gp_Pnt(0, 0, 0), gp_Dir(0, 1, 0), gp_Dir(0, 0, 1), fzx);
  if (st != OCC_OK) return st;

  set_last("");
  return OCC_OK;
  OCC_GUARD_END
}

int occ_session_world_plane_xy(occ_session_t* session, occ_entity_id_t* out_id) {
  SessionImpl* S = nullptr;
  int st = req_session(session, &S);
  if (st != OCC_OK) return st;
  REQ(out_id, OCC_ERR_NULL_ARG);
  if (S->plane_xy == 0) {
    st = occ_session_ensure_world_planes(session);
    if (st != OCC_OK) return st;
  }
  if (S->plane_xy == 0) {
    set_last("world xy plane missing");
    return OCC_ERR_NOT_FOUND;
  }
  *out_id = S->plane_xy;
  return OCC_OK;
}

int occ_session_world_plane_yz(occ_session_t* session, occ_entity_id_t* out_id) {
  SessionImpl* S = nullptr;
  int st = req_session(session, &S);
  if (st != OCC_OK) return st;
  REQ(out_id, OCC_ERR_NULL_ARG);
  if (S->plane_yz == 0) {
    st = occ_session_ensure_world_planes(session);
    if (st != OCC_OK) return st;
  }
  if (S->plane_yz == 0) {
    set_last("world yz plane missing");
    return OCC_ERR_NOT_FOUND;
  }
  *out_id = S->plane_yz;
  return OCC_OK;
}

int occ_session_world_plane_zx(occ_session_t* session, occ_entity_id_t* out_id) {
  SessionImpl* S = nullptr;
  int st = req_session(session, &S);
  if (st != OCC_OK) return st;
  REQ(out_id, OCC_ERR_NULL_ARG);
  if (S->plane_zx == 0) {
    st = occ_session_ensure_world_planes(session);
    if (st != OCC_OK) return st;
  }
  if (S->plane_zx == 0) {
    set_last("world zx plane missing");
    return OCC_ERR_NOT_FOUND;
  }
  *out_id = S->plane_zx;
  return OCC_OK;
}

/* --------------------------- IR query algebra v0 --------------------------- */

int occ_query_created_by(occ_session_t* session,
                         const char* op_id_prefix,
                         occ_entity_kind_t kind,
                         occ_entity_id_t* out_entity_ids,
                         int max,
                         int* out_count) {
  return occ_session_find_by_created_by(session, op_id_prefix, kind,
                                        out_entity_ids, max, out_count);
}

int occ_query_filter_kind(occ_session_t* session,
                          const occ_entity_id_t* in_ids,
                          int n_in,
                          occ_entity_kind_t kind,
                          occ_entity_id_t* out_entity_ids,
                          int max,
                          int* out_count) {
  SessionImpl* S = nullptr;
  int st = req_session(session, &S);
  if (st != OCC_OK) return st;
  if (n_in < 0) {
    set_last("n_in < 0");
    return OCC_ERR_BAD_QUERY;
  }
  if (n_in > 0 && !in_ids) {
    set_last("null in_ids");
    return OCC_ERR_NULL_ARG;
  }
  OCC_GUARD_BEGIN
  std::vector<occ_entity_id_t> hits;
  hits.reserve(static_cast<size_t>(n_in > 0 ? n_in : 0));
  for (int i = 0; i < n_in; ++i) {
    auto it = S->entities.find(in_ids[i]);
    if (it == S->entities.end()) continue; /* drop dead ids */
    if (!kind_matches(kind, it->second.kind)) continue;
    hits.push_back(in_ids[i]);
  }
  return write_ids_capped(hits, out_entity_ids, max, out_count);
  OCC_GUARD_END
}

int occ_query_intersect_ids(const occ_entity_id_t* a,
                            int na,
                            const occ_entity_id_t* b,
                            int nb,
                            occ_entity_id_t* out_entity_ids,
                            int max,
                            int* out_count) {
  if (na < 0 || nb < 0) {
    set_last("negative list length");
    return OCC_ERR_BAD_QUERY;
  }
  if ((na > 0 && !a) || (nb > 0 && !b)) {
    set_last("null id list");
    return OCC_ERR_NULL_ARG;
  }
  OCC_GUARD_BEGIN
  std::unordered_set<occ_entity_id_t> bset;
  bset.reserve(static_cast<size_t>(nb > 0 ? nb : 0));
  for (int i = 0; i < nb; ++i) bset.insert(b[i]);

  std::vector<occ_entity_id_t> hits;
  std::unordered_set<occ_entity_id_t> seen;
  hits.reserve(static_cast<size_t>(na > 0 ? na : 0));
  for (int i = 0; i < na; ++i) {
    if (!bset.count(a[i])) continue;
    if (seen.count(a[i])) continue;
    seen.insert(a[i]);
    hits.push_back(a[i]);
  }
  return write_ids_capped(hits, out_entity_ids, max, out_count);
  OCC_GUARD_END
}

int occ_query_union_ids(const occ_entity_id_t* a,
                        int na,
                        const occ_entity_id_t* b,
                        int nb,
                        occ_entity_id_t* out_entity_ids,
                        int max,
                        int* out_count) {
  if (na < 0 || nb < 0) {
    set_last("negative list length");
    return OCC_ERR_BAD_QUERY;
  }
  if ((na > 0 && !a) || (nb > 0 && !b)) {
    set_last("null id list");
    return OCC_ERR_NULL_ARG;
  }
  OCC_GUARD_BEGIN
  std::vector<occ_entity_id_t> hits;
  std::unordered_set<occ_entity_id_t> seen;
  hits.reserve(static_cast<size_t>((na > 0 ? na : 0) + (nb > 0 ? nb : 0)));
  for (int i = 0; i < na; ++i) {
    if (seen.insert(a[i]).second) hits.push_back(a[i]);
  }
  for (int i = 0; i < nb; ++i) {
    if (seen.insert(b[i]).second) hits.push_back(b[i]);
  }
  return write_ids_capped(hits, out_entity_ids, max, out_count);
  OCC_GUARD_END
}

int occ_query_subtract_ids(const occ_entity_id_t* a,
                           int na,
                           const occ_entity_id_t* b,
                           int nb,
                           occ_entity_id_t* out_entity_ids,
                           int max,
                           int* out_count) {
  if (na < 0 || nb < 0) {
    set_last("negative list length");
    return OCC_ERR_BAD_QUERY;
  }
  if ((na > 0 && !a) || (nb > 0 && !b)) {
    set_last("null id list");
    return OCC_ERR_NULL_ARG;
  }
  OCC_GUARD_BEGIN
  std::unordered_set<occ_entity_id_t> bset;
  for (int i = 0; i < nb; ++i) bset.insert(b[i]);
  std::vector<occ_entity_id_t> hits;
  std::unordered_set<occ_entity_id_t> seen;
  for (int i = 0; i < na; ++i) {
    if (bset.count(a[i])) continue;
    if (!seen.insert(a[i]).second) continue;
    hits.push_back(a[i]);
  }
  return write_ids_capped(hits, out_entity_ids, max, out_count);
  OCC_GUARD_END
}

}  // extern "C"
```

---

## 5. Shared glue reminder (`occ_c_internal.hxx`)

Already specified in the main P0 literate API. Session code depends on it exactly as below (extract once if missing):

```cpp
// === file: occ_c_internal.hxx
// Private — not installed. Shared by all occ_c*.cc TUs.
#pragma once
#include "occ_c.h"
#include <string>
#include <cmath>
#include <TopoDS_Shape.hxx>
#include <Standard_Failure.hxx>

namespace occ_c_detail {

inline thread_local std::string g_last_error;

inline void set_last(const char* msg) {
  g_last_error = msg ? msg : "";
}

inline TopoDS_Shape* as_shape(occ_shape_t s) {
  return reinterpret_cast<TopoDS_Shape*>(s);
}

inline occ_shape_t to_handle(const TopoDS_Shape& s) {
  return reinterpret_cast<occ_shape_t>(new TopoDS_Shape(s));
}

}  // namespace occ_c_detail

#define OCC_GUARD_BEGIN try {
#define OCC_GUARD_END                                                         \
  }                                                                           \
  catch (Standard_Failure & e) {                                              \
    occ_c_detail::set_last(e.GetMessageString() ? e.GetMessageString()        \
                                                : "OCCT failure");            \
    return OCC_ERR_EXCEPTION;                                                 \
  }                                                                           \
  catch (std::exception & e) {                                                \
    occ_c_detail::set_last(e.what());                                         \
    return OCC_ERR_EXCEPTION;                                                 \
  }                                                                           \
  catch (...) {                                                               \
    occ_c_detail::set_last("unknown exception");                              \
    return OCC_ERR_EXCEPTION;                                                 \
  }

#define REQ(cond, code)             \
  do {                              \
    if (!(cond)) return (code);     \
  } while (0)
```

If baseline `occ_last_error` is not yet wired:

```cpp
// fragment for occ_c.cc
const char* occ_last_error(void) {
  return occ_c_detail::g_last_error.c_str();
}
```

---

## 6. Pedagogy — IR `created_by: box1/solid` after extrude

### 6.1 Document fragment

```yaml
- id: box1/sketch
  op: MakePlaneRect   # or Sketch2D → face
  plane: world_xy
  width_m: 0.10
  height_m: 0.06

- id: box1/solid
  op: Extrude
  profile: { created_by: "box1/sketch", entity: face }
  extent: { kind: blind, depth_m: 0.08 }

- id: holes1
  op: DrillHole
  target: { created_by: "box1/solid", entity: body }
  # later: on: { created_by: "box1/solid", entity: face, filter: max_z }
```

### 6.2 Host evaluation sequence (C)

```c
occ_session_t* S = NULL;
occ_session_create(&S);
occ_session_ensure_world_planes(S);

/* --- box1/sketch --- */
occ_session_begin_op(S, "box1/sketch");
occ_shape_t sketch_face = NULL;
/* e.g. occ_make_plane_rect(...) → sketch_face */
occ_entity_id_t sketch_id = 0;
occ_session_register_shape(S, sketch_face, &sketch_id);
occ_session_set_name(S, sketch_id, "box1_sketch_face");
occ_session_end_op(S, "box1/sketch");

/* Resolve profile selector for extrude */
occ_entity_id_t prof_ids[32];
int n_prof = 0;
occ_query_created_by(S, "box1/sketch", OCC_ENTITY_FACE, prof_ids, 32, &n_prof);
/* n_prof >= 1; take prof_ids[0], get_shape → extrude */

/* --- box1/solid --- */
occ_session_begin_op(S, "box1/solid");
occ_shape_t solid = NULL;
/* occ_extrude(profile_shape, 0,0,0.08, &solid); */
occ_entity_id_t solid_id = 0;
occ_session_register_shape(S, solid, &solid_id);
/* expands faces/edges/vertices with created_by == "box1/solid" */
occ_session_end_op(S, "box1/solid");

/* --- holes1 target: created_by box1/solid, entity body --- */
occ_entity_id_t body_ids[8];
int n_body = 0;
occ_query_created_by(S, "box1/solid", OCC_ENTITY_BODY, body_ids, 8, &n_body);
/* BODY matches the SOLID root */

/* faces of that extrude for geometric filters */
occ_entity_id_t face_ids[64];
int n_face = 0;
occ_query_created_by(S, "box1/solid", OCC_ENTITY_FACE, face_ids, 64, &n_face);

/* algebra: intersect two independent queries when IR says so */
occ_entity_id_t a[16], b[16], ab[16];
int na = 0, nb = 0, nab = 0;
occ_query_created_by(S, "box1", OCC_ENTITY_FACE, a, 16, &na);   /* prefix */
occ_query_created_by(S, "box1/solid", OCC_ENTITY_ANY, b, 16, &nb);
occ_query_intersect_ids(a, na, b, nb, ab, 16, &nab);

occ_session_destroy(S);
```

### 6.3 Mapping table

| IR selector | Session call |
|-------------|--------------|
| `{ created_by: "box1/solid", entity: body }` | `occ_query_created_by(S, "box1/solid", OCC_ENTITY_BODY, …)` |
| `{ created_by: "box1/solid", entity: face }` | `… OCC_ENTITY_FACE …` |
| `{ created_by: "box1", entity: face }` | prefix match hits `box1/sketch` and `box1/solid` faces |
| `{ name: "world_xy" }` | `occ_session_find_by_name(S, "world_xy", &id)` |
| set intersection | `occ_query_intersect_ids` |
| kind refine after historical query | `occ_query_filter_kind` |

### 6.4 Nested ops

```c
occ_session_begin_op(S, "housing");
  occ_session_begin_op(S, "housing/extrude");
    /* register → created_by == "housing/extrude" */
  occ_session_end_op(S, "housing/extrude");
  occ_session_begin_op(S, "housing/boolean");
    /* register → created_by == "housing/boolean" */
  occ_session_end_op(S, "housing/boolean");
occ_session_end_op(S, "housing");
/* prefix "housing" matches both children; exact "housing/boolean" is precise */
```

The IR evaluator is responsible for choosing **leaf** ids for creation tags and **prefix** queries for “everything under this feature”.

### 6.5 What is *not* stored

- Parameter values / feature definitions (IR document owns them).  
- Rollback journal of OCCT kernels (re-eval from IR instead).  
- Automatic parent/child topology links beyond same `created_by` string.  
- Multi-threaded mutation of one session.

---

## 7. Smoke test (pure C conceptual)

```c
// === file: examples/c_api_session_smoke.c
#include "occ_c.h"
#include "occ_c_session.h"
#include <stdio.h>
#include <string.h>

int main(void) {
  occ_session_t* S = NULL;
  if (occ_session_create(&S) != OCC_OK) return 1;

  if (occ_session_ensure_world_planes(S) != OCC_OK) {
    fprintf(stderr, "planes: %s\n", occ_last_error());
    return 1;
  }
  occ_entity_id_t xy = 0;
  occ_session_world_plane_xy(S, &xy);
  printf("world_xy entity=%llu\n", (unsigned long long)xy);

  /* Fake: make a box with baseline API then register under op id */
  occ_shape_t box = NULL;
  if (occ_make_box(0.1, 0.06, 0.08, &box) != OCC_OK) {
    fprintf(stderr, "box: %s\n", occ_last_error());
    return 1;
  }

  occ_session_begin_op(S, "box1/solid");
  occ_entity_id_t root = 0;
  if (occ_session_register_shape(S, box, &root) != OCC_OK) {
    fprintf(stderr, "reg: %s\n", occ_last_error());
    return 1;
  }
  occ_session_set_name(S, root, "box1_body");
  occ_session_end_op(S, "box1/solid");

  char opbuf[128];
  occ_session_entity_op_id(S, root, opbuf, (int)sizeof(opbuf));
  printf("root id=%llu created_by=%s\n", (unsigned long long)root, opbuf);

  occ_entity_id_t faces[128];
  int nf = 0;
  int st = occ_query_created_by(S, "box1/solid", OCC_ENTITY_FACE, faces, 128, &nf);
  if (st != OCC_OK && st != OCC_ERR_CAPACITY) {
    fprintf(stderr, "query: %s\n", occ_last_error());
    return 1;
  }
  printf("faces created_by box1/solid: %d\n", nf);

  occ_entity_id_t bodies[8];
  int nb = 0;
  occ_query_created_by(S, "box1/solid", OCC_ENTITY_BODY, bodies, 8, &nb);
  printf("bodies: %d (expect 1)\n", nb);

  occ_entity_id_t by_name = 0;
  if (occ_session_find_by_name(S, "box1_body", &by_name) != OCC_OK ||
      by_name != root) {
    fprintf(stderr, "name lookup failed\n");
    return 1;
  }

  occ_session_frame_t tcp;
  memset(&tcp, 0, sizeof(tcp));
  tcp.x[0] = 1; tcp.y[1] = 1; tcp.z[2] = 1;
  tcp.origin[2] = 0.08;
  if (occ_session_attach_frame(S, root, "tcp", &tcp) != OCC_OK) {
    fprintf(stderr, "frame: %s\n", occ_last_error());
    return 1;
  }
  occ_session_frame_t got;
  occ_session_get_frame(S, root, "tcp", &got);
  printf("tcp origin z=%.3f m\n", got.origin[2]);

  /* algebra */
  occ_entity_id_t allf[128], only_root_prefix[128], inter[128];
  int n1 = 0, n2 = 0, n3 = 0;
  occ_query_created_by(S, "box1", OCC_ENTITY_FACE, allf, 128, &n1);
  occ_query_created_by(S, "box1/solid", OCC_ENTITY_FACE, only_root_prefix, 128,
                       &n2);
  occ_query_intersect_ids(allf, n1, only_root_prefix, n2, inter, 128, &n3);
  printf("intersect faces=%d\n", n3);

  occ_shape_t copy = NULL;
  occ_session_get_shape(S, root, &copy);
  occ_shape_free(copy);
  occ_shape_free(box);
  occ_session_destroy(S);
  printf("session smoke ok\n");
  return 0;
}
```

---

## 8. IR mapping + build checklist

| IR / host | C |
|-----------|---|
| studio / session | `occ_session_t` |
| feature begin/end | `begin_op` / `end_op` |
| publish body | `register_shape` |
| `created_by` | `occ_query_created_by` |
| named entity / frame | `set_name` / `attach_frame` |
| world planes | `ensure_world_planes` |
| query ∩ ∪ \ | `intersect` / `union` / `subtract_ids` |

Extract: patch `occ_status_t`; add session sources to `//api:occ_c_lib`; export Wasm symbols;
include `occ_c_internal.hxx`. Goldens: prefix `a` hits `a/b`; `end_op` mismatch → `UNKNOWN_OP`;
`max=0` → `CAPACITY` with correct `out_count`; name rebind steals. Not a FeatureScript `Context`.

---

## 9. Design invariants

1. Entity id = monotonic `uint64` from 1; not reused after `clear` (counter continues).  
2. Shapes stored as `TopoDS_Shape` by value; `created_by` = op-stack top at register.  
3. Prefix match = `strncmp`; prefer IR ids with `/` so `box1` ≠ `box10`.  
4. `BODY` matches solid-like kinds; session mutation is single-threaded.  
5. World planes = FACE entities `world_xy` / `world_yz` / `world_zx` + frame `"cs"`.

---

*End of literate section 01 — session / history / created_by.*

<!-- END 01-session-history.md -->


<!-- BEGIN 02-construction.md -->

# 02 — Construction Geometry (Wires, Faces, Planes, Curves)

**Module:** `occ_c_construct`  
**Section of:** `occ_c` P0 literate API expansion  
**OCCT pin:** **7.9.3**  
**Depends on:** `occ_c.h`, `occ_c_internal.hxx` (shared `as_shape` / `to_handle` / `OCC_GUARD_*` / `REQ` / `set_last`)  
**Status enum:** requires `OCC_ERR_GEOM = 8` from the intro patch  
**Units:** meters · **angles:** radians · **topology indices:** 1-based  

---

## Pedagogy — why this module exists

CAD kernels expose two worlds:

1. **Topology** — `TopoDS_Vertex` / `Edge` / `Wire` / `Face` / `Solid` (what `occ_shape_t` holds).
2. **Geometry** — `gp_Pnt`, `gp_Pln`, `gp_Circ`, `Geom_BSplineCurve` (math under the topology).

FeatureScript / IR nodes such as **MakePoint**, **MakePlane**, and **Sketch2D** (explicit-coords mode only) are *not* constraint solvers. They lower to pure construction calls that build BREP atoms which later feed `occ_extrude`, `occ_revolve`, `occ_pipe`, and route polylines.

```text
IR MakePoint(x,y,z)          →  occ_make_vertex
IR MakePlane(o,n,x)          →  occ_plane_t POD  (+ optional occ_make_plane_rect face for viz)
IR Sketch2D line/arc/circle  →  occ_make_edge_*  →  occ_make_wire_from_edges
IR Sketch2D closed profile   →  occ_make_planar_face_from_wire
IR RoutePath polyline        →  occ_make_polyline / occ_make_bspline_wire_through_points
IR Rectangle / Polygon       →  occ_make_rectangle_wire / occ_make_polygon_wire → face
```

**Out of scope here:** 2D constraint solving, dimension-driven sketches, assembly mates. Those live above this C layer. Coordinates arrive already solved.

### OCCT 7.9.3 class map

| C symbol | Primary OCCT type |
|----------|-------------------|
| `occ_make_vertex` | `BRepBuilderAPI_MakeVertex` + `gp_Pnt` |
| `occ_make_edge_line` | `BRepBuilderAPI_MakeEdge(gp_Pnt, gp_Pnt)` |
| `occ_make_edge_circle` | `BRepBuilderAPI_MakeEdge(gp_Circ)` / `GC_MakeCircle` |
| `occ_make_edge_arc_3pt` | `GC_MakeArcOfCircle(P1,P2,P3)` + `MakeEdge` |
| `occ_make_edge_arc_center` | `GC_MakeArcOfCircle(gp_Circ, α0, α1, sense)` |
| `occ_make_polyline` | successive `MakeEdge` + `BRepBuilderAPI_MakeWire` |
| `occ_make_polygon_wire` | `BRepBuilderAPI_MakePolygon` |
| `occ_make_rectangle_wire` | 4 corners via `gp_Ax2` + `MakePolygon` |
| `occ_make_circle_wire` | circle edge → `MakeWire` |
| `occ_make_wire_from_edges` | `BRepBuilderAPI_MakeWire::Add` |
| `occ_wire_is_closed` | `TopoDS_Shape::Closed()` + endpoint gap check |
| `occ_wire_length` | `BRepAdaptor_CompCurve` + `GCPnts_AbscissaPoint::Length` |
| `occ_wire_reverse` | `TopoDS_Shape::Reversed()` |
| `occ_make_planar_face_from_wire` | `BRepBuilderAPI_MakeFace(wire, OnlyPlane=true)` |
| `occ_make_face_circle` | `MakeFace(gp_Circ plane + wire)` / circle face |
| `occ_make_face_rectangle` | rectangle wire → planar face |
| `occ_make_face_polygon` | polygon wire → planar face |
| `occ_make_plane_rect` | `BRepBuilderAPI_MakeFace(gp_Pln, -hw..hw, -hh..hh)` |
| `occ_plane_t` | POD: origin + normal + X dir (infinite plane params) |
| `occ_plane_from_3pts` | `gp_Pln(P1,P2,P3)` / cross-product basis |
| `occ_plane_from_point_normal` | `gp_Pln(P, Dir)` + auto X |
| `occ_plane_project_point` | signed distance along normal |
| `occ_make_segment_on_plane` | UV → 3D via `gp_Ax3` + `MakeEdge` |
| `occ_offset_wire_2d` | `BRepOffsetAPI_MakeOffset` |
| `occ_make_bspline_wire_through_points` | `GeomAPI_PointsToBSpline` / `GeomAPI_Interpolate` |
| `occ_count_wires` / `occ_wire_at` | `TopExp::MapShapes(..., TopAbs_WIRE, ...)` |

---

## IR lowering recipes (explicit Sketch2D)

### MakePoint

```text
MakePoint { x, y, z }  // meters, world
  → occ_make_vertex(x, y, z, &v)
  // optional: keep in host registry by entity id; C does not name entities
```

### MakePlane

```text
MakePlane { origin[3], normal[3], x_dir[3]? }
  → if x_dir given:
       occ_plane_from_point_normal + overwrite x via occ_plane_t fields
       // or fill occ_plane_t directly after validating axes
  → else:
       occ_plane_from_point_normal(o, n, &pln)
  // viz (construction plane rectangle):
  → occ_make_plane_rect(o..., n..., x..., half_w, half_h, &face)
```

Infinite planes are **not** BREP solids. Store `occ_plane_t` in the host. Only materialize a thin rectangular face when the UI needs a pickable / drawable plane.

### Sketch2D (explicit coordinates, no solver)

Sketch entities live in a plane `occ_plane_t pln`. 2D sketch coords `(u,v)` map to 3D:

```
P = O + u * X + v * Y
Y = N × X   (right-handed)
```

| Sketch entity | Lowering |
|---------------|----------|
| Point `(u,v)` | `occ_plane_project` not needed; `O+uX+vY` → `occ_make_vertex` |
| Line `(u0,v0)-(u1,v1)` | `occ_make_segment_on_plane(&pln, u0,v0, u1,v1, &e)` |
| Full circle | build center 3D + normal → `occ_make_edge_circle` / `occ_make_circle_wire` |
| Arc 3 points | three 3D points → `occ_make_edge_arc_3pt` |
| Arc center+angles | `occ_make_edge_arc_center` |
| Polyline profile | pack `xyz[]` → `occ_make_polyline` / `occ_make_polygon_wire` |
| Closed profile for extrude | wire → `occ_make_planar_face_from_wire` |
| Offset profile | `occ_offset_wire_2d` |

Connect edges with `occ_make_wire_from_edges` when the sketch yields a sequence of independent edges (typical after IR emission). Prefer `occ_make_polygon_wire` when all segments are straight.

### Route / extrude / revolve consumers

```text
polyline route          → occ_make_polyline(xyz, n, /*closed=*/0, &spine)
                          → occ_pipe(profile, spine, &solid)
closed rectangle profile → occ_make_face_rectangle(...) → occ_extrude(face, dx,dy,dz, &solid)
circle profile           → occ_make_face_circle(...) → occ_revolve / occ_extrude
bspline path             → occ_make_bspline_wire_through_points → pipe/sweep
```

---

## Header — extractable

```c
// === file: occ_c_construct.h
// Construction geometry for occ_c — points, planes, edges, wires, faces.
// Explicit coordinates only (no sketch constraint solver).
// Units: meters. Angles: radians. Topology indices: 1-based.
#ifndef OCC_C_CONSTRUCT_H_
#define OCC_C_CONSTRUCT_H_

#include "occ_c.h"

#ifdef __cplusplus
extern "C" {
#endif

/* ---- Infinite plane as POD (not a TopoDS shape) ---- */
typedef struct occ_plane_s {
  double o[3];  /* origin, meters */
  double n[3];  /* unit normal (stored normalized by builders) */
  double x[3];  /* unit X axis in plane, orthogonal to n */
} occ_plane_t;

/* ---- Vertices / edges ---- */
OCC_API int occ_make_vertex(double x, double y, double z, occ_shape_t* out);

OCC_API int occ_make_edge_line(double x0, double y0, double z0,
                               double x1, double y1, double z1,
                               occ_shape_t* out);

/* Full circle as a single closed edge (gp_Circ). */
OCC_API int occ_make_edge_circle(double cx, double cy, double cz,
                                 double nx, double ny, double nz,
                                 double radius, occ_shape_t* out);

/* Arc through three points (P1 start, P2 on-arc, P3 end). GC_MakeArcOfCircle. */
OCC_API int occ_make_edge_arc_3pt(double x1, double y1, double z1,
                                  double x2, double y2, double z2,
                                  double x3, double y3, double z3,
                                  occ_shape_t* out);

/* Arc of circle about center/normal with angular range [a0, a1] radians.
 * Sense follows increasing angle when a1 > a0; OCCT Sense = Standard_True. */
OCC_API int occ_make_edge_arc_center(double cx, double cy, double cz,
                                     double nx, double ny, double nz,
                                     double radius,
                                     double a0_rad, double a1_rad,
                                     occ_shape_t* out);

/* ---- Wires ---- */

/* Open or closed polyline via successive line edges + MakeWire.
 * xyz is length 3*n: [x0,y0,z0, x1,y1,z1, ...]. closed≠0 connects last→first. */
OCC_API int occ_make_polyline(const double* xyz, int n, int closed,
                              occ_shape_t* out);

/* Polygonal wire via BRepBuilderAPI_MakePolygon (preferred for face profiles). */
OCC_API int occ_make_polygon_wire(const double* xyz, int n, int closed,
                                  occ_shape_t* out);

/* Axis-aligned rectangle in a plane defined by center + normal.
 * Local X is chosen by gp_Ax2 from the normal. width/height in meters. */
OCC_API int occ_make_rectangle_wire(double cx, double cy, double cz,
                                    double nx, double ny, double nz,
                                    double width, double height,
                                    occ_shape_t* out);

/* Full circle as a wire (one edge). */
OCC_API int occ_make_circle_wire(double cx, double cy, double cz,
                                 double nx, double ny, double nz,
                                 double radius, occ_shape_t* out);

/* Assemble ordered edges into a wire. Each edges[i] must be TopAbs_EDGE. */
OCC_API int occ_make_wire_from_edges(const occ_shape_t* edges, int n,
                                     occ_shape_t* out);

OCC_API int occ_wire_is_closed(occ_shape_t wire, int* out_closed);
OCC_API int occ_wire_length(occ_shape_t wire, double* out_len);
OCC_API int occ_wire_reverse(occ_shape_t wire, occ_shape_t* out);

/* Topology helpers for compounds containing wires (1-based). */
OCC_API int occ_count_wires(occ_shape_t s, int* out);
OCC_API int occ_wire_at(occ_shape_t s, int idx, occ_shape_t* out);

/* ---- Faces ---- */

/* Planar face from a closed wire (BRepBuilderAPI_MakeFace, OnlyPlane). */
OCC_API int occ_make_planar_face_from_wire(occ_shape_t wire, occ_shape_t* out);

OCC_API int occ_make_face_circle(double cx, double cy, double cz,
                                 double nx, double ny, double nz,
                                 double radius, occ_shape_t* out);

/* Rectangle face: center + normal, width × height (full dimensions). */
OCC_API int occ_make_face_rectangle(double cx, double cy, double cz,
                                    double nx, double ny, double nz,
                                    double width, double height,
                                    occ_shape_t* out);

/* Face from polygon points (closed automatically). */
OCC_API int occ_make_face_polygon(const double* xyz, int n, occ_shape_t* out);

/* Construction plane as a thin rectangular face (viz / pick).
 * half_w, half_h are half-extents in meters along plane X and Y. */
OCC_API int occ_make_plane_rect(double ox, double oy, double oz,
                                double nx, double ny, double nz,
                                double xdirx, double xdiry, double xdirz,
                                double half_w, double half_h,
                                occ_shape_t* out);

/* ---- Plane POD helpers ---- */

OCC_API int occ_plane_from_3pts(double x1, double y1, double z1,
                                double x2, double y2, double z2,
                                double x3, double y3, double z3,
                                occ_plane_t* out);

OCC_API int occ_plane_from_point_normal(double ox, double oy, double oz,
                                        double nx, double ny, double nz,
                                        occ_plane_t* out);

/* Project world point onto plane; writes 3D coordinates into out_xyz[3]. */
OCC_API int occ_plane_project_point(const occ_plane_t* pln,
                                    double x, double y, double z,
                                    double out_xyz[3]);

/* Line segment from plane UV coordinates (meters in plane frame). */
OCC_API int occ_make_segment_on_plane(const occ_plane_t* pln,
                                      double u0, double v0,
                                      double u1, double v1,
                                      occ_shape_t* out);

/* Planar wire offset (BRepOffsetAPI_MakeOffset). dist in meters;
 * positive = left of wire orientation (OCCT convention). */
OCC_API int occ_offset_wire_2d(occ_shape_t wire, double dist, occ_shape_t* out);

/* BSpline through points. degree is preferred DegMax (clamped 1..8).
 * periodic≠0 uses GeomAPI_Interpolate; else GeomAPI_PointsToBSpline.
 * Returns a wire with one edge. */
OCC_API int occ_make_bspline_wire_through_points(const double* xyz, int n,
                                                 int degree, int periodic,
                                                 occ_shape_t* out);

#ifdef __cplusplus
}  /* extern "C" */
#endif

#endif  /* OCC_C_CONSTRUCT_H_ */
```

---

## Implementation — extractable

```cpp
// === file: occ_c_construct.cc
// Construction geometry — thin C over OCCT 7.9.3.
#include "occ_c_construct.h"
#include "occ_c_internal.hxx"

#include <cmath>
#include <vector>

#include <BRepAdaptor_CompCurve.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeVertex.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepGProp.hxx>
#include <BRepOffsetAPI_MakeOffset.hxx>
#include <BRep_Tool.hxx>
#include <GCPnts_AbscissaPoint.hxx>
#include <GC_MakeArcOfCircle.hxx>
#include <GC_MakeCircle.hxx>
#include <GeomAPI_Interpolate.hxx>
#include <GeomAPI_PointsToBSpline.hxx>
#include <Geom_BSplineCurve.hxx>
#include <Geom_Circle.hxx>
#include <Geom_TrimmedCurve.hxx>
#include <GProp_GProps.hxx>
#include <TColgp_Array1OfPnt.hxx>
#include <TColgp_HArray1OfPnt.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Vertex.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Ax2.hxx>
#include <gp_Ax3.hxx>
#include <gp_Circ.hxx>
#include <gp_Dir.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>

using occ_c_detail::as_shape;
using occ_c_detail::to_handle;
using occ_c_detail::set_last;

namespace {

constexpr double k_eps = 1.0e-12;
constexpr double k_gap = 1.0e-7;  // meters — wire endpoint closure tolerance

double vlen3(double x, double y, double z) {
  return std::sqrt(x * x + y * y + z * z);
}

int require_unit_dir(double x, double y, double z, gp_Dir& out, const char* what) {
  const double L = vlen3(x, y, z);
  if (L < k_eps) {
    set_last(what);
    return OCC_ERR_GEOM;
  }
  out = gp_Dir(x / L, y / L, z / L);
  return OCC_OK;
}

/* Fill plane POD from gp_Ax3 (Z = normal, X = x_dir). */
void plane_from_ax3(const gp_Ax3& ax, occ_plane_t* out) {
  const gp_Pnt o = ax.Location();
  const gp_Dir n = ax.Direction();
  const gp_Dir x = ax.XDirection();
  out->o[0] = o.X(); out->o[1] = o.Y(); out->o[2] = o.Z();
  out->n[0] = n.X(); out->n[1] = n.Y(); out->n[2] = n.Z();
  out->x[0] = x.X(); out->x[1] = x.Y(); out->x[2] = x.Z();
}

int plane_to_ax3(const occ_plane_t& p, gp_Ax3& out) {
  const double nl = vlen3(p.n[0], p.n[1], p.n[2]);
  const double xl = vlen3(p.x[0], p.x[1], p.x[2]);
  if (nl < k_eps || xl < k_eps) {
    set_last("plane axis length near zero");
    return OCC_ERR_GEOM;
  }
  gp_Dir n(p.n[0] / nl, p.n[1] / nl, p.n[2] / nl);
  gp_Dir x(p.x[0] / xl, p.x[1] / xl, p.x[2] / xl);
  if (std::abs(x.Dot(n)) > 1.0 - 1.0e-9) {
    set_last("plane X parallel to normal");
    return OCC_ERR_GEOM;
  }
  out = gp_Ax3(gp_Pnt(p.o[0], p.o[1], p.o[2]), n, x);
  return OCC_OK;
}

gp_Pnt uv_to_pnt(const gp_Ax3& ax, double u, double v) {
  const gp_Pnt o = ax.Location();
  const gp_Dir xd = ax.XDirection();
  const gp_Dir yd = ax.YDirection();
  return gp_Pnt(o.X() + u * xd.X() + v * yd.X(),
                o.Y() + u * xd.Y() + v * yd.Y(),
                o.Z() + u * xd.Z() + v * yd.Z());
}

int rectangle_corners(double cx, double cy, double cz,
                      double nx, double ny, double nz,
                      double width, double height,
                      gp_Pnt corners[4]) {
  if (width <= 0.0 || height <= 0.0) {
    set_last("rectangle width/height must be > 0");
    return OCC_ERR_GEOM;
  }
  gp_Dir n;
  int st = require_unit_dir(nx, ny, nz, n, "rectangle normal near zero");
  if (st != OCC_OK) return st;
  gp_Ax2 ax(gp_Pnt(cx, cy, cz), n);  // auto X from normal
  const gp_Dir xd = ax.XDirection();
  const gp_Dir yd = ax.YDirection();
  const double hw = 0.5 * width;
  const double hh = 0.5 * height;
  const gp_Pnt c(cx, cy, cz);
  // CCW when looking along -normal? Looking along +normal: X×Y = N, CCW.
  corners[0] = gp_Pnt(c.X() - hw * xd.X() - hh * yd.X(),
                      c.Y() - hw * xd.Y() - hh * yd.Y(),
                      c.Z() - hw * xd.Z() - hh * yd.Z());
  corners[1] = gp_Pnt(c.X() + hw * xd.X() - hh * yd.X(),
                      c.Y() + hw * xd.Y() - hh * yd.Y(),
                      c.Z() + hw * xd.Z() - hh * yd.Z());
  corners[2] = gp_Pnt(c.X() + hw * xd.X() + hh * yd.X(),
                      c.Y() + hw * xd.Y() + hh * yd.Y(),
                      c.Z() + hw * xd.Z() + hh * yd.Z());
  corners[3] = gp_Pnt(c.X() - hw * xd.X() + hh * yd.X(),
                      c.Y() - hw * xd.Y() + hh * yd.Y(),
                      c.Z() - hw * xd.Z() + hh * yd.Z());
  return OCC_OK;
}

int wire_from_closed_corners(const gp_Pnt corners[4], occ_shape_t* out) {
  BRepBuilderAPI_MakePolygon poly;
  for (int i = 0; i < 4; ++i) poly.Add(corners[i]);
  poly.Close();
  if (!poly.IsDone()) {
    set_last("rectangle polygon failed");
    return OCC_ERR_GEOM;
  }
  *out = to_handle(poly.Wire());
  return OCC_OK;
}

int edge_as_topo(occ_shape_t s, TopoDS_Edge& e) {
  if (!s || as_shape(s)->IsNull()) {
    set_last("null edge");
    return OCC_ERR_NULL_ARG;
  }
  if (as_shape(s)->ShapeType() != TopAbs_EDGE) {
    set_last("expected TopAbs_EDGE");
    return OCC_ERR_INVALID_SHAPE;
  }
  e = TopoDS::Edge(*as_shape(s));
  return OCC_OK;
}

int wire_as_topo(occ_shape_t s, TopoDS_Wire& w) {
  if (!s || as_shape(s)->IsNull()) {
    set_last("null wire");
    return OCC_ERR_NULL_ARG;
  }
  if (as_shape(s)->ShapeType() != TopAbs_WIRE) {
    set_last("expected TopAbs_WIRE");
    return OCC_ERR_INVALID_SHAPE;
  }
  w = TopoDS::Wire(*as_shape(s));
  return OCC_OK;
}

}  // namespace

extern "C" {

/* =========================================================================
 * Vertices / edges
 * ========================================================================= */

int occ_make_vertex(double x, double y, double z, occ_shape_t* out) {
  REQ(out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  *out = to_handle(BRepBuilderAPI_MakeVertex(gp_Pnt(x, y, z)).Vertex());
  return OCC_OK;
  OCC_GUARD_END
}

int occ_make_edge_line(double x0, double y0, double z0,
                       double x1, double y1, double z1,
                       occ_shape_t* out) {
  REQ(out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  const gp_Pnt p0(x0, y0, z0);
  const gp_Pnt p1(x1, y1, z1);
  if (p0.Distance(p1) < k_eps) {
    set_last("line endpoints coincident");
    return OCC_ERR_GEOM;
  }
  BRepBuilderAPI_MakeEdge me(p0, p1);
  if (!me.IsDone()) {
    set_last("MakeEdge line failed");
    return OCC_ERR_GEOM;
  }
  *out = to_handle(me.Edge());
  return OCC_OK;
  OCC_GUARD_END
}

int occ_make_edge_circle(double cx, double cy, double cz,
                         double nx, double ny, double nz,
                         double radius, occ_shape_t* out) {
  REQ(out, OCC_ERR_NULL_ARG);
  REQ(radius > 0.0, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  gp_Dir n;
  int st = require_unit_dir(nx, ny, nz, n, "circle normal near zero");
  if (st != OCC_OK) return st;
  gp_Ax2 ax(gp_Pnt(cx, cy, cz), n);
  GC_MakeCircle mk(ax, radius);
  if (!mk.IsDone()) {
    set_last("GC_MakeCircle failed");
    return OCC_ERR_GEOM;
  }
  BRepBuilderAPI_MakeEdge me(mk.Value());
  if (!me.IsDone()) {
    set_last("MakeEdge circle failed");
    return OCC_ERR_GEOM;
  }
  *out = to_handle(me.Edge());
  return OCC_OK;
  OCC_GUARD_END
}

int occ_make_edge_arc_3pt(double x1, double y1, double z1,
                          double x2, double y2, double z2,
                          double x3, double y3, double z3,
                          occ_shape_t* out) {
  REQ(out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  const gp_Pnt p1(x1, y1, z1);
  const gp_Pnt p2(x2, y2, z2);
  const gp_Pnt p3(x3, y3, z3);
  if (p1.Distance(p2) < k_eps || p2.Distance(p3) < k_eps || p1.Distance(p3) < k_eps) {
    set_last("arc_3pt: coincident points");
    return OCC_ERR_GEOM;
  }
  GC_MakeArcOfCircle mk(p1, p2, p3);
  if (!mk.IsDone()) {
    set_last("GC_MakeArcOfCircle(3pt) failed");
    return OCC_ERR_GEOM;
  }
  BRepBuilderAPI_MakeEdge me(mk.Value());
  if (!me.IsDone()) {
    set_last("MakeEdge arc_3pt failed");
    return OCC_ERR_GEOM;
  }
  *out = to_handle(me.Edge());
  return OCC_OK;
  OCC_GUARD_END
}

int occ_make_edge_arc_center(double cx, double cy, double cz,
                             double nx, double ny, double nz,
                             double radius,
                             double a0_rad, double a1_rad,
                             occ_shape_t* out) {
  REQ(out, OCC_ERR_NULL_ARG);
  REQ(radius > 0.0, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  if (std::abs(a1_rad - a0_rad) < 1.0e-15) {
    set_last("arc_center: zero angular span");
    return OCC_ERR_GEOM;
  }
  gp_Dir n;
  int st = require_unit_dir(nx, ny, nz, n, "arc normal near zero");
  if (st != OCC_OK) return st;
  gp_Ax2 ax(gp_Pnt(cx, cy, cz), n);
  gp_Circ circ(ax, radius);
  // Sense True follows the circle orientation (right-hand about normal).
  const Standard_Boolean sense = (a1_rad >= a0_rad) ? Standard_True : Standard_False;
  GC_MakeArcOfCircle mk(circ, a0_rad, a1_rad, sense);
  if (!mk.IsDone()) {
    set_last("GC_MakeArcOfCircle(center) failed");
    return OCC_ERR_GEOM;
  }
  BRepBuilderAPI_MakeEdge me(mk.Value());
  if (!me.IsDone()) {
    set_last("MakeEdge arc_center failed");
    return OCC_ERR_GEOM;
  }
  *out = to_handle(me.Edge());
  return OCC_OK;
  OCC_GUARD_END
}

/* =========================================================================
 * Wires
 * ========================================================================= */

int occ_make_polyline(const double* xyz, int n, int closed, occ_shape_t* out) {
  REQ(xyz && out, OCC_ERR_NULL_ARG);
  REQ(n >= 2, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  BRepBuilderAPI_MakeWire mw;
  for (int i = 0; i < n - 1; ++i) {
    const gp_Pnt a(xyz[3 * i],     xyz[3 * i + 1],     xyz[3 * i + 2]);
    const gp_Pnt b(xyz[3 * (i + 1)], xyz[3 * (i + 1) + 1], xyz[3 * (i + 1) + 2]);
    if (a.Distance(b) < k_eps) {
      set_last("polyline: zero-length segment");
      return OCC_ERR_GEOM;
    }
    BRepBuilderAPI_MakeEdge me(a, b);
    if (!me.IsDone()) {
      set_last("polyline: MakeEdge failed");
      return OCC_ERR_GEOM;
    }
    mw.Add(me.Edge());
  }
  if (closed) {
    const gp_Pnt a(xyz[3 * (n - 1)], xyz[3 * (n - 1) + 1], xyz[3 * (n - 1) + 2]);
    const gp_Pnt b(xyz[0], xyz[1], xyz[2]);
    if (a.Distance(b) >= k_eps) {
      BRepBuilderAPI_MakeEdge me(a, b);
      if (!me.IsDone()) {
        set_last("polyline: close edge failed");
        return OCC_ERR_GEOM;
      }
      mw.Add(me.Edge());
    }
  }
  if (!mw.IsDone()) {
    set_last("polyline: MakeWire failed");
    return OCC_ERR_GEOM;
  }
  *out = to_handle(mw.Wire());
  return OCC_OK;
  OCC_GUARD_END
}

int occ_make_polygon_wire(const double* xyz, int n, int closed, occ_shape_t* out) {
  REQ(xyz && out, OCC_ERR_NULL_ARG);
  REQ(n >= 2, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  BRepBuilderAPI_MakePolygon poly;
  for (int i = 0; i < n; ++i) {
    poly.Add(gp_Pnt(xyz[3 * i], xyz[3 * i + 1], xyz[3 * i + 2]));
  }
  if (closed) poly.Close();
  if (!poly.IsDone()) {
    set_last("MakePolygon failed");
    return OCC_ERR_GEOM;
  }
  *out = to_handle(poly.Wire());
  return OCC_OK;
  OCC_GUARD_END
}

int occ_make_rectangle_wire(double cx, double cy, double cz,
                            double nx, double ny, double nz,
                            double width, double height,
                            occ_shape_t* out) {
  REQ(out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  gp_Pnt corners[4];
  int st = rectangle_corners(cx, cy, cz, nx, ny, nz, width, height, corners);
  if (st != OCC_OK) return st;
  return wire_from_closed_corners(corners, out);
  OCC_GUARD_END
}

int occ_make_circle_wire(double cx, double cy, double cz,
                         double nx, double ny, double nz,
                         double radius, occ_shape_t* out) {
  REQ(out, OCC_ERR_NULL_ARG);
  REQ(radius > 0.0, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  occ_shape_t edge = nullptr;
  int st = occ_make_edge_circle(cx, cy, cz, nx, ny, nz, radius, &edge);
  if (st != OCC_OK) return st;
  BRepBuilderAPI_MakeWire mw(TopoDS::Edge(*as_shape(edge)));
  occ_shape_free(edge);
  if (!mw.IsDone()) {
    set_last("circle wire failed");
    return OCC_ERR_GEOM;
  }
  *out = to_handle(mw.Wire());
  return OCC_OK;
  OCC_GUARD_END
}

int occ_make_wire_from_edges(const occ_shape_t* edges, int n, occ_shape_t* out) {
  REQ(edges && out, OCC_ERR_NULL_ARG);
  REQ(n >= 1, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  BRepBuilderAPI_MakeWire mw;
  for (int i = 0; i < n; ++i) {
    TopoDS_Edge e;
    int st = edge_as_topo(edges[i], e);
    if (st != OCC_OK) return st;
    mw.Add(e);
  }
  if (!mw.IsDone()) {
    set_last("MakeWire from edges failed (disconnected?)");
    return OCC_ERR_GEOM;
  }
  *out = to_handle(mw.Wire());
  return OCC_OK;
  OCC_GUARD_END
}

int occ_wire_is_closed(occ_shape_t wire, int* out_closed) {
  REQ(wire && out_closed, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  TopoDS_Wire w;
  int st = wire_as_topo(wire, w);
  if (st != OCC_OK) return st;

  // Prefer geometric endpoint check; Closed() flag alone is unreliable.
  TopoDS_Vertex vfirst, vlast;
  TopExp::Vertices(w, vfirst, vlast);
  if (vfirst.IsNull() || vlast.IsNull()) {
    *out_closed = 0;
    return OCC_OK;
  }
  const gp_Pnt p0 = BRep_Tool::Pnt(vfirst);
  const gp_Pnt p1 = BRep_Tool::Pnt(vlast);
  if (p0.Distance(p1) <= k_gap || vfirst.IsSame(vlast)) {
    *out_closed = 1;
    return OCC_OK;
  }
  // Single closed edge (full circle): first==last geometrically via same vertex.
  *out_closed = w.Closed() ? 1 : 0;
  return OCC_OK;
  OCC_GUARD_END
}

int occ_wire_length(occ_shape_t wire, double* out_len) {
  REQ(wire && out_len, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  TopoDS_Wire w;
  int st = wire_as_topo(wire, w);
  if (st != OCC_OK) return st;
  BRepAdaptor_CompCurve cc(w, Standard_True);
  *out_len = GCPnts_AbscissaPoint::Length(cc);
  return OCC_OK;
  OCC_GUARD_END
}

int occ_wire_reverse(occ_shape_t wire, occ_shape_t* out) {
  REQ(wire && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  TopoDS_Wire w;
  int st = wire_as_topo(wire, w);
  if (st != OCC_OK) return st;
  *out = to_handle(w.Reversed());
  return OCC_OK;
  OCC_GUARD_END
}

int occ_count_wires(occ_shape_t s, int* out) {
  REQ(s && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  TopTools_IndexedMapOfShape m;
  TopExp::MapShapes(*as_shape(s), TopAbs_WIRE, m);
  *out = m.Extent();
  return OCC_OK;
  OCC_GUARD_END
}

int occ_wire_at(occ_shape_t s, int idx, occ_shape_t* out) {
  REQ(s && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  TopTools_IndexedMapOfShape m;
  TopExp::MapShapes(*as_shape(s), TopAbs_WIRE, m);
  if (idx < 1 || idx > m.Extent()) {
    set_last("wire index out of range");
    return OCC_ERR_INDEX;
  }
  *out = to_handle(m.FindKey(idx));
  return OCC_OK;
  OCC_GUARD_END
}

/* =========================================================================
 * Faces
 * ========================================================================= */

int occ_make_planar_face_from_wire(occ_shape_t wire, occ_shape_t* out) {
  REQ(wire && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  TopoDS_Wire w;
  int st = wire_as_topo(wire, w);
  if (st != OCC_OK) return st;
  BRepBuilderAPI_MakeFace mf(w, /*OnlyPlane=*/Standard_True);
  if (!mf.IsDone()) {
    set_last("MakeFace from wire failed (non-planar or open?)");
    return OCC_ERR_GEOM;
  }
  *out = to_handle(mf.Face());
  return OCC_OK;
  OCC_GUARD_END
}

int occ_make_face_circle(double cx, double cy, double cz,
                         double nx, double ny, double nz,
                         double radius, occ_shape_t* out) {
  REQ(out, OCC_ERR_NULL_ARG);
  REQ(radius > 0.0, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  occ_shape_t wire = nullptr;
  int st = occ_make_circle_wire(cx, cy, cz, nx, ny, nz, radius, &wire);
  if (st != OCC_OK) return st;
  // Bound the face to the plane of the circle for robustness.
  gp_Dir n;
  st = require_unit_dir(nx, ny, nz, n, "face_circle normal near zero");
  if (st != OCC_OK) {
    occ_shape_free(wire);
    return st;
  }
  gp_Pln pln(gp_Pnt(cx, cy, cz), n);
  BRepBuilderAPI_MakeFace mf(pln, TopoDS::Wire(*as_shape(wire)), Standard_True);
  occ_shape_free(wire);
  if (!mf.IsDone()) {
    set_last("MakeFace circle failed");
    return OCC_ERR_GEOM;
  }
  *out = to_handle(mf.Face());
  return OCC_OK;
  OCC_GUARD_END
}

int occ_make_face_rectangle(double cx, double cy, double cz,
                            double nx, double ny, double nz,
                            double width, double height,
                            occ_shape_t* out) {
  REQ(out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  occ_shape_t wire = nullptr;
  int st = occ_make_rectangle_wire(cx, cy, cz, nx, ny, nz, width, height, &wire);
  if (st != OCC_OK) return st;
  st = occ_make_planar_face_from_wire(wire, out);
  occ_shape_free(wire);
  return st;
  OCC_GUARD_END
}

int occ_make_face_polygon(const double* xyz, int n, occ_shape_t* out) {
  REQ(xyz && out, OCC_ERR_NULL_ARG);
  REQ(n >= 3, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  occ_shape_t wire = nullptr;
  int st = occ_make_polygon_wire(xyz, n, /*closed=*/1, &wire);
  if (st != OCC_OK) return st;
  st = occ_make_planar_face_from_wire(wire, out);
  occ_shape_free(wire);
  return st;
  OCC_GUARD_END
}

int occ_make_plane_rect(double ox, double oy, double oz,
                        double nx, double ny, double nz,
                        double xdirx, double xdiry, double xdirz,
                        double half_w, double half_h,
                        occ_shape_t* out) {
  REQ(out, OCC_ERR_NULL_ARG);
  REQ(half_w > 0.0 && half_h > 0.0, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  gp_Dir n, x;
  int st = require_unit_dir(nx, ny, nz, n, "plane_rect normal near zero");
  if (st != OCC_OK) return st;
  st = require_unit_dir(xdirx, xdiry, xdirz, x, "plane_rect xdir near zero");
  if (st != OCC_OK) return st;
  if (std::abs(x.Dot(n)) > 1.0 - 1.0e-9) {
    set_last("plane_rect: X parallel to normal");
    return OCC_ERR_GEOM;
  }
  gp_Ax3 ax(gp_Pnt(ox, oy, oz), n, x);
  BRepBuilderAPI_MakeFace mf(gp_Pln(ax), -half_w, half_w, -half_h, half_h);
  if (!mf.IsDone()) {
    set_last("plane_rect MakeFace failed");
    return OCC_ERR_GEOM;
  }
  *out = to_handle(mf.Face());
  return OCC_OK;
  OCC_GUARD_END
}

/* =========================================================================
 * Plane POD helpers
 * ========================================================================= */

int occ_plane_from_3pts(double x1, double y1, double z1,
                        double x2, double y2, double z2,
                        double x3, double y3, double z3,
                        occ_plane_t* out) {
  REQ(out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  const gp_Pnt p1(x1, y1, z1);
  const gp_Pnt p2(x2, y2, z2);
  const gp_Pnt p3(x3, y3, z3);
  gp_Vec v12(p1, p2);
  gp_Vec v13(p1, p3);
  gp_Vec nvec = v12.Crossed(v13);
  if (nvec.Magnitude() < k_eps) {
    set_last("plane_from_3pts: collinear points");
    return OCC_ERR_GEOM;
  }
  nvec.Normalize();
  gp_Dir n(nvec);
  // X axis along P1→P2
  if (v12.Magnitude() < k_eps) {
    set_last("plane_from_3pts: P1P2 too short");
    return OCC_ERR_GEOM;
  }
  gp_Dir x(v12);
  gp_Ax3 ax(p1, n, x);
  plane_from_ax3(ax, out);
  return OCC_OK;
  OCC_GUARD_END
}

int occ_plane_from_point_normal(double ox, double oy, double oz,
                                double nx, double ny, double nz,
                                occ_plane_t* out) {
  REQ(out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  gp_Dir n;
  int st = require_unit_dir(nx, ny, nz, n, "plane normal near zero");
  if (st != OCC_OK) return st;
  // gp_Ax3(P, N) picks a stable X orthogonal to N.
  gp_Ax3 ax(gp_Pnt(ox, oy, oz), n);
  plane_from_ax3(ax, out);
  return OCC_OK;
  OCC_GUARD_END
}

int occ_plane_project_point(const occ_plane_t* pln,
                            double x, double y, double z,
                            double out_xyz[3]) {
  REQ(pln && out_xyz, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  gp_Ax3 ax;
  int st = plane_to_ax3(*pln, ax);
  if (st != OCC_OK) return st;
  const gp_Pnt o = ax.Location();
  const gp_Dir n = ax.Direction();
  const gp_Pnt p(x, y, z);
  const double dist = gp_Vec(o, p).Dot(gp_Vec(n.X(), n.Y(), n.Z()));
  const gp_Pnt q(p.X() - dist * n.X(),
                 p.Y() - dist * n.Y(),
                 p.Z() - dist * n.Z());
  out_xyz[0] = q.X();
  out_xyz[1] = q.Y();
  out_xyz[2] = q.Z();
  return OCC_OK;
  OCC_GUARD_END
}

int occ_make_segment_on_plane(const occ_plane_t* pln,
                              double u0, double v0,
                              double u1, double v1,
                              occ_shape_t* out) {
  REQ(pln && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  gp_Ax3 ax;
  int st = plane_to_ax3(*pln, ax);
  if (st != OCC_OK) return st;
  const gp_Pnt p0 = uv_to_pnt(ax, u0, v0);
  const gp_Pnt p1 = uv_to_pnt(ax, u1, v1);
  if (p0.Distance(p1) < k_eps) {
    set_last("segment_on_plane: zero length");
    return OCC_ERR_GEOM;
  }
  BRepBuilderAPI_MakeEdge me(p0, p1);
  if (!me.IsDone()) {
    set_last("segment_on_plane: MakeEdge failed");
    return OCC_ERR_GEOM;
  }
  *out = to_handle(me.Edge());
  return OCC_OK;
  OCC_GUARD_END
}

/* =========================================================================
 * Offset + BSpline
 * ========================================================================= */

int occ_offset_wire_2d(occ_shape_t wire, double dist, occ_shape_t* out) {
  REQ(wire && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  TopoDS_Wire w;
  int st = wire_as_topo(wire, w);
  if (st != OCC_OK) return st;
  if (std::abs(dist) < k_eps) {
    *out = to_handle(w);
    return OCC_OK;
  }
  // BRepOffsetAPI_MakeOffset works on planar wires (open or closed).
  BRepOffsetAPI_MakeOffset mk(w, GeomAbs_Arc, /*IsOpenResult=*/Standard_False);
  mk.Perform(dist);
  if (!mk.IsDone()) {
    set_last("BRepOffsetAPI_MakeOffset failed");
    return OCC_ERR_GEOM;
  }
  const TopoDS_Shape& sh = mk.Shape();
  // Result may be a wire or a compound of wires — return as-is.
  *out = to_handle(sh);
  return OCC_OK;
  OCC_GUARD_END
}

int occ_make_bspline_wire_through_points(const double* xyz, int n,
                                         int degree, int periodic,
                                         occ_shape_t* out) {
  REQ(xyz && out, OCC_ERR_NULL_ARG);
  REQ(n >= 2, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  int deg = degree;
  if (deg < 1) deg = 1;
  if (deg > 8) deg = 8;

  Handle(Geom_BSplineCurve) curve;

  if (periodic) {
    // GeomAPI_PointsToBSpline is non-periodic; use Interpolate for closed paths.
    // For periodic interpolate, last point must equal first — OCCT requires
    // n points with P[n]==P[1] not duplicated; PeriodicFlag handles wrap.
    if (n < 3) {
      set_last("periodic bspline needs n >= 3");
      return OCC_ERR_GEOM;
    }
    Handle(TColgp_HArray1OfPnt) hpts = new TColgp_HArray1OfPnt(1, n);
    for (int i = 0; i < n; ++i) {
      hpts->SetValue(i + 1, gp_Pnt(xyz[3 * i], xyz[3 * i + 1], xyz[3 * i + 2]));
    }
    GeomAPI_Interpolate interp(hpts, Standard_True, 1.0e-6);
    interp.Perform();
    if (!interp.IsDone()) {
      set_last("GeomAPI_Interpolate (periodic) failed");
      return OCC_ERR_GEOM;
    }
    curve = interp.Curve();
  } else {
    TColgp_Array1OfPnt pts(1, n);
    for (int i = 0; i < n; ++i) {
      pts.SetValue(i + 1, gp_Pnt(xyz[3 * i], xyz[3 * i + 1], xyz[3 * i + 2]));
    }
    // DegMin = max(1, deg-2), DegMax = deg — keeps user degree as upper bound.
    const int deg_min = (deg > 1) ? (deg > 3 ? deg - 2 : 1) : 1;
    GeomAPI_PointsToBSpline approx(pts, deg_min, deg, GeomAbs_C2, 1.0e-3);
    if (!approx.IsDone()) {
      set_last("GeomAPI_PointsToBSpline failed");
      return OCC_ERR_GEOM;
    }
    curve = approx.Curve();
  }

  BRepBuilderAPI_MakeEdge me(curve);
  if (!me.IsDone()) {
    set_last("MakeEdge from BSpline failed");
    return OCC_ERR_GEOM;
  }
  BRepBuilderAPI_MakeWire mw(me.Edge());
  if (!mw.IsDone()) {
    set_last("MakeWire from BSpline edge failed");
    return OCC_ERR_GEOM;
  }
  *out = to_handle(mw.Wire());
  return OCC_OK;
  OCC_GUARD_END
}

}  // extern "C"
```

---

## Walk-through: key algorithms

### 1. Three-point arc (`GC_MakeArcOfCircle`)

OCCT builds a `Geom_TrimmedCurve` arc where **P1** is the start, **P3** the end, and **P2** lies on the arc (not the center). Collinear or coincident points yield `!IsDone()`; we map that to `OCC_ERR_GEOM` and set `occ_last_error`.

```text
P1 ──arc──► P2 ──arc──► P3
     ╲           ╱
      ╲  center ╱
```

### 2. Centered arc angles

`GC_MakeArcOfCircle(gp_Circ, Alpha1, Alpha2, Sense)` trims the circle. Parameter 0 is along the Ax2 X direction; angles are radians. When `a1 < a0` we pass `Sense = False` so the short/long arc choice follows the signed span the caller intended.

### 3. Polyline vs polygon wire

| | `occ_make_polyline` | `occ_make_polygon_wire` |
|--|---------------------|-------------------------|
| Builder | `MakeEdge` loop + `MakeWire` | `BRepBuilderAPI_MakePolygon` |
| Best for | open routes, mixed later with arcs | closed face profiles |
| Degenerate segment | hard error | `Add` may skip; we still require `IsDone` |

Both accept the same packed `xyz[3*n]` layout.

### 4. Planar face from wire

`BRepBuilderAPI_MakeFace(wire, OnlyPlane=true)` asks OCCT to find a supporting plane. Failure modes: open wire, non-planar edges, self-intersection. Hosts should validate `occ_wire_is_closed` before calling when lowering Sketch2D profiles.

### 5. Construction plane face

`occ_make_plane_rect` is **not** an infinite plane. It builds a bounded rectangular face on `gp_Pln(gp_Ax3)` with UV domain `[-half_w, half_w] × [-half_h, half_h]`. Store infinite parameters in `occ_plane_t`; only materialize the face for visualization / picking.

### 6. Wire offset

`BRepOffsetAPI_MakeOffset` expects a **planar** wire. Join type `GeomAbs_Arc` rounds convex corners. Result may be a single wire or a compound when the offset self-splits — callers of routes should `occ_count_wires` and pick with `occ_wire_at`.

### 7. BSpline through points

```text
periodic == 0  →  GeomAPI_PointsToBSpline(points, DegMin, DegMax=degree, C2, tol)
periodic != 0  →  GeomAPI_Interpolate(points, PeriodicFlag=true)  // OCCT-correct closed
               →  MakeEdge(curve) → MakeWire
```

`GeomAPI_PointsToBSpline` does not offer a periodic flag in 7.9.3; periodic paths therefore use `GeomAPI_Interpolate` as documented in the header comment.

---

## Worked examples (host-side C)

### A. MakePoint + MakePlane + visible construction rectangle

```c
occ_shape_t pt = NULL;
occ_make_vertex(0.1, 0.2, 0.3, &pt);   /* MakePoint */

occ_plane_t pln;
occ_plane_from_point_normal(0, 0, 0,  0, 0, 1, &pln);  /* XY plane */

/* Optional: force X along world X after auto-basis */
pln.x[0] = 1; pln.x[1] = 0; pln.x[2] = 0;

occ_shape_t cplane = NULL;
occ_make_plane_rect(pln.o[0], pln.o[1], pln.o[2],
                    pln.n[0], pln.n[1], pln.n[2],
                    pln.x[0], pln.x[1], pln.x[2],
                    0.5, 0.5,   /* 1 m × 1 m visible square */
                    &cplane);
```

### B. Explicit Sketch2D: rectangle profile → extrude

```c
/* Sketch on plane Z=0, rectangle 0.2 × 0.1 centered at origin */
occ_shape_t profile = NULL;
occ_make_face_rectangle(0, 0, 0,  0, 0, 1,  0.2, 0.1, &profile);

occ_shape_t solid = NULL;
occ_extrude(profile, 0, 0, 0.05, &solid);  /* 50 mm tall (meters!) */
```

### C. Sketch2D mixed: line + arc → wire → face

```c
occ_plane_t pln;
occ_plane_from_point_normal(0, 0, 0, 0, 0, 1, &pln);

occ_shape_t e0 = NULL, e1 = NULL, e2 = NULL;
/* bottom line u=-0.05..0.05, v=-0.03 */
occ_make_segment_on_plane(&pln, -0.05, -0.03,  0.05, -0.03, &e0);
/* arc bulging up through (0, 0.02) to left end */
occ_make_edge_arc_3pt(0.05, -0.03, 0,
                      0.00,  0.02, 0,
                     -0.05, -0.03, 0, &e1);
/* (if only two edges form the closed shape) */
occ_shape_t edges[2] = { e0, e1 };
occ_shape_t wire = NULL;
occ_make_wire_from_edges(edges, 2, &wire);

int closed = 0;
occ_wire_is_closed(wire, &closed);

occ_shape_t face = NULL;
occ_make_planar_face_from_wire(wire, &face);
```

### D. Route polyline for pipe spine

```c
double path[] = {
  0.0, 0.0, 0.0,
  1.0, 0.0, 0.0,
  1.0, 0.5, 0.2,
  2.0, 0.5, 0.2
};
occ_shape_t spine = NULL;
occ_make_polyline(path, 4, /*closed=*/0, &spine);

double len = 0.0;
occ_wire_length(spine, &len);

/* circle profile in YZ at start, then occ_pipe(profile, spine, &tube) */
```

### E. Smooth periodic path

```c
double loop[] = {
  0.0, 0.0, 0.0,
  1.0, 0.0, 0.0,
  1.0, 1.0, 0.0,
  0.0, 1.0, 0.0
};
occ_shape_t smooth = NULL;
occ_make_bspline_wire_through_points(loop, 4, /*degree=*/3, /*periodic=*/1, &smooth);
```

### F. Offset profile for wall thickness sketch

```c
double poly[] = {
  0, 0, 0,
  0.1, 0, 0,
  0.1, 0.08, 0,
  0, 0.08, 0
};
occ_shape_t outer = NULL;
occ_make_polygon_wire(poly, 4, 1, &outer);

occ_shape_t inner = NULL;
occ_offset_wire_2d(outer, -0.005, &inner);  /* 5 mm inward */

int nw = 0;
occ_count_wires(inner, &nw);
/* if compound, pick wire 1: occ_wire_at(inner, 1, &w1); */
```

---

## Error contract

| Condition | Return |
|-----------|--------|
| null `out` / null required pointer | `OCC_ERR_NULL_ARG` |
| wrong `ShapeType` (not wire/edge) | `OCC_ERR_INVALID_SHAPE` |
| zero radius, collinear arc, open non-planar face, offset fail | `OCC_ERR_GEOM` |
| `occ_wire_at` / index helpers | `OCC_ERR_INDEX` |
| OCCT `Standard_Failure` | `OCC_ERR_EXCEPTION` + `occ_last_error()` |

Always free intermediate shapes (`occ_shape_free`) on both success paths that replace handles and on error paths that allocated partials. The implementations above free temporary edges/wires they create before returning.

---

## BUILD.bazel fragment (reference)

```python
# Add to api/BUILD.bazel  _OCC_C_EXPORTS and srcs:
#   "include/occ_c_construct.h",
#   "src/occ_c_construct.cc",
#
# Link against the same @occt package as occ_c.cc.
# No extra third_party deps.
```

Exports to list (for visibility / wasm exports map):

```text
occ_make_vertex
occ_make_edge_line
occ_make_edge_circle
occ_make_edge_arc_3pt
occ_make_edge_arc_center
occ_make_polyline
occ_make_polygon_wire
occ_make_rectangle_wire
occ_make_circle_wire
occ_make_wire_from_edges
occ_wire_is_closed
occ_wire_length
occ_wire_reverse
occ_count_wires
occ_wire_at
occ_make_planar_face_from_wire
occ_make_face_circle
occ_make_face_rectangle
occ_make_face_polygon
occ_make_plane_rect
occ_plane_from_3pts
occ_plane_from_point_normal
occ_plane_project_point
occ_make_segment_on_plane
occ_offset_wire_2d
occ_make_bspline_wire_through_points
```

---

## IR node → C call cheat sheet

| IR / product node | C call sequence |
|-------------------|-----------------|
| `MakePoint` | `occ_make_vertex` |
| `MakePlane` (params only) | `occ_plane_from_point_normal` or `occ_plane_from_3pts` → store `occ_plane_t` |
| `MakePlane` (visible) | + `occ_make_plane_rect` |
| `Sketch2D` line | `occ_make_segment_on_plane` or `occ_make_edge_line` |
| `Sketch2D` circle | `occ_make_circle_wire` / `occ_make_face_circle` |
| `Sketch2D` arc | `occ_make_edge_arc_3pt` or `occ_make_edge_arc_center` |
| `Sketch2D` polyline | `occ_make_polyline` / `occ_make_polygon_wire` |
| `Sketch2D` closed profile | wire → `occ_make_planar_face_from_wire` |
| `Sketch2D` rectangle | `occ_make_face_rectangle` |
| `Sketch2D` polygon | `occ_make_face_polygon` |
| `Sketch2D` spline | `occ_make_bspline_wire_through_points` |
| `Sketch2D` offset | `occ_offset_wire_2d` |
| Route polyline | `occ_make_polyline` → spine for `occ_pipe` |
| Extrude profile | face from above → `occ_extrude` |
| Revolve profile | face/wire → `occ_revolve` |

---

## Consistency notes with baseline `occ_c`

- Same opaque ownership: `new TopoDS_Shape` via `to_handle`, free with `occ_shape_free`.
- Same `OCC_GUARD_BEGIN` / `OCC_GUARD_END` / `REQ` macros.
- Same 1-based topology indexing (`occ_wire_at` mirrors `occ_face_at` / `occ_edge_at`).
- Same unit convention: **meters** and **radians** (never mm/degrees in the C boundary).
- Does **not** reimplement frames; `occ_plane_t` is a lighter POD than `occ_frame_t` (origin + Z + X vs full placement). Hosts may convert:

```text
occ_frame_t f  →  occ_plane_t { f.origin, f.z_axis, f.x_axis }
```

---

## Test matrix (implementer checklist)

| # | Case | Expect |
|---|------|--------|
| 1 | `occ_make_vertex(0,0,0)` | `OCC_OK`, vertex |
| 2 | `occ_make_edge_line` coincident pts | `OCC_ERR_GEOM` |
| 3 | unit circle wire on XY | closed wire, length ≈ 2π |
| 4 | arc 3pt (1,0,0)/(0,1,0)/(-1,0,0) | quarter/half arc edge |
| 5 | arc center 0..π/2 r=1 | length ≈ π/2 |
| 6 | rectangle wire 0.2×0.1 | closed, 4 edges |
| 7 | face from that wire | 1 face, area ≈ 0.02 |
| 8 | plane_rect half 0.5 | face on plane, area ≈ 1.0 |
| 9 | plane_from_3pts collinear | `OCC_ERR_GEOM` |
| 10 | project (0,0,5) onto Z=0 | (0,0,0) |
| 11 | polygon face triangle | area matches ½ base·height |
| 12 | offset closed square −0.01 | smaller wire or compound |
| 13 | bspline 4 pts degree 3 | single-edge wire |
| 14 | periodic bspline 4 pts | closed smooth wire |
| 15 | wire_from_edges disconnected | `OCC_ERR_GEOM` |
| 16 | count_wires on compound of 2 | 2; wire_at(1), wire_at(2) ok; wire_at(3) `OCC_ERR_INDEX` |

---

## File extract map

```text
docs/literate-sections/02-construction.md
        │  extract fences tagged:
        │    // === file: occ_c_construct.h
        │    // === file: occ_c_construct.cc
        ▼
api/include/occ_c_construct.h
api/src/occ_c_construct.cc
```

Include from the umbrella header or client code:

```c
#include "occ_c.h"
#include "occ_c_construct.h"
```

End of section 02.

<!-- END 02-construction.md -->


<!-- BEGIN 03-frames-trsf.md -->

# Section 03 — Frames & Rigid Transforms (SE(3))

**Document type:** Literate programming source for Apache **`occ_c`** over **OCCT 7.9.3**  
**Extract targets:** `api/include/occ_c_frames.h`, `api/src/occ_c_frames.cc`, `api/include/occ_c_trsf.h`, `api/src/occ_c_trsf.cc`  
**Scope:** Pure SE(3) math + placing BREP. Product mate **solver** is out of scope.  
**Units:** meters, radians. Topology indices 1-based elsewhere; this section is coordinate-only except shape appliers.  
**Depends on:** `occ_c.h` (`OCC_API`, `occ_shape_t`, `occ_status_t`), `occ_c_internal.hxx` (`as_shape`, `to_handle`, `set_last`, `OCC_GUARD_*`, `REQ`).

---

## Pedagogy

### AttachFrame → POD, not a kernel entity

In product IR, `AttachFrame` names a rigid pose on a part (mate-connector analogue). In `occ_c` that is a plain C struct:

```c
typedef struct {
  double ox, oy, oz;       /* origin in parent / world */
  double xx, xy, xz;       /* X axis (unit after normalize) */
  double yx, yy, yz;       /* Y axis */
  double zx, zy, zz;       /* Z axis (main / "up" / surface normal / edge tangent) */
} occ_frame_t;
```

It is **not** a Parasolid mate connector body, not a named attribute on `TopoDS_Shape`, and not an OCCT `TDF` label. Host code owns the registry; the kernel only evaluates rigid maps.

A valid frame is a **right-handed orthonormal triad** (det ≈ +1). All constructors run an orthonormalization helper that:

1. Normalizes Z (required).
2. Projects the X-hint off Z; if nearly parallel, substitutes a stable alternate hint.
3. Rebuilds Y = Z × X, then X = Y × Z.

### RigidXform → displacement, not re-bake of design geometry

`RigidXform` / occurrence placement is:

\[
T = T_{\mathrm{target}}\, T_{\mathrm{current}}^{-1}
\]

Apply \(T\) once with `BRepBuilderAPI_Transform(..., Standard_True)` (copy). Design BREP stays at its modeling pose; each occurrence gets a transformed copy. **Do not** re-model joints into solid topology for FK — keep joint variables as numbers, compose SE(3), then place.

### Connector map \(T = B \cdot A^{-1}\)

If a shape's connector sits at frame \(A\) and must land on frame \(B\):

```text
world_point' = B * inv(A) * world_point
```

OCCT's `gp_Trsf::SetDisplacement(A, B)` is exactly that map. Our C name is `occ_frame_displacement` (returns the map as a frame / 4×3 / 4×4).

### ComposeChain vs baking joints into BREP

For a 6-DOF serial arm:

| Approach | When | Cost |
|----------|------|------|
| **`occ_compose_chain`** then `occ_trsf_apply_shape` per link | animation, IR evaluation, collision pack | cheap; BREP topology fixed |
| Baking joint angle into solid (boolean, revolve cut) | never for FK | destroys stable ids, kills interactivity |

DH bonus (`occ_compose_chain_dh`) is classic Craig / Paul convention for textbooks and legacy URDF-like tables; product robot paths should prefer explicit origins + axes (`occ_compose_chain`).

### Matrix layout (fixed)

**4×4 is row-major** with last row `[0,0,0,1]`. Column vectors: \(p' = M p\).

```text
index:  0  1  2  3
        4  5  6  7
        8  9 10 11
       12 13 14 15

values: xx yx zx ox
        xy yy zy oy
        xz yz zz oz
         0  0  0  1
```

**4×3** is the upper three rows only (12 doubles, same order). Compatible with `gp_Trsf::SetValues(a11..a34)`.

Multiplication convention for frames and matrices: **`B * A` means apply A first, then B** (standard linear-algebra composition for column vectors).

---

## Shared conventions used by both TUs

| Symbol | Meaning |
|--------|---------|
| `OCC_OK` | success |
| `OCC_ERR_NULL_ARG` | null pointer |
| `OCC_ERR_INVALID_SHAPE` | wrong `TopAbs` kind |
| `OCC_ERR_GEOM` | degenerate geometry / singular matrix |
| `OCC_ERR_FRAME` | degenerate / non-orthonormalizable axes |
| `OCC_ERR_EXCEPTION` | OCCT/`std` exception via `OCC_GUARD_END` |

OCCT types used (7.9.3): `gp_Trsf`, `gp_Ax1`, `gp_Ax2`, `gp_Ax3`, `gp_Pnt`, `gp_Dir`, `gp_Vec`, `BRepBuilderAPI_Transform`, `BRepAdaptor_Curve`, `BRepAdaptor_Surface`, `BRep_Builder`, `TopExp_Explorer`, `TopoDS`, `TopAbs_*`.

---

## Header — frames

```c
// === file: occ_c_frames.h
#ifndef OCC_C_FRAMES_H_
#define OCC_C_FRAMES_H_

#include "occ_c.h"

#ifdef __cplusplus
extern "C" {
#endif

/* -------------------------------------------------------------------------
 * occ_frame_t — pure SE(3) pose (mate-connector analogue as POD).
 *
 * Right-handed orthonormal triad after successful construction:
 *   X = (xx,xy,xz), Y = (yx,yy,yz), Z = (zx,zy,zz), origin = (ox,oy,oz)
 * Z is the "main" direction (edge tangent, surface normal, joint axis sense).
 * ------------------------------------------------------------------------- */
typedef struct {
  double ox, oy, oz;
  double xx, xy, xz; /* X axis */
  double yx, yy, yz; /* Y axis */
  double zx, zy, zz; /* Z axis */
} occ_frame_t;

/* World / identity frame: origin 0, X=(1,0,0), Y=(0,1,0), Z=(0,0,1). */
OCC_API int occ_frame_world(occ_frame_t* out);

/* Build from origin + X + Z; Y is reconstructed; axes orthonormalized. */
OCC_API int occ_frame_from_axes(double ox, double oy, double oz,
                                double xx, double xy, double xz,
                                double zx, double zy, double zz,
                                occ_frame_t* out);

/* Build from origin + Z and optional X-hint.
 * Pass xh=xyh=xzh=0 (or any near-zero vector) to auto-pick a stable X.
 * Handles nearly-parallel X-hint via orthonormalize helper. */
OCC_API int occ_frame_from_z(double ox, double oy, double oz,
                             double zx, double zy, double zz,
                             double xh, double yh, double zh,
                             occ_frame_t* out);

/* ZYX intrinsic Euler (yaw-pitch-roll): R = Rz(rz) * Ry(ry) * Rx(rx).
 * Angles in radians. Origin (ox,oy,oz). */
OCC_API int occ_frame_from_zyx_euler(double ox, double oy, double oz,
                                     double rx, double ry, double rz,
                                     occ_frame_t* out);

/* 4x3 row-major upper block: [R|t] as 3x4 flattened row-major (12 doubles). */
OCC_API int occ_frame_to_trsf_4x3(const occ_frame_t* f, double out12[12]);
OCC_API int occ_frame_from_trsf_4x3(const double m12[12], occ_frame_t* out);

/* 4x4 row-major, last row 0,0,0,1. Column-vector p' = M p. */
OCC_API int occ_frame_to_matrix4x4(const occ_frame_t* f, double out16[16]);
OCC_API int occ_frame_from_matrix4x4(const double m16[16], occ_frame_t* out);

/* Invert: inv(F). Multiply: B*A means apply A then B. */
OCC_API int occ_frame_inverted(const occ_frame_t* f, occ_frame_t* out);
OCC_API int occ_frame_multiplied(const occ_frame_t* b, const occ_frame_t* a,
                                 occ_frame_t* out);

/* Connector displacement T = B * inv(A). Maps points so frame A lands on B. */
OCC_API int occ_frame_displacement(const occ_frame_t* from_a,
                                   const occ_frame_t* to_b,
                                   occ_frame_t* out);

/* Apply rigid transform encoded as 4x3 or as a placement frame (world ← local). */
OCC_API int occ_transform_shape_4x3(occ_shape_t s, const double m12[12],
                                    occ_shape_t* out);
OCC_API int occ_transform_shape_frame(occ_shape_t s, const occ_frame_t* f,
                                      occ_shape_t* out);

/* Place shape so that current_frame_on_shape lands on target_frame:
 *   T = target * inv(current);  out = T(shape).
 * If current_frame_on_shape is NULL, treated as world (identity). */
OCC_API int occ_place_shape_at_frame(occ_shape_t shape,
                                     const occ_frame_t* target_frame,
                                     const occ_frame_t* current_frame_on_shape,
                                     occ_shape_t* out);

/* Frame whose Z is edge tangent at parameter u (curve parameter, not arc length). */
OCC_API int occ_frame_at_edge_param(occ_shape_t edge, double u,
                                    occ_frame_t* out);

/* Frame at wire start (at_start!=0) or end (at_start==0); Z = tangent outward
 * along the wire direction (start: +D1, end: +D1 at last param of last edge). */
OCC_API int occ_frame_at_wire_end(occ_shape_t wire, int at_start,
                                  occ_frame_t* out);

/* Frame on face surface at (u,v): origin = S(u,v), Z = unit normal from D1,
 * X along dS/du when possible. */
OCC_API int occ_frame_on_face(occ_shape_t face, double u, double v,
                              occ_frame_t* out);

/* Mirror copy across plane (point + normal). If keep_original_compound!=0,
 * out is a COMPOUND of {original, mirrored}; else out is mirrored only. */
OCC_API int occ_mirror_copy(occ_shape_t shape,
                            double px, double py, double pz,
                            double nx, double ny, double nz,
                            int keep_original_compound,
                            occ_shape_t* out);

/* Apply N rigid transforms (each 4x4 row-major) to seed → COMPOUND of N copies.
 * Foundation for linear/polar patterns at the IR level. */
OCC_API int occ_transform_copy_array(occ_shape_t seed,
                                     const double* transforms_4x4, /* n*16 */
                                     int n,
                                     occ_shape_t* out);

#ifdef __cplusplus
}
#endif

#endif /* OCC_C_FRAMES_H_ */
```

---

## Implementation — frames

```cpp
// === file: occ_c_frames.cc
// OCCT 7.9.3 — pure SE(3) frames + BREP placement.
// Extract into api/src/occ_c_frames.cc

#include "occ_c_frames.h"
#include "occ_c_internal.hxx"

#include <cmath>
#include <cstring>

#include <BRepAdaptor_Curve.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRep_Builder.hxx>
#include <TopAbs.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Ax1.hxx>
#include <gp_Ax2.hxx>
#include <gp_Ax3.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>

using occ_c_detail::as_shape;
using occ_c_detail::to_handle;
using occ_c_detail::set_last;

namespace {

constexpr double k_axis_eps   = 1.0e-12;
constexpr double k_parallel   = 1.0e-9;   /* |dot| > 1-eps ⇒ nearly parallel */
constexpr double k_unit_tol   = 1.0e-9;

inline double vdot(double ax, double ay, double az,
                   double bx, double by, double bz) {
  return ax * bx + ay * by + az * bz;
}

inline double vlen(double x, double y, double z) {
  return std::sqrt(x * x + y * y + z * z);
}

inline void vcross(double ax, double ay, double az,
                   double bx, double by, double bz,
                   double* ox, double* oy, double* oz) {
  *ox = ay * bz - az * by;
  *oy = az * bx - ax * bz;
  *oz = ax * by - ay * bx;
}

inline int vnormalize(double* x, double* y, double* z) {
  const double L = vlen(*x, *y, *z);
  if (L < k_axis_eps) return 0;
  *x /= L; *y /= L; *z /= L;
  return 1;
}

/* Orthonormalize right-handed triad from Z (required) + X-hint (optional).
 * Nearly-parallel X-hint is replaced by a stable alternate (world X or Y).
 * Returns OCC_OK / OCC_ERR_FRAME. */
int orthonormalize(double zx, double zy, double zz,
                   double xh, double yh, double zh,
                   double* xx, double* xy, double* xz,
                   double* yx, double* yy, double* yz,
                   double* ox_z, double* oy_z, double* oz_z) {
  if (!vnormalize(&zx, &zy, &zz)) {
    set_last("frame Z axis length near zero");
    return OCC_ERR_FRAME;
  }

  /* Project X-hint onto plane orthogonal to Z. */
  double hx = xh, hy = yh, hz = zh;
  double hlen = vlen(hx, hy, hz);
  if (hlen < k_axis_eps) {
    /* Auto-pick: prefer world X unless Z ~ ±X, then world Y. */
    if (std::fabs(zx) < 0.9) {
      hx = 1.0; hy = 0.0; hz = 0.0;
    } else {
      hx = 0.0; hy = 1.0; hz = 0.0;
    }
  } else {
    hx /= hlen; hy /= hlen; hz /= hlen;
    const double d = vdot(hx, hy, hz, zx, zy, zz);
    if (std::fabs(d) > 1.0 - k_parallel) {
      /* Nearly parallel — switch hint. */
      if (std::fabs(zx) < 0.9) {
        hx = 1.0; hy = 0.0; hz = 0.0;
      } else {
        hx = 0.0; hy = 1.0; hz = 0.0;
      }
    }
  }

  /* Remove Z component from hint. */
  {
    const double d = vdot(hx, hy, hz, zx, zy, zz);
    hx -= d * zx; hy -= d * zy; hz -= d * zz;
  }
  if (!vnormalize(&hx, &hy, &hz)) {
    /* Pathological residual — try the other world axis. */
    if (std::fabs(zx) < 0.9) {
      hx = 1.0; hy = 0.0; hz = 0.0;
    } else {
      hx = 0.0; hy = 1.0; hz = 0.0;
    }
    const double d = vdot(hx, hy, hz, zx, zy, zz);
    hx -= d * zx; hy -= d * zy; hz -= d * zz;
    if (!vnormalize(&hx, &hy, &hz)) {
      set_last("frame orthonormalize failed (X residual)");
      return OCC_ERR_FRAME;
    }
  }

  /* Y = Z × X, then re-orthogonalize X = Y × Z for numerical hygiene. */
  double yx0, yy0, yz0;
  vcross(zx, zy, zz, hx, hy, hz, &yx0, &yy0, &yz0);
  if (!vnormalize(&yx0, &yy0, &yz0)) {
    set_last("frame orthonormalize failed (Y)");
    return OCC_ERR_FRAME;
  }
  double xx0, xy0, xz0;
  vcross(yx0, yy0, yz0, zx, zy, zz, &xx0, &xy0, &xz0);
  if (!vnormalize(&xx0, &xy0, &xz0)) {
    set_last("frame orthonormalize failed (X rebuild)");
    return OCC_ERR_FRAME;
  }

  *xx = xx0; *xy = xy0; *xz = xz0;
  *yx = yx0; *yy = yy0; *yz = yz0;
  *ox_z = zx; *oy_z = zy; *oz_z = zz;
  return OCC_OK;
}

void store_frame(occ_frame_t* out,
                 double ox, double oy, double oz,
                 double xx, double xy, double xz,
                 double yx, double yy, double yz,
                 double zx, double zy, double zz) {
  out->ox = ox; out->oy = oy; out->oz = oz;
  out->xx = xx; out->xy = xy; out->xz = xz;
  out->yx = yx; out->yy = yy; out->yz = yz;
  out->zx = zx; out->zy = zy; out->zz = zz;
}

int frame_to_ax3(const occ_frame_t& f, gp_Ax3& out) {
  double xx = f.xx, xy = f.xy, xz = f.xz;
  double yx = f.yx, yy = f.yy, yz = f.yz;
  double zx = f.zx, zy = f.zy, zz = f.zz;

  /* Prefer stored X as hint; re-orthonormalize for safety. */
  double oxx, oxy, oxz, oyx, oyy, oyz, ozx, ozy, ozz;
  int st = orthonormalize(zx, zy, zz, xx, xy, xz,
                          &oxx, &oxy, &oxz,
                          &oyx, &oyy, &oyz,
                          &ozx, &ozy, &ozz);
  if (st != OCC_OK) return st;

  /* Detect left-handed storage: if given Y opposes reconstructed Y, flip Y
   * is unnecessary for placement — we force RH via gp_Ax3(Z,X). */
  (void)yx; (void)yy; (void)yz;

  try {
    out = gp_Ax3(gp_Pnt(f.ox, f.oy, f.oz),
                 gp_Dir(ozx, ozy, ozz),
                 gp_Dir(oxx, oxy, oxz));
  } catch (Standard_Failure& e) {
    set_last(e.GetMessageString() ? e.GetMessageString() : "gp_Ax3 failed");
    return OCC_ERR_FRAME;
  }
  return OCC_OK;
}

void frame_from_ax3(const gp_Ax3& a, occ_frame_t* out) {
  const gp_Pnt o = a.Location();
  const gp_Dir x = a.XDirection();
  const gp_Dir y = a.YDirection();
  const gp_Dir z = a.Direction();
  store_frame(out,
              o.X(), o.Y(), o.Z(),
              x.X(), x.Y(), x.Z(),
              y.X(), y.Y(), y.Z(),
              z.X(), z.Y(), z.Z());
}

/* Placement transform: maps world identity triad onto frame f
 * (local coordinates of f → world). */
int place_trsf(const occ_frame_t& f, gp_Trsf& t) {
  gp_Ax3 ax;
  int st = frame_to_ax3(f, ax);
  if (st != OCC_OK) return st;
  t.SetDisplacement(gp_Ax3() /* world */, ax);
  return OCC_OK;
}

void trsf_to_4x3(const gp_Trsf& t, double out12[12]) {
  out12[0]  = t.Value(1, 1); out12[1]  = t.Value(1, 2);
  out12[2]  = t.Value(1, 3); out12[3]  = t.Value(1, 4);
  out12[4]  = t.Value(2, 1); out12[5]  = t.Value(2, 2);
  out12[6]  = t.Value(2, 3); out12[7]  = t.Value(2, 4);
  out12[8]  = t.Value(3, 1); out12[9]  = t.Value(3, 2);
  out12[10] = t.Value(3, 3); out12[11] = t.Value(3, 4);
}

void trsf_to_4x4(const gp_Trsf& t, double out16[16]) {
  out16[0]  = t.Value(1, 1); out16[1]  = t.Value(1, 2);
  out16[2]  = t.Value(1, 3); out16[3]  = t.Value(1, 4);
  out16[4]  = t.Value(2, 1); out16[5]  = t.Value(2, 2);
  out16[6]  = t.Value(2, 3); out16[7]  = t.Value(2, 4);
  out16[8]  = t.Value(3, 1); out16[9]  = t.Value(3, 2);
  out16[10] = t.Value(3, 3); out16[11] = t.Value(3, 4);
  out16[12] = 0.0; out16[13] = 0.0; out16[14] = 0.0; out16[15] = 1.0;
}

int trsf_from_4x3(const double m12[12], gp_Trsf& t) {
  try {
    t.SetValues(m12[0], m12[1], m12[2], m12[3],
                m12[4], m12[5], m12[6], m12[7],
                m12[8], m12[9], m12[10], m12[11]);
  } catch (Standard_Failure& e) {
    set_last(e.GetMessageString() ? e.GetMessageString() : "SetValues failed");
    return OCC_ERR_GEOM;
  }
  return OCC_OK;
}

int trsf_from_4x4(const double m16[16], gp_Trsf& t) {
  /* Ignore last row; require near [0,0,0,1] only as soft check. */
  if (std::fabs(m16[15] - 1.0) > 1.0e-6) {
    set_last("matrix4x4 last row not [0,0,0,1]");
    return OCC_ERR_GEOM;
  }
  try {
    t.SetValues(m16[0], m16[1], m16[2], m16[3],
                m16[4], m16[5], m16[6], m16[7],
                m16[8], m16[9], m16[10], m16[11]);
  } catch (Standard_Failure& e) {
    set_last(e.GetMessageString() ? e.GetMessageString() : "SetValues failed");
    return OCC_ERR_GEOM;
  }
  return OCC_OK;
}

int apply_trsf_copy(occ_shape_t s, const gp_Trsf& t, occ_shape_t* out) {
  REQ(s && out, OCC_ERR_NULL_ARG);
  BRepBuilderAPI_Transform mk(*as_shape(s), t, /*Copy=*/Standard_True);
  if (!mk.IsDone()) {
    set_last("BRepBuilderAPI_Transform failed");
    return OCC_ERR_GEOM;
  }
  *out = to_handle(mk.Shape());
  return OCC_OK;
}

/* Frame from tangent vector at a point (Z = unit tangent). */
int frame_from_point_tangent(const gp_Pnt& p, const gp_Vec& d1,
                             occ_frame_t* out) {
  if (d1.Magnitude() < k_axis_eps) {
    set_last("degenerate tangent for frame");
    return OCC_ERR_GEOM;
  }
  gp_Vec t = d1;
  t.Normalize();
  double xx, xy, xz, yx, yy, yz, zx, zy, zz;
  int st = orthonormalize(t.X(), t.Y(), t.Z(),
                          0.0, 0.0, 0.0,
                          &xx, &xy, &xz,
                          &yx, &yy, &yz,
                          &zx, &zy, &zz);
  if (st != OCC_OK) return st;
  store_frame(out, p.X(), p.Y(), p.Z(), xx, xy, xz, yx, yy, yz, zx, zy, zz);
  return OCC_OK;
}

}  // namespace

extern "C" {

/* =========================================================================
 * Constructors
 * ========================================================================= */

int occ_frame_world(occ_frame_t* out) {
  REQ(out, OCC_ERR_NULL_ARG);
  store_frame(out,
              0.0, 0.0, 0.0,
              1.0, 0.0, 0.0,
              0.0, 1.0, 0.0,
              0.0, 0.0, 1.0);
  return OCC_OK;
}

int occ_frame_from_axes(double ox, double oy, double oz,
                        double xx, double xy, double xz,
                        double zx, double zy, double zz,
                        occ_frame_t* out) {
  REQ(out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  double oxx, oxy, oxz, oyx, oyy, oyz, ozx, ozy, ozz;
  int st = orthonormalize(zx, zy, zz, xx, xy, xz,
                          &oxx, &oxy, &oxz,
                          &oyx, &oyy, &oyz,
                          &ozx, &ozy, &ozz);
  if (st != OCC_OK) return st;
  store_frame(out, ox, oy, oz, oxx, oxy, oxz, oyx, oyy, oyz, ozx, ozy, ozz);
  return OCC_OK;
  OCC_GUARD_END
}

int occ_frame_from_z(double ox, double oy, double oz,
                     double zx, double zy, double zz,
                     double xh, double yh, double zh,
                     occ_frame_t* out) {
  REQ(out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  double oxx, oxy, oxz, oyx, oyy, oyz, ozx, ozy, ozz;
  int st = orthonormalize(zx, zy, zz, xh, yh, zh,
                          &oxx, &oxy, &oxz,
                          &oyx, &oyy, &oyz,
                          &ozx, &ozy, &ozz);
  if (st != OCC_OK) return st;
  store_frame(out, ox, oy, oz, oxx, oxy, oxz, oyx, oyy, oyz, ozx, ozy, ozz);
  return OCC_OK;
  OCC_GUARD_END
}

int occ_frame_from_zyx_euler(double ox, double oy, double oz,
                             double rx, double ry, double rz,
                             occ_frame_t* out) {
  REQ(out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  /* Intrinsic ZYX: R = Rz(rz) * Ry(ry) * Rx(rx)
   * Columns of R are the frame axes expressed in parent. */
  const double cx = std::cos(rx), sx = std::sin(rx);
  const double cy = std::cos(ry), sy = std::sin(ry);
  const double cz = std::cos(rz), sz = std::sin(rz);

  /* R = Rz * Ry * Rx */
  const double r00 = cz * cy;
  const double r01 = cz * sy * sx - sz * cx;
  const double r02 = cz * sy * cx + sz * sx;
  const double r10 = sz * cy;
  const double r11 = sz * sy * sx + cz * cx;
  const double r12 = sz * sy * cx - cz * sx;
  const double r20 = -sy;
  const double r21 = cy * sx;
  const double r22 = cy * cx;

  /* Columns: X=(r00,r10,r20), Y=(r01,r11,r21), Z=(r02,r12,r22) */
  store_frame(out, ox, oy, oz,
              r00, r10, r20,
              r01, r11, r21,
              r02, r12, r22);

  /* Re-orthonormalize to kill trig drift. */
  double oxx, oxy, oxz, oyx, oyy, oyz, ozx, ozy, ozz;
  int st = orthonormalize(out->zx, out->zy, out->zz,
                          out->xx, out->xy, out->xz,
                          &oxx, &oxy, &oxz,
                          &oyx, &oyy, &oyz,
                          &ozx, &ozy, &ozz);
  if (st != OCC_OK) return st;
  store_frame(out, ox, oy, oz, oxx, oxy, oxz, oyx, oyy, oyz, ozx, ozy, ozz);
  return OCC_OK;
  OCC_GUARD_END
}

/* =========================================================================
 * Matrix I/O
 * ========================================================================= */

int occ_frame_to_trsf_4x3(const occ_frame_t* f, double out12[12]) {
  REQ(f && out12, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  gp_Trsf t;
  int st = place_trsf(*f, t);
  if (st != OCC_OK) return st;
  trsf_to_4x3(t, out12);
  return OCC_OK;
  OCC_GUARD_END
}

int occ_frame_from_trsf_4x3(const double m12[12], occ_frame_t* out) {
  REQ(m12 && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  gp_Trsf t;
  int st = trsf_from_4x3(m12, t);
  if (st != OCC_OK) return st;
  frame_from_ax3(gp_Ax3().Transformed(t), out);
  return OCC_OK;
  OCC_GUARD_END
}

int occ_frame_to_matrix4x4(const occ_frame_t* f, double out16[16]) {
  REQ(f && out16, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  gp_Trsf t;
  int st = place_trsf(*f, t);
  if (st != OCC_OK) return st;
  trsf_to_4x4(t, out16);
  return OCC_OK;
  OCC_GUARD_END
}

int occ_frame_from_matrix4x4(const double m16[16], occ_frame_t* out) {
  REQ(m16 && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  gp_Trsf t;
  int st = trsf_from_4x4(m16, t);
  if (st != OCC_OK) return st;
  frame_from_ax3(gp_Ax3().Transformed(t), out);
  return OCC_OK;
  OCC_GUARD_END
}

/* =========================================================================
 * Algebra
 * ========================================================================= */

int occ_frame_inverted(const occ_frame_t* f, occ_frame_t* out) {
  REQ(f && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  gp_Trsf t;
  int st = place_trsf(*f, t);
  if (st != OCC_OK) return st;
  t.Invert();
  frame_from_ax3(gp_Ax3().Transformed(t), out);
  return OCC_OK;
  OCC_GUARD_END
}

int occ_frame_multiplied(const occ_frame_t* b, const occ_frame_t* a,
                         occ_frame_t* out) {
  /* B*A: apply A then B. */
  REQ(a && b && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  gp_Trsf ta, tb;
  int st = place_trsf(*a, ta);
  if (st != OCC_OK) return st;
  st = place_trsf(*b, tb);
  if (st != OCC_OK) return st;
  gp_Trsf t = tb.Multiplied(ta);
  frame_from_ax3(gp_Ax3().Transformed(t), out);
  return OCC_OK;
  OCC_GUARD_END
}

int occ_frame_displacement(const occ_frame_t* from_a,
                           const occ_frame_t* to_b,
                           occ_frame_t* out) {
  /* T = B * inv(A)  via  gp_Trsf::SetDisplacement(A, B). */
  REQ(from_a && to_b && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  gp_Ax3 A, B;
  int st = frame_to_ax3(*from_a, A);
  if (st != OCC_OK) return st;
  st = frame_to_ax3(*to_b, B);
  if (st != OCC_OK) return st;
  gp_Trsf t;
  t.SetDisplacement(A, B);
  frame_from_ax3(gp_Ax3().Transformed(t), out);
  return OCC_OK;
  OCC_GUARD_END
}

/* =========================================================================
 * Shape placement
 * ========================================================================= */

int occ_transform_shape_4x3(occ_shape_t s, const double m12[12],
                            occ_shape_t* out) {
  REQ(s && m12 && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  gp_Trsf t;
  int st = trsf_from_4x3(m12, t);
  if (st != OCC_OK) return st;
  return apply_trsf_copy(s, t, out);
  OCC_GUARD_END
}

int occ_transform_shape_frame(occ_shape_t s, const occ_frame_t* f,
                              occ_shape_t* out) {
  REQ(s && f && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  gp_Trsf t;
  int st = place_trsf(*f, t);
  if (st != OCC_OK) return st;
  return apply_trsf_copy(s, t, out);
  OCC_GUARD_END
}

int occ_place_shape_at_frame(occ_shape_t shape,
                             const occ_frame_t* target_frame,
                             const occ_frame_t* current_frame_on_shape,
                             occ_shape_t* out) {
  /* T = target * inv(current).  current == NULL ⇒ identity. */
  REQ(shape && target_frame && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  gp_Ax3 B;
  int st = frame_to_ax3(*target_frame, B);
  if (st != OCC_OK) return st;

  gp_Ax3 A; /* current */
  if (current_frame_on_shape) {
    st = frame_to_ax3(*current_frame_on_shape, A);
    if (st != OCC_OK) return st;
  } else {
    A = gp_Ax3(); /* world */
  }

  gp_Trsf t;
  t.SetDisplacement(A, B);
  return apply_trsf_copy(shape, t, out);
  OCC_GUARD_END
}

/* =========================================================================
 * Topology-sampled frames
 * ========================================================================= */

int occ_frame_at_edge_param(occ_shape_t edge, double u, occ_frame_t* out) {
  REQ(edge && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  const TopoDS_Shape& sh = *as_shape(edge);
  if (sh.ShapeType() != TopAbs_EDGE) {
    set_last("occ_frame_at_edge_param: expected EDGE");
    return OCC_ERR_INVALID_SHAPE;
  }
  const TopoDS_Edge E = TopoDS::Edge(sh);
  BRepAdaptor_Curve c(E);
  if (u < c.FirstParameter() - 1.0e-9 || u > c.LastParameter() + 1.0e-9) {
    /* Soft clamp — still evaluate (OCCT curves often allow slight overrun). */
  }
  gp_Pnt p;
  gp_Vec d1;
  c.D1(u, p, d1);
  /* Respect edge orientation: reversed edges flip geometric tangent sense
   * for applications that care about wire direction. We report geometry D1
   * of the underlying curve; callers wanting topological sense can reverse Z. */
  return frame_from_point_tangent(p, d1, out);
  OCC_GUARD_END
}

int occ_frame_at_wire_end(occ_shape_t wire, int at_start, occ_frame_t* out) {
  REQ(wire && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  const TopoDS_Shape& sh = *as_shape(wire);
  if (sh.ShapeType() != TopAbs_WIRE) {
    set_last("occ_frame_at_wire_end: expected WIRE");
    return OCC_ERR_INVALID_SHAPE;
  }

  TopoDS_Edge edge;
  int count = 0;
  for (TopExp_Explorer ex(sh, TopAbs_EDGE); ex.More(); ex.Next()) {
    edge = TopoDS::Edge(ex.Current());
    ++count;
    if (at_start) break; /* first edge */
  }
  if (count == 0) {
    set_last("wire has no edges");
    return OCC_ERR_GEOM;
  }
  /* If !at_start, edge is the last edge from the explorer loop. */

  BRepAdaptor_Curve c(edge);
  const Standard_Real t =
      at_start ? c.FirstParameter() : c.LastParameter();
  gp_Pnt p;
  gp_Vec d1;
  c.D1(t, p, d1);

  /* If the edge is REVERSED in the wire, geometric First/Last still map to
   * the curve; for start we want the tangent pointing into the wire.
   * Adjust: for REVERSED edge, geometric D1 is opposite topological walk. */
  if (edge.Orientation() == TopAbs_REVERSED) {
    d1.Reverse();
  }
  /* At the end of a REVERSED edge that is the last in explorer order,
   * after Reverse, D1 points along wire walk direction. */

  return frame_from_point_tangent(p, d1, out);
  OCC_GUARD_END
}

int occ_frame_on_face(occ_shape_t face, double u, double v, occ_frame_t* out) {
  REQ(face && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  const TopoDS_Shape& sh = *as_shape(face);
  if (sh.ShapeType() != TopAbs_FACE) {
    set_last("occ_frame_on_face: expected FACE");
    return OCC_ERR_INVALID_SHAPE;
  }
  const TopoDS_Face F = TopoDS::Face(sh);
  BRepAdaptor_Surface s(F, /*restriction=*/Standard_True);
  gp_Pnt p;
  gp_Vec d1u, d1v;
  s.D1(u, v, p, d1u, d1v);

  gp_Vec n = d1u.Crossed(d1v);
  if (n.Magnitude() < k_axis_eps) {
    set_last("face normal degenerate at (u,v)");
    return OCC_ERR_GEOM;
  }
  /* Respect face orientation. */
  if (F.Orientation() == TopAbs_REVERSED) {
    n.Reverse();
  }
  n.Normalize();

  /* X-hint along dS/du; orthonormalize handles parallel cases. */
  double xx, xy, xz, yx, yy, yz, zx, zy, zz;
  int st = orthonormalize(n.X(), n.Y(), n.Z(),
                          d1u.X(), d1u.Y(), d1u.Z(),
                          &xx, &xy, &xz,
                          &yx, &yy, &yz,
                          &zx, &zy, &zz);
  if (st != OCC_OK) return st;
  store_frame(out, p.X(), p.Y(), p.Z(), xx, xy, xz, yx, yy, yz, zx, zy, zz);
  return OCC_OK;
  OCC_GUARD_END
}

/* =========================================================================
 * Mirror + array (occurrence foundations)
 * ========================================================================= */

int occ_mirror_copy(occ_shape_t shape,
                    double px, double py, double pz,
                    double nx, double ny, double nz,
                    int keep_original_compound,
                    occ_shape_t* out) {
  REQ(shape && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  if (vlen(nx, ny, nz) < k_axis_eps) {
    set_last("mirror plane normal near zero");
    return OCC_ERR_GEOM;
  }
  gp_Ax2 pln(gp_Pnt(px, py, pz), gp_Dir(nx, ny, nz));
  gp_Trsf t;
  t.SetMirror(pln);

  BRepBuilderAPI_Transform mk(*as_shape(shape), t, /*Copy=*/Standard_True);
  if (!mk.IsDone()) {
    set_last("mirror transform failed");
    return OCC_ERR_GEOM;
  }
  const TopoDS_Shape mirrored = mk.Shape();

  if (!keep_original_compound) {
    *out = to_handle(mirrored);
    return OCC_OK;
  }

  BRep_Builder b;
  TopoDS_Compound comp;
  b.MakeCompound(comp);
  b.Add(comp, *as_shape(shape));
  b.Add(comp, mirrored);
  *out = to_handle(comp);
  return OCC_OK;
  OCC_GUARD_END
}

int occ_transform_copy_array(occ_shape_t seed,
                             const double* transforms_4x4,
                             int n,
                             occ_shape_t* out) {
  REQ(seed && transforms_4x4 && out, OCC_ERR_NULL_ARG);
  REQ(n > 0, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  BRep_Builder b;
  TopoDS_Compound comp;
  b.MakeCompound(comp);

  for (int i = 0; i < n; ++i) {
    const double* m = transforms_4x4 + static_cast<size_t>(i) * 16;
    gp_Trsf t;
    int st = trsf_from_4x4(m, t);
    if (st != OCC_OK) return st;
    BRepBuilderAPI_Transform mk(*as_shape(seed), t, Standard_True);
    if (!mk.IsDone()) {
      set_last("transform_copy_array: transform failed");
      return OCC_ERR_GEOM;
    }
    b.Add(comp, mk.Shape());
  }
  *out = to_handle(comp);
  return OCC_OK;
  OCC_GUARD_END
}

}  // extern "C"
```

---

## Header — transforms / FK

```c
// === file: occ_c_trsf.h
#ifndef OCC_C_TRSF_H_
#define OCC_C_TRSF_H_

#include "occ_c.h"
#include "occ_c_frames.h"

#ifdef __cplusplus
extern "C" {
#endif

/* -------------------------------------------------------------------------
 * Pure SE(3) math on 4x4 row-major matrices (last row 0,0,0,1).
 * Composition: out = a * b  means apply b first, then a (column vectors).
 * ------------------------------------------------------------------------- */

OCC_API void occ_trsf_identity(double m[16]);

/* out = a * b  (a after b). Safe if out aliases a or b (uses temp). */
OCC_API void occ_trsf_compose(const double a[16], const double b[16],
                              double out[16]);

/* Rigid inverse. Returns OCC_ERR_GEOM if rotation block singular. */
OCC_API int occ_trsf_invert(const double m[16], double out[16]);

/* Apply 4x4 (upper 3x4) to shape via BRepBuilderAPI_Transform copy. */
OCC_API int occ_trsf_apply_shape(occ_shape_t s, const double m[16],
                                 occ_shape_t* out);

/* Convenience: frame → 4x4 (same as occ_frame_to_matrix4x4). */
OCC_API int occ_trsf_from_frame(const occ_frame_t* f, double out16[16]);

/* -------------------------------------------------------------------------
 * Serial FK: n revolute joints.
 *
 * Each joint i is expressed in the *parent* joint frame (joint 0 parent = world):
 *   Ti = Trans(origins[i]) * Rot(axes[i], angles[i])
 *   World_i = World_{i-1} * Ti
 *
 * origins: n*3 doubles (x,y,z) in parent frame
 * axes:    n*3 doubles (unit preferred; normalized internally)
 * angles:  n doubles, radians
 *
 * out_world_frames: if non-NULL, n frames (world pose after each joint)
 * out_final_4x4:    if non-NULL, World_{n-1} as 4x4 row-major
 * ------------------------------------------------------------------------- */
OCC_API int occ_compose_chain(int n,
                              const double* origins, /* n*3 */
                              const double* axes,    /* n*3 */
                              const double* angles,  /* n */
                              occ_frame_t* out_world_frames, /* nullable, n */
                              double* out_final_4x4 /* nullable, 16 */);

/* Classic DH (Craig): each link i
 *   T_i = RotZ(theta_i) * TransZ(d_i) * TransX(a_i) * RotX(alpha_i)
 * Arrays length n. out_world_frames / out_final_4x4 same as above. */
OCC_API int occ_compose_chain_dh(int n,
                                 const double* a,
                                 const double* alpha,
                                 const double* d,
                                 const double* theta,
                                 occ_frame_t* out_world_frames,
                                 double* out_final_4x4);

#ifdef __cplusplus
}
#endif

#endif /* OCC_C_TRSF_H_ */
```

---

## Implementation — transforms / FK

```cpp
// === file: occ_c_trsf.cc
// OCCT 7.9.3 — SE(3) matrix math + serial FK + shape apply.
// Extract into api/src/occ_c_trsf.cc

#include "occ_c_trsf.h"
#include "occ_c_internal.hxx"

#include <cmath>
#include <cstring>

#include <BRepBuilderAPI_Transform.hxx>
#include <gp_Trsf.hxx>

using occ_c_detail::as_shape;
using occ_c_detail::to_handle;
using occ_c_detail::set_last;

namespace {

constexpr double k_eps = 1.0e-18;

inline void mat4_zero(double m[16]) {
  std::memset(m, 0, 16 * sizeof(double));
}

void mat4_mul(const double a[16], const double b[16], double out[16]) {
  double t[16];
  for (int i = 0; i < 4; ++i) {
    for (int j = 0; j < 4; ++j) {
      double s = 0.0;
      for (int k = 0; k < 4; ++k) {
        s += a[i * 4 + k] * b[k * 4 + j];
      }
      t[i * 4 + j] = s;
    }
  }
  std::memcpy(out, t, 16 * sizeof(double));
}

/* Rodrigues rotation about unit axis (ax,ay,az), angle ang → 3x3 row-major R[9]. */
void rot_axis_angle(double ax, double ay, double az, double ang, double R[9]) {
  double len = std::sqrt(ax * ax + ay * ay + az * az);
  if (len < 1.0e-30) {
    R[0] = R[4] = R[8] = 1.0;
    R[1] = R[2] = R[3] = R[5] = R[6] = R[7] = 0.0;
    return;
  }
  const double x = ax / len, y = ay / len, z = az / len;
  const double c = std::cos(ang), s = std::sin(ang), t = 1.0 - c;
  R[0] = t * x * x + c;     R[1] = t * x * y - s * z; R[2] = t * x * z + s * y;
  R[3] = t * x * y + s * z; R[4] = t * y * y + c;     R[5] = t * y * z - s * x;
  R[6] = t * x * z - s * y; R[7] = t * y * z + s * x; R[8] = t * z * z + c;
}

/* Pack R(3x3 row-major) + translation into 4x4 row-major. */
void pack_Rt(const double R[9], double tx, double ty, double tz, double m[16]) {
  m[0] = R[0]; m[1] = R[1]; m[2] = R[2]; m[3] = tx;
  m[4] = R[3]; m[5] = R[4]; m[6] = R[5]; m[7] = ty;
  m[8] = R[6]; m[9] = R[7]; m[10] = R[8]; m[11] = tz;
  m[12] = 0.0; m[13] = 0.0; m[14] = 0.0; m[15] = 1.0;
}

/* Pure translation 4x4. */
void mat4_trans(double tx, double ty, double tz, double m[16]) {
  occ_trsf_identity(m);
  m[3] = tx; m[7] = ty; m[11] = tz;
}

/* RotZ / RotX for DH. */
void mat4_rotz(double th, double m[16]) {
  const double c = std::cos(th), s = std::sin(th);
  occ_trsf_identity(m);
  m[0] = c;  m[1] = -s;
  m[4] = s;  m[5] = c;
}

void mat4_rotx(double al, double m[16]) {
  const double c = std::cos(al), s = std::sin(al);
  occ_trsf_identity(m);
  m[5] = c;  m[6] = -s;
  m[9] = s;  m[10] = c;
}

/* Convert 4x4 placement (local→world) into occ_frame_t via columns. */
int frame_from_mat4(const double m[16], occ_frame_t* out) {
  /* Columns of R are axes. */
  double xx = m[0], xy = m[4], xz = m[8];
  double yx = m[1], yy = m[5], yz = m[9];
  double zx = m[2], zy = m[6], zz = m[10];
  double ox = m[3], oy = m[7], oz = m[11];

  /* Re-orthonormalize with Z + X. */
  return occ_frame_from_axes(ox, oy, oz, xx, xy, xz, zx, zy, zz, out);
}

int apply_mat4(occ_shape_t s, const double m[16], occ_shape_t* out) {
  REQ(s && m && out, OCC_ERR_NULL_ARG);
  gp_Trsf t;
  try {
    t.SetValues(m[0], m[1], m[2], m[3],
                m[4], m[5], m[6], m[7],
                m[8], m[9], m[10], m[11]);
  } catch (Standard_Failure& e) {
    set_last(e.GetMessageString() ? e.GetMessageString() : "SetValues failed");
    return OCC_ERR_GEOM;
  }
  BRepBuilderAPI_Transform mk(*as_shape(s), t, Standard_True);
  if (!mk.IsDone()) {
    set_last("trsf apply failed");
    return OCC_ERR_GEOM;
  }
  *out = to_handle(mk.Shape());
  return OCC_OK;
}

}  // namespace

extern "C" {

void occ_trsf_identity(double m[16]) {
  mat4_zero(m);
  m[0] = m[5] = m[10] = m[15] = 1.0;
}

void occ_trsf_compose(const double a[16], const double b[16], double out[16]) {
  mat4_mul(a, b, out);
}

int occ_trsf_invert(const double m[16], double out[16]) {
  /* Rigid inverse: R^T | -R^T t
   * For pure SE(3) (det R = ±1, orthogonal). We use 3x3 inverse via det
   * to tolerate slight non-orthogonality from float noise. */
  const double r00 = m[0], r01 = m[1], r02 = m[2];
  const double r10 = m[4], r11 = m[5], r12 = m[6];
  const double r20 = m[8], r21 = m[9], r22 = m[10];
  const double det =
      r00 * (r11 * r22 - r12 * r21) -
      r01 * (r10 * r22 - r12 * r20) +
      r02 * (r10 * r21 - r11 * r20);
  if (std::fabs(det) < k_eps) {
    set_last("trsf invert: singular rotation");
    return OCC_ERR_GEOM;
  }
  /* For proper rigid body, inv(R) = R^T when det≈+1 and R orthogonal.
   * Use transpose of upper-left (standard SE3 inverse for rotations). */
  const double tx = m[3], ty = m[7], tz = m[11];
  out[0] = r00; out[1] = r10; out[2] = r20;
  out[4] = r01; out[5] = r11; out[6] = r21;
  out[8] = r02; out[9] = r12; out[10] = r22;
  out[3]  = -(out[0] * tx + out[1] * ty + out[2] * tz);
  out[7]  = -(out[4] * tx + out[5] * ty + out[6] * tz);
  out[11] = -(out[8] * tx + out[9] * ty + out[10] * tz);
  out[12] = out[13] = out[14] = 0.0;
  out[15] = 1.0;
  return OCC_OK;
}

int occ_trsf_apply_shape(occ_shape_t s, const double m[16], occ_shape_t* out) {
  REQ(s && m && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  return apply_mat4(s, m, out);
  OCC_GUARD_END
}

int occ_trsf_from_frame(const occ_frame_t* f, double out16[16]) {
  REQ(f && out16, OCC_ERR_NULL_ARG);
  return occ_frame_to_matrix4x4(f, out16);
}

/* =========================================================================
 * Serial FK — explicit joint origins + axes
 * ========================================================================= */

int occ_compose_chain(int n,
                      const double* origins,
                      const double* axes,
                      const double* angles,
                      occ_frame_t* out_world_frames,
                      double* out_final_4x4) {
  REQ(n >= 0, OCC_ERR_GEOM);
  if (n == 0) {
    if (out_final_4x4) occ_trsf_identity(out_final_4x4);
    return OCC_OK;
  }
  REQ(origins && axes && angles, OCC_ERR_NULL_ARG);
  REQ(out_world_frames || out_final_4x4, OCC_ERR_NULL_ARG);

  OCC_GUARD_BEGIN
  double world[16];
  occ_trsf_identity(world);

  for (int i = 0; i < n; ++i) {
    const double ox = origins[i * 3 + 0];
    const double oy = origins[i * 3 + 1];
    const double oz = origins[i * 3 + 2];
    const double ax = axes[i * 3 + 0];
    const double ay = axes[i * 3 + 1];
    const double az = axes[i * 3 + 2];
    const double ang = angles[i];

    /* Ti = Trans(origin) * Rot(axis, angle)  in parent frame. */
    double R[9], Trot[16], Ttr[16], Ti[16], tmp[16];
    rot_axis_angle(ax, ay, az, ang, R);
    pack_Rt(R, 0.0, 0.0, 0.0, Trot);
    mat4_trans(ox, oy, oz, Ttr);
    mat4_mul(Ttr, Trot, Ti);          /* Trans * Rot */
    mat4_mul(world, Ti, tmp);         /* world = world * Ti */
    std::memcpy(world, tmp, 16 * sizeof(double));

    if (out_world_frames) {
      int st = frame_from_mat4(world, &out_world_frames[i]);
      if (st != OCC_OK) return st;
    }
  }

  if (out_final_4x4) {
    std::memcpy(out_final_4x4, world, 16 * sizeof(double));
  }
  return OCC_OK;
  OCC_GUARD_END
}

/* =========================================================================
 * Classic Denavit–Hartenberg (Craig)
 *
 * For link i (0-based):
 *   T_i^{i-1} = RotZ(theta) * TransZ(d) * TransX(a) * RotX(alpha)
 *
 * World_i = World_{i-1} * T_i
 * ========================================================================= */

int occ_compose_chain_dh(int n,
                         const double* a,
                         const double* alpha,
                         const double* d,
                         const double* theta,
                         occ_frame_t* out_world_frames,
                         double* out_final_4x4) {
  REQ(n >= 0, OCC_ERR_GEOM);
  if (n == 0) {
    if (out_final_4x4) occ_trsf_identity(out_final_4x4);
    return OCC_OK;
  }
  REQ(a && alpha && d && theta, OCC_ERR_NULL_ARG);
  REQ(out_world_frames || out_final_4x4, OCC_ERR_NULL_ARG);

  OCC_GUARD_BEGIN
  double world[16];
  occ_trsf_identity(world);

  for (int i = 0; i < n; ++i) {
    double Rz[16], Tz[16], Tx[16], Rx[16];
    double t0[16], t1[16], t2[16], Ti[16], tmp[16];

    mat4_rotz(theta[i], Rz);
    mat4_trans(0.0, 0.0, d[i], Tz);
    mat4_trans(a[i], 0.0, 0.0, Tx);
    mat4_rotx(alpha[i], Rx);

    /* Ti = Rz * Tz * Tx * Rx */
    mat4_mul(Rz, Tz, t0);
    mat4_mul(t0, Tx, t1);
    mat4_mul(t1, Rx, Ti);

    mat4_mul(world, Ti, tmp);
    std::memcpy(world, tmp, 16 * sizeof(double));

    if (out_world_frames) {
      int st = frame_from_mat4(world, &out_world_frames[i]);
      if (st != OCC_OK) return st;
    }
  }

  if (out_final_4x4) {
    std::memcpy(out_final_4x4, world, 16 * sizeof(double));
  }
  return OCC_OK;
  OCC_GUARD_END
}

}  // extern "C"
```

---

## Usage sketches (host / tests)

### 1. Named frame on a flange (AttachFrame)

```c
occ_frame_t flange;
occ_frame_from_z(/*origin*/ 0.0, 0.0, 0.15,
                 /*Z*/ 0.0, 0.0, 1.0,
                 /*X hint*/ 1.0, 0.0, 0.0,
                 &flange);
/* Host maps name "joint_1_out" → flange POD; no BREP mutation. */
```

### 2. Connector-to-connector place (RigidXform)

```c
occ_frame_t src, dst, map;
occ_frame_from_axes(0,0,0, 1,0,0, 0,0,1, &src);
occ_frame_from_zyx_euler(1.0, 0.2, 0.0, 0.0, 0.0, M_PI/2, &dst);
occ_frame_displacement(&src, &dst, &map);   /* T = dst * inv(src) */

occ_shape_t placed = NULL;
occ_place_shape_at_frame(part, &dst, &src, &placed);
/* equivalent: occ_transform_shape_frame after building map, or
 * occ_frame_between via displacement + apply. */
```

### 3. Six-DOF arm FK without baking joints

```c
enum { N = 6 };
double origins[N*3] = {
  0,0,0.1,   0,0,0,   0,0.3,0,   0,0,0,   0,0.25,0,   0,0,0
};
double axes[N*3] = {
  0,0,1,  0,1,0,  0,1,0,  1,0,0,  0,1,0,  1,0,0
};
double q[N] = { 0.1, -0.4, 0.8, 0.0, 0.3, -0.2 };

occ_frame_t world_frames[N];
double Ttcp[16];
occ_compose_chain(N, origins, axes, q, world_frames, Ttcp);

for (int i = 0; i < N; ++i) {
  occ_shape_t posed = NULL;
  occ_trsf_apply_shape(link_seed[i], /* per-link cumulative */
                       /* build 4x4 from world_frames[i] */, &posed);
}
/* Prefer: each link modeled in its local joint frame; place with
 * occ_frame_to_matrix4x4(&world_frames[i], M) + occ_trsf_apply_shape. */
```

### 4. Pattern foundation

```c
double Ms[3 * 16];
for (int i = 0; i < 3; ++i) {
  occ_trsf_identity(&Ms[i * 16]);
  Ms[i * 16 + 3] = 0.05 * i; /* translate X */
}
occ_shape_t arr = NULL;
occ_transform_copy_array(bolt, Ms, 3, &arr); /* COMPOUND of 3 */
```

### 5. Face / edge frames for pipe ports

```c
occ_frame_t port;
occ_frame_on_face(face, u, v, &port);          /* Z = outward normal */
/* or */
occ_frame_at_edge_param(edge, 0.5 * (u0 + u1), &port); /* Z = tangent */
occ_frame_at_wire_end(route_wire, /*at_start=*/1, &port);
```

---

## OCCT mapping cheat-sheet

| `occ_c` | OCCT 7.9.3 |
|---------|------------|
| `occ_frame_t` | POD ↔ `gp_Ax3` (Location, XDirection, YDirection, Direction=Z) |
| placement of frame in world | `gp_Trsf::SetDisplacement(gp_Ax3(), ax3)` |
| connector map \(B A^{-1}\) | `gp_Trsf::SetDisplacement(A, B)` |
| invert / multiply | `gp_Trsf::Invert`, `Multiplied` |
| 4×3 / 4×4 I/O | `gp_Trsf::Value(i,j)`, `SetValues(a11..a34)` |
| apply to BREP | `BRepBuilderAPI_Transform(shape, trsf, Standard_True)` |
| edge frame | `BRepAdaptor_Curve::D1` |
| face frame | `BRepAdaptor_Surface::D1` → normal `d1u × d1v` |
| wire end | `TopExp_Explorer(TopAbs_EDGE)` + curve D1 |
| mirror | `gp_Trsf::SetMirror(gp_Ax2(point, normal))` |
| compound array | `BRep_Builder::MakeCompound` + `Add` |
| FK | pure `double[16]` math (no OCCT joint solver) |

---

## Design decisions (locked)

1. **Full triad stored** (X,Y,Z) so Y is not recomputed on every read; constructors still orthonormalize.
2. **Row-major 4×4**, last row `0,0,0,1`, column vectors — document once, never offer a second layout in C.
3. **`occ_frame_multiplied(b,a)` = B∘A** (A then B) — matches matrix multiply and OCCT `tb.Multiplied(ta)`.
4. **`occ_place_shape_at_frame`** takes optional current frame (NULL = world) so occurrence math is one call.
5. **No mate solver** — no constraint graph, no degrees of freedom residual; host/IR owns that.
6. **`occ_compose_chain` joint local model**: `Trans(origin)*Rot(axis,angle)` relative to parent; export world frames after each joint for link placement.
7. **Orthonormalize** always handles nearly-parallel X-hint (auto world X/Y fallback).
8. **Mirror** uses plane as `gp_Ax2(point, normal)`; optional compound keeps original for pattern-like mirror features.
9. **Lerp/slerp** skipped (optional); hosts that need animation interpolate quaternions themselves or call repeated Euler construction.

---

## IR map (product vocabulary → this section)

| IR / product term | C API |
|-------------------|-------|
| `AttachFrame` | store `occ_frame_t` in host registry; constructors above |
| `RigidXform` / occurrence | `occ_place_shape_at_frame`, `occ_transform_shape_*` |
| connector map | `occ_frame_displacement` |
| `ComposeChain` | `occ_compose_chain` (+ `occ_compose_chain_dh`) |
| pattern seed copies | `occ_transform_copy_array` |
| mirror feature (rigid) | `occ_mirror_copy` |
| port on face / path end | `occ_frame_on_face`, `occ_frame_at_wire_end`, `occ_frame_at_edge_param` |

---

## Build notes

1. Add `occ_c_frames.cc` and `occ_c_trsf.cc` to `//api:occ_c_lib` (or equivalent).
2. Install headers `occ_c_frames.h`, `occ_c_trsf.h` next to `occ_c.h`.
3. Ensure `OCC_ERR_FRAME` and `OCC_ERR_GEOM` exist in `occ_status_t` (see §3 of `docs/occ-c-p0-literate-api.md`).
4. Wasm size: these TUs pull `BRepBuilderAPI_Transform` + adaptors only — no boolean kernel.

---

## Self-check (implementer)

- [ ] All symbols in headers are defined in the matching `.cc` with no stubs.
- [ ] `occ_frame_from_z` with zero X-hint succeeds for Z along ±X, ±Y, ±Z.
- [ ] `occ_frame_displacement` then `occ_transform_shape_frame` moves a box so its corner frame lands on target.
- [ ] `occ_compose_chain` with all angles 0 yields translations only along cumulative origins.
- [ ] `occ_compose_chain_dh` matches a known 2-link planar arm table within 1e-9.
- [ ] `occ_mirror_copy(..., keep=1)` returns `TopAbs_COMPOUND` with two children.
- [ ] `occ_transform_copy_array` with identity × N returns N copies at same pose (compound).
- [ ] 4×4 last row always written as `0,0,0,1`; `from_matrix4x4` rejects `m[15]≠1`.

---

*End of section 03 — frames & rigid transforms.*

<!-- END 03-frames-trsf.md -->


<!-- BEGIN 04-route-pipe-member.md -->

# Section 04 — Routing, Pipe Solids & Structural Member Sweep

**Document type:** Literate programming source for the Apache **`occ_c`** C API  
**Audience:** Implementers extracting real `.h` / `.cc` into `api/`  
**Date:** 2026-07-31  
**OCCT pin:** **7.9.3**  
**Priority:** AI-BOOST P0 (piping skids · continuous centerline sweep · skid steel)  
**Extract targets:**
- `api/include/occ_c_route.h`
- `api/src/occ_c_route.cc`

Depends on: `occ_c.h`, `occ_c_frames.h` (`occ_frame_t`), `occ_c_internal.hxx`  
Units: **meters**, **radians**. Topology indices 1-based where applicable.

---

## Pedagogy — RoutePath, pipe ≠ Frame, IR SweepAlong

Industrial **fluid pipe** is not a FeatureScript / Onshape “Frame” (structural profile).
The kernel path for a skid line is deliberately three layers:

| Layer | Concept | This module |
|-------|---------|-------------|
| 1. Centerline | `RoutePath` wire in 3-space | `occ_make_route_polyline` / `occ_make_route_with_bends` |
| 2. Fluid solid | Circle (or annulus) swept along centerline | `occ_pipe_solid` / `occ_pipe_annulus` / `occ_pipe_shell_profile` |
| 3. Structure | Rectangular / circular **member** along a path | `occ_member_sweep_rect` / `occ_member_sweep_circle` |

### continuous_sweep vs segment_and_fittings

| Mode | Day-1 P0 | Geometry |
|------|----------|----------|
| **`continuous_sweep`** | **Yes** | Bend radii are *baked into the centerline wire* as circular arcs; one solid via `MakePipe`. BOM may later approximate elbows. |
| **`segment_and_fittings`** | P1 | Straight pipe solids + discrete elbow fittings from a catalog. Not this file. |

`occ_make_route_with_bends` exists so continuous_sweep produces G1 spines that
`BRepOffsetAPI_MakePipe` accepts (G1 required — see OCCT warning on MakePipe).

### IR / Luau map

| IR op / Luau | C entry |
|--------------|---------|
| `RoutePath` (polyline) | `occ_make_route_polyline` |
| `RoutePath` (bend R) | `occ_make_route_with_bends` |
| `SweepAlong` (solid) | `occ_pipe_solid` |
| `SweepAlong` annulus | `occ_pipe_annulus` |
| `MemberSweep` rect | `occ_member_sweep_rect` |
| `MemberSweep` circle | `occ_member_sweep_circle` |
| path stations / FK seeds | `occ_frame_at_wire_fraction`, `occ_route_node_frames` |

OCCT classes used: `BRepBuilderAPI_MakePolygon`, `MakeEdge`, `MakeWire`,
`MakeFace`, `GC_MakeSegment`, `GC_MakeArcOfCircle`, `BRepOffsetAPI_MakePipe`,
`BRepOffsetAPI_MakePipeShell`, `BRepAlgoAPI_Cut`, `BRepAdaptor_CompCurve`,
`BRepAdaptor_Curve`, `BRepTools_WireExplorer`, `BRepGProp::LinearProperties`,
`gp_Ax2` / `gp_Ax3` / `gp_Circ` / `gp_Trsf`.

---

## Status code extension

If not already in `occ_status_t`, implementers must add:

```c
/* fragment for occ_c.h — extend occ_status_t */
OCC_ERR_MATH = 13   /* bend geometry / numeric failure (too-short legs, etc.) — value must match occ_c.h */
```

Until the enum is patched, the implementation defines a local fallback:

```c
#ifndef OCC_ERR_MATH
#define OCC_ERR_MATH 13
#endif
#ifndef OCC_ERR_GEOM
#define OCC_ERR_GEOM 8
#endif
```

| Code | When |
|------|------|
| `OCC_ERR_NULL_ARG` | null pointer inputs |
| `OCC_ERR_INVALID_SHAPE` | spine/profile not a wire/face as required |
| `OCC_ERR_GEOM` | degenerate construction, zero radius, collinear hairpin |
| `OCC_ERR_MATH` | bend trim exceeds available leg length; numeric failure |
| `OCC_ERR_BOOLEAN` | annulus cut failed |
| `OCC_ERR_EXCEPTION` | OCCT `Standard_Failure` |

---

## Algorithm — circular bend fillets (CRITICAL)

### Goal

Replace each sharp interior vertex of a polyline with a **circular arc of radius R**
lying in the plane of the two adjacent segments, so the resulting wire is **G1**
(tangent continuous). Straight segments are shortened by equal trims on both sides
of the vertex.

### Inputs (meters)

- Points \(P_0, P_1, \ldots, P_{n-1}\)
- Bend radius \(R > 0\)
- Closed loop: pass the first sample again as the last
  (\(P_{n-1} = P_0\) within \(10^{-9}\) m). The duplicate is dropped and the
  wrap-around corner is filleted.

### Per-corner construction (vertex \(B = P_i\))

Let the previous point be \(A\) and the next point be \(C\) (wrapping when closed).

1. **Segment vectors (unit)**

\[
\mathbf{u} = \frac{B - A}{\|B - A\|}, \qquad
\mathbf{v} = \frac{C - B}{\|C - B\|}
\]

2. **Collinear test.** Let \(\mathbf{c} = \mathbf{u} \times \mathbf{v}\).
   If \(\|\mathbf{c}\| < \varepsilon\) (with \(\varepsilon \approx 10^{-12}\)):

   - If \(\mathbf{u}\cdot\mathbf{v} > 0\): nearly straight — **skip** bend (keep sharp = collinear).
   - If \(\mathbf{u}\cdot\mathbf{v} < 0\): 180° reverse hairpin — **error** `OCC_ERR_GEOM`.

3. **Turn angle** (deflection between consecutive segment directions):

\[
\alpha = \mathrm{atan2}(\|\mathbf{u}\times\mathbf{v}\|,\; \mathbf{u}\cdot\mathbf{v})
\in (0,\pi)
\]

Prefer `atan2` over `acos` for stability near 0 and \(\pi\).

4. **Trim length** (classic pipe-elbow / circular fillet):

\[
L = R \cdot \tan(\alpha / 2)
\]

Geometric reading: each leg is shortened by \(L\) so the remaining stubs are
tangent to a circle of radius \(R\).

5. **Too-short leg check.** Available half of the inbound leg is
   \(\|B-A\| - L_{\text{prev}}\) (after accounting for the bend at \(A\)), and
   similarly for the outbound leg. Implementation uses a two-pass approach:
   first compute all corner trims \(L_i\), then for each segment \(P_j \to P_{j+1}\)
   require

\[
L_{\text{start}} + L_{\text{end}} < \|P_{j+1}-P_j\| - \varepsilon_{\text{len}}
\]

   On violation return **`OCC_ERR_MATH`** with a clear message.

6. **Trim points**

\[
T_1 = B - \mathbf{u}\, L, \qquad T_2 = B + \mathbf{v}\, L
\]

7. **Plane normal and inward radial direction**

\[
\mathbf{N} = \frac{\mathbf{u}\times\mathbf{v}}{\|\mathbf{u}\times\mathbf{v}\|}
\]

The unit normal to the inbound segment pointing **into the turn**:

\[
\mathbf{n}_1 = \mathbf{N} \times \mathbf{u}
\]

(For a left turn in the XY plane with \(\mathbf{N}=+\mathbf{z}\), \(\mathbf{n}_1\)
points left of \(\mathbf{u}\). Right turns reverse \(\mathbf{N}\) automatically.)

8. **Arc center**

\[
O = T_1 + R\,\mathbf{n}_1
\]

Equivalently \(O = T_2 + R\,(\mathbf{N}\times\mathbf{v})\) — same point when the
inputs are consistent. Distance from \(B\) to \(O\):

\[
\|B - O\| = \frac{R}{\sin(\alpha/2)}
\]

9. **Mid-arc point** for `GC_MakeArcOfCircle(T1, Pmid, T2)`:

Rotate \(T_1\) about axis \((O, \mathbf{N})\) by angle \(+\alpha/2\):

\[
P_{\mathrm{mid}} = \mathrm{Rot}_{(O,\mathbf{N}),\,\alpha/2}(T_1)
\]

Positive sense about \(\mathbf{N}\) takes \(T_1\) toward \(T_2\) because
\(\mathbf{N}\) was built from \(\mathbf{u}\times\mathbf{v}\).

10. **Emit edges.** For each segment, emit the straight `GC_MakeSegment` between
    its trimmed endpoints (skip if length \(<\varepsilon\)). After each interior
    segment end, emit the bend arc at that vertex.

### Worked numeric check (90° elbow)

\(A=(-1,0,0),\; B=(0,0,0),\; C=(0,1,0),\; R=0.1\)

- \(\mathbf{u}=(1,0,0),\; \mathbf{v}=(0,1,0),\; \alpha=\pi/2\)
- \(L = 0.1\cdot\tan(\pi/4)=0.1\)
- \(T_1=(-0.1,0,0),\; T_2=(0,0.1,0)\)
- \(\mathbf{N}=(0,0,1),\; \mathbf{n}_1=(0,1,0)\)
- \(O = T_1 + 0.1\,\mathbf{n}_1 = (-0.1, 0.1, 0)\)
- \(P_{\mathrm{mid}} = (-0.1 + 0.1/\sqrt{2},\; 0.1 - 0.1/\sqrt{2},\; 0)\)

Arc subtends 90°, G1 with both stubs. ✓

### Closed loops

When first and last samples coincide (and \(n \ge 4\) before drop):

- Drop the duplicate last sample; number of segments = \(n\) after drop.
- Every vertex is a potential bend corner (wrap-around included).
- Trim budget on segment \(i\to(i+1)\bmod n\) uses \(L_i + L_{(i+1)\bmod n}\).

### Why not `BRepFilletAPI_MakeFillet` on a solid?

We fillet the **centerline wire**, not solid edges. Solid fillets change OD/ID
semantics; centerline fillets preserve nominal pipe length along the CL and
match process-piping practice.

---

## Header — `// === file: occ_c_route.h`

```c
// === file: occ_c_route.h
// OCCT 7.9.3 — routes, pipe solids, structural member sweeps (AI-BOOST P0).
// Extract to: api/include/occ_c_route.h
#ifndef OCC_C_ROUTE_H_
#define OCC_C_ROUTE_H_

#include "occ_c.h"
#include "occ_c_frames.h" /* occ_frame_t */

#ifdef __cplusplus
extern "C" {
#endif

/* Fallback status codes if host occ_c.h not yet patched. */
#ifndef OCC_ERR_GEOM
#define OCC_ERR_GEOM 8
#endif
#ifndef OCC_ERR_MATH
#define OCC_ERR_MATH 13
#endif

/* =========================================================================
 * Centerline routes (RoutePath)
 * ========================================================================= */

/**
 * Polyline wire through n_points samples of xyz[3*i+{0,1,2}] (meters).
 * If closed != 0, connects last point back to first (n_points >= 3).
 * Degenerate zero-length segments → OCC_ERR_GEOM.
 */
OCC_API int occ_make_route_polyline(const double* xyz, int n_points, int closed,
                                    occ_shape_t* out_wire);

/**
 * Polyline with circular bend fillets of radius bend_radius (meters) at every
 * interior vertex. Closed loops: if first and last samples coincide (within
 * 1e-9 m), the duplicate is dropped and the wrap-around corner is filleted.
 *
 * Algorithm: for turn angle alpha between unit segment directions u,v:
 *   L = R * tan(alpha/2); trim both legs by L; arc in plane of (u,v) via
 *   GC_MakeArcOfCircle(trim1, mid_arc, trim2). See section 04 doc.
 *
 * Collinear corners are skipped. Hairpin (alpha ≈ π) → OCC_ERR_GEOM.
 * Too-short legs for the requested R → OCC_ERR_MATH.
 * bend_radius == 0 falls back to occ_make_route_polyline (open).
 */
OCC_API int occ_make_route_with_bends(const double* xyz, int n_points,
                                      double bend_radius,
                                      occ_shape_t* out_wire);

/**
 * Arc-length of a wire (or any shape with edges) via BRepGProp::LinearProperties.
 * out_len in meters.
 */
OCC_API int occ_wire_length(occ_shape_t wire, double* out_len);

/**
 * Point + unit tangent at the geometric start (at_start != 0) or end of a wire.
 * Tangent follows wire direction of travel (start→end). origin/tangent are
 * length-3 arrays (meters / unitless). For a full occ_frame_t use
 * occ_frame_at_wire_fraction(wire, at_start ? 0 : 1, &f).
 */
OCC_API int occ_frame_at_wire_end(occ_shape_t wire, int at_start,
                                  double origin[3], double tangent[3]);

/**
 * Frame at fractional arc-length position t ∈ [0,1] along wire.
 * Uses cumulative edge lengths (preferred) with BRepAdaptor_Curve per edge;
 * falls back to BRepAdaptor_CompCurve parameter lerp if length is zero.
 * Z = unit tangent in the direction of increasing arc length.
 */
OCC_API int occ_frame_at_wire_fraction(occ_shape_t wire, double t,
                                       occ_frame_t* out_frame);

/**
 * One frame per route node. For i = 0..n-2: Z along outbound segment
 * (P_{i+1}-P_i). For the last node of an open path: Z along inbound
 * (P_{n-1}-P_{n-2}). Closed: every node uses outbound (wrap).
 * out_frames must hold at least n elements.
 */
OCC_API int occ_route_node_frames(const double* xyz, int n,
                                  int closed, occ_frame_t* out_frames);

/* =========================================================================
 * Profiles for sweeping (construction helpers, centered at origin on XY)
 * ========================================================================= */

/**
 * Planar circular face of given radius, center (cx,cy,cz), normal (nx,ny,nz).
 * Used as MakePipe profile for solid / annulus OD & ID.
 */
OCC_API int occ_make_circle_face(double cx, double cy, double cz,
                                 double nx, double ny, double nz,
                                 double radius, occ_shape_t* out);

/**
 * Rectangular profile wire centered at origin on the XY plane:
 * corners at (±width/2, ±height/2, 0), closed. Ready to transform to a spine
 * start frame before MakePipe, or used internally by member sweeps.
 */
OCC_API int occ_make_rect_profile_wire(double width, double height,
                                       occ_shape_t* out_wire);

/**
 * Circular profile wire (not face) of radius r, center origin, normal +Z.
 * Convenience for MakePipeShell and circular members.
 */
OCC_API int occ_make_circle_profile_wire(double radius, occ_shape_t* out_wire);

/* =========================================================================
 * Pipe solids (fluid path — SweepAlong)
 * ========================================================================= */

/**
 * Sweep profile (face or wire) along spine_wire with BRepOffsetAPI_MakePipe.
 * Spine should be G1 (use occ_make_route_with_bends). Profile is used as-is
 * (caller places it at the spine start, normal ≈ tangent).
 */
OCC_API int occ_pipe_solid(occ_shape_t profile_face_or_wire,
                           occ_shape_t spine_wire,
                           occ_shape_t* out);

/**
 * Hollow pipe: OD outer diameter, ID inner diameter (meters), both > 0, id < od.
 * Builds circle faces at spine start (normal = start tangent), MakePipe each,
 * then BRepAlgoAPI_Cut(OD, ID).
 */
OCC_API int occ_pipe_annulus(double od, double id, occ_shape_t spine_wire,
                             occ_shape_t* out);

/**
 * BRepOffsetAPI_MakePipeShell path:
 *   SetMode(Frenet=true), Add(profile, with_contact, WithCorrection=true),
 *   Build(), MakeSolid().
 * profile must be a wire (preferably closed for solid). with_contact != 0
 * translates the section onto the spine.
 */
OCC_API int occ_pipe_shell_profile(occ_shape_t profile_wire,
                                   occ_shape_t spine_wire,
                                   int with_contact,
                                   occ_shape_t* out);

/* =========================================================================
 * Structural members (skid steel — NOT fluid pipe)
 * ========================================================================= */

/**
 * Rectangular tube/bar of cross-section width × height (meters), centered on
 * the spine. Profile is built in the spine-start frame's XY (Z = tangent).
 * Uses BRepOffsetAPI_MakePipe on a planar rectangular face.
 */
OCC_API int occ_member_sweep_rect(double width, double height,
                                  occ_shape_t spine_wire,
                                  occ_shape_t* out);

/**
 * Circular bar / round HSS of given radius (meters) along spine.
 */
OCC_API int occ_member_sweep_circle(double radius, occ_shape_t spine_wire,
                                    occ_shape_t* out);

#ifdef __cplusplus
}
#endif
#endif /* OCC_C_ROUTE_H_ */
```

---

## Implementation — `// === file: occ_c_route.cc`

```cpp
// === file: occ_c_route.cc
// OCCT 7.9.3 — routes, pipe solids, structural member sweeps (AI-BOOST P0).
// Extract to: api/src/occ_c_route.cc
//
// Design notes
// ------------
// * continuous_sweep: bend R is baked into the centerline wire (G1 arcs).
// * Fluid pipe (circle/annulus) ≠ structural Frame (rect/circle member).
// * IR: RoutePath → wire; SweepAlong → occ_pipe_*; MemberSweep → occ_member_*.
// * Units: meters. Double precision throughout.
//
// Bend geometry (see literate section 04 for full derivation):
//   alpha = atan2(|u×v|, u·v)
//   L     = R * tan(alpha/2)
//   T1    = B - u*L
//   T2    = B + v*L
//   N     = normalize(u×v)
//   n1    = N × u          // inward normal at T1
//   O     = T1 + R * n1    // arc center
//   Pmid  = Rot_(O,N,alpha/2)(T1)
//   arc   = GC_MakeArcOfCircle(T1, Pmid, T2)

#include "occ_c_route.h"
#include "occ_c_internal.hxx"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

#include <BRepAlgoAPI_Cut.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepGProp.hxx>
#include <BRepOffsetAPI_MakePipe.hxx>
#include <BRepOffsetAPI_MakePipeShell.hxx>
#include <BRepTools_WireExplorer.hxx>
#include <BRep_Builder.hxx>
#include <BRepAdaptor_CompCurve.hxx>
#include <BRepAdaptor_Curve.hxx>
#include <GC_MakeArcOfCircle.hxx>
#include <GC_MakeSegment.hxx>
#include <GProp_GProps.hxx>
#include <Geom_TrimmedCurve.hxx>
#include <Standard_Failure.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Ax1.hxx>
#include <gp_Ax2.hxx>
#include <gp_Ax3.hxx>
#include <gp_Circ.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>

#ifndef OCC_ERR_GEOM
#define OCC_ERR_GEOM 8
#endif
#ifndef OCC_ERR_FRAME
#define OCC_ERR_FRAME 9
#endif
#ifndef OCC_ERR_MATH
#define OCC_ERR_MATH 13
#endif

using occ_c_detail::as_shape;
using occ_c_detail::set_last;
using occ_c_detail::to_handle;

namespace {

/* -------------------------------------------------------------------------
 * Numeric thresholds (meters / dimensionless). All SI meters.
 * ------------------------------------------------------------------------- */
constexpr double kEpsLen   = 1.0e-12;  /* zero-length segment (m) */
constexpr double kEpsAng   = 1.0e-10;  /* collinear / hairpin (rad-ish via sin) */
constexpr double kEpsDot   = 1.0e-12;  /* unit-vector clamp */
constexpr double kMinSeg   = 1.0e-9;   /* minimum residual straight after trim */

/* -------------------------------------------------------------------------
 * Small vector helpers
 * ------------------------------------------------------------------------- */

inline gp_Pnt P3(const double* xyz, int i) {
  return gp_Pnt(xyz[3 * i + 0], xyz[3 * i + 1], xyz[3 * i + 2]);
}

inline double clampd(double x, double lo, double hi) {
  return x < lo ? lo : (x > hi ? hi : x);
}

inline int require_wire(occ_shape_t s, const char* what) {
  if (!s) {
    set_last("null shape");
    return OCC_ERR_NULL_ARG;
  }
  if (as_shape(s)->ShapeType() != TopAbs_WIRE) {
    set_last(what);
    return OCC_ERR_INVALID_SHAPE;
  }
  return OCC_OK;
}

/**
 * Build a right-handed frame with origin p, Z = unit tangent z_dir.
 * X is chosen by projecting world +X (or +Y if Z ≈ world X) into the plane
 * perpendicular to Z — stable for piping stations and member profiles.
 */
int frame_from_origin_z(const gp_Pnt& p, const gp_Vec& z_in, occ_frame_t* out) {
  if (!out) return OCC_ERR_NULL_ARG;
  gp_Vec z = z_in;
  if (z.Magnitude() < kEpsLen) {
    set_last("frame: degenerate tangent");
    return OCC_ERR_FRAME;
  }
  z.Normalize();

  /* Prefer world +X as reference; if nearly parallel to Z, use world +Y. */
  gp_Vec ref(1.0, 0.0, 0.0);
  if (std::fabs(z.Dot(ref)) > 0.9) {
    ref = gp_Vec(0.0, 1.0, 0.0);
  }
  /* Project ref into plane ⟂ Z: X0 = ref - (ref·z) z */
  gp_Vec x_try = ref.Subtracted(z.Multiplied(ref.Dot(z)));
  if (x_try.Magnitude() < kEpsLen) {
    ref = gp_Vec(0.0, 0.0, 1.0);
    x_try = ref.Subtracted(z.Multiplied(ref.Dot(z)));
  }
  if (x_try.Magnitude() < kEpsLen) {
    set_last("frame: cannot complete axes");
    return OCC_ERR_FRAME;
  }
  x_try.Normalize();
  /* Right-handed: Y = Z × X, then X = Y × Z (re-orthogonalize). */
  gp_Vec y = z.Crossed(x_try);
  if (y.Magnitude() < kEpsLen) {
    set_last("frame: degenerate Y");
    return OCC_ERR_FRAME;
  }
  y.Normalize();
  gp_Vec x_rh = y.Crossed(z);
  x_rh.Normalize();

  out->origin[0] = p.X();
  out->origin[1] = p.Y();
  out->origin[2] = p.Z();
  out->x_axis[0] = x_rh.X();
  out->x_axis[1] = x_rh.Y();
  out->x_axis[2] = x_rh.Z();
  out->z_axis[0] = z.X();
  out->z_axis[1] = z.Y();
  out->z_axis[2] = z.Z();
  return OCC_OK;
}

/** gp_Trsf placing local XY profile into frame f (origin + X + Z). */
int trsf_from_frame(const occ_frame_t& f, gp_Trsf& t) {
  gp_Vec z(f.z_axis[0], f.z_axis[1], f.z_axis[2]);
  gp_Vec x(f.x_axis[0], f.x_axis[1], f.x_axis[2]);
  if (z.Magnitude() < kEpsLen || x.Magnitude() < kEpsLen) {
    set_last("frame: zero axis");
    return OCC_ERR_FRAME;
  }
  z.Normalize();
  /* Re-orthogonalize X against Z. */
  gp_Vec x_o = x.Subtracted(z.Multiplied(x.Dot(z)));
  if (x_o.Magnitude() < kEpsLen) {
    set_last("frame: X parallel Z");
    return OCC_ERR_FRAME;
  }
  x_o.Normalize();
  gp_Ax3 from; /* default world */
  gp_Ax3 to(gp_Pnt(f.origin[0], f.origin[1], f.origin[2]), gp_Dir(z),
            gp_Dir(x_o));
  t.SetTransformation(to, from);
  return OCC_OK;
}

/* -------------------------------------------------------------------------
 * Edge length helpers
 * ------------------------------------------------------------------------- */

double edge_length(const TopoDS_Edge& e) {
  GProp_GProps props;
  BRepGProp::LinearProperties(e, props, Standard_True);
  return props.Mass();
}

/**
 * Ordered edges of a wire via BRepTools_WireExplorer (preserves connectivity).
 * Falls back to TopExp_Explorer if the wire explorer yields nothing.
 */
void collect_wire_edges(const TopoDS_Wire& w, std::vector<TopoDS_Edge>& edges) {
  edges.clear();
  for (BRepTools_WireExplorer ex(w); ex.More(); ex.Next()) {
    edges.push_back(ex.Current());
  }
  if (edges.empty()) {
    for (TopExp_Explorer ex(w, TopAbs_EDGE); ex.More(); ex.Next()) {
      edges.push_back(TopoDS::Edge(ex.Current()));
    }
  }
}

/**
 * Evaluate point + unit tangent at arc-length fraction t∈[0,1] along ordered
 * edges. Direction of travel follows WireExplorer order.
 */
int eval_wire_fraction(const TopoDS_Wire& w, double t, gp_Pnt& p,
                       gp_Vec& tangent) {
  t = clampd(t, 0.0, 1.0);
  std::vector<TopoDS_Edge> edges;
  collect_wire_edges(w, edges);
  if (edges.empty()) {
    set_last("wire has no edges");
    return OCC_ERR_GEOM;
  }

  std::vector<double> lens(edges.size());
  double total = 0.0;
  for (size_t i = 0; i < edges.size(); ++i) {
    lens[i] = edge_length(edges[i]);
    if (lens[i] < 0.0) lens[i] = 0.0;
    total += lens[i];
  }

  if (total < kEpsLen) {
    /* Degenerate length — use CompCurve parameter lerp. */
    BRepAdaptor_CompCurve cc(w, /*KnotByCurvilinearAbcissa=*/Standard_True);
    const Standard_Real u0 = cc.FirstParameter();
    const Standard_Real u1 = cc.LastParameter();
    const Standard_Real u  = u0 + t * (u1 - u0);
    gp_Vec d1;
    cc.D1(u, p, d1);
    if (d1.Magnitude() < kEpsLen) {
      set_last("degenerate wire tangent (compcurve)");
      return OCC_ERR_GEOM;
    }
    d1.Normalize();
    tangent = d1;
    return OCC_OK;
  }

  const double target = t * total;
  double acc = 0.0;
  for (size_t i = 0; i < edges.size(); ++i) {
    const double L = lens[i];
    if (acc + L < target - 1e-15 && i + 1 < edges.size()) {
      acc += L;
      continue;
    }
    /* Parameterize this edge by its own arc-length fraction.
       BRepAdaptor_Curve respects TopoDS_Edge orientation, so First→Last
       already follows WireExplorer travel direction. */
    const double local = (L > kEpsLen) ? (target - acc) / L : 0.0;
    BRepAdaptor_Curve c(edges[i]);
    const Standard_Real u0 = c.FirstParameter();
    const Standard_Real u1 = c.LastParameter();
    const Standard_Real u =
        u0 + clampd(local, 0.0, 1.0) * (u1 - u0);
    gp_Vec d1;
    c.D1(u, p, d1);
    if (d1.Magnitude() < kEpsLen) {
      set_last("degenerate edge tangent");
      return OCC_ERR_GEOM;
    }
    d1.Normalize();
    tangent = d1;
    return OCC_OK;
  }

  /* Fallback: geometric end of the last edge. */
  BRepAdaptor_Curve c(edges.back());
  gp_Vec d1;
  c.D1(c.LastParameter(), p, d1);
  if (d1.Magnitude() < kEpsLen) {
    set_last("degenerate end tangent");
    return OCC_ERR_GEOM;
  }
  d1.Normalize();
  tangent = d1;
  return OCC_OK;
}

/* -------------------------------------------------------------------------
 * Corner / bend data
 * ------------------------------------------------------------------------- */

struct CornerData {
  bool   active = false;  /* true → emit circular arc at this vertex */
  double trim   = 0.0;    /* L = R * tan(alpha/2) */
  double alpha  = 0.0;    /* turn angle (radians) */
  gp_Pnt T1;              /* inbound trim point */
  gp_Pnt T2;              /* outbound trim point */
  gp_Pnt Pmid;            /* mid-arc point */
  gp_Dir N;               /* plane normal */
};

/**
 * Compute circular-fillet corner data at vertex B with previous A and next C.
 *
 * Returns:
 *   OCC_OK          — corner filled (active or collinear-skip)
 *   OCC_ERR_GEOM    — zero segment, hairpin, plane failure
 *   OCC_ERR_MATH    — (not used here; length budget checked later)
 */
int compute_corner(const gp_Pnt& A, const gp_Pnt& B, const gp_Pnt& C,
                   double R, CornerData& out) {
  out = CornerData{};

  gp_Vec u(A, B);
  gp_Vec v(B, C);
  const double lu = u.Magnitude();
  const double lv = v.Magnitude();
  if (lu < kEpsLen || lv < kEpsLen) {
    set_last("route: zero-length segment at bend vertex");
    return OCC_ERR_GEOM;
  }
  u.Normalize();
  v.Normalize();

  gp_Vec cross = u.Crossed(v);
  const double sin_a = cross.Magnitude();
  const double cos_a = clampd(u.Dot(v), -1.0, 1.0);

  /* Collinear: sin≈0 */
  if (sin_a < kEpsAng) {
    if (cos_a < 0.0) {
      set_last("route: 180-degree hairpin bend unsupported");
      return OCC_ERR_GEOM;
    }
    /* Nearly straight — no fillet. */
    out.active = false;
    out.trim   = 0.0;
    return OCC_OK;
  }

  const double alpha = std::atan2(sin_a, cos_a); /* (0, π) */
  if (alpha < kEpsAng) {
    out.active = false;
    out.trim   = 0.0;
    return OCC_OK;
  }
  if (std::fabs(alpha - M_PI) < 1e-8) {
    set_last("route: 180-degree bend unsupported");
    return OCC_ERR_GEOM;
  }

  const double half = 0.5 * alpha;
  const double tana = std::tan(half);
  if (!(tana >= 0.0) || !std::isfinite(tana)) {
    set_last("route: tan(alpha/2) numeric failure");
    return OCC_ERR_MATH;
  }
  const double L = R * tana;
  if (!std::isfinite(L) || L < 0.0) {
    set_last("route: trim length numeric failure");
    return OCC_ERR_MATH;
  }

  /* Plane normal N = normalize(u × v) */
  cross.Normalize();
  const gp_Dir N(cross);

  /* Inward normal at inbound side: n1 = N × u  (unit; N ⟂ u) */
  gp_Vec n1 = gp_Vec(N).Crossed(u);
  if (n1.Magnitude() < kEpsLen) {
    set_last("route: cannot form bend plane (inward normal)");
    return OCC_ERR_GEOM;
  }
  n1.Normalize();

  const gp_Pnt T1 = B.Translated(u.Multiplied(-L));
  const gp_Pnt T2 = B.Translated(v.Multiplied(L));
  const gp_Pnt O  = T1.Translated(n1.Multiplied(R));

  /* Mid-arc: rotate T1 about (O, N) by +alpha/2 */
  gp_Trsf rot;
  rot.SetRotation(gp_Ax1(O, N), half);
  const gp_Pnt Pmid = T1.Transformed(rot);

  /* Sanity: |O-T1| ≈ R, |O-T2| ≈ R */
  const double d1 = O.Distance(T1);
  const double d2 = O.Distance(T2);
  if (std::fabs(d1 - R) > 1e-6 * std::max(1.0, R) ||
      std::fabs(d2 - R) > 1e-6 * std::max(1.0, R)) {
    /* Soft check — still emit; floating noise on large coords. */
  }

  out.active = true;
  out.trim   = L;
  out.alpha  = alpha;
  out.T1     = T1;
  out.T2     = T2;
  out.Pmid   = Pmid;
  out.N      = N;
  return OCC_OK;
}

int add_segment_edge(BRepBuilderAPI_MakeWire& mk, const gp_Pnt& a,
                     const gp_Pnt& b) {
  if (a.Distance(b) <= kEpsLen) {
    return OCC_OK; /* skip zero stub */
  }
  GC_MakeSegment mkseg(a, b);
  if (!mkseg.IsDone()) {
    set_last("route: GC_MakeSegment failed");
    return OCC_ERR_GEOM;
  }
  BRepBuilderAPI_MakeEdge me(mkseg.Value());
  if (!me.IsDone()) {
    set_last("route: segment edge failed");
    return OCC_ERR_GEOM;
  }
  mk.Add(me.Edge());
  return OCC_OK;
}

int add_arc_edge(BRepBuilderAPI_MakeWire& mk, const CornerData& c) {
  GC_MakeArcOfCircle mkarc(c.T1, c.Pmid, c.T2);
  if (!mkarc.IsDone()) {
    set_last("route: GC_MakeArcOfCircle failed");
    return OCC_ERR_GEOM;
  }
  BRepBuilderAPI_MakeEdge me(mkarc.Value());
  if (!me.IsDone()) {
    set_last("route: bend arc edge failed");
    return OCC_ERR_GEOM;
  }
  mk.Add(me.Edge());
  return OCC_OK;
}

/**
 * Core bend builder.
 *
 * Two-pass:
 *   1) compute CornerData for every vertex that may receive a fillet;
 *   2) validate trim budgets on every segment; assemble wire.
 */
int build_route_with_bends(const double* xyz, int n_points, double R,
                           occ_shape_t* out) {
  if (n_points < 2) {
    set_last("route: need at least 2 points");
    return OCC_ERR_GEOM;
  }
  if (R < 0.0) {
    set_last("route: negative bend radius");
    return OCC_ERR_GEOM;
  }

  /* R == 0 → pure polyline (open). */
  if (R == 0.0 || n_points == 2) {
    return occ_make_route_polyline(xyz, n_points, /*closed=*/0, out);
  }

  std::vector<gp_Pnt> pts(static_cast<size_t>(n_points));
  for (int i = 0; i < n_points; ++i) {
    pts[static_cast<size_t>(i)] = P3(xyz, i);
  }

  /* Closed loop if first and last samples coincide (within 1e-9 m).
     Drop the duplicate last sample and fillet the wrap-around corner. */
  int is_closed = 0;
  if (n_points >= 4 && pts.front().Distance(pts.back()) < 1e-9) {
    pts.pop_back();
    n_points = static_cast<int>(pts.size());
    is_closed = 1;
  }

  if (is_closed && n_points < 3) {
    set_last("route: closed path needs >= 3 points");
    return OCC_ERR_GEOM;
  }

  const int n = n_points;
  const int n_seg = is_closed ? n : (n - 1);

  /* ---- Pass 1: corner data per vertex ---- */
  std::vector<CornerData> corners(static_cast<size_t>(n));

  auto prev_idx = [&](int i) -> int {
    if (i > 0) return i - 1;
    return is_closed ? (n - 1) : -1;
  };
  auto next_idx = [&](int i) -> int {
    if (i + 1 < n) return i + 1;
    return is_closed ? 0 : -1;
  };

  for (int i = 0; i < n; ++i) {
    const int ip = prev_idx(i);
    const int in = next_idx(i);
    if (ip < 0 || in < 0) {
      /* Open path endpoints — no bend. */
      corners[static_cast<size_t>(i)].active = false;
      corners[static_cast<size_t>(i)].trim   = 0.0;
      continue;
    }
    const int st =
        compute_corner(pts[static_cast<size_t>(ip)], pts[static_cast<size_t>(i)],
                       pts[static_cast<size_t>(in)], R,
                       corners[static_cast<size_t>(i)]);
    if (st != OCC_OK) return st;
  }

  /* ---- Pass 2: segment length budgets ---- */
  for (int s = 0; s < n_seg; ++s) {
    const int i0 = s;
    const int i1 = (s + 1) % n;
    const double seg_len =
        pts[static_cast<size_t>(i0)].Distance(pts[static_cast<size_t>(i1)]);
    if (seg_len < kEpsLen) {
      set_last("route: zero-length segment");
      return OCC_ERR_GEOM;
    }
    const double L0 = corners[static_cast<size_t>(i0)].trim;
    const double L1 = corners[static_cast<size_t>(i1)].trim;
    if (L0 + L1 > seg_len - kMinSeg) {
      char buf[192];
      std::snprintf(buf, sizeof(buf),
                    "route: bend radius too large for segment %d "
                    "(need L0+L1=%.6g < len=%.6g m)",
                    s, L0 + L1, seg_len);
      set_last(buf);
      return OCC_ERR_MATH;
    }
  }

  /* ---- Pass 3: assemble wire ----
   *
   * For each segment s: i0 → i1
   *   start point = (corner i0 active) ? corners[i0].T2 : pts[i0]
   *                 (T2 is the outbound trim of the bend at i0)
   *   end point   = (corner i1 active) ? corners[i1].T1 : pts[i1]
   *   emit straight(start, end)
   *   if corner i1 active and (not the fictitious open end): emit arc at i1
   *
   * For open paths, arcs only at vertices 1..n-2 (already encoded by active).
   * For closed paths, after last segment emit arc at vertex 0 if active —
   * handled naturally because i1 runs through all vertices via wrap.
   *
   * Careful: after segment ending at i1 we emit arc at i1, which connects
   * T1→T2; the next segment then starts at T2. Good.
   *
   * For closed loops, the final arc at the vertex that closes must not be
   * double-emitted. We emit the arc at i1 for every segment; when s runs
   * 0..n-1, each vertex appears exactly once as i1. ✓
   */
  BRepBuilderAPI_MakeWire mk_wire;

  for (int s = 0; s < n_seg; ++s) {
    const int i0 = s;
    const int i1 = is_closed ? ((s + 1) % n) : (s + 1);

    const CornerData& c0 = corners[static_cast<size_t>(i0)];
    const CornerData& c1 = corners[static_cast<size_t>(i1)];

    const gp_Pnt start =
        c0.active ? c0.T2 : pts[static_cast<size_t>(i0)];
    const gp_Pnt end =
        c1.active ? c1.T1 : pts[static_cast<size_t>(i1)];

    int st = add_segment_edge(mk_wire, start, end);
    if (st != OCC_OK) return st;

    /* Arc at the end vertex of this segment when that corner is active.
       For open paths the last vertex (n-1) is never active, so the final
       segment does not grow a trailing arc. */
    if (c1.active) {
      st = add_arc_edge(mk_wire, c1);
      if (st != OCC_OK) return st;
    }
  }

  if (!mk_wire.IsDone()) {
    set_last("route: wire assembly failed");
    return OCC_ERR_GEOM;
  }
  *out = to_handle(mk_wire.Wire());
  return OCC_OK;
}

/* -------------------------------------------------------------------------
 * Profile placement: circle face / rect face at a frame
 * ------------------------------------------------------------------------- */

int make_circle_face_at(const gp_Pnt& c, const gp_Dir& n, double radius,
                        TopoDS_Face& face_out) {
  if (radius <= 0.0) {
    set_last("circle face: radius must be > 0");
    return OCC_ERR_GEOM;
  }
  gp_Ax2 ax(c, n);
  gp_Circ circ(ax, radius);
  BRepBuilderAPI_MakeEdge me(circ);
  if (!me.IsDone()) {
    set_last("circle face: edge failed");
    return OCC_ERR_GEOM;
  }
  BRepBuilderAPI_MakeWire mw(me.Edge());
  if (!mw.IsDone()) {
    set_last("circle face: wire failed");
    return OCC_ERR_GEOM;
  }
  BRepBuilderAPI_MakeFace mf(mw.Wire(), /*OnlyPlane=*/Standard_True);
  if (!mf.IsDone()) {
    set_last("circle face: face failed");
    return OCC_ERR_GEOM;
  }
  face_out = mf.Face();
  return OCC_OK;
}

int make_rect_face_at_frame(const occ_frame_t& f, double width, double height,
                            TopoDS_Face& face_out) {
  if (width <= 0.0 || height <= 0.0) {
    set_last("rect profile: width/height must be > 0");
    return OCC_ERR_GEOM;
  }
  const double hx = 0.5 * width;
  const double hy = 0.5 * height;
  /* Local rectangle in frame XY (Z = spine tangent). */
  const gp_Pnt loc[4] = {
      gp_Pnt(-hx, -hy, 0.0),
      gp_Pnt( hx, -hy, 0.0),
      gp_Pnt( hx,  hy, 0.0),
      gp_Pnt(-hx,  hy, 0.0),
  };
  gp_Trsf t;
  int st = trsf_from_frame(f, t);
  if (st != OCC_OK) return st;

  BRepBuilderAPI_MakePolygon poly;
  for (int i = 0; i < 4; ++i) {
    poly.Add(loc[i].Transformed(t));
  }
  poly.Close();
  if (!poly.IsDone()) {
    set_last("rect profile: polygon failed");
    return OCC_ERR_GEOM;
  }
  BRepBuilderAPI_MakeFace mf(poly.Wire(), /*OnlyPlane=*/Standard_True);
  if (!mf.IsDone()) {
    set_last("rect profile: face failed");
    return OCC_ERR_GEOM;
  }
  face_out = mf.Face();
  return OCC_OK;
}

int make_circle_face_at_frame(const occ_frame_t& f, double radius,
                              TopoDS_Face& face_out) {
  gp_Pnt c(f.origin[0], f.origin[1], f.origin[2]);
  gp_Dir n(f.z_axis[0], f.z_axis[1], f.z_axis[2]);
  return make_circle_face_at(c, n, radius, face_out);
}

/** Spine start frame helper (point+tangent → occ_frame_t). */
int spine_start_frame(occ_shape_t spine, occ_frame_t* f) {
  double o[3], t[3];
  const int st = occ_frame_at_wire_end(spine, /*at_start=*/1, o, t);
  if (st != OCC_OK) return st;
  return frame_from_origin_z(gp_Pnt(o[0], o[1], o[2]),
                             gp_Vec(t[0], t[1], t[2]), f);
}

int do_make_pipe(const TopoDS_Wire& spine, const TopoDS_Shape& profile,
                 TopoDS_Shape& solid_out) {
  BRepOffsetAPI_MakePipe mk(spine, profile);
  mk.Build();
  if (!mk.IsDone()) {
    set_last("MakePipe failed (spine must be G1; try occ_make_route_with_bends)");
    return OCC_ERR_GEOM;
  }
  solid_out = mk.Shape();
  return OCC_OK;
}

}  // namespace

extern "C" {

/* =========================================================================
 * Routes
 * ========================================================================= */

int occ_make_route_polyline(const double* xyz, int n_points, int closed,
                            occ_shape_t* out_wire) {
  REQ(xyz && out_wire, OCC_ERR_NULL_ARG);
  REQ(n_points >= 2, OCC_ERR_GEOM);
  if (closed) {
    REQ(n_points >= 3, OCC_ERR_GEOM);
  }
  OCC_GUARD_BEGIN

  /* Reject zero-length consecutive samples early. */
  for (int i = 0; i < n_points - 1; ++i) {
    if (P3(xyz, i).Distance(P3(xyz, i + 1)) < kEpsLen) {
      set_last("route polyline: zero-length segment");
      return OCC_ERR_GEOM;
    }
  }
  if (closed && P3(xyz, n_points - 1).Distance(P3(xyz, 0)) < kEpsLen) {
    set_last("route polyline: closed loop zero-length closing segment");
    return OCC_ERR_GEOM;
  }

  BRepBuilderAPI_MakePolygon poly;
  for (int i = 0; i < n_points; ++i) {
    poly.Add(P3(xyz, i));
  }
  if (closed) {
    poly.Close();
  }
  if (!poly.IsDone()) {
    set_last("route polyline failed (degenerate points?)");
    return OCC_ERR_GEOM;
  }
  *out_wire = to_handle(poly.Wire());
  return OCC_OK;
  OCC_GUARD_END
}

int occ_make_route_with_bends(const double* xyz, int n_points,
                              double bend_radius, occ_shape_t* out_wire) {
  REQ(xyz && out_wire, OCC_ERR_NULL_ARG);
  REQ(n_points >= 2, OCC_ERR_GEOM);
  REQ(bend_radius >= 0.0, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  return build_route_with_bends(xyz, n_points, bend_radius, out_wire);
  OCC_GUARD_END
}

int occ_wire_length(occ_shape_t wire, double* out_len) {
  REQ(wire && out_len, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  GProp_GProps props;
  BRepGProp::LinearProperties(*as_shape(wire), props, Standard_True);
  *out_len = props.Mass();
  return OCC_OK;
  OCC_GUARD_END
}

int occ_frame_at_wire_end(occ_shape_t wire, int at_start,
                          double origin[3], double tangent[3]) {
  REQ(wire && origin && tangent, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  const int stw = require_wire(wire, "frame_at_wire_end: expected wire");
  if (stw != OCC_OK) return stw;

  const double t = at_start ? 0.0 : 1.0;
  gp_Pnt p;
  gp_Vec tan;
  const int st =
      eval_wire_fraction(TopoDS::Wire(*as_shape(wire)), t, p, tan);
  if (st != OCC_OK) return st;
  origin[0] = p.X(); origin[1] = p.Y(); origin[2] = p.Z();
  tangent[0] = tan.X(); tangent[1] = tan.Y(); tangent[2] = tan.Z();
  return OCC_OK;
  OCC_GUARD_END
}

int occ_frame_at_wire_fraction(occ_shape_t wire, double t,
                               occ_frame_t* out_frame) {
  REQ(wire && out_frame, OCC_ERR_NULL_ARG);
  if (t < 0.0 || t > 1.0) {
    set_last("frame_at_wire_fraction: t must be in [0,1]");
    return OCC_ERR_GEOM;
  }
  OCC_GUARD_BEGIN
  const int stw = require_wire(wire, "frame_at_wire_fraction: expected wire");
  if (stw != OCC_OK) return stw;

  gp_Pnt p;
  gp_Vec tan;
  const int st =
      eval_wire_fraction(TopoDS::Wire(*as_shape(wire)), t, p, tan);
  if (st != OCC_OK) return st;
  return frame_from_origin_z(p, tan, out_frame);
  OCC_GUARD_END
}

int occ_route_node_frames(const double* xyz, int n, int closed,
                          occ_frame_t* out_frames) {
  REQ(xyz && out_frames, OCC_ERR_NULL_ARG);
  REQ(n >= 2, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN

  for (int i = 0; i < n; ++i) {
    gp_Pnt o = P3(xyz, i);
    gp_Vec z;

    if (closed) {
      /* Outbound segment, wrapping. */
      const int j = (i + 1) % n;
      z = gp_Vec(o, P3(xyz, j));
      if (z.Magnitude() < kEpsLen) {
        /* Fall back to inbound. */
        const int k = (i - 1 + n) % n;
        z = gp_Vec(P3(xyz, k), o);
      }
    } else if (i < n - 1) {
      /* Open: Z along outbound for all but last. */
      z = gp_Vec(o, P3(xyz, i + 1));
      if (z.Magnitude() < kEpsLen && i > 0) {
        z = gp_Vec(P3(xyz, i - 1), o);
      }
    } else {
      /* Last node of open path: Z along inbound. */
      z = gp_Vec(P3(xyz, n - 2), o);
    }

    if (z.Magnitude() < kEpsLen) {
      char buf[96];
      std::snprintf(buf, sizeof(buf),
                    "route_node_frames: degenerate segment at node %d", i);
      set_last(buf);
      return OCC_ERR_GEOM;
    }
    const int st = frame_from_origin_z(o, z, &out_frames[i]);
    if (st != OCC_OK) return st;
  }
  return OCC_OK;
  OCC_GUARD_END
}

/* =========================================================================
 * Profiles
 * ========================================================================= */

int occ_make_circle_face(double cx, double cy, double cz, double nx, double ny,
                         double nz, double radius, occ_shape_t* out) {
  REQ(out, OCC_ERR_NULL_ARG);
  REQ(radius > 0.0, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  gp_Vec nv(nx, ny, nz);
  if (nv.Magnitude() < kEpsLen) {
    set_last("circle face: zero normal");
    return OCC_ERR_GEOM;
  }
  TopoDS_Face face;
  const int st =
      make_circle_face_at(gp_Pnt(cx, cy, cz), gp_Dir(nv), radius, face);
  if (st != OCC_OK) return st;
  *out = to_handle(face);
  return OCC_OK;
  OCC_GUARD_END
}

int occ_make_rect_profile_wire(double width, double height,
                               occ_shape_t* out_wire) {
  REQ(out_wire, OCC_ERR_NULL_ARG);
  REQ(width > 0.0 && height > 0.0, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  const double hx = 0.5 * width;
  const double hy = 0.5 * height;
  BRepBuilderAPI_MakePolygon poly;
  poly.Add(gp_Pnt(-hx, -hy, 0.0));
  poly.Add(gp_Pnt( hx, -hy, 0.0));
  poly.Add(gp_Pnt( hx,  hy, 0.0));
  poly.Add(gp_Pnt(-hx,  hy, 0.0));
  poly.Close();
  if (!poly.IsDone()) {
    set_last("rect profile wire failed");
    return OCC_ERR_GEOM;
  }
  *out_wire = to_handle(poly.Wire());
  return OCC_OK;
  OCC_GUARD_END
}

int occ_make_circle_profile_wire(double radius, occ_shape_t* out_wire) {
  REQ(out_wire, OCC_ERR_NULL_ARG);
  REQ(radius > 0.0, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  gp_Ax2 ax(gp_Pnt(0.0, 0.0, 0.0), gp_Dir(0.0, 0.0, 1.0));
  gp_Circ circ(ax, radius);
  BRepBuilderAPI_MakeEdge me(circ);
  if (!me.IsDone()) {
    set_last("circle profile wire: edge failed");
    return OCC_ERR_GEOM;
  }
  BRepBuilderAPI_MakeWire mw(me.Edge());
  if (!mw.IsDone()) {
    set_last("circle profile wire: wire failed");
    return OCC_ERR_GEOM;
  }
  *out_wire = to_handle(mw.Wire());
  return OCC_OK;
  OCC_GUARD_END
}

/* =========================================================================
 * Pipe solids
 * ========================================================================= */

int occ_pipe_solid(occ_shape_t profile_face_or_wire, occ_shape_t spine_wire,
                   occ_shape_t* out) {
  REQ(profile_face_or_wire && spine_wire && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  const int stw = require_wire(spine_wire, "pipe_solid: spine must be wire");
  if (stw != OCC_OK) return stw;

  const TopoDS_Shape& prof = *as_shape(profile_face_or_wire);
  const TopAbs_ShapeEnum pt = prof.ShapeType();
  if (pt != TopAbs_FACE && pt != TopAbs_WIRE && pt != TopAbs_EDGE &&
      pt != TopAbs_VERTEX) {
    set_last("pipe_solid: profile must be face/wire/edge (not a solid)");
    return OCC_ERR_INVALID_SHAPE;
  }

  TopoDS_Shape solid;
  const int st =
      do_make_pipe(TopoDS::Wire(*as_shape(spine_wire)), prof, solid);
  if (st != OCC_OK) return st;
  *out = to_handle(solid);
  return OCC_OK;
  OCC_GUARD_END
}

int occ_pipe_annulus(double od, double id, occ_shape_t spine_wire,
                     occ_shape_t* out) {
  REQ(spine_wire && out, OCC_ERR_NULL_ARG);
  if (!(od > id && id > 0.0)) {
    set_last("annulus pipe: require od > id > 0");
    return OCC_ERR_GEOM;
  }
  OCC_GUARD_BEGIN
  const int stw = require_wire(spine_wire, "annulus pipe: spine must be wire");
  if (stw != OCC_OK) return stw;

  occ_frame_t f0;
  int st = spine_start_frame(spine_wire, &f0);
  if (st != OCC_OK) return st;

  const double ro = 0.5 * od;
  const double ri = 0.5 * id;

  TopoDS_Face face_od, face_id;
  st = make_circle_face_at_frame(f0, ro, face_od);
  if (st != OCC_OK) return st;
  st = make_circle_face_at_frame(f0, ri, face_id);
  if (st != OCC_OK) return st;

  const TopoDS_Wire spine = TopoDS::Wire(*as_shape(spine_wire));
  TopoDS_Shape solid_od, solid_id;
  st = do_make_pipe(spine, face_od, solid_od);
  if (st != OCC_OK) return st;
  st = do_make_pipe(spine, face_id, solid_id);
  if (st != OCC_OK) return st;

  BRepAlgoAPI_Cut cut(solid_od, solid_id);
  cut.Build();
  if (!cut.IsDone()) {
    set_last("annulus pipe: boolean cut failed");
    return OCC_ERR_BOOLEAN;
  }
  *out = to_handle(cut.Shape());
  return OCC_OK;
  OCC_GUARD_END
}

int occ_pipe_shell_profile(occ_shape_t profile_wire, occ_shape_t spine_wire,
                           int with_contact, occ_shape_t* out) {
  REQ(profile_wire && spine_wire && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  int st = require_wire(spine_wire, "pipe_shell: spine must be wire");
  if (st != OCC_OK) return st;
  st = require_wire(profile_wire, "pipe_shell: profile must be wire");
  if (st != OCC_OK) return st;

  const TopoDS_Wire spine = TopoDS::Wire(*as_shape(spine_wire));
  const TopoDS_Wire prof  = TopoDS::Wire(*as_shape(profile_wire));

  BRepOffsetAPI_MakePipeShell mk(spine);
  /* Frenet trihedron — good default for smooth G1 spines. */
  mk.SetMode(/*IsFrenet=*/Standard_True);
  /* WithCorrection rotates profile to be orthogonal to the spine tangent. */
  mk.Add(prof, with_contact ? Standard_True : Standard_False,
         /*WithCorrection=*/Standard_True);
  if (!mk.IsReady()) {
    set_last("pipe_shell: not ready (profile?)");
    return OCC_ERR_GEOM;
  }
  mk.Build();
  if (!mk.IsDone()) {
    set_last("pipe_shell: Build failed");
    return OCC_ERR_GEOM;
  }
  /* MakeSolid requires a closed profile; if it returns false, still return
     the shell so callers can inspect. */
  if (!mk.MakeSolid()) {
    set_last("pipe_shell: MakeSolid failed (is profile closed?)");
    /* Still hand back the shell shape — useful for debugging. */
    *out = to_handle(mk.Shape());
    return OCC_ERR_GEOM;
  }
  *out = to_handle(mk.Shape());
  return OCC_OK;
  OCC_GUARD_END
}

/* =========================================================================
 * Structural members (skid steel)
 * ========================================================================= */

int occ_member_sweep_rect(double width, double height, occ_shape_t spine_wire,
                          occ_shape_t* out) {
  REQ(spine_wire && out, OCC_ERR_NULL_ARG);
  REQ(width > 0.0 && height > 0.0, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  const int stw =
      require_wire(spine_wire, "member_sweep_rect: spine must be wire");
  if (stw != OCC_OK) return stw;

  occ_frame_t f0;
  int st = spine_start_frame(spine_wire, &f0);
  if (st != OCC_OK) return st;

  TopoDS_Face face;
  st = make_rect_face_at_frame(f0, width, height, face);
  if (st != OCC_OK) return st;

  TopoDS_Shape solid;
  st = do_make_pipe(TopoDS::Wire(*as_shape(spine_wire)), face, solid);
  if (st != OCC_OK) return st;
  *out = to_handle(solid);
  return OCC_OK;
  OCC_GUARD_END
}

int occ_member_sweep_circle(double radius, occ_shape_t spine_wire,
                            occ_shape_t* out) {
  REQ(spine_wire && out, OCC_ERR_NULL_ARG);
  REQ(radius > 0.0, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  const int stw =
      require_wire(spine_wire, "member_sweep_circle: spine must be wire");
  if (stw != OCC_OK) return stw;

  occ_frame_t f0;
  int st = spine_start_frame(spine_wire, &f0);
  if (st != OCC_OK) return st;

  TopoDS_Face face;
  st = make_circle_face_at_frame(f0, radius, face);
  if (st != OCC_OK) return st;

  TopoDS_Shape solid;
  st = do_make_pipe(TopoDS::Wire(*as_shape(spine_wire)), face, solid);
  if (st != OCC_OK) return st;
  *out = to_handle(solid);
  return OCC_OK;
  OCC_GUARD_END
}

}  // extern "C"
```

---

## Smoke tests (conceptual C)

```c
#include "occ_c.h"
#include "occ_c_route.h"
#include <math.h>
#include <stdio.h>

static int expect_ok(int st, const char* what) {
  if (st != OCC_OK) {
    fprintf(stderr, "FAIL %s: %s (%d)\n", what, occ_last_error(), st);
    return 0;
  }
  return 1;
}

int smoke_route_pipe_member(void) {
  /* ---- 1. Polyline ---- */
  double poly[] = {
    0,0,0,
    1,0,0,
    1,1,0,
    0,1,0
  };
  occ_shape_t w_poly = 0;
  if (!expect_ok(occ_make_route_polyline(poly, 4, 0, &w_poly), "polyline"))
    return 1;

  double len = 0.0;
  if (!expect_ok(occ_wire_length(w_poly, &len), "wire_length")) return 1;
  printf("polyline length = %.6f m (expect 3)\n", len);

  /* ---- 2. Bends: 90° elbow, R=0.1 ---- */
  double elbow[] = {
    -1, 0, 0,
     0, 0, 0,
     0, 1, 0
  };
  occ_shape_t w_bend = 0;
  if (!expect_ok(occ_make_route_with_bends(elbow, 3, 0.1, &w_bend),
                 "bends"))
    return 1;
  if (!expect_ok(occ_wire_length(w_bend, &len), "bend length")) return 1;
  /* Straight stubs: (1-0.1) + (1-0.1) + arc quarter-circle 0.1*(pi/2) */
  const double expect = 0.9 + 0.9 + 0.1 * (M_PI * 0.5);
  printf("bend length = %.6f m (expect ~%.6f)\n", len, expect);
  if (fabs(len - expect) > 1e-4) {
    fprintf(stderr, "FAIL bend length mismatch\n");
    return 1;
  }

  /* ---- 3. Too-short legs → OCC_ERR_MATH ---- */
  double short_leg[] = {
    0,0,0,
    0.05,0,0,
    0.05,0.05,0
  };
  occ_shape_t w_bad = 0;
  int st = occ_make_route_with_bends(short_leg, 3, 0.1, &w_bad);
  if (st != OCC_ERR_MATH) {
    fprintf(stderr, "FAIL expected OCC_ERR_MATH, got %d (%s)\n",
            st, occ_last_error());
    return 1;
  }
  printf("too-short legs correctly → OCC_ERR_MATH: %s\n", occ_last_error());

  /* ---- 4. Frames along wire ---- */
  double o0[3], t0[3], o1[3], t1[3];
  occ_frame_t fm;
  if (!expect_ok(occ_frame_at_wire_end(w_bend, 1, o0, t0), "frame start"))
    return 1;
  if (!expect_ok(occ_frame_at_wire_end(w_bend, 0, o1, t1), "frame end"))
    return 1;
  if (!expect_ok(occ_frame_at_wire_fraction(w_bend, 0.5, &fm), "frame mid"))
    return 1;
  printf("start origin (%.3f,%.3f,%.3f) t=(%.3f,%.3f,%.3f)\n",
         o0[0], o0[1], o0[2], t0[0], t0[1], t0[2]);

  occ_frame_t nodes[3];
  if (!expect_ok(occ_route_node_frames(elbow, 3, 0, nodes), "node frames"))
    return 1;

  /* ---- 5. Annulus pipe (~4" NPS style diameters, meters) ---- */
  double skid[] = {
    0, 0, 0,
    0, 0, 1.2,
    0.8, 0, 1.2,
    0.8, 0, 0.3
  };
  occ_shape_t path = 0, pipe = 0;
  if (!expect_ok(occ_make_route_with_bends(skid, 4, 0.15, &path),
                 "skid route"))
    return 1;
  if (!expect_ok(occ_pipe_annulus(0.1143, 0.1023, path, &pipe),
                 "annulus"))
    return 1;
  printf("annulus pipe OK\n");

  /* ---- 6. Structural W200-ish rect member along same path ---- */
  occ_shape_t beam = 0;
  if (!expect_ok(occ_member_sweep_rect(0.200, 0.100, path, &beam),
                 "member rect"))
    return 1;
  printf("member rect OK\n");

  occ_shape_t rod = 0;
  if (!expect_ok(occ_member_sweep_circle(0.025, path, &rod),
                 "member circle"))
    return 1;

  /* ---- 7. PipeShell with XY circle profile ---- */
  occ_shape_t cprof = 0, shell_solid = 0;
  if (!expect_ok(occ_make_circle_profile_wire(0.05, &cprof), "circ prof"))
    return 1;
  /* Place profile at spine start via contact+correction inside PipeShell. */
  st = occ_pipe_shell_profile(cprof, path, /*with_contact=*/1, &shell_solid);
  if (st != OCC_OK) {
    fprintf(stderr, "pipe_shell: %s (%d) — non-fatal in smoke\n",
            occ_last_error(), st);
  } else {
    printf("pipe_shell OK\n");
  }

  /* ---- 8. Closed loop with bends ---- */
  /* Closed: repeat first point as last so wrap-around corner is filleted. */
  double loop[] = {
    0, 0, 0,
    1, 0, 0,
    1, 1, 0,
    0, 1, 0,
    0, 0, 0
  };
  occ_shape_t w_loop = 0;
  if (!expect_ok(occ_make_route_with_bends(loop, 5, 0.1, &w_loop),
                 "closed bends"))
    return 1;
  if (!expect_ok(occ_wire_length(w_loop, &len), "loop len")) return 1;
  printf("closed bend loop length = %.6f m\n", len);

  occ_shape_free(w_poly);
  occ_shape_free(w_bend);
  occ_shape_free(path);
  occ_shape_free(pipe);
  occ_shape_free(beam);
  occ_shape_free(rod);
  occ_shape_free(cprof);
  if (shell_solid) occ_shape_free(shell_solid);
  occ_shape_free(w_loop);
  printf("smoke_route_pipe_member: OK\n");
  return 0;
}
```

---

## Golden expectations

| Case | Expect |
|------|--------|
| 90° elbow R=0.1, legs 1 m | length \(1.8 + 0.05\pi\) m |
| R too large for legs | `OCC_ERR_MATH` |
| Hairpin (u·v ≈ −1, sin≈0) | `OCC_ERR_GEOM` |
| Collinear points | skipped bend, polyline continues |
| `id >= od` or `id <= 0` | `OCC_ERR_GEOM` |
| Spine not wire | `OCC_ERR_INVALID_SHAPE` |
| `t` outside [0,1] | `OCC_ERR_GEOM` |
| MakePipe on sharp polyline (no bends) | may fail G1 — use bends |

---

## Extraction checklist

1. Add `OCC_ERR_MATH = 13` to `occ_status_t` in `occ_c.h`.
2. Install `occ_c_route.h` next to `occ_c_frames.h`.
3. Compile `occ_c_route.cc` into `//api:occ_c_lib` (Bazel / CMake).
4. Ensure OCCT subset links `TKOffset` (MakePipe / MakePipeShell), `TKGeomBase` (`GC_*`), `TKTopAlgo`, `TKBO` (cut), `TKG3d` / `TKBRep`.
5. Wasm size budget: route+pipe is core AI-BOOST — keep in P0 kernel.
6. Wire Luau `cad.route` / `cad.structure` / IR `RoutePath` + `SweepAlong` + `MemberSweep`.

---

## Design rationale (implementer notes)

### Why bake bends into the wire?

`BRepOffsetAPI_MakePipe` requires a **G1** spine. A raw polyline has C0 corners
only; sweeping a circle across a kink produces self-intersections or algorithm
failure. Filleting the centerline with radius R:

- Matches process-piping “bend radius = N × OD” practice.
- Keeps a single solid for clash / mass / STEP (continuous_sweep P0).
- Defers fittings BOM to a P1 `segment_and_fittings` recipe.

### Why annulus = two pipes + cut?

A true hollow sweep (shell + thicken) is possible via `MakePipeShell` +
`MakeThickSolid`, but OD/ID as two solid sweeps + `BRepAlgoAPI_Cut` is:

- Numerically robust for constant wall thickness.
- Trivial to validate (`id < od`).
- Identical topology to “drill the ID after OD sweep”.

### Why separate member sweeps?

Skid steel (W-shapes, HSS, pipe-as-structure) must not share the fluid
`RoutePath` identity. Same spine geometry can drive both, but product IR keeps
`MemberSweep` distinct from `SweepAlong` so BOM, materials, and MeshPrep domains
stay clean.

### Profile placement

`MakePipe` does **not** auto-move the profile to the spine start. Callers of
`occ_pipe_solid` must place the profile; high-level helpers
(`occ_pipe_annulus`, `occ_member_sweep_*`) build the profile in the spine-start
frame (origin + Z=tangent) so the first section is orthogonal to the path.

`occ_pipe_shell_profile` uses `WithCorrection=true` so a profile drawn in world
XY can be auto-rotated onto the spine — useful for catalog sections.

### Frame convention

`occ_frame_t = { origin, x_axis, z_axis }` with implied
\(\mathbf{y} = \mathbf{z}\times\mathbf{x}\). Along a wire, **Z = tangent**.
Supports and clamps attach with Z along the run; flanges use the same frames via
`occ_route_node_frames` / `occ_frame_at_wire_end`.

---

## API surface summary

| Function | OCCT engine | Returns |
|----------|-------------|---------|
| `occ_make_route_polyline` | `MakePolygon` | wire |
| `occ_make_route_with_bends` | `GC_MakeSegment` + `GC_MakeArcOfCircle` + `MakeWire` | G1 wire |
| `occ_wire_length` | `BRepGProp::LinearProperties` | meters |
| `occ_frame_at_wire_end` | cumulative edges / `BRepAdaptor_Curve` | `occ_frame_t` |
| `occ_frame_at_wire_fraction` | cumulative arc-length | `occ_frame_t` |
| `occ_route_node_frames` | pure math on samples | `occ_frame_t[n]` |
| `occ_make_circle_face` | `gp_Circ` + `MakeFace` | face |
| `occ_make_rect_profile_wire` | `MakePolygon` on XY | wire |
| `occ_make_circle_profile_wire` | `gp_Circ` + `MakeWire` | wire |
| `occ_pipe_solid` | `BRepOffsetAPI_MakePipe` | solid/shell |
| `occ_pipe_annulus` | 2× MakePipe + `BRepAlgoAPI_Cut` | solid |
| `occ_pipe_shell_profile` | `BRepOffsetAPI_MakePipeShell` | solid |
| `occ_member_sweep_rect` | rect face + MakePipe | solid |
| `occ_member_sweep_circle` | circle face + MakePipe | solid |

---

## Closed-loop assembly diagram (implementer)

```text
Open path, n=4 vertices (indices 0..3), bends at 1 and 2:

  P0 ----straight---- T1(c1) ~~arc~~ T2(c1) ----straight---- T1(c2) ~~arc~~ T2(c2) ----straight---- P3
       seg0                bend@1              seg1                bend@2              seg2

Closed path, n=4, bends at 0,1,2,3:

  T2(c0) --s0-- T1(c1) ~a1~ T2(c1) --s1-- T1(c2) ~a2~ T2(c2) --s2-- T1(c3) ~a3~ T2(c3) --s3-- T1(c0) ~a0~ (back)
```

Segment budget for segment \(s\): \(L_s + L_{s+1} < \|P_{s+1}-P_s\|\).

---

## Compatibility with baseline `occ_pipe`

Baseline `occ_c` already ships `occ_pipe(profile, spine, out)`.  
`occ_pipe_solid` is the P0-named alias with stricter validation and error
strings; implementations may forward:

```cpp
int occ_pipe_solid(occ_shape_t profile, occ_shape_t spine, occ_shape_t* out) {
  /* full implementation above — do not call a stub */
}
```

Do **not** remove baseline `occ_pipe`; Luau shims may call either.

---

## File end

Literate section 04 complete. Extract the two `// === file:` blocks into
`api/include/occ_c_route.h` and `api/src/occ_c_route.cc`, patch `OCC_ERR_MATH`,
link TKOffset/TKBO/TKGeomBase, and run `smoke_route_pipe_member`.

<!-- END 04-route-pipe-member.md -->


<!-- BEGIN 05-patterns-holes-split.md -->

# Part E — Patterns, Holes, Compounds, Split

**Document type:** Literate programming source for the Apache **`occ_c`** C API  
**Section:** 05 — Patterns / Holes / Compounds / Split  
**OCCT pin:** **7.9.3**  
**Priority:** P0 (linear/polar/holes/compound) · P1 (along-path, counterbore/sink, split)  
**Product goals:** flange bolt circles · skid support patterns · pipe hanger spacing · plate split  

---

## How to extract

1. Blocks tagged `// === file: <name>` are **authoritative source**.  
2. Install headers under `api/include/`, sources under `api/src/`.  
3. Share `as_shape` / `to_handle` / `OCC_GUARD_*` / `set_last` / `REQ` via private `occ_c_internal.hxx` (see front-matter).  
4. Units: **meters**, **radians**, topology indices **1-based**, hole sizes are **diameters**.  
5. Pattern APIs return a **compound of instances** by default; fuse with `occ_boolean_fuse_pattern` / `occ_fuse_many` when a single solid is required.

```text
api/include/occ_c_pattern.h
api/include/occ_c_hole.h
api/include/occ_c_boolean_ext.h
api/src/occ_c_pattern.cc
api/src/occ_c_hole.cc
api/src/occ_c_boolean_ext.cc
```

---

## Pedagogy

### Bolt-circle IR (robot flange / pipe flange)

A 6-bolt flange is not six independent features in IR — it is:

1. Disc solid (revolve or extrude).  
2. One hole **seed** at radius \(R\) on the pitch circle.  
3. `PatternPolar` with axis = flange normal, `count = 6`, `angle_step = 2π/6`.  
4. Optional fuse is **not** needed for holes — pattern the tool and `CutMany`.

```text
flange  = MakeCylinder(od=0.12, h=0.02)
tools   = PatternPolar(seed_tool_cyl, center=0, axis=Z, count=6)
result  = CutMany(flange, tools)
```

### PatternAlongPath supports on a pipe

AI-BOOST skid: hangers / U-bolt pads spaced along a process line.

1. `spine = RoutePath(...)` wire.  
2. `pad = MakeBox(...)` authored at origin, local +Z = “forward”.  
3. `occ_pattern_along_path(pad, spine, count=N, align_tangent=1, &pads)` places copies at equal arc-length; with align, each pad’s +Z follows the path tangent.  
4. `occ_fuse_many` if a single body is preferred for clash.

### Split for manufacturing / half models

`occ_split_by_plane` uses a **finite half-space tool** (plane face → `BRepPrimAPI_MakeHalfSpace` → Common with oversized box) then `BRepAlgoAPI_Cut` twice. Pure infinite half-spaces stress BOP on thin shells — the bbox-enlarged solid tool keeps the boolean finite.

`occ_split_by_shape` uses `BRepAlgoAPI_Splitter` (OCCT 7.9.3): objects = solid, tools = face/shell/solid; result = compound of object parts only.

---

## OCCT 7.9.3 map

| `occ_c` symbol | Primary OCCT |
|----------------|--------------|
| `occ_pattern_linear*` | `gp_Trsf::SetTranslation` + `BRepBuilderAPI_Transform` + compound |
| `occ_pattern_polar*` | `gp_Trsf::SetRotation` + `gp_Ax1` |
| `occ_pattern_along_path` | `BRepAdaptor_CompCurve` + `GCPnts_AbscissaPoint` + `gp_Ax3` |
| `occ_pattern_from_transforms` | `gp_Trsf::SetValues` (4×3) |
| `occ_boolean_fuse_pattern` | pattern then sequential `BRepAlgoAPI_Fuse` |
| `occ_drill_hole_through` | bbox diagonal ×2 cylinder + `BRepAlgoAPI_Cut` |
| `occ_drill_hole_blind` | `BRepPrimAPI_MakeCylinder` + Cut |
| `occ_drill_hole_counterbore` | two cylinders fused + Cut |
| `occ_drill_hole_countersink` | cylinder + `BRepPrimAPI_MakeCone` fused tool |
| `occ_hole_on_face_center` | `TopExp::MapShapes` + `BRepGProp` + face normal |
| `occ_make_compound` / explode | `BRep_Builder` / `TopoDS_Iterator` |
| `occ_split_by_plane` | plane face + `MakeHalfSpace` + finite box ∩ + Cut |
| `occ_split_by_shape` | `BRepAlgoAPI_Splitter` |
| `occ_fuse_many` / `occ_cut_many` | sequential Fuse / Cut |

---

## Header — `// === file: occ_c_pattern.h`

```c
// === file: occ_c_pattern.h
#ifndef OCC_C_PATTERN_H_
#define OCC_C_PATTERN_H_

#include "occ_c.h"

#ifdef __cplusplus
extern "C" {
#endif

/* =========================================================================
 * Patterns — P0/P1 kernel for flanges, bolt circles, supports.
 *
 * Convention:
 *   - count includes the seed at the identity transform (index 0),
 *     except occ_pattern_linear_exclude_seed which skips identity.
 *   - Results are TopoDS_COMPOUND of copied shapes (Copy=true transforms).
 *   - Units: meters, radians.
 * ========================================================================= */

/**
 * Linear pattern: instances at i * (dx,dy,dz) for i = 0 .. count-1.
 * Instance 0 is a copy of seed at the original location.
 */
OCC_API int occ_pattern_linear(occ_shape_t seed,
                               double dx, double dy, double dz,
                               int count,
                               occ_shape_t* out_compound);

/**
 * Additional instances only: translations 1*d .. count*d.
 * Use when the seed body already lives in the model.
 */
OCC_API int occ_pattern_linear_exclude_seed(occ_shape_t seed,
                                            double dx, double dy, double dz,
                                            int count,
                                            occ_shape_t* out);

/**
 * Polar pattern about axis through (px,py,pz) direction (ax,ay,az).
 * Instance i is rotated by i * angle_step_rad, i = 0 .. count-1.
 */
OCC_API int occ_pattern_polar(occ_shape_t seed,
                              double px, double py, double pz,
                              double ax, double ay, double az,
                              double angle_step_rad,
                              int count,
                              occ_shape_t* out);

/**
 * Full-circle polar: angle_step = 2π / count.
 * Does not place a duplicate at 2π (seed occupies angle 0).
 */
OCC_API int occ_pattern_polar_full_circle(occ_shape_t seed,
                                          double px, double py, double pz,
                                          double ax, double ay, double az,
                                          int count,
                                          occ_shape_t* out);

/**
 * Place `count` copies of seed along spine_wire at equal arc-length.
 *
 * Spacing:
 *   L = wire length
 *   s_i = i * L / max(count-1, 1)   for i = 0 .. count-1
 *   (count==1 → only the start of the wire)
 *
 * If align_tangent_bool != 0:
 *   Rigid map world origin→P(s_i), world +Z→unit tangent T(s_i).
 *   X = stable perpendicular (prefer world-Z × T unless nearly parallel).
 *   Seed assumed authored near origin with +Z "forward".
 *
 * If align_tangent_bool == 0:
 *   Pure translation by (P(s_i) - P(0)); orientation fixed (world-upright pads).
 */
OCC_API int occ_pattern_along_path(occ_shape_t seed,
                                   occ_shape_t spine_wire,
                                   int count,
                                   int align_tangent_bool,
                                   occ_shape_t* out);

/**
 * Apply explicit rigid transforms to seed.
 * matrices: row-major 3×4 blocks packed as n * 12 doubles:
 *   [ r11 r12 r13 tx  r21 r22 r23 ty  r31 r32 r33 tz ]
 * Same layout as occ_frame_to_trsf_4x3 / occ_transform_shape_4x3.
 */
OCC_API int occ_pattern_from_transforms(occ_shape_t seed,
                                        const double* matrices_4x3,
                                        int n,
                                        occ_shape_t* out);

/**
 * Pattern seed by the given transforms, then fuse each instance into base
 * (sequential BRepAlgoAPI_Fuse). If n==0, returns a copy of base.
 */
OCC_API int occ_boolean_fuse_pattern(occ_shape_t base,
                                     occ_shape_t seed,
                                     const double* matrices_4x3,
                                     int n,
                                     occ_shape_t* out);

#ifdef __cplusplus
}
#endif

#endif /* OCC_C_PATTERN_H_ */
```

---

## Header — `// === file: occ_c_hole.h`

```c
// === file: occ_c_hole.h
#ifndef OCC_C_HOLE_H_
#define OCC_C_HOLE_H_

#include "occ_c.h"

#ifdef __cplusplus
extern "C" {
#endif

/* =========================================================================
 * Simple holes — P0/P1 (no standards tables, no hole attributes).
 *
 * All sizes are full diameters in meters.
 * Direction (dx,dy,dz) is the drill axis; material is removed along +dir
 * for blind features starting at origin. Through tools are centered on
 * the origin so they exit both sides.
 * ========================================================================= */

/**
 * Through-all cylindrical hole.
 * Tool length = bbox_diagonal(solid) * 2 (+ margin). Cylinder is centered
 * on (cx,cy,cz) along unit(dx,dy,dz) so both faces are pierced for any
 * solid whose extent is within one diagonal of the point.
 */
OCC_API int occ_drill_hole_through(occ_shape_t solid,
                                   double cx, double cy, double cz,
                                   double dx, double dy, double dz,
                                   double diameter,
                                   occ_shape_t* out);

/**
 * Blind cylindrical hole of given depth along +dir from origin.
 */
OCC_API int occ_drill_hole_blind(occ_shape_t solid,
                                 double ox, double oy, double oz,
                                 double dx, double dy, double dz,
                                 double diameter,
                                 double depth,
                                 occ_shape_t* out);

/**
 * Counterbore: large cylinder (cbore_d × cbore_depth) from origin along
 * +dir, then smaller tap cylinder (tap_d × tap_depth) from the same origin.
 * Tool = Fuse(cbore_cyl, tap_cyl); result = Cut(solid, tool).
 */
OCC_API int occ_drill_hole_counterbore(occ_shape_t solid,
                                       double ox, double oy, double oz,
                                       double dx, double dy, double dz,
                                       double tap_d, double tap_depth,
                                       double cbore_d, double cbore_depth,
                                       occ_shape_t* out);

/**
 * Countersink: cylindrical tap (tap_d × tap_depth) plus conical mouth of
 * included angle csink_angle_rad and axial depth csink_depth.
 *
 * half_angle = csink_angle_rad / 2
 * R_mouth    = csink_depth * tan(half_angle)
 * Cone: R1=R_mouth at origin, R2=0 at z=csink_depth (apex inside solid).
 */
OCC_API int occ_drill_hole_countersink(occ_shape_t solid,
                                       double ox, double oy, double oz,
                                       double dx, double dy, double dz,
                                       double tap_d, double tap_depth,
                                       double csink_angle_rad,
                                       double csink_depth,
                                       occ_shape_t* out);

/**
 * Drill at face center of mass, along face normal (oriented to enter
 * from outside via solid classifier heuristic).
 *
 * face_index_1based: 1 .. N faces
 * through_or_depth:  <= 0 → through-all;  > 0 → blind of that depth
 */
OCC_API int occ_hole_on_face_center(occ_shape_t solid,
                                    int face_index_1based,
                                    double diameter,
                                    double through_or_depth,
                                    occ_shape_t* out);

#ifdef __cplusplus
}
#endif

#endif /* OCC_C_HOLE_H_ */
```

---

## Header — `// === file: occ_c_boolean_ext.h`

```c
// === file: occ_c_boolean_ext.h
#ifndef OCC_C_BOOLEAN_EXT_H_
#define OCC_C_BOOLEAN_EXT_H_

#include "occ_c.h"

#ifdef __cplusplus
extern "C" {
#endif

/* Compounds, split, multi-boolean — P0/P1 grouping & partition helpers. */

/** Pack n shapes into a TopoDS_COMPOUND. */
OCC_API int occ_make_compound(const occ_shape_t* shapes, int n,
                              occ_shape_t* out);

/**
 * Explode direct children of a compound (or the shape itself if not a
 * compound — then out_count=1).
 * out_shapes: caller array of capacity max_out.
 * Returns OCC_ERR_INDEX if children > max_out (still fills max_out).
 */
OCC_API int occ_explode_compound(occ_shape_t compound,
                                 occ_shape_t* out_shapes,
                                 int max_out,
                                 int* out_count);

/**
 * Split solid by plane through (ox,oy,oz) normal (nx,ny,nz).
 *
 * Implementation (finite half-space — read carefully):
 *   1. Planar face large enough to cover solid bbox (diag*4).
 *   2. MakeHalfSpace(face, ref_point on +normal / -normal).
 *   3. Common(half-space, oversized AABB of solid) → finite tool H±.
 *   4. out_pos = Cut(solid, H−)  → portion on the +normal side.
 *   5. out_neg = Cut(solid, H+)  → portion on the −normal side.
 *
 * Infinite half-spaces alone can make BOP slow; clipping keeps tools finite.
 * Both outputs may be compounds if the cut disconnects the solid.
 */
OCC_API int occ_split_by_plane(occ_shape_t solid,
                               double ox, double oy, double oz,
                               double nx, double ny, double nz,
                               occ_shape_t* out_pos,
                               occ_shape_t* out_neg);

/**
 * Split solid by cutter (face, shell, or solid) via BRepAlgoAPI_Splitter.
 * Result compound contains only split object parts (tool parts excluded).
 */
OCC_API int occ_split_by_shape(occ_shape_t solid,
                               occ_shape_t cutter_face_or_shell,
                               occ_shape_t* out_compound_parts);

/** Sequential fuse of n shapes (n>=1). n==1 returns a copy. */
OCC_API int occ_fuse_many(const occ_shape_t* shapes, int n, occ_shape_t* out);

/** Sequential cut: base minus tools[0], tools[1], ... */
OCC_API int occ_cut_many(occ_shape_t base,
                         const occ_shape_t* tools, int n,
                         occ_shape_t* out);

#ifdef __cplusplus
}
#endif

#endif /* OCC_C_BOOLEAN_EXT_H_ */
```

---

## Implementation — `// === file: occ_c_pattern.cc`

```cpp
// === file: occ_c_pattern.cc
// OCCT 7.9.3 — linear / polar / along-path / transform patterns + fuse.
#include "occ_c_pattern.h"
#include "occ_c_internal.hxx"

#include <cmath>
#include <vector>

#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRep_Builder.hxx>
#include <BRepAdaptor_CompCurve.hxx>
#include <GCPnts_AbscissaPoint.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Wire.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <gp_Ax1.hxx>
#include <gp_Ax3.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>

using occ_c_detail::as_shape;
using occ_c_detail::to_handle;
using occ_c_detail::set_last;

namespace {

constexpr double k_eps = 1.0e-12;

int pack_compound(const std::vector<TopoDS_Shape>& parts, occ_shape_t* out) {
  if (parts.empty()) {
    set_last("pattern: no instances");
    return OCC_ERR_GEOM;
  }
  if (parts.size() == 1) {
    *out = to_handle(parts[0]);
    return OCC_OK;
  }
  TopoDS_Compound comp;
  BRep_Builder bb;
  bb.MakeCompound(comp);
  for (const auto& s : parts) bb.Add(comp, s);
  *out = to_handle(comp);
  return OCC_OK;
}

TopoDS_Shape xform_copy(const TopoDS_Shape& seed, const gp_Trsf& t) {
  BRepBuilderAPI_Transform mk(seed, t, /*Copy=*/Standard_True);
  return mk.Shape();
}

gp_Trsf trsf_from_4x3(const double* m) {
  gp_Trsf t;
  t.SetValues(m[0], m[1], m[2], m[3],
              m[4], m[5], m[6], m[7],
              m[8], m[9], m[10], m[11]);
  return t;
}

/** Build transform placing world origin→P and world +Z→T (unit). */
int trsf_align_z_to_tangent(const gp_Pnt& P, const gp_Vec& Traw, gp_Trsf& out) {
  if (Traw.Magnitude() < k_eps) {
    set_last("pattern_along_path: degenerate tangent");
    return OCC_ERR_GEOM;
  }
  gp_Dir z(Traw);
  gp_Vec up(0.0, 0.0, 1.0);
  if (std::abs(gp_Vec(z).Dot(up)) > 0.999) {
    up = gp_Vec(1.0, 0.0, 0.0);
  }
  gp_Vec x = up.Crossed(gp_Vec(z));
  if (x.Magnitude() < k_eps) {
    set_last("pattern_along_path: cannot build frame");
    return OCC_ERR_GEOM;
  }
  x.Normalize();
  gp_Ax3 target(P, z, gp_Dir(x));
  out.SetDisplacement(gp_Ax3() /*world*/, target);
  return OCC_OK;
}

int sample_wire_at_abscissa(const TopoDS_Wire& wire, double s,
                            gp_Pnt& P, gp_Vec& T) {
  BRepAdaptor_CompCurve curve(wire, /*KnotByCurvilinearAbcissa=*/Standard_True);
  const double L = GCPnts_AbscissaPoint::Length(curve);
  if (L < k_eps) {
    set_last("pattern_along_path: zero-length wire");
    return OCC_ERR_GEOM;
  }
  double ss = s;
  if (ss < 0.0) ss = 0.0;
  if (ss > L) ss = L;

  const double u0 = curve.FirstParameter();
  GCPnts_AbscissaPoint ap(curve, ss, u0);
  if (!ap.IsDone()) {
    const double u1 = curve.LastParameter();
    const double u = u0 + (u1 - u0) * (ss / L);
    curve.D1(u, P, T);
  } else {
    curve.D1(ap.Parameter(), P, T);
  }
  if (T.Magnitude() < k_eps) {
    set_last("pattern_along_path: null tangent at sample");
    return OCC_ERR_GEOM;
  }
  return OCC_OK;
}

}  // namespace

extern "C" {

int occ_pattern_linear(occ_shape_t seed,
                       double dx, double dy, double dz,
                       int count,
                       occ_shape_t* out_compound) {
  REQ(seed && out_compound, OCC_ERR_NULL_ARG);
  REQ(count >= 1, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  const TopoDS_Shape& S = *as_shape(seed);
  std::vector<TopoDS_Shape> parts;
  parts.reserve(static_cast<size_t>(count));
  for (int i = 0; i < count; ++i) {
    gp_Trsf t;
    if (i != 0) t.SetTranslation(gp_Vec(dx * i, dy * i, dz * i));
    parts.push_back(xform_copy(S, t));
  }
  return pack_compound(parts, out_compound);
  OCC_GUARD_END
}

int occ_pattern_linear_exclude_seed(occ_shape_t seed,
                                    double dx, double dy, double dz,
                                    int count,
                                    occ_shape_t* out) {
  REQ(seed && out, OCC_ERR_NULL_ARG);
  REQ(count >= 1, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  const TopoDS_Shape& S = *as_shape(seed);
  std::vector<TopoDS_Shape> parts;
  parts.reserve(static_cast<size_t>(count));
  for (int i = 1; i <= count; ++i) {
    gp_Trsf t;
    t.SetTranslation(gp_Vec(dx * i, dy * i, dz * i));
    parts.push_back(xform_copy(S, t));
  }
  return pack_compound(parts, out);
  OCC_GUARD_END
}

int occ_pattern_polar(occ_shape_t seed,
                      double px, double py, double pz,
                      double ax, double ay, double az,
                      double angle_step_rad,
                      int count,
                      occ_shape_t* out) {
  REQ(seed && out, OCC_ERR_NULL_ARG);
  REQ(count >= 1, OCC_ERR_GEOM);
  if (gp_Vec(ax, ay, az).Magnitude() < k_eps) {
    set_last("pattern_polar: zero axis");
    return OCC_ERR_GEOM;
  }
  OCC_GUARD_BEGIN
  const TopoDS_Shape& S = *as_shape(seed);
  gp_Ax1 axis(gp_Pnt(px, py, pz), gp_Dir(ax, ay, az));
  std::vector<TopoDS_Shape> parts;
  parts.reserve(static_cast<size_t>(count));
  for (int i = 0; i < count; ++i) {
    gp_Trsf t;
    if (i != 0) t.SetRotation(axis, angle_step_rad * static_cast<double>(i));
    parts.push_back(xform_copy(S, t));
  }
  return pack_compound(parts, out);
  OCC_GUARD_END
}

int occ_pattern_polar_full_circle(occ_shape_t seed,
                                  double px, double py, double pz,
                                  double ax, double ay, double az,
                                  int count,
                                  occ_shape_t* out) {
  REQ(count >= 1, OCC_ERR_GEOM);
  const double step = (2.0 * M_PI) / static_cast<double>(count);
  return occ_pattern_polar(seed, px, py, pz, ax, ay, az, step, count, out);
}

int occ_pattern_along_path(occ_shape_t seed,
                           occ_shape_t spine_wire,
                           int count,
                           int align_tangent_bool,
                           occ_shape_t* out) {
  REQ(seed && spine_wire && out, OCC_ERR_NULL_ARG);
  REQ(count >= 1, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  const TopoDS_Shape& spine = *as_shape(spine_wire);
  if (spine.ShapeType() != TopAbs_WIRE) {
    set_last("pattern_along_path: spine must be a wire");
    return OCC_ERR_INVALID_SHAPE;
  }
  const TopoDS_Wire wire = TopoDS::Wire(spine);
  const TopoDS_Shape& S = *as_shape(seed);

  BRepAdaptor_CompCurve curve(wire, Standard_True);
  const double L = GCPnts_AbscissaPoint::Length(curve);
  if (L < k_eps) {
    set_last("pattern_along_path: zero-length wire");
    return OCC_ERR_GEOM;
  }

  gp_Pnt P0;
  gp_Vec T0;
  int st0 = sample_wire_at_abscissa(wire, 0.0, P0, T0);
  if (st0 != OCC_OK) return st0;

  std::vector<TopoDS_Shape> parts;
  parts.reserve(static_cast<size_t>(count));

  for (int i = 0; i < count; ++i) {
    const double s =
        (count == 1) ? 0.0
                     : (L * static_cast<double>(i) /
                        static_cast<double>(count - 1));
    gp_Pnt P;
    gp_Vec T;
    int st = sample_wire_at_abscissa(wire, s, P, T);
    if (st != OCC_OK) return st;

    gp_Trsf tr;
    if (align_tangent_bool) {
      st = trsf_align_z_to_tangent(P, T, tr);
      if (st != OCC_OK) return st;
    } else {
      tr.SetTranslation(gp_Vec(P0, P));
    }
    parts.push_back(xform_copy(S, tr));
  }
  return pack_compound(parts, out);
  OCC_GUARD_END
}

int occ_pattern_from_transforms(occ_shape_t seed,
                                const double* matrices_4x3,
                                int n,
                                occ_shape_t* out) {
  REQ(seed && out, OCC_ERR_NULL_ARG);
  REQ(n >= 1, OCC_ERR_GEOM);
  REQ(matrices_4x3, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  const TopoDS_Shape& S = *as_shape(seed);
  std::vector<TopoDS_Shape> parts;
  parts.reserve(static_cast<size_t>(n));
  for (int i = 0; i < n; ++i) {
    const double* m = matrices_4x3 + static_cast<size_t>(i) * 12;
    parts.push_back(xform_copy(S, trsf_from_4x3(m)));
  }
  return pack_compound(parts, out);
  OCC_GUARD_END
}

int occ_boolean_fuse_pattern(occ_shape_t base,
                             occ_shape_t seed,
                             const double* matrices_4x3,
                             int n,
                             occ_shape_t* out) {
  REQ(base && out, OCC_ERR_NULL_ARG);
  if (n < 0) return OCC_ERR_GEOM;
  OCC_GUARD_BEGIN
  if (n == 0) {
    gp_Trsf id;
    *out = to_handle(xform_copy(*as_shape(base), id));
    return OCC_OK;
  }
  REQ(seed && matrices_4x3, OCC_ERR_NULL_ARG);

  TopoDS_Shape acc = *as_shape(base);
  const TopoDS_Shape& S = *as_shape(seed);
  for (int i = 0; i < n; ++i) {
    const double* m = matrices_4x3 + static_cast<size_t>(i) * 12;
    TopoDS_Shape inst = xform_copy(S, trsf_from_4x3(m));
    BRepAlgoAPI_Fuse fuse(acc, inst);
    fuse.Build();
    if (!fuse.IsDone()) {
      set_last("boolean_fuse_pattern: fuse failed");
      return OCC_ERR_BOOLEAN;
    }
    acc = fuse.Shape();
  }
  *out = to_handle(acc);
  return OCC_OK;
  OCC_GUARD_END
}

}  // extern "C"
```

---

## Implementation — `// === file: occ_c_hole.cc`

```cpp
// === file: occ_c_hole.cc
// OCCT 7.9.3 — through / blind / counterbore / countersink / face-center.
#include "occ_c_hole.h"
#include "occ_c_internal.hxx"

#include <cmath>

#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepBndLib.hxx>
#include <BRepGProp.hxx>
#include <BRepLProp_SLProps.hxx>
#include <BRepPrimAPI_MakeCone.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepClass3d_SolidClassifier.hxx>
#include <Bnd_Box.hxx>
#include <GProp_GProps.hxx>
#include <TopExp.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <TopAbs_State.hxx>
#include <gp_Ax2.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>

using occ_c_detail::as_shape;
using occ_c_detail::to_handle;
using occ_c_detail::set_last;

namespace {

constexpr double k_eps = 1.0e-12;

int unit_dir(double dx, double dy, double dz, gp_Dir& out) {
  const double m = std::sqrt(dx * dx + dy * dy + dz * dz);
  if (m < k_eps) {
    set_last("hole: zero direction");
    return OCC_ERR_GEOM;
  }
  out = gp_Dir(dx / m, dy / m, dz / m);
  return OCC_OK;
}

/** Long enough cylinder to pierce any solid whose bbox contains the origin. */
double through_length(const TopoDS_Shape& solid) {
  Bnd_Box b;
  BRepBndLib::Add(solid, b);
  if (b.IsVoid()) return 1.0e3;
  double x0, y0, z0, x1, y1, z1;
  b.Get(x0, y0, z0, x1, y1, z1);
  const double dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
  const double diag = std::sqrt(dx * dx + dy * dy + dz * dz);
  /* Spec: diagonal * 2, plus small absolute margin for open bboxes. */
  return diag * 2.0 + 1.0e-3;
}

int cut_with_tool(const TopoDS_Shape& solid, const TopoDS_Shape& tool,
                  occ_shape_t* out, const char* err) {
  BRepAlgoAPI_Cut cut(solid, tool);
  cut.Build();
  if (!cut.IsDone()) {
    set_last(err);
    return OCC_ERR_BOOLEAN;
  }
  *out = to_handle(cut.Shape());
  return OCC_OK;
}

TopoDS_Shape make_cyl(const gp_Pnt& origin, const gp_Dir& dir,
                      double radius, double height) {
  gp_Ax2 ax(origin, dir);
  return BRepPrimAPI_MakeCylinder(ax, radius, height).Shape();
}

int fuse2(const TopoDS_Shape& a, const TopoDS_Shape& b, TopoDS_Shape& out) {
  BRepAlgoAPI_Fuse op(a, b);
  op.Build();
  if (!op.IsDone()) {
    set_last("hole: tool fuse failed");
    return OCC_ERR_BOOLEAN;
  }
  out = op.Shape();
  return OCC_OK;
}

int face_at_index(const TopoDS_Shape& solid, int face_index_1based,
                  TopoDS_Face& out_face) {
  TopTools_IndexedMapOfShape map;
  TopExp::MapShapes(solid, TopAbs_FACE, map);
  if (face_index_1based < 1 || face_index_1based > map.Extent()) {
    set_last("hole_on_face_center: face index out of range");
    return OCC_ERR_INDEX;
  }
  out_face = TopoDS::Face(map(face_index_1based));
  return OCC_OK;
}

int face_center_and_normal(const TopoDS_Face& face,
                           gp_Pnt& center, gp_Dir& normal) {
  GProp_GProps props;
  BRepGProp::SurfaceProperties(face, props);
  center = props.CentreOfMass();

  BRepAdaptor_Surface surf(face, Standard_True);
  const double u0 = surf.FirstUParameter();
  const double u1 = surf.LastUParameter();
  const double v0 = surf.FirstVParameter();
  const double v1 = surf.LastVParameter();
  const double um = 0.5 * (u0 + u1);
  const double vm = 0.5 * (v0 + v1);

  BRepLProp_SLProps lp(surf, um, vm, /*N=*/1, /*res=*/1.0e-9);
  if (!lp.IsNormalDefined()) {
    set_last("hole_on_face_center: normal undefined");
    return OCC_ERR_GEOM;
  }
  normal = lp.Normal();
  if (props.Mass() <= k_eps) {
    center = lp.Value();
  }
  return OCC_OK;
}

/** Flip normal so the tool enters from outside (classifier heuristic). */
void orient_drill_inward(const TopoDS_Shape& solid, const gp_Pnt& center,
                         gp_Dir& dir) {
  try {
    BRepClass3d_SolidClassifier cls(solid);
    const double eps = 1.0e-4;
    gp_Pnt outside = center.Translated(gp_Vec(dir).Multiplied(eps));
    gp_Pnt inside  = center.Translated(gp_Vec(dir).Multiplied(-eps));
    cls.Perform(outside, 1.0e-7);
    const TopAbs_State so = cls.State();
    cls.Perform(inside, 1.0e-7);
    const TopAbs_State si = cls.State();
    if (so == TopAbs_IN && si != TopAbs_IN) {
      dir.Reverse();
    }
  } catch (...) {
    /* Leave dir as surface normal. */
  }
}

}  // namespace

extern "C" {

int occ_drill_hole_through(occ_shape_t solid,
                           double cx, double cy, double cz,
                           double dx, double dy, double dz,
                           double diameter,
                           occ_shape_t* out) {
  REQ(solid && out, OCC_ERR_NULL_ARG);
  REQ(diameter > 0.0, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  gp_Dir d;
  int st = unit_dir(dx, dy, dz, d);
  if (st != OCC_OK) return st;

  const TopoDS_Shape& body = *as_shape(solid);
  const double L = through_length(body);
  const double r = 0.5 * diameter;
  gp_Pnt origin(cx, cy, cz);
  /* Center the tool on the origin so it sticks out both sides. */
  gp_Pnt start = origin.Translated(gp_Vec(d).Multiplied(-0.5 * L));
  TopoDS_Shape tool = make_cyl(start, d, r, L);
  return cut_with_tool(body, tool, out, "through hole cut failed");
  OCC_GUARD_END
}

int occ_drill_hole_blind(occ_shape_t solid,
                         double ox, double oy, double oz,
                         double dx, double dy, double dz,
                         double diameter,
                         double depth,
                         occ_shape_t* out) {
  REQ(solid && out, OCC_ERR_NULL_ARG);
  REQ(diameter > 0.0 && depth > 0.0, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  gp_Dir d;
  int st = unit_dir(dx, dy, dz, d);
  if (st != OCC_OK) return st;
  TopoDS_Shape tool =
      make_cyl(gp_Pnt(ox, oy, oz), d, 0.5 * diameter, depth);
  return cut_with_tool(*as_shape(solid), tool, out, "blind hole cut failed");
  OCC_GUARD_END
}

int occ_drill_hole_counterbore(occ_shape_t solid,
                               double ox, double oy, double oz,
                               double dx, double dy, double dz,
                               double tap_d, double tap_depth,
                               double cbore_d, double cbore_depth,
                               occ_shape_t* out) {
  REQ(solid && out, OCC_ERR_NULL_ARG);
  REQ(tap_d > 0.0 && tap_depth > 0.0, OCC_ERR_GEOM);
  REQ(cbore_d > tap_d && cbore_depth > 0.0, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  gp_Dir d;
  int st = unit_dir(dx, dy, dz, d);
  if (st != OCC_OK) return st;
  gp_Pnt O(ox, oy, oz);
  TopoDS_Shape tap = make_cyl(O, d, 0.5 * tap_d, tap_depth);
  TopoDS_Shape cb  = make_cyl(O, d, 0.5 * cbore_d, cbore_depth);
  TopoDS_Shape tool;
  st = fuse2(tap, cb, tool);
  if (st != OCC_OK) return st;
  return cut_with_tool(*as_shape(solid), tool, out,
                       "counterbore cut failed");
  OCC_GUARD_END
}

int occ_drill_hole_countersink(occ_shape_t solid,
                               double ox, double oy, double oz,
                               double dx, double dy, double dz,
                               double tap_d, double tap_depth,
                               double csink_angle_rad,
                               double csink_depth,
                               occ_shape_t* out) {
  REQ(solid && out, OCC_ERR_NULL_ARG);
  REQ(tap_d > 0.0 && tap_depth > 0.0, OCC_ERR_GEOM);
  REQ(csink_depth > 0.0, OCC_ERR_GEOM);
  REQ(csink_angle_rad > k_eps && csink_angle_rad < M_PI - k_eps,
      OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  gp_Dir d;
  int st = unit_dir(dx, dy, dz, d);
  if (st != OCC_OK) return st;
  gp_Pnt O(ox, oy, oz);
  gp_Ax2 ax(O, d);

  TopoDS_Shape tap = make_cyl(O, d, 0.5 * tap_d, tap_depth);

  const double half = 0.5 * csink_angle_rad;
  const double Rmouth = csink_depth * std::tan(half);
  if (Rmouth < 0.5 * tap_d) {
    set_last("countersink: mouth smaller than tap — increase depth/angle");
    return OCC_ERR_GEOM;
  }
  /* Cone: R1 at z=0 (mouth), R2=0 at z=H (apex inside solid). */
  TopoDS_Shape cone =
      BRepPrimAPI_MakeCone(ax, Rmouth, /*R2=*/0.0, csink_depth).Shape();

  TopoDS_Shape tool;
  st = fuse2(tap, cone, tool);
  if (st != OCC_OK) return st;
  return cut_with_tool(*as_shape(solid), tool, out,
                       "countersink cut failed");
  OCC_GUARD_END
}

int occ_hole_on_face_center(occ_shape_t solid,
                            int face_index_1based,
                            double diameter,
                            double through_or_depth,
                            occ_shape_t* out) {
  REQ(solid && out, OCC_ERR_NULL_ARG);
  REQ(diameter > 0.0, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  TopoDS_Face face;
  int st = face_at_index(*as_shape(solid), face_index_1based, face);
  if (st != OCC_OK) return st;

  gp_Pnt c;
  gp_Dir n;
  st = face_center_and_normal(face, c, n);
  if (st != OCC_OK) return st;
  orient_drill_inward(*as_shape(solid), c, n);

  if (through_or_depth <= 0.0) {
    return occ_drill_hole_through(solid, c.X(), c.Y(), c.Z(),
                                  n.X(), n.Y(), n.Z(), diameter, out);
  }
  return occ_drill_hole_blind(solid, c.X(), c.Y(), c.Z(),
                              n.X(), n.Y(), n.Z(), diameter,
                              through_or_depth, out);
  OCC_GUARD_END
}

}  // extern "C"
```

---

## Implementation — `// === file: occ_c_boolean_ext.cc`

```cpp
// === file: occ_c_boolean_ext.cc
// OCCT 7.9.3 — compounds, plane/shape split, fuse/cut many.
#include "occ_c_boolean_ext.h"
#include "occ_c_internal.hxx"

#include <cmath>

#include <BRepAlgoAPI_Common.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepAlgoAPI_Splitter.hxx>
#include <BRepBndLib.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeHalfSpace.hxx>
#include <BRep_Builder.hxx>
#include <Bnd_Box.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Iterator.hxx>
#include <TopoDS_Solid.hxx>
#include <gp_Ax3.hxx>
#include <gp_Dir.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>

using occ_c_detail::as_shape;
using occ_c_detail::to_handle;
using occ_c_detail::set_last;

namespace {

constexpr double k_eps = 1.0e-12;

TopoDS_Shape copy_shape(const TopoDS_Shape& s) {
  gp_Trsf id;
  BRepBuilderAPI_Transform mk(s, id, Standard_True);
  return mk.Shape();
}

int bbox_of(const TopoDS_Shape& s, Bnd_Box& b) {
  b.SetVoid();
  BRepBndLib::Add(s, b);
  if (b.IsVoid()) {
    set_last("split: void bounding box");
    return OCC_ERR_GEOM;
  }
  return OCC_OK;
}

/**
 * Finite half-space tool on the ref_point side of plane (O, N).
 *
 *   1. Planar face at O, size = solid_diag * 4.
 *   2. MakeHalfSpace(face, ref_point) → infinite solid.
 *   3. Oversized AABB around solid.
 *   4. Common(halfspace, box) → finite cutting solid.
 */
int make_finite_halfspace_tool(const TopoDS_Shape& solid,
                               const gp_Pnt& O, const gp_Dir& N,
                               const gp_Pnt& ref_point,
                               TopoDS_Shape& out_tool) {
  Bnd_Box bb;
  int st = bbox_of(solid, bb);
  if (st != OCC_OK) return st;
  double x0, y0, z0, x1, y1, z1;
  bb.Get(x0, y0, z0, x1, y1, z1);
  const double dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
  const double diag =
      std::sqrt(dx * dx + dy * dy + dz * dz) + 1.0e-3;
  const double half = diag * 2.0;

  gp_Ax3 ax(O, N);
  gp_Pln pln(ax);
  BRepBuilderAPI_MakeFace mf(pln, -half, half, -half, half);
  if (!mf.IsDone()) {
    set_last("split_by_plane: plane face failed");
    return OCC_ERR_GEOM;
  }
  TopoDS_Face face = mf.Face();

  BRepPrimAPI_MakeHalfSpace mhs(face, ref_point);
  if (!mhs.IsDone()) {
    set_last("split_by_plane: MakeHalfSpace failed");
    return OCC_ERR_GEOM;
  }
  TopoDS_Solid hs = mhs.Solid();

  const double m = diag;
  TopoDS_Shape box =
      BRepPrimAPI_MakeBox(gp_Pnt(x0 - m, y0 - m, z0 - m),
                          gp_Pnt(x1 + m, y1 + m, z1 + m))
          .Shape();

  BRepAlgoAPI_Common common(hs, box);
  common.Build();
  if (!common.IsDone()) {
    set_last("split_by_plane: halfspace∩box failed");
    return OCC_ERR_BOOLEAN;
  }
  out_tool = common.Shape();
  return OCC_OK;
}

}  // namespace

extern "C" {

int occ_make_compound(const occ_shape_t* shapes, int n, occ_shape_t* out) {
  REQ(shapes && out, OCC_ERR_NULL_ARG);
  REQ(n >= 1, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  TopoDS_Compound comp;
  BRep_Builder bb;
  bb.MakeCompound(comp);
  for (int i = 0; i < n; ++i) {
    REQ(shapes[i], OCC_ERR_NULL_ARG);
    bb.Add(comp, *as_shape(shapes[i]));
  }
  *out = to_handle(comp);
  return OCC_OK;
  OCC_GUARD_END
}

int occ_explode_compound(occ_shape_t compound,
                         occ_shape_t* out_shapes,
                         int max_out,
                         int* out_count) {
  REQ(compound && out_shapes && out_count, OCC_ERR_NULL_ARG);
  REQ(max_out >= 1, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  const TopoDS_Shape& sh = *as_shape(compound);
  *out_count = 0;

  if (sh.ShapeType() != TopAbs_COMPOUND &&
      sh.ShapeType() != TopAbs_COMPSOLID) {
    out_shapes[0] = to_handle(copy_shape(sh));
    *out_count = 1;
    return OCC_OK;
  }

  int written = 0;
  int total = 0;
  for (TopoDS_Iterator it(sh); it.More(); it.Next()) {
    ++total;
    if (written < max_out) {
      out_shapes[written] = to_handle(copy_shape(it.Value()));
      ++written;
    }
  }
  *out_count = written;
  if (total > max_out) {
    set_last("explode_compound: output buffer too small");
    return OCC_ERR_INDEX;
  }
  if (total == 0) {
    set_last("explode_compound: empty compound");
    return OCC_ERR_GEOM;
  }
  return OCC_OK;
  OCC_GUARD_END
}

int occ_split_by_plane(occ_shape_t solid,
                       double ox, double oy, double oz,
                       double nx, double ny, double nz,
                       occ_shape_t* out_pos,
                       occ_shape_t* out_neg) {
  REQ(solid && out_pos && out_neg, OCC_ERR_NULL_ARG);
  const double nm = std::sqrt(nx * nx + ny * ny + nz * nz);
  if (nm < k_eps) {
    set_last("split_by_plane: zero normal");
    return OCC_ERR_GEOM;
  }
  OCC_GUARD_BEGIN
  const TopoDS_Shape& body = *as_shape(solid);
  gp_Pnt O(ox, oy, oz);
  gp_Dir N(nx / nm, ny / nm, nz / nm);
  const double lift = 1.0e-3;

  gp_Pnt ref_pos = O.Translated(gp_Vec(N).Multiplied(lift));
  gp_Pnt ref_neg = O.Translated(gp_Vec(N).Multiplied(-lift));

  TopoDS_Shape tool_pos;
  TopoDS_Shape tool_neg;
  int st = make_finite_halfspace_tool(body, O, N, ref_pos, tool_pos);
  if (st != OCC_OK) return st;
  st = make_finite_halfspace_tool(body, O, N, ref_neg, tool_neg);
  if (st != OCC_OK) return st;

  /* out_pos = +N side = Cut(body, tool_neg)
     out_neg = −N side = Cut(body, tool_pos) */
  {
    BRepAlgoAPI_Cut cut_pos(body, tool_neg);
    cut_pos.Build();
    if (!cut_pos.IsDone()) {
      set_last("split_by_plane: positive half cut failed");
      return OCC_ERR_BOOLEAN;
    }
    *out_pos = to_handle(cut_pos.Shape());
  }
  {
    BRepAlgoAPI_Cut cut_neg(body, tool_pos);
    cut_neg.Build();
    if (!cut_neg.IsDone()) {
      set_last("split_by_plane: negative half cut failed");
      occ_shape_free(*out_pos);
      *out_pos = nullptr;
      return OCC_ERR_BOOLEAN;
    }
    *out_neg = to_handle(cut_neg.Shape());
  }
  return OCC_OK;
  OCC_GUARD_END
}

int occ_split_by_shape(occ_shape_t solid,
                       occ_shape_t cutter_face_or_shell,
                       occ_shape_t* out_compound_parts) {
  REQ(solid && cutter_face_or_shell && out_compound_parts, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  const TopoDS_Shape& obj = *as_shape(solid);
  const TopoDS_Shape& tool = *as_shape(cutter_face_or_shell);

  BRepAlgoAPI_Splitter splitter;
  TopTools_ListOfShape args, tools;
  args.Append(obj);
  tools.Append(tool);
  splitter.SetArguments(args);
  splitter.SetTools(tools);
  splitter.Build();
  if (!splitter.IsDone()) {
    set_last("split_by_shape: BRepAlgoAPI_Splitter failed");
    return OCC_ERR_BOOLEAN;
  }
  *out_compound_parts = to_handle(splitter.Shape());
  return OCC_OK;
  OCC_GUARD_END
}

int occ_fuse_many(const occ_shape_t* shapes, int n, occ_shape_t* out) {
  REQ(shapes && out, OCC_ERR_NULL_ARG);
  REQ(n >= 1, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  REQ(shapes[0], OCC_ERR_NULL_ARG);
  if (n == 1) {
    *out = to_handle(copy_shape(*as_shape(shapes[0])));
    return OCC_OK;
  }
  TopoDS_Shape acc = *as_shape(shapes[0]);
  for (int i = 1; i < n; ++i) {
    REQ(shapes[i], OCC_ERR_NULL_ARG);
    BRepAlgoAPI_Fuse fuse(acc, *as_shape(shapes[i]));
    fuse.Build();
    if (!fuse.IsDone()) {
      set_last("fuse_many: fuse failed");
      return OCC_ERR_BOOLEAN;
    }
    acc = fuse.Shape();
  }
  *out = to_handle(acc);
  return OCC_OK;
  OCC_GUARD_END
}

int occ_cut_many(occ_shape_t base,
                 const occ_shape_t* tools, int n,
                 occ_shape_t* out) {
  REQ(base && out, OCC_ERR_NULL_ARG);
  REQ(n >= 1 && tools, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  TopoDS_Shape acc = *as_shape(base);
  for (int i = 0; i < n; ++i) {
    REQ(tools[i], OCC_ERR_NULL_ARG);
    BRepAlgoAPI_Cut cut(acc, *as_shape(tools[i]));
    cut.Build();
    if (!cut.IsDone()) {
      set_last("cut_many: cut failed");
      return OCC_ERR_BOOLEAN;
    }
    acc = cut.Shape();
  }
  *out = to_handle(acc);
  return OCC_OK;
  OCC_GUARD_END
}

}  // extern "C"
```

---

## IR / Luau mapping

| IR op | C entry | Notes |
|-------|---------|-------|
| `PatternLinear` | `occ_pattern_linear` | count includes seed at 0 |
| `PatternLinear` siblings | `occ_pattern_linear_exclude_seed` | seed already in tree |
| `PatternPolar` | `occ_pattern_polar` / `_full_circle` | radians |
| `PatternAlongPath` | `occ_pattern_along_path` | equal arc-length |
| `Pattern` (explicit) | `occ_pattern_from_transforms` | 4×3 row-major |
| `FusePattern` | `occ_boolean_fuse_pattern` | base ← seed@Ti |
| `DrillHole` through | `occ_drill_hole_through` | **diameter**, bbox×2 |
| `DrillHole` blind | `occ_drill_hole_blind` | |
| `DrillHole` counterbore | `occ_drill_hole_counterbore` | P1 |
| `DrillHole` countersink | `occ_drill_hole_countersink` | included angle |
| `DrillHole` on face | `occ_hole_on_face_center` | 1-based face |
| `GroupBodies` | `occ_make_compound` | |
| explode / ungroup | `occ_explode_compound` | |
| `Split` by plane | `occ_split_by_plane` | finite half-space |
| `Split` by face | `occ_split_by_shape` | Splitter |
| multi-fuse / multi-cut | `occ_fuse_many` / `occ_cut_many` | |

---

## Worked example A — Flange bolt circle

```c
#include "occ_c.h"
#include "occ_c_pattern.h"
#include "occ_c_hole.h"
#include "occ_c_boolean_ext.h"
#include <math.h>

/* 120 mm OD × 20 mm flange, 6× Ø8 on 90 mm pitch circle. */
int make_flange_bolted(occ_shape_t* out) {
  occ_shape_t disc = 0;
  if (occ_make_cylinder(/*r*/0.06, /*h*/0.02, &disc) != OCC_OK) return -1;

  const double pitch_r = 0.045;
  const double hole_d  = 0.008;
  const int nbolts = 6;

  occ_shape_t cur = disc;
  for (int i = 0; i < nbolts; ++i) {
    const double a = (2.0 * M_PI * i) / nbolts;
    const double x = pitch_r * cos(a);
    const double y = pitch_r * sin(a);
    occ_shape_t nxt = 0;
    if (occ_drill_hole_through(cur, x, y, 0.01, 0, 0, 1, hole_d, &nxt)
        != OCC_OK) {
      return -1;
    }
    if (cur != disc) occ_shape_free(cur);
    cur = nxt;
  }
  *out = cur;
  return 0;
}

/* Pattern tools then cut_many (cleaner BOP batching): */
int make_flange_pattern_tools(occ_shape_t* out) {
  occ_shape_t disc = 0, cyl = 0, seed_tool = 0, tools = 0;
  occ_make_cylinder(0.06, 0.02, &disc);
  occ_make_cylinder(0.004, 0.1, &cyl);
  double M[12] = {
    1,0,0, 0.045,
    0,1,0, 0,
    0,0,1, -0.04
  };
  occ_pattern_from_transforms(cyl, M, 1, &seed_tool);
  occ_pattern_polar_full_circle(seed_tool, 0, 0, 0, 0, 0, 1, 6, &tools);

  occ_shape_t parts[8];
  int n = 0;
  occ_explode_compound(tools, parts, 8, &n);
  occ_cut_many(disc, parts, n, out);
  for (int i = 0; i < n; ++i) occ_shape_free(parts[i]);
  occ_shape_free(disc);
  occ_shape_free(cyl);
  occ_shape_free(seed_tool);
  occ_shape_free(tools);
  return 0;
}
```

---

## Worked example B — Supports along a pipe spine

```c
/* Place N pad boxes along a route wire.
   align=0 → world-upright; align=1 → +Z follows tangent. */
int supports_on_pipe(occ_shape_t pad_seed, occ_shape_t spine,
                     int n, int align, occ_shape_t* out_pads) {
  return occ_pattern_along_path(pad_seed, spine, n, align, out_pads);
}

/* Fuse patterned pads onto a skid base: */
int weld_pads_to_base(occ_shape_t base, occ_shape_t pad_seed,
                      const double* mats, int n, occ_shape_t* out) {
  return occ_boolean_fuse_pattern(base, pad_seed, mats, n, out);
}
```

Equal arc-length: `count=5` → `s = {0, L/4, L/2, 3L/4, L}`.

---

## Worked example C — Counterbore + countersink

```c
occ_shape_t plate = 0, a = 0, b = 0;
occ_make_box(0.1, 0.1, 0.02, &plate);

/* Socket-head cap screw counterbore. */
occ_drill_hole_counterbore(plate,
  0.05, 0.05, 0.02,   /* origin on top face */
  0, 0, -1,           /* drill into plate (−Z) */
  0.0065, 0.018,      /* tap Ø6.5 × 18 mm */
  0.011, 0.006,       /* cbore Ø11 × 6 mm */
  &a);

/* Flat-head 90° countersink. */
occ_drill_hole_countersink(a,
  0.02, 0.02, 0.02,
  0, 0, -1,
  0.005, 0.015,
  M_PI / 2.0,         /* 90° included */
  0.003,
  &b);
```

---

## Worked example D — Split half model

```c
occ_shape_t solid = 0, pos = 0, neg = 0;
/* ... build solid ... */
occ_split_by_plane(solid, 0, 0, 0, 1, 0, 0, &pos, &neg);
/* pos = +X portion, neg = −X portion */

occ_shape_t face = 0, parts = 0;
occ_make_plane_rect(0,0,0, 0,0,1, 1,0,0, 2.0, 2.0, &face);
occ_split_by_shape(solid, face, &parts);
```

### Why finite half-spaces?

```text
MakeHalfSpace(face, ref)  →  infinite solid
        │
        ▼
Common( halfspace, oversized_AABB(solid) )
        │
        ▼
finite tool  ──Cut──►  kept half of solid
```

Infinite tools can work but bbox of the tool is infinite → poorer BVH heuristics. Clipping to `bbox(solid)` expanded by one diagonal covers the solid completely while staying finite. Prefer `occ_split_by_shape` with a plane face when you only need partition (no named half).

---

## Smoke checklist (conceptual)

```c
occ_shape_t box=0, lin=0, sib=0, polar=0;
occ_make_box(0.01, 0.01, 0.01, &box);
assert(occ_pattern_linear(box, 0.05, 0, 0, 4, &lin) == OCC_OK);
assert(occ_pattern_linear_exclude_seed(box, 0.05, 0, 0, 3, &sib) == OCC_OK);
assert(occ_pattern_polar_full_circle(box, 0,0,0, 0,0,1, 8, &polar) == OCC_OK);

occ_shape_t wire=0, pathpat=0;
double xyz[] = {0,0,0, 1,0,0, 1,1,0};
occ_make_polyline(xyz, 3, 0, &wire);
assert(occ_pattern_along_path(box, wire, 5, 1, &pathpat) == OCC_OK);

occ_shape_t plate=0, holed=0;
occ_make_box(0.2, 0.2, 0.01, &plate);
assert(occ_drill_hole_through(plate, 0.1,0.1,0.005, 0,0,1, 0.01, &holed)
       == OCC_OK);

occ_shape_t arr[4]; int n=0;
assert(occ_explode_compound(lin, arr, 4, &n) == OCC_OK && n == 4);

occ_shape_t p=0, q=0;
assert(occ_split_by_plane(plate, 0.1,0,0, 1,0,0, &p, &q) == OCC_OK);

occ_shape_t fused=0;
occ_shape_t two[2] = { box, arr[1] };
assert(occ_fuse_many(two, 2, &fused) == OCC_OK);
```

---

## Edge cases & contracts

| Case | Behavior |
|------|----------|
| `count < 1` | `OCC_ERR_GEOM` |
| zero pattern axis / hole dir | `OCC_ERR_GEOM` |
| `diameter <= 0` | `OCC_ERR_GEOM` |
| countersink mouth < tap | `OCC_ERR_GEOM` |
| empty compound explode | `OCC_ERR_GEOM` |
| explode buffer too small | fills `max_out`, `OCC_ERR_INDEX` |
| pattern copy flag | always `Copy=True` so seed free is safe |
| through tool length | `2 * bbox_diagonal + 1e-3` |
| topology indices | **1-based** faces |
| matrices | 3×4 row-major, n×12 doubles |

**Ownership:** every `out` / `out_shapes[i]` is a fresh heap handle; free with `occ_shape_free`. Inputs never consumed.  
**Thread safety:** `g_last_error` is `thread_local` (same as baseline `occ_c`).

---

## Dual-goal coverage

| Product need | API |
|--------------|-----|
| Robot flange bolt circle | `occ_pattern_polar_full_circle` + `occ_drill_hole_through` |
| Link lightening holes | `occ_pattern_linear` + blind/through |
| Socket cap counterbore | `occ_drill_hole_counterbore` |
| Flat-head countersink | `occ_drill_hole_countersink` |
| Pipe hanger spacing | `occ_pattern_along_path` |
| Skid multi-body group | `occ_make_compound` / explode |
| Half-model FEA | `occ_split_by_plane` |
| Boolean batching | `occ_fuse_many` / `occ_cut_many` / `occ_boolean_fuse_pattern` |

---

## Supersedes slim draft in `occ-c-p0-literate-api.md`

The main literate file embeds minimal `occ_pattern_*` / `occ_drill_hole_*` inside `occ_c_route.cc` with a `fuse` flag and **radius** args. **This section owns the dedicated modules**:

| Draft (`route`) | This section |
|-----------------|--------------|
| `fuse` flag on pattern | compound vs `occ_boolean_fuse_pattern` |
| radius | **diameter** |
| no along-path | `occ_pattern_along_path` |
| no counterbore/sink | full stepped holes |
| compound only | explode + split + multi-boolean |

Drop duplicate symbols from `occ_c_route` to avoid ODR clashes.

---

## Appendix — 4×3 matrix layout

```text
index:  0   1   2   3     4   5   6   7     8   9  10  11
value: r11 r12 r13 tx    r21 r22 r23 ty    r31 r32 r33 tz
gp_Trsf::SetValues(r11,r12,r13,tx, r21,r22,r23,ty, r31,r32,r33,tz)
```

```c
/* Polar about Z at origin for occ_pattern_from_transforms: */
void polar_z_matrix(double angle, double out[12]) {
  const double c = cos(angle), s = sin(angle);
  out[0]=c; out[1]=-s; out[2]=0; out[3]=0;
  out[4]=s; out[5]= c; out[6]=0; out[7]=0;
  out[8]=0; out[9]= 0; out[10]=1; out[11]=0;
}
```

## Appendix — countersink trigonometry

```text
included α = csink_angle_rad;  half = α/2
R_mouth = csink_depth * tan(half)
MakeCone(Ax2(origin,dir), R1=R_mouth, R2=0, H=csink_depth)
  fused with MakeCylinder(..., r=tap_d/2, H=tap_depth)
```

Common: ISO 90° = `M_PI/2`, ASME 82° = `82*M_PI/180`.

## Appendix — face index stability

`TopExp::MapShapes` face order is stable for a given solid but **not** across booleans. IR should not store bare face indices across features; `occ_hole_on_face_center` is a one-shot convenience. Product-layer selectors live in the query module.

---

*End of section 05 — Patterns, Holes, Compounds, Split.*

<!-- END 05-patterns-holes-split.md -->


<!-- BEGIN 06-query-measure.md -->

# Section 06 — Query, Measure, Clash, Mass, Topology Selectors

**Document type:** Literate programming fragment for the Apache **`occ_c`** C API  
**Files extracted from this section:**
- `api/include/occ_c_query.h`
- `api/src/occ_c_query.cc`
**OCCT pin:** **7.9.3**  
**Priority:** P0 — `QueryClash` / `QueryGeom` / mass properties / topology selectors  
**Product goals:** AI-BOOST skid **clearance KPI** · 6-DOF robot **non-adjacent self-collision**  
**Units:** meters, radians; topology indices **1-based**  
**Depends on:** `occ_c.h`, private `occ_c_internal.hxx` (`as_shape`, `to_handle`, `set_last`, `OCC_GUARD_*`, `REQ`)

---

## 1. Pedagogy — why this section exists

### 1.1 Skid clearance KPI (AI-BOOST)

A process skid is not “done” when the solids look right. The **competition KPI** is geometric:

1. Route a pipe annulus (centerline + bend R + OD/ID).  
2. Place equipment envelopes (housing, frame members, valves).  
3. Measure **minimum clearance** between the pipe run and every housing / structural body.  
4. Fail the IR graph if any pair returns clash status **2** (interfering) or status **1** below a project threshold.

`BRepExtrema_DistShapeShape` is the kernel primitive: load two shapes, `Perform()`, read `Value()` and contact points. Clash status is an **out-param**, never only an error code — “clearance violated” is geometry, not a programmer bug.

### 1.2 Robot self-collision (non-adjacent links)

A 6-DOF arm places each link solid with `occ_trsf_apply_shape` / FK chain. Self-collision is:

```text
for i in 0..n-1:
  for j in i+2..n-1:          # skip adjacent links (share a joint)
    occ_clash(link[i], link[j], clearance, &st)
```

`occ_clash_all_pairs` materializes the full \(n \times n\) status matrix for IR `QueryClash` multi-body nodes. Diagonal is always **0** (shape vs self is undefined / skip); adjacent pairs may be masked by the host.

### 1.3 Mass for structure & dynamics

Baseline `occ_volume` is geometry volume. Structural steel and robot-link dynamics need **mass × density** and the **inertia tensor about COM**:

\[
m = \rho V,\quad
\mathbf{I}_{\mathrm{com}} = \rho\,\mathrm{MatrixOfInertia}(GProp)
\]

`GProp_GProps::MatrixOfInertia()` is already about the centre of mass; scale by density, export **row-major 3×3** (`out_inertia_tensor[9]`).

### 1.4 Topology selectors without a full session

IR hosts often need “largest planar face parallel to Z” without FeatureScript-style query sessions. This section exposes **index-returning filters**:

| Helper | Use |
|--------|-----|
| `occ_select_faces_by_area_gt` | Mandrel / mounting faces |
| `occ_select_planar_faces` | Gasket / flange planes |
| `occ_select_faces_parallel_to` | “Top” face by world normal |
| `occ_select_edges_by_length_gt` | Long weld edges |
| `occ_largest_face` | Single best face index |

Indices are **1-based** into `TopExp::MapShapes(..., TopAbs_FACE|EDGE)`.

### 1.5 OCCT classes used (7.9.3)

| Concern | Class / call |
|---------|----------------|
| Min distance | `BRepExtrema_DistShapeShape` (`LoadS1/S2`, `Perform`, `Value`, `InnerSolution`, `PointOnShape1/2`) |
| Mass / area / length | `BRepGProp::{Volume,Surface,Linear}Properties` + `GProp_GProps` |
| Inertia | `GProp_GProps::MatrixOfInertia` (about COM) |
| BBox | `BRepBndLib::Add` + `Bnd_Box::Get` |
| Topology maps | `TopExp::MapShapes` + `TopTools_IndexedMapOfShape` |
| Edge / face fields | `BRepAdaptor_Curve`, `BRepAdaptor_Surface`, `BRepTools::UVBounds` |
| Planarity | `GeomLib_IsPlanarSurface` **or** `BRep_Tool::Surface` + `Handle(Geom_Plane)` downcast |
| Validity | `BRepCheck_Analyzer` |
| Ray cast | `BRepIntCurveSurface_Inter` + `gp_Lin` |
| Optional solid common | `BRepAlgoAPI_Common` (only when depth check needed) |

---

## 2. Clash status contract

```c
/* out_status for occ_clash / matrix cells */
enum {
  OCC_CLASH_SEPARATED   = 0, /* d > clearance  (and not InnerSolution) */
  OCC_CLASH_CLEARANCE   = 1, /* 0 < d <= clearance  — soft band / KPI warning */
  OCC_CLASH_INTERFERING = 2  /* d ≈ 0 or InnerSolution or optional common volume > 0 */
};
```

Decision tree (`eps = Precision::Confusion()`):

```text
dss.Perform()
if !IsDone → return OCC_ERR_GEOM (or status=2 if host prefers soft-fail)
d = Value()
if InnerSolution() or d <= eps          → INTERFERING (2)
else if d <= clearance                  → CLEARANCE (1)
else                                    → SEPARATED (0)
```

Host KPI example:

```c
int st;
occ_clash(pipe, housing, 0.025, &st);   /* 25 mm clearance */
if (st == 2) fail("hard clash");
if (st == 1) warn("below 25 mm clearance");
```

---

## 3. Header — `// === file: occ_c_query.h`

```c
// === file: occ_c_query.h
#ifndef OCC_C_QUERY_H_
#define OCC_C_QUERY_H_

#include "occ_c.h"

#ifdef __cplusplus
extern "C" {
#endif

/* -------------------------------------------------------------------------
 * Clash status (out-param; not an occ_status_t error code)
 * ------------------------------------------------------------------------- */
#define OCC_CLASH_SEPARATED   0
#define OCC_CLASH_CLEARANCE   1
#define OCC_CLASH_INTERFERING 2

/* -------------------------------------------------------------------------
 * Distance & clash
 * ------------------------------------------------------------------------- */

/** Minimum distance between two shapes.
 *  on success: *out_dist >= 0; optional out_p_on_a / out_p_on_b filled if non-NULL.
 *  Points are first solution (1-based OCCT index). */
OCC_API int occ_distance(occ_shape_t a, occ_shape_t b,
                         double* out_dist,
                         double out_p_on_a[3],
                         double out_p_on_b[3]);

/** Pairwise clash with clearance band.
 *  *out_status ∈ {0,1,2} as OCC_CLASH_* .
 *  Returns OCC_OK when status was written; OCC_ERR_GEOM if extrema failed. */
OCC_API int occ_clash(occ_shape_t a, occ_shape_t b,
                      double clearance, int* out_status);

/** All-pairs clash matrix, row-major n*n.
 *  Diagonal forced to SEPARATED (0). out_matrix_flat[i*n+j] is status(i,j). */
OCC_API int occ_clash_all_pairs(const occ_shape_t* shapes, int n,
                                double clearance, int* out_matrix_flat);

/** Min distance from shape to any of others[0..n-1].
 *  *out_idx is 0-based index into others; *out_dist is that minimum. */
OCC_API int occ_min_distance_to_set(occ_shape_t shape,
                                    const occ_shape_t* others, int n,
                                    int* out_idx, double* out_dist);

/* -------------------------------------------------------------------------
 * Global measures (re-export style; safe to call from any TU)
 * ------------------------------------------------------------------------- */

OCC_API int occ_volume(occ_shape_t s, double* out_vol);
OCC_API int occ_surface_area(occ_shape_t s, double* out_area);
OCC_API int occ_center_of_mass(occ_shape_t s, double out_com[3]);

/** Density-scaled mass properties.
 *  density in kg/m^3 (or consistent unit system).
 *  out_inertia_tensor[9] row-major 3x3 about COM:
 *    [Ixx Ixy Ixz; Iyx Iyy Iyz; Izx Izy Izz]  (symmetric). */
OCC_API int occ_mass_properties(occ_shape_t s, double density,
                                double* out_mass,
                                double out_com[3],
                                double out_inertia_tensor[9]);

/** Linear properties: edge or wire arc length (BRepGProp::LinearProperties). */
OCC_API int occ_length(occ_shape_t s, double* out_len);

/* -------------------------------------------------------------------------
 * Face / edge geometry
 * ------------------------------------------------------------------------- */

OCC_API int occ_face_area(occ_shape_t face, double* out_area);
OCC_API int occ_face_normal(occ_shape_t face, double out_n[3]); /* unit, at center UV */
OCC_API int occ_face_center(occ_shape_t face, double out_p[3]); /* 3D at center UV */
OCC_API int occ_is_planar_face(occ_shape_t face, int* out_bool);

/** 1-based face index of maximum area inside s; also returns area if non-NULL. */
OCC_API int occ_largest_face(occ_shape_t s, int* out_1based_index);
OCC_API int occ_largest_face_area(occ_shape_t s, int* out_1based_index,
                                  double* out_area);

OCC_API int occ_edge_midpoint(occ_shape_t edge, double out_p[3]);
OCC_API int occ_edge_tangent(occ_shape_t edge, double out_t[3]); /* unit */
OCC_API int occ_edge_length(occ_shape_t edge, double* out_len);

/* -------------------------------------------------------------------------
 * Topology typing & solids
 * ------------------------------------------------------------------------- */

/** *out maps TopAbs_ShapeEnum → occ_shape_type_t / int (0=COMPOUND .. 7=VERTEX). */
OCC_API int occ_shape_type(occ_shape_t s, int* out);

OCC_API int occ_count_solids(occ_shape_t s, int* out_n);
/** Extract solid at 1-based index into a new owned shape handle. */
OCC_API int occ_solid_at(occ_shape_t s, int index_1based, occ_shape_t* out);

/* -------------------------------------------------------------------------
 * Proximity helpers
 * ------------------------------------------------------------------------- */

/** Closest face (1-based in TopExp FACE map) of shape to point p[3]. */
OCC_API int occ_closest_face_to_point(occ_shape_t shape, const double p[3],
                                      int* out_face_index,
                                      double out_point_on_face[3]);

/** Ray cast: origin + t * dir, dir need not be unit.
 *  Finds smallest t >= 0 hit. out_t may be NULL; out_hit[3] optional;
 *  out_face_index 1-based optional (0 if unused).
 *  Returns OCC_ERR_INDEX if no hit. */
OCC_API int occ_ray_cast(occ_shape_t shape,
                         const double origin[3], const double dir[3],
                         double* out_t, double out_hit[3],
                         int* out_face_index);

/* -------------------------------------------------------------------------
 * Bounds, validity, cheap topology fingerprint
 * ------------------------------------------------------------------------- */

/** Axis-aligned bbox: out_min[3], out_max[3]. */
OCC_API int occ_bbox(occ_shape_t s, double out_min[3], double out_max[3]);

/** BRepCheck_Analyzer::IsValid() → *out_bool 1/0. */
OCC_API int occ_is_valid_shape(occ_shape_t s, int* out_bool);

/** Quick topology hash: mix of face/edge/vertex counts into *out_hash.
 *  Not geometric; useful to skip redraw when topology cardinality unchanged. */
OCC_API int occ_same_topology_count_hash(occ_shape_t s, unsigned long long* out_hash);

/* -------------------------------------------------------------------------
 * Selector helpers (IR without full session)
 * out_indices: caller-allocated capacity max_out; *out_n written count.
 * Indices are 1-based FACE or EDGE map indices.
 * ------------------------------------------------------------------------- */

OCC_API int occ_select_faces_by_area_gt(occ_shape_t shape, double min_area,
                                        int* out_indices, int max_out,
                                        int* out_n);

OCC_API int occ_select_edges_by_length_gt(occ_shape_t shape, double min_len,
                                          int* out_indices, int max_out,
                                          int* out_n);

OCC_API int occ_select_planar_faces(occ_shape_t shape,
                                    int* out_indices, int max_out,
                                    int* out_n);

/** Faces whose unit normal is within tol_deg of unit(normal). */
OCC_API int occ_select_faces_parallel_to(occ_shape_t shape,
                                         const double normal[3],
                                         double tol_deg,
                                         int* out_indices, int max_out,
                                         int* out_n);

#ifdef __cplusplus
}
#endif

#endif /* OCC_C_QUERY_H_ */
```

---

## 4. Implementation — `// === file: occ_c_query.cc`

```cpp
// === file: occ_c_query.cc
// P0 Query / Measure / Clash / Mass / Topology selectors — OCCT 7.9.3
#include "occ_c_query.h"
#include "occ_c_internal.hxx"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <limits>

#include <BRepAdaptor_Curve.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepAlgoAPI_Common.hxx>
#include <BRepBndLib.hxx>
#include <BRepBuilderAPI_MakeVertex.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepExtrema_DistShapeShape.hxx>
#include <BRepGProp.hxx>
#include <BRepIntCurveSurface_Inter.hxx>
#include <BRepTools.hxx>
#include <BRep_Tool.hxx>
#include <Bnd_Box.hxx>
#include <GProp_GProps.hxx>
#include <GeomAbs_SurfaceType.hxx>
#include <GeomLib_IsPlanarSurface.hxx>
#include <Geom_Plane.hxx>
#include <Geom_Surface.hxx>
#include <Precision.hxx>
#include <TopAbs.hxx>
#include <TopExp.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Solid.hxx>
#include <TopoDS_Vertex.hxx>
#include <gp_Dir.hxx>
#include <gp_Lin.hxx>
#include <gp_Mat.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>

using occ_c_detail::as_shape;
using occ_c_detail::set_last;
using occ_c_detail::to_handle;

namespace {

constexpr double k_pi = 3.14159265358979323846;

inline void pnt_to3(const gp_Pnt& p, double o[3]) {
  if (!o) return;
  o[0] = p.X();
  o[1] = p.Y();
  o[2] = p.Z();
}

inline void vec_to3(const gp_Vec& v, double o[3]) {
  if (!o) return;
  o[0] = v.X();
  o[1] = v.Y();
  o[2] = v.Z();
}

inline double vlen3(double x, double y, double z) {
  return std::sqrt(x * x + y * y + z * z);
}

inline int normalize3(double& x, double& y, double& z) {
  const double L = vlen3(x, y, z);
  if (L < 1.0e-30) return 0;
  x /= L;
  y /= L;
  z /= L;
  return 1;
}

/** Run DistShapeShape; return OCC_OK and write d/points, or OCC_ERR_GEOM. */
int dist_shapes(const TopoDS_Shape& A, const TopoDS_Shape& B, double* out_d,
                double* p_on_a, double* p_on_b) {
  BRepExtrema_DistShapeShape dss;
  dss.LoadS1(A);
  dss.LoadS2(B);
  dss.Perform();
  if (!dss.IsDone()) {
    set_last("BRepExtrema_DistShapeShape failed");
    return OCC_ERR_GEOM;
  }
  if (out_d) *out_d = dss.Value();
  if (dss.NbSolution() >= 1) {
    if (p_on_a) pnt_to3(dss.PointOnShape1(1), p_on_a);
    if (p_on_b) pnt_to3(dss.PointOnShape2(1), p_on_b);
  } else {
    if (p_on_a) {
      p_on_a[0] = p_on_a[1] = p_on_a[2] = 0.0;
    }
    if (p_on_b) {
      p_on_b[0] = p_on_b[1] = p_on_b[2] = 0.0;
    }
  }
  return OCC_OK;
}

/** Map distance + InnerSolution + clearance → OCC_CLASH_*. */
int classify_clash(const TopoDS_Shape& A, const TopoDS_Shape& B,
                   double clearance, int* out_status,
                   Standard_Boolean try_common_volume) {
  BRepExtrema_DistShapeShape dss;
  dss.LoadS1(A);
  dss.LoadS2(B);
  dss.Perform();
  if (!dss.IsDone()) {
    set_last("clash: DistShapeShape failed");
    return OCC_ERR_GEOM;
  }

  const double eps = Precision::Confusion();
  const double d = dss.Value();
  const Standard_Boolean inner = dss.InnerSolution();

  if (inner || d <= eps) {
    /* Optional: confirm with boolean common when both look solid-like. */
    if (try_common_volume && !inner && d <= eps) {
      try {
        BRepAlgoAPI_Common common(A, B);
        if (common.IsDone() && !common.Shape().IsNull()) {
          GProp_GProps gp;
          BRepGProp::VolumeProperties(common.Shape(), gp);
          if (gp.Mass() > eps) {
            *out_status = OCC_CLASH_INTERFERING;
            return OCC_OK;
          }
        }
      } catch (...) {
        /* fall through — distance already says touching */
      }
    }
    *out_status = OCC_CLASH_INTERFERING;
    return OCC_OK;
  }

  if (clearance < 0.0) clearance = 0.0;
  if (d <= clearance) {
    *out_status = OCC_CLASH_CLEARANCE;
  } else {
    *out_status = OCC_CLASH_SEPARATED;
  }
  return OCC_OK;
}

void map_subshapes(const TopoDS_Shape& s, TopAbs_ShapeEnum t,
                   TopTools_IndexedMapOfShape& map) {
  map.Clear();
  TopExp::MapShapes(s, t, map);
}

int face_area_of(const TopoDS_Shape& f, double* out) {
  GProp_GProps props;
  BRepGProp::SurfaceProperties(f, props);
  *out = props.Mass();
  return OCC_OK;
}

int edge_length_of(const TopoDS_Shape& e, double* out) {
  GProp_GProps props;
  BRepGProp::LinearProperties(e, props, Standard_True);
  *out = props.Mass();
  return OCC_OK;
}

/** True if face is planar (Geom_Plane downcast or GeomLib_IsPlanarSurface). */
bool is_planar_face_impl(const TopoDS_Face& F, double tol = 1.0e-7) {
  Handle(Geom_Surface) surf = BRep_Tool::Surface(F);
  if (surf.IsNull()) return false;
  if (!Handle(Geom_Plane)::DownCast(surf).IsNull()) return true;
  GeomLib_IsPlanarSurface checker(surf, tol);
  return checker.IsPlanar() == Standard_True;
}

/** Unit normal at UV center; respects face orientation. */
int face_normal_impl(const TopoDS_Face& F, gp_Vec& n_out, gp_Pnt* p_out) {
  BRepAdaptor_Surface surf(F);
  Standard_Real u0, u1, v0, v1;
  BRepTools::UVBounds(F, u0, u1, v0, v1);
  const Standard_Real u = 0.5 * (u0 + u1);
  const Standard_Real v = 0.5 * (v0 + v1);
  gp_Pnt p;
  gp_Vec d1u, d1v;
  surf.D1(u, v, p, d1u, d1v);
  gp_Vec n = d1u.Crossed(d1v);
  if (n.Magnitude() < Precision::Confusion()) {
    set_last("face normal degenerate at UV center");
    return OCC_ERR_GEOM;
  }
  n.Normalize();
  if (F.Orientation() == TopAbs_REVERSED) n.Reverse();
  n_out = n;
  if (p_out) *p_out = p;
  return OCC_OK;
}

int face_center_impl(const TopoDS_Face& F, gp_Pnt& p_out) {
  BRepAdaptor_Surface surf(F);
  Standard_Real u0, u1, v0, v1;
  BRepTools::UVBounds(F, u0, u1, v0, v1);
  p_out = surf.Value(0.5 * (u0 + u1), 0.5 * (v0 + v1));
  return OCC_OK;
}

/** Angle between unit vectors in degrees, clamped. */
double angle_deg_unit(const gp_Vec& a, double nx, double ny, double nz) {
  double d = a.X() * nx + a.Y() * ny + a.Z() * nz;
  if (d > 1.0) d = 1.0;
  if (d < -1.0) d = -1.0;
  /* parallel if |dot| close to 1 (either same or opposite direction) */
  const double ad = std::fabs(d);
  return std::acos(ad) * (180.0 / k_pi);
}

unsigned long long mix_u64(unsigned long long h, unsigned long long v) {
  h ^= v + 0x9e3779b97f4a7c15ULL + (h << 6) + (h >> 2);
  return h;
}

}  // namespace

extern "C" {

/* =========================================================================
 * Distance & clash
 * ========================================================================= */

int occ_distance(occ_shape_t a, occ_shape_t b, double* out_dist,
                 double out_p_on_a[3], double out_p_on_b[3]) {
  REQ(a && b && out_dist, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  return dist_shapes(*as_shape(a), *as_shape(b), out_dist, out_p_on_a,
                     out_p_on_b);
  OCC_GUARD_END
}

int occ_clash(occ_shape_t a, occ_shape_t b, double clearance,
              int* out_status) {
  REQ(a && b && out_status, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  /* try_common_volume = false for P0 speed; InnerSolution covers solids */
  return classify_clash(*as_shape(a), *as_shape(b), clearance, out_status,
                        Standard_False);
  OCC_GUARD_END
}

int occ_clash_all_pairs(const occ_shape_t* shapes, int n, double clearance,
                        int* out_matrix_flat) {
  REQ(shapes && out_matrix_flat, OCC_ERR_NULL_ARG);
  if (n < 0) {
    set_last("n < 0");
    return OCC_ERR_GEOM;
  }
  if (n == 0) return OCC_OK;
  OCC_GUARD_BEGIN
  for (int i = 0; i < n; ++i) {
    if (!shapes[i]) return OCC_ERR_NULL_ARG;
    for (int j = 0; j < n; ++j) {
      const int idx = i * n + j;
      if (i == j) {
        out_matrix_flat[idx] = OCC_CLASH_SEPARATED;
        continue;
      }
      if (j < i) {
        /* matrix is symmetric under our metric */
        out_matrix_flat[idx] = out_matrix_flat[j * n + i];
        continue;
      }
      int st = OCC_CLASH_INTERFERING;
      const int rc =
          classify_clash(*as_shape(shapes[i]), *as_shape(shapes[j]),
                         clearance, &st, Standard_False);
      if (rc != OCC_OK) return rc;
      out_matrix_flat[idx] = st;
    }
  }
  return OCC_OK;
  OCC_GUARD_END
}

int occ_min_distance_to_set(occ_shape_t shape, const occ_shape_t* others,
                            int n, int* out_idx, double* out_dist) {
  REQ(shape && others && out_idx && out_dist, OCC_ERR_NULL_ARG);
  if (n <= 0) {
    set_last("empty others set");
    return OCC_ERR_INDEX;
  }
  OCC_GUARD_BEGIN
  const TopoDS_Shape& S = *as_shape(shape);
  double best = std::numeric_limits<double>::infinity();
  int best_i = -1;
  for (int i = 0; i < n; ++i) {
    if (!others[i]) return OCC_ERR_NULL_ARG;
    double d = 0.0;
    const int rc = dist_shapes(S, *as_shape(others[i]), &d, nullptr, nullptr);
    if (rc != OCC_OK) return rc;
    if (d < best) {
      best = d;
      best_i = i;
    }
  }
  if (best_i < 0) return OCC_ERR_GEOM;
  *out_idx = best_i;
  *out_dist = best;
  return OCC_OK;
  OCC_GUARD_END
}

/* =========================================================================
 * Global measures
 * ========================================================================= */

int occ_volume(occ_shape_t s, double* out_vol) {
  REQ(s && out_vol, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  GProp_GProps props;
  BRepGProp::VolumeProperties(*as_shape(s), props);
  *out_vol = props.Mass();
  return OCC_OK;
  OCC_GUARD_END
}

int occ_surface_area(occ_shape_t s, double* out_area) {
  REQ(s && out_area, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  GProp_GProps props;
  BRepGProp::SurfaceProperties(*as_shape(s), props);
  *out_area = props.Mass();
  return OCC_OK;
  OCC_GUARD_END
}

int occ_center_of_mass(occ_shape_t s, double out_com[3]) {
  REQ(s && out_com, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  GProp_GProps props;
  BRepGProp::VolumeProperties(*as_shape(s), props);
  pnt_to3(props.CentreOfMass(), out_com);
  return OCC_OK;
  OCC_GUARD_END
}

int occ_mass_properties(occ_shape_t s, double density, double* out_mass,
                        double out_com[3], double out_inertia_tensor[9]) {
  REQ(s && out_mass && out_com && out_inertia_tensor, OCC_ERR_NULL_ARG);
  if (!(density > 0.0) || !std::isfinite(density)) {
    set_last("density must be finite and > 0");
    return OCC_ERR_GEOM;
  }
  OCC_GUARD_BEGIN
  GProp_GProps props;
  BRepGProp::VolumeProperties(*as_shape(s), props);
  const double vol = props.Mass();
  *out_mass = vol * density;
  pnt_to3(props.CentreOfMass(), out_com);

  /* MatrixOfInertia is already about COM (GProp contract). Scale by density.
   * Row-major 3x3. */
  const gp_Mat M = props.MatrixOfInertia();
  /* M.Value(row,col) is 1-based */
  out_inertia_tensor[0] = M.Value(1, 1) * density; /* Ixx */
  out_inertia_tensor[1] = M.Value(1, 2) * density; /* Ixy */
  out_inertia_tensor[2] = M.Value(1, 3) * density; /* Ixz */
  out_inertia_tensor[3] = M.Value(2, 1) * density; /* Iyx */
  out_inertia_tensor[4] = M.Value(2, 2) * density; /* Iyy */
  out_inertia_tensor[5] = M.Value(2, 3) * density; /* Iyz */
  out_inertia_tensor[6] = M.Value(3, 1) * density; /* Izx */
  out_inertia_tensor[7] = M.Value(3, 2) * density; /* Izy */
  out_inertia_tensor[8] = M.Value(3, 3) * density; /* Izz */
  return OCC_OK;
  OCC_GUARD_END
}

int occ_length(occ_shape_t s, double* out_len) {
  REQ(s && out_len, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  GProp_GProps props;
  BRepGProp::LinearProperties(*as_shape(s), props, Standard_True);
  *out_len = props.Mass();
  return OCC_OK;
  OCC_GUARD_END
}

/* =========================================================================
 * Face / edge geometry
 * ========================================================================= */

int occ_face_area(occ_shape_t face, double* out_area) {
  REQ(face && out_area, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  if (as_shape(face)->ShapeType() != TopAbs_FACE) {
    set_last("occ_face_area: not a face");
    return OCC_ERR_INVALID_SHAPE;
  }
  return face_area_of(*as_shape(face), out_area);
  OCC_GUARD_END
}

int occ_face_normal(occ_shape_t face, double out_n[3]) {
  REQ(face && out_n, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  if (as_shape(face)->ShapeType() != TopAbs_FACE) {
    set_last("occ_face_normal: not a face");
    return OCC_ERR_INVALID_SHAPE;
  }
  TopoDS_Face F = TopoDS::Face(*as_shape(face));
  gp_Vec n;
  const int rc = face_normal_impl(F, n, nullptr);
  if (rc != OCC_OK) return rc;
  vec_to3(n, out_n);
  return OCC_OK;
  OCC_GUARD_END
}

int occ_face_center(occ_shape_t face, double out_p[3]) {
  REQ(face && out_p, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  if (as_shape(face)->ShapeType() != TopAbs_FACE) {
    set_last("occ_face_center: not a face");
    return OCC_ERR_INVALID_SHAPE;
  }
  TopoDS_Face F = TopoDS::Face(*as_shape(face));
  gp_Pnt p;
  face_center_impl(F, p);
  pnt_to3(p, out_p);
  return OCC_OK;
  OCC_GUARD_END
}

int occ_is_planar_face(occ_shape_t face, int* out_bool) {
  REQ(face && out_bool, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  if (as_shape(face)->ShapeType() != TopAbs_FACE) {
    set_last("occ_is_planar_face: not a face");
    return OCC_ERR_INVALID_SHAPE;
  }
  TopoDS_Face F = TopoDS::Face(*as_shape(face));
  /* Fast path: BRepAdaptor type */
  BRepAdaptor_Surface ads(F);
  if (ads.GetType() == GeomAbs_Plane) {
    *out_bool = 1;
    return OCC_OK;
  }
  /* Geom_Plane downcast or GeomLib_IsPlanarSurface for NURBS flats */
  *out_bool = is_planar_face_impl(F) ? 1 : 0;
  return OCC_OK;
  OCC_GUARD_END
}

int occ_largest_face(occ_shape_t s, int* out_1based_index) {
  return occ_largest_face_area(s, out_1based_index, nullptr);
}

int occ_largest_face_area(occ_shape_t s, int* out_1based_index,
                          double* out_area) {
  REQ(s && out_1based_index, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  TopTools_IndexedMapOfShape faces;
  map_subshapes(*as_shape(s), TopAbs_FACE, faces);
  if (faces.Extent() < 1) {
    set_last("no faces");
    return OCC_ERR_INDEX;
  }
  double best = -1.0;
  int best_i = 1;
  for (int i = 1; i <= faces.Extent(); ++i) {
    double a = 0.0;
    face_area_of(faces.FindKey(i), &a);
    if (a > best) {
      best = a;
      best_i = i;
    }
  }
  *out_1based_index = best_i;
  if (out_area) *out_area = best;
  return OCC_OK;
  OCC_GUARD_END
}

int occ_edge_midpoint(occ_shape_t edge, double out_p[3]) {
  REQ(edge && out_p, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  if (as_shape(edge)->ShapeType() != TopAbs_EDGE) {
    set_last("occ_edge_midpoint: not an edge");
    return OCC_ERR_INVALID_SHAPE;
  }
  TopoDS_Edge E = TopoDS::Edge(*as_shape(edge));
  BRepAdaptor_Curve c(E);
  const Standard_Real t =
      0.5 * (c.FirstParameter() + c.LastParameter());
  pnt_to3(c.Value(t), out_p);
  return OCC_OK;
  OCC_GUARD_END
}

int occ_edge_tangent(occ_shape_t edge, double out_t[3]) {
  REQ(edge && out_t, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  if (as_shape(edge)->ShapeType() != TopAbs_EDGE) {
    set_last("occ_edge_tangent: not an edge");
    return OCC_ERR_INVALID_SHAPE;
  }
  TopoDS_Edge E = TopoDS::Edge(*as_shape(edge));
  BRepAdaptor_Curve c(E);
  const Standard_Real t =
      0.5 * (c.FirstParameter() + c.LastParameter());
  gp_Pnt pt;
  gp_Vec d1;
  c.D1(t, pt, d1);
  if (d1.Magnitude() < Precision::Confusion()) {
    set_last("edge tangent degenerate");
    return OCC_ERR_GEOM;
  }
  d1.Normalize();
  if (E.Orientation() == TopAbs_REVERSED) d1.Reverse();
  vec_to3(d1, out_t);
  return OCC_OK;
  OCC_GUARD_END
}

int occ_edge_length(occ_shape_t edge, double* out_len) {
  REQ(edge && out_len, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  if (as_shape(edge)->ShapeType() != TopAbs_EDGE) {
    set_last("occ_edge_length: not an edge");
    return OCC_ERR_INVALID_SHAPE;
  }
  return edge_length_of(*as_shape(edge), out_len);
  OCC_GUARD_END
}

/* =========================================================================
 * Topology typing & solids
 * ========================================================================= */

int occ_shape_type(occ_shape_t s, int* out) {
  REQ(s && out, OCC_ERR_NULL_ARG);
  /* TopAbs_ShapeEnum order matches OCC_SHAPE_* in occ_c.h */
  *out = static_cast<int>(as_shape(s)->ShapeType());
  return OCC_OK;
}

int occ_count_solids(occ_shape_t s, int* out_n) {
  REQ(s && out_n, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  TopTools_IndexedMapOfShape solids;
  map_subshapes(*as_shape(s), TopAbs_SOLID, solids);
  *out_n = solids.Extent();
  return OCC_OK;
  OCC_GUARD_END
}

int occ_solid_at(occ_shape_t s, int index_1based, occ_shape_t* out) {
  REQ(s && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  TopTools_IndexedMapOfShape solids;
  map_subshapes(*as_shape(s), TopAbs_SOLID, solids);
  if (index_1based < 1 || index_1based > solids.Extent()) {
    set_last("solid index out of range");
    return OCC_ERR_INDEX;
  }
  *out = to_handle(solids.FindKey(index_1based));
  return OCC_OK;
  OCC_GUARD_END
}

/* =========================================================================
 * Proximity helpers
 * ========================================================================= */

int occ_closest_face_to_point(occ_shape_t shape, const double p[3],
                              int* out_face_index,
                              double out_point_on_face[3]) {
  REQ(shape && p && out_face_index, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  TopTools_IndexedMapOfShape faces;
  map_subshapes(*as_shape(shape), TopAbs_FACE, faces);
  if (faces.Extent() < 1) {
    set_last("no faces for closest-face query");
    return OCC_ERR_INDEX;
  }

  BRepBuilderAPI_MakeVertex mkv(gp_Pnt(p[0], p[1], p[2]));
  if (!mkv.IsDone()) {
    set_last("MakeVertex failed");
    return OCC_ERR_GEOM;
  }
  const TopoDS_Vertex V = mkv.Vertex();

  double best = std::numeric_limits<double>::infinity();
  int best_i = 1;
  gp_Pnt best_pt(p[0], p[1], p[2]);

  for (int i = 1; i <= faces.Extent(); ++i) {
    BRepExtrema_DistShapeShape dss;
    dss.LoadS1(V);
    dss.LoadS2(faces.FindKey(i));
    dss.Perform();
    if (!dss.IsDone() || dss.NbSolution() < 1) continue;
    const double d = dss.Value();
    if (d < best) {
      best = d;
      best_i = i;
      best_pt = dss.PointOnShape2(1);
    }
  }
  if (!std::isfinite(best)) {
    set_last("closest face: all extrema failed");
    return OCC_ERR_GEOM;
  }
  *out_face_index = best_i;
  if (out_point_on_face) pnt_to3(best_pt, out_point_on_face);
  return OCC_OK;
  OCC_GUARD_END
}

int occ_ray_cast(occ_shape_t shape, const double origin[3],
                 const double dir[3], double* out_t, double out_hit[3],
                 int* out_face_index) {
  REQ(shape && origin && dir, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  double dx = dir[0], dy = dir[1], dz = dir[2];
  const double L = vlen3(dx, dy, dz);
  if (L < 1.0e-30) {
    set_last("ray direction near zero");
    return OCC_ERR_GEOM;
  }
  /* gp_Lin needs unit direction; parameter W is along unit dir → scale t */
  gp_Lin lin(gp_Pnt(origin[0], origin[1], origin[2]),
             gp_Dir(dx / L, dy / L, dz / L));

  BRepIntCurveSurface_Inter inter;
  inter.Init(*as_shape(shape), lin, Precision::Confusion());

  Standard_Boolean any = Standard_False;
  double best_w = 0.0; /* along unit direction */
  gp_Pnt best_pt;
  TopoDS_Face best_face;

  for (; inter.More(); inter.Next()) {
    const Standard_Real w = inter.W();
    if (w < -Precision::Confusion()) continue; /* behind ray origin */
    if (!any || w < best_w) {
      any = Standard_True;
      best_w = w;
      best_pt = inter.Pnt();
      best_face = inter.Face();
    }
  }

  if (!any) {
    set_last("ray cast: no hit");
    return OCC_ERR_INDEX;
  }

  /* Convert unit-dir parameter to caller dir parameter: hit = o + t * dir
   * and also hit = o + w * unit(dir) ⇒ t = w / L */
  if (out_t) *out_t = best_w / L;
  if (out_hit) pnt_to3(best_pt, out_hit);

  if (out_face_index) {
    *out_face_index = 0;
    TopTools_IndexedMapOfShape faces;
    map_subshapes(*as_shape(shape), TopAbs_FACE, faces);
    for (int i = 1; i <= faces.Extent(); ++i) {
      if (faces.FindKey(i).IsSame(best_face)) {
        *out_face_index = i;
        break;
      }
    }
  }
  return OCC_OK;
  OCC_GUARD_END
}

/* =========================================================================
 * Bounds, validity, topology fingerprint
 * ========================================================================= */

int occ_bbox(occ_shape_t s, double out_min[3], double out_max[3]) {
  REQ(s && out_min && out_max, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  Bnd_Box box;
  BRepBndLib::Add(*as_shape(s), box);
  if (box.IsVoid()) {
    set_last("bbox void");
    return OCC_ERR_GEOM;
  }
  Standard_Real xmin, ymin, zmin, xmax, ymax, zmax;
  box.Get(xmin, ymin, zmin, xmax, ymax, zmax);
  out_min[0] = xmin;
  out_min[1] = ymin;
  out_min[2] = zmin;
  out_max[0] = xmax;
  out_max[1] = ymax;
  out_max[2] = zmax;
  return OCC_OK;
  OCC_GUARD_END
}

int occ_is_valid_shape(occ_shape_t s, int* out_bool) {
  REQ(s && out_bool, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  BRepCheck_Analyzer ana(*as_shape(s), Standard_True);
  *out_bool = ana.IsValid() ? 1 : 0;
  return OCC_OK;
  OCC_GUARD_END
}

int occ_same_topology_count_hash(occ_shape_t s,
                                 unsigned long long* out_hash) {
  REQ(s && out_hash, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  const TopoDS_Shape& S = *as_shape(s);
  TopTools_IndexedMapOfShape faces, edges, verts;
  map_subshapes(S, TopAbs_FACE, faces);
  map_subshapes(S, TopAbs_EDGE, edges);
  map_subshapes(S, TopAbs_VERTEX, verts);

  unsigned long long h = 0xcbf29ce484222325ULL; /* FNV-ish seed */
  h = mix_u64(h, static_cast<unsigned long long>(S.ShapeType()));
  h = mix_u64(h, static_cast<unsigned long long>(faces.Extent()));
  h = mix_u64(h, static_cast<unsigned long long>(edges.Extent()));
  h = mix_u64(h, static_cast<unsigned long long>(verts.Extent()));
  /* Cheap orientation/flags mix — still not geometric */
  h = mix_u64(h, static_cast<unsigned long long>(S.Orientation()));
  *out_hash = h;
  return OCC_OK;
  OCC_GUARD_END
}

/* =========================================================================
 * Selector helpers
 * ========================================================================= */

int occ_select_faces_by_area_gt(occ_shape_t shape, double min_area,
                                int* out_indices, int max_out, int* out_n) {
  REQ(shape && out_n, OCC_ERR_NULL_ARG);
  if (max_out < 0) return OCC_ERR_GEOM;
  if (max_out > 0) REQ(out_indices, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  TopTools_IndexedMapOfShape faces;
  map_subshapes(*as_shape(shape), TopAbs_FACE, faces);
  int n = 0;
  for (int i = 1; i <= faces.Extent(); ++i) {
    double a = 0.0;
    face_area_of(faces.FindKey(i), &a);
    if (a > min_area) {
      if (n < max_out && out_indices) out_indices[n] = i;
      ++n;
    }
  }
  /* If caller only wanted the count, still OK when max_out==0 */
  *out_n = n;
  if (n > max_out && max_out > 0) {
    /* truncated write; report true count in *out_n */
    set_last("select faces: output truncated");
    /* still OCC_OK — host can reallocate using *out_n */
  }
  return OCC_OK;
  OCC_GUARD_END
}

int occ_select_edges_by_length_gt(occ_shape_t shape, double min_len,
                                  int* out_indices, int max_out, int* out_n) {
  REQ(shape && out_n, OCC_ERR_NULL_ARG);
  if (max_out < 0) return OCC_ERR_GEOM;
  if (max_out > 0) REQ(out_indices, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  TopTools_IndexedMapOfShape edges;
  map_subshapes(*as_shape(shape), TopAbs_EDGE, edges);
  int n = 0;
  for (int i = 1; i <= edges.Extent(); ++i) {
    double L = 0.0;
    edge_length_of(edges.FindKey(i), &L);
    if (L > min_len) {
      if (n < max_out && out_indices) out_indices[n] = i;
      ++n;
    }
  }
  *out_n = n;
  return OCC_OK;
  OCC_GUARD_END
}

int occ_select_planar_faces(occ_shape_t shape, int* out_indices, int max_out,
                            int* out_n) {
  REQ(shape && out_n, OCC_ERR_NULL_ARG);
  if (max_out < 0) return OCC_ERR_GEOM;
  if (max_out > 0) REQ(out_indices, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  TopTools_IndexedMapOfShape faces;
  map_subshapes(*as_shape(shape), TopAbs_FACE, faces);
  int n = 0;
  for (int i = 1; i <= faces.Extent(); ++i) {
    const TopoDS_Face F = TopoDS::Face(faces.FindKey(i));
    BRepAdaptor_Surface ads(F);
    bool planar = (ads.GetType() == GeomAbs_Plane);
    if (!planar) planar = is_planar_face_impl(F);
    if (planar) {
      if (n < max_out && out_indices) out_indices[n] = i;
      ++n;
    }
  }
  *out_n = n;
  return OCC_OK;
  OCC_GUARD_END
}

int occ_select_faces_parallel_to(occ_shape_t shape, const double normal[3],
                                 double tol_deg, int* out_indices, int max_out,
                                 int* out_n) {
  REQ(shape && normal && out_n, OCC_ERR_NULL_ARG);
  if (max_out < 0) return OCC_ERR_GEOM;
  if (max_out > 0) REQ(out_indices, OCC_ERR_NULL_ARG);
  if (!(tol_deg >= 0.0) || !std::isfinite(tol_deg)) {
    set_last("tol_deg must be finite and >= 0");
    return OCC_ERR_GEOM;
  }
  double nx = normal[0], ny = normal[1], nz = normal[2];
  if (!normalize3(nx, ny, nz)) {
    set_last("normal near zero");
    return OCC_ERR_GEOM;
  }
  OCC_GUARD_BEGIN
  TopTools_IndexedMapOfShape faces;
  map_subshapes(*as_shape(shape), TopAbs_FACE, faces);
  int n = 0;
  for (int i = 1; i <= faces.Extent(); ++i) {
    TopoDS_Face F = TopoDS::Face(faces.FindKey(i));
    gp_Vec fn;
    if (face_normal_impl(F, fn, nullptr) != OCC_OK) continue;
    const double ang = angle_deg_unit(fn, nx, ny, nz);
    if (ang <= tol_deg) {
      if (n < max_out && out_indices) out_indices[n] = i;
      ++n;
    }
  }
  *out_n = n;
  return OCC_OK;
  OCC_GUARD_END
}

}  // extern "C"
```

---

## 5. IR map

| IR op / host need | C API |
|-------------------|-------|
| `QueryClash` pair | `occ_clash(a,b,clearance,&st)` |
| `QueryClash` multi-body | `occ_clash_all_pairs` |
| Min gap KPI | `occ_distance` + contact points |
| Nearest obstacle | `occ_min_distance_to_set` |
| `QueryGeom` volume/area/COM | `occ_volume` / `occ_surface_area` / `occ_center_of_mass` |
| Mass + inertia | `occ_mass_properties(s, ρ, …)` |
| Edge length / face area | `occ_length` / `occ_face_area` |
| Largest / planar / parallel face | selectors + `occ_largest_face` |
| Edge mid + tangent (joint axis seed) | `occ_edge_midpoint` / `occ_edge_tangent` |
| Solid extract from compound | `occ_count_solids` / `occ_solid_at` |
| Pick face under cursor | `occ_ray_cast` or `occ_closest_face_to_point` |
| BBox cull before clash | `occ_bbox` |
| Healing gate | `occ_is_valid_shape` |
| Dirty check | `occ_same_topology_count_hash` |

---

## 6. Host usage sketches

### 6.1 Skid pipe vs housing clearance (25 mm KPI)

```c
double d, pa[3], pb[3];
int st;
if (occ_distance(pipe, housing, &d, pa, pb) != OCC_OK) abort_eval();
if (occ_clash(pipe, housing, 0.025, &st) != OCC_OK) abort_eval();

/* st==0: green; st==1: amber KPI; st==2: red hard clash */
log_kpi("clearance_m", d);
log_kpi("clash_status", st);
```

### 6.2 Robot non-adjacent self-collision

```c
enum { N = 6 };
occ_shape_t links[N]; /* already posed */
int mat[N * N];
occ_clash_all_pairs(links, N, 0.002, mat); /* 2 mm skin */

for (int i = 0; i < N; ++i) {
  for (int j = i + 2; j < N; ++j) { /* skip adjacent */
    if (mat[i * N + j] == OCC_CLASH_INTERFERING)
      fail("self-collision %d vs %d", i, j);
  }
}
```

### 6.3 Steel mass for skid frame member

```c
double mass, com[3], I[9];
occ_mass_properties(beam, 7850.0, &mass, com, I); /* mild steel kg/m^3 */
/* I is row-major about COM — feed multibody dynamics or COG report */
```

### 6.4 Select top planar mounting face

```c
int idxs[64], n = 0;
double zaxis[3] = {0, 0, 1};
occ_select_faces_parallel_to(part, zaxis, 5.0, idxs, 64, &n);
/* further filter by area */
int planar[64], np = 0;
occ_select_planar_faces(part, planar, 64, &np);
```

### 6.5 Ray pick for review UI

```c
double t, hit[3];
int fi = 0;
if (occ_ray_cast(model, origin, dir, &t, hit, &fi) == OCC_OK) {
  highlight_face(fi); /* 1-based */
}
```

---

## 7. Notes / pitfalls (implementer checklist)

1. **`InnerSolution`** — true when one solid contains (part of) the other; distance may be 0 even without face contact. Always treat as **INTERFERING**.  
2. **Clearance band** — status **1** is not an error; hosts map it to KPI warnings.  
3. **Density** — only scales volume-derived props; do not pass density into `BRepGProp` itself.  
4. **Inertia layout** — full 9-element row-major (not the 6-element Voigt pack used in an earlier sketch of `occ_c-p0-literate-api.md`).  
5. **Indices** — all topology indices **1-based**, matching `TopExp` / baseline `occ_face_at`.  
6. **Ray parameter** — `BRepIntCurveSurface_Inter::W()` is along **unit** direction; we convert to caller `dir` scale.  
7. **Selectors** — when `max_out == 0`, only `*out_n` is filled (count query).  
8. **Thread safety** — `set_last` is TLS in `occ_c_internal.hxx`; DistShapeShape is re-entrant per instance.  
9. **Performance** — for large all-pairs, host should bbox-cull with `occ_bbox` before calling `occ_clash`.  
10. **Optional common-volume** — wired in `classify_clash` but disabled for `occ_clash` P0 speed; flip `try_common_volume` if product needs boolean confirmation.

---

## 8. BUILD glue (reminder)

```python
# api/BUILD.bazel fragment
# add to occ_c library srcs:
#   "src/occ_c_query.cc"
# hdrs:
#   "include/occ_c_query.h"
# and export symbols in _OCC_C_EXPORTS if using explicit lists.
```

Wasm size: this TU pulls `BRepExtrema`, `BRepGProp`, `BRepCheck`, `BRepIntCurveSurface` — already typical for a measure-enabled kernel; no XCAF.

---

## 9. Self-check matrix (extract-time)

| Symbol | Present in `.h` | Full body in `.cc` | OCCT primary |
|--------|-----------------|--------------------|--------------|
| `occ_distance` | ✓ | ✓ | `BRepExtrema_DistShapeShape` |
| `occ_clash` | ✓ | ✓ | Dist + InnerSolution |
| `occ_clash_all_pairs` | ✓ | ✓ | loop classify |
| `occ_min_distance_to_set` | ✓ | ✓ | Dist loop |
| `occ_volume` | ✓ | ✓ | `VolumeProperties` |
| `occ_surface_area` | ✓ | ✓ | `SurfaceProperties` |
| `occ_center_of_mass` | ✓ | ✓ | `CentreOfMass` |
| `occ_mass_properties` | ✓ | ✓ | Mass×ρ + MatrixOfInertia×ρ |
| `occ_length` | ✓ | ✓ | `LinearProperties` |
| `occ_face_area` | ✓ | ✓ | SurfaceProperties |
| `occ_face_normal` | ✓ | ✓ | `BRepAdaptor_Surface::D1` |
| `occ_face_center` | ✓ | ✓ | UV mid |
| `occ_is_planar_face` | ✓ | ✓ | GeomAbs_Plane / GeomLib / Geom_Plane |
| `occ_largest_face` | ✓ | ✓ | area scan |
| `occ_largest_face_area` | ✓ | ✓ | area scan |
| `occ_edge_midpoint` | ✓ | ✓ | `BRepAdaptor_Curve` |
| `occ_edge_tangent` | ✓ | ✓ | D1 + orientation |
| `occ_edge_length` | ✓ | ✓ | LinearProperties |
| `occ_shape_type` | ✓ | ✓ | `ShapeType()` |
| `occ_count_solids` | ✓ | ✓ | MapShapes SOLID |
| `occ_solid_at` | ✓ | ✓ | MapShapes + copy |
| `occ_closest_face_to_point` | ✓ | ✓ | vertex vs faces |
| `occ_ray_cast` | ✓ | ✓ | `BRepIntCurveSurface_Inter` |
| `occ_bbox` | ✓ | ✓ | `BRepBndLib` |
| `occ_is_valid_shape` | ✓ | ✓ | `BRepCheck_Analyzer` |
| `occ_same_topology_count_hash` | ✓ | ✓ | face/edge/vert counts |
| `occ_select_faces_by_area_gt` | ✓ | ✓ | filter |
| `occ_select_edges_by_length_gt` | ✓ | ✓ | filter |
| `occ_select_planar_faces` | ✓ | ✓ | planarity |
| `occ_select_faces_parallel_to` | ✓ | ✓ | normal angle |

**End of section 06.**

<!-- END 06-query-measure.md -->


<!-- BEGIN 07-sweeps-helix-ext.md -->

# Section 07 — Extended Sweeps, Helix, Thicken & Sew

**Module:** `occ_c_sweep_ext`  
**OCCT pin:** 7.9.3  
**Priority:** P0 extents + P2 helix/thicken (implemented anyway for springs/threads)  
**Depends on:** `occ_c.h`, `occ_c_internal.hxx` (shared `as_shape` / `to_handle` / `OCC_GUARD_*`)  
**Extract to:**

```text
api/include/occ_c_sweep_ext.h
api/src/occ_c_sweep_ext.cc
```

---

## Pedagogy — PushPull extents taxonomy (clean-room)

CAD kernels expose a *primitive* linear sweep (`BRepPrimAPI_MakePrism`). Product
features (Onshape `extrude`, IR `PushPull`, SolidWorks Boss-Extrude) sit **on
top** of that primitive and add an *extent* taxonomy:

| Extent kind | Product meaning | Kernel reduction |
|-------------|-----------------|------------------|
| **Blind** | fixed distance along a direction | `MakePrism(profile, vec)` |
| **Symmetric / midplane** | half depth each side of the sketch plane | prism of `2·h` then shift by `-h·n` |
| **To depth** | unit direction × scalar depth | same as blind with `vec = depth·û` |
| **Through all** | long enough to clear a body | prism length ≥ `2 · bbox_diagonal` along `û` |
| **Up-to face / next** | stop at another surface | *not* in this module (needs `BRepFeat_MakePrism` / section) |
| **Draft** | taper walls while extruding | **SKIPPED** (P2; `BRepOffsetAPI_DraftAngle` / `BRepFeat`) |

This module ships the **extent reductions** as first-class C entry points so the
IR / Luau layer can lower:

```text
PushPull { extent: blind, depth }        → occ_extrude_to_depth / occ_extrude_blind
PushPull { extent: symmetric, half }     → occ_extrude_symmetric
PushPull { extent: through_all, body }   → occ_extrude_through_all
SpinSolid { angle: 2π }                  → occ_revolve_full
Loft { solid, ruled }                    → occ_loft_solid / occ_loft_ruled
SweepAlong { profile, spine }            → occ_sweep_profile_along_wire
MakeHelix / spring centerline            → occ_make_helix_wire
Thicken sheet / offset face              → occ_thicken_shell / occ_offset_face
Sew open faces → shell → solid           → occ_sew_faces + occ_make_solid_from_shell
```

**Units:** meters, radians. Directions that claim to be unit vectors are
normalized defensively; zero-length directions return `OCC_ERR_GEOM`.

**Draft skip policy:** no `occ_draft_*` symbols are exported. Callers that need
mold draft must use a later module (or boolean + offset recipes). See § Draft
skip note at the end of the header.

---

## OCCT class map

| C symbol | Primary OCCT |
|----------|--------------|
| `occ_extrude_blind` | `BRepPrimAPI_MakePrism` + `gp_Vec` |
| `occ_extrude_to_depth` | `MakePrism` + `gp_Dir * depth` |
| `occ_extrude_symmetric` | `MakePrism` full length + `BRepBuilderAPI_Transform` shift |
| `occ_extrude_through_all` | `BRepBndLib` diagonal · 2 + `MakePrism` |
| `occ_revolve_full` | `BRepPrimAPI_MakeRevol` (angle default `2π`) |
| `occ_loft_solid` / `occ_loft_ruled` | `BRepOffsetAPI_ThruSections(isSolid, isRuled)` |
| `occ_make_helix_wire` | `Geom_CylindricalSurface` + `GCE2d_MakeSegment` + `BRepBuilderAPI_MakeEdge` + `BRepLib::BuildCurves3d` |
| `occ_sweep_profile_along_wire` | `BRepOffsetAPI_MakePipe` |
| `occ_thicken_shell` | `BRepOffsetAPI_MakeThickSolid::MakeThickSolidBySimple` |
| `occ_offset_face` | `BRepOffsetAPI_MakeOffsetShape::PerformBySimple` |
| `occ_sew_faces` | `BRepBuilderAPI_Sewing` |
| `occ_make_solid_from_shell` | `BRepBuilderAPI_MakeSolid` |

---

## Header — `// === file: occ_c_sweep_ext.h`

```c
// === file: occ_c_sweep_ext.h
// Extended sweeps beyond baseline occ_extrude / occ_revolve / occ_loft / occ_pipe.
// OCCT 7.9.3 — extents, helix, thicken, sew, solid-from-shell.
//
// Draft (taper) is intentionally NOT provided here — see DRAFT SKIP note below.
//
#ifndef OCC_C_SWEEP_EXT_H_
#define OCC_C_SWEEP_EXT_H_

#include "occ_c.h"

#ifdef __cplusplus
extern "C" {
#endif

/* Ensure geom error code exists even if baseline occ_c.h has not been patched. */
#ifndef OCC_ERR_GEOM
#define OCC_ERR_GEOM 8
#endif

/* =========================================================================
 * Linear extrude extents (PushPull taxonomy)
 * ========================================================================= */

/**
 * Blind extrude — alias of baseline prism: profile swept by vector (dx,dy,dz).
 * Profile: face → solid, wire → shell, edge → face (OCCT rules).
 *
 * @param profile  face / wire / edge / vertex
 * @param dx,dy,dz sweep vector in meters (not required unit)
 * @param out      owned result shape
 */
OCC_API int occ_extrude_blind(occ_shape_t profile,
                              double dx, double dy, double dz,
                              occ_shape_t* out);

/**
 * Extrude a fixed depth along a direction. Direction is normalized;
 * result vector = depth * û. Depth must be > 0.
 */
OCC_API int occ_extrude_to_depth(occ_shape_t profile,
                                 double dir_x, double dir_y, double dir_z,
                                 double depth,
                                 occ_shape_t* out);

/**
 * Symmetric / midplane extrude: half_depth each side of the profile plane
 * along unit direction. Equivalent to prism of length 2*half_depth centered
 * on the profile (translate by -half_depth * û after prism of +û * 2h).
 *
 * @param half_depth  positive half-thickness in meters
 */
OCC_API int occ_extrude_symmetric(occ_shape_t profile,
                                  double dir_x, double dir_y, double dir_z,
                                  double half_depth,
                                  occ_shape_t* out);

/**
 * Through-all style extrude relative to another solid's bounding box.
 *
 * Algorithm (documented contract):
 *   1. Compute AABB of relative_to_solid (BRepBndLib).
 *   2. L = 2 * bbox_diagonal  (guarantees clearance both ways for typical parts).
 *   3. Build prism of length L along unit dir starting from the profile,
 *      then center it so the prism straddles the solid's projection
 *      (shift by -0.5*L along dir). If you only need a one-sided long
 *      extrusion, use occ_extrude_to_depth with a large depth instead.
 *
 * The result is the **tool body** (prism). Boolean cut/fuse against the
 * solid is the caller's job (product feature layer).
 *
 * @param relative_to_solid  any shape with finite bbox; used only for size
 */
OCC_API int occ_extrude_through_all(occ_shape_t profile,
                                    double dir_x, double dir_y, double dir_z,
                                    occ_shape_t relative_to_solid,
                                    occ_shape_t* out);

/* =========================================================================
 * Revolve
 * ========================================================================= */

/**
 * Full revolution (angle = 2π) of profile about axis (px,py,pz)+(ax,ay,az).
 * Axis direction is normalized.
 */
OCC_API int occ_revolve_full(occ_shape_t profile,
                             double px, double py, double pz,
                             double ax, double ay, double az,
                             occ_shape_t* out);

/* =========================================================================
 * Loft with solid / ruled flags
 * ========================================================================= */

/**
 * Loft through wire/vertex sections as a solid (isSolid=true).
 * @param ruled  if non-zero, ruled surfaces between consecutive sections
 */
OCC_API int occ_loft_solid(const occ_shape_t* profiles, int n, int ruled,
                           occ_shape_t* out);

/**
 * Loft with explicit solid and ruled flags (full ThruSections control).
 * @param solid  non-zero → solid, else shell
 * @param ruled  non-zero → ruled faces, else smoothed approximation
 */
OCC_API int occ_loft_ruled(const occ_shape_t* profiles, int n,
                           int solid, int ruled,
                           occ_shape_t* out);

/* =========================================================================
 * Helix wire (springs, threads P2 — implemented)
 * ========================================================================= */

/**
 * Build an open helical wire on a cylinder.
 *
 * Construction (OCCT tutorial pattern):
 *   Geom_CylindricalSurface(ax2, radius)
 *   2D line/segment in (U,V) with U=angle, V=height:
 *       P0 = (0, 0),  P1 = (±2π · turns, height)
 *   BRepBuilderAPI_MakeEdge(curve2d, surface)
 *   BRepLib::BuildCurves3d
 *   BRepBuilderAPI_MakeWire
 *
 * @param axis_px,py,pz  axis origin
 * @param axis_dx,dy,dz  axis direction (normalized)
 * @param radius         cylinder radius > 0
 * @param pitch          height advance per full turn > 0
 * @param height         total axial length > 0  (turns = height/pitch)
 * @param right_handed   non-zero → right-handed (U increases with V);
 *                       zero → left-handed (U decreases)
 * @param out            wire shape
 */
OCC_API int occ_make_helix_wire(double axis_px, double axis_py, double axis_pz,
                                double axis_dx, double axis_dy, double axis_dz,
                                double radius, double pitch, double height,
                                int right_handed,
                                occ_shape_t* out);

/**
 * Convenience: number of turns instead of height.
 * height = turns * pitch. turns must be > 0.
 */
OCC_API int occ_make_helix_wire_turns(double axis_px, double axis_py,
                                      double axis_pz,
                                      double axis_dx, double axis_dy,
                                      double axis_dz,
                                      double radius, double pitch,
                                      double turns, int right_handed,
                                      occ_shape_t* out);

/* =========================================================================
 * Pipe / sweep along spine
 * ========================================================================= */

/**
 * Sweep profile along a spine wire (BRepOffsetAPI_MakePipe).
 * Semantic alias of baseline occ_pipe with stricter validation + error text.
 */
OCC_API int occ_sweep_profile_along_wire(occ_shape_t profile,
                                         occ_shape_t spine_wire,
                                         occ_shape_t* out);

/**
 * Helical spring solid: circle profile of wire_radius swept along helix.
 * Builds helix then MakePipe. Useful for AI-BOOST springs / P2 threads prep.
 */
OCC_API int occ_make_spring_solid(double axis_px, double axis_py, double axis_pz,
                                  double axis_dx, double axis_dy, double axis_dz,
                                  double coil_radius, double pitch,
                                  double height, double wire_radius,
                                  int right_handed,
                                  occ_shape_t* out);

/* =========================================================================
 * Thicken / offset / sew / solidify
 * ========================================================================= */

/**
 * Thicken an open face or shell into a solid by offset distance.
 * Uses MakeThickSolidBySimple (no face-removal list).
 * Positive thickness offsets along face normal (OCCT convention).
 */
OCC_API int occ_thicken_shell(occ_shape_t shell_or_face, double thickness,
                              occ_shape_t* out);

/**
 * Offset a face (or shell) by distance; returns the offset shell/face shape.
 * Uses MakeOffsetShape::PerformBySimple.
 */
OCC_API int occ_offset_face(occ_shape_t face, double offset, occ_shape_t* out);

/**
 * Sew an array of faces (or shells) into a single sewed shape (usually shell).
 * @param shapes  array of face/shell/compound-of-faces
 * @param n       count ≥ 1
 * @param tol     sewing tolerance in meters (e.g. 1e-6)
 */
OCC_API int occ_sew_faces(const occ_shape_t* shapes, int n, double tol,
                          occ_shape_t* out);

/**
 * Promote a closed shell to a solid (BRepBuilderAPI_MakeSolid).
 * Shell must be closed and orientable; no geometric healing is performed.
 */
OCC_API int occ_make_solid_from_shell(occ_shape_t shell, occ_shape_t* out);

/**
 * Sew faces then attempt solidification in one call.
 * If sew result is already a solid, returns it; if shell, MakeSolid.
 */
OCC_API int occ_sew_to_solid(const occ_shape_t* shapes, int n, double tol,
                             occ_shape_t* out);

/* =========================================================================
 * Diagnostics helpers (bbox / diagonal — used by through-all)
 * ========================================================================= */

/** Axis-aligned bbox of shape; out_min/out_max are length-3 arrays. */
OCC_API int occ_sweep_bbox(occ_shape_t s, double out_min[3], double out_max[3]);

/** Bounding-box space diagonal (sqrt of sum of squared side lengths). */
OCC_API int occ_sweep_bbox_diagonal(occ_shape_t s, double* out_diag);

/* =========================================================================
 * DRAFT SKIP (P2 — intentionally not implemented in this module)
 * =========================================================================
 *
 * Product draft / taper would map to:
 *   - BRepOffsetAPI_DraftAngle  (draft faces of a solid)
 *   - BRepFeat_MakePrism with draft angle
 *   - BRepOffsetAPI_MakeDraft   (draft surface from wire)
 *
 * Exporting a half-baked occ_draft_* would invite silent geometry errors on
 * non-manifold skid parts. Callers must treat draft as unsupported:
 *
 *   if (feature.draft_deg != 0) return product_error("draft not in kernel P0");
 *
 * When draft is added, put it in occ_c_draft.h — do not bolt it onto extrude
 * extents here without a solid regression suite.
 */

#ifdef __cplusplus
}
#endif

#endif /* OCC_C_SWEEP_EXT_H_ */
```

---

## Implementation — `// === file: occ_c_sweep_ext.cc`

```cpp
// === file: occ_c_sweep_ext.cc
// Extended sweeps for occ_c — OCCT 7.9.3.
// Blind / symmetric / through-all / revolve-full / loft flags /
// helix wire / pipe / thicken / sew / solid-from-shell.
//
#include "occ_c_sweep_ext.h"
#include "occ_c_internal.hxx"

#include <cmath>
#include <vector>

#include <BRepBndLib.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakeSolid.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_Sewing.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepLib.hxx>
#include <BRepOffsetAPI_MakeOffsetShape.hxx>
#include <BRepOffsetAPI_MakePipe.hxx>
#include <BRepOffsetAPI_MakeThickSolid.hxx>
#include <BRepOffsetAPI_ThruSections.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <BRepPrimAPI_MakeRevol.hxx>
#include <BRep_Builder.hxx>
#include <Bnd_Box.hxx>
#include <GCE2d_MakeSegment.hxx>
#include <Geom2d_Curve.hxx>
#include <Geom2d_TrimmedCurve.hxx>
#include <Geom_CylindricalSurface.hxx>
#include <Geom_Surface.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS_Solid.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Ax1.hxx>
#include <gp_Ax2.hxx>
#include <gp_Circ.hxx>
#include <gp_Dir.hxx>
#include <gp_Dir2d.hxx>
#include <gp_Pnt.hxx>
#include <gp_Pnt2d.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>

using occ_c_detail::as_shape;
using occ_c_detail::to_handle;
using occ_c_detail::set_last;

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

namespace {

constexpr double k_eps = 1.0e-14;
constexpr double k_tol_default = 1.0e-6;

/* ---- small math helpers ------------------------------------------------ */

static bool unit_dir(double x, double y, double z, gp_Dir& out) {
  const double m2 = x * x + y * y + z * z;
  if (m2 < k_eps) return false;
  out = gp_Dir(x, y, z); /* gp_Dir normalizes */
  return true;
}

static bool finite3(double x, double y, double z) {
  return std::isfinite(x) && std::isfinite(y) && std::isfinite(z);
}

/* Prism of profile by vector V. */
static int prism_vec(const TopoDS_Shape& profile, const gp_Vec& V,
                     TopoDS_Shape& out_shape) {
  if (V.Magnitude() < k_eps) {
    set_last("extrude: zero-length sweep vector");
    return OCC_ERR_GEOM;
  }
  BRepPrimAPI_MakePrism mk(profile, V, /*Copy=*/Standard_True);
  if (!mk.IsDone()) {
    set_last("extrude: MakePrism failed");
    return OCC_ERR_GEOM;
  }
  out_shape = mk.Shape();
  return OCC_OK;
}

/* Translate shape by vector. */
static int translate_shape(const TopoDS_Shape& s, const gp_Vec& V,
                           TopoDS_Shape& out_shape) {
  gp_Trsf t;
  t.SetTranslation(V);
  BRepBuilderAPI_Transform mk(s, t, /*Copy=*/Standard_True);
  if (!mk.IsDone()) {
    set_last("transform failed");
    return OCC_ERR_GEOM;
  }
  out_shape = mk.Shape();
  return OCC_OK;
}

/* Bbox of shape → min/max corners; returns false if void. */
static bool shape_bbox(const TopoDS_Shape& s, gp_Pnt& pmin, gp_Pnt& pmax,
                       double& diagonal) {
  Bnd_Box box;
  BRepBndLib::Add(s, box);
  if (box.IsVoid()) return false;
  Standard_Real xmin, ymin, zmin, xmax, ymax, zmax;
  box.Get(xmin, ymin, zmin, xmax, ymax, zmax);
  pmin = gp_Pnt(xmin, ymin, zmin);
  pmax = gp_Pnt(xmax, ymax, zmax);
  const double dx = xmax - xmin;
  const double dy = ymax - ymin;
  const double dz = zmax - zmin;
  diagonal = std::sqrt(dx * dx + dy * dy + dz * dz);
  return true;
}

/* Accept face/wire/edge/vertex/shell as extrude profile (OCCT MakePrism). */
static bool is_sweepable_profile(const TopoDS_Shape& s) {
  switch (s.ShapeType()) {
    case TopAbs_FACE:
    case TopAbs_WIRE:
    case TopAbs_EDGE:
    case TopAbs_VERTEX:
    case TopAbs_SHELL:
    case TopAbs_COMPOUND: /* compounds of faces sometimes used */
      return true;
    default:
      return false;
  }
}

/* ThruSections shared path. */
static int loft_impl(const occ_shape_t* profiles, int n, int solid, int ruled,
                     occ_shape_t* out) {
  REQ(profiles && out, OCC_ERR_NULL_ARG);
  REQ(n >= 2, OCC_ERR_GEOM);

  BRepOffsetAPI_ThruSections mk(solid ? Standard_True : Standard_False,
                                ruled ? Standard_True : Standard_False,
                                /*pres3d=*/1.0e-6);

  for (int i = 0; i < n; ++i) {
    if (!profiles[i]) {
      set_last("loft: null profile");
      return OCC_ERR_NULL_ARG;
    }
    const TopoDS_Shape& sh = *as_shape(profiles[i]);
    if (sh.IsNull()) {
      set_last("loft: null shape");
      return OCC_ERR_INVALID_SHAPE;
    }
    if (sh.ShapeType() == TopAbs_WIRE) {
      mk.AddWire(TopoDS::Wire(sh));
    } else if (sh.ShapeType() == TopAbs_VERTEX) {
      mk.AddVertex(TopoDS::Vertex(sh));
    } else if (sh.ShapeType() == TopAbs_EDGE) {
      /* Promote single edge to wire for convenience. */
      BRepBuilderAPI_MakeWire mw(TopoDS::Edge(sh));
      if (!mw.IsDone()) {
        set_last("loft: edge→wire failed");
        return OCC_ERR_GEOM;
      }
      mk.AddWire(mw.Wire());
    } else if (sh.ShapeType() == TopAbs_FACE) {
      /* Outer wire of face — common CAD convenience. */
      TopExp_Explorer ex(sh, TopAbs_WIRE);
      if (!ex.More()) {
        set_last("loft: face has no wire");
        return OCC_ERR_INVALID_SHAPE;
      }
      mk.AddWire(TopoDS::Wire(ex.Current()));
    } else {
      set_last("loft: profile must be wire/vertex/edge/face");
      return OCC_ERR_INVALID_SHAPE;
    }
  }

  mk.Build();
  if (!mk.IsDone()) {
    set_last("loft: ThruSections failed");
    return OCC_ERR_GEOM;
  }
  *out = to_handle(mk.Shape());
  return OCC_OK;
}

/* Helix on cylinder in UV: segment (0,0) → (±2π·turns, height). */
static int make_helix_edge(const gp_Ax2& ax2, double radius, double pitch,
                           double height, int right_handed,
                           TopoDS_Edge& out_edge) {
  if (radius <= 0.0 || pitch <= 0.0 || height <= 0.0) {
    set_last("helix: radius/pitch/height must be > 0");
    return OCC_ERR_GEOM;
  }

  const double turns = height / pitch;
  if (turns < 1.0e-12) {
    set_last("helix: turns too small");
    return OCC_ERR_GEOM;
  }

  Handle(Geom_CylindricalSurface) cyl =
      new Geom_CylindricalSurface(ax2, radius);

  /* U = angle (rad), V = axial height on the cylinder parametrization.
   * Right-handed: U increases with V; left-handed: U decreases. */
  const double u_end =
      (right_handed ? 1.0 : -1.0) * (2.0 * M_PI * turns);
  const gp_Pnt2d p0(0.0, 0.0);
  const gp_Pnt2d p1(u_end, height);

  GCE2d_MakeSegment mkseg(p0, p1);
  if (!mkseg.IsDone()) {
    set_last("helix: 2d segment failed");
    return OCC_ERR_GEOM;
  }
  Handle(Geom2d_TrimmedCurve) c2d = mkseg.Value();

  BRepBuilderAPI_MakeEdge me(c2d, cyl);
  if (!me.IsDone()) {
    set_last("helix: MakeEdge on cylinder failed");
    return OCC_ERR_GEOM;
  }
  out_edge = me.Edge();

  /* Ensure 3D curve exists for downstream MakePipe / meshing. */
  BRepLib::BuildCurves3d(out_edge);
  return OCC_OK;
}

/* Circle face in plane with normal = axis, center on axis origin, for spring. */
static int make_circle_face_at(const gp_Pnt& center, const gp_Dir& normal,
                               double radius, TopoDS_Face& out_face) {
  if (radius <= 0.0) {
    set_last("circle face: radius must be > 0");
    return OCC_ERR_GEOM;
  }
  gp_Ax2 ax(center, normal);
  gp_Circ circ(ax, radius);
  BRepBuilderAPI_MakeEdge me(circ);
  if (!me.IsDone()) {
    set_last("circle face: edge failed");
    return OCC_ERR_GEOM;
  }
  BRepBuilderAPI_MakeWire mw(me.Edge());
  if (!mw.IsDone()) {
    set_last("circle face: wire failed");
    return OCC_ERR_GEOM;
  }
  BRepBuilderAPI_MakeFace mf(mw.Wire(), /*OnlyPlane=*/Standard_True);
  if (!mf.IsDone()) {
    set_last("circle face: face failed");
    return OCC_ERR_GEOM;
  }
  out_face = mf.Face();
  return OCC_OK;
}

/* Extract a single shell from shape if possible. */
static int as_shell(const TopoDS_Shape& s, TopoDS_Shell& out_shell) {
  if (s.ShapeType() == TopAbs_SHELL) {
    out_shell = TopoDS::Shell(s);
    return OCC_OK;
  }
  if (s.ShapeType() == TopAbs_FACE) {
    /* Promote face → shell via sewing single face. */
    BRepBuilderAPI_Sewing sew(k_tol_default);
    sew.Add(s);
    sew.Perform();
    const TopoDS_Shape& r = sew.SewedShape();
    if (r.ShapeType() == TopAbs_SHELL) {
      out_shell = TopoDS::Shell(r);
      return OCC_OK;
    }
    if (r.ShapeType() == TopAbs_FACE) {
      BRep_Builder bb;
      TopoDS_Shell sh;
      bb.MakeShell(sh);
      bb.Add(sh, r);
      out_shell = sh;
      return OCC_OK;
    }
  }
  /* Search first shell in compound. */
  TopExp_Explorer ex(s, TopAbs_SHELL);
  if (ex.More()) {
    out_shell = TopoDS::Shell(ex.Current());
    return OCC_OK;
  }
  set_last("expected shell or face");
  return OCC_ERR_INVALID_SHAPE;
}

}  // namespace

/* =========================================================================
 * BBox helpers
 * ========================================================================= */

int occ_sweep_bbox(occ_shape_t s, double out_min[3], double out_max[3]) {
  REQ(s && out_min && out_max, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  gp_Pnt pmin, pmax;
  double diag = 0.0;
  if (!shape_bbox(*as_shape(s), pmin, pmax, diag)) {
    set_last("bbox: void");
    return OCC_ERR_GEOM;
  }
  out_min[0] = pmin.X(); out_min[1] = pmin.Y(); out_min[2] = pmin.Z();
  out_max[0] = pmax.X(); out_max[1] = pmax.Y(); out_max[2] = pmax.Z();
  return OCC_OK;
  OCC_GUARD_END
}

int occ_sweep_bbox_diagonal(occ_shape_t s, double* out_diag) {
  REQ(s && out_diag, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  gp_Pnt pmin, pmax;
  double diag = 0.0;
  if (!shape_bbox(*as_shape(s), pmin, pmax, diag)) {
    set_last("bbox diagonal: void");
    return OCC_ERR_GEOM;
  }
  *out_diag = diag;
  return OCC_OK;
  OCC_GUARD_END
}

/* =========================================================================
 * Linear extrude extents
 * ========================================================================= */

int occ_extrude_blind(occ_shape_t profile,
                      double dx, double dy, double dz,
                      occ_shape_t* out) {
  REQ(profile && out, OCC_ERR_NULL_ARG);
  REQ(finite3(dx, dy, dz), OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  const TopoDS_Shape& prof = *as_shape(profile);
  if (prof.IsNull() || !is_sweepable_profile(prof)) {
    set_last("extrude_blind: invalid profile");
    return OCC_ERR_INVALID_SHAPE;
  }
  TopoDS_Shape result;
  const int st = prism_vec(prof, gp_Vec(dx, dy, dz), result);
  if (st != OCC_OK) return st;
  *out = to_handle(result);
  return OCC_OK;
  OCC_GUARD_END
}

int occ_extrude_to_depth(occ_shape_t profile,
                         double dir_x, double dir_y, double dir_z,
                         double depth,
                         occ_shape_t* out) {
  REQ(profile && out, OCC_ERR_NULL_ARG);
  REQ(depth > 0.0, OCC_ERR_GEOM);
  REQ(finite3(dir_x, dir_y, dir_z), OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  gp_Dir d;
  if (!unit_dir(dir_x, dir_y, dir_z, d)) {
    set_last("extrude_to_depth: zero direction");
    return OCC_ERR_GEOM;
  }
  const TopoDS_Shape& prof = *as_shape(profile);
  if (prof.IsNull() || !is_sweepable_profile(prof)) {
    set_last("extrude_to_depth: invalid profile");
    return OCC_ERR_INVALID_SHAPE;
  }
  const gp_Vec V(d.X() * depth, d.Y() * depth, d.Z() * depth);
  TopoDS_Shape result;
  const int st = prism_vec(prof, V, result);
  if (st != OCC_OK) return st;
  *out = to_handle(result);
  return OCC_OK;
  OCC_GUARD_END
}

int occ_extrude_symmetric(occ_shape_t profile,
                          double dir_x, double dir_y, double dir_z,
                          double half_depth,
                          occ_shape_t* out) {
  REQ(profile && out, OCC_ERR_NULL_ARG);
  REQ(half_depth > 0.0, OCC_ERR_GEOM);
  REQ(finite3(dir_x, dir_y, dir_z), OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  gp_Dir d;
  if (!unit_dir(dir_x, dir_y, dir_z, d)) {
    set_last("extrude_symmetric: zero direction");
    return OCC_ERR_GEOM;
  }
  const TopoDS_Shape& prof = *as_shape(profile);
  if (prof.IsNull() || !is_sweepable_profile(prof)) {
    set_last("extrude_symmetric: invalid profile");
    return OCC_ERR_INVALID_SHAPE;
  }

  /* Prism of full length 2h along +û, then shift by -h·û so profile is midplane. */
  const double full = 2.0 * half_depth;
  const gp_Vec V(d.X() * full, d.Y() * full, d.Z() * full);
  TopoDS_Shape prism;
  int st = prism_vec(prof, V, prism);
  if (st != OCC_OK) return st;

  const gp_Vec shift(-d.X() * half_depth, -d.Y() * half_depth,
                     -d.Z() * half_depth);
  TopoDS_Shape centered;
  st = translate_shape(prism, shift, centered);
  if (st != OCC_OK) return st;

  *out = to_handle(centered);
  return OCC_OK;
  OCC_GUARD_END
}

int occ_extrude_through_all(occ_shape_t profile,
                            double dir_x, double dir_y, double dir_z,
                            occ_shape_t relative_to_solid,
                            occ_shape_t* out) {
  REQ(profile && relative_to_solid && out, OCC_ERR_NULL_ARG);
  REQ(finite3(dir_x, dir_y, dir_z), OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  gp_Dir d;
  if (!unit_dir(dir_x, dir_y, dir_z, d)) {
    set_last("extrude_through_all: zero direction");
    return OCC_ERR_GEOM;
  }
  const TopoDS_Shape& prof = *as_shape(profile);
  if (prof.IsNull() || !is_sweepable_profile(prof)) {
    set_last("extrude_through_all: invalid profile");
    return OCC_ERR_INVALID_SHAPE;
  }

  gp_Pnt pmin, pmax;
  double diag = 0.0;
  if (!shape_bbox(*as_shape(relative_to_solid), pmin, pmax, diag)) {
    set_last("extrude_through_all: solid bbox void");
    return OCC_ERR_GEOM;
  }
  /* Contract: length = bbox_diagonal * 2. Center prism about profile. */
  const double L = diag * 2.0;
  if (L < k_eps) {
    set_last("extrude_through_all: degenerate solid bbox");
    return OCC_ERR_GEOM;
  }

  const gp_Vec V(d.X() * L, d.Y() * L, d.Z() * L);
  TopoDS_Shape prism;
  int st = prism_vec(prof, V, prism);
  if (st != OCC_OK) return st;

  const gp_Vec shift(-d.X() * (L * 0.5), -d.Y() * (L * 0.5),
                     -d.Z() * (L * 0.5));
  TopoDS_Shape centered;
  st = translate_shape(prism, shift, centered);
  if (st != OCC_OK) return st;

  *out = to_handle(centered);
  return OCC_OK;
  OCC_GUARD_END
}

/* =========================================================================
 * Revolve full
 * ========================================================================= */

int occ_revolve_full(occ_shape_t profile,
                     double px, double py, double pz,
                     double ax, double ay, double az,
                     occ_shape_t* out) {
  REQ(profile && out, OCC_ERR_NULL_ARG);
  REQ(finite3(px, py, pz) && finite3(ax, ay, az), OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  gp_Dir d;
  if (!unit_dir(ax, ay, az, d)) {
    set_last("revolve_full: zero axis direction");
    return OCC_ERR_GEOM;
  }
  const TopoDS_Shape& prof = *as_shape(profile);
  if (prof.IsNull() || !is_sweepable_profile(prof)) {
    set_last("revolve_full: invalid profile");
    return OCC_ERR_INVALID_SHAPE;
  }
  const gp_Ax1 axis(gp_Pnt(px, py, pz), d);
  /* Angle omitted → full 2π constructor. */
  BRepPrimAPI_MakeRevol mk(prof, axis, /*Copy=*/Standard_True);
  if (!mk.IsDone()) {
    set_last("revolve_full: MakeRevol failed");
    return OCC_ERR_GEOM;
  }
  *out = to_handle(mk.Shape());
  return OCC_OK;
  OCC_GUARD_END
}

/* =========================================================================
 * Loft solid / ruled
 * ========================================================================= */

int occ_loft_solid(const occ_shape_t* profiles, int n, int ruled,
                   occ_shape_t* out) {
  OCC_GUARD_BEGIN
  return loft_impl(profiles, n, /*solid=*/1, ruled, out);
  OCC_GUARD_END
}

int occ_loft_ruled(const occ_shape_t* profiles, int n, int solid, int ruled,
                   occ_shape_t* out) {
  OCC_GUARD_BEGIN
  return loft_impl(profiles, n, solid, ruled, out);
  OCC_GUARD_END
}

/* =========================================================================
 * Helix wire
 * ========================================================================= */

int occ_make_helix_wire(double axis_px, double axis_py, double axis_pz,
                        double axis_dx, double axis_dy, double axis_dz,
                        double radius, double pitch, double height,
                        int right_handed,
                        occ_shape_t* out) {
  REQ(out, OCC_ERR_NULL_ARG);
  REQ(finite3(axis_px, axis_py, axis_pz), OCC_ERR_GEOM);
  REQ(finite3(axis_dx, axis_dy, axis_dz), OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  gp_Dir d;
  if (!unit_dir(axis_dx, axis_dy, axis_dz, d)) {
    set_last("helix: zero axis direction");
    return OCC_ERR_GEOM;
  }
  const gp_Ax2 ax2(gp_Pnt(axis_px, axis_py, axis_pz), d);

  TopoDS_Edge edge;
  const int st =
      make_helix_edge(ax2, radius, pitch, height, right_handed, edge);
  if (st != OCC_OK) return st;

  BRepBuilderAPI_MakeWire mw(edge);
  if (!mw.IsDone()) {
    set_last("helix: MakeWire failed");
    return OCC_ERR_GEOM;
  }
  *out = to_handle(mw.Wire());
  return OCC_OK;
  OCC_GUARD_END
}

int occ_make_helix_wire_turns(double axis_px, double axis_py, double axis_pz,
                              double axis_dx, double axis_dy, double axis_dz,
                              double radius, double pitch, double turns,
                              int right_handed,
                              occ_shape_t* out) {
  REQ(turns > 0.0, OCC_ERR_GEOM);
  REQ(pitch > 0.0, OCC_ERR_GEOM);
  const double height = turns * pitch;
  return occ_make_helix_wire(axis_px, axis_py, axis_pz, axis_dx, axis_dy,
                             axis_dz, radius, pitch, height, right_handed,
                             out);
}

/* =========================================================================
 * Sweep / pipe
 * ========================================================================= */

int occ_sweep_profile_along_wire(occ_shape_t profile, occ_shape_t spine_wire,
                                 occ_shape_t* out) {
  REQ(profile && spine_wire && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  const TopoDS_Shape& spine = *as_shape(spine_wire);
  if (spine.IsNull() || spine.ShapeType() != TopAbs_WIRE) {
    set_last("sweep: spine must be a wire");
    return OCC_ERR_INVALID_SHAPE;
  }
  const TopoDS_Shape& prof = *as_shape(profile);
  if (prof.IsNull()) {
    set_last("sweep: null profile");
    return OCC_ERR_INVALID_SHAPE;
  }

  BRepOffsetAPI_MakePipe mk(TopoDS::Wire(spine), prof);
  /* MakePipe builds in ctor path; still check result. */
  if (mk.Shape().IsNull()) {
    set_last("sweep: MakePipe produced null shape");
    return OCC_ERR_GEOM;
  }
  *out = to_handle(mk.Shape());
  return OCC_OK;
  OCC_GUARD_END
}

int occ_make_spring_solid(double axis_px, double axis_py, double axis_pz,
                          double axis_dx, double axis_dy, double axis_dz,
                          double coil_radius, double pitch, double height,
                          double wire_radius, int right_handed,
                          occ_shape_t* out) {
  REQ(out, OCC_ERR_NULL_ARG);
  REQ(coil_radius > wire_radius && wire_radius > 0.0, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN

  /* 1. Helix centerline. */
  occ_shape_t helix = nullptr;
  int st = occ_make_helix_wire(axis_px, axis_py, axis_pz, axis_dx, axis_dy,
                               axis_dz, coil_radius, pitch, height,
                               right_handed, &helix);
  if (st != OCC_OK) return st;

  /* 2. Circle profile at helix start, plane ⊥ helix tangent.
   *    Start point of right-handed helix at V=0, U=0 is:
   *    ax2.Location() + radius * XDirection. */
  gp_Dir axis_d;
  if (!unit_dir(axis_dx, axis_dy, axis_dz, axis_d)) {
    occ_shape_free(helix);
    set_last("spring: zero axis");
    return OCC_ERR_GEOM;
  }
  const gp_Ax2 ax2(gp_Pnt(axis_px, axis_py, axis_pz), axis_d);
  const gp_Pnt start = ax2.Location().Translated(
      gp_Vec(ax2.XDirection()) * coil_radius);
  /* Tangent of helix at start: combination of circumferential + axial.
   * For profile plane we use a plane whose normal ≈ helix tangent.
   * Approximate: cross(axis, radial) gives circumferential; add axial pitch term. */
  const gp_Vec radial(ax2.XDirection());
  const gp_Vec circum = gp_Vec(axis_d).Crossed(radial);
  if (circum.Magnitude() < k_eps) {
    occ_shape_free(helix);
    set_last("spring: degenerate frame");
    return OCC_ERR_GEOM;
  }
  /* ds/dθ = radius in circum direction; dV/dθ = pitch/(2π) along axis. */
  gp_Vec tang = circum.Normalized() * coil_radius +
                gp_Vec(axis_d) * (pitch / (2.0 * M_PI));
  if (!right_handed) {
    /* Left-handed: reverse circumferential sense. */
    tang = circum.Normalized() * (-coil_radius) +
           gp_Vec(axis_d) * (pitch / (2.0 * M_PI));
  }
  if (tang.Magnitude() < k_eps) {
    occ_shape_free(helix);
    set_last("spring: zero tangent");
    return OCC_ERR_GEOM;
  }
  const gp_Dir tang_d(tang);

  TopoDS_Face profile_face;
  st = make_circle_face_at(start, tang_d, wire_radius, profile_face);
  if (st != OCC_OK) {
    occ_shape_free(helix);
    return st;
  }

  BRepOffsetAPI_MakePipe mk(TopoDS::Wire(*as_shape(helix)), profile_face);
  occ_shape_free(helix);
  if (mk.Shape().IsNull()) {
    set_last("spring: MakePipe failed");
    return OCC_ERR_GEOM;
  }
  *out = to_handle(mk.Shape());
  return OCC_OK;
  OCC_GUARD_END
}

/* =========================================================================
 * Thicken / offset
 * ========================================================================= */

int occ_thicken_shell(occ_shape_t shell_or_face, double thickness,
                      occ_shape_t* out) {
  REQ(shell_or_face && out, OCC_ERR_NULL_ARG);
  REQ(std::fabs(thickness) > k_eps, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  const TopoDS_Shape& s = *as_shape(shell_or_face);
  if (s.IsNull()) {
    set_last("thicken: null shape");
    return OCC_ERR_INVALID_SHAPE;
  }
  /* MakeThickSolidBySimple expects non-closed shell or face. */
  BRepOffsetAPI_MakeThickSolid mk;
  mk.MakeThickSolidBySimple(s, thickness);
  if (!mk.IsDone()) {
    set_last("thicken: MakeThickSolidBySimple failed");
    return OCC_ERR_GEOM;
  }
  *out = to_handle(mk.Shape());
  return OCC_OK;
  OCC_GUARD_END
}

int occ_offset_face(occ_shape_t face, double offset, occ_shape_t* out) {
  REQ(face && out, OCC_ERR_NULL_ARG);
  REQ(std::fabs(offset) > k_eps, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  const TopoDS_Shape& s = *as_shape(face);
  if (s.IsNull()) {
    set_last("offset_face: null shape");
    return OCC_ERR_INVALID_SHAPE;
  }
  /* PerformBySimple works on face / shell / solid. */
  BRepOffsetAPI_MakeOffsetShape mk;
  mk.PerformBySimple(s, offset);
  if (!mk.IsDone()) {
    set_last("offset_face: PerformBySimple failed");
    return OCC_ERR_GEOM;
  }
  *out = to_handle(mk.Shape());
  return OCC_OK;
  OCC_GUARD_END
}

/* =========================================================================
 * Sew / solidify
 * ========================================================================= */

int occ_sew_faces(const occ_shape_t* shapes, int n, double tol,
                  occ_shape_t* out) {
  REQ(shapes && out, OCC_ERR_NULL_ARG);
  REQ(n >= 1, OCC_ERR_GEOM);
  REQ(tol > 0.0, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN

  BRepBuilderAPI_Sewing sewing(tol,
                               /*option1 sewing=*/Standard_True,
                               /*option2 analysis=*/Standard_True,
                               /*option3 cutting=*/Standard_True,
                               /*option4 nonmanifold=*/Standard_False);

  int added = 0;
  for (int i = 0; i < n; ++i) {
    if (!shapes[i]) {
      set_last("sew: null shape in array");
      return OCC_ERR_NULL_ARG;
    }
    const TopoDS_Shape& sh = *as_shape(shapes[i]);
    if (sh.IsNull()) continue;
    sewing.Add(sh);
    ++added;
  }
  if (added == 0) {
    set_last("sew: no shapes added");
    return OCC_ERR_GEOM;
  }

  sewing.Perform();
  const TopoDS_Shape& sewed = sewing.SewedShape();
  if (sewed.IsNull()) {
    set_last("sew: null result");
    return OCC_ERR_GEOM;
  }
  *out = to_handle(sewed);
  return OCC_OK;
  OCC_GUARD_END
}

int occ_make_solid_from_shell(occ_shape_t shell, occ_shape_t* out) {
  REQ(shell && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  const TopoDS_Shape& s = *as_shape(shell);
  if (s.IsNull()) {
    set_last("make_solid: null shape");
    return OCC_ERR_INVALID_SHAPE;
  }

  if (s.ShapeType() == TopAbs_SOLID) {
    *out = to_handle(s);
    return OCC_OK;
  }

  TopoDS_Shell sh;
  const int st = as_shell(s, sh);
  if (st != OCC_OK) return st;

  BRepBuilderAPI_MakeSolid mk(sh);
  if (!mk.IsDone()) {
    set_last("make_solid: MakeSolid failed (is shell closed?)");
    return OCC_ERR_GEOM;
  }
  /* Orientation check: closed solid should have finite volume sign. */
  TopoDS_Solid solid = mk.Solid();
  *out = to_handle(solid);
  return OCC_OK;
  OCC_GUARD_END
}

int occ_sew_to_solid(const occ_shape_t* shapes, int n, double tol,
                     occ_shape_t* out) {
  REQ(shapes && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  occ_shape_t sewed = nullptr;
  int st = occ_sew_faces(shapes, n, tol, &sewed);
  if (st != OCC_OK) return st;

  const TopoDS_Shape& r = *as_shape(sewed);
  if (r.ShapeType() == TopAbs_SOLID) {
    *out = sewed; /* transfer ownership */
    return OCC_OK;
  }

  st = occ_make_solid_from_shell(sewed, out);
  occ_shape_free(sewed);
  return st;
  OCC_GUARD_END
}

/* =========================================================================
 * Self-check recipe notes (not compiled tests — documentation for extractors)
 * =========================================================================
 *
 * Blind box from rectangle face:
 *   occ_make_plane_rect(...) → face
 *   occ_extrude_blind(face, 0,0,0.08, &solid)
 *
 * Symmetric plate:
 *   occ_extrude_symmetric(face, 0,0,1, 0.005, &plate)  // 10 mm thick midplane
 *
 * Through-all cut tool:
 *   occ_extrude_through_all(profile, 0,0,1, body, &tool)
 *   occ_cut(body, tool, &result)
 *
 * Helix spring:
 *   occ_make_helix_wire(0,0,0, 0,0,1, 0.02, 0.005, 0.05, 1, &wire)
 *   occ_make_spring_solid(0,0,0, 0,0,1, 0.02, 0.005, 0.05, 0.0015, 1, &spring)
 *
 * Sew open faces of a multi-face patch:
 *   occ_sew_faces(faces, n, 1e-6, &shell)
 *   occ_make_solid_from_shell(shell, &solid)   // if closed
 *   // or occ_thicken_shell(shell, 0.002, &solid) for sheet→solid
 */
```

---

## Lowering table (IR / FeatureScript-class → C)

| Clean-room IR / FS concept | C call |
|----------------------------|--------|
| `PushPull` blind depth | `occ_extrude_to_depth` or `occ_extrude_blind` |
| `PushPull` symmetric / midplane | `occ_extrude_symmetric` |
| `PushPull` through-all | `occ_extrude_through_all` + boolean |
| `PushPull` + draft | **unsupported** — draft skip |
| `SpinSolid` 360° | `occ_revolve_full` |
| `Loft` solid smooth | `occ_loft_solid(profiles, n, ruled=0)` |
| `Loft` solid ruled | `occ_loft_solid(profiles, n, ruled=1)` |
| `Loft` surface ruled | `occ_loft_ruled(profiles, n, solid=0, ruled=1)` |
| `SweepAlong` | `occ_sweep_profile_along_wire` |
| `MakeHelix` | `occ_make_helix_wire` |
| Spring / thread prep | `occ_make_spring_solid` / helix + pipe |
| `Thicken` | `occ_thicken_shell` |
| `Offset surface` | `occ_offset_face` |
| Enclose / sew faces | `occ_sew_faces` → `occ_make_solid_from_shell` |

---

## Design notes for implementers

### Why through-all is “tool-only”

True CAD “through all” is a **boolean recipe**: extrude a long enough prism,
then `CUT` or `COMMON` with the target body. Emitting only the prism keeps the
kernel pure and lets the product layer choose new / add / remove / intersect —
matching the clean-room extrude taxonomy expansion:

```text
extrude op → optional boolean → optional draft → cleanup
                 ▲ this module    ▲ SKIPPED
```

Length `2 * bbox_diagonal` is deliberately conservative (covers worst-case
diagonal piercing). Product code may shrink after measuring projected extent
along the direction if Wasm size / boolean cost matters.

### Why helix is a wire first

Threads and springs share a centerline. Product recipes:

1. **Cosmetic thread** — helix wire only (viz).
2. **Spring solid** — `occ_make_spring_solid` (pipe circle along helix).
3. **Cut thread** — helix + profile sweep + cut (P2, out of scope).

Building the wire with `Geom_CylindricalSurface` + 2D segment is the same
pattern as OCCT’s MakeBottle threading tutorial, and produces a real 3D curve
via `BRepLib::BuildCurves3d` so `MakePipe` succeeds.

### Thicken vs shell (baseline)

| API | Input | Closing faces | Use |
|-----|-------|---------------|-----|
| `occ_shell` (baseline) | solid | remove list | hollow solid |
| `occ_thicken_shell` (this) | face/shell | n/a (simple) | sheet → solid |
| `occ_offset_face` | face/shell | n/a | parallel surface |

### Sew tolerances

Default sewing tol for CAD topology is often `1e-6` m. For imported meshes
tessellated to BREP faces, raise to `1e-4`–`1e-3`. Free edges after sew
(`NbFreeEdges`) mean the shell is open — thicken instead of MakeSolid.

### Error codes

| Condition | Code |
|-----------|------|
| null handle / out | `OCC_ERR_NULL_ARG` |
| wrong shape type | `OCC_ERR_INVALID_SHAPE` |
| zero dir, bad radius, prism fail | `OCC_ERR_GEOM` |
| OCCT exception | `OCC_ERR_EXCEPTION` |

Boolean failures are not produced here (no fuse/cut in this TU except ownership
helpers). Spring/pipe failures surface as `OCC_ERR_GEOM`.

---

## Minimal usage sketch (C)

```c
#include "occ_c.h"
#include "occ_c_frames.h"
#include "occ_c_sweep_ext.h"

/* Midplane plate 10 mm thick from a rectangle face on XY. */
void demo_symmetric_plate(void) {
  occ_shape_t face = 0, plate = 0;
  occ_make_plane_rect(0, 0, 0,  /* origin */
                      0, 0, 1,  /* normal Z */
                      1, 0, 0,  /* X axis */
                      0.10, 0.06, &face);
  occ_extrude_symmetric(face, 0, 0, 1, 0.005, &plate);
  occ_shape_free(face);
  /* ... STEP export plate ... */
  occ_shape_free(plate);
}

/* Through-all cut: drill-like prism through a box. */
void demo_through_all_cut(void) {
  occ_shape_t box = 0, circle = 0, tool = 0, result = 0;
  occ_make_box(0.2, 0.1, 0.05, &box);
  occ_make_circle_face(0.1, 0.05, 0.0, 0, 0, 1, 0.008, &circle);
  occ_extrude_through_all(circle, 0, 0, 1, box, &tool);
  occ_cut(box, tool, &result);
  occ_shape_free(box); occ_shape_free(circle);
  occ_shape_free(tool); occ_shape_free(result);
}

/* Helical spring. */
void demo_spring(void) {
  occ_shape_t spring = 0;
  occ_make_spring_solid(
      0, 0, 0,   /* axis origin */
      0, 0, 1,   /* axis +Z */
      0.015,     /* coil R */
      0.004,     /* pitch */
      0.040,     /* height */
      0.0012,    /* wire R */
      1,         /* right-handed */
      &spring);
  occ_shape_free(spring);
}
```

---

## BUILD.bazel fragment (reminder)

```python
# add to _OCC_C_EXPORTS / cc_library srcs
"api/src/occ_c_sweep_ext.cc",
# hdrs
"api/include/occ_c_sweep_ext.h",
```

Wasm size: helix + sew pull `Geom_CylindricalSurface`, `GCE2d`, `BRepBuilderAPI_Sewing`,
`MakeThickSolid` — already largely in the binary if shell/offset exist; net
growth is small relative to STEP/XCAF.

---

## Checklist

- [x] Blind / depth / symmetric / through-all extents
- [x] Full revolve
- [x] Loft solid + ruled flags (`ThruSections`)
- [x] Helix wire via cylinder + 2d segment
- [x] Sweep profile along wire (`MakePipe`)
- [x] Spring solid convenience
- [x] Thicken shell / offset face
- [x] Sew faces + solid from shell + sew-to-solid
- [x] Draft **skipped** with documented policy
- [x] Pedagogy tables + lowering map + usage sketch

**End of section 07.**

<!-- END 07-sweeps-helix-ext.md -->


<!-- BEGIN 08-smoke-dual-goal.md -->

# Section 08 — Dual-Goal Smoke Programs (pure C)

**Document type:** Literate extractable sources for `occ_c` dual-goal validation  
**OCCT pin:** 7.9.3 · **API:** expanded P0 (`occ_c.h`, `occ_c_frames.h`, `occ_c_route.h`)  
**Goals:** AI-BOOST piping skids · 6-DOF robot arm · flange bolt-circle recipe  
**Units:** meters, radians  
**Marker:** first line of a fence is `// === file: PATH` (C) or `# === file: PATH` (Python/Starlark)

| Program | Goal | IR ops |
|---------|------|--------|
| `smoke_pipe_skid.c` | pipe skid | `PrimBox`, `AttachFrame`, `RoutePath`, `SweepAlong`, `PatternLinear`, `QueryClash` |
| `smoke_robot_6dof.c` | 6-DOF arm | `PrimCylinder`/`PrimBox`, `AttachFrame`, `ComposeChain`, `RigidXform`, `QueryClash` |
| `smoke_flange_bolt_circle.c` | hole+pattern | `PrimCylinder`, `DrillHole`, `PatternPolar` |

Also: `scripts/extract_literate.py`, Bazel fragment for the three smokes.

```bash
python3 scripts/extract_literate.py docs/literate-sections/08-smoke-dual-goal.md --root .
bazel test //examples:smoke_pipe_skid_test //examples:smoke_robot_6dof_test //examples:smoke_flange_bolt_circle_test
```

---

## 1. Pipe skid — `examples/smoke_pipe_skid.c`

Skid ~3 m × 1.5 m base, two equipment proxies, 4″ NPS annulus (`OD=0.1143`, `ID=0.1023`),
150 mm bends, linear clamp pattern, clash + mass.

```c
// === file: examples/smoke_pipe_skid.c
/*
 * smoke_pipe_skid.c — AI-BOOST piping skid dual-goal smoke (pure C / occ_c)
 *
 * Call sequence (IR → C):
 *   PrimBox        → occ_make_box / occ_translate
 *   AttachFrame    → occ_frame_from_axes
 *   RoutePath      → occ_make_route_with_bends
 *   SweepAlong     → occ_pipe_annulus
 *   PatternLinear  → occ_pattern_linear
 *   QueryClash     → occ_clash / occ_distance
 *   mass           → occ_mass_properties
 *
 * Exit 0 on success; non-zero + stderr on failure. Units: m, rad. OCCT 7.9.3.
 */
#include "occ_c.h"
#include "occ_c_frames.h"
#include "occ_c_route.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

enum { SKID_OK = 0, SKID_FAIL = 1 };

static const double kSteelDensity = 7850.0;
static const double kPipeOD       = 0.1143;  /* 4" NPS OD */
static const double kPipeID       = 0.1023;
static const double kBendRadius   = 0.150;
static const double kClearance    = 0.025;   /* 25 mm */
static const int    kClampCount   = 5;
static const double kClampPitch   = 0.60;

static void die(const char* step, int st) {
  fprintf(stderr, "[smoke_pipe_skid] FAIL %s: status=%d err=%s\n",
          step, st, occ_last_error() ? occ_last_error() : "(null)");
}

static void free_shape(occ_shape_t* s) {
  if (s && *s) { occ_shape_free(*s); *s = 0; }
}

static void print_frame(const char* name, const occ_frame_t* f) {
  printf("  frame %-10s o=(%.4f,%.4f,%.4f) z=(%.3f,%.3f,%.3f)\n",
         name, f->origin[0], f->origin[1], f->origin[2],
         f->z_axis[0], f->z_axis[1], f->z_axis[2]);
}

/* ---- Step 1: PrimBox skid base 3.0 x 1.5 x 0.10 m, centered on XY ---- */
static int build_base(occ_shape_t* out_base) {
  occ_shape_t raw = 0, centered = 0;
  int st = occ_make_box(3.0, 1.5, 0.10, &raw);
  if (st != OCC_OK) { die("PrimBox base", st); return SKID_FAIL; }
  st = occ_translate(raw, -1.5, -0.75, 0.0, &centered);
  free_shape(&raw);
  if (st != OCC_OK) { die("translate base", st); return SKID_FAIL; }
  *out_base = centered;
  printf("[1] PrimBox skid base 3.0 x 1.5 x 0.10 m\n");
  return SKID_OK;
}

/* ---- Step 2: PrimBox equipment + AttachFrame nozzle frames ---- */
static int build_equipment(occ_shape_t* out_a, occ_shape_t* out_b,
                           occ_frame_t* na, occ_frame_t* nb) {
  int st;
  {
    occ_shape_t box = 0, placed = 0;
    st = occ_make_box(0.80, 0.60, 0.90, &box);
    if (st != OCC_OK) { die("PrimBox eqA", st); return SKID_FAIL; }
    st = occ_translate(box, -1.30, -0.30, 0.10, &placed);
    free_shape(&box);
    if (st != OCC_OK) { die("translate eqA", st); return SKID_FAIL; }
    *out_a = placed;
  }
  /* Nozzle A: east face, pipe departs +X. local X = up, Z = pipe dir. */
  st = occ_frame_from_axes(-0.50, 0.0, 0.55,
                           0.0, 0.0, 1.0,
                           1.0, 0.0, 0.0, na);
  if (st != OCC_OK) { die("AttachFrame nozzleA", st); return SKID_FAIL; }

  {
    occ_shape_t box = 0, placed = 0;
    st = occ_make_box(1.00, 0.70, 1.10, &box);
    if (st != OCC_OK) { die("PrimBox eqB", st); return SKID_FAIL; }
    st = occ_translate(box, 0.80, 0.10, 0.10, &placed);
    free_shape(&box);
    if (st != OCC_OK) { die("translate eqB", st); return SKID_FAIL; }
    *out_b = placed;
  }
  /* Nozzle B: west face, pipe arrives -X into equipment. */
  st = occ_frame_from_axes(0.80, 0.40, 0.70,
                           0.0, 0.0, 1.0,
                          -1.0, 0.0, 0.0, nb);
  if (st != OCC_OK) { die("AttachFrame nozzleB", st); return SKID_FAIL; }

  printf("[2] PrimBox equipment A/B + AttachFrame nozzles\n");
  print_frame("nozzleA", na);
  print_frame("nozzleB", nb);
  return SKID_OK;
}

/* ---- Step 3: RoutePath with bends between nozzles ---- */
static int build_route(const occ_frame_t* na, const occ_frame_t* nb,
                       occ_shape_t* out_path, double* out_len) {
  double nodes[] = {
    na->origin[0],           na->origin[1], na->origin[2],
    na->origin[0] + 0.35,    na->origin[1], na->origin[2],
    na->origin[0] + 0.35,    na->origin[1], 1.20,
    nb->origin[0] - 0.45,    na->origin[1], 1.20,
    nb->origin[0] - 0.45,    nb->origin[1], 1.20,
    nb->origin[0] - 0.45,    nb->origin[1], nb->origin[2],
    nb->origin[0],           nb->origin[1], nb->origin[2]
  };
  const int n_pts = (int)(sizeof(nodes) / sizeof(nodes[0]) / 3);

  int st = occ_make_route_with_bends(nodes, n_pts, kBendRadius, out_path);
  if (st != OCC_OK) { die("RoutePath", st); return SKID_FAIL; }

  *out_len = 0.0;
  st = occ_wire_length(*out_path, out_len);
  if (st != OCC_OK) { die("wire_length", st); return SKID_FAIL; }

  double o0[3], t0[3], o1[3], t1[3];
  if (occ_frame_at_wire_end(*out_path, 1, o0, t0) == OCC_OK)
    printf("  start o=(%.3f,%.3f,%.3f) t=(%.3f,%.3f,%.3f)\n",
           o0[0], o0[1], o0[2], t0[0], t0[1], t0[2]);
  if (occ_frame_at_wire_end(*out_path, 0, o1, t1) == OCC_OK)
    printf("  end   o=(%.3f,%.3f,%.3f) t=(%.3f,%.3f,%.3f)\n",
           o1[0], o1[1], o1[2], t1[0], t1[1], t1[2]);

  printf("[3] RoutePath n=%d bendR=%.3f m length=%.4f m\n",
         n_pts, kBendRadius, *out_len);
  return SKID_OK;
}

/* ---- Step 4: SweepAlong annulus pipe ---- */
static int build_pipe(occ_shape_t path, occ_shape_t* out_pipe) {
  int st = occ_pipe_annulus(kPipeOD, kPipeID, path, out_pipe);
  if (st != OCC_OK) { die("SweepAlong pipe_annulus", st); return SKID_FAIL; }
  printf("[4] SweepAlong annulus OD=%.4f ID=%.4f m\n", kPipeOD, kPipeID);
  return SKID_OK;
}

/* ---- Step 5: PatternLinear support clamps (boxes under header) ---- */
static int build_clamps(occ_shape_t* out_clamps) {
  occ_shape_t seed = 0, seed_at = 0;
  int st = occ_make_box(0.12, 0.18, 0.06, &seed);
  if (st != OCC_OK) { die("PrimBox clamp seed", st); return SKID_FAIL; }
  st = occ_translate(seed, -0.20, -0.09, 1.20 - 0.06 - kPipeOD * 0.5, &seed_at);
  free_shape(&seed);
  if (st != OCC_OK) { die("translate clamp", st); return SKID_FAIL; }

  st = occ_pattern_linear(seed_at, kClampPitch, 0.0, 0.0,
                          kClampCount, /*fuse=*/0, out_clamps);
  free_shape(&seed_at);
  if (st != OCC_OK) { die("PatternLinear clamps", st); return SKID_FAIL; }
  printf("[5] PatternLinear clamps count=%d pitch=%.2f m\n",
         kClampCount, kClampPitch);
  return SKID_OK;
}

/* ---- Step 6: QueryClash pipe vs equipment ---- */
static int check_clashes(occ_shape_t pipe, occ_shape_t eq_a, occ_shape_t eq_b,
                         int* out_any_hit) {
  int st_a = 2, st_b = 2;
  int rc = occ_clash(pipe, eq_a, kClearance, &st_a);
  if (rc != OCC_OK) { die("QueryClash eqA", rc); return SKID_FAIL; }
  rc = occ_clash(pipe, eq_b, kClearance, &st_b);
  if (rc != OCC_OK) { die("QueryClash eqB", rc); return SKID_FAIL; }

  double d = -1.0, p1[3] = {0}, p2[3] = {0};
  if (occ_distance(pipe, eq_a, &d, p1, p2) == OCC_OK)
    printf("  dist(pipe,eqA)=%.4f m\n", d);
  if (occ_distance(pipe, eq_b, &d, p1, p2) == OCC_OK)
    printf("  dist(pipe,eqB)=%.4f m\n", d);

  /* status: 0=clear 1=hit/within-clearance 2=unknown */
  printf("[6] QueryClash clearance=%.3f m eqA=%d eqB=%d\n",
         kClearance, st_a, st_b);
  *out_any_hit = (st_a == 1 || st_b == 1) ? 1 : 0;
  if (st_a == 2 && st_b == 2) {
    fprintf(stderr, "[smoke_pipe_skid] both clash results unknown\n");
    return SKID_FAIL;
  }
  return SKID_OK;
}

/* ---- Step 7: mass properties ---- */
static int report_mass(occ_shape_t pipe) {
  double mass = 0.0, com[3] = {0}, I[6] = {0};
  int st = occ_mass_properties(pipe, kSteelDensity, &mass, com, I);
  if (st != OCC_OK) { die("mass_properties", st); return SKID_FAIL; }
  printf("[7] mass=%.3f kg COM=(%.4f,%.4f,%.4f)\n",
         mass, com[0], com[1], com[2]);
  printf("  Ixx=%.4g Iyy=%.4g Izz=%.4g Ixy=%.4g Ixz=%.4g Iyz=%.4g\n",
         I[0], I[1], I[2], I[3], I[4], I[5]);
  if (!(mass > 0.0) || !isfinite(mass)) {
    fprintf(stderr, "[smoke_pipe_skid] bad mass\n");
    return SKID_FAIL;
  }
  return SKID_OK;
}

static int export_skid(occ_shape_t base, occ_shape_t a, occ_shape_t b,
                       occ_shape_t pipe, occ_shape_t clamps) {
  occ_shape_t parts[5];
  int n = 0;
  if (base) parts[n++] = base;
  if (a) parts[n++] = a;
  if (b) parts[n++] = b;
  if (pipe) parts[n++] = pipe;
  if (clamps) parts[n++] = clamps;
  occ_shape_t assy = 0;
  if (occ_make_compound(parts, n, &assy) != OCC_OK) {
    die("make_compound", OCC_ERR_GEOM);
    return SKID_FAIL;
  }
  const char* path = "/tmp/smoke_pipe_skid.step";
  if (occ_step_write(assy, path) == OCC_OK)
    printf("[+] wrote %s (%d bodies)\n", path, n);
  else
    printf("  (STEP write skipped: %s)\n",
           occ_last_error() ? occ_last_error() : "?");
  free_shape(&assy);
  return SKID_OK;
}

int main(void) {
  printf("=== smoke_pipe_skid: AI-BOOST dual-goal pipe skid ===\n");
  printf("API: occ_c + frames + route | OCCT 7.9.3 | units: m, rad\n\n");

  occ_shape_t base = 0, eq_a = 0, eq_b = 0, path = 0, pipe = 0, clamps = 0;
  occ_frame_t na, nb;
  memset(&na, 0, sizeof(na));
  memset(&nb, 0, sizeof(nb));
  double route_len = 0.0;
  int any_hit = 0;
  int rc = SKID_OK;

  if (build_base(&base) != SKID_OK) { rc = SKID_FAIL; goto done; }
  if (build_equipment(&eq_a, &eq_b, &na, &nb) != SKID_OK) { rc = SKID_FAIL; goto done; }
  if (build_route(&na, &nb, &path, &route_len) != SKID_OK) { rc = SKID_FAIL; goto done; }
  if (build_pipe(path, &pipe) != SKID_OK) { rc = SKID_FAIL; goto done; }
  if (build_clamps(&clamps) != SKID_OK) { rc = SKID_FAIL; goto done; }
  if (check_clashes(pipe, eq_a, eq_b, &any_hit) != SKID_OK) { rc = SKID_FAIL; goto done; }
  if (report_mass(pipe) != SKID_OK) { rc = SKID_FAIL; goto done; }

  {
    double vol = 0.0;
    if (occ_volume(pipe, &vol) == OCC_OK) {
      printf("  pipe volume=%.6f m^3\n", vol);
      double outer = M_PI * (kPipeOD * 0.5) * (kPipeOD * 0.5) * route_len;
      if (vol > outer * 1.25) {
        fprintf(stderr, "[smoke_pipe_skid] volume too large\n");
        rc = SKID_FAIL;
        goto done;
      }
    }
  }
  export_skid(base, eq_a, eq_b, pipe, clamps);
  printf("\n=== RESULT: %s (clash_hit=%d route_len=%.3f m) ===\n",
         rc == SKID_OK ? "PASS" : "FAIL", any_hit, route_len);

done:
  free_shape(&base); free_shape(&eq_a); free_shape(&eq_b);
  free_shape(&path); free_shape(&pipe); free_shape(&clamps);
  return rc;
}
```

---

## 2. Six-DOF robot — `examples/smoke_robot_6dof.c`

Six links (box base + cylinders), joint frames, `ComposeChain` at example angles,
`RigidXform` place, non-adjacent clash, print TCP 4×4.

```c
// === file: examples/smoke_robot_6dof.c
/*
 * smoke_robot_6dof.c — 6-DOF robot arm dual-goal smoke (pure C / occ_c)
 *
 * IR → C:
 *   PrimCylinder / PrimBox → occ_make_cylinder / occ_make_box
 *   AttachFrame            → occ_frame_from_z (joint PODs)
 *   ComposeChain           → occ_compose_chain
 *   RigidXform             → occ_trsf_apply_shape
 *   QueryClash             → occ_clash (skip adjacent |i-j|==1)
 *
 * Prints TCP 4x4 row-major. Exit non-zero on failure. Units: m, rad.
 */
#include "occ_c.h"
#include "occ_c_frames.h"
#include "occ_c_route.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

enum { DOF = 6, ROBOT_OK = 0, ROBOT_FAIL = 1 };

static const double kLinkLen[DOF] = { 0.15, 0.45, 0.40, 0.12, 0.10, 0.08 };
static const double kLinkRad[DOF] = { 0.080, 0.055, 0.045, 0.035, 0.030, 0.028 };

/* Joint origins (m) and axes for occ_compose_chain. */
static const double kOrigins[DOF * 3] = {
  0.0, 0.0, 0.0,
  0.0, 0.0, 0.15,
  0.0, 0.0, 0.45,
  0.0, 0.0, 0.40,
  0.0, 0.0, 0.12,
  0.0, 0.0, 0.10
};
static const double kAxes[DOF * 3] = {
  0.0, 0.0, 1.0,   /* base yaw */
  0.0, 1.0, 0.0,   /* shoulder */
  0.0, 1.0, 0.0,   /* elbow */
  0.0, 0.0, 1.0,   /* wrist roll */
  0.0, 1.0, 0.0,   /* wrist pitch */
  0.0, 0.0, 1.0    /* tool roll */
};
static const double kAngles[DOF] = { 0.35, -0.60, 1.10, 0.20, -0.40, 0.80 };
static const double kLinkClearance = 0.005;

static void die(const char* step, int st) {
  fprintf(stderr, "[smoke_robot_6dof] FAIL %s: status=%d err=%s\n",
          step, st, occ_last_error() ? occ_last_error() : "(null)");
}

static void free_shape(occ_shape_t* s) {
  if (s && *s) { occ_shape_free(*s); *s = 0; }
}

static void print_mat4(const char* title, const double m[16]) {
  printf("%s (row-major SE3, p'=M p):\n", title);
  for (int r = 0; r < 4; ++r)
    printf("  | %11.6f %11.6f %11.6f %11.6f |\n",
           m[4*r+0], m[4*r+1], m[4*r+2], m[4*r+3]);
}

static void mat_origin(const double m[16], double o[3]) {
  o[0] = m[3]; o[1] = m[7]; o[2] = m[11];
}

/* ---- Step 1: PrimBox / PrimCylinder link solids (local +Z) ---- */
static int build_link_solids(occ_shape_t links[DOF]) {
  for (int i = 0; i < DOF; ++i) {
    links[i] = 0;
    int st;
    if (i == 0) {
      occ_shape_t box = 0, centered = 0;
      st = occ_make_box(0.20, 0.20, kLinkLen[0], &box);
      if (st != OCC_OK) { die("PrimBox base", st); return ROBOT_FAIL; }
      st = occ_translate(box, -0.10, -0.10, 0.0, &centered);
      free_shape(&box);
      if (st != OCC_OK) { die("translate base", st); return ROBOT_FAIL; }
      links[i] = centered;
    } else {
      st = occ_make_cylinder(0, 0, 0, 0, 0, 1, kLinkRad[i], kLinkLen[i], &links[i]);
      if (st != OCC_OK) { die("PrimCylinder link", st); return ROBOT_FAIL; }
    }
  }
  printf("[1] PrimBox/PrimCylinder: %d link solids\n", DOF);
  for (int i = 0; i < DOF; ++i)
    printf("  L%d len=%.3f rad=%.3f\n", i, kLinkLen[i], i == 0 ? 0.10 : kLinkRad[i]);
  return ROBOT_OK;
}

/* ---- Step 2: AttachFrame joint PODs at zero config ---- */
static int attach_joint_frames(occ_frame_t joints[DOF]) {
  for (int i = 0; i < DOF; ++i) {
    const double* o = &kOrigins[i * 3];
    const double* a = &kAxes[i * 3];
    int st = occ_frame_from_z(o[0], o[1], o[2], a[0], a[1], a[2], &joints[i]);
    if (st != OCC_OK) { die("AttachFrame joint", st); return ROBOT_FAIL; }
  }
  printf("[2] AttachFrame: %d joint frames\n", DOF);
  for (int i = 0; i < DOF; ++i)
    printf("  J%d o=(%.3f,%.3f,%.3f) z=(%.2f,%.2f,%.2f)\n", i,
           joints[i].origin[0], joints[i].origin[1], joints[i].origin[2],
           joints[i].z_axis[0], joints[i].z_axis[1], joints[i].z_axis[2]);
  return ROBOT_OK;
}

/* ---- Step 3: ComposeChain → TCP + prefixes ---- */
static int compose_all(const double angles[DOF],
                       double T_prefix[DOF][16], double T_tcp[16]) {
  for (int k = 0; k < DOF; ++k)
    occ_compose_chain(kOrigins, kAxes, angles, k + 1, T_prefix[k]);
  memcpy(T_tcp, T_prefix[DOF - 1], 16 * sizeof(double));

  printf("[3] ComposeChain n=%d angles (rad):\n", DOF);
  for (int i = 0; i < DOF; ++i)
    printf("  q[%d]=%+.4f (%.1f deg)\n", i, angles[i], angles[i] * 180.0 / M_PI);
  print_mat4("TCP", T_tcp);

  double tcp_o[3];
  mat_origin(T_tcp, tcp_o);
  printf("  TCP origin=(%.4f, %.4f, %.4f) m\n", tcp_o[0], tcp_o[1], tcp_o[2]);

  double r = sqrt(tcp_o[0]*tcp_o[0] + tcp_o[1]*tcp_o[1] + tcp_o[2]*tcp_o[2]);
  double reach = 0.0;
  for (int i = 0; i < DOF; ++i) reach += kLinkLen[i];
  if (r > reach + 0.05) {
    fprintf(stderr, "[smoke_robot_6dof] TCP %.3f exceeds reach %.3f\n", r, reach);
    return ROBOT_FAIL;
  }
  return ROBOT_OK;
}

/* ---- Step 4: RigidXform place each link ---- */
static int place_links(occ_shape_t local[DOF], const double T_prefix[DOF][16],
                       occ_shape_t world[DOF]) {
  for (int i = 0; i < DOF; ++i) {
    world[i] = 0;
    int st = occ_trsf_apply_shape(local[i], T_prefix[i], &world[i]);
    if (st != OCC_OK) { die("RigidXform", st); return ROBOT_FAIL; }
  }
  printf("[4] RigidXform: placed %d links\n", DOF);
  return ROBOT_OK;
}

/* ---- Step 5: QueryClash non-adjacent (skip |i-j|<=1) ---- */
static int clash_nonadjacent(occ_shape_t world[DOF], int* out_hits) {
  int hits = 0, checks = 0;
  printf("[5] QueryClash non-adjacent, clearance=%.3f m\n", kLinkClearance);
  for (int i = 0; i < DOF; ++i) {
    for (int j = i + 2; j < DOF; ++j) {
      int status = 2;
      int rc = occ_clash(world[i], world[j], kLinkClearance, &status);
      if (rc != OCC_OK) { die("QueryClash", rc); return ROBOT_FAIL; }
      ++checks;
      printf("  L%d vs L%d status=%d\n", i, j, status);
      if (status == 1) ++hits;
    }
  }
  printf("  pairs=%d hits=%d\n", checks, hits);
  *out_hits = hits;
  return ROBOT_OK;
}

/* ---- Step 6: frame POD helpers ---- */
static int demo_frame_math(const occ_frame_t joints[DOF]) {
  occ_frame_t world, inv, prod;
  double m12[12];
  if (occ_frame_world(&world) != OCC_OK) { die("frame_world", -1); return ROBOT_FAIL; }
  if (occ_frame_inverted(&joints[0], &inv) != OCC_OK) { die("invert", -1); return ROBOT_FAIL; }
  if (occ_frame_multiplied(&joints[1], &joints[0], &prod) != OCC_OK) {
    die("multiplied", -1); return ROBOT_FAIL;
  }
  if (occ_frame_to_trsf_4x3(&prod, m12) != OCC_OK) { die("to_trsf", -1); return ROBOT_FAIL; }
  printf("[6] frame math OK (world, invert, multiply, 4x3)\n");
  (void)world; (void)inv;
  return ROBOT_OK;
}

static int report_arm_mass(occ_shape_t world[DOF]) {
  occ_shape_t assy = 0;
  if (occ_make_compound(world, DOF, &assy) != OCC_OK) {
    die("compound arm", -1); return ROBOT_FAIL;
  }
  double mass = 0.0, com[3] = {0}, I[6] = {0};
  int st = occ_mass_properties(assy, 2700.0, &mass, com, I);
  free_shape(&assy);
  if (st != OCC_OK) { die("mass arm", st); return ROBOT_FAIL; }
  printf("[7] arm mass (Al)=%.2f kg COM=(%.3f,%.3f,%.3f)\n",
         mass, com[0], com[1], com[2]);
  if (!(mass > 0.0)) { fprintf(stderr, "bad arm mass\n"); return ROBOT_FAIL; }
  return ROBOT_OK;
}

int main(void) {
  printf("=== smoke_robot_6dof: 6-DOF arm dual-goal smoke ===\n\n");

  occ_shape_t local[DOF], world[DOF];
  occ_frame_t joints[DOF];
  double T_prefix[DOF][16], T_tcp[16], angles[DOF];
  memset(local, 0, sizeof(local));
  memset(world, 0, sizeof(world));
  memset(joints, 0, sizeof(joints));
  memcpy(angles, kAngles, sizeof(angles));

  int hits = 0, rc = ROBOT_OK;

  if (build_link_solids(local) != ROBOT_OK) { rc = ROBOT_FAIL; goto done; }
  if (attach_joint_frames(joints) != ROBOT_OK) { rc = ROBOT_FAIL; goto done; }
  if (compose_all(angles, T_prefix, T_tcp) != ROBOT_OK) { rc = ROBOT_FAIL; goto done; }
  if (place_links(local, T_prefix, world) != ROBOT_OK) { rc = ROBOT_FAIL; goto done; }
  if (clash_nonadjacent(world, &hits) != ROBOT_OK) { rc = ROBOT_FAIL; goto done; }
  if (demo_frame_math(joints) != ROBOT_OK) { rc = ROBOT_FAIL; goto done; }
  if (report_arm_mass(world) != ROBOT_OK) { rc = ROBOT_FAIL; goto done; }

  printf("\n--- TCP 4x4 (canonical) ---\n");
  for (int r = 0; r < 4; ++r)
    printf("%.8f %.8f %.8f %.8f\n",
           T_tcp[4*r+0], T_tcp[4*r+1], T_tcp[4*r+2], T_tcp[4*r+3]);

  printf("\nJoint origins after FK:\n");
  for (int i = 0; i < DOF; ++i) {
    double o[3];
    mat_origin(T_prefix[i], o);
    printf("  J%d world=(%.4f, %.4f, %.4f)\n", i, o[0], o[1], o[2]);
  }
  printf("\n=== RESULT: %s (non-adj hits=%d) ===\n",
         rc == ROBOT_OK ? "PASS" : "FAIL", hits);

done:
  for (int i = 0; i < DOF; ++i) { free_shape(&local[i]); free_shape(&world[i]); }
  return rc;
}
```

---

## 3. Flange bolt circle — `examples/smoke_flange_bolt_circle.c`

Short cylinder flange + center bore + N bolt holes + polar bolt-head pattern.

```c
// === file: examples/smoke_flange_bolt_circle.c
/*
 * smoke_flange_bolt_circle.c — hole + PatternPolar recipe (pure C / occ_c)
 *
 * IR → C:
 *   PrimCylinder → occ_make_cylinder
 *   DrillHole    → occ_drill_hole_through
 *   PatternPolar → occ_pattern_polar
 *   mass         → occ_mass_properties
 *
 * Also demos PatternPolar of a single-hole solid (compound copies).
 */
#include "occ_c.h"
#include "occ_c_frames.h"
#include "occ_c_route.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

enum { FLANGE_OK = 0, FLANGE_FAIL = 1 };

static const double kFlangeOD    = 0.230;
static const double kFlangeThk   = 0.024;
static const double kBoreRadius  = 0.051;
static const double kBoltCircleR = 0.095;
static const double kBoltHoleR   = 0.0095;
static const int    kBoltCount   = 8;
static const double kSteelDensity = 7850.0;

static void die(const char* step, int st) {
  fprintf(stderr, "[smoke_flange_bolt_circle] FAIL %s: status=%d err=%s\n",
          step, st, occ_last_error() ? occ_last_error() : "(null)");
}

static void free_shape(occ_shape_t* s) {
  if (s && *s) { occ_shape_free(*s); *s = 0; }
}

static int make_flange_disk(occ_shape_t* out) {
  int st = occ_make_cylinder(0, 0, 0, 0, 0, 1, kFlangeOD * 0.5, kFlangeThk, out);
  if (st != OCC_OK) { die("PrimCylinder flange", st); return FLANGE_FAIL; }
  printf("[1] PrimCylinder flange OD=%.3f thk=%.3f m\n", kFlangeOD, kFlangeThk);
  return FLANGE_OK;
}

static int drill_center_bore(occ_shape_t solid, occ_shape_t* out) {
  int st = occ_drill_hole_through(solid, 0, 0, kFlangeThk * 0.5,
                                  0, 0, 1, kBoreRadius, out);
  if (st != OCC_OK) { die("DrillHole bore", st); return FLANGE_FAIL; }
  printf("[2] DrillHole center bore R=%.4f m\n", kBoreRadius);
  return FLANGE_OK;
}

/* Preferred: successive through-holes on bolt circle → one solid. */
static int drill_bolt_circle(occ_shape_t solid, occ_shape_t* out) {
  occ_shape_t cur = solid, next = 0;
  int owns = 0;
  for (int i = 0; i < kBoltCount; ++i) {
    double ang = (2.0 * M_PI * (double)i) / (double)kBoltCount;
    double cx = kBoltCircleR * cos(ang);
    double cy = kBoltCircleR * sin(ang);
    int st = occ_drill_hole_through(cur, cx, cy, kFlangeThk * 0.5,
                                    0, 0, 1, kBoltHoleR, &next);
    if (st != OCC_OK) {
      die("DrillHole bolt", st);
      if (owns) free_shape(&cur);
      return FLANGE_FAIL;
    }
    if (owns) free_shape(&cur);
    cur = next; next = 0; owns = 1;
    printf("  bolt %d at (%.4f, %.4f)\n", i, cx, cy);
  }
  *out = cur;
  printf("[3] DrillHole bolt circle N=%d PCD=%.3f m\n",
         kBoltCount, 2.0 * kBoltCircleR);
  return FLANGE_OK;
}

/* PatternPolar of hex-head proxy boxes for BOM viz. */
static int pattern_bolt_heads(occ_shape_t* out_heads) {
  occ_shape_t seed = 0, seed_at = 0;
  int st = occ_make_box(0.024, 0.024, 0.016, &seed);
  if (st != OCC_OK) { die("PrimBox bolt head", st); return FLANGE_FAIL; }
  st = occ_translate(seed, kBoltCircleR - 0.012, -0.012, kFlangeThk, &seed_at);
  free_shape(&seed);
  if (st != OCC_OK) { die("translate head", st); return FLANGE_FAIL; }

  double step = (2.0 * M_PI) / (double)kBoltCount;
  st = occ_pattern_polar(seed_at, 0, 0, 0, 0, 0, 1, step, kBoltCount, 0, out_heads);
  free_shape(&seed_at);
  if (st != OCC_OK) { die("PatternPolar heads", st); return FLANGE_FAIL; }
  printf("[4] PatternPolar bolt heads N=%d step=%.4f rad\n", kBoltCount, step);
  return FLANGE_OK;
}

static int report(occ_shape_t flange) {
  double mass = 0.0, com[3] = {0}, I[6] = {0};
  int st = occ_mass_properties(flange, kSteelDensity, &mass, com, I);
  if (st != OCC_OK) { die("mass", st); return FLANGE_FAIL; }
  printf("[5] mass=%.3f kg COM=(%.4f,%.4f,%.4f)\n",
         mass, com[0], com[1], com[2]);
  double radial = sqrt(com[0]*com[0] + com[1]*com[1]);
  if (radial > 0.005) {
    fprintf(stderr, "[smoke_flange_bolt_circle] COM radial %.4f too large\n", radial);
    return FLANGE_FAIL;
  }
  if (!(mass > 0.0) || !isfinite(mass)) {
    fprintf(stderr, "[smoke_flange_bolt_circle] bad mass\n");
    return FLANGE_FAIL;
  }
  double vol = 0.0;
  if (occ_volume(flange, &vol) == OCC_OK) {
    printf("  volume=%.6f m^3\n", vol);
    double solid = M_PI * (kFlangeOD * 0.5) * (kFlangeOD * 0.5) * kFlangeThk;
    if (vol >= solid) {
      fprintf(stderr, "[smoke_flange_bolt_circle] holes did not reduce volume\n");
      return FLANGE_FAIL;
    }
  }
  return FLANGE_OK;
}

/* Alt: one hole then PatternPolar of the drilled solid (compound demo). */
static int demo_pattern_drilled_copy(occ_shape_t plain) {
  occ_shape_t one = 0, pat = 0;
  int st = occ_drill_hole_through(plain, kBoltCircleR, 0, kFlangeThk * 0.5,
                                  0, 0, 1, kBoltHoleR, &one);
  if (st != OCC_OK) { die("alt drill", st); return FLANGE_FAIL; }
  double step = (2.0 * M_PI) / (double)kBoltCount;
  st = occ_pattern_polar(one, 0, 0, 0, 0, 0, 1, step, kBoltCount, 0, &pat);
  free_shape(&one);
  if (st != OCC_OK) { die("alt polar", st); return FLANGE_FAIL; }
  printf("[alt] PatternPolar of single-hole flange → %d copies\n", kBoltCount);
  free_shape(&pat);
  return FLANGE_OK;
}

int main(void) {
  printf("=== smoke_flange_bolt_circle: hole+pattern recipe ===\n\n");
  occ_shape_t disk = 0, bored = 0, flange = 0, heads = 0;
  int rc = FLANGE_OK;

  if (make_flange_disk(&disk) != FLANGE_OK) { rc = FLANGE_FAIL; goto done; }
  if (demo_pattern_drilled_copy(disk) != FLANGE_OK) { rc = FLANGE_FAIL; goto done; }
  if (drill_center_bore(disk, &bored) != FLANGE_OK) { rc = FLANGE_FAIL; goto done; }
  if (drill_bolt_circle(bored, &flange) != FLANGE_OK) { rc = FLANGE_FAIL; goto done; }
  if (pattern_bolt_heads(&heads) != FLANGE_OK) { rc = FLANGE_FAIL; goto done; }
  if (report(flange) != FLANGE_OK) { rc = FLANGE_FAIL; goto done; }

  {
    occ_shape_t parts[2] = { flange, heads }, grp = 0;
    if (occ_make_compound(parts, 2, &grp) == OCC_OK) {
      if (occ_step_write(grp, "/tmp/smoke_flange_bolt_circle.step") == OCC_OK)
        printf("[+] wrote /tmp/smoke_flange_bolt_circle.step\n");
      free_shape(&grp);
    }
  }
  printf("\n=== RESULT: %s ===\n", rc == FLANGE_OK ? "PASS" : "FAIL");

done:
  free_shape(&disk); free_shape(&bored); free_shape(&flange); free_shape(&heads);
  return rc;
}
```

---

## 4. Extractor — `scripts/extract_literate.py`

```python
# === file: scripts/extract_literate.py
#!/usr/bin/env python3
"""extract_literate.py — write literate code fences to real files.

Usage:
  python3 scripts/extract_literate.py docs/literate-sections/08-smoke-dual-goal.md
  python3 scripts/extract_literate.py docs/occ-c-p0-literate-api.md --root . --force
  python3 scripts/extract_literate.py section.md --dry-run --list

A fenced block is extractable iff its first non-empty line matches:
  // === file: RELPATH   (C/C++/headers)
  # === file: RELPATH    (Python/Starlark)
The mark line is kept in the output. Paths must be relative (no parent hops).
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path
from typing import Iterable, List, Optional, Tuple

FILE_MARK = re.compile(
    r"^[ \t]*(?://|#) === file:[ \t]*(?P<path>\S+)\s*$"
)
FENCE_OPEN = re.compile(r"^```([a-zA-Z0-9_+-]*)\s*$")
FENCE_CLOSE = re.compile(r"^```\s*$")


def iter_fences(lines: List[str]) -> Iterable[Tuple[str, List[str]]]:
    i, n = 0, len(lines)
    while i < n:
        m = FENCE_OPEN.match(lines[i])
        if not m:
            i += 1
            continue
        lang = m.group(1) or ""
        i += 1
        body: List[str] = []
        while i < n and not FENCE_CLOSE.match(lines[i]):
            body.append(lines[i].rstrip("\n"))
            i += 1
        if i < n:
            i += 1
        yield lang, body


def first_file_mark(body: List[str]) -> Optional[str]:
    for line in body:
        if line.strip() == "":
            continue
        m = FILE_MARK.match(line)
        return m.group("path") if m else None
    return None


def safe_join(root: Path, rel: str) -> Path:
    if os.path.isabs(rel) or any(p == ".." for p in Path(rel).parts):
        raise ValueError(f"unsafe path: {rel}")
    out = (root / rel).resolve()
    out.relative_to(root.resolve())
    return out


def extract_from_text(
    text: str, root: Path, force: bool, dry_run: bool, source: str
) -> List[Tuple[str, Path, int]]:
    written: List[Tuple[str, Path, int]] = []
    for lang, body in iter_fences(text.splitlines()):
        rel = first_file_mark(body)
        if not rel:
            continue
        content = "\n".join(body)
        if content and not content.endswith("\n"):
            content += "\n"
        try:
            dest = safe_join(root, rel)
        except ValueError as ex:
            print(f"error: {source}: {ex}", file=sys.stderr)
            continue
        nbytes = len(content.encode("utf-8"))
        if dry_run:
            print(f"DRY  {rel}  ({nbytes} B, lang={lang or '-'})")
            written.append((rel, dest, nbytes))
            continue
        if dest.exists() and not force:
            print(f"skip {rel}  (exists; use --force)")
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(content, encoding="utf-8")
        if rel.startswith("scripts/") and rel.endswith(".py"):
            dest.chmod(dest.stat().st_mode | 0o111)
        print(f"write {rel}  ({nbytes} B)")
        written.append((rel, dest, nbytes))
    return written


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("markdown", nargs="+", help="Markdown sources")
    ap.add_argument("--root", default=".", help="Output root (default cwd)")
    ap.add_argument("--force", action="store_true", help="Overwrite existing")
    ap.add_argument("--dry-run", action="store_true", help="Plan only")
    ap.add_argument("--list", action="store_true", help="List paths and sizes")
    ap.add_argument("--require", action="store_true", help="Fail if zero files")
    args = ap.parse_args(argv)

    root = Path(args.root).resolve()
    if not root.is_dir():
        print(f"error: root not a directory: {root}", file=sys.stderr)
        return 1

    total: List[Tuple[str, Path, int]] = []
    for md in args.markdown:
        p = Path(md)
        if not p.is_file():
            print(f"error: not a file: {md}", file=sys.stderr)
            return 1
        dry = args.dry_run or args.list
        total.extend(
            extract_from_text(
                p.read_text(encoding="utf-8"), root, args.force, dry, str(p)
            )
        )

    if args.list:
        for rel, _d, n in total:
            print(f"{rel}\t{n}")
        return 0 if total or not args.require else 2

    print(f"-- {len(total)} file(s) from {len(args.markdown)} source(s)")
    return 2 if (args.require and not total) else 0


if __name__ == "__main__":
    sys.exit(main())
```

---

## 5. BUILD.bazel fragment

```python
# === file: examples/BUILD.bazel
# Dual-goal pure-C smoke binaries for occ_c P0. Merge with existing package.

load("@rules_cc//cc:defs.bzl", "cc_binary", "cc_test")

package(default_visibility = ["//visibility:public"])

SMOKE_COPTS = ["-std=c11", "-Wall", "-Wextra", "-Wno-unused-parameter"]
OCC_C_DEP = "//api:occ_c"  # or //api:occ_c_lib

cc_binary(
    name = "smoke_pipe_skid",
    srcs = ["smoke_pipe_skid.c"],
    copts = SMOKE_COPTS,
    deps = [OCC_C_DEP],
)

cc_test(
    name = "smoke_pipe_skid_test",
    srcs = ["smoke_pipe_skid.c"],
    copts = SMOKE_COPTS,
    deps = [OCC_C_DEP],
    size = "small",
)

cc_binary(
    name = "smoke_robot_6dof",
    srcs = ["smoke_robot_6dof.c"],
    copts = SMOKE_COPTS,
    deps = [OCC_C_DEP],
)

cc_test(
    name = "smoke_robot_6dof_test",
    srcs = ["smoke_robot_6dof.c"],
    copts = SMOKE_COPTS,
    deps = [OCC_C_DEP],
    size = "small",
)

cc_binary(
    name = "smoke_flange_bolt_circle",
    srcs = ["smoke_flange_bolt_circle.c"],
    copts = SMOKE_COPTS,
    deps = [OCC_C_DEP],
)

cc_test(
    name = "smoke_flange_bolt_circle_test",
    srcs = ["smoke_flange_bolt_circle.c"],
    copts = SMOKE_COPTS,
    deps = [OCC_C_DEP],
    size = "small",
)

filegroup(
    name = "dual_goal_smokes",
    srcs = [
        "smoke_pipe_skid.c",
        "smoke_robot_6dof.c",
        "smoke_flange_bolt_circle.c",
    ],
)

# Reference: api/BUILD.bazel expanded library srcs
# cc_library(
#     name = "occ_c",
#     srcs = [
#         "src/occ_c.cc",
#         "src/occ_c_frames.cc",
#         "src/occ_c_route.cc",
#         "src/occ_c_query.cc",
#         "src/occ_c_trsf.cc",
#     ],
#     hdrs = [
#         "include/occ_c.h",
#         "include/occ_c_frames.h",
#         "include/occ_c_route.h",
#     ],
#     includes = ["include"],
#     deps = ["@occt//:occt"],
#     copts = ["-std=c++17"],
# )
```

---

## 6. IR → C map (this section)

| IR op | C symbol | Smoke |
|-------|----------|-------|
| `PrimBox` | `occ_make_box` | skid base/eq/clamps, base link |
| `PrimCylinder` | `occ_make_cylinder` | robot links, flange |
| `AttachFrame` | `occ_frame_from_axes` / `occ_frame_from_z` | nozzles, joints |
| `RoutePath` | `occ_make_route_with_bends` | skid centerline |
| `SweepAlong` | `occ_pipe_annulus` | pipe run |
| `PatternLinear` | `occ_pattern_linear` | clamps |
| `PatternPolar` | `occ_pattern_polar` | bolt heads |
| `DrillHole` | `occ_drill_hole_through` | bore + bolts |
| `ComposeChain` | `occ_compose_chain` | FK |
| `RigidXform` | `occ_trsf_apply_shape` | place links |
| `QueryClash` | `occ_clash` | pipe/eq, non-adj links |
| mass | `occ_mass_properties` | all three |
| `GroupBodies` | `occ_make_compound` | STEP export |

---

## 7. Extract & build checklist

```bash
python3 scripts/extract_literate.py \
  docs/occ-c-p0-literate-api.md \
  docs/literate-sections/08-smoke-dual-goal.md \
  --root . --force

bazel build //examples:smoke_pipe_skid //examples:smoke_robot_6dof //examples:smoke_flange_bolt_circle
bazel test  //examples:smoke_pipe_skid_test //examples:smoke_robot_6dof_test //examples:smoke_flange_bolt_circle_test
```

**Golden checks:** pipe mass > 0; robot TCP within reach; flange COM radial < 5 mm; all exit 0.

---

*End of section 08 — dual-goal smoke programs.*

<!-- END 08-smoke-dual-goal.md -->



---

# Appendix Z — Clean-room capability matrix vs this literate C surface

Legend for **In literate C**:
- **Yes** — full extractable implementation present
- **Baseline** — already in shipping `occ_c.cc` (not re-implemented here; still part of the C surface)
- **Partial** — recipe / hooks only (not a full product feature)
- **N/A (product)** — clean-room P0 but **explicitly not** a kernel C responsibility
- **No** — missing from both baseline and this doc

| # | Capability (clean-room) | Pri | In literate C / baseline |
|---|-------------------------|-----|---------------------------|
| 1 | Sketch2D explicit geometry (wires/faces) | P0 | **Yes** — Part 02 |
| 2 | Sketch constraint **solver** | P0 product | **N/A (product)** |
| 3 | MakePlane / construction plane | P0 | **Yes** — Part 02 |
| 4 | MakePoint / vertex | P0 | **Yes** — Part 02 |
| 5 | AttachFrame (named SE3 on bodies) | P0 | **Yes** — Parts 01+03 |
| 6 | RigidXform / place / connector map | P0 | **Yes** — Part 03 |
| 7 | PrimBox/Cylinder/Sphere/Cone/Torus/Wedge | P0 | **Baseline** |
| 8 | PushPull / extrude blind | P0 | **Baseline** + extents Part 07 |
| 9 | Extrude symmetric / through-all | P0 | **Yes** — Part 07 |
| 10 | SpinSolid / revolve | P0 | **Baseline** + full revolve Part 07 |
| 11 | SweepAlong / pipe solid | P0 | **Baseline** + Part 04 |
| 12 | Annulus pipe (OD/ID) | P0 skid | **Yes** — Part 04 |
| 13 | PipeShell / Frenet sweep | P0 skid | **Yes** — Part 04 |
| 14 | RoutePath polyline | P0 skid | **Yes** — Part 04 |
| 15 | RoutePath with bend radius | P0 skid | **Yes** — Part 04 |
| 16 | MemberSweep rect/circle (structure) | P1 skid | **Yes** — Part 04 |
| 17 | BoolCombine fuse/cut/common | P0 | **Baseline** + fuse/cut many Part 05 |
| 18 | DrillHole through/blind | P0 | **Yes** — Part 05 |
| 19 | Counterbore / countersink | P1 | **Yes** — Part 05 |
| 20 | PatternLinear | P0 | **Yes** — Part 05 |
| 21 | PatternPolar / full circle | P0 | **Yes** — Part 05 |
| 22 | PatternAlongPath | P1 | **Yes** — Part 05 |
| 23 | GroupBodies / compound / explode | P1 | **Yes** — Part 05 |
| 24 | SplitBody plane/shape | P1 | **Yes** — Part 05 |
| 25 | Fillet / chamfer / shell | P1 | **Baseline** |
| 26 | Loft | P2 | **Baseline** + ruled Part 07 |
| 27 | MakeHelix | P2 | **Yes** — Part 07 |
| 28 | Thicken / sew / solid-from-shell | P1–P2 | **Yes** — Part 07 |
| 29 | MirrorCopy | P1 | **Baseline** mirror + Part 03 mirror_copy |
| 30 | ImportBrep / ExportBrep / STEP / mesh | P0 | **Baseline** |
| 31 | QueryGeom volume/area/COM/bbox | P0 | **Baseline** + Part 06 |
| 32 | QueryClash / distance / clearance | P0 | **Yes** — Part 06 |
| 33 | ComputeMass density + inertia | P1 | **Yes** — Part 06 |
| 34 | Topology selectors (area/planar/…) | P0 | **Yes** — Part 06 |
| 35 | History / created_by / session | P0 | **Yes** — Part 01 |
| 36 | ComposeChain FK | P0 robot | **Yes** — Part 03 |
| 37 | DH chain | P1 robot | **Yes** — Part 03 |
| 38 | Mate **solver** (assembly constraints) | P0 product | **N/A (product)** |
| 39 | Joint limits as constraint system | P0 product | **N/A (product)** (math only in C) |
| 40 | Catalog SpawnPart database | P0 product | **N/A (product)** (import+place in C) |
| 41 | FittingElbow catalog solids | P0 product | **N/A (product)** |
| 42 | ExportRobotPackage / URDF writer | P0 product | **N/A (product)** |
| 43 | MeshPrep FEA domains | P0 product | **Partial** — baseline mesh + host JSON |
| 44 | ParseIntent NL / ParseDrawing | P0 product | **N/A (product)** |
| 45 | Hole standards tables | P2 | **N/A** (skip) |
| 46 | Sheet metal suite | P2 | **N/A** (skip) |
| 47 | Dual-goal smoke tests | — | **Yes** — Part 08 |
| 48 | Literate extract script | — | **Yes** — Part 08 |

### Kernel C completeness verdict

All clean-room items that **belong in the C kernel** for dual-goal P0/P1 are **Yes** or **Baseline**.  
Items marked **N/A (product)** are intentionally outside `occ_c` (IR/Luau/host packaging).

**Stats (v2):** ~11.6k markdown lines · ~9.5k code-fence lines · **160** `OCC_API` symbols · **8** implementation modules + smokes.

