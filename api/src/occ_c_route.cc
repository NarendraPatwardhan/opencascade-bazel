// OCCT 7.9.3 — routes, pipe solids, structural member sweeps (AI-BOOST P0).
//
// Design notes
// ------------
// * continuous_sweep: bend R is baked into the centerline wire (G1 arcs).
// * Fluid pipe (circle/annulus) ≠ structural Frame (rect/circle member).
// * IR: RoutePath → wire; SweepAlong → occ_pipe_*; MemberSweep → occ_member_*.
// * Units: meters. Double precision throughout.
//
// Bend geometry (see literate section 04 for full derivation):
//   alpha = atan2(|u×v|, u·v)
//   L     = R * tan(alpha/2)
//   T1    = B - u*L
//   T2    = B + v*L
//   N     = normalize(u×v)
//   n1    = N × u          // inward normal at T1
//   O     = T1 + R * n1    // arc center
//   Pmid  = Rot_(O,N,alpha/2)(T1)
//   arc   = GC_MakeArcOfCircle(T1, Pmid, T2)

#include "occ_c_route.h"
#include "occ_c_construct.h"
#include "occ_c_internal.hxx"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

#include <BRepAlgoAPI_Cut.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepGProp.hxx>
#include <BRepLib.hxx>
#include <BRepOffsetAPI_MakePipe.hxx>
#include <gp_Circ.hxx>
#include <BRepOffsetAPI_MakePipeShell.hxx>
#include <BRepTools_WireExplorer.hxx>
#include <BRep_Builder.hxx>
#include <BRepAdaptor_CompCurve.hxx>
#include <BRepAdaptor_Curve.hxx>
#include <GC_MakeArcOfCircle.hxx>
#include <GC_MakeSegment.hxx>
#include <GProp_GProps.hxx>
#include <Geom_TrimmedCurve.hxx>
#include <Standard_Failure.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Ax1.hxx>
#include <gp_Ax2.hxx>
#include <gp_Ax3.hxx>
#include <gp_Circ.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>


using occ_c_detail::as_shape;
using occ_c_detail::set_last;
using occ_c_detail::to_handle;

