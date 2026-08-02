-- @cad params_resolve — harvest free CAD params via guest require("syntax").
--
-- Product path (IR-shaped):
--   guest Luau + syntax → pure POD param list (JSON)
--   JS host → store / sheet / inject values only (no host Luau parser)
--
-- Authoring surface (pretty for end users):
--   -- [Size]
--   local width = 40 -- [16:0.5:120] mm
--   local base = solid.box({ dx = width, ... })
--
-- Free params require an author signal: trailing `-- …` annotation and/or a
-- display comment on the line above. Bare intermediates (`local z_tool = -2`)
-- are not harvested.
--
-- Host runs this battery through worker kind "params_resolve" and parses
-- __OCC_PARAMS_RESULT__ + JSON. syntax is lazy-resident on loom.

local syntax = require("syntax")
local json = require("json")

local M = {}

export type ParamPod = {
	name: string,
	value: any,
	defaultValue: any?,
	min: number?,
	max: number?,
	step: number?,
	unit: string?,
	scrub: string?,
	group: string?,
	displayName: string?,
	type: string?,
	options: { string }?,
	litStart: number?,
	litEnd: number?,
}

local MARKER = "__OCC_PARAMS_RESULT__"

local function humanize(name: string): string
	local s = string.gsub(name, "_", " ")
	return (string.gsub(s, "(%a)([%w']*)", function(first, rest)
		return string.upper(first) .. rest
	end))
end

local function range_from_magnitude(n: number): (number, number, number)
	local a = math.abs(n)
	if a == 0 then
		return -10, 10, 0.1
	end
	if a >= 100 then
		return math.min(0, n - a), n + a, 1
	end
	if a >= 10 then
		local minv = if n == math.floor(n) then math.max(0, math.floor(n * 0.25)) else 0
		return minv, math.ceil(n * 2.5), 0.5
	end
	if a >= 1 then
		return math.max(0, math.floor(n * 0.1 * 10) / 10), math.ceil(n * 3 * 10) / 10, 0.1
	end
	return 0, math.max(1, a * 10), 0.01
end

--- CADAM-style trailing annotation body (after `--`).
local function parse_trailing_annotation(comment: string): { [string]: any }
	local out: { [string]: any } = {}
	local rest = string.gsub(comment or "", "^%s*%-%-%s?", "")
	rest = string.match(rest, "^%s*(.-)%s*$") or rest
	if rest == "" then
		return out
	end

	local inner, before, after
	local bstart, bend = string.find(rest, "%b[]")
	if bstart then
		inner = string.sub(rest, bstart + 1, bend - 1)
		before = string.match(string.sub(rest, 1, bstart - 1), "^%s*(.-)%s*$") or ""
		after = string.match(string.sub(rest, bend + 1), "^%s*(.-)%s*$") or ""
		if before ~= "" and not string.match(string.lower(before), "^(view|xform|rebuild)$") then
			out.displayName = string.gsub(before, ":$", "")
			out.displayName = string.match(out.displayName, "^%s*(.-)%s*$") or out.displayName
		end
		inner = string.match(inner, "^%s*(.-)%s*$") or inner
		if string.find(inner, ",") and not string.match(inner, "^-?[%d%.]") then
			out.type = "enum"
			local opts: { string } = {}
			for part in string.gmatch(inner, "[^,]+") do
				local t = string.match(part, "^%s*(.-)%s*$")
				if t and t ~= "" then
					table.insert(opts, t)
				end
			end
			out.options = opts
		else
			local parts: { string } = {}
			for part in string.gmatch(inner, "[^:]+") do
				table.insert(parts, string.match(part, "^%s*(.-)%s*$") or part)
			end
			if #parts == 2 then
				local minn = tonumber(parts[1])
				local maxn = tonumber(parts[2])
				if minn ~= nil then
					out.min = minn
				end
				if maxn ~= nil then
					out.max = maxn
				end
			elseif #parts >= 3 then
				local minn = tonumber(parts[1])
				local stepn = tonumber(parts[2])
				local maxn = tonumber(parts[3])
				if minn ~= nil then
					out.min = minn
				end
				if stepn ~= nil and stepn > 0 then
					out.step = stepn
				end
				if maxn ~= nil then
					out.max = maxn
				end
			end
		end
		rest = after
	end

	for t in string.gmatch(rest, "%S+") do
		local low = string.lower(t)
		if low == "view" or low == "xform" or low == "rebuild" then
			out.scrub = low
		elseif string.match(low, "^group=") then
			out.group = string.sub(t, 7)
		elseif string.match(low, "^unit=") then
			out.unit = string.sub(t, 6)
		elseif low == "mm" or low == "cm" or low == "m" or low == "deg" or low == "°" or low == "rad" or low == "in" then
			out.unit = if low == "deg" then "°" else t
		elseif out.group == nil and not string.match(t, "^%[") and #t < 32 then
			if out.displayName == nil or t ~= string.match(out.displayName, "^(%S+)") then
				out.group = t
			end
		end
	end
	return out
