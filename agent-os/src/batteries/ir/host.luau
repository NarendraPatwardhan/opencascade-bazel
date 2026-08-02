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
	-- Mid-flight preempt: { __occ_err = "aborted", aborted = true } → soft cancel.
	if type(data) == "table" and type(data.__occ_err) == "string" then
		local aborted = data.aborted == true or data.__occ_err == "aborted"
		error({
			code = if aborted then "IR_ERR_ABORTED" else "IR_ERR_HOST",
			message = data.__occ_err,
			aborted = aborted,
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
--- Under host session memo=true, free_all becomes memo_begin (keeps cache).
function host.free_all()
	local ok, err = pcall(function()
		host.call("free_all", {})
	end)
	return ok, err
end

--- Session flags from OccBridge (memo scrub path).
function host.session_opts(): { [string]: any }
	local ok, data = pcall(function()
		return host.call("session_opts", {})
	end)
	if ok and type(data) == "table" then
		return data
	end
	return {}
end

--- Explicit memo generation bump (optional; free_all under memo does the same).
function host.memo_begin()
	local ok, err = pcall(function()
		host.call("memo_begin", {})
	end)
	return ok, err
end

--- Lookup cached host shape by op fingerprint.
function host.cache_get(key: string): any
	if type(key) ~= "string" or key == "" then
		return { hit = false }
	end
	local ok, data = pcall(function()
		return host.call("cache_get", { key = key })
	end)
	if not ok or type(data) ~= "table" then
		return { hit = false }
	end
	return data
end

--- Store host shape under fingerprint (after successful create).
function host.cache_put(key: string, shapeId: number)
	if type(key) ~= "string" or key == "" or type(shapeId) ~= "number" then
		return
	end
	pcall(function()
		host.call("cache_put", { key = key, shapeId = shapeId })
	end)
end

return host
