-- Feature-tier solid handlers (eval DISPATCH owns these exclusively):
-- Scale, FilletAll, PipeProfile, SpinSolid, Offset3d, HollowBody,
-- DrillHoleThrough, DrillHoleBlind, MakeRectProfile, MemberSweepRect.
-- Measures MassProps / MeshStats / StepWrite live in ir.ops.measure.

local host = require("ir.host")
local errors = require("ir.errors")
local resolve = require("ir.resolve")

local features = {}

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

function features.Scale(op: any, env: any): any
	local p = op.params
	local sid = resolve.resolve_shape(op.refs.shape, env)
	if errors.is_fail(sid) then
		return errors.annotate(sid, { op_id = op.id })
	end
	local origin = vec3(p.origin, { 0, 0, 0 })
	local data = host.call("scale", {
		id = sid,
		cx = origin[1] or p.cx or 0,
		cy = origin[2] or p.cy or 0,
		cz = origin[3] or p.cz or 0,
		factor = p.factor or p.f or 1,
	})
	env.shapes[op.id] = data.shapeId
	return data
end

function features.FilletAll(op: any, env: any): any
	local p = op.params
	local sid = resolve.resolve_shape(op.refs.shape, env)
	if errors.is_fail(sid) then
		return errors.annotate(sid, { op_id = op.id })
	end
	local data = host.call("fillet_all", {
		id = sid,
		radius = p.radius or 0.5,
	})
	env.shapes[op.id] = data.shapeId
	return data
end

function features.PipeProfile(op: any, env: any): any
	local profile = resolve.resolve_shape(op.refs.profile, env)
	if errors.is_fail(profile) then
		return errors.annotate(profile, { op_id = op.id })
	end
	local spine = resolve.resolve_shape(op.refs.spine or op.refs.path, env)
	if errors.is_fail(spine) then
		return errors.annotate(spine, { op_id = op.id })
	end
	local data = host.call("pipe", { profile = profile, spine = spine })
	env.shapes[op.id] = data.shapeId
	return data
end

function features.SpinSolid(op: any, env: any): any
	local p = op.params
	local profile = resolve.resolve_shape(op.refs.profile or op.refs.shape, env)
	if errors.is_fail(profile) then
		return errors.annotate(profile, { op_id = op.id })
	end
	local origin = vec3(p.origin, { 0, 0, 0 })
	local axis = vec3(p.axis, { 0, 0, 1 })
	local data = host.call("revolve", {
		profile = profile,
		px = origin[1] or p.px or 0,
		py = origin[2] or p.py or 0,
		pz = origin[3] or p.pz or 0,
		ax = axis[1] or p.ax or 0,
		ay = axis[2] or p.ay or 0,
		az = axis[3] or p.az or 1,
		angle = p.angle or p.angle_rad or (2 * math.pi),
	})
	env.shapes[op.id] = data.shapeId
	return data
end

function features.Offset3d(op: any, env: any): any
	local p = op.params
	local sid = resolve.resolve_shape(op.refs.shape, env)
	if errors.is_fail(sid) then
		return errors.annotate(sid, { op_id = op.id })
	end
	local offset = p.offset or p.distance
	if type(offset) ~= "number" then
		return errors.fail("IR_ERR_VALIDATE", { message = "Offset3d.offset required", op_id = op.id })
	end
	local data = host.call("offset_3d", { id = sid, offset = offset })
	env.shapes[op.id] = data.shapeId
	return data
end

function features.HollowBody(op: any, env: any): any
	local p = op.params
	local sid = resolve.resolve_shape(op.refs.shape, env)
	if errors.is_fail(sid) then
		return errors.annotate(sid, { op_id = op.id })
	end
	local faces = p.faces or p.face_idx
	if type(faces) ~= "table" then
		return errors.fail("IR_ERR_VALIDATE", {
			message = "HollowBody.faces (1-based indices) required",
			op_id = op.id,
		})
	end
	local data = host.call("shell", {
		id = sid,
		faces = faces,
		thickness = p.thickness or p.t or 0.1,
	})
	env.shapes[op.id] = data.shapeId
	return data
end

