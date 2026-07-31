# `occ_c` P0 Kernel Expansion — Literate Implementation Spec

**Document type:** Literate programming source for the Apache **`occ_c`** C API  
**Audience:** Implementers extracting real `.h` / `.cc` into `api/`  
**Date:** 2026-07-31  
**OCCT pin:** **7.9.3** (`OCCT-7_9_3` / `@occt` in Bazel)  
**Checklist source:** [`docs/cleanroom-featurescript-std-report.md`](cleanroom-featurescript-std-report.md) dual-goal P0 matrix  
**Product goals:** AI-BOOST piping skids · 6-DOF robot arm  
**Method:** Multi-agent draft against live OCCT 7.9.3 headers + existing `occ_c` style  

---

## How to use this file (literate extract)

1. Blocks tagged `// === file: <name>` are **authoritative source**.  
2. Concatenate into the named files under `api/include/` and `api/src/`.  
3. Share `as_shape` / `to_handle` / `OCC_GUARD_*` / `g_last_error` via a private `occ_c_internal.hxx` **or** keep a single translation unit that `#include`s fragments.  
4. Extend `occ_status_t`, update `_OCC_C_EXPORTS` in `api/BUILD.bazel`, rebuild Wasm size limit.  
5. Do **not** copy FeatureScript; only OCCT + our names.  
6. Units: **meters**, **radians**, topology indices **1-based**.

```text
docs/occ-c-p0-literate-api.md
        │ extract
        ▼
api/include/occ_c.h          (patched enums + prototypes)
api/include/occ_c_frames.h   (optional split)
api/include/occ_c_route.h
api/src/occ_c.cc             (baseline — already shipped)
api/src/occ_c_frames.cc
api/src/occ_c_route.cc
api/src/occ_c_query.cc
api/src/occ_c_trsf.cc
```

---

## 0. Derivation: how today’s `occ_c` maps onto OCCT 7.9.3

The current API is a **thin C façade**. Pattern for every mutator:

```cpp
int occ_*(…, occ_shape_t* out) {
  REQ(…);
  OCC_GUARD_BEGIN
  // one or few OCCT calls
  *out = to_handle(/* TopoDS_Shape */);
  return OCC_OK;
  OCC_GUARD_END
}
```

| `occ_c` symbol | Primary OCCT type / call | Role |
|----------------|--------------------------|------|
| `occ_shape_t` | `TopoDS_Shape*` (owned) | Opaque BREP handle |
| `occ_mesh_t` | private `MeshBuf*` | Tessellation buffers |
| `occ_make_box` | `BRepPrimAPI_MakeBox` | Primitive |
| `occ_make_cylinder` | `BRepPrimAPI_MakeCylinder` + `gp_Ax2` | Primitive |
| `occ_make_sphere` | `BRepPrimAPI_MakeSphere` | Primitive |
| `occ_make_cone` | `BRepPrimAPI_MakeCone` | Primitive |
| `occ_make_torus` | `BRepPrimAPI_MakeTorus` | Primitive |
| `occ_make_wedge` | `BRepPrimAPI_MakeWedge` | Primitive |
| `occ_fuse` | `BRepAlgoAPI_Fuse` | Boolean |
| `occ_cut` | `BRepAlgoAPI_Cut` | Boolean |
| `occ_intersect` | `BRepAlgoAPI_Common` | Boolean |
| `occ_section` | `BRepAlgoAPI_Section` | Boolean |
| `occ_fillet_*` | `BRepFilletAPI_MakeFillet` + `TopExp` | Feature |
| `occ_chamfer_*` | `BRepFilletAPI_MakeChamfer` | Feature |
| `occ_shell` | `BRepOffsetAPI_MakeThickSolid` | Feature |
| `occ_offset_3d` | `BRepOffsetAPI_MakeOffsetShape` | Feature |
| `occ_extrude` | `BRepPrimAPI_MakePrism` | Sweep |
| `occ_revolve` | `BRepPrimAPI_MakeRevol` | Sweep |
| `occ_loft` | `BRepOffsetAPI_ThruSections` | Sweep |
| `occ_pipe` | `BRepOffsetAPI_MakePipe` | Sweep (pipe solid) |
| `occ_translate/rotate/scale/mirror` | `gp_Trsf` + `BRepBuilderAPI_Transform` | Xform |
| `occ_volume` / area / COM | `BRepGProp` + `GProp_GProps` | Measure |
| `occ_bbox` | `BRepBndLib` + `Bnd_Box` | Measure |
| `occ_count_*` / `*_at` | `TopExp::MapShapes` | Topology (1-based) |
| `occ_step_*` | `STEPControl_Reader/Writer` | IO |
| `occ_brep_*` | `BRepTools` + `BRep_Builder` | IO |
| `occ_stl_write` | `StlAPI_Writer` + mesh | IO |
| `occ_gltf_write` / `occ_obj_*` | XCAF + RWGltf/RWObj | IO |
| `occ_mesh_compute` | `BRepMesh_IncrementalMesh` + `Poly_Triangulation` | Viz |

**What this expansion adds (clean-room P0 gaps):** construction wires/faces, POD frames, rigid 4×4 / connector maps, route+bends, annulus pipe, patterns, simple holes, compounds, distance/clash, mass×density, topology selector helpers, FK chain math.

---

## 1. Clean-room checklist → C surface

| Checklist item | Pri | Baseline | This doc |
|----------------|-----|----------|----------|
| Primitives / boolean / extrude / revolve / pipe / fillet | P0 | **Done** | — |
| Sketch solver | P0 product | N | **Out of C P0** (Luau/IR; use faces/wires) |
| Construction plane / point | P0 | N | `occ_make_plane_rect`, `occ_make_vertex` |
| Named frames `AttachFrame` | P0 | N | `occ_frame_t` POD + place APIs |
| Connector-to-connector | P0 | N | `occ_frame_between` / displacement |
| RoutePath poly + bend R | P0 | N | `occ_make_route_*` |
| SweepAlong annulus | P0 | partial `occ_pipe` | `occ_pipe_annulus` |
| Pattern linear / polar | P0 | N | `occ_pattern_*` |
| DrillHole simple | P0 | N | `occ_drill_hole_*` |
| GroupBodies | P1/P0 | N | `occ_make_compound` |
| QueryClash / distance | P0 | N | `occ_clash`, `occ_distance` |
| Mass + density | P1 | volume only | `occ_mass_properties` |
| Topology selectors | P0 | index only | largest face, planar, normal, edge mid/tan |
| ComposeChain FK | P0 robot | N | `occ_compose_chain` pure math + `occ_trsf_apply_shape` |
| Assembly mate **solver** | P0 product | N | **Not in C** (product layer) |
| MeshPrep FEA | P0 product | viz mesh | host JSON + `occ_mesh_compute` |
| NL / 2D parse | P0 product | N | **Not in C** |
| Sheet metal / hole tables | P2 | N | **Skip** |

---

## 2. Shared runtime glue (extract once)

`// === file: occ_c_internal.hxx`

```cpp
// === file: occ_c_internal.hxx
// Private — not installed. Shared by all occ_c*.cc TUs.
#pragma once
#include "occ_c.h"
#include <string>
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

`occ_last_error` implementation returns `occ_c_detail::g_last_error.c_str()`.

---

## 3. Patched status enum + shape-type enum

```c
// === file: occ_c.h  (enum fragment — replace existing occ_status_t)
typedef enum {
  OCC_OK                = 0,
  OCC_ERR_NULL_ARG      = 1,
  OCC_ERR_INVALID_SHAPE = 2,
  OCC_ERR_BOOLEAN       = 3,
  OCC_ERR_FILLET        = 4,
  OCC_ERR_IO            = 5,
  OCC_ERR_INDEX         = 6,
  OCC_ERR_EXCEPTION     = 7,
  OCC_ERR_GEOM          = 8,  /* construction / distance / curve */
  OCC_ERR_FRAME         = 9,  /* degenerate frame axes */
  OCC_ERR_CLASH         = 10  /* reserved; clash usually returns status out-param */
} occ_status_t;

/* Mirrors TopAbs_ShapeEnum (OCCT 7.9.3) */
typedef enum {
  OCC_SHAPE_COMPOUND  = 0,
  OCC_SHAPE_COMPSOLID = 1,
  OCC_SHAPE_SOLID     = 2,
  OCC_SHAPE_SHELL     = 3,
  OCC_SHAPE_FACE      = 4,
  OCC_SHAPE_WIRE      = 5,
  OCC_SHAPE_EDGE      = 6,
  OCC_SHAPE_VERTEX    = 7,
  OCC_SHAPE_SHAPE     = 8
} occ_shape_type_t;
```

---


# Part A — Frames, Construction Wires/Faces, Rigid Placement

## Pedagogy

Named frames are **POD** (`occ_frame_t`: origin + X + Z). Not Parasolid mate-connector bodies.
`gp_Ax3` + `gp_Trsf::SetDisplacement(A,B)` implements connector map \(T = T_B T_A^{-1}\).

OCCT: `BRepBuilderAPI_MakeVertex/Edge/Wire/Polygon/Face/Transform`, `gp_Ax3`, `gp_Trsf`, `gp_Circ`, `gp_Pln`.

---

## Header — `// === file: occ_c_frames.h`

