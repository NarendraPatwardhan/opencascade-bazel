# Literate Section 01 — Session, Shape Registry, History Tagging, `created_by`

**Document type:** Literate programming source for Apache **`occ_c`** (thin C ABI over OpenCASCADE **7.9.3**)  
**Section:** `#1` clean-room **P0** gap — stable entity ids + history selectors  
**Audience:** Implementers extracting real `.h` / `.cc` into `api/include/` and `api/src/`  
**Date:** 2026-07-31  
**OCCT pin:** 7.9.3  
**Depends on:** `occ_c.h` (baseline), `occ_c_internal.hxx` (shared glue from P0 literate API)  
**Does not depend on:** FeatureScript names, Parasolid, any proprietary history model  

---

## How to extract

1. Blocks whose first fence line is `// === file: <name>` are authoritative source.  
2. Concatenate into `api/include/occ_c_session.h`, `api/src/occ_c_session.cc`, and patch `occ_status_t` in `occ_c.h`.  
3. Link against OCCT 7.9.3 (`TKBRep`, `TKTopAlgo`, `TKMath`, `TKG3d`, `TKBO` not required here).  
4. Units: **meters**, **radians**, topology indices **1-based** (when enumerating subshapes).  
5. Threading model: **single-threaded host** per session. One session object is not safe for concurrent mutation. `g_last_error` is `thread_local`.  
6. Original names only — no FeatureScript identifiers.

```text
docs/literate-sections/01-session-history.md
        │ extract
        ▼
api/include/occ_c.h            (status enum patch)
api/include/occ_c_session.h
api/src/occ_c_session.cc
```

---

## 1. Why history exists (parametric reselect after ops)

A pure shape-handle API is enough to *build* geometry once. It is **not** enough to rebuild a parametric document.

Consider IR:

```yaml
- id: box1/solid
  op: Extrude
  ...
- id: holes1
  op: DrillHole
  target: { created_by: box1/solid, entity: body }
  on:    { created_by: box1/solid, entity: face, filter: max_z }
```

When `box1/solid` re-evaluates (depth changes from 80 mm to 100 mm), every face index of the solid is free to renumber. Downstream features that stored `face_index: 7` break. Downstream features that store **historical selectors** survive:

| Fragile | Stable |
|---------|--------|
| `face_index: 7` | `created_by: "box1/solid"` + kind `FACE` + geometric filter |
| raw `occ_shape_t` pointer after free | `occ_entity_id_t` in a session registry |
| anonymous result of fuse | op id stack tags every registered result |

**Session responsibilities (this section):**

1. Own a **registry** of BREP entities (`TopoDS_Shape` by value) under monotonic `uint64` ids.  
2. Tag each registration with the **current operation id** (`begin_op` / `end_op` stack → nested `parent/child` paths).  
3. Answer **`created_by` prefix queries** filtered by entity kind.  
4. Hold optional **names** and **named frames** attached to entities (joint frames, nozzle CS, world planes).  
5. Expose pure-C **query algebra v0** helpers (created_by wrapper, kind filter, id-list intersection) for the IR selector evaluator.

This is intentionally a **thin history table**, not a full feature graph, not a Parasolid journal, and not a FeatureScript `Context`. The IR evaluator owns regeneration order; `occ_c` only remembers *what was created under which op id*.

---

## 2. Extended status codes

Patch / replace the baseline `occ_status_t` so session + math + capacity paths have dedicated codes. Existing numeric values for the first seven codes remain stable.

```c
// === file: occ_c.h  (enum fragment — replace existing occ_status_t)
typedef enum {
  OCC_OK                 = 0,
  OCC_ERR_NULL_ARG       = 1,
  OCC_ERR_INVALID_SHAPE  = 2,
  OCC_ERR_BOOLEAN        = 3,
  OCC_ERR_FILLET         = 4,
  OCC_ERR_IO             = 5,
  OCC_ERR_INDEX          = 6,
  OCC_ERR_EXCEPTION      = 7,
  /* Extended — session / query / math / capacity */
  OCC_ERR_NO_SESSION     = 8,
  OCC_ERR_UNKNOWN_OP     = 9,
  OCC_ERR_BAD_QUERY      = 10,
  OCC_ERR_CAPACITY       = 11,
  OCC_ERR_NOT_FOUND      = 12,
  OCC_ERR_MATH           = 13,
  OCC_ERR_UNSUPPORTED    = 14,
  /* Keep optional geom/frame codes if already shipped in baseline expansion */
  OCC_ERR_GEOM           = 15,
  OCC_ERR_FRAME          = 16,
  OCC_ERR_CLASH          = 17
} occ_status_t;
```

