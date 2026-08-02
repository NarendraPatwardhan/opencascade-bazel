#!/usr/bin/env node
/**
 * Path B Luau surface smoke: route+annulus+clash, frames FK place oracles,
 * solid high-ROI (drill, mass, revolve, shell, step_write, member), cad.* aggregator + IR.
 *
 * Env (same as node_smoke): AGENT_OS_KERNEL, LOOM, MC_CORE, CATALOG, OCC_BASE, SOLID_LUAU
 *
 *   node agent-os/smoke/solid_api_smoke.mjs
 */

import { accessSync, constants, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CadEngine } from "../src/cad-engine.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoAgentOs = resolve(here, "..");
const repoRoot = resolve(repoAgentOs, "..");

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
  const candidates = [
    p,
    join(process.env.RUNFILES_DIR || "", p),
    join(process.env.RUNFILES_DIR || "", "_main", p),
    join(process.cwd(), p),
  ];
  for (const c of candidates) {
    try {
      accessSync(c, constants.R_OK);
      return c;
    } catch {
      /* try next */
    }
  }
  return p;
}

function luauLongString(s) {
  let eq = "";
  while (s.includes(`]${eq}]`)) eq += "=";
  return `[${eq}[${s}]${eq}]`;
}

const kernel = must(
  resolveRunfile(envPath("AGENT_OS_KERNEL", join(repoAgentOs, "vendor/kernel.wasm"))),
  "kernel",
);
const loom = must(
  resolveRunfile(envPath("AGENT_OS_LOOM", join(repoAgentOs, "vendor/loom.tar"))),
  "loom",
);
const mcCore = must(
  resolveRunfile(envPath("AGENT_OS_MC_CORE", join(repoAgentOs, "vendor/mc-core.mjs"))),
  "mc-core",
);
const catalog = must(
  resolveRunfile(
    envPath("AGENT_OS_CATALOG", join(repoAgentOs, "vendor/catalog-compiler.wasm")),
  ),
  "catalog-compiler",
);
const occBase = must(
  resolveRunfile(envPath("OCC_BASE", join(repoAgentOs, "vendor/occ"))),
  "occ base dir",
);
must(join(occBase, "libocc_c.js"), "libocc_c.js");
must(join(occBase, "libocc_c.wasm"), "libocc_c.wasm");
const solidLuau = must(
  resolveRunfile(envPath("SOLID_LUAU", join(repoAgentOs, "src/batteries/solid.luau"))),
  "solid.luau",
);
const batteriesDir = resolve(dirname(solidLuau));
const examplesDir = must(
  resolveRunfile(envPath("IR_EXAMPLES_DIR", join(repoRoot, "docs/ir/examples"))),
  "IR examples",
);

const boxCutJson = readFileSync(join(examplesDir, "box_cut_cyl.cad.json"), "utf8");

