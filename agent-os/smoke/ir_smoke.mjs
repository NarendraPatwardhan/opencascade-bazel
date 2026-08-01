#!/usr/bin/env node
/**
 * IR Path A smoke: box-cut (+ optional pipe / robot) via cad.ir Luau runtime.
 *
 * Env (same as node_smoke): AGENT_OS_KERNEL, LOOM, MC_CORE, CATALOG, OCC_BASE, SOLID_LUAU
 * Optional: IR_EXAMPLES_DIR (default: repo docs/ir/examples)
 *
 *   node agent-os/smoke/ir_smoke.mjs
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

function loadExample(name) {
  return readFileSync(join(examplesDir, name), "utf8");
}

/** Embed JSON as Luau long string; escape ]==] if present. */
function luauLongString(s) {
  let eq = "";
  while (s.includes(`]${eq}]`)) eq += "=";
  return `[${eq}[${s}]${eq}]`;
}

function makeSource(jsonText, mode) {
  // mode: "demo" | "eval_measures"
  if (mode === "demo") {
    return `
local ir = require("ir")
local json = require("json")
local doc = ir.load(${luauLongString(jsonText)})
if ir.is_fail(doc) then
  error("load: " .. tostring(doc.error and doc.error.message))
end
local res = ir.run_demo(doc, { include_measures = true })
if ir.is_fail(res) or res.ok == false then
  local e = res.error or {}
  error("eval: " .. tostring(e.code) .. " " .. tostring(e.message) .. " op_id=" .. tostring(e.op_id))
end
print("__IR_SMOKE_OK__" .. json.encode({
  root = res.root,
  measures = res.measures,
  shape_keys = (function()
    local ks = {}
    for k in pairs(res.shapes or {}) do table.insert(ks, k) end
    table.sort(ks)
    return ks
  end)(),
  frame_keys = (function()
    local ks = {}
    for k in pairs(res.frames or {}) do table.insert(ks, k) end
    table.sort(ks)
    return ks
  end)(),
}))
`;
  }
  return `
local ir = require("ir")
local json = require("json")
local doc = ir.load(${luauLongString(jsonText)})
if ir.is_fail(doc) then error(doc.error.message) end
local res = ir.eval(doc)
if ir.is_fail(res) or res.ok == false then
  local e = res.error or {}
  error(tostring(e.code) .. ": " .. tostring(e.message) .. " @ " .. tostring(e.op_id))
end
-- Emit CAD result from last geometry shape for host mesh (optional)
local root_op = res.root
local sid = res.shapes and res.shapes[root_op]
if type(sid) == "number" then
  print("__OCC_CAD_RESULT__" .. json.encode({ schema = 1, root = sid, ir_root = root_op, measures = res.measures }))
end
print("__IR_SMOKE_OK__" .. json.encode({
  root = res.root,
  measures = res.measures,
  frames = res.frames and (function()
    local n = 0
    for _ in pairs(res.frames) do n += 1 end
    return n
  end)() or 0,
}))
`;
}