Callers: `NO_SESSION` null/destroyed session; `UNKNOWN_OP` stack mismatch; `BAD_QUERY` bad args;
`CAPACITY` overflow (partial fill); `NOT_FOUND` missing id/name; `MATH` bad frame; `UNSUPPORTED` unused reserve.

---

## 3. Header — `occ_c_session.h`

```c
// === file: occ_c_session.h
#ifndef OCC_C_SESSION_H_
#define OCC_C_SESSION_H_

#include "occ_c.h"

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* --------------------------------------------------------------------------
 * Opaque session handle.
 *
 * Lifetime: create → (ops / register / query)* → destroy.
 * Threading: not safe for concurrent mutation of the same session.
 * -------------------------------------------------------------------------- */
typedef struct occ_session_s occ_session_t;

/* Monotonic entity id. Valid ids are >= 1. 0 is never a live entity. */
typedef uint64_t occ_entity_id_t;

/* Entity kinds for history selectors (IR entity: body|face|edge|...). */
typedef enum {
  OCC_ENTITY_BODY     = 0,  /* solid / compsolid / compound-as-body */
  OCC_ENTITY_FACE     = 1,
  OCC_ENTITY_EDGE     = 2,
  OCC_ENTITY_VERTEX   = 3,
  OCC_ENTITY_WIRE     = 4,
  OCC_ENTITY_SHELL    = 5,
  OCC_ENTITY_SOLID    = 6,
  OCC_ENTITY_COMPOUND = 7,
  OCC_ENTITY_FRAME    = 8,  /* frame-only records (no BREP) */
  OCC_ENTITY_ANY      = 9   /* wildcard in queries */
} occ_entity_kind_t;

/* Full orthonormal frame POD (meters). Used by session attach_frame.
 * Compatible with 4x3 row layout: origin, x, y, z (each 3 doubles). */
typedef struct occ_session_frame_s {
  double origin[3];
  double x[3];
  double y[3];
  double z[3];
} occ_session_frame_t;

/* ============================ lifecycle ============================ */

/** Create an empty session. *out_session must be non-null. */
OCC_API int occ_session_create(occ_session_t** out_session);

/** Destroy session and free all registered shapes / maps. */
OCC_API int occ_session_destroy(occ_session_t* session);

/** Drop all entities, names, frames, op stack; keep session alive.
 *  World-plane ids are invalidated until ensure_world_planes is called again. */
OCC_API int occ_session_clear(occ_session_t* session);

/* ============================ op id stack ============================ */

/** Push op id string (copied). Nested begin/end supported.
 *  op_id_str must be non-empty. Typical: "box1", "box1/solid". */
OCC_API int occ_session_begin_op(occ_session_t* session, const char* op_id_str);

/** Pop op id. If op_id_str non-null, must match top of stack. */
OCC_API int occ_session_end_op(occ_session_t* session, const char* op_id_str);

/** Copy current top op id into buf (NUL-terminated). Empty stack → empty string. */
OCC_API int occ_session_current_op(occ_session_t* session, char* buf, int buflen);

/* ============================ shape registry ============================ */

/** Register a shape copy under a new entity id, tagged with current op id.
 *  Also expands faces / edges / vertices / wires / shells / solids as sibling
 *  entities with the same created_by tag (needed for created_by + kind FACE).
 *  *out_entity_id receives the id of the root shape.
 *  shape may be null only when registering a pure FRAME later via attach. */
OCC_API int occ_session_register_shape(occ_session_t* session,
                                       occ_shape_t shape,
                                       occ_entity_id_t* out_entity_id);

/** Register shape without topology expansion (root only). */
OCC_API int occ_session_register_shape_root_only(occ_session_t* session,
                                                 occ_shape_t shape,
                                                 occ_entity_id_t* out_entity_id);

/** Copy entity BREP into a new owned occ_shape_t handle (*out_shape).
 *  Caller must occ_shape_free(*out_shape). */
OCC_API int occ_session_get_shape(occ_session_t* session,
                                  occ_entity_id_t entity_id,
                                  occ_shape_t* out_shape);

/** Remove entity (and its attached frames). Names pointing here are cleared.
 *  Does not cascade-delete sub-entities registered during expansion. */
OCC_API int occ_session_release_entity(occ_session_t* session,
                                       occ_entity_id_t entity_id);

/** Number of live entities (all kinds). */
OCC_API int occ_session_entity_count(occ_session_t* session, int* out_count);

/* ============================ history selectors ============================ */

/** Find entities whose created_by string has op_id_prefix as prefix
 *  (strncmp) and whose kind matches (or kind == OCC_ENTITY_ANY).
 *  OCC_ENTITY_BODY matches SOLID, COMPSOLID-as-SOLID, and COMPOUND.
 *  Writes up to max ids into out_entity_ids; *out_count = total matches.
 *  If total > max, returns OCC_ERR_CAPACITY after filling max slots. */
OCC_API int occ_session_find_by_created_by(occ_session_t* session,
                                           const char* op_id_prefix,
                                           occ_entity_kind_t kind,
                                           occ_entity_id_t* out_entity_ids,
                                           int max,
                                           int* out_count);

/** Copy created_by op id for entity into buf. */
OCC_API int occ_session_entity_op_id(occ_session_t* session,
                                     occ_entity_id_t entity_id,
                                     char* buf,
                                     int buflen);

/** Return entity kind. */
OCC_API int occ_session_entity_kind(occ_session_t* session,
                                    occ_entity_id_t entity_id,
                                    occ_entity_kind_t* out_kind);

/* ============================ named tags ============================ */

/** Attach a unique name to an entity (replaces previous name for that entity).
 *  Names are unique in the session; reusing a name rebinds it. */
OCC_API int occ_session_set_name(occ_session_t* session,
                                 occ_entity_id_t entity_id,
                                 const char* name);

/** Look up entity by exact name. */
OCC_API int occ_session_find_by_name(occ_session_t* session,
                                     const char* name,
                                     occ_entity_id_t* out_entity_id);

/** Copy name for entity into buf (empty if unnamed). */
OCC_API int occ_session_entity_name(occ_session_t* session,
                                    occ_entity_id_t entity_id,
                                    char* buf,
                                    int buflen);

/* ============================ frames on entities ============================ */

/** Attach / replace a named frame on an entity. Axes must be non-degenerate.
 *  If entity_id == 0, creates a free FRAME entity tagged with current op. */
OCC_API int occ_session_attach_frame(occ_session_t* session,
                                     occ_entity_id_t entity_id,
                                     const char* name,
                                     const occ_session_frame_t* frame);

/** Fetch named frame attached to entity. */
OCC_API int occ_session_get_frame(occ_session_t* session,
                                  occ_entity_id_t entity_id,
                                  const char* name,
                                  occ_session_frame_t* out_frame);

/** Pack frame to 12 doubles: origin[3], x[3], y[3], z[3]. */
OCC_API int occ_session_frame_to_12(const occ_session_frame_t* f,
                                    double out12[12]);

/** Unpack 12 doubles into frame. */
OCC_API int occ_session_frame_from_12(const double m12[12],
                                      occ_session_frame_t* out);

/* ============================ document defaults (world planes) ============ */

/** Ensure world XY / YZ / ZX construction plane entities exist.
 *  Creates three thin rectangular faces + attached frames if missing. */
OCC_API int occ_session_ensure_world_planes(occ_session_t* session);

/** Entity ids for world planes (after ensure). */
OCC_API int occ_session_world_plane_xy(occ_session_t* session,
                                       occ_entity_id_t* out_id);
OCC_API int occ_session_world_plane_yz(occ_session_t* session,
                                       occ_entity_id_t* out_id);
OCC_API int occ_session_world_plane_zx(occ_session_t* session,
                                       occ_entity_id_t* out_id);

/* ============================ IR selector v0 query helpers ================= */

/** Wrapper: same as occ_session_find_by_created_by (IR entry point). */
OCC_API int occ_query_created_by(occ_session_t* session,
                                 const char* op_id_prefix,
                                 occ_entity_kind_t kind,
                                 occ_entity_id_t* out_entity_ids,
                                 int max,
                                 int* out_count);

/** Keep only ids whose live entity kind matches `kind` (ANY keeps all live). */
OCC_API int occ_query_filter_kind(occ_session_t* session,
                                  const occ_entity_id_t* in_ids,
                                  int n_in,
                                  occ_entity_kind_t kind,
                                  occ_entity_id_t* out_entity_ids,
                                  int max,
                                  int* out_count);

/** Sorted set intersection of two id lists (order of first occurrence in a). */
OCC_API int occ_query_intersect_ids(const occ_entity_id_t* a,
                                    int na,
                                    const occ_entity_id_t* b,
                                    int nb,
                                    occ_entity_id_t* out_entity_ids,
                                    int max,
                                    int* out_count);

/** Sorted set union (stable, unique). */
OCC_API int occ_query_union_ids(const occ_entity_id_t* a,
                                int na,
                                const occ_entity_id_t* b,
                                int nb,
                                occ_entity_id_t* out_entity_ids,
                                int max,
                                int* out_count);

/** Set difference a \\ b. */
OCC_API int occ_query_subtract_ids(const occ_entity_id_t* a,
                                   int na,
                                   const occ_entity_id_t* b,
                                   int nb,
                                   occ_entity_id_t* out_entity_ids,
                                   int max,
                                   int* out_count);

#ifdef __cplusplus
}
#endif

#endif /* OCC_C_SESSION_H_ */
```

