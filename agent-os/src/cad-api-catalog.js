/**
 * Closed CAD API catalog — source of truth for Monaco complete/hover (Phase A).
 * Keep aligned with batteries/{solid,route,frames,query,cad}.luau, ir/, and host occ-bridge ops.
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
    name: "mesh_stats",
    label: "solid.mesh_stats",
    documentation: "Mesh stats only (vertex/index counts); no full mesh payload.",
    insertText: "mesh_stats(${1:id}, ${2:0.1})",
    params: [
      { name: "id", type: "shapeId" },
      { name: "deflection", type: "number", optional: true },
    ],
    returns: "{ vertexCount, indexCount, … }",
  },
  {
    name: "mass_properties",
    label: "solid.mass_properties",
    documentation: "Density-scaled mass, COM, and inertia tensor (row-major 3×3).",
    insertText: "mass_properties(${1:id}, ${2:1})",
    params: [
      { name: "id", type: "shapeId" },
      { name: "density", type: "number", optional: true },
    ],
    returns: "{ mass, com, inertia, density }",
  },
  {
    name: "face_rectangle",
    label: "solid.face_rectangle",
    documentation: "Planar rectangle face (profile for extrude/revolve).",
    insertText:
      "face_rectangle({\n  origin = { ${1:0}, 0, 0 },\n  normal = { 0, 0, 1 },\n  width = ${2:0.1},\n  height = ${3:0.05},\n})",
    params: [
      { name: "origin", type: "{x,y,z}", optional: true },
      { name: "normal", type: "{x,y,z}", optional: true },
      { name: "width", type: "number" },
      { name: "height", type: "number" },
    ],
    returns: "shapeId",
  },
  {
    name: "revolve",
    label: "solid.revolve",
    documentation: "Revolve a profile about an axis by angle (radians).",
    insertText:
      "revolve(${1:profile}, {\n  angle = ${2:2 * math.pi},\n  origin = { 0, 0, 0 },\n  axis = { 0, 0, 1 },\n})",
    params: [
      { name: "profile", type: "shapeId" },
      { name: "angle", type: "number", documentation: "Radians (default 2π)" },
      { name: "origin", type: "{x,y,z}", optional: true },
      { name: "axis", type: "{x,y,z}", optional: true },
    ],
    returns: "shapeId",
  },
  {
    name: "offset",
    label: "solid.offset",
    documentation: "Uniform 3D offset of a solid.",
    insertText: "offset(${1:id}, { offset = ${2:0.1} })",
    params: [
      { name: "id", type: "shapeId" },
      { name: "offset", type: "number" },
    ],
    returns: "shapeId",
  },
  {
    name: "shell",
    label: "solid.shell",
    documentation: "Hollow shell: open listed 1-based faces with thickness.",
    insertText: "shell(${1:id}, { faces = { ${2:1} }, thickness = ${3:0.1} })",
    params: [
      { name: "id", type: "shapeId" },
      { name: "faces", type: "{number}", documentation: "1-based face indices to open" },
      { name: "thickness", type: "number" },
    ],
    returns: "shapeId",
  },
  {
    name: "drill_through",
    label: "solid.drill_through",
    documentation: "Through cylindrical hole (tool length auto from bbox).",
    insertText:
      "drill_through(${1:id}, {\n  origin = { ${2:0}, ${3:0}, ${4:0} },\n  direction = { 0, 0, 1 },\n  diameter = ${5:1},\n})",
    params: [
      { name: "id", type: "shapeId" },
      { name: "origin", type: "{x,y,z}" },
      { name: "direction", type: "{x,y,z}", optional: true },
      { name: "diameter", type: "number" },
    ],
    returns: "shapeId",
  },
  {
    name: "drill_blind",
    label: "solid.drill_blind",
    documentation: "Blind cylindrical hole of given depth.",
    insertText:
      "drill_blind(${1:id}, {\n  origin = { ${2:0}, ${3:0}, ${4:0} },\n  direction = { 0, 0, 1 },\n  diameter = ${5:1},\n  depth = ${6:2},\n})",
    params: [
      { name: "id", type: "shapeId" },
      { name: "origin", type: "{x,y,z}" },
      { name: "direction", type: "{x,y,z}", optional: true },
      { name: "diameter", type: "number" },
      { name: "depth", type: "number" },
    ],
    returns: "shapeId",
  },
  {
    name: "member_sweep_rect",
    label: "solid.member_sweep_rect",
    documentation: "Rectangular structural member along a spine wire.",
    insertText: "member_sweep_rect(${1:spine}, { width = ${2:0.1}, height = ${3:0.2} })",
    params: [
      { name: "spine", type: "shapeId" },
      { name: "width", type: "number" },
      { name: "height", type: "number" },
    ],
    returns: "shapeId",
  },
  {
    name: "trsf_apply",
    label: "solid.trsf_apply",
    documentation: "Apply row-major 4×4 rigid transform (copy) → new shape id.",
    insertText: "trsf_apply(${1:id}, ${2:matrix4x4})",
    params: [
      { name: "id", type: "shapeId" },
      { name: "matrix4x4", type: "{number×16}" },
    ],
    returns: "shapeId",
  },
  {
    name: "place",
    label: "solid.place",
    documentation: "Alias for trsf_apply — place shape by 4×4.",
    insertText: "place(${1:id}, ${2:matrix4x4})",
    params: [
      { name: "id", type: "shapeId" },
      { name: "matrix4x4", type: "{number×16}" },
    ],
    returns: "shapeId",
  },
  {
    name: "free",
    label: "solid.free",
    documentation: "Free one host shape id.",
    insertText: "free(${1:id})",
    params: [{ name: "id", type: "shapeId" }],
    returns: "nil",
  },
  {
    name: "free_all",
    label: "solid.free_all",
    documentation: "Free all host shapes (Path B cleanup).",
    insertText: "free_all()",
    params: [],
    returns: "nil",
  },
  {
    name: "step_write",
    label: "solid.step_write",
    documentation:
      "Write STEP to Emscripten MEMFS path (path required; use a unique name to avoid clobber).",
    insertText: 'step_write(${1:id}, "/tmp/${2:part}.step")',
    params: [
      { name: "id", type: "shapeId" },
      { name: "path", type: "string" },
    ],
    returns: "{ path, ok }",
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

/** @type {CadMethod[]} */
export const ROUTE_METHODS = [
  {
    name: "make_route",
    label: "route.make_route",
    documentation: "Polyline route wire from nodes (nested Vec3 or flat xyz).",
    insertText:
      "make_route({\n  nodes = {\n    { ${1:0}, 0, 0 },\n    { ${2:1}, 0, 0 },\n    { 1, ${3:1}, 0 },\n  },\n})",
    params: [
      { name: "nodes", type: "{{x,y,z}}" },
      { name: "closed", type: "boolean", optional: true },
    ],
    returns: "shapeId",
  },
  {
    name: "make_route_bends",
    label: "route.make_route_bends",
    documentation: "Route with circular bend fillets (G1 spine for pipe annulus).",
    insertText:
      "make_route_bends({\n  nodes = {\n    { 0, 0, 0 },\n    { ${1:1}, 0, 0 },\n    { 1, ${2:1}, 0 },\n  },\n  bend_r = ${3:0.15},\n})",
    params: [
      { name: "nodes", type: "{{x,y,z}}" },
      { name: "bend_r", type: "number" },
    ],
    returns: "shapeId",
  },
  {
    name: "pipe_annulus",
    label: "route.pipe_annulus",
    documentation: "Hollow pipe (OD/ID) swept along spine wire.",
    insertText: "pipe_annulus(${1:spine}, { od = ${2:0.1}, inner = ${3:0.08} })",
    params: [
      { name: "spine", type: "shapeId" },
      { name: "od", type: "number" },
      { name: "inner", type: "number" },
    ],
    returns: "shapeId",
  },
  {
    name: "pipe_run",
    label: "route.pipe_run",
    documentation: "Convenience: bend route + annulus solid (frees intermediate spine).",
    insertText:
      "pipe_run({\n  nodes = { { 0, 0, 0 }, { ${1:1}, 0, 0 }, { 1, ${2:1}, 0 } },\n  bend_r = ${3:0.15},\n  od = ${4:0.1},\n  inner = ${5:0.08},\n})",
    params: [
      { name: "nodes", type: "{{x,y,z}}" },
      { name: "bend_r", type: "number" },
      { name: "od", type: "number" },
      { name: "inner", type: "number" },
    ],
    returns: "shapeId",
  },
  {
    name: "member_sweep_rect",
    label: "route.member_sweep_rect",
    documentation: "Rectangular structural member along a spine (also solid.member_sweep_rect).",
    insertText: "member_sweep_rect(${1:spine}, { width = ${2:0.1}, height = ${3:0.2} })",
    params: [
      { name: "spine", type: "shapeId" },
      { name: "width", type: "number" },
      { name: "height", type: "number" },
    ],
    returns: "shapeId",
  },
];