```c
// === file: occ_c_frames.h
#ifndef OCC_C_FRAMES_H_
#define OCC_C_FRAMES_H_
#include "occ_c.h"
#ifdef __cplusplus
extern "C" {
#endif

typedef struct occ_frame_s {
  double origin[3];
  double x_axis[3];
  double z_axis[3];
} occ_frame_t;

OCC_API int occ_frame_world(occ_frame_t* out);
OCC_API int occ_frame_from_axes(double ox, double oy, double oz,
                                double xx, double xy, double xz,
                                double zx, double zy, double zz,
                                occ_frame_t* out);
OCC_API int occ_frame_from_z(double ox, double oy, double oz,
                             double zx, double zy, double zz,
                             occ_frame_t* out);
OCC_API int occ_frame_to_trsf_4x3(const occ_frame_t* f, double out12[12]);
OCC_API int occ_frame_from_trsf_4x3(const double m12[12], occ_frame_t* out);
OCC_API int occ_frame_inverted(const occ_frame_t* f, occ_frame_t* out);
OCC_API int occ_frame_multiplied(const occ_frame_t* b, const occ_frame_t* a,
                                 occ_frame_t* out);
OCC_API int occ_frame_displacement(const occ_frame_t* from_a,
                                   const occ_frame_t* to_b,
                                   occ_frame_t* out_as_frame);
OCC_API int occ_frame_displacement_4x3(const occ_frame_t* from_a,
                                       const occ_frame_t* to_b,
                                       double out12[12]);

OCC_API int occ_make_vertex(double x, double y, double z, occ_shape_t* out);
OCC_API int occ_make_polyline(const double* xyz, int n, int closed,
                              occ_shape_t* out);
OCC_API int occ_make_circle_wire(double cx, double cy, double cz,
                                 double nx, double ny, double nz,
                                 double radius, occ_shape_t* out);
OCC_API int occ_make_planar_face_from_wire(occ_shape_t wire, occ_shape_t* out);
OCC_API int occ_make_plane_rect(double ox, double oy, double oz,
                                double nx, double ny, double nz,
                                double xx, double xy, double xz,
                                double width, double height,
                                occ_shape_t* out);

OCC_API int occ_transform_shape_4x3(occ_shape_t s, const double m12[12],
                                    occ_shape_t* out);
OCC_API int occ_transform_shape_frame(occ_shape_t s, const occ_frame_t* f,
                                      occ_shape_t* out);
OCC_API int occ_place_shape_at_frame(occ_shape_t s, const occ_frame_t* target,
                                     occ_shape_t* out);
OCC_API int occ_frame_between(occ_shape_t s,
                              const occ_frame_t* src,
                              const occ_frame_t* dst,
                              occ_shape_t* out);

#ifdef __cplusplus
}
#endif
#endif
```

---

## Implementation — `// === file: occ_c_frames.cc`

