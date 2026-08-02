-- @cad route helpers — centerline wires + pipe annulus (always IR tape).
-- Usage: local route = require("route")
--
-- Policy: route.* records cad.ir ops on the session tape. Never host call for
-- geometry authoring. Spine args must be IR tape handles (string).

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

--- Require an IR tape handle for authoring (never host geometry call).
local function ir_id(id: ShapeId, where: string): string
	if type(id) == "string" then
		return id
	end
	error(
		where
			.. ": expected IR tape handle (string); route.* authoring is tape-only — do not realize mid-chain"
	)
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
	return tape().sweep_annulus(ir_id(spine, "route.pipe_annulus"), {
		od = o.od,
		inner = inner,
	})
end

--- Convenience: bend route + annulus solid in one call (both via IR tape).
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

--- Rectangular structural member along a spine → MemberSweepRect IR tape op.
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
	return tape().member_sweep_rect(ir_id(spine, "route.member_sweep_rect"), {
		width = width,
		height = height,
	})
end

return route
