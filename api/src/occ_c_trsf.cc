// OCCT 7.9.3 — SE(3) matrix math + serial FK + shape apply.
// Extract into api/src/occ_c_trsf.cc

#include "occ_c_trsf.h"
#include "occ_c_internal.hxx"

#include <cmath>
#include <cstring>

#include <BRepBuilderAPI_Transform.hxx>
#include <gp_Trsf.hxx>

using occ_c_detail::as_shape;
using occ_c_detail::to_handle;
using occ_c_detail::set_last;

namespace {

constexpr double k_eps = 1.0e-18;

inline void mat4_zero(double m[16]) {
  std::memset(m, 0, 16 * sizeof(double));
}

void mat4_mul(const double a[16], const double b[16], double out[16]) {
  double t[16];
  for (int i = 0; i < 4; ++i) {
    for (int j = 0; j < 4; ++j) {
      double s = 0.0;
      for (int k = 0; k < 4; ++k) {
        s += a[i * 4 + k] * b[k * 4 + j];
      }
      t[i * 4 + j] = s;
    }
  }
  std::memcpy(out, t, 16 * sizeof(double));
}

/* Rodrigues rotation about unit axis (ax,ay,az), angle ang → 3x3 row-major R[9]. */
void rot_axis_angle(double ax, double ay, double az, double ang, double R[9]) {
  double len = std::sqrt(ax * ax + ay * ay + az * az);
  if (len < 1.0e-30) {
    R[0] = R[4] = R[8] = 1.0;
    R[1] = R[2] = R[3] = R[5] = R[6] = R[7] = 0.0;
    return;
  }
  const double x = ax / len, y = ay / len, z = az / len;
  const double c = std::cos(ang), s = std::sin(ang), t = 1.0 - c;
  R[0] = t * x * x + c;     R[1] = t * x * y - s * z; R[2] = t * x * z + s * y;
  R[3] = t * x * y + s * z; R[4] = t * y * y + c;     R[5] = t * y * z - s * x;
  R[6] = t * x * z - s * y; R[7] = t * y * z + s * x; R[8] = t * z * z + c;
}

/* Pack R(3x3 row-major) + translation into 4x4 row-major. */
void pack_Rt(const double R[9], double tx, double ty, double tz, double m[16]) {
  m[0] = R[0]; m[1] = R[1]; m[2] = R[2]; m[3] = tx;
  m[4] = R[3]; m[5] = R[4]; m[6] = R[5]; m[7] = ty;
  m[8] = R[6]; m[9] = R[7]; m[10] = R[8]; m[11] = tz;
  m[12] = 0.0; m[13] = 0.0; m[14] = 0.0; m[15] = 1.0;
}

/* Pure translation 4x4. */
void mat4_trans(double tx, double ty, double tz, double m[16]) {
  occ_trsf_identity(m);
  m[3] = tx; m[7] = ty; m[11] = tz;
}

/* RotZ / RotX for DH. */
void mat4_rotz(double th, double m[16]) {
  const double c = std::cos(th), s = std::sin(th);
  occ_trsf_identity(m);
  m[0] = c;  m[1] = -s;
  m[4] = s;  m[5] = c;
}

void mat4_rotx(double al, double m[16]) {
  const double c = std::cos(al), s = std::sin(al);
  occ_trsf_identity(m);
  m[5] = c;  m[6] = -s;
  m[9] = s;  m[10] = c;
}

/* Convert 4x4 placement (local→world) into occ_frame_t via columns. */
int frame_from_mat4(const double m[16], occ_frame_t* out) {
  /* Columns of R are axes. */
  double xx = m[0], xy = m[4], xz = m[8];
  double yx = m[1], yy = m[5], yz = m[9];
  double zx = m[2], zy = m[6], zz = m[10];
  double ox = m[3], oy = m[7], oz = m[11];

  /* Re-orthonormalize with Z + X. */
  return occ_frame_from_axes(ox, oy, oz, xx, xy, xz, zx, zy, zz, out);
}

int apply_mat4(occ_shape_t s, const double m[16], occ_shape_t* out) {
  REQ(s && m && out, OCC_ERR_NULL_ARG);
  gp_Trsf t;
  try {
    t.SetValues(m[0], m[1], m[2], m[3],
                m[4], m[5], m[6], m[7],
                m[8], m[9], m[10], m[11]);
  } catch (Standard_Failure& e) {
    set_last(e.GetMessageString() ? e.GetMessageString() : "SetValues failed");
    return OCC_ERR_GEOM;
  }
  BRepBuilderAPI_Transform mk(*as_shape(s), t, Standard_True);
  if (!mk.IsDone()) {
    set_last("trsf apply failed");
    return OCC_ERR_GEOM;
  }
  *out = to_handle(mk.Shape());
  return OCC_OK;
}

}  // namespace