/** @type {CadMethod[]} */
export const FRAMES_METHODS = [
  {
    name: "from_axes",
    label: "frames.from_axes",
    documentation: "Orthonormal frame POD from origin + X hint + Z (host).",
    insertText:
      "from_axes({\n  origin = { ${1:0}, ${2:0}, ${3:0} },\n  x = { 1, 0, 0 },\n  z = { 0, 0, 1 },\n})",
    params: [
      { name: "origin", type: "{x,y,z}", optional: true },
      { name: "x", type: "{x,y,z}", optional: true },
      { name: "z", type: "{x,y,z}", optional: true },
    ],
    returns: "FramePod",
  },
  {
    name: "compose_chain",
    label: "frames.compose_chain",
    documentation: "Serial FK: n revolute joints → prefix 4×4 matrices + final.",
    insertText:
      "compose_chain({\n  origins = { { 0, 0, ${1:0.3} } },\n  axes = { { 0, 0, 1 } },\n  angles = { ${2:0} },\n})",
    params: [
      { name: "origins", type: "{{x,y,z}}" },
      { name: "axes", type: "{{x,y,z}}" },
      { name: "angles", type: "{number}", documentation: "Radians" },
    ],
    returns: "{ n, prefixes, final }",
  },
  {
    name: "trsf_apply",
    label: "frames.trsf_apply",
    documentation: "Apply row-major 4×4 to shape → new id.",
    insertText: "trsf_apply(${1:id}, ${2:matrix4x4})",
    params: [
      { name: "id", type: "shapeId" },
      { name: "matrix4x4", type: "{number×16}" },
    ],
    returns: "shapeId",
  },
  {
    name: "place_at_chain",
    label: "frames.place_at_chain",
    documentation:
      "Place shape at chain.final or prefixes[prefix_1based] (Luau 1-based: 1..n). Prefer over place() vs solid.place(matrix).",
    insertText: "place_at_chain(${1:id}, ${2:chain})",
    params: [
      { name: "id", type: "shapeId" },
      { name: "chain", type: "ComposeChainResult" },
      { name: "prefix_1based", type: "number?", documentation: "1..n; omit for final", optional: true },
    ],
    returns: "shapeId",
  },
  {
    name: "place",
    label: "frames.place",
    documentation: "Alias for place_at_chain (1-based prefix). solid.place takes a matrix only.",
    insertText: "place(${1:id}, ${2:chain})",
    params: [
      { name: "id", type: "shapeId" },
      { name: "chain", type: "ComposeChainResult" },
      { name: "prefix_1based", type: "number?", optional: true },
    ],
    returns: "shapeId",
  },
  {
    name: "identity",
    label: "frames.identity",
    documentation: "Identity 4×4 row-major matrix.",
    insertText: "identity()",
    params: [],
    returns: "{number×16}",
  },
  {
    name: "translation",
    label: "frames.translation",
    documentation: "Pure translation 4×4.",
    insertText: "translation(${1:0}, ${2:0}, ${3:0})",
    params: [
      { name: "dx", type: "number" },
      { name: "dy", type: "number" },
      { name: "dz", type: "number" },
    ],
    returns: "{number×16}",
  },
];

