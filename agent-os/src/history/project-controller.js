/**
 * ProjectController — document + undo + durable versions.
 *
 * Layers:
 *   A. RAM undo stack (frequent; commit/debounce end of scrub + editor)
 *   B. HistoryBackend (GitEngine when available, else IDB, else memory)
 *
 * Does not run OCC / worker. Host wires onApply → editor + store + execute.
 *
 * Undo rules:
 *   - Live scrub / keystrokes update `doc` only (no stack mutation).
 *   - recordUndo / checkpoint push the *new* snapshot; previous present → past.
 *
 * Callbacks:
 *   onDirtyChange(dirty, tip) — lightweight (badge / canUndo); scrub + undo stack
 *   onHistoryChange() — full version list; only open / commitVersion / restoreVersion
 *
 * Async history ops (open/undo/redo/restore/commit) are single-flight serialized.
 */

import { createUndoStack } from "./undo-stack.js";
import {
  cloneDoc,
  docsContentEqual,
  sanitizeProjectId,
  validateVersionName,
  validateVersionMessage,
  validateVersionRef,
} from "./backend.js";
import { createDefaultHistoryBackend } from "./opfs-backend.js";

/**
 * @typedef {import('./backend.js').WorktreeDoc} WorktreeDoc
 * @typedef {import('./backend.js').HistoryCommit} HistoryCommit
 */

/**
 * @param {{
 *   projectId?: string,
 *   backend?: import('./backend.js').HistoryBackend,
 *   historyOpts?: {
 *     assetBase?: string,
 *     engineBytes?: Uint8Array,
 *     engineUrl?: string,
 *     enginePath?: string,
 *     durableDir?: string,
 *     preferGit?: boolean,
 *   },
 *   undoLimit?: number,
 *   autosaveMs?: number,
 *   onApply?: (doc: WorktreeDoc, meta: { reason: string }) => void | Promise<void>,
 *   onDirtyChange?: (dirty: boolean, tip: HistoryCommit | null) => void,
 *   onHistoryChange?: () => void,
 * }} [opts]
 */
