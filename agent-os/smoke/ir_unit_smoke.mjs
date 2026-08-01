#!/usr/bin/env node
/**
 * Pure Luau unit smoke for cad.ir validate / bind / canonical / eval_pose (no dual-goal geom).
 *
 *   node agent-os/smoke/ir_unit_smoke.mjs
 */

import { accessSync, constants } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CadEngine } from "../src/cad-engine.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoAgentOs = resolve(here, "..");

function must(path, label) {
  try {
    accessSync(path, constants.R_OK);
  } catch {
    throw new Error(`missing ${label}: ${path}`);
  }
  return path;
}

function envPath(name, fallback) {
  return process.env[name] || fallback;
}

function resolveRunfile(p) {
  if (!p) return p;
  if (p.startsWith("/")) return p;
  for (const c of [
    p,
    join(process.env.RUNFILES_DIR || "", p),
    join(process.env.RUNFILES_DIR || "", "_main", p),
    join(process.cwd(), p),
  ]) {
    try {
      accessSync(c, constants.R_OK);
      return c;
    } catch {
      /* next */
    }
  }
  return p;
}

const kernel = must(resolveRunfile(envPath("AGENT_OS_KERNEL", join(repoAgentOs, "vendor/kernel.wasm"))), "kernel");
const loom = must(resolveRunfile(envPath("AGENT_OS_LOOM", join(repoAgentOs, "vendor/loom.tar"))), "loom");
const mcCore = must(resolveRunfile(envPath("AGENT_OS_MC_CORE", join(repoAgentOs, "vendor/mc-core.mjs"))), "mc-core");
const catalog = must(
  resolveRunfile(envPath("AGENT_OS_CATALOG", join(repoAgentOs, "vendor/catalog-compiler.wasm"))),
  "catalog",
);
const occBase = must(resolveRunfile(envPath("OCC_BASE", join(repoAgentOs, "vendor/occ"))), "occ");
const solidLuau = must(
  resolveRunfile(envPath("SOLID_LUAU", join(repoAgentOs, "src/batteries/solid.luau"))),
  "solid",
);
const batteriesDir = resolve(dirname(solidLuau));

