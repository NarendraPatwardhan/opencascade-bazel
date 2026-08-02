-- @cad query helpers — measures / clash always via IR tape.
-- Usage: local query = require("query")
--
-- Policy: query.* measures use tape.query_* + tape.eval_measure. Shape args
-- must be IR tape handles (string). Never host call for geometry queries.

export type ShapeId = number | string

local query = {}

local function tape(): any
	local ok, t = pcall(function()
		return require("ir.tape")
	end)
	if not ok or t == nil then
		error('query: require("ir.tape") unavailable')
	end
	t.ensure("session")
	return t
end

--- Require an IR tape handle for measures (never host geometry call).
local function ir_id(id: ShapeId, where: string): string
	if type(id) == "string" then
		return id
	end
	error(
		where
			.. ": expected IR tape handle (string); query.* measures are tape-only — do not realize mid-chain"
	)
end

function query.clash(a: ShapeId, b: ShapeId, clearance: number?): any
	local mid = tape().query_clash(ir_id(a, "query.clash"), ir_id(b, "query.clash"), clearance)
	local pod = tape().eval_measure(mid)
	return {
		status = pod.status_code or 0,
		name = pod.status or "unknown",
		distance = pod.distance,
	}
end

function query.distance(a: ShapeId, b: ShapeId): any
	-- QueryClash with distance; no standalone Distance IR op in v0.
	local mid = tape().query_clash(ir_id(a, "query.distance"), ir_id(b, "query.distance"), 0)
	local pod = tape().eval_measure(mid)
	return { distance = pod.distance }
end

function query.volume(id: ShapeId): number
	local mid = tape().query_geom(ir_id(id, "query.volume"), "volume")
	local pod = tape().eval_measure(mid)
	return pod.volume
end

function query.bbox(id: ShapeId): any
	local mid = tape().query_geom(ir_id(id, "query.bbox"), "bbox")
	local pod = tape().eval_measure(mid)
	return pod.bbox
end

function query.mesh_stats(id: ShapeId, deflection: number?): any
	local mid = tape().mesh_stats(ir_id(id, "query.mesh_stats"), deflection or 0.1)
	local pod = tape().eval_measure(mid)
	return {
		vertexCount = pod.vertexCount,
		indexCount = pod.indexCount,
		volume = pod.volume,
		deflection = pod.deflection,
	}
end

function query.mass_properties(id: ShapeId, density: number?): any
	local mid = tape().mass_props(ir_id(id, "query.mass_properties"), density or 1)
	local pod = tape().eval_measure(mid)
	return {
		mass = pod.mass,
		com = pod.com,
		inertia = pod.inertia,
		density = pod.density,
	}
end

return query
