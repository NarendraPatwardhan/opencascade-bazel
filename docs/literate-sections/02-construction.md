# 02 — Construction Geometry (Wires, Faces, Planes, Curves)

**Module:** `occ_c_construct`  
**Section of:** `occ_c` P0 literate API expansion  
**OCCT pin:** **7.9.3**  
**Depends on:** `occ_c.h`, `occ_c_internal.hxx` (shared `as_shape` / `to_handle` / `OCC_GUARD_*` / `REQ` / `set_last`)  
**Status enum:** requires `OCC_ERR_GEOM = 8` from the intro patch  
**Units:** meters · **angles:** radians · **topology indices:** 1-based  

---

## Pedagogy — why this module exists

CAD kernels expose two worlds:

1. **Topology** — `TopoDS_Vertex` / `Edge` / `Wire` / `Face` / `Solid` (what `occ_shape_t` holds).
2. **Geometry** — `gp_Pnt`, `gp_Pln`, `gp_Circ`, `Geom_BSplineCurve` (math under the topology).

FeatureScript / IR nodes such as **MakePoint**, **MakePlane**, and **Sketch2D** (explicit-coords mode only) are *not* constraint solvers. They lower to pure construction calls that build BREP atoms which later feed `occ_extrude`, `occ_revolve`, `occ_pipe`, and route polylines.

```text
IR MakePoint(x,y,z)          →  occ_make_vertex
IR MakePlane(o,n,x)          →  occ_plane_t POD  (+ optional occ_make_plane_rect face for viz)
IR Sketch2D line/arc/circle  →  occ_make_edge_*  →  occ_make_wire_from_edges
IR Sketch2D closed profile   →  occ_make_planar_face_from_wire
IR RoutePath polyline        →  occ_make_polyline / occ_make_bspline_wire_through_points
IR Rectangle / Polygon       →  occ_make_rectangle_wire / occ_make_polygon_wire → face
```

**Out of scope here:** 2D constraint solving, dimension-driven sketches, assembly mates. Those live above this C layer. Coordinates arrive already solved.

### OCCT 7.9.3 class map

| C symbol | Primary OCCT type |
|----------|-------------------|
| `occ_make_vertex` | `BRepBuilderAPI_MakeVertex` + `gp_Pnt` |
| `occ_make_edge_line` | `BRepBuilderAPI_MakeEdge(gp_Pnt, gp_Pnt)` |
| `occ_make_edge_circle` | `BRepBuilderAPI_MakeEdge(gp_Circ)` / `GC_MakeCircle` |
| `occ_make_edge_arc_3pt` | `GC_MakeArcOfCircle(P1,P2,P3)` + `MakeEdge` |
| `occ_make_edge_arc_center` | `GC_MakeArcOfCircle(gp_Circ, α0, α1, sense)` |
| `occ_make_polyline` | successive `MakeEdge` + `BRepBuilderAPI_MakeWire` |
| `occ_make_polygon_wire` | `BRepBuilderAPI_MakePolygon` |
| `occ_make_rectangle_wire` | 4 corners via `gp_Ax2` + `MakePolygon` |
| `occ_make_circle_wire` | circle edge → `MakeWire` |
| `occ_make_wire_from_edges` | `BRepBuilderAPI_MakeWire::Add` |
| `occ_wire_is_closed` | `TopoDS_Shape::Closed()` + endpoint gap check |
| `occ_wire_length` | `BRepAdaptor_CompCurve` + `GCPnts_AbscissaPoint::Length` |
| `occ_wire_reverse` | `TopoDS_Shape::Reversed()` |
| `occ_make_planar_face_from_wire` | `BRepBuilderAPI_MakeFace(wire, OnlyPlane=true)` |
| `occ_make_face_circle` | `MakeFace(gp_Circ plane + wire)` / circle face |
| `occ_make_face_rectangle` | rectangle wire → planar face |
| `occ_make_face_polygon` | polygon wire → planar face |
| `occ_make_plane_rect` | `BRepBuilderAPI_MakeFace(gp_Pln, -hw..hw, -hh..hh)` |
| `occ_plane_t` | POD: origin + normal + X dir (infinite plane params) |
| `occ_plane_from_3pts` | `gp_Pln(P1,P2,P3)` / cross-product basis |
| `occ_plane_from_point_normal` | `gp_Pln(P, Dir)` + auto X |
| `occ_plane_project_point` | signed distance along normal |
| `occ_make_segment_on_plane` | UV → 3D via `gp_Ax3` + `MakeEdge` |
| `occ_offset_wire_2d` | `BRepOffsetAPI_MakeOffset` |
| `occ_make_bspline_wire_through_points` | `GeomAPI_PointsToBSpline` / `GeomAPI_Interpolate` |
| `occ_count_wires` / `occ_wire_at` | `TopExp::MapShapes(..., TopAbs_WIRE, ...)` |

---

## IR lowering recipes (explicit Sketch2D)

### MakePoint

```text
MakePoint { x, y, z }  // meters, world
  → occ_make_vertex(x, y, z, &v)
  // optional: keep in host registry by entity id; C does not name entities
```

### MakePlane

```text
MakePlane { origin[3], normal[3], x_dir[3]? }
  → if x_dir given:
       occ_plane_from_point_normal + overwrite x via occ_plane_t fields
       // or fill occ_plane_t directly after validating axes
  → else:
       occ_plane_from_point_normal(o, n, &pln)
  // viz (construction plane rectangle):
  → occ_make_plane_rect(o..., n..., x..., half_w, half_h, &face)
```

Infinite planes are **not** BREP solids. Store `occ_plane_t` in the host. Only materialize a thin rectangular face when the UI needs a pickable / drawable plane.

### Sketch2D (explicit coordinates, no solver)

Sketch entities live in a plane `occ_plane_t pln`. 2D sketch coords `(u,v)` map to 3D:

```
P = O + u * X + v * Y
Y = N × X   (right-handed)
```

