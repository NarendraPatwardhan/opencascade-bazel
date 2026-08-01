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
