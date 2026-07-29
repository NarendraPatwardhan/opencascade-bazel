-- Typed stub of AgentOS require("tools") for luau-analyze only.
-- Runtime uses the embedded tools builtin (this file is not on the execute path).

export type ToolError = {
	message: string?,
	[string]: any,
}

export type ToolResult = {
	ok: boolean?,
	data: any,
	err: ToolError | string | nil,
}

local tools = {}

function tools.call(_name: string, _payload: { [string]: any }): ToolResult
	-- Shape returned by host CAD ops (shapeId, volume, bbox, …).
	return {
		ok = true,
		data = {
			shapeId = 0,
			volume = 0,
			bbox = {
				min = { 0, 0, 0 },
				max = { 0, 0, 0 },
			},
		},
	}
end

function tools.save(_name: string, _payload: { [string]: any }, _path: string): ToolResult
	return { ok = true, data = {} }
end

function tools.gc(): () end

return tools
