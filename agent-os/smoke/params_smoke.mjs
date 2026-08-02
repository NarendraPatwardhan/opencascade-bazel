#!/usr/bin/env node
/**
 * Unit smoke: resolveParams (host fallback) / extract / infer / inject / merge.
 * No AgentOS / OCCT required — pure host JS (degraded path double).
 *
 * Product schema path (guest syntax → POD) is exercised by:
 *   node agent-os/smoke/params_syntax_smoke.mjs
 *
 *   node agent-os/smoke/params_smoke.mjs
 */

import { resolveParams } from "../src/params/resolve.js";
import {
  extractParams,
  extractRegistrationParams,
  mergeParams,
} from "../src/params/extract.js";
import { inferParams } from "../src/params/infer.js";
import {
  injectParamsPrelude,
  buildParamsInjectedSource,
  formatParamsTable,
  valuesFromParams,
  peelLeadingDirectives,
  mapAnalyzerLineToUser,
  adjustInjectedDiagnostics,
  PARAMS_INJECT_LINE_COUNT,
} from "../src/params/inject.js";
import { applyParamValuesToSource } from "../src/params/luau-locals.js";
import { adjustPreludeLines } from "../src/analyze-parse.js";
import { FLANGE_SOURCE } from "../src/demos/block-hole-params.js";

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

// --- explicit block ---
{
  const src = `--[[params
width = { value=40, min=16, max=120, unit="mm", group="Size" }
flag  = { value=true, scrub="view", group="Display" }
]]
local solid = require("solid")
local w = params.width
`;
  const p = extractParams(src);
  expect(p.length === 2, "block: two params");
  const m = byName(p);
  expect(m.get("width")?.value === 40, "block: width=40");
  expect(m.get("width")?.min === 16, "block: width min");
  expect(m.get("flag")?.type === "boolean", "block: flag boolean");
  expect(m.get("flag")?.value === true, "block: flag true");
}

// --- @param lines (numeric + boolean) ---
{
  const src = `
-- @param hole_r 5 0.5 25 mm rebuild
-- @param show_grid true
local x = 1
`;
  const p = extractParams(src);
  expect(p.length >= 2, "@param: two params");
  const hole = p.find((x) => x.name === "hole_r");
  expect(hole?.value === 5, "@param: hole_r value");
  expect(hole?.min === 0.5, "@param: hole_r min");
  const grid = p.find((x) => x.name === "show_grid");
  expect(grid?.value === true, "@param: show_grid true");
  expect(grid?.type === "boolean", "@param: show_grid boolean type");
}

// --- block + disjoint @param lines merge ---
{
  const src = `--[[params
width = { value=40, min=16, max=120 }
]]
-- @param extra 7 0 20 mm rebuild
local w = params.width
`;
  const p = extractParams(src);
  const m = byName(p);
  expect(m.has("width") && m.has("extra"), "block+@param: both names");
  expect(m.get("extra")?.value === 7, "block+@param: extra value");
}

// --- P.number registration ---
{
  const src = `
local P = require("params")
local width = P.number("width", { default=40, min=16, max=120, unit="mm", group="Size" })
local on = params.bool("enabled", { default=true, group="Flags" })
`;
  const p = extractRegistrationParams(src);
  expect(p.length === 2, "registration: two calls");
  const m = byName(p);
  expect(m.get("width")?.value === 40, "registration: width default");
  expect(m.get("width")?.min === 16, "registration: width min");
  expect(m.get("enabled")?.type === "boolean", "registration: bool type");
  expect(m.get("enabled")?.value === true, "registration: bool default");
}

// --- registration-only via resolveParams ---
{
  const src = `
local width = params.number("width", { default=40, min=16, max=120 })
local on = params.bool("enabled", { default=false })
`;
  const p = resolveParams(src);
  const m = byName(p);
  expect(m.has("width") && m.has("enabled"), "resolve registration-only");
  expect(m.get("width")?.value === 40, "resolve registration-only width");
}

