-- IR tape: record clean solid.*-style calls as cad.ir ops, then evaluate once.
-- Shape handles are string op ids while recording; host numbers after finish/eval.

local errors = require("ir.errors")
local eval_mod = require("ir.eval")
local demo_mod = require("ir.demo")

local tape = {
	enabled = false,
	_seq = 0,
	_ops = {} :: { any },
	_ids = {} :: { [string]: boolean },
	_doc_id = "tape",
}

local function reset()
	tape._seq = 0
	tape._ops = {}
	tape._ids = {}
end

function tape.is_enabled(): boolean
	return tape.enabled == true
end

function tape.begin(doc_id: string?)
	tape.enabled = true
	reset()
	tape._doc_id = doc_id or "tape"
end

function tape.clear()
	reset()
end

function tape.end_recording()
	tape.enabled = false
end

function tape.is_handle(id: any): boolean
	return type(id) == "string" and tape._ids[id] == true
end

-- Must match IR OP_ID_PATTERN: ^[%a_][%w_./%-]*$
local function next_id(prefix: string?): string
	tape._seq = tape._seq + 1
	local p = prefix or "s"
	local id = p .. tostring(tape._seq)
	tape._ids[id] = true
	return id
end

local function body_ref(id: string): any
	return { created_by = id, entity = "body" }
end

local function push(op: any): string
	if not tape.enabled then
		error("ir.tape: not recording (solid.* auto-begins tape, or call ir.tape.begin())")
	end
	table.insert(tape._ops, op)
	return op.id
end

function tape.document(): any
	return {
		ir_schema = "cad.ir/v0",
		id = tape._doc_id,
		version = "0.1.0",
		units = { length = "meter", angle = "radian", store = "SI" },
		params = {},
		ops = tape._ops,
		meta = {
			author = "luau-tape",
			lib_versions = { cad_ir = "0.1.0", occ_c = "7.9.3-api", occt = "7.9.3" },
			kernel_version = "7.9.3",
			strict = true,
		},
	}
end

function tape.prim_box(opts: any): string
	local o = opts or {}
	local id = next_id("box")
	return push({
		id = id,
		op = "PrimBox",
		params = {
			dx = o.dx or o.x or 0.01,
			dy = o.dy or o.y or 0.01,
			dz = o.dz or o.z or 0.01,
			corner = o.corner or "origin",
		},
	})
end

function tape.prim_cylinder(opts: any): string
	local o = opts or {}
	local origin = o.origin or {}
	local axis = o.axis or { 0, 0, 1 }
	local id = next_id("cyl")
	return push({
		id = id,
		op = "PrimCylinder",
		params = {
			radius = o.radius or 0.001,
			height = o.height or 0.001,
			origin = {
				origin[1] or o.cx or 0,
				origin[2] or o.cy or 0,
				origin[3] or o.cz or 0,
			},
			axis = {
				axis[1] or 0,
				axis[2] or 0,
				axis[3] or 1,
			},
		},
	})
end

function tape.prim_sphere(opts: any): string
	local o = opts or {}
	local origin = o.origin or {}
	local id = next_id("sph")
	return push({
		id = id,
		op = "PrimSphere",
		params = {
			radius = o.radius or 0.001,
			origin = {
				origin[1] or o.cx or 0,
				origin[2] or o.cy or 0,
				origin[3] or o.cz or 0,
			},
		},
	})
end

function tape.prim_cone(opts: any): string
	local o = opts or {}
	local origin = o.origin or {}
	local axis = o.axis or { 0, 0, 1 }
	local id = next_id("cone")
	return push({
		id = id,
		op = "PrimCone",
		params = {
			r1 = o.r1 or o.radius1 or 1,
			r2 = o.r2 or o.radius2 or 0,
			height = o.height or 1,
			origin = {
				origin[1] or o.cx or 0,
				origin[2] or o.cy or 0,
				origin[3] or o.cz or 0,
			},
			axis = {
				axis[1] or 0,
				axis[2] or 0,
				axis[3] or 1,
			},
		},
	})
end

function tape.prim_torus(opts: any): string
	local o = opts or {}
	local origin = o.origin or {}
	local axis = o.axis or { 0, 0, 1 }
	local id = next_id("tor")
	return push({
		id = id,
		op = "PrimTorus",
		params = {
			major_r = o.major_r or o.majorR or o.R or 2,
			minor_r = o.minor_r or o.minorR or o.r or 0.5,
			origin = {
				origin[1] or o.cx or 0,
				origin[2] or o.cy or 0,
				origin[3] or o.cz or 0,
			},
			axis = {
				axis[1] or 0,
				axis[2] or 0,
				axis[3] or 1,
			},
		},
	})