namespace {

/* -------------------------------------------------------------------------
 * Numeric thresholds (meters / dimensionless). All SI meters.
 * ------------------------------------------------------------------------- */
constexpr double kEpsLen   = 1.0e-12;  /* zero-length segment (m) */
constexpr double kEpsAng   = 1.0e-10;  /* collinear / hairpin (rad-ish via sin) */
constexpr double kEpsDot   = 1.0e-12;  /* unit-vector clamp */
constexpr double kMinSeg   = 1.0e-9;   /* minimum residual straight after trim */

/* -------------------------------------------------------------------------
 * Small vector helpers
 * ------------------------------------------------------------------------- */

inline gp_Pnt P3(const double* xyz, int i) {
  return gp_Pnt(xyz[3 * i + 0], xyz[3 * i + 1], xyz[3 * i + 2]);
}

inline double clampd(double x, double lo, double hi) {
  return x < lo ? lo : (x > hi ? hi : x);
}

inline int require_wire(occ_shape_t s, const char* what) {
  if (!s) {
    set_last("null shape");
    return OCC_ERR_NULL_ARG;
  }
  if (as_shape(s)->ShapeType() != TopAbs_WIRE) {
    set_last(what);
    return OCC_ERR_INVALID_SHAPE;
  }
  return OCC_OK;
}

/**
 * Build a right-handed frame with origin p, Z = unit tangent z_dir.
 * X is chosen by projecting world +X (or +Y if Z ≈ world X) into the plane
 * perpendicular to Z — stable for piping stations and member profiles.
 */
int frame_from_origin_z(const gp_Pnt& p, const gp_Vec& z_in, occ_frame_t* out) {
  if (!out) return OCC_ERR_NULL_ARG;
  gp_Vec z = z_in;
  if (z.Magnitude() < kEpsLen) {
    set_last("frame: degenerate tangent");
    return OCC_ERR_FRAME;
  }
  z.Normalize();

  /* Prefer world +X as reference; if nearly parallel to Z, use world +Y. */
  gp_Vec ref(1.0, 0.0, 0.0);
  if (std::fabs(z.Dot(ref)) > 0.9) {
    ref = gp_Vec(0.0, 1.0, 0.0);
  }
  /* Project ref into plane ⟂ Z: X0 = ref - (ref·z) z */
  gp_Vec x_try = ref.Subtracted(z.Multiplied(ref.Dot(z)));
  if (x_try.Magnitude() < kEpsLen) {
    ref = gp_Vec(0.0, 0.0, 1.0);
    x_try = ref.Subtracted(z.Multiplied(ref.Dot(z)));
  }
  if (x_try.Magnitude() < kEpsLen) {
    set_last("frame: cannot complete axes");
    return OCC_ERR_FRAME;
  }
  x_try.Normalize();
  /* Right-handed: Y = Z × X, then X = Y × Z (re-orthogonalize). */
  gp_Vec y = z.Crossed(x_try);
  if (y.Magnitude() < kEpsLen) {
    set_last("frame: degenerate Y");
    return OCC_ERR_FRAME;
  }
  y.Normalize();
  gp_Vec x_rh = y.Crossed(z);
  x_rh.Normalize();

  out->ox = p.X();
  out->oy = p.Y();
  out->oz = p.Z();
  out->xx = x_rh.X();
  out->xy = x_rh.Y();
  out->xz = x_rh.Z();
  out->yx = y.X();
  out->yy = y.Y();
  out->yz = y.Z();
  out->zx = z.X();
  out->zy = z.Y();
  out->zz = z.Z();
  return OCC_OK;
}

/** gp_Trsf placing local XY profile into frame f (origin + X + Z). */
int trsf_from_frame(const occ_frame_t& f, gp_Trsf& t) {
  gp_Vec z(f.zx, f.zy, f.zz);
  gp_Vec x(f.xx, f.xy, f.xz);
  if (z.Magnitude() < kEpsLen || x.Magnitude() < kEpsLen) {
    set_last("frame: zero axis");
    return OCC_ERR_FRAME;
  }
  z.Normalize();
  /* Re-orthogonalize X against Z. */
  gp_Vec x_o = x.Subtracted(z.Multiplied(x.Dot(z)));
  if (x_o.Magnitude() < kEpsLen) {
    set_last("frame: X parallel Z");
    return OCC_ERR_FRAME;
  }
  x_o.Normalize();
  gp_Ax3 from; /* default world */
  gp_Ax3 to(gp_Pnt(f.ox, f.oy, f.oz), gp_Dir(z),
            gp_Dir(x_o));
  t.SetTransformation(to, from);
  return OCC_OK;
}

/* -------------------------------------------------------------------------
 * Edge length helpers
 * ------------------------------------------------------------------------- */

double edge_length(const TopoDS_Edge& e) {
  GProp_GProps props;
  BRepGProp::LinearProperties(e, props, Standard_True);
  return props.Mass();
}

/**
 * Ordered edges of a wire via BRepTools_WireExplorer (preserves connectivity).
 * Falls back to TopExp_Explorer if the wire explorer yields nothing.
 */
void collect_wire_edges(const TopoDS_Wire& w, std::vector<TopoDS_Edge>& edges) {
  edges.clear();
  for (BRepTools_WireExplorer ex(w); ex.More(); ex.Next()) {
    edges.push_back(ex.Current());
  }
  if (edges.empty()) {
    for (TopExp_Explorer ex(w, TopAbs_EDGE); ex.More(); ex.Next()) {
      edges.push_back(TopoDS::Edge(ex.Current()));
    }
  }
}

/**
 * Evaluate point + unit tangent at arc-length fraction t∈[0,1] along ordered
 * edges. Direction of travel follows WireExplorer order.
 */
int eval_wire_fraction(const TopoDS_Wire& w, double t, gp_Pnt& p,
                       gp_Vec& tangent) {
  t = clampd(t, 0.0, 1.0);
  std::vector<TopoDS_Edge> edges;
  collect_wire_edges(w, edges);
  if (edges.empty()) {
    set_last("wire has no edges");
    return OCC_ERR_GEOM;
  }

  std::vector<double> lens(edges.size());
  double total = 0.0;
  for (size_t i = 0; i < edges.size(); ++i) {
    lens[i] = edge_length(edges[i]);
    if (lens[i] < 0.0) lens[i] = 0.0;
    total += lens[i];
  }

  if (total < kEpsLen) {
    /* Degenerate length — use CompCurve parameter lerp. */
    BRepAdaptor_CompCurve cc(w, /*KnotByCurvilinearAbcissa=*/Standard_True);
    const Standard_Real u0 = cc.FirstParameter();
    const Standard_Real u1 = cc.LastParameter();
    const Standard_Real u  = u0 + t * (u1 - u0);
    gp_Vec d1;
    cc.D1(u, p, d1);
    if (d1.Magnitude() < kEpsLen) {
      set_last("degenerate wire tangent (compcurve)");
      return OCC_ERR_GEOM;
    }
    d1.Normalize();
    tangent = d1;
    return OCC_OK;
  }

  const double target = t * total;
  double acc = 0.0;
  for (size_t i = 0; i < edges.size(); ++i) {
    const double L = lens[i];
    if (acc + L < target - 1e-15 && i + 1 < edges.size()) {
      acc += L;
      continue;
    }
    /* Parameterize this edge by its own arc-length fraction.
       BRepAdaptor_Curve respects TopoDS_Edge orientation, so First→Last
       already follows WireExplorer travel direction. */
    const double local = (L > kEpsLen) ? (target - acc) / L : 0.0;
    BRepAdaptor_Curve c(edges[i]);
    const Standard_Real u0 = c.FirstParameter();
    const Standard_Real u1 = c.LastParameter();
    const Standard_Real u =
        u0 + clampd(local, 0.0, 1.0) * (u1 - u0);
    gp_Vec d1;
    c.D1(u, p, d1);
    if (d1.Magnitude() < kEpsLen) {
      set_last("degenerate edge tangent");
      return OCC_ERR_GEOM;
    }
    d1.Normalize();
    tangent = d1;
    return OCC_OK;
  }

  /* Fallback: geometric end of the last edge. */
  BRepAdaptor_Curve c(edges.back());
  gp_Vec d1;
  c.D1(c.LastParameter(), p, d1);
  if (d1.Magnitude() < kEpsLen) {
    set_last("degenerate end tangent");
    return OCC_ERR_GEOM;
  }
  d1.Normalize();
  tangent = d1;
  return OCC_OK;
}

/* -------------------------------------------------------------------------
 * Corner / bend data
 * ------------------------------------------------------------------------- */

struct CornerData {
  bool   active = false;  /* true → emit circular arc at this vertex */
  double trim   = 0.0;    /* L = R * tan(alpha/2) */
  double alpha  = 0.0;    /* turn angle (radians) */
  gp_Pnt T1;              /* inbound trim point */
  gp_Pnt T2;              /* outbound trim point */
  gp_Pnt Pmid;            /* mid-arc point */
  gp_Dir N;               /* plane normal */
};

/**
 * Compute circular-fillet corner data at vertex B with previous A and next C.
 *
 * Returns:
 *   OCC_OK          — corner filled (active or collinear-skip)
 *   OCC_ERR_GEOM    — zero segment, hairpin, plane failure
 *   OCC_ERR_MATH    — (not used here; length budget checked later)
 */
int compute_corner(const gp_Pnt& A, const gp_Pnt& B, const gp_Pnt& C,
                   double R, CornerData& out) {
  out = CornerData{};

  gp_Vec u(A, B);
  gp_Vec v(B, C);
  const double lu = u.Magnitude();
  const double lv = v.Magnitude();
  if (lu < kEpsLen || lv < kEpsLen) {
    set_last("route: zero-length segment at bend vertex");
    return OCC_ERR_GEOM;
  }
  u.Normalize();
  v.Normalize();

  gp_Vec cross = u.Crossed(v);
  const double sin_a = cross.Magnitude();
  const double cos_a = clampd(u.Dot(v), -1.0, 1.0);

  /* Collinear: sin≈0 */
  if (sin_a < kEpsAng) {
    if (cos_a < 0.0) {
      set_last("route: 180-degree hairpin bend unsupported");
      return OCC_ERR_GEOM;
    }
    /* Nearly straight — no fillet. */
    out.active = false;
    out.trim   = 0.0;
    return OCC_OK;
  }

  const double alpha = std::atan2(sin_a, cos_a); /* (0, π) */
  if (alpha < kEpsAng) {
    out.active = false;
    out.trim   = 0.0;
    return OCC_OK;
  }
  if (std::fabs(alpha - M_PI) < 1e-8) {
    set_last("route: 180-degree bend unsupported");
    return OCC_ERR_GEOM;
  }

  const double half = 0.5 * alpha;
  const double tana = std::tan(half);
  if (!(tana >= 0.0) || !std::isfinite(tana)) {
    set_last("route: tan(alpha/2) numeric failure");
    return OCC_ERR_MATH;
  }
  const double L = R * tana;
  if (!std::isfinite(L) || L < 0.0) {
    set_last("route: trim length numeric failure");
    return OCC_ERR_MATH;
  }

  /* Plane normal N = normalize(u × v) */
  cross.Normalize();
  const gp_Dir N(cross);

  /* Inward normal at inbound side: n1 = N × u  (unit; N ⟂ u) */
  gp_Vec n1 = gp_Vec(N).Crossed(u);
  if (n1.Magnitude() < kEpsLen) {
    set_last("route: cannot form bend plane (inward normal)");
    return OCC_ERR_GEOM;
  }
  n1.Normalize();

  const gp_Pnt T1 = B.Translated(u.Multiplied(-L));
  const gp_Pnt T2 = B.Translated(v.Multiplied(L));
  const gp_Pnt O  = T1.Translated(n1.Multiplied(R));

  /* Mid-arc: rotate T1 about (O, N) by +alpha/2 */
  gp_Trsf rot;
  rot.SetRotation(gp_Ax1(O, N), half);
  const gp_Pnt Pmid = T1.Transformed(rot);

  /* Sanity: |O-T1| ≈ R, |O-T2| ≈ R */
  const double d1 = O.Distance(T1);
  const double d2 = O.Distance(T2);
  if (std::fabs(d1 - R) > 1e-6 * std::max(1.0, R) ||
      std::fabs(d2 - R) > 1e-6 * std::max(1.0, R)) {
    /* Soft check — still emit; floating noise on large coords. */
  }

  out.active = true;
  out.trim   = L;
  out.alpha  = alpha;
  out.T1     = T1;
  out.T2     = T2;
  out.Pmid   = Pmid;
  out.N      = N;
  return OCC_OK;
}

int add_segment_edge(BRepBuilderAPI_MakeWire& mk, const gp_Pnt& a,
                     const gp_Pnt& b) {
  if (a.Distance(b) <= kEpsLen) {
    return OCC_OK; /* skip zero stub */
  }
  GC_MakeSegment mkseg(a, b);
  if (!mkseg.IsDone()) {
    set_last("route: GC_MakeSegment failed");
    return OCC_ERR_GEOM;
  }
  BRepBuilderAPI_MakeEdge me(mkseg.Value());
  if (!me.IsDone()) {
    set_last("route: segment edge failed");
    return OCC_ERR_GEOM;
  }
  mk.Add(me.Edge());
  return OCC_OK;
}

int add_arc_edge(BRepBuilderAPI_MakeWire& mk, const CornerData& c) {
  GC_MakeArcOfCircle mkarc(c.T1, c.Pmid, c.T2);
  if (!mkarc.IsDone()) {
    set_last("route: GC_MakeArcOfCircle failed");
    return OCC_ERR_GEOM;
  }
  BRepBuilderAPI_MakeEdge me(mkarc.Value());
  if (!me.IsDone()) {
    set_last("route: bend arc edge failed");
    return OCC_ERR_GEOM;
  }
  mk.Add(me.Edge());
  return OCC_OK;
}

/**
 * Core bend builder.
 *
 * Two-pass:
 *   1) compute CornerData for every vertex that may receive a fillet;
 *   2) validate trim budgets on every segment; assemble wire.
 */
int build_route_with_bends(const double* xyz, int n_points, double R,
                           occ_shape_t* out) {
  if (n_points < 2) {
    set_last("route: need at least 2 points");
    return OCC_ERR_GEOM;
  }
  if (R < 0.0) {
    set_last("route: negative bend radius");
    return OCC_ERR_GEOM;
  }

  /* R == 0 → pure polyline (open). */
  if (R == 0.0 || n_points == 2) {
    return occ_make_route_polyline(xyz, n_points, /*closed=*/0, out);
  }

  std::vector<gp_Pnt> pts(static_cast<size_t>(n_points));
  for (int i = 0; i < n_points; ++i) {
    pts[static_cast<size_t>(i)] = P3(xyz, i);
  }

  /* Closed loop if first and last samples coincide (within 1e-9 m).
     Drop the duplicate last sample and fillet the wrap-around corner. */
  int is_closed = 0;
  if (n_points >= 4 && pts.front().Distance(pts.back()) < 1e-9) {
    pts.pop_back();
    n_points = static_cast<int>(pts.size());
    is_closed = 1;
  }

  if (is_closed && n_points < 3) {
    set_last("route: closed path needs >= 3 points");
    return OCC_ERR_GEOM;
  }

  const int n = n_points;
  const int n_seg = is_closed ? n : (n - 1);

  /* ---- Pass 1: corner data per vertex ---- */
  std::vector<CornerData> corners(static_cast<size_t>(n));

  auto prev_idx = [&](int i) -> int {
    if (i > 0) return i - 1;
    return is_closed ? (n - 1) : -1;
  };
  auto next_idx = [&](int i) -> int {
    if (i + 1 < n) return i + 1;
    return is_closed ? 0 : -1;
  };

  for (int i = 0; i < n; ++i) {
    const int ip = prev_idx(i);
    const int in = next_idx(i);
    if (ip < 0 || in < 0) {
      /* Open path endpoints — no bend. */
      corners[static_cast<size_t>(i)].active = false;
      corners[static_cast<size_t>(i)].trim   = 0.0;
      continue;
    }
    const int st =
        compute_corner(pts[static_cast<size_t>(ip)], pts[static_cast<size_t>(i)],
                       pts[static_cast<size_t>(in)], R,
                       corners[static_cast<size_t>(i)]);
    if (st != OCC_OK) return st;
  }

  /* ---- Pass 2: segment length budgets ---- */
  for (int s = 0; s < n_seg; ++s) {
    const int i0 = s;
    const int i1 = (s + 1) % n;
    const double seg_len =
        pts[static_cast<size_t>(i0)].Distance(pts[static_cast<size_t>(i1)]);
    if (seg_len < kEpsLen) {
      set_last("route: zero-length segment");
      return OCC_ERR_GEOM;
    }
    const double L0 = corners[static_cast<size_t>(i0)].trim;
    const double L1 = corners[static_cast<size_t>(i1)].trim;
    if (L0 + L1 > seg_len - kMinSeg) {
      char buf[192];
      std::snprintf(buf, sizeof(buf),
                    "route: bend radius too large for segment %d "
                    "(need L0+L1=%.6g < len=%.6g m)",
                    s, L0 + L1, seg_len);
      set_last(buf);
      return OCC_ERR_MATH;
    }
  }

  /* ---- Pass 3: assemble wire ----
   *
   * For each segment s: i0 → i1
   *   start point = (corner i0 active) ? corners[i0].T2 : pts[i0]
   *                 (T2 is the outbound trim of the bend at i0)
   *   end point   = (corner i1 active) ? corners[i1].T1 : pts[i1]
   *   emit straight(start, end)
   *   if corner i1 active and (not the fictitious open end): emit arc at i1
   *
   * For open paths, arcs only at vertices 1..n-2 (already encoded by active).
   * For closed paths, after last segment emit arc at vertex 0 if active —
   * handled naturally because i1 runs through all vertices via wrap.
   *
   * Careful: after segment ending at i1 we emit arc at i1, which connects
   * T1→T2; the next segment then starts at T2. Good.
   *
   * For closed loops, the final arc at the vertex that closes must not be
   * double-emitted. We emit the arc at i1 for every segment; when s runs
   * 0..n-1, each vertex appears exactly once as i1. ✓
   */
  BRepBuilderAPI_MakeWire mk_wire;

  for (int s = 0; s < n_seg; ++s) {
    const int i0 = s;
    const int i1 = is_closed ? ((s + 1) % n) : (s + 1);

    const CornerData& c0 = corners[static_cast<size_t>(i0)];
    const CornerData& c1 = corners[static_cast<size_t>(i1)];

    const gp_Pnt start =
        c0.active ? c0.T2 : pts[static_cast<size_t>(i0)];
    const gp_Pnt end =
        c1.active ? c1.T1 : pts[static_cast<size_t>(i1)];

    int st = add_segment_edge(mk_wire, start, end);
    if (st != OCC_OK) return st;

    /* Arc at the end vertex of this segment when that corner is active.
       For open paths the last vertex (n-1) is never active, so the final
       segment does not grow a trailing arc. */
    if (c1.active) {
      st = add_arc_edge(mk_wire, c1);
      if (st != OCC_OK) return st;
    }
  }

  if (!mk_wire.IsDone()) {
    set_last("route: wire assembly failed");
    return OCC_ERR_GEOM;
  }
  *out = to_handle(mk_wire.Wire());
  return OCC_OK;
}

/* -------------------------------------------------------------------------
 * Profile placement: circle face / rect face at a frame
 * ------------------------------------------------------------------------- */

int make_circle_face_at(const gp_Pnt& c, const gp_Dir& n, double radius,
                        TopoDS_Face& face_out) {
  if (radius <= 0.0) {
    set_last("circle face: radius must be > 0");
    return OCC_ERR_GEOM;
  }
  gp_Ax2 ax(c, n);
  gp_Circ circ(ax, radius);
  BRepBuilderAPI_MakeEdge me(circ);
  if (!me.IsDone()) {
    set_last("circle face: edge failed");
    return OCC_ERR_GEOM;
  }
  BRepBuilderAPI_MakeWire mw(me.Edge());
  if (!mw.IsDone()) {
    set_last("circle face: wire failed");
    return OCC_ERR_GEOM;
  }
  BRepBuilderAPI_MakeFace mf(mw.Wire(), /*OnlyPlane=*/Standard_True);
  if (!mf.IsDone()) {
    set_last("circle face: face failed");
    return OCC_ERR_GEOM;
  }
  face_out = mf.Face();
  return OCC_OK;
}

int make_rect_face_at_frame(const occ_frame_t& f, double width, double height,
                            TopoDS_Face& face_out) {
  if (width <= 0.0 || height <= 0.0) {
    set_last("rect profile: width/height must be > 0");
    return OCC_ERR_GEOM;
  }
  const double hx = 0.5 * width;
  const double hy = 0.5 * height;
  /* Local rectangle in frame XY (Z = spine tangent). */
  const gp_Pnt loc[4] = {
      gp_Pnt(-hx, -hy, 0.0),
      gp_Pnt( hx, -hy, 0.0),
      gp_Pnt( hx,  hy, 0.0),
      gp_Pnt(-hx,  hy, 0.0),
  };
  gp_Trsf t;
  int st = trsf_from_frame(f, t);
  if (st != OCC_OK) return st;

  BRepBuilderAPI_MakePolygon poly;
  for (int i = 0; i < 4; ++i) {
    poly.Add(loc[i].Transformed(t));
  }
  poly.Close();
  if (!poly.IsDone()) {
    set_last("rect profile: polygon failed");
    return OCC_ERR_GEOM;
  }
  BRepBuilderAPI_MakeFace mf(poly.Wire(), /*OnlyPlane=*/Standard_True);
  if (!mf.IsDone()) {
    set_last("rect profile: face failed");
    return OCC_ERR_GEOM;
  }
  face_out = mf.Face();
  return OCC_OK;
}

int make_circle_face_at_frame(const occ_frame_t& f, double radius,
                              TopoDS_Face& face_out) {
  gp_Pnt c(f.ox, f.oy, f.oz);
  gp_Dir n(f.zx, f.zy, f.zz);
  return make_circle_face_at(c, n, radius, face_out);
}

/** Spine start frame helper (point+tangent → occ_frame_t). */
int spine_start_frame(occ_shape_t spine, occ_frame_t* f) {
  double o[3], t[3];
  const int st = occ_wire_end_point_tangent(spine, /*at_start=*/1, o, t);
  if (st != OCC_OK) return st;
  return frame_from_origin_z(gp_Pnt(o[0], o[1], o[2]),
                             gp_Vec(t[0], t[1], t[2]), f);
}

int do_make_pipe(const TopoDS_Wire& spine, const TopoDS_Shape& profile,
                 TopoDS_Shape& solid_out) {
  BRepOffsetAPI_MakePipe mk(spine, profile);
  mk.Build();
  if (!mk.IsDone()) {
    set_last("MakePipe failed (spine must be G1; try occ_make_route_with_bends)");
    return OCC_ERR_GEOM;
  }
  solid_out = mk.Shape();
  return OCC_OK;
}

}  // namespace

