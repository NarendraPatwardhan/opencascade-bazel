-- Flange-style plate via IR (same recipe as the main browser demo).
-- Base + boss + center bore + 4-bolt polar pattern → ir.run_demo.
package.path = "/opt/cad/?.luau;/opt/cad/?/init.luau;" .. package.path
local ir = require("ir")

-- SI meters (40×40×8 mm base, 10 mm boss, 5 mm bore, PCD 28 mm, M4 holes)
local w, d, h = 0.040, 0.040, 0.008
local boss_r, boss_h = 0.012, 0.010
local hole_r = 0.005
local bolt_r, pcd, bolt_n = 0.002, 0.028, 4
local step = (2 * math.pi) / bolt_n
local through_h = h + boss_h + 0.004
local z_tool = -0.002

local doc = {
	ir_schema = "cad.ir/v0",
	id = "example_flange_plate",
	version = "0.1.0",
	units = { length = "meter", angle = "radian", store = "SI" },
	params = {},
	ops = {
		{
			id = "base",
			op = "PrimBox",
			params = {
				dx = w,
				dy = d,
				dz = h,
				corner = "centered_xy_bottom",
			},
		},
		{
			id = "boss",
			op = "PrimCylinder",
			params = {
				radius = boss_r,
				height = boss_h,
				origin = { 0, 0, h },
				axis = { 0, 0, 1 },
			},
		},
		{
			id = "body",
			op = "BoolCombine",
			params = { mode = "union" },
			refs = {
				target = { created_by = "base", entity = "body" },
				tools = { { created_by = "boss", entity = "body" } },
			},
		},
		{
			id = "bore_tool",
			op = "PrimCylinder",
			params = {
				radius = hole_r,
				height = through_h,
				origin = { 0, 0, z_tool },
				axis = { 0, 0, 1 },
			},
		},
		{
			id = "with_bore",
			op = "BoolCombine",
			params = { mode = "subtract" },
			refs = {
				target = { created_by = "body", entity = "body" },
				tools = { { created_by = "bore_tool", entity = "body" } },
			},
		},
		{
			id = "bolt_seed",
			op = "PrimCylinder",
			params = {
				radius = bolt_r,
				height = through_h,
				origin = { pcd / 2, 0, z_tool },
				axis = { 0, 0, 1 },
			},
		},
		{
			id = "bolt_pattern",
			op = "PatternPolar",
			params = {
				origin = { 0, 0, 0 },
				axis = { 0, 0, 1 },
				angle_step = step,
				count = bolt_n,
			},
			refs = {
				shape = { created_by = "bolt_seed", entity = "body" },
			},
		},
		{
			id = "part",
			op = "BoolCombine",
			params = { mode = "subtract" },
			refs = {
				target = { created_by = "with_bore", entity = "body" },
				tools = { { created_by = "bolt_pattern", entity = "body" } },
			},
		},
	},
	meta = {
		author = "example",
		lib_versions = { cad_ir = "0.1.0", occ_c = "7.9.3-api", occt = "7.9.3" },
		kernel_version = "7.9.3",
		strict = true,
	},
}

local res = ir.run_demo(doc, { root = "part" })
if type(res) == "table" and res.ok == false then
	local e = res.error or {}
	error(tostring(e.message or e.code or "IR eval failed"))
end
