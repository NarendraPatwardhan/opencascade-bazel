/**
 * In-memory undo/redo ring for document snapshots (source + param values).
 * Pure JS — no browser APIs. Scrub ticks should not push every change;
 * call push on commit / debounced editor change / named version only.
 */

/**
 * @typedef {{ source: string, values: Record<string, any>, label?: string, ts?: number }} DocSnapshot
 */

/**
 * @param {{ limit?: number }} [opts]
 */
export function createUndoStack(opts = {}) {
  const limit = Math.max(2, opts.limit ?? 80);
  /** @type {DocSnapshot[]} */
  let past = [];
  /** @type {DocSnapshot[]} */
  let future = [];
  /** @type {DocSnapshot | null} */
  let present = null;

  /**
   * @param {DocSnapshot} snap
   * @returns {DocSnapshot}
   */
  function clone(snap) {
    return {
      source: String(snap.source ?? ""),
      values: { ...(snap.values || {}) },
      label: snap.label,
      ts: snap.ts ?? Date.now(),
    };
  }

  /**
   * @param {DocSnapshot} a
   * @param {DocSnapshot} b
   */
  function equal(a, b) {
    if (!a || !b) return false;
    if (a.source !== b.source) return false;
    const ak = Object.keys(a.values || {});
    const bk = Object.keys(b.values || {});
    if (ak.length !== bk.length) return false;
    for (const k of ak) {
      if (a.values[k] !== b.values[k]) return false;
    }
    return true;
  }

  return {
    get canUndo() {
      return past.length > 0;
    },
    get canRedo() {
      return future.length > 0;
    },
    get depth() {
      return past.length;
    },
    get present() {
      return present ? clone(present) : null;
    },

    /**
     * Seed present without creating undo entries (open / restore).
     * @param {DocSnapshot} snap
     */
    reset(snap) {
      present = clone(snap);
      past = [];
      future = [];
    },

    /**
     * Push a new present state. No-ops if equal to current present.
     * Clears redo stack.
     * @param {DocSnapshot} snap
     * @returns {boolean} true if pushed
     */
    push(snap) {
      const next = clone(snap);
      if (present && equal(present, next)) return false;
      if (present) {
        past.push(present);
        while (past.length > limit) past.shift();
      }
      present = next;
      future = [];
      return true;
    },

    /**
     * Replace present without recording (e.g. live scrub tracking for dirty).
     * Does not touch past/future.
     * @param {DocSnapshot} snap
     */
    replacePresent(snap) {
      present = clone(snap);
    },

    /**
     * @returns {DocSnapshot | null}
     */
    undo() {
      if (!past.length || !present) return null;
      future.push(present);
      present = past.pop() ?? null;
      return present ? clone(present) : null;
    },

    /**
     * @returns {DocSnapshot | null}
     */
    redo() {
      if (!future.length || !present) return null;
      past.push(present);
      while (past.length > limit) past.shift();
      present = future.pop() ?? null;
      return present ? clone(present) : null;
    },

    /** Test / debug. */
    _debug() {
      return {
        past: past.length,
        future: future.length,
        present: present ? clone(present) : null,
      };
    },
  };
}