export function createProjectController(opts = {}) {
  const projectId = sanitizeProjectId(opts.projectId || "default");
  const backend =
    opts.backend ||
    createDefaultHistoryBackend({
      projectId,
      ...(opts.historyOpts || {}),
    });
  const undo = createUndoStack({ limit: opts.undoLimit ?? 80 });
  const autosaveMs = opts.autosaveMs ?? 1500;

  /** @type {WorktreeDoc} */
  let doc = {
    source: "",
    project: { name: "untitled", schema_version: 1 },
    meta: {},
    values: {},
  };
  /** @type {HistoryCommit | null} */
  let tipCommit = null;
  /** Tip blob content for dirty comparison (source+values). */
  /** @type {WorktreeDoc | null} */
  let tipDoc = null;
  let dirty = false;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let autosaveTimer = null;

  /** Serialize async history mutations (undo/redo/restore/commit/open). */
  /** @type {Promise<void>} */
  let historyChain = Promise.resolve();
  let historyBusy = false;

  /**
   * @template T
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  function runHistoryOp(fn) {
    const run = historyChain.then(async () => {
      historyBusy = true;
      try {
        return await fn();
      } finally {
        historyBusy = false;
      }
    });
    // Keep chain alive on rejection.
    historyChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** Lightweight: dirty badge / undo buttons — scrub + undo stack only. */
  function emitDirtyOnly() {
    opts.onDirtyChange?.(dirty, tipCommit);
  }

  /** Full version list — durable timeline changes only. */
  function emitHistory() {
    opts.onDirtyChange?.(dirty, tipCommit);
    opts.onHistoryChange?.();
  }

  /** Overleaf-style auto checkpoint label (time-based, not a user name). */
  function autoVersionMessage(reason) {
    const t = new Date().toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const r = reason ? String(reason) : "edit";
    return `auto · ${t} · ${r}`;
  }

  function snapshotFromDoc() {
    return {
      source: doc.source,
      values: { ...(doc.values || {}) },
      ts: Date.now(),
    };
  }

  function recomputeDirty() {
    if (!tipDoc) {
      dirty = true;
      return;
    }
    dirty = !docsContentEqual(doc, tipDoc);
  }

  /**
   * Load tip blob without mutating worktree.
   * @param {HistoryCommit | null} tip
   * @returns {Promise<WorktreeDoc | null>}
   */
  async function loadTipDoc(tip) {
    if (!tip?.id) return null;
    if (typeof backend.readVersion !== "function") return null;
    try {
      return await backend.readVersion(projectId, tip.id);
    } catch {
      return null;
    }
  }

  function scheduleAutosave() {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      autosaveTimer = null;
      void flushAutosave();
    }, autosaveMs);
  }

  async function flushAutosave() {
    try {
      await backend.saveWorktree(projectId, doc);
    } catch {
      /* non-fatal */
    }
  }

  return {
    get projectId() {
      return projectId;
    },
    get backendKind() {
      return backend.kind;
    },
    /** Underlying HistoryBackend (may expose remote ops when kind === "git"). */
    get backend() {
      return backend;
    },
    get dirty() {
      return dirty;
    },
    get canUndo() {
      return undo.canUndo;
    },
    get canRedo() {
      return undo.canRedo;
    },
    get tip() {
      return tipCommit;
    },
    get historyBusy() {
      return historyBusy;
    },
    get document() {
      return cloneDoc(doc);
    },
    get source() {
      return doc.source;
    },
    get values() {
      return { ...(doc.values || {}) };
    },

    /**
     * Open project: hydrate worktree from backend or seed.
     * @param {WorktreeDoc} [seed]
     */
    async open(seed) {
      return runHistoryOp(async () => {
        let loaded = null;
        try {
          loaded = await backend.open(projectId);
        } catch {
          loaded = null;
        }
        doc = cloneDoc(loaded || seed || doc);
        undo.reset(snapshotFromDoc());
        try {
          tipCommit = await backend.tip(projectId);
        } catch {
          tipCommit = null;
        }
        // tipDoc from tip *blob*, not worktree — dirty if worktree ≠ tip.
        tipDoc = await loadTipDoc(tipCommit);
        if (tipDoc) {
          dirty = !docsContentEqual(doc, tipDoc);
        } else {
          // No tip version yet: clean if we loaded a saved worktree, else dirty seed.
          dirty = !loaded;
        }
        await opts.onApply?.(cloneDoc(doc), { reason: "open" });

        // Seed timeline: if no durable versions yet, write an auto checkpoint
        // so History is never empty after first open (Overleaf always has points).
        let existing = [];
        try {
          existing = (await backend.listVersions(projectId)) || [];
        } catch {
          existing = [];
        }
        if (!existing.length && (doc.source || Object.keys(doc.values || {}).length)) {
          try {
            const message = autoVersionMessage("open");
            const entry = await backend.commit(projectId, doc, { message });
            if (entry) {
              entry.auto = true;
              if (!entry.name) entry.name = undefined;
              tipCommit = entry;
              tipDoc = cloneDoc(doc);
              dirty = false;
            }
          } catch (err) {
            if (typeof console !== "undefined" && console.warn) {
              console.warn(
                "[history] seed auto-commit failed:",
                err instanceof Error ? err.message : err,
              );
            }
          }
        }

        emitHistory();
        return cloneDoc(doc);
      });
    },

    /**
     * Author buffer source change (editor).
     * @param {string} source
     * @param {{ recordUndo?: boolean }} [o]
     */
    setSource(source, o = {}) {
      const next = String(source ?? "");
      if (next === doc.source) {
        if (o.recordUndo) {
          undo.push(snapshotFromDoc());
          emitDirtyOnly();
        }
        return;
      }
      doc = cloneDoc({ ...doc, source: next });
      recomputeDirty();
      if (o.recordUndo) {
        undo.push(snapshotFromDoc());
        scheduleAutosave();
      }
      // Undo-stack-only / live edit: never listVersions.
      emitDirtyOnly();
    },

    /**
     * Param values map (store is source of truth while scrubbing).
     * @param {Record<string, any>} values
     * @param {{ recordUndo?: boolean, merge?: boolean }} [o]
     */
    setValues(values, o = {}) {
      const next =
        o.merge === false
          ? { ...(values || {}) }
          : { ...(doc.values || {}), ...(values || {}) };
      doc = cloneDoc({ ...doc, values: next });
      recomputeDirty();
      if (o.recordUndo) {
        undo.push(snapshotFromDoc());
        scheduleAutosave();
      }
      emitDirtyOnly();
    },

    /**
     * Push current doc onto undo stack (end of scrub / idle).
     * @param {string} [label]
     */
    checkpoint(label) {
      const pushed = undo.push({
        ...snapshotFromDoc(),
        label: label || "edit",
      });
      if (pushed) {
        recomputeDirty();
        scheduleAutosave();
        emitDirtyOnly();
      }
      return pushed;
    },

    /**
     * Apply an edit that may include source and/or values.
     * @param {Partial<WorktreeDoc>} patch
     * @param {{ recordUndo?: boolean, reason?: string }} [o]
     */
    async applyEdit(patch, o = {}) {
      return runHistoryOp(async () => {
        const next = cloneDoc({
          ...doc,
          ...patch,
          values: patch.values
            ? { ...(doc.values || {}), ...patch.values }
            : doc.values,
          project: patch.project
            ? { ...(doc.project || {}), ...patch.project }
            : doc.project,
        });
        doc = next;
        recomputeDirty();
        if (o.recordUndo !== false) {
          undo.push(snapshotFromDoc());
        }
        await opts.onApply?.(cloneDoc(doc), { reason: o.reason || "edit" });
        scheduleAutosave();
        emitDirtyOnly();
        return cloneDoc(doc);
      });
    },

    async undo() {
      return runHistoryOp(async () => {
        const snap = undo.undo();
        if (!snap) return null;
        doc = cloneDoc({
          ...doc,
          source: snap.source,
          values: snap.values || {},
        });
        recomputeDirty();
        await opts.onApply?.(cloneDoc(doc), { reason: "undo" });
        scheduleAutosave();
        emitDirtyOnly();
        return cloneDoc(doc);
      });
    },

    async redo() {
      return runHistoryOp(async () => {
        const snap = undo.redo();
        if (!snap) return null;
        doc = cloneDoc({
          ...doc,
          source: snap.source,
          values: snap.values || {},
        });
        recomputeDirty();
        await opts.onApply?.(cloneDoc(doc), { reason: "redo" });
        scheduleAutosave();
        emitDirtyOnly();
        return cloneDoc(doc);
      });
    },

    /**
     * Durable version checkpoint (named label and/or auto history point).
     * @param {{ name?: string, message?: string, auto?: boolean }} [o]
     */
    async commitVersion(o = {}) {
      return runHistoryOp(async () => {
        // Explicit empty name (e.g. "   ") is an error; omit name for auto.
        let name;
        if (o.name != null) {
          const trimmed = String(o.name).trim();
          if (trimmed === "") {
            throw new Error("version name must not be empty");
          }
          name = validateVersionName(trimmed, true);
        }
        const message = validateVersionMessage(
          o.message ||
            name ||
            (o.auto ? autoVersionMessage() : "checkpoint"),
        );
        undo.push(snapshotFromDoc());
        const entry = await backend.commit(projectId, doc, {
          name,
          message,
        });
        // Tag auto points for the timeline (backend may only store name/message).
        if (o.auto && entry && !entry.name) {
          entry.auto = true;
        }
        tipCommit = entry;
        tipDoc = cloneDoc(doc);
        dirty = false;
        emitHistory();
        return entry;
      });
    },

    /**
     * Overleaf-style automatic history: if the working copy differs from tip,
     * create a durable checkpoint. No-op when already clean / equal.
     * Coalesce at the host (debounce) — call after scrub commit / editor idle.
     * @param {{ reason?: string }} [o]
     * @returns {Promise<HistoryCommit | null>}
     */
    async autoCommit(o = {}) {
      return runHistoryOp(async () => {
        recomputeDirty();
        if (!dirty && tipDoc && docsContentEqual(doc, tipDoc)) {
          return null;
        }
        // First edit with no tip yet, or dirty vs tip.
        if (tipDoc && docsContentEqual(doc, tipDoc)) {
          dirty = false;
          return null;
        }
        const reason = o.reason || "edit";
        const message = autoVersionMessage(reason);
        undo.push(snapshotFromDoc());
        const entry = await backend.commit(projectId, doc, {
          message,
        });
        if (entry) entry.auto = true;
        tipCommit = entry;
        tipDoc = cloneDoc(doc);
        dirty = false;
        emitHistory();
        return entry;
      });
    },

    async listVersions() {
      return backend.listVersions(projectId);
    },

    /**
     * Restore durable version. Pre-restore is pushed onto undo only after
     * backend.restore succeeds so failed restore does not pollute the stack.
     * @param {string} ref
     */
    async restoreVersion(ref) {
      return runHistoryOp(async () => {
        const refId = validateVersionRef(ref);
        // Capture pre-restore snapshot without mutating undo yet.
        const preRestore = snapshotFromDoc();
        const restored = await backend.restore(projectId, refId);
        // Success: record pre-restore then restored as present.
        undo.push(preRestore);
        doc = cloneDoc(restored);
        undo.push(snapshotFromDoc());

        try {
          tipCommit = await backend.tip(projectId);
        } catch {
          /* keep */
        }
        // Always refresh tipDoc from tip blob, then recompute dirty.
        tipDoc = (await loadTipDoc(tipCommit)) || tipDoc;
        if (tipDoc) {
          recomputeDirty();
        } else if (tipCommit && refId === tipCommit.id) {
          tipDoc = cloneDoc(doc);
          dirty = false;
        } else {
          dirty = true;
        }

        await opts.onApply?.(cloneDoc(doc), { reason: "restore" });
        scheduleAutosave();
        emitHistory();
        return cloneDoc(doc);
      });
    },

    async flush() {
      if (autosaveTimer) {
        clearTimeout(autosaveTimer);
        autosaveTimer = null;
      }
      await flushAutosave();
    },

    dispose() {
      if (autosaveTimer) clearTimeout(autosaveTimer);
      autosaveTimer = null;
    },
  };
}
