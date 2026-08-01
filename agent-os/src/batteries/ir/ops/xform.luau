-- Translate / Rotate / RigidXform / MirrorCopy / PushPull

local host = require("ir.host")
local errors = require("ir.errors")
local resolve = require("ir.resolve")

local xform = {}

local function vec3(v: any, default: { number }): { number }
	if type(v) ~= "table" then
		return default
	end
	return {
		(v[1] or v.x or 0) :: number,
		(v[2] or v.y or 0) :: number,
		(v[3] or v.z or 0) :: number,
	}
end

function xform.Translate(op: any, env: any): any
	local p = op.params
	local sid = resolve.resolve_shape(op.refs.shape, env)
	if errors.is_fail(sid) then
		return errors.annotate(sid, { op_id = op.id })
	end
	local data = host.call("translate", {
		id = sid,
		dx = p.dx or 0,
		dy = p.dy or 0,
		dz = p.dz or 0,
	})
	env.shapes[op.id] = data.shapeId
	return data
end

function xform.Rotate(op: any, env: any): any
	local p = op.params
	local sid = resolve.resolve_shape(op.refs.shape, env)
	if errors.is_fail(sid) then
		return errors.annotate(sid, { op_id = op.id })
	end
	local origin = vec3(p.origin, { 0, 0, 0 })
	local axis = vec3(p.axis, { 0, 0, 1 })
	local data = host.call("rotate", {
		id = sid,
		px = origin[1],
		py = origin[2],
		pz = origin[3],
		ax = axis[1],
		ay = axis[2],
		az = axis[3],
		angle = p.angle or p.angle_rad or 0,
	})
	env.shapes[op.id] = data.shapeId
	return data
end

function xform.RigidXform(op: any, env: any): any
	local p = op.params
	local sid = resolve.resolve_shape(op.refs.shape, env)
	if errors.is_fail(sid) then
		return errors.annotate(sid, { op_id = op.id })
	end
	local matrix = p.matrix4x4
	if matrix == nil and op.refs.chain then
		local chain = resolve.resolve_chain(op.refs.chain, env)
		if errors.is_fail(chain) then
			return errors.annotate(chain, { op_id = op.id })
		end
		local idx = p.prefix_index
		if type(idx) ~= "number" or idx < 0 or idx >= chain.n then
			return errors.fail("IR_ERR_VALIDATE", {
				message = "prefix_index OOB: " .. tostring(idx),
				op_id = op.id,
			})
		end
		-- prefixes is 1-based in Luau array from host (JSON array)
		matrix = chain.prefixes[idx + 1]
		if matrix == nil then
			return errors.fail("IR_ERR_SELECTOR", { message = "missing prefix matrix", op_id = op.id })
		end
	end
	if type(matrix) ~= "table" or #matrix < 16 then
		return errors.fail("IR_ERR_VALIDATE", { message = "matrix4x4 length 16 required", op_id = op.id })
	end
	local data = host.call("trsf_apply", { id = sid, matrix4x4 = matrix })
	env.shapes[op.id] = data.shapeId
	return data
end

function xform.MirrorCopy(op: any, env: any): any
	local p = op.params
	local sid = resolve.resolve_shape(op.refs.shape, env)
	if errors.is_fail(sid) then
		return errors.annotate(sid, { op_id = op.id })
	end
	local point = vec3(p.point or p.origin, { 0, 0, 0 })
	local normal = vec3(p.normal or p.n, { 0, 0, 1 })
	local data = host.call("mirror", {
		id = sid,
		px = point[1],
		py = point[2],
		pz = point[3],
		nx = normal[1],
		ny = normal[2],
		nz = normal[3],
	})
	env.shapes[op.id] = data.shapeId
	return data
end

function xform.PushPull(op: any, env: any): any
	local p = op.params
	local profile = resolve.resolve_shape(op.refs.profile or op.refs.shape, env)
	if errors.is_fail(profile) then
		return errors.annotate(profile, { op_id = op.id })
	end
	local data = host.call("extrude", {
		profile = profile,
		dx = p.dx or 0,
		dy = p.dy or 0,
		dz = p.dz or p.height or 1,
	})
	env.shapes[op.id] = data.shapeId
	return data
end

function xform.PatternLinear(op: any, env: any): any
	local p = op.params
	local sid = resolve.resolve_shape(op.refs.shape or op.refs.seed, env)
	if errors.is_fail(sid) then
		return errors.annotate(sid, { op_id = op.id })
	end
	local data = host.call("pattern_linear", {
		id = sid,
		dx = p.dx or 0,
		dy = p.dy or 0,
		dz = p.dz or 0,
		count = p.count or 2,
	})
	env.shapes[op.id] = data.shapeId
	return data
end

function xform.PatternPolar(op: any, env: any): any
	local p = op.params
	local sid = resolve.resolve_shape(op.refs.shape or op.refs.seed, env)
	if errors.is_fail(sid) then
		return errors.annotate(sid, { op_id = op.id })
	end
	local origin = vec3(p.origin, { 0, 0, 0 })
	local axis = vec3(p.axis, { 0, 0, 1 })
	local data = host.call("pattern_polar", {
		id = sid,
		px = origin[1],
		py = origin[2],
		pz = origin[3],
		ax = axis[1],
		ay = axis[2],
		az = axis[3],
		angle_step = p.angle_step or p.angle_step_rad or (math.pi / 2),
		count = p.count or 4,
	})
	env.shapes[op.id] = data.shapeId
	return data
end

return xform
