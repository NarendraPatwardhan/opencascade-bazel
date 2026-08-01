/**
 * Demo parametric script: box with central hole.
 * Host owns params (BLOCK_HOLE_PARAMS); editor shows clean Luau only.
 */

/** @type {import('../params/types.js').Parameter[]} */
export const BLOCK_HOLE_PARAMS = [
  {
    name: "width",
    displayName: "Width",
    value: 40,
    defaultValue: 40,
    min: 5,
    max: 120,
    step: 0.5,
    unit: "mm",
    scrub: "rebuild",
    group: "Size",
  },
  {
    name: "depth",
    displayName: "Depth",
    value: 30,
    defaultValue: 30,
    min: 5,
    max: 120,
    step: 0.5,
    unit: "mm",
    scrub: "rebuild",
    group: "Size",
  },
  {
    name: "height",
    displayName: "Height",
    value: 20,
    defaultValue: 20,
    min: 2,
    max: 80,
    step: 0.5,
    unit: "mm",
    scrub: "rebuild",
    group: "Size",
  },
  {
    name: "hole_r",
    displayName: "Hole radius",
    value: 5,
    defaultValue: 5,
    min: 0.5,
    max: 25,
    step: 0.1,
    unit: "mm",
    scrub: "rebuild",
    group: "Hole",
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
 * Clean Luau for the editor / worker. No metadata dump.
 * @param {Record<string, any>} values
 */
export function blockHoleSource(values) {
  const w = Number(values.width) || 40;
  const d = Number(values.depth) || 30;
  const h = Number(values.height) || 20;
  const r = Number(values.hole_r) || 5;

  return `local solid = require("solid")

local block = solid.box({ dx = ${w}, dy = ${d}, dz = ${h} })
local drill = solid.cylinder({
  radius = ${r},
  height = ${h + 2},
  origin = { ${w / 2}, ${d / 2}, -1 },
  axis = { 0, 0, 1 },
})
local part = solid.cut(block, drill)
solid.finish(part, { name = "block_hole" })
`;
}
