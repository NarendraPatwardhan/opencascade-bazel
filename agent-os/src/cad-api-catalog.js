/**
 * Closed CAD API catalog — source of truth for Monaco complete/hover (Phase A).
 * Keep aligned with batteries/solid.luau and host occ-bridge ops.
 */

/** @typedef {{ name: string, detail?: string, documentation?: string, insertText?: string, kind?: string }} CadSymbol */
/** @typedef {{ name: string, type?: string, documentation?: string, optional?: boolean }} CadParam */
/** @typedef {{ name: string, label: string, documentation?: string, insertText: string, params?: CadParam[], returns?: string }} CadMethod */

/** @type {CadMethod[]} */
export const SOLID_METHODS = [
  {
    name: "box",
    label: "solid.box",
    documentation: "Axis-aligned box from origin with size (dx, dy, dz). Returns a shape id.",
    insertText: "box({ dx = ${1:10}, dy = ${2:10}, dz = ${3:10} })",
    params: [
      { name: "dx", type: "number", documentation: "Size along X" },
      { name: "dy", type: "number", documentation: "Size along Y" },
      { name: "dz", type: "number", documentation: "Size along Z" },
      { name: "x", type: "number", documentation: "Alias for dx", optional: true },
      { name: "y", type: "number", documentation: "Alias for dy", optional: true },
      { name: "z", type: "number", documentation: "Alias for dz", optional: true },
    ],
    returns: "shapeId",
  },
  {
    name: "cylinder",
    label: "solid.cylinder",
    documentation: "Cylinder with radius, height, origin, and axis. Returns a shape id.",
    insertText:
      "cylinder({\n  radius = ${1:1},\n  height = ${2:1},\n  origin = { ${3:0}, ${4:0}, ${5:0} },\n  axis = { 0, 0, 1 },\n})",
    params: [
      { name: "radius", type: "number" },
      { name: "height", type: "number" },
      { name: "origin", type: "{x,y,z}", documentation: "Base point as { x, y, z } or array", optional: true },
      { name: "axis", type: "{x,y,z}", documentation: "Direction vector (default +Z)", optional: true },
      { name: "cx", type: "number", optional: true },
      { name: "cy", type: "number", optional: true },
      { name: "cz", type: "number", optional: true },
    ],
    returns: "shapeId",
  },
  {
    name: "sphere",
    label: "solid.sphere",
    documentation: "Sphere of given radius at origin. Returns a shape id.",
    insertText: "sphere({ radius = ${1:1}, origin = { ${2:0}, ${3:0}, ${4:0} } })",
    params: [
      { name: "radius", type: "number" },
      { name: "origin", type: "{x,y,z}", optional: true },
      { name: "cx", type: "number", optional: true },
      { name: "cy", type: "number", optional: true },
      { name: "cz", type: "number", optional: true },
    ],
    returns: "shapeId",
  },
  {
    name: "cone",
    label: "solid.cone",
    documentation: "Truncated cone (r1→r2) along axis. Returns a shape id.",
    insertText:
      "cone({\n  r1 = ${1:2},\n  r2 = ${2:0},\n  height = ${3:5},\n  origin = { ${4:0}, ${5:0}, ${6:0} },\n  axis = { 0, 0, 1 },\n})",
    params: [
      { name: "r1", type: "number", documentation: "Base radius" },
      { name: "r2", type: "number", documentation: "Top radius (0 = pointed)", optional: true },
      { name: "height", type: "number" },
      { name: "origin", type: "{x,y,z}", optional: true },
      { name: "axis", type: "{x,y,z}", optional: true },
    ],
    returns: "shapeId",
  },
  {
    name: "torus",
    label: "solid.torus",
    documentation: "Torus with major/minor radii. Returns a shape id.",
    insertText:
      "torus({\n  major_r = ${1:2},\n  minor_r = ${2:0.5},\n  origin = { ${3:0}, ${4:0}, ${5:0} },\n  axis = { 0, 0, 1 },\n})",
    params: [
      { name: "major_r", type: "number", documentation: "Major radius (centerline)" },
      { name: "minor_r", type: "number", documentation: "Minor (tube) radius" },
      { name: "origin", type: "{x,y,z}", optional: true },
      { name: "axis", type: "{x,y,z}", optional: true },
    ],
    returns: "shapeId",
  },
  {
    name: "fuse",
    label: "solid.fuse",
    documentation: "Boolean union of two shapes. Returns a new shape id.",
    insertText: "fuse(${1:a}, ${2:b})",
    params: [
      { name: "a", type: "shapeId" },
      { name: "b", type: "shapeId" },
    ],
    returns: "shapeId",
  },
  {
    name: "cut",
    label: "solid.cut",
    documentation: "Boolean difference: a minus b. Returns a new shape id.",
    insertText: "cut(${1:a}, ${2:b})",
    params: [
      { name: "a", type: "shapeId" },
      { name: "b", type: "shapeId" },
    ],
    returns: "shapeId",
  },
  {
    name: "intersect",
    label: "solid.intersect",
    documentation: "Boolean intersection of two shapes. Returns a new shape id.",
    insertText: "intersect(${1:a}, ${2:b})",
    params: [
      { name: "a", type: "shapeId" },
      { name: "b", type: "shapeId" },
    ],
    returns: "shapeId",
  },
  {
    name: "translate",
    label: "solid.translate",
    documentation: "Copy shape translated by (dx, dy, dz).",
    insertText: "translate(${1:id}, { dx = ${2:0}, dy = ${3:0}, dz = ${4:0} })",
    params: [
      { name: "id", type: "shapeId" },
      { name: "dx", type: "number", optional: true },
      { name: "dy", type: "number", optional: true },
      { name: "dz", type: "number", optional: true },
    ],
    returns: "shapeId",
  },
  {
    name: "rotate",
    label: "solid.rotate",
    documentation: "Copy shape rotated by angle (radians) about axis through origin.",
    insertText:
      "rotate(${1:id}, {\n  angle = ${2:math.pi / 2},\n  origin = { 0, 0, 0 },\n  axis = { 0, 0, 1 },\n})",
    params: [
      { name: "id", type: "shapeId" },
      { name: "angle", type: "number", documentation: "Angle in radians" },
      { name: "origin", type: "{x,y,z}", optional: true },
      { name: "axis", type: "{x,y,z}", optional: true },
    ],
    returns: "shapeId",
  },
  {
    name: "scale",
    label: "solid.scale",
    documentation: "Copy shape scaled about a center point.",
    insertText: "scale(${1:id}, { factor = ${2:2}, origin = { 0, 0, 0 } })",
    params: [
      { name: "id", type: "shapeId" },
      { name: "factor", type: "number" },
      { name: "origin", type: "{x,y,z}", optional: true },
    ],
    returns: "shapeId",
  },
  {
    name: "mirror",
    label: "solid.mirror",
    documentation: "Copy shape mirrored through a plane (point + normal).",
    insertText:
      "mirror(${1:id}, {\n  point = { 0, 0, 0 },\n  normal = { ${2:1}, 0, 0 },\n})",
    params: [
      { name: "id", type: "shapeId" },
      { name: "point", type: "{x,y,z}", optional: true },
      { name: "normal", type: "{x,y,z}", optional: true },
    ],
    returns: "shapeId",
  },
  {
    name: "extrude",
    label: "solid.extrude",
    documentation: "Extrude a profile shape by (dx, dy, dz). Returns a new shape id.",
    insertText: "extrude(${1:profile}, { dx = 0, dy = 0, dz = ${2:1} })",
    params: [
      { name: "profile", type: "shapeId" },
      { name: "dx", type: "number", optional: true },
      { name: "dy", type: "number", optional: true },
      { name: "dz", type: "number", optional: true },
    ],
    returns: "shapeId",
  },
  {
    name: "pipe",
    label: "solid.pipe",
    documentation: "Sweep profile along a spine wire. Returns a new shape id.",
    insertText: "pipe(${1:profile}, ${2:spine})",
    params: [
      { name: "profile", type: "shapeId" },
      { name: "spine", type: "shapeId", documentation: "Wire path" },
    ],
    returns: "shapeId",
  },
  {
    name: "fillet_all",
    label: "solid.fillet_all",
    documentation: "Fillet all edges of a solid with a given radius.",
    insertText: "fillet_all(${1:id}, { radius = ${2:0.5} })",
    params: [
      { name: "id", type: "shapeId" },
      { name: "radius", type: "number" },
    ],
    returns: "shapeId",
  },
  {
    name: "pattern_linear",
    label: "solid.pattern_linear",
    documentation:
      "Linear pattern: count copies of seed at i*(dx,dy,dz), i=0..count-1. Returns a compound.",
    insertText:
      "pattern_linear(${1:id}, { dx = ${2:10}, dy = 0, dz = 0, count = ${3:4} })",
    params: [
      { name: "id", type: "shapeId" },
      { name: "dx", type: "number" },
      { name: "dy", type: "number", optional: true },
      { name: "dz", type: "number", optional: true },
      { name: "count", type: "number" },
    ],
    returns: "shapeId",
  },
  {
    name: "pattern_polar",
    label: "solid.pattern_polar",
    documentation:
      "Polar pattern about an axis: count copies at i*angle_step (radians). Returns a compound.",
    insertText:
      "pattern_polar(${1:id}, {\n  angle_step = ${2:math.pi / 2},\n  count = ${3:4},\n  origin = { 0, 0, 0 },\n  axis = { 0, 0, 1 },\n})",
    params: [
      { name: "id", type: "shapeId" },
      { name: "angle_step", type: "number", documentation: "Radians between instances" },
      { name: "count", type: "number" },
      { name: "origin", type: "{x,y,z}", optional: true },
      { name: "axis", type: "{x,y,z}", optional: true },
    ],
    returns: "shapeId",
  },
  {
    name: "clash",
    label: "solid.clash",
    documentation:
      "Clash test with clearance band. Returns { status, name } where name is separated|clearance|interfere.",
    insertText: "clash(${1:a}, ${2:b}, ${3:0})",
    params: [
      { name: "a", type: "shapeId" },
      { name: "b", type: "shapeId" },
      { name: "clearance", type: "number", optional: true },
    ],
    returns: "{ status, name }",
  },
  {
    name: "distance",
    label: "solid.distance",
    documentation: "Minimum distance between two shapes. Returns { distance, pointOnA, pointOnB }.",
    insertText: "distance(${1:a}, ${2:b})",
    params: [
      { name: "a", type: "shapeId" },
      { name: "b", type: "shapeId" },
    ],
    returns: "{ distance, pointOnA, pointOnB }",
  },
  {
    name: "volume",
    label: "solid.volume",
    documentation: "Measure volume of a shape (host OCCT).",
    insertText: "volume(${1:id})",
    params: [{ name: "id", type: "shapeId" }],
    returns: "number",
  },
  {
    name: "bbox",
    label: "solid.bbox",
    documentation: "Axis-aligned bounding box { min, max }.",
    insertText: "bbox(${1:id})",
    params: [{ name: "id", type: "shapeId" }],
    returns: "{ min, max }",
  },
  {
    name: "finish",
    label: "solid.finish",
    documentation:
      "Emit the finished root shape for the host to mesh/export. Call once at the end of the program.",
    insertText: 'finish(${1:root}, { name = "${2:part}" })',
    params: [
      { name: "rootId", type: "shapeId" },
      { name: "extra", type: "table", documentation: "Optional metadata (e.g. name)", optional: true },
    ],
    returns: "shapeId",
  },
];