end

function tape.bool(mode: string, a: string, b: string): string
	local id = next_id(mode)
	return push({
		id = id,
		op = "BoolCombine",
		params = { mode = mode },
		refs = {
			target = body_ref(a),
			tools = { body_ref(b) },
		},
	})
end

function tape.translate(id: string, opts: any): string
	local o = opts or {}
	local nid = next_id("tr")
	return push({
		id = nid,
		op = "Translate",
		params = {
			dx = o.dx or 0,
			dy = o.dy or 0,
			dz = o.dz or 0,
		},
		refs = { shape = body_ref(id) },
	})
end

function tape.rotate(id: string, opts: any): string
	local o = opts or {}
	local origin = o.origin or {}
	local axis = o.axis or {}
	local nid = next_id("rot")
	return push({
		id = nid,
		op = "Rotate",
		params = {
			angle = o.angle or o.angle_rad or 0,
			origin = {
				origin[1] or o.px or 0,
				origin[2] or o.py or 0,
				origin[3] or o.pz or 0,
			},
			axis = {
				axis[1] or o.ax or 0,
				axis[2] or o.ay or 0,
				axis[3] or o.az or 1,
			},
		},
		refs = { shape = body_ref(id) },
	})
end

--- Mirror about a plane (point + normal) → MirrorCopy IR op.
function tape.mirror(id: string, opts: any): string
	local o = opts or {}
	local point = o.point or {}
	local normal = o.normal or {}
	local nid = next_id("mir")
	return push({
		id = nid,
		op = "MirrorCopy",
		params = {
			point = {
				point[1] or o.px or 0,
				point[2] or o.py or 0,
				point[3] or o.pz or 0,
			},
			normal = {
				normal[1] or o.nx or 0,
				normal[2] or o.ny or 0,
				normal[3] or o.nz or 1,
			},
		},
		refs = { shape = body_ref(id) },
	})
end

--- Extrude / push-pull a profile → PushPull IR op.
function tape.push_pull(profile: string, opts: any): string
	local o = opts or {}
	local nid = next_id("ppull")
	return push({
		id = nid,
		op = "PushPull",
		params = {
			dx = o.dx or 0,
			dy = o.dy or 0,
			dz = o.dz or o.height or 1,
		},
		refs = { profile = body_ref(profile) },
	})
end

-- Alias used by solid.extrude
tape.extrude = tape.push_pull

--- Uniform scale about a point → Scale IR op.
function tape.scale(id: string, opts: any): string
	local o = opts or {}
	local origin = o.origin or {}
	local nid = next_id("sc")
	return push({
		id = nid,
		op = "Scale",
		params = {
			origin = {
				origin[1] or o.cx or 0,
				origin[2] or o.cy or 0,
				origin[3] or o.cz or 0,
			},
			cx = origin[1] or o.cx or 0,
			cy = origin[2] or o.cy or 0,
			cz = origin[3] or o.cz or 0,
			factor = o.factor or o.f or 1,
		},
		refs = { shape = body_ref(id) },
	})
end

--- Fillet all edges → FilletAll IR op.
function tape.fillet_all(id: string, opts: any): string
	local o = opts or {}
	local nid = next_id("fil")
	return push({
		id = nid,
		op = "FilletAll",
		params = { radius = o.radius or 0.5 },
		refs = { shape = body_ref(id) },
	})
end

--- Profile + spine pipe → PipeProfile IR op.
function tape.pipe_profile(profile: string, spine: string): string
	local nid = next_id("pipe")
	return push({
		id = nid,
		op = "PipeProfile",
		params = {},
		refs = {
			profile = body_ref(profile),
			spine = body_ref(spine),
		},
	})
end

--- Revolve / spin a profile about an axis → SpinSolid IR op.
function tape.spin_solid(profile: string, opts: any): string
	local o = opts or {}
	local origin = o.origin or {}
	local axis = o.axis or {}
	local nid = next_id("spin")
	return push({
		id = nid,
		op = "SpinSolid",
		params = {
			angle = o.angle or o.angle_rad or (2 * math.pi),
			origin = {
				origin[1] or o.px or 0,
				origin[2] or o.py or 0,
				origin[3] or o.pz or 0,
			},
			axis = {
				axis[1] or o.ax or 0,
				axis[2] or o.ay or 0,
				axis[3] or o.az or 1,
			},
		},
		refs = { profile = body_ref(profile) },
	})
end

tape.revolve = tape.spin_solid