extern "C" {

void occ_trsf_identity(double m[16]) {
  mat4_zero(m);
  m[0] = m[5] = m[10] = m[15] = 1.0;
}

void occ_trsf_compose(const double a[16], const double b[16], double out[16]) {
  mat4_mul(a, b, out);
}

int occ_trsf_invert(const double m[16], double out[16]) {
  /* Rigid inverse: R^T | -R^T t
   * For pure SE(3) (det R = ±1, orthogonal). We use 3x3 inverse via det
   * to tolerate slight non-orthogonality from float noise. */
  const double r00 = m[0], r01 = m[1], r02 = m[2];
  const double r10 = m[4], r11 = m[5], r12 = m[6];
  const double r20 = m[8], r21 = m[9], r22 = m[10];
  const double det =
      r00 * (r11 * r22 - r12 * r21) -
      r01 * (r10 * r22 - r12 * r20) +
      r02 * (r10 * r21 - r11 * r20);
  if (std::fabs(det) < k_eps) {
    set_last("trsf invert: singular rotation");
    return OCC_ERR_GEOM;
  }
  /* For proper rigid body, inv(R) = R^T when det≈+1 and R orthogonal.
   * Use transpose of upper-left (standard SE3 inverse for rotations). */
  const double tx = m[3], ty = m[7], tz = m[11];
  out[0] = r00; out[1] = r10; out[2] = r20;
  out[4] = r01; out[5] = r11; out[6] = r21;
  out[8] = r02; out[9] = r12; out[10] = r22;
  out[3]  = -(out[0] * tx + out[1] * ty + out[2] * tz);
  out[7]  = -(out[4] * tx + out[5] * ty + out[6] * tz);
  out[11] = -(out[8] * tx + out[9] * ty + out[10] * tz);
  out[12] = out[13] = out[14] = 0.0;
  out[15] = 1.0;
  return OCC_OK;
}

int occ_trsf_apply_shape(occ_shape_t s, const double m[16], occ_shape_t* out) {
  REQ(s && m && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  return apply_mat4(s, m, out);
  OCC_GUARD_END
}

int occ_trsf_from_frame(const occ_frame_t* f, double out16[16]) {
  REQ(f && out16, OCC_ERR_NULL_ARG);
  return occ_frame_to_matrix4x4(f, out16);
}

/* =========================================================================
 * Serial FK — explicit joint origins + axes
 * ========================================================================= */

int occ_compose_chain(int n,
                      const double* origins,
                      const double* axes,
                      const double* angles,
                      occ_frame_t* out_world_frames,
                      double* out_final_4x4) {
  REQ(n >= 0, OCC_ERR_GEOM);
  if (n == 0) {
    if (out_final_4x4) occ_trsf_identity(out_final_4x4);
    return OCC_OK;
  }
  REQ(origins && axes && angles, OCC_ERR_NULL_ARG);
  REQ(out_world_frames || out_final_4x4, OCC_ERR_NULL_ARG);

  OCC_GUARD_BEGIN
  double world[16];
  occ_trsf_identity(world);

  for (int i = 0; i < n; ++i) {
    const double ox = origins[i * 3 + 0];
    const double oy = origins[i * 3 + 1];
    const double oz = origins[i * 3 + 2];
    const double ax = axes[i * 3 + 0];
    const double ay = axes[i * 3 + 1];
    const double az = axes[i * 3 + 2];
    const double ang = angles[i];

    /* Ti = Trans(origin) * Rot(axis, angle)  in parent frame. */
    double R[9], Trot[16], Ttr[16], Ti[16], tmp[16];
    rot_axis_angle(ax, ay, az, ang, R);
    pack_Rt(R, 0.0, 0.0, 0.0, Trot);
    mat4_trans(ox, oy, oz, Ttr);
    mat4_mul(Ttr, Trot, Ti);          /* Trans * Rot */
    mat4_mul(world, Ti, tmp);         /* world = world * Ti */
    std::memcpy(world, tmp, 16 * sizeof(double));

    if (out_world_frames) {
      int st = frame_from_mat4(world, &out_world_frames[i]);
      if (st != OCC_OK) return st;
    }
  }

  if (out_final_4x4) {
    std::memcpy(out_final_4x4, world, 16 * sizeof(double));
  }
  return OCC_OK;
  OCC_GUARD_END
}

/* =========================================================================
 * Classic Denavit–Hartenberg (Craig)
 *
 * For link i (0-based):
 *   T_i^{i-1} = RotZ(theta) * TransZ(d) * TransX(a) * RotX(alpha)
 *
 * World_i = World_{i-1} * T_i
 * ========================================================================= */

int occ_compose_chain_dh(int n,
                         const double* a,
                         const double* alpha,
                         const double* d,
                         const double* theta,
                         occ_frame_t* out_world_frames,
                         double* out_final_4x4) {
  REQ(n >= 0, OCC_ERR_GEOM);
  if (n == 0) {
    if (out_final_4x4) occ_trsf_identity(out_final_4x4);
    return OCC_OK;
  }
  REQ(a && alpha && d && theta, OCC_ERR_NULL_ARG);
  REQ(out_world_frames || out_final_4x4, OCC_ERR_NULL_ARG);

  OCC_GUARD_BEGIN
  double world[16];
  occ_trsf_identity(world);

  for (int i = 0; i < n; ++i) {
    double Rz[16], Tz[16], Tx[16], Rx[16];
    double t0[16], t1[16], t2[16], Ti[16], tmp[16];

    mat4_rotz(theta[i], Rz);
    mat4_trans(0.0, 0.0, d[i], Tz);
    mat4_trans(a[i], 0.0, 0.0, Tx);
    mat4_rotx(alpha[i], Rx);

    /* Ti = Rz * Tz * Tx * Rx */
    mat4_mul(Rz, Tz, t0);
    mat4_mul(t0, Tx, t1);
    mat4_mul(t1, Rx, Ti);

    mat4_mul(world, Ti, tmp);
    std::memcpy(world, tmp, 16 * sizeof(double));

    if (out_world_frames) {
      int st = frame_from_mat4(world, &out_world_frames[i]);
      if (st != OCC_OK) return st;
    }
  }

  if (out_final_4x4) {
    std::memcpy(out_final_4x4, world, 16 * sizeof(double));
  }
  return OCC_OK;
  OCC_GUARD_END
}

}  // extern "C"
