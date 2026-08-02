-- cad.ir.eval + eval_pose (K17 lifetime, K19 pose path)
-- Op-level memo: fingerprint {op,params,refs} → host cache_get/put (param scrub).

local errors = require("ir.errors")
local bind_mod = require("ir.bind")
local validate_mod = require("ir.validate")
local limits_mod = require("ir.limits")
local host = require("ir.host")
local registry = require("ir.registry")
local canonical = require("ir.canonical")
local prims = require("ir.ops.prims")
local boolean = require("ir.ops.boolean")
local xform = require("ir.ops.xform")
local route = require("ir.ops.route")
local frames = require("ir.ops.frames")
local measure = require("ir.ops.measure")
local chain = require("ir.ops.chain")
local features = require("ir.ops.features")

local eval_mod = {}

local function is_array(t: any): boolean
	if type(t) ~= "table" then
		return false
	end
	local n = #t
	if n == 0 then
		return false
	end
	for k in pairs(t) do
		if type(k) ~= "number" then
			return false
		end
	end
	return true
end

--- Stable ref encoding: shape op-ids recurse to their fingerprints; other fields constant.
local function fingerprint_ref(sel: any, fp_by_id: { [string]: string }): any
	if sel == nil then
		return nil
	end
	if type(sel) ~= "table" then
		return sel
	end
	if is_array(sel) then
		local out = {}
		for i, s in ipairs(sel) do
			out[i] = fingerprint_ref(s, fp_by_id)
		end
		return out
	end
	local out: { [string]: any } = {}
	if type(sel.body) == "string" then
		out.body_fp = fp_by_id[sel.body] or ("?:" .. sel.body)
	end
	if type(sel.created_by) == "string" then
		out.created_by_fp = fp_by_id[sel.created_by] or ("?:" .. sel.created_by)
		if sel.entity ~= nil then
			out.entity = sel.entity
		end
	end
	if type(sel.op) == "string" then
		out.op_fp = fp_by_id[sel.op] or ("?:" .. sel.op)
	end
	if type(sel.frame) == "string" then
		out.frame = sel.frame
	end
	if type(sel.chain) == "string" then
		out.chain_fp = fp_by_id[sel.chain] or ("?:" .. sel.chain)
	end
	if type(sel.chain_op) == "string" then
		out.chain_fp = fp_by_id[sel.chain_op] or ("?:" .. sel.chain_op)
	end
	if type(sel.nth) == "table" then
		out.nth = {
			i = sel.nth.i,
			of = fingerprint_ref(sel.nth.of, fp_by_id),
		}
	end
	for k, v in pairs(sel) do
		if
			out[k] == nil
			and k ~= "body"
			and k ~= "created_by"
			and k ~= "op"
			and k ~= "frame"
			and k ~= "chain"
			and k ~= "chain_op"
			and k ~= "nth"
			and k ~= "entity"
		then
			if type(v) == "table" then
				out[k] = fingerprint_ref(v, fp_by_id)
			else
				out[k] = v
			end
		end
	end
	return out
end

local function fnv1a32_hex(s: string): string
	local h = 2166136261
	for i = 1, #s do
		h = bit32.bxor(h, string.byte(s, i))
		h = bit32.band(h * 16777619, 0xffffffff)
	end
	return string.format("%08x", h)
end

--- Canonical fingerprint for one IR op (after bind). refs recurse via fp_by_id.
function eval_mod.op_fingerprint(op: any, fp_by_id: { [string]: string }?): string
	local map = fp_by_id or {}
	local payload = {
		op = op.op,
		params = op.params or {},
		refs = fingerprint_ref(op.refs, map),
	}
	local s = canonical.encode(payload)
	return "op:" .. tostring(op.op) .. ":" .. fnv1a32_hex(s)
end

--- Fingerprint every op in order; returns map op_id → fingerprint string.
function eval_mod.fingerprint_ops(ops: any): { [string]: string }
	local fp_by_id: { [string]: string } = {}
	if type(ops) ~= "table" then
		return fp_by_id
	end
	for _, op in ipairs(ops) do
		if type(op) == "table" and type(op.id) == "string" then
			local fp = eval_mod.op_fingerprint(op, fp_by_id)
			fp_by_id[op.id] = fp
		end
	end
	return fp_by_id
end

local function want_memo(opts: any): boolean
	if type(opts) ~= "table" then
		return false
	end
	if opts.memo == true or opts.reuse_memo == true then
		return true
	end
	if opts.memo == false or opts.reuse_memo == false then
		return false
	end
	-- Worker sets OccBridge.sessionOpts.memo for scrub executes.
	local so = host.session_opts()
	return so.memo == true
