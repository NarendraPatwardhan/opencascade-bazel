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
import { executeCacheKey, MeshResultCache } from "./memo-cache.js";
import { joinAssetUrl, normalizeAssetBase } from "./asset-url.js";

// mc-core needs crypto.subtle.digest + crypto.randomUUID. Patch only missing
// methods — never replace globalThis.crypto (that deleted randomUUID before).
ensureWebCrypto();

/** Asset root (absolute or path). Always normalized via base(). */
let assetBase = "";
/** @type {import('./occ-bridge.js').OccBridge | null} */
let occ = null;
/** @type {any} */
let vm = null;
/** @type {any} */
let mcApi = null;
let warmingVm = null;
let warmingFull = null;

/** Full-result mesh cache (source+params+deflection) for param scrub. */
const meshResultCache = new MeshResultCache();

/**
 * Mid-flight execute preemption (Phase 3).
 * Onmessage bumps latestStamp.execute immediately; the active execute
 * cooperatively aborts at the next cad.call host boundary (cannot interrupt
 * a single OCC ccall mid-op). Yields the event loop so stamped messages land.
 */
/** Monotonic stamp per coalescible kind (latest-wins). */
const latestStamp = {
  execute: 0,
  params_resolve: 0,
  analyze: 0,
};
/** Stamp of the execute currently inside execute() (0 = none). */
let activeExecuteStamp = 0;
/** Set when a newer execute arrives while activeExecuteStamp is in flight. */
let executeAbortRequested = false;

/**
 * Yield so pending worker onmessage handlers can bump latestStamp / abort.
 * Macrotask (setTimeout 0) — microtasks alone do not drain message events.
 * @returns {Promise<void>}
 */
function yieldToEventLoop() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** @returns {boolean} */
function isExecuteAborted() {
  if (activeExecuteStamp <= 0) return false;
  if (executeAbortRequested) return true;
  return activeExecuteStamp < latestStamp.execute;
}

/**
 * Soft-cancel reply body (also used as execute() return when mid-flight abort).
 * @param {{ id?: number }} req
 * @param {string} reason
 */
function cancelledReply(req, reason = "superseded") {
  return {
    id: req.id ?? 0,
    kind: "execute",
    code: 0,
    cancelled: true,
    diagnostics: [],
    meta: { protocol: PROTOCOL, cancelled: true, reason },
  };
}

/**
 * True when guest __OCC_CAD_RESULT__ fail payload is a cooperative abort.
 * @param {any} payload
 */
function isAbortFailPayload(payload) {
  if (!payload || payload.ok !== false || !payload.error) return false;
  const e = payload.error;
  if (e.aborted === true) return true;
  if (e.code === "IR_ERR_ABORTED") return true;
  const msg = String(e.message || "");
  return msg === "aborted" || msg.startsWith("aborted:");
}

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

/** Normalized asset root (never throws on path-only bases). */
function base() {
  return normalizeAssetBase(assetBase, import.meta.url);
}

/** @param {string} rel */
function asset(rel) {
  return joinAssetUrl(base(), rel);
}

