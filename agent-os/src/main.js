/**
 * Host loop: editor + param sheet + scheduler + worker + viewport + history.
 * sourceMode: 'demo' | 'editor'
 *
 * Params (product): worker params_resolve → guest syntax POD → store.
 * Cold UI only: sync resolveParams() fallback until VM is warm.
 * Execute injects values from POD map (no host language analysis as schema truth).
 * While scrubbing: store is source of truth — do not rewrite Monaco.
 * View keys: viewport command-router consults editor.hasTextFocus().
 */

import { createViewport } from "./view/index.js";
import { mountLuauEditor } from "./luau-editor.js";
import { createParamStore } from "./params/store.js";
import { mountParamSheet } from "./params/sheet.js";
import {
  resolveParams,
  resolveParamsFromPods,
} from "./params/resolve.js";
import { createScheduler } from "./eval/scheduler.js";
import {
  BLOCK_HOLE_SEED,
  blockHoleSource,
  FLANGE_SOURCE,
} from "./demos/block-hole-params.js";
import { createProjectController } from "./history/project-controller.js";
import { mountHistoryPanel } from "./history/panel.js";
import { createDefaultHistoryBackend } from "./history/opfs-backend.js";
import { paramsHeaderFingerprint } from "./params/header-fingerprint.js";
import { schemaSignature } from "./params/schema-signature.js";

const ANALYZE_DEBOUNCE_MS = 550;
/** Coarser mesh while scrubbing; finer on commit / explicit run. */
const DEFLECTION_SCRUB = 0.35;
const DEFLECTION_COMMIT = 0.18;

/** Asset base for kernel / loom / mc-core / git-engine.tar (sibling of src/). */
const ASSET_BASE = new URL("../", import.meta.url).href;

const els = {
  editorHost: document.querySelector("#editor"),
  run: document.querySelector("#run"), // optional; live rebuild is the main path
  status: document.querySelector("#status"),
  log: document.querySelector("#log"),
  viewport: document.querySelector("#viewport"),
  meta: document.querySelector("#meta"),
  params: document.querySelector("#params"),
  history: document.querySelector("#history"),
};

/** @type {Awaited<ReturnType<typeof mountLuauEditor>> | null} */
let editor = null;
/** @type {Awaited<ReturnType<typeof createViewport>> | null} */
let viewport = null;
let nextId = 1;
/** @type {Worker | null} */
let worker = null;
/** @type {Map<number, { resolve: Function, reject: Function }>} */
const pending = new Map();
/** @type {Promise<void> | null} */
let configReady = null;

/** @type {ReturnType<typeof setTimeout> | null} */
let analyzeTimer = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let resolveTimer = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let editorCheckpointTimer = null;
let analyzeGen = 0;
let lastAnalyzeErrors = 0;
let isRunning = false;
/** Last schema signature applied to the store (avoid thrash rebuilds). */
let lastSchemaSig = "";
/** Fingerprint of free-param header region — skip guest harvest when unchanged. */
let lastParamsHeaderFp = "";

/** @type {'demo'|'editor'} */
let sourceMode = "demo";

/** True after worker warm (params_resolve uses guest syntax). */
let runtimeWarm = false;
/** Generation token so stale async resolves are dropped. */
let paramsResolveGen = 0;

/**
 * Applying history (undo/restore) — suppress history re-entrancy from store.
 */
let historyApplying = false;

/**
 * Initial store: cold fallback (JS line walk) until AgentOS VM is warm, then
 * product path re-resolves via guest require("syntax") → POD.
 * Seed is applied only in demo mode on re-resolve (migration gaps), never for
 * arbitrary editor buffers.
 */
const paramStore = createParamStore(resolveParams(FLANGE_SOURCE));
// Param scrub always rebuilds (debounced). No Live checkbox / Apply in UI.
paramStore.setLiveRebuild(true);

/** @type {ReturnType<typeof mountParamSheet> | null} */
let paramSheet = null;
/** @type {ReturnType<typeof mountHistoryPanel> | null} */
let historyPanel = null;

// Prefer GitEngine when git-engine.tar + mc-core load; else IDB/memory.
const historyBackend = createDefaultHistoryBackend({
  projectId: "demo-flange",
  assetBase: ASSET_BASE,
  preferGit: true,
});

