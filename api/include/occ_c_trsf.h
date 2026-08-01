/*
 * occ_c_trsf.h — pure SE(3) math, serial FK, and applying rigid maps to shapes.
 *
 * Why this module exists
 * ----------------------
 * Frames (occ_c_frames.h) are the pose POD for placement and mating.
 * This module is the matrix layer: compose / invert 4×4 maps, run serial
 * kinematic chains (revolute or classic DH), and push a 4×4 onto a shape.
 * Use frames when you think in “connectors”; use trsf when you think in
 * homogeneous matrices or robot joint lists.
 *
 * Matrix convention
 * -----------------
 *   - 4×4 row-major, last row 0,0,0,1.
 *   - Column vectors: p' = M p  (upper 3×3 = R, last column = t).
 *   - Composition: out = a * b  means apply b first, then a.
 *   - Identity / compose are pure C (no BREP). Invert fails if R is singular.
 *
 * Serial FK (occ_compose_chain)
 * -----------------------------
 * n revolute joints. Joint i is expressed in the *parent* joint frame
 * (joint 0 parent = world):
 *   Ti = Trans(origins[i]) * Rot(axes[i], angles[i])
 *   World_i = World_{i-1} * Ti
 * Optional out_world_frames[i] is the pose after joint i; out_final_4x4 is
 * World_{n-1}. Null out pointers are skipped.
 *
 * DH variant (occ_compose_chain_dh) uses Craig link transform:
 *   T_i = RotZ(theta) * TransZ(d) * TransX(a) * RotX(alpha)
 *
 * Ownership
 * ---------
 * Matrix ops write into caller buffers (no heap).
 * occ_trsf_apply_shape returns a new owned shape (copy transform); free with
 * occ_shape_free. Input shape is never freed.
 *
 * Units: meters, radians. Depends on occ_frame_t from occ_c_frames.h.
 * Implementation: api/src/occ_c_trsf.cc.
 */
#ifndef OCC_C_TRSF_H_
#define OCC_C_TRSF_H_

#include "occ_c.h"
#include "occ_c_frames.h"

#ifdef __cplusplus
extern "C" {
#endif

/* -------------------------------------------------------------------------
 * Pure SE(3) math on 4×4 row-major matrices (last row 0,0,0,1).
 * Composition: out = a * b  means apply b first, then a (column vectors).
 * ------------------------------------------------------------------------- */

OCC_API void occ_trsf_identity(double m[16]);

/** out = a * b  (a after b). Safe if out aliases a or b (uses temp). */
OCC_API void occ_trsf_compose(const double a[16], const double b[16],
                              double out[16]);

/** Rigid inverse. Returns OCC_ERR_GEOM if rotation block is singular. */
OCC_API int occ_trsf_invert(const double m[16], double out[16]);

/** Apply 4×4 (upper 3×4) to shape as a copy transform → new owned shape. */
OCC_API int occ_trsf_apply_shape(occ_shape_t s, const double m[16],
                                 occ_shape_t* out);

/** Convenience: frame → 4×4 (same layout as occ_frame_to_matrix4x4). */
OCC_API int occ_trsf_from_frame(const occ_frame_t* f, double out16[16]);

/* -------------------------------------------------------------------------
 * Serial FK: n revolute joints.
 *
 * Each joint i is expressed in the *parent* joint frame (joint 0 parent = world):
 *   Ti = Trans(origins[i]) * Rot(axes[i], angles[i])
 *   World_i = World_{i-1} * Ti
 *
 * origins: n*3 doubles (x,y,z) in parent frame
 * axes:    n*3 doubles (unit preferred; normalized internally)
 * angles:  n doubles, radians
 *
 * out_world_frames: if non-NULL, n frames (world pose after each joint)
 * out_final_4x4:    if non-NULL, World_{n-1} as 4×4 row-major
 * ------------------------------------------------------------------------- */
OCC_API int occ_compose_chain(int n,
                              const double* origins, /* n*3 */
                              const double* axes,    /* n*3 */
                              const double* angles,  /* n */
                              occ_frame_t* out_world_frames, /* nullable, n */
                              double* out_final_4x4 /* nullable, 16 */);

/** Classic DH (Craig): each link i
 *    T_i = RotZ(theta_i) * TransZ(d_i) * TransX(a_i) * RotX(alpha_i)
 *  Arrays length n. out_world_frames / out_final_4x4 same as above. */
OCC_API int occ_compose_chain_dh(int n,
                                 const double* a,
                                 const double* alpha,
                                 const double* d,
                                 const double* theta,
                                 occ_frame_t* out_world_frames,
                                 double* out_final_4x4);

#ifdef __cplusplus
}
#endif

#endif /* OCC_C_TRSF_H_ */
