// C API over OCCT — thin wrappers, extern "C" linkage.

#include "occ_c.h"
#include "occ_c_internal.hxx"

#include <cstring>
#include <string>
#include <vector>

#include <BRepAlgoAPI_Common.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepAlgoAPI_Section.hxx>
#include <BRepBndLib.hxx>
#include <BRepBuilderAPI_MakeSolid.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepFilletAPI_MakeChamfer.hxx>
#include <BRepFilletAPI_MakeFillet.hxx>
#include <BRepGProp.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <BRepOffsetAPI_MakeOffsetShape.hxx>
#include <BRepOffsetAPI_MakePipe.hxx>
#include <BRepOffsetAPI_MakeThickSolid.hxx>
#include <BRepOffsetAPI_ThruSections.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCone.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <BRepPrimAPI_MakeRevol.hxx>
#include <BRepPrimAPI_MakeSphere.hxx>
#include <BRepPrimAPI_MakeTorus.hxx>
#include <BRepPrimAPI_MakeWedge.hxx>
#include <BRepTools.hxx>
#include <BRep_Builder.hxx>
#include <BRep_Tool.hxx>
#include <Bnd_Box.hxx>
#include <GProp_GProps.hxx>
#include <Message_ProgressRange.hxx>
#include <Poly_Triangulation.hxx>
#include <RWGltf_CafWriter.hxx>
#include <RWObj_CafReader.hxx>
#include <RWObj_CafWriter.hxx>
#include <STEPCAFControl_Reader.hxx>
#include <STEPControl_Reader.hxx>
#include <STEPControl_Writer.hxx>
#include <Standard_Failure.hxx>
#include <Standard_Version.hxx>
#include <StlAPI_Writer.hxx>
#include <TColStd_IndexedDataMapOfStringString.hxx>
#include <TDF_Label.hxx>
#include <TDocStd_Application.hxx>
#include <TDocStd_Document.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Vertex.hxx>
#include <XCAFApp_Application.hxx>
#include <XCAFDoc_DocumentTool.hxx>
#include <XCAFDoc_ShapeTool.hxx>
#include <gp_Ax1.hxx>
#include <gp_Ax2.hxx>
#include <gp_Dir.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>

namespace {

using occ_c_detail::as_shape;
using occ_c_detail::g_last_error;
using occ_c_detail::set_last;
using occ_c_detail::to_handle;

gp_Ax2 axis(double cx, double cy, double cz, double ax, double ay, double az) {
  return gp_Ax2(gp_Pnt(cx, cy, cz), gp_Dir(ax, ay, az));
}

int single_doc_with_shape(const TopoDS_Shape& shape,
                          Handle(TDocStd_Document)& doc) {
  Handle(XCAFApp_Application) app = XCAFApp_Application::GetApplication();
  app->NewDocument("XmlOcaf", doc);
  Handle(XCAFDoc_ShapeTool) tool =
      XCAFDoc_DocumentTool::ShapeTool(doc->Main());
  tool->AddShape(shape, Standard_True);
  return OCC_OK;
}

struct MeshBuf {
  std::vector<float>    vtx;    // xyz
  std::vector<float>    nrm;    // xyz per vertex
  std::vector<int32_t>  idx;    // triangle indices
};

}  // namespace