const project = createProjectController({
  projectId: "demo-flange",
  backend: historyBackend,
  autosaveMs: 2000,
  async onApply(doc, meta) {
    historyApplying = true;
    try {
      const prevSource = editor ? editor.getValue() : getSource();
      const sourceChanged =
        doc.source != null && String(doc.source) !== String(prevSource);
      if (editor && doc.source != null && editor.getValue() !== doc.source) {
        editor.setValue(doc.source);
      }
      sourceMode = "editor";

      // When source changed (undo/restore), harvest schema before execute so
      // inject map matches the restored buffer (avoid wrong-window inject).
      if (
        (meta.reason === "undo" ||
          meta.reason === "redo" ||
          meta.reason === "restore") &&
        sourceChanged
      ) {
        try {
          if (runtimeWarm) {
            await syncParamsFromSourceGuest(doc.source, {
              preserveValues: false,
              force: true,
            });
          } else {
            syncParamsFromSourceFallback(doc.source, {
              preserveValues: false,
              force: true,
            });
          }
        } catch {
          syncParamsFromSourceFallback(doc.source, {
            preserveValues: false,
            force: true,
          });
        }
      }

      // Apply values into store without treating as a new user scrub.
      const list = paramStore.list().map((p) =>
        doc.values && doc.values[p.name] !== undefined
          ? { ...p, value: doc.values[p.name] }
          : p,
      );
      if (list.length) {
        // Keep schema sig so sheet can value-patch when structure unchanged.
        paramStore.replace(list);
        lastSchemaSig = schemaSignature(list);
      }
      if (
        meta.reason === "undo" ||
        meta.reason === "redo" ||
        meta.reason === "restore"
      ) {
        await runSource({
          fromParams: true,
          fit: meta.reason === "restore",
          generation: paramStore.generation,
          fine: true,
        });
      }
    } finally {
      historyApplying = false;
    }
  },
  // Lightweight: dirty badge + undo/redo enablement only (no listVersions).
  onDirtyChange(dirty, tip) {
    historyPanel?.update({
      canUndo: project.canUndo,
      canRedo: project.canRedo,
      dirty,
      tip,
      // omit versions → panel keeps existing list
      versions: undefined,
      badgeOnly: true,
    });
  },
  // Full list refresh on open / version / undo stack boundary.
  onHistoryChange() {
    void refreshHistoryPanel();
  },
});

const scheduler = createScheduler({
  debounceMs: 200,
  getLiveRebuild: () => true,
  onView(params) {
    const p =
      params.find((x) => x.name === "show_grid") || paramStore.get("show_grid");
    if (viewport && p) viewport.setOptions({ grid: !!p.value });
  },
  onXform(params) {
    const yaw =
      params.find((x) => x.name === "yaw") || paramStore.get("yaw");
    if (viewport && yaw) applyYaw(Number(yaw.value) || 0);
  },
  async onRebuild(params, meta) {
    const gen = meta.generation ?? paramStore.generation;
    const fine = meta.phase === "commit" || meta.force === true;
    await runSource({
      fromParams: true,
      fit: false,
      generation: gen,
      fine,
    });
  },
});

function setStatus(text, isError = false) {
  const t = String(text || "").trim();
  els.status.textContent = t;
  els.status.dataset.error = isError ? "1" : "0";
  if (t) els.status.removeAttribute("data-empty");
  else els.status.setAttribute("data-empty", "1");
}

/** User-facing log: drop host result markers and empty noise. */
function appendLog(line) {
  const cleaned = String(line)
    .split(/\r?\n/)
    .filter((l) => l && !l.includes("__OCC_CAD_RESULT__"))
    .join("\n")
    .trim();
  if (!cleaned) return;
  els.log.hidden = false;
  els.log.textContent += cleaned + "\n";
  els.log.scrollTop = els.log.scrollHeight;
}

/** Yaw about world Y (input degrees from the param sheet). */
function yawMatrixY(deg) {
  const rad = (Number(deg) || 0) * (Math.PI / 180);
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [
    c, 0, -s, 0,
    0, 1, 0, 0,
    s, 0, c, 0,
    0, 0, 0, 1,
  ];
}

function applyYaw(deg) {
  if (!viewport) return;
  viewport.setRootMatrix(yawMatrixY(deg));
}

function getSource() {
  if (sourceMode === "demo") return blockHoleSource();
  return editor ? editor.getValue() : blockHoleSource();
}

