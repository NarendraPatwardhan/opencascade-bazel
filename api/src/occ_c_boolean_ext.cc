// OCCT 7.9.3 — compounds, plane/shape split, fuse/cut many.
#include "occ_c_boolean_ext.h"
#include "occ_c_internal.hxx"

#include <cmath>

#include <BRepAlgoAPI_Common.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepAlgoAPI_Splitter.hxx>
#include <BRepBndLib.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeHalfSpace.hxx>
#include <BRep_Builder.hxx>
#include <Bnd_Box.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Iterator.hxx>
#include <TopoDS_Solid.hxx>
#include <gp_Ax3.hxx>
#include <gp_Dir.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>

using occ_c_detail::as_shape;
using occ_c_detail::to_handle;
using occ_c_detail::set_last;

namespace {

constexpr double k_eps = 1.0e-12;

TopoDS_Shape copy_shape(const TopoDS_Shape& s) {
  gp_Trsf id;
  BRepBuilderAPI_Transform mk(s, id, Standard_True);
  return mk.Shape();
}

int bbox_of(const TopoDS_Shape& s, Bnd_Box& b) {
  b.SetVoid();
  BRepBndLib::Add(s, b);
  if (b.IsVoid()) {
    set_last("split: void bounding box");
    return OCC_ERR_GEOM;
  }
  return OCC_OK;
}

/**
 * Finite half-space tool on the ref_point side of plane (O, N).
 *
 *   1. Planar face at O, size = solid_diag * 4.
 *   2. MakeHalfSpace(face, ref_point) → infinite solid.
 *   3. Oversized AABB around solid.
 *   4. Common(halfspace, box) → finite cutting solid.
 */
int make_finite_halfspace_tool(const TopoDS_Shape& solid,
                               const gp_Pnt& O, const gp_Dir& N,
                               const gp_Pnt& ref_point,
                               TopoDS_Shape& out_tool) {
  Bnd_Box bb;
  int st = bbox_of(solid, bb);
  if (st != OCC_OK) return st;
  double x0, y0, z0, x1, y1, z1;
  bb.Get(x0, y0, z0, x1, y1, z1);
  const double dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
  const double diag =
      std::sqrt(dx * dx + dy * dy + dz * dz) + 1.0e-3;
  const double half = diag * 2.0;

  gp_Ax3 ax(O, N);
  gp_Pln pln(ax);
  BRepBuilderAPI_MakeFace mf(pln, -half, half, -half, half);
  if (!mf.IsDone()) {
    set_last("split_by_plane: plane face failed");
    return OCC_ERR_GEOM;
  }
  TopoDS_Face face = mf.Face();

  BRepPrimAPI_MakeHalfSpace mhs(face, ref_point);
  if (!mhs.IsDone()) {
    set_last("split_by_plane: MakeHalfSpace failed");
    return OCC_ERR_GEOM;
  }
  TopoDS_Solid hs = mhs.Solid();

  const double m = diag;
  TopoDS_Shape box =
      BRepPrimAPI_MakeBox(gp_Pnt(x0 - m, y0 - m, z0 - m),
                          gp_Pnt(x1 + m, y1 + m, z1 + m))
          .Shape();

  BRepAlgoAPI_Common common(hs, box);
  common.Build();
  if (!common.IsDone()) {
    set_last("split_by_plane: halfspace∩box failed");
    return OCC_ERR_BOOLEAN;
  }
  out_tool = common.Shape();
  return OCC_OK;
}

}  // namespace