end

-- One handler per registry op. Feature-tier solid ops live in features.luau;
-- measures in measure.luau; prims/boolean/xform/route/frames/chain cover the rest.
local DISPATCH: { [string]: (any, any) -> any } = {
	PrimBox = prims.PrimBox,
	PrimCylinder = prims.PrimCylinder,
	PrimSphere = prims.PrimSphere,
	PrimCone = prims.PrimCone,
	PrimTorus = prims.PrimTorus,
	MakeRectProfile = features.MakeRectProfile,
	BoolCombine = boolean.BoolCombine,
	Translate = xform.Translate,
	Rotate = xform.Rotate,
	Scale = features.Scale,
	RigidXform = xform.RigidXform,
	MirrorCopy = xform.MirrorCopy,
	PushPull = xform.PushPull,
	PatternLinear = xform.PatternLinear,
	PatternPolar = xform.PatternPolar,
	FilletAll = features.FilletAll,
	SpinSolid = features.SpinSolid,
	Offset3d = features.Offset3d,
	HollowBody = features.HollowBody,
	DrillHoleThrough = features.DrillHoleThrough,
	DrillHoleBlind = features.DrillHoleBlind,
	RoutePath = route.RoutePath,
	SweepAlong = route.SweepAlong,
	PipeProfile = features.PipeProfile,
	MemberSweepRect = features.MemberSweepRect,
	AttachFrame = frames.AttachFrame,
	ComposeChain = chain.ComposeChain,
	QueryClash = measure.QueryClash,
	QueryGeom = measure.QueryGeom,
	ExportMesh = measure.ExportMesh,
	MeshStats = measure.MeshStats,
	MassProps = measure.MassProps,
	StepWrite = measure.StepWrite,
}

local function new_env(): { [string]: any }
	return {
		shapes = {},
		frames = {},
		frames_by_op = {},
		measures = {},
		trace = {},
	}
end

local function copy_map(src: any): { [any]: any }
	local out: { [any]: any } = {}
	if type(src) == "table" then
		for k, v in pairs(src) do
			out[k] = v
		end
	end
	return out
end

local function seed_frames(doc: any, env: any)
	if type(doc.frames) == "table" then
		for name, f in pairs(doc.frames) do
			env.frames[name] = f
		end
	end
end

function eval_mod.expand_macros(doc: any): any
	return doc
end

local function prepare(doc: any, opts: any): any
	opts = opts or {}
	local d = doc
	if opts.auto_prepare ~= false then
		d = eval_mod.expand_macros(d)
		local bound = bind_mod.bind_params(d, opts)
		if errors.is_fail(bound) then
			return bound
		end
		d = bound
		local v = validate_mod.validate(d, opts)
		if errors.is_fail(v) then
			return v
		end
		d = v
	end
	return d
end

