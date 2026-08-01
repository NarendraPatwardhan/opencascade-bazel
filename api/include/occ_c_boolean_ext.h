// === file: occ_c_boolean_ext.h
#ifndef OCC_C_BOOLEAN_EXT_H_
#define OCC_C_BOOLEAN_EXT_H_

#include "occ_c.h"

#ifdef __cplusplus
extern "C" {
#endif

/* Compounds, split, multi-boolean — P0/P1 grouping & partition helpers. */

/** Pack n shapes into a TopoDS_COMPOUND. */
OCC_API int occ_make_compound(const occ_shape_t* shapes, int n,
                              occ_shape_t* out);

/**
 * Explode direct children of a compound (or the shape itself if not a
 * compound — then out_count=1).
 * out_shapes: caller array of capacity max_out.
 * Returns OCC_ERR_INDEX if children > max_out (still fills max_out).
 */
OCC_API int occ_explode_compound(occ_shape_t compound,
                                 occ_shape_t* out_shapes,
                                 int max_out,
                                 int* out_count);

/**
 * Split solid by plane through (ox,oy,oz) normal (nx,ny,nz).
 *
 * Implementation (finite half-space — read carefully):
 *   1. Planar face large enough to cover solid bbox (diag*4).
 *   2. MakeHalfSpace(face, ref_point on +normal / -normal).
 *   3. Common(half-space, oversized AABB of solid) → finite tool H±.
 *   4. out_pos = Cut(solid, H−)  → portion on the +normal side.
 *   5. out_neg = Cut(solid, H+)  → portion on the −normal side.
 *
 * Infinite half-spaces alone can make BOP slow; clipping keeps tools finite.
 * Both outputs may be compounds if the cut disconnects the solid.
 */
OCC_API int occ_split_by_plane(occ_shape_t solid,
                               double ox, double oy, double oz,
                               double nx, double ny, double nz,
                               occ_shape_t* out_pos,
                               occ_shape_t* out_neg);

/**
 * Split solid by cutter (face, shell, or solid) via BRepAlgoAPI_Splitter.
 * Result compound contains only split object parts (tool parts excluded).
 */
OCC_API int occ_split_by_shape(occ_shape_t solid,
                               occ_shape_t cutter_face_or_shell,
                               occ_shape_t* out_compound_parts);

/** Sequential fuse of n shapes (n>=1). n==1 returns a copy. */
OCC_API int occ_fuse_many(const occ_shape_t* shapes, int n, occ_shape_t* out);

/** Sequential cut: base minus tools[0], tools[1], ... */
OCC_API int occ_cut_many(occ_shape_t base,
                         const occ_shape_t* tools, int n,
                         occ_shape_t* out);

#ifdef __cplusplus
}
#endif

#endif /* OCC_C_BOOLEAN_EXT_H_ */
