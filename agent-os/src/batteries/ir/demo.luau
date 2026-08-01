-- run_demo → __OCC_CAD_RESULT__ (same marker as solid.finish)

local json = require("json")
local errors = require("ir.errors")
local eval_mod = require("ir.eval")

local demo = {}

local function emit_fail(err: any): any
	local e = err
	if type(err) == "table" and err.error then
		e = err.error
	elseif type(err) == "table" and err.code then
		e = err
	else
		e = { code = "IR_ERR_VALIDATE", message = tostring(err) }
	end
	-- Gate measures: never dump on failure path. Debug flag for success only.
	print("__OCC_CAD_RESULT__" .. json.encode({
		schema = 1,
		ok = false,
		error = e,
	}))
	if type(err) == "table" and err.ok == false then
		return err
	end
	return { ok = false, error = e }
end

function demo.run_demo(doc: any, opts: any?): any
	opts = opts or {}
	local res = eval_mod.eval(doc, opts)
	if errors.is_fail(res) or res.ok == false then
		return emit_fail(res)
	end

	local root_op = res.root
	if type(root_op) ~= "string" then
		return emit_fail(errors.fail("IR_ERR_VALIDATE", { message = "no root shape op_id" }))
	end
	local shape_id = res.shapes and res.shapes[root_op]
	if type(shape_id) ~= "number" then
		for id, sid in pairs(res.shapes or {}) do
			if type(sid) == "number" then
				shape_id = sid
				root_op = id
			end
		end
	end
	if type(shape_id) ~= "number" then
		return emit_fail(errors.fail("IR_ERR_VALIDATE", { message = "no root shape id for demo marker" }))
	end

	local payload: { [string]: any } = {
		schema = 1,
		root = shape_id,
		ir_root = root_op,
		ok = true,
	}
	-- Measures on marker are opt-in (sensitive engineering data §11.4)
	if opts.include_measures or opts.debug_measures then
		payload.measures = res.measures
	end
	print("__OCC_CAD_RESULT__" .. json.encode(payload))
	return res
end

return demo
