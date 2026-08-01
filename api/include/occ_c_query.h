/*
 * occ_c_query.h — distance, clash, mass, topology, proximity, selectors.
 *
 * Why this module exists
 * ----------------------
 * Modeling ops produce shapes; product logic needs to *ask questions* about
 * them: how far, do they clash, which face is largest, cast a ray, pick edges
 * longer than X. Baseline occ_c.h already has volume / area / COM / bbox for
 * a single shape. This module is the measurement and selection layer for
 * multi-shape and sub-topology queries — freestanding (no session required).
 * For history-backed reselect, use occ_c_session.h and filter by created_by.
 *
 * Clash taxonomy (occ_clash_status_t in occ_c.h)
 * ---------------------------------------------
 *   OCC_CLASH_SEPARATED  — min distance > clearance
 *   OCC_CLASH_CLEARANCE  — 0 < dist ≤ clearance (near miss band)
 *   OCC_CLASH_INTERFERE  — overlapping / touching (dist ≈ 0 or inner solution)
 * Pairwise and all-pairs matrix use the same codes. Diagonal of all-pairs is
 * forced SEPARATED (a shape does not clash with itself here).
 *
 * Distance points
 * ---------------
 * Optional out_p_on_a / out_p_on_b receive the first extrema solution (meters).
 * Pass NULL to skip. out_dist is always ≥ 0 on success.
 *
 * Mass properties
 * ---------------
 * density in kg/m³ (or any consistent unit system). Inertia is 3×3 about COM,
 * row-major symmetric tensor. Length applies to edge or wire arc length.
 *
 * Selectors
 * ---------
 * out_indices: caller-allocated capacity max_out; *out_n written count.
 * Indices are 1-based face or edge map indices (match topology helpers).
 * Parallel-to uses face unit normal vs unit(normal) within tol_deg.
 *
 * Ray cast
 * --------
 * origin + t * dir, dir need not be unit. Smallest t ≥ 0 hit. No hit →
 * OCC_ERR_INDEX. Optional out_t / out_hit / out_face_index (1-based; 0 unused).
 *
 * Ownership: freestanding queries do not allocate shapes except solid_at
 * (new owned handle). Status int + out-params only otherwise.
 * Units: meters, degrees only where named *_deg. Implementation: occ_c_query.cc.
 */
#ifndef OCC_C_QUERY_H_
#define OCC_C_QUERY_H_

#include "occ_c.h"

#ifdef __cplusplus
extern "C" {
#endif

/* -------------------------------------------------------------------------
 * Distance & clash
 * ------------------------------------------------------------------------- */

/** Minimum distance between two shapes.
 *  on success: *out_dist ≥ 0; optional out_p_on_a / out_p_on_b if non-NULL.
 *  Points are the first extrema solution. */
OCC_API int occ_distance(occ_shape_t a, occ_shape_t b,
                         double* out_dist,
                         double out_p_on_a[3],
                         double out_p_on_b[3]);

/** Pairwise clash with clearance band.
 *  *out_status ∈ {0,1,2} as OCC_CLASH_*.
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
 * Global measures
 * ------------------------------------------------------------------------- */

/* volume / surface_area / center_of_mass / bbox: baseline occ_c.h */

/** Density-scaled mass properties.
 *  density in kg/m³ (or consistent unit system).
 *  out_inertia_tensor[9] row-major 3×3 about COM:
 *    [Ixx Ixy Ixz; Iyx Iyy Iyz; Izx Izy Izz]  (symmetric). */
OCC_API int occ_mass_properties(occ_shape_t s, double density,
                                double* out_mass,
                                double out_com[3],
                                double out_inertia_tensor[9]);

/** Linear properties: edge or wire arc length (meters). */
OCC_API int occ_length(occ_shape_t s, double* out_len);

/* -------------------------------------------------------------------------
 * Face / edge geometry
 * ------------------------------------------------------------------------- */

OCC_API int occ_face_area(occ_shape_t face, double* out_area);
/** Unit normal at face center UV. */
OCC_API int occ_face_normal(occ_shape_t face, double out_n[3]);
/** 3D point at face center UV. */
OCC_API int occ_face_center(occ_shape_t face, double out_p[3]);
OCC_API int occ_is_planar_face(occ_shape_t face, int* out_bool);

/** 1-based face index of maximum area inside s; also area if non-NULL. */
OCC_API int occ_largest_face(occ_shape_t s, int* out_1based_index);
OCC_API int occ_largest_face_area(occ_shape_t s, int* out_1based_index,
                                  double* out_area);

OCC_API int occ_edge_midpoint(occ_shape_t edge, double out_p[3]);
/** Unit tangent at edge midpoint parameter. */
OCC_API int occ_edge_tangent(occ_shape_t edge, double out_t[3]);
OCC_API int occ_edge_length(occ_shape_t edge, double* out_len);

/* -------------------------------------------------------------------------
 * Topology typing & solids
 * ------------------------------------------------------------------------- */

/** *out is occ_shape_kind_t (OCC_SHAPE_*). Never raw kernel enums. */
OCC_API int occ_shape_type(occ_shape_t s, int* out);

OCC_API int occ_count_solids(occ_shape_t s, int* out_n);
/** Extract solid at 1-based index into a new owned shape handle. */
OCC_API int occ_solid_at(occ_shape_t s, int index_1based, occ_shape_t* out);

/* -------------------------------------------------------------------------
 * Proximity helpers
 * ------------------------------------------------------------------------- */

/** Closest face (1-based face map) of shape to point p[3]. */
OCC_API int occ_closest_face_to_point(occ_shape_t shape, const double p[3],
                                      int* out_face_index,
                                      double out_point_on_face[3]);

/** Ray cast: origin + t * dir, dir need not be unit.
 *  Finds smallest t ≥ 0 hit. out_t may be NULL; out_hit[3] optional;
 *  out_face_index 1-based optional (0 if unused).
 *  Returns OCC_ERR_INDEX if no hit. */
OCC_API int occ_ray_cast(occ_shape_t shape,
                         const double origin[3], const double dir[3],
                         double* out_t, double out_hit[3],
                         int* out_face_index);

/* -------------------------------------------------------------------------
 * Validity & cheap topology fingerprint
 * ------------------------------------------------------------------------- */

/** Structural validity check → *out_bool 1/0. */
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
