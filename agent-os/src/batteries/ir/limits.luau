-- Default resource caps (design Appendix B + security caps)

local limits = {}

-- Hard ceilings: guest cannot raise caps above these unless limits_authority.
limits.HARD_MAX = {
	max_ops = 4096,
	route_nodes = 512,
	pattern_count = 256,
	max_params = 2048,
	max_ref_depth = 16,
	max_chain_joints = 256,
	max_bool_tools = 64,
	max_bind_depth = 32,
	max_linear_m = 1e3,
	deflection_min = 1e-4, -- floor: also HARD_MIN (cannot lower)
	deflection_max = 1.0,
	wall_clock_ms = 120000,
	per_op_ms = 30000,
	max_json_bytes = 2 * 1024 * 1024,
}

-- Hard floors: guest cannot lower these security floors (stricter is OK for some).
-- deflection_min: guest cannot set below DEFAULT (weaker floor = denser mesh DoS).
-- deflection_max: guest cannot set above HARD_MAX (already in HARD_MAX).
limits.HARD_MIN = {
	deflection_min = 1e-4,
	-- ceiling-style caps may be lowered by guest (stricter) — no HARD_MIN
}

limits.DEFAULT = {
	max_ops = 4096,
	route_nodes = 512,
	pattern_count = 256,
	max_params = 2048,
	max_ref_depth = 16,
	max_chain_joints = 64,
	max_bool_tools = 64,
	max_bind_depth = 32,
	max_linear_m = 1e3,
	deflection_min = 1e-4,
	deflection_max = 1.0,
	wall_clock_ms = 120000,
	per_op_ms = 30000,
	max_json_bytes = 2 * 1024 * 1024,
}

function limits.merge(opts: { [string]: any }?): { [string]: number }
	local out: { [string]: number } = {}
	for k, v in pairs(limits.DEFAULT) do
		out[k] = v
	end
	local authority = type(opts) == "table" and opts.limits_authority == true
	if type(opts) == "table" then
		local src = opts.limits
		if type(src) ~= "table" then
			src = nil
			if opts.max_ops or opts.route_nodes or opts.pattern_count or opts.wall_clock_ms or opts.deflection_min then
				src = opts
			end
		end
		if type(src) == "table" then
			for k, v in pairs(src) do
				if type(v) == "number" and limits.DEFAULT[k] ~= nil and v == v and v > 0 then
					if authority then
						out[k] = v
					else
						local hard_max = limits.HARD_MAX[k] or limits.DEFAULT[k]
						local hard_min = limits.HARD_MIN[k]
						local wanted = v
						-- Cannot raise ceilings
						if wanted > hard_max then
							wanted = hard_max
						end
						-- Cannot lower security floors (e.g. deflection_min)
						if hard_min ~= nil and wanted < hard_min then
							wanted = hard_min
						end
						out[k] = wanted
					end
				end
			end
		end
	end
	-- Reconcile min/max pairs without weakening security floors:
	-- if min > max, raise max to min (never lower min below HARD_MIN).
	if out.deflection_min > out.deflection_max then
		out.deflection_max = out.deflection_min
	end
	-- Re-apply HARD_MIN floors after reconcile (guest cannot weaken floors)
	if not authority then
		local floor = limits.HARD_MIN.deflection_min
		if floor ~= nil and out.deflection_min < floor then
			out.deflection_min = floor
		end
		if out.deflection_min > out.deflection_max then
			out.deflection_max = out.deflection_min
		end
		-- Also clamp deflection_max to HARD_MAX after raise
		local dmax_hard = limits.HARD_MAX.deflection_max
		if dmax_hard ~= nil and out.deflection_max > dmax_hard then
			out.deflection_max = dmax_hard
			-- floor must still hold; if floor > hard max (misconfig), keep floor and max=floor
			if out.deflection_min > out.deflection_max then
				out.deflection_max = out.deflection_min
			end
		end
	end
	return out
end

return limits
