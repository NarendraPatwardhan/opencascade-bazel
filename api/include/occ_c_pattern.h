/*
 * occ_c_pattern.h — linear / polar / path / transform patterns of a seed shape.
 *
 * Why this module exists
 * ----------------------
 * Flanges, bolt circles, rib arrays, and pad supports all need “copy seed at
 * many rigid poses.” Patterns build a COMPOUND of independent copies (or fuse
 * them into a base). They do not boolean-cut holes; pair with occ_c_hole.h or
 * baseline cut if you need voids at patterned locations.
 *
 * Count convention (read carefully)
 * ---------------------------------
 *   - count includes the seed at the identity transform (index 0),
 *     except occ_pattern_linear_exclude_seed which skips identity
 *     (use when the seed body already lives in the model).
 *   - Polar full-circle uses step = 2π / count; no duplicate at 2π.
 *
 * Algorithms
 * ----------
 *   linear:   instance i at translation i * (dx,dy,dz), i = 0 .. count-1
 *   polar:    instance i rotated i * angle_step about axis (p, a)
 *   along path:
 *     equal arc-length samples on spine_wire
 *     s_i = i * L / max(count-1, 1)   (count==1 → only wire start)
 *     align_tangent: rigid map world origin→P(s), world +Z→unit tangent
 *                    (seed authored near origin with +Z “forward”)
 *     no align: pure translation by (P(s_i) - P(0)); orientation fixed
 *   from_transforms: apply caller 4×3 rigid blocks to seed
 *   fuse_pattern:    transform each instance then sequential fuse into base
 *
 * Ownership & result type
 * -----------------------
 * Successful *out is a new owned shape — usually a COMPOUND of copies
 * (copy=true transforms). Free with occ_shape_free. Seed is never freed.
 * matrices_4x3: row-major 3×4 blocks packed as n * 12 doubles
 *   [ r11 r12 r13 tx  r21 r22 r23 ty  r31 r32 r33 tz ]
 * Same layout as occ_frame_to_trsf_4x3 / occ_transform_shape_4x3.
 *
 * Units: meters, radians. Implementation: api/src/occ_c_pattern.cc.
 */
#ifndef OCC_C_PATTERN_H_
#define OCC_C_PATTERN_H_

#include "occ_c.h"

#ifdef __cplusplus
extern "C" {
#endif

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
 *   Seed assumed authored near origin with +Z “forward”.
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
 * (sequential fuse). If n==0, returns a copy of base.
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