/** @type {CadMethod[]} */
export const QUERY_METHODS = [
  {
    name: "clash",
    label: "query.clash",
    documentation: "Clash test with clearance band.",
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
    label: "query.distance",
    documentation: "Minimum distance between two shapes.",
    insertText: "distance(${1:a}, ${2:b})",
    params: [
      { name: "a", type: "shapeId" },
      { name: "b", type: "shapeId" },
    ],
    returns: "{ distance, pointOnA, pointOnB }",
  },
  {
    name: "volume",
    label: "query.volume",
    documentation: "Measure volume.",
    insertText: "volume(${1:id})",
    params: [{ name: "id", type: "shapeId" }],
    returns: "number",
  },
  {
    name: "bbox",
    label: "query.bbox",
    documentation: "Axis-aligned bounding box.",
    insertText: "bbox(${1:id})",
    params: [{ name: "id", type: "shapeId" }],
    returns: "{ min, max }",
  },
  {
    name: "mesh_stats",
    label: "query.mesh_stats",
    documentation: "Mesh stats only (no full arrays).",
    insertText: "mesh_stats(${1:id}, ${2:0.1})",
    params: [
      { name: "id", type: "shapeId" },
      { name: "deflection", type: "number", optional: true },
    ],
    returns: "{ vertexCount, indexCount, … }",
  },
  {
    name: "mass_properties",
    label: "query.mass_properties",
    documentation: "Mass, COM, inertia at given density.",
    insertText: "mass_properties(${1:id}, ${2:1})",
    params: [
      { name: "id", type: "shapeId" },
      { name: "density", type: "number", optional: true },
    ],
    returns: "{ mass, com, inertia, density }",
  },
];