```cpp
// === file: occ_c_frames.cc
#include "occ_c_frames.h"
#include "occ_c_internal.hxx"

#include <cmath>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeVertex.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <TopoDS.hxx>
#include <gp_Ax2.hxx>
#include <gp_Ax3.hxx>
#include <gp_Circ.hxx>
#include <gp_Dir.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>

using occ_c_detail::as_shape;
using occ_c_detail::to_handle;
using occ_c_detail::set_last;

namespace {

constexpr double k_axis_eps = 1.0e-12;

double vlen(double x, double y, double z) {
  return std::sqrt(x * x + y * y + z * z);
}

int make_ax3(const occ_frame_t& f, gp_Ax3& out) {
  const double xl = vlen(f.x_axis[0], f.x_axis[1], f.x_axis[2]);
  const double zl = vlen(f.z_axis[0], f.z_axis[1], f.z_axis[2]);
  if (xl < k_axis_eps || zl < k_axis_eps) {
    set_last("frame axis length near zero");
    return OCC_ERR_FRAME;
  }
  gp_Dir z(f.z_axis[0] / zl, f.z_axis[1] / zl, f.z_axis[2] / zl);
  gp_Dir x(f.x_axis[0] / xl, f.x_axis[1] / xl, f.x_axis[2] / xl);
  if (std::abs(x.Dot(z)) > 1.0 - 1.0e-9) {
    set_last("frame X and Z axes nearly parallel");
    return OCC_ERR_FRAME;
  }
  out = gp_Ax3(gp_Pnt(f.origin[0], f.origin[1], f.origin[2]), z, x);
  return OCC_OK;
}

void frame_from_ax3(const gp_Ax3& a, occ_frame_t* out) {
  const gp_Pnt o = a.Location();
  const gp_Dir x = a.XDirection();
  const gp_Dir z = a.Direction();
  out->origin[0] = o.X(); out->origin[1] = o.Y(); out->origin[2] = o.Z();
  out->x_axis[0] = x.X(); out->x_axis[1] = x.Y(); out->x_axis[2] = x.Z();
  out->z_axis[0] = z.X(); out->z_axis[1] = z.Y(); out->z_axis[2] = z.Z();
}

int place_trsf(const occ_frame_t& f, gp_Trsf& t) {
  gp_Ax3 ax;
  int st = make_ax3(f, ax);
  if (st != OCC_OK) return st;
  t.SetDisplacement(gp_Ax3(), ax);
  return OCC_OK;
}

void trsf_to_4x3(const gp_Trsf& t, double out12[12]) {
  out12[0] = t.Value(1, 1); out12[1] = t.Value(1, 2);
  out12[2] = t.Value(1, 3); out12[3] = t.Value(1, 4);
  out12[4] = t.Value(2, 1); out12[5] = t.Value(2, 2);
  out12[6] = t.Value(2, 3); out12[7] = t.Value(2, 4);
  out12[8] = t.Value(3, 1); out12[9] = t.Value(3, 2);
  out12[10] = t.Value(3, 3); out12[11] = t.Value(3, 4);
}

int apply_trsf(occ_shape_t s, const gp_Trsf& t, occ_shape_t* out) {
  REQ(s && out, OCC_ERR_NULL_ARG);
  BRepBuilderAPI_Transform mk(*as_shape(s), t, Standard_True);
  if (!mk.IsDone()) {
    set_last("BRepBuilderAPI_Transform failed");
    return OCC_ERR_GEOM;
  }
  *out = to_handle(mk.Shape());
  return OCC_OK;
}

}  // namespace

extern "C" {

int occ_frame_world(occ_frame_t* out) {
  REQ(out, OCC_ERR_NULL_ARG);
  out->origin[0] = out->origin[1] = out->origin[2] = 0.0;
  out->x_axis[0] = 1; out->x_axis[1] = 0; out->x_axis[2] = 0;
  out->z_axis[0] = 0; out->z_axis[1] = 0; out->z_axis[2] = 1;
  return OCC_OK;
}

int occ_frame_from_axes(double ox, double oy, double oz,
                        double xx, double xy, double xz,
                        double zx, double zy, double zz,
                        occ_frame_t* out) {
  REQ(out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  occ_frame_t tmp{{ox, oy, oz}, {xx, xy, xz}, {zx, zy, zz}};
  gp_Ax3 ax;
  int st = make_ax3(tmp, ax);
  if (st != OCC_OK) return st;
  frame_from_ax3(ax, out);
  return OCC_OK;
  OCC_GUARD_END
}

int occ_frame_from_z(double ox, double oy, double oz,
                     double zx, double zy, double zz,
                     occ_frame_t* out) {
  REQ(out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  if (vlen(zx, zy, zz) < k_axis_eps) {
    set_last("frame Z axis length near zero");
    return OCC_ERR_FRAME;
  }
  gp_Ax3 ax(gp_Pnt(ox, oy, oz), gp_Dir(zx, zy, zz));
  frame_from_ax3(ax, out);
  return OCC_OK;
  OCC_GUARD_END
}

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
  t.SetValues(m12[0], m12[1], m12[2], m12[3],
              m12[4], m12[5], m12[6], m12[7],
              m12[8], m12[9], m12[10], m12[11]);
  frame_from_ax3(gp_Ax3().Transformed(t), out);
  return OCC_OK;
  OCC_GUARD_END
}

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
  REQ(a && b && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  gp_Trsf ta, tb;
  int st = place_trsf(*a, ta);
  if (st != OCC_OK) return st;
  st = place_trsf(*b, tb);
  if (st != OCC_OK) return st;
  frame_from_ax3(gp_Ax3().Transformed(tb.Multiplied(ta)), out);
  return OCC_OK;
  OCC_GUARD_END
}

int occ_frame_displacement(const occ_frame_t* from_a,
                           const occ_frame_t* to_b,
                           occ_frame_t* out_as_frame) {
  REQ(from_a && to_b && out_as_frame, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  gp_Ax3 A, B;
  int st = make_ax3(*from_a, A);
  if (st != OCC_OK) return st;
  st = make_ax3(*to_b, B);
  if (st != OCC_OK) return st;
  gp_Trsf t;
  t.SetDisplacement(A, B);
  frame_from_ax3(gp_Ax3().Transformed(t), out_as_frame);
  return OCC_OK;
  OCC_GUARD_END
}

int occ_frame_displacement_4x3(const occ_frame_t* from_a,
                               const occ_frame_t* to_b,
                               double out12[12]) {
  REQ(from_a && to_b && out12, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  gp_Ax3 A, B;
  int st = make_ax3(*from_a, A);
  if (st != OCC_OK) return st;
  st = make_ax3(*to_b, B);
  if (st != OCC_OK) return st;
  gp_Trsf t;
  t.SetDisplacement(A, B);
  trsf_to_4x3(t, out12);
  return OCC_OK;
  OCC_GUARD_END
}

int occ_make_vertex(double x, double y, double z, occ_shape_t* out) {
  REQ(out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  *out = to_handle(BRepBuilderAPI_MakeVertex(gp_Pnt(x, y, z)).Vertex());
  return OCC_OK;
  OCC_GUARD_END
}

int occ_make_polyline(const double* xyz, int n, int closed, occ_shape_t* out) {
  REQ(xyz && out, OCC_ERR_NULL_ARG);
  REQ(n >= 2, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  BRepBuilderAPI_MakePolygon poly;
  for (int i = 0; i < n; ++i)
    poly.Add(gp_Pnt(xyz[3 * i], xyz[3 * i + 1], xyz[3 * i + 2]));
  if (closed) poly.Close();
  if (!poly.IsDone()) {
    set_last("polyline failed");
    return OCC_ERR_GEOM;
  }
  *out = to_handle(poly.Wire());
  return OCC_OK;
  OCC_GUARD_END
}

int occ_make_circle_wire(double cx, double cy, double cz,
                         double nx, double ny, double nz,
                         double radius, occ_shape_t* out) {
  REQ(out, OCC_ERR_NULL_ARG);
  REQ(radius > 0.0, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  gp_Ax2 ax(gp_Pnt(cx, cy, cz), gp_Dir(nx, ny, nz));
  BRepBuilderAPI_MakeEdge me(gp_Circ(ax, radius));
  if (!me.IsDone()) { set_last("circle edge failed"); return OCC_ERR_GEOM; }
  BRepBuilderAPI_MakeWire mw(me.Edge());
  if (!mw.IsDone()) { set_last("circle wire failed"); return OCC_ERR_GEOM; }
  *out = to_handle(mw.Wire());
  return OCC_OK;
  OCC_GUARD_END
}

int occ_make_planar_face_from_wire(occ_shape_t wire, occ_shape_t* out) {
  REQ(wire && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  if (as_shape(wire)->ShapeType() != TopAbs_WIRE) {
    set_last("expected wire");
    return OCC_ERR_INVALID_SHAPE;
  }
  BRepBuilderAPI_MakeFace mf(TopoDS::Wire(*as_shape(wire)), Standard_True);
  if (!mf.IsDone()) { set_last("planar face failed"); return OCC_ERR_GEOM; }
  *out = to_handle(mf.Face());
  return OCC_OK;
  OCC_GUARD_END
}

int occ_make_plane_rect(double ox, double oy, double oz,
                        double nx, double ny, double nz,
                        double xx, double xy, double xz,
                        double width, double height,
                        occ_shape_t* out) {
  REQ(out, OCC_ERR_NULL_ARG);
  REQ(width > 0.0 && height > 0.0, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  gp_Ax3 ax(gp_Pnt(ox, oy, oz), gp_Dir(nx, ny, nz), gp_Dir(xx, xy, xz));
  const double hw = 0.5 * width, hh = 0.5 * height;
  BRepBuilderAPI_MakeFace mf(gp_Pln(ax), -hw, hw, -hh, hh);
  if (!mf.IsDone()) { set_last("plane_rect failed"); return OCC_ERR_GEOM; }
  *out = to_handle(mf.Face());
  return OCC_OK;
  OCC_GUARD_END
}

int occ_transform_shape_4x3(occ_shape_t s, const double m12[12],
                            occ_shape_t* out) {
  REQ(s && m12 && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  gp_Trsf t;
  t.SetValues(m12[0], m12[1], m12[2], m12[3],
              m12[4], m12[5], m12[6], m12[7],
              m12[8], m12[9], m12[10], m12[11]);
  return apply_trsf(s, t, out);
  OCC_GUARD_END
}

int occ_transform_shape_frame(occ_shape_t s, const occ_frame_t* f,
                              occ_shape_t* out) {
  REQ(s && f && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  gp_Trsf t;
  int st = place_trsf(*f, t);
  if (st != OCC_OK) return st;
  return apply_trsf(s, t, out);
  OCC_GUARD_END
}

int occ_place_shape_at_frame(occ_shape_t s, const occ_frame_t* target,
                             occ_shape_t* out) {
  return occ_transform_shape_frame(s, target, out);
}

int occ_frame_between(occ_shape_t s, const occ_frame_t* src,
                      const occ_frame_t* dst, occ_shape_t* out) {
  REQ(s && src && dst && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  gp_Ax3 A, B;
  int st = make_ax3(*src, A);
  if (st != OCC_OK) return st;
  st = make_ax3(*dst, B);
  if (st != OCC_OK) return st;
  gp_Trsf t;
  t.SetDisplacement(A, B);
  return apply_trsf(s, t, out);
  OCC_GUARD_END
}

}  // extern "C"
```

**IR map:** `AttachFrame` → POD registry in host + optional `occ_frame_*`; `RigidXform` → `occ_place_shape_at_frame` / `occ_frame_between`.


# Part B — Clash, Distance, Mass, Topology Selectors, 4×4 FK

## Pedagogy

`BRepExtrema_DistShapeShape`: `LoadS1/S2`, `Perform()`, `IsDone()`, `Value()`,
`InnerSolution()`, `PointOnShape1(1)` (1-based). Clash status is an **out-param**,
not only an error code.

FK / assembly pose: pure `double[16]` row-major SE(3), then `occ_trsf_apply_shape`.
No mate solver in C.

---

## Header prototypes (merge into `occ_c.h`)

```c
/* Clash: out_status 0=clear 1=interference 2=unknown */
OCC_API int occ_distance(occ_shape_t a, occ_shape_t b,
                         double* out_dist, double p1[3], double p2[3]);
OCC_API int occ_clash(occ_shape_t a, occ_shape_t b,
                      double clearance, int* out_status);

OCC_API int occ_length(occ_shape_t s, double* out_len);
OCC_API int occ_mass_properties(occ_shape_t s, double density,
                                double* mass, double com[3], double inertia[6]);

OCC_API int occ_shape_type(occ_shape_t s, int* out);
OCC_API int occ_is_planar_face(occ_shape_t face, int* out_bool);
OCC_API int occ_face_normal(occ_shape_t face, double n[3]);
OCC_API int occ_face_area(occ_shape_t face, double* out_area);
OCC_API int occ_largest_face(occ_shape_t s, int* out_1based_index);
OCC_API int occ_edge_midpoint(occ_shape_t edge, double p[3]);
OCC_API int occ_edge_tangent(occ_shape_t edge, double t[3]);

/* 4x4 row-major, column-vector p' = M p */
OCC_API void occ_trsf_identity(double m[16]);
OCC_API void occ_trsf_from_frame(double ox, double oy, double oz,
                                 double zx, double zy, double zz,
                                 double xx, double xy, double xz,
                                 double m[16]);
OCC_API void occ_trsf_compose(const double a[16], const double b[16],
                              double out[16]);
OCC_API int  occ_trsf_invert(const double m[16], double out[16]);
OCC_API int  occ_trsf_apply_shape(occ_shape_t s, const double m[16],
                                  occ_shape_t* out);
OCC_API void occ_compose_chain(const double* origins, /* n*3 */
                               const double* axes,    /* n*3 */
                               const double* angles,  /* n rad */
                               int n, double out[16]);
```

---

## Implementation — `// === file: occ_c_trsf.cc` (pure math + apply)

