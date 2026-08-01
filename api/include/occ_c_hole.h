// === file: occ_c_hole.h
#ifndef OCC_C_HOLE_H_
#define OCC_C_HOLE_H_

#include "occ_c.h"

#ifdef __cplusplus
extern "C" {
#endif

/* =========================================================================
 * Simple holes — P0/P1 (no standards tables, no hole attributes).
 *
 * All sizes are full diameters in meters.
 * Direction (dx,dy,dz) is the drill axis; material is removed along +dir
 * for blind features starting at origin. Through tools are centered on
 * the origin so they exit both sides.
 * ========================================================================= */

/**
 * Through-all cylindrical hole.
 * Tool length = bbox_diagonal(solid) * 2 (+ margin). Cylinder is centered
 * on (cx,cy,cz) along unit(dx,dy,dz) so both faces are pierced for any
 * solid whose extent is within one diagonal of the point.
 */
OCC_API int occ_drill_hole_through(occ_shape_t solid,
                                   double cx, double cy, double cz,
                                   double dx, double dy, double dz,
                                   double diameter,
                                   occ_shape_t* out);

/**
 * Blind cylindrical hole of given depth along +dir from origin.
 */
OCC_API int occ_drill_hole_blind(occ_shape_t solid,
                                 double ox, double oy, double oz,
                                 double dx, double dy, double dz,
                                 double diameter,
                                 double depth,
                                 occ_shape_t* out);

/**
 * Counterbore: large cylinder (cbore_d × cbore_depth) from origin along
 * +dir, then smaller tap cylinder (tap_d × tap_depth) from the same origin.
 * Tool = Fuse(cbore_cyl, tap_cyl); result = Cut(solid, tool).
 */
OCC_API int occ_drill_hole_counterbore(occ_shape_t solid,
                                       double ox, double oy, double oz,
                                       double dx, double dy, double dz,
                                       double tap_d, double tap_depth,
                                       double cbore_d, double cbore_depth,
                                       occ_shape_t* out);

/**
 * Countersink: cylindrical tap (tap_d × tap_depth) plus conical mouth of
 * included angle csink_angle_rad and axial depth csink_depth.
 *
 * half_angle = csink_angle_rad / 2
 * R_mouth    = csink_depth * tan(half_angle)
 * Cone: R1=R_mouth at origin, R2=0 at z=csink_depth (apex inside solid).
 */
OCC_API int occ_drill_hole_countersink(occ_shape_t solid,
                                       double ox, double oy, double oz,
                                       double dx, double dy, double dz,
                                       double tap_d, double tap_depth,
                                       double csink_angle_rad,
                                       double csink_depth,
                                       occ_shape_t* out);

/**
 * Drill at face center of mass, along face normal (oriented to enter
 * from outside via solid classifier heuristic).
 *
 * face_index_1based: 1 .. N faces
 * through_or_depth:  <= 0 → through-all;  > 0 → blind of that depth
 */
OCC_API int occ_hole_on_face_center(occ_shape_t solid,
                                    int face_index_1based,
                                    double diameter,
                                    double through_or_depth,
                                    occ_shape_t* out);

#ifdef __cplusplus
}
#endif

#endif /* OCC_C_HOLE_H_ */
