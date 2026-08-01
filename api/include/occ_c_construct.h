/*
 * occ_c_construct.h — construction geometry: points, planes, edges, wires, faces.
 *
 * Why this module exists
 * ----------------------
 * Baseline occ_c.h is solids-first (box, cylinder, boolean, fillet). Real CAD
 * needs intermediate 1D/2D pieces: edges for sweeps, closed wires as profiles,
 * planar faces as extrude/revolve inputs, and a POD plane for sketch-like work.
 * This module is that layer — explicit coordinates only. There is no sketch
 * constraint solver, no dimensions, no history.
 *
 * How to use it (typical profile → solid path)
 * --------------------------------------------
 *   1. Build a closed planar wire:
 *        occ_make_polygon_wire / occ_make_rectangle_wire / occ_make_circle_wire
 *        or assemble edges with occ_make_wire_from_edges.
 *   2. Promote to a face:
 *        occ_make_planar_face_from_wire  (or occ_make_face_* shortcuts).
 *   3. Sweep / extrude with baseline or occ_c_sweep_ext.h.
 *
 * Plane POD (occ_plane_t)
 * -----------------------
 * An infinite plane is NOT a BREP shape. It is origin + unit normal + unit X
 * in the plane. Builders store n and x normalized; Y is implied (n × x).
 * Use UV helpers (occ_make_segment_on_plane) when authoring in plane coords.
 *
 * Wire choice
 * -----------
 *   polyline      — successive line edges; fine for open paths.
 *   polygon_wire  — preferred closed profile for faces (robust closure).
 *   edges → wire  — when you already have arcs/splines as edge shapes.
 *
 * Ownership & conventions
 * -----------------------
 * Every successful *out shape is caller-owned → occ_shape_free.
 * Inputs are never freed by the callee. Topology indices (wire_at, count_wires)
 * are 1-based. Units: meters. Angles: radians.
 *
 * Implementation: api/src/occ_c_construct.cc (thin maps only).
 */
#ifndef OCC_C_CONSTRUCT_H_
#define OCC_C_CONSTRUCT_H_

#include "occ_c.h"