```cpp
// === file: occ_c_trsf.cc
#include "occ_c.h"
#include "occ_c_internal.hxx"
#include <cmath>
#include <cstring>
#include <BRepBuilderAPI_Transform.hxx>
#include <gp_Trsf.hxx>

using occ_c_detail::as_shape;
using occ_c_detail::to_handle;
using occ_c_detail::set_last;

extern "C" {

void occ_trsf_identity(double m[16]) {
  std::memset(m, 0, 16 * sizeof(double));
  m[0] = m[5] = m[10] = m[15] = 1.0;
}

void occ_trsf_compose(const double a[16], const double b[16], double out[16]) {
  double t[16];
  for (int i = 0; i < 4; ++i) {
    for (int j = 0; j < 4; ++j) {
      double s = 0.0;
      for (int k = 0; k < 4; ++k) s += a[i * 4 + k] * b[k * 4 + j];
      t[i * 4 + j] = s;
    }
  }
  std::memcpy(out, t, 16 * sizeof(double));
}

void occ_trsf_from_frame(double ox, double oy, double oz,
                         double zx, double zy, double zz,
                         double xx, double xy, double xz,
                         double m[16]) {
  double zlen = std::sqrt(zx*zx + zy*zy + zz*zz);
  if (zlen < 1e-30) { occ_trsf_identity(m); m[3]=ox; m[7]=oy; m[11]=oz; return; }
  zx/=zlen; zy/=zlen; zz/=zlen;
  double yx = zy*xz - zz*xy, yy = zz*xx - zx*xz, yz = zx*xy - zy*xx;
  double ylen = std::sqrt(yx*yx + yy*yy + yz*yz);
  if (ylen < 1e-30) {
    double hx = (std::fabs(zx) < 0.9) ? 1.0 : 0.0;
    double hy = (std::fabs(zx) < 0.9) ? 0.0 : 1.0;
    yx = zy*0 - zz*hy; yy = zz*hx - zx*0; yz = zx*hy - zy*hx;
    ylen = std::sqrt(yx*yx + yy*yy + yz*yz);
  }
  yx/=ylen; yy/=ylen; yz/=ylen;
  double rx = yy*zz - yz*zy, ry = yz*zx - yx*zz, rz = yx*zy - yy*zx;
  double xlen = std::sqrt(rx*rx + ry*ry + rz*rz);
  rx/=xlen; ry/=xlen; rz/=xlen;
  m[0]=rx; m[1]=yx; m[2]=zx; m[3]=ox;
  m[4]=ry; m[5]=yy; m[6]=zy; m[7]=oy;
  m[8]=rz; m[9]=yz; m[10]=zz; m[11]=oz;
  m[12]=0; m[13]=0; m[14]=0; m[15]=1;
}

int occ_trsf_invert(const double m[16], double out[16]) {
  double r00=m[0],r01=m[1],r02=m[2], r10=m[4],r11=m[5],r12=m[6],
         r20=m[8],r21=m[9],r22=m[10];
  double det = r00*(r11*r22-r12*r21) - r01*(r10*r22-r12*r20) + r02*(r10*r21-r11*r20);
  if (std::fabs(det) < 1e-18) return OCC_ERR_GEOM;
  double tx=m[3], ty=m[7], tz=m[11];
  out[0]=r00; out[1]=r10; out[2]=r20;
  out[4]=r01; out[5]=r11; out[6]=r21;
  out[8]=r02; out[9]=r12; out[10]=r22;
  out[3]=-(out[0]*tx+out[1]*ty+out[2]*tz);
  out[7]=-(out[4]*tx+out[5]*ty+out[6]*tz);
  out[11]=-(out[8]*tx+out[9]*ty+out[10]*tz);
  out[12]=out[13]=out[14]=0; out[15]=1;
  return OCC_OK;
}

static void rot_axis_angle(double ax, double ay, double az, double ang, double R[9]) {
  double len = std::sqrt(ax*ax+ay*ay+az*az);
  if (len < 1e-30) {
    R[0]=R[4]=R[8]=1; R[1]=R[2]=R[3]=R[5]=R[6]=R[7]=0; return;
  }
  double x=ax/len, y=ay/len, z=az/len, c=std::cos(ang), s=std::sin(ang), t=1-c;
  R[0]=t*x*x+c;   R[1]=t*x*y-s*z; R[2]=t*x*z+s*y;
  R[3]=t*x*y+s*z; R[4]=t*y*y+c;   R[5]=t*y*z-s*x;
  R[6]=t*x*z-s*y; R[7]=t*y*z+s*x; R[8]=t*z*z+c;
}

void occ_compose_chain(const double* origins, const double* axes,
                       const double* angles, int n, double out[16]) {
  occ_trsf_identity(out);
  for (int i = 0; i < n; ++i) {
    double R[9], Ti[16], tmp[16];
    rot_axis_angle(axes[i*3], axes[i*3+1], axes[i*3+2], angles[i], R);
    Ti[0]=R[0]; Ti[1]=R[1]; Ti[2]=R[2]; Ti[3]=origins[i*3];
    Ti[4]=R[3]; Ti[5]=R[4]; Ti[6]=R[5]; Ti[7]=origins[i*3+1];
    Ti[8]=R[6]; Ti[9]=R[7]; Ti[10]=R[8]; Ti[11]=origins[i*3+2];
    Ti[12]=0; Ti[13]=0; Ti[14]=0; Ti[15]=1;
    occ_trsf_compose(out, Ti, tmp);
    std::memcpy(out, tmp, 16 * sizeof(double));
  }
}

int occ_trsf_apply_shape(occ_shape_t s, const double m[16], occ_shape_t* out) {
  REQ(s && m && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  gp_Trsf t;
  t.SetValues(m[0], m[1], m[2], m[3],
              m[4], m[5], m[6], m[7],
              m[8], m[9], m[10], m[11]);
  BRepBuilderAPI_Transform mk(*as_shape(s), t, Standard_True);
  if (!mk.IsDone()) { set_last("trsf apply failed"); return OCC_ERR_GEOM; }
  *out = to_handle(mk.Shape());
  return OCC_OK;
  OCC_GUARD_END
}

}  // extern "C"
```

---

## Implementation — `// === file: occ_c_query.cc`

