-- @cad query helpers — measures / clash via IR tape when shapes are IR handles
-- Usage: local query = require("query")

local tools = require("tools")

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

local function is_ir(id: any): boolean
	local ok, t = pcall(function()
		return require("ir.tape")
	end)
	return ok and t ~= nil and t.is_handle(id)
end

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

local function host_id(id: ShapeId): number
	if type(id) == "number" then
		return id
	end
	if is_ir(id) then
		return tape().eval_to_shape(id :: string)
	end
	error("query: expected IR handle or host id")
end

function query.clash(a: ShapeId, b: ShapeId, clearance: number?): any
	if is_ir(a) and is_ir(b) then
		local mid = tape().query_clash(a :: string, b :: string, clearance)
		local pod = tape().eval_measure(mid)
		-- Match host clash shape for smokes
		return {
			status = pod.status_code or 0,
			name = pod.status or "unknown",
			distance = pod.distance,
		}
	end
	return call("clash", {
		a = host_id(a),
		b = host_id(b),
		clearance = clearance or 0,
	})
end

function query.distance(a: ShapeId, b: ShapeId): any
	return call("distance", { a = host_id(a), b = host_id(b) })
end

function query.volume(id: ShapeId): number
	if is_ir(id) then
		local mid = tape().query_geom(id :: string, "volume")
		local pod = tape().eval_measure(mid)
		return pod.volume
	end
	return call("volume", { id = host_id(id) }).volume
end

function query.bbox(id: ShapeId): any
	if is_ir(id) then
		local mid = tape().query_geom(id :: string, "bbox")
		local pod = tape().eval_measure(mid)
		return pod.bbox
	end
	return call("bbox", { id = host_id(id) }).bbox
end

function query.mesh_stats(id: ShapeId, deflection: number?): any
	return call("mesh_stats", { id = host_id(id), deflection = deflection or 0.1 })
end

function query.mass_properties(id: ShapeId, density: number?): any
	return call("mass_properties", { id = host_id(id), density = density or 1 })
end

return query