| Sketch entity | Lowering |
|---------------|----------|
| Point `(u,v)` | `occ_plane_project` not needed; `O+uX+vY` → `occ_make_vertex` |
| Line `(u0,v0)-(u1,v1)` | `occ_make_segment_on_plane(&pln, u0,v0, u1,v1, &e)` |
| Full circle | build center 3D + normal → `occ_make_edge_circle` / `occ_make_circle_wire` |
| Arc 3 points | three 3D points → `occ_make_edge_arc_3pt` |
| Arc center+angles | `occ_make_edge_arc_center` |
| Polyline profile | pack `xyz[]` → `occ_make_polyline` / `occ_make_polygon_wire` |
| Closed profile for extrude | wire → `occ_make_planar_face_from_wire` |
| Offset profile | `occ_offset_wire_2d` |

Connect edges with `occ_make_wire_from_edges` when the sketch yields a sequence of independent edges (typical after IR emission). Prefer `occ_make_polygon_wire` when all segments are straight.

### Route / extrude / revolve consumers

```text
polyline route          → occ_make_polyline(xyz, n, /*closed=*/0, &spine)
                          → occ_pipe(profile, spine, &solid)
closed rectangle profile → occ_make_face_rectangle(...) → occ_extrude(face, dx,dy,dz, &solid)
circle profile           → occ_make_face_circle(...) → occ_revolve / occ_extrude
bspline path             → occ_make_bspline_wire_through_points → pipe/sweep
```

---

## Header — extractable

```c
// === file: occ_c_construct.h
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
```

---

## Implementation — extractable

