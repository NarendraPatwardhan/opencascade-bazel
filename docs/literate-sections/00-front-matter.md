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
2. Run extract on individual parts or `cat docs/literate-sections/0{0..8}-*.md` then extract (see `docs/occ-c-literate-api.md`). Script is in Part 08.  
3. Extract lands under `api/include/`, `api/src/`, `examples/`.  
4. Baseline `api/src/occ_c.cc` **stays** — this document is additive modules + a unified header patch.  
5. Units: **meters**, **radians**, topology indices **1-based**.  
6. Do **not** copy FeatureScript; only OCCT + our names.  
7. Product-layer items (mate **solver**, NL parse, FEA solve, sketch **constraint** solve, catalog DB) are explicitly **out of C** — marked OUT below.

```text
docs/literate-sections/*.md  (authoritative; hub is docs/occ-c-literate-api.md)
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

Each part is self-contained literate source. Concatenate in order only if you want a single extract input; the hub does not duplicate full text.