/**
 * Preserve current values when re-resolving schema from source.
 * @param {import('./params/types.js').Parameter[]} next
 */
function mergeCurrentValues(next) {
  const cur = paramStore.values();
  return next.map((p) =>
    cur[p.name] !== undefined ? { ...p, value: cur[p.name] } : p,
  );
}

/**
 * Seed only in demo mode (migration / missing host-only names on the flange
 * demo). Editor mode is Luau-only authority — no flange seed leak.
 * @returns {import('./params/types.js').Parameter[] | undefined}
 */
function resolveSeed() {
  if (sourceMode === "demo") return BLOCK_HOLE_SEED;
  return undefined;
}

/**
 * Apply a resolved Parameter[] into the store (shared by cold + guest paths).
 * @param {import('./params/types.js').Parameter[]} resolved
 * @param {{ preserveValues?: boolean, force?: boolean }} [opts]
 */
function applyResolvedParams(resolved, opts = {}) {
  if (!resolved.length) {
    if (paramStore.list().length) {
      lastSchemaSig = "";
      paramStore.replace([]);
    }
    return;
  }
  const list =
    opts.preserveValues !== false ? mergeCurrentValues(resolved) : resolved;
  const sig = schemaSignature(list);
  // Short-circuit: same schema → no store.replace thrash (sheet stays put).
  if (!opts.force && sig === lastSchemaSig) return;
  lastSchemaSig = sig;
  paramStore.replace(list);
}

/**
 * Cold / degraded: host-side resolveParams (luau-locals fallback).
 * Used only before runtimeWarm or if guest path errors.
 * @param {string} [src]
 * @param {{ preserveValues?: boolean, force?: boolean }} [opts]
 */
function syncParamsFromSourceFallback(src, opts = {}) {
  const source = src ?? getSource();
  const seed = resolveSeed();
  const resolved = resolveParams(source, seed ? { seed } : {});
  applyResolvedParams(resolved, opts);
}

/**
 * Product path: worker params_resolve → guest syntax POD → store.
 * @param {string} [src]
 * @param {{ preserveValues?: boolean, force?: boolean }} [opts]
 */
async function syncParamsFromSourceGuest(src, opts = {}) {
  const source = src ?? getSource();
  const seed = resolveSeed();
  const headerFp = paramsHeaderFingerprint(source);
  // Body-only edits: skip full guest harvest when free-param header unchanged.
  if (
    !opts.force &&
    headerFp &&
    headerFp === lastParamsHeaderFp &&
    lastSchemaSig
  ) {
    return;
  }
  const gen = ++paramsResolveGen;
  await ensureConfigured();
  const reply = await callWorker(
    { kind: "params_resolve", source },
    120_000,
  );
  if (gen !== paramsResolveGen) return;
  if (reply.cancelled) return;
  if (reply.code !== 0) {
    const err = reply.error || `params_resolve code ${reply.code}`;
    appendLog(`params_resolve (syntax) failed: ${err}`);
    // Degraded: keep sheet usable via host fallback (document as non-product).
    syncParamsFromSourceFallback(source, opts);
    return;
  }
  const resolved = resolveParamsFromPods(
    reply.params || [],
    source,
    seed ? { seed } : {},
  );
  applyResolvedParams(resolved, opts);
  lastParamsHeaderFp = headerFp;
}

/**
 * Re-resolve param schema from source into the store.
 * When VM is warm, product path is guest syntax; else cold fallback.
 * @param {string} [src]
 * @param {{ preserveValues?: boolean, force?: boolean }} [opts]
 */
function syncParamsFromSource(src, opts = {}) {
  if (runtimeWarm) {
    void syncParamsFromSourceGuest(src, opts).catch((err) => {
      appendLog(`params_resolve failed: ${err.message}`);
      syncParamsFromSourceFallback(src, opts);
    });
    return;
  }
  syncParamsFromSourceFallback(src, opts);
}

function scheduleParamsResolve(source, opts = {}) {
  if (resolveTimer) clearTimeout(resolveTimer);
  resolveTimer = setTimeout(() => {
    resolveTimer = null;
    syncParamsFromSource(source, { preserveValues: true, ...opts });
  }, ANALYZE_DEBOUNCE_MS);
}

