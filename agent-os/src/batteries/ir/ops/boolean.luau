-- BoolCombine left-fold

local host = require("ir.host")
local errors = require("ir.errors")
local resolve = require("ir.resolve")

local boolean = {}

local MODE_HOST = {
	union = "fuse",
	subtract = "cut",
	intersect = "intersect",
}

function boolean.BoolCombine(op: any, env: any): any
	local mode = op.params.mode
	local hostOp = MODE_HOST[mode]
	if not hostOp then
		return errors.fail("IR_ERR_VALIDATE", { message = "bad BoolCombine mode", op_id = op.id })
	end
	local target = resolve.resolve_shape(op.refs.target, env)
	if errors.is_fail(target) then
		return errors.annotate(target, { op_id = op.id })
	end
	local tools = resolve.resolve_shape(op.refs.tools, env)
	if errors.is_fail(tools) then
		return errors.annotate(tools, { op_id = op.id })
	end
	local acc = target
	for _, tool in ipairs(tools) do
		local data = host.call(hostOp, { a = acc, b = tool })
		acc = data.shapeId
	end
	env.shapes[op.id] = acc
	return { shapeId = acc }
end

return boolean