local function run_op(
	op: any,
	env: any,
	opts: any,
	caps: any,
	wall_t0: number,
	fp_by_id: { [string]: string }?,
	memo: boolean?
): any
	local handler = DISPATCH[op.op]
	if not handler then
		return errors.fail("IR_ERR_UNKNOWN_OP", { op = op.op, op_id = op.id })
	end
	-- Cooperative timers: cannot interrupt mid-cad.call; check boundaries only.
	if caps and caps.wall_clock_ms then
		local elapsed = (os.clock() - wall_t0) * 1000
		if elapsed > caps.wall_clock_ms then
			return errors.fail("IR_ERR_LIMIT", {
				message = "wall_clock_ms exceeded before op " .. tostring(op.id),
				cap = "wall_clock_ms",
				op_id = op.id,
			})
		end
	end

	local fp: string? = nil
	if type(fp_by_id) == "table" and type(op.id) == "string" then
		fp = eval_mod.op_fingerprint(op, fp_by_id)
		fp_by_id[op.id] = fp
	end

	-- Op-level shape memo: identical (op+params+refs) reuses host shape.
	if memo and type(fp) == "string" then
		local hit = host.cache_get(fp)
		if type(hit) == "table" and hit.hit == true and type(hit.shapeId) == "number" then
			env.shapes[op.id] = hit.shapeId
			if opts and opts.trace then
				table.insert(env.trace, {
					op_id = op.id,
					op = op.op,
					t_ms = 0,
					status = "ok",
					memo = "hit",
				})
			end
			return { shapeId = hit.shapeId, _memo = true }
		end
	end

	local t0 = os.clock()
	local ok, result = pcall(function()
		return handler(op, env)
	end)
	local dt = (os.clock() - t0) * 1000
	if opts and opts.trace then
		table.insert(env.trace, {
			op_id = op.id,
			op = op.op,
			t_ms = dt,
			status = if ok and not errors.is_fail(result) then "ok" else "fail",
			memo = if memo then "miss" else nil,
		})
	end
	if caps and caps.per_op_ms and dt > caps.per_op_ms then
		return errors.fail("IR_ERR_LIMIT", {
			message = string.format("per_op_ms exceeded for %s (%.1f ms)", tostring(op.id), dt),
			cap = "per_op_ms",
			op_id = op.id,
			op = op.op,
		})
	end
	if caps and caps.wall_clock_ms then
		local elapsed = (os.clock() - wall_t0) * 1000
		if elapsed > caps.wall_clock_ms then
			return errors.fail("IR_ERR_LIMIT", {
				message = "wall_clock_ms exceeded after op " .. tostring(op.id),
				cap = "wall_clock_ms",
				op_id = op.id,
			})
		end
	end
	if not ok then
		local msg = result
		local code = "IR_ERR_HOST"
		local host_op = nil
		local aborted = nil
		if type(result) == "table" then
			msg = result.message or tostring(result)
			code = result.code or code
			host_op = result.host_op
			-- Preserve cooperative abort so worker can soft-cancel (not user error).
			if result.aborted == true or code == "IR_ERR_ABORTED" then
				aborted = true
				code = "IR_ERR_ABORTED"
			end
		else
			msg = tostring(result)
		end
		return errors.fail(code, {
			message = msg,
			op_id = op.id,
			op = op.op,
			host_op = host_op,
			aborted = aborted,
		})
	end
	if errors.is_fail(result) then
		if result.error and not result.error.op_id then
			result.error.op_id = op.id
			result.error.op = op.op
		end
		return result
	end
	-- Store successful shape creates under fingerprint for the next scrub.
	if memo and type(fp) == "string" and type(env.shapes[op.id]) == "number" then
		host.cache_put(fp, env.shapes[op.id])
	end
	return result
end

local function success_result(env: any, root: string?): { [string]: any }
	return {
		ok = true,
		root = root,
		shapes = env.shapes,
		measures = env.measures,
		frames = env.frames,
		trace = env.trace,
		env = env, -- for eval_pose prior_env
	}
end

local function pick_root(doc: any, env: any, opts: any): string?
	if opts and type(opts.root) == "string" then
		return opts.root
	end
	if type(doc.results) == "table" and type(doc.results.root) == "string" then
		return doc.results.root
	end
	for i = #doc.ops, 1, -1 do
		local op = doc.ops[i]
		if op.op == "ExportMesh" and op.refs and op.refs.shape then
			local s = op.refs.shape
			if type(s.body) == "string" then
				return s.body
			end
			if type(s.created_by) == "string" then
				return s.created_by
			end
			if type(s.op) == "string" then
				return s.op
			end
		end
	end
	for i = #doc.ops, 1, -1 do
		local op = doc.ops[i]
		if env.shapes[op.id] ~= nil then
			return op.id
		end
	end
	return nil
end

function eval_mod.eval(doc: any, opts: any?): any
	opts = opts or {}
	local d = prepare(doc, opts)
	if errors.is_fail(d) then
		return d
	end

	local caps = limits_mod.merge(opts)
	local memo = want_memo(opts)

	-- K17: host freeAll + empty env at full eval start (fail closed if free fails).
	-- skip_free_all: solid.realize mid-session must not wipe unrelated host shapes (route/frames).
	-- memo: free_all under session memo becomes memo_begin (keeps cached shapes).
	if not opts.skip_free_all then
		local free_ok, free_err = host.free_all()
		if not free_ok then
			return errors.fail("IR_ERR_HOST", {
				message = "free_all failed at eval start: " .. tostring(free_err),
				host_op = "free_all",
			})
		end
	elseif memo then
		-- Mid-session eval with memo: still bump generation so keepIds works.
		host.memo_begin()
	end
	local env = new_env()
	seed_frames(d, env)

	local fp_by_id: { [string]: string } = {}
	local wall_t0 = os.clock()
	for _, op in ipairs(d.ops) do
		local r = run_op(op, env, opts, caps, wall_t0, fp_by_id, memo)
		if errors.is_fail(r) then
			r.env_partial = true
			r.shapes = env.shapes
			r.measures = env.measures
			r.frames = env.frames
			r.trace = env.trace
			return r
		end
	end

	local root = pick_root(d, env, opts)
	local res = success_result(env, root)
	if memo then
		res.memo = true
		res.fingerprints = fp_by_id
	end
	return res
