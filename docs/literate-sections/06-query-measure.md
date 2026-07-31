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