--- Uniform 3D offset → Offset3d IR op.
function tape.offset3d(id: string, opts: any): string
	local o = opts or {}
	local offset = if type(opts) == "number" then opts else (o.offset or o.distance)
	local nid = next_id("off")
	return push({
		id = nid,
		op = "Offset3d",
		params = { offset = offset },
		refs = { shape = body_ref(id) },
	})
end

--- Shell / hollow body by opening faces → HollowBody IR op.
function tape.hollow_body(id: string, opts: any): string
	local o = opts or {}
	local nid = next_id("hol")
	return push({
		id = nid,
		op = "HollowBody",
		params = {
			faces = o.faces or o.face_idx,
			thickness = o.thickness or o.t or 0.1,
		},
		refs = { shape = body_ref(id) },
	})
end

tape.shell = tape.hollow_body

--- Through cylindrical hole → DrillHoleThrough IR op.
function tape.drill_through(id: string, opts: any): string
	local o = opts or {}
	local origin = o.origin or {}
	local dir = o.direction or {}
	local nid = next_id("drt")
	return push({
		id = nid,
		op = "DrillHoleThrough",
		params = {
			origin = {
				origin[1] or o.cx or o.ox or 0,
				origin[2] or o.cy or o.oy or 0,
				origin[3] or o.cz or o.oz or 0,
			},
			direction = {
				dir[1] or o.dx or 0,
				dir[2] or o.dy or 0,
				dir[3] or o.dz or 1,
			},
			diameter = o.diameter or o.d,
		},
		refs = { shape = body_ref(id) },
	})
end

--- Blind cylindrical hole → DrillHoleBlind IR op.
function tape.drill_blind(id: string, opts: any): string
	local o = opts or {}
	local origin = o.origin or {}
	local dir = o.direction or {}
	local nid = next_id("drb")
	return push({
		id = nid,
		op = "DrillHoleBlind",
		params = {
			origin = {
				origin[1] or o.ox or o.cx or 0,
				origin[2] or o.oy or o.cy or 0,
				origin[3] or o.oz or o.cz or 0,
			},
			direction = {
				dir[1] or o.dx or 0,
				dir[2] or o.dy or 0,
				dir[3] or o.dz or 1,
			},
			diameter = o.diameter or o.d,
			depth = o.depth,
		},
		refs = { shape = body_ref(id) },
	})
end

--- Planar rectangle face profile → MakeRectProfile IR op.
function tape.make_rect_profile(opts: any): string
	local o = opts or {}
	local origin = o.origin or {}
	local normal = o.normal or {}
	local id = next_id("rect")
	return push({
		id = id,
		op = "MakeRectProfile",
		params = {
			origin = {
				origin[1] or o.cx or 0,
				origin[2] or o.cy or 0,
				origin[3] or o.cz or 0,
			},
			normal = {
				normal[1] or o.nx or 0,
				normal[2] or o.ny or 0,
				normal[3] or o.nz or 1,
			},
			width = o.width or o.dx,
			height = o.height or o.dy,
		},
	})
end

--- Rectangular structural member along spine → MemberSweepRect IR op.
function tape.member_sweep_rect(spine: string, opts: any): string
	local o = opts or {}
	local nid = next_id("msr")
	return push({
		id = nid,
		op = "MemberSweepRect",
		params = {
			width = o.width or o.w,
			height = o.height or o.h,
		},
		refs = { spine = body_ref(spine) },
	})
end

--- Mass properties measure op id (caller may tape.eval_measure).
function tape.mass_props(shape_id: string, density: number?): string
	tape.ensure()
	local id = next_id("mp")
	return push({
		id = id,
		op = "MassProps",
		params = { density = density or 1 },
		refs = { shape = body_ref(shape_id) },
	})
end

--- Mesh stats measure op id (caller may tape.eval_measure).
function tape.mesh_stats(shape_id: string, deflection: number?): string
	tape.ensure()
	local id = next_id("ms")
	return push({
		id = id,
		op = "MeshStats",
		params = { deflection = deflection or 0.1 },
		refs = { shape = body_ref(shape_id) },
	})
end

--- ExportMesh (Tier A stats-only mesh measure; host mesh_stats, no full mesh).
function tape.export_mesh(shape_id: string, opts: any?): string
	tape.ensure()
	local o = opts or {}
	local id = next_id("em")
	local params: { [string]: any } = {
		deflection = o.deflection or 0.001,
	}
	if o.mesh_optional == true then
		params.mesh_optional = true
	end
	return push({
		id = id,
		op = "ExportMesh",
		params = params,
		refs = { shape = body_ref(shape_id) },
	})
