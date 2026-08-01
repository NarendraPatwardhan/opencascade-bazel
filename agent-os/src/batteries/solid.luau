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

export type ConeOpts = {
	r1: number?,
	r2: number?,
	radius1: number?,
	radius2: number?,
	height: number?,
	origin: { number }?,
	axis: { number }?,
	cx: number?,
	cy: number?,
	cz: number?,
}

export type TorusOpts = {
	major_r: number?,
	minor_r: number?,
	majorR: number?,
	minorR: number?,
	R: number?,
	r: number?,
	origin: { number }?,
	axis: { number }?,
	cx: number?,
	cy: number?,
	cz: number?,
}

export type TranslateOpts = {
	dx: number?,
	dy: number?,
	dz: number?,
}

export type RotateOpts = {
	px: number?,
	py: number?,
	pz: number?,
	ax: number?,
	ay: number?,
	az: number?,
	angle: number?,
	angle_rad: number?,
	origin: { number }?,
	axis: { number }?,
}

export type ScaleOpts = {
	cx: number?,
	cy: number?,
	cz: number?,
	factor: number?,
	origin: { number }?,
}

export type MirrorOpts = {
	px: number?,
	py: number?,
	pz: number?,
	nx: number?,
	ny: number?,
	nz: number?,
	point: { number }?,
	normal: { number }?,
}

export type ExtrudeOpts = {
	dx: number?,
	dy: number?,
	dz: number?,
}

export type FilletOpts = {
	radius: number?,
}

export type PatternLinearOpts = {
	dx: number?,
	dy: number?,
	dz: number?,
	count: number?,
}

export type PatternPolarOpts = {
	px: number?,
	py: number?,
	pz: number?,
	ax: number?,
	ay: number?,
	az: number?,
	angle_step: number?,
	angle_step_rad: number?,
	count: number?,
	origin: { number }?,
	axis: { number }?,
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

function solid.cone(opts: ConeOpts?): ShapeId
	local o: ConeOpts = if opts then opts else {}
	local origin = o.origin or {}
	local axis = o.axis or { 0, 0, 1 }
	local data = call("make_cone", {
		cx = origin[1] or o.cx or 0,
		cy = origin[2] or o.cy or 0,
		cz = origin[3] or o.cz or 0,
		ax = axis[1] or 0,
		ay = axis[2] or 0,
		az = axis[3] or 1,
		r1 = o.r1 or o.radius1 or 1,
		r2 = o.r2 or o.radius2 or 0,
		height = o.height or 1,
	})
	return data.shapeId
end

function solid.torus(opts: TorusOpts?): ShapeId
	local o: TorusOpts = if opts then opts else {}
	local origin = o.origin or {}
	local axis = o.axis or { 0, 0, 1 }
	local data = call("make_torus", {
		cx = origin[1] or o.cx or 0,
		cy = origin[2] or o.cy or 0,
		cz = origin[3] or o.cz or 0,
		ax = axis[1] or 0,
		ay = axis[2] or 0,
		az = axis[3] or 1,
		major_r = o.major_r or o.majorR or o.R or 2,
		minor_r = o.minor_r or o.minorR or o.r or 0.5,
	})
	return data.shapeId
end

function solid.fuse(a: ShapeId, b: ShapeId): ShapeId
	return call("fuse", { a = a, b = b }).shapeId
end

function solid.cut(a: ShapeId, b: ShapeId): ShapeId
	return call("cut", { a = a, b = b }).shapeId
end

function solid.intersect(a: ShapeId, b: ShapeId): ShapeId
	return call("intersect", { a = a, b = b }).shapeId
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

function solid.rotate(id: ShapeId, opts: RotateOpts?): ShapeId
	local o: RotateOpts = if opts then opts else {}
	local origin = o.origin or {}
	local axis = o.axis or {}
	return call("rotate", {
		id = id,
		px = origin[1] or o.px or 0,
		py = origin[2] or o.py or 0,
		pz = origin[3] or o.pz or 0,
		ax = axis[1] or o.ax or 0,
		ay = axis[2] or o.ay or 0,
		az = axis[3] or o.az or 1,
		angle = o.angle or o.angle_rad or 0,
	}).shapeId
end

function solid.scale(id: ShapeId, opts: ScaleOpts?): ShapeId
	local o: ScaleOpts = if opts then opts else {}
	local origin = o.origin or {}
	return call("scale", {
		id = id,
		cx = origin[1] or o.cx or 0,
		cy = origin[2] or o.cy or 0,
		cz = origin[3] or o.cz or 0,
		factor = o.factor or 1,
	}).shapeId
end

function solid.mirror(id: ShapeId, opts: MirrorOpts?): ShapeId
	local o: MirrorOpts = if opts then opts else {}
	local point = o.point or {}
	local normal = o.normal or {}
	return call("mirror", {
		id = id,
		px = point[1] or o.px or 0,
		py = point[2] or o.py or 0,
		pz = point[3] or o.pz or 0,
		nx = normal[1] or o.nx or 0,
		ny = normal[2] or o.ny or 0,
		nz = normal[3] or o.nz or 1,
	}).shapeId
end

function solid.extrude(profile: ShapeId, opts: ExtrudeOpts?): ShapeId
	local o: ExtrudeOpts = if opts then opts else {}
	return call("extrude", {
		profile = profile,
		dx = o.dx or 0,
		dy = o.dy or 0,
		dz = o.dz or 1,
	}).shapeId
end

function solid.pipe(profile: ShapeId, spine: ShapeId): ShapeId
	return call("pipe", { profile = profile, spine = spine }).shapeId
end

function solid.fillet_all(id: ShapeId, opts: FilletOpts?): ShapeId
	local o: FilletOpts = if opts then opts else {}
	return call("fillet_all", { id = id, radius = o.radius or 0.5 }).shapeId
end

function solid.pattern_linear(id: ShapeId, opts: PatternLinearOpts?): ShapeId
	local o: PatternLinearOpts = if opts then opts else {}
	return call("pattern_linear", {
		id = id,
		dx = o.dx or 0,
		dy = o.dy or 0,
		dz = o.dz or 0,
		count = o.count or 2,
	}).shapeId
end

function solid.pattern_polar(id: ShapeId, opts: PatternPolarOpts?): ShapeId
	local o: PatternPolarOpts = if opts then opts else {}
	local origin = o.origin or {}
	local axis = o.axis or {}
	return call("pattern_polar", {
		id = id,
		px = origin[1] or o.px or 0,
		py = origin[2] or o.py or 0,
		pz = origin[3] or o.pz or 0,
		ax = axis[1] or o.ax or 0,
		ay = axis[2] or o.ay or 0,
		az = axis[3] or o.az or 1,
		angle_step = o.angle_step or o.angle_step_rad or (math.pi / 2),
		count = o.count or 4,
	}).shapeId
end

function solid.clash(a: ShapeId, b: ShapeId, clearance: number?): any
	return call("clash", { a = a, b = b, clearance = clearance or 0 })
end

function solid.distance(a: ShapeId, b: ShapeId): any
	return call("distance", { a = a, b = b })
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