/** @type {CadMethod[]} */
export const IR_METHODS = [
  {
    name: "load",
    label: "ir.load",
    documentation: "Parse cad.ir/v0 JSON string or table → document.",
    insertText: "load(${1:source})",
    params: [{ name: "source", type: "string|table" }],
    returns: "doc | fail",
  },
  {
    name: "validate",
    label: "ir.validate",
    documentation: "Luau-first IR validator.",
    insertText: "validate(${1:doc})",
    params: [{ name: "doc", type: "doc" }],
    returns: "ok | fail",
  },
  {
    name: "eval",
    label: "ir.eval",
    documentation: "Evaluate IR document → shape env / root.",
    insertText: "eval(${1:doc})",
    params: [{ name: "doc", type: "doc" }],
    returns: "result | fail",
  },
  {
    name: "eval_pose",
    label: "ir.eval_pose",
    documentation: "Pose-only re-eval (ComposeChain + RigidXform place).",
    insertText: "eval_pose(${1:doc}, ${2:prior_env}, ${3:pose_params})",
    params: [
      { name: "doc", type: "doc" },
      { name: "prior_env", type: "env" },
      { name: "pose_params", type: "table", optional: true },
    ],
    returns: "result | fail",
  },
  {
    name: "run_demo",
    label: "ir.run_demo",
    documentation: "Full Path A demo: eval + emit __OCC_CAD_RESULT__ marker.",
    insertText: "run_demo(${1:doc})",
    params: [{ name: "doc", type: "doc" }],
    returns: "result | fail",
  },
  {
    name: "bind_params",
    label: "ir.bind_params",
    documentation: "Substitute {param: name} refs from doc.params.",
    insertText: "bind_params(${1:doc})",
    params: [{ name: "doc", type: "doc" }],
    returns: "doc",
  },
  {
    name: "expand_macros",
    label: "ir.expand_macros",
    documentation: "Expand IR macros (pass before bind/validate).",
    insertText: "expand_macros(${1:doc})",
    params: [{ name: "doc", type: "doc" }],
    returns: "doc",
  },
  {
    name: "is_fail",
    label: "ir.is_fail",
    documentation: "True if value is an IR fail envelope.",
    insertText: "is_fail(${1:v})",
    params: [{ name: "v", type: "any" }],
    returns: "boolean",
  },
  {
    name: "canonical_json",
    label: "ir.canonical_json",
    documentation: "Canonical JSON string (strict key sort) for hashing / goldens (K18).",
    insertText: "canonical_json(${1:doc})",
    params: [{ name: "doc", type: "doc" }],
    returns: "string",
  },
  {
    name: "hash_body",
    label: "ir.hash_body",
    documentation: "Hash of canonical form (for goldens / integrity).",
    insertText: "hash_body(${1:doc})",
    params: [{ name: "doc", type: "doc" }],
    returns: "string",
  },
  // Advanced: ir.limits / ir.registry / ir.errors are table exports (not methods).
];