/** Multi-section Path B + IR via cad aggregator with geometric oracles. */
const source = `
local cad = require("cad")
local json = require("json")

-- Aggregator fields (not only top-level requires)
local solid = cad.solid
local route = cad.route
local frames = cad.frames
local query = cad.query
local ir = cad.ir

local function almost_eq(a, b, eps)
  return math.abs(a - b) <= (eps or 1e-6)
end

-- =====================================================================
-- 1) IR via cad.ir first (eval free_all's host table — Path B after)
-- =====================================================================
local doc = ir.load(${luauLongString(boxCutJson)})
if ir.is_fail(doc) then
  error("ir load: " .. tostring(doc.error and doc.error.message))
end
assert(type(ir.canonical_json(doc)) == "string" and #ir.canonical_json(doc) > 10, "canonical_json")
assert(type(ir.hash_body(doc)) == "string" and #ir.hash_body(doc) > 0, "hash_body")
local ir_res = ir.eval(doc)
if ir.is_fail(ir_res) or ir_res.ok == false then
  local e = ir_res.error or {}
  error("ir eval: " .. tostring(e.code) .. " " .. tostring(e.message))
end
assert(ir_res.root == "body_cut", "ir_root_op body_cut got " .. tostring(ir_res.root))
local ir_root = ir_res.shapes and ir_res.shapes[ir_res.root]
assert(type(ir_root) == "number", "ir root shape id")

-- =====================================================================
-- 2) route: make_route_bends + pipe_annulus + pipe_run + clash
-- =====================================================================
local nodes = {
  { 0, 0, 0 },
  { 1.0, 0, 0 },
  { 1.0, 0.8, 0 },
}
local spine = route.make_route_bends({ nodes = nodes, bend_r = 0.15 })
local pipe = route.pipe_annulus(spine, { od = 0.1, inner = 0.08 })
local pipe_vol = query.volume(pipe)
assert(type(pipe_vol) == "number" and pipe_vol > 0, "pipe volume")
-- Annulus volume < solid OD-only ballpark: open cylinder vol ~ pi*(r^2)*L
-- L ≈ 1.0+0.8 = 1.8; outer r=0.05 → V_outer≈0.0141; wall (0.05^2-0.04^2)*pi*L≈0.0051
assert(pipe_vol < 0.012 and pipe_vol > 0.002, "annulus volume band got " .. tostring(pipe_vol))

local pipe2 = route.pipe_run({
  nodes = nodes,
  bend_r = 0.15,
  od = 0.1,
  inner = 0.08,
})
assert(query.volume(pipe2) > 0, "pipe_run volume")

-- Equipment envelope for clash (realize IR solid handles → host ids for query.*)
local eq = solid.box({ dx = 0.3, dy = 0.3, dz = 0.3 })
eq = solid.translate(eq, { dx = 0.85, dy = 0.35, dz = -0.1 })
eq = solid.realize(eq)
local clash = query.clash(pipe, eq, 0.0)
assert(type(clash.status) == "number", "clash status")
assert(type(clash.name) == "string" and #clash.name > 0, "clash name")
-- Pipe corner through eq region should interfere or clearance
assert(clash.status == 1 or clash.status == 2, "expected clearance|interfere got " .. tostring(clash.name))

local open_route = route.make_route({
  nodes = { { 0, 0, 0 }, { 0.5, 0, 0 }, { 0.5, 0.5, 0 } },
  closed = false,
})
assert(type(open_route) == "number", "make_route id")

-- =====================================================================
-- 3) frames: from_axes, compose_chain, place_at_chain (bbox moves)
-- =====================================================================
local fr = frames.from_axes({
  origin = { 1, 2, 3 },
  x = { 1, 0, 0 },
  z = { 0, 0, 1 },
})
assert(almost_eq(fr.ox, 1) and almost_eq(fr.oz, 3), "from_axes origin")
assert(almost_eq(fr.zz, 1) and almost_eq(fr.xx, 1), "from_axes axes")

local link = solid.realize(solid.box({ dx = 0.1, dy = 0.1, dz = 0.3 }))
local bb0 = query.bbox(link)
local chain = frames.compose_chain({
  origins = { { 0, 0, 0.5 } },
  axes = { { 0, 0, 1 } },
  angles = { math.pi / 2 },
})
assert(chain.n == 1 and #chain.final >= 16, "chain final")
-- Row-major 4×4 last column = translation: tx=m[3], ty=m[7], tz=m[11]
-- Joint: Trans(0,0,0.5) then RotZ(π/2) → world tz ≈ 0.5
assert(math.abs(chain.final[4]) < 1e-6, "final tx≈0 got " .. tostring(chain.final[4]))
assert(math.abs(chain.final[8]) < 1e-6, "final ty≈0 got " .. tostring(chain.final[8]))
assert(almost_eq(chain.final[12], 0.5, 1e-5), "final tz≈0.5 got " .. tostring(chain.final[12]))
-- Note: Luau is 1-based → final[4]=tx, final[8]=ty, final[12]=tz (C 0-based 3,7,11)

local placed = frames.place_at_chain(link, chain)
local bb_placed = query.bbox(placed)
assert(type(bb_placed.min) == "table", "placed bbox")
-- After place: box z extent should sit around +0.5 translation
assert(bb_placed.min[3] > bb0.min[3] + 0.3, "placed z min moved: " .. tostring(bb_placed.min[3]))

local placed_p1 = frames.place_at_chain(link, chain, 1)
assert(type(placed_p1) == "number", "prefix_1based place")

local m = frames.translation(2, 0, 0)
local moved = solid.place(link, m)
local moved_bb = query.bbox(moved)
assert(moved_bb.min[1] > 1.5, "translated bbox min.x")
local m_id = frames.identity()
local same = frames.trsf_apply(link, m_id)
assert(type(same) == "number", "trsf_apply identity")

-- =====================================================================
-- 4) solid high-ROI: drill volume drop, mass shape, shell, revolve, member, step
-- =====================================================================
local block = solid.realize(solid.box({ dx = 0.2, dy = 0.2, dz = 0.1 }))
local vol0 = query.volume(block)
local drilled = solid.drill_through(block, {
  origin = { 0.1, 0.1, 0.05 },
  direction = { 0, 0, 1 },
  diameter = 0.04,
})
local vol_drilled = query.volume(drilled)
assert(vol_drilled < vol0 * 0.99, "drill must remove material " .. vol_drilled .. " vs " .. vol0)
assert(vol_drilled > vol0 * 0.5, "drill should not destroy solid")

local mp = query.mass_properties(drilled, 7800)
assert(type(mp.mass) == "number" and mp.mass > 0, "mass")
assert(type(mp.com) == "table" and #mp.com >= 3, "com length")
assert(type(mp.inertia) == "table" and #mp.inertia >= 9, "inertia length")
for i = 1, 3 do
  assert(type(mp.com[i]) == "number" and mp.com[i] == mp.com[i], "com finite")
end

local stats = solid.mesh_stats(drilled, 0.05)
assert(type(stats.vertexCount) == "number" and stats.vertexCount > 0, "mesh_stats")

local blind_block = solid.realize(solid.box({ dx = 0.1, dy = 0.1, dz = 0.1 }))
local vol_b0 = query.volume(blind_block)
local blind = solid.drill_blind(blind_block, {
  origin = { 0.05, 0.05, 0.1 },
  direction = { 0, 0, -1 },
  diameter = 0.02,
  depth = 0.04,
})
local vol_b1 = query.volume(blind)
assert(vol_b1 < vol_b0, "blind drill removes material")

-- shell: open one face (1-based); negative thickness = inward for MakeThickSolid
local shell_box = solid.realize(solid.box({ dx = 0.05, dy = 0.05, dz = 0.05 }))
local vol_shell0 = query.volume(shell_box)
local shelled = solid.shell(shell_box, { faces = { 6 }, thickness = -0.005 })
assert(type(shelled) == "number", "shell id")
local vol_shell1 = query.volume(shelled)
assert(vol_shell1 > 0 and vol_shell1 < vol_shell0, "shell hollows solid")

-- revolve: rectangular face profile offset from Z → solid of revolution
local profile = solid.face_rectangle({
  origin = { 0.1, 0, 0 },
  normal = { 0, 1, 0 },
  width = 0.04,
  height = 0.05,
})
local revolved = solid.revolve(profile, {
  origin = { 0, 0, 0 },
  axis = { 0, 0, 1 },
  angle = math.pi / 2,
})
assert(type(revolved) == "number" and query.volume(revolved) > 0, "revolve")

-- member_sweep_rect along polyline spine
local beam_spine = route.make_route({
  nodes = { { 0, 0, 0 }, { 0.5, 0, 0 } },
})
local beam = route.member_sweep_rect(beam_spine, { width = 0.04, height = 0.06 })
assert(query.volume(beam) > 0, "member_sweep_rect volume")

-- step_write MEMFS
local step = solid.step_write(drilled, "/tmp/solid_api_smoke.step")
assert(step.ok == true and step.path == "/tmp/solid_api_smoke.step", "step_write")

print("__SOLID_API_SMOKE__" .. json.encode({
  pipe_vol = pipe_vol,
  clash_status = clash.status,
  clash_name = clash.name,
  chain_n = chain.n,
  final_tz = chain.final[12], -- Luau 1-based index for C m[11]
  placed_zmin = bb_placed.min[3],
  vol0 = vol0,
  vol_drilled = vol_drilled,
  mass = mp.mass,
  com0 = mp.com[1],
  inertia0 = mp.inertia[1],
  mesh_vertices = stats.vertexCount,
  ir_root_op = ir_res.root,
  step_path = step.path,
}))

solid.finish(pipe, { name = "solid_api_smoke" })
`;