function features.DrillHoleThrough(op: any, env: any): any
	local p = op.params
	local sid = resolve.resolve_shape(op.refs.shape or op.refs.solid, env)
	if errors.is_fail(sid) then
		return errors.annotate(sid, { op_id = op.id })
	end
	local origin = vec3(p.origin, { 0, 0, 0 })
	local dir = vec3(p.direction or p.dir, { 0, 0, 1 })
	local diameter = p.diameter or p.d
	if type(diameter) ~= "number" then
		return errors.fail("IR_ERR_VALIDATE", {
			message = "DrillHoleThrough.diameter required",
			op_id = op.id,
		})
	end
	local data = host.call("drill_hole_through", {
		id = sid,
		cx = origin[1] or p.cx or p.ox or 0,
		cy = origin[2] or p.cy or p.oy or 0,
		cz = origin[3] or p.cz or p.oz or 0,
		dx = dir[1] or p.dx or 0,
		dy = dir[2] or p.dy or 0,
		dz = dir[3] or p.dz or 1,
		diameter = diameter,
	})
	env.shapes[op.id] = data.shapeId
	return data
end

function features.DrillHoleBlind(op: any, env: any): any
	local p = op.params
	local sid = resolve.resolve_shape(op.refs.shape or op.refs.solid, env)
	if errors.is_fail(sid) then
		return errors.annotate(sid, { op_id = op.id })
	end
	local origin = vec3(p.origin, { 0, 0, 0 })
	local dir = vec3(p.direction or p.dir, { 0, 0, 1 })
	local diameter = p.diameter or p.d
	if type(diameter) ~= "number" then
		return errors.fail("IR_ERR_VALIDATE", {
			message = "DrillHoleBlind.diameter required",
			op_id = op.id,
		})
	end
	if type(p.depth) ~= "number" then
		return errors.fail("IR_ERR_VALIDATE", {
			message = "DrillHoleBlind.depth required",
			op_id = op.id,
		})
	end
	local data = host.call("drill_hole_blind", {
		id = sid,
		ox = origin[1] or p.ox or p.cx or 0,
		oy = origin[2] or p.oy or p.cy or 0,
		oz = origin[3] or p.oz or p.cz or 0,
		dx = dir[1] or p.dx or 0,
		dy = dir[2] or p.dy or 0,
		dz = dir[3] or p.dz or 1,
		diameter = diameter,
		depth = p.depth,
	})
	env.shapes[op.id] = data.shapeId
	return data
end

function features.MakeRectProfile(op: any, env: any): any
	local p = op.params
	local origin = vec3(p.origin, { 0, 0, 0 })
	local normal = vec3(p.normal or p.n, { 0, 0, 1 })
	local width = p.width or p.dx
	local height = p.height or p.dy
	if type(width) ~= "number" or type(height) ~= "number" then
		return errors.fail("IR_ERR_VALIDATE", {
			message = "MakeRectProfile.width and height required",
			op_id = op.id,
		})
	end
	local data = host.call("make_face_rectangle", {
		cx = origin[1] or p.cx or 0,
		cy = origin[2] or p.cy or 0,
		cz = origin[3] or p.cz or 0,
		nx = normal[1] or p.nx or 0,
		ny = normal[2] or p.ny or 0,
		nz = normal[3] or p.nz or 1,
		width = width,
		height = height,
	})
	env.shapes[op.id] = data.shapeId
	return data
end

function features.MemberSweepRect(op: any, env: any): any
	local p = op.params
	local spine = resolve.resolve_shape(op.refs.spine or op.refs.path, env)
	if errors.is_fail(spine) then
		return errors.annotate(spine, { op_id = op.id })
	end
	local width = p.width or p.w
	local height = p.height or p.h
	if type(width) ~= "number" or type(height) ~= "number" then
		return errors.fail("IR_ERR_VALIDATE", {
			message = "MemberSweepRect.width and height required",
			op_id = op.id,
		})
	end
	local data = host.call("member_sweep_rect", {
		width = width,
		height = height,
		spine = spine,
	})
	env.shapes[op.id] = data.shapeId
	return data
end

return features
