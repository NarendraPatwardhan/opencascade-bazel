-- Default demo: solid box. solid.* always records IR; finish evaluates → mesh.
package.path = "/opt/cad/?.luau;/opt/cad/?/init.luau;" .. package.path
local solid = require("solid")

local root = solid.box({ dx = 20, dy = 15, dz = 10 })
solid.finish(root, { name = "hello_box" })
