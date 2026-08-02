-- @cad solid helpers — ALL geometry authoring via ir.tape (never host call).
--
-- Runtime: bare require("tools") / require("json") resolve to AgentOS builtins.
-- Analyze: worker stages this file next to typed stubs and rewrites those two
-- requires to relative paths so luau-analyze can follow the module graph.
--
-- Policy: solid.* records cad.ir ops on the session tape. Measures use
-- tape.eval_measure. finish always tape.finish. realize is rare interop only.
-- Session free/free_all may still touch the host (not geometry authoring).

local tools = require("tools")
local json = require("json")

-- Authoring returns IR tape handles (string op ids). Host numbers only after
-- finish / realize (interop).
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

--- Require an IR tape handle for authoring (never host geometry call).
local function ir_id(id: ShapeId, where: string): string
	if type(id) == "string" then
		return id
	end
	error(
		where
			.. ": expected IR tape handle (string); solid.* authoring is tape-only — do not realize mid-chain"
	)
end

--- Materialize IR tape through root handle → host shape id (rare interop only).
function solid.realize(rootId: ShapeId): number
	if type(rootId) == "number" then
		return rootId
	end
	return tape().eval_to_shape(rootId :: string)
end

-- Session cleanup only (not geometry authoring).
local function host_session(op: string, args: { [string]: any }): any
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
	local data = res.data
	if type(data) == "table" and type((data :: any).__occ_err) == "string" then
		-- Mid-flight preempt: same stable "aborted" token as ir.host.
		if (data :: any).aborted == true or (data :: any).__occ_err == "aborted" then
			error("aborted")
		end
		error((data :: any).__occ_err)
	end
	return data
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
	return tape().bool("union", ir_id(a, "solid.fuse"), ir_id(b, "solid.fuse"))
end

function solid.cut(a: ShapeId, b: ShapeId): ShapeId
	return tape().bool("subtract", ir_id(a, "solid.cut"), ir_id(b, "solid.cut"))
end

function solid.intersect(a: ShapeId, b: ShapeId): ShapeId
	return tape().bool("intersect", ir_id(a, "solid.intersect"), ir_id(b, "solid.intersect"))
end

function solid.translate(id: ShapeId, opts: TranslateOpts?): ShapeId
	local o: TranslateOpts = if opts then opts else {}
	return tape().translate(ir_id(id, "solid.translate"), o)
end

function solid.rotate(id: ShapeId, opts: RotateOpts?): ShapeId
	local o: RotateOpts = if opts then opts else {}
	return tape().rotate(ir_id(id, "solid.rotate"), o)
end

function solid.scale(id: ShapeId, opts: ScaleOpts?): ShapeId
	local o: ScaleOpts = if opts then opts else {}
	return tape().scale(ir_id(id, "solid.scale"), o)
end

function solid.mirror(id: ShapeId, opts: MirrorOpts?): ShapeId
	local o: MirrorOpts = if opts then opts else {}
	return tape().mirror(ir_id(id, "solid.mirror"), o)
end

function solid.extrude(profile: ShapeId, opts: ExtrudeOpts?): ShapeId
	local o: ExtrudeOpts = if opts then opts else {}
	return tape().push_pull(ir_id(profile, "solid.extrude"), o)
end

function solid.pipe(profile: ShapeId, spine: ShapeId): ShapeId
	return tape().pipe_profile(ir_id(profile, "solid.pipe"), ir_id(spine, "solid.pipe"))
end

function solid.fillet_all(id: ShapeId, opts: FilletOpts?): ShapeId
	local o: FilletOpts = if opts then opts else {}
	return tape().fillet_all(ir_id(id, "solid.fillet_all"), o)
end

function solid.pattern_linear(id: ShapeId, opts: PatternLinearOpts?): ShapeId
	local o: PatternLinearOpts = if opts then opts else {}
	return tape().pattern_linear(ir_id(id, "solid.pattern_linear"), o)
end

function solid.pattern_polar(id: ShapeId, opts: PatternPolarOpts?): ShapeId
	local o: PatternPolarOpts = if opts then opts else {}
	return tape().pattern_polar(ir_id(id, "solid.pattern_polar"), o)
end

function solid.clash(a: ShapeId, b: ShapeId, clearance: number?): any
	local mid = tape().query_clash(ir_id(a, "solid.clash"), ir_id(b, "solid.clash"), clearance)
	local pod = tape().eval_measure(mid)
	return {
		status = pod.status_code or 0,
		name = pod.status or "unknown",
		distance = pod.distance,
	}
end

function solid.distance(a: ShapeId, b: ShapeId): any
	-- QueryClash with distance; no standalone Distance IR op in v0.
	local mid = tape().query_clash(ir_id(a, "solid.distance"), ir_id(b, "solid.distance"), 0)
	local pod = tape().eval_measure(mid)
	return { distance = pod.distance }
end

