-- Freestanding selector resolution (design §3.5)

local errors = require("ir.errors")

local resolve = {}

local function is_array(t: any): boolean
	return type(t) == "table" and #t > 0
end

function resolve.resolve_shape(sel: any, env: { [string]: any }): any
	if sel == nil then
		return errors.fail("IR_ERR_SELECTOR", { message = "nil selector" })
	end
	if is_array(sel) then
		local out = {}
		for i, s in ipairs(sel) do
			local r = resolve.resolve_shape(s, env)
			if errors.is_fail(r) then
				return r
			end
			out[i] = r
		end
		return out
	end
	if type(sel) ~= "table" then
		return errors.fail("IR_ERR_SELECTOR", { message = "selector must be object or array" })
	end

	if sel.nth ~= nil then
		local nth = sel.nth
		if type(nth) ~= "table" or nth.of == nil or type(nth.i) ~= "number" then
			return errors.fail("IR_ERR_SELECTOR", { message = "nth requires { of, i }" })
		end
		local list = resolve.resolve_shape(nth.of, env)
		if errors.is_fail(list) then
			return list
		end
		local idx = nth.i + 1 -- 0-based in IR → 1-based Luau
		if type(list) ~= "table" or list[idx] == nil then
			return errors.fail("IR_ERR_SELECTOR", { message = "nth index out of range: " .. tostring(nth.i) })
		end
		return list[idx]
	end

	if type(sel.body) == "string" then
		local id = env.shapes[sel.body]
		if id == nil then
			return errors.fail("IR_ERR_SELECTOR", { message = "unknown body '" .. sel.body .. "'" })
		end
		return id
	end

	if type(sel.created_by) == "string" then
		local entity = sel.entity or "body"
		if entity ~= "body" and entity ~= "wire" then
			return errors.fail("IR_ERR_UNSUPPORTED", {
				message = "freestanding entity '" .. tostring(entity) .. "' not supported (body|wire only)",
			})
		end
		local id = env.shapes[sel.created_by]
		if id == nil then
			return errors.fail("IR_ERR_SELECTOR", { message = "unknown created_by '" .. sel.created_by .. "'" })
		end
		return id
	end

	if type(sel.op) == "string" then
		local id = env.shapes[sel.op]
		if id == nil then
			return errors.fail("IR_ERR_SELECTOR", { message = "unknown op shape '" .. sel.op .. "'" })
		end
		return id
	end

	if type(sel.frame) == "string" then
		return errors.fail("IR_ERR_SELECTOR", { message = "frame selector is not a shape: " .. sel.frame })
	end

	-- face filters etc.
	if sel.entity == "face" or sel.entity == "edge" or sel.filter or sel.all_solids then
		return errors.fail("IR_ERR_UNSUPPORTED", { message = "session/face selectors not available freestanding" })
	end

	return errors.fail("IR_ERR_SELECTOR", { message = "unrecognized shape selector" })
end

function resolve.resolve_frame(sel: any, env: { [string]: any }): any
	if type(sel) == "table" and type(sel.frame) == "string" then
		local f = env.frames[sel.frame]
		if f == nil then
			return errors.fail("IR_ERR_SELECTOR", { message = "unknown frame '" .. sel.frame .. "'" })
		end
		return f
	end
	return errors.fail("IR_ERR_SELECTOR", { message = "frame selector requires { frame = name }" })
end

function resolve.resolve_chain(sel: any, env: { [string]: any }): any
	if type(sel) ~= "table" then
		return errors.fail("IR_ERR_SELECTOR", { message = "chain selector must be object" })
	end
	local key = sel.op or sel.chain_op
	if type(key) ~= "string" then
		return errors.fail("IR_ERR_SELECTOR", { message = "chain selector needs op" })
	end
	local m = env.measures[key]
	if m == nil then
		return errors.fail("IR_ERR_SELECTOR", { message = "unknown chain measure '" .. key .. "'" })
	end
	if m.kind ~= "compose_chain" then
		return errors.fail("IR_ERR_SELECTOR", { message = "measure '" .. key .. "' is not compose_chain" })
	end
	return m
end

-- Validate selector form without env (structural freestanding allowlist)
function resolve.validate_selector(sel: any, depth: number, max_depth: number): any
	if depth > max_depth then
		return errors.fail("IR_ERR_LIMIT", { message = "max_ref_depth exceeded", cap = "max_ref_depth" })
	end
	if sel == nil then
		return nil
	end
	if is_array(sel) then
		for _, s in ipairs(sel) do
			local e = resolve.validate_selector(s, depth + 1, max_depth)
			if e then
				return e
			end
		end
		return nil
	end
	if type(sel) ~= "table" then
		return errors.fail("IR_ERR_SELECTOR", { message = "selector must be object" })
	end
	if sel.nth then
		if type(sel.nth) ~= "table" then
			return errors.fail("IR_ERR_SELECTOR", { message = "nth must be object" })
		end
		return resolve.validate_selector(sel.nth.of, depth + 1, max_depth)
	end
	if sel.entity == "face" or sel.entity == "edge" or sel.filter or sel.all_solids or sel.face_index then
		return errors.fail("IR_ERR_UNSUPPORTED", {
			message = "illegal freestanding selector (face/filter/set-op/index)",
		})
	end
	if sel.created_by and sel.entity and sel.entity ~= "body" and sel.entity ~= "wire" then
		return errors.fail("IR_ERR_UNSUPPORTED", {
			message = "freestanding entity must be body|wire",
		})
	end
	if sel.body or sel.created_by or sel.op or sel.frame then
		return nil
	end
	-- empty refs object ok; unknown keys in strict handled elsewhere
	return nil
end

return resolve
