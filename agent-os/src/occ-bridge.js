/**
 * Host-side bridge over Emscripten createOccModule / occ_* C API.
 * Shape pointers never leave this module — only integer ids.
 */

/** @typedef {import('./types.js').OccModule} OccModule */

export class OccBridge {
  /**
   * @param {object} mod Emscripten module instance
   */
  constructor(mod) {
    this.mod = mod;
    /** @type {Map<number, number>} id → shape pointer */
    this.shapes = new Map();
    this.nextId = 1;
  }

  /**
   * @param {string} baseUrl directory containing libocc_c.js + libocc_c.wasm
   * @returns {Promise<OccBridge>}
   */
  static async create(baseUrl) {
    const root = baseUrl.endsWith("/") ? baseUrl : baseUrl + "/";
    const modUrl = new URL("libocc_c.js", root).href;
    const createOccModule = await loadCreateOccModule(modUrl);
    const mod = await createOccModule({
      // Glue may request libocc_c_wasm_bin.wasm; we ship libocc_c.wasm.
      locateFile: (path) => {
        const name = String(path).endsWith(".wasm") ? "libocc_c.wasm" : path;
        const url = new URL(name, root).href;
        // Node fs APIs want paths; browsers want URLs.
        if (typeof process !== "undefined" && process.versions?.node && url.startsWith("file:")) {
          return new URL(url).pathname;
        }
        return url;
      },
    });
    return new OccBridge(mod);
  }

  version() {
    return this.mod.ccall("occ_version", "string", [], []) || "unknown";
  }

  lastError() {
    return this.mod.ccall("occ_last_error", "string", [], []) || "";
  }

