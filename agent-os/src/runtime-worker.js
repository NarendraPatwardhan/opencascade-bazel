/**
 * Browser module worker: AgentOS + host CAD tools + libocc_c.
 * Kinds: config | warm | analyze | execute
 */

import { PROTOCOL } from "./protocol.js";
import { OccBridge } from "./occ-bridge.js";
import {
  parseLuauAnalyzeOutput,
  adjustPreludeLines,
  filterDiagnosticsByPath,
} from "./analyze-parse.js";

let assetBase = "/agent-os/";
/** @type {import('./occ-bridge.js').OccBridge | null} */
let occ = null;
/** @type {any} */
let vm = null;
/** @type {any} */
let mcApi = null;
let warmingVm = null;
let warmingFull = null;

/** Execute still prepends package.path (1 line) for /opt/cad solid + ir. */
const EXECUTE_PRELUDE_LINES = 1;

/**
 * cad.ir package files under /opt/cad/ir/ (require("ir") → ir/init.luau).
 * Keep in sync with agent-os/src/batteries/ir/** (manifest also at batteries/ir/MANIFEST).
 */
const IR_LUAU_FILES = [
  "init.luau",
  "errors.luau",
  "limits.luau",
  "registry.luau",
  "host.luau",
  "load.luau",
  "bind.luau",
  "validate.luau",
  "resolve.luau",
  "eval.luau",
  "demo.luau",
  "canonical.luau",
  "ops/prims.luau",
  "ops/boolean.luau",
  "ops/xform.luau",
  "ops/route.luau",
  "ops/frames.luau",
  "ops/measure.luau",
  "ops/chain.luau",
];

/**
 * Analyze workspace: user entry + solid + typed stubs for tools/json.
 * Bare require("solid") resolves via package.path ./?.luau next to main.
 * solid's require("tools")/require("json") are rewritten to relative paths
 * because the analyzer does not load AgentOS embedded builtins.
 */
const ANALYZE_DIR = "/tmp/cad";
const ANALYZE_ENTRY = `${ANALYZE_DIR}/main.luau`;

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

/** AgentOS VM only (for luau-analyze). Does not load OCCT. */
async function ensureVm() {
  if (vm) return;
  if (warmingVm) return warmingVm;
  warmingVm = (async () => {
    const b = base();
    log("warming AgentOS…", b);
    const [{ mc, tool, z }, kernel, image, catalogCompiler] = await Promise.all([
      import(/* webpackIgnore: true */ new URL("mc-core.mjs", b).href),
      fetchBytes(new URL("kernel.wasm", b).href),
      fetchBytes(new URL("loom.tar", b).href),
      fetchBytes(new URL("catalog-compiler.wasm", b).href),
    ]);
    mcApi = { mc, tool, z };

    // CAD tool registered even before OCC loads — analyze does not call it.
    const cadTool = tool({
      name: "cad call",
      description: "OpenCASCADE host geometry op.",
      input: z.object({ op: z.string() }).passthrough(),
      async run(input) {
        if (!occ) throw new Error("OCCT not warmed yet");
        const { op, ...rest } = input;
        return occ.call(op, rest);
      },
    });

    vm = await mc.create({
      runtime: "browser",
      kernel,
      image,
      catalogCompiler,
      tools: [cadTool],
    });
    log("AgentOS VM ready");
  })();
  try {
    await warmingVm;
  } finally {
    warmingVm = null;
  }
}

/** VM + OCCT for execute. */
async function ensureWarm() {
  await ensureVm();
  if (occ) return;
  if (warmingFull) return warmingFull;
  warmingFull = (async () => {
    occ = await OccBridge.create(base());
    log("OCCT", occ.version());
  })();
  try {
    await warmingFull;
  } finally {
    warmingFull = null;
  }
}

async function mkdirp(path) {
  const parts = String(path).split("/").filter(Boolean);
  let cur = "";
  for (const part of parts) {
    cur += "/" + part;
    try {
      await vm.fs.mkdir(cur);
    } catch {
      // exists
    }
  }
}

async function stageBatteries() {
  const b = base();
  const solid = await fetchText(new URL("batteries/solid.luau", b).href);
  await mkdirp("/opt/cad");
  await mkdirp("/opt/cad/ir");
  await mkdirp("/opt/cad/ir/ops");
  await vm.fs.write("/opt/cad/solid.luau", solid);

  let initOk = false;
  await Promise.all(
    IR_LUAU_FILES.map(async (rel) => {
      try {
        const text = await fetchText(new URL(`batteries/ir/${rel}`, b).href);
        await vm.fs.write(`/opt/cad/ir/${rel}`, text);
        if (rel === "init.luau") initOk = true;
      } catch (e) {
        log("ir battery skip", rel, e?.message || e);
      }
    }),
  );
  if (!initOk) {
    throw new Error('batteries/ir/init.luau missing — cannot stage cad.ir (require("ir"))');
  }
}

