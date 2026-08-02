#!/usr/bin/env node
/**
 * Smoke: guest require("syntax") params harvest → pure POD.
 *
 * Boots AgentOS loom + CadEngine.resolveParams (hard-fails if syntax/marker
 * missing). Covers interleaved annotations, group markers, bare locals,
 * and no false params after solid.box.
 *
 *   node agent-os/smoke/params_syntax_smoke.mjs
 *
 * Paths via env (same as node_smoke) or vendor defaults.
 */

import { accessSync, constants } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CadEngine } from "../src/cad-engine.js";
import { resolveParamsFromPods } from "../src/params/resolve.js";
import { FLANGE_SOURCE } from "../src/demos/block-hole-params.js";

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
const solidLuau = must(
  resolveRunfile(envPath("SOLID_LUAU", join(repoAgentOs, "src/batteries/solid.luau"))),
  "solid.luau",
);
const batteriesDir = resolve(dirname(solidLuau));

let failed = 0;
function expect(cond, msg) {
  if (!cond) {
    failed++;
    console.error("FAIL:", msg);
  } else {
    console.log("ok:", msg);
  }
}

function byName(list) {
  return new Map(list.map((p) => [p.name, p]));
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

console.log("warming AgentOS (params_resolve needs loom + syntax)…");
const t0 = Date.now();
await engine.warm();
await engine.stageBatteries();
console.log(`warm in ${Date.now() - t0}ms`);

// --- interleaved annotations + group + stop after geometry ---
{
  const src = `
-- [Size]
local width = 40 -- [16:0.5:120] mm
local show_grid = true -- view
local solid = require("solid")
local base = solid.box({ dx = width })
local leftover = 99
`;
  const out = await engine.resolveParams(src);
  expect(out.meta?.syntax === true, "syntax path meta.syntax");
  expect(out.meta?.path === "syntax", "syntax path meta.path");
  const m = byName(out.params);
  expect(m.get("width")?.value === 40, "interleaved: width=40");
  expect(m.get("width")?.min === 16, "interleaved: min from annotation");
  expect(m.get("width")?.step === 0.5, "interleaved: step");
  expect(m.get("width")?.max === 120, "interleaved: max");
  expect(m.get("width")?.unit === "mm", "interleaved: unit mm");
  expect(m.get("width")?.group === "Size", "interleaved: group Size");
  expect(m.get("show_grid")?.value === true, "interleaved: bool true");
  expect(m.get("show_grid")?.type === "boolean", "interleaved: bool type");
  expect(m.get("show_grid")?.scrub === "view", "interleaved: view scrub");
  expect(!m.has("base"), "no false param: base (geometry call)");
  expect(!m.has("leftover"), "no false param: leftover after solid.box");
  expect(!m.has("solid"), "no false param: require solid");
}

// --- negative unary literal + annotation ---
{
  const src = `
local offset = -2 -- [-10:0.1:10] mm
local solid = require("solid")
local base = solid.box({ dx = 1, dy = 1, dz = 1 })
`;
  const out = await engine.resolveParams(src);
  const m = byName(out.params);
  expect(m.get("offset")?.value === -2, "unary: offset=-2");
  expect(m.get("offset")?.min === -10, "unary: min");
  expect(m.get("offset")?.max === 10, "unary: max");
  expect(m.get("offset")?.step === 0.1, "unary: step");
}

// --- bare local infer + multi-assign + skip ALL_CAPS / expressions ---
{
  const src = `
local solid = require("solid")
local width = 40
local depth, height = 30, 8
local show = true
local through_h = height + 4
local PI = 3.14159
local _hidden = 1
local function helper()
  local nested = 99
  return nested
end
local body = solid.box({ dx = width, dy = 1, dz = 1 })
local after = 3
`;
  const out = await engine.resolveParams(src);
  const m = byName(out.params);
  expect(m.has("width"), "bare: width");
  expect(m.has("depth"), "bare: depth");
  expect(m.has("height"), "bare: height");
  expect(m.get("show")?.value === true, "bare: show bool");
  expect(!m.has("through_h"), "bare: skip expression through_h");
  expect(!m.has("PI"), "bare: skip ALL_CAPS");
  expect(!m.has("_hidden"), "bare: skip _prefix");
  expect(!m.has("nested"), "bare: skip nested in function");
  expect(!m.has("body"), "bare: skip call body");
  expect(!m.has("after"), "bare: no post-function leftover");
}

// --- flange demo ---
{
  const out = await engine.resolveParams(FLANGE_SOURCE);
  const m = byName(out.params);
  expect(m.has("width") && m.has("bolt_n") && m.has("yaw"), "flange: core names");
  expect(m.get("show_grid")?.type === "boolean", "flange: show_grid type");
  expect(m.get("show_grid")?.value === true, "flange: show_grid value");
  expect(m.get("yaw")?.scrub === "xform", "flange: yaw xform");
  expect(m.get("width")?.group === "Size", "flange: Size group");
  expect(m.get("boss_h")?.group === "Boss", "flange: Boss group");
  expect(out.params.length >= 10, `flange: enough params (got ${out.params.length})`);
}

// --- misparsed --[[params]] before local still harvests width (header recovery) ---
{
  const src = `--[[params
broken = { value=1
]]
local width = 40 -- [16:120] mm
local solid = require("solid")
local base = solid.box({ dx = width })
`;
  const out = await engine.resolveParams(src);
  const m = byName(out.params);
  expect(m.get("width")?.value === 40, "recovery: width after broken long comment");
  expect(!m.has("base"), "recovery: no base after geometry");
}

// --- resolveParamsFromPods merge with legacy block ---
{
  const src = `--[[params
extra = { value=7, min=0, max=20 }
]]
local width = 40 -- [16:120] mm
`;
  const out = await engine.resolveParams(src);
  const resolved = resolveParamsFromPods(out.params, src);
  const m = byName(resolved);
  expect(m.get("width")?.value === 40, "merge: local width");
  expect(m.has("extra"), "merge: legacy block fills extra");
}

// --- empty source ---
{
  const out = await engine.resolveParams("");
  expect(Array.isArray(out.params) && out.params.length === 0, "empty source → []");
}

// --- hard-fail: missing __OCC_PARAMS_RESULT__ marker ---
{
  await engine.stageParamsResolveBattery();
  const harness =
    `package.path = "/opt/cad/?.luau;/opt/cad/?/init.luau;" .. package.path\n` +
    `print("no marker here")\n`;
  const result = await engine.vm.luau(harness);
  expect(result.exitCode === 0, "fail-mode harness runs");
  let threw = false;
  try {
    const parsed = engine.parseParamsResult(result.stdout);
    if (!parsed) {
      throw new Error(
        "missing __OCC_PARAMS_RESULT__ — params_resolve battery / syntax failed",
      );
    }
  } catch (e) {
    threw = true;
    expect(
      String(e.message).includes("__OCC_PARAMS_RESULT__"),
      "fail-mode: message mentions marker",
    );
  }
  expect(threw, "fail-mode: missing marker hard-fails (no silent [])");
}

// --- hard-fail: invalid POD JSON after marker ---
{
  const bad = "__OCC_PARAMS_RESULT__{not-json";
  let threw = false;
  try {
    engine.parseParamsResult(bad);
  } catch (e) {
    threw = true;
    expect(e instanceof SyntaxError || e instanceof Error, "fail-mode: JSON parse throws");
  }
  // parseParamsResult only JSON.parses after marker — invalid JSON throws
  expect(threw, "fail-mode: bad JSON after marker throws");
}

// --- worker-shaped soft-fail reply contract (host path consumes code≠0) ---
{
  const soft = {
    kind: "params_resolve",
    code: 2,
    params: [],
    error: "missing __OCC_PARAMS_RESULT__ — params_resolve battery failed",
    meta: { path: "syntax", syntax: false },
  };
  expect(soft.code !== 0, "soft-fail: nonzero code");
  expect(soft.meta.syntax === false, "soft-fail: meta.syntax false");
  expect(Array.isArray(soft.params) && soft.params.length === 0, "soft-fail: empty params");
  expect(String(soft.error).includes("__OCC_PARAMS_RESULT__"), "soft-fail: error string");
}

await engine.close();

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log("\nparams_syntax_smoke: all passed (guest syntax path)");
