/**
 * Host-side bridge over Emscripten createOccModule / occ_* C API.
 * Shape pointers never leave this module — only integer ids.
 */

import { ShapeMemoTable } from "./memo-cache.js";

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
    /** Per-op fingerprint → shapeId (param scrub reuse). */
    this.memo = new ShapeMemoTable();
    /** @type {{ memo?: boolean }} */
    this.sessionOpts = { memo: false };
  }

  /**
   * Session flags visible to guest via host.call("session_opts").
   * Worker sets { memo: true } on scrub executes.
   * @param {{ memo?: boolean }} opts
   */
  setSessionOpts(opts = {}) {
    this.sessionOpts = { ...this.sessionOpts, ...opts };
  }

  /** Bump memo generation (selective reuse across free_all under memo mode). */
  memoBegin() {
    this.memo.begin();
  }

  /**
   * Free shapes not retained by this generation's memo entries (and optional root).
   * @param {{ root?: number }} [opts]
   */
  memoEnd(opts = {}) {
    const keep = this.memo.keepIds(opts.root);
    for (const id of [...this.shapes.keys()]) {
      if (!keep.has(id)) this.free(id);
    }
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
    this.memo.clear();
    this.sessionOpts = { memo: false };
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
      case "session_opts":
        return {
          memo: this.sessionOpts?.memo === true,
        };
      case "memo_begin":
        this.memoBegin();
        return { generation: this.memo.generation };
      case "memo_end": {
        const root =
          args.root != null || args.shapeId != null || args.id != null
            ? idOf(args.root ?? args.shapeId ?? args.id)
            : undefined;
        this.memoEnd({ root });
        return { kept: this.memo.size };
      }
      case "cache_get": {
        const key = String(args.key ?? "");
        return this.memo.get(key, this.shapes);
      }
      case "cache_put": {
        const key = String(args.key ?? "");
        const shapeId = idOf(args.shapeId ?? args.id ?? args.shape);
        this.memo.put(key, shapeId);
        return {};
      }
      case "cache_clear":
        this.memo.clear();
        return {};
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
      case "free_all":
        // Memo mode (param scrub): keep cached shapes; bump generation so
        // memo_end can drop fingerprints not reused this eval.
        // Hard reset: clear memo table + free every shape (default).
        if (this.sessionOpts?.memo === true) {
          this.memoBegin();
          return { memo: true, generation: this.memo.generation };
        }
        this.freeAll();
        return {};
      case "mesh_stats":
        return this.#meshStats(
          idOf(args.id ?? args.shape),
          num(args.deflection, 0.1),
        );
      case "volume":
        return { volume: this.#volume(idOf(args.id ?? args.shape)) };
      case "bbox":
        return { bbox: this.#bbox(idOf(args.id ?? args.shape)) };
      case "mesh":
        return this.mesh(idOf(args.id ?? args.shape), num(args.deflection, 0.1));
      case "make_route":
        return {
          shapeId: this.#makeRoute(
            flatNodes(args.nodes),
            intOf(args.n_points ?? args.nPoints, 0) || undefined,
            args.closed ? 1 : 0,
          ),
        };
      case "make_route_bends":
        return {
          shapeId: this.#makeRouteBends(
            flatNodes(args.nodes),
            intOf(args.n_points ?? args.nPoints, 0) || undefined,
            num(args.bend_r ?? args.bend_radius ?? args.bendR),
          ),
        };
      case "pipe_annulus":
        return {
          shapeId: this.#pipeAnnulus(
            num(args.od),
            num(args.inner ?? args.id_bore ?? args.inner_diameter),
            idOf(args.spine ?? args.path),
          ),
        };
      case "compose_chain":
        return this.#composeChain(
          intOf(args.n),
          flatVec3n(args.origins, intOf(args.n), "origins"),
          flatVec3n(args.axes, intOf(args.n), "axes"),
          flatNums(args.angles, intOf(args.n), "angles"),
          args.want_prefixes !== false && args.wantPrefixes !== false,
        );
      case "trsf_apply":
        return {
          shapeId: this.#trsfApply(
            idOf(args.id ?? args.shape),
            flatMat4(args.matrix4x4 ?? args.matrix ?? args.m),
          ),
        };
      case "frame_from_axes":
        return this.#frameFromAxes(
          num(args.ox, 0), num(args.oy, 0), num(args.oz, 0),
          num(args.xx, 1), num(args.xy, 0), num(args.xz, 0),
          num(args.zx, 0), num(args.zy, 0), num(args.zz, 1),
        );
      case "make_face_rectangle":
        return {
          shapeId: this.#makeFaceRectangle(
            num(args.cx, 0), num(args.cy, 0), num(args.cz, 0),
            num(args.nx, 0), num(args.ny, 0), num(args.nz, 1),
            num(args.width ?? args.dx),
            num(args.height ?? args.dy),
          ),
        };
      case "revolve":
        return {
          shapeId: this.#revolve(
            idOf(args.profile ?? args.id ?? args.shape),
            num(args.px, 0), num(args.py, 0), num(args.pz, 0),
            num(args.ax, 0), num(args.ay, 0), num(args.az, 1),
            num(args.angle ?? args.angle_rad),
          ),
        };
      case "offset_3d":
        return {
          shapeId: this.#offset3d(
            idOf(args.id ?? args.shape),
            num(args.offset ?? args.distance),
          ),
        };
      case "shell":
        return {
          shapeId: this.#shell(
            idOf(args.id ?? args.shape),
            intList(args.faces ?? args.face_idx ?? args.faceIdx, "faces"),
            num(args.thickness ?? args.t),
          ),
        };
      case "drill_hole_through":
        return {
          shapeId: this.#drillHoleThrough(
            idOf(args.id ?? args.shape ?? args.solid),
            num(args.cx ?? args.ox, 0), num(args.cy ?? args.oy, 0), num(args.cz ?? args.oz, 0),
            num(args.dx, 0), num(args.dy, 0), num(args.dz, 1),
            num(args.diameter ?? args.d),
          ),
        };
      case "drill_hole_blind":
        return {
          shapeId: this.#drillHoleBlind(
            idOf(args.id ?? args.shape ?? args.solid),
            num(args.ox ?? args.cx, 0), num(args.oy ?? args.cy, 0), num(args.oz ?? args.cz, 0),
            num(args.dx, 0), num(args.dy, 0), num(args.dz, 1),
            num(args.diameter ?? args.d),
            num(args.depth),
          ),
        };
      case "member_sweep_rect":
        return {
          shapeId: this.#memberSweepRect(
            num(args.width ?? args.w),
            num(args.height ?? args.h),
            idOf(args.spine ?? args.path),
          ),
        };
      case "mass_properties":
        return this.#massProperties(
          idOf(args.id ?? args.shape),
          num(args.density, 1),
        );
      case "step_write": {
        const path = args.path ?? args.file;
        if (path == null || String(path) === "") {
          throw new Error("step_write: path string required (MEMFS)");
        }
        return this.#stepWrite(idOf(args.id ?? args.shape), String(path));
      }
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
   * Polyline route wire: occ_make_route_polyline.
   * @param {number[]} nodes flat xyz (length 3n)
   * @param {number} [nPoints]
   * @param {number} closed 0|1
   */
  #makeRoute(nodes, nPoints, closed = 0) {
    const n = nPoints && nPoints > 0 ? nPoints : (nodes.length / 3) | 0;
    if (n < 2 || nodes.length < n * 3) {
      throw new Error(`make_route: need n_points>=2 and nodes length >= 3n (got n=${n}, len=${nodes.length})`);
    }
    const xyz = this.#allocDoubles(nodes.slice(0, n * 3));
    const out = this.#outPtr();
    try {
      const rc = this.mod.ccall(
        "occ_make_route_polyline", "number",
        ["number", "number", "number", "number"],
        [xyz, n, closed | 0, out],
      );
      if (rc !== 0) throw new Error(`occ_make_route_polyline failed (${rc}): ${this.lastError()}`);
      return this.#adopt(this.mod.getValue(out, "i32"));
    } finally {
      this.mod._free(xyz);
      this.mod._free(out);
    }
  }

  /**
   * Route with circular bend fillets: occ_make_route_with_bends.
   * @param {number[]} nodes flat xyz
   * @param {number} [nPoints]
   * @param {number} bendR meters
   */
  #makeRouteBends(nodes, nPoints, bendR) {
    const n = nPoints && nPoints > 0 ? nPoints : (nodes.length / 3) | 0;
    if (n < 2 || nodes.length < n * 3) {
      throw new Error(`make_route_bends: need n_points>=2 and nodes length >= 3n (got n=${n}, len=${nodes.length})`);
    }
    const xyz = this.#allocDoubles(nodes.slice(0, n * 3));
    const out = this.#outPtr();
    try {
      const rc = this.mod.ccall(
        "occ_make_route_with_bends", "number",
        ["number", "number", "number", "number"],
        [xyz, n, bendR, out],
      );
      if (rc !== 0) throw new Error(`occ_make_route_with_bends failed (${rc}): ${this.lastError()}`);
      return this.#adopt(this.mod.getValue(out, "i32"));
    } finally {
      this.mod._free(xyz);
      this.mod._free(out);
    }
  }

  /** Hollow pipe annulus solid along spine wire. */
  #pipeAnnulus(od, inner, spineId) {
    const out = this.#outPtr();
    try {
      const rc = this.mod.ccall(
        "occ_pipe_annulus", "number",
        ["number", "number", "number", "number"],
        [od, inner, this.#ptr(spineId), out],
      );
      if (rc !== 0) throw new Error(`occ_pipe_annulus failed (${rc}): ${this.lastError()}`);
      return this.#adopt(this.mod.getValue(out, "i32"));
    } finally {
      this.mod._free(out);
    }
  }

  /**
   * Serial FK: n revolute joints → world frames + final 4×4.
   * All heap pointers allocated inside try so finally always frees.
   * @returns {{ n: number, prefixes: number[][], final: number[] }}
   */
  #composeChain(n, origins, axes, angles, wantPrefixes = true) {
    if (n < 1) throw new Error("compose_chain: n >= 1 required");
    if (origins.length < n * 3 || axes.length < n * 3 || angles.length < n) {
      throw new Error(`compose_chain: array lengths (origins=${origins.length}, axes=${axes.length}, angles=${angles.length}) for n=${n}`);
    }
    let oPtr = 0;
    let aPtr = 0;
    let angPtr = 0;
    let framesPtr = 0;
    let finalPtr = 0;
    let matOut = 0;
    try {
      oPtr = this.#allocDoubles(origins.slice(0, n * 3));
      aPtr = this.#allocDoubles(axes.slice(0, n * 3));
      angPtr = this.#allocDoubles(angles.slice(0, n));
      const frameBytes = n * 12 * 8;
      if (wantPrefixes) {
        framesPtr = this.mod._malloc(frameBytes);
        if (!framesPtr) throw new Error("malloc failed for frames");
        this.mod.HEAPU8.fill(0, framesPtr, framesPtr + frameBytes);
      }
      finalPtr = this.mod._malloc(16 * 8);
      if (!finalPtr) throw new Error("malloc failed for final matrix");
      this.mod.HEAPU8.fill(0, finalPtr, finalPtr + 16 * 8);

      const rc = this.mod.ccall(
        "occ_compose_chain", "number",
        ["number", "number", "number", "number", "number", "number"],
        [n, oPtr, aPtr, angPtr, framesPtr || 0, finalPtr],
      );
      if (rc !== 0) throw new Error(`occ_compose_chain failed (${rc}): ${this.lastError()}`);

      const final = this.#readDoubles(finalPtr, 16);
      /** @type {number[][]} */
      const prefixes = [];
      if (wantPrefixes && framesPtr) {
        matOut = this.mod._malloc(16 * 8);
        if (!matOut) throw new Error("malloc failed for matrix out");
        for (let i = 0; i < n; i++) {
          const fPtr = framesPtr + i * 12 * 8;
          const mrc = this.mod.ccall(
            "occ_frame_to_matrix4x4", "number",
            ["number", "number"],
            [fPtr, matOut],
          );
          if (mrc !== 0) throw new Error(`occ_frame_to_matrix4x4 failed (${mrc}): ${this.lastError()}`);
          prefixes.push(this.#readDoubles(matOut, 16));
        }
      }
      return { n, prefixes, final };
    } finally {
      if (oPtr) this.mod._free(oPtr);
      if (aPtr) this.mod._free(aPtr);
      if (angPtr) this.mod._free(angPtr);
      if (framesPtr) this.mod._free(framesPtr);
      if (finalPtr) this.mod._free(finalPtr);
      if (matOut) this.mod._free(matOut);
    }
  }

  /**
   * Mesh stats only (no position/normal/index arrays) for IR ExportMesh.
   * Avoids JSON-serializing multi-MB typed arrays over the host tool channel.
   */
  #meshStats(id, deflection = 0.1) {
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

      let nvOut = 0;
      let niOut = 0;
      try {
        nvOut = this.mod._malloc(4);
        niOut = this.mod._malloc(4);
        if (!nvOut || !niOut) throw new Error("malloc failed for mesh count outs");
        if (this.mod.ccall("occ_mesh_vertex_count", "number", ["number", "number"], [meshPtr, nvOut]) !== 0) {
          throw new Error(this.lastError());
        }
        if (this.mod.ccall("occ_mesh_index_count", "number", ["number", "number"], [meshPtr, niOut]) !== 0) {
          throw new Error(this.lastError());
        }
        const nv = this.mod.getValue(nvOut, "i32");
        const ni = this.mod.getValue(niOut, "i32");
        let bbox;
        let volume;
        try {
          bbox = this.#bbox(id);
          volume = this.#volume(id);
        } catch {
          /* optional */
        }
        return {
          vertexCount: nv,
          indexCount: ni,
          deflection,
          bbox,
          volume,
          stats_only: true,
        };
      } finally {
        if (nvOut) this.mod._free(nvOut);
        if (niOut) this.mod._free(niOut);
      }
    } finally {
      this.mod._free(meshOut);
      if (meshPtr) this.mod.ccall("occ_mesh_free", null, ["number"], [meshPtr]);
    }
  }

  /** Apply row-major 4×4 to shape → new owned shape. */
  #trsfApply(id, matrix16) {
    if (!matrix16 || matrix16.length < 16) {
      throw new Error("trsf_apply: matrix4x4 length 16 required");
    }
    const mPtr = this.#allocDoubles(matrix16.slice(0, 16));
    const out = this.#outPtr();
    try {
      const rc = this.mod.ccall(
        "occ_trsf_apply_shape", "number",
        ["number", "number", "number"],
        [this.#ptr(id), mPtr, out],
      );
      if (rc !== 0) throw new Error(`occ_trsf_apply_shape failed (${rc}): ${this.lastError()}`);
      return this.#adopt(this.mod.getValue(out, "i32"));
    } finally {
      this.mod._free(mPtr);
      this.mod._free(out);
    }
  }

  /** Optional POD frame orthonormalize via occ_frame_from_axes. */
  #frameFromAxes(ox, oy, oz, xx, xy, xz, zx, zy, zz) {
    // occ_frame_t = 12 doubles
    const fPtr = this.mod._malloc(12 * 8);
    if (!fPtr) throw new Error("malloc failed for frame");
    try {
      const rc = this.mod.ccall(
        "occ_frame_from_axes", "number",
        ["number", "number", "number", "number", "number", "number", "number", "number", "number", "number"],
        [ox, oy, oz, xx, xy, xz, zx, zy, zz, fPtr],
      );
      if (rc !== 0) throw new Error(`occ_frame_from_axes failed (${rc}): ${this.lastError()}`);
      const v = this.#readDoubles(fPtr, 12);
      return {
        frame: {
          ox: v[0], oy: v[1], oz: v[2],
          xx: v[3], xy: v[4], xz: v[5],
          yx: v[6], yy: v[7], yz: v[8],
          zx: v[9], zy: v[10], zz: v[11],
        },
      };
    } finally {
      this.mod._free(fPtr);
    }
  }

  /** Planar rectangle face (for revolve / extrude profiles). */
  #makeFaceRectangle(cx, cy, cz, nx, ny, nz, width, height) {
    const out = this.#outPtr();
    try {
      const rc = this.mod.ccall(
        "occ_make_face_rectangle", "number",
        ["number", "number", "number", "number", "number", "number", "number", "number", "number"],
        [cx, cy, cz, nx, ny, nz, width, height, out],
      );
      if (rc !== 0) throw new Error(`occ_make_face_rectangle failed (${rc}): ${this.lastError()}`);
      return this.#adopt(this.mod.getValue(out, "i32"));
    } finally {
      this.mod._free(out);
    }
  }

  /** Revolve profile about axis by angle_rad (radians). */
  #revolve(profileId, px, py, pz, ax, ay, az, angleRad) {
    const out = this.#outPtr();
    try {
      const rc = this.mod.ccall(
        "occ_revolve", "number",
        ["number", "number", "number", "number", "number", "number", "number", "number", "number"],
        [this.#ptr(profileId), px, py, pz, ax, ay, az, angleRad, out],
      );
      if (rc !== 0) throw new Error(`occ_revolve failed (${rc}): ${this.lastError()}`);
      return this.#adopt(this.mod.getValue(out, "i32"));
    } finally {
      this.mod._free(out);
    }
  }

  /** Uniform 3D offset of a solid (BRepOffsetAPI_MakeOffsetShape). */
  #offset3d(id, offset) {
    const out = this.#outPtr();
    try {
      const rc = this.mod.ccall(
        "occ_offset_3d", "number",
        ["number", "number", "number"],
        [this.#ptr(id), offset, out],
      );
      if (rc !== 0) throw new Error(`occ_offset_3d failed (${rc}): ${this.lastError()}`);
      return this.#adopt(this.mod.getValue(out, "i32"));
    } finally {
      this.mod._free(out);
    }
  }

  /**
   * Shell (MakeThickSolid): open faces listed by 1-based indices.
   * @param {number} id
   * @param {number[]} faceIdx 1-based face indices to open
   * @param {number} thickness
   */
  #shell(id, faceIdx, thickness) {
    if (!faceIdx || faceIdx.length < 1) {
      throw new Error("shell: faces array (1-based indices) required");
    }
    const n = faceIdx.length;
    const idxPtr = this.mod._malloc(n * 4);
    if (!idxPtr) throw new Error("malloc failed for face indices");
    const out = this.#outPtr();
    try {
      for (let i = 0; i < n; i++) {
        this.mod.setValue(idxPtr + i * 4, faceIdx[i] | 0, "i32");
      }
      const rc = this.mod.ccall(
        "occ_shell", "number",
        ["number", "number", "number", "number", "number"],
        [this.#ptr(id), idxPtr, n, thickness, out],
      );
      if (rc !== 0) throw new Error(`occ_shell failed (${rc}): ${this.lastError()}`);
      return this.#adopt(this.mod.getValue(out, "i32"));
    } finally {
      this.mod._free(idxPtr);
      this.mod._free(out);
    }
  }

  #drillHoleThrough(solidId, cx, cy, cz, dx, dy, dz, diameter) {
    const out = this.#outPtr();
    try {
      const rc = this.mod.ccall(
        "occ_drill_hole_through", "number",
        ["number", "number", "number", "number", "number", "number", "number", "number", "number"],
        [this.#ptr(solidId), cx, cy, cz, dx, dy, dz, diameter, out],
      );
      if (rc !== 0) throw new Error(`occ_drill_hole_through failed (${rc}): ${this.lastError()}`);
      return this.#adopt(this.mod.getValue(out, "i32"));
    } finally {
      this.mod._free(out);
    }
  }

  #drillHoleBlind(solidId, ox, oy, oz, dx, dy, dz, diameter, depth) {
    const out = this.#outPtr();
    try {
      const rc = this.mod.ccall(
        "occ_drill_hole_blind", "number",
        ["number", "number", "number", "number", "number", "number", "number", "number", "number", "number"],
        [this.#ptr(solidId), ox, oy, oz, dx, dy, dz, diameter, depth, out],
      );
      if (rc !== 0) throw new Error(`occ_drill_hole_blind failed (${rc}): ${this.lastError()}`);
      return this.#adopt(this.mod.getValue(out, "i32"));
    } finally {
      this.mod._free(out);
    }
  }

  /** Rectangular structural member along spine wire. */
  #memberSweepRect(width, height, spineId) {
    const out = this.#outPtr();
    try {
      const rc = this.mod.ccall(
        "occ_member_sweep_rect", "number",
        ["number", "number", "number", "number"],
        [width, height, this.#ptr(spineId), out],
      );
      if (rc !== 0) throw new Error(`occ_member_sweep_rect failed (${rc}): ${this.lastError()}`);
      return this.#adopt(this.mod.getValue(out, "i32"));
    } finally {
      this.mod._free(out);
    }
  }

  /**
   * Density-scaled mass properties (kg if density kg/m³ and geometry SI).
   * @returns {{ mass: number, com: number[], inertia: number[], density: number }}
   */
  #massProperties(id, density) {
    const massP = this.mod._malloc(8);
    const comP = this.mod._malloc(3 * 8);
    const inertiaP = this.mod._malloc(9 * 8);
    if (!massP || !comP || !inertiaP) {
      if (massP) this.mod._free(massP);
      if (comP) this.mod._free(comP);
      if (inertiaP) this.mod._free(inertiaP);
      throw new Error("malloc failed for mass_properties");
    }
    try {
      const rc = this.mod.ccall(
        "occ_mass_properties", "number",
        ["number", "number", "number", "number", "number"],
        [this.#ptr(id), density, massP, comP, inertiaP],
      );
      if (rc !== 0) throw new Error(`occ_mass_properties failed (${rc}): ${this.lastError()}`);
      return {
        mass: this.mod.getValue(massP, "double"),
        com: this.#readDoubles(comP, 3),
        inertia: this.#readDoubles(inertiaP, 9),
        density,
      };
    } finally {
      this.mod._free(massP);
      this.mod._free(comP);
      this.mod._free(inertiaP);
    }
  }

  /**
   * Write STEP to Emscripten MEMFS path (browser/Node wasm FS).
   * @returns {{ path: string, ok: true }}
   */
  #stepWrite(id, path) {
    if (!path || typeof path !== "string") throw new Error("step_write: path string required");
    const rc = this.mod.ccall(
      "occ_step_write", "number",
      ["number", "string"],
      [this.#ptr(id), path],
    );
    if (rc !== 0) throw new Error(`occ_step_write failed (${rc}): ${this.lastError()}`);
    return { path, ok: true };
  }

  /** @param {number[]} arr */
  #allocDoubles(arr) {
    const bytes = arr.length * 8;
    const ptr = this.mod._malloc(bytes);
    if (!ptr) throw new Error("malloc failed for doubles");
    for (let i = 0; i < arr.length; i++) {
      this.mod.setValue(ptr + i * 8, Number(arr[i]), "double");
    }
    return ptr;
  }

  /**
   * @param {number} ptr
   * @param {number} n
   * @returns {number[]}
   */
  #readDoubles(ptr, n) {
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      out[i] = this.mod.getValue(ptr + i * 8, "double");
    }
    return out;
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