/** AgentOS VM only (for luau-analyze). Does not load OCCT. */
async function ensureVm() {
  if (vm) return;
  if (warmingVm) return warmingVm;
  warmingVm = (async () => {
    const b = base();
    log("warming AgentOS…", b);
    const [{ mc, tool, z }, kernel, image, catalogCompiler] = await Promise.all([
      import(/* webpackIgnore: true */ asset("mc-core.mjs")),
      fetchBytes(asset("kernel.wasm")),
      fetchBytes(asset("loom.tar")),
      fetchBytes(asset("catalog-compiler.wasm")),
    ]);
    mcApi = { mc, tool, z };

    // CAD tool registered even before OCC loads — analyze does not call it.
    // Never throw from run(): loom collapses host throws to generic
    // "host tool call failed". Return a sentinel; ir/host.luau elevates it.
    // Mid-flight cancel: yield → check abort → free shapes → aborted sentinel
    // (between host calls only; single OCC ccall still runs to completion).
    const cadTool = tool({
      name: "cad call",
      description: "OpenCASCADE host geometry op.",
      input: z.object({ op: z.string() }).passthrough(),
      async run(input) {
        try {
          // Let onmessage stamp a newer execute and set abortRequested.
          await yieldToEventLoop();
          const op =
            input && typeof input === "object" ? String(input.op || "") : "";
          // free_all / shape_free still run during abort so cleanup works.
          if (
            isExecuteAborted() &&
            op !== "free_all" &&
            op !== "shape_free"
          ) {
            if (occ) occ.freeAll();
            return {
              __occ_err: "aborted",
              aborted: true,
              __occ_op: op || undefined,
            };
          }
          if (!occ) throw new Error("OCCT not warmed yet");
          const { op: _op, ...rest } = input;
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
/** Asset base that batteries were staged against (re-stage if config changes). */
let batteriesStagedBase = "";

function resetBatteryStaging() {
  batteriesStaged = false;
  paramsResolveStaged = false;
  batteriesStagedBase = "";
}

async function stageBatteries() {
  // Stage once per assetBase — re-staging on every execute is a major bottleneck.
  if (batteriesStaged && batteriesStagedBase === base()) return;
  const b = base();
  await mkdirp("/opt/cad");
  await mkdirp("/opt/cad/ir");
  await mkdirp("/opt/cad/ir/ops");

  let solidOk = false;
  await Promise.all(
    TOP_BATTERY_LUAU.map(async (name) => {
      try {
        const text = await fetchText(asset(`batteries/${name}`));
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
        const text = await fetchText(asset(`batteries/ir/${rel}`));
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
  batteriesStagedBase = b;
  log("batteries staged", b);
}

/**
 * Schema harvest only needs params_resolve.luau (+ loom syntax/json builtins).
 * Avoid re-staging solid/ir on every debounced editor params resolve.
 */
async function stageParamsResolveBattery() {
  if (paramsResolveStaged && batteriesStagedBase === base()) return;
  // If full batteries already staged for this base, params_resolve is included.
  if (batteriesStaged && batteriesStagedBase === base()) {
    paramsResolveStaged = true;
    return;
  }
  const b = base();
  await mkdirp("/opt/cad");
  try {
    const text = await fetchText(
      asset("batteries/params_resolve.luau"),
    );
    await vm.fs.write("/opt/cad/params_resolve.luau", text);
    paramsResolveStaged = true;
    if (!batteriesStagedBase) batteriesStagedBase = b;
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
    fetchText(asset("batteries/analyze/tools.luau")),
    fetchText(asset("batteries/analyze/json.luau")),
    ...TOP_BATTERY_LUAU.map(async (name) => {
      try {
        return { name, text: await fetchText(asset(`batteries/${name}`)) };
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
        let text = await fetchText(asset(`batteries/ir/${rel}`));
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
  const source = req.source;
  if (!source?.trim()) throw new Error("empty Luau source");

  const deflection = Number(req.deflection ?? 0.15);
  // Param scrub: mesh cache + per-op shape memo. Explicit Run rebuilds cold.
  const memo = req.memo === true;
  const cacheKey = executeCacheKey(source, req.params, deflection);

  if (memo) {
    const cached = meshResultCache.get(cacheKey);
    if (cached) {
      if (isExecuteAborted()) {
        return cancelledReply(req, "aborted");
      }
      return {
        id: req.id,
        kind: "execute",
        code: 0,
        diagnostics: [],
        stdout: cached.stdout ?? "",
        stderr: cached.stderr ?? "",
        mesh: cached.mesh,
        meta: {
          ...cached.meta,
          meshCacheHit: true,
          memo: true,
        },
      };
    }
    // Keep host shapes for op-level reuse; guest free_all → memo_begin.
    occ.setSessionOpts({ memo: true });
  } else {
    // Drop shapes + shape memo + mesh cache so host OCCT memory stays bounded.
    // Also clears any partial table left by a mid-flight abort.
    occ.freeAll();
    meshResultCache.clear();
  }

  if (isExecuteAborted()) {
    occ.freeAll();
    meshResultCache.clear();
    return cancelledReply(req, "aborted");
  }
  await stageBatteries();
  if (isExecuteAborted()) {
    occ.freeAll();
    meshResultCache.clear();
    return cancelledReply(req, "aborted");
  }

  const built = wrapUserSource(source, req.params);
  const wrapped =
    `package.path = "/opt/cad/?.luau;/opt/cad/?/init.luau;" .. package.path\n` +
    built.source;
  const result = await vm.luau(wrapped);

  // Cooperative abort: cad tool returned aborted → IR fail → exit nonzero,
  // or a newer execute stamped while we were between host calls.
  if (isExecuteAborted()) {
    occ.freeAll();
    meshResultCache.clear();
    return cancelledReply(req, "aborted");
  }

  if (result.exitCode !== 0) {
    const failPayload = parseResult(result.stdout);
    if (isAbortFailPayload(failPayload)) {
      occ.freeAll();
      meshResultCache.clear();
      return cancelledReply(req, "aborted");
    }
    const raw = `${result.stdout || ""}\n${result.stderr || ""}`;
    const diags = adjustInjectedDiagnostics(parseLuauAnalyzeOutput(raw), {
      packagePathLines: PACKAGE_PATH_LINES,
      headLineCount: built.headLineCount,
      injectLineCount: built.injectLineCount,
    });
    // Prefer structured IR fail marker when present (op / host_op / real OCC msg).
    let errorText = (result.stderr || result.stdout || "luau failed").trim();
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
    // String-only abort from tape.finish error("aborted …") without marker.
    if (
      errorText === "aborted" ||
      errorText.startsWith("aborted") ||
      /\bIR_ERR_ABORTED\b/.test(errorText)
    ) {
      occ.freeAll();
      meshResultCache.clear();
      return cancelledReply(req, "aborted");
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

  // Skip expensive mesh if a newer scrub already superseded us.
  if (isExecuteAborted()) {
    occ.freeAll();
    meshResultCache.clear();
    return cancelledReply(req, "aborted");
  }

  const mesh = occ.mesh(payload.root, deflection);

  if (memo) {
    // Drop fingerprints not reused this generation; keep root + memo hits.
    occ.memoEnd({ root: payload.root });
  } else {
    // Keep only the finished root for optional follow-up measure ops in-session.
    for (const id of [...occ.shapes.keys()]) {
      if (id !== payload.root) occ.free(id);
    }
  }

  // Final check after mesh: drop delivery if superseded during tessellation.
  if (isExecuteAborted()) {
    occ.freeAll();
    meshResultCache.clear();
    return cancelledReply(req, "aborted");
  }

  const meshPod = {
    positions: mesh.positions,
    normals: mesh.normals,
    indices: mesh.indices,
    bbox: mesh.bbox,
    volume: mesh.volume,
    vertexCount: mesh.vertexCount,
    indexCount: mesh.indexCount,
  };
  const meta = {
    protocol: PROTOCOL,
    root: payload.root,
    name: payload.name,
    occVersion: occ.version(),
    deflection,
    memo,
    meshCacheHit: false,
    shapeMemoSize: occ.memo?.size ?? 0,
  };

  if (memo) {
    meshResultCache.set(cacheKey, {
      mesh: meshPod,
      meta,
      stdout: result.stdout,
      stderr: result.stderr,
    });
  }

  return {
    id: req.id,
    kind: "execute",
    code: 0,
    diagnostics: [],
    stdout: result.stdout,
    stderr: result.stderr,
    mesh: meshPod,
    meta,
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
 *
 * Latest-wins: for execute / params_resolve / analyze, a newer job of the
 * same kind supersedes older ones. Queued jobs reply cancelled:true without
 * OCC/Luau. In-flight execute is cooperatively aborted at the next cad.call
 * boundary (yield + abort flag) so the serial chain can start the newer run
 * with a clean shape table instead of finishing every intermediate OCC op.
 */
/** @type {Promise<void>} */
let workTail = Promise.resolve();

/**
 * Highest execute stamp that has finished (ok, error, or cancelled).
 * Analyze is lower priority: skip when a newer execute is still queued/running
 * (latestStamp.execute > lastFinishedExecuteStamp). Under a serial queue
 * `executeBusy` alone is nearly always false at analyze start.
 */
let lastFinishedExecuteStamp = 0;

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

/**
 * @param {string} kind
 * @returns {boolean}
 */
function isCoalescible(kind) {
  return kind === "execute" || kind === "params_resolve" || kind === "analyze";
}

/**
 * Soft-cancel reply so host pending promises resolve without treating as error.
 * @param {{ id?: number, kind?: string }} msg
 * @param {string} [reason]
 */
function postCancelled(msg, reason = "superseded") {
  self.postMessage({
    id: msg.id ?? 0,
    kind: msg.kind,
    code: 0,
    cancelled: true,
    diagnostics: [],
    params: msg.kind === "params_resolve" ? [] : undefined,
    meta: { protocol: PROTOCOL, cancelled: true, reason },
  });
}

self.onmessage = (ev) => {
  const msg = ev.data;
  if (!msg || typeof msg !== "object") return;

  // Stamp coalescible jobs before enqueue so newer arrivals win.
  // For execute: also request cooperative abort of any in-flight older run
  // so the next cad.call host boundary fails fast (after event-loop yield).
  let stamp = 0;
  if (isCoalescible(msg.kind)) {
    stamp = ++latestStamp[msg.kind];
    if (
      msg.kind === "execute" &&
      activeExecuteStamp > 0 &&
      stamp > activeExecuteStamp
    ) {
      executeAbortRequested = true;
      log("execute preempt", { active: activeExecuteStamp, newer: stamp });
    }
  }

  // config is cheap and sets assetBase for subsequent jobs — still serialize
  // so it cannot race with a mid-flight fetch of batteries.
  void enqueue(async () => {
    try {
      if (msg.kind === "config" && msg.assetBase) {
        const prev = base();
        assetBase = String(msg.assetBase);
        const next = base();
        if (next !== prev) resetBatteryStaging();
        self.postMessage({
          id: msg.id ?? 0,
          kind: "config",
          code: 0,
          diagnostics: [],
          meta: { assetBase: next },
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

      // Latest-wins: drop superseded work before paying OCC / guest cost.
      if (isCoalescible(msg.kind) && stamp < latestStamp[msg.kind]) {
        if (msg.kind === "execute") {
          lastFinishedExecuteStamp = Math.max(lastFinishedExecuteStamp, stamp);
        }
        postCancelled(msg, "superseded");
        return;
      }

      // Analyze is lower priority: skip when an execute is queued or in flight.
      if (
        msg.kind === "analyze" &&
        latestStamp.execute > lastFinishedExecuteStamp
      ) {
        postCancelled(msg, "busy_execute");
        return;
      }

      if (msg.kind === "analyze") {
        const reply = await analyze(msg);
        // Drop stale analyze result if a newer one was queued mid-flight.
        if (stamp < latestStamp.analyze) {
          postCancelled(msg, "superseded");
          return;
        }
        self.postMessage(reply);
        return;
      }
      if (msg.kind === "execute") {
        // Re-check after any prior job; another execute may have queued.
        if (stamp < latestStamp.execute) {
          lastFinishedExecuteStamp = Math.max(lastFinishedExecuteStamp, stamp);
          postCancelled(msg, "superseded");
          return;
        }
        activeExecuteStamp = stamp;
        // Clear abort for this generation; a still-newer stamp may re-set it
        // via onmessage while we run.
        executeAbortRequested = stamp < latestStamp.execute;
        try {
          const reply = await execute(msg);
          if (reply.cancelled || stamp < latestStamp.execute) {
            // Mid-flight abort or finished but a newer scrub is pending.
            if (occ) occ.freeAll();
            postCancelled(
              msg,
              reply.cancelled
                ? reply.meta?.reason || "aborted"
                : "superseded",
            );
            return;
          }
          if (reply.code === 0 && reply.mesh) {
            const t = [reply.mesh.positions.buffer, reply.mesh.indices.buffer];
            if (reply.mesh.normals) t.push(reply.mesh.normals.buffer);
            self.postMessage(reply, t);
          } else {
            self.postMessage(reply);
          }
        } finally {
          if (activeExecuteStamp === stamp) {
            activeExecuteStamp = 0;
            // Keep executeAbortRequested only if a still-newer run is pending;
            // that run will clear/set it when it becomes active.
            if (stamp >= latestStamp.execute) {
              executeAbortRequested = false;
            }
          }
          lastFinishedExecuteStamp = Math.max(lastFinishedExecuteStamp, stamp);
        }
        return;
      }
      if (msg.kind === "params_resolve") {
        if (stamp < latestStamp.params_resolve) {
          postCancelled(msg, "superseded");
          return;
        }
        const reply = await paramsResolve(msg);
        if (stamp < latestStamp.params_resolve) {
          postCancelled(msg, "superseded");
          return;
        }
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
      // Treat unexpected abort-shaped errors as soft cancel for execute.
      if (
        msg.kind === "execute" &&
        (message === "aborted" || message.startsWith("aborted:"))
      ) {
        if (occ) occ.freeAll();
        lastFinishedExecuteStamp = Math.max(
          lastFinishedExecuteStamp,
          stamp || 0,
        );
        postCancelled(msg, "aborted");
        return;
      }
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
