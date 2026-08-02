-- @cad frames + serial FK helpers (ComposeChain / RigidXform always via IR tape).
-- Usage: local frames = require("frames")
--
-- Policy: frames.* authoring records cad.ir ops on the session tape. Shape args
-- must be IR tape handles (string). Pure POD helpers (identity, translation)
-- stay host-free math.

export type ShapeId = number | string

export type FramePod = {
	ox: number,
	oy: number,
	oz: number,
	xx: number,
	xy: number,
	xz: number,
	yx: number,
	yy: number,
	yz: number,
	zx: number,
	zy: number,
	zz: number,
}

export type ComposeChainResult = {
	n: number,
	prefixes: { { number } },
	final: { number },
	_ir_id: string?,
}

local frames = {}

local function tape(): any
	local ok, t = pcall(function()
		return require("ir.tape")
	end)
	if not ok or t == nil then
		error('frames: require("ir.tape") unavailable')
	end
	t.ensure("session")
	return t
end

--- Require an IR tape handle for authoring (never host geometry call).
local function ir_id(id: ShapeId, where: string): string
	if type(id) == "string" then
		return id
	end
	error(
		where
			.. ": expected IR tape handle (string); frames.* authoring is tape-only — do not realize mid-chain"
	)
end

local function flatten_vec3_list(list: { any }, n: number?): ({ number }, number)
	if type(list) ~= "table" then
		error("frames: Vec3 list required")
	end
	local first = list[1]
	if type(first) == "number" then
		local count = n or math.floor(#list / 3)
		if #list < count * 3 then
			error("frames: flat Vec3 list too short")
		end
		local flat: { number } = {}
		for i = 1, count * 3 do
			flat[i] = list[i] :: number
		end
		return flat, count
	end
	local count = n or #list
	local flat: { number } = {}
	for i = 1, count do
		local p = list[i]
		if type(p) ~= "table" then
			error("frames: Vec3[" .. i .. "] must be table")
		end
		local x = (p :: any)[1] or (p :: any).x
		local y = (p :: any)[2] or (p :: any).y
		local z = (p :: any)[3] or (p :: any).z
		if type(x) ~= "number" or type(y) ~= "number" or type(z) ~= "number" then
			error("frames: Vec3[" .. i .. "] components must be numbers")
		end
		table.insert(flat, x)
		table.insert(flat, y)
		table.insert(flat, z)
	end
	return flat, count
end

--- Orthonormal frame from origin + X hint + Z via pure IR AttachFrame.
function frames.from_axes(opts: {
	origin: { number }?,
	ox: number?,
	oy: number?,
	oz: number?,
	x: { number }?,
	z: { number }?,
	xx: number?,
	xy: number?,
	xz: number?,
	zx: number?,
	zy: number?,
	zz: number?,
	name: string?,
}?): FramePod
	local o = opts or {}
	local origin_t = o.origin or {}
	local x_t = o.x
	local z_t = o.z or {}
	local origin = {
		(origin_t :: any)[1] or o.ox or 0,
		(origin_t :: any)[2] or o.oy or 0,
		(origin_t :: any)[3] or o.oz or 0,
	}
	local z = {
		(z_t :: any)[1] or o.zx or 0,
		(z_t :: any)[2] or o.zy or 0,
		(z_t :: any)[3] or o.zz or 1,
	}
	local x: { number }?
	if type(x_t) == "table" and ((x_t :: any)[1] ~= nil or (x_t :: any).x ~= nil) then
		x = {
			(x_t :: any)[1] or (x_t :: any).x or 1,
			(x_t :: any)[2] or (x_t :: any).y or 0,
			(x_t :: any)[3] or (x_t :: any).z or 0,
		}
	elseif o.xx ~= nil then
		x = { o.xx or 1, o.xy or 0, o.xz or 0 }
	end
	local t = tape()
	local id = t.attach_frame({
		name = o.name,
		origin = origin,
		z = z,
		x = x,
	})
	return t.eval_frame(id)
end

--- Serial FK via IR ComposeChain; returns POD (+ _ir_id for place_at_chain).
function frames.compose_chain(opts: {
	origins: { any },
	axes: { any },
	angles: { number },
	n: number?,
	want_prefixes: boolean?,
}): ComposeChainResult
	local o = opts
	local angles = o.angles
	if type(angles) ~= "table" or #angles < 1 then
		error("frames.compose_chain: angles required (n>=1)")
	end
	local n = o.n or #angles
	-- Keep nested Vec3 tables for IR (ComposeChain handler flattens)
	local origins_t: { any } = {}
	local axes_t: { any } = {}
	if type(o.origins[1]) == "number" then
		for i = 1, n do
			local b = (i - 1) * 3
			origins_t[i] = { o.origins[b + 1], o.origins[b + 2], o.origins[b + 3] }
		end
	else
		origins_t = o.origins
	end
	if type(o.axes[1]) == "number" then
		for i = 1, n do
			local b = (i - 1) * 3
			axes_t[i] = { o.axes[b + 1], o.axes[b + 2], o.axes[b + 3] }
		end
	else
		axes_t = o.axes
	end
	return tape().compose_chain({
		origins = origins_t,
		axes = axes_t,
		angles = angles,
	})
end

--- Apply row-major 4×4 rigid transform → new shape (IR RigidXform).
function frames.trsf_apply(id: ShapeId, matrix4x4: { number }): ShapeId
	if type(matrix4x4) ~= "table" or #matrix4x4 < 16 then
		error("frames.trsf_apply: matrix4x4 length 16 required")
	end
	return tape().rigid_xform(ir_id(id, "frames.trsf_apply"), { matrix4x4 = matrix4x4 })
end

--- Place shape at chain.final, or at prefixes[prefix_1based] (Luau 1-based: 1..n).
function frames.place_at_chain(id: ShapeId, chain: ComposeChainResult, prefix_1based: number?): ShapeId
	local shape_key = ir_id(id, "frames.place_at_chain")
	if type(chain) ~= "table" then
		error("frames.place_at_chain: chain required")
	end
	if type(chain._ir_id) == "string" then
		if prefix_1based == nil then
			return tape().rigid_xform(shape_key, { chain = chain, matrix4x4 = chain.final })
		end
		local idx = prefix_1based :: number
		if idx < 1 or idx > chain.n then
			error("frames.place_at_chain: prefix_1based out of range (need 1..n)")
		end
		return tape().rigid_xform(shape_key, {
			chain = chain,
			prefix_1based = prefix_1based,
		})
	end
	-- Chain without IR id: bake matrix via RigidXform
	local matrix: { number }
	if prefix_1based == nil then
		matrix = chain.final
	else
		local idx = prefix_1based :: number
		if idx < 1 or idx > chain.n then
			error("frames.place_at_chain: prefix_1based out of range (need 1..n)")
		end
		matrix = chain.prefixes[idx]
		if matrix == nil then
			error("frames.place_at_chain: missing prefix matrix")
		end
	end
	return tape().rigid_xform(shape_key, { matrix4x4 = matrix })
end

function frames.place(id: ShapeId, chain: ComposeChainResult, prefix_1based: number?): ShapeId
	return frames.place_at_chain(id, chain, prefix_1based)
end

function frames.identity(): { number }
	return {
		1, 0, 0, 0,
		0, 1, 0, 0,
		0, 0, 1, 0,
		0, 0, 0, 1,
	}
end

function frames.translation(dx: number, dy: number, dz: number): { number }
	return {
		1, 0, 0, dx,
		0, 1, 0, dy,
		0, 0, 1, dz,
		0, 0, 0, 1,
	}
end

return frames
