-- QueryClash / QueryGeom / ExportMesh / MeshStats / MassProps / StepWrite

local host = require("ir.host")
local errors = require("ir.errors")
local resolve = require("ir.resolve")

local measure = {}

local STATUS_NAME = {
	[0] = "separated",
	[1] = "clearance",
	[2] = "interfere",
}

function measure.QueryClash(op: any, env: any): any
	local p = op.params
	local a = resolve.resolve_shape(op.refs.a, env)
	if errors.is_fail(a) then
		return errors.annotate(a, { op_id = op.id })
	end
	local b = resolve.resolve_shape(op.refs.b, env)
	if errors.is_fail(b) then
		return errors.annotate(b, { op_id = op.id })
	end
	local clearance = p.clearance or 0
	local clash = host.call("clash", { a = a, b = b, clearance = clearance })
	local status_code = clash.status
	local status = clash.name
	if type(status) == "string" then
		status = string.lower(status)
	else
		status = STATUS_NAME[status_code] or ("unknown_" .. tostring(status_code))
	end
	local pod: { [string]: any } = {
		kind = "clash",
		status = status,
		status_code = status_code,
	}
	local include_distance = p.include_distance
	if include_distance == nil then
		include_distance = true
	end
	if include_distance then
		local ok, dist = pcall(function()
			return host.call("distance", { a = a, b = b })
		end)
		if ok and type(dist) == "table" then
			pod.distance = dist.distance
		elseif p.distance_optional then
			-- omit distance
		else
			return errors.fail("IR_ERR_HOST", {
				message = "distance failed: " .. tostring(dist),
				op_id = op.id,
			})
		end
	end
	env.measures[op.id] = pod
	return pod
end

function measure.QueryGeom(op: any, env: any): any
	local p = op.params
	local mode = p.mode or "volume"
	local sid = resolve.resolve_shape(op.refs.shape, env)
	if errors.is_fail(sid) then
		return errors.annotate(sid, { op_id = op.id })
	end
	if mode == "volume" then
		local data = host.call("volume", { id = sid })
		local pod = { kind = "geom", mode = "volume", volume = data.volume }
		env.measures[op.id] = pod
		return pod
	elseif mode == "bbox" then
		local data = host.call("bbox", { id = sid })
		local pod = { kind = "geom", mode = "bbox", bbox = data.bbox }
		env.measures[op.id] = pod
		return pod
	end
	return errors.fail("IR_ERR_VALIDATE", { message = "bad QueryGeom.mode", op_id = op.id })
end

function measure.ExportMesh(op: any, env: any): any
	local p = op.params
	local sid = resolve.resolve_shape(op.refs.shape, env)
	if errors.is_fail(sid) then
		return errors.annotate(sid, { op_id = op.id })
	end
	local deflection = p.deflection or 0.001
	-- Stats-only path only — never call full `mesh` over the JSON tool bridge
	-- (re-review Issues 3/7). Soft skip only via params.mesh_optional (v0 alias
	-- for design opts.mesh_in_guest batch path that opts out of guest meshing).
	local ok, res = pcall(function()
		return host.call("mesh_stats", { id = sid, deflection = deflection })
	end)
	if not ok or type(res) ~= "table" then
		if p.mesh_optional == true then
			local pod_skip = { kind = "mesh", deflection = deflection, skipped = true }
			env.measures[op.id] = pod_skip
			return pod_skip
		end
		return errors.fail("IR_ERR_HOST", {
			message = "mesh_stats failed (no full-mesh fallback): " .. tostring(res),
			op_id = op.id,
			host_op = "mesh_stats",
		})
	end
	local pod: { [string]: any } = {
		kind = "mesh",
		deflection = deflection,
		vertexCount = res.vertexCount,
		indexCount = res.indexCount,
	}
	if res.volume ~= nil then
		pod.volume = res.volume
	end
	env.measures[op.id] = pod
	return pod
end

--- Explicit mesh_stats measure (same host as ExportMesh; always requires success).
function measure.MeshStats(op: any, env: any): any
	local p = op.params
	local sid = resolve.resolve_shape(op.refs.shape, env)
	if errors.is_fail(sid) then
		return errors.annotate(sid, { op_id = op.id })
	end
	local deflection = p.deflection or 0.1
	local res = host.call("mesh_stats", { id = sid, deflection = deflection })
	local pod: { [string]: any } = {
		kind = "mesh_stats",
		deflection = deflection,
		vertexCount = res.vertexCount,
		indexCount = res.indexCount,
	}
	if res.volume ~= nil then
		pod.volume = res.volume
	end
	env.measures[op.id] = pod
	return pod
end

function measure.MassProps(op: any, env: any): any
	local p = op.params
	local sid = resolve.resolve_shape(op.refs.shape, env)
	if errors.is_fail(sid) then
		return errors.annotate(sid, { op_id = op.id })
	end
	local density = p.density or 1
	local res = host.call("mass_properties", { id = sid, density = density })
	local pod: { [string]: any } = {
		kind = "mass_props",
		density = density,
		mass = res.mass,
		com = res.com,
		inertia = res.inertia,
	}
	env.measures[op.id] = pod
	return pod
end

function measure.StepWrite(op: any, env: any): any
	local p = op.params
	local sid = resolve.resolve_shape(op.refs.shape, env)
	if errors.is_fail(sid) then
		return errors.annotate(sid, { op_id = op.id })
	end
	local path = p.path or p.file
	if type(path) ~= "string" or path == "" then
		return errors.fail("IR_ERR_VALIDATE", {
			message = "StepWrite.path required (MEMFS)",
			op_id = op.id,
		})
	end
	local res = host.call("step_write", { id = sid, path = path })
	local pod: { [string]: any } = {
		kind = "step_write",
		path = (type(res) == "table" and res.path) or path,
		ok = true,
	}
	env.measures[op.id] = pod
	return pod
end

return measure
