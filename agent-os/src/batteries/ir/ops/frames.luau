-- AttachFrame pure POD (no host required freestanding)

local errors = require("ir.errors")

local frames = {}

local function v3(t: any): { number }
	return {
		(t[1] or t.x or 0) :: number,
		(t[2] or t.y or 0) :: number,
		(t[3] or t.z or 0) :: number,
	}
end

local function cross(a: { number }, b: { number }): { number }
	return {
		a[2] * b[3] - a[3] * b[2],
		a[3] * b[1] - a[1] * b[3],
		a[1] * b[2] - a[2] * b[1],
	}
end

local function dot(a: { number }, b: { number }): number
	return a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
end

local function norm(a: { number }): number
	return math.sqrt(dot(a, a))
end

local function unit(a: { number }): { number }
	local n = norm(a)
	if n < 1e-15 then
		return { 0, 0, 0 }
	end
	return { a[1] / n, a[2] / n, a[3] / n }
end

local function sub(a: { number }, b: { number }): { number }
	return { a[1] - b[1], a[2] - b[2], a[3] - b[3] }
end

local function scale(a: { number }, s: number): { number }
	return { a[1] * s, a[2] * s, a[3] * s }
end

--- Orthonormalize from origin + z + optional x hint (matches occ_frame_from_axes intent).
function frames.frame_from_axes(origin: { number }, xhint: { number }?, z: { number }): { [string]: number }
	local Z = unit(z)
	if norm(Z) < 1e-12 then
		error("AttachFrame: z must be non-zero")
	end
	local Xh = xhint or { 1, 0, 0 }
	-- If X nearly parallel to Z, pick alternate
	if math.abs(dot(unit(Xh), Z)) > 0.999 then
		if math.abs(Z[1]) < 0.9 then
			Xh = { 1, 0, 0 }
		else
			Xh = { 0, 1, 0 }
		end
	end
	local Y = unit(cross(Z, Xh))
	-- Recompute X = Y × Z? Standard: Y = Z × X, X = Y × Z for right-handed
	-- Design: Y = z × x orthonormalized
	Y = unit(cross(Z, unit(Xh)))
	if norm(Y) < 1e-12 then
		Y = unit(cross(Z, { 0, 1, 0 }))
		if norm(Y) < 1e-12 then
			Y = unit(cross(Z, { 1, 0, 0 }))
		end
	end
	local X = unit(cross(Y, Z))
	return {
		ox = origin[1],
		oy = origin[2],
		oz = origin[3],
		xx = X[1],
		xy = X[2],
		xz = X[3],
		yx = Y[1],
		yy = Y[2],
		yz = Y[3],
		zx = Z[1],
		zy = Z[2],
		zz = Z[3],
	}
end

function frames.AttachFrame(op: any, env: any): any
	local p = op.params
	if p.face or (op.refs and op.refs.face) then
		return errors.fail("IR_ERR_UNSUPPORTED", {
			message = "AttachFrame face attach unsupported freestanding",
			op_id = op.id,
		})
	end
	local origin = v3(p.origin)
	local z = v3(p.z)
	local x = if type(p.x) == "table" then v3(p.x) else nil
	local ok, pod = pcall(function()
		return frames.frame_from_axes(origin, x, z)
	end)
	if not ok then
		return errors.fail("IR_ERR_VALIDATE", { message = tostring(pod), op_id = op.id })
	end
	env.frames[p.name] = pod
	-- also index by op id for convenience (optional)
	env.frames_by_op[op.id] = pod
	return { frame = pod, name = p.name }
end

return frames
