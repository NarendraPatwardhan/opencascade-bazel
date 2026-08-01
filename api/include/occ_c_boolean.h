/*
 * occ_c_boolean.h — compounds, plane/shape split, multi-boolean helpers.
 *
 * Why this module exists
 * ----------------------
 * Baseline occ_c.h has pairwise fuse / cut / common. Assembly IR and partition
 * workflows need: pack many shapes into one handle, explode compounds, split a
 * solid by a plane or cutter face, and fuse/cut against N tools in one call.
 * This module is that grouping / partition layer — not a general BOP GUI.
 *
 * Compounds
 * ---------
 * occ_make_compound packs n shapes into a single COMPOUND (shared handle tree;
 * sub-shapes are still independent BREPs). occ_explode_compound lists *direct*
 * children only; if the input is not a compound, out_count=1 and the shape
 * itself is returned as the sole entry. Caller provides capacity max_out;
 * excess children → OCC_ERR_CAPACITY after filling max_out (*out_count = total).
 *
 * Plane split (finite half-space — important)
 * -------------------------------------------
 * Infinite half-spaces make boolean ops slow and fragile. Contract:
 *   1. Build a planar face large enough to cover solid AABB (diag × 4).
 *   2. Half-space solid on +normal and −normal sides of that plane.
 *   3. Intersect each half-space with an oversized AABB of the solid → finite tools.
 *   4. out_pos = cut(solid, tool_on_neg)  → portion on the +normal side
 *   5. out_neg = cut(solid, tool_on_pos)  → portion on the −normal side
 * Both outputs may be compounds if the cut disconnects the solid.
 *
 * Shape split
 * -----------
 * occ_split_by_shape uses a general splitter; result compound holds only the
 * split object parts (tool pieces excluded).
 *
 * Multi-boolean
 * -------------
 * fuse_many: sequential fuse, n≥1 (n==1 returns a copy).
 * cut_many:  base minus tools[0], tools[1], … in order.
 *
 * Ownership: every successful *out is caller-owned → occ_shape_free.
 * Inputs never freed. Units: meters.
 * Implementation: api/src/occ_c_boolean_ext.cc.
 */
#ifndef OCC_C_BOOLEAN_H_
#define OCC_C_BOOLEAN_H_

#include "occ_c.h"

#ifdef __cplusplus
extern "C" {
#endif

/** Pack n shapes into a compound handle. n ≥ 1. */
OCC_API int occ_make_compound(const occ_shape_t* shapes, int n,
                              occ_shape_t* out);

/**
 * Explode direct children of a compound (or the shape itself if not a
 * compound — then out_count=1).
 * out_shapes: caller array of capacity max_out.
 * Returns OCC_ERR_CAPACITY if children > max_out (still fills max_out;
 * *out_count is the full child count).
 * Each written entry is a new owned shape handle.
 */
OCC_API int occ_explode_compound(occ_shape_t compound,
                                 occ_shape_t* out_shapes,
                                 int max_out,
                                 int* out_count);

/**
 * Split solid by plane through (ox,oy,oz) normal (nx,ny,nz).
 *
 * Finite half-space contract (see file guide):
 *   out_pos = portion on the +normal side
 *   out_neg = portion on the −normal side
 * Either may be a compound if the cut disconnects the solid.
 */
OCC_API int occ_split_by_plane(occ_shape_t solid,
                               double ox, double oy, double oz,
                               double nx, double ny, double nz,
                               occ_shape_t* out_pos,
                               occ_shape_t* out_neg);

/**
 * Split solid by cutter (face, shell, or solid).
 * Result compound contains only split object parts (tool parts excluded).
 */
OCC_API int occ_split_by_shape(occ_shape_t solid,
                               occ_shape_t cutter_face_or_shell,
                               occ_shape_t* out_compound_parts);

/** Sequential fuse of n shapes (n≥1). n==1 returns a copy. */
OCC_API int occ_fuse_many(const occ_shape_t* shapes, int n, occ_shape_t* out);

/** Sequential cut: base minus tools[0], tools[1], ... */
OCC_API int occ_cut_many(occ_shape_t base,
                         const occ_shape_t* tools, int n,
                         occ_shape_t* out);

#ifdef __cplusplus
}
#endif

#endif /* OCC_C_BOOLEAN_H_ */
