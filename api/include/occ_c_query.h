// === file: occ_c_query.h
#ifndef OCC_C_QUERY_H_
#define OCC_C_QUERY_H_

#include "occ_c.h"

#ifdef __cplusplus
extern "C" {
#endif

/* Clash status codes: occ_clash_status_t in occ_c.h
 *   OCC_CLASH_SEPARATED / OCC_CLASH_CLEARANCE / OCC_CLASH_INTERFERE */

/* -------------------------------------------------------------------------
 * Distance & clash
 * ------------------------------------------------------------------------- */

/** Minimum distance between two shapes.
 *  on success: *out_dist >= 0; optional out_p_on_a / out_p_on_b filled if non-NULL.
 *  Points are first solution (1-based OCCT index). */
OCC_API int occ_distance(occ_shape_t a, occ_shape_t b,
                         double* out_dist,
                         double out_p_on_a[3],
                         double out_p_on_b[3]);

/** Pairwise clash with clearance band.
 *  *out_status ∈ {0,1,2} as OCC_CLASH_* .
 *  Returns OCC_OK when status was written; OCC_ERR_GEOM if extrema failed. */
OCC_API int occ_clash(occ_shape_t a, occ_shape_t b,
                      double clearance, int* out_status);

/** All-pairs clash matrix, row-major n*n.
 *  Diagonal forced to SEPARATED (0). out_matrix_flat[i*n+j] is status(i,j). */
OCC_API int occ_clash_all_pairs(const occ_shape_t* shapes, int n,
                                double clearance, int* out_matrix_flat);

/** Min distance from shape to any of others[0..n-1].
 *  *out_idx is 0-based index into others; *out_dist is that minimum. */
OCC_API int occ_min_distance_to_set(occ_shape_t shape,
                                    const occ_shape_t* others, int n,
                                    int* out_idx, double* out_dist);

/* -------------------------------------------------------------------------
 * Global measures (re-export style; safe to call from any TU)
 * ------------------------------------------------------------------------- */

/* volume / surface_area / center_of_mass: baseline occ_c.h */

/** Density-scaled mass properties.
 *  density in kg/m^3 (or consistent unit system).
 *  out_inertia_tensor[9] row-major 3x3 about COM:
 *    [Ixx Ixy Ixz; Iyx Iyy Iyz; Izx Izy Izz]  (symmetric). */
OCC_API int occ_mass_properties(occ_shape_t s, double density,
                                double* out_mass,
                                double out_com[3],
                                double out_inertia_tensor[9]);

/** Linear properties: edge or wire arc length (BRepGProp::LinearProperties). */
OCC_API int occ_length(occ_shape_t s, double* out_len);

/* -------------------------------------------------------------------------
 * Face / edge geometry
 * ------------------------------------------------------------------------- */

OCC_API int occ_face_area(occ_shape_t face, double* out_area);
OCC_API int occ_face_normal(occ_shape_t face, double out_n[3]); /* unit, at center UV */
OCC_API int occ_face_center(occ_shape_t face, double out_p[3]); /* 3D at center UV */
OCC_API int occ_is_planar_face(occ_shape_t face, int* out_bool);

/** 1-based face index of maximum area inside s; also returns area if non-NULL. */
OCC_API int occ_largest_face(occ_shape_t s, int* out_1based_index);
OCC_API int occ_largest_face_area(occ_shape_t s, int* out_1based_index,
                                  double* out_area);

OCC_API int occ_edge_midpoint(occ_shape_t edge, double out_p[3]);
OCC_API int occ_edge_tangent(occ_shape_t edge, double out_t[3]); /* unit */
OCC_API int occ_edge_length(occ_shape_t edge, double* out_len);

/* -------------------------------------------------------------------------
 * Topology typing & solids
 * ------------------------------------------------------------------------- */

/** *out maps TopAbs_ShapeEnum → occ_shape_type_t / int (0=COMPOUND .. 7=VERTEX). */
OCC_API int occ_shape_type(occ_shape_t s, int* out);

OCC_API int occ_count_solids(occ_shape_t s, int* out_n);
/** Extract solid at 1-based index into a new owned shape handle. */
OCC_API int occ_solid_at(occ_shape_t s, int index_1based, occ_shape_t* out);

/* -------------------------------------------------------------------------
 * Proximity helpers
 * ------------------------------------------------------------------------- */

/** Closest face (1-based in TopExp FACE map) of shape to point p[3]. */
OCC_API int occ_closest_face_to_point(occ_shape_t shape, const double p[3],
                                      int* out_face_index,
                                      double out_point_on_face[3]);

/** Ray cast: origin + t * dir, dir need not be unit.
 *  Finds smallest t >= 0 hit. out_t may be NULL; out_hit[3] optional;
 *  out_face_index 1-based optional (0 if unused).
 *  Returns OCC_ERR_INDEX if no hit. */
OCC_API int occ_ray_cast(occ_shape_t shape,
                         const double origin[3], const double dir[3],
                         double* out_t, double out_hit[3],
                         int* out_face_index);

/* -------------------------------------------------------------------------
 * Bounds, validity, cheap topology fingerprint
 * ------------------------------------------------------------------------- */

/** Axis-aligned bbox: out_min[3], out_max[3]. */
/* bbox: baseline occ_c.h */

/** BRepCheck_Analyzer::IsValid() → *out_bool 1/0. */
OCC_API int occ_is_valid_shape(occ_shape_t s, int* out_bool);

/** Quick topology hash: mix of face/edge/vertex counts into *out_hash.
 *  Not geometric; useful to skip redraw when topology cardinality unchanged. */
OCC_API int occ_same_topology_count_hash(occ_shape_t s, unsigned long long* out_hash);

/* -------------------------------------------------------------------------
 * Selector helpers (IR without full session)
 * out_indices: caller-allocated capacity max_out; *out_n written count.
 * Indices are 1-based FACE or EDGE map indices.
 * ------------------------------------------------------------------------- */

OCC_API int occ_select_faces_by_area_gt(occ_shape_t shape, double min_area,
                                        int* out_indices, int max_out,
                                        int* out_n);

OCC_API int occ_select_edges_by_length_gt(occ_shape_t shape, double min_len,
                                          int* out_indices, int max_out,
                                          int* out_n);

OCC_API int occ_select_planar_faces(occ_shape_t shape,
                                    int* out_indices, int max_out,
                                    int* out_n);

/** Faces whose unit normal is within tol_deg of unit(normal). */
OCC_API int occ_select_faces_parallel_to(occ_shape_t shape,
                                         const double normal[3],
                                         double tol_deg,
                                         int* out_indices, int max_out,
                                         int* out_n);

#ifdef __cplusplus
}
#endif

#endif /* OCC_C_QUERY_H_ */
