-- @cad params battery — host-injected values + registration sugar.
--
-- Host execute/analyze inject (after any --! hot comments) sets:
--   _HOST_PARAMS = { width = 40, ... }
--   params = require("params")   -- this module (methods + value __index)
--
-- Dual surface (same object):
--   local w = params.width                         -- value read
--   local w = params.number("width", { default=40 })  -- registration + value
--   local P = require("params"); P.number(...)     -- equivalent
--
-- Registrations do not invent host-side sheet entries at runtime; the host
-- resolves schema via guest params_resolve + syntax (POD), with cold JS fallback.
-- At runtime this battery returns injected values, falling back to opts.default.

local M = {}

local function host_values(): { [string]: any }
	local t = rawget(_G, "_HOST_PARAMS")
	if type(t) == "table" then
		return t
	end
	return {}
end

local function read(name: string, default: any): any
	local v = host_values()[name]
	if v == nil then
		return default
	end
	return v
end

function M.get(name: string, default: any?): any
	return read(name, default)
end

function M.values(): { [string]: any }
	return host_values()
end

function M.number(name: string, opts: { [string]: any }?): number
	opts = opts or {}
	local default = opts.default
	if default == nil then
		default = opts.value
	end
	if default == nil then
		default = 0
	end
	local v = read(name, default)
	local n = tonumber(v)
	if n == nil then
		n = tonumber(default) or 0
	end
	return n
end

function M.bool(name: string, opts: { [string]: any }?): boolean
	opts = opts or {}
	local default = opts.default
	if default == nil then
		default = opts.value
	end
	if default == nil then
		default = false
	end
	local v = read(name, default)
	return not not v
end

M.boolean = M.bool

function M.string(name: string, opts: { [string]: any }?): string
	opts = opts or {}
	local default = opts.default
	if default == nil then
		default = opts.value
	end
	if default == nil then
		default = ""
	end
	local v = read(name, default)
	if type(v) ~= "string" then
		return tostring(v)
	end
	return v
end

-- params.width → host value; params.number stays a method on M.
setmetatable(M, {
	__index = function(_t, key: string): any
		return host_values()[key]
	end,
})

return M