// Seed signature from initial store.
lastSchemaSig = schemaSignature(paramStore.list());
lastParamsHeaderFp = paramsHeaderFingerprint(FLANGE_SOURCE);

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./runtime-worker.js", import.meta.url), {
    type: "module",
    name: "occ-cad-runtime",
  });
  worker.onmessage = (ev) => {
    const msg = ev.data;
    const slot = pending.get(msg.id);
    if (!slot) return;
    pending.delete(msg.id);
    // cancelled: soft-success so callers can drop without throwing
    // analyze + params_resolve always resolve structured replies (soft-fail via code).
    // execute/warm/config reject on nonzero so runSource still throws hard errors.
    if (
      msg.cancelled ||
      msg.kind === "analyze" ||
      msg.kind === "params_resolve" ||
      msg.code === 0
    ) {
      slot.resolve(msg);
    } else {
      const err = new Error(msg.error || `worker code ${msg.code}`);
      /** @type {any} */ (err).diagnostics = msg.diagnostics;
      /** @type {any} */ (err).stdout = msg.stdout;
      /** @type {any} */ (err).stderr = msg.stderr;
      slot.reject(err);
    }
  };
  worker.onerror = (ev) => {
    setStatus(`Worker error: ${ev.message}`, true);
    appendLog(`worker error: ${ev.message}`);
  };
  configReady = callWorker({ kind: "config", assetBase: ASSET_BASE }).then(
    () => undefined,
  );
  configReady.catch((err) => appendLog(`config failed: ${err.message}`));
  return worker;
}

function callWorker(payload, timeoutMs = 180_000) {
  ensureWorker();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    pending.set(id, {
      resolve: (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
    worker.postMessage({ ...payload, id });
  });
}

async function ensureConfigured() {
  ensureWorker();
  if (configReady) await configReady;
}

function editorHasTextFocus() {
  return !!editor?.hasTextFocus?.();
}

async function ensureViewport() {
  if (viewport) return viewport;
  viewport = await createViewport(els.viewport, {
    grid: true,
    isEditorFocused: editorHasTextFocus,
  });
  viewport.setFrames([
    {
      id: "F_PART",
      origin: [0, 0, 0],
      axes: { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] },
    },
  ]);
  refreshGimbals();
  const grid = paramStore.get("show_grid");
  if (grid) viewport.setOptions({ grid: !!grid.value });
  return viewport;
}

function refreshGimbals() {
  if (!viewport) return;
  const bindings = paramStore
    .list()
    .filter((p) => p.frame && (p.scrub === "xform" || p.unit === "rad"));
  viewport.setGimbals(bindings, {
    onChange(name, value) {
      paramStore.set(name, value, { phase: "change" });
    },
    onCommit(name, value) {
      paramStore.set(name, value, { phase: "commit", force: true });
    },
  });
}

/**
 * @param {object} m worker mesh
 * @param {{ fit?: boolean }} [opts]
 */
async function presentMesh(m, opts = {}) {
  const vp = await ensureViewport();
  if (Array.isArray(m.bodies) && m.bodies.length) {
    vp.setBodies(m.bodies, { fit: opts.fit !== false });
  } else {
    vp.setBodies(
      [
        {
          id: m.id || "body0",
          positions: m.positions,
          normals: m.normals,
          indices: m.indices,
          color: m.color || "#00a6ff",
          bbox: m.bbox,
          volume: m.volume,
        },
      ],
      { fit: opts.fit !== false },
    );
  }
  const yaw = paramStore.get("yaw");
  if (yaw && typeof yaw.value === "number") applyYaw(yaw.value);
  const grid = paramStore.get("show_grid");
  if (grid) vp.setOptions({ grid: !!grid.value });
  refreshGimbals();
  return vp;
}

async function runAnalyze(source, opts = {}) {
  const gen = ++analyzeGen;
  const quiet = opts.quiet === true || isRunning || scheduler.busy;
  try {
    await ensureConfigured();
    if (!quiet) setStatus("Analyzing…");
    const reply = await callWorker(
      {
        kind: "analyze",
        source,
        params: paramStore.values(),
      },
      120_000,
    );
    if (gen !== analyzeGen) return;
    if (reply.cancelled) return;
    const diags = reply.diagnostics || [];
    lastAnalyzeErrors = diags.filter((d) => d.severity === "error").length;
    editor?.setAnalyzeMarkers?.(diags);
    if (!isRunning && !scheduler.busy) {
      if (lastAnalyzeErrors > 0) {
        setStatus(
          `Analyze: ${lastAnalyzeErrors} error${lastAnalyzeErrors === 1 ? "" : "s"}`,
          true,
        );
      } else if (diags.length > 0) {
        setStatus(`Analyze: ${diags.length} warning(s)`);
      } else {
        setStatus("Ready");
      }
    }
  } catch (err) {
    if (gen !== analyzeGen) return;
    appendLog(`analyze failed: ${err.message}`);
    if (!isRunning && !scheduler.busy) {
      setStatus(`Analyze unavailable: ${err.message}`, true);
    }
  }
}