end

local function parse_group_marker(body: string): string?
	local t = string.match(body, "^%s*(.-)%s*$") or body
	local m = string.match(t, "^%[%s*([^%]]+)%s*%]$")
	if m then
		return string.match(m, "^%s*(.-)%s*$")
	end
	m = string.match(t, "^#%s*(.+)$")
	if m then
		return string.match(m, "^%s*(.-)%s*$")
	end
	m = string.match(t, "^%-%-%-*%s*(.-)%s*%-%-%-*$")
	if m and m ~= "" then
		return m
	end
	return nil
end

local function parse_display_comment(body: string): string?
	local t = string.match(body, "^%s*(.-)%s*$") or body
	if t == "" or #t > 48 then
		return nil
	end
	if parse_group_marker(t) then
		return nil
	end
	if string.match(t, "^@param%f[%s]") or string.match(t, "^!") then
		return nil
	end
	if string.find(t, "[=%[%]{}()]") then
		return nil
	end
	return t
end

local function comment_body(text: string): string
	return string.gsub(text or "", "^%s*%-%-%s?", "")
end

local function is_all_caps(name: string): boolean
	return string.match(name, "^[A-Z][A-Z0-9_]*$") ~= nil
end

local function is_skip_name(name: string): boolean
	if name == "" then
		return true
	end
	if string.sub(name, 1, 1) == "_" then
		return true
	end
	if is_all_caps(name) then
		return true
	end
	return false
end

--- Collect named children of a node (concrete kinds we care about).
local function named_children(doc: any, node: any): { any }
	local out: { any } = {}
	for ch in doc:children(node, { named_only = true, page_size = 64 }) do
		table.insert(out, ch)
	end
	return out
end

local function node_text(doc: any, node: any): string
	local ok, t = pcall(function()
		return doc:text(node.range)
	end)
	if ok and type(t) == "string" then
		return t
	end
	return ""
end

local function is_require_call(doc: any, node: any): boolean
	if node.concrete_kind ~= "function_call" then
		return false
	end
	-- require("…") or require '…'
	local kids = named_children(doc, node)
	for _, ch in kids do
		if ch.concrete_kind == "identifier" then
			return node_text(doc, ch) == "require"
		end
		if ch.concrete_kind == "variable" then
			local id = node_text(doc, ch)
			return id == "require"
		end
	end
	local full = node_text(doc, node)
	return string.match(full, "^require%s*[%(\"']") ~= nil
end

local function is_function_call_expr(kind: string): boolean
	return kind == "function_call"
end

local function is_bare_literal_kind(kind: string): boolean
	-- number / boolean tokens, or unary signed numbers (`-2` → unary_expression)
	return kind == "number" or kind == "boolean" or kind == "unary_expression"
end

--- True when full node text is a bare numeric/bool literal (incl. signed).
local function is_signed_number_text(text: string): boolean
	return string.match(text, "^%s*%-?%d+%.?%d*[eE]?[%+%-]?%d*%s*$") ~= nil
		or string.match(text, "^%s*%-?%.%d+[eE]?[%+%-]?%d*%s*$") ~= nil
end

local function literal_value(doc: any, node: any): any?
	local kind = node.concrete_kind
	local text = node_text(doc, node)
	if kind == "boolean" then
		return text == "true"
	end
	if kind == "number" then
		local n = tonumber(text)
		if n ~= nil then
			return n
		end
		return nil
	end
	-- `-2`, `+3.5` as unary_expression (not a single number token)
	if kind == "unary_expression" then
		local trimmed = string.match(text, "^%s*(.-)%s*$") or text
		if is_signed_number_text(trimmed) then
			local n = tonumber(trimmed)
			if n ~= nil then
				return n
			end
		end
		-- Child walk: operator "-" + number
		local kids = named_children(doc, node)
		local num: number? = nil
		for _, ch in kids do
			if ch.concrete_kind == "number" then
				num = tonumber(node_text(doc, ch))
			end
		end
		-- unary text often starts with "-"
		if string.sub(trimmed, 1, 1) == "-" and num ~= nil then
			return -num
		end
		if string.sub(trimmed, 1, 1) == "+" and num ~= nil then
			return num
		end
		-- full text tonumber as last resort
		return tonumber(trimmed)
	end
	return nil