end

-- Pose-only re-eval (K19 / §6.8)
function eval_mod.eval_pose(doc: any, prior_env: any, pose_params: { [string]: any }?, opts: any?): any
	opts = opts or {}
	if type(prior_env) ~= "table" or type(prior_env.shapes) ~= "table" then
		return errors.fail("IR_ERR_VALIDATE", { message = "eval_pose requires prior_env from successful eval" })
	end

	local d: { [string]: any } = {}
	for k, v in pairs(doc) do
		d[k] = v
	end
	local params: { [string]: any } = {}
	if type(doc.params) == "table" then
		for k, v in pairs(doc.params) do
			params[k] = v
		end
	end
	if type(pose_params) == "table" then
		for k, v in pairs(pose_params) do
			params[k] = v
		end
	end
	d.params = params

	local bound = bind_mod.bind_params(d, opts)
	if errors.is_fail(bound) then
		return bound
	end
	d = bound

	-- Lightweight re-validate of pose ops only (limits + op params; host-ready)
	local caps = limits_mod.merge(opts)
	local prior_chain_n: number? = nil
	if type(prior_env.measures) == "table" then
		for _, m in pairs(prior_env.measures) do
			if type(m) == "table" and m.kind == "compose_chain" and type(m.n) == "number" then
				prior_chain_n = m.n
				break
			end
		end
	end

	for _, op in ipairs(d.ops) do
		local is_pose = op.op == "ComposeChain"
			or (op.op == "RigidXform" and op.refs and op.refs.chain ~= nil and op.params.matrix4x4 == nil)
		if is_pose then
			local perr = validate_mod.validate_op_params(op, caps)
			if perr then
				return perr
			end
			local ready, missing = registry.host_ready(op.op, op.params, opts.host_available)
			if not ready then
				return errors.fail("IR_ERR_HOST_UNAVAILABLE", {
					message = "host lowerer unavailable for " .. op.op,
					op = op.op,
					op_id = op.id,
					host_op = missing,
				})
			end
			if op.op == "ComposeChain" and prior_chain_n ~= nil then
				local n = #op.params.angles
				if n ~= prior_chain_n then
					return errors.fail("IR_ERR_VALIDATE", {
						message = "eval_pose cannot change ComposeChain joint count ("
							.. tostring(prior_chain_n)
							.. " → "
							.. tostring(n)
							.. ")",
						op_id = op.id,
					})
				end
			end
		end
	end

	-- Deep-copy maps so prior_env is never mutated (Issue 1)
	local env = {
		shapes = copy_map(prior_env.shapes),
		frames = copy_map(prior_env.frames),
		frames_by_op = copy_map(prior_env.frames_by_op),
		measures = copy_map(prior_env.measures),
		trace = {},
	}

	-- Collect superseded place ids; free ONLY after full success so prior_env
	-- host ids stay valid if any rebind fails (re-review Issue 1).
	local pending_free: { number } = {}
	local wall_t0 = os.clock()
	for _, op in ipairs(d.ops) do
		local is_pose = op.op == "ComposeChain"
			or (op.op == "RigidXform" and op.refs and op.refs.chain ~= nil and op.params.matrix4x4 == nil)
		if is_pose then
			local old_place: number? = nil
			if op.op == "RigidXform" then
				local old = env.shapes[op.id]
				if type(old) == "number" then
					old_place = old
					-- Clear map entry so run_op rebinds; do NOT free host yet
					env.shapes[op.id] = nil
				end
			end
			local r = run_op(op, env, opts, caps, wall_t0)
			if errors.is_fail(r) then
				-- Restore map entry for discarded env debug; prior_env still valid
				if old_place ~= nil then
					env.shapes[op.id] = old_place
				end
				r.env_partial = true
				return r
			end
			-- Successful re-place: schedule free of superseded host id if different
			if old_place ~= nil and env.shapes[op.id] ~= old_place then
				table.insert(pending_free, old_place)
			end
		end
	end

	for _, id in ipairs(pending_free) do
		host.shape_free(id)
	end

	local root = pick_root(d, env, opts)
	return success_result(env, root)
end

eval_mod.DISPATCH = DISPATCH

return eval_mod
