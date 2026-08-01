/**
 * Host-owned parameter store (REACTIVITY.md).
 * Pure state — no three, no worker. Eval scheduling is eval/scheduler.js.
 */

import { normalizeParam, clampParam } from "./types.js";

/**
 * @param {import('./types.js').Parameter[]} [initial]
 */
export function createParamStore(initial = []) {
  /** @type {import('./types.js').Parameter[]} */
  let params = initial.map(normalizeParam);
  /** @type {Set<Function>} */
  const listeners = new Set();
  let liveRebuild = false;
  let generation = 0;
  let goodGeneration = 0;

  function snapshot() {
    return params.map((p) => ({
      ...p,
      options: p.options ? [...p.options] : undefined,
    }));
  }

  function emit(meta = {}) {
    const snap = snapshot();
    for (const fn of listeners) fn(snap, meta);
  }

  return {
    /** Immutable-ish snapshot of all parameters. */
    list: snapshot,

    get(name) {
      return params.find((p) => p.name === name);
    },

    values() {
      /** @type {Record<string, any>} */
      const o = {};
      for (const p of params) o[p.name] = p.value;
      return o;
    },

    /**
     * Replace entire param list (e.g. after extract).
     * @param {import('./types.js').Parameter[]} list
     */
    replace(list) {
      params = list.map(normalizeParam);
      generation++;
      emit({ tier: "replace", phase: "commit", generation });
    },

    /**
     * Set one value.
     * @param {string} name
     * @param {any} value
     * @param {{ phase?: 'change'|'commit', force?: boolean }} [meta]
     */
    set(name, value, meta = {}) {
      const i = params.findIndex((p) => p.name === name);
      if (i < 0) return;
      const p = params[i];
      const next = clampParam(p, value);
      if (next === p.value && meta.force !== true) return;
      params[i] = { ...p, value: next };
      const tier = p.scrub || "rebuild";
      if (tier === "rebuild" && (meta.phase === "commit" || meta.force)) {
        generation++;
      }
      emit({ name, tier, generation, ...meta });
    },

    /** Force a rebuild commit (Apply / Live on). */
    requestRebuild() {
      generation++;
      emit({ tier: "rebuild", phase: "commit", force: true, generation });
    },

    /**
     * Reset one param or all to defaultValue.
     * @param {string} [name]
     */
    reset(name) {
      if (name) {
        const p = params.find((x) => x.name === name);
        if (p) this.set(name, p.defaultValue, { phase: "commit", force: true });
        return;
      }
      params = params.map((p) => ({ ...p, value: p.defaultValue }));
      generation++;
      emit({ tier: "reset", phase: "commit", generation });
    },

    get liveRebuild() {
      return liveRebuild;
    },
    setLiveRebuild(v) {
      liveRebuild = !!v;
    },

    get generation() {
      return generation;
    },
    get goodGeneration() {
      return goodGeneration;
    },
    markGood(gen) {
      if (gen == null) goodGeneration = generation;
      else goodGeneration = gen;
    },
    get isStale() {
      return goodGeneration < generation;
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
