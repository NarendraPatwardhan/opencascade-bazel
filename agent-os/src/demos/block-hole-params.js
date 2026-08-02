/**
 * Main parametric demo: flange-style plate (base + boss + bore + bolt circle).
 *
 * Host owns params (BLOCK_HOLE_PARAMS); editor shows **clean Luau** only.
 * solid.use_ir(true) records solid.* into cad.ir; solid.finish evaluates IR.
 * Users do not write IR tables — they write solid.box / fuse / cut / pattern.
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
 * Clean Luau for the editor / worker.
 * solid.use_ir(true) → solid.* records IR → solid.finish evaluates IR.
 *
 * Model numbers match the param sheet (same scale as the original box+hole
 * demo: width=40 fills the view). Do **not** convert UI "mm" labels to SI
 * meters here — that made the part ~1000× too small next to the gizmo.
 * (IR schema still says store=SI; this demo uses consistent model units.)
 *
 * @param {Record<string, any>} values
 */
export function blockHoleSource(values) {
  const w = Number(values.width) || 40;
  const d = Number(values.depth) || 40;
  const h = Number(values.height) || 8;
  const bossH = Number(values.boss_h) || 10;
  const bossR = Number(values.boss_r) || 12;
  const holeR = Number(values.hole_r) || 5;
  const boltN = Math.max(2, Math.min(12, Math.round(Number(values.bolt_n) || 4)));
  const boltR = Number(values.bolt_r) || 2;
  const pcd = Number(values.pcd) || 28;
  const step = (2 * Math.PI) / boltN;
  const throughH = h + bossH + 4;
  const zTool = -2;

  return `-- Flange plate: clean Luau → IR tape → eval → mesh
-- (solid.use_ir records cad.ir ops; finish evaluates them)
local solid = require("solid")

solid.use_ir(true)

-- Base plate (centered on XY)
local base = solid.box({
  dx = ${w},
  dy = ${d},
  dz = ${h},
  corner = "centered_xy_bottom",
})

-- Raised boss
local boss = solid.cylinder({
  radius = ${bossR},
  height = ${bossH},
  origin = { 0, 0, ${h} },
  axis = { 0, 0, 1 },
})
local body = solid.fuse(base, boss)

-- Center through-bore
local bore = solid.cylinder({
  radius = ${holeR},
  height = ${throughH},
  origin = { 0, 0, ${zTool} },
  axis = { 0, 0, 1 },
})
body = solid.cut(body, bore)

-- Bolt circle
local bolt = solid.cylinder({
  radius = ${boltR},
  height = ${throughH},
  origin = { ${pcd / 2}, 0, ${zTool} },
  axis = { 0, 0, 1 },
})
local bolts = solid.pattern_polar(bolt, {
  origin = { 0, 0, 0 },
  axis = { 0, 0, 1 },
  angle_step = ${step},
  count = ${boltN},
})
local part = solid.cut(body, bolts)

solid.finish(part, { name = "flange_plate" })
`;
}