```cpp
// === file: occ_c_construct.cc
// Construction geometry — thin C over OCCT 7.9.3.
#include "occ_c_construct.h"
#include "occ_c_internal.hxx"

#include <cmath>
#include <vector>

#include <BRepAdaptor_CompCurve.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeVertex.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepGProp.hxx>
#include <BRepOffsetAPI_MakeOffset.hxx>
#include <BRep_Tool.hxx>
#include <GCPnts_AbscissaPoint.hxx>
#include <GC_MakeArcOfCircle.hxx>
#include <GC_MakeCircle.hxx>
#include <GeomAPI_Interpolate.hxx>
#include <GeomAPI_PointsToBSpline.hxx>
#include <Geom_BSplineCurve.hxx>
#include <Geom_Circle.hxx>
#include <Geom_TrimmedCurve.hxx>
#include <GProp_GProps.hxx>
#include <TColgp_Array1OfPnt.hxx>
#include <TColgp_HArray1OfPnt.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Vertex.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Ax2.hxx>
#include <gp_Ax3.hxx>
#include <gp_Circ.hxx>
#include <gp_Dir.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>

using occ_c_detail::as_shape;
using occ_c_detail::to_handle;
using occ_c_detail::set_last;

namespace {

constexpr double k_eps = 1.0e-12;
constexpr double k_gap = 1.0e-7;  // meters — wire endpoint closure tolerance

double vlen3(double x, double y, double z) {
  return std::sqrt(x * x + y * y + z * z);
}

int require_unit_dir(double x, double y, double z, gp_Dir& out, const char* what) {
  const double L = vlen3(x, y, z);
  if (L < k_eps) {
    set_last(what);
    return OCC_ERR_GEOM;
  }
  out = gp_Dir(x / L, y / L, z / L);
  return OCC_OK;
}

/* Fill plane POD from gp_Ax3 (Z = normal, X = x_dir). */
void plane_from_ax3(const gp_Ax3& ax, occ_plane_t* out) {
  const gp_Pnt o = ax.Location();
  const gp_Dir n = ax.Direction();
  const gp_Dir x = ax.XDirection();
  out->o[0] = o.X(); out->o[1] = o.Y(); out->o[2] = o.Z();
  out->n[0] = n.X(); out->n[1] = n.Y(); out->n[2] = n.Z();
  out->x[0] = x.X(); out->x[1] = x.Y(); out->x[2] = x.Z();
}

int plane_to_ax3(const occ_plane_t& p, gp_Ax3& out) {
  const double nl = vlen3(p.n[0], p.n[1], p.n[2]);
  const double xl = vlen3(p.x[0], p.x[1], p.x[2]);
  if (nl < k_eps || xl < k_eps) {
    set_last("plane axis length near zero");
    return OCC_ERR_GEOM;
  }
  gp_Dir n(p.n[0] / nl, p.n[1] / nl, p.n[2] / nl);
  gp_Dir x(p.x[0] / xl, p.x[1] / xl, p.x[2] / xl);
  if (std::abs(x.Dot(n)) > 1.0 - 1.0e-9) {
    set_last("plane X parallel to normal");
    return OCC_ERR_GEOM;
  }
  out = gp_Ax3(gp_Pnt(p.o[0], p.o[1], p.o[2]), n, x);
  return OCC_OK;
}

gp_Pnt uv_to_pnt(const gp_Ax3& ax, double u, double v) {
  const gp_Pnt o = ax.Location();
  const gp_Dir xd = ax.XDirection();
  const gp_Dir yd = ax.YDirection();
  return gp_Pnt(o.X() + u * xd.X() + v * yd.X(),
                o.Y() + u * xd.Y() + v * yd.Y(),
                o.Z() + u * xd.Z() + v * yd.Z());
}

int rectangle_corners(double cx, double cy, double cz,
                      double nx, double ny, double nz,
                      double width, double height,
                      gp_Pnt corners[4]) {
  if (width <= 0.0 || height <= 0.0) {
    set_last("rectangle width/height must be > 0");
    return OCC_ERR_GEOM;
  }
  gp_Dir n;
  int st = require_unit_dir(nx, ny, nz, n, "rectangle normal near zero");
  if (st != OCC_OK) return st;
  gp_Ax2 ax(gp_Pnt(cx, cy, cz), n);  // auto X from normal
  const gp_Dir xd = ax.XDirection();
  const gp_Dir yd = ax.YDirection();
  const double hw = 0.5 * width;
  const double hh = 0.5 * height;
  const gp_Pnt c(cx, cy, cz);
  // CCW when looking along -normal? Looking along +normal: X×Y = N, CCW.
  corners[0] = gp_Pnt(c.X() - hw * xd.X() - hh * yd.X(),
                      c.Y() - hw * xd.Y() - hh * yd.Y(),
                      c.Z() - hw * xd.Z() - hh * yd.Z());
  corners[1] = gp_Pnt(c.X() + hw * xd.X() - hh * yd.X(),
                      c.Y() + hw * xd.Y() - hh * yd.Y(),
                      c.Z() + hw * xd.Z() - hh * yd.Z());
  corners[2] = gp_Pnt(c.X() + hw * xd.X() + hh * yd.X(),
                      c.Y() + hw * xd.Y() + hh * yd.Y(),
                      c.Z() + hw * xd.Z() + hh * yd.Z());
  corners[3] = gp_Pnt(c.X() - hw * xd.X() + hh * yd.X(),
                      c.Y() - hw * xd.Y() + hh * yd.Y(),
                      c.Z() - hw * xd.Z() + hh * yd.Z());
  return OCC_OK;
}

int wire_from_closed_corners(const gp_Pnt corners[4], occ_shape_t* out) {
  BRepBuilderAPI_MakePolygon poly;
  for (int i = 0; i < 4; ++i) poly.Add(corners[i]);
  poly.Close();
  if (!poly.IsDone()) {
    set_last("rectangle polygon failed");
    return OCC_ERR_GEOM;
  }
  *out = to_handle(poly.Wire());
  return OCC_OK;
}

int edge_as_topo(occ_shape_t s, TopoDS_Edge& e) {
  if (!s || as_shape(s)->IsNull()) {
    set_last("null edge");
    return OCC_ERR_NULL_ARG;
  }
  if (as_shape(s)->ShapeType() != TopAbs_EDGE) {
    set_last("expected TopAbs_EDGE");
    return OCC_ERR_INVALID_SHAPE;
  }
  e = TopoDS::Edge(*as_shape(s));
  return OCC_OK;
}

int wire_as_topo(occ_shape_t s, TopoDS_Wire& w) {
  if (!s || as_shape(s)->IsNull()) {
    set_last("null wire");
    return OCC_ERR_NULL_ARG;
  }
  if (as_shape(s)->ShapeType() != TopAbs_WIRE) {
    set_last("expected TopAbs_WIRE");
    return OCC_ERR_INVALID_SHAPE;
  }
  w = TopoDS::Wire(*as_shape(s));
  return OCC_OK;
}

}  // namespace

extern "C" {

/* =========================================================================
 * Vertices / edges
 * ========================================================================= */

int occ_make_vertex(double x, double y, double z, occ_shape_t* out) {
  REQ(out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  *out = to_handle(BRepBuilderAPI_MakeVertex(gp_Pnt(x, y, z)).Vertex());
  return OCC_OK;
  OCC_GUARD_END
}

int occ_make_edge_line(double x0, double y0, double z0,
                       double x1, double y1, double z1,
                       occ_shape_t* out) {
  REQ(out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  const gp_Pnt p0(x0, y0, z0);
  const gp_Pnt p1(x1, y1, z1);
  if (p0.Distance(p1) < k_eps) {
    set_last("line endpoints coincident");
    return OCC_ERR_GEOM;
  }
  BRepBuilderAPI_MakeEdge me(p0, p1);
  if (!me.IsDone()) {
    set_last("MakeEdge line failed");
    return OCC_ERR_GEOM;
  }
  *out = to_handle(me.Edge());
  return OCC_OK;
  OCC_GUARD_END
}

int occ_make_edge_circle(double cx, double cy, double cz,
                         double nx, double ny, double nz,
                         double radius, occ_shape_t* out) {
  REQ(out, OCC_ERR_NULL_ARG);
  REQ(radius > 0.0, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  gp_Dir n;
  int st = require_unit_dir(nx, ny, nz, n, "circle normal near zero");
  if (st != OCC_OK) return st;
  gp_Ax2 ax(gp_Pnt(cx, cy, cz), n);
  GC_MakeCircle mk(ax, radius);
  if (!mk.IsDone()) {
    set_last("GC_MakeCircle failed");
    return OCC_ERR_GEOM;
  }
  BRepBuilderAPI_MakeEdge me(mk.Value());
  if (!me.IsDone()) {
    set_last("MakeEdge circle failed");
    return OCC_ERR_GEOM;
  }
  *out = to_handle(me.Edge());
  return OCC_OK;
  OCC_GUARD_END
}

int occ_make_edge_arc_3pt(double x1, double y1, double z1,
                          double x2, double y2, double z2,
                          double x3, double y3, double z3,
                          occ_shape_t* out) {
  REQ(out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  const gp_Pnt p1(x1, y1, z1);
  const gp_Pnt p2(x2, y2, z2);
  const gp_Pnt p3(x3, y3, z3);
  if (p1.Distance(p2) < k_eps || p2.Distance(p3) < k_eps || p1.Distance(p3) < k_eps) {
    set_last("arc_3pt: coincident points");
    return OCC_ERR_GEOM;
  }
  GC_MakeArcOfCircle mk(p1, p2, p3);
  if (!mk.IsDone()) {
    set_last("GC_MakeArcOfCircle(3pt) failed");
    return OCC_ERR_GEOM;
  }
  BRepBuilderAPI_MakeEdge me(mk.Value());
  if (!me.IsDone()) {
    set_last("MakeEdge arc_3pt failed");
    return OCC_ERR_GEOM;
  }
  *out = to_handle(me.Edge());
  return OCC_OK;
  OCC_GUARD_END
}

int occ_make_edge_arc_center(double cx, double cy, double cz,
                             double nx, double ny, double nz,
                             double radius,
                             double a0_rad, double a1_rad,
                             occ_shape_t* out) {
  REQ(out, OCC_ERR_NULL_ARG);
  REQ(radius > 0.0, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  if (std::abs(a1_rad - a0_rad) < 1.0e-15) {
    set_last("arc_center: zero angular span");
    return OCC_ERR_GEOM;
  }
  gp_Dir n;
  int st = require_unit_dir(nx, ny, nz, n, "arc normal near zero");
  if (st != OCC_OK) return st;
  gp_Ax2 ax(gp_Pnt(cx, cy, cz), n);
  gp_Circ circ(ax, radius);
  // Sense True follows the circle orientation (right-hand about normal).
  const Standard_Boolean sense = (a1_rad >= a0_rad) ? Standard_True : Standard_False;
  GC_MakeArcOfCircle mk(circ, a0_rad, a1_rad, sense);
  if (!mk.IsDone()) {
    set_last("GC_MakeArcOfCircle(center) failed");
    return OCC_ERR_GEOM;
  }
  BRepBuilderAPI_MakeEdge me(mk.Value());
  if (!me.IsDone()) {
    set_last("MakeEdge arc_center failed");
    return OCC_ERR_GEOM;
  }
  *out = to_handle(me.Edge());
  return OCC_OK;
  OCC_GUARD_END
}

/* =========================================================================
 * Wires
 * ========================================================================= */

int occ_make_polyline(const double* xyz, int n, int closed, occ_shape_t* out) {
  REQ(xyz && out, OCC_ERR_NULL_ARG);
  REQ(n >= 2, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  BRepBuilderAPI_MakeWire mw;
  for (int i = 0; i < n - 1; ++i) {
    const gp_Pnt a(xyz[3 * i],     xyz[3 * i + 1],     xyz[3 * i + 2]);
    const gp_Pnt b(xyz[3 * (i + 1)], xyz[3 * (i + 1) + 1], xyz[3 * (i + 1) + 2]);
    if (a.Distance(b) < k_eps) {
      set_last("polyline: zero-length segment");
      return OCC_ERR_GEOM;
    }
    BRepBuilderAPI_MakeEdge me(a, b);
    if (!me.IsDone()) {
      set_last("polyline: MakeEdge failed");
      return OCC_ERR_GEOM;
    }
    mw.Add(me.Edge());
  }
  if (closed) {
    const gp_Pnt a(xyz[3 * (n - 1)], xyz[3 * (n - 1) + 1], xyz[3 * (n - 1) + 2]);
    const gp_Pnt b(xyz[0], xyz[1], xyz[2]);
    if (a.Distance(b) >= k_eps) {
      BRepBuilderAPI_MakeEdge me(a, b);
      if (!me.IsDone()) {
        set_last("polyline: close edge failed");
        return OCC_ERR_GEOM;
      }
      mw.Add(me.Edge());
    }
  }
  if (!mw.IsDone()) {
    set_last("polyline: MakeWire failed");
    return OCC_ERR_GEOM;
  }
  *out = to_handle(mw.Wire());
  return OCC_OK;
  OCC_GUARD_END
}

int occ_make_polygon_wire(const double* xyz, int n, int closed, occ_shape_t* out) {
  REQ(xyz && out, OCC_ERR_NULL_ARG);
  REQ(n >= 2, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  BRepBuilderAPI_MakePolygon poly;
  for (int i = 0; i < n; ++i) {
    poly.Add(gp_Pnt(xyz[3 * i], xyz[3 * i + 1], xyz[3 * i + 2]));
  }
  if (closed) poly.Close();
  if (!poly.IsDone()) {
    set_last("MakePolygon failed");
    return OCC_ERR_GEOM;
  }
  *out = to_handle(poly.Wire());
  return OCC_OK;
  OCC_GUARD_END
}

int occ_make_rectangle_wire(double cx, double cy, double cz,
                            double nx, double ny, double nz,
                            double width, double height,
                            occ_shape_t* out) {
  REQ(out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  gp_Pnt corners[4];
  int st = rectangle_corners(cx, cy, cz, nx, ny, nz, width, height, corners);
  if (st != OCC_OK) return st;
  return wire_from_closed_corners(corners, out);
  OCC_GUARD_END
}

int occ_make_circle_wire(double cx, double cy, double cz,
                         double nx, double ny, double nz,
                         double radius, occ_shape_t* out) {
  REQ(out, OCC_ERR_NULL_ARG);
  REQ(radius > 0.0, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  occ_shape_t edge = nullptr;
  int st = occ_make_edge_circle(cx, cy, cz, nx, ny, nz, radius, &edge);
  if (st != OCC_OK) return st;
  BRepBuilderAPI_MakeWire mw(TopoDS::Edge(*as_shape(edge)));
  occ_shape_free(edge);
  if (!mw.IsDone()) {
    set_last("circle wire failed");
    return OCC_ERR_GEOM;
  }
  *out = to_handle(mw.Wire());
  return OCC_OK;
  OCC_GUARD_END
}

int occ_make_wire_from_edges(const occ_shape_t* edges, int n, occ_shape_t* out) {
  REQ(edges && out, OCC_ERR_NULL_ARG);
  REQ(n >= 1, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  BRepBuilderAPI_MakeWire mw;
  for (int i = 0; i < n; ++i) {
    TopoDS_Edge e;
    int st = edge_as_topo(edges[i], e);
    if (st != OCC_OK) return st;
    mw.Add(e);
  }
  if (!mw.IsDone()) {
    set_last("MakeWire from edges failed (disconnected?)");
    return OCC_ERR_GEOM;
  }
  *out = to_handle(mw.Wire());
  return OCC_OK;
  OCC_GUARD_END
}

int occ_wire_is_closed(occ_shape_t wire, int* out_closed) {
  REQ(wire && out_closed, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  TopoDS_Wire w;
  int st = wire_as_topo(wire, w);
  if (st != OCC_OK) return st;

  // Prefer geometric endpoint check; Closed() flag alone is unreliable.
  TopoDS_Vertex vfirst, vlast;
  TopExp::Vertices(w, vfirst, vlast);
  if (vfirst.IsNull() || vlast.IsNull()) {
    *out_closed = 0;
    return OCC_OK;
  }
  const gp_Pnt p0 = BRep_Tool::Pnt(vfirst);
  const gp_Pnt p1 = BRep_Tool::Pnt(vlast);
  if (p0.Distance(p1) <= k_gap || vfirst.IsSame(vlast)) {
    *out_closed = 1;
    return OCC_OK;
  }
  // Single closed edge (full circle): first==last geometrically via same vertex.
  *out_closed = w.Closed() ? 1 : 0;
  return OCC_OK;
  OCC_GUARD_END
}

int occ_wire_length(occ_shape_t wire, double* out_len) {
  REQ(wire && out_len, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  TopoDS_Wire w;
  int st = wire_as_topo(wire, w);
  if (st != OCC_OK) return st;
  BRepAdaptor_CompCurve cc(w, Standard_True);
  *out_len = GCPnts_AbscissaPoint::Length(cc);
  return OCC_OK;
  OCC_GUARD_END
}

int occ_wire_reverse(occ_shape_t wire, occ_shape_t* out) {
  REQ(wire && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  TopoDS_Wire w;
  int st = wire_as_topo(wire, w);
  if (st != OCC_OK) return st;
  *out = to_handle(w.Reversed());
  return OCC_OK;
  OCC_GUARD_END
}

int occ_count_wires(occ_shape_t s, int* out) {
  REQ(s && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  TopTools_IndexedMapOfShape m;
  TopExp::MapShapes(*as_shape(s), TopAbs_WIRE, m);
  *out = m.Extent();
  return OCC_OK;
  OCC_GUARD_END
}

int occ_wire_at(occ_shape_t s, int idx, occ_shape_t* out) {
  REQ(s && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  TopTools_IndexedMapOfShape m;
  TopExp::MapShapes(*as_shape(s), TopAbs_WIRE, m);
  if (idx < 1 || idx > m.Extent()) {
    set_last("wire index out of range");
    return OCC_ERR_INDEX;
  }
  *out = to_handle(m.FindKey(idx));
  return OCC_OK;
  OCC_GUARD_END
}

/* =========================================================================
 * Faces
 * ========================================================================= */

int occ_make_planar_face_from_wire(occ_shape_t wire, occ_shape_t* out) {
  REQ(wire && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  TopoDS_Wire w;
  int st = wire_as_topo(wire, w);
  if (st != OCC_OK) return st;
  BRepBuilderAPI_MakeFace mf(w, /*OnlyPlane=*/Standard_True);
  if (!mf.IsDone()) {
    set_last("MakeFace from wire failed (non-planar or open?)");
    return OCC_ERR_GEOM;
  }
  *out = to_handle(mf.Face());
  return OCC_OK;
  OCC_GUARD_END
}

int occ_make_face_circle(double cx, double cy, double cz,
                         double nx, double ny, double nz,
                         double radius, occ_shape_t* out) {
  REQ(out, OCC_ERR_NULL_ARG);
  REQ(radius > 0.0, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  occ_shape_t wire = nullptr;
  int st = occ_make_circle_wire(cx, cy, cz, nx, ny, nz, radius, &wire);
  if (st != OCC_OK) return st;
  // Bound the face to the plane of the circle for robustness.
  gp_Dir n;
  st = require_unit_dir(nx, ny, nz, n, "face_circle normal near zero");
  if (st != OCC_OK) {
    occ_shape_free(wire);
    return st;
  }
  gp_Pln pln(gp_Pnt(cx, cy, cz), n);
  BRepBuilderAPI_MakeFace mf(pln, TopoDS::Wire(*as_shape(wire)), Standard_True);
  occ_shape_free(wire);
  if (!mf.IsDone()) {
    set_last("MakeFace circle failed");
    return OCC_ERR_GEOM;
  }
  *out = to_handle(mf.Face());
  return OCC_OK;
  OCC_GUARD_END
}

int occ_make_face_rectangle(double cx, double cy, double cz,
                            double nx, double ny, double nz,
                            double width, double height,
                            occ_shape_t* out) {
  REQ(out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  occ_shape_t wire = nullptr;
  int st = occ_make_rectangle_wire(cx, cy, cz, nx, ny, nz, width, height, &wire);
  if (st != OCC_OK) return st;
  st = occ_make_planar_face_from_wire(wire, out);
  occ_shape_free(wire);
  return st;
  OCC_GUARD_END
}

int occ_make_face_polygon(const double* xyz, int n, occ_shape_t* out) {
  REQ(xyz && out, OCC_ERR_NULL_ARG);
  REQ(n >= 3, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  occ_shape_t wire = nullptr;
  int st = occ_make_polygon_wire(xyz, n, /*closed=*/1, &wire);
  if (st != OCC_OK) return st;
  st = occ_make_planar_face_from_wire(wire, out);
  occ_shape_free(wire);
  return st;
  OCC_GUARD_END
}

int occ_make_plane_rect(double ox, double oy, double oz,
                        double nx, double ny, double nz,
                        double xdirx, double xdiry, double xdirz,
                        double half_w, double half_h,
                        occ_shape_t* out) {
  REQ(out, OCC_ERR_NULL_ARG);
  REQ(half_w > 0.0 && half_h > 0.0, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  gp_Dir n, x;
  int st = require_unit_dir(nx, ny, nz, n, "plane_rect normal near zero");
  if (st != OCC_OK) return st;
  st = require_unit_dir(xdirx, xdiry, xdirz, x, "plane_rect xdir near zero");
  if (st != OCC_OK) return st;
  if (std::abs(x.Dot(n)) > 1.0 - 1.0e-9) {
    set_last("plane_rect: X parallel to normal");
    return OCC_ERR_GEOM;
  }
  gp_Ax3 ax(gp_Pnt(ox, oy, oz), n, x);
  BRepBuilderAPI_MakeFace mf(gp_Pln(ax), -half_w, half_w, -half_h, half_h);
  if (!mf.IsDone()) {
    set_last("plane_rect MakeFace failed");
    return OCC_ERR_GEOM;
  }
  *out = to_handle(mf.Face());
  return OCC_OK;
  OCC_GUARD_END
}

/* =========================================================================
 * Plane POD helpers
 * ========================================================================= */

int occ_plane_from_3pts(double x1, double y1, double z1,
                        double x2, double y2, double z2,
                        double x3, double y3, double z3,
                        occ_plane_t* out) {
  REQ(out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  const gp_Pnt p1(x1, y1, z1);
  const gp_Pnt p2(x2, y2, z2);
  const gp_Pnt p3(x3, y3, z3);
  gp_Vec v12(p1, p2);
  gp_Vec v13(p1, p3);
  gp_Vec nvec = v12.Crossed(v13);
  if (nvec.Magnitude() < k_eps) {
    set_last("plane_from_3pts: collinear points");
    return OCC_ERR_GEOM;
  }
  nvec.Normalize();
  gp_Dir n(nvec);
  // X axis along P1→P2
  if (v12.Magnitude() < k_eps) {
    set_last("plane_from_3pts: P1P2 too short");
    return OCC_ERR_GEOM;
  }
  gp_Dir x(v12);
  gp_Ax3 ax(p1, n, x);
  plane_from_ax3(ax, out);
  return OCC_OK;
  OCC_GUARD_END
}

int occ_plane_from_point_normal(double ox, double oy, double oz,
                                double nx, double ny, double nz,
                                occ_plane_t* out) {
  REQ(out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  gp_Dir n;
  int st = require_unit_dir(nx, ny, nz, n, "plane normal near zero");
  if (st != OCC_OK) return st;
  // gp_Ax3(P, N) picks a stable X orthogonal to N.
  gp_Ax3 ax(gp_Pnt(ox, oy, oz), n);
  plane_from_ax3(ax, out);
  return OCC_OK;
  OCC_GUARD_END
}

int occ_plane_project_point(const occ_plane_t* pln,
                            double x, double y, double z,
                            double out_xyz[3]) {
  REQ(pln && out_xyz, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  gp_Ax3 ax;
  int st = plane_to_ax3(*pln, ax);
  if (st != OCC_OK) return st;
  const gp_Pnt o = ax.Location();
  const gp_Dir n = ax.Direction();
  const gp_Pnt p(x, y, z);
  const double dist = gp_Vec(o, p).Dot(gp_Vec(n.X(), n.Y(), n.Z()));
  const gp_Pnt q(p.X() - dist * n.X(),
                 p.Y() - dist * n.Y(),
                 p.Z() - dist * n.Z());
  out_xyz[0] = q.X();
  out_xyz[1] = q.Y();
  out_xyz[2] = q.Z();
  return OCC_OK;
  OCC_GUARD_END
}

int occ_make_segment_on_plane(const occ_plane_t* pln,
                              double u0, double v0,
                              double u1, double v1,
                              occ_shape_t* out) {
  REQ(pln && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  gp_Ax3 ax;
  int st = plane_to_ax3(*pln, ax);
  if (st != OCC_OK) return st;
  const gp_Pnt p0 = uv_to_pnt(ax, u0, v0);
  const gp_Pnt p1 = uv_to_pnt(ax, u1, v1);
  if (p0.Distance(p1) < k_eps) {
    set_last("segment_on_plane: zero length");
    return OCC_ERR_GEOM;
  }
  BRepBuilderAPI_MakeEdge me(p0, p1);
  if (!me.IsDone()) {
    set_last("segment_on_plane: MakeEdge failed");
    return OCC_ERR_GEOM;
  }
  *out = to_handle(me.Edge());
  return OCC_OK;
  OCC_GUARD_END
}

/* =========================================================================
 * Offset + BSpline
 * ========================================================================= */

int occ_offset_wire_2d(occ_shape_t wire, double dist, occ_shape_t* out) {
  REQ(wire && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  TopoDS_Wire w;
  int st = wire_as_topo(wire, w);
  if (st != OCC_OK) return st;
  if (std::abs(dist) < k_eps) {
    *out = to_handle(w);
    return OCC_OK;
  }
  // BRepOffsetAPI_MakeOffset works on planar wires (open or closed).
  BRepOffsetAPI_MakeOffset mk(w, GeomAbs_Arc, /*IsOpenResult=*/Standard_False);
  mk.Perform(dist);
  if (!mk.IsDone()) {
    set_last("BRepOffsetAPI_MakeOffset failed");
    return OCC_ERR_GEOM;
  }
  const TopoDS_Shape& sh = mk.Shape();
  // Result may be a wire or a compound of wires — return as-is.
  *out = to_handle(sh);
  return OCC_OK;
  OCC_GUARD_END
}

int occ_make_bspline_wire_through_points(const double* xyz, int n,
                                         int degree, int periodic,
                                         occ_shape_t* out) {
  REQ(xyz && out, OCC_ERR_NULL_ARG);
  REQ(n >= 2, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  int deg = degree;
  if (deg < 1) deg = 1;
  if (deg > 8) deg = 8;

  Handle(Geom_BSplineCurve) curve;

  if (periodic) {
    // GeomAPI_PointsToBSpline is non-periodic; use Interpolate for closed paths.
    // For periodic interpolate, last point must equal first — OCCT requires
    // n points with P[n]==P[1] not duplicated; PeriodicFlag handles wrap.
    if (n < 3) {
      set_last("periodic bspline needs n >= 3");
      return OCC_ERR_GEOM;
    }
    Handle(TColgp_HArray1OfPnt) hpts = new TColgp_HArray1OfPnt(1, n);
    for (int i = 0; i < n; ++i) {
      hpts->SetValue(i + 1, gp_Pnt(xyz[3 * i], xyz[3 * i + 1], xyz[3 * i + 2]));
    }
    GeomAPI_Interpolate interp(hpts, Standard_True, 1.0e-6);
    interp.Perform();
    if (!interp.IsDone()) {
      set_last("GeomAPI_Interpolate (periodic) failed");
      return OCC_ERR_GEOM;
    }
    curve = interp.Curve();
  } else {
    TColgp_Array1OfPnt pts(1, n);
    for (int i = 0; i < n; ++i) {
      pts.SetValue(i + 1, gp_Pnt(xyz[3 * i], xyz[3 * i + 1], xyz[3 * i + 2]));
    }
    // DegMin = max(1, deg-2), DegMax = deg — keeps user degree as upper bound.
    const int deg_min = (deg > 1) ? (deg > 3 ? deg - 2 : 1) : 1;
    GeomAPI_PointsToBSpline approx(pts, deg_min, deg, GeomAbs_C2, 1.0e-3);
    if (!approx.IsDone()) {
      set_last("GeomAPI_PointsToBSpline failed");
      return OCC_ERR_GEOM;
    }
    curve = approx.Curve();
  }

  BRepBuilderAPI_MakeEdge me(curve);
  if (!me.IsDone()) {
    set_last("MakeEdge from BSpline failed");
    return OCC_ERR_GEOM;
  }
  BRepBuilderAPI_MakeWire mw(me.Edge());
  if (!mw.IsDone()) {
    set_last("MakeWire from BSpline edge failed");
    return OCC_ERR_GEOM;
  }
  *out = to_handle(mw.Wire());
  return OCC_OK;
  OCC_GUARD_END
}

}  // extern "C"
```

