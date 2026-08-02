/**
 * resolveParams(source) — schema from Luau for the param sheet.
 *
 * Priority (first match wins per name; later only fills gaps / fields):
 *   1. Interleaved locals + trailing annotations (primary — clean for humans)
 *      local width = 40 -- [16:0.5:120] mm
 *   2. Legacy explicit: --[[params]] block, -- @param lines, P.number(...)
 *   3. Bare header locals without annotation (automagic ranges)
 *   4. seed (optional migration only)
 *
 * End users should almost never need a giant comment block.
 */

import {
  extractParams,
  extractRegistrationParams,
  mergeParams,
} from "./extract.js";
import { analyzeLuauParams } from "./luau-locals.js";
import { normalizeParam } from "./types.js";

/**
 * @param {string} source
 * @param {{ seed?: import('./types.js').Parameter[] }} [opts]
 * @returns {import('./types.js').Parameter[]}
 */
export function resolveParams(source, opts = {}) {
  const seed = (opts.seed || []).map((p) => normalizeParam(p));

  // Primary: comment-aware static analysis of header locals
  const fromLocals = analyzeLuauParams(source);

  // Legacy / advanced explicit forms (fill names not already bound as locals,
  // or merge extra metadata if same name — local annotation already applied)
  const legacy = extractParams(source);
  const registrations = extractRegistrationParams(source);
  const legacyAll = mergeParams(legacy, registrations);

  // Locals win (they're the readable source of truth). Legacy fills gaps only.
  let merged = mergeParams(fromLocals, legacyAll);

  if (seed.length) {
    merged = mergeParams(merged, seed);
  }
  if (!merged.length && seed.length) {
    return seed.map((p) => ({ ...p }));
  }
  return merged;
}
