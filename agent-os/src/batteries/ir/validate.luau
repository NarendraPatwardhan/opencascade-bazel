-- Product validator for cad.ir/v0 (K21)

local errors = require("ir.errors")
local limits_mod = require("ir.limits")
local registry = require("ir.registry")
local resolve = require("ir.resolve")

local validate = {}

local OP_ID_PATTERN = "^[%a_][%w_./%-]*$"

local ENVELOPE_KEYS = {
	ir_schema = true,
	id = true,
	version = true,
	units = true,
	params = true,
	catalog = true,
	frames = true,
	assembly = true,
	ops = true,
	results = true,
	meta = true,
}

local OP_KEYS = {
	id = true,
	op = true,
	params = true,
	refs = true,
	deps = true,
	meta = true,
}

local function count_keys(t: { [string]: any }): number
	local n = 0
	for _ in pairs(t) do
		n += 1
	end
	return n
end

local function is_finite_number(v: any): boolean
	return type(v) == "number" and v == v and v ~= math.huge and v ~= -math.huge
end

local function is_vec3(v: any, max_abs: number?): boolean
	if type(v) ~= "table" then
		return false
	end
	local x = v[1] or v.x
	local y = v[2] or v.y
	local z = v[3] or v.z
	if not (is_finite_number(x) and is_finite_number(y) and is_finite_number(z)) then
		return false
	end
	if type(max_abs) == "number" then
		if math.abs(x) > max_abs or math.abs(y) > max_abs or math.abs(z) > max_abs then
			return false
		end
	end
	return true
end

local function positive_size(v: any, max_m: number): boolean
	return is_finite_number(v) and v > 0 and v <= max_m
end

local function validate_units(units: any): any
	if type(units) ~= "table" then
		return errors.fail("IR_ERR_SCHEMA", { message = "units must be object" })
	end
	if units.store ~= "SI" then
		return errors.fail("IR_ERR_SCHEMA", { message = "units.store must be 'SI'" })
	end
	if units.length ~= "meter" then
		return errors.fail("IR_ERR_SCHEMA", { message = "units.length must be 'meter' (SI store)" })
	end
	if units.angle ~= "radian" then
		return errors.fail("IR_ERR_SCHEMA", { message = "units.angle must be 'radian'" })
	end
	return nil
end

