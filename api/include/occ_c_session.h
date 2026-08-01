/*
 * occ_c_session.h — optional history table on top of freestanding shapes.
 *
 * Why this exists: IR / parametric reselect needs stable identities
 * (created_by, names, frames) after many ops. Freestanding occ_shape_t alone
 * is a raw BREP pointer with no history.
 *
 * Model:
 *   create session → begin_op("box1") → make freestanding shape →
 *   register_shape (COPIES BREP into the table; you still own the input) →
 *   end_op → query by created_by / name → get_shape (new freestanding handle)
 *
 * Entity ids are uint64 ≥ 1. Register expands faces/edges/… as siblings with
 * the same created_by so selectors can re-find them.
 *
 * Session is NOT a mate solver and NOT a catalog. It only stores geometry and
 * tags. Threading: one session, one thread for mutation.
 */
#ifndef OCC_C_SESSION_H_
#define OCC_C_SESSION_H_

#include "occ_c.h"
#include "occ_c_frames.h"

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* --------------------------------------------------------------------------
 * Opaque session handle
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


/* ---- frame POD conversion (modeling ↔ session array layout) ---- */
OCC_API int occ_session_frame_from_frame(const occ_frame_t* f, occ_session_frame_t* out);
OCC_API int occ_session_frame_to_frame(const occ_session_frame_t* sf, occ_frame_t* out);

#ifdef __cplusplus
}
#endif

#endif /* OCC_C_SESSION_H_ */
