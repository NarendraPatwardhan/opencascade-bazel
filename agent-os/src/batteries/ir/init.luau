-- cad.ir public API (design §7.6)
-- Usage: local ir = require("ir")

local load_mod = require("ir.load")
local bind_mod = require("ir.bind")
local validate_mod = require("ir.validate")
local eval_mod = require("ir.eval")
local demo_mod = require("ir.demo")
local canonical = require("ir.canonical")
local limits = require("ir.limits")
local registry = require("ir.registry")
local errors = require("ir.errors")

local ir = {
	VERSION = "0.1.0",
	SCHEMA = "cad.ir/v0",
}

function ir.load(source: any, opts: any?): any
	return load_mod.load(source, opts)
end

function ir.expand_macros(doc: any): any
	return eval_mod.expand_macros(doc)
end

function ir.bind_params(doc: any): any
	return bind_mod.bind_params(doc)
end

function ir.validate(doc: any, opts: any?): any
	return validate_mod.validate(doc, opts)
end

function ir.eval(doc: any, opts: any?): any
	return eval_mod.eval(doc, opts)
end

function ir.eval_pose(doc: any, prior_env: any, pose_params: any?, opts: any?): any
	return eval_mod.eval_pose(doc, prior_env, pose_params, opts)
end

function ir.run_demo(doc: any, opts: any?): any
	return demo_mod.run_demo(doc, opts)
end

function ir.canonical_json(doc: any): string
	return canonical.canonical_json(doc)
end

function ir.hash_body(doc: any): string
	return canonical.hash_body(doc)
end

--- Stable per-op fingerprint (op + params + recursive ref fingerprints).
function ir.op_fingerprint(op: any, fp_by_id: { [string]: string }?): string
	return eval_mod.op_fingerprint(op, fp_by_id)
end

function ir.fingerprint_ops(ops: any): { [string]: string }
	return eval_mod.fingerprint_ops(ops)
end

ir.limits = limits
ir.registry = registry
ir.errors = errors
ir.is_fail = errors.is_fail

-- Recording tape for clean solid.* → IR lowering (solid.* always records; finish evaluates)
local ok_tape, tape = pcall(function()
	return require("ir.tape")
end)
if ok_tape then
	ir.tape = tape
end

return ir