/**
 * Accept flat number[] or nested [[x,y,z],…] / mixed Luau tables.
 * @param {unknown} nodes
 * @returns {number[]}
 */
function flatNodes(nodes) {
  if (nodes == null) throw new Error("missing nodes");
  if (!Array.isArray(nodes)) throw new Error("nodes must be an array");
  if (nodes.length === 0) return [];
  // Nested: first element is array/object with x or [1]
  const first = nodes[0];
  if (typeof first === "number") {
    return nodes.map((x) => num(x));
  }
  /** @type {number[]} */
  const out = [];
  for (const p of nodes) {
    if (Array.isArray(p)) {
      out.push(num(p[0]), num(p[1]), num(p[2]));
    } else if (p && typeof p === "object") {
      const o = /** @type {Record<string, unknown>} */ (p);
      // Prefer named x/y/z; else 0-based indices before 1-based.
      out.push(
        num(o.x ?? o[0] ?? o[1]),
        num(o.y ?? o[1] ?? o[2]),
        num(o.z ?? o[2] ?? o[3]),
      );
    } else {
      throw new Error("nodes entry must be [x,y,z] or flat numbers");
    }
  }
  return out;
}

/**
 * @param {unknown} v
 * @param {number} n
 * @param {string} label
 * @returns {number[]}
 */
