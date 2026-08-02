/**
 * Tiered eval scheduler (REACTIVITY §4).
 *
 * view    → sync onView
 * xform   → sync onXform
 * rebuild → debounced async onRebuild; generation-stamped (stale drops)
 */

/**
 * @param {{
 *   onView?: (params: object[], meta: object) => void,
 *   onXform?: (params: object[], meta: object) => void,
 *   onRebuild?: (params: object[], meta: object) => Promise<void>,
 *   debounceMs?: number,
 *   getLiveRebuild?: () => boolean,
 * }} opts
 */
export function createScheduler(opts = {}) {
  const debounceMs = opts.debounceMs ?? 200;
  /** @type {ReturnType<typeof setTimeout>|null} */
  let timer = null;
  /** @type {Promise<void>|null} */
  let inflight = null;
  let inflightGen = -1;
  let pendingGen = -1;
  /** @type {object[]|null} */
  let pendingParams = null;
  /** @type {object} */
  let pendingMeta = {};
  let disposed = false;

  function clearTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  /**
   * @param {object[]} params
   * @param {{ tier?: string, phase?: string, generation?: number, name?: string, force?: boolean }} meta
   * @param {{ liveRebuild?: boolean }} [ctx]
   */
  function dispatch(params, meta = {}, ctx = {}) {
    if (disposed) return;
    const tier = meta.tier || "rebuild";

    if (tier === "view") {
      opts.onView?.(params, meta);
      return;
    }
    if (tier === "xform") {
      opts.onXform?.(params, meta);
      return;
    }

    const live = ctx.liveRebuild ?? opts.getLiveRebuild?.() ?? false;

    // Scrub without Live: store already updated; wait for Apply / commit.
    if (meta.phase === "change" && !live && !meta.force) {
      return;
    }

    pendingParams = params;
    pendingMeta = meta;
    pendingGen = meta.generation ?? pendingGen + 1;

    clearTimer();
    const delay =
      meta.force || meta.phase === "commit"
        ? Math.min(debounceMs, 50)
        : debounceMs;
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, delay);
  }

  async function flush() {
    if (disposed || !pendingParams) return;
    const params = pendingParams;
    const meta = { ...pendingMeta };
    const gen = pendingGen;
    pendingParams = null;

    if (inflight) {
      try {
        await inflight;
      } catch {
        /* previous error already handled by caller */
      }
    }

    if (pendingParams && pendingGen > gen) return;

    const run = async () => {
      inflightGen = gen;
      await opts.onRebuild?.(params, { ...meta, generation: gen });
    };

    inflight = run().finally(() => {
      if (inflightGen === gen) inflight = null;
    });
    await inflight;
  }

  async function flushNow() {
    clearTimer();
    await flush();
  }

  /**
   * Drop pending rebuilds (e.g. before history restore/undo applies a new
   * generation). In-flight work still finishes but is stamped stale by gen.
   */
  function cancel() {
    clearTimer();
    pendingParams = null;
    pendingMeta = {};
    pendingGen = -1;
  }

  function dispose() {
    disposed = true;
    clearTimer();
    pendingParams = null;
  }

  return {
    dispatch,
    flush: flushNow,
    cancel,
    dispose,
    get busy() {
      return !!inflight || !!timer;
    },
    get inflightGen() {
      return inflightGen;
    },
  };
}
