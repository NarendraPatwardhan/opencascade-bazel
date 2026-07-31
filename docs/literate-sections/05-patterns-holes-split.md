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