--- Per-op param/ref checks; caps optional (defaults used when nil).
function validate.validate_op_params(op: { [string]: any }, caps: { [string]: number }?): any
	local c = caps or limits_mod.DEFAULT
	local name = op.op
	local p = op.params or {}
	local max_m = c.max_linear_m or 1e3

	if name == "PrimBox" then
		if not (positive_size(p.dx, max_m) and positive_size(p.dy, max_m) and positive_size(p.dz, max_m)) then
			return errors.fail("IR_ERR_VALIDATE", {
				message = "PrimBox requires dx,dy,dz in (0, max_linear_m]",
				op_id = op.id,
				op = name,
			})
		end
	elseif name == "PrimCylinder" then
		if not (positive_size(p.radius, max_m) and positive_size(p.height, max_m)) then
			return errors.fail("IR_ERR_VALIDATE", {
				message = "PrimCylinder radius/height must be in (0, max_linear_m]",
				op_id = op.id,
				op = name,
			})
		end
	elseif name == "PrimSphere" then
		if not positive_size(p.radius, max_m) then
			return errors.fail("IR_ERR_VALIDATE", {
				message = "PrimSphere.radius must be in (0, max_linear_m]",
				op_id = op.id,
				op = name,
			})
		end
	elseif name == "PrimCone" then
		local r1 = p.r1 or p.radius1
		local r2 = p.r2 or p.radius2 or 0
		if not is_finite_number(r1) or r1 < 0 or r1 > max_m then
			return errors.fail("IR_ERR_VALIDATE", { message = "PrimCone.r1 invalid", op_id = op.id, op = name })
		end
		if not is_finite_number(r2) or r2 < 0 or r2 > max_m then
			return errors.fail("IR_ERR_VALIDATE", { message = "PrimCone.r2 invalid", op_id = op.id, op = name })
		end
		if not positive_size(p.height, max_m) then
			return errors.fail("IR_ERR_VALIDATE", { message = "PrimCone.height invalid", op_id = op.id, op = name })
		end
	elseif name == "PrimTorus" then
		local R = p.major_r or p.majorR or p.R
		local r = p.minor_r or p.minorR or p.r
		if not positive_size(R, max_m) or not positive_size(r, max_m) then
			return errors.fail("IR_ERR_VALIDATE", { message = "PrimTorus radii invalid", op_id = op.id, op = name })
		end
	elseif name == "BoolCombine" then
		local mode = p.mode
		if mode ~= "union" and mode ~= "subtract" and mode ~= "intersect" then
			return errors.fail("IR_ERR_VALIDATE", {
				message = "BoolCombine.mode must be union|subtract|intersect",
				op_id = op.id,
				op = name,
			})
		end
		local tools = op.refs and op.refs.tools
		if type(tools) ~= "table" or #tools < 1 then
			return errors.fail("IR_ERR_VALIDATE", {
				message = "BoolCombine.refs.tools length >= 1",
				op_id = op.id,
				op = name,
			})
		end
		local max_tools = c.max_bool_tools or 64
		if #tools > max_tools then
			return errors.fail("IR_ERR_LIMIT", {
				message = "BoolCombine tools count " .. #tools .. " > max_bool_tools " .. max_tools,
				op_id = op.id,
				cap = "max_bool_tools",
			})
		end
		if op.refs == nil or op.refs.target == nil then
			return errors.fail("IR_ERR_VALIDATE", {
				message = "BoolCombine.refs.target required",
				op_id = op.id,
				op = name,
			})
		end
	elseif name == "RoutePath" then
		local nodes = p.nodes
		if type(nodes) ~= "table" or #nodes < 2 then
			return errors.fail("IR_ERR_VALIDATE", {
				message = "RoutePath.nodes length >= 2",
				op_id = op.id,
				op = name,
			})
		end
		for i, node in ipairs(nodes) do
			if not is_vec3(node, max_m) then
				return errors.fail("IR_ERR_VALIDATE", {
					message = "RoutePath.nodes["
						.. i
						.. "] must be finite Vec3 within ±max_linear_m",
					op_id = op.id,
					op = name,
				})
			end
		end
		local style = p.style or "polyline"
		if style ~= "polyline" and style ~= "polyline_bend" then
			return errors.fail("IR_ERR_VALIDATE", {
				message = "RoutePath.style must be polyline|polyline_bend",
				op_id = op.id,
				op = name,
			})
		end
		if style == "polyline_bend" then
			if type(p.bend_r) ~= "number" and type(p.bend_radius) ~= "number" then
				return errors.fail("IR_ERR_VALIDATE", {
					message = "RoutePath.polyline_bend requires bend_r >= 0",
					op_id = op.id,
					op = name,
				})
			end
			local br = p.bend_r or p.bend_radius
			if br < 0 then
				return errors.fail("IR_ERR_VALIDATE", {
					message = "RoutePath.bend_r must be >= 0",
					op_id = op.id,
					op = name,
				})
			end
		end
	elseif name == "SweepAlong" then
		local kind = p.profile_kind or "annulus"
		if kind ~= "annulus" then
			return errors.fail("IR_ERR_UNSUPPORTED", {
				message = "SweepAlong v0 only supports profile_kind=annulus",
				op_id = op.id,
				op = name,
			})
		end
		local od = p.od
		local inner = p.inner or p.inner_diameter
		if type(od) ~= "number" or type(inner) ~= "number" then
			return errors.fail("IR_ERR_VALIDATE", {
				message = "SweepAlong annulus requires od and inner",
				op_id = op.id,
				op = name,
			})
		end
		if not (od > inner and inner > 0 and od <= max_m) then
			return errors.fail("IR_ERR_VALIDATE", {
				message = "SweepAlong requires max_linear_m >= od > inner > 0",
				op_id = op.id,
				op = name,
			})
		end
		if op.refs == nil or op.refs.path == nil then
			return errors.fail("IR_ERR_VALIDATE", {
				message = "SweepAlong.refs.path required",
				op_id = op.id,
				op = name,
			})
		end
	elseif name == "ComposeChain" then
		local origins, axes, angles = p.origins, p.axes, p.angles
		if type(origins) ~= "table" or type(axes) ~= "table" or type(angles) ~= "table" then
			return errors.fail("IR_ERR_VALIDATE", {
				message = "ComposeChain requires origins,axes,angles",
				op_id = op.id,
				op = name,
			})
		end
		local n = #angles
		if n < 1 or #origins ~= n or #axes ~= n then
			return errors.fail("IR_ERR_VALIDATE", {
				message = "ComposeChain origins/axes/angles length must match n>=1",
				op_id = op.id,
				op = name,
			})
		end
		local max_j = c.max_chain_joints or 64
		if n > max_j then
			return errors.fail("IR_ERR_LIMIT", {
				message = "ComposeChain n=" .. n .. " > max_chain_joints " .. max_j,
				op_id = op.id,
				cap = "max_chain_joints",
			})
		end
		for i = 1, n do
			if not is_vec3(origins[i]) then
				return errors.fail("IR_ERR_VALIDATE", {
					message = "ComposeChain.origins[" .. i .. "] must be Vec3",
					op_id = op.id,
				})
			end
			if not is_vec3(axes[i]) then
				return errors.fail("IR_ERR_VALIDATE", {
					message = "ComposeChain.axes[" .. i .. "] must be Vec3",
					op_id = op.id,
				})
			end
			if not is_finite_number(angles[i]) then
				return errors.fail("IR_ERR_VALIDATE", {
					message = "ComposeChain.angles[" .. i .. "] must be number",
					op_id = op.id,
				})
			end
		end
	elseif name == "RigidXform" then
		local has_mat = type(p.matrix4x4) == "table" and #p.matrix4x4 == 16
		local has_chain = op.refs and op.refs.chain ~= nil and type(p.prefix_index) == "number"
		if has_mat and has_chain then
			return errors.fail("IR_ERR_VALIDATE", {
				message = "RigidXform modes mutually exclusive (matrix4x4 vs chain prefix)",
				op_id = op.id,
				op = name,
			})
		end
		if not has_mat and not has_chain then
			return errors.fail("IR_ERR_VALIDATE", {
				message = "RigidXform needs matrix4x4 or (prefix_index + refs.chain)",
				op_id = op.id,
				op = name,
			})
		end
		if op.refs == nil or op.refs.shape == nil then
			return errors.fail("IR_ERR_VALIDATE", {
				message = "RigidXform.refs.shape required",
				op_id = op.id,
				op = name,
			})
		end
	elseif name == "AttachFrame" then
		if type(p.name) ~= "string" or p.name == "" then
			return errors.fail("IR_ERR_VALIDATE", {
				message = "AttachFrame.name required",
				op_id = op.id,
				op = name,
			})
		end
		if type(p.origin) ~= "table" or type(p.z) ~= "table" then
			return errors.fail("IR_ERR_VALIDATE", {
				message = "AttachFrame requires origin and z",
				op_id = op.id,
				op = name,
			})
		end
	elseif name == "QueryClash" then
		if op.refs == nil or op.refs.a == nil or op.refs.b == nil then
			return errors.fail("IR_ERR_VALIDATE", {
				message = "QueryClash.refs.a/b required",
				op_id = op.id,
				op = name,
			})
		end
	elseif name == "QueryGeom" then
		local mode = p.mode or "volume"
		if mode ~= "volume" and mode ~= "bbox" then
			return errors.fail("IR_ERR_VALIDATE", {
				message = "QueryGeom.mode must be volume|bbox",
				op_id = op.id,
				op = name,
			})
		end
		if op.refs == nil or op.refs.shape == nil then
			return errors.fail("IR_ERR_VALIDATE", {
				message = "QueryGeom.refs.shape required",
				op_id = op.id,
				op = name,
			})
		end
	elseif name == "ExportMesh" then
		if op.refs == nil or op.refs.shape == nil then
			return errors.fail("IR_ERR_VALIDATE", {
				message = "ExportMesh.refs.shape required",
				op_id = op.id,
				op = name,
			})
		end
		local d = p.deflection
		if d ~= nil then
			local dmin = c.deflection_min or 1e-4
			local dmax = c.deflection_max or 1.0
			if not is_finite_number(d) or d < dmin or d > dmax then
				return errors.fail("IR_ERR_VALIDATE", {
					message = string.format(
						"ExportMesh.deflection must be in [%g, %g]",
						dmin,
						dmax
					),
					op_id = op.id,
					op = name,
				})
			end
		end
	elseif name == "Translate" then
		if op.refs == nil or op.refs.shape == nil then
			return errors.fail("IR_ERR_VALIDATE", {
				message = "Translate.refs.shape required",
				op_id = op.id,
				op = name,
			})
		end
	elseif name == "Rotate" then
		if type(p.angle) ~= "number" and type(p.angle_rad) ~= "number" then
			return errors.fail("IR_ERR_VALIDATE", {
				message = "Rotate.angle required",
				op_id = op.id,
				op = name,
			})
		end
		if op.refs == nil or op.refs.shape == nil then
			return errors.fail("IR_ERR_VALIDATE", {
				message = "Rotate.refs.shape required",
				op_id = op.id,
				op = name,
			})
		end
	elseif name == "PatternLinear" or name == "PatternPolar" then
		local count = p.count or (if name == "PatternLinear" then 2 else 4)
		if type(count) ~= "number" or count ~= math.floor(count) or count < 1 then
			return errors.fail("IR_ERR_VALIDATE", {
				message = name .. ".count must be integer >= 1",
				op_id = op.id,
				op = name,
			})
		end
		local maxc = c.pattern_count or 256
		if count > maxc then
			return errors.fail("IR_ERR_LIMIT", {
				message = name .. ".count " .. count .. " > pattern_count " .. maxc,
				op_id = op.id,
				cap = "pattern_count",
			})
		end
		if op.refs == nil or (op.refs.shape == nil and op.refs.seed == nil) then
			return errors.fail("IR_ERR_VALIDATE", {
				message = name .. ".refs.shape required",
				op_id = op.id,
				op = name,
			})
		end
	elseif name == "MirrorCopy" then
		if op.refs == nil or op.refs.shape == nil then
			return errors.fail("IR_ERR_VALIDATE", {
				message = "MirrorCopy.refs.shape required",
				op_id = op.id,
				op = name,
			})
		end
	elseif name == "PushPull" then
		if op.refs == nil or (op.refs.profile == nil and op.refs.shape == nil) then
			return errors.fail("IR_ERR_VALIDATE", {
				message = "PushPull.refs.profile|shape required",
				op_id = op.id,
				op = name,
			})
		end
	elseif name == "Scale" then
		if op.refs == nil or op.refs.shape == nil then
			return errors.fail("IR_ERR_VALIDATE", {
				message = "Scale.refs.shape required",
				op_id = op.id,
				op = name,
			})
		end
		local factor = p.factor or p.f
		if factor ~= nil and (not is_finite_number(factor) or factor == 0) then
			return errors.fail("IR_ERR_VALIDATE", {
				message = "Scale.factor must be finite non-zero when set",
				op_id = op.id,
				op = name,
			})
		end
	elseif name == "FilletAll" then
		if op.refs == nil or op.refs.shape == nil then
			return errors.fail("IR_ERR_VALIDATE", {
				message = "FilletAll.refs.shape required",
				op_id = op.id,
				op = name,
			})
		end
		if p.radius ~= nil and not positive_size(p.radius, max_m) then
			return errors.fail("IR_ERR_VALIDATE", {
				message = "FilletAll.radius must be in (0, max_linear_m]",
				op_id = op.id,
				op = name,
			})
		end
	elseif name == "PipeProfile" then
		if op.refs == nil or op.refs.profile == nil then
			return errors.fail("IR_ERR_VALIDATE", {
				message = "PipeProfile.refs.profile required",
				op_id = op.id,
				op = name,
			})
		end
		if op.refs.spine == nil and op.refs.path == nil then
			return errors.fail("IR_ERR_VALIDATE", {
				message = "PipeProfile.refs.spine|path required",
				op_id = op.id,
				op = name,
			})
		end
	elseif name == "SpinSolid" then
		if op.refs == nil or (op.refs.profile == nil and op.refs.shape == nil) then
			return errors.fail("IR_ERR_VALIDATE", {
				message = "SpinSolid.refs.profile|shape required",
				op_id = op.id,
				op = name,
			})
		end
	elseif name == "Offset3d" then
		if op.refs == nil or op.refs.shape == nil then
			return errors.fail("IR_ERR_VALIDATE", {
				message = "Offset3d.refs.shape required",
				op_id = op.id,
				op = name,
			})
		end
		local offset = p.offset or p.distance
		if type(offset) ~= "number" or not is_finite_number(offset) then
			return errors.fail("IR_ERR_VALIDATE", {
				message = "Offset3d.offset (or distance) required",
				op_id = op.id,
				op = name,
			})
		end
	elseif name == "HollowBody" then
		if op.refs == nil or op.refs.shape == nil then
			return errors.fail("IR_ERR_VALIDATE", {
				message = "HollowBody.refs.shape required",
				op_id = op.id,
				op = name,
			})
		end
		local faces = p.faces or p.face_idx
		if type(faces) ~= "table" or #faces < 1 then
			return errors.fail("IR_ERR_VALIDATE", {
				message = "HollowBody.faces (1-based indices) required",
				op_id = op.id,
				op = name,
			})
		end
	elseif name == "DrillHoleThrough" or name == "DrillHoleBlind" then
		if op.refs == nil or (op.refs.shape == nil and op.refs.solid == nil) then
			return errors.fail("IR_ERR_VALIDATE", {
				message = name .. ".refs.shape|solid required",
				op_id = op.id,
				op = name,
			})
		end
		local diameter = p.diameter or p.d
		if not positive_size(diameter, max_m) then
			return errors.fail("IR_ERR_VALIDATE", {
				message = name .. ".diameter required in (0, max_linear_m]",
				op_id = op.id,
				op = name,
			})
		end
		if name == "DrillHoleBlind" then
			if not positive_size(p.depth, max_m) then
				return errors.fail("IR_ERR_VALIDATE", {
					message = "DrillHoleBlind.depth required in (0, max_linear_m]",
					op_id = op.id,
					op = name,
				})
			end
		end
	elseif name == "MakeRectProfile" then
		local width = p.width or p.dx
		local height = p.height or p.dy
		if not (positive_size(width, max_m) and positive_size(height, max_m)) then
			return errors.fail("IR_ERR_VALIDATE", {
				message = "MakeRectProfile width/height must be in (0, max_linear_m]",
				op_id = op.id,
				op = name,
			})
		end
	elseif name == "MemberSweepRect" then
		if op.refs == nil or (op.refs.spine == nil and op.refs.path == nil) then
			return errors.fail("IR_ERR_VALIDATE", {
				message = "MemberSweepRect.refs.spine|path required",
				op_id = op.id,
				op = name,
			})
		end
		local width = p.width or p.w
		local height = p.height or p.h
		if not (positive_size(width, max_m) and positive_size(height, max_m)) then
			return errors.fail("IR_ERR_VALIDATE", {
				message = "MemberSweepRect width/height must be in (0, max_linear_m]",
				op_id = op.id,
				op = name,
			})
		end
	elseif name == "MassProps" then
		if op.refs == nil or op.refs.shape == nil then
			return errors.fail("IR_ERR_VALIDATE", {
				message = "MassProps.refs.shape required",
				op_id = op.id,
				op = name,
			})
		end
		if p.density ~= nil and (not is_finite_number(p.density) or p.density <= 0) then
			return errors.fail("IR_ERR_VALIDATE", {
				message = "MassProps.density must be > 0 when set",
				op_id = op.id,
				op = name,
			})
		end
	elseif name == "MeshStats" then
		if op.refs == nil or op.refs.shape == nil then
			return errors.fail("IR_ERR_VALIDATE", {
				message = "MeshStats.refs.shape required",
				op_id = op.id,
				op = name,
			})
		end
		local d = p.deflection
		if d ~= nil then
			local dmin = c.deflection_min or 1e-4
			local dmax = c.deflection_max or 1.0
			if not is_finite_number(d) or d < dmin or d > dmax then
				return errors.fail("IR_ERR_VALIDATE", {
					message = string.format(
						"MeshStats.deflection must be in [%g, %g]",
						dmin,
						dmax
					),
					op_id = op.id,
					op = name,
				})
			end
		end
	elseif name == "StepWrite" then
		if op.refs == nil or op.refs.shape == nil then
			return errors.fail("IR_ERR_VALIDATE", {
				message = "StepWrite.refs.shape required",
				op_id = op.id,
				op = name,
			})
		end
		local path = p.path or p.file
		if type(path) ~= "string" or path == "" then
			return errors.fail("IR_ERR_VALIDATE", {
				message = "StepWrite.path required",
				op_id = op.id,
				op = name,
			})
		end
	end
	return nil
