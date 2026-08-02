-- @cad route helpers — centerline wires + pipe annulus (always → IR tape when possible)
-- Usage: local route = require("route")

local tools = require("tools")

export type ShapeId = number | string

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

local function tape(): any
	local ok, t = pcall(function()
		return require("ir.tape")
	end)
	if not ok or t == nil then
		error('route: require("ir.tape") unavailable')
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
	error("route: expected IR handle or host id")
end

--- Polyline route wire (open or closed) → RoutePath IR.
function route.make_route(opts: RouteOpts): ShapeId
	local o = opts or ({} :: any)
	return tape().route_path({
		style = "polyline",
		nodes = o.nodes,
		closed = o.closed == true,
	})
end

--- Route with circular bend fillets → RoutePath polyline_bend IR.
function route.make_route_bends(opts: RouteBendsOpts): ShapeId
	local o = opts or ({} :: any)
	return tape().route_path({
		style = "polyline_bend",
		nodes = o.nodes,
		bend_r = o.bend_r or o.bend_radius or 0,
	})
end

--- Hollow pipe (annulus OD/ID) swept along spine → SweepAlong IR.
function route.pipe_annulus(spine: ShapeId, opts: AnnulusOpts): ShapeId
	local o = opts or ({} :: any)
	local inner = o.inner or o.inner_diameter or o.id_bore
	if type(o.od) ~= "number" or type(inner) ~= "number" then
		error("route.pipe_annulus: od and inner required")
	end
	if type(spine) == "string" or is_ir(spine) then
		return tape().sweep_annulus(spine :: string, {
			od = o.od,
			inner = inner,
		})
	end
	return call("pipe_annulus", {
		od = o.od,
		inner = inner,
		spine = host_id(spine),
	}).shapeId
end

--- Convenience: bend route + annulus solid in one call (both via IR when possible).
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
	return route.pipe_annulus(spine, {
		od = o.od,
		inner = o.inner or o.inner_diameter,
	})
end

--- Rectangular structural member along a spine (host tool; no IR MemberSweep yet).
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
		spine = host_id(spine),
	})
	return data.shapeId
end

return route
