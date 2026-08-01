#include "occ_c_session.h"
#include "occ_c_internal.hxx"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>

using occ_c_detail::as_shape;
using occ_c_detail::set_last;
using occ_c_detail::to_handle;

/* ==========================================================================
 * Internal session state
 * ========================================================================== */

namespace {

struct EntityRec {
  occ_entity_id_t id = 0;
  TopoDS_Shape shape;           /* may be null shape for FRAME-only */
  occ_entity_kind_t kind = OCC_ENTITY_ANY;
  std::string created_by;       /* op id at registration time */
  std::string name;             /* optional unique name */
  bool has_shape = false;
};

struct FrameKeyHash {
  size_t operator()(const std::pair<uint64_t, std::string>& k) const noexcept {
    return std::hash<uint64_t>{}(k.first) ^
           (std::hash<std::string>{}(k.second) << 1);
  }
};

struct SessionImpl {
  uint64_t next_id = 1;
  std::unordered_map<uint64_t, EntityRec> entities;
  std::unordered_map<std::string, occ_entity_id_t> name_to_id;
  std::unordered_map<std::pair<uint64_t, std::string>, occ_session_frame_t,
                     FrameKeyHash>
      frames;
  std::vector<std::string> op_stack;

  occ_entity_id_t plane_xy = 0;
  occ_entity_id_t plane_yz = 0;
  occ_entity_id_t plane_zx = 0;
};

SessionImpl* impl_of(occ_session_t* s) {
  return reinterpret_cast<SessionImpl*>(s);
}

const SessionImpl* impl_of(const occ_session_t* s) {
  return reinterpret_cast<const SessionImpl*>(s);
}

int req_session(occ_session_t* session, SessionImpl** out) {
  if (!session) {
    set_last("null session");
    return OCC_ERR_NO_SESSION;
  }
  *out = impl_of(session);
  return OCC_OK;
}

std::string current_op_id(const SessionImpl* S) {
  if (S->op_stack.empty()) return std::string();
  return S->op_stack.back();
}

occ_entity_kind_t kind_from_shape(const TopoDS_Shape& s) {
  if (s.IsNull()) return OCC_ENTITY_ANY;
  switch (s.ShapeType()) {
    case TopAbs_COMPOUND:
      return OCC_ENTITY_COMPOUND;
    case TopAbs_COMPSOLID:
      return OCC_ENTITY_SOLID;
    case TopAbs_SOLID:
      return OCC_ENTITY_SOLID;
    case TopAbs_SHELL:
      return OCC_ENTITY_SHELL;
    case TopAbs_FACE:
      return OCC_ENTITY_FACE;
    case TopAbs_WIRE:
      return OCC_ENTITY_WIRE;
    case TopAbs_EDGE:
      return OCC_ENTITY_EDGE;
    case TopAbs_VERTEX:
      return OCC_ENTITY_VERTEX;
    default:
      return OCC_ENTITY_BODY;
  }
}

/* BODY selector matches solid-like / compound bodies. */
bool kind_matches(occ_entity_kind_t want, occ_entity_kind_t have) {
  if (want == OCC_ENTITY_ANY) return true;
  if (want == have) return true;
  if (want == OCC_ENTITY_BODY) {
    return have == OCC_ENTITY_SOLID || have == OCC_ENTITY_COMPOUND ||
           have == OCC_ENTITY_SHELL || have == OCC_ENTITY_BODY;
  }
  return false;
}

bool prefix_match(const std::string& created_by, const char* prefix) {
  if (!prefix) return false;
  const size_t n = std::strlen(prefix);
  if (n == 0) return false;
  if (created_by.size() < n) return false;
  return std::strncmp(created_by.c_str(), prefix, n) == 0;
}

int copy_cstr(const std::string& src, char* buf, int buflen) {
  if (!buf || buflen < 1) {
    set_last("buffer too small");
    return OCC_ERR_CAPACITY;
  }
  /* leave room for NUL */
  const size_t max_copy = static_cast<size_t>(buflen - 1);
  const size_t n = src.size() < max_copy ? src.size() : max_copy;
  if (n > 0) std::memcpy(buf, src.data(), n);
  buf[n] = '\0';
  if (src.size() + 1 > static_cast<size_t>(buflen)) {
    set_last("op id / name truncated");
    return OCC_ERR_CAPACITY;
  }
  return OCC_OK;
}

double vlen3(double x, double y, double z) {
  return std::sqrt(x * x + y * y + z * z);
}

int validate_frame(const occ_session_frame_t* f) {
  if (!f) return OCC_ERR_NULL_ARG;
  const double xl = vlen3(f->x[0], f->x[1], f->x[2]);
  const double yl = vlen3(f->y[0], f->y[1], f->y[2]);
  const double zl = vlen3(f->z[0], f->z[1], f->z[2]);
  if (xl < 1e-12 || yl < 1e-12 || zl < 1e-12) {
    set_last("frame axis length near zero");
    return OCC_ERR_MATH;
  }
  /* soft orthonormal check */
  const double xzn =
      (f->x[0] * f->z[0] + f->x[1] * f->z[1] + f->x[2] * f->z[2]) / (xl * zl);
  if (std::fabs(xzn) > 1e-3) {
    set_last("frame X and Z not orthogonal enough");
    return OCC_ERR_MATH;
  }
  return OCC_OK;
}

occ_entity_id_t alloc_id(SessionImpl* S) {
  return S->next_id++;
}

void unbind_name(SessionImpl* S, EntityRec& rec) {
  if (rec.name.empty()) return;
  auto it = S->name_to_id.find(rec.name);
  if (it != S->name_to_id.end() && it->second == rec.id) {
    S->name_to_id.erase(it);
  }
  rec.name.clear();
}

void erase_frames_for(SessionImpl* S, occ_entity_id_t id) {
  for (auto it = S->frames.begin(); it != S->frames.end();) {
    if (it->first.first == id)
      it = S->frames.erase(it);
    else
      ++it;
  }
}

int register_one(SessionImpl* S,
                 const TopoDS_Shape& shape,
                 occ_entity_kind_t kind,
                 bool has_shape,
                 occ_entity_id_t* out_id) {
  EntityRec rec;
  rec.id = alloc_id(S);
  rec.shape = shape;
  rec.kind = kind;
  rec.created_by = current_op_id(S);
  rec.has_shape = has_shape && !shape.IsNull();
  const occ_entity_id_t id = rec.id;
  S->entities.emplace(id, std::move(rec));
  if (out_id) *out_id = id;
  return OCC_OK;
}

void expand_subshapes(SessionImpl* S, const TopoDS_Shape& root) {
  if (root.IsNull()) return;

  auto add_type = [&](TopAbs_ShapeEnum t, occ_entity_kind_t k) {
    for (TopExp_Explorer ex(root, t); ex.More(); ex.Next()) {
      const TopoDS_Shape& sub = ex.Current();
      /* skip if identical to root (already registered) */
      if (sub.IsSame(root)) continue;
      register_one(S, sub, k, true, nullptr);
    }
  };

  /* Order: solids → shells → faces → wires → edges → vertices */
  add_type(TopAbs_SOLID, OCC_ENTITY_SOLID);
  add_type(TopAbs_SHELL, OCC_ENTITY_SHELL);
  add_type(TopAbs_FACE, OCC_ENTITY_FACE);
  add_type(TopAbs_WIRE, OCC_ENTITY_WIRE);
  add_type(TopAbs_EDGE, OCC_ENTITY_EDGE);
  add_type(TopAbs_VERTEX, OCC_ENTITY_VERTEX);
}

int make_plane_rect_face(const gp_Pnt& origin,
                         const gp_Dir& normal,
                         const gp_Dir& xdir,
                         double half_w,
                         double half_h,
                         TopoDS_Shape& out_face) {
  const gp_Dir ydir = normal.Crossed(xdir);
  const gp_Pnt p0 =
      origin.Translated(gp_Vec(xdir) * (-half_w) + gp_Vec(ydir) * (-half_h));
  const gp_Pnt p1 =
      origin.Translated(gp_Vec(xdir) * (half_w) + gp_Vec(ydir) * (-half_h));
  const gp_Pnt p2 =
      origin.Translated(gp_Vec(xdir) * (half_w) + gp_Vec(ydir) * (half_h));
  const gp_Pnt p3 =
      origin.Translated(gp_Vec(xdir) * (-half_w) + gp_Vec(ydir) * (half_h));

  BRepBuilderAPI_MakePolygon poly(p0, p1, p2, p3, Standard_True);
  if (!poly.IsDone()) {
    set_last("world plane polygon failed");
    return OCC_ERR_MATH;
  }
  BRepBuilderAPI_MakeFace mf(poly.Wire(), /*OnlyPlane=*/Standard_True);
  if (!mf.IsDone()) {
    set_last("world plane face failed");
    return OCC_ERR_MATH;
  }
  out_face = mf.Face();
  return OCC_OK;
}

void fill_frame(occ_session_frame_t* f,
                double ox, double oy, double oz,
                double xx, double xy, double xz,
                double yx, double yy, double yz,
                double zx, double zy, double zz) {
  f->origin[0] = ox; f->origin[1] = oy; f->origin[2] = oz;
  f->x[0] = xx; f->x[1] = xy; f->x[2] = xz;
  f->y[0] = yx; f->y[1] = yy; f->y[2] = yz;
  f->z[0] = zx; f->z[1] = zy; f->z[2] = zz;
}

int write_ids_capped(const std::vector<occ_entity_id_t>& ids,
                     occ_entity_id_t* out_entity_ids,
                     int max,
                     int* out_count) {
  if (!out_count) {
    set_last("null out_count");
    return OCC_ERR_NULL_ARG;
  }
  *out_count = static_cast<int>(ids.size());
  if (max < 0) {
    set_last("max < 0");
    return OCC_ERR_BAD_QUERY;
  }
  if (max > 0 && !out_entity_ids) {
    set_last("null out_entity_ids with max > 0");
    return OCC_ERR_NULL_ARG;
  }
  const int nwrite =
      static_cast<int>(ids.size()) < max ? static_cast<int>(ids.size()) : max;
  for (int i = 0; i < nwrite; ++i) out_entity_ids[i] = ids[static_cast<size_t>(i)];
  if (static_cast<int>(ids.size()) > max && max >= 0) {
    set_last("query result exceeds capacity");
    return OCC_ERR_CAPACITY;
  }
  return OCC_OK;
}

}  // namespace

