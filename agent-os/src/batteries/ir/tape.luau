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
		error("ir.tape: not recording (call solid.use_ir(true) or ir.tape.begin())")
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

--- Evaluate recorded IR; return host shape id for root handle.
function tape.eval_to_shape(root: string, opts: any?): number
	local doc = tape.document()
	local res = eval_mod.eval(doc, opts or { root = root })
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
		error(tostring(e.message or e.code or "IR tape finish failed"))
	end
	local sid = res.shapes and res.shapes[root]
	if type(sid) == "number" then
		return sid
	end
	-- Marker already printed; return 0 as sentinel if id not recovered
	return 0
end

return tape
