-- load JSON string or table → document table

local json = require("json")
local errors = require("ir.errors")
local limits_mod = require("ir.limits")

local load_mod = {}

local function shallow_clone(t: { [string]: any }): { [string]: any }
	local out: { [string]: any } = {}
	for k, v in pairs(t) do
		out[k] = v
	end
	return out
end

function load_mod.load(source: any, opts: { [string]: any }?): any
	if type(source) == "string" then
		local caps = limits_mod.merge(opts)
		local max_bytes = caps.max_json_bytes or (2 * 1024 * 1024)
		if #source > max_bytes then
			return errors.fail("IR_ERR_LIMIT", {
				message = "JSON string exceeds max_json_bytes",
				cap = "max_json_bytes",
			})
		end
		local ok, doc = pcall(function()
			return json.decode(source)
		end)
		if not ok then
			return errors.fail("IR_ERR_SCHEMA", { message = "JSON decode failed: " .. tostring(doc) })
		end
		if type(doc) ~= "table" then
			return errors.fail("IR_ERR_SCHEMA", { message = "IR document must be a JSON object" })
		end
		return doc
	end
	if type(source) == "table" then
		return shallow_clone(source)
	end
	return errors.fail("IR_ERR_SCHEMA", { message = "load expects string or table" })
end

return load_mod