function parseMarker(stdout, marker) {
  for (const line of String(stdout || "").split(/\r?\n/).reverse()) {
    const idx = line.indexOf(marker);
    if (idx >= 0) return JSON.parse(line.slice(idx + marker.length));
  }
  return null;
}

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

console.log("warming AgentOS + OCCT (solid_api_smoke)…");
const t0 = Date.now();
try {
  const out = await engine.execute(source, { deflection: 0.15 });
  const payload = parseMarker(out.stdout || "", "__SOLID_API_SMOKE__");
  if (!payload) {
    throw new Error("missing __SOLID_API_SMOKE__ marker in stdout — dual-goal checks not verified");
  }
  console.log("checks:", JSON.stringify(payload));
  if (!(payload.pipe_vol > 0.002 && payload.pipe_vol < 0.012)) {
    throw new Error(`pipe_vol out of annulus band: ${payload.pipe_vol}`);
  }
  if (payload.clash_status !== 1 && payload.clash_status !== 2) {
    throw new Error(`clash_status ${payload.clash_status}`);
  }
  if (payload.chain_n !== 1) throw new Error("chain_n");
  if (!(Math.abs(payload.final_tz - 0.5) < 1e-4)) throw new Error(`final_tz ${payload.final_tz}`);
  if (!(payload.placed_zmin > 0.3)) throw new Error(`placed_zmin ${payload.placed_zmin}`);
  if (!(payload.vol_drilled < payload.vol0 * 0.99)) throw new Error("drill volume drop");
  if (!(payload.mass > 0)) throw new Error("mass");
  if (!(payload.mesh_vertices > 0)) throw new Error("mesh_vertices");
  if (payload.ir_root_op !== "body_cut") throw new Error(`ir_root_op=${payload.ir_root_op}`);
  if (payload.step_path !== "/tmp/solid_api_smoke.step") throw new Error("step_path");

  const nv = out.mesh.vertexCount;
  const nt = (out.mesh.indexCount / 3) | 0;
  console.log(`ok in ${Date.now() - t0}ms mesh vertices=${nv} triangles=${nt}`);
  if (nv < 8 || nt < 4) {
    console.error("mesh too small — solid_api_smoke failed");
    process.exit(2);
  }
  console.log("solid_api_smoke PASS");
  process.exit(0);
} catch (err) {
  console.error("solid_api_smoke FAIL:", err.message);
  if (err.stdout) console.error("--- stdout ---\n" + err.stdout);
  if (err.stderr) console.error("--- stderr ---\n" + err.stderr);
  process.exit(1);
} finally {
  await engine.close().catch(() => undefined);
}
