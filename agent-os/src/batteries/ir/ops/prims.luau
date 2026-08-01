-- PrimBox / PrimCylinder / Tier B prims

local host = require("ir.host")
local errors = require("ir.errors")

local prims = {}

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

function prims.PrimBox(op: any, env: any): any
	local p = op.params
	local data = host.call("make_box", { dx = p.dx, dy = p.dy, dz = p.dz })
	local shapeId = data.shapeId
	local corner = p.corner or "origin"
	if corner == "centered_xy_bottom" then
		local seed = shapeId
		local t = host.call("translate", {
			id = seed,
			dx = -p.dx / 2,
			dy = -p.dy / 2,
			dz = 0,
		})
		shapeId = t.shapeId
		-- Seed is unreferenced; free immediately (K17 intermediates otherwise retained until freeAll).
		host.shape_free(seed)
	elseif corner ~= "origin" then
		return errors.fail("IR_ERR_VALIDATE", {
			message = "PrimBox.corner must be origin|centered_xy_bottom",
			op_id = op.id,
		})
	end
	env.shapes[op.id] = shapeId
	return { shapeId = shapeId }
end

function prims.PrimCylinder(op: any, env: any): any
	local p = op.params
	local origin = vec3(p.origin, { 0, 0, 0 })
	local axis = vec3(p.axis, { 0, 0, 1 })
	local data = host.call("make_cylinder", {
		cx = origin[1],
		cy = origin[2],
		cz = origin[3],
		ax = axis[1],
		ay = axis[2],
		az = axis[3],
		radius = p.radius,
		height = p.height,
	})
	env.shapes[op.id] = data.shapeId
	return data
end

function prims.PrimSphere(op: any, env: any): any
	local p = op.params
	local origin = vec3(p.origin, { 0, 0, 0 })
	local data = host.call("make_sphere", {
		cx = origin[1],
		cy = origin[2],
		cz = origin[3],
		radius = p.radius,
	})
	env.shapes[op.id] = data.shapeId
	return data
end

function prims.PrimCone(op: any, env: any): any
	local p = op.params
	local origin = vec3(p.origin, { 0, 0, 0 })
	local axis = vec3(p.axis, { 0, 0, 1 })
	local data = host.call("make_cone", {
		cx = origin[1],
		cy = origin[2],
		cz = origin[3],
		ax = axis[1],
		ay = axis[2],
		az = axis[3],
		r1 = p.r1 or p.radius1,
		r2 = p.r2 or p.radius2 or 0,
		height = p.height,
	})
	env.shapes[op.id] = data.shapeId
	return data
end

function prims.PrimTorus(op: any, env: any): any
	local p = op.params
	local origin = vec3(p.origin, { 0, 0, 0 })
	local axis = vec3(p.axis, { 0, 0, 1 })
	local data = host.call("make_torus", {
		cx = origin[1],
		cy = origin[2],
		cz = origin[3],
		ax = axis[1],
		ay = axis[2],
		az = axis[3],
		major_r = p.major_r or p.majorR or p.R,
		minor_r = p.minor_r or p.minorR or p.r,
	})
	env.shapes[op.id] = data.shapeId
	return data
end

return prims
