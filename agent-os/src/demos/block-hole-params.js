/**
 * Flange plate demo — params are ordinary Luau locals with optional
 * trailing annotations (CADAM-style). No giant --[[params]] block.
 *
 *   local width = 40 -- [16:0.5:120] mm
 *
 * Host resolveParams() static-analyzes header locals; execute rewrites
 * literals to live store values and still injects `params` for advanced use.
 */

/** Optional seed (demo migration gaps only). */
/** @type {import('../params/types.js').Parameter[]} */
export const BLOCK_HOLE_SEED = [];

/** @deprecated */
export const BLOCK_HOLE_PARAMS = BLOCK_HOLE_SEED;

/**
 * Clean flange source — what an end user should see and write.
 */
export const FLANGE_SOURCE = `\
-- Flange plate: solid.* always → IR → mesh
local solid = require("solid")

-- [Size]
local width = 40 -- [16:0.5:120] mm
local depth = 40 -- [16:0.5:120] mm
local height = 8 -- [2:0.5:40] mm

-- [Boss]
local boss_h = 10 -- [1:0.5:40] mm
local boss_r = 12 -- [3:0.5:50] mm

-- [Bore]
local hole_r = 5 -- [0.5:0.1:25] mm

-- [Bolts]
local bolt_n = 4 -- [2:1:12]
local bolt_r = 2 -- [0.5:0.1:8] mm
local pcd = 28 -- [8:0.5:100] mm

-- [Pose]
local yaw = 0 -- [-180:1:180] ° xform

-- [Display]
local show_grid = true -- view

local step = (2 * math.pi) / math.max(2, math.min(12, math.floor(bolt_n + 0.5)))
local through_h = height + boss_h + 4
local z_tool = -2

local base = solid.box({
	dx = width,
	dy = depth,
	dz = height,
	corner = "centered_xy_bottom",
})

local boss = solid.cylinder({
	radius = boss_r,
	height = boss_h,
	origin = { 0, 0, height },
	axis = { 0, 0, 1 },
})
local body = solid.fuse(base, boss)

local bore = solid.cylinder({
	radius = hole_r,
	height = through_h,
	origin = { 0, 0, z_tool },
	axis = { 0, 0, 1 },
})
body = solid.cut(body, bore)

local bolt = solid.cylinder({
	radius = bolt_r,
	height = through_h,
	origin = { pcd / 2, 0, z_tool },
	axis = { 0, 0, 1 },
})
local bolts = solid.pattern_polar(bolt, {
	origin = { 0, 0, 0 },
	axis = { 0, 0, 1 },
	angle_step = step,
	count = math.max(2, math.min(12, math.floor(bolt_n + 0.5))),
})
local part = solid.cut(body, bolts)

solid.finish(part, { name = "flange_plate" })
`;

/**
 * @param {Record<string, any>} [_values]
 */
export function blockHoleSource(_values) {
  return FLANGE_SOURCE;
}