end

--- STEP write measure op id (caller may tape.eval_measure).
function tape.step_write(shape_id: string, path: string): string
	tape.ensure()
	local id = next_id("stp")
	return push({
		id = id,
		op = "StepWrite",
		params = { path = path },
		refs = { shape = body_ref(shape_id) },
	})
end

function tape.pattern_polar(id: string, opts: any): string
	local o = opts or {}
	local origin = o.origin or {}
	local axis = o.axis or {}
	local nid = next_id("pp")
	return push({
		id = nid,
		op = "PatternPolar",
		params = {
			origin = {
				origin[1] or o.px or 0,
				origin[2] or o.py or 0,
				origin[3] or o.pz or 0,
			},
			axis = {
				axis[1] or o.ax or 0,
				axis[2] or o.ay or 0,
				axis[3] or o.az or 1,
			},
			angle_step = o.angle_step or o.angle_step_rad or (math.pi / 2),
			count = o.count or 4,
		},
		refs = { shape = body_ref(id) },
	})
end

function tape.pattern_linear(id: string, opts: any): string
	local o = opts or {}
	local nid = next_id("pl")
	return push({
		id = nid,
		op = "PatternLinear",
		params = {
			dx = o.dx or 0,
			dy = o.dy or 0,
			dz = o.dz or 0,
			count = o.count or 2,
		},
		refs = { shape = body_ref(id) },
	})
end

--- Ensure tape is recording (shared by solid/route/frames/query).
function tape.ensure(doc_id: string?)
	if not tape.enabled then
		tape.begin(doc_id or "session")
	end
end

--- RoutePath: polyline or polyline_bend.
function tape.route_path(opts: any): string
	tape.ensure()
	local o = opts or {}
	local style = o.style
	if not style then
		if o.bend_r or o.bend_radius then
			style = "polyline_bend"
		else
			style = "polyline"
		end
	end
	local id = next_id("rt")
	return push({
		id = id,
		op = "RoutePath",
		params = {
			style = style,
			nodes = o.nodes,
			bend_r = o.bend_r or o.bend_radius,
			closed = o.closed == true,
		},
	})
end

--- SweepAlong annulus along path (spine IR handle).
function tape.sweep_annulus(path_id: string, opts: any): string
	tape.ensure()
	local o = opts or {}
	local id = next_id("sw")
	return push({
		id = id,
		op = "SweepAlong",
		params = {
			profile_kind = "annulus",
			od = o.od,
			inner = o.inner or o.inner_diameter or o.id_bore,
		},
		refs = { path = body_ref(path_id) },
	})
end

--- AttachFrame pure POD (name on params).
function tape.attach_frame(opts: any): string
	tape.ensure()
	local o = opts or {}
	local id = next_id("fr")
	local name = o.name or id
	return push({
		id = id,
		op = "AttachFrame",
		params = {
			name = name,
			origin = o.origin or { o.ox or 0, o.oy or 0, o.oz or 0 },
			z = o.z or { o.zx or 0, o.zy or 0, o.zz or 1 },
			x = o.x,
		},
	})
end

--- ComposeChain measure; returns POD with _ir_id for place_at_chain.
function tape.compose_chain(opts: any): any
	tape.ensure()
	local o = opts or {}
	local id = next_id("fk")
	push({
		id = id,
		op = "ComposeChain",
		params = {
			origins = o.origins,
			axes = o.axes,
			angles = o.angles,
		},
	})
	local res = eval_mod.eval(tape.document(), { skip_free_all = true, root = id })
	if errors.is_fail(res) or res.ok == false then
		local e = (res :: any).error or res
		error(tostring((e :: any).message or (e :: any).code or "ComposeChain eval failed"))
	end
	local pod = res.measures and res.measures[id]
	if type(pod) ~= "table" then
		error("ComposeChain: no measure pod")
	end
	pod._ir_id = id
	return pod
end

--- RigidXform from matrix4x4 or from chain measure + prefix (0-based IR index).
function tape.rigid_xform(shape_id: string, opts: any): string
	tape.ensure()
	local o = opts or {}
	local nid = next_id("rx")
	local params: { [string]: any } = {}
	local refs: { [string]: any } = { shape = body_ref(shape_id) }
	if type(o.matrix4x4) == "table" then
		params.matrix4x4 = o.matrix4x4
	elseif type(o.chain_id) == "string" then
		refs.chain = { op = o.chain_id }
		params.prefix_index = o.prefix_index or 0
	elseif type(o.chain) == "table" and type(o.chain._ir_id) == "string" then
		refs.chain = { op = o.chain._ir_id }
		if type(o.prefix_1based) == "number" then
			params.prefix_index = (o.prefix_1based :: number) - 1
		elseif type(o.matrix4x4) == "table" then
			params.matrix4x4 = o.matrix4x4
		else
			-- final matrix: bake from POD (script rebuilds on param change)
			params.matrix4x4 = o.chain.final
		end
	else
		error("tape.rigid_xform: need matrix4x4 or chain")
	end
	return push({
		id = nid,
		op = "RigidXform",
		params = params,
		refs = refs,
	})
