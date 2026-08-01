// Extended sweeps beyond baseline occ_extrude / occ_revolve / occ_loft / occ_pipe.
// OCCT 7.9.3 — extents, helix, thicken, sew, solid-from-shell.
//
// Draft (taper) is intentionally NOT provided here — see DRAFT SKIP note below.
//
#ifndef OCC_C_SWEEP_EXT_H_
#define OCC_C_SWEEP_EXT_H_

#include "occ_c.h"

#ifdef __cplusplus
extern "C" {
#endif

/* Ensure geom error code exists even if baseline occ_c.h has not been patched. */

/* =========================================================================
 * Linear extrude extents (PushPull taxonomy)
 * ========================================================================= */

/**
 * Blind extrude — alias of baseline prism: profile swept by vector (dx,dy,dz).
 * Profile: face → solid, wire → shell, edge → face (OCCT rules).
 *
 * @param profile  face / wire / edge / vertex
 * @param dx,dy,dz sweep vector in meters (not required unit)
 * @param out      owned result shape
 */
OCC_API int occ_extrude_blind(occ_shape_t profile,
                              double dx, double dy, double dz,
                              occ_shape_t* out);

/**
 * Extrude a fixed depth along a direction. Direction is normalized;
 * result vector = depth * û. Depth must be > 0.
 */
OCC_API int occ_extrude_to_depth(occ_shape_t profile,
                                 double dir_x, double dir_y, double dir_z,
                                 double depth,
                                 occ_shape_t* out);

/**
 * Symmetric / midplane extrude: half_depth each side of the profile plane
 * along unit direction. Equivalent to prism of length 2*half_depth centered
 * on the profile (translate by -half_depth * û after prism of +û * 2h).
 *
 * @param half_depth  positive half-thickness in meters
 */
OCC_API int occ_extrude_symmetric(occ_shape_t profile,
                                  double dir_x, double dir_y, double dir_z,
                                  double half_depth,
                                  occ_shape_t* out);

/**
 * Through-all style extrude relative to another solid's bounding box.
 *
 * Algorithm (documented contract):
 *   1. Compute AABB of relative_to_solid (BRepBndLib).
 *   2. L = 2 * bbox_diagonal  (guarantees clearance both ways for typical parts).
 *   3. Build prism of length L along unit dir starting from the profile,
 *      then center it so the prism straddles the solid's projection
 *      (shift by -0.5*L along dir). If you only need a one-sided long
 *      extrusion, use occ_extrude_to_depth with a large depth instead.
 *
 * The result is the **tool body** (prism). Boolean cut/fuse against the
 * solid is the caller's job (product feature layer).
 *
 * @param relative_to_solid  any shape with finite bbox; used only for size
 */
OCC_API int occ_extrude_through_all(occ_shape_t profile,
                                    double dir_x, double dir_y, double dir_z,
                                    occ_shape_t relative_to_solid,
                                    occ_shape_t* out);

/* =========================================================================
 * Revolve
 * ========================================================================= */

/**
 * Full revolution (angle = 2π) of profile about axis (px,py,pz)+(ax,ay,az).
 * Axis direction is normalized.
 */
OCC_API int occ_revolve_full(occ_shape_t profile,
                             double px, double py, double pz,
                             double ax, double ay, double az,
                             occ_shape_t* out);

/* =========================================================================
 * Loft with solid / ruled flags
 * ========================================================================= */

/**
 * Loft through wire/vertex sections as a solid (isSolid=true).
 * @param ruled  if non-zero, ruled surfaces between consecutive sections
 */
OCC_API int occ_loft_solid(const occ_shape_t* profiles, int n, int ruled,
                           occ_shape_t* out);

/**
 * Loft with explicit solid and ruled flags (full ThruSections control).
 * @param solid  non-zero → solid, else shell
 * @param ruled  non-zero → ruled faces, else smoothed approximation
 */
OCC_API int occ_loft_ruled(const occ_shape_t* profiles, int n,
                           int solid, int ruled,
                           occ_shape_t* out);

/* =========================================================================
 * Helix wire (springs, threads P2 — implemented)
 * ========================================================================= */

/**
 * Build an open helical wire on a cylinder.
 *
 * Construction (OCCT tutorial pattern):
 *   Geom_CylindricalSurface(ax2, radius)
 *   2D line/segment in (U,V) with U=angle, V=height:
 *       P0 = (0, 0),  P1 = (±2π · turns, height)
 *   BRepBuilderAPI_MakeEdge(curve2d, surface)
 *   BRepLib::BuildCurves3d
 *   BRepBuilderAPI_MakeWire
 *
 * @param axis_px,py,pz  axis origin
 * @param axis_dx,dy,dz  axis direction (normalized)
 * @param radius         cylinder radius > 0
 * @param pitch          height advance per full turn > 0
 * @param height         total axial length > 0  (turns = height/pitch)
 * @param right_handed   non-zero → right-handed (U increases with V);
 *                       zero → left-handed (U decreases)
 * @param out            wire shape
 */
OCC_API int occ_make_helix_wire(double axis_px, double axis_py, double axis_pz,
                                double axis_dx, double axis_dy, double axis_dz,
                                double radius, double pitch, double height,
                                int right_handed,
                                occ_shape_t* out);

/**
 * Convenience: number of turns instead of height.
 * height = turns * pitch. turns must be > 0.
 */
OCC_API int occ_make_helix_wire_turns(double axis_px, double axis_py,
                                      double axis_pz,
                                      double axis_dx, double axis_dy,
                                      double axis_dz,
                                      double radius, double pitch,
                                      double turns, int right_handed,
                                      occ_shape_t* out);

/* =========================================================================
 * Pipe / sweep along spine
 * ========================================================================= */

/**
 * Sweep profile along a spine wire (BRepOffsetAPI_MakePipe).
 * Semantic alias of baseline occ_pipe with stricter validation + error text.
 */
OCC_API int occ_sweep_profile_along_wire(occ_shape_t profile,
                                         occ_shape_t spine_wire,
                                         occ_shape_t* out);

/**
 * Helical spring solid: circle profile of wire_radius swept along helix.
 * Builds helix then MakePipe. Useful for AI-BOOST springs / P2 threads prep.
 */
OCC_API int occ_make_spring_solid(double axis_px, double axis_py, double axis_pz,
                                  double axis_dx, double axis_dy, double axis_dz,
                                  double coil_radius, double pitch,
                                  double height, double wire_radius,
                                  int right_handed,
                                  occ_shape_t* out);

/* =========================================================================
 * Thicken / offset / sew / solidify
 * ========================================================================= */

/**
 * Thicken an open face or shell into a solid by offset distance.
 * Uses MakeThickSolidBySimple (no face-removal list).
 * Positive thickness offsets along face normal (OCCT convention).
 */
OCC_API int occ_thicken_shell(occ_shape_t shell_or_face, double thickness,
                              occ_shape_t* out);

/**
 * Offset a face (or shell) by distance; returns the offset shell/face shape.
 * Uses MakeOffsetShape::PerformBySimple.
 */
OCC_API int occ_offset_face(occ_shape_t face, double offset, occ_shape_t* out);

/**
 * Sew an array of faces (or shells) into a single sewed shape (usually shell).
 * @param shapes  array of face/shell/compound-of-faces
 * @param n       count ≥ 1
 * @param tol     sewing tolerance in meters (e.g. 1e-6)
 */
OCC_API int occ_sew_faces(const occ_shape_t* shapes, int n, double tol,
                          occ_shape_t* out);

/**
 * Promote a closed shell to a solid (BRepBuilderAPI_MakeSolid).
 * Shell must be closed and orientable; no geometric healing is performed.
 */
OCC_API int occ_make_solid_from_shell(occ_shape_t shell, occ_shape_t* out);

/**
 * Sew faces then attempt solidification in one call.
 * If sew result is already a solid, returns it; if shell, MakeSolid.
 */
OCC_API int occ_sew_to_solid(const occ_shape_t* shapes, int n, double tol,
                             occ_shape_t* out);

/* =========================================================================
 * Diagnostics helpers (bbox / diagonal — used by through-all)
 * ========================================================================= */

/** Axis-aligned bbox of shape; out_min/out_max are length-3 arrays. */
OCC_API int occ_sweep_bbox(occ_shape_t s, double out_min[3], double out_max[3]);

/** Bounding-box space diagonal (sqrt of sum of squared side lengths). */
OCC_API int occ_sweep_bbox_diagonal(occ_shape_t s, double* out_diag);

/* =========================================================================
 * DRAFT SKIP (P2 — intentionally not implemented in this module)
 * =========================================================================
 *
 * Product draft / taper would map to:
 *   - BRepOffsetAPI_DraftAngle  (draft faces of a solid)
 *   - BRepFeat_MakePrism with draft angle
 *   - BRepOffsetAPI_MakeDraft   (draft surface from wire)
 *
 * Exporting a half-baked occ_draft_* would invite silent geometry errors on
 * non-manifold skid parts. Callers must treat draft as unsupported:
 *
 *   if (feature.draft_deg != 0) return product_error("draft not in kernel P0");
 *
 * When draft is added, put it in occ_c_draft.h — do not bolt it onto extrude
 * extents here without a solid regression suite.
 */

#ifdef __cplusplus
}
#endif

#endif /* OCC_C_SWEEP_EXT_H_ */