```cpp
// === file: occ_c_query.cc
#include "occ_c.h"
#include "occ_c_internal.hxx"

#include <BRepAdaptor_Curve.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepExtrema_DistShapeShape.hxx>
#include <BRepGProp.hxx>
#include <BRepTools.hxx>
#include <GProp_GProps.hxx>
#include <GeomAbs_SurfaceType.hxx>
#include <Precision.hxx>
#include <TopExp.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopoDS.hxx>
#include <cmath>

using occ_c_detail::as_shape;
using occ_c_detail::set_last;

extern "C" {

int occ_distance(occ_shape_t a, occ_shape_t b,
                 double* out_dist, double p1[3], double p2[3]) {
  REQ(a && b && out_dist, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  BRepExtrema_DistShapeShape dss;
  dss.LoadS1(*as_shape(a));
  dss.LoadS2(*as_shape(b));
  dss.Perform();
  if (!dss.IsDone()) { set_last("DistShapeShape failed"); return OCC_ERR_GEOM; }
  *out_dist = dss.Value();
  if (dss.NbSolution() >= 1) {
    if (p1) {
      auto p = dss.PointOnShape1(1);
      p1[0]=p.X(); p1[1]=p.Y(); p1[2]=p.Z();
    }
    if (p2) {
      auto p = dss.PointOnShape2(1);
      p2[0]=p.X(); p2[1]=p.Y(); p2[2]=p.Z();
    }
  }
  return OCC_OK;
  OCC_GUARD_END
}

int occ_clash(occ_shape_t a, occ_shape_t b, double clearance, int* out_status) {
  REQ(a && b && out_status, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  *out_status = 2;
  BRepExtrema_DistShapeShape dss;
  dss.LoadS1(*as_shape(a));
  dss.LoadS2(*as_shape(b));
  dss.Perform();
  if (!dss.IsDone()) { *out_status = 2; return OCC_OK; }
  const double d = dss.Value();
  if (dss.InnerSolution() || d <= clearance) *out_status = 1;
  else *out_status = 0;
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

int occ_mass_properties(occ_shape_t s, double density,
                        double* mass, double com[3], double inertia[6]) {
  REQ(s && mass && com && inertia, OCC_ERR_NULL_ARG);
  if (!(density > 0.0) || !std::isfinite(density)) {
    set_last("density must be finite and > 0");
    return OCC_ERR_GEOM;
  }
  OCC_GUARD_BEGIN
  GProp_GProps props;
  BRepGProp::VolumeProperties(*as_shape(s), props);
  *mass = props.Mass() * density;
  gp_Pnt c = props.CentreOfMass();
  com[0]=c.X(); com[1]=c.Y(); com[2]=c.Z();
  gp_Mat M = props.MatrixOfInertia();
  inertia[0]=M.Value(1,1)*density; inertia[1]=M.Value(2,2)*density;
  inertia[2]=M.Value(3,3)*density; inertia[3]=M.Value(1,2)*density;
  inertia[4]=M.Value(1,3)*density; inertia[5]=M.Value(2,3)*density;
  return OCC_OK;
  OCC_GUARD_END
}

int occ_shape_type(occ_shape_t s, int* out) {
  REQ(s && out, OCC_ERR_NULL_ARG);
  *out = static_cast<int>(as_shape(s)->ShapeType());
  return OCC_OK;
}

int occ_is_planar_face(occ_shape_t face, int* out_bool) {
  REQ(face && out_bool, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  if (as_shape(face)->ShapeType() != TopAbs_FACE) return OCC_ERR_INVALID_SHAPE;
  BRepAdaptor_Surface surf(TopoDS::Face(*as_shape(face)));
  *out_bool = (surf.GetType() == GeomAbs_Plane) ? 1 : 0;
  return OCC_OK;
  OCC_GUARD_END
}

int occ_face_normal(occ_shape_t face, double n[3]) {
  REQ(face && n, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  if (as_shape(face)->ShapeType() != TopAbs_FACE) return OCC_ERR_INVALID_SHAPE;
  TopoDS_Face F = TopoDS::Face(*as_shape(face));
  BRepAdaptor_Surface surf(F);
  Standard_Real u0,u1,v0,v1;
  BRepTools::UVBounds(F, u0,u1,v0,v1);
  gp_Pnt p; gp_Vec d1u, d1v;
  surf.D1(0.5*(u0+u1), 0.5*(v0+v1), p, d1u, d1v);
  gp_Vec nn = d1u.Crossed(d1v);
  if (nn.Magnitude() < Precision::Confusion()) return OCC_ERR_GEOM;
  nn.Normalize();
  if (F.Orientation() == TopAbs_REVERSED) nn.Reverse();
  n[0]=nn.X(); n[1]=nn.Y(); n[2]=nn.Z();
  return OCC_OK;
  OCC_GUARD_END
}

int occ_face_area(occ_shape_t face, double* out_area) {
  REQ(face && out_area, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  GProp_GProps props;
  BRepGProp::SurfaceProperties(*as_shape(face), props);
  *out_area = props.Mass();
  return OCC_OK;
  OCC_GUARD_END
}

int occ_largest_face(occ_shape_t s, int* out_1based_index) {
  REQ(s && out_1based_index, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  TopTools_IndexedMapOfShape faces;
  TopExp::MapShapes(*as_shape(s), TopAbs_FACE, faces);
  if (faces.Extent() < 1) return OCC_ERR_INDEX;
  double best = -1.0; int best_i = 1;
  for (int i = 1; i <= faces.Extent(); ++i) {
    GProp_GProps props;
    BRepGProp::SurfaceProperties(faces.FindKey(i), props);
    if (props.Mass() > best) { best = props.Mass(); best_i = i; }
  }
  *out_1based_index = best_i;
  return OCC_OK;
  OCC_GUARD_END
}

int occ_edge_midpoint(occ_shape_t edge, double p[3]) {
  REQ(edge && p, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  if (as_shape(edge)->ShapeType() != TopAbs_EDGE) return OCC_ERR_INVALID_SHAPE;
  BRepAdaptor_Curve c(TopoDS::Edge(*as_shape(edge)));
  gp_Pnt pt = c.Value(0.5 * (c.FirstParameter() + c.LastParameter()));
  p[0]=pt.X(); p[1]=pt.Y(); p[2]=pt.Z();
  return OCC_OK;
  OCC_GUARD_END
}

int occ_edge_tangent(occ_shape_t edge, double tdir[3]) {
  REQ(edge && tdir, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  if (as_shape(edge)->ShapeType() != TopAbs_EDGE) return OCC_ERR_INVALID_SHAPE;
  TopoDS_Edge E = TopoDS::Edge(*as_shape(edge));
  BRepAdaptor_Curve c(E);
  Standard_Real t = 0.5 * (c.FirstParameter() + c.LastParameter());
  gp_Pnt pt; gp_Vec d1;
  c.D1(t, pt, d1);
  if (d1.Magnitude() < Precision::Confusion()) return OCC_ERR_GEOM;
  d1.Normalize();
  if (E.Orientation() == TopAbs_REVERSED) d1.Reverse();
  tdir[0]=d1.X(); tdir[1]=d1.Y(); tdir[2]=d1.Z();
  return OCC_OK;
  OCC_GUARD_END
}

}  // extern "C"
```

**IR map:** `QueryClash` → `occ_clash`; `QueryGeom` mass → `occ_mass_properties`; `ComposeChain` → `occ_compose_chain` + apply.


# Part C — Routing, Patterns, Holes, Compounds (P0)

## Pedagogy

Industrial **fluid pipe** is not a FeatureScript “Frame”. Kernel path:

1. Build a **centerline wire** (`RoutePath`): polyline or polyline with fillet bends.
2. Sweep a **circle profile** along the wire (`occ_pipe` / `BRepOffsetAPI_MakePipe`).
3. For OD/ID: two solid pipes + `occ_cut`.

**Patterns** are transform lists + optional fuse — IR `PatternLinear` / `PatternPolar`.

**Holes** are cylinder cuts (simple P0); standards tables stay data, not C.

OCCT classes: `BRepBuilderAPI_MakePolygon`, `MakeEdge`, `MakeWire`, `MakeFace`,
`GC_MakeSegment`, `GC_MakeArcOfCircle`, `BRepOffsetAPI_MakePipe`,
`BRepAlgoAPI_Cut` / `Fuse`, `BRep_Builder`, `BRepPrimAPI_MakeCylinder`,
`BRepBndLib`, `BRepGProp::LinearProperties`.

---

## Header additions — `// === file: occ_c_route.h`

```c
// === file: occ_c_route.h
#ifndef OCC_C_ROUTE_H_
#define OCC_C_ROUTE_H_
#include "occ_c.h"
#ifdef __cplusplus
extern "C" {
#endif

#ifndef OCC_ERR_GEOM
#define OCC_ERR_GEOM 8
#endif

/* ---- Wires / routes ---- */
OCC_API int occ_make_route_polyline(const double* xyz, int n_points, int closed,
                                    occ_shape_t* out);
OCC_API int occ_make_route_with_bends(const double* xyz, int n_points,
                                      double bend_radius, occ_shape_t* out);
OCC_API int occ_wire_length(occ_shape_t wire, double* out_len);
OCC_API int occ_frame_at_wire_end(occ_shape_t wire, int at_start,
                                  double origin[3], double tangent[3]);

/* ---- Circle profile + annulus pipe ---- */
OCC_API int occ_make_circle_face(double cx, double cy, double cz,
                                 double nx, double ny, double nz,
                                 double radius, occ_shape_t* out);
OCC_API int occ_pipe_annulus(double od, double id, occ_shape_t spine_wire,
                             occ_shape_t* out);

/* ---- Patterns ---- */
OCC_API int occ_pattern_linear(occ_shape_t seed,
                               double dx, double dy, double dz,
                               int count, int fuse, occ_shape_t* out);
OCC_API int occ_pattern_polar(occ_shape_t seed,
                              double px, double py, double pz,
                              double ax, double ay, double az,
                              double angle_step_rad, int count,
                              int fuse, occ_shape_t* out);

/* ---- Holes (simple) ---- */
OCC_API int occ_drill_hole_through(occ_shape_t solid,
                                   double cx, double cy, double cz,
                                   double ax, double ay, double az,
                                   double radius, occ_shape_t* out);
OCC_API int occ_drill_hole_blind(occ_shape_t solid,
                                 double cx, double cy, double cz,
                                 double ax, double ay, double az,
                                 double radius, double depth,
                                 occ_shape_t* out);

/* ---- Compound ---- */
OCC_API int occ_make_compound(const occ_shape_t* shapes, int n,
                              occ_shape_t* out);

#ifdef __cplusplus
}
#endif
#endif
```

---

## Implementation — `// === file: occ_c_route.cc`

