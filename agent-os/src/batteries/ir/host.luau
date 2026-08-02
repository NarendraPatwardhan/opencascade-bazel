-- Host cad.call wrapper for IR handlers

local tools = require("tools")

local host = {}

function host.call(op: string, args: { [string]: any }): any
	local payload: { [string]: any } = {}
	for k, v in pairs(args) do
		payload[k] = v
	end
	payload.op = op
	local res = tools.call("host.org.main.cad.call", payload)
	if type(res) ~= "table" then
		error({ code = "IR_ERR_HOST", message = "cad.call returned non-table", host_op = op })
	end
	if res.ok == false then
		local msg = "cad.call failed"
		if type(res.err) == "table" and type(res.err.message) == "string" then
			msg = res.err.message
		elseif type(res.err) == "string" then
			msg = res.err
		end
		error({ code = "IR_ERR_HOST", message = msg, host_op = op })
	end
	local data = res.data
	-- JS cad tool returns { __occ_err = "…" } instead of throwing so loom
	-- does not collapse the failure into generic "host tool call failed".
	if type(data) == "table" and type(data.__occ_err) == "string" then
		error({
			code = "IR_ERR_HOST",
			message = data.__occ_err,
			host_op = (data.__occ_op :: any) or op,
		})
	end
	return data
end

--- Free one host shape id (best-effort; ignore unknown).
function host.shape_free(id: number)
	if type(id) ~= "number" then
		return
	end
	pcall(function()
		host.call("shape_free", { id = id })
	end)
end

--- K17: free entire host shape table (bridge free_all).
function host.free_all()
	local ok, err = pcall(function()
		host.call("free_all", {})
	end)
	return ok, err
end

return host