// --- block ≻ registration field merge (defined-wins keeps registration min/max) ---
{
  const src = `--[[params
width = { value=50 }
]]
local width = P.number("width", { default=1, min=16, max=120, unit="mm" })
local depth = P.number("depth", { default=30, min=10, max=80 })
`;
  const p = resolveParams(src);
  const m = byName(p);
  expect(m.get("width")?.value === 50, "block≻reg: block value wins");
  expect(m.get("width")?.min === 16, "block≻reg: registration min kept");
  expect(m.get("width")?.max === 120, "block≻reg: registration max kept");
  expect(m.get("width")?.unit === "mm", "block≻reg: registration unit kept");
  expect(m.has("depth"), "block≻reg: unique registration name present");
}

// --- mergeParams defined-wins unit ---
{
  const a = mergeParams(
    [{ name: "w", value: 9, min: undefined, max: undefined }],
    [{ name: "w", value: 1, min: 0, max: 100 }, { name: "h", value: 2 }],
  );
  const m = byName(a);
  expect(m.get("w")?.value === 9, "mergeParams: extracted value");
  expect(m.get("w")?.min === 0, "mergeParams: undefined does not wipe min");
  expect(m.get("w")?.max === 100, "mergeParams: undefined does not wipe max");
  expect(m.has("h"), "mergeParams: keeps default-only name");
}

// --- inference of header locals ---
{
  const src = `
local solid = require("solid")
local width = 40
local depth, height = 30, 8
local show = true
local through_h = height + 4
local function helper()
  local nested = 99
  return nested
end
local body = solid.box({ dx = width, dy = 1, dz = 1 })
`;
  const p = inferParams(src);
  const m = byName(p);
  expect(m.has("width"), "infer: width");
  expect(m.has("depth"), "infer: depth");
  expect(m.has("height"), "infer: height");
  expect(m.get("show")?.type === "boolean", "infer: bool");
  expect(!m.has("through_h"), "infer: skip expression through_h");
  expect(!m.has("nested"), "infer: skip nested function local");
  expect(!m.has("body"), "infer: skip call assignment");
}

// --- inference: stop after first non-require call; skip ALL_CAPS ---
{
  const src = `
local w = 40
local body = solid.box({ dx = w, dy = 1, dz = 1 })
local leftover = 3
`;
  const p = inferParams(src);
  const m = byName(p);
  expect(m.has("w"), "infer: header w");
  expect(!m.has("leftover"), "infer: no post-call leftover");
  expect(!m.has("body"), "infer: no call assignment body");
}
{
  const src = `
local PI = 3.14159
local MAX = 10
local width = 40
`;
  const p = inferParams(src);
  const m = byName(p);
  expect(!m.has("PI"), "infer: skip ALL_CAPS PI");
  expect(!m.has("MAX"), "infer: skip ALL_CAPS MAX");
  expect(m.has("width"), "infer: keeps width");
}

// --- merge priority: interleaved local wins over legacy block ---
{
  const src = `--[[params
width = { value=50, min=10, max=200, unit="mm", group="Size" }
]]
local width = 40 -- [10:0.5:200] mm
local extra = 7
`;
  const resolved = resolveParams(src);
  const m = byName(resolved);
  expect(m.get("width")?.value === 40, "merge: local value wins over block");
  expect(m.get("width")?.max === 200, "merge: trailing annotation max");
  expect(m.has("extra"), "merge: bare local extra inferred");
}

// --- interleaved annotations ---
{
  const src = `
-- [Size]
local width = 40 -- [16:0.5:120] mm
local show_grid = true -- view
local solid = require("solid")
local base = solid.box({ dx = width })
`;
  const resolved = resolveParams(src);
  const m = byName(resolved);
  expect(m.get("width")?.min === 16, "interleaved: min");
  expect(m.get("width")?.step === 0.5, "interleaved: step");
  expect(m.get("width")?.group === "Size", "interleaved: group marker");
  expect(m.get("show_grid")?.type === "boolean", "interleaved: bool");
  expect(m.get("show_grid")?.scrub === "view", "interleaved: view scrub");
  expect(!m.has("base"), "interleaved: no post-geometry local");
}