function parseIrOk(stdout) {
  const marker = "__IR_SMOKE_OK__";
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

const cases = [
  {
    name: "box_cut_cyl",
    file: "box_cut_cyl.cad.json",
    check(payload) {
      if (!payload || payload.root !== "body_cut") {
        throw new Error(`box_cut: expected root body_cut, got ${JSON.stringify(payload?.root)}`);
      }
      if (!payload.measures?.viz || payload.measures.viz.kind !== "mesh") {
        throw new Error("box_cut: expected measures.viz.kind=mesh");
      }
    },
  },
  {
    name: "pipe_skid_slice",
    file: "pipe_skid_slice.cad.json",
    check(payload) {
      if (!payload?.measures?.clash_pipe_eqA) {
        throw new Error("pipe: missing clash_pipe_eqA measure");
      }
      const c = payload.measures.clash_pipe_eqA;
      if (c.kind !== "clash" || typeof c.status_code !== "number") {
        throw new Error(`pipe: bad clash measure ${JSON.stringify(c)}`);
      }
      if (typeof c.distance !== "number" || !Number.isFinite(c.distance)) {
        throw new Error(`pipe: expected finite distance, got ${c.distance}`);
      }
      console.log(`  clash_pipe_eqA status=${c.status} code=${c.status_code} dist=${c.distance}`);
      const c2 = payload.measures.clash_pipe_eqB;
      if (!c2 || c2.kind !== "clash") throw new Error("pipe: missing clash_pipe_eqB");
      console.log(`  clash_pipe_eqB status=${c2.status} code=${c2.status_code} dist=${c2.distance}`);
      const fk = payload.frame_keys || [];
      for (const name of ["nozzleA", "nozzleB"]) {
        if (!fk.includes(name)) {
          throw new Error(`pipe: missing frame ${name} in frame_keys=${JSON.stringify(fk)}`);
        }
      }
    },
  },
  {
    name: "robot_6dof_slice",
    file: "robot_6dof_slice.cad.json",
    check(payload) {
      const fk = payload?.measures?.fk;
      if (!fk || fk.kind !== "compose_chain" || fk.n !== 6) {
        throw new Error(`robot: bad fk measure ${JSON.stringify(fk)}`);
      }
      if (!Array.isArray(fk.final) || fk.final.length !== 16) {
        throw new Error("robot: final matrix length 16 required");
      }
      if (!Array.isArray(fk.prefixes) || fk.prefixes.length !== 6) {
        throw new Error("robot: prefixes length 6 required");
      }
      const ox = fk.final[3];
      const oy = fk.final[7];
      const oz = fk.final[11];
      if (![ox, oy, oz].every((v) => Number.isFinite(v))) {
        throw new Error(`robot: non-finite TCP ${ox},${oy},${oz}`);
      }
      console.log(`  TCP origin ≈ (${ox.toFixed(6)}, ${oy.toFixed(6)}, ${oz.toFixed(6)})`);
      const keys = payload.shape_keys || [];
      for (const k of ["place0", "place1", "place2", "place3", "place4", "place5"]) {
        if (!keys.includes(k)) {
          throw new Error(`robot: missing place binding ${k} in shape_keys=${JSON.stringify(keys)}`);
        }
      }
    },
  },
];

console.log("warming AgentOS + OCCT for IR smoke…");
const t0 = Date.now();
let failed = 0;

try {
  for (const c of cases) {
    console.log(`\n== IR case: ${c.name} ==`);
    const jsonText = loadExample(c.file);
    const source = makeSource(jsonText, "demo");
    try {
      // freeAll inside execute
      const out = await engine.execute(source, { deflection: 0.05 });
      const payload = parseIrOk(out.stdout);
      if (!payload) {
        throw new Error("missing __IR_SMOKE_OK__ in stdout");
      }
      c.check(payload);
      const nv = out.mesh?.vertexCount ?? 0;
      const nt = ((out.mesh?.indexCount ?? 0) / 3) | 0;
      console.log(`  mesh vertices=${nv} triangles=${nt}`);
      if (nv < 4 || nt < 1) {
        // robot places multiple links; root may be last place with small mesh
        console.warn("  warning: small mesh (root may be a thin link)");
      }
      console.log(`  PASS ${c.name}`);
    } catch (err) {
      failed++;
      console.error(`  FAIL ${c.name}:`, err.message);
      if (err.stdout) console.error("--- stdout ---\n" + String(err.stdout).slice(0, 4000));
      if (err.stderr) console.error("--- stderr ---\n" + String(err.stderr).slice(0, 2000));
    }
  }
} finally {
  await engine.close().catch(() => undefined);
}

console.log(`\nir_smoke done in ${Date.now() - t0}ms; failed=${failed}`);
process.exit(failed ? 1 : 0);
