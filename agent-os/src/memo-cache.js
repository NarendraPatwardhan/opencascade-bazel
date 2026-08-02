/**
 * Execute-level mesh result cache + per-op shape memo table.
 *
 * Used by runtime-worker (full mesh short-circuit) and OccBridge (op fingerprints).
 * Pure JS — no OCCT / AgentOS dependency so smokes can unit-test keys and get/put.
 */

/**
 * Deterministic JSON-like encode (sorted object keys) for cache keys.
 * @param {unknown} value
 * @returns {string}
 */
export function stableSerialize(value) {
  if (value === null || value === undefined) return "null";
  const t = typeof value;
  if (t === "boolean") return value ? "true" : "false";
  if (t === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("stableSerialize: non-finite number");
    }
    // Match Luau canonical preference: exact integers without trailing .0
    if (Number.isInteger(value) && Math.abs(value) < 1e15) {
      return String(value);
    }
    return String(value);
  }
  if (t === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableSerialize(v)).join(",")}]`;
  }
  if (t === "object") {
    const keys = Object.keys(/** @type {Record<string, unknown>} */ (value)).sort();
    const parts = keys.map(
      (k) =>
        `${JSON.stringify(k)}:${stableSerialize(
          /** @type {Record<string, unknown>} */ (value)[k],
        )}`,
    );
    return `{${parts.join(",")}}`;
  }
  throw new Error(`stableSerialize: unsupported type ${t}`);
}

/**
 * FNV-1a 32-bit hex (same family as ir.canonical.hash_body).
 * @param {string} str
 * @returns {string} 8 hex chars
 */
export function fnv1a32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * Full-result mesh cache key: injected source + param values + deflection.
 * @param {string} source
 * @param {Record<string, unknown> | null | undefined} params
 * @param {number} deflection
 * @returns {string}
 */
export function executeCacheKey(source, params, deflection) {
  const payload = {
    source: String(source ?? ""),
    params: params && typeof params === "object" ? params : {},
    deflection: Number(deflection ?? 0.15),
  };
  return `exec:${fnv1a32(stableSerialize(payload))}`;
}

/**
 * Deep-copy mesh typed arrays so postMessage(…, transfer) cannot detach the cache.
 * @param {object} mesh
 * @returns {object}
 */
export function cloneMeshPod(mesh) {
  if (!mesh || typeof mesh !== "object") return mesh;
  return {
    positions: mesh.positions
      ? new Float32Array(mesh.positions)
      : mesh.positions,
    normals: mesh.normals ? new Float32Array(mesh.normals) : mesh.normals,
    indices: mesh.indices ? new Uint32Array(mesh.indices) : mesh.indices,
    bbox: mesh.bbox
      ? {
          min: mesh.bbox.min ? [...mesh.bbox.min] : mesh.bbox.min,
          max: mesh.bbox.max ? [...mesh.bbox.max] : mesh.bbox.max,
        }
      : mesh.bbox,
    volume: mesh.volume,
    vertexCount: mesh.vertexCount,
    indexCount: mesh.indexCount,
  };
}

/**
 * Single-slot full execute mesh cache (last successful scrub/run).
 */
export class MeshResultCache {
  constructor() {
    /** @type {string | null} */
    this.key = null;
    /** @type {object | null} mesh + meta (+ optional stdout/stderr); no request id */
    this.payload = null;
  }

  /**
   * @param {string} key
   * @returns {object | null} clone safe to transfer to main thread
   */
  get(key) {
    if (this.key !== null && this.key === key && this.payload) {
      const p = this.payload;
      return {
        ...p,
        mesh: cloneMeshPod(p.mesh),
        meta: p.meta ? { ...p.meta } : p.meta,
      };
    }
    return null;
  }

  /**
   * @param {string} key
   * @param {object} payload
   */
  set(key, payload) {
    this.key = key;
    // Own copies: caller may transfer the original mesh buffers.
    this.payload = {
      ...payload,
      mesh: cloneMeshPod(payload.mesh),
      meta: payload.meta ? { ...payload.meta } : payload.meta,
    };
  }

  clear() {
    this.key = null;
    this.payload = null;
  }
}

/**
 * Per-op fingerprint → host shape id, with generation for selective free.
 */
export class ShapeMemoTable {
  constructor() {
    /** @type {Map<string, { shapeId: number, generation: number }>} */
    this.map = new Map();
    /** @type {number} */
    this.generation = 0;
  }

  /** Start a memo session (e.g. free_all under memo mode). */
  begin() {
    this.generation += 1;
  }

  /**
   * @param {string} key
   * @param {Map<number, unknown>} shapes live OccBridge.shapes
   * @returns {{ hit: false } | { hit: true, shapeId: number }}
   */
  get(key, shapes) {
    if (!key) return { hit: false };
    const e = this.map.get(key);
    if (!e) return { hit: false };
    if (!shapes || !shapes.has(e.shapeId)) {
      this.map.delete(key);
      return { hit: false };
    }
    e.generation = this.generation;
    return { hit: true, shapeId: e.shapeId };
  }

  /**
   * @param {string} key
   * @param {number} shapeId
   */
  put(key, shapeId) {
    if (typeof key !== "string" || !key) return;
    if (typeof shapeId !== "number" || !Number.isFinite(shapeId)) return;
    this.map.set(key, { shapeId, generation: this.generation });
  }

  /**
   * Drop stale fingerprint entries; return shape ids still needed this generation.
   * @param {number | null | undefined} root
   * @returns {Set<number>}
   */
  keepIds(root) {
    const keep = new Set();
    if (typeof root === "number" && Number.isFinite(root)) {
      keep.add(root);
    }
    for (const [k, e] of this.map) {
      if (e.generation === this.generation) {
        keep.add(e.shapeId);
      } else {
        this.map.delete(k);
      }
    }
    return keep;
  }

  clear() {
    this.map.clear();
  }

  get size() {
    return this.map.size;
  }
}
