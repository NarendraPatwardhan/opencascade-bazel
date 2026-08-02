/**
 * Browser module worker: AgentOS + host CAD tools + libocc_c.
 * Kinds: config | warm | analyze | execute | params_resolve
 */

import { ensureWebCrypto } from "./sha256-polyfill.js";
import { PROTOCOL } from "./protocol.js";
import { OccBridge } from "./occ-bridge.js";
import {
  parseLuauAnalyzeOutput,
  filterDiagnosticsByPath,
} from "./analyze-parse.js";
import {
  buildParamsInjectedSource,
  adjustInjectedDiagnostics,
} from "./params/inject.js";

// mc-core needs crypto.subtle.digest + crypto.randomUUID. Patch only missing
// methods — never replace globalThis.crypto (that deleted randomUUID before).
ensureWebCrypto();

let assetBase = "/agent-os/";
/** @type {import('./occ-bridge.js').OccBridge | null} */
let occ = null;
/** @type {any} */
let vm = null;
/** @type {any} */
let mcApi = null;
let warmingVm = null;
let warmingFull = null;

/** Execute always prepends package.path (1 line) for /opt/cad solid + ir. */
const PACKAGE_PATH_LINES = 1;

/**
 * Top-level batteries under /opt/cad/*.luau (require("solid") / require("route") / …).
 * Batteries author through IR tape comprehensively (solid/route/frames/query).
 * Keep in sync with batteries/MANIFEST.
 */
const TOP_BATTERY_LUAU = [
  "solid.luau",
  "route.luau",
  "frames.luau",
  "query.luau",
  "cad.luau",
  "params.luau",
  "params_resolve.luau",
];

/** Guest → host POD marker for params harvest (parallel to __OCC_CAD_RESULT__). */
const PARAMS_RESULT_MARKER = "__OCC_PARAMS_RESULT__";

/**
 * cad.ir package files under /opt/cad/ir/ (require("ir") → ir/init.luau).
 * Keep in sync with agent-os/src/batteries/ir/** (manifest also at batteries/ir/MANIFEST).
 * Staged for both execute and analyze (cad.luau eagerly requires "ir").
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
  "tape.luau",
  "ops/prims.luau",
  "ops/boolean.luau",
  "ops/xform.luau",
  "ops/route.luau",
  "ops/frames.luau",
  "ops/measure.luau",
  "ops/chain.luau",
  "ops/features.luau",
];

/**
 * Analyze workspace: user entry + top-level batteries + ir package + tools/json stubs.
 * Bare require("solid"|"cad"|"ir"|…) resolves via package.path next to main.
 * Batteries' require("tools")/require("json") are rewritten to relative paths
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
    // Never throw from run(): loom collapses host throws to generic
    // "host tool call failed". Return a sentinel; ir/host.luau elevates it.
    const cadTool = tool({
      name: "cad call",
      description: "OpenCASCADE host geometry op.",
      input: z.object({ op: z.string() }).passthrough(),
      async run(input) {
        try {
          if (!occ) throw new Error("OCCT not warmed yet");
          const { op, ...rest } = input;
          return occ.call(op, rest);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          return {
            __occ_err: message,
            __occ_op: input && typeof input === "object" ? input.op : undefined,
          };
        }
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

/** @type {boolean} */
let batteriesStaged = false;
/** @type {boolean} */
let paramsResolveStaged = false;

async function stageBatteries() {
  const b = base();
  await mkdirp("/opt/cad");
  await mkdirp("/opt/cad/ir");
  await mkdirp("/opt/cad/ir/ops");

  let solidOk = false;
  await Promise.all(
    TOP_BATTERY_LUAU.map(async (name) => {
      try {
        const text = await fetchText(new URL(`batteries/${name}`, b).href);
        await vm.fs.write(`/opt/cad/${name}`, text);
        if (name === "solid.luau") solidOk = true;
        if (name === "params_resolve.luau") paramsResolveStaged = true;
      } catch (e) {
        log("battery skip", name, e?.message || e);
      }
    }),
  );
  if (!solidOk) {
    throw new Error('batteries/solid.luau missing — cannot stage solid battery');
  }

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
  batteriesStaged = true;
}

/**
 * Schema harvest only needs params_resolve.luau (+ loom syntax/json builtins).
 * Avoid re-staging solid/ir on every debounced editor params resolve.
 */