  /**
   * @param {number} ptr
   * @returns {number} shape id
   */
  #adopt(ptr) {
    if (!ptr) throw new Error(`null shape from OCCT: ${this.lastError()}`);
    const id = this.nextId++;
    this.shapes.set(id, ptr);
    return id;
  }

  /**
   * @param {number} id
   * @returns {number} shape ptr
   */
  #ptr(id) {
    const p = this.shapes.get(id);
    if (p === undefined) throw new Error(`unknown shape id ${id}`);
    return p;
  }

  free(id) {
    const p = this.shapes.get(id);
    if (p === undefined) return;
    this.mod.ccall("occ_shape_free", null, ["number"], [p]);
    this.shapes.delete(id);
  }

  freeAll() {
    for (const id of [...this.shapes.keys()]) this.free(id);
  }

  /**
   * @param {string} op
   * @param {Record<string, unknown>} args
   */
  call(op, args = {}) {
    switch (op) {
      case "kernel_version":
        return { version: this.version() };
      case "make_box":
        return { shapeId: this.#makeBox(num(args.dx), num(args.dy), num(args.dz)) };
      case "make_cylinder":
        return {
          shapeId: this.#makeCylinder(
            num(args.cx, 0), num(args.cy, 0), num(args.cz, 0),
            num(args.ax, 0), num(args.ay, 0), num(args.az, 1),
            num(args.radius), num(args.height),
          ),
        };
      case "make_sphere":
        return {
          shapeId: this.#makeSphere(
            num(args.cx, 0), num(args.cy, 0), num(args.cz, 0), num(args.radius),
          ),
        };
      case "make_cone":
        return {
          shapeId: this.#makeCone(
            num(args.cx, 0), num(args.cy, 0), num(args.cz, 0),
            num(args.ax, 0), num(args.ay, 0), num(args.az, 1),
            num(args.r1 ?? args.radius1),
            num(args.r2 ?? args.radius2, 0),
            num(args.height),
          ),
        };
      case "make_torus":
        return {
          shapeId: this.#makeTorus(
            num(args.cx, 0), num(args.cy, 0), num(args.cz, 0),
            num(args.ax, 0), num(args.ay, 0), num(args.az, 1),
            num(args.major_r ?? args.majorR ?? args.R),
            num(args.minor_r ?? args.minorR ?? args.r),
          ),
        };
      case "fuse":
        return { shapeId: this.#boolean("occ_fuse", idOf(args.a), idOf(args.b)) };
      case "cut":
        return { shapeId: this.#boolean("occ_cut", idOf(args.a), idOf(args.b)) };
      case "intersect":
        return { shapeId: this.#boolean("occ_intersect", idOf(args.a), idOf(args.b)) };
      case "translate":
        return {
          shapeId: this.#transform(
            "occ_translate",
            idOf(args.id ?? args.shape),
            num(args.dx), num(args.dy), num(args.dz),
          ),
        };
      case "rotate":
        return {
          shapeId: this.#rotate(
            idOf(args.id ?? args.shape),
            num(args.px, 0), num(args.py, 0), num(args.pz, 0),
            num(args.ax, 0), num(args.ay, 0), num(args.az, 1),
            num(args.angle ?? args.angle_rad),
          ),
        };
      case "scale":
        return {
          shapeId: this.#scale(
            idOf(args.id ?? args.shape),
            num(args.cx, 0), num(args.cy, 0), num(args.cz, 0),
            num(args.factor ?? args.f),
          ),
        };
      case "mirror":
        return {
          shapeId: this.#mirror(
            idOf(args.id ?? args.shape),
            num(args.px, 0), num(args.py, 0), num(args.pz, 0),
            num(args.nx, 0), num(args.ny, 0), num(args.nz, 1),
          ),
        };
      case "extrude":
        return {
          shapeId: this.#extrude(
            idOf(args.profile ?? args.id ?? args.shape),
            num(args.dx), num(args.dy), num(args.dz),
          ),
        };
      case "pipe":
        return {
          shapeId: this.#pipe(
            idOf(args.profile),
            idOf(args.spine),
          ),
        };
      case "fillet_all":
        return { shapeId: this.#filletAll(idOf(args.id ?? args.shape), num(args.radius)) };
      case "pattern_linear":
        return {
          shapeId: this.#patternLinear(
            idOf(args.id ?? args.seed ?? args.shape),
            num(args.dx), num(args.dy), num(args.dz),
            intOf(args.count),
          ),
        };
      case "pattern_polar":
        return {
          shapeId: this.#patternPolar(
            idOf(args.id ?? args.seed ?? args.shape),
            num(args.px, 0), num(args.py, 0), num(args.pz, 0),
            num(args.ax, 0), num(args.ay, 0), num(args.az, 1),
            num(args.angle_step ?? args.angle_step_rad ?? args.angleStep),
            intOf(args.count),
          ),
        };
      case "clash":
        return this.#clash(
          idOf(args.a),
          idOf(args.b),
          num(args.clearance, 0),
        );
      case "distance":
        return this.#distance(idOf(args.a), idOf(args.b));
      case "shape_free":
        this.free(idOf(args.id ?? args.shape));
        return {};
      case "volume":
        return { volume: this.#volume(idOf(args.id ?? args.shape)) };
      case "bbox":
        return { bbox: this.#bbox(idOf(args.id ?? args.shape)) };
      case "mesh":
        return this.mesh(idOf(args.id ?? args.shape), num(args.deflection, 0.1));
      default:
        throw new Error(`unknown cad op: ${op}`);
    }
  }

  #outPtr() {
    const p = this.mod._malloc(4);
    if (!p) throw new Error("malloc failed for out pointer");
    this.mod.setValue(p, 0, "i32");
    return p;
  }

  #makeBox(dx, dy, dz) {
    const out = this.#outPtr();
    try {
      const rc = this.mod.ccall(
        "occ_make_box", "number",
        ["number", "number", "number", "number"],
        [dx, dy, dz, out],
      );
      if (rc !== 0) throw new Error(`occ_make_box failed (${rc}): ${this.lastError()}`);
      return this.#adopt(this.mod.getValue(out, "i32"));
    } finally {
      this.mod._free(out);
    }
  }

  #makeCylinder(cx, cy, cz, ax, ay, az, radius, height) {
    const out = this.#outPtr();
    try {
      const rc = this.mod.ccall(
        "occ_make_cylinder", "number",
        ["number", "number", "number", "number", "number", "number", "number", "number", "number"],
        [cx, cy, cz, ax, ay, az, radius, height, out],
      );
      if (rc !== 0) throw new Error(`occ_make_cylinder failed (${rc}): ${this.lastError()}`);
      return this.#adopt(this.mod.getValue(out, "i32"));
    } finally {
      this.mod._free(out);
    }
  }

  #makeSphere(cx, cy, cz, radius) {
    const out = this.#outPtr();
    try {
      const rc = this.mod.ccall(
        "occ_make_sphere", "number",
        ["number", "number", "number", "number", "number"],
        [cx, cy, cz, radius, out],
      );
      if (rc !== 0) throw new Error(`occ_make_sphere failed (${rc}): ${this.lastError()}`);
      return this.#adopt(this.mod.getValue(out, "i32"));
    } finally {
      this.mod._free(out);
    }
  }

  #makeCone(cx, cy, cz, ax, ay, az, r1, r2, height) {
    const out = this.#outPtr();
    try {
      const rc = this.mod.ccall(
        "occ_make_cone", "number",
        ["number", "number", "number", "number", "number", "number", "number", "number", "number", "number"],
        [cx, cy, cz, ax, ay, az, r1, r2, height, out],
      );
      if (rc !== 0) throw new Error(`occ_make_cone failed (${rc}): ${this.lastError()}`);
      return this.#adopt(this.mod.getValue(out, "i32"));
    } finally {
      this.mod._free(out);
    }
  }

  #makeTorus(cx, cy, cz, ax, ay, az, majorR, minorR) {
    const out = this.#outPtr();
    try {
      const rc = this.mod.ccall(
        "occ_make_torus", "number",
        ["number", "number", "number", "number", "number", "number", "number", "number", "number"],
        [cx, cy, cz, ax, ay, az, majorR, minorR, out],
      );
      if (rc !== 0) throw new Error(`occ_make_torus failed (${rc}): ${this.lastError()}`);
      return this.#adopt(this.mod.getValue(out, "i32"));
    } finally {
      this.mod._free(out);
    }
  }

  #boolean(fn, a, b) {
    const out = this.#outPtr();
    try {
      const rc = this.mod.ccall(fn, "number", ["number", "number", "number"], [this.#ptr(a), this.#ptr(b), out]);
      if (rc !== 0) throw new Error(`${fn} failed (${rc}): ${this.lastError()}`);
      return this.#adopt(this.mod.getValue(out, "i32"));
    } finally {
      this.mod._free(out);
    }
  }

  #transform(fn, id, dx, dy, dz) {
    const out = this.#outPtr();
    try {
      const rc = this.mod.ccall(
        fn, "number",
        ["number", "number", "number", "number", "number"],
        [this.#ptr(id), dx, dy, dz, out],
      );
      if (rc !== 0) throw new Error(`${fn} failed (${rc}): ${this.lastError()}`);
      return this.#adopt(this.mod.getValue(out, "i32"));
    } finally {
      this.mod._free(out);
    }
  }

  #rotate(id, px, py, pz, ax, ay, az, angleRad) {
    const out = this.#outPtr();
    try {
      const rc = this.mod.ccall(
        "occ_rotate", "number",
        ["number", "number", "number", "number", "number", "number", "number", "number", "number"],
        [this.#ptr(id), px, py, pz, ax, ay, az, angleRad, out],
      );
      if (rc !== 0) throw new Error(`occ_rotate failed (${rc}): ${this.lastError()}`);
      return this.#adopt(this.mod.getValue(out, "i32"));
    } finally {
      this.mod._free(out);
    }
  }

  #scale(id, cx, cy, cz, factor) {
    const out = this.#outPtr();
    try {
      const rc = this.mod.ccall(
        "occ_scale", "number",
        ["number", "number", "number", "number", "number", "number"],
        [this.#ptr(id), cx, cy, cz, factor, out],
      );
      if (rc !== 0) throw new Error(`occ_scale failed (${rc}): ${this.lastError()}`);
      return this.#adopt(this.mod.getValue(out, "i32"));
    } finally {
      this.mod._free(out);
    }
  }

  #mirror(id, px, py, pz, nx, ny, nz) {
    const out = this.#outPtr();
    try {
      const rc = this.mod.ccall(
        "occ_mirror", "number",
        ["number", "number", "number", "number", "number", "number", "number", "number"],
        [this.#ptr(id), px, py, pz, nx, ny, nz, out],
      );
      if (rc !== 0) throw new Error(`occ_mirror failed (${rc}): ${this.lastError()}`);
      return this.#adopt(this.mod.getValue(out, "i32"));
    } finally {
      this.mod._free(out);
    }
  }

  #extrude(profileId, dx, dy, dz) {
    const out = this.#outPtr();
    try {
      const rc = this.mod.ccall(
        "occ_extrude", "number",
        ["number", "number", "number", "number", "number"],
        [this.#ptr(profileId), dx, dy, dz, out],
      );
      if (rc !== 0) throw new Error(`occ_extrude failed (${rc}): ${this.lastError()}`);
      return this.#adopt(this.mod.getValue(out, "i32"));
    } finally {
      this.mod._free(out);
    }
  }

  #pipe(profileId, spineId) {
    const out = this.#outPtr();
    try {
      const rc = this.mod.ccall(
        "occ_pipe", "number",
        ["number", "number", "number"],
        [this.#ptr(profileId), this.#ptr(spineId), out],
      );
      if (rc !== 0) throw new Error(`occ_pipe failed (${rc}): ${this.lastError()}`);
      return this.#adopt(this.mod.getValue(out, "i32"));
    } finally {
      this.mod._free(out);
    }
  }

  #filletAll(id, radius) {
    const out = this.#outPtr();
    try {
      const rc = this.mod.ccall(
        "occ_fillet_all", "number",
        ["number", "number", "number"],
        [this.#ptr(id), radius, out],
      );
      if (rc !== 0) throw new Error(`occ_fillet_all failed (${rc}): ${this.lastError()}`);
      return this.#adopt(this.mod.getValue(out, "i32"));
    } finally {
      this.mod._free(out);
    }
  }

  #patternLinear(seedId, dx, dy, dz, count) {
    const out = this.#outPtr();
    try {
      const rc = this.mod.ccall(
        "occ_pattern_linear", "number",
        ["number", "number", "number", "number", "number", "number"],
        [this.#ptr(seedId), dx, dy, dz, count, out],
      );
      if (rc !== 0) throw new Error(`occ_pattern_linear failed (${rc}): ${this.lastError()}`);
      return this.#adopt(this.mod.getValue(out, "i32"));
    } finally {
      this.mod._free(out);
    }
  }

  #patternPolar(seedId, px, py, pz, ax, ay, az, angleStepRad, count) {
    const out = this.#outPtr();
    try {
      const rc = this.mod.ccall(
        "occ_pattern_polar", "number",
        ["number", "number", "number", "number", "number", "number", "number", "number", "number", "number"],
        [this.#ptr(seedId), px, py, pz, ax, ay, az, angleStepRad, count, out],
      );
      if (rc !== 0) throw new Error(`occ_pattern_polar failed (${rc}): ${this.lastError()}`);
      return this.#adopt(this.mod.getValue(out, "i32"));
    } finally {
      this.mod._free(out);
    }
  }

  /**
   * Pairwise clash with clearance band.
   * status: 0 SEPARATED, 1 CLEARANCE, 2 INTERFERE
   */
  #clash(a, b, clearance) {
    const stOut = this.#outPtr();
    try {
      const rc = this.mod.ccall(
        "occ_clash", "number",
        ["number", "number", "number", "number"],
        [this.#ptr(a), this.#ptr(b), clearance, stOut],
      );
      if (rc !== 0) throw new Error(`occ_clash failed (${rc}): ${this.lastError()}`);
      const status = this.mod.getValue(stOut, "i32");
      return { status, name: CLASH_NAMES[status] ?? `unknown_${status}` };
    } finally {
      this.mod._free(stOut);
    }
  }

  /** Minimum distance between two shapes (meters). */
  #distance(a, b) {
    const distOut = this.mod._malloc(8);
    const pA = this.mod._malloc(24);
    const pB = this.mod._malloc(24);
    try {
      const rc = this.mod.ccall(
        "occ_distance", "number",
        ["number", "number", "number", "number", "number"],
        [this.#ptr(a), this.#ptr(b), distOut, pA, pB],
      );
      if (rc !== 0) throw new Error(`occ_distance failed (${rc}): ${this.lastError()}`);
      return {
        distance: this.mod.getValue(distOut, "double"),
        pointOnA: [
          this.mod.getValue(pA, "double"),
          this.mod.getValue(pA + 8, "double"),
          this.mod.getValue(pA + 16, "double"),
        ],
        pointOnB: [
          this.mod.getValue(pB, "double"),
          this.mod.getValue(pB + 8, "double"),
          this.mod.getValue(pB + 16, "double"),
        ],
      };
    } finally {
      this.mod._free(distOut);
      this.mod._free(pA);
      this.mod._free(pB);
    }
  }

  #volume(id) {
    const out = this.mod._malloc(8);
    try {
      const rc = this.mod.ccall("occ_volume", "number", ["number", "number"], [this.#ptr(id), out]);
      if (rc !== 0) throw new Error(`occ_volume failed (${rc}): ${this.lastError()}`);
      return this.mod.getValue(out, "double");
    } finally {
      this.mod._free(out);
    }
  }

  #bbox(id) {
    const minP = this.mod._malloc(24);
    const maxP = this.mod._malloc(24);
    try {
      const rc = this.mod.ccall(
        "occ_bbox", "number",
        ["number", "number", "number"],
        [this.#ptr(id), minP, maxP],
      );
      if (rc !== 0) throw new Error(`occ_bbox failed (${rc}): ${this.lastError()}`);
      const min = [
        this.mod.getValue(minP, "double"),
        this.mod.getValue(minP + 8, "double"),
        this.mod.getValue(minP + 16, "double"),
      ];
      const max = [
        this.mod.getValue(maxP, "double"),
        this.mod.getValue(maxP + 8, "double"),
        this.mod.getValue(maxP + 16, "double"),
      ];
      return { min, max };
    } finally {
      this.mod._free(minP);
      this.mod._free(maxP);
    }
  }

  /**
   * @param {number} id
   * @param {number} deflection
   */
  mesh(id, deflection = 0.1) {
    const meshOut = this.#outPtr();
    let meshPtr = 0;
    try {
      const rc = this.mod.ccall(
        "occ_mesh_compute", "number",
        ["number", "number", "number"],
        [this.#ptr(id), deflection, meshOut],
      );
      if (rc !== 0) throw new Error(`occ_mesh_compute failed (${rc}): ${this.lastError()}`);
      meshPtr = this.mod.getValue(meshOut, "i32");
      if (!meshPtr) throw new Error("null mesh");

      const nvOut = this.mod._malloc(4);
      const niOut = this.mod._malloc(4);
      try {
        if (this.mod.ccall("occ_mesh_vertex_count", "number", ["number", "number"], [meshPtr, nvOut]) !== 0) {
          throw new Error(this.lastError());
        }
        if (this.mod.ccall("occ_mesh_index_count", "number", ["number", "number"], [meshPtr, niOut]) !== 0) {
          throw new Error(this.lastError());
        }
        const nv = this.mod.getValue(nvOut, "i32");
        const ni = this.mod.getValue(niOut, "i32");

        const vpp = this.#outPtr();
        const npp = this.#outPtr();
        const ipp = this.#outPtr();
        try {
          if (this.mod.ccall("occ_mesh_vertices", "number", ["number", "number"], [meshPtr, vpp]) !== 0) {
            throw new Error(this.lastError());
          }
          if (this.mod.ccall("occ_mesh_normals", "number", ["number", "number"], [meshPtr, npp]) !== 0) {
            throw new Error(this.lastError());
          }
          if (this.mod.ccall("occ_mesh_indices", "number", ["number", "number"], [meshPtr, ipp]) !== 0) {
            throw new Error(this.lastError());
          }
          const vPtr = this.mod.getValue(vpp, "i32");
          const nPtr = this.mod.getValue(npp, "i32");
          const iPtr = this.mod.getValue(ipp, "i32");

          const positions = new Float32Array(nv * 3);
          const normals = new Float32Array(nv * 3);
          const indices = new Uint32Array(ni);
          positions.set(this.mod.HEAPF32.subarray(vPtr / 4, vPtr / 4 + nv * 3));
          normals.set(this.mod.HEAPF32.subarray(nPtr / 4, nPtr / 4 + nv * 3));
          // indices are int32 in C API
          const srcIdx = this.mod.HEAP32.subarray(iPtr / 4, iPtr / 4 + ni);
          for (let i = 0; i < ni; i++) indices[i] = srcIdx[i] >>> 0;

          let bbox;
          let volume;
          try {
            bbox = this.#bbox(id);
            volume = this.#volume(id);
          } catch {
            /* measure optional */
          }

          return { positions, normals, indices, bbox, volume, vertexCount: nv, indexCount: ni };
        } finally {
          this.mod._free(vpp);
          this.mod._free(npp);
          this.mod._free(ipp);
        }
      } finally {
        this.mod._free(nvOut);
        this.mod._free(niOut);
      }
    } finally {
      this.mod._free(meshOut);
      if (meshPtr) this.mod.ccall("occ_mesh_free", null, ["number"], [meshPtr]);
    }
  }
}

/**
 * Load Emscripten MODULARIZE factory whether or not EXPORT_ES6 is enabled.
 * @param {string} modUrl
 */
async function loadCreateOccModule(modUrl) {
  try {
    const mod = await import(/* @vite-ignore */ modUrl);
    const fn = mod.default || mod.createOccModule;
    if (typeof fn === "function") return fn;
  } catch {
    /* classic / CJS glue — wrap as ESM */
  }
  if (typeof fetch === "function") {
    const text = await fetch(modUrl).then((r) => {
      if (!r.ok) throw new Error(`load ${modUrl}: HTTP ${r.status}`);
      return r.text();
    });
    const blob = new Blob(
      [`${text}\nexport default (typeof createOccModule!=="undefined"?createOccModule:module.exports);\n`],
      { type: "text/javascript" },
    );
    const url = URL.createObjectURL(blob);
    try {
      const mod = await import(/* @vite-ignore */ url);
      return mod.default;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  // Node: dynamic import of CJS
  const mod = await import(/* @vite-ignore */ modUrl);
  return mod.default || mod;
}

function num(v, fallback) {
  if (v === undefined || v === null) {
    if (fallback !== undefined) return fallback;
    throw new Error("missing numeric argument");
  }
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`not a finite number: ${v}`);
  return n;
}

function intOf(v, fallback) {
  if (v === undefined || v === null) {
    if (fallback !== undefined) return fallback;
    throw new Error("missing integer argument");
  }
  const n = Number(v);
  if (!Number.isInteger(n)) throw new Error(`not an integer: ${v}`);
  return n;
}

function idOf(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new Error(`invalid shape id: ${v}`);
  return n;
}

/** occ_clash_status_t names (OCC_CLASH_*). */
const CLASH_NAMES = Object.freeze({
  0: "separated",
  1: "clearance",
  2: "interfere",
});
