// === file: api/src/occ_c_internal.hxx
// Private — not installed. Shared by all occ_c*.cc translation units.
#pragma once

#include "occ_c.h"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <string>
#include <vector>

#include <BRep_Builder.hxx>
#include <BRep_Tool.hxx>
#include <Standard_Failure.hxx>
#include <Standard_Version.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Ax1.hxx>
#include <gp_Ax2.hxx>
#include <gp_Ax3.hxx>
#include <gp_Dir.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>

namespace occ_c_detail {

inline thread_local std::string g_last_error;

inline void set_last(const char* msg) {
  g_last_error = msg ? msg : "";
}

inline TopoDS_Shape* as_shape(occ_shape_t s) {
  return reinterpret_cast<TopoDS_Shape*>(s);
}

inline occ_shape_t to_handle(const TopoDS_Shape& s) {
  return reinterpret_cast<occ_shape_t>(new TopoDS_Shape(s));
}

inline bool null_shape(occ_shape_t s) {
  return !s || as_shape(s)->IsNull();
}

inline gp_Ax2 axis2(double cx, double cy, double cz,
                    double ax, double ay, double az) {
  return gp_Ax2(gp_Pnt(cx, cy, cz), gp_Dir(ax, ay, az));
}

inline double vlen(double x, double y, double z) {
  return std::sqrt(x * x + y * y + z * z);
}

inline bool normalize3(double& x, double& y, double& z, double eps = 1e-14) {
  const double L = vlen(x, y, z);
  if (L < eps) return false;
  x /= L;
  y /= L;
  z /= L;
  return true;
}

inline void cross3(double ax, double ay, double az,
                   double bx, double by, double bz,
                   double& ox, double& oy, double& oz) {
  ox = ay * bz - az * by;
  oy = az * bx - ax * bz;
  oz = ax * by - ay * bx;
}

inline double dot3(double ax, double ay, double az,
                   double bx, double by, double bz) {
  return ax * bx + ay * by + az * bz;
}

}  // namespace occ_c_detail

#define OCC_GUARD_BEGIN try {
#define OCC_GUARD_END                                                         \
  } catch (Standard_Failure & e) {                                            \
    occ_c_detail::set_last(e.GetMessageString() ? e.GetMessageString()        \
                                                : "OCCT failure");            \
    return OCC_ERR_EXCEPTION;                                                 \
  } catch (std::exception & e) {                                              \
    occ_c_detail::set_last(e.what());                                         \
    return OCC_ERR_EXCEPTION;                                                 \
  } catch (...) {                                                             \
    occ_c_detail::set_last("unknown exception");                              \
    return OCC_ERR_EXCEPTION;                                                 \
  }

#define REQ(cond, code)               \
  do {                                \
    if (!(cond)) return (code);       \
  } while (0)

#define REQ_MSG(cond, code, msg)                    \
  do {                                              \
    if (!(cond)) {                                  \
      occ_c_detail::set_last(msg);                  \
      return (code);                                \
    }                                               \
  } while (0)