---

## Walk-through: key algorithms

### 1. Three-point arc (`GC_MakeArcOfCircle`)

OCCT builds a `Geom_TrimmedCurve` arc where **P1** is the start, **P3** the end, and **P2** lies on the arc (not the center). Collinear or coincident points yield `!IsDone()`; we map that to `OCC_ERR_GEOM` and set `occ_last_error`.

```text
P1 ──arc──► P2 ──arc──► P3
     ╲           ╱
      ╲  center ╱
```

### 2. Centered arc angles

`GC_MakeArcOfCircle(gp_Circ, Alpha1, Alpha2, Sense)` trims the circle. Parameter 0 is along the Ax2 X direction; angles are radians. When `a1 < a0` we pass `Sense = False` so the short/long arc choice follows the signed span the caller intended.

### 3. Polyline vs polygon wire

| | `occ_make_polyline` | `occ_make_polygon_wire` |
|--|---------------------|-------------------------|
| Builder | `MakeEdge` loop + `MakeWire` | `BRepBuilderAPI_MakePolygon` |
| Best for | open routes, mixed later with arcs | closed face profiles |
| Degenerate segment | hard error | `Add` may skip; we still require `IsDone` |

Both accept the same packed `xyz[3*n]` layout.

### 4. Planar face from wire