function scheduleAnalyze(source) {
  if (analyzeTimer) clearTimeout(analyzeTimer);
  analyzeTimer = setTimeout(() => {
    analyzeTimer = null;
    void runAnalyze(source);
  }, ANALYZE_DEBOUNCE_MS);
}

function applyDiagnostics(diags) {
  if (!editor?.setAnalyzeMarkers) return;
  if (Array.isArray(diags) && diags.length) {
    editor.setAnalyzeMarkers(diags);
    lastAnalyzeErrors = diags.filter((d) => d.severity === "error").length;
  }
}

/**
 * @param {{ fit?: boolean, fromParams?: boolean, generation?: number, fine?: boolean }} [opts]
 */
/**
 * If this generation still owns the status line and nothing else is busy,
 * clear a stuck "Updating…" / "Running…" after cancel/stale drop.
 * @param {number} gen
 * @param {boolean} fromParams
 */
function clearStaleStatus(gen, fromParams) {
  if (!fromParams) return;
  if (gen < paramStore.generation) return; // newer rebuild owns status
  if (scheduler.busy) return;
  const t = String(els.status?.textContent || "");
  if (t === "Updating…" || t === "Running…") {
    setStatus("Ready");
  }
}

async function runSource(opts = {}) {
  if (analyzeTimer) {
    clearTimeout(analyzeTimer);
    analyzeTimer = null;
  }
  const fromParams = opts.fromParams === true;
  const gen = opts.generation ?? paramStore.generation;
  isRunning = !fromParams;

  if (els.run) els.run.disabled = true;
  setStatus(fromParams ? "Updating…" : "Running…");
  if (!fromParams) {
    els.log.textContent = "";
    els.log.hidden = true;
  }

  try {
    await ensureConfigured();
    // Scrub path: store is source of truth — never rewrite Monaco from params.
    // Editor remains the author buffer; inject happens only inside the worker.
    const source = getSource();
    // Skip analyze on rapid scrub; keep it for explicit runs.
    if (!fromParams) {
      await runAnalyze(source, { quiet: true });
    }

    if (fromParams && gen < paramStore.generation) {
      clearStaleStatus(gen, fromParams);
      return;
    }

    const deflection =
      fromParams && !opts.fine ? DEFLECTION_SCRUB : DEFLECTION_COMMIT;

    const reply = await callWorker(
      {
        kind: "execute",
        source,
        params: paramStore.values(),
        deflection,
        // Param scrub: full mesh cache + per-op shape memo. Explicit Run rebuilds cold.
        memo: fromParams === true,
      },
      300_000,
    );

    if (fromParams && gen < paramStore.generation) {
      clearStaleStatus(gen, fromParams);
      return;
    }
    // Soft success: queue superseded or mid-flight OCC abort (reason aborted).
    // Do not paint error / stale mesh — a newer execute owns the UI.
    if (reply.cancelled) {
      clearStaleStatus(gen, fromParams);
      return;
    }

    applyDiagnostics(reply.diagnostics);
    if (!reply.diagnostics?.length) editor?.clearAnalyzeMarkers?.();
    const m = reply.mesh;
    if (!m?.positions || !m?.indices) throw new Error("no mesh in reply");

    setStatus(
      `${m.vertexCount ?? m.positions.length / 3} verts · ` +
        `${((m.indexCount ?? m.indices.length) / 3) | 0} tris` +
        (m.volume != null ? ` · vol ${m.volume.toFixed(1)}` : ""),
    );
    if (els.meta) {
      els.meta.hidden = true;
      els.meta.textContent = JSON.stringify(reply.meta, null, 2);
    }
    if (reply.stdout) appendLog(reply.stdout);

    const fit = opts.fit !== undefined ? opts.fit : !fromParams || !viewport;
    await presentMesh(m, { fit });
    paramStore.markGood(gen);
    viewport?.setOptions({ stale: false });
  } catch (err) {
    applyDiagnostics(/** @type {any} */ (err).diagnostics);
    setStatus(err.message, true);
    appendLog(`error: ${err.message}`);
    const stderr = /** @type {any} */ (err).stderr;
    if (stderr) appendLog(String(stderr).trim());
    if (fromParams) {
      viewport?.setOptions({
        stale: true,
        staleMessage: "Update failed",
      });
    }
  } finally {
    isRunning = false;
    if (els.run) els.run.disabled = false;
  }
}

