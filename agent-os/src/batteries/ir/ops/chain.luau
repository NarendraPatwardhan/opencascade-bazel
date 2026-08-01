-- ComposeChain → measure only

local host = require("ir.host")
local errors = require("ir.errors")

local chain = {}

local function flatten_vec3_list(list: { any }, n: number): any
	local flat: { number } = {}
	for i = 1, n do
		local p = list[i]
		if type(p) ~= "table" then
			return errors.fail("IR_ERR_VALIDATE", {
				message = "ComposeChain Vec3[" .. i .. "] must be table",
			})
		end
		local x, y, z = p[1] or p.x, p[2] or p.y, p[3] or p.z
		if type(x) ~= "number" or type(y) ~= "number" or type(z) ~= "number" then
			return errors.fail("IR_ERR_VALIDATE", {
				message = "ComposeChain Vec3[" .. i .. "] must be numeric",
			})
		end
		table.insert(flat, x)
		table.insert(flat, y)
		table.insert(flat, z)
	end
	if #flat ~= n * 3 then
		return errors.fail("IR_ERR_VALIDATE", { message = "ComposeChain flat length mismatch" })
	end
	return flat
end

function chain.ComposeChain(op: any, env: any): any
	local p = op.params
	local angles = p.angles
	local n = #angles
	if n < 1 then
		return errors.fail("IR_ERR_VALIDATE", { message = "ComposeChain n>=1", op_id = op.id })
	end
	local origins = flatten_vec3_list(p.origins, n)
	if errors.is_fail(origins) then
		return errors.annotate(origins, { op_id = op.id })
	end
	local axes = flatten_vec3_list(p.axes, n)
	if errors.is_fail(axes) then
		return errors.annotate(axes, { op_id = op.id })
	end
	local ang_flat: { number } = {}
	for i = 1, n do
		if type(angles[i]) ~= "number" then
			return errors.fail("IR_ERR_VALIDATE", {
				message = "ComposeChain.angles[" .. i .. "] must be number",
				op_id = op.id,
			})
		end
		ang_flat[i] = angles[i] :: number
	end
	local data = host.call("compose_chain", {
		n = n,
		origins = origins,
		axes = axes,
		angles = ang_flat,
		want_prefixes = true,
	})
	local pod = {
		kind = "compose_chain",
		n = data.n or n,
		prefixes = data.prefixes or {},
		final = data.final or {},
	}
	env.measures[op.id] = pod
	-- Optional frame mirrors omitted (design allows; matrix-only is non-FramePod — Issue 45).
	-- RigidXform uses measures only.
	return pod
end

return chain
