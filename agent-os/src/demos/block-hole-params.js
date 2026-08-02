/**
 * Main parametric demo: flange-style plate (base + boss + bore + bolt circle).
 *
 * Source of truth for geometry params is the Luau `--[[params]]` block.
 * Host resolves schema via resolveParams() and injects values on execute
 * (params.width etc.) — no number rewriting into source.
 *
 * Optional seed (BLOCK_HOLE_SEED) is applied only in demo mode on re-resolve
 * (migration gaps). Editor mode never merges it — Luau is sole schema authority.
 */

/** Demo-mode seed for migration gaps only. Prefer the Luau block as authority. */
/** @type {import('../params/types.js').Parameter[]} */
export const BLOCK_HOLE_SEED = [
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

/** @deprecated Use BLOCK_HOLE_SEED — kept as alias for older imports. */
export const BLOCK_HOLE_PARAMS = BLOCK_HOLE_SEED;

/**
 * Static flange Luau: declares params, reads injected `params.*` table.
 * Host must inject values via injectParamsPrelude / worker `params` field.
 */
export const FLANGE_SOURCE = `--[[params
width   = { value=40, min=16, max=120, step=0.5, unit="mm", scrub="rebuild", group="Size", display_name="Width" }
depth   = { value=40, min=16, max=120, step=0.5, unit="mm", scrub="rebuild", group="Size", display_name="Depth" }
height  = { value=8,  min=2,  max=40,  step=0.5, unit="mm", scrub="rebuild", group="Size", display_name="Base height" }
boss_h  = { value=10, min=1,  max=40,  step=0.5, unit="mm", scrub="rebuild", group="Boss", display_name="Boss height" }
boss_r  = { value=12, min=3,  max=50,  step=0.5, unit="mm", scrub="rebuild", group="Boss", display_name="Boss radius" }
hole_r  = { value=5,  min=0.5, max=25, step=0.1, unit="mm", scrub="rebuild", group="Bore", display_name="Bore radius" }
bolt_n  = { value=4,  min=2,  max=12,  step=1,   unit="",   scrub="rebuild", group="Bolts", display_name="Bolt count" }
bolt_r  = { value=2,  min=0.5, max=8,  step=0.1, unit="mm", scrub="rebuild", group="Bolts", display_name="Bolt hole radius" }
pcd     = { value=28, min=8,  max=100, step=0.5, unit="mm", scrub="rebuild", group="Bolts", display_name="Bolt PCD" }
yaw     = { value=0,  min=-180, max=180, step=1, unit="°", scrub="xform", group="Pose", frame="F_PART", axis="y", display_name="Yaw" }
show_grid = { value=true, scrub="view", group="Display", display_name="Grid" }
]]
-- Flange plate: solid.* (always → IR → mesh). Values from host-injected params.
local solid = require("solid")

local w = params.width
local d = params.depth
local h = params.height
local boss_h = params.boss_h
local boss_r = params.boss_r
local hole_r = params.hole_r
local bolt_n = math.max(2, math.min(12, math.floor((params.bolt_n or 4) + 0.5)))
local bolt_r = params.bolt_r
local pcd = params.pcd

local step = (2 * math.pi) / bolt_n
local through_h = h + boss_h + 4
local z_tool = -2

local base = solid.box({
  dx = w,
  dy = d,
  dz = h,
  corner = "centered_xy_bottom",
})

local boss = solid.cylinder({
  radius = boss_r,
  height = boss_h,
  origin = { 0, 0, h },
  axis = { 0, 0, 1 },
})
local body = solid.fuse(base, boss)

local bore = solid.cylinder({
  radius = hole_r,
  height = through_h,
  origin = { 0, 0, z_tool },
  axis = { 0, 0, 1 },
})
body = solid.cut(body, bore)

local bolt = solid.cylinder({
  radius = bolt_r,
  height = through_h,
  origin = { pcd / 2, 0, z_tool },
  axis = { 0, 0, 1 },
})
local bolts = solid.pattern_polar(bolt, {
  origin = { 0, 0, 0 },
  axis = { 0, 0, 1 },
  angle_step = step,
  count = bolt_n,
})
local part = solid.cut(body, bolts)

solid.finish(part, { name = "flange_plate" })
`;

/**
 * Demo source (static). `values` ignored — inject path supplies runtime values.
 * @param {Record<string, any>} [_values]
 */
export function blockHoleSource(_values) {
  return FLANGE_SOURCE;
}