function onParamsChanged(params, meta = {}) {
  refreshGimbals();
  // History apply owns execute; do not re-enter project or double-schedule.
  if (historyApplying) return;
  // Do NOT rewrite Monaco on scrub — store + inject at execute time only.
  // Schema harvest replace must not record undo (replace emits phase:commit).
  if (meta.tier === "replace") {
    project.setValues(paramStore.values(), { recordUndo: false, merge: false });
  } else if (meta.tier === "reset") {
    project.setValues(paramStore.values(), { recordUndo: true, merge: false });
  } else if (meta.phase === "commit" || meta.force) {
    project.setValues(paramStore.values(), { recordUndo: true, merge: false });
  } else if (meta.phase === "change") {
    // Track live values without undo noise; checkpoint on commit.
    project.setValues(paramStore.values(), { recordUndo: false, merge: false });
  }
  // Harvest replace should not force geometry rebuild by itself — values
  // unchanged; only user scrub/reset/rebuild tiers schedule execute.
  if (meta.tier === "replace") return;
  scheduler.dispatch(params, meta, { liveRebuild: true });
}

paramStore.subscribe(onParamsChanged);

if (els.params) {
  paramSheet = mountParamSheet(els.params, paramStore, { debounceMs: 200 });
}

async function refreshHistoryPanel() {
  if (!historyPanel) return;
  let versions = [];
  try {
    versions = await project.listVersions();
  } catch {
    versions = [];
  }
  historyPanel.update({
    canUndo: project.canUndo,
    canRedo: project.canRedo,
    dirty: project.dirty,
    tip: project.tip,
    versions,
  });
}

async function handleUndo() {
  const doc = await project.undo();
  if (!doc) return;
  setStatus("Undo");
}

async function handleRedo() {
  const doc = await project.redo();
  if (!doc) return;
  setStatus("Redo");
}

async function handleSaveVersion() {
  // Overleaf/Onshape-style: name a checkpoint of the local working copy.
  const name = window.prompt(
    "Name this version",
    `Version ${new Date().toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })}`,
  );
  if (name == null) return; // cancelled
  const trimmed = name.trim();
  if (!trimmed) {
    setStatus("Version name required", true);
    return;
  }
  try {
    // Sync author buffer into project before durable (local git) commit.
    project.setSource(getSource(), { recordUndo: false });
    project.setValues(paramStore.values(), { recordUndo: false, merge: false });
    const entry = await project.commitVersion({
      name: trimmed,
      message: trimmed,
    });
    setStatus(`Version saved · ${entry.shortHash || entry.id.slice(0, 7)}`);
    await refreshHistoryPanel();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Save failed";
    setStatus(msg, true);
  }
}

async function handleRestore(id) {
  if (!id) return;
  const ok = window.confirm(
    "Restore this version to the working copy?\n\n" +
      "Source and parameters will roll back. You can Undo if you change your mind.",
  );
  if (!ok) return;
  try {
    await project.restoreVersion(id);
    setStatus("Restored version");
    await refreshHistoryPanel();
  } catch {
    setStatus("Unknown version", true);
  }
}

if (els.history) {
  historyPanel = mountHistoryPanel(els.history, {
    onUndo: () => void handleUndo(),
    onRedo: () => void handleRedo(),
    onSaveVersion: () => void handleSaveVersion(),
    onRestore: (id) => void handleRestore(id),
  });
  void refreshHistoryPanel();
}