/**
 * Stage module graph for luau-analyze (no package.path prelude on user source).
 * @param {string} userSource
 */
async function stageAnalyzeWorkspace(userSource) {
  const b = base();
  const [solidSrc, toolsStub, jsonStub] = await Promise.all([
    fetchText(new URL("batteries/solid.luau", b).href),
    fetchText(new URL("batteries/analyze/tools.luau", b).href),
    fetchText(new URL("batteries/analyze/json.luau", b).href),
  ]);
  // Point solid at local stubs so the analyzer can load tools/json types.
  const solidForAnalyze = solidSrc
    .replace(/require\("tools"\)/g, 'require("./tools")')
    .replace(/require\("json"\)/g, 'require("./json")');

  await mkdirp(ANALYZE_DIR);
  await vm.fs.write(`${ANALYZE_DIR}/tools.luau`, toolsStub);
  await vm.fs.write(`${ANALYZE_DIR}/json.luau`, jsonStub);
  await vm.fs.write(`${ANALYZE_DIR}/solid.luau`, solidForAnalyze);
  await vm.fs.write(ANALYZE_ENTRY, userSource ?? "");
}

function parseResult(stdout) {
  const marker = "__OCC_CAD_RESULT__";
  for (const line of String(stdout || "").split(/\r?\n/).reverse()) {
    const idx = line.indexOf(marker);
    if (idx >= 0) return JSON.parse(line.slice(idx + marker.length));
  }
  return null;
}

async function analyze(req) {
  await ensureVm();
  const source = req.source ?? "";
  await stageAnalyzeWorkspace(source);
  const result = await vm.exec(`luau-analyze ${ANALYZE_ENTRY}`);
  const raw = `${result.stdout || ""}\n${result.stderr || ""}`;
  const all = parseLuauAnalyzeOutput(raw);
  // Markers map to the Monaco buffer = user entry only (not solid/tools/json).
  const diags = filterDiagnosticsByPath(all, ["main.luau", ANALYZE_ENTRY]);
  return {
    id: req.id,
    kind: "analyze",
    code: 0,
    diagnostics: diags,
    meta: {
      protocol: PROTOCOL,
      analyzeExit: result.exitCode,
      errorCount: diags.filter((d) => d.severity === "error").length,
      diagnosticCount: diags.length,
      allDiagnosticCount: all.length,
    },
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

async function execute(req) {
  await ensureWarm();
  // Drop shapes from prior runs so host OCCT memory does not grow without bound.
  occ.freeAll();
  await stageBatteries();
  const source = req.source;
  if (!source?.trim()) throw new Error("empty Luau source");

  const wrapped =
    `package.path = "/opt/cad/?.luau;/opt/cad/?/init.luau;" .. package.path\n` + source;
  const result = await vm.luau(wrapped);
  if (result.exitCode !== 0) {
    const raw = `${result.stdout || ""}\n${result.stderr || ""}`;
    const diags = adjustPreludeLines(parseLuauAnalyzeOutput(raw), EXECUTE_PRELUDE_LINES);
    return {
      id: req.id,
      kind: "execute",
      code: result.exitCode || 1,
      diagnostics: diags,
      error: (result.stderr || result.stdout || "luau failed").trim(),
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  const payload = parseResult(result.stdout);
  if (!payload || typeof payload.root !== "number") {
    return {
      id: req.id,
      kind: "execute",
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
    kind: "execute",
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
      self.postMessage({
        id: msg.id ?? 0,
        kind: "config",
        code: 0,
        diagnostics: [],
        meta: { assetBase },
      });
      return;
    }
    if (msg.kind === "warm") {
      await ensureWarm();
      self.postMessage({
        id: msg.id,
        kind: "warm",
        code: 0,
        diagnostics: [],
        meta: { occVersion: occ.version(), protocol: PROTOCOL },
      });
      return;
    }
    if (msg.kind === "analyze") {
      const reply = await analyze(msg);
      self.postMessage(reply);
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
    self.postMessage({
      id: msg.id ?? 0,
      kind: msg.kind,
      code: 1,
      diagnostics: [],
      error: `unknown kind ${msg.kind}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log("error", message);
    self.postMessage({
      id: msg.id ?? 0,
      kind: msg.kind,
      code: 1,
      diagnostics: [],
      error: message,
    });
  }
};

log("loaded");
