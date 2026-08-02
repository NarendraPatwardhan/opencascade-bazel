#!/usr/bin/env node
/**
 * Node smoke: AgentOS loom Luau + libocc_c Wasm → mesh triangle count.
 *
 * solid.* always records cad.ir; solid.finish evaluates the tape and emits
 * __OCC_CAD_RESULT__ so the host can mesh the root shape id.
 *
 * Paths via env (Bazel runfiles) or CLI:
 *   AGENT_OS_KERNEL, AGENT_OS_LOOM, AGENT_OS_MC_CORE, AGENT_OS_CATALOG,
 *   OCC_BASE (dir with libocc_c.js/wasm), SOLID_LUAU
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

const source = `
local solid = require("solid")
local block = solid.box({ dx = 10, dy = 10, dz = 10 })
local drill = solid.cylinder({
  radius = 2.5,
  height = 12,
  origin = { 5, 5, -1 },
  axis = { 0, 0, 1 },
})
local part = solid.cut(block, drill)
solid.finish(part, { name = "node_smoke" })
`;

const engine = new CadEngine({
  kernel,
  loom,
  mcCore,
  catalogCompiler: catalog,
  occBase: pathToFileURL(occBase + "/").href,
  solidLuau,
  runtime: "local",
});

console.log("warming AgentOS + OCCT…");
const t0 = Date.now();
try {
  const out = await engine.execute(source, { deflection: 0.2 });
  const nv = out.mesh.vertexCount;
  const nt = (out.mesh.indexCount / 3) | 0;
  console.log(`ok in ${Date.now() - t0}ms`);
  console.log(`occ ${out.meta.occVersion}`);
  console.log(`mesh vertices=${nv} triangles=${nt}`);
  if (out.mesh.volume != null) console.log(`volume=${out.mesh.volume}`);
  if (nv < 8 || nt < 4) {
    console.error("mesh too small — smoke failed");
    process.exit(2);
  }
  console.log("node_smoke PASS");
  process.exit(0);
} catch (err) {
  console.error("node_smoke FAIL:", err.message);
  if (err.stdout) console.error("--- stdout ---\n" + err.stdout);
  if (err.stderr) console.error("--- stderr ---\n" + err.stderr);
  process.exit(1);
} finally {
  await engine.close().catch(() => undefined);
}
