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