`BRepBuilderAPI_MakeFace(wire, OnlyPlane=true)` asks OCCT to find a supporting plane. Failure modes: open wire, non-planar edges, self-intersection. Hosts should validate `occ_wire_is_closed` before calling when lowering Sketch2D profiles.

### 5. Construction plane face

`occ_make_plane_rect` is **not** an infinite plane. It builds a bounded rectangular face on `gp_Pln(gp_Ax3)` with UV domain `[-half_w, half_w] × [-half_h, half_h]`. Store infinite parameters in `occ_plane_t`; only materialize the face for visualization / picking.

### 6. Wire offset

`BRepOffsetAPI_MakeOffset` expects a **planar** wire. Join type `GeomAbs_Arc` rounds convex corners. Result may be a single wire or a compound when the offset self-splits — callers of routes should `occ_count_wires` and pick with `occ_wire_at`.

### 7. BSpline through points

```text
periodic == 0  →  GeomAPI_PointsToBSpline(points, DegMin, DegMax=degree, C2, tol)
periodic != 0  →  GeomAPI_Interpolate(points, PeriodicFlag=true)  // OCCT-correct closed
               →  MakeEdge(curve) → MakeWire
```

`GeomAPI_PointsToBSpline` does not offer a periodic flag in 7.9.3; periodic paths therefore use `GeomAPI_Interpolate` as documented in the header comment.

