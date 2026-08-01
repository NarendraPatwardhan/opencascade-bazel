// Construction geometry — thin C maps for edges/wires/faces/plane POD.
// Wire endpoint closure uses a small gap tolerance (k_gap); B-spline path
// picks periodic interpolate vs points-to-spline from the periodic flag.
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