---

## 4. Implementation — `occ_c_session.cc`

Complete translation unit. Requires `occ_c_internal.hxx` with `as_shape` / `to_handle` / `set_last` / `OCC_GUARD_*` / `REQ` / `g_last_error` as defined in the P0 literate API.

```cpp
// === file: occ_c_session.cc
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
```

---

## 5. Shared glue reminder (`occ_c_internal.hxx`)

Already specified in the main P0 literate API. Session code depends on it exactly as below (extract once if missing):

```cpp
// === file: occ_c_internal.hxx
// Private — not installed. Shared by all occ_c*.cc TUs.
#pragma once
#include "occ_c.h"
#include <string>
#include <cmath>
#include <TopoDS_Shape.hxx>
#include <Standard_Failure.hxx>

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

}  // namespace occ_c_detail

#define OCC_GUARD_BEGIN try {
#define OCC_GUARD_END                                                         \
  }                                                                           \
  catch (Standard_Failure & e) {                                              \
    occ_c_detail::set_last(e.GetMessageString() ? e.GetMessageString()        \
                                                : "OCCT failure");            \
    return OCC_ERR_EXCEPTION;                                                 \
  }                                                                           \
  catch (std::exception & e) {                                                \
    occ_c_detail::set_last(e.what());                                         \
    return OCC_ERR_EXCEPTION;                                                 \
  }                                                                           \
  catch (...) {                                                               \
    occ_c_detail::set_last("unknown exception");                              \
    return OCC_ERR_EXCEPTION;                                                 \
  }

#define REQ(cond, code)             \
  do {                              \
    if (!(cond)) return (code);     \
  } while (0)
```

