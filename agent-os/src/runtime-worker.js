/**
 * Browser module worker: wraps CadEngine with fetch-based IO.
 */

import { PROTOCOL } from "./protocol.js";
import { OccBridge } from "./occ-bridge.js";

let assetBase = "/agent-os/";
/** @type {import('./occ-bridge.js').OccBridge | null} */
let occ = null;
/** @type {any} */
let vm = null;
let warming = null;

function log(...a) {
  console.log("[cad-runtime]", ...a);
}

async function fetchBytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url}: HTTP ${res.status}`);
  return res.text();
}

function base() {
  return assetBase.endsWith("/") ? assetBase : assetBase + "/";
}

async function ensureWarm() {
  if (vm && occ) return;
  if (warming) return warming;
  warming = (async () => {
    const b = base();
    log("warming…", b);
    const [{ mc, tool, z }, kernel, image, catalogCompiler] = await Promise.all([
      import(/* webpackIgnore: true */ new URL("mc-core.mjs", b).href),
      fetchBytes(new URL("kernel.wasm", b).href),
      fetchBytes(new URL("loom.tar", b).href),
      fetchBytes(new URL("catalog-compiler.wasm", b).href),
    ]);

    occ = await OccBridge.create(b);
    log("OCCT", occ.version());

    const bridge = occ;
    const cadTool = tool({
      name: "cad call",
      description: "OpenCASCADE host geometry op.",
      input: z.object({ op: z.string() }).passthrough(),
      async run(input) {
        const { op, ...rest } = input;
        return bridge.call(op, rest);
      },
    });

    vm = await mc.create({
      runtime: "browser",
      kernel,
      image,
      catalogCompiler,
      tools: [cadTool],
    });
    log("VM ready");
  })();
  try {
    await warming;
  } finally {
    warming = null;
  }
}

async function stageBatteries() {
  const solid = await fetchText(new URL("batteries/solid.luau", base()).href);
  await vm.fs.mkdir("/opt");
  await vm.fs.mkdir("/opt/cad");
  await vm.fs.write("/opt/cad/solid.luau", solid);
}

function parseResult(stdout) {
  const marker = "__OCC_CAD_RESULT__";
  for (const line of String(stdout || "").split(/\r?\n/).reverse()) {
    const idx = line.indexOf(marker);
    if (idx >= 0) return JSON.parse(line.slice(idx + marker.length));
  }
  return null;
}

async function execute(req) {
  await ensureWarm();
  // Drop shapes from prior runs so host OCCT memory does not grow without bound.
  occ.freeAll();
  await stageBatteries();
  const source = req.source;
  if (!source?.trim()) throw new Error("empty Luau source");

  const wrapped = `package.path = "/opt/cad/?.luau;" .. package.path\n` + source;
  const result = await vm.luau(wrapped);
  if (result.exitCode !== 0) {
    return {
      id: req.id,
      code: result.exitCode || 1,
      diagnostics: [],
      error: (result.stderr || result.stdout || "luau failed").trim(),
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  const payload = parseResult(result.stdout);
  if (!payload || typeof payload.root !== "number") {
    return {
      id: req.id,
      code: 2,
      diagnostics: [],
      error: "missing __OCC_CAD_RESULT__ — call solid.finish(root)",
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  const deflection = Number(req.deflection ?? 0.15);
  const mesh = occ.mesh(payload.root, deflection);
  // Keep only the finished root for optional follow-up measure ops in-session.
  for (const id of [...occ.shapes.keys()]) {
    if (id !== payload.root) occ.free(id);
  }
  return {
    id: req.id,
    code: 0,
    diagnostics: [],
    stdout: result.stdout,
    stderr: result.stderr,
    mesh: {
      positions: mesh.positions,
      normals: mesh.normals,
      indices: mesh.indices,
      bbox: mesh.bbox,
      volume: mesh.volume,
      vertexCount: mesh.vertexCount,
      indexCount: mesh.indexCount,
    },
    meta: {
      protocol: PROTOCOL,
      root: payload.root,
      name: payload.name,
      occVersion: occ.version(),
      deflection,
    },
  };
}

self.onmessage = async (ev) => {
  const msg = ev.data;
  if (!msg || typeof msg !== "object") return;
  try {
    if (msg.kind === "config" && msg.assetBase) {
      assetBase = msg.assetBase;
      self.postMessage({ id: msg.id ?? 0, code: 0, diagnostics: [], meta: { assetBase } });
      return;
    }
    if (msg.kind === "warm") {
      await ensureWarm();
      self.postMessage({
        id: msg.id,
        code: 0,
        diagnostics: [],
        meta: { occVersion: occ.version(), protocol: PROTOCOL },
      });
      return;
    }
    if (msg.kind === "execute") {
      const reply = await execute(msg);
      if (reply.code === 0 && reply.mesh) {
        const t = [reply.mesh.positions.buffer, reply.mesh.indices.buffer];
        if (reply.mesh.normals) t.push(reply.mesh.normals.buffer);
        self.postMessage(reply, t);
      } else {
        self.postMessage(reply);
      }
      return;
    }
    self.postMessage({ id: msg.id ?? 0, code: 1, diagnostics: [], error: `unknown kind ${msg.kind}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log("error", message);
    self.postMessage({ id: msg.id ?? 0, code: 1, diagnostics: [], error: message });
  }
};

log("loaded");
