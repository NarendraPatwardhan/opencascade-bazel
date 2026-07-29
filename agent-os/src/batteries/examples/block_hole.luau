-- Box with cylindrical hole (boolean cut)
package.path = "/opt/cad/?.luau;" .. package.path
local solid = require("solid")

local block = solid.box({ dx = 20, dy = 20, dz = 12 })
local drill = solid.cylinder({
	radius = 4,
	height = 16,
	origin = { 10, 10, -2 },
	axis = { 0, 0, 1 },
})
local part = solid.cut(block, drill)
solid.finish(part, { name = "block_hole" })
