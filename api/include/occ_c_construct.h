// Construction geometry for occ_c — points, planes, edges, wires, faces.
// Explicit coordinates only (no sketch constraint solver).
// Units: meters. Angles: radians. Topology indices: 1-based.
#ifndef OCC_C_CONSTRUCT_H_
#define OCC_C_CONSTRUCT_H_

#include "occ_c.h"

#ifdef __cplusplus
extern "C" {
#endif

/* ---- Infinite plane as POD (not a TopoDS shape) ---- */
typedef struct occ_plane_s {
  double o[3];  /* origin, meters */
  double n[3];  /* unit normal (stored normalized by builders) */
  double x[3];  /* unit X axis in plane, orthogonal to n */
} occ_plane_t;

/* ---- Vertices / edges ---- */
OCC_API int occ_make_vertex(double x, double y, double z, occ_shape_t* out);

OCC_API int occ_make_edge_line(double x0, double y0, double z0,
                               double x1, double y1, double z1,
                               occ_shape_t* out);

/* Full circle as a single closed edge (gp_Circ). */
OCC_API int occ_make_edge_circle(double cx, double cy, double cz,
                                 double nx, double ny, double nz,
                                 double radius, occ_shape_t* out);

/* Arc through three points (P1 start, P2 on-arc, P3 end). GC_MakeArcOfCircle. */
OCC_API int occ_make_edge_arc_3pt(double x1, double y1, double z1,
                                  double x2, double y2, double z2,
                                  double x3, double y3, double z3,
                                  occ_shape_t* out);

/* Arc of circle about center/normal with angular range [a0, a1] radians.
 * Sense follows increasing angle when a1 > a0; OCCT Sense = Standard_True. */
OCC_API int occ_make_edge_arc_center(double cx, double cy, double cz,
                                     double nx, double ny, double nz,
                                     double radius,
                                     double a0_rad, double a1_rad,
                                     occ_shape_t* out);

/* ---- Wires ---- */

/* Open or closed polyline via successive line edges + MakeWire.
 * xyz is length 3*n: [x0,y0,z0, x1,y1,z1, ...]. closed≠0 connects last→first. */
OCC_API int occ_make_polyline(const double* xyz, int n, int closed,
                              occ_shape_t* out);

/* Polygonal wire via BRepBuilderAPI_MakePolygon (preferred for face profiles). */
OCC_API int occ_make_polygon_wire(const double* xyz, int n, int closed,
                                  occ_shape_t* out);

/* Axis-aligned rectangle in a plane defined by center + normal.
 * Local X is chosen by gp_Ax2 from the normal. width/height in meters. */
OCC_API int occ_make_rectangle_wire(double cx, double cy, double cz,
                                    double nx, double ny, double nz,
                                    double width, double height,
                                    occ_shape_t* out);

/* Full circle as a wire (one edge). */
OCC_API int occ_make_circle_wire(double cx, double cy, double cz,
                                 double nx, double ny, double nz,
                                 double radius, occ_shape_t* out);

/* Assemble ordered edges into a wire. Each edges[i] must be TopAbs_EDGE. */
OCC_API int occ_make_wire_from_edges(const occ_shape_t* edges, int n,
                                     occ_shape_t* out);

OCC_API int occ_wire_is_closed(occ_shape_t wire, int* out_closed);
OCC_API int occ_wire_length(occ_shape_t wire, double* out_len);
OCC_API int occ_wire_reverse(occ_shape_t wire, occ_shape_t* out);

/* Topology helpers for compounds containing wires (1-based). */
OCC_API int occ_count_wires(occ_shape_t s, int* out);
OCC_API int occ_wire_at(occ_shape_t s, int idx, occ_shape_t* out);

/* ---- Faces ---- */

/* Planar face from a closed wire (BRepBuilderAPI_MakeFace, OnlyPlane). */
OCC_API int occ_make_planar_face_from_wire(occ_shape_t wire, occ_shape_t* out);

OCC_API int occ_make_face_circle(double cx, double cy, double cz,
                                 double nx, double ny, double nz,
                                 double radius, occ_shape_t* out);

/* Rectangle face: center + normal, width × height (full dimensions). */
OCC_API int occ_make_face_rectangle(double cx, double cy, double cz,
                                    double nx, double ny, double nz,
                                    double width, double height,
                                    occ_shape_t* out);

/* Face from polygon points (closed automatically). */
OCC_API int occ_make_face_polygon(const double* xyz, int n, occ_shape_t* out);

/* Construction plane as a thin rectangular face (viz / pick).
 * half_w, half_h are half-extents in meters along plane X and Y. */
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

/* Project world point onto plane; writes 3D coordinates into out_xyz[3]. */
OCC_API int occ_plane_project_point(const occ_plane_t* pln,
                                    double x, double y, double z,
                                    double out_xyz[3]);

/* Line segment from plane UV coordinates (meters in plane frame). */
OCC_API int occ_make_segment_on_plane(const occ_plane_t* pln,
                                      double u0, double v0,
                                      double u1, double v1,
                                      occ_shape_t* out);

/* Planar wire offset (BRepOffsetAPI_MakeOffset). dist in meters;
 * positive = left of wire orientation (OCCT convention). */
OCC_API int occ_offset_wire_2d(occ_shape_t wire, double dist, occ_shape_t* out);

/* BSpline through points. degree is preferred DegMax (clamped 1..8).
 * periodic≠0 uses GeomAPI_Interpolate; else GeomAPI_PointsToBSpline.
 * Returns a wire with one edge. */
OCC_API int occ_make_bspline_wire_through_points(const double* xyz, int n,
                                                 int degree, int periodic,
                                                 occ_shape_t* out);

#ifdef __cplusplus
}  /* extern "C" */
#endif

#endif  /* OCC_C_CONSTRUCT_H_ */