extern "C" {

const char* occ_version(void) {
  return "OCCT " OCC_VERSION_STRING_EXT " / occ_c 0.1";
}

const char* occ_last_error(void) {
  return g_last_error.c_str();
}

void occ_shape_free(occ_shape_t s) {
  delete as_shape(s);
}

occ_shape_t occ_shape_copy(occ_shape_t s) {
  if (!s) return nullptr;
  return to_handle(*as_shape(s));
}

int occ_shape_is_null(occ_shape_t s) {
  return !s || as_shape(s)->IsNull();
}

/* ---- Primitives ---- */

int occ_make_box(double dx, double dy, double dz, occ_shape_t* out) {
  REQ(out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  *out = to_handle(BRepPrimAPI_MakeBox(dx, dy, dz).Shape());
  return OCC_OK;
  OCC_GUARD_END
}

int occ_make_cylinder(double cx, double cy, double cz,
                      double ax, double ay, double az,
                      double r, double h, occ_shape_t* out) {
  REQ(out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  *out = to_handle(BRepPrimAPI_MakeCylinder(axis(cx, cy, cz, ax, ay, az), r, h).Shape());
  return OCC_OK;
  OCC_GUARD_END
}

int occ_make_sphere(double cx, double cy, double cz, double r, occ_shape_t* out) {
  REQ(out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  *out = to_handle(BRepPrimAPI_MakeSphere(gp_Pnt(cx, cy, cz), r).Shape());
  return OCC_OK;
  OCC_GUARD_END
}

int occ_make_cone(double cx, double cy, double cz,
                  double ax, double ay, double az,
                  double r1, double r2, double h, occ_shape_t* out) {
  REQ(out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  *out = to_handle(BRepPrimAPI_MakeCone(axis(cx, cy, cz, ax, ay, az), r1, r2, h).Shape());
  return OCC_OK;
  OCC_GUARD_END
}

int occ_make_torus(double cx, double cy, double cz,
                   double ax, double ay, double az,
                   double R, double r, occ_shape_t* out) {
  REQ(out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  *out = to_handle(BRepPrimAPI_MakeTorus(axis(cx, cy, cz, ax, ay, az), R, r).Shape());
  return OCC_OK;
  OCC_GUARD_END
}

int occ_make_wedge(double dx, double dy, double dz, double ltx, occ_shape_t* out) {
  REQ(out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  *out = to_handle(BRepPrimAPI_MakeWedge(dx, dy, dz, ltx).Shape());
  return OCC_OK;
  OCC_GUARD_END
}

/* ---- Booleans ---- */

#define BOOLEAN(name, Algo)                                        \
  int name(occ_shape_t a, occ_shape_t b, occ_shape_t* out) {       \
    REQ(a && b && out, OCC_ERR_NULL_ARG);                          \
    OCC_GUARD_BEGIN                                                \
    Algo op(*as_shape(a), *as_shape(b));                           \
    op.Build();                                                    \
    if (!op.IsDone()) {                                            \
      set_last(#Algo " failed");                                   \
      return OCC_ERR_BOOLEAN;                                      \
    }                                                              \
    *out = to_handle(op.Shape());                                  \
    return OCC_OK;                                                 \
    OCC_GUARD_END                                                  \
  }

BOOLEAN(occ_fuse,      BRepAlgoAPI_Fuse)
BOOLEAN(occ_cut,       BRepAlgoAPI_Cut)
BOOLEAN(occ_intersect, BRepAlgoAPI_Common)
BOOLEAN(occ_section,   BRepAlgoAPI_Section)

/* ---- Features ---- */

int occ_fillet_all(occ_shape_t s, double r, occ_shape_t* out) {
  REQ(s && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  BRepFilletAPI_MakeFillet mk(*as_shape(s));
  for (TopExp_Explorer ex(*as_shape(s), TopAbs_EDGE); ex.More(); ex.Next()) {
    mk.Add(r, TopoDS::Edge(ex.Current()));
  }
  mk.Build();
  if (!mk.IsDone()) { set_last("fillet failed"); return OCC_ERR_FILLET; }
  *out = to_handle(mk.Shape());
  return OCC_OK;
  OCC_GUARD_END
}

int occ_fillet_edges(occ_shape_t s, const int* idx, int n, double r, occ_shape_t* out) {
  REQ(s && idx && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  TopTools_IndexedMapOfShape edges;
  TopExp::MapShapes(*as_shape(s), TopAbs_EDGE, edges);
  BRepFilletAPI_MakeFillet mk(*as_shape(s));
  for (int i = 0; i < n; ++i) {
    int id = idx[i];
    if (id < 1 || id > edges.Extent()) { set_last("edge index out of range"); return OCC_ERR_INDEX; }
    mk.Add(r, TopoDS::Edge(edges.FindKey(id)));
  }
  mk.Build();
  if (!mk.IsDone()) { set_last("fillet failed"); return OCC_ERR_FILLET; }
  *out = to_handle(mk.Shape());
  return OCC_OK;
  OCC_GUARD_END
}

int occ_chamfer_all(occ_shape_t s, double d, occ_shape_t* out) {
  REQ(s && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  BRepFilletAPI_MakeChamfer mk(*as_shape(s));
  for (TopExp_Explorer ex(*as_shape(s), TopAbs_EDGE); ex.More(); ex.Next()) {
    mk.Add(d, TopoDS::Edge(ex.Current()));
  }
  mk.Build();
  if (!mk.IsDone()) { set_last("chamfer failed"); return OCC_ERR_FILLET; }
  *out = to_handle(mk.Shape());
  return OCC_OK;
  OCC_GUARD_END
}

int occ_chamfer_edges(occ_shape_t s, const int* idx, int n, double d, occ_shape_t* out) {
  REQ(s && idx && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  TopTools_IndexedMapOfShape edges;
  TopExp::MapShapes(*as_shape(s), TopAbs_EDGE, edges);
  BRepFilletAPI_MakeChamfer mk(*as_shape(s));
  for (int i = 0; i < n; ++i) {
    int id = idx[i];
    if (id < 1 || id > edges.Extent()) { set_last("edge index out of range"); return OCC_ERR_INDEX; }
    mk.Add(d, TopoDS::Edge(edges.FindKey(id)));
  }
  mk.Build();
  if (!mk.IsDone()) { set_last("chamfer failed"); return OCC_ERR_FILLET; }
  *out = to_handle(mk.Shape());
  return OCC_OK;
  OCC_GUARD_END
}

int occ_shell(occ_shape_t s, const int* idx, int n, double t, occ_shape_t* out) {
  REQ(s && idx && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  TopTools_IndexedMapOfShape faces;
  TopExp::MapShapes(*as_shape(s), TopAbs_FACE, faces);
  TopTools_ListOfShape removed;
  for (int i = 0; i < n; ++i) {
    int id = idx[i];
    if (id < 1 || id > faces.Extent()) { set_last("face index out of range"); return OCC_ERR_INDEX; }
    removed.Append(faces.FindKey(id));
  }
  BRepOffsetAPI_MakeThickSolid mk;
  mk.MakeThickSolidByJoin(*as_shape(s), removed, t, 1.0e-3);
  mk.Build();
  if (!mk.IsDone()) { set_last("shell failed"); return OCC_ERR_BUILD; }
  *out = to_handle(mk.Shape());
  return OCC_OK;
  OCC_GUARD_END
}

int occ_offset_3d(occ_shape_t s, double off, occ_shape_t* out) {
  REQ(s && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  BRepOffsetAPI_MakeOffsetShape mk;
  mk.PerformByJoin(*as_shape(s), off, 1.0e-3);
  if (!mk.IsDone()) { set_last("offset failed"); return OCC_ERR_GEOM; }
  *out = to_handle(mk.Shape());
  return OCC_OK;
  OCC_GUARD_END
}

/* ---- Sweeps ---- */

int occ_extrude(occ_shape_t profile, double dx, double dy, double dz, occ_shape_t* out) {
  REQ(profile && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  *out = to_handle(BRepPrimAPI_MakePrism(*as_shape(profile), gp_Vec(dx, dy, dz)).Shape());
  return OCC_OK;
  OCC_GUARD_END
}

int occ_revolve(occ_shape_t profile,
                double px, double py, double pz,
                double ax, double ay, double az,
                double ang, occ_shape_t* out) {
  REQ(profile && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  gp_Ax1 a(gp_Pnt(px, py, pz), gp_Dir(ax, ay, az));
  *out = to_handle(BRepPrimAPI_MakeRevol(*as_shape(profile), a, ang).Shape());
  return OCC_OK;
  OCC_GUARD_END
}

int occ_loft(const occ_shape_t* profiles, int n, int solid, occ_shape_t* out) {
  REQ(profiles && out && n >= 2, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  BRepOffsetAPI_ThruSections mk(solid ? Standard_True : Standard_False);
  for (int i = 0; i < n; ++i) {
    const TopoDS_Shape& sh = *as_shape(profiles[i]);
    if (sh.ShapeType() == TopAbs_WIRE)        mk.AddWire(TopoDS::Wire(sh));
    else if (sh.ShapeType() == TopAbs_VERTEX) mk.AddVertex(TopoDS::Vertex(sh));
    else { set_last("loft profile must be wire or vertex"); return OCC_ERR_INVALID_SHAPE; }
  }
  mk.Build();
  if (!mk.IsDone()) { set_last("loft failed"); return OCC_ERR_BUILD; }
  *out = to_handle(mk.Shape());
  return OCC_OK;
  OCC_GUARD_END
}

int occ_pipe(occ_shape_t profile, occ_shape_t spine, occ_shape_t* out) {
  REQ(profile && spine && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  if (as_shape(spine)->ShapeType() != TopAbs_WIRE) {
    set_last("pipe spine must be a wire"); return OCC_ERR_INVALID_SHAPE;
  }
  BRepOffsetAPI_MakePipe mk(TopoDS::Wire(*as_shape(spine)), *as_shape(profile));
  *out = to_handle(mk.Shape());
  return OCC_OK;
  OCC_GUARD_END
}

/* ---- Transforms ---- */

static int apply_trsf(occ_shape_t s, const gp_Trsf& t, occ_shape_t* out) {
  REQ(s && out, OCC_ERR_NULL_ARG);
  BRepBuilderAPI_Transform mk(*as_shape(s), t, Standard_True);
  *out = to_handle(mk.Shape());
  return OCC_OK;
}

int occ_translate(occ_shape_t s, double dx, double dy, double dz, occ_shape_t* out) {
  OCC_GUARD_BEGIN
  gp_Trsf t; t.SetTranslation(gp_Vec(dx, dy, dz));
  return apply_trsf(s, t, out);
  OCC_GUARD_END
}

int occ_rotate(occ_shape_t s,
               double px, double py, double pz,
               double ax, double ay, double az,
               double ang, occ_shape_t* out) {
  OCC_GUARD_BEGIN
  gp_Trsf t; t.SetRotation(gp_Ax1(gp_Pnt(px, py, pz), gp_Dir(ax, ay, az)), ang);
  return apply_trsf(s, t, out);
  OCC_GUARD_END
}

int occ_scale(occ_shape_t s, double cx, double cy, double cz, double f, occ_shape_t* out) {
  OCC_GUARD_BEGIN
  gp_Trsf t; t.SetScale(gp_Pnt(cx, cy, cz), f);
  return apply_trsf(s, t, out);
  OCC_GUARD_END
}

int occ_mirror(occ_shape_t s,
               double px, double py, double pz,
               double nx, double ny, double nz,
               occ_shape_t* out) {
  OCC_GUARD_BEGIN
  gp_Trsf t; t.SetMirror(gp_Ax2(gp_Pnt(px, py, pz), gp_Dir(nx, ny, nz)));
  return apply_trsf(s, t, out);
  OCC_GUARD_END
}

/* ---- Measurement ---- */

int occ_volume(occ_shape_t s, double* out) {
  REQ(s && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  GProp_GProps p; BRepGProp::VolumeProperties(*as_shape(s), p);
  *out = p.Mass();
  return OCC_OK;
  OCC_GUARD_END
}

int occ_surface_area(occ_shape_t s, double* out) {
  REQ(s && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  GProp_GProps p; BRepGProp::SurfaceProperties(*as_shape(s), p);
  *out = p.Mass();
  return OCC_OK;
  OCC_GUARD_END
}

int occ_center_of_mass(occ_shape_t s, double out_xyz[3]) {
  REQ(s && out_xyz, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  GProp_GProps p; BRepGProp::VolumeProperties(*as_shape(s), p);
  gp_Pnt c = p.CentreOfMass();
  out_xyz[0] = c.X(); out_xyz[1] = c.Y(); out_xyz[2] = c.Z();
  return OCC_OK;
  OCC_GUARD_END
}

int occ_bbox(occ_shape_t s, double mn[3], double mx[3]) {
  REQ(s && mn && mx, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  Bnd_Box b; BRepBndLib::Add(*as_shape(s), b);
  b.Get(mn[0], mn[1], mn[2], mx[0], mx[1], mx[2]);
  return OCC_OK;
  OCC_GUARD_END
}

/* ---- Topology ---- */

static int count_by_type(occ_shape_t s, TopAbs_ShapeEnum k, int* out) {
  REQ(s && out, OCC_ERR_NULL_ARG);
  TopTools_IndexedMapOfShape m;
  TopExp::MapShapes(*as_shape(s), k, m);
  *out = m.Extent();
  return OCC_OK;
}

int occ_count_faces(occ_shape_t s, int* out)    { return count_by_type(s, TopAbs_FACE, out); }
int occ_count_edges(occ_shape_t s, int* out)    { return count_by_type(s, TopAbs_EDGE, out); }
int occ_count_vertices(occ_shape_t s, int* out) { return count_by_type(s, TopAbs_VERTEX, out); }

static int sub_at(occ_shape_t s, TopAbs_ShapeEnum k, int idx, occ_shape_t* out) {
  REQ(s && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  TopTools_IndexedMapOfShape m;
  TopExp::MapShapes(*as_shape(s), k, m);
  if (idx < 1 || idx > m.Extent()) { set_last("index out of range"); return OCC_ERR_INDEX; }
  *out = to_handle(m.FindKey(idx));
  return OCC_OK;
  OCC_GUARD_END
}

int occ_face_at(occ_shape_t s, int i, occ_shape_t* out) { return sub_at(s, TopAbs_FACE, i, out); }
int occ_edge_at(occ_shape_t s, int i, occ_shape_t* out) { return sub_at(s, TopAbs_EDGE, i, out); }

int occ_vertex_xyz(occ_shape_t s, int idx, double out_xyz[3]) {
  REQ(s && out_xyz, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  TopTools_IndexedMapOfShape m;
  TopExp::MapShapes(*as_shape(s), TopAbs_VERTEX, m);
  if (idx < 1 || idx > m.Extent()) { set_last("index out of range"); return OCC_ERR_INDEX; }
  gp_Pnt p = BRep_Tool::Pnt(TopoDS::Vertex(m.FindKey(idx)));
  out_xyz[0] = p.X(); out_xyz[1] = p.Y(); out_xyz[2] = p.Z();
  return OCC_OK;
  OCC_GUARD_END
}

/* ---- Import / Export ---- */

int occ_step_write(occ_shape_t s, const char* path) {
  REQ(s && path, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  STEPControl_Writer w;
  if (w.Transfer(*as_shape(s), STEPControl_AsIs) != IFSelect_RetDone) {
    set_last("STEP transfer failed"); return OCC_ERR_IO;
  }
  if (w.Write(path) != IFSelect_RetDone) { set_last("STEP write failed"); return OCC_ERR_IO; }
  return OCC_OK;
  OCC_GUARD_END
}

int occ_step_read(const char* path, occ_shape_t* out) {
  REQ(path && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  STEPControl_Reader r;
  if (r.ReadFile(path) != IFSelect_RetDone) { set_last("STEP read failed"); return OCC_ERR_IO; }
  r.TransferRoots();
  *out = to_handle(r.OneShape());
  return OCC_OK;
  OCC_GUARD_END
}

int occ_brep_write(occ_shape_t s, const char* path) {
  REQ(s && path, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  if (!BRepTools::Write(*as_shape(s), path)) { set_last("BREP write failed"); return OCC_ERR_IO; }
  return OCC_OK;
  OCC_GUARD_END
}

int occ_brep_read(const char* path, occ_shape_t* out) {
  REQ(path && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  TopoDS_Shape s;
  BRep_Builder b;
  if (!BRepTools::Read(s, path, b)) { set_last("BREP read failed"); return OCC_ERR_IO; }
  *out = to_handle(s);
  return OCC_OK;
  OCC_GUARD_END
}

int occ_stl_write(occ_shape_t s, const char* path, double defl) {
  REQ(s && path, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  if (defl > 0) BRepMesh_IncrementalMesh(*as_shape(s), defl);
  StlAPI_Writer w;
  if (!w.Write(*as_shape(s), path)) { set_last("STL write failed"); return OCC_ERR_IO; }
  return OCC_OK;
  OCC_GUARD_END
}

int occ_gltf_write(occ_shape_t s, const char* path, double defl) {
  REQ(s && path, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  if (defl > 0) BRepMesh_IncrementalMesh(*as_shape(s), defl);
  Handle(TDocStd_Document) doc;
  single_doc_with_shape(*as_shape(s), doc);
  RWGltf_CafWriter w(path, /*is_binary*/ Standard_False);
  TColStd_IndexedDataMapOfStringString meta;
  Message_ProgressRange pr;
  if (!w.Perform(doc, meta, pr)) { set_last("glTF write failed"); return OCC_ERR_IO; }
  return OCC_OK;
  OCC_GUARD_END
}

int occ_obj_write(occ_shape_t s, const char* path, double defl) {
  REQ(s && path, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  if (defl > 0) BRepMesh_IncrementalMesh(*as_shape(s), defl);
  Handle(TDocStd_Document) doc;
  single_doc_with_shape(*as_shape(s), doc);
  RWObj_CafWriter w(path);
  TColStd_IndexedDataMapOfStringString meta;
  Message_ProgressRange pr;
  if (!w.Perform(doc, meta, pr)) { set_last("OBJ write failed"); return OCC_ERR_IO; }
  return OCC_OK;
  OCC_GUARD_END
}

int occ_obj_read(const char* path, occ_shape_t* out) {
  REQ(path && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  Handle(XCAFApp_Application) app = XCAFApp_Application::GetApplication();
  Handle(TDocStd_Document) doc;
  app->NewDocument("XmlOcaf", doc);
  RWObj_CafReader r;
  r.SetDocument(doc);
  Message_ProgressRange pr;
  if (!r.Perform(path, pr)) { set_last("OBJ read failed"); return OCC_ERR_IO; }
  Handle(XCAFDoc_ShapeTool) tool = XCAFDoc_DocumentTool::ShapeTool(doc->Main());
  TDF_LabelSequence labels;
  tool->GetFreeShapes(labels);
  TopoDS_Compound comp;
  BRep_Builder bb; bb.MakeCompound(comp);
  for (int i = 1; i <= labels.Length(); ++i) {
    TopoDS_Shape sh;
    if (tool->GetShape(labels.Value(i), sh)) bb.Add(comp, sh);
  }
  *out = to_handle(comp);
  return OCC_OK;
  OCC_GUARD_END
}

/* ---- Mesh ---- */

int occ_mesh_compute(occ_shape_t s, double defl, occ_mesh_t* out) {
  REQ(s && out, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  BRepMesh_IncrementalMesh(*as_shape(s), defl > 0 ? defl : 0.1);

  auto* buf = new MeshBuf;
  for (TopExp_Explorer ex(*as_shape(s), TopAbs_FACE); ex.More(); ex.Next()) {
    const TopoDS_Face& f = TopoDS::Face(ex.Current());
    TopLoc_Location loc;
    Handle(Poly_Triangulation) tri = BRep_Tool::Triangulation(f, loc);
    if (tri.IsNull()) continue;
    const gp_Trsf& t = loc.Transformation();
    const int base = static_cast<int>(buf->vtx.size() / 3);
    const int nv = tri->NbNodes();

    // Per-face flat normal from first triangle (simple but adequate).
    gp_Vec fn(0, 0, 1);
    if (tri->NbTriangles() > 0) {
      const Poly_Triangle& t0 = tri->Triangle(1);
      int a, b, c; t0.Get(a, b, c);
      gp_Pnt pa = tri->Node(a).Transformed(t);
      gp_Pnt pb = tri->Node(b).Transformed(t);
      gp_Pnt pc = tri->Node(c).Transformed(t);
      gp_Vec v1(pa, pb), v2(pa, pc);
      gp_Vec n = v1.Crossed(v2);
      if (n.Magnitude() > 1e-12) { n.Normalize(); fn = n; }
    }
    if (f.Orientation() == TopAbs_REVERSED) fn.Reverse();

    for (int i = 1; i <= nv; ++i) {
      gp_Pnt p = tri->Node(i).Transformed(t);
      buf->vtx.push_back(static_cast<float>(p.X()));
      buf->vtx.push_back(static_cast<float>(p.Y()));
      buf->vtx.push_back(static_cast<float>(p.Z()));
      buf->nrm.push_back(static_cast<float>(fn.X()));
      buf->nrm.push_back(static_cast<float>(fn.Y()));
      buf->nrm.push_back(static_cast<float>(fn.Z()));
    }
    const bool rev = (f.Orientation() == TopAbs_REVERSED);
    for (int i = 1; i <= tri->NbTriangles(); ++i) {
      int a, b, c; tri->Triangle(i).Get(a, b, c);
      if (rev) std::swap(b, c);
      buf->idx.push_back(base + a - 1);
      buf->idx.push_back(base + b - 1);
      buf->idx.push_back(base + c - 1);
    }
  }
  *out = reinterpret_cast<occ_mesh_t>(buf);
  return OCC_OK;
  OCC_GUARD_END
}

int occ_mesh_vertex_count(occ_mesh_t m, int* out) {
  REQ(m && out, OCC_ERR_NULL_ARG);
  *out = static_cast<int>(reinterpret_cast<MeshBuf*>(m)->vtx.size() / 3);
  return OCC_OK;
}
int occ_mesh_index_count(occ_mesh_t m, int* out) {
  REQ(m && out, OCC_ERR_NULL_ARG);
  *out = static_cast<int>(reinterpret_cast<MeshBuf*>(m)->idx.size());
  return OCC_OK;
}
int occ_mesh_vertices(occ_mesh_t m, const float** xyz) {
  REQ(m && xyz, OCC_ERR_NULL_ARG);
  *xyz = reinterpret_cast<MeshBuf*>(m)->vtx.data();
  return OCC_OK;
}
int occ_mesh_normals(occ_mesh_t m, const float** nxyz) {
  REQ(m && nxyz, OCC_ERR_NULL_ARG);
  *nxyz = reinterpret_cast<MeshBuf*>(m)->nrm.data();
  return OCC_OK;
}
int occ_mesh_indices(occ_mesh_t m, const int32_t** idx) {
  REQ(m && idx, OCC_ERR_NULL_ARG);
  *idx = reinterpret_cast<MeshBuf*>(m)->idx.data();
  return OCC_OK;
}
void occ_mesh_free(occ_mesh_t m) {
  delete reinterpret_cast<MeshBuf*>(m);
}

}  // extern "C"
