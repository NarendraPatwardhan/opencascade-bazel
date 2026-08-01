/*
 * occ_c_route.h — pipe centerlines and solids for skid-style geometry.
 *
 * Teaching walk-through (read with occ_c_route.cc):
 *
 *   1. Build a centerline wire with circular fillets at corners:
 *        occ_make_route_with_bends(nodes, n, R, &wire)
 *      Algorithm: unit leg directions u,v; turn angle α; trim length
 *      L = R·tan(α/2); circular arc in the plane of (u,v).
 *
 *   2. Sweep a hollow pipe along that wire:
 *        occ_pipe_annulus(OD, ID, wire, &solid)
 *      Implementation builds ONE planar annular face (outer circle + inner
 *      hole) at the spine start frame, then a single pipe sweep. We avoid
 *      solid_outer − solid_inner booleans on long spines (fragile under some
 *      toolchains).
 *
 *   3. Structural members: rectangular/circular profiles along the same spine.
 *
 * Units: meters. Depends on occ_frame_t from occ_c_frames.h.
 */
#ifndef OCC_C_ROUTE_H_
#define OCC_C_ROUTE_H_

#include "occ_c.h"
#include "occ_c_frames.h"

#ifdef __cplusplus
extern "C" {
#endif

/* =========================================================================
 * Centerline routes
 * ========================================================================= */

/**
 * Polyline wire through n_points samples of xyz[3*i+{0,1,2}] (meters).
 * If closed != 0, connects last point back to first (n_points >= 3).
 * Degenerate zero-length segments → OCC_ERR_GEOM.
 */
OCC_API int occ_make_route_polyline(const double* xyz, int n_points, int closed,
                                    occ_shape_t* out_wire);

/**
 * Polyline with circular bend fillets of radius bend_radius (meters) at every
 * interior vertex. Closed loops: if first and last samples coincide (within
 * 1e-9 m), the duplicate is dropped and the wrap-around corner is filleted.
 *
 * Algorithm: for turn angle alpha between unit segment directions u,v:
 *   L = R * tan(alpha/2); trim both legs by L; arc in plane of (u,v) via
 *   circular arc through (trim1, mid_arc, trim2).
 *
 * Collinear corners are skipped. Hairpin (alpha ≈ π) → OCC_ERR_GEOM.
 * Too-short legs for the requested R → OCC_ERR_MATH.
 * bend_radius == 0 falls back to occ_make_route_polyline (open).
 */
OCC_API int occ_make_route_with_bends(const double* xyz, int n_points,
                                      double bend_radius,
                                      occ_shape_t* out_wire);

/**
 * Arc-length of a wire (or any shape with edges) via BRepGProp::LinearProperties.
 * out_len in meters.
 */
/* occ_wire_length: occ_c_construct.h */

/**
 * Point + unit tangent at the geometric start (at_start != 0) or end of a wire.
 * Tangent follows wire direction of travel (start→end). origin/tangent are
 * length-3 arrays (meters / unitless). For a full occ_frame_t use
 * occ_frame_at_wire_fraction(wire, at_start ? 0 : 1, &f).
 */
OCC_API int occ_wire_end_point_tangent(occ_shape_t wire, int at_start,
                                  double origin[3], double tangent[3]);

/**
 * Frame at fractional arc-length position t ∈ [0,1] along wire.
 * Uses cumulative edge lengths (preferred) with BRepAdaptor_Curve per edge;
 * falls back to BRepAdaptor_CompCurve parameter lerp if length is zero.
 * Z = unit tangent in the direction of increasing arc length.
 */
OCC_API int occ_frame_at_wire_fraction(occ_shape_t wire, double t,
                                       occ_frame_t* out_frame);

/**
 * One frame per route node. For i = 0..n-2: Z along outbound segment
 * (P_{i+1}-P_i). For the last node of an open path: Z along inbound
 * (P_{n-1}-P_{n-2}). Closed: every node uses outbound (wrap).
 * out_frames must hold at least n elements.
 */
OCC_API int occ_route_node_frames(const double* xyz, int n,
                                  int closed, occ_frame_t* out_frames);

/* =========================================================================
 * Profiles for sweeping (construction helpers, centered at origin on XY)
 * ========================================================================= */

/**
 * Planar circular face of given radius, center (cx,cy,cz), normal (nx,ny,nz).
 * Used as MakePipe profile for solid / annulus OD & ID.
 */
OCC_API int occ_make_circle_face(double cx, double cy, double cz,
                                 double nx, double ny, double nz,
                                 double radius, occ_shape_t* out);

/**
 * Rectangular profile wire centered at origin on the XY plane:
 * corners at (±width/2, ±height/2, 0), closed. Ready to transform to a spine
 * start frame before MakePipe, or used internally by member sweeps.
 */
OCC_API int occ_make_rect_profile_wire(double width, double height,
                                       occ_shape_t* out_wire);

/**
 * Circular profile wire (not face) of radius r, center origin, normal +Z.
 * Convenience for MakePipeShell and circular members.
 */
OCC_API int occ_make_circle_profile_wire(double radius, occ_shape_t* out_wire);

/* =========================================================================
 * Pipe solids (fluid path — SweepAlong)
 * ========================================================================= */

/**
 * Sweep profile (face or wire) along spine_wire with BRepOffsetAPI_MakePipe.
 * Spine should be G1 (use occ_make_route_with_bends). Profile is used as-is
 * (caller places it at the spine start, normal ≈ tangent).
 */
OCC_API int occ_pipe_solid(occ_shape_t profile_face_or_wire,
                           occ_shape_t spine_wire,
                           occ_shape_t* out);

/**
 * Hollow pipe: OD outer diameter, ID inner diameter (meters), both > 0, id < od.
 * Builds circle faces at spine start (normal = start tangent), MakePipe each,
 * then BRepAlgoAPI_Cut(OD, ID).
 */
OCC_API int occ_pipe_annulus(double od, double id, occ_shape_t spine_wire,
                             occ_shape_t* out);

/**
 * BRepOffsetAPI_MakePipeShell path:
 *   SetMode(Frenet=true), Add(profile, with_contact, WithCorrection=true),
 *   Build(), MakeSolid().
 * profile must be a wire (preferably closed for solid). with_contact != 0
 * translates the section onto the spine.
 */
OCC_API int occ_pipe_shell_profile(occ_shape_t profile_wire,
                                   occ_shape_t spine_wire,
                                   int with_contact,
                                   occ_shape_t* out);

/* =========================================================================
 * Structural members (skid steel — NOT fluid pipe)
 * ========================================================================= */

/**
 * Rectangular tube/bar of cross-section width × height (meters), centered on
 * the spine. Profile is built in the spine-start frame's XY (Z = tangent).
 * Uses BRepOffsetAPI_MakePipe on a planar rectangular face.
 */
OCC_API int occ_member_sweep_rect(double width, double height,
                                  occ_shape_t spine_wire,
                                  occ_shape_t* out);

/**
 * Circular bar / round HSS of given radius (meters) along spine.
 */
OCC_API int occ_member_sweep_circle(double radius, occ_shape_t spine_wire,
                                    occ_shape_t* out);

#ifdef __cplusplus
}
#endif
#endif /* OCC_C_ROUTE_H_ */
