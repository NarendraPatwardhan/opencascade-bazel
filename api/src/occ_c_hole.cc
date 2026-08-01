// Through / blind / counterbore / countersink / face-center holes.
// Through length ≈ 2×AABB diagonal, tool centered on origin (both sides).
// Face-center orients the drill with a solid-classifier “enter from outside”
// heuristic (see orient_drill_inward).
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