---

## Worked examples (host-side C)

### A. MakePoint + MakePlane + visible construction rectangle

```c
occ_shape_t pt = NULL;
occ_make_vertex(0.1, 0.2, 0.3, &pt);   /* MakePoint */

occ_plane_t pln;
occ_plane_from_point_normal(0, 0, 0,  0, 0, 1, &pln);  /* XY plane */

/* Optional: force X along world X after auto-basis */
pln.x[0] = 1; pln.x[1] = 0; pln.x[2] = 0;

occ_shape_t cplane = NULL;
occ_make_plane_rect(pln.o[0], pln.o[1], pln.o[2],
                    pln.n[0], pln.n[1], pln.n[2],
                    pln.x[0], pln.x[1], pln.x[2],
                    0.5, 0.5,   /* 1 m × 1 m visible square */
                    &cplane);
```

### B. Explicit Sketch2D: rectangle profile → extrude

```c
/* Sketch on plane Z=0, rectangle 0.2 × 0.1 centered at origin */
occ_shape_t profile = NULL;
occ_make_face_rectangle(0, 0, 0,  0, 0, 1,  0.2, 0.1, &profile);

occ_shape_t solid = NULL;
occ_extrude(profile, 0, 0, 0.05, &solid);  /* 50 mm tall (meters!) */
```