end

function tape.query_clash(a: string, b: string, clearance: number?): string
	tape.ensure()
	local id = next_id("cl")
	return push({
		id = id,
		op = "QueryClash",
		params = {
			clearance = clearance or 0,
			include_distance = true,
			distance_optional = true,
		},
		refs = {
			a = body_ref(a),
			b = body_ref(b),
		},
	})
end

function tape.query_geom(shape_id: string, mode: string): string
	tape.ensure()
	local id = next_id("qg")
	return push({
		id = id,
		op = "QueryGeom",
		params = { mode = mode or "volume" },
		refs = { shape = body_ref(shape_id) },
	})
end

--- Eval measure op → POD (skip free_all).
function tape.eval_measure(op_id: string): any
	local res = eval_mod.eval(tape.document(), { skip_free_all = true, root = op_id })
	if errors.is_fail(res) or res.ok == false then
		local e = (res :: any).error or res
		error(tostring((e :: any).message or (e :: any).code or "measure eval failed"))
	end
	local pod = res.measures and res.measures[op_id]
	if type(pod) ~= "table" then
		error("tape.eval_measure: no measure for " .. tostring(op_id))
	end
	return pod
end

--- Eval AttachFrame op → frame POD from env (skip free_all).
function tape.eval_frame(op_id: string): any
	local res = eval_mod.eval(tape.document(), { skip_free_all = true, root = op_id })
	if errors.is_fail(res) or res.ok == false then
		local e = (res :: any).error or res
		error(tostring((e :: any).message or (e :: any).code or "frame eval failed"))
	end
	local env = res.env
	if type(env) == "table" and type(env.frames_by_op) == "table" then
		local pod = env.frames_by_op[op_id]
		if type(pod) == "table" then
			return pod
		end
	end
	if type(res.frames) == "table" then
		for _, op in ipairs(tape._ops) do
			if op.id == op_id and op.op == "AttachFrame" then
				local name = op.params and op.params.name
				if type(name) == "string" and type(res.frames[name]) == "table" then
					return res.frames[name]
				end
			end
		end
	end
	error("tape.eval_frame: no frame for " .. tostring(op_id))
end

--- Evaluate recorded IR; return host shape id for root handle.
--- skip_free_all so mid-session realize() does not wipe other host shapes.
function tape.eval_to_shape(root: string, opts: any?): number
	local o: { [string]: any } = { root = root, skip_free_all = true }
	if type(opts) == "table" then
		for k, v in pairs(opts) do
			o[k] = v
		end
	end
	local doc = tape.document()
	local res = eval_mod.eval(doc, o)
	if errors.is_fail(res) or res.ok == false then
		local e = (res :: any).error or res
		error(tostring((e :: any).message or (e :: any).code or "IR tape eval failed"))
	end
	local sid = res.shapes and res.shapes[root]
	if type(sid) ~= "number" then
		error("IR tape: no host shape for root " .. tostring(root))
	end
	return sid
end

function tape.finish(root: string, extra: any?): number
	local doc = tape.document()
	local opts: { [string]: any } = { root = root }
	if type(extra) == "table" then
		for k, v in pairs(extra) do
			opts[k] = v
		end
	end
	local res = demo_mod.run_demo(doc, opts)
	if type(res) == "table" and res.ok == false then
		local e = res.error or {}
		local msg = tostring(e.message or e.code or "IR tape finish failed")
		-- Surface which IR / host op failed (generic "host tool call failed"
		-- alone is not actionable for authors).
		if type(e.op) == "string" then
			msg = msg .. " [" .. e.op
			if type(e.op_id) == "string" then
				msg = msg .. " " .. e.op_id
			end
			if type(e.host_op) == "string" then
				msg = msg .. " host=" .. e.host_op
			end
			msg = msg .. "]"
		elseif type(e.host_op) == "string" then
			msg = msg .. " [host=" .. e.host_op .. "]"
		end
		error(msg)
	end
	local sid = res.shapes and res.shapes[root]
	if type(sid) == "number" then
		return sid
	end
	return 0
end

return tape
