-- @cad aggregator — solid/route/frames/query/ir (SYSTEM.md §5 seed)
-- Usage:
--   local cad = require("cad")
--   local root = cad.solid.box({ dx = 1, dy = 1, dz = 1 })
--   local res = cad.ir.run_demo(doc)
--
-- Batteries author through IR tape only. Seed modules: solid / route / frames / query / ir.
-- Full map (units, piping, asm, holes, structure, io, …) may re-export later.

local cad = {
	solid = require("solid"),
	route = require("route"),
	frames = require("frames"),
	query = require("query"),
	ir = require("ir"),
}

return cad
