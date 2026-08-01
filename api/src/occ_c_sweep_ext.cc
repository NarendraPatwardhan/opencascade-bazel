// Public header: occ_c_sweep.h (this .cc keeps the _ext filename).
// Extended sweeps: extrude extents, helix, pipe/spring, thicken, sew.
// Helix: UV segment on a cylinder surface lifted to 3D (make_helix_edge).
// Through-all: prism length = 2×bbox diagonal, centered on profile (tool only).
// Spring: circle profile at helix start, plane ⊥ start tangent, then pipe.
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

/* Thin wrappers over baseline occ_bbox. */
int occ_sweep_bbox(occ_shape_t s, double out_min[3], double out_max[3]) {
  return occ_bbox(s, out_min, out_max);
}

int occ_sweep_bbox_diagonal(occ_shape_t s, double* out_diag) {
  REQ(s && out_diag, OCC_ERR_NULL_ARG);
  double mn[3], mx[3];
  const int st = occ_bbox(s, mn, mx);
  if (st != OCC_OK) return st;
  const double dx = mx[0] - mn[0];
  const double dy = mx[1] - mn[1];
  const double dz = mx[2] - mn[2];
  *out_diag = std::sqrt(dx * dx + dy * dy + dz * dz);
  return OCC_OK;
}

/* =========================================================================
 * Linear extrude extents
 * ========================================================================= */

/* Alias of baseline occ_extrude (MakePrism). */
int occ_extrude_blind(occ_shape_t profile,
                      double dx, double dy, double dz,
                      occ_shape_t* out) {
  return occ_extrude(profile, dx, dy, dz, out);
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

/* Alias of baseline occ_pipe (MakePipe). */
int occ_sweep_profile_along_wire(occ_shape_t profile, occ_shape_t spine_wire,
                                 occ_shape_t* out) {
  return occ_pipe(profile, spine_wire, out);
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