// --- seed fills only missing ---
{
  const src = `--[[params
width = { value=40, min=16, max=120 }
]]
`;
  const seed = [
    { name: "width", value: 1, min: 0, max: 2 },
    { name: "yaw", value: 0, min: -180, max: 180, scrub: "xform" },
  ];
  const resolved = resolveParams(src, { seed });
  const m = byName(resolved);
  expect(m.get("width")?.value === 40, "seed: does not override width");
  expect(m.has("yaw"), "seed: adds yaw");
  expect(m.get("yaw")?.scrub === "xform", "seed: yaw scrub");
}

// --- seed-only when source empty / no schema ---
{
  const seed = [
    { name: "width", value: 40, min: 16, max: 120 },
    { name: "yaw", value: 0, scrub: "xform" },
  ];
  const empty = resolveParams("", { seed });
  expect(empty.length === 2, "seed-only: empty source returns seed");
  expect(byName(empty).get("width")?.value === 40, "seed-only: width value");
  const bare = resolveParams('local solid = require("solid")\n', { seed });
  expect(bare.length === 2, "seed-only: require-only → seed");
  expect(byName(bare).has("yaw"), "seed-only: yaw present");
}

// --- no false positives deep in functions ---
{
  const src = `
local solid = require("solid")
local function build()
  local magic = 12345
  return solid.box({ dx = magic, dy = 1, dz = 1 })
end
build()
`;
  const p = inferParams(src);
  expect(p.length === 0, "infer: empty when only nested magic");
  const r = resolveParams(src);
  expect(r.length === 0, "resolve: empty without declarations");
}

// --- flange demo source resolves ---
{
  const p = resolveParams(FLANGE_SOURCE);
  const m = byName(p);
  expect(m.has("width") && m.has("bolt_n") && m.has("yaw"), "flange: core names");
  expect(m.get("show_grid")?.type === "boolean", "flange: show_grid bool");
  expect(m.get("yaw")?.scrub === "xform", "flange: yaw xform");
  expect(p.length >= 10, "flange: enough params");
}

// --- inject prelude dual bind (require params) ---
{
  const { source, lineCount } = injectParamsPrelude({
    width: 42.5,
    show_grid: false,
    name: "plate",
  });
  expect(lineCount === PARAMS_INJECT_LINE_COUNT, "inject: lineCount === PARAMS_INJECT_LINE_COUNT");
  expect(source.includes("width = 42.5"), "inject: number");
  expect(source.includes("show_grid = false"), "inject: bool");
  expect(source.includes('name = "plate"'), "inject: string");
  expect(source.includes('params = require("params")'), "inject: method-capable params");
  expect(source.includes("_HOST_PARAMS"), "inject: _HOST_PARAMS");
  expect(formatParamsTable({}) === "{}", "inject: empty table");
  const vals = valuesFromParams([{ name: "a", value: 1 }]);
  expect(vals.a === 1, "valuesFromParams");
}

// --- literal rewrite preserves trailing annotations (execute path) ---
{
  const user = `local width = 40 -- [16:120] mm\nlocal show = true -- view\nlocal z = -2\n`;
  const rewritten = applyParamValuesToSource(user, {
    width: 99,
    show: false,
    z: -5,
  });
  expect(rewritten.includes("local width = 99"), "rewrite: number");
  expect(rewritten.includes("-- [16:120] mm"), "rewrite: keep trailing annotation");
  expect(rewritten.includes("local show = false"), "rewrite: bool");
  expect(rewritten.includes("-- view"), "rewrite: keep view scrub comment");
  expect(rewritten.includes("local z = -5"), "rewrite: signed number");

  const built = buildParamsInjectedSource(user, { width: 99, show: false, z: -5 });
  expect(built.source.includes("local width = 99"), "build inject: rewritten width");
  expect(built.source.includes("-- [16:120] mm"), "build inject: trailing kept");
  expect(built.source.includes("_HOST_PARAMS"), "build inject: host table");
  expect(built.source.includes("local show = false"), "build inject: bool rewrite");
}

