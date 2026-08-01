-- Flange plate via clean Luau → IR tape (same as main browser demo).
package.path = "/opt/cad/?.luau;/opt/cad/?/init.luau;" .. package.path
local solid = require("solid")

solid.use_ir(true)

local w, d, h = 0.040, 0.040, 0.008
local boss_r, boss_h = 0.012, 0.010
local hole_r = 0.005
local bolt_r, pcd, bolt_n = 0.002, 0.028, 4
local step = (2 * math.pi) / bolt_n
local through_h = h + boss_h + 0.004
local z_tool = -0.002

local base = solid.box({
	dx = w,
	dy = d,
	dz = h,
	corner = "centered_xy_bottom",
})
local boss = solid.cylinder({
	radius = boss_r,
	height = boss_h,
	origin = { 0, 0, h },
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
	count = bolt_n,
})
local part = solid.cut(body, bolts)

solid.finish(part, { name = "flange_plate" })
