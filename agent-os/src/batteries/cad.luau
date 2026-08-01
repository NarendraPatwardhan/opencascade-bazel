-- @cad aggregator — Path A/B author surface (SYSTEM.md §5 dual-goal seed)
-- Usage:
--   local cad = require("cad")
--   local root = cad.solid.box({ dx = 1, dy = 1, dz = 1 })
--   local res = cad.ir.run_demo(doc)
--
-- Seed modules only: solid / route / frames / query / ir.
-- Full map (units, piping, asm, holes, structure, io, …) may re-export later.

local cad = {
	solid = require("solid"),
	route = require("route"),
	frames = require("frames"),
	query = require("query"),
	ir = require("ir"),
}

return cad
