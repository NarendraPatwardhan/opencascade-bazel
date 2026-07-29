-- @cad solid helpers — call host cad.call tools via require("tools")
local tools = require("tools")
local json = require("json")

local solid = {}

local function call(op, args)
	local payload = args or {}
	payload.op = op
	local res = tools.call("host.org.main.cad.call", payload)
	if type(res) ~= "table" then
		error("cad.call returned non-table")
	end
	if res.ok == false then
		local msg = "cad.call failed"
		if type(res.err) == "table" and res.err.message then
			msg = res.err.message
		elseif type(res.err) == "string" then
			msg = res.err
		end
		error(msg)
	end
	return res.data
end

function solid.box(opts)
	opts = opts or {}
	local data = call("make_box", {
		dx = opts.dx or opts.x or 10,
		dy = opts.dy or opts.y or 10,
		dz = opts.dz or opts.z or 10,
	})
	return data.shapeId
end

function solid.cylinder(opts)
	opts = opts or {}
	local o = opts.origin or {}
	local a = opts.axis or { 0, 0, 1 }
	local data = call("make_cylinder", {
		cx = o[1] or opts.cx or 0,
		cy = o[2] or opts.cy or 0,
		cz = o[3] or opts.cz or 0,
		ax = a[1] or 0,
		ay = a[2] or 0,
		az = a[3] or 1,
		radius = opts.radius or 1,
		height = opts.height or 1,
	})
	return data.shapeId
end

function solid.sphere(opts)
	opts = opts or {}
	local o = opts.origin or {}
	local data = call("make_sphere", {
		cx = o[1] or opts.cx or 0,
		cy = o[2] or opts.cy or 0,
		cz = o[3] or opts.cz or 0,
		radius = opts.radius or 1,
	})
	return data.shapeId
end

function solid.fuse(a, b)
	return call("fuse", { a = a, b = b }).shapeId
end

function solid.cut(a, b)
	return call("cut", { a = a, b = b }).shapeId
end

function solid.translate(id, opts)
	opts = opts or {}
	return call("translate", {
		id = id,
		dx = opts.dx or 0,
		dy = opts.dy or 0,
		dz = opts.dz or 0,
	}).shapeId
end

function solid.fillet_all(id, opts)
	opts = opts or {}
	return call("fillet_all", { id = id, radius = opts.radius or 0.5 }).shapeId
end

function solid.volume(id)
	return call("volume", { id = id }).volume
end

function solid.bbox(id)
	return call("bbox", { id = id }).bbox
end

-- Emit a single JSON result line the host can parse.
function solid.finish(rootId, extra)
	local payload = {
		schema = 1,
		root = rootId,
	}
	if type(extra) == "table" then
		for k, v in pairs(extra) do
			payload[k] = v
		end
	end
	print("__OCC_CAD_RESULT__" .. json.encode(payload))
	return rootId
end

return solid