extern "C" {

/* =========================================================================
 * Routes
 * ========================================================================= */

int occ_make_route_polyline(const double* xyz, int n_points, int closed,
                            occ_shape_t* out_wire) {
  REQ(xyz && out_wire, OCC_ERR_NULL_ARG);
  REQ(n_points >= 2, OCC_ERR_GEOM);
  if (closed) {
    REQ(n_points >= 3, OCC_ERR_GEOM);
  }
  OCC_GUARD_BEGIN

  /* Reject zero-length consecutive samples early. */
  for (int i = 0; i < n_points - 1; ++i) {
    if (P3(xyz, i).Distance(P3(xyz, i + 1)) < kEpsLen) {
      set_last("route polyline: zero-length segment");
      return OCC_ERR_GEOM;
    }
  }
  if (closed && P3(xyz, n_points - 1).Distance(P3(xyz, 0)) < kEpsLen) {
    set_last("route polyline: closed loop zero-length closing segment");
    return OCC_ERR_GEOM;
  }

  BRepBuilderAPI_MakePolygon poly;
  for (int i = 0; i < n_points; ++i) {
    poly.Add(P3(xyz, i));
  }
  if (closed) {
    poly.Close();
  }
  if (!poly.IsDone()) {
    set_last("route polyline failed (degenerate points?)");
    return OCC_ERR_GEOM;
  }
  *out_wire = to_handle(poly.Wire());
  return OCC_OK;
  OCC_GUARD_END
}

int occ_make_route_with_bends(const double* xyz, int n_points,
                              double bend_radius, occ_shape_t* out_wire) {
  REQ(xyz && out_wire, OCC_ERR_NULL_ARG);
  REQ(n_points >= 2, OCC_ERR_GEOM);
  REQ(bend_radius >= 0.0, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  return build_route_with_bends(xyz, n_points, bend_radius, out_wire);
  OCC_GUARD_END
}

/* occ_wire_length: defined in occ_c_construct.cc */

int occ_wire_end_point_tangent(occ_shape_t wire, int at_start,
                          double origin[3], double tangent[3]) {
  REQ(wire && origin && tangent, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  const int stw = require_wire(wire, "frame_at_wire_end: expected wire");
  if (stw != OCC_OK) return stw;

  const double t = at_start ? 0.0 : 1.0;
  gp_Pnt p;
  gp_Vec tan;
  const int st =
      eval_wire_fraction(TopoDS::Wire(*as_shape(wire)), t, p, tan);
  if (st != OCC_OK) return st;
  origin[0] = p.X(); origin[1] = p.Y(); origin[2] = p.Z();
  tangent[0] = tan.X(); tangent[1] = tan.Y(); tangent[2] = tan.Z();
  return OCC_OK;
  OCC_GUARD_END
}

int occ_frame_at_wire_fraction(occ_shape_t wire, double t,
                               occ_frame_t* out_frame) {
  REQ(wire && out_frame, OCC_ERR_NULL_ARG);
  if (t < 0.0 || t > 1.0) {
    set_last("frame_at_wire_fraction: t must be in [0,1]");
    return OCC_ERR_GEOM;
  }
  OCC_GUARD_BEGIN
  const int stw = require_wire(wire, "frame_at_wire_fraction: expected wire");
  if (stw != OCC_OK) return stw;

  gp_Pnt p;
  gp_Vec tan;
  const int st =
      eval_wire_fraction(TopoDS::Wire(*as_shape(wire)), t, p, tan);
  if (st != OCC_OK) return st;
  return frame_from_origin_z(p, tan, out_frame);
  OCC_GUARD_END
}

int occ_route_node_frames(const double* xyz, int n, int closed,
                          occ_frame_t* out_frames) {
  REQ(xyz && out_frames, OCC_ERR_NULL_ARG);
  REQ(n >= 2, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN

  for (int i = 0; i < n; ++i) {
    gp_Pnt o = P3(xyz, i);
    gp_Vec z;

    if (closed) {
      /* Outbound segment, wrapping. */
      const int j = (i + 1) % n;
      z = gp_Vec(o, P3(xyz, j));
      if (z.Magnitude() < kEpsLen) {
        /* Fall back to inbound. */
        const int k = (i - 1 + n) % n;
        z = gp_Vec(P3(xyz, k), o);
      }
    } else if (i < n - 1) {
      /* Open: Z along outbound for all but last. */
      z = gp_Vec(o, P3(xyz, i + 1));
      if (z.Magnitude() < kEpsLen && i > 0) {
        z = gp_Vec(P3(xyz, i - 1), o);
      }
    } else {
      /* Last node of open path: Z along inbound. */
      z = gp_Vec(P3(xyz, n - 2), o);
    }

    if (z.Magnitude() < kEpsLen) {
      char buf[96];
      std::snprintf(buf, sizeof(buf),
                    "route_node_frames: degenerate segment at node %d", i);
      set_last(buf);
      return OCC_ERR_GEOM;
    }
    const int st = frame_from_origin_z(o, z, &out_frames[i]);
    if (st != OCC_OK) return st;
  }
  return OCC_OK;
  OCC_GUARD_END
}

/* =========================================================================
 * Profiles
 * ========================================================================= */

/* Alias of construct's occ_make_face_circle (single MakeFace implementation). */
int occ_make_circle_face(double cx, double cy, double cz, double nx, double ny,
                         double nz, double radius, occ_shape_t* out) {
  return occ_make_face_circle(cx, cy, cz, nx, ny, nz, radius, out);
}

int occ_make_rect_profile_wire(double width, double height,
                               occ_shape_t* out_wire) {
  REQ(out_wire, OCC_ERR_NULL_ARG);
  REQ(width > 0.0 && height > 0.0, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  const double hx = 0.5 * width;
  const double hy = 0.5 * height;
  BRepBuilderAPI_MakePolygon poly;
  poly.Add(gp_Pnt(-hx, -hy, 0.0));
  poly.Add(gp_Pnt( hx, -hy, 0.0));
  poly.Add(gp_Pnt( hx,  hy, 0.0));
  poly.Add(gp_Pnt(-hx,  hy, 0.0));
  poly.Close();
  if (!poly.IsDone()) {
    set_last("rect profile wire failed");
    return OCC_ERR_GEOM;
  }
  *out_wire = to_handle(poly.Wire());
  return OCC_OK;
  OCC_GUARD_END
}

int occ_make_circle_profile_wire(double radius, occ_shape_t* out_wire) {
  REQ(out_wire, OCC_ERR_NULL_ARG);
  REQ(radius > 0.0, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  gp_Ax2 ax(gp_Pnt(0.0, 0.0, 0.0), gp_Dir(0.0, 0.0, 1.0));
  gp_Circ circ(ax, radius);
  BRepBuilderAPI_MakeEdge me(circ);
  if (!me.IsDone()) {
    set_last("circle profile wire: edge failed");
    return OCC_ERR_GEOM;
  }
  BRepBuilderAPI_MakeWire mw(me.Edge());
  if (!mw.IsDone()) {
    set_last("circle profile wire: wire failed");
    return OCC_ERR_GEOM;
  }
  *out_wire = to_handle(mw.Wire());
  return OCC_OK;
  OCC_GUARD_END
}

/* =========================================================================
 * Pipe solids
 * ========================================================================= */

/* Thin wrapper over baseline occ_pipe (MakePipe). Extra profile-type check. */
int occ_pipe_solid(occ_shape_t profile_face_or_wire, occ_shape_t spine_wire,
                   occ_shape_t* out) {
  REQ(profile_face_or_wire && spine_wire && out, OCC_ERR_NULL_ARG);
  const TopoDS_Shape& prof = *as_shape(profile_face_or_wire);
  const TopAbs_ShapeEnum pt = prof.ShapeType();
  if (pt != TopAbs_FACE && pt != TopAbs_WIRE && pt != TopAbs_EDGE &&
      pt != TopAbs_VERTEX) {
    set_last("pipe_solid: profile must be face/wire/edge (not a solid)");
    return OCC_ERR_INVALID_SHAPE;
  }
  return occ_pipe(profile_face_or_wire, spine_wire, out);
}

int occ_pipe_annulus(double od, double id, occ_shape_t spine_wire,
                     occ_shape_t* out) {
  REQ(spine_wire && out, OCC_ERR_NULL_ARG);
  if (!(od > id && id > 0.0)) {
    set_last("annulus pipe: require od > id > 0");
    return OCC_ERR_GEOM;
  }
  OCC_GUARD_BEGIN
  const int stw = require_wire(spine_wire, "annulus pipe: spine must be wire");
  if (stw != OCC_OK) return stw;

  occ_frame_t f0;
  int st = spine_start_frame(spine_wire, &f0);
  if (st != OCC_OK) return st;

  const double ro = 0.5 * od;
  const double ri = 0.5 * id;

  /* Single annular profile face (outer circle + inner hole), then one MakePipe.
   * Avoids solid_od − solid_id boolean, which trips hermetic-cc/OCCT IntWalk
   * alignment panics on some spines. */
  gp_Pnt c(f0.ox, f0.oy, f0.oz);
  gp_Dir n(f0.zx, f0.zy, f0.zz);
  gp_Ax2 ax(c, n);

  BRepBuilderAPI_MakeEdge me_o(gp_Circ(ax, ro));
  BRepBuilderAPI_MakeEdge me_i(gp_Circ(ax, ri));
  if (!me_o.IsDone() || !me_i.IsDone()) {
    set_last("annulus pipe: circle edges failed");
    return OCC_ERR_GEOM;
  }
  BRepBuilderAPI_MakeWire mw_o(me_o.Edge());
  BRepBuilderAPI_MakeWire mw_i(me_i.Edge());
  if (!mw_o.IsDone() || !mw_i.IsDone()) {
    set_last("annulus pipe: circle wires failed");
    return OCC_ERR_GEOM;
  }
  BRepBuilderAPI_MakeFace mf(mw_o.Wire(), /*OnlyPlane=*/Standard_True);
  if (!mf.IsDone()) {
    set_last("annulus pipe: outer face failed");
    return OCC_ERR_GEOM;
  }
  /* Inner wire becomes a hole (reversed orientation for proper face). */
  TopoDS_Wire hole = mw_i.Wire();
  hole.Reverse();
  mf.Add(hole);
  if (!mf.IsDone()) {
    set_last("annulus pipe: hole add failed");
    return OCC_ERR_GEOM;
  }
  TopoDS_Face ann = mf.Face();
  /* Force orientation so the face is valid for MakePipe. */
  BRepLib::BuildCurves3d(ann);

  TopoDS_Shape solid;
  st = do_make_pipe(TopoDS::Wire(*as_shape(spine_wire)), ann, solid);
  if (st != OCC_OK) return st;
  *out = to_handle(solid);
  return OCC_OK;
  OCC_GUARD_END
}

int occ_pipe_shell_profile(occ_shape_t profile_wire, occ_shape_t spine_wire,
                           int with_contact, occ_shape_t* out) {
  REQ(profile_wire && spine_wire && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  int st = require_wire(spine_wire, "pipe_shell: spine must be wire");
  if (st != OCC_OK) return st;
  st = require_wire(profile_wire, "pipe_shell: profile must be wire");
  if (st != OCC_OK) return st;

  const TopoDS_Wire spine = TopoDS::Wire(*as_shape(spine_wire));
  const TopoDS_Wire prof  = TopoDS::Wire(*as_shape(profile_wire));

  BRepOffsetAPI_MakePipeShell mk(spine);
  /* Frenet trihedron — good default for smooth G1 spines. */
  mk.SetMode(/*IsFrenet=*/Standard_True);
  /* WithCorrection rotates profile to be orthogonal to the spine tangent. */
  mk.Add(prof, with_contact ? Standard_True : Standard_False,
         /*WithCorrection=*/Standard_True);
  if (!mk.IsReady()) {
    set_last("pipe_shell: not ready (profile?)");
    return OCC_ERR_GEOM;
  }
  mk.Build();
  if (!mk.IsDone()) {
    set_last("pipe_shell: Build failed");
    return OCC_ERR_GEOM;
  }
  /* MakeSolid requires a closed profile; if it returns false, still return
     the shell so callers can inspect. */
  if (!mk.MakeSolid()) {
    set_last("pipe_shell: MakeSolid failed (is profile closed?)");
    /* Still hand back the shell shape — useful for debugging. */
    *out = to_handle(mk.Shape());
    return OCC_ERR_GEOM;
  }
  *out = to_handle(mk.Shape());
  return OCC_OK;
  OCC_GUARD_END
}

/* =========================================================================
 * Structural members (skid steel)
 * ========================================================================= */

int occ_member_sweep_rect(double width, double height, occ_shape_t spine_wire,
                          occ_shape_t* out) {
  REQ(spine_wire && out, OCC_ERR_NULL_ARG);
  REQ(width > 0.0 && height > 0.0, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  const int stw =
      require_wire(spine_wire, "member_sweep_rect: spine must be wire");
  if (stw != OCC_OK) return stw;

  occ_frame_t f0;
  int st = spine_start_frame(spine_wire, &f0);
  if (st != OCC_OK) return st;

  TopoDS_Face face;
  st = make_rect_face_at_frame(f0, width, height, face);
  if (st != OCC_OK) return st;

  TopoDS_Shape solid;
  st = do_make_pipe(TopoDS::Wire(*as_shape(spine_wire)), face, solid);
  if (st != OCC_OK) return st;
  *out = to_handle(solid);
  return OCC_OK;
  OCC_GUARD_END
}

int occ_member_sweep_circle(double radius, occ_shape_t spine_wire,
                            occ_shape_t* out) {
  REQ(spine_wire && out, OCC_ERR_NULL_ARG);
  REQ(radius > 0.0, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  const int stw =
      require_wire(spine_wire, "member_sweep_circle: spine must be wire");
  if (stw != OCC_OK) return stw;

  occ_frame_t f0;
  int st = spine_start_frame(spine_wire, &f0);
  if (st != OCC_OK) return st;

  TopoDS_Face face;
  st = make_circle_face_at_frame(f0, radius, face);
  if (st != OCC_OK) return st;

  TopoDS_Shape solid;
  st = do_make_pipe(TopoDS::Wire(*as_shape(spine_wire)), face, solid);
  if (st != OCC_OK) return st;
  *out = to_handle(solid);
  return OCC_OK;
  OCC_GUARD_END
}

}  // extern "C"