end

local function local_names_and_values(doc: any, decl: any): ({ string }, { any })
	local names: { string } = {}
	local values: { any } = {}
	local kids = named_children(doc, decl)
	for _, ch in kids do
		if ch.concrete_kind == "local_name" then
			-- local_name → identifier child
			local id = nil
			for sub in doc:children(ch, { named_only = true, page_size = 8 }) do
				if sub.concrete_kind == "identifier" then
					id = node_text(doc, sub)
					break
				end
			end
			if id == nil then
				id = node_text(doc, ch)
			end
			table.insert(names, id)
		elseif is_bare_literal_kind(ch.concrete_kind) or is_function_call_expr(ch.concrete_kind)
			or ch.concrete_kind == "binary_expression"
			or ch.concrete_kind == "unary_expression"
			or ch.concrete_kind == "parenthesized_expression"
			or ch.concrete_kind == "table_constructor"
			or ch.concrete_kind == "quoted_string"
			or ch.concrete_kind == "variable"
			or ch.concrete_kind == "nil"
			or ch.concrete_kind == "if_expression"
			or ch.concrete_kind == "function_expression"
			or ch.concrete_kind == "member_expression"
		then
			table.insert(values, ch)
		end
	end
	return names, values
end

local function build_param(
	name: string,
	value: any,
	ann: { [string]: any },
	group_hint: string,
	display_hint: string,
	lit_start: number?,
	lit_end: number?
): ParamPod
	local obj: ParamPod = {
		name = name,
		value = value,
		defaultValue = value,
		displayName = ann.displayName or (if display_hint ~= "" then display_hint else humanize(name)),
		group = ann.group or (if group_hint ~= "" then group_hint else "Main"),
		scrub = ann.scrub or (if type(value) == "boolean" then "view" else "rebuild"),
		unit = ann.unit or "",
	}
	-- litStart/litEnd: optional future POD-driven inject; host rewrite still uses
	-- applyParamValuesToSource (luau-locals position helper) as inject truth today.
	if lit_start ~= nil then
		obj.litStart = lit_start
	end
	if lit_end ~= nil then
		obj.litEnd = lit_end
	end

	if type(value) == "boolean" then
		obj.type = "boolean"
	elseif ann.type == "enum" and type(ann.options) == "table" then
		obj.type = "enum"
		obj.options = ann.options
	else
		obj.type = "number"
		if ann.min ~= nil then
			obj.min = ann.min
		end
		if ann.max ~= nil then
			obj.max = ann.max
		end
		if ann.step ~= nil then
			obj.step = ann.step
		end
		if obj.min == nil or obj.max == nil then
			local rmin, rmax, rstep = range_from_magnitude(value :: number)
			if obj.min == nil then
				obj.min = rmin
			end
			if obj.max == nil then
				obj.max = rmax
			end
			if obj.step == nil then
				if type(value) == "number" and value == math.floor(value) and math.abs(value) >= 1 then
					obj.step = 1
				else
					obj.step = rstep
				end
			end
		end
	end
	return obj
end