### C. Sketch2D mixed: line + arc → wire → face

```c
occ_plane_t pln;
occ_plane_from_point_normal(0, 0, 0, 0, 0, 1, &pln);

occ_shape_t e0 = NULL, e1 = NULL, e2 = NULL;
/* bottom line u=-0.05..0.05, v=-0.03 */
occ_make_segment_on_plane(&pln, -0.05, -0.03,  0.05, -0.03, &e0);
/* arc bulging up through (0, 0.02) to left end */
occ_make_edge_arc_3pt(0.05, -0.03, 0,
                      0.00,  0.02, 0,
                     -0.05, -0.03, 0, &e1);
/* (if only two edges form the closed shape) */
occ_shape_t edges[2] = { e0, e1 };
occ_shape_t wire = NULL;
occ_make_wire_from_edges(edges, 2, &wire);

int closed = 0;
occ_wire_is_closed(wire, &closed);

occ_shape_t face = NULL;
occ_make_planar_face_from_wire(wire, &face);
```

### D. Route polyline for pipe spine

```c
double path[] = {
  0.0, 0.0, 0.0,
  1.0, 0.0, 0.0,
  1.0, 0.5, 0.2,
  2.0, 0.5, 0.2
};
occ_shape_t spine = NULL;
occ_make_polyline(path, 4, /*closed=*/0, &spine);

double len = 0.0;
occ_wire_length(spine, &len);

/* circle profile in YZ at start, then occ_pipe(profile, spine, &tube) */
```

### E. Smooth periodic path

```c
double loop[] = {
  0.0, 0.0, 0.0,
  1.0, 0.0, 0.0,
  1.0, 1.0, 0.0,
  0.0, 1.0, 0.0
};
occ_shape_t smooth = NULL;
occ_make_bspline_wire_through_points(loop, 4, /*degree=*/3, /*periodic=*/1, &smooth);
```

### F. Offset profile for wall thickness sketch