extern "C" {

int occ_make_compound(const occ_shape_t* shapes, int n, occ_shape_t* out) {
  REQ(shapes && out, OCC_ERR_NULL_ARG);
  REQ(n >= 1, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  TopoDS_Compound comp;
  BRep_Builder bb;
  bb.MakeCompound(comp);
  for (int i = 0; i < n; ++i) {
    REQ(shapes[i], OCC_ERR_NULL_ARG);
    bb.Add(comp, *as_shape(shapes[i]));
  }
  *out = to_handle(comp);
  return OCC_OK;
  OCC_GUARD_END
}

int occ_explode_compound(occ_shape_t compound,
                         occ_shape_t* out_shapes,
                         int max_out,
                         int* out_count) {
  REQ(compound && out_shapes && out_count, OCC_ERR_NULL_ARG);
  REQ(max_out >= 1, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  const TopoDS_Shape& sh = *as_shape(compound);
  *out_count = 0;

  if (sh.ShapeType() != TopAbs_COMPOUND &&
      sh.ShapeType() != TopAbs_COMPSOLID) {
    out_shapes[0] = to_handle(copy_shape(sh));
    *out_count = 1;
    return OCC_OK;
  }

  int written = 0;
  int total = 0;
  for (TopoDS_Iterator it(sh); it.More(); it.Next()) {
    ++total;
    if (written < max_out) {
      out_shapes[written] = to_handle(copy_shape(it.Value()));
      ++written;
    }
  }
  *out_count = written;
  if (total > max_out) {
    set_last("explode_compound: output buffer too small");
    return OCC_ERR_INDEX;
  }
  if (total == 0) {
    set_last("explode_compound: empty compound");
    return OCC_ERR_GEOM;
  }
  return OCC_OK;
  OCC_GUARD_END
}

int occ_split_by_plane(occ_shape_t solid,
                       double ox, double oy, double oz,
                       double nx, double ny, double nz,
                       occ_shape_t* out_pos,
                       occ_shape_t* out_neg) {
  REQ(solid && out_pos && out_neg, OCC_ERR_NULL_ARG);
  const double nm = std::sqrt(nx * nx + ny * ny + nz * nz);
  if (nm < k_eps) {
    set_last("split_by_plane: zero normal");
    return OCC_ERR_GEOM;
  }
  OCC_GUARD_BEGIN
  const TopoDS_Shape& body = *as_shape(solid);
  gp_Pnt O(ox, oy, oz);
  gp_Dir N(nx / nm, ny / nm, nz / nm);
  const double lift = 1.0e-3;

  gp_Pnt ref_pos = O.Translated(gp_Vec(N).Multiplied(lift));
  gp_Pnt ref_neg = O.Translated(gp_Vec(N).Multiplied(-lift));

  TopoDS_Shape tool_pos;
  TopoDS_Shape tool_neg;
  int st = make_finite_halfspace_tool(body, O, N, ref_pos, tool_pos);
  if (st != OCC_OK) return st;
  st = make_finite_halfspace_tool(body, O, N, ref_neg, tool_neg);
  if (st != OCC_OK) return st;

  /* out_pos = +N side = Cut(body, tool_neg)
     out_neg = −N side = Cut(body, tool_pos) */
  {
    BRepAlgoAPI_Cut cut_pos(body, tool_neg);
    cut_pos.Build();
    if (!cut_pos.IsDone()) {
      set_last("split_by_plane: positive half cut failed");
      return OCC_ERR_BOOLEAN;
    }
    *out_pos = to_handle(cut_pos.Shape());
  }
  {
    BRepAlgoAPI_Cut cut_neg(body, tool_pos);
    cut_neg.Build();
    if (!cut_neg.IsDone()) {
      set_last("split_by_plane: negative half cut failed");
      occ_shape_free(*out_pos);
      *out_pos = nullptr;
      return OCC_ERR_BOOLEAN;
    }
    *out_neg = to_handle(cut_neg.Shape());
  }
  return OCC_OK;
  OCC_GUARD_END
}

int occ_split_by_shape(occ_shape_t solid,
                       occ_shape_t cutter_face_or_shell,
                       occ_shape_t* out_compound_parts) {
  REQ(solid && cutter_face_or_shell && out_compound_parts, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  const TopoDS_Shape& obj = *as_shape(solid);
  const TopoDS_Shape& tool = *as_shape(cutter_face_or_shell);

  BRepAlgoAPI_Splitter splitter;
  TopTools_ListOfShape args, tools;
  args.Append(obj);
  tools.Append(tool);
  splitter.SetArguments(args);
  splitter.SetTools(tools);
  splitter.Build();
  if (!splitter.IsDone()) {
    set_last("split_by_shape: BRepAlgoAPI_Splitter failed");
    return OCC_ERR_BOOLEAN;
  }
  *out_compound_parts = to_handle(splitter.Shape());
  return OCC_OK;
  OCC_GUARD_END
}

int occ_fuse_many(const occ_shape_t* shapes, int n, occ_shape_t* out) {
  REQ(shapes && out, OCC_ERR_NULL_ARG);
  REQ(n >= 1, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  REQ(shapes[0], OCC_ERR_NULL_ARG);
  if (n == 1) {
    *out = to_handle(copy_shape(*as_shape(shapes[0])));
    return OCC_OK;
  }
  TopoDS_Shape acc = *as_shape(shapes[0]);
  for (int i = 1; i < n; ++i) {
    REQ(shapes[i], OCC_ERR_NULL_ARG);
    BRepAlgoAPI_Fuse fuse(acc, *as_shape(shapes[i]));
    fuse.Build();
    if (!fuse.IsDone()) {
      set_last("fuse_many: fuse failed");
      return OCC_ERR_BOOLEAN;
    }
    acc = fuse.Shape();
  }
  *out = to_handle(acc);
  return OCC_OK;
  OCC_GUARD_END
}

int occ_cut_many(occ_shape_t base,
                 const occ_shape_t* tools, int n,
                 occ_shape_t* out) {
  REQ(base && out, OCC_ERR_NULL_ARG);
  REQ(n >= 1 && tools, OCC_ERR_GEOM);
  OCC_GUARD_BEGIN
  TopoDS_Shape acc = *as_shape(base);
  for (int i = 0; i < n; ++i) {
    REQ(tools[i], OCC_ERR_NULL_ARG);
    BRepAlgoAPI_Cut cut(acc, *as_shape(tools[i]));
    cut.Build();
    if (!cut.IsDone()) {
      set_last("cut_many: cut failed");
      return OCC_ERR_BOOLEAN;
    }
    acc = cut.Shape();
  }
  *out = to_handle(acc);
  return OCC_OK;
  OCC_GUARD_END
}

}  // extern "C"
