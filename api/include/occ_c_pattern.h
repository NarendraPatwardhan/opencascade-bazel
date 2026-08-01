#ifndef OCC_C_PATTERN_H_
#define OCC_C_PATTERN_H_

#include "occ_c.h"

#ifdef __cplusplus
extern "C" {
#endif

/* =========================================================================
 * Patterns — P0/P1 kernel for flanges, bolt circles, supports.
 *
 * Convention:
 *   - count includes the seed at the identity transform (index 0),
 *     except occ_pattern_linear_exclude_seed which skips identity.
 *   - Results are TopoDS_COMPOUND of copied shapes (Copy=true transforms).
 *   - Units: meters, radians.
 * ========================================================================= */

/**
 * Linear pattern: instances at i * (dx,dy,dz) for i = 0 .. count-1.
 * Instance 0 is a copy of seed at the original location.
 */
OCC_API int occ_pattern_linear(occ_shape_t seed,
                               double dx, double dy, double dz,
                               int count,
                               occ_shape_t* out_compound);

/**
 * Additional instances only: translations 1*d .. count*d.
 * Use when the seed body already lives in the model.
 */
OCC_API int occ_pattern_linear_exclude_seed(occ_shape_t seed,
                                            double dx, double dy, double dz,
                                            int count,
                                            occ_shape_t* out);

/**
 * Polar pattern about axis through (px,py,pz) direction (ax,ay,az).
 * Instance i is rotated by i * angle_step_rad, i = 0 .. count-1.
 */
OCC_API int occ_pattern_polar(occ_shape_t seed,
                              double px, double py, double pz,
                              double ax, double ay, double az,
                              double angle_step_rad,
                              int count,
                              occ_shape_t* out);

/**
 * Full-circle polar: angle_step = 2π / count.
 * Does not place a duplicate at 2π (seed occupies angle 0).
 */
OCC_API int occ_pattern_polar_full_circle(occ_shape_t seed,
                                          double px, double py, double pz,
                                          double ax, double ay, double az,
                                          int count,
                                          occ_shape_t* out);

/**
 * Place `count` copies of seed along spine_wire at equal arc-length.
 *
 * Spacing:
 *   L = wire length
 *   s_i = i * L / max(count-1, 1)   for i = 0 .. count-1
 *   (count==1 → only the start of the wire)
 *
 * If align_tangent_bool != 0:
 *   Rigid map world origin→P(s_i), world +Z→unit tangent T(s_i).
 *   X = stable perpendicular (prefer world-Z × T unless nearly parallel).
 *   Seed assumed authored near origin with +Z "forward".
 *
 * If align_tangent_bool == 0:
 *   Pure translation by (P(s_i) - P(0)); orientation fixed (world-upright pads).
 */
OCC_API int occ_pattern_along_path(occ_shape_t seed,
                                   occ_shape_t spine_wire,
                                   int count,
                                   int align_tangent_bool,
                                   occ_shape_t* out);

/**
 * Apply explicit rigid transforms to seed.
 * matrices: row-major 3×4 blocks packed as n * 12 doubles:
 *   [ r11 r12 r13 tx  r21 r22 r23 ty  r31 r32 r33 tz ]
 * Same layout as occ_frame_to_trsf_4x3 / occ_transform_shape_4x3.
 */
OCC_API int occ_pattern_from_transforms(occ_shape_t seed,
                                        const double* matrices_4x3,
                                        int n,
                                        occ_shape_t* out);

/**
 * Pattern seed by the given transforms, then fuse each instance into base
 * (sequential BRepAlgoAPI_Fuse). If n==0, returns a copy of base.
 */
OCC_API int occ_boolean_fuse_pattern(occ_shape_t base,
                                     occ_shape_t seed,
                                     const double* matrices_4x3,
                                     int n,
                                     occ_shape_t* out);

#ifdef __cplusplus
}
#endif

#endif /* OCC_C_PATTERN_H_ */