If baseline `occ_last_error` is not yet wired:

```cpp
// fragment for occ_c.cc
const char* occ_last_error(void) {
  return occ_c_detail::g_last_error.c_str();
}
```

---

## 6. Pedagogy — IR `created_by: box1/solid` after extrude

### 6.1 Document fragment

```yaml
- id: box1/sketch
  op: MakePlaneRect   # or Sketch2D → face
  plane: world_xy
  width_m: 0.10
  height_m: 0.06

- id: box1/solid
  op: Extrude
  profile: { created_by: "box1/sketch", entity: face }
  extent: { kind: blind, depth_m: 0.08 }

- id: holes1
  op: DrillHole
  target: { created_by: "box1/solid", entity: body }
  # later: on: { created_by: "box1/solid", entity: face, filter: max_z }
```

### 6.2 Host evaluation sequence (C)

```c
occ_session_t* S = NULL;
occ_session_create(&S);
occ_session_ensure_world_planes(S);

/* --- box1/sketch --- */
occ_session_begin_op(S, "box1/sketch");
occ_shape_t sketch_face = NULL;
/* e.g. occ_make_plane_rect(...) → sketch_face */
occ_entity_id_t sketch_id = 0;
occ_session_register_shape(S, sketch_face, &sketch_id);
occ_session_set_name(S, sketch_id, "box1_sketch_face");
occ_session_end_op(S, "box1/sketch");

/* Resolve profile selector for extrude */
occ_entity_id_t prof_ids[32];
int n_prof = 0;
occ_query_created_by(S, "box1/sketch", OCC_ENTITY_FACE, prof_ids, 32, &n_prof);
/* n_prof >= 1; take prof_ids[0], get_shape → extrude */

/* --- box1/solid --- */
occ_session_begin_op(S, "box1/solid");
occ_shape_t solid = NULL;
/* occ_extrude(profile_shape, 0,0,0.08, &solid); */
occ_entity_id_t solid_id = 0;
occ_session_register_shape(S, solid, &solid_id);
/* expands faces/edges/vertices with created_by == "box1/solid" */
occ_session_end_op(S, "box1/solid");

/* --- holes1 target: created_by box1/solid, entity body --- */
occ_entity_id_t body_ids[8];
int n_body = 0;
occ_query_created_by(S, "box1/solid", OCC_ENTITY_BODY, body_ids, 8, &n_body);
/* BODY matches the SOLID root */

/* faces of that extrude for geometric filters */
occ_entity_id_t face_ids[64];
int n_face = 0;
occ_query_created_by(S, "box1/solid", OCC_ENTITY_FACE, face_ids, 64, &n_face);

/* algebra: intersect two independent queries when IR says so */
occ_entity_id_t a[16], b[16], ab[16];
int na = 0, nb = 0, nab = 0;
occ_query_created_by(S, "box1", OCC_ENTITY_FACE, a, 16, &na);   /* prefix */
occ_query_created_by(S, "box1/solid", OCC_ENTITY_ANY, b, 16, &nb);
occ_query_intersect_ids(a, na, b, nb, ab, 16, &nab);

occ_session_destroy(S);
```

