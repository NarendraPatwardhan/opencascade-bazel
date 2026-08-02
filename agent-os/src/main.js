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
import { applyParamValuesToSource } from "./params/luau-locals.js";
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
  historyTrigger: document.querySelector("#history-trigger"),
  historyTriggerTip: document.querySelector("#history-trigger-tip"),
  historyOverlay: document.querySelector("#history-overlay"),
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

// Local timeline: IDB primary + optional GitEngine dual-write (see opfs-backend).
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
    // Drop pending scrub rebuilds / auto-checkpoints so they cannot re-apply
    // pre-restore values after this apply completes.
    try {
      scheduler.cancel?.();
    } catch {
      /* scheduler may not exist yet during early open */
    }
    if (autoVersionTimer) {
      clearTimeout(autoVersionTimer);
      autoVersionTimer = null;
    }
    if (resolveTimer) {
      clearTimeout(resolveTimer);
      resolveTimer = null;
    }
    try {
      const isHistoryMove =
        meta.reason === "undo" ||
        meta.reason === "redo" ||
        meta.reason === "restore" ||
        meta.reason === "clear";

      // Replay checkpoint values into the author buffer so Monaco matches the
      // store (scrub path otherwise leaves old literals in the editor).
      let bufferSource =
        doc.source != null ? String(doc.source) : getSource();
      if (isHistoryMove && doc.values && typeof doc.values === "object") {
        bufferSource = applyParamValuesToSource(bufferSource, doc.values);
      }

      const prevSource = editor ? editor.getValue() : getSource();
      const sourceChanged = String(bufferSource) !== String(prevSource);
      if (editor && sourceChanged) {
        editor.setValue(bufferSource, { silent: true });
      }
      // Keep project doc.source in sync with rewritten buffer without clearing
      // alignedVersionId (restore just set it).
      if (isHistoryMove && sourceChanged) {
        project.setSource(bufferSource, {
          recordUndo: false,
          keepAligned: true,
        });
      }
      sourceMode = "editor";

      // When source structure changed, re-harvest schema then overlay values.
      if (isHistoryMove && sourceChanged && meta.reason !== "clear") {
        try {
          if (runtimeWarm) {
            await syncParamsFromSourceGuest(bufferSource, {
              preserveValues: false,
              force: true,
            });
          } else {
            syncParamsFromSourceFallback(bufferSource, {
              preserveValues: false,
              force: true,
            });
          }
        } catch {
          syncParamsFromSourceFallback(bufferSource, {
            preserveValues: false,
            force: true,
          });
        }
      }

      // Apply checkpoint values into the store (param-only restore needs this
      // even when source text is unchanged).
      const vals = doc.values || {};
      const hasCheckpointValues = Object.keys(vals).length > 0;
      if (isHistoryMove && !hasCheckpointValues) {
        // Old checkpoints may lack a values map — re-harvest from source so
        // we never keep pre-restore scrub numbers.
        syncParamsFromSourceFallback(bufferSource, {
          preserveValues: false,
          force: true,
        });
      } else {
        const list = paramStore.list().map((p) =>
          Object.prototype.hasOwnProperty.call(vals, p.name)
            ? { ...p, value: vals[p.name] }
            : // Missing key in a sparse checkpoint: fall back to defaultValue
              // (not the pre-restore live value).
              isHistoryMove
              ? { ...p, value: p.defaultValue }
              : p,
        );
        if (list.length) {
          paramStore.replace(list);
          lastSchemaSig = schemaSignature(list);
        }
      }
      // Force sheet controls to the restored numbers (full remount is cheap here).
      try {
        paramSheet?.render?.();
      } catch {
        /* sheet may not expose render */
      }

      // Keep project.values aligned with the store (restore blob + sheet).
      if (isHistoryMove) {
        project.setValues(paramStore.values(), {
          recordUndo: false,
          merge: false,
          keepAligned: true,
        });
      }

      if (isHistoryMove) {
        // clear: handleClearDocument runs execute after harvest; skip double run
        if (meta.reason === "clear") return;
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
  // Lightweight: app-bar chip + drawer badges only (no listVersions).
  onDirtyChange(dirty, tip) {
    updateHistoryTrigger({ dirty, tip });
    historyPanel?.update({
      canUndo: project.canUndo,
      canRedo: project.canRedo,
      dirty,
      tip,
      alignedVersionId: project.alignedVersionId,
      versions: undefined,
      badgeOnly: true,
    });
  },
  // Full list when drawer open / version save / restore.
  onHistoryChange() {
    void refreshHistoryPanel({ full: isHistoryOpen() });
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
  if (!els.status) return;
  els.status.textContent = t;
  els.status.dataset.error = isError ? "1" : "0";
  if (t) els.status.removeAttribute("data-empty");
  else els.status.setAttribute("data-empty", "1");
}

/** User-facing log: drop host result markers and empty noise. */
function appendLog(line) {
  if (!els.log) return;
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
  if (!fromParams && els.log) {
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
    // Overleaf-style: settled edit → durable auto history point.
    scheduleAutoVersion("params");
  } else if (meta.phase === "commit" || meta.force) {
    project.setValues(paramStore.values(), { recordUndo: true, merge: false });
    // End of scrub / Apply — not every slider tick.
    scheduleAutoVersion("params");
  } else if (meta.phase === "change") {
    // Live scrub: track values only; history commits when scrub ends (commit).
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

/**
 * Compact app-bar chip (always visible). Full list only when drawer is open.
 * @param {{ dirty?: boolean, tip?: any }} state
 */
function updateHistoryTrigger(state = {}) {
  const tipEl = els.historyTriggerTip;
  const btn = els.historyTrigger;
  if (!tipEl || !btn) return;
  const dirty = state.dirty ?? project.dirty;
  const tip = state.tip !== undefined ? state.tip : project.tip;
  btn.dataset.dirty = dirty ? "1" : "0";
  if (dirty) {
    tipEl.textContent = "Edited";
    tipEl.title =
      "Working copy differs from last checkpoint (auto-history will catch up after you settle)";
  } else if (tip?.name || tip?.message) {
    const label = tip.name || tip.message;
    tipEl.textContent = label;
    tipEl.title = tip.shortHash ? `${label} (${tip.shortHash})` : label;
  } else if (tip?.shortHash) {
    tipEl.textContent = tip.shortHash;
    tipEl.title = "Latest local version";
  } else {
    tipEl.textContent = "Working copy";
    tipEl.title = "No versions yet — open History to save one";
  }
}

function isHistoryOpen() {
  return !!els.historyOverlay && !els.historyOverlay.hidden;
}

function openHistoryDrawer() {
  if (!els.historyOverlay) return;
  els.historyOverlay.hidden = false;
  els.historyOverlay.setAttribute("aria-hidden", "false");
  els.historyTrigger?.setAttribute("aria-expanded", "true");
  void refreshHistoryPanel({ full: true });
  // Focus close after paint so Esc handlers and AT work.
  requestAnimationFrame(() => historyPanel?.focusClose?.());
}

function closeHistoryDrawer() {
  if (!els.historyOverlay) return;
  els.historyOverlay.hidden = true;
  els.historyOverlay.setAttribute("aria-hidden", "true");
  els.historyTrigger?.setAttribute("aria-expanded", "false");
  els.historyTrigger?.focus?.();
}

function toggleHistoryDrawer() {
  if (isHistoryOpen()) closeHistoryDrawer();
  else openHistoryDrawer();
}

/**
 * @param {{ full?: boolean }} [opts] full=true rebuilds version list (open drawer)
 */
async function refreshHistoryPanel(opts = {}) {
  const full = opts.full === true || isHistoryOpen();
  updateHistoryTrigger({ dirty: project.dirty, tip: project.tip });
  if (!historyPanel) return;
  if (!full) {
    // Scrub path: badge-only inside drawer if it happens to be open.
    historyPanel.update({
      canUndo: project.canUndo,
      canRedo: project.canRedo,
      dirty: project.dirty,
      tip: project.tip,
      alignedVersionId: project.alignedVersionId,
      badgeOnly: true,
    });
    return;
  }
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
    alignedVersionId: project.alignedVersionId,
    versions,
  });
  updateHistoryTrigger({ dirty: project.dirty, tip: project.tip });
}

/** Debounce auto history points (Overleaf-style continuous history). */
/** @type {ReturnType<typeof setTimeout> | null} */
let autoVersionTimer = null;
const AUTO_VERSION_MS = 900;

/**
 * Schedule a durable auto-checkpoint after the user settles (scrub end / idle).
 * @param {string} [reason]
 */
function scheduleAutoVersion(reason = "edit") {
  if (autoVersionTimer) clearTimeout(autoVersionTimer);
  autoVersionTimer = setTimeout(() => {
    autoVersionTimer = null;
    void flushAutoVersion(reason);
  }, AUTO_VERSION_MS);
}

/**
 * @param {string} [reason]
 */
async function flushAutoVersion(reason = "edit") {
  try {
    // Keep document in sync with author buffer + store before committing.
    project.setSource(getSource(), { recordUndo: false });
    project.setValues(paramStore.values(), {
      recordUndo: false,
      merge: false,
    });
    const entry = await project.autoCommit({ reason });
    if (entry) {
      // Quiet status — history builds like Overleaf without modal noise.
      if (isHistoryOpen()) await refreshHistoryPanel({ full: true });
      else updateHistoryTrigger({ dirty: project.dirty, tip: project.tip });
    }
  } catch (err) {
    // Auto history must never break editing; log softly.
    appendLog(
      `auto history: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function handleUndo() {
  const doc = await project.undo();
  if (!doc) return;
  setStatus("Undo");
  // Do not auto-commit undos — that pollutes Overleaf-style history.
}

async function handleRedo() {
  const doc = await project.redo();
  if (!doc) return;
  setStatus("Redo");
}

/**
 * Named label for the current working copy (in-drawer form — never prompt).
 * @param {string} name
 */
async function handleLabelVersion(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) {
    setStatus("Label required", true);
    return;
  }
  try {
    project.setSource(getSource(), { recordUndo: false });
    project.setValues(paramStore.values(), {
      recordUndo: false,
      merge: false,
    });
    const entry = await project.commitVersion({
      name: trimmed,
      message: trimmed,
    });
    setStatus(`Labeled · ${entry.shortHash || entry.id.slice(0, 7)}`);
    await refreshHistoryPanel({ full: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Label failed";
    setStatus(msg, true);
  }
}

/**
 * Restore after in-panel confirm (never window.confirm).
 * @param {string} id
 */
async function handleRestore(id) {
  if (!id) return;
  try {
    await project.restoreVersion(id);
    setStatus("Restored");
    await refreshHistoryPanel({ full: true });
  } catch {
    setStatus("Unknown version", true);
  }
}

/** Wipe history + reset to demo flange seed (in-panel confirm). */
async function handleClearDocument() {
  try {
    const seed = {
      source: blockHoleSource(),
      project: { name: "flange_plate", schema_version: 1 },
      values: {},
      meta: {},
    };
    await project.clearDocument(seed);
    // Re-harvest params from demo source after wipe.
    try {
      if (runtimeWarm) {
        await syncParamsFromSourceGuest(seed.source, {
          preserveValues: false,
          force: true,
        });
      } else {
        syncParamsFromSourceFallback(seed.source, {
          preserveValues: false,
          force: true,
        });
      }
    } catch {
      syncParamsFromSourceFallback(seed.source, {
        preserveValues: false,
        force: true,
      });
    }
    // Apply defaults from harvest into project + execute.
    project.setValues(paramStore.values(), {
      recordUndo: false,
      merge: false,
    });
    await runSource({ fromParams: true, fit: true, fine: true });
    setStatus("History cleared · demo reset");
    await refreshHistoryPanel({ full: true });
  } catch (err) {
    setStatus(err instanceof Error ? err.message : "Clear failed", true);
  }
}

if (els.history) {
  historyPanel = mountHistoryPanel(els.history, {
    onUndo: () => void handleUndo(),
    onRedo: () => void handleRedo(),
    onLabelVersion: (name) => handleLabelVersion(name),
    onRestore: (id) => handleRestore(id),
    onClear: () => handleClearDocument(),
    onClose: () => closeHistoryDrawer(),
  });
  // Drawer closed by default — only keep the app-bar chip live.
  void refreshHistoryPanel({ full: false });
}

// Persist worktree on leave (autosave window).
window.addEventListener("pagehide", () => {
  void project.flush?.();
});
window.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") void project.flush?.();
});

els.historyTrigger?.addEventListener("click", () => {
  toggleHistoryDrawer();
});

els.historyOverlay?.querySelectorAll("[data-history-close]").forEach((el) => {
  el.addEventListener("click", () => closeHistoryDrawer());
});

function isEditableTarget(el) {
  if (!el || !(el instanceof Element)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (/** @type {HTMLElement} */ (el).isContentEditable) return true;
  return false;
}

// Keyboard: Esc closes history; undo/redo when not typing in Monaco or forms.
window.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && isHistoryOpen()) {
    ev.preventDefault();
    closeHistoryDrawer();
    return;
  }
  if (editorHasTextFocus()) return;
  if (isEditableTarget(/** @type {Element} */ (ev.target))) return;
  const mod = ev.metaKey || ev.ctrlKey;
  if (!mod) return;
  const key = ev.key.toLowerCase();
  // Ctrl/Cmd+H — open local history (avoid browser history hijack when focused in app)
  if (key === "h" && !ev.shiftKey && !ev.altKey) {
    ev.preventDefault();
    openHistoryDrawer();
    return;
  }
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
    // Overleaf-style: settled code edit → durable auto history point.
    scheduleAutoVersion("code");
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
    // Refresh history chip after seed auto-checkpoint (open).
    void refreshHistoryPanel({ full: isHistoryOpen() });
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