async function stageParamsResolveBattery() {
  if (paramsResolveStaged) return;
  const b = base();
  await mkdirp("/opt/cad");
  try {
    const text = await fetchText(
      new URL("batteries/params_resolve.luau", b).href,
    );
    await vm.fs.write("/opt/cad/params_resolve.luau", text);
    paramsResolveStaged = true;
  } catch (e) {
    throw new Error(
      `batteries/params_resolve.luau missing: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/**
 * Stage module graph for luau-analyze (no package.path prelude on user source).
 * Includes top-level batteries + full ir/ package so require("cad") works
 * (cad.luau eagerly requires "ir").
 * @param {string} userSource
 */
async function stageAnalyzeWorkspace(userSource) {
  const b = base();
  const [toolsStub, jsonStub, ...batterySrcs] = await Promise.all([
    fetchText(new URL("batteries/analyze/tools.luau", b).href),
    fetchText(new URL("batteries/analyze/json.luau", b).href),
    ...TOP_BATTERY_LUAU.map(async (name) => {
      try {
        return { name, text: await fetchText(new URL(`batteries/${name}`, b).href) };
      } catch {
        return { name, text: null };
      }
    }),
  ]);

  await mkdirp(ANALYZE_DIR);
  await mkdirp(`${ANALYZE_DIR}/ir`);
  await mkdirp(`${ANALYZE_DIR}/ir/ops`);
  await vm.fs.write(`${ANALYZE_DIR}/tools.luau`, toolsStub);
  await vm.fs.write(`${ANALYZE_DIR}/json.luau`, jsonStub);

  // Point batteries at local stubs so the analyzer can load tools/json types.
  // Peer requires (solid/route/ir) stay bare — same dir / ir package layout.
  for (const { name, text } of batterySrcs) {
    if (!text) continue;
    const forAnalyze = text
      .replace(/require\("tools"\)/g, 'require("./tools")')
      .replace(/require\("json"\)/g, 'require("./json")');
    await vm.fs.write(`${ANALYZE_DIR}/${name}`, forAnalyze);
  }

  // Stage ir package so require("ir") / require("cad").ir resolves under analyze.
  // ir.host uses require("tools") — rewrite to ../tools for /tmp/cad/ir/*.luau.
  // Nested ops use require("ir.host") etc. — leave bare (package-style).
  let irInitOk = false;
  await Promise.all(
    IR_LUAU_FILES.map(async (rel) => {
      try {
        let text = await fetchText(new URL(`batteries/ir/${rel}`, b).href);
        // From /tmp/cad/ir/*.luau → ../tools; from ops/*.luau → ../../tools
        if (rel.startsWith("ops/")) {
          text = text
            .replace(/require\("tools"\)/g, 'require("../../tools")')
            .replace(/require\("json"\)/g, 'require("../../json")');
        } else {
          text = text
            .replace(/require\("tools"\)/g, 'require("../tools")')
            .replace(/require\("json"\)/g, 'require("../json")');
        }
        await vm.fs.write(`${ANALYZE_DIR}/ir/${rel}`, text);
        if (rel === "init.luau") irInitOk = true;
      } catch (e) {
        log("analyze ir skip", rel, e?.message || e);
      }
    }),
  );
  if (!irInitOk) {
    log("analyze: ir/init.luau missing — require(\"cad\") / require(\"ir\") may fail analyze");
  }

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

/**
 * Parse __OCC_PARAMS_RESULT__ + JSON POD array from guest stdout.
 * @param {string} stdout
 * @returns {any[] | null}
 */
function parseParamsResult(stdout) {
  for (const line of String(stdout || "").split(/\r?\n/).reverse()) {
    const idx = line.indexOf(PARAMS_RESULT_MARKER);
    if (idx >= 0) {
      const raw = line.slice(idx + PARAMS_RESULT_MARKER.length);
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    }
  }
  return null;
}

/**
 * Wrap user source with host params inject (preserves --! hot comments).
 * @param {string} userSource
 * @param {Record<string, any> | undefined} values
 */
function wrapUserSource(userSource, values) {
  return buildParamsInjectedSource(
    userSource ?? "",
    values && typeof values === "object" ? values : {},
  );
}

async function analyze(req) {
  await ensureVm();
  const source = req.source ?? "";
  // Inject params so `params.width` / params.number / require("params") work.
  // Hot comments (--!strict) stay at file head; inject sits after them.
  const built = wrapUserSource(source, req.params);
  await stageAnalyzeWorkspace(built.source);
  const result = await vm.exec(`luau-analyze ${ANALYZE_ENTRY}`);
  const raw = `${result.stdout || ""}\n${result.stderr || ""}`;
  const all = parseLuauAnalyzeOutput(raw);
  // Markers map to the Monaco buffer = user entry only (not solid/tools/json).
  let diags = filterDiagnosticsByPath(all, ["main.luau", ANALYZE_ENTRY]);
  diags = adjustInjectedDiagnostics(diags, {
    packagePathLines: 0,
    headLineCount: built.headLineCount,
    injectLineCount: built.injectLineCount,
  });
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
      paramsInjectLines: built.injectLineCount,
      paramsHeadLines: built.headLineCount,
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

  const built = wrapUserSource(source, req.params);
  const wrapped =
    `package.path = "/opt/cad/?.luau;/opt/cad/?/init.luau;" .. package.path\n` +
    built.source;
  const result = await vm.luau(wrapped);
  if (result.exitCode !== 0) {
    const raw = `${result.stdout || ""}\n${result.stderr || ""}`;
    const diags = adjustInjectedDiagnostics(parseLuauAnalyzeOutput(raw), {
      packagePathLines: PACKAGE_PATH_LINES,
      headLineCount: built.headLineCount,
      injectLineCount: built.injectLineCount,
    });
    // Prefer structured IR fail marker when present (op / host_op / real OCC msg).
    let errorText = (result.stderr || result.stdout || "luau failed").trim();
    const failPayload = parseResult(result.stdout);
    if (failPayload && failPayload.ok === false && failPayload.error) {
      const e = failPayload.error;
      const parts = [e.message || e.code || "IR eval failed"];
      if (e.op) {
        let tag = String(e.op);
        if (e.op_id) tag += ` ${e.op_id}`;
        if (e.host_op) tag += ` host=${e.host_op}`;
        parts.push(`[${tag}]`);
      } else if (e.host_op) {
        parts.push(`[host=${e.host_op}]`);
      }
      errorText = parts.join(" ");
    }
    return {
      id: req.id,
      kind: "execute",
      code: result.exitCode || 1,
      diagnostics: diags,
      error: errorText,
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

/**
 * Product path: guest Luau + require("syntax") → POD param list.
 * Host only stores / sheets / injects values — no JS Luau parse.
 * Needs AgentOS VM only (no OCCT). syntax service starts lazily on first use.
 * @param {{ id: number, source?: string }} req
 */
async function paramsResolve(req) {
  await ensureVm();
  // Only params_resolve.luau — not full solid/ir restage on every editor debounce.
  await stageParamsResolveBattery();
  const source = req.source ?? "";
  await mkdirp("/tmp");
  // Unique path per request to reduce races with concurrent harvest calls.
  const srcPath = `/tmp/params_resolve_src_${req.id ?? 0}.luau`;
  await vm.fs.write(srcPath, source);

  const harness =
    `package.path = "/opt/cad/?.luau;/opt/cad/?/init.luau;" .. package.path\n` +
    `local pr = require("params_resolve")\n` +
    `pr.run_file(${JSON.stringify(srcPath)})\n`;

  const result = await vm.luau(harness);
  if (result.exitCode !== 0) {
    const errText = (result.stderr || result.stdout || "params_resolve failed").trim();
    return {
      id: req.id,
      kind: "params_resolve",
      code: result.exitCode || 1,
      diagnostics: [],
      error: errText,
      stdout: result.stdout,
      stderr: result.stderr,
      params: [],
      meta: { protocol: PROTOCOL, path: "syntax", syntax: false },
    };
  }

  let params;
  try {
    params = parseParamsResult(result.stdout);
  } catch (e) {
    return {
      id: req.id,
      kind: "params_resolve",
      code: 2,
      diagnostics: [],
      error: `params_resolve: invalid POD JSON: ${e instanceof Error ? e.message : String(e)}`,
      stdout: result.stdout,
      stderr: result.stderr,
      params: [],
      meta: { protocol: PROTOCOL, path: "syntax", syntax: false },
    };
  }
  if (!params) {
    return {
      id: req.id,
      kind: "params_resolve",
      code: 2,
      diagnostics: [],
      error: `missing ${PARAMS_RESULT_MARKER} — params_resolve battery failed`,
      stdout: result.stdout,
      stderr: result.stderr,
      params: [],
      meta: { protocol: PROTOCOL, path: "syntax", syntax: false },
    };
  }

  return {
    id: req.id,
    kind: "params_resolve",
    code: 0,
    diagnostics: [],
    params,
    meta: {
      protocol: PROTOCOL,
      path: "syntax",
      syntax: true,
      count: params.length,
    },
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

/**
 * Serialize all worker work on the shared AgentOS VM + OccBridge.
 * Overlapping execute/params_resolve/analyze freeAll races produce
 * "unknown shape id N" → generic "host tool call failed" at solid.finish.
 */
/** @type {Promise<void>} */
let workTail = Promise.resolve();

/**
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
function enqueue(fn) {
  const run = workTail.then(fn, fn);
  // Keep the chain alive even when a job rejects.
  workTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

self.onmessage = (ev) => {
  const msg = ev.data;
  if (!msg || typeof msg !== "object") return;
  // config is cheap and sets assetBase for subsequent jobs — still serialize
  // so it cannot race with a mid-flight fetch of batteries.
  void enqueue(async () => {
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
      if (msg.kind === "params_resolve") {
        const reply = await paramsResolve(msg);
        self.postMessage(reply);
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
  });
};

log("loaded");