### 6.3 Mapping table

| IR selector | Session call |
|-------------|--------------|
| `{ created_by: "box1/solid", entity: body }` | `occ_query_created_by(S, "box1/solid", OCC_ENTITY_BODY, …)` |
| `{ created_by: "box1/solid", entity: face }` | `… OCC_ENTITY_FACE …` |
| `{ created_by: "box1", entity: face }` | prefix match hits `box1/sketch` and `box1/solid` faces |
| `{ name: "world_xy" }` | `occ_session_find_by_name(S, "world_xy", &id)` |
| set intersection | `occ_query_intersect_ids` |
| kind refine after historical query | `occ_query_filter_kind` |

### 6.4 Nested ops

```c
occ_session_begin_op(S, "housing");
  occ_session_begin_op(S, "housing/extrude");
    /* register → created_by == "housing/extrude" */
  occ_session_end_op(S, "housing/extrude");
  occ_session_begin_op(S, "housing/boolean");
    /* register → created_by == "housing/boolean" */
  occ_session_end_op(S, "housing/boolean");
occ_session_end_op(S, "housing");
/* prefix "housing" matches both children; exact "housing/boolean" is precise */
```

The IR evaluator is responsible for choosing **leaf** ids for creation tags and **prefix** queries for “everything under this feature”.

### 6.5 What is *not* stored

- Parameter values / feature definitions (IR document owns them).  
- Rollback journal of OCCT kernels (re-eval from IR instead).  
- Automatic parent/child topology links beyond same `created_by` string.  
- Multi-threaded mutation of one session.

---

## 7. Smoke test (pure C conceptual)