// --- inject skip non-identifiers / non-literals ---
{
  const t = formatParamsTable({ "a-b": 1, ok: 2, bad: { x: 1 }, n: NaN, z: null });
  expect(t.includes("ok = 2"), "inject skip: ok kept");
  expect(!t.includes("a-b"), "inject skip: bad key");
  expect(!t.includes("bad"), "inject skip: object value");
}

// --- hot comments peeled before inject ---
{
  const user = `--!strict\n--!native\nlocal w = params.width\n`;
  const peeled = peelLeadingDirectives(user);
  expect(peeled.headLineCount === 2, "peel: two hot comments");
  expect(peeled.head.startsWith("--!strict"), "peel: head starts with strict");
  const built = buildParamsInjectedSource(user, { width: 1 });
  expect(built.source.startsWith("--!strict"), "hot: inject after --!strict");
  expect(built.headLineCount === 2, "hot: headLineCount");
  expect(built.injectLineCount === 2, "hot: injectLineCount");
  const lines = built.source.split("\n");
  expect(lines[0] === "--!strict", "hot: line0 strict");
  expect(lines[2].startsWith("_HOST_PARAMS"), "hot: inject after head");
  // lineCount matches non-empty inject lines
  const injOnly = injectParamsPrelude({ a: 1 });
  const nonEmpty = injOnly.source.split("\n").filter((l) => l.length > 0).length;
  expect(injOnly.lineCount === nonEmpty, "inject: lineCount matches non-empty lines");
}

// --- adjustInjectedDiagnostics / mapAnalyzerLineToUser ---
{
  // No head: inject at lines 1-2, user starts at analyzer 3 → user 1
  const diags = [
    { line: 1, message: "in inject" },
    { line: 2, message: "in inject" },
    { line: 3, message: "user" },
    { line: 5, message: "later" },
  ];
  const adj = adjustInjectedDiagnostics(diags, {
    packagePathLines: 0,
    headLineCount: 0,
    injectLineCount: 2,
  });
  expect(adj.length === 2, "adjust: drops inject lines");
  expect(adj[0].line === 1 && adj[0].message === "user", "adjust: line 3→1");
  expect(adj[1].line === 3, "adjust: line 5→3");

  // With head (2) + inject (2): analyzer 1-2 = head, 3-4 = inject, 5 = user 3
  expect(mapAnalyzerLineToUser(1, { headLineCount: 2, injectLineCount: 2 }) === 1, "map: head line1");
  expect(mapAnalyzerLineToUser(2, { headLineCount: 2, injectLineCount: 2 }) === 2, "map: head line2");
  expect(mapAnalyzerLineToUser(3, { headLineCount: 2, injectLineCount: 2 }) === null, "map: inject drop");
  expect(mapAnalyzerLineToUser(5, { headLineCount: 2, injectLineCount: 2 }) === 3, "map: body→user");

  // Execute: package.path (1) + head0 + inject2
  expect(
    mapAnalyzerLineToUser(4, { packagePathLines: 1, headLineCount: 0, injectLineCount: 2 }) === 1,
    "map: execute package+inject → user1",
  );
  expect(
    mapAnalyzerLineToUser(1, { packagePathLines: 1, headLineCount: 0, injectLineCount: 2 }) === null,
    "map: package.path dropped",
  );

  // adjustPreludeLines identity / drop
  const simple = adjustPreludeLines(
    [
      { line: 3, message: "a" },
      { line: 1, message: "b" },
      { line: 2, message: "c" },
    ],
    2,
  );
  expect(simple.length === 1 && simple[0].line === 1, "adjustPreludeLines: drop prelude");
  expect(adjustPreludeLines([{ line: 5, message: "x" }], 0)[0].line === 5, "adjustPreludeLines: identity");
}

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log("\nparams_smoke: all passed");
