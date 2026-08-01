-- Strict-lex canonical JSON + product hash (K18)

local canonical = {}

-- Empty arrays: Luau cannot distinguish [] from {}. For v0 product hash we treat
-- tables with only sequential integer keys 1..n (including n=0 via __array flag) as arrays.
-- Callers that need empty array can set t.__array = true (stripped at encode).
local function is_array(t: any): boolean
	if type(t) ~= "table" then
		return false
	end
	if t.__array == true then
		return true
	end
	local n = #t
	if n == 0 then
		-- empty table without __array → object `{}` (documented v0 limitation)
		return false
	end
	for k in pairs(t) do
		if k ~= "__array" and type(k) ~= "number" then
			return false
		end
	end
	return true
end

local function escape_str(s: string): string
	s = string.gsub(s, "\\", "\\\\")
	s = string.gsub(s, '"', '\\"')
	s = string.gsub(s, "\n", "\\n")
	s = string.gsub(s, "\r", "\\r")
	s = string.gsub(s, "\t", "\\t")
	return '"' .. s .. '"'
end

local function encode_number(n: number): string
	if n ~= n or n == math.huge or n == -math.huge then
		error("canonical_json: non-finite number")
	end
	-- Prefer compact integer form when exact
	if n == math.floor(n) and math.abs(n) < 1e15 then
		return string.format("%.0f", n)
	end
	-- Use shortest reasonable representation
	return string.format("%.17g", n)
end

function canonical.encode(value: any): string
	local tv = type(value)
	if value == nil then
		return "null"
	end
	if tv == "boolean" then
		return if value then "true" else "false"
	end
	if tv == "number" then
		return encode_number(value)
	end
	if tv == "string" then
		return escape_str(value)
	end
	if tv ~= "table" then
		error("canonical_json: unsupported type " .. tv)
	end
	if is_array(value) then
		local parts = {}
		for i = 1, #value do
			parts[i] = canonical.encode(value[i])
		end
		return "[" .. table.concat(parts, ",") .. "]"
	end
	-- object: strict lexicographic key sort (skip __array meta)
	local keys = {}
	for k in pairs(value) do
		if type(k) == "string" and k ~= "__array" then
			table.insert(keys, k)
		end
	end
	table.sort(keys)
	local parts = {}
	for _, k in ipairs(keys) do
		table.insert(parts, escape_str(k) .. ":" .. canonical.encode(value[k]))
	end
	return "{" .. table.concat(parts, ",") .. "}"
end

function canonical.canonical_json(doc: any): string
	return canonical.encode(doc)
end

-- Document body for hashing: exclude meta.hashes and results
function canonical.body_for_hash(doc: any): any
	local out: { [string]: any } = {}
	for k, v in pairs(doc) do
		if k ~= "results" then
			if k == "meta" and type(v) == "table" then
				local meta: { [string]: any } = {}
				for mk, mv in pairs(v) do
					if mk ~= "hashes" then
						meta[mk] = mv
					end
				end
				out.meta = meta
			else
				out[k] = v
			end
		end
	end
	return out
end

-- FNV-1a 32-bit product hash (labeled; design allows non-sha256 product hash for v0).
function canonical.hash_body(doc: any): string
	local s = canonical.encode(canonical.body_for_hash(doc))
	local h = 2166136261
	for i = 1, #s do
		h = bit32.bxor(h, string.byte(s, i))
		h = bit32.band(h * 16777619, 0xffffffff)
	end
	return string.format("fnv1a32:%08x", h)
end

return canonical
