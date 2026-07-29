-- @cad solid helpers — host geometry via require("tools") + cad.call
--
-- Runtime: bare require("tools") / require("json") resolve to AgentOS builtins.
-- Analyze: worker stages this file next to typed stubs and rewrites those two
-- requires to relative paths so luau-analyze can follow the module graph.

local tools = require("tools")
local json = require("json")

export type ShapeId = number

export type BoxOpts = {
	dx: number?,
	dy: number?,
	dz: number?,
	x: number?,
	y: number?,
	z: number?,
}

export type CylinderOpts = {
	radius: number?,
	height: number?,
	origin: { number }?,
	axis: { number }?,
	cx: number?,
	cy: number?,
	cz: number?,
}

export type SphereOpts = {
	radius: number?,
	origin: { number }?,
	cx: number?,
	cy: number?,
	cz: number?,
}

export type TranslateOpts = {
	dx: number?,
	dy: number?,
	dz: number?,
}

export type FilletOpts = {
	radius: number?,
}

export type FinishExtra = {
	name: string?,
	[string]: any,
}

local solid = {}

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

function solid.box(opts: BoxOpts?): ShapeId
	local o: BoxOpts = if opts then opts else {}
	local data = call("make_box", {
		dx = o.dx or o.x or 10,
		dy = o.dy or o.y or 10,
		dz = o.dz or o.z or 10,
	})
	return data.shapeId
end

function solid.cylinder(opts: CylinderOpts?): ShapeId
	local o: CylinderOpts = if opts then opts else {}
	local origin = o.origin or {}
	local axis = o.axis or { 0, 0, 1 }
	local data = call("make_cylinder", {
		cx = origin[1] or o.cx or 0,
		cy = origin[2] or o.cy or 0,
		cz = origin[3] or o.cz or 0,
		ax = axis[1] or 0,
		ay = axis[2] or 0,
		az = axis[3] or 1,
		radius = o.radius or 1,
		height = o.height or 1,
	})
	return data.shapeId
end

function solid.sphere(opts: SphereOpts?): ShapeId
	local o: SphereOpts = if opts then opts else {}
	local origin = o.origin or {}
	local data = call("make_sphere", {
		cx = origin[1] or o.cx or 0,
		cy = origin[2] or o.cy or 0,
		cz = origin[3] or o.cz or 0,
		radius = o.radius or 1,
	})
	return data.shapeId
end

function solid.fuse(a: ShapeId, b: ShapeId): ShapeId
	return call("fuse", { a = a, b = b }).shapeId
end

function solid.cut(a: ShapeId, b: ShapeId): ShapeId
	return call("cut", { a = a, b = b }).shapeId
end

function solid.translate(id: ShapeId, opts: TranslateOpts?): ShapeId
	local o: TranslateOpts = if opts then opts else {}
	return call("translate", {
		id = id,
		dx = o.dx or 0,
		dy = o.dy or 0,
		dz = o.dz or 0,
	}).shapeId
end

function solid.fillet_all(id: ShapeId, opts: FilletOpts?): ShapeId
	local o: FilletOpts = if opts then opts else {}
	return call("fillet_all", { id = id, radius = o.radius or 0.5 }).shapeId
end

function solid.volume(id: ShapeId): number
	return call("volume", { id = id }).volume
end

function solid.bbox(id: ShapeId): any
	return call("bbox", { id = id }).bbox
end

-- Emit a single JSON result line the host can parse.
function solid.finish(rootId: ShapeId, extra: FinishExtra?): ShapeId
	local payload: { [string]: any } = {
		schema = 1,
		root = rootId,
	}
	if type(extra) == "table" then
		for k, v in pairs(extra) do
			payload[k] = v
		end
	end
	print("__OCC_CAD_RESULT__" .. json.encode(payload))
	return rootId
end

return solid