```c
// === file: examples/c_api_session_smoke.c
#include "occ_c.h"
#include "occ_c_session.h"
#include <stdio.h>
#include <string.h>

int main(void) {
  occ_session_t* S = NULL;
  if (occ_session_create(&S) != OCC_OK) return 1;

  if (occ_session_ensure_world_planes(S) != OCC_OK) {
    fprintf(stderr, "planes: %s\n", occ_last_error());
    return 1;
  }
  occ_entity_id_t xy = 0;
  occ_session_world_plane_xy(S, &xy);
  printf("world_xy entity=%llu\n", (unsigned long long)xy);

  /* Fake: make a box with baseline API then register under op id */
  occ_shape_t box = NULL;
  if (occ_make_box(0.1, 0.06, 0.08, &box) != OCC_OK) {
    fprintf(stderr, "box: %s\n", occ_last_error());
    return 1;
  }

  occ_session_begin_op(S, "box1/solid");
  occ_entity_id_t root = 0;
  if (occ_session_register_shape(S, box, &root) != OCC_OK) {
    fprintf(stderr, "reg: %s\n", occ_last_error());
    return 1;
  }
  occ_session_set_name(S, root, "box1_body");
  occ_session_end_op(S, "box1/solid");

  char opbuf[128];
  occ_session_entity_op_id(S, root, opbuf, (int)sizeof(opbuf));
  printf("root id=%llu created_by=%s\n", (unsigned long long)root, opbuf);

  occ_entity_id_t faces[128];
  int nf = 0;
  int st = occ_query_created_by(S, "box1/solid", OCC_ENTITY_FACE, faces, 128, &nf);
  if (st != OCC_OK && st != OCC_ERR_CAPACITY) {
    fprintf(stderr, "query: %s\n", occ_last_error());
    return 1;
  }
  printf("faces created_by box1/solid: %d\n", nf);

  occ_entity_id_t bodies[8];
  int nb = 0;
  occ_query_created_by(S, "box1/solid", OCC_ENTITY_BODY, bodies, 8, &nb);
  printf("bodies: %d (expect 1)\n", nb);

  occ_entity_id_t by_name = 0;
  if (occ_session_find_by_name(S, "box1_body", &by_name) != OCC_OK ||
      by_name != root) {
    fprintf(stderr, "name lookup failed\n");
    return 1;
  }

  occ_session_frame_t tcp;
  memset(&tcp, 0, sizeof(tcp));
  tcp.x[0] = 1; tcp.y[1] = 1; tcp.z[2] = 1;
  tcp.origin[2] = 0.08;
  if (occ_session_attach_frame(S, root, "tcp", &tcp) != OCC_OK) {
    fprintf(stderr, "frame: %s\n", occ_last_error());
    return 1;
  }
  occ_session_frame_t got;
  occ_session_get_frame(S, root, "tcp", &got);
  printf("tcp origin z=%.3f m\n", got.origin[2]);

  /* algebra */
  occ_entity_id_t allf[128], only_root_prefix[128], inter[128];
  int n1 = 0, n2 = 0, n3 = 0;
  occ_query_created_by(S, "box1", OCC_ENTITY_FACE, allf, 128, &n1);
  occ_query_created_by(S, "box1/solid", OCC_ENTITY_FACE, only_root_prefix, 128,
                       &n2);
  occ_query_intersect_ids(allf, n1, only_root_prefix, n2, inter, 128, &n3);
  printf("intersect faces=%d\n", n3);

  occ_shape_t copy = NULL;
  occ_session_get_shape(S, root, &copy);
  occ_shape_free(copy);
  occ_shape_free(box);
  occ_session_destroy(S);
  printf("session smoke ok\n");
  return 0;
}
```

---

## 8. IR mapping + build checklist

| IR / host | C |
|-----------|---|
| studio / session | `occ_session_t` |
| feature begin/end | `begin_op` / `end_op` |
| publish body | `register_shape` |
| `created_by` | `occ_query_created_by` |
| named entity / frame | `set_name` / `attach_frame` |
| world planes | `ensure_world_planes` |
| query ∩ ∪ \ | `intersect` / `union` / `subtract_ids` |

Extract: patch `occ_status_t`; add session sources to `//api:occ_c_lib`; export Wasm symbols;
include `occ_c_internal.hxx`. Goldens: prefix `a` hits `a/b`; `end_op` mismatch → `UNKNOWN_OP`;
`max=0` → `CAPACITY` with correct `out_count`; name rebind steals. Not a FeatureScript `Context`.

---

## 9. Design invariants

1. Entity id = monotonic `uint64` from 1; not reused after `clear` (counter continues).  
2. Shapes stored as `TopoDS_Shape` by value; `created_by` = op-stack top at register.  
3. Prefix match = `strncmp`; prefer IR ids with `/` so `box1` ≠ `box10`.  
4. `BODY` matches solid-like kinds; session mutation is single-threaded.  
5. World planes = FACE entities `world_xy` / `world_yz` / `world_zx` + frame `"cs"`.

---

*End of literate section 01 — session / history / created_by.*
