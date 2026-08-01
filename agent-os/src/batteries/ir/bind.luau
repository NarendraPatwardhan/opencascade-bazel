-- Deep-walk op.params / op.refs and replace { param = "name" } with document.params[name]

local errors = require("ir.errors")
local limits_mod = require("ir.limits")

local bind = {}

local function is_param_ref(v: any): boolean
	return type(v) == "table" and type(v.param) == "string" and next(v, "param") == nil
end

local function bind_value(v: any, params: { [string]: any }, path: string, depth: number, max_depth: number): any
	if depth > max_depth then
		return errors.fail("IR_ERR_LIMIT", {
			message = "bind depth exceeded at " .. path,
			cap = "max_bind_depth",
		})
	end
	if is_param_ref(v) then
		local name = v.param
		if params[name] == nil then
			return errors.fail("IR_ERR_UNBOUND_PARAM", {
				message = "unbound param '" .. name .. "' at " .. path,
				param = name,
			})
		end
		return params[name]
	end
	if type(v) == "table" then
		local out: { [any]: any } = {}
		local is_array = #v > 0
		if is_array then
			for i, item in ipairs(v) do
				local r = bind_value(item, params, path .. "[" .. i .. "]", depth + 1, max_depth)
				if errors.is_fail(r) then
					return r
				end
				out[i] = r
			end
		else
			for k, item in pairs(v) do
				local r = bind_value(item, params, path .. "." .. tostring(k), depth + 1, max_depth)
				if errors.is_fail(r) then
					return r
				end
				out[k] = r
			end
		end
		return out
	end
	return v
end

function bind.bind_params(doc: { [string]: any }, opts: { [string]: any }?): any
	if type(doc) ~= "table" then
		return errors.fail("IR_ERR_SCHEMA", { message = "bind_params: doc must be table" })
	end
	local params = doc.params
	if type(params) ~= "table" then
		return errors.fail("IR_ERR_SCHEMA", { message = "document.params must be an object" })
	end

	local caps = limits_mod.merge(opts)
	local max_depth = caps.max_bind_depth or caps.max_ref_depth or 32

	local out: { [string]: any } = {}
	for k, v in pairs(doc) do
		out[k] = v
	end

	local ops = doc.ops
	if type(ops) ~= "table" then
		return errors.fail("IR_ERR_SCHEMA", { message = "document.ops must be an array" })
	end

	local new_ops = {}
	for i, op in ipairs(ops) do
		if type(op) ~= "table" then
			return errors.fail("IR_ERR_SCHEMA", {
				message = "ops[" .. i .. "] must be object",
				op_id = tostring(i),
			})
		end
		local nop: { [string]: any } = {}
		for k, v in pairs(op) do
			nop[k] = v
		end
		if type(op.params) == "table" then
			local bp = bind_value(op.params, params, "ops[" .. i .. "].params", 0, max_depth)
			if errors.is_fail(bp) then
				return errors.annotate(bp, { op_id = op.id })
			end
			nop.params = bp
		end
		if type(op.refs) == "table" then
			local br = bind_value(op.refs, params, "ops[" .. i .. "].refs", 0, max_depth)
			if errors.is_fail(br) then
				return errors.annotate(br, { op_id = op.id })
			end
			nop.refs = br
		end
		new_ops[i] = nop
	end
	out.ops = new_ops
	return out
end

return bind