/* ==========================================================================
 * C API
 * ========================================================================== */

extern "C" {

/* --------------------------- lifecycle --------------------------- */

int occ_session_create(occ_session_t** out_session) {
  REQ(out_session, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  SessionImpl* S = new SessionImpl();
  *out_session = reinterpret_cast<occ_session_t*>(S);
  set_last("");
  return OCC_OK;
  OCC_GUARD_END
}

int occ_session_destroy(occ_session_t* session) {
  if (!session) return OCC_OK;
  OCC_GUARD_BEGIN
  delete impl_of(session);
  set_last("");
  return OCC_OK;
  OCC_GUARD_END
}

int occ_session_clear(occ_session_t* session) {
  SessionImpl* S = nullptr;
  int st = req_session(session, &S);
  if (st != OCC_OK) return st;
  OCC_GUARD_BEGIN
  S->entities.clear();
  S->name_to_id.clear();
  S->frames.clear();
  S->op_stack.clear();
  S->plane_xy = S->plane_yz = S->plane_zx = 0;
  /* keep next_id monotonic across clear so historical ids never revive */
  set_last("");
  return OCC_OK;
  OCC_GUARD_END
}

/* --------------------------- op stack --------------------------- */

int occ_session_begin_op(occ_session_t* session, const char* op_id_str) {
  SessionImpl* S = nullptr;
  int st = req_session(session, &S);
  if (st != OCC_OK) return st;
  REQ(op_id_str, OCC_ERR_NULL_ARG);
  if (op_id_str[0] == '\0') {
    set_last("empty op id");
    return OCC_ERR_UNKNOWN_OP;
  }
  OCC_GUARD_BEGIN
  S->op_stack.emplace_back(op_id_str);
  set_last("");
  return OCC_OK;
  OCC_GUARD_END
}

int occ_session_end_op(occ_session_t* session, const char* op_id_str) {
  SessionImpl* S = nullptr;
  int st = req_session(session, &S);
  if (st != OCC_OK) return st;
  OCC_GUARD_BEGIN
  if (S->op_stack.empty()) {
    set_last("end_op with empty op stack");
    return OCC_ERR_UNKNOWN_OP;
  }
  if (op_id_str) {
    if (S->op_stack.back() != op_id_str) {
      set_last("end_op id does not match stack top");
      return OCC_ERR_UNKNOWN_OP;
    }
  }
  S->op_stack.pop_back();
  set_last("");
  return OCC_OK;
  OCC_GUARD_END
}

int occ_session_current_op(occ_session_t* session, char* buf, int buflen) {
  SessionImpl* S = nullptr;
  int st = req_session(session, &S);
  if (st != OCC_OK) return st;
  REQ(buf, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  return copy_cstr(current_op_id(S), buf, buflen);
  OCC_GUARD_END
}

/* --------------------------- register / get / release --------------------------- */

int occ_session_register_shape_root_only(occ_session_t* session,
                                         occ_shape_t shape,
                                         occ_entity_id_t* out_entity_id) {
  SessionImpl* S = nullptr;
  int st = req_session(session, &S);
  if (st != OCC_OK) return st;
  REQ(shape, OCC_ERR_NULL_ARG);
  REQ(out_entity_id, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  const TopoDS_Shape& sh = *as_shape(shape);
  if (sh.IsNull()) {
    set_last("null TopoDS_Shape");
    return OCC_ERR_INVALID_SHAPE;
  }
  const occ_entity_kind_t k = kind_from_shape(sh);
  st = register_one(S, sh, k, true, out_entity_id);
  if (st != OCC_OK) return st;
  set_last("");
  return OCC_OK;
  OCC_GUARD_END
}

int occ_session_register_shape(occ_session_t* session,
                               occ_shape_t shape,
                               occ_entity_id_t* out_entity_id) {
  SessionImpl* S = nullptr;
  int st = req_session(session, &S);
  if (st != OCC_OK) return st;
  REQ(shape, OCC_ERR_NULL_ARG);
  REQ(out_entity_id, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  const TopoDS_Shape& sh = *as_shape(shape);
  if (sh.IsNull()) {
    set_last("null TopoDS_Shape");
    return OCC_ERR_INVALID_SHAPE;
  }
  const occ_entity_kind_t k = kind_from_shape(sh);
  st = register_one(S, sh, k, true, out_entity_id);
  if (st != OCC_OK) return st;
  expand_subshapes(S, sh);
  set_last("");
  return OCC_OK;
  OCC_GUARD_END
}

int occ_session_get_shape(occ_session_t* session,
                          occ_entity_id_t entity_id,
                          occ_shape_t* out_shape) {
  SessionImpl* S = nullptr;
  int st = req_session(session, &S);
  if (st != OCC_OK) return st;
  REQ(out_shape, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  auto it = S->entities.find(entity_id);
  if (it == S->entities.end()) {
    set_last("entity not found");
    return OCC_ERR_NOT_FOUND;
  }
  if (!it->second.has_shape || it->second.shape.IsNull()) {
    set_last("entity has no BREP shape");
    return OCC_ERR_INVALID_SHAPE;
  }
  *out_shape = to_handle(it->second.shape);
  set_last("");
  return OCC_OK;
  OCC_GUARD_END
}

int occ_session_release_entity(occ_session_t* session,
                               occ_entity_id_t entity_id) {
  SessionImpl* S = nullptr;
  int st = req_session(session, &S);
  if (st != OCC_OK) return st;
  OCC_GUARD_BEGIN
  auto it = S->entities.find(entity_id);
  if (it == S->entities.end()) {
    set_last("entity not found");
    return OCC_ERR_NOT_FOUND;
  }
  unbind_name(S, it->second);
  erase_frames_for(S, entity_id);
  if (S->plane_xy == entity_id) S->plane_xy = 0;
  if (S->plane_yz == entity_id) S->plane_yz = 0;
  if (S->plane_zx == entity_id) S->plane_zx = 0;
  S->entities.erase(it);
  set_last("");
  return OCC_OK;
  OCC_GUARD_END
}

int occ_session_entity_count(occ_session_t* session, int* out_count) {
  SessionImpl* S = nullptr;
  int st = req_session(session, &S);
  if (st != OCC_OK) return st;
  REQ(out_count, OCC_ERR_NULL_ARG);
  *out_count = static_cast<int>(S->entities.size());
  return OCC_OK;
}

/* --------------------------- history find --------------------------- */

int occ_session_find_by_created_by(occ_session_t* session,
                                   const char* op_id_prefix,
                                   occ_entity_kind_t kind,
                                   occ_entity_id_t* out_entity_ids,
                                   int max,
                                   int* out_count) {
  SessionImpl* S = nullptr;
  int st = req_session(session, &S);
  if (st != OCC_OK) return st;
  if (!op_id_prefix || op_id_prefix[0] == '\0') {
    set_last("empty op_id_prefix");
    return OCC_ERR_BAD_QUERY;
  }
  OCC_GUARD_BEGIN
  std::vector<occ_entity_id_t> hits;
  hits.reserve(64);
  for (const auto& kv : S->entities) {
    const EntityRec& rec = kv.second;
    if (!prefix_match(rec.created_by, op_id_prefix)) continue;
    if (!kind_matches(kind, rec.kind)) continue;
    hits.push_back(rec.id);
  }
  /* stable order by entity id for determinism */
  std::sort(hits.begin(), hits.end());
  return write_ids_capped(hits, out_entity_ids, max, out_count);
  OCC_GUARD_END
}

int occ_session_entity_op_id(occ_session_t* session,
                             occ_entity_id_t entity_id,
                             char* buf,
                             int buflen) {
  SessionImpl* S = nullptr;
  int st = req_session(session, &S);
  if (st != OCC_OK) return st;
  REQ(buf, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  auto it = S->entities.find(entity_id);
  if (it == S->entities.end()) {
    set_last("entity not found");
    return OCC_ERR_NOT_FOUND;
  }
  return copy_cstr(it->second.created_by, buf, buflen);
  OCC_GUARD_END
}

int occ_session_entity_kind(occ_session_t* session,
                            occ_entity_id_t entity_id,
                            occ_entity_kind_t* out_kind) {
  SessionImpl* S = nullptr;
  int st = req_session(session, &S);
  if (st != OCC_OK) return st;
  REQ(out_kind, OCC_ERR_NULL_ARG);
  auto it = S->entities.find(entity_id);
  if (it == S->entities.end()) {
    set_last("entity not found");
    return OCC_ERR_NOT_FOUND;
  }
  *out_kind = it->second.kind;
  return OCC_OK;
}

/* --------------------------- names --------------------------- */

int occ_session_set_name(occ_session_t* session,
                         occ_entity_id_t entity_id,
                         const char* name) {
  SessionImpl* S = nullptr;
  int st = req_session(session, &S);
  if (st != OCC_OK) return st;
  REQ(name, OCC_ERR_NULL_ARG);
  if (name[0] == '\0') {
    set_last("empty name");
    return OCC_ERR_BAD_QUERY;
  }
  OCC_GUARD_BEGIN
  auto it = S->entities.find(entity_id);
  if (it == S->entities.end()) {
    set_last("entity not found");
    return OCC_ERR_NOT_FOUND;
  }
  /* rebind: if name already used by another entity, steal it */
  auto nit = S->name_to_id.find(name);
  if (nit != S->name_to_id.end() && nit->second != entity_id) {
    auto other = S->entities.find(nit->second);
    if (other != S->entities.end()) {
      other->second.name.clear();
    }
  }
  unbind_name(S, it->second);
  it->second.name = name;
  S->name_to_id[name] = entity_id;
  set_last("");
  return OCC_OK;
  OCC_GUARD_END
}

int occ_session_find_by_name(occ_session_t* session,
                             const char* name,
                             occ_entity_id_t* out_entity_id) {
  SessionImpl* S = nullptr;
  int st = req_session(session, &S);
  if (st != OCC_OK) return st;
  REQ(name, OCC_ERR_NULL_ARG);
  REQ(out_entity_id, OCC_ERR_NULL_ARG);
  auto it = S->name_to_id.find(name);
  if (it == S->name_to_id.end()) {
    set_last("name not found");
    return OCC_ERR_NOT_FOUND;
  }
  *out_entity_id = it->second;
  return OCC_OK;
}

int occ_session_entity_name(occ_session_t* session,
                            occ_entity_id_t entity_id,
                            char* buf,
                            int buflen) {
  SessionImpl* S = nullptr;
  int st = req_session(session, &S);
  if (st != OCC_OK) return st;
  REQ(buf, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  auto it = S->entities.find(entity_id);
  if (it == S->entities.end()) {
    set_last("entity not found");
    return OCC_ERR_NOT_FOUND;
  }
  return copy_cstr(it->second.name, buf, buflen);
  OCC_GUARD_END
}

/* --------------------------- frames --------------------------- */

int occ_session_frame_to_12(const occ_session_frame_t* f, double out12[12]) {
  REQ(f && out12, OCC_ERR_NULL_ARG);
  out12[0] = f->origin[0]; out12[1] = f->origin[1]; out12[2] = f->origin[2];
  out12[3] = f->x[0];      out12[4] = f->x[1];      out12[5] = f->x[2];
  out12[6] = f->y[0];      out12[7] = f->y[1];      out12[8] = f->y[2];
  out12[9] = f->z[0];      out12[10] = f->z[1];     out12[11] = f->z[2];
  return OCC_OK;
}

int occ_session_frame_from_12(const double m12[12], occ_session_frame_t* out) {
  REQ(m12 && out, OCC_ERR_NULL_ARG);
  out->origin[0] = m12[0]; out->origin[1] = m12[1]; out->origin[2] = m12[2];
  out->x[0] = m12[3];      out->x[1] = m12[4];      out->x[2] = m12[5];
  out->y[0] = m12[6];      out->y[1] = m12[7];      out->y[2] = m12[8];
  out->z[0] = m12[9];      out->z[1] = m12[10];     out->z[2] = m12[11];
  return OCC_OK;
}

int occ_session_attach_frame(occ_session_t* session,
                             occ_entity_id_t entity_id,
                             const char* name,
                             const occ_session_frame_t* frame) {
  SessionImpl* S = nullptr;
  int st = req_session(session, &S);
  if (st != OCC_OK) return st;
  REQ(name, OCC_ERR_NULL_ARG);
  REQ(frame, OCC_ERR_NULL_ARG);
  if (name[0] == '\0') {
    set_last("empty frame name");
    return OCC_ERR_BAD_QUERY;
  }
  OCC_GUARD_BEGIN
  st = validate_frame(frame);
  if (st != OCC_OK) return st;

  occ_entity_id_t target = entity_id;
  if (target == 0) {
    /* free-floating FRAME entity */
    st = register_one(S, TopoDS_Shape(), OCC_ENTITY_FRAME, false, &target);
    if (st != OCC_OK) return st;
  } else {
    auto it = S->entities.find(target);
    if (it == S->entities.end()) {
      set_last("entity not found for frame attach");
      return OCC_ERR_NOT_FOUND;
    }
  }

  S->frames[{target, std::string(name)}] = *frame;
  set_last("");
  return OCC_OK;
  OCC_GUARD_END
}

int occ_session_get_frame(occ_session_t* session,
                          occ_entity_id_t entity_id,
                          const char* name,
                          occ_session_frame_t* out_frame) {
  SessionImpl* S = nullptr;
  int st = req_session(session, &S);
  if (st != OCC_OK) return st;
  REQ(name && out_frame, OCC_ERR_NULL_ARG);
  OCC_GUARD_BEGIN
  auto it = S->frames.find({entity_id, std::string(name)});
  if (it == S->frames.end()) {
    set_last("frame not found");
    return OCC_ERR_NOT_FOUND;
  }
  *out_frame = it->second;
  set_last("");
  return OCC_OK;
  OCC_GUARD_END
}

/* --------------------------- world planes --------------------------- */

int occ_session_ensure_world_planes(occ_session_t* session) {
  SessionImpl* S = nullptr;
  int st = req_session(session, &S);
  if (st != OCC_OK) return st;
  OCC_GUARD_BEGIN

  auto ensure_one = [&](occ_entity_id_t& slot, const char* op_name,
                        const char* ent_name, const gp_Pnt& o, const gp_Dir& n,
                        const gp_Dir& x, const occ_session_frame_t& fr) -> int {
    if (slot != 0 && S->entities.count(slot)) return OCC_OK;
    /* temporarily push a synthetic op so created_by is stable */
    S->op_stack.emplace_back(op_name);
    TopoDS_Shape face;
    int rc = make_plane_rect_face(o, n, x, /*half_w=*/1.0, /*half_h=*/1.0, face);
    if (rc != OCC_OK) {
      S->op_stack.pop_back();
      return rc;
    }
    occ_entity_id_t id = 0;
    rc = register_one(S, face, OCC_ENTITY_FACE, true, &id);
    S->op_stack.pop_back();
    if (rc != OCC_OK) return rc;
    EntityRec& rec = S->entities[id];
    unbind_name(S, rec);
    rec.name = ent_name;
    S->name_to_id[ent_name] = id;
    S->frames[{id, std::string("cs")}] = fr;
    slot = id;
    return OCC_OK;
  };

  occ_session_frame_t fxy, fyz, fzx;
  fill_frame(&fxy, 0, 0, 0,  1, 0, 0,  0, 1, 0,  0, 0, 1);
  fill_frame(&fyz, 0, 0, 0,  0, 1, 0,  0, 0, 1,  1, 0, 0);
  fill_frame(&fzx, 0, 0, 0,  0, 0, 1,  1, 0, 0,  0, 1, 0);

  st = ensure_one(S->plane_xy, "world/xy", "world_xy",
                  gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1), gp_Dir(1, 0, 0), fxy);
  if (st != OCC_OK) return st;
  st = ensure_one(S->plane_yz, "world/yz", "world_yz",
                  gp_Pnt(0, 0, 0), gp_Dir(1, 0, 0), gp_Dir(0, 1, 0), fyz);
  if (st != OCC_OK) return st;
  st = ensure_one(S->plane_zx, "world/zx", "world_zx",
                  gp_Pnt(0, 0, 0), gp_Dir(0, 1, 0), gp_Dir(0, 0, 1), fzx);
  if (st != OCC_OK) return st;

  set_last("");
  return OCC_OK;
  OCC_GUARD_END
}

int occ_session_world_plane_xy(occ_session_t* session, occ_entity_id_t* out_id) {
  SessionImpl* S = nullptr;
  int st = req_session(session, &S);
  if (st != OCC_OK) return st;
  REQ(out_id, OCC_ERR_NULL_ARG);
  if (S->plane_xy == 0) {
    st = occ_session_ensure_world_planes(session);
    if (st != OCC_OK) return st;
  }
  if (S->plane_xy == 0) {
    set_last("world xy plane missing");
    return OCC_ERR_NOT_FOUND;
  }
  *out_id = S->plane_xy;
  return OCC_OK;
}

int occ_session_world_plane_yz(occ_session_t* session, occ_entity_id_t* out_id) {
  SessionImpl* S = nullptr;
  int st = req_session(session, &S);
  if (st != OCC_OK) return st;
  REQ(out_id, OCC_ERR_NULL_ARG);
  if (S->plane_yz == 0) {
    st = occ_session_ensure_world_planes(session);
    if (st != OCC_OK) return st;
  }
  if (S->plane_yz == 0) {
    set_last("world yz plane missing");
    return OCC_ERR_NOT_FOUND;
  }
  *out_id = S->plane_yz;
  return OCC_OK;
}

int occ_session_world_plane_zx(occ_session_t* session, occ_entity_id_t* out_id) {
  SessionImpl* S = nullptr;
  int st = req_session(session, &S);
  if (st != OCC_OK) return st;
  REQ(out_id, OCC_ERR_NULL_ARG);
  if (S->plane_zx == 0) {
    st = occ_session_ensure_world_planes(session);
    if (st != OCC_OK) return st;
  }
  if (S->plane_zx == 0) {
    set_last("world zx plane missing");
    return OCC_ERR_NOT_FOUND;
  }
  *out_id = S->plane_zx;
  return OCC_OK;
}

/* --------------------------- IR query algebra v0 --------------------------- */

int occ_query_created_by(occ_session_t* session,
                         const char* op_id_prefix,
                         occ_entity_kind_t kind,
                         occ_entity_id_t* out_entity_ids,
                         int max,
                         int* out_count) {
  return occ_session_find_by_created_by(session, op_id_prefix, kind,
                                        out_entity_ids, max, out_count);
}

int occ_query_filter_kind(occ_session_t* session,
                          const occ_entity_id_t* in_ids,
                          int n_in,
                          occ_entity_kind_t kind,
                          occ_entity_id_t* out_entity_ids,
                          int max,
                          int* out_count) {
  SessionImpl* S = nullptr;
  int st = req_session(session, &S);
  if (st != OCC_OK) return st;
  if (n_in < 0) {
    set_last("n_in < 0");
    return OCC_ERR_BAD_QUERY;
  }
  if (n_in > 0 && !in_ids) {
    set_last("null in_ids");
    return OCC_ERR_NULL_ARG;
  }
  OCC_GUARD_BEGIN
  std::vector<occ_entity_id_t> hits;
  hits.reserve(static_cast<size_t>(n_in > 0 ? n_in : 0));
  for (int i = 0; i < n_in; ++i) {
    auto it = S->entities.find(in_ids[i]);
    if (it == S->entities.end()) continue; /* drop dead ids */
    if (!kind_matches(kind, it->second.kind)) continue;
    hits.push_back(in_ids[i]);
  }
  return write_ids_capped(hits, out_entity_ids, max, out_count);
  OCC_GUARD_END
}

int occ_query_intersect_ids(const occ_entity_id_t* a,
                            int na,
                            const occ_entity_id_t* b,
                            int nb,
                            occ_entity_id_t* out_entity_ids,
                            int max,
                            int* out_count) {
  if (na < 0 || nb < 0) {
    set_last("negative list length");
    return OCC_ERR_BAD_QUERY;
  }
  if ((na > 0 && !a) || (nb > 0 && !b)) {
    set_last("null id list");
    return OCC_ERR_NULL_ARG;
  }
  OCC_GUARD_BEGIN
  std::unordered_set<occ_entity_id_t> bset;
  bset.reserve(static_cast<size_t>(nb > 0 ? nb : 0));
  for (int i = 0; i < nb; ++i) bset.insert(b[i]);

  std::vector<occ_entity_id_t> hits;
  std::unordered_set<occ_entity_id_t> seen;
  hits.reserve(static_cast<size_t>(na > 0 ? na : 0));
  for (int i = 0; i < na; ++i) {
    if (!bset.count(a[i])) continue;
    if (seen.count(a[i])) continue;
    seen.insert(a[i]);
    hits.push_back(a[i]);
  }
  return write_ids_capped(hits, out_entity_ids, max, out_count);
  OCC_GUARD_END
}

int occ_query_union_ids(const occ_entity_id_t* a,
                        int na,
                        const occ_entity_id_t* b,
                        int nb,
                        occ_entity_id_t* out_entity_ids,
                        int max,
                        int* out_count) {
  if (na < 0 || nb < 0) {
    set_last("negative list length");
    return OCC_ERR_BAD_QUERY;
  }
  if ((na > 0 && !a) || (nb > 0 && !b)) {
    set_last("null id list");
    return OCC_ERR_NULL_ARG;
  }
  OCC_GUARD_BEGIN
  std::vector<occ_entity_id_t> hits;
  std::unordered_set<occ_entity_id_t> seen;
  hits.reserve(static_cast<size_t>((na > 0 ? na : 0) + (nb > 0 ? nb : 0)));
  for (int i = 0; i < na; ++i) {
    if (seen.insert(a[i]).second) hits.push_back(a[i]);
  }
  for (int i = 0; i < nb; ++i) {
    if (seen.insert(b[i]).second) hits.push_back(b[i]);
  }
  return write_ids_capped(hits, out_entity_ids, max, out_count);
  OCC_GUARD_END
}

int occ_query_subtract_ids(const occ_entity_id_t* a,
                           int na,
                           const occ_entity_id_t* b,
                           int nb,
                           occ_entity_id_t* out_entity_ids,
                           int max,
                           int* out_count) {
  if (na < 0 || nb < 0) {
    set_last("negative list length");
    return OCC_ERR_BAD_QUERY;
  }
  if ((na > 0 && !a) || (nb > 0 && !b)) {
    set_last("null id list");
    return OCC_ERR_NULL_ARG;
  }
  OCC_GUARD_BEGIN
  std::unordered_set<occ_entity_id_t> bset;
  for (int i = 0; i < nb; ++i) bset.insert(b[i]);
  std::vector<occ_entity_id_t> hits;
  std::unordered_set<occ_entity_id_t> seen;
  for (int i = 0; i < na; ++i) {
    if (bset.count(a[i])) continue;
    if (!seen.insert(a[i]).second) continue;
    hits.push_back(a[i]);
  }
  return write_ids_capped(hits, out_entity_ids, max, out_count);
  OCC_GUARD_END
}

}  // extern "C"

/* ==========================================================================
 * Frame POD conversion
 * ========================================================================== */

int occ_session_frame_from_frame(const occ_frame_t* f, occ_session_frame_t* out) {
  if (!f || !out) {
    set_last("null frame");
    return OCC_ERR_NULL_ARG;
  }
  out->origin[0] = f->ox; out->origin[1] = f->oy; out->origin[2] = f->oz;
  out->x[0] = f->xx; out->x[1] = f->xy; out->x[2] = f->xz;
  out->y[0] = f->yx; out->y[1] = f->yy; out->y[2] = f->yz;
  out->z[0] = f->zx; out->z[1] = f->zy; out->z[2] = f->zz;
  return OCC_OK;
}

int occ_session_frame_to_frame(const occ_session_frame_t* sf, occ_frame_t* out) {
  if (!sf || !out) {
    set_last("null frame");
    return OCC_ERR_NULL_ARG;
  }
  out->ox = sf->origin[0]; out->oy = sf->origin[1]; out->oz = sf->origin[2];
  out->xx = sf->x[0]; out->xy = sf->x[1]; out->xz = sf->x[2];
  out->yx = sf->y[0]; out->yy = sf->y[1]; out->yz = sf->y[2];
  out->zx = sf->z[0]; out->zy = sf->z[1]; out->zz = sf->z[2];
  return OCC_OK;
}

