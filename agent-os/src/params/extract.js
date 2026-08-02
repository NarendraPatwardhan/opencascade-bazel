/**
 * Legacy explicit param forms (secondary gap-fill on the host).
 *
 * Preferred authoring is interleaved locals harvested by guest syntax
 * (batteries/params_resolve.luau). Still supported here:
 *   --[[params]] blocks, -- @param lines, P.number(...) calls.
 */

import { normalizeParam } from "./types.js";

/**
 * @param {string} source
 * @returns {import('./types.js').Parameter[]}
 */
export function extractParams(source) {
  if (!source || typeof source !== "string") return [];

  const block = source.match(/--\s*\[\[\s*params\b([\s\S]*?)\]\]/);
  const blockParams = block ? parseParamBlock(block[1]) : [];
  const lineParams = extractParamLines(source);
  const regParams = extractRegistrationParams(source);

  // Block → line → P.number/params.* registrations (defined fields win left→right gaps).
  let out = blockParams;
  if (lineParams.length) out = out.length ? mergeParams(out, lineParams) : lineParams;
  if (regParams.length) out = out.length ? mergeParams(out, regParams) : regParams;
  return out;
}

/**
 * @param {string} source
 * @returns {import('./types.js').Parameter[]}
 */
function extractParamLines(source) {
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
        min: min != null && min !== "" ? Number(min) : undefined,
        max: max != null && max !== "" ? Number(max) : undefined,
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
 * Parse `P.number("name", { … })` / `params.bool("flag", { … })` registrations.
 * Static parse only — does not execute Luau.
 * Nested option tables in `{ … }` are not supported (see file header).
 * @param {string} source
 * @returns {import('./types.js').Parameter[]}
 */
export function extractRegistrationParams(source) {
  if (!source || typeof source !== "string") return [];
  /** @type {import('./types.js').Parameter[]} */
  const out = [];
  // P.number("width", { default=40, min=16, ... })
  // params.number('width', { ... })
  // optional local binding: local width = P.number(...)
  // Field body is non-greedy until first `}` — nested braces not supported.
  const callRe =
    /\b(?:P|params)\s*\.\s*(number|bool|boolean|enum|string)\s*\(\s*["'](\w+)["']\s*(?:,\s*\{([^}]*)\})?\s*\)/g;
  let m;
  while ((m = callRe.exec(source))) {
    const kind = m[1];
    const name = m[2];
    const fields = m[3] || "";
    /** @type {Record<string, any>} */
    const obj = { name };
    parseFieldsInto(fields, obj);
    if (obj.default != null && obj.defaultValue == null) {
      obj.defaultValue = obj.default;
    }
    if (obj.value == null && obj.defaultValue != null) {
      obj.value = obj.defaultValue;
    }
    if (kind === "bool" || kind === "boolean") {
      obj.type = "boolean";
      if (obj.value == null) obj.value = false;
    } else if (kind === "enum") {
      obj.type = "enum";
    } else if (kind === "string") {
      obj.type = "string";
      if (obj.value == null) obj.value = "";
    } else {
      obj.type = "number";
      if (obj.value == null) obj.value = 0;
    }
    out.push(normalizeParam(obj));
  }
  return out;
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
    parseFieldsInto(fields, obj);
    if (obj.default != null && obj.defaultValue == null) {
      obj.defaultValue = obj.default;
    }
    if (obj.value == null && obj.defaultValue != null) obj.value = obj.defaultValue;
    out.push(normalizeParam(obj));
  }
  return out;
}

/**
 * @param {string} fields
 * @param {Record<string, any>} obj
 */
function parseFieldsInto(fields, obj) {
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
}

/**
 * Defined-field merge: `extracted` wins on name overlap for fields that are
 * not `undefined`; missing/undefined fields on the winner keep the loser's
 * values. New names from `extracted` are added; names only in `defaults` stay.
 *
 * @param {import('./types.js').Parameter[]} extracted
 * @param {import('./types.js').Parameter[]} defaults
 */
export function mergeParams(extracted, defaults = []) {
  if (!extracted.length) return defaults.map((p) => ({ ...p }));
  const byName = new Map(defaults.map((p) => [p.name, { ...p }]));
  for (const e of extracted) {
    const prev = byName.get(e.name);
    if (!prev) {
      byName.set(e.name, { ...e });
      continue;
    }
    /** @type {Record<string, any>} */
    const merged = { ...prev };
    for (const key of Object.keys(e)) {
      const v = /** @type {any} */ (e)[key];
      if (v !== undefined) merged[key] = v;
    }
    byName.set(e.name, /** @type {import('./types.js').Parameter} */ (merged));
  }
  return [...byName.values()];
}
