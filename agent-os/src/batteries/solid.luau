-- @cad solid helpers — host geometry via require("tools") + cad.call
--
-- Runtime: bare require("tools") / require("json") resolve to AgentOS builtins.
-- Analyze: worker stages this file next to typed stubs and rewrites those two
-- requires to relative paths so luau-analyze can follow the module graph.

local tools = require("tools")
local json = require("json")

-- Host shape ids are numbers. solid.* authoring records IR tape handles (string op ids).
-- Host-only tools (fillet/pipe/drill/shell/…) realize handles first via host_id().
export type ShapeId = number | string

export type BoxOpts = {
	dx: number?,
	dy: number?,
	dz: number?,
	x: number?,
	y: number?,
	z: number?,
	--- IR tape only: "origin" | "centered_xy_bottom"
	corner: string?,
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

export type RevolveOpts = {
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

export type OffsetOpts = {
	offset: number?,
	distance: number?,
}

export type ShellOpts = {
	faces: { number },
	thickness: number?,
	t: number?,
}

export type DrillOpts = {
	origin: { number }?,
	cx: number?,
	cy: number?,
	cz: number?,
	ox: number?,
	oy: number?,
	oz: number?,
	direction: { number }?,
	dx: number?,
	dy: number?,
	dz: number?,
	diameter: number?,
	d: number?,
	depth: number?,
}

export type MemberSweepRectOpts = {
	width: number?,
	height: number?,
	w: number?,
	h: number?,
}

export type StepWriteOpts = {
	path: string?,
	file: string?,
}

local solid = {}

-- solid.* is always IR: geometry calls record cad.ir ops; finish evaluates.
-- There is no direct-host "Path B" for solid authoring.
local function tape(): any
	local ok, t = pcall(function()
		return require("ir.tape")
	end)
	if not ok or t == nil then
		error('solid: require("ir.tape") unavailable — stage batteries/ir/')
	end
	if not t.is_enabled() then
		t.begin("solid")
	end
	return t
end

local function is_ir_handle(id: any): boolean
	local ok, t = pcall(function()
		return require("ir.tape")
	end)
	return ok and t ~= nil and t.is_handle(id)
end

--- Materialize IR tape through root handle → host shape id (for host-only tools).
function solid.realize(rootId: ShapeId): number
	if type(rootId) == "number" then
		return rootId
	end
	return tape().eval_to_shape(rootId :: string)
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
	if is_ir_handle(id) then
		return solid.realize(id)
	end
	error("solid: expected IR handle or host shape id, got " .. type(id))
end

function solid.box(opts: BoxOpts?): ShapeId
	local o: BoxOpts = if opts then opts else {}
	return tape().prim_box(o)
end

function solid.cylinder(opts: CylinderOpts?): ShapeId
	local o: CylinderOpts = if opts then opts else {}
	return tape().prim_cylinder(o)
end

function solid.sphere(opts: SphereOpts?): ShapeId
	local o: SphereOpts = if opts then opts else {}
	return tape().prim_sphere(o)
end

function solid.cone(opts: ConeOpts?): ShapeId
	local o: ConeOpts = if opts then opts else {}
	return tape().prim_cone(o)
end

function solid.torus(opts: TorusOpts?): ShapeId
	local o: TorusOpts = if opts then opts else {}
	return tape().prim_torus(o)
end

function solid.fuse(a: ShapeId, b: ShapeId): ShapeId
	return tape().bool("union", a :: string, b :: string)
end

function solid.cut(a: ShapeId, b: ShapeId): ShapeId
	return tape().bool("subtract", a :: string, b :: string)
end

function solid.intersect(a: ShapeId, b: ShapeId): ShapeId
	return tape().bool("intersect", a :: string, b :: string)
end

function solid.translate(id: ShapeId, opts: TranslateOpts?): ShapeId
	local o: TranslateOpts = if opts then opts else {}
	return tape().translate(id :: string, o)
end

function solid.rotate(id: ShapeId, opts: RotateOpts?): ShapeId
	local o: RotateOpts = if opts then opts else {}
	return tape().rotate(id :: string, o)
end

-- No IR Scale op in registry — host-only after realize (not Path B authoring).
function solid.scale(id: ShapeId, opts: ScaleOpts?): ShapeId
	local o: ScaleOpts = if opts then opts else {}
	local origin = o.origin or {}
	return call("scale", {
		id = host_id(id),
		cx = origin[1] or o.cx or 0,
		cy = origin[2] or o.cy or 0,
		cz = origin[3] or o.cz or 0,
		factor = o.factor or 1,
	}).shapeId
end

function solid.mirror(id: ShapeId, opts: MirrorOpts?): ShapeId
	local o: MirrorOpts = if opts then opts else {}
	return tape().mirror(id :: string, o)
end

function solid.extrude(profile: ShapeId, opts: ExtrudeOpts?): ShapeId
	local o: ExtrudeOpts = if opts then opts else {}
	-- IR handle → PushPull tape op. Host profile (face_rectangle) has no Face IR op.
	if is_ir_handle(profile) then
		return tape().push_pull(profile :: string, o)
	end
	return call("extrude", {
		profile = host_id(profile),
		dx = o.dx or 0,
		dy = o.dy or 0,
		dz = o.dz or 1,
	}).shapeId
end

-- Host-only after realize (no IR pipe/sweep-profile op for solid authoring).
function solid.pipe(profile: ShapeId, spine: ShapeId): ShapeId
	return call("pipe", { profile = host_id(profile), spine = host_id(spine) }).shapeId
end

-- Host-only after realize (no IR Fillet op).
function solid.fillet_all(id: ShapeId, opts: FilletOpts?): ShapeId
	local o: FilletOpts = if opts then opts else {}
	return call("fillet_all", { id = host_id(id), radius = o.radius or 0.5 }).shapeId
end

function solid.pattern_linear(id: ShapeId, opts: PatternLinearOpts?): ShapeId
	local o: PatternLinearOpts = if opts then opts else {}
	return tape().pattern_linear(id :: string, o)
end

function solid.pattern_polar(id: ShapeId, opts: PatternPolarOpts?): ShapeId
	local o: PatternPolarOpts = if opts then opts else {}
	return tape().pattern_polar(id :: string, o)
end

function solid.clash(a: ShapeId, b: ShapeId, clearance: number?): any
	return call("clash", { a = host_id(a), b = host_id(b), clearance = clearance or 0 })
end

function solid.distance(a: ShapeId, b: ShapeId): any
	return call("distance", { a = host_id(a), b = host_id(b) })
end

function solid.volume(id: ShapeId): number
	return call("volume", { id = host_id(id) }).volume
end

function solid.bbox(id: ShapeId): any
	return call("bbox", { id = host_id(id) }).bbox
end

function solid.mesh_stats(id: ShapeId, deflection: number?): any
	return call("mesh_stats", { id = host_id(id), deflection = deflection or 0.1 })
end

function solid.mass_properties(id: ShapeId, density: number?): any
	return call("mass_properties", { id = host_id(id), density = density or 1 })
end

--- Planar rectangle face (profile for extrude/revolve). Host-only — no Face IR op yet.
function solid.face_rectangle(opts: {
	cx: number?,
	cy: number?,
	cz: number?,
	origin: { number }?,
	normal: { number }?,
	nx: number?,
	ny: number?,
	nz: number?,
	width: number?,
	height: number?,
	dx: number?,
	dy: number?,
}?): ShapeId
	local o = opts or ({} :: any)
	local origin = o.origin or {}
	local normal = o.normal or {}
	local width = o.width or o.dx
	local height = o.height or o.dy
	if type(width) ~= "number" or type(height) ~= "number" then
		error("solid.face_rectangle: width and height required")
	end
	return call("make_face_rectangle", {
		cx = origin[1] or o.cx or 0,
		cy = origin[2] or o.cy or 0,
		cz = origin[3] or o.cz or 0,
		nx = normal[1] or o.nx or 0,
		ny = normal[2] or o.ny or 0,
		nz = normal[3] or o.nz or 1,
		width = width,
		height = height,
	}).shapeId
end

--- Revolve a profile about an axis by angle (radians). Host-only after realize (no Revolve IR op).
--- Profile must be a host shape (face_rectangle); IR solid handles need solid.realize first.
function solid.revolve(profile: ShapeId, opts: RevolveOpts?): ShapeId
	local o: RevolveOpts = if opts then opts else {}
	local origin = o.origin or {}
	local axis = o.axis or {}
	return call("revolve", {
		profile = host_id(profile),
		px = origin[1] or o.px or 0,
		py = origin[2] or o.py or 0,
		pz = origin[3] or o.pz or 0,
		ax = axis[1] or o.ax or 0,
		ay = axis[2] or o.ay or 0,
		az = axis[3] or o.az or 1,
		angle = o.angle or o.angle_rad or (2 * math.pi),
	}).shapeId
end

--- Uniform 3D offset of a solid. Host-only after realize. Offset distance required.
function solid.offset(id: ShapeId, opts: OffsetOpts | number): ShapeId
	local offset: number?
	if type(opts) == "number" then
		offset = opts
	elseif type(opts) == "table" then
		local o = opts :: OffsetOpts
		offset = o.offset or o.distance
	end
	if type(offset) ~= "number" then
		error("solid.offset: offset (or distance) required")
	end
	return call("offset_3d", { id = host_id(id), offset = offset }).shapeId
end

--- Shell (hollow) by opening 1-based face indices with thickness. Host-only after realize.
function solid.shell(id: ShapeId, opts: ShellOpts): ShapeId
	local o = opts
	if type(o) ~= "table" or type(o.faces) ~= "table" then
		error("solid.shell: opts.faces (1-based indices) required")
	end
	id = host_id(id)
	return call("shell", {
		id = id,
		faces = o.faces,
		thickness = o.thickness or o.t or 0.1,
	}).shapeId
end

--- Through cylindrical hole (tool length auto-sized from solid bbox). Host-only after realize.
--- diameter required. Seed home for holes; future cad.holes may re-export.
function solid.drill_through(id: ShapeId, opts: DrillOpts): ShapeId
	local o = opts or ({} :: any)
	local origin = o.origin or {}
	local dir = o.direction or {}
	local diameter = o.diameter or o.d
	if type(diameter) ~= "number" then
		error("solid.drill_through: diameter required")
	end
	return call("drill_hole_through", {
		id = host_id(id),
		cx = origin[1] or o.cx or o.ox or 0,
		cy = origin[2] or o.cy or o.oy or 0,
		cz = origin[3] or o.cz or o.oz or 0,
		dx = dir[1] or o.dx or 0,
		dy = dir[2] or o.dy or 0,
		dz = dir[3] or o.dz or 1,
		diameter = diameter,
	}).shapeId
end

--- Blind cylindrical hole of given depth along +direction from origin. Host-only after realize.
--- diameter and depth required. Seed home for holes; future cad.holes may re-export.
function solid.drill_blind(id: ShapeId, opts: DrillOpts): ShapeId
	local o = opts or ({} :: any)
	local origin = o.origin or {}
	local dir = o.direction or {}
	local diameter = o.diameter or o.d
	if type(diameter) ~= "number" then
		error("solid.drill_blind: diameter required")
	end
	if type(o.depth) ~= "number" then
		error("solid.drill_blind: depth required")
	end
	return call("drill_hole_blind", {
		id = host_id(id),
		ox = origin[1] or o.ox or o.cx or 0,
		oy = origin[2] or o.oy or o.cy or 0,
		oz = origin[3] or o.oz or o.cz or 0,
		dx = dir[1] or o.dx or 0,
		dy = dir[2] or o.dy or 0,
		dz = dir[3] or o.dz or 1,
		diameter = diameter,
		depth = o.depth,
	}).shapeId
end

--- Rectangular structural member swept along a spine wire (also route.member_sweep_rect).
--- Host-only after realize. width and height required. Seed home; future cad.structure may re-export.
function solid.member_sweep_rect(spine: ShapeId, opts: MemberSweepRectOpts): ShapeId
	local o = opts or ({} :: any)
	local width = o.width or o.w
	local height = o.height or o.h
	if type(width) ~= "number" or type(height) ~= "number" then
		error("solid.member_sweep_rect: width and height required")
	end
	return call("member_sweep_rect", {
		width = width,
		height = height,
		spine = host_id(spine),
	}).shapeId
end

--- Apply row-major 4×4 rigid transform (copy) → new shape id.
function solid.trsf_apply(id: ShapeId, matrix4x4: { number }): ShapeId
	if type(matrix4x4) ~= "table" or #matrix4x4 < 16 then
		error("solid.trsf_apply: matrix4x4 length 16 required")
	end
	return call("trsf_apply", { id = host_id(id), matrix4x4 = matrix4x4 }).shapeId
end

--- Place shape by 4×4 matrix only (alias of trsf_apply). For chain FK use frames.place_at_chain.
function solid.place(id: ShapeId, matrix4x4: { number }): ShapeId
	return solid.trsf_apply(id, matrix4x4)
end

--- Free one host shape id (best-effort). IR handles are not host pointers.
function solid.free(id: ShapeId)
	if is_ir_handle(id) then
		return
	end
	call("shape_free", { id = id })
end

--- Free all host shapes (K17 / session cleanup).
function solid.free_all()
	call("free_all", {})
end

--- Write STEP to Emscripten MEMFS path (browser/Node wasm FS only in v0).
function solid.step_write(id: ShapeId, opts: StepWriteOpts | string): any
	local path: string
	if type(opts) == "string" then
		path = opts
	else
		local o = (opts or {}) :: StepWriteOpts
		path = o.path or o.file
	end
	if type(path) ~= "string" or path == "" then
		error('solid.step_write: path required (e.g. "/tmp/part.step")')
	end
	return call("step_write", { id = host_id(id), path = path })
end

-- Always IR-eval tape handles (box/fuse/cut/… authoring); host ids only emit marker.
function solid.finish(rootId: ShapeId, extra: FinishExtra?): ShapeId
	if type(rootId) == "string" then
		local t = tape()
		local hostId = t.finish(rootId, extra)
		t.end_recording()
		return if hostId ~= 0 then hostId else rootId
	end
	if type(rootId) == "number" then
		-- Already a host id (e.g. after realize / host-only tool chain); emit marker only.
		local payload: { [string]: any } = { schema = 1, root = rootId }
		if type(extra) == "table" then
			for k, v in pairs(extra) do
				payload[k] = v
			end
		end
		print("__OCC_CAD_RESULT__" .. json.encode(payload))
		return rootId
	end
	error("solid.finish: expected IR tape handle or host shape id, got " .. type(rootId))
end

return solid