/** Module-level symbols */
export const MODULES = [
  {
    name: "solid",
    label: 'require("solid")',
    documentation: "CAD solid helpers (host-backed OCCT ops).",
    insertText: 'require("solid")',
  },
  {
    name: "json",
    label: 'require("json")',
    documentation: "JSON encode/decode (AgentOS battery).",
    insertText: 'require("json")',
  },
  {
    name: "tools",
    label: 'require("tools")',
    documentation: "Host tool broker client (prefer solid.* for CAD).",
    insertText: 'require("tools")',
  },
];

/** Snippets for common patterns */
export const SNIPPETS = [
  {
    label: "cad-hello",
    documentation: "Minimal box finished for meshing.",
    insertText:
      'local solid = require("solid")\n\nlocal root = solid.box({ dx = ${1:10}, dy = ${2:10}, dz = ${3:10} })\nsolid.finish(root, { name = "${4:part}" })\n',
  },
  {
    label: "cad-cut-hole",
    documentation: "Box with cylindrical hole.",
    insertText:
      'local solid = require("solid")\n\nlocal block = solid.box({ dx = ${1:20}, dy = ${2:20}, dz = ${3:12} })\nlocal drill = solid.cylinder({\n  radius = ${4:4},\n  height = ${5:16},\n  origin = { ${6:10}, ${7:10}, ${8:-2} },\n  axis = { 0, 0, 1 },\n})\nlocal part = solid.cut(block, drill)\nsolid.finish(part, { name = "${9:block_hole}" })\n',
  },
];

export const LUAU_KEYWORDS = [
  "and",
  "break",
  "continue",
  "do",
  "else",
  "elseif",
  "end",
  "export",
  "false",
  "for",
  "function",
  "if",
  "in",
  "local",
  "nil",
  "not",
  "or",
  "repeat",
  "return",
  "then",
  "true",
  "type",
  "typeof",
  "until",
  "while",
];
