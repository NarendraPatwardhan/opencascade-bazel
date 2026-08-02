-- @cad frames + serial FK helpers (ComposeChain / RigidXform via IR tape when possible)
-- Usage: local frames = require("frames")

local tools = require("tools")

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

local function is_ir(id: any): boolean
	local ok, t = pcall(function()
		return require("ir.tape")
	end)
	return ok and t ~= nil and t.is_handle(id)
end

local function host_id(id: ShapeId): number
	if type(id) == "number" then
		return id
	end
	if is_ir(id) then
		return tape().eval_to_shape(id :: string)
	end
	error("frames: expected IR handle or host id")
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

--- Orthonormal frame from origin + X hint + Z (host POD helper — pure geometry math).
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
}?): FramePod
	local o = opts or {}
	local origin = o.origin or {}
	local x = o.x or {}
	local z = o.z or {}
	local data = call("frame_from_axes", {
		ox = origin[1] or o.ox or 0,
		oy = origin[2] or o.oy or 0,
		oz = origin[3] or o.oz or 0,
		xx = x[1] or o.xx or 1,
		xy = x[2] or o.xy or 0,
		xz = x[3] or o.xz or 0,
		zx = z[1] or o.zx or 0,
		zy = z[2] or o.zy or 0,
		zz = z[3] or o.zz or 1,
	})
	return data.frame
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

--- Apply row-major 4×4 rigid transform → new shape (IR RigidXform when shape is IR handle).
function frames.trsf_apply(id: ShapeId, matrix4x4: { number }): ShapeId
	if type(matrix4x4) ~= "table" or #matrix4x4 < 16 then
		error("frames.trsf_apply: matrix4x4 length 16 required")
	end
	if type(id) == "string" or is_ir(id) then
		return tape().rigid_xform(id :: string, { matrix4x4 = matrix4x4 })
	end
	return call("trsf_apply", { id = host_id(id), matrix4x4 = matrix4x4 }).shapeId
end

--- Place shape at chain.final, or at prefixes[prefix_1based] (Luau 1-based: 1..n).
function frames.place_at_chain(id: ShapeId, chain: ComposeChainResult, prefix_1based: number?): ShapeId
	if type(chain) ~= "table" then
		error("frames.place_at_chain: chain required")
	end
	local shape_key: string
	if type(id) == "string" or is_ir(id) then
		shape_key = id :: string
	else
		-- Host shape cannot enter IR RigidXform refs; materialize not reverse.
		-- Place via host matrix from chain POD.
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
		return call("trsf_apply", { id = id, matrix4x4 = matrix }).shapeId
	end
	if type(chain._ir_id) == "string" then
		if prefix_1based == nil then
			return tape().rigid_xform(shape_key, { chain = chain, matrix4x4 = chain.final })
		end
		return tape().rigid_xform(shape_key, {
			chain = chain,
			prefix_1based = prefix_1based,
		})
	end
	-- Chain without IR id: bake matrix
	local matrix2: { number }
	if prefix_1based == nil then
		matrix2 = chain.final
	else
		matrix2 = chain.prefixes[prefix_1based :: number]
	end
	return tape().rigid_xform(shape_key, { matrix4x4 = matrix2 })
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
