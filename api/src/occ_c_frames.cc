// OCCT 7.9.3 — pure SE(3) frames + BREP placement.

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