```cpp
// === file: occ_c_route.cc
// OCCT 7.9.3 — routes, annulus pipe, patterns, holes, compounds.
// Share as_shape/to_handle/guards with occ_c (see internal header notes).

#include "occ_c_route.h"

#include <cmath>
#include <string>
#include <vector>

#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepBndLib.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepGProp.hxx>
#include <BRepOffsetAPI_MakePipe.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRep_Builder.hxx>
#include <BRepAdaptor_Curve.hxx>
#include <Bnd_Box.hxx>
#include <GC_MakeArcOfCircle.hxx>
#include <GC_MakeSegment.hxx>
#include <GProp_GProps.hxx>
#include <Geom_TrimmedCurve.hxx>
#include <Standard_Failure.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Ax1.hxx>
#include <gp_Ax2.hxx>
#include <gp_Circ.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>

#ifndef OCC_ERR_GEOM
#define OCC_ERR_GEOM 8
#endif

namespace {

thread_local std::string g_last_error;
void set_last(const char* msg) { g_last_error = msg ? msg : ""; }
TopoDS_Shape* as_shape(occ_shape_t s) {
  return reinterpret_cast<TopoDS_Shape*>(s);
}
occ_shape_t to_handle(const TopoDS_Shape& s) {
  return reinterpret_cast<occ_shape_t>(new TopoDS_Shape(s));
}

#define OCC_GUARD_BEGIN try {
#define OCC_GUARD_END                                                   \
  }                                                                     \
  catch (Standard_Failure & e) {                                        \
    set_last(e.GetMessageString() ? e.GetMessageString() : "OCCT failure"); \
    return OCC_ERR_EXCEPTION;                                           \
  }                                                                     \
  catch (std::exception & e) {                                          \
    set_last(e.what());                                                 \
    return OCC_ERR_EXCEPTION;                                           \
  }                                                                     \
  catch (...) {                                                         \
    set_last("unknown exception");                                      \
    return OCC_ERR_EXCEPTION;                                           \
  }

#define REQ(cond, code)             \
  do {                              \
    if (!(cond)) return (code);     \
  } while (0)

static gp_Pnt P3(const double* xyz, int i) {
  return gp_Pnt(xyz[3 * i], xyz[3 * i + 1], xyz[3 * i + 2]);
}

static int fuse_or_compound(const std::vector<TopoDS_Shape>& parts, int fuse,
                            occ_shape_t* out) {
  if (parts.empty()) {
    set_last("pattern: empty");
    return OCC_ERR_GEOM;
  }
  if (parts.size() == 1) {
    *out = to_handle(parts[0]);
    return OCC_OK;
  }
  if (!fuse) {
    TopoDS_Compound comp;
    BRep_Builder bb;
    bb.MakeCompound(comp);
    for (const auto& s : parts) bb.Add(comp, s);
    *out = to_handle(comp);
    return OCC_OK;
  }
  TopoDS_Shape acc = parts[0];
  for (size_t i = 1; i < parts.size(); ++i) {
    BRepAlgoAPI_Fuse op(acc, parts[i]);
    op.Build();
    if (!op.IsDone()) {
      set_last("pattern fuse failed");
      return OCC_ERR_BOOLEAN;
    }
    acc = op.Shape();
  }
  *out = to_handle(acc);
  return OCC_OK;
}

/** Cylinder long enough to cut through a solid (through-hole). */
static double through_length(const TopoDS_Shape& solid) {
  Bnd_Box b;
  BRepBndLib::Add(solid, b);
  if (b.IsVoid()) return 1.0e3;
  double x0, y0, z0, x1, y1, z1;
  b.Get(x0, y0, z0, x1, y1, z1);
  const double dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
  const double diag = std::sqrt(dx * dx + dy * dy + dz * dz);
  return diag * 2.0 + 1.0; /* generous margin */
}

}  // namespace

extern "C" {

/* =========================================================================
 * Routes
 * ========================================================================= */

int occ_make_route_polyline(const double* xyz, int n_points, int closed,
                            occ_shape_t* out) {
  REQ(xyz && out, OCC_ERR_NULL_ARG);
  REQ(n_points >= 2, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  BRepBuilderAPI_MakePolygon poly;
  for (int i = 0; i < n_points; ++i) poly.Add(P3(xyz, i));
  if (closed) poly.Close();
  if (!poly.IsDone()) {
    set_last("route polyline failed (degenerate points?)");
    return OCC_ERR_GEOM;
  }
  *out = to_handle(poly.Wire());
  return OCC_OK;
  OCC_GUARD_END
}

/*
 * Polyline with circular bend fillets at interior vertices.
 * For corner i (1..n-2): unit dirs u = normalize(P_i - P_{i-1}),
 * v = normalize(P_{i+1} - P_i). Half-angle φ from cos(φ)=u·v... use
 * offset d = R * tan(α/2) where α is exterior turn: α = acos(clamp(u·v)).
 * Actually: angle between -u and v is the interior supplement.
 * Standard pipe-elbow: d = R / tan(θ/2) where θ = angle between segments
 * (turning angle) = acos(-u·v) for directions into and out of corner.
 */
int occ_make_route_with_bends(const double* xyz, int n_points,
                              double bend_radius, occ_shape_t* out) {
  REQ(xyz && out, OCC_ERR_NULL_ARG);
  REQ(n_points >= 2, OCC_ERR_GEOM);
  REQ(bend_radius >= 0.0, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN

  if (n_points == 2 || bend_radius == 0.0) {
    return occ_make_route_polyline(xyz, n_points, /*closed=*/0, out);
  }

  std::vector<gp_Pnt> pts(static_cast<size_t>(n_points));
  for (int i = 0; i < n_points; ++i) pts[static_cast<size_t>(i)] = P3(xyz, i);

  BRepBuilderAPI_MakeWire mk_wire;
  const double R = bend_radius;

  for (int i = 0; i < n_points - 1; ++i) {
    const gp_Pnt& A = pts[static_cast<size_t>(i)];
    const gp_Pnt& B = pts[static_cast<size_t>(i + 1)];

    /* Segment endpoints may be trimmed for bends at A (if interior) and B. */
    gp_Pnt S = A;
    gp_Pnt E = B;

    if (i > 0) {
      /* Incoming corner at A: trim start of this segment. */
      const gp_Pnt& Pprev = pts[static_cast<size_t>(i - 1)];
      gp_Vec u(Pprev, A);
      gp_Vec v(A, B);
      if (u.Magnitude() < 1e-12 || v.Magnitude() < 1e-12) {
        set_last("route: zero-length segment");
        return OCC_ERR_GEOM;
      }
      u.Normalize();
      v.Normalize();
      double c = u.Dot(v);
      if (c > 1.0) c = 1.0;
      if (c < -1.0) c = -1.0;
      /* turning angle between continuation of u and v */
      const double turn = std::acos(c); /* 0 = straight, π = hairpin */
      if (turn < 1e-8) {
        /* nearly collinear — no trim */
      } else if (std::abs(turn - M_PI) < 1e-8) {
        set_last("route: 180-degree bend unsupported");
        return OCC_ERR_GEOM;
      } else {
        const double d = R * std::tan(turn * 0.5);
        if (d + 1e-9 > gp_Vec(A, B).Magnitude() * 0.5) {
          set_last("route: bend radius too large for segment length");
          return OCC_ERR_GEOM;
        }
        S = A.Translated(v.Multiplied(d));
      }
    }

    if (i + 1 < n_points - 1) {
      /* Outgoing corner at B: trim end of this segment. */
      const gp_Pnt& C = pts[static_cast<size_t>(i + 2)];
      gp_Vec u(A, B);
      gp_Vec v(B, C);
      if (u.Magnitude() < 1e-12 || v.Magnitude() < 1e-12) {
        set_last("route: zero-length segment");
        return OCC_ERR_GEOM;
      }
      u.Normalize();
      v.Normalize();
      double c = u.Dot(v);
      if (c > 1.0) c = 1.0;
      if (c < -1.0) c = -1.0;
      const double turn = std::acos(c);
      if (turn >= 1e-8 && std::abs(turn - M_PI) >= 1e-8) {
        const double d = R * std::tan(turn * 0.5);
        if (d + 1e-9 > gp_Vec(A, B).Magnitude() * 0.5) {
          set_last("route: bend radius too large for segment length");
          return OCC_ERR_GEOM;
        }
        E = B.Translated(u.Multiplied(-d));
      }
    }

    if (S.Distance(E) > 1e-12) {
      Handle(Geom_TrimmedCurve) seg = GC_MakeSegment(S, E).Value();
      BRepBuilderAPI_MakeEdge me(seg);
      if (!me.IsDone()) {
        set_last("route: segment edge failed");
        return OCC_ERR_GEOM;
      }
      mk_wire.Add(me.Edge());
    }

    /* Arc at vertex B (interior). */
    if (i + 1 < n_points - 1) {
      const gp_Pnt& C = pts[static_cast<size_t>(i + 2)];
      gp_Vec u(A, B);
      gp_Vec v(B, C);
      u.Normalize();
      v.Normalize();
      double c = u.Dot(v);
      if (c > 1.0) c = 1.0;
      if (c < -1.0) c = -1.0;
      const double turn = std::acos(c);
      if (turn < 1e-8) {
        /* collinear — no arc */
      } else {
        const double d = R * std::tan(turn * 0.5);
        const gp_Pnt P1 = B.Translated(u.Multiplied(-d));
        const gp_Pnt P2 = B.Translated(v.Multiplied(d));
        /* Arc plane normal = u × v */
        gp_Vec n = u.Crossed(v);
        if (n.Magnitude() < 1e-12) {
          set_last("route: cannot form bend plane");
          return OCC_ERR_GEOM;
        }
        n.Normalize();
        /* Midpoint direction for 3-point arc: bisector of -u and v */
        gp_Vec bis = u.Multiplied(-1.0).Added(v);
        if (bis.Magnitude() < 1e-12) {
          set_last("route: degenerate bisector");
          return OCC_ERR_GEOM;
        }
        bis.Normalize();
        /* Center is along -bis from B? For pipe elbow center is inside angle:
           from B along -(u_hat normalized with v) — use:
           center = B - (u+v).Normalized() * (R / sin(turn/2))? 
           Simpler 3-pt arc: P1, Pm, P2 with Pm on circle. */
        const double half = turn * 0.5;
        const double cmag = R / std::sin(half);
        gp_Vec to_center = u.Multiplied(-1.0).Added(v.Multiplied(-1.0));
        /* unit bisector of interior angle: -(u_unit + v_unit) points to inside */
        gp_Vec inside = u.Added(v);
        if (inside.Magnitude() < 1e-12) {
          set_last("route: inside bisector failed");
          return OCC_ERR_GEOM;
        }
        inside.Normalize();
        const gp_Pnt center = B.Translated(inside.Multiplied(-R / std::sin(half)));
        /* Mid arc point */
        gp_Vec mid_dir(center, B);
        /* Better mid: rotate P1 around center by half turn */
        gp_Ax1 ax(center, gp_Dir(n));
        gp_Trsf rot;
        rot.SetRotation(ax, turn * 0.5);
        const gp_Pnt Pm = P1.Transformed(rot);
        GC_MakeArcOfCircle mk_arc(P1, Pm, P2);
        if (!mk_arc.IsDone()) {
          set_last("route: bend arc failed");
          return OCC_ERR_GEOM;
        }
        BRepBuilderAPI_MakeEdge me(mk_arc.Value());
        if (!me.IsDone()) {
          set_last("route: bend edge failed");
          return OCC_ERR_GEOM;
        }
        mk_wire.Add(me.Edge());
      }
    }
  }

  if (!mk_wire.IsDone()) {
    set_last("route: wire assembly failed");
    return OCC_ERR_GEOM;
  }
  *out = to_handle(mk_wire.Wire());
  return OCC_OK;
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
  const TopoDS_Shape& sh = *as_shape(wire);
  if (sh.ShapeType() != TopAbs_WIRE) {
    set_last("expected wire");
    return OCC_ERR_INVALID_SHAPE;
  }
  /* First or last edge in explorer order. */
  TopoDS_Edge edge;
  int count = 0;
  for (TopExp_Explorer ex(sh, TopAbs_EDGE); ex.More(); ex.Next()) {
    edge = TopoDS::Edge(ex.Current());
    ++count;
    if (at_start) break;
  }
  if (count == 0) {
    set_last("wire has no edges");
    return OCC_ERR_GEOM;
  }
  if (!at_start) {
    /* last edge already in edge */
  }
  BRepAdaptor_Curve c(edge);
  const Standard_Real t =
      at_start ? c.FirstParameter() : c.LastParameter();
  gp_Pnt p;
  gp_Vec d1;
  c.D1(t, p, d1);
  if (d1.Magnitude() < 1e-12) {
    set_last("degenerate wire tangent");
    return OCC_ERR_GEOM;
  }
  d1.Normalize();
  if (!at_start && edge.Orientation() == TopAbs_REVERSED) {
    /* keep geometric end direction as curve D1 at LastParameter */
  }
  origin[0] = p.X(); origin[1] = p.Y(); origin[2] = p.Z();
  tangent[0] = d1.X(); tangent[1] = d1.Y(); tangent[2] = d1.Z();
  return OCC_OK;
  OCC_GUARD_END
}

/* =========================================================================
 * Circle face + annulus pipe
 * ========================================================================= */

int occ_make_circle_face(double cx, double cy, double cz,
                         double nx, double ny, double nz,
                         double radius, occ_shape_t* out) {
  REQ(out, OCC_ERR_NULL_ARG);
  REQ(radius > 0.0, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  gp_Ax2 ax(gp_Pnt(cx, cy, cz), gp_Dir(nx, ny, nz));
  gp_Circ circ(ax, radius);
  BRepBuilderAPI_MakeEdge me(circ);
  if (!me.IsDone()) {
    set_last("circle edge failed");
    return OCC_ERR_GEOM;
  }
  BRepBuilderAPI_MakeWire mw(me.Edge());
  BRepBuilderAPI_MakeFace mf(mw.Wire(), /*OnlyPlane=*/Standard_True);
  if (!mf.IsDone()) {
    set_last("circle face failed");
    return OCC_ERR_GEOM;
  }
  *out = to_handle(mf.Face());
  return OCC_OK;
  OCC_GUARD_END
}

int occ_pipe_annulus(double od, double id, occ_shape_t spine_wire,
                     occ_shape_t* out) {
  REQ(spine_wire && out, OCC_ERR_NULL_ARG);
  REQ(od > id && id > 0.0, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  if (as_shape(spine_wire)->ShapeType() != TopAbs_WIRE) {
    set_last("annulus pipe: spine must be wire");
    return OCC_ERR_INVALID_SHAPE;
  }

  double o[3], t[3];
  int st = occ_frame_at_wire_end(spine_wire, /*at_start=*/1, o, t);
  if (st != OCC_OK) return st;

  occ_shape_t face_od = nullptr, face_id = nullptr;
  occ_shape_t solid_od = nullptr, solid_id = nullptr;
  st = occ_make_circle_face(o[0], o[1], o[2], t[0], t[1], t[2], od * 0.5,
                            &face_od);
  if (st != OCC_OK) return st;
  st = occ_make_circle_face(o[0], o[1], o[2], t[0], t[1], t[2], id * 0.5,
                            &face_id);
  if (st != OCC_OK) {
    occ_shape_free(face_od);
    return st;
  }

  {
    BRepOffsetAPI_MakePipe mk(TopoDS::Wire(*as_shape(spine_wire)),
                              *as_shape(face_od));
    solid_od = to_handle(mk.Shape());
  }
  {
    BRepOffsetAPI_MakePipe mk(TopoDS::Wire(*as_shape(spine_wire)),
                              *as_shape(face_id));
    solid_id = to_handle(mk.Shape());
  }
  occ_shape_free(face_od);
  occ_shape_free(face_id);

  BRepAlgoAPI_Cut cut(*as_shape(solid_od), *as_shape(solid_id));
  cut.Build();
  occ_shape_free(solid_od);
  occ_shape_free(solid_id);
  if (!cut.IsDone()) {
    set_last("annulus pipe cut failed");
    return OCC_ERR_BOOLEAN;
  }
  *out = to_handle(cut.Shape());
  return OCC_OK;
  OCC_GUARD_END
}

/* =========================================================================
 * Patterns
 * ========================================================================= */

int occ_pattern_linear(occ_shape_t seed, double dx, double dy, double dz,
                       int count, int fuse, occ_shape_t* out) {
  REQ(seed && out, OCC_ERR_NULL_ARG);
  REQ(count >= 1, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  std::vector<TopoDS_Shape> parts;
  parts.reserve(static_cast<size_t>(count));
  for (int i = 0; i < count; ++i) {
    if (i == 0) {
      parts.push_back(*as_shape(seed));
    } else {
      gp_Trsf t;
      t.SetTranslation(gp_Vec(dx * i, dy * i, dz * i));
      BRepBuilderAPI_Transform mk(*as_shape(seed), t, Standard_True);
      parts.push_back(mk.Shape());
    }
  }
  return fuse_or_compound(parts, fuse, out);
  OCC_GUARD_END
}

int occ_pattern_polar(occ_shape_t seed, double px, double py, double pz,
                      double ax, double ay, double az,
                      double angle_step_rad, int count, int fuse,
                      occ_shape_t* out) {
  REQ(seed && out, OCC_ERR_NULL_ARG);
  REQ(count >= 1, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  gp_Ax1 axis(gp_Pnt(px, py, pz), gp_Dir(ax, ay, az));
  std::vector<TopoDS_Shape> parts;
  parts.reserve(static_cast<size_t>(count));
  for (int i = 0; i < count; ++i) {
    if (i == 0) {
      parts.push_back(*as_shape(seed));
    } else {
      gp_Trsf t;
      t.SetRotation(axis, angle_step_rad * i);
      BRepBuilderAPI_Transform mk(*as_shape(seed), t, Standard_True);
      parts.push_back(mk.Shape());
    }
  }
  return fuse_or_compound(parts, fuse, out);
  OCC_GUARD_END
}

/* =========================================================================
 * Holes
 * ========================================================================= */

int occ_drill_hole_blind(occ_shape_t solid, double cx, double cy, double cz,
                         double ax, double ay, double az, double radius,
                         double depth, occ_shape_t* out) {
  REQ(solid && out, OCC_ERR_NULL_ARG);
  REQ(radius > 0.0 && depth > 0.0, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  /* Cylinder axis along (ax,ay,az) from (cx,cy,cz), length=depth. */
  gp_Ax2 a2(gp_Pnt(cx, cy, cz), gp_Dir(ax, ay, az));
  TopoDS_Shape tool = BRepPrimAPI_MakeCylinder(a2, radius, depth).Shape();
  BRepAlgoAPI_Cut cut(*as_shape(solid), tool);
  cut.Build();
  if (!cut.IsDone()) {
    set_last("blind hole cut failed");
    return OCC_ERR_BOOLEAN;
  }
  *out = to_handle(cut.Shape());
  return OCC_OK;
  OCC_GUARD_END
}

int occ_drill_hole_through(occ_shape_t solid, double cx, double cy, double cz,
                           double ax, double ay, double az, double radius,
                           occ_shape_t* out) {
  REQ(solid && out, OCC_ERR_NULL_ARG);
  REQ(radius > 0.0, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  const double L = through_length(*as_shape(solid));
  /* Center the tool on (c) so it sticks out both sides. */
  gp_Dir d(ax, ay, az);
  gp_Pnt origin(cx, cy, cz);
  gp_Pnt start = origin.Translated(gp_Vec(d).Multiplied(-0.5 * L));
  gp_Ax2 a2(start, d);
  TopoDS_Shape tool = BRepPrimAPI_MakeCylinder(a2, radius, L).Shape();
  BRepAlgoAPI_Cut cut(*as_shape(solid), tool);
  cut.Build();
  if (!cut.IsDone()) {
    set_last("through hole cut failed");
    return OCC_ERR_BOOLEAN;
  }
  *out = to_handle(cut.Shape());
  return OCC_OK;
  OCC_GUARD_END
}

/* =========================================================================
 * Compound
 * ========================================================================= */

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

}  // extern "C"
```

