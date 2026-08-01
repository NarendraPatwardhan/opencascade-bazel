/*
 * occ_c_all.h — full public C surface in dependency order.
 *
 * Use this when you need session, frames, route/pipe, patterns, or measure
 * selectors. For a minimal freestanding geometry client, occ_c.h alone is
 * enough.
 *
 * Include order matters: frames define occ_frame_t before route/trsf use it.
 * Modules never re-include each other circularly through occ_c.h (baseline
 * stays free of module includes).
 *
 * Learning path for dual-goal products:
 *   1. occ_c.h          — box, cut, measure, STEP
 *   2. occ_c_frames.h   — SE(3) pose POD + place
 *   3. occ_c_route.h    — pipe centerlines + annulus solids
 *   4. occ_c_session.h  — history / created_by for reselect
 *   5. occ_c_query.h    — clash / distance / selectors
 * Implementation walk-throughs live as comments in the matching .cc files.
 */
#pragma once

#include "occ_c.h"
#include "occ_c_session.h"
#include "occ_c_construct.h"
#include "occ_c_frames.h"
#include "occ_c_trsf.h"
#include "occ_c_route.h"
#include "occ_c_pattern.h"
#include "occ_c_hole.h"
#include "occ_c_boolean.h"
#include "occ_c_query.h"
#include "occ_c_sweep.h"

