-- RoutePath + SweepAlong (annulus)

local host = require("ir.host")
local errors = require("ir.errors")
local resolve = require("ir.resolve")

local route = {}

local function flatten_nodes(nodes: { any }): (any, number?)
	local flat: { number } = {}
	local n = 0
	for i, p in ipairs(nodes) do
		if type(p) ~= "table" then
			return errors.fail("IR_ERR_VALIDATE", {
				message = "RoutePath.nodes[" .. i .. "] must be Vec3 table",
			}), nil
		end
		local x = p[1] or p.x
		local y = p[2] or p.y
		local z = p[3] or p.z
		if type(x) ~= "number" or type(y) ~= "number" or type(z) ~= "number" then
			return errors.fail("IR_ERR_VALIDATE", {
				message = "RoutePath.nodes[" .. i .. "] components must be numbers",
			}), nil
		end
		table.insert(flat, x)
		table.insert(flat, y)
		table.insert(flat, z)
		n += 1
	end
	if #flat ~= n * 3 then
		return errors.fail("IR_ERR_VALIDATE", { message = "RoutePath flat length mismatch" }), nil
	end
	return flat, n
end

function route.RoutePath(op: any, env: any): any
	local p = op.params
	local style = p.style or "polyline"
	local flat, n = flatten_nodes(p.nodes)
	if errors.is_fail(flat) then
		return errors.annotate(flat, { op_id = op.id })
	end
	local data
	if style == "polyline_bend" then
		data = host.call("make_route_bends", {
			nodes = flat,
			n_points = n,
			bend_r = p.bend_r or p.bend_radius or 0,
		})
	elseif style == "polyline" then
		data = host.call("make_route", {
			nodes = flat,
			n_points = n,
			closed = p.closed == true,
		})
	else
		return errors.fail("IR_ERR_VALIDATE", { message = "bad RoutePath.style", op_id = op.id })
	end
	env.shapes[op.id] = data.shapeId
	return data
end

function route.SweepAlong(op: any, env: any): any
	local p = op.params
	local kind = p.profile_kind or "annulus"
	if kind ~= "annulus" then
		return errors.fail("IR_ERR_UNSUPPORTED", {
			message = "SweepAlong only annulus in v0",
			op_id = op.id,
		})
	end
	local spine = resolve.resolve_shape(op.refs.path, env)
	if errors.is_fail(spine) then
		return errors.annotate(spine, { op_id = op.id })
	end
	local data = host.call("pipe_annulus", {
		od = p.od,
		inner = p.inner or p.inner_diameter,
		spine = spine,
	})
	env.shapes[op.id] = data.shapeId
	return data
end

return route