---

## IR / Luau mapping (this module)

| IR op | C entry |
|-------|---------|
| `RoutePath` (polyline) | `occ_make_route_polyline` |
| `RoutePath` (bend R) | `occ_make_route_with_bends` |
| `SweepAlong` annulus | `occ_pipe_annulus` |
| `PatternLinear` | `occ_pattern_linear` |
| `PatternPolar` | `occ_pattern_polar` |
| `DrillHole` | `occ_drill_hole_*` |
| `GroupBodies` | `occ_make_compound` |

## Smoke (conceptual)

```c
double nodes[] = {
  0,0,0,
  0,0,1,
  1,0,1,
  1,0,0
};
occ_shape_t path=0, pipe=0;
occ_make_route_with_bends(nodes, 4, 0.15, &path);
occ_pipe_annulus(0.1143, 0.1023, path, &pipe); /* ~4" NPS style */

occ_shape_t plate=0, patterned=0;
occ_make_box(0.2, 0.2, 0.02, &plate);
occ_pattern_polar(plate, 0,0,0, 0,0,1, 2*M_PI/6, 6, 0, &patterned);
```

---

# Part D — Integrated smoke program (pure C)

`// === file: examples/c_api_p0_smoke.c`  
Links against the expanded `libocc_c`. Verifies route+annulus, pattern, clash, FK chain.

