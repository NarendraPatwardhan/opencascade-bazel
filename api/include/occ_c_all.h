// === file: api/include/occ_c_all.h
// One-stop include for host / Wasm / demos needing the full expanded surface.
// Order matters: frames before route/trsf (occ_frame_t).
#pragma once

#include "occ_c.h"
#include "occ_c_session.h"
#include "occ_c_construct.h"
#include "occ_c_frames.h"
#include "occ_c_trsf.h"
#include "occ_c_route.h"
#include "occ_c_pattern.h"
#include "occ_c_hole.h"
#include "occ_c_boolean_ext.h"
#include "occ_c_query.h"
#include "occ_c_sweep_ext.h"
