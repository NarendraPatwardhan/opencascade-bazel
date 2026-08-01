/**
 * Main parametric demo: flange-style plate (base + boss + bore + bolt circle).
 *
 * Host owns params (BLOCK_HOLE_PARAMS); editor shows clean Luau only.
 * Geometry is authored as an IR document and evaluated through cad.ir
 * (Luau → IR → Luau eval → host/occ_c) — same UX as the original demo.
 */

/** @type {import('../params/types.js').Parameter[]} */
export const BLOCK_HOLE_PARAMS = [
  {
    name: "width",
    displayName: "Width",
    value: 40,
    defaultValue: 40,
    min: 16,
    max: 120,
    step: 0.5,
    unit: "mm",
    scrub: "rebuild",
    group: "Size",
  },
  {
    name: "depth",
    displayName: "Depth",
    value: 40,
    defaultValue: 40,
    min: 16,
    max: 120,
    step: 0.5,
    unit: "mm",
    scrub: "rebuild",
    group: "Size",
  },
  {
    name: "height",
    displayName: "Base height",
    value: 8,
    defaultValue: 8,
    min: 2,
    max: 40,
    step: 0.5,
    unit: "mm",
    scrub: "rebuild",
    group: "Size",
  },
  {
    name: "boss_h",
    displayName: "Boss height",
    value: 10,
    defaultValue: 10,
    min: 1,
    max: 40,
    step: 0.5,
    unit: "mm",
    scrub: "rebuild",
    group: "Boss",
  },
  {
    name: "boss_r",
    displayName: "Boss radius",
    value: 12,
    defaultValue: 12,
    min: 3,
    max: 50,
    step: 0.5,
    unit: "mm",
    scrub: "rebuild",
    group: "Boss",
  },
  {
    name: "hole_r",
    displayName: "Bore radius",
    value: 5,
    defaultValue: 5,
    min: 0.5,
    max: 25,
    step: 0.1,
    unit: "mm",
    scrub: "rebuild",
    group: "Bore",
  },
  {
    name: "bolt_n",
    displayName: "Bolt count",
    value: 4,
    defaultValue: 4,
    min: 2,
    max: 12,
    step: 1,
    unit: "",
    scrub: "rebuild",
    group: "Bolts",
  },
  {
    name: "bolt_r",
    displayName: "Bolt hole radius",
    value: 2,
    defaultValue: 2,
    min: 0.5,
    max: 8,
    step: 0.1,
    unit: "mm",
    scrub: "rebuild",
    group: "Bolts",
  },
  {
    name: "pcd",
    displayName: "Bolt PCD",
    value: 28,
    defaultValue: 28,
    min: 8,
    max: 100,
    step: 0.5,
    unit: "mm",
    scrub: "rebuild",
    group: "Bolts",
  },
  {
    name: "yaw",
    displayName: "Yaw",
    value: 0,
    defaultValue: 0,
    min: -180,
    max: 180,
    step: 1,
    unit: "°",
    scrub: "xform",
    group: "Pose",
    frame: "F_PART",
    axis: "y",
  },
  {
    name: "show_grid",
    displayName: "Grid",
    value: true,
    defaultValue: true,
    type: "boolean",
    scrub: "view",
    group: "Display",
  },
];

/**
 * mm display param → meters (SI) for IR / occ_c.
 * @param {number} mm
 */
function m(mm) {
  return (Number(mm) || 0) / 1000;
}

/**
 * Clean Luau for the editor / worker. Builds IR then evaluates via cad.ir.
 * User still sees a short parametric script — not raw IR JSON editing.
 * @param {Record<string, any>} values
 */
export function blockHoleSource(values) {
  const wMm = Number(values.width) || 40;
  const dMm = Number(values.depth) || 40;
  const hMm = Number(values.height) || 8;
  const bossHMm = Number(values.boss_h) || 10;
  const bossRMm = Number(values.boss_r) || 12;
  const holeRMm = Number(values.hole_r) || 5;
  const boltN = Math.max(2, Math.min(12, Math.round(Number(values.bolt_n) || 4)));
  const boltRMm = Number(values.bolt_r) || 2;
  const pcdMm = Number(values.pcd) || 28;

  // SI meters for IR
  const w = m(wMm);
  const d = m(dMm);
  const h = m(hMm);
  const bossH = m(bossHMm);
  const bossR = m(bossRMm);
  const holeR = m(holeRMm);
  const boltR = m(boltRMm);
  const pcd = m(pcdMm);
  const step = (2 * Math.PI) / boltN;
  // Tool lengths slightly past solids
  const throughH = h + bossH + m(4);
  const zTool = -m(2);

  return `-- Flange-style plate via IR (Luau builds IR → ir.eval → occ_c)
-- Base plate + raised boss + center bore + polar bolt circle.
local ir = require("ir")

local doc = {
  ir_schema = "cad.ir/v0",
  id = "demo_flange_plate",
  version = "0.1.0",
  units = { length = "meter", angle = "radian", store = "SI" },
  params = {},
  ops = {
    -- 1) Rectangular base, centered on XY so yaw pivots cleanly
    {
      id = "base",
      op = "PrimBox",
      params = {
        dx = ${w},
        dy = ${d},
        dz = ${h},
        corner = "centered_xy_bottom",
      },
    },
    -- 2) Raised cylindrical boss on top of the base
    {
      id = "boss",
      op = "PrimCylinder",
      params = {
        radius = ${bossR},
        height = ${bossH},
        origin = { 0, 0, ${h} },
        axis = { 0, 0, 1 },
      },
    },
    {
      id = "body",
      op = "BoolCombine",
      params = { mode = "union" },
      refs = {
        target = { created_by = "base", entity = "body" },
        tools = { { created_by = "boss", entity = "body" } },
      },
    },
    -- 3) Center through-bore
    {
      id = "bore_tool",
      op = "PrimCylinder",
      params = {
        radius = ${holeR},
        height = ${throughH},
        origin = { 0, 0, ${zTool} },
        axis = { 0, 0, 1 },
      },
    },
    {
      id = "with_bore",
      op = "BoolCombine",
      params = { mode = "subtract" },
      refs = {
        target = { created_by = "body", entity = "body" },
        tools = { { created_by = "bore_tool", entity = "body" } },
      },
    },
    -- 4) Bolt hole seed on the pitch circle, then polar pattern
    {
      id = "bolt_seed",
      op = "PrimCylinder",
      params = {
        radius = ${boltR},
        height = ${throughH},
        origin = { ${pcd / 2}, 0, ${zTool} },
        axis = { 0, 0, 1 },
      },
    },
    {
      id = "bolt_pattern",
      op = "PatternPolar",
      params = {
        origin = { 0, 0, 0 },
        axis = { 0, 0, 1 },
        angle_step = ${step},
        count = ${boltN},
      },
      refs = {
        shape = { created_by = "bolt_seed", entity = "body" },
      },
    },
    {
      id = "part",
      op = "BoolCombine",
      params = { mode = "subtract" },
      refs = {
        target = { created_by = "with_bore", entity = "body" },
        tools = { { created_by = "bolt_pattern", entity = "body" } },
      },
    },
  },
  meta = {
    author = "demo",
    goals = { "browser-demo" },
    lib_versions = { cad_ir = "0.1.0", occ_c = "7.9.3-api", occt = "7.9.3" },
    kernel_version = "7.9.3",
    strict = true,
  },
}

local res = ir.run_demo(doc, { root = "part" })
if type(res) == "table" and res.ok == false then
  local e = res.error or {}
  error(tostring(e.message or e.code or "IR eval failed"))
end
`;
}