const source = `
local ir = require("ir")
local json = require("json")
local solid = require("solid")

local failures = {}

local function expect(cond, msg)
  if not cond then table.insert(failures, msg) end
end

local function base_doc(ops, params)
  return {
    ir_schema = "cad.ir/v0",
    version = "0.1.0",
    units = { length = "meter", angle = "radian", store = "SI" },
    params = params or {},
    ops = ops,
    meta = { author = "test", strict = true, lib_versions = { cad_ir = "0.1.0" }, kernel_version = "7.9.3" },
  }
end

-- 1) bind_params resolves {param=}
local doc = base_doc({
  {
    id = "housing",
    op = "PrimBox",
    params = {
      dx = { param = "box_x" },
      dy = { param = "box_y" },
      dz = { param = "box_z" },
    },
  },
}, { box_x = 0.1, box_y = 0.2, box_z = 0.3 })

local bound = ir.bind_params(doc)
expect(not ir.is_fail(bound), "bind should succeed")
expect(bound.ops[1].params.dx == 0.1, "dx bound")
expect(bound.ops[1].params.dy == 0.2, "dy bound")

-- 2) unbound param
local ub = ir.bind_params(base_doc({
  { id = "a", op = "PrimBox", params = { dx = { param = "missing" }, dy = 1, dz = 1 } },
}))
expect(ir.is_fail(ub) and ub.error.code == "IR_ERR_UNBOUND_PARAM", "unbound param")

-- 3) validate good (after bind)
local v = ir.validate(bound)
expect(not ir.is_fail(v), "validate good doc: " .. tostring(v.error and v.error.message))

-- 4) unknown op
local uv = ir.validate(base_doc({
  { id = "x", op = "Sketch2D", params = {} },
}))
expect(ir.is_fail(uv) and uv.error.code == "IR_ERR_UNKNOWN_OP", "unknown op Sketch2D")

-- 5) face selector freestanding rejected
local fv = ir.validate(base_doc({
  { id = "b", op = "PrimBox", params = { dx = 1, dy = 1, dz = 1 } },
  {
    id = "c",
    op = "BoolCombine",
    params = { mode = "subtract" },
    refs = {
      target = { body = "b" },
      tools = {{ created_by = "b", entity = "face", filter = { max_area = true } }},
    },
  },
}))
expect(ir.is_fail(fv) and (fv.error.code == "IR_ERR_UNSUPPORTED" or fv.error.code == "IR_ERR_VALIDATE"),
  "face selector rejected: " .. tostring(fv.error and fv.error.code))

-- 6) bad units
local uu = ir.validate({
  ir_schema = "cad.ir/v0",
  version = "0.1.0",
  units = { length = "mm", angle = "radian", store = "SI" },
  params = {},
  ops = {},
  meta = { author = "t", strict = true, lib_versions = {}, kernel_version = "7.9.3" },
})
expect(ir.is_fail(uu) and uu.error.code == "IR_ERR_SCHEMA", "mm store rejected")

-- 7) canonical_json stable key order
local a = ir.canonical_json({ b = 1, a = 2 })
local cjson = ir.canonical_json({ a = 2, b = 1 })
expect(a == cjson and a == '{"a":2,"b":1}', "canonical key sort: " .. a)

-- 8) hash_body deterministic
local h1 = ir.hash_body(bound)
local h2 = ir.hash_body(bound)
expect(h1 == h2 and type(h1) == "string" and #h1 > 8, "hash stable")

-- 9) IR_ERR_HOST_UNAVAILABLE
local routeDoc = base_doc({
  {
    id = "route_A",
    op = "RoutePath",
    params = {
      style = "polyline",
      nodes = { {0,0,0}, {1,0,0} },
    },
  },
})
local hu = ir.validate(routeDoc, { host_available = { make_box = true } })
expect(ir.is_fail(hu) and hu.error.code == "IR_ERR_HOST_UNAVAILABLE",
  "host_unavailable RoutePath: " .. tostring(hu.error and hu.error.code) .. " " .. tostring(hu.error and hu.error.host_op))

-- 10) IR_ERR_DUP_ID
local dup = ir.validate(base_doc({
  { id = "a", op = "PrimBox", params = { dx = 1, dy = 1, dz = 1 } },
  { id = "a", op = "PrimBox", params = { dx = 1, dy = 1, dz = 1 } },
}))
expect(ir.is_fail(dup) and dup.error.code == "IR_ERR_DUP_ID", "dup id")

-- 11) IR_ERR_LIMIT max_ops
local many = {}
for i = 1, 5 do
  many[i] = { id = "b" .. i, op = "PrimBox", params = { dx = 1, dy = 1, dz = 1 } }
end
local lim = ir.validate(base_doc(many), { limits = { max_ops = 3 } })
expect(ir.is_fail(lim) and lim.error.code == "IR_ERR_LIMIT" and lim.error.cap == "max_ops",
  "max_ops limit: " .. tostring(lim.error and lim.error.code))

-- 12) IR_ERR_LIMIT route_nodes
local nodes = {}
for i = 1, 10 do nodes[i] = { i, 0, 0 } end
local rlim = ir.validate(base_doc({
  { id = "r", op = "RoutePath", params = { style = "polyline", nodes = nodes } },
}), { limits = { route_nodes = 5 } })
expect(ir.is_fail(rlim) and rlim.error.code == "IR_ERR_LIMIT", "route_nodes limit")

-- 13) IR_ERR_DEP_ORDER
local dep = ir.validate(base_doc({
  { id = "a", op = "PrimBox", params = { dx = 1, dy = 1, dz = 1 } },
  {
    id = "b",
    op = "Translate",
    params = { dx = 1, dy = 0, dz = 0 },
    refs = { shape = { body = "a" } },
    deps = { "missing" },
  },
}))
expect(ir.is_fail(dep) and dep.error.code == "IR_ERR_DEP_ORDER", "dep order")

-- 14) ComposeChain length mismatch
local cc = ir.validate(base_doc({
  {
    id = "fk",
    op = "ComposeChain",
    params = {
      origins = { {0,0,0} },
      axes = { {0,0,1}, {0,1,0} },
      angles = { 0.1 },
    },
  },
}))
expect(ir.is_fail(cc) and cc.error.code == "IR_ERR_VALIDATE", "compose chain length")

-- 15) SweepAlong non-annulus
local sw = ir.validate(base_doc({
  { id = "r", op = "RoutePath", params = { style = "polyline", nodes = { {0,0,0},{1,0,0} } } },
  {
    id = "p",
    op = "SweepAlong",
    params = { profile_kind = "shape", od = 0.1, inner = 0.05 },
    refs = { path = { created_by = "r", entity = "wire" } },
  },
}))
expect(ir.is_fail(sw) and sw.error.code == "IR_ERR_UNSUPPORTED", "sweep non-annulus")

-- 16) RigidXform missing matrix/chain
local rx = ir.validate(base_doc({
  { id = "l", op = "PrimBox", params = { dx = 1, dy = 1, dz = 1 } },
  {
    id = "pl",
    op = "RigidXform",
    params = {},
    refs = { shape = { body = "l" } },
  },
}))
expect(ir.is_fail(rx) and rx.error.code == "IR_ERR_VALIDATE", "rigid missing mode")

-- 17) pattern_count limit
local pat = ir.validate(base_doc({
  { id = "s", op = "PrimBox", params = { dx = 1, dy = 1, dz = 1 } },
  {
    id = "p",
    op = "PatternLinear",
    params = { dx = 1, dy = 0, dz = 0, count = 999 },
    refs = { shape = { body = "s" } },
  },
}))
expect(ir.is_fail(pat) and pat.error.code == "IR_ERR_LIMIT" and pat.error.cap == "pattern_count",
  "pattern_count: " .. tostring(pat.error and pat.error.cap))

-- 17b) deflection_max below HARD_MIN must not lower deflection_min floor
local caps_floor = ir.limits.merge({ limits = { deflection_max = 1e-9 } })
expect(caps_floor.deflection_min >= 1e-4,
  "deflection_min floor: got " .. tostring(caps_floor.deflection_min))
expect(caps_floor.deflection_max >= caps_floor.deflection_min,
  "deflection_max >= min after reconcile: max="
    .. tostring(caps_floor.deflection_max)
    .. " min="
    .. tostring(caps_floor.deflection_min))
-- ExportMesh with tiny deflection still rejected vs floor
local tiny = ir.validate(base_doc({
  { id = "s", op = "PrimBox", params = { dx = 1, dy = 1, dz = 1 } },
  {
    id = "m",
    op = "ExportMesh",
    params = { deflection = 1e-9 },
    refs = { shape = { body = "s" } },
  },
}), { limits = { deflection_max = 1e-9 } })
expect(ir.is_fail(tiny) and tiny.error.code == "IR_ERR_VALIDATE",
  "tiny deflection rejected: " .. tostring(tiny.error and tiny.error.code))

-- 18) eval_pose: full eval robot-ish mini, then pose change
local robot = base_doc({
  { id = "link0", op = "PrimBox", params = { dx = 0.1, dy = 0.1, dz = 0.1 } },
  {
    id = "fk",
    op = "ComposeChain",
    params = {
      origins = { {0,0,0} },
      axes = { {0,0,1} },
      angles = { { param = "th0" } },
    },
  },
  {
    id = "place0",
    op = "RigidXform",
    params = { prefix_index = 0 },
    refs = { shape = { body = "link0" }, chain = { op = "fk" } },
  },
}, { th0 = 0.0 })
local res1 = ir.eval(robot)
expect(res1.ok == true, "robot mini eval: " .. tostring(res1.error and res1.error.message))
expect(type(res1.shapes.link0) == "number", "link0 shape")
expect(type(res1.shapes.place0) == "number", "place0 shape")
local tcp1 = res1.measures.fk.final
local place_before = res1.shapes.place0
local link_before = res1.shapes.link0
local res2 = ir.eval_pose(robot, res1.env, { th0 = 1.2 })
expect(res2.ok == true, "eval_pose: " .. tostring(res2.error and res2.error.message))
expect(res2.shapes.link0 == link_before, "eval_pose keeps link solid id")
expect(res2.shapes.place0 ~= place_before, "eval_pose new place id")
-- prior env must not be mutated
expect(res1.shapes.place0 == place_before, "prior_env place unchanged")
local tcp2 = res2.measures.fk.final
expect(type(tcp2) == "table" and #tcp2 == 16, "pose final matrix")
-- TCP z translation may change with θ about Z depending on chain; just ensure finite and different measure n
expect(res2.measures.fk.n == 1, "pose chain n")

-- emit dummy CAD result so CadEngine.execute is happy
local box = solid.box({ dx = 1, dy = 1, dz = 1 })
solid.finish(box, { name = "ir_unit" })

print("__IR_UNIT__" .. json.encode({
  ok = #failures == 0,
  failures = failures,
  hash = h1,
}))
if #failures > 0 then
  error("ir unit failures: " .. table.concat(failures, "; "))
end
`;

const engine = new CadEngine({
  kernel,
  loom,
  mcCore,
  catalogCompiler: catalog,
  occBase: pathToFileURL(occBase + "/").href,
  solidLuau,
  batteriesDir,
  runtime: "local",
});

console.log("IR unit smoke (validate/bind/canonical/eval_pose)…");
try {
  const out = await engine.execute(source, { deflection: 0.5 });
  const marker = "__IR_UNIT__";
  let payload = null;
  for (const line of String(out.stdout || "").split(/\r?\n/).reverse()) {
    const i = line.indexOf(marker);
    if (i >= 0) {
      payload = JSON.parse(line.slice(i + marker.length));
      break;
    }
  }
  if (!payload?.ok) {
    console.error("FAIL", payload);
    process.exit(1);
  }
  console.log("ir_unit_smoke PASS", payload.hash);
  process.exit(0);
} catch (err) {
  console.error("ir_unit_smoke FAIL:", err.message);
  if (err.stdout) console.error(String(err.stdout).slice(0, 6000));
  if (err.stderr) console.error(String(err.stderr).slice(0, 2000));
  process.exit(1);
} finally {
  await engine.close().catch(() => undefined);
}