function solid.volume(id: ShapeId): number
	local mid = tape().query_geom(ir_id(id, "solid.volume"), "volume")
	local pod = tape().eval_measure(mid)
	return pod.volume
end

function solid.bbox(id: ShapeId): any
	local mid = tape().query_geom(ir_id(id, "solid.bbox"), "bbox")
	local pod = tape().eval_measure(mid)
	return pod.bbox
end

function solid.mesh_stats(id: ShapeId, deflection: number?): any
	local mid = tape().mesh_stats(ir_id(id, "solid.mesh_stats"), deflection)
	return tape().eval_measure(mid)
end

function solid.mass_properties(id: ShapeId, density: number?): any
	local mid = tape().mass_props(ir_id(id, "solid.mass_properties"), density)
	return tape().eval_measure(mid)
end

--- Planar rectangle face (profile for extrude/revolve) → MakeRectProfile.
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
	local width = o.width or o.dx
	local height = o.height or o.dy
	if type(width) ~= "number" or type(height) ~= "number" then
		error("solid.face_rectangle: width and height required")
	end
	return tape().make_rect_profile(o)
end

--- Revolve a profile about an axis by angle (radians) → SpinSolid.
function solid.revolve(profile: ShapeId, opts: RevolveOpts?): ShapeId
	local o: RevolveOpts = if opts then opts else {}
	return tape().spin_solid(ir_id(profile, "solid.revolve"), o)
end

--- Uniform 3D offset → Offset3d.
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
	return tape().offset3d(ir_id(id, "solid.offset"), { offset = offset })
end

--- Shell (hollow) by opening 1-based face indices → HollowBody.
function solid.shell(id: ShapeId, opts: ShellOpts): ShapeId
	local o = opts
	if type(o) ~= "table" or type(o.faces) ~= "table" then
		error("solid.shell: opts.faces (1-based indices) required")
	end
	return tape().hollow_body(ir_id(id, "solid.shell"), o)
end

--- Through cylindrical hole → DrillHoleThrough.
function solid.drill_through(id: ShapeId, opts: DrillOpts): ShapeId
	local o = opts or ({} :: any)
	local diameter = o.diameter or o.d
	if type(diameter) ~= "number" then
		error("solid.drill_through: diameter required")
	end
	return tape().drill_through(ir_id(id, "solid.drill_through"), o)
end

--- Blind cylindrical hole → DrillHoleBlind.
function solid.drill_blind(id: ShapeId, opts: DrillOpts): ShapeId
	local o = opts or ({} :: any)
	local diameter = o.diameter or o.d
	if type(diameter) ~= "number" then
		error("solid.drill_blind: diameter required")
	end
	if type(o.depth) ~= "number" then
		error("solid.drill_blind: depth required")
	end
	return tape().drill_blind(ir_id(id, "solid.drill_blind"), o)
end

--- Rectangular structural member along spine → MemberSweepRect.
function solid.member_sweep_rect(spine: ShapeId, opts: MemberSweepRectOpts): ShapeId
	local o = opts or ({} :: any)
	local width = o.width or o.w
	local height = o.height or o.h
	if type(width) ~= "number" or type(height) ~= "number" then
		error("solid.member_sweep_rect: width and height required")
	end
	return tape().member_sweep_rect(ir_id(spine, "solid.member_sweep_rect"), o)
end

--- Apply row-major 4×4 rigid transform → RigidXform.
function solid.trsf_apply(id: ShapeId, matrix4x4: { number }): ShapeId
	if type(matrix4x4) ~= "table" or #matrix4x4 < 16 then
		error("solid.trsf_apply: matrix4x4 length 16 required")
	end
	return tape().rigid_xform(ir_id(id, "solid.trsf_apply"), { matrix4x4 = matrix4x4 })
end

--- Place shape by 4×4 matrix only (alias of trsf_apply).
function solid.place(id: ShapeId, matrix4x4: { number }): ShapeId
	return solid.trsf_apply(id, matrix4x4)
end

--- Free one host shape id (best-effort). IR handles are not host pointers.
function solid.free(id: ShapeId)
	if is_ir_handle(id) or type(id) == "string" then
		return
	end
	host_session("shape_free", { id = id })
end

--- Free all host shapes (K17 / session cleanup).
function solid.free_all()
	host_session("free_all", {})
end

--- Write STEP via StepWrite measure (eval_measure).
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
	local mid = tape().step_write(ir_id(id, "solid.step_write"), path)
	return tape().eval_measure(mid)
end

-- Always IR-eval tape handles; finish ends recording after demo eval.
function solid.finish(rootId: ShapeId, extra: FinishExtra?): ShapeId
	if type(rootId) == "string" then
		local t = tape()
		local hostId = t.finish(rootId, extra)
		t.end_recording()
		return if hostId ~= 0 then hostId else rootId
	end
	if type(rootId) == "number" then
		-- Already a host id (rare interop after realize); emit marker only.
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