#ifdef __cplusplus
extern "C" {
#endif

/* ---- Infinite plane as POD (not a BREP shape) ---- */
typedef struct occ_plane_s {
  double o[3];  /* origin, meters */
  double n[3];  /* unit normal (stored normalized by builders) */
  double x[3];  /* unit X axis in plane, orthogonal to n */
} occ_plane_t;

/* ---- Vertices / edges ---- */

/** Single vertex shape at (x,y,z) meters. */
OCC_API int occ_make_vertex(double x, double y, double z, occ_shape_t* out);

/** Straight edge from (x0,y0,z0) to (x1,y1,z1). Zero-length → OCC_ERR_GEOM. */
OCC_API int occ_make_edge_line(double x0, double y0, double z0,
                               double x1, double y1, double z1,
                               occ_shape_t* out);

/** Full circle as a single closed edge. Center, unit normal, radius > 0. */
OCC_API int occ_make_edge_circle(double cx, double cy, double cz,
                                 double nx, double ny, double nz,
                                 double radius, occ_shape_t* out);

/** Circular arc through three points (P1 start, P2 on-arc, P3 end).
 *  Collinear or coincident points → OCC_ERR_GEOM. */
OCC_API int occ_make_edge_arc_3pt(double x1, double y1, double z1,
                                  double x2, double y2, double z2,
                                  double x3, double y3, double z3,
                                  occ_shape_t* out);

/** Arc of circle about center/normal with angular range [a0, a1] radians.
 *  Sense follows increasing angle when a1 > a0. */
OCC_API int occ_make_edge_arc_center(double cx, double cy, double cz,
                                     double nx, double ny, double nz,
                                     double radius,
                                     double a0_rad, double a1_rad,
                                     occ_shape_t* out);

/* ---- Wires ---- */

/** Open or closed polyline via successive line edges.
 *  xyz is length 3*n: [x0,y0,z0, x1,y1,z1, ...]. closed≠0 connects last→first. */
OCC_API int occ_make_polyline(const double* xyz, int n, int closed,
                              occ_shape_t* out);

/** Polygonal wire preferred for face profiles (robust endpoint closure). */
OCC_API int occ_make_polygon_wire(const double* xyz, int n, int closed,
                                  occ_shape_t* out);

/** Axis-aligned rectangle in a plane defined by center + normal.
 *  Local X is auto-picked from the normal. width/height are full extents. */
OCC_API int occ_make_rectangle_wire(double cx, double cy, double cz,
                                    double nx, double ny, double nz,
                                    double width, double height,
                                    occ_shape_t* out);

/** Full circle as a wire (one closed edge). */
OCC_API int occ_make_circle_wire(double cx, double cy, double cz,
                                 double nx, double ny, double nz,
                                 double radius, occ_shape_t* out);

/** Assemble ordered edges into a wire. Each edges[i] must be an edge shape. */
OCC_API int occ_make_wire_from_edges(const occ_shape_t* edges, int n,
                                     occ_shape_t* out);

OCC_API int occ_wire_is_closed(occ_shape_t wire, int* out_closed);
OCC_API int occ_wire_length(occ_shape_t wire, double* out_len);
/** Reverse orientation; returns a new owned wire. */
OCC_API int occ_wire_reverse(occ_shape_t wire, occ_shape_t* out);

/** Topology helpers for compounds containing wires (1-based indices). */
OCC_API int occ_count_wires(occ_shape_t s, int* out);
OCC_API int occ_wire_at(occ_shape_t s, int idx, occ_shape_t* out);

/* ---- Faces ---- */

/** Planar face from a closed wire (planar constraint enforced). */
OCC_API int occ_make_planar_face_from_wire(occ_shape_t wire, occ_shape_t* out);

OCC_API int occ_make_face_circle(double cx, double cy, double cz,
                                 double nx, double ny, double nz,
                                 double radius, occ_shape_t* out);

/** Rectangle face: center + normal, width × height (full dimensions). */
OCC_API int occ_make_face_rectangle(double cx, double cy, double cz,
                                    double nx, double ny, double nz,
                                    double width, double height,
                                    occ_shape_t* out);

/** Face from polygon points (closed automatically; n ≥ 3). */
OCC_API int occ_make_face_polygon(const double* xyz, int n, occ_shape_t* out);

/** Construction plane as a thin rectangular face (viz / pick aids).
 *  half_w, half_h are half-extents in meters along plane X and Y. */
OCC_API int occ_make_plane_rect(double ox, double oy, double oz,
                                double nx, double ny, double nz,
                                double xdirx, double xdiry, double xdirz,
                                double half_w, double half_h,
                                occ_shape_t* out);

/* ---- Plane POD helpers ---- */

OCC_API int occ_plane_from_3pts(double x1, double y1, double z1,
                                double x2, double y2, double z2,
                                double x3, double y3, double z3,
                                occ_plane_t* out);

OCC_API int occ_plane_from_point_normal(double ox, double oy, double oz,
                                        double nx, double ny, double nz,
                                        occ_plane_t* out);

/** Project world point onto plane; writes 3D coordinates into out_xyz[3]. */
OCC_API int occ_plane_project_point(const occ_plane_t* pln,
                                    double x, double y, double z,
                                    double out_xyz[3]);

/** Line segment from plane UV coordinates (meters in plane frame). */
OCC_API int occ_make_segment_on_plane(const occ_plane_t* pln,
                                      double u0, double v0,
                                      double u1, double v1,
                                      occ_shape_t* out);

/** Planar wire offset. dist in meters; positive = left of wire orientation. */
OCC_API int occ_offset_wire_2d(occ_shape_t wire, double dist, occ_shape_t* out);

/** B-spline wire through points. degree is preferred max degree (clamped 1..8).
 *  periodic≠0 builds a closed periodic spline; else interpolating open curve.
 *  Returns a wire with one edge. n ≥ 2 (more for higher degree). */
OCC_API int occ_make_bspline_wire_through_points(const double* xyz, int n,
                                                 int degree, int periodic,
                                                 occ_shape_t* out);

#ifdef __cplusplus
}  /* extern "C" */
#endif

#endif  /* OCC_C_CONSTRUCT_H_ */
