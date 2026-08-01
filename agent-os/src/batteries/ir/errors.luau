-- IR error constructors (cad.ir/v0)

local errors = {}

function errors.fail(code: string, fields: { [string]: any }?): { ok: boolean, error: { [string]: any } }
	local f = fields or {}
	local err: { [string]: any } = {
		code = code,
		message = f.message or code,
	}
	for k, v in pairs(f) do
		if k ~= "message" then
			err[k] = v
		end
	end
	return { ok = false, error = err }
end

function errors.is_fail(r: any): boolean
	return type(r) == "table" and r.ok == false and type(r.error) == "table"
end

--- Annotate a fail result's error table with extra fields (op_id, ref, …).
function errors.annotate(r: any, fields: { [string]: any }): any
	if type(r) == "table" and type(r.error) == "table" and type(fields) == "table" then
		for k, v in pairs(fields) do
			r.error[k] = v
		end
	end
	return r
end

return errors
