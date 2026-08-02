/**
 * resolveParams — schema from Luau for the param sheet.
 *
 * Product path (VM warm / CadEngine):
 *   guest require("syntax") + batteries/params_resolve.luau → POD array
 *   host merges seed + optional legacy fill; no JS Luau parse as truth
 *
 * Fallback (cold UI, unit tests without loom):
 *   host-side line walk in luau-locals.js (degraded; not product truth)
 *
 * Authoring (end users):
 *   -- [Size]
 *   local width = 40 -- [16:0.5:120] mm
 *
 * Priority when merging layers (first match wins per name; later fills gaps):
 *   1. Guest POD locals (or JS fallback analyzeLuauParams)
 *   2. Legacy explicit: --[[params]] block, -- @param lines, P.number(...)
 *   3. seed (optional migration only)
 */

import { extractParams, mergeParams } from "./extract.js";
import { analyzeLuauParams } from "./luau-locals.js";
import { normalizeParam } from "./types.js";

/**
 * Normalize a POD param list from guest (or any plain objects) into Parameter[].
 * @param {any[]} pods
 * @returns {import('./types.js').Parameter[]}
 */
export function normalizeParamPods(pods) {
  if (!Array.isArray(pods)) return [];
  return pods
    .filter((p) => p && typeof p === "object" && typeof p.name === "string")
    .map((p) => normalizeParam(p));
}

/**
 * Merge guest/primary locals with legacy extractors + optional seed.
 * @param {import('./types.js').Parameter[]} fromLocals
 * @param {string} source
 * @param {{ seed?: import('./types.js').Parameter[] }} [opts]
 * @returns {import('./types.js').Parameter[]}
 */
export function mergeParamLayers(fromLocals, source, opts = {}) {
  const seed = (opts.seed || []).map((p) => normalizeParam(p));
  // extractParams covers --[[params]], @param lines, and P.number / params.* calls.
  const legacy = extractParams(source || "");

  // Locals win (readable source of truth). Legacy fills gaps only.
  let merged = mergeParams(fromLocals, legacy);

  if (seed.length) {
    merged = mergeParams(merged, seed);
  }
  if (!merged.length && seed.length) {
    return seed.map((p) => ({ ...p }));
  }
  return merged;
}

/**
 * Synchronous resolve — **degraded / unit-test / cold-UI** path.
 * Uses host-side luau-locals.js (not product truth when VM is warm).
 *
 * Prefer `resolveParamsFromPods` + worker `params_resolve` in the product UI.
 *
 * @param {string} source
 * @param {{ seed?: import('./types.js').Parameter[] }} [opts]
 * @returns {import('./types.js').Parameter[]}
 */
export function resolveParams(source, opts = {}) {
  const fromLocals = analyzeLuauParams(source || "");
  return mergeParamLayers(fromLocals, source || "", opts);
}

/**
 * Product path: build Parameter[] from guest POD (syntax harvest).
 * @param {any[]} pods  pure POD from params_resolve battery
 * @param {string} source  original source (legacy gap-fill only)
 * @param {{ seed?: import('./types.js').Parameter[] }} [opts]
 * @returns {import('./types.js').Parameter[]}
 */
export function resolveParamsFromPods(pods, source, opts = {}) {
  const fromLocals = normalizeParamPods(pods);
  return mergeParamLayers(fromLocals, source || "", opts);
}
