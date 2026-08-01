-- @cad route helpers — centerline wires + pipe annulus (AI-BOOST Path B)
-- Usage: local route = require("route")

local tools = require("tools")

export type ShapeId = number

export type RouteOpts = {
	nodes: { any },
	closed: boolean?,
	n_points: number?,
}

export type RouteBendsOpts = {
	nodes: { any },
	bend_r: number?,
	bend_radius: number?,
	n_points: number?,
}

export type AnnulusOpts = {
	od: number,
	inner: number?,
	inner_diameter: number?,
	id_bore: number?,
}

local route = {}

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

--- Flatten nested {{x,y,z},…} or flat {x,y,z,x,y,z,…} into a flat number array.
local function flatten_nodes(nodes: { any }): ({ number }, number)
	if type(nodes) ~= "table" or #nodes == 0 then
		error("route: nodes must be a non-empty array")
	end
	local first = nodes[1]
	if type(first) == "number" then
		local n = math.floor(#nodes / 3)
		if n < 2 or #nodes < n * 3 then
			error("route: flat nodes need length >= 6 (n_points>=2)")
		end
		local flat: { number } = {}
		for i = 1, n * 3 do
			flat[i] = nodes[i] :: number
		end
		return flat, n
	end
	local flat: { number } = {}
	local n = 0
	for i, p in ipairs(nodes) do
		if type(p) ~= "table" then
			error("route: nodes[" .. i .. "] must be Vec3 table")
		end
		local x = (p :: any)[1] or (p :: any).x
		local y = (p :: any)[2] or (p :: any).y
		local z = (p :: any)[3] or (p :: any).z
		if type(x) ~= "number" or type(y) ~= "number" or type(z) ~= "number" then
			error("route: nodes[" .. i .. "] components must be numbers")
		end
		table.insert(flat, x)
		table.insert(flat, y)
		table.insert(flat, z)
		n += 1
	end
	if n < 2 then
		error("route: need at least 2 points")
	end
	return flat, n
end

--- Polyline route wire (open or closed).
function route.make_route(opts: RouteOpts): ShapeId
	local o = opts or ({} :: any)
	local flat, n = flatten_nodes(o.nodes)
	local data = call("make_route", {
		nodes = flat,
		n_points = o.n_points or n,
		closed = o.closed == true,
	})
	return data.shapeId
end

--- Route with circular bend fillets (G1 spine for pipe annulus).
function route.make_route_bends(opts: RouteBendsOpts): ShapeId
	local o = opts or ({} :: any)
	local flat, n = flatten_nodes(o.nodes)
	local data = call("make_route_bends", {
		nodes = flat,
		n_points = o.n_points or n,
		bend_r = o.bend_r or o.bend_radius or 0,
	})
	return data.shapeId
end

--- Hollow pipe (annulus OD/ID) swept along spine wire.
function route.pipe_annulus(spine: ShapeId, opts: AnnulusOpts): ShapeId
	local o = opts or ({} :: any)
	local inner = o.inner or o.inner_diameter or o.id_bore
	if type(o.od) ~= "number" or type(inner) ~= "number" then
		error("route.pipe_annulus: od and inner required")
	end
	local data = call("pipe_annulus", {
		od = o.od,
		inner = inner,
		spine = spine,
	})
	return data.shapeId
end

--- Convenience: bend route + annulus solid in one call.
--- Intermediate spine wire is freed after annulus (result ownership only).
function route.pipe_run(opts: {
	nodes: { any },
	bend_r: number?,
	bend_radius: number?,
	od: number,
	inner: number?,
	inner_diameter: number?,
}): ShapeId
	local o = opts
	local spine = route.make_route_bends({
		nodes = o.nodes,
		bend_r = o.bend_r or o.bend_radius,
	})
	local solid = route.pipe_annulus(spine, {
		od = o.od,
		inner = o.inner or o.inner_diameter,
	})
	-- Best-effort free intermediate wire (not needed after annulus owns geometry).
	pcall(function()
		call("shape_free", { id = spine })
	end)
	return solid
end

--- Rectangular structural member along a spine (C: occ_member_sweep_rect; seed home also solid.member_sweep_rect).
function route.member_sweep_rect(spine: ShapeId, opts: {
	width: number?,
	height: number?,
	w: number?,
	h: number?,
}?): ShapeId
	local o = opts or ({} :: any)
	local width = o.width or o.w
	local height = o.height or o.h
	if type(width) ~= "number" or type(height) ~= "number" then
		error("route.member_sweep_rect: width and height required")
	end
	local data = call("member_sweep_rect", {
		width = width,
		height = height,
		spine = spine,
	})
	return data.shapeId
end

return route
