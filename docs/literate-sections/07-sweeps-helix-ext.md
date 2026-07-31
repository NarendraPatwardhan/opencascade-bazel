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
