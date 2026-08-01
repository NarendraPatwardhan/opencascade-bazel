/**
 * Parameter extraction from Luau source (REACTIVITY C2).
 *
 * 1) Explicit metadata block:
 *      --[[params
 *      width = { value=40, min=5, max=120, unit="mm", scrub="rebuild", group="Size" }
 *      ]]
 * 2) Line form: -- @param name value min max unit scrub
 * 3) No magic-number invention — returns [] if nothing declared.
 */

import { normalizeParam } from "./types.js";

/**
 * @param {string} source
 * @returns {import('./types.js').Parameter[]}
 */
export function extractParams(source) {
  if (!source || typeof source !== "string") return [];

  const block = source.match(/--\s*\[\[\s*params\b([\s\S]*?)\]\]/);
  if (block) return parseParamBlock(block[1]);

  /** @type {import('./types.js').Parameter[]} */
  const lineParams = [];
  const re =
    /--\s*@param\s+(\w+)\s+([^\s]+)(?:\s+([^\s]+))?(?:\s+([^\s]+))?(?:\s+(\w+))?(?:\s+(\w+))?/g;
  let m;
  while ((m = re.exec(source))) {
    const [, name, value, min, max, unit, scrub] = m;
    const num = Number(value);
    lineParams.push(
      normalizeParam({
        name,
        value: Number.isFinite(num) ? num : value === "true",
        min: min != null ? Number(min) : undefined,
        max: max != null ? Number(max) : undefined,
        unit: unit && !/^(view|xform|rebuild)$/.test(unit) ? unit : undefined,
        scrub:
          scrub ||
          (unit && /^(view|xform|rebuild)$/.test(unit) ? unit : "rebuild"),
      }),
    );
  }
  return lineParams;
}

/**
 * @param {string} body
 */
function parseParamBlock(body) {
  /** @type {import('./types.js').Parameter[]} */
  const out = [];
  const entryRe = /(\w+)\s*=\s*\{([^}]*)\}/g;
  let m;
  while ((m = entryRe.exec(body))) {
    const name = m[1];
    const fields = m[2];
    /** @type {Record<string, any>} */
    const obj = { name };
    const fieldRe = /(\w+)\s*=\s*("(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^,\n]+)/g;
    let f;
    while ((f = fieldRe.exec(fields))) {
      const key = f[1];
      let raw = f[2].trim().replace(/,\s*$/, "");
      if (
        (raw.startsWith('"') && raw.endsWith('"')) ||
        (raw.startsWith("'") && raw.endsWith("'"))
      ) {
        obj[key] = raw.slice(1, -1);
      } else if (raw === "true" || raw === "false") {
        obj[key] = raw === "true";
      } else {
        const n = Number(raw);
        obj[key] = Number.isFinite(n) ? n : raw;
      }
    }
    if (obj.default != null && obj.defaultValue == null) {
      obj.defaultValue = obj.default;
    }
    if (obj.value == null && obj.defaultValue != null) obj.value = obj.defaultValue;
    out.push(normalizeParam(obj));
  }
  return out;
}

/**
 * Extracted wins on overlap; defaults fill missing names.
 * @param {import('./types.js').Parameter[]} extracted
 * @param {import('./types.js').Parameter[]} defaults
 */
export function mergeParams(extracted, defaults = []) {
  if (!extracted.length) return defaults.map((p) => ({ ...p }));
  const byName = new Map(defaults.map((p) => [p.name, { ...p }]));
  for (const e of extracted) {
    const prev = byName.get(e.name);
    byName.set(e.name, prev ? { ...prev, ...e, value: e.value } : e);
  }
  return [...byName.values()];
}
