-- IR op registry: host lowerers + bind kinds (Tier A + ready Tier B)

local registry = {}

-- host: string | { modes } | false (pure POD) | "optional"
-- binds: "shape" | "measure" | "frame" | "none"
registry.OPS = {
	PrimBox = { host = "make_box", binds = "shape", tier = "A" },
	PrimCylinder = { host = "make_cylinder", binds = "shape", tier = "A" },
	PrimSphere = { host = "make_sphere", binds = "shape", tier = "B" },
	PrimCone = { host = "make_cone", binds = "shape", tier = "B" },
	PrimTorus = { host = "make_torus", binds = "shape", tier = "B" },
	MakeRectProfile = { host = "make_face_rectangle", binds = "shape", tier = "B" },
	BoolCombine = { host = { union = "fuse", subtract = "cut", intersect = "intersect" }, binds = "shape", tier = "A" },
	Translate = { host = "translate", binds = "shape", tier = "A" },
	Rotate = { host = "rotate", binds = "shape", tier = "A" },
	Scale = { host = "scale", binds = "shape", tier = "B" },
	MirrorCopy = { host = "mirror", binds = "shape", tier = "B" },
	PushPull = { host = "extrude", binds = "shape", tier = "B" },
	RigidXform = { host = "trsf_apply", binds = "shape", tier = "A" },
	FilletAll = { host = "fillet_all", binds = "shape", tier = "B" },
	SpinSolid = { host = "revolve", binds = "shape", tier = "B" },
	Offset3d = { host = "offset_3d", binds = "shape", tier = "B" },
	HollowBody = { host = "shell", binds = "shape", tier = "B" },
	DrillHoleThrough = { host = "drill_hole_through", binds = "shape", tier = "B" },
	DrillHoleBlind = { host = "drill_hole_blind", binds = "shape", tier = "B" },
	RoutePath = { host = { polyline = "make_route", polyline_bend = "make_route_bends" }, binds = "shape", tier = "A" },
	SweepAlong = { host = "pipe_annulus", binds = "shape", tier = "A" },
	PipeProfile = { host = "pipe", binds = "shape", tier = "B" },
	MemberSweepRect = { host = "member_sweep_rect", binds = "shape", tier = "B" },
	AttachFrame = { host = false, binds = "frame", tier = "A", pure = true },
	ComposeChain = { host = "compose_chain", binds = "measure", tier = "A" },
	QueryClash = { host = { clash = "clash", distance = "distance" }, binds = "measure", tier = "A" },
	QueryGeom = { host = { volume = "volume", bbox = "bbox" }, binds = "measure", tier = "A" },
	-- mesh_stats only — no full-mesh fallback over JSON tool bridge (security)
	ExportMesh = { host = "mesh_stats", binds = "measure", tier = "A" },
	MeshStats = { host = "mesh_stats", binds = "measure", tier = "B" },
	MassProps = { host = "mass_properties", binds = "measure", tier = "B" },
	StepWrite = { host = "step_write", binds = "measure", tier = "B" },
	PatternLinear = { host = "pattern_linear", binds = "shape", tier = "B" },
	PatternPolar = { host = "pattern_polar", binds = "shape", tier = "B" },
}

-- Host ops present in OccBridge (K15 host-ready).
registry.HOST_AVAILABLE = {
	make_box = true,
	make_cylinder = true,
	make_sphere = true,
	make_cone = true,
	make_torus = true,
	fuse = true,
	cut = true,
	intersect = true,
	translate = true,
	rotate = true,
	scale = true,
	mirror = true,
	extrude = true,
	pipe = true,
	fillet_all = true,
	pattern_linear = true,
	pattern_polar = true,
	clash = true,
	distance = true,
	volume = true,
	bbox = true,
	mesh = true,
	mesh_stats = true,
	mass_properties = true,
	step_write = true,
	shape_free = true,
	free_all = true,
	make_route = true,
	make_route_bends = true,
	pipe_annulus = true,
	compose_chain = true,
	trsf_apply = true,
	frame_from_axes = true,
	make_face_rectangle = true,
	revolve = true,
	offset_3d = true,
	shell = true,
	drill_hole_through = true,
	drill_hole_blind = true,
	member_sweep_rect = true,
}

function registry.lookup(op: string): any
	return registry.OPS[op]
end

function registry.is_known(op: string): boolean
	return registry.OPS[op] ~= nil
end

-- Returns nil if pure / no host required; host op name string if single; or list of possible host ops.
function registry.required_hosts(op: string, params: { [string]: any }?): any
	local meta = registry.OPS[op]
	if not meta then
		return nil
	end
	if meta.pure or meta.host == false then
		return nil -- pure POD
	end
	local h = meta.host
	if type(h) == "string" then
		return h
	end
	if type(h) == "table" then
		-- mode-dependent: return all values (validate checks any/all as needed)
		local list = {}
		for _, v in pairs(h) do
			table.insert(list, v)
		end
		return list
	end
	return nil
end

function registry.host_ready(op: string, params: { [string]: any }?, available: { [string]: boolean }?): (boolean, string?)
	local meta = registry.OPS[op]
	if not meta then
		return false, "unknown op"
	end
	if meta.pure or meta.host == false then
		return true, nil
	end
	local avail = available or registry.HOST_AVAILABLE
	local h = meta.host
	if type(h) == "string" then
		if avail[h] then
			return true, nil
		end
		return false, h
	end
	if type(h) == "table" then
		if op == "BoolCombine" and type(params) == "table" then
			local mode = params.mode
			local hostOp = h[mode]
			if not hostOp then
				return true, nil
			end
			if avail[hostOp] then
				return true, nil
			end
			return false, hostOp
		end
		if op == "RoutePath" and type(params) == "table" then
			local style = params.style or "polyline"
			local hostOp = h[style]
			if not hostOp then
				return true, nil
			end
			if avail[hostOp] then
				return true, nil
			end
			return false, hostOp
		end
		if op == "QueryGeom" and type(params) == "table" then
			local mode = params.mode or "volume"
			local hostOp = h[mode]
			if hostOp and not avail[hostOp] then
				return false, hostOp
			end
			return true, nil
		end
		if op == "QueryClash" then
			if not avail.clash then
				return false, "clash"
			end
			local include_distance = true
			if type(params) == "table" and params.include_distance == false then
				include_distance = false
			end
			if include_distance and not avail.distance then
				return false, "distance"
			end
			return true, nil
		end
		for _, hostOp in pairs(h) do
			if not avail[hostOp] then
				return false, hostOp
			end
		end
		return true, nil
	end
	return true, nil
end

return registry