function flatVec3n(v, n, label) {
  if (v == null) throw new Error(`missing ${label}`);
  if (!Array.isArray(v)) throw new Error(`${label} must be an array`);
  if (v.length === 0) throw new Error(`${label} empty`);
  if (typeof v[0] === "number") {
    if (v.length < n * 3) throw new Error(`${label}: need ${n * 3} flat numbers`);
    return v.slice(0, n * 3).map((x) => num(x));
  }
  if (v.length < n) throw new Error(`${label}: need ${n} Vec3`);
  /** @type {number[]} */
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = v[i];
    if (Array.isArray(p)) {
      out.push(num(p[0]), num(p[1]), num(p[2]));
    } else {
      throw new Error(`${label}[${i}] must be [x,y,z]`);
    }
  }
  return out;
}

/**
 * @param {unknown} v
 * @param {number} n
 * @param {string} label
 * @returns {number[]}
 */
function flatNums(v, n, label) {
  if (v == null) throw new Error(`missing ${label}`);
  if (!Array.isArray(v)) throw new Error(`${label} must be an array`);
  if (v.length < n) throw new Error(`${label}: need ${n} numbers`);
  return v.slice(0, n).map((x) => num(x));
}

/**
 * @param {unknown} m
 * @returns {number[]}
 */
function flatMat4(m) {
  if (m == null) throw new Error("missing matrix4x4");
  if (!Array.isArray(m)) throw new Error("matrix4x4 must be an array");
  if (m.length < 16) throw new Error("matrix4x4 length 16 required");
  return m.slice(0, 16).map((x) => num(x));
}

/**
 * Coerce Luau/JSON number array to int list (e.g. 1-based face indices).
 * @param {unknown} v
 * @param {string} label
 * @returns {number[]}
 */
function intList(v, label) {
  if (v == null) throw new Error(`missing ${label}`);
  if (!Array.isArray(v)) throw new Error(`${label} must be an array`);
  if (v.length < 1) throw new Error(`${label} must be non-empty`);
  return v.map((x, i) => {
    const n = Number(x);
    if (!Number.isInteger(n)) throw new Error(`${label}[${i}] not an integer: ${x}`);
    return n;
  });
}

/** occ_clash_status_t names (OCC_CLASH_*). IR normalizes to lowercase. */
const CLASH_NAMES = Object.freeze({
  0: "separated",
  1: "clearance",
  2: "interfere",
});