end

local function collect_shape_ref_ids(sel: any, out: { string })
	if type(sel) ~= "table" then
		return
	end
	if #sel > 0 and type(sel[1]) == "table" then
		for _, s in ipairs(sel) do
			collect_shape_ref_ids(s, out)
		end
		return
	end
	if sel.nth and type(sel.nth) == "table" then
		collect_shape_ref_ids(sel.nth.of, out)
		return
	end
	if type(sel.body) == "string" then
		table.insert(out, sel.body)
	end
	if type(sel.created_by) == "string" then
		table.insert(out, sel.created_by)
	end
	-- { op = "x" } used both for shape and chain measure — only enforce order later by kind
	if type(sel.op) == "string" and not sel.chain_op then
		table.insert(out, sel.op)
	end
end

function validate.validate(doc: { [string]: any }, opts: { [string]: any }?): any
	opts = opts or {}
	if type(doc) ~= "table" then
		return errors.fail("IR_ERR_SCHEMA", { message = "document must be object" })
	end
	if doc.ir_schema ~= "cad.ir/v0" then
		return errors.fail("IR_ERR_SCHEMA", {
			message = "ir_schema must be 'cad.ir/v0' (got " .. tostring(doc.ir_schema) .. ")",
		})
	end
	if type(doc.version) ~= "string" then
		return errors.fail("IR_ERR_SCHEMA", { message = "version string required" })
	end
	local uerr = validate_units(doc.units)
	if uerr then
		return uerr
	end
	if type(doc.params) ~= "table" then
		return errors.fail("IR_ERR_SCHEMA", { message = "params object required" })
	end
	if type(doc.meta) ~= "table" then
		return errors.fail("IR_ERR_SCHEMA", { message = "meta object required" })
	end
	if type(doc.ops) ~= "table" then
		return errors.fail("IR_ERR_SCHEMA", { message = "ops array required" })
	end

	local strict = opts.strict
	if strict == nil then
		strict = doc.meta.strict
	end
	if strict == nil then
		strict = true
	end
	if strict then
		for k in pairs(doc) do
			if type(k) == "string" and not ENVELOPE_KEYS[k] then
				return errors.fail("IR_ERR_SCHEMA", {
					message = "unknown document field '" .. k .. "' (strict)",
				})
			end
		end
	end

	local caps = limits_mod.merge(opts)
	local nops = #doc.ops
	if nops > caps.max_ops then
		return errors.fail("IR_ERR_LIMIT", {
			message = "ops count " .. nops .. " > max_ops " .. caps.max_ops,
			cap = "max_ops",
		})
	end
	if count_keys(doc.params) > caps.max_params then
		return errors.fail("IR_ERR_LIMIT", {
			message = "params exceed max_params",
			cap = "max_params",
		})
	end

	local seen: { [string]: number } = {}
	local order: { [string]: number } = {}

	for i, op in ipairs(doc.ops) do
		if type(op) ~= "table" then
			return errors.fail("IR_ERR_SCHEMA", { message = "ops[" .. i .. "] must be object" })
		end
		if type(op.id) ~= "string" or op.id == "" then
			return errors.fail("IR_ERR_SCHEMA", { message = "ops[" .. i .. "].id required" })
		end
		if not string.match(op.id, OP_ID_PATTERN) then
			return errors.fail("IR_ERR_VALIDATE", {
				message = "invalid op id '" .. op.id .. "'",
				op_id = op.id,
			})
		end
		if seen[op.id] then
			return errors.fail("IR_ERR_DUP_ID", {
				message = "duplicate op id '" .. op.id .. "'",
				op_id = op.id,
			})
		end
		seen[op.id] = i
		order[op.id] = i

		if type(op.op) ~= "string" then
			return errors.fail("IR_ERR_SCHEMA", {
				message = "ops[" .. i .. "].op required",
				op_id = op.id,
			})
		end
		if not registry.is_known(op.op) then
			return errors.fail("IR_ERR_UNKNOWN_OP", {
				message = "unknown op '" .. op.op .. "'",
				op = op.op,
				op_id = op.id,
			})
		end

		if strict then
			for k in pairs(op) do
				if type(k) == "string" and not OP_KEYS[k] then
					return errors.fail("IR_ERR_VALIDATE", {
						message = "unknown op field '" .. k .. "' on " .. op.id .. " (strict)",
						op_id = op.id,
					})
				end
			end
		end

		local ready, missing = registry.host_ready(op.op, op.params, opts.host_available)
		if not ready then
			return errors.fail("IR_ERR_HOST_UNAVAILABLE", {
				message = "host lowerer unavailable for " .. op.op .. (missing and (": " .. missing) or ""),
				op = op.op,
				op_id = op.id,
				host_op = missing,
			})
		end

		if type(op.params) ~= "table" then
			return errors.fail("IR_ERR_SCHEMA", {
				message = "ops[" .. i .. "].params required (may be {})",
				op_id = op.id,
			})
		end

		if type(op.deps) == "table" then
			for _, dep in ipairs(op.deps) do
				if type(dep) ~= "string" or order[dep] == nil or order[dep] >= i then
					return errors.fail("IR_ERR_DEP_ORDER", {
						message = "dep '" .. tostring(dep) .. "' must appear earlier than " .. op.id,
						op_id = op.id,
					})
				end
			end
		end

		if type(op.refs) == "table" then
			for rname, sel in pairs(op.refs) do
				local serr = resolve.validate_selector(sel, 0, caps.max_ref_depth)
				if serr then
					return errors.annotate(serr, { op_id = op.id, ref = rname })
				end
			end
		end

		if op.op == "RoutePath" and type(op.params.nodes) == "table" then
			if #op.params.nodes > caps.route_nodes then
				return errors.fail("IR_ERR_LIMIT", {
					message = "route nodes exceed cap",
					op_id = op.id,
					cap = "route_nodes",
				})
			end
		end

		local perr = validate.validate_op_params(op, caps)
		if perr then
			return perr
		end

		-- Structural ref order: shape refs must name earlier geometry ops
		if type(op.refs) == "table" then
			for rname, sel in pairs(op.refs) do
				if rname == "chain" then
					local key = type(sel) == "table" and (sel.op or sel.chain_op)
					if type(key) == "string" then
						if order[key] == nil or order[key] >= i then
							return errors.fail("IR_ERR_DEP_ORDER", {
								message = "chain ref '" .. key .. "' must appear earlier",
								op_id = op.id,
								ref = rname,
							})
						end
						local mop = doc.ops[order[key]]
						if not mop or mop.op ~= "ComposeChain" then
							return errors.fail("IR_ERR_VALIDATE", {
								message = "chain ref must be ComposeChain op",
								op_id = op.id,
							})
						end
					end
				else
					local ids: { string } = {}
					collect_shape_ref_ids(sel, ids)
					for _, rid in ipairs(ids) do
						if order[rid] == nil or order[rid] >= i then
							return errors.fail("IR_ERR_DEP_ORDER", {
								message = "ref '" .. rid .. "' must name an earlier op",
								op_id = op.id,
								ref = rname,
							})
						end
						local earlier = doc.ops[order[rid]]
						if earlier then
							local em = registry.lookup(earlier.op)
							if em and em.binds == "measure" then
								return errors.fail("IR_ERR_VALIDATE", {
									message = "cannot use measure-only op '" .. rid .. "' as shape ref",
									op_id = op.id,
								})
							end
							if em and em.binds == "frame" then
								return errors.fail("IR_ERR_VALIDATE", {
									message = "cannot use frame-only op '" .. rid .. "' as shape ref",
									op_id = op.id,
								})
							end
						end
					end
				end
			end
		end
	end

	return doc
end

return validate