--- Harvest header-region free params from Luau source via syntax CST.
function M.resolve(source: string): { ParamPod }
	if type(source) ~= "string" or source == "" then
		return {}
	end

	local ok_open, doc_or_err = pcall(function()
		return syntax.open("luau", source)
	end)
	if not ok_open then
		error("params_resolve: syntax.open failed: " .. tostring(doc_or_err), 2)
	end
	local doc = doc_or_err

	-- Entire harvest under pcall so doc:close always runs (long-lived loom VM).
	local ok_body, result = pcall(function()
		local params: { ParamPod } = {}
		local by_name: { [string]: boolean } = {}
		local group_hint = ""
		local display_hint = ""
		local stopped = false

		-- Top-level walk: named children of source_file (stmts + extra comments).
		local top: { any } = {}
		for ch in doc:children(doc:root(), { named_only = true, page_size = 256 }) do
			table.insert(top, ch)
		end

		--- Find trailing line_comment on the same row after index `from` (skip whitespace).
		local function trailing_comment_after(from: number, decl_row: number): string
			local j = from + 1
			while j <= #top do
				local nxt = top[j]
				local nk = nxt.concrete_kind
				if nk == "whitespace" then
					j += 1
					continue
				end
				if (nk == "line_comment" or nk == "comment") and nxt.range.start_point.row == decl_row then
					return node_text(doc, nxt)
				end
				break
			end
			return ""
		end

		local i = 1
		while i <= #top and not stopped do
			local node = top[i]
			local kind = node.concrete_kind

			if kind == "whitespace" then
				-- Extras between statements; do not clear group/display hints.
				i += 1
			elseif kind == "line_comment" or kind == "comment" then
				local text = node_text(doc, node)
				local body = comment_body(text)
				local gm = parse_group_marker(body)
				if gm then
					group_hint = gm
					display_hint = ""
				else
					local dc = parse_display_comment(body)
					if dc then
						display_hint = dc
					end
				end
				i += 1
			elseif kind == "local_function_declaration" or kind == "function_declaration" then
				stopped = true
			elseif kind == "if_statement"
				or kind == "for_numeric_statement"
				or kind == "for_generic_statement"
				or kind == "while_statement"
				or kind == "repeat_statement"
				or kind == "do_statement"
			then
				stopped = true
			elseif kind == "function_call" then
				-- bare call at top level ends header (e.g. build())
				if not is_require_call(doc, node) then
					stopped = true
				else
					display_hint = ""
					i += 1
				end
			elseif kind == "local_declaration" then
				local names, values = local_names_and_values(doc, node)

				-- Classify RHS: require skip; non-require call → stop header; literals → params
				local has_non_require_call = false
				local all_require = #values > 0
				for _, v in values do
					if is_function_call_expr(v.concrete_kind) then
						if is_require_call(doc, v) then
							-- require: skip this decl entirely
						else
							has_non_require_call = true
							all_require = false
						end
					else
						all_require = false
					end
				end

				if has_non_require_call then
					-- geometry body starts (local base = solid.box(...))
					stopped = true
					break
				end

				if all_require then
					display_hint = ""
					i += 1
					continue
				end

				local trailing = trailing_comment_after(i, node.range.start_point.row)
				local ann = parse_trailing_annotation(trailing)
				-- Free params need an author signal: trailing `-- …` annotation
				-- and/or a display comment on the line above. Bare intermediates
				-- (e.g. `local z_tool = -2`) stay out of the sheet.
				local has_trailing = trailing ~= nil and trailing ~= ""
				local has_display = display_hint ~= nil and display_hint ~= ""
				local is_annotated = has_trailing or has_display

				local nbind = 0
				if #names == 1 and #values == 1 then
					nbind = 1
				elseif #names == #values then
					nbind = #names
				end

				for j = 1, nbind do
					local name = names[j]
					local val_node = values[j]
					if
						is_annotated
						and not is_skip_name(name)
						and val_node
						and is_bare_literal_kind(val_node.concrete_kind)
					then
						local value = literal_value(doc, val_node)
						if value ~= nil and not by_name[name] then
							local p = build_param(
								name,
								value,
								ann,
								group_hint,
								if j == 1 then display_hint else "",
								val_node.range.start_byte,
								val_node.range.end_byte
							)
							table.insert(params, p)
							by_name[name] = true
						end
					end
				end
				display_hint = ""
				i += 1
			elseif kind == "assignment_statement" then
				-- body = solid.cut(...) ends header; bare/broken assigns (e.g. inside a
				-- misparsed --[[params]] block) must not kill later header locals.
				local ends = false
				for ch in doc:children(node, { named_only = true, page_size = 32 }) do
					if is_function_call_expr(ch.concrete_kind) and not is_require_call(doc, ch) then
						ends = true
						break
					end
				end
				if ends then
					stopped = true
				else
					i += 1
				end
			elseif kind == "ERROR" or kind == "MISSING" then
				-- tolerate misparsed long comments / junk; keep scanning header
				i += 1
			else
				-- unknown top-level node: skip without clearing group markers
				i += 1
			end
		end

		return params
	end)

	pcall(function()
		doc:close()
	end)

	if not ok_body then
		error("params_resolve: harvest failed: " .. tostring(result), 2)
	end
	return result :: { ParamPod }
end

function M.resolve_json(source: string): string
	local params = M.resolve(source)
	-- Guest json.encode({}) is an object; empty array must be "[]" for host POD.
	if #params == 0 then
		return "[]"
	end
	return json.encode(params)
end

function M.marker(): string
	return MARKER
end

--- Host harness entry: read source path, print marker + JSON.
function M.run_file(path: string)
	local bytes, err = sys.fs.read(path)
	if bytes == nil then
		error("params_resolve: cannot read " .. tostring(path) .. ": " .. tostring(err), 2)
	end
	local source = if type(bytes) == "string" then bytes else tostring(bytes)
	print(MARKER .. M.resolve_json(source))
end

return M
