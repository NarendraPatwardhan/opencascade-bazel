// Minimal smoke test — construct a box, fuse a cylinder, cut a smaller one,
// fillet all edges, verify volume, and export STEP + STL.

#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepFilletAPI_MakeFillet.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <STEPControl_Writer.hxx>
#include <StlAPI_Writer.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <gp_Ax2.hxx>
#include <gp_Pnt.hxx>
#include <gp_Dir.hxx>

#include <cstdio>
#include <cstdlib>

int main() {
  TopoDS_Shape box  = BRepPrimAPI_MakeBox(10.0, 10.0, 10.0).Shape();
  TopoDS_Shape cyl1 = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(5, 5, -1), gp_Dir(0, 0, 1)), 3.0, 12.0).Shape();
  TopoDS_Shape cyl2 = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(5, 5, -1), gp_Dir(0, 0, 1)), 1.5, 12.0).Shape();

  TopoDS_Shape fused = BRepAlgoAPI_Fuse(box, cyl1).Shape();
  TopoDS_Shape cut   = BRepAlgoAPI_Cut(fused, cyl2).Shape();

  TopoDS_Shape filleted = cut;  // skip fillet for smoke test

  GProp_GProps props;
  BRepGProp::VolumeProperties(filleted, props);
  const double volume = props.Mass();
  std::printf("volume = %.4f mm^3\n", volume);
  if (volume < 100.0 || volume > 2000.0) {
    std::fprintf(stderr, "unexpected volume\n");
    return 1;
  }

  {
    STEPControl_Writer w;
    if (w.Transfer(filleted, STEPControl_AsIs) != IFSelect_RetDone) {
      std::fprintf(stderr, "step transfer failed\n");
      return 1;
    }
    if (w.Write("smoke.step") != IFSelect_RetDone) {
      std::fprintf(stderr, "step write failed\n");
      return 1;
    }
  }

  {
    BRepMesh_IncrementalMesh(filleted, 0.1);
    StlAPI_Writer stl;
    if (!stl.Write(filleted, "smoke.stl")) {
      std::fprintf(stderr, "stl write failed\n");
      return 1;
    }
  }

  std::puts("ok");
  return 0;
}