/** Module-level symbols */
export const MODULES = [
  {
    name: "solid",
    label: 'require("solid")',
    documentation: "CAD solid helpers (host-backed OCCT ops). Path B geometry surface.",
    insertText: 'require("solid")',
  },
  {
    name: "route",
    label: 'require("route")',
    documentation: "Centerline routes + pipe annulus (AI-BOOST Path B).",
    insertText: 'require("route")',
  },
  {
    name: "frames",
    label: 'require("frames")',
    documentation: "Frames, compose_chain FK, place/trsf_apply (robot Path B).",
    insertText: 'require("frames")',
  },
  {
    name: "query",
    label: 'require("query")',
    documentation: "Measures, clash, mesh stats, mass properties.",
    insertText: 'require("query")',
  },
  {
    name: "cad",
    label: 'require("cad")',
    documentation: "Aggregator: cad.solid / cad.route / cad.frames / cad.query / cad.ir.",
    insertText: 'require("cad")',
  },
  {
    name: "ir",
    label: 'require("ir")',
    documentation:
      "Portable CAD IR runtime (cad.ir/v0). Path A: load/bind/validate/eval IR documents.",
    insertText: 'require("ir")',
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
    documentation: "Host tool broker client (prefer solid.* / route.* for CAD).",
    insertText: 'require("tools")',
  },
];

/** Host cad.call ops (OccBridge) — keep aligned with occ-bridge.js */
export const HOST_CAD_OPS = [
  "kernel_version",
  "make_box",
  "make_cylinder",
  "make_sphere",
  "make_cone",
  "make_torus",
  "fuse",
  "cut",
  "intersect",
  "translate",
  "rotate",
  "scale",
  "mirror",
  "extrude",
  "make_face_rectangle",
  "revolve",
  "pipe",
  "fillet_all",
  "pattern_linear",
  "pattern_polar",
  "clash",
  "distance",
  "volume",
  "bbox",
  "mesh",
  "mesh_stats",
  "mass_properties",
  "shape_free",
  "free_all",
  "make_route",
  "make_route_bends",
  "pipe_annulus",
  "compose_chain",
  "trsf_apply",
  "frame_from_axes",
  "offset_3d",
  "shell",
  "drill_hole_through",
  "drill_hole_blind",
  "member_sweep_rect",
  "step_write",
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
  {
    label: "cad-pipe-run",
    documentation: "Path B: route with bends + pipe annulus.",
    insertText:
      'local solid = require("solid")\nlocal route = require("route")\n\nlocal pipe = route.pipe_run({\n  nodes = {\n    { 0, 0, 0 },\n    { ${1:1.0}, 0, 0 },\n    { 1.0, ${2:0.8}, 0 },\n  },\n  bend_r = ${3:0.15},\n  od = ${4:0.1},\n  inner = ${5:0.08},\n})\nsolid.finish(pipe, { name = "${6:pipe_run}" })\n',
  },
  {
    label: "cad-fk-place",
    documentation: "Path B: compose_chain FK + place_at_chain link solid.",
    insertText:
      'local solid = require("solid")\nlocal frames = require("frames")\n\nlocal link = solid.box({ dx = 0.1, dy = 0.1, dz = 0.3 })\nlocal chain = frames.compose_chain({\n  origins = { { 0, 0, 0.3 } },\n  axes = { { 0, 0, 1 } },\n  angles = { ${1:math.pi / 4} },\n})\nlocal placed = frames.place_at_chain(link, chain)\nsolid.finish(placed, { name = "${2:fk_place}" })\n',
  },
  {
    label: "cad-ir-box-cut",
    documentation: "Path A: evaluate box-cut IR document and emit demo marker.",
    insertText:
      'local ir = require("ir")\n\nlocal doc = ir.load([==[\n${1:-- paste cad.ir/v0 JSON}\n]==])\nif ir.is_fail(doc) then error(doc.error.message) end\nlocal res = ir.run_demo(doc)\nif ir.is_fail(res) or res.ok == false then error((res.error and res.error.message) or "ir eval failed") end\n',
  },
  {
    label: "cad-aggregator",
    documentation: "require(\"cad\") aggregator for solid/route/frames/query/ir.",
    insertText:
      'local cad = require("cad")\nlocal root = cad.solid.box({ dx = ${1:10}, dy = ${2:10}, dz = ${3:10} })\ncad.solid.finish(root, { name = "${4:part}" })\n',
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