```c
double poly[] = {
  0, 0, 0,
  0.1, 0, 0,
  0.1, 0.08, 0,
  0, 0.08, 0
};
occ_shape_t outer = NULL;
occ_make_polygon_wire(poly, 4, 1, &outer);

occ_shape_t inner = NULL;
occ_offset_wire_2d(outer, -0.005, &inner);  /* 5 mm inward */

int nw = 0;
occ_count_wires(inner, &nw);
/* if compound, pick wire 1: occ_wire_at(inner, 1, &w1); */
```

---

## Error contract

| Condition | Return |
|-----------|--------|
| null `out` / null required pointer | `OCC_ERR_NULL_ARG` |
| wrong `ShapeType` (not wire/edge) | `OCC_ERR_INVALID_SHAPE` |
| zero radius, collinear arc, open non-planar face, offset fail | `OCC_ERR_GEOM` |
| `occ_wire_at` / index helpers | `OCC_ERR_INDEX` |
| OCCT `Standard_Failure` | `OCC_ERR_EXCEPTION` + `occ_last_error()` |

Always free intermediate shapes (`occ_shape_free`) on both success paths that replace handles and on error paths that allocated partials. The implementations above free temporary edges/wires they create before returning.

---

## BUILD.bazel fragment (reference)

```python
# Add to api/BUILD.bazel  _OCC_C_EXPORTS and srcs:
#   "include/occ_c_construct.h",
#   "src/occ_c_construct.cc",
#
# Link against the same @occt package as occ_c.cc.
# No extra third_party deps.
```

Exports to list (for visibility / wasm exports map):

```text
occ_make_vertex
occ_make_edge_line
occ_make_edge_circle
occ_make_edge_arc_3pt
occ_make_edge_arc_center
occ_make_polyline
occ_make_polygon_wire
occ_make_rectangle_wire
occ_make_circle_wire
occ_make_wire_from_edges
occ_wire_is_closed
occ_wire_length
occ_wire_reverse
occ_count_wires
occ_wire_at
occ_make_planar_face_from_wire
occ_make_face_circle
occ_make_face_rectangle
occ_make_face_polygon
occ_make_plane_rect
occ_plane_from_3pts
occ_plane_from_point_normal
occ_plane_project_point
occ_make_segment_on_plane
occ_offset_wire_2d
occ_make_bspline_wire_through_points
```

---

## IR node → C call cheat sheet

| IR / product node | C call sequence |
|-------------------|-----------------|
| `MakePoint` | `occ_make_vertex` |
| `MakePlane` (params only) | `occ_plane_from_point_normal` or `occ_plane_from_3pts` → store `occ_plane_t` |
| `MakePlane` (visible) | + `occ_make_plane_rect` |
| `Sketch2D` line | `occ_make_segment_on_plane` or `occ_make_edge_line` |
| `Sketch2D` circle | `occ_make_circle_wire` / `occ_make_face_circle` |
| `Sketch2D` arc | `occ_make_edge_arc_3pt` or `occ_make_edge_arc_center` |
| `Sketch2D` polyline | `occ_make_polyline` / `occ_make_polygon_wire` |
| `Sketch2D` closed profile | wire → `occ_make_planar_face_from_wire` |
| `Sketch2D` rectangle | `occ_make_face_rectangle` |
| `Sketch2D` polygon | `occ_make_face_polygon` |
| `Sketch2D` spline | `occ_make_bspline_wire_through_points` |
| `Sketch2D` offset | `occ_offset_wire_2d` |
| Route polyline | `occ_make_polyline` → spine for `occ_pipe` |
| Extrude profile | face from above → `occ_extrude` |
| Revolve profile | face/wire → `occ_revolve` |

---

## Consistency notes with baseline `occ_c`

- Same opaque ownership: `new TopoDS_Shape` via `to_handle`, free with `occ_shape_free`.
- Same `OCC_GUARD_BEGIN` / `OCC_GUARD_END` / `REQ` macros.
- Same 1-based topology indexing (`occ_wire_at` mirrors `occ_face_at` / `occ_edge_at`).
- Same unit convention: **meters** and **radians** (never mm/degrees in the C boundary).
- Does **not** reimplement frames; `occ_plane_t` is a lighter POD than `occ_frame_t` (origin + Z + X vs full placement). Hosts may convert:

```text
occ_frame_t f  →  occ_plane_t { f.origin, f.z_axis, f.x_axis }
```

---

## Test matrix (implementer checklist)

| # | Case | Expect |
|---|------|--------|
| 1 | `occ_make_vertex(0,0,0)` | `OCC_OK`, vertex |
| 2 | `occ_make_edge_line` coincident pts | `OCC_ERR_GEOM` |
| 3 | unit circle wire on XY | closed wire, length ≈ 2π |
| 4 | arc 3pt (1,0,0)/(0,1,0)/(-1,0,0) | quarter/half arc edge |
| 5 | arc center 0..π/2 r=1 | length ≈ π/2 |
| 6 | rectangle wire 0.2×0.1 | closed, 4 edges |
| 7 | face from that wire | 1 face, area ≈ 0.02 |
| 8 | plane_rect half 0.5 | face on plane, area ≈ 1.0 |
| 9 | plane_from_3pts collinear | `OCC_ERR_GEOM` |
| 10 | project (0,0,5) onto Z=0 | (0,0,0) |
| 11 | polygon face triangle | area matches ½ base·height |
| 12 | offset closed square −0.01 | smaller wire or compound |
| 13 | bspline 4 pts degree 3 | single-edge wire |
| 14 | periodic bspline 4 pts | closed smooth wire |
| 15 | wire_from_edges disconnected | `OCC_ERR_GEOM` |
| 16 | count_wires on compound of 2 | 2; wire_at(1), wire_at(2) ok; wire_at(3) `OCC_ERR_INDEX` |

---

## File extract map

```text
docs/literate-sections/02-construction.md
        │  extract fences tagged:
        │    // === file: occ_c_construct.h
        │    // === file: occ_c_construct.cc
        ▼
api/include/occ_c_construct.h
api/src/occ_c_construct.cc
```

Include from the umbrella header or client code:

```c
#include "occ_c.h"
#include "occ_c_construct.h"
```

End of section 02.
