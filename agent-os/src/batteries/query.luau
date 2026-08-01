-- @cad query helpers — measures, clash, mesh stats
-- Usage: local query = require("query")

local tools = require("tools")

export type ShapeId = number

local query = {}

local function call(op: string, args: { [string]: any }): any
	local payload: { [string]: any } = {}
	for k, v in pairs(args) do
		payload[k] = v
	end
	payload.op = op
	local res = tools.call("host.org.main.cad.call", payload)
	if type(res) ~= "table" then
		error("cad.call returned non-table")
	end
	if res.ok == false then
		local msg = "cad.call failed"
		if type(res.err) == "table" and (res.err :: any).message then
			msg = (res.err :: any).message
		elseif type(res.err) == "string" then
			msg = res.err
		end
		error(msg)
	end
	return res.data
end

function query.clash(a: ShapeId, b: ShapeId, clearance: number?): any
	return call("clash", { a = a, b = b, clearance = clearance or 0 })
end

function query.distance(a: ShapeId, b: ShapeId): any
	return call("distance", { a = a, b = b })
end

function query.volume(id: ShapeId): number
	return call("volume", { id = id }).volume
end

function query.bbox(id: ShapeId): any
	return call("bbox", { id = id }).bbox
end

--- Mesh stats only (vertex/index counts + optional bbox/volume). No full mesh payload.
function query.mesh_stats(id: ShapeId, deflection: number?): any
	return call("mesh_stats", { id = id, deflection = deflection or 0.1 })
end

--- Density-scaled mass properties (default density=1 → mass ≈ volume).
function query.mass_properties(id: ShapeId, density: number?): any
	return call("mass_properties", { id = id, density = density or 1 })
end

return query
