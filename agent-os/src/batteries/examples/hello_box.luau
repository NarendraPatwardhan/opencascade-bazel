-- Default demo: solid box
package.path = "/opt/cad/?.luau;" .. package.path
local solid = require("solid")

local root = solid.box({ dx = 20, dy = 15, dz = 10 })
print("volume approx check via host later")
solid.finish(root, { name = "hello_box" })
