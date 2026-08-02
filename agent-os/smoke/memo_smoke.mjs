#!/usr/bin/env node
/**
 * Unit smoke: execute mesh cache key + ShapeMemoTable get/put/keepIds.
 * Pure JS — no AgentOS / OCCT required.
 *
 *   node agent-os/smoke/memo_smoke.mjs
 */

import {
  stableSerialize,
  fnv1a32,
  executeCacheKey,
  cloneMeshPod,
  MeshResultCache,
  ShapeMemoTable,
} from "../src/memo-cache.js";

let failed = 0;

function expect(cond, msg) {
  if (!cond) {
    failed++;
    console.error("FAIL:", msg);
  } else {
    console.log("ok:", msg);
  }
}

// --- stableSerialize / key ---
{
  expect(stableSerialize({ b: 1, a: 2 }) === '{"a":2,"b":1}', "stableSerialize: key sort");
  expect(stableSerialize([3, 1]) === "[3,1]", "stableSerialize: array");
  const k1 = executeCacheKey("local w=1\n", { w: 1, h: 2 }, 0.15);
  const k2 = executeCacheKey("local w=1\n", { h: 2, w: 1 }, 0.15);
  expect(k1 === k2, "executeCacheKey: param key order stable");
  const k3 = executeCacheKey("local w=1\n", { w: 2, h: 2 }, 0.15);
  expect(k1 !== k3, "executeCacheKey: param value change differs");
  const k4 = executeCacheKey("local w=1\n", { w: 1, h: 2 }, 0.5);
  expect(k1 !== k4, "executeCacheKey: deflection change differs");
  const k5 = executeCacheKey("local w=2\n", { w: 1, h: 2 }, 0.15);
  expect(k1 !== k5, "executeCacheKey: source change differs");
  expect(k1.startsWith("exec:"), "executeCacheKey: prefix");
  expect(fnv1a32("abc").length === 8, "fnv1a32: 8 hex");
}

// --- MeshResultCache + clone for transfer safety ---
{
  const cache = new MeshResultCache();
  const positions = new Float32Array([0, 1, 2]);
  const indices = new Uint32Array([0, 1, 2]);
  const mesh = {
    positions,
    normals: new Float32Array([0, 0, 1]),
    indices,
    bbox: { min: [0, 0, 0], max: [1, 1, 1] },
    volume: 1,
    vertexCount: 1,
    indexCount: 3,
  };
  const key = executeCacheKey("s", { a: 1 }, 0.15);
  cache.set(key, { mesh, meta: { root: 1 }, stdout: "ok" });

  // Mutate original after set — cache must be independent.
  positions[0] = 99;
  const hit = cache.get(key);
  expect(!!hit, "mesh cache: hit");
  expect(hit.mesh.positions[0] === 0, "mesh cache: clone on set");
  expect(hit.meta.root === 1, "mesh cache: meta");
  expect(cache.get("other") === null, "mesh cache: miss");

  // Detach a transferred-style view of the hit; cache must survive.
  hit.mesh.positions[0] = 7;
  const hit2 = cache.get(key);
  expect(hit2.mesh.positions[0] === 0, "mesh cache: clone on get");

  const cloned = cloneMeshPod(mesh);
  expect(cloned.positions !== mesh.positions, "cloneMeshPod: new buffer");
  cache.clear();
  expect(cache.get(key) === null, "mesh cache: clear");
}

// --- ShapeMemoTable (OccBridge memo) ---
{
  const memo = new ShapeMemoTable();
  const shapes = new Map([
    [1, 0x100],
    [2, 0x200],
    [3, 0x300],
  ]);

  memo.begin(); // gen 1
  expect(memo.get("fp-a", shapes).hit === false, "shape memo: cold miss");
  memo.put("fp-a", 1);
  memo.put("fp-b", 2);
  let g = memo.get("fp-a", shapes);
  expect(g.hit === true && g.shapeId === 1, "shape memo: hit a");
  g = memo.get("fp-b", shapes);
  expect(g.hit === true && g.shapeId === 2, "shape memo: hit b");

  // New generation: only re-touched keys stay after keepIds
  memo.begin(); // gen 2
  memo.put("fp-a", 1); // reused
  // fp-b not touched
  memo.put("fp-c", 3); // new
  const keep = memo.keepIds(1);
  expect(keep.has(1) && keep.has(3), "shape memo: keep touched + root");
  expect(!keep.has(2), "shape memo: drop stale b");
  expect(memo.get("fp-b", shapes).hit === false, "shape memo: stale entry removed");

  // Dead shape pointer → miss + drop
  memo.put("fp-dead", 99);
  expect(memo.get("fp-dead", shapes).hit === false, "shape memo: missing shape is miss");

  memo.clear();
  expect(memo.size === 0, "shape memo: clear");
}

// Simulate two identical executes hitting mesh cache (worker path contract)
{
  const cache = new MeshResultCache();
  const key = executeCacheKey("solid.box()", { w: 10 }, 0.25);
  let hostCalls = 0;
  function fakeExecute(params) {
    const k = executeCacheKey("solid.box()", params, 0.25);
    const hit = cache.get(k);
    if (hit) {
      return { meshCacheHit: true, mesh: hit.mesh };
    }
    hostCalls++;
    const mesh = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      indices: new Uint32Array([0, 1, 2]),
      vertexCount: 3,
      indexCount: 3,
      volume: 1,
    };
    cache.set(k, { mesh, meta: { root: 1 } });
    return { meshCacheHit: false, mesh };
  }
  const r1 = fakeExecute({ w: 10 });
  expect(r1.meshCacheHit === false && hostCalls === 1, "sim: first miss builds");
  const r2 = fakeExecute({ w: 10 });
  expect(r2.meshCacheHit === true && hostCalls === 1, "sim: second hit skips host");
  const r3 = fakeExecute({ w: 11 });
  expect(r3.meshCacheHit === false && hostCalls === 2, "sim: param change rebuilds");
  expect(r2.mesh.positions.length === 9, "sim: hit mesh intact");
}

if (failed > 0) {
  console.error(`memo_smoke FAIL (${failed})`);
  process.exit(1);
}
console.log("memo_smoke PASS");
process.exit(0);
