/*
 * occ_c_frames.h — SE(3) poses as plain C structs (no C++).
 *
 * A frame is a mate-connector analogue: origin + right-handed orthonormal
 * triad. Z is the “main” direction (edge tangent, surface normal, joint axis).
 *
 *   X = (xx,xy,xz), Y = (yx,yy,yz), Z = (zx,zy,zz), origin = (ox,oy,oz)
 *
 * Place a solid so a frame on the solid meets a world frame with
 * occ_transform_shape_frame / related helpers in this module and occ_c_trsf.h.
 *
 * occ_frame_t is the preferred frame POD for the whole C API (route, trsf,
 * pattern, pipe profiles). Session history stores a parallel array layout
 * (origin[3], x[3], y[3], z[3]) as occ_session_frame_t — convert only at
 * attach/get with occ_session_frame_from_frame / to_frame in occ_c_session.h.
 */
#ifndef OCC_C_FRAMES_H_
#define OCC_C_FRAMES_H_

#include "occ_c.h"

#ifdef __cplusplus
extern "C" {
#endif

/* -------------------------------------------------------------------------
 * occ_frame_t — pure SE(3) pose as POD
 * ------------------------------------------------------------------------- */
typedef struct {
  double ox, oy, oz;
  double xx, xy, xz; /* X axis */
  double yx, yy, yz; /* Y axis */
  double zx, zy, zz; /* Z axis */
} occ_frame_t;

/* World / identity frame: origin 0, X=(1,0,0), Y=(0,1,0), Z=(0,0,1). */
OCC_API int occ_frame_world(occ_frame_t* out);

/* Build from origin + X + Z; Y is reconstructed; axes orthonormalized. */
OCC_API int occ_frame_from_axes(double ox, double oy, double oz,
                                double xx, double xy, double xz,
                                double zx, double zy, double zz,
                                occ_frame_t* out);

/* Build from origin + Z and optional X-hint.
 * Pass xh=xyh=xzh=0 (or any near-zero vector) to auto-pick a stable X.
 * Handles nearly-parallel X-hint via orthonormalize helper. */
OCC_API int occ_frame_from_z(double ox, double oy, double oz,
                             double zx, double zy, double zz,
                             double xh, double yh, double zh,
                             occ_frame_t* out);

/* ZYX intrinsic Euler (yaw-pitch-roll): R = Rz(rz) * Ry(ry) * Rx(rx).
 * Angles in radians. Origin (ox,oy,oz). */
OCC_API int occ_frame_from_zyx_euler(double ox, double oy, double oz,
                                     double rx, double ry, double rz,
                                     occ_frame_t* out);

/* 4x3 row-major upper block: [R|t] as 3x4 flattened row-major (12 doubles). */
OCC_API int occ_frame_to_trsf_4x3(const occ_frame_t* f, double out12[12]);
OCC_API int occ_frame_from_trsf_4x3(const double m12[12], occ_frame_t* out);

/* 4x4 row-major, last row 0,0,0,1. Column-vector p' = M p. */
OCC_API int occ_frame_to_matrix4x4(const occ_frame_t* f, double out16[16]);
OCC_API int occ_frame_from_matrix4x4(const double m16[16], occ_frame_t* out);

/* Invert: inv(F). Multiply: B*A means apply A then B. */
OCC_API int occ_frame_inverted(const occ_frame_t* f, occ_frame_t* out);
OCC_API int occ_frame_multiplied(const occ_frame_t* b, const occ_frame_t* a,
                                 occ_frame_t* out);

/* Connector displacement T = B * inv(A). Maps points so frame A lands on B. */
OCC_API int occ_frame_displacement(const occ_frame_t* from_a,
                                   const occ_frame_t* to_b,
                                   occ_frame_t* out);

/* Apply rigid transform encoded as 4x3 or as a placement frame (world ← local). */
OCC_API int occ_transform_shape_4x3(occ_shape_t s, const double m12[12],
                                    occ_shape_t* out);
OCC_API int occ_transform_shape_frame(occ_shape_t s, const occ_frame_t* f,
                                      occ_shape_t* out);

/* Place shape so that current_frame_on_shape lands on target_frame:
 *   T = target * inv(current);  out = T(shape).
 * If current_frame_on_shape is NULL, treated as world (identity). */
OCC_API int occ_place_shape_at_frame(occ_shape_t shape,
                                     const occ_frame_t* target_frame,
                                     const occ_frame_t* current_frame_on_shape,
                                     occ_shape_t* out);

/* Frame whose Z is edge tangent at parameter u (curve parameter, not arc length). */
OCC_API int occ_frame_at_edge_param(occ_shape_t edge, double u,
                                    occ_frame_t* out);

/* Frame at wire start (at_start!=0) or end (at_start==0); Z = tangent outward
 * along the wire direction (start: +D1, end: +D1 at last param of last edge). */
OCC_API int occ_frame_at_wire_end(occ_shape_t wire, int at_start,
                                  occ_frame_t* out);

/* Frame on face surface at (u,v): origin = S(u,v), Z = unit normal from D1,
 * X along dS/du when possible. */
OCC_API int occ_frame_on_face(occ_shape_t face, double u, double v,
                              occ_frame_t* out);

/* Mirror copy across plane (point + normal). If keep_original_compound!=0,
 * out is a COMPOUND of {original, mirrored}; else out is mirrored only. */
OCC_API int occ_mirror_copy(occ_shape_t shape,
                            double px, double py, double pz,
                            double nx, double ny, double nz,
                            int keep_original_compound,
                            occ_shape_t* out);

/* Apply N rigid transforms (each 4x4 row-major) to seed → COMPOUND of N copies.
 * Foundation for linear/polar patterns at the IR level. */
OCC_API int occ_transform_copy_array(occ_shape_t seed,
                                     const double* transforms_4x4, /* n*16 */
                                     int n,
                                     occ_shape_t* out);

#ifdef __cplusplus
}
#endif

#endif /* OCC_C_FRAMES_H_ */
