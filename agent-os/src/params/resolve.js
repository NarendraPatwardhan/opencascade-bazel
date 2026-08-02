/**
 * Single pipeline: schema from Luau source.
 *
 * resolveParams(source, { seed? }) → Parameter[]
 *
 * Merge priority:
 *   1. Explicit (Tier 0): --[[params]], -- @param, P.number / params.number calls
 *   2. Inferred (Tier 1): bare header locals
 *   3. seed: fills only names not present (migration / host-only view params)
 *
 * Explicit always wins on name overlap. Seed never overwrites extracted values.
 */

import { extractParams, extractRegistrationParams, mergeParams } from "./extract.js";
import { inferParams } from "./infer.js";
import { normalizeParam } from "./types.js";

/**
 * @param {string} source
 * @param {{ seed?: import('./types.js').Parameter[] }} [opts]
 * @returns {import('./types.js').Parameter[]}
 */
export function resolveParams(source, opts = {}) {
  const seed = (opts.seed || []).map((p) => normalizeParam(p));

  const blockAndLines = extractParams(source);
  const registrations = extractRegistrationParams(source);
  // Explicit set: block/lines first, then P.number registrations fill gaps /
  // merge fields (block still wins on overlap via mergeParams order below).
  const explicit = mergeExplicit(blockAndLines, registrations);

  const inferred = inferParams(source);

  // explicit wins over inferred
  let merged = mergeParams(explicit, inferred);
  // seed fills only missing names
  if (seed.length) {
    merged = mergeParams(merged, seed);
  }

  // If nothing at all, return seed (or empty)
  if (!merged.length && seed.length) return seed.map((p) => ({ ...p }));
  return merged;
}

/**
 * Block/line params win over registration-style on field merge;
 * registrations add names not in the block.
 * @param {import('./types.js').Parameter[]} blockAndLines
 * @param {import('./types.js').Parameter[]} registrations
 */
function mergeExplicit(blockAndLines, registrations) {
  if (!blockAndLines.length && !registrations.length) return [];
  if (!blockAndLines.length) return registrations.map((p) => ({ ...p }));
  if (!registrations.length) return blockAndLines.map((p) => ({ ...p }));
  // extracted (block) wins
  return mergeParams(blockAndLines, registrations);
}