function isEditableTarget(el) {
  if (!el || !(el instanceof Element)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (/** @type {HTMLElement} */ (el).isContentEditable) return true;
  return false;
}

// Keyboard: undo/redo when not typing in Monaco or form controls.
window.addEventListener("keydown", (ev) => {
  if (editorHasTextFocus()) return;
  if (isEditableTarget(/** @type {Element} */ (ev.target))) return;
  const mod = ev.metaKey || ev.ctrlKey;
  if (!mod) return;
  const key = ev.key.toLowerCase();
  if (key === "z" && !ev.shiftKey) {
    ev.preventDefault();
    void handleUndo();
  } else if (key === "y" || (key === "z" && ev.shiftKey)) {
    ev.preventDefault();
    void handleRedo();
  }
});

// Optional #run (removed from chrome — params live-rebuild + editor Ctrl/Cmd+Enter).
els.run?.addEventListener("click", () => {
  sourceMode = "editor";
  project.setSource(getSource(), { recordUndo: true });
  syncParamsFromSource(undefined, { preserveValues: true, force: true });
  void runSource({ fit: true, fine: true });
});

/** Background warm: first slider rebuild is already slow without this. */
async function autoWarm() {
  try {
    setStatus("Loading runtime…");
    await ensureConfigured();
    const reply = await callWorker({ kind: "warm" }, 300_000);
    runtimeWarm = true;
    // Product path re-harvest; never fail Ready if only schema path degrades.
    try {
      await syncParamsFromSourceGuest(getSource(), {
        preserveValues: true,
        force: true,
      });
    } catch (harvestErr) {
      appendLog(
        `params_resolve after warm failed: ${harvestErr instanceof Error ? harvestErr.message : String(harvestErr)}`,
      );
      syncParamsFromSourceFallback(getSource(), {
        preserveValues: true,
        force: true,
      });
    }
    setStatus(`Ready · OCCT ${reply.meta?.occVersion || "?"}`);
  } catch (err) {
    setStatus(err.message, true);
    appendLog(`error: ${err.message}`);
  }
}

function scheduleEditorCheckpoint(doc) {
  if (editorCheckpointTimer) clearTimeout(editorCheckpointTimer);
  editorCheckpointTimer = setTimeout(() => {
    editorCheckpointTimer = null;
    project.setSource(doc, { recordUndo: true });
  }, 600);
}

setStatus("Loading editor…");
mountLuauEditor({
  parent: els.editorHost,
  doc: blockHoleSource(),
  autoFocus: true,
  onRun: () => {
    sourceMode = "editor";
    project.setSource(getSource(), { recordUndo: true });
    project.setValues(paramStore.values(), { recordUndo: false, merge: false });
    syncParamsFromSource(undefined, { preserveValues: true, force: true });
    void runSource({ fit: true, fine: true });
  },
  onChange: (doc) => {
    sourceMode = "editor";
    // Debounced: sheet from source analysis; execute injects store values.
    // Do not push every keystroke onto undo — checkpoint after idle.
    project.setSource(doc, { recordUndo: false });
    scheduleEditorCheckpoint(doc);
    scheduleParamsResolve(doc);
    scheduleAnalyze(doc);
  },
})
  .then(async (handle) => {
    editor = handle;
    viewport?.setEditorFocusProbe?.(editorHasTextFocus);
    await project.open({
      source: blockHoleSource(),
      project: { name: "flange_plate", schema_version: 1 },
      values: paramStore.values(),
    });
    void autoWarm().then(() => {
      // First mesh from demo params once runtime is hot
      void runSource({ fromParams: true, fit: true, fine: true });
    });
  })
  .catch((err) => {
    setStatus(`Editor failed: ${err.message}`, true);
    appendLog(String(err.stack || err));
    const ta = document.createElement("textarea");
    ta.id = "source";
    ta.spellcheck = false;
    ta.value = blockHoleSource();
    ta.setAttribute("aria-label", "Luau source");
    els.editorHost.replaceWith(ta);
    editor = {
      getValue: () => ta.value,
      setValue: (d) => {
        ta.value = d;
      },
      focus: () => ta.focus(),
      hasTextFocus: () => document.activeElement === ta,
      destroy: () => undefined,
      setAnalyzeMarkers: () => undefined,
      clearAnalyzeMarkers: () => undefined,
    };
    ta.addEventListener("input", () => {
      sourceMode = "editor";
      project.setSource(ta.value, { recordUndo: false });
      scheduleEditorCheckpoint(ta.value);
      scheduleParamsResolve(ta.value);
      scheduleAnalyze(ta.value);
    });
    void project
      .open({
        source: blockHoleSource(),
        project: { name: "flange_plate", schema_version: 1 },
        values: paramStore.values(),
      })
      .then(() => autoWarm());
  });