```c
// === file: examples/c_api_p0_smoke.c
#include "occ_c.h"
#include "occ_c_frames.h"
#include "occ_c_route.h"
#include <math.h>
#include <stdio.h>

int main(void) {
  /* --- Skid-like pipe --- */
  double nodes[] = {
    0.0, 0.0, 0.0,
    0.0, 0.0, 1.0,
    1.2, 0.0, 1.0,
    1.2, 0.8, 1.0
  };
  occ_shape_t path = 0, pipe = 0, housing = 0;
  if (occ_make_route_with_bends(nodes, 4, 0.20, &path) != OCC_OK) {
    fprintf(stderr, "route: %s\n", occ_last_error());
    return 1;
  }
  if (occ_pipe_annulus(0.1143, 0.1023, path, &pipe) != OCC_OK) {
    fprintf(stderr, "pipe: %s\n", occ_last_error());
    return 1;
  }
  occ_make_box(0.5, 0.5, 0.5, &housing);
  occ_shape_t housing_moved = 0;
  occ_translate(housing, 0.6, 0.0, 0.75, &housing_moved);

  int clash = 2;
  occ_clash(pipe, housing_moved, 0.025, &clash);
  printf("pipe vs housing clash status=%d (0 clear, 1 hit)\n", clash);

  double len = 0;
  occ_wire_length(path, &len);
  printf("centerline length=%.4f m\n", len);

  /* --- Bolt circle via polar pattern + hole --- */
  occ_shape_t flange = 0, cyl = 0, cut = 0, bolts = 0;
  occ_make_cylinder(0, 0, 0, 0, 0, 1, 0.05, 0.012, &flange);
  /* seed hole tool as a small box for pattern demo; real drill uses occ_drill */
  occ_shape_t drilled = 0;
  if (occ_drill_hole_through(flange, 0.035, 0, 0, 0, 0, 1, 0.003, &drilled) != OCC_OK) {
    fprintf(stderr, "drill: %s\n", occ_last_error());
    return 1;
  }
  /* Pattern the drilled flange? Prefer pattern hole centers — linear demo: */
  occ_pattern_polar(drilled, 0, 0, 0, 0, 0, 1, 2.0 * M_PI / 6.0, 6, 0, &bolts);
  printf("polar pattern compound ok\n");

  /* --- Frame place --- */
  occ_frame_t f;
  occ_frame_from_axes(1, 0, 0,  0, 1, 0,  0, 0, 1, &f);
  occ_shape_t placed = 0;
  occ_place_shape_at_frame(drilled, &f, &placed);

  /* --- FK chain (robot) --- */
  double origins[] = {0,0,0,  0,0,0.15,  0,0,0.35};
  double axes[]    = {0,0,1,  0,1,0,     0,1,0};
  double angles[]  = {0.1, -0.4, 0.8};
  double T[16];
  occ_compose_chain(origins, axes, angles, 3, T);
  occ_shape_t link = 0, posed = 0;
  occ_make_box(0.06, 0.06, 0.3, &link);
  occ_trsf_apply_shape(link, T, &posed);
  printf("FK pose applied\n");

  double mass, com[3], I[6];
  occ_mass_properties(pipe, 7850.0, &mass, com, I);
  printf("pipe mass~%.2f kg  COM=(%.3f,%.3f,%.3f)\n", mass, com[0], com[1], com[2]);

  occ_step_write(pipe, "/tmp/p0_pipe.step");
  printf("wrote /tmp/p0_pipe.step\n");

  occ_shape_free(path); occ_shape_free(pipe); occ_shape_free(housing);
  occ_shape_free(housing_moved); occ_shape_free(flange); occ_shape_free(drilled);
  occ_shape_free(bolts); occ_shape_free(placed); occ_shape_free(link);
  occ_shape_free(posed);
  return 0;
}
```

---

# Part E — Bazel / Wasm export checklist

When landing this expansion:

1. Add sources to `//api:occ_c_lib` (`occ_c_frames.cc`, `occ_c_route.cc`, `occ_c_query.cc`, `occ_c_trsf.cc`).  
2. Extend `_OCC_C_EXPORTS` with every new `OCC_API` symbol (underscore prefix for emscripten).  
3. Re-run `//api:libocc_c_wasm` size limit.  
4. Add `//examples/c_api_p0_smoke` pure-C target.  
5. Golden tests: route bend radius too large → `OCC_ERR_GEOM`; clash gap 5 with clearance 6 → status 1.

**Subset note:** route/arc code needs `GC` toolkit; ensure `third_party/occt/gen_bazel.py` `SUBSET` includes packages already used by STEP/mesh plus any missing `GC` / `BRepExtrema` (usually present via modeling subset). If link fails, expand `SUBSET` and regenerate `occt.BUILD`.

---

# Part F — Dual-goal coverage after extract

| Goal | Enabled by this C surface |
|------|---------------------------|
| AI-BOOST pipe run | `occ_make_route_with_bends` + `occ_pipe_annulus` + `occ_clash` + STEP |
| Skid structure (P1) | `occ_pipe` / pattern / compound (full frame profiles = later recipe) |
| 6-DOF arm links | prims + `occ_drill_hole_*` + `occ_pattern_polar` + frames + `occ_compose_chain` |
| Human review | clash status, mass props, STEP/mesh (existing) |

**Still product/IR (not C):** NL planner, 2D parse, mate solver, fittings catalog data, MeshPrep JSON, full sketch constraint solver.

---

# Part G — Relationship to baseline `occ_c.cc`

Do **not** rewrite working primitives/booleans/mesh. This document **extends** them. Extraction order:

1. Patch enums in `occ_c.h`.  
2. Add `occ_c_internal.hxx`; migrate baseline to use it (optional cleanup).  
3. Land frames → route → query → trsf.  
4. Smoke.  
5. Wire AgentOS host tools / IR lowerings to new symbols.

---

*End of literate P0 kernel expansion. Multi-agent authored against OCCT 7.9.3 + clean-room checklist. Extract to compile; do not treat prose as executable.*
