/**
 * Host binding of param values into guest Luau.
 *
 * Preferred authoring (clean for humans):
 *   local width = 40 -- [16:120] mm
 *   solid.box({ dx = width, … })
 *
 * On run we:
 *   1) rewrite header local literals to store values (preserves trailing comments)
 *   2) inject `_HOST_PARAMS` + `params = require("params")` for advanced/params.* use
 *
 * Staged shape (hot comments preserved at file head):
 *   --!strict
 *   _HOST_PARAMS = { … }
 *   params = require("params")
 *   <user body with local width = <live value> -- …>
 */

import { applyParamValuesToSource } from "./luau-locals.js";

/**
 * Serialize a JS value as a Luau literal (numbers, bools, strings only).
 * @param {any} v
 * @returns {string | null}
 */
export function luauLiteral(v) {
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number" && Number.isFinite(v)) {
    if (Object.is(v, -0)) return "0";
    return String(v);
  }
  if (typeof v === "string") {
    return JSON.stringify(v);
  }
  return null;
}

/**
 * Build a Luau table body from a values map.
 * Skips non-identifier keys and non-literal values (objects, null, NaN).
 * @param {Record<string, any>} values
 */
export function formatParamsTable(values) {
  if (!values || typeof values !== "object") return "{}";
  /** @type {string[]} */
  const parts = [];
  for (const [k, v] of Object.entries(values)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) continue;
    const lit = luauLiteral(v);
    if (lit == null) continue;
    parts.push(`${k} = ${lit}`);
  }
  if (!parts.length) return "{}";
  return `{ ${parts.join(", ")} }`;
}

/**
 * Peel leading shebang + Luau hot comments (`--!strict`, etc.) so inject can
 * sit after them without stripping directives from the effective file head.
 * @param {string} source
 * @returns {{ head: string, body: string, headLineCount: number }}
 */
export function peelLeadingDirectives(source) {
  if (!source || typeof source !== "string") {
    return { head: "", body: source || "", headLineCount: 0 };
  }
  const lines = source.split(/\r?\n/);
  /** @type {string[]} */
  const head = [];
  let i = 0;
  if (lines[0]?.startsWith("#!")) {
    head.push(lines[0]);
    i = 1;
  }
  while (i < lines.length) {
    const t = lines[i].trim();
    if (/^--!/.test(t)) {
      head.push(lines[i]);
      i++;
      continue;
    }
    break;
  }
  const body = lines.slice(i).join("\n");
  return {
    head: head.length ? head.join("\n") + "\n" : "",
    body,
    headLineCount: head.length,
  };
}

/** Inject block always two physical lines (stable for diagnostics). */
export const PARAMS_INJECT_LINE_COUNT = 2;

/**
 * Build inject block (values table + method-capable `params` global).
 * @param {Record<string, any>} [values]
 */
export function formatInjectBlock(values = {}) {
  const table = formatParamsTable(values);
  return (
    `_HOST_PARAMS = ${table}\n` +
    `params = require("params")\n`
  );
}

/**
 * Full wrap: peel hot comments, inject, reassemble.
 * @param {string} userSource
 * @param {Record<string, any>} [values]
 * @returns {{
 *   source: string,
 *   headLineCount: number,
 *   injectLineCount: number,
 *   lineCount: number,
 * }}
 */
export function buildParamsInjectedSource(userSource, values = {}) {
  const { head, body, headLineCount } = peelLeadingDirectives(userSource || "");
  // Rewrite bare `local name = lit` to live store values (clean authoring path).
  const rewritten = applyParamValuesToSource(
    body,
    values && typeof values === "object" ? values : {},
  );
  const injectBlock = formatInjectBlock(values);
  const injectLineCount = PARAMS_INJECT_LINE_COUNT;
  return {
    source: head + injectBlock + rewritten,
    headLineCount,
    injectLineCount,
    /** @deprecated prefer injectLineCount + headLineCount; equals inject lines only */
    lineCount: injectLineCount,
  };
}

/**
 * Map an analyzer/runtime line number back to the Monaco (user) buffer.
 * Layout: [packagePathLines][head][inject][body]
 * User buffer: [head][body]
 *
 * @param {number} analyzerLine 1-based
 * @param {{
 *   packagePathLines?: number,
 *   headLineCount?: number,
 *   injectLineCount?: number,
 * }} opts
 * @returns {number | null} user line or null if in synthetic prelude
 */
export function mapAnalyzerLineToUser(analyzerLine, opts = {}) {
  const packagePathLines = opts.packagePathLines || 0;
  const headLineCount = opts.headLineCount || 0;
  const injectLineCount = opts.injectLineCount || 0;
  if (!Number.isFinite(analyzerLine) || analyzerLine < 1) return null;
  let a = analyzerLine - packagePathLines;
  if (a < 1) return null;
  if (a <= headLineCount) return a;
  if (a <= headLineCount + injectLineCount) return null;
  return a - injectLineCount;
}

/**
 * Adjust diagnostics for params inject (+ optional package.path line).
 * @param {Array<{ line: number, [k: string]: any }>} diags
 * @param {{
 *   packagePathLines?: number,
 *   headLineCount?: number,
 *   injectLineCount?: number,
 * }} opts
 */
export function adjustInjectedDiagnostics(diags, opts = {}) {
  if (!Array.isArray(diags) || !diags.length) return diags || [];
  /** @type {typeof diags} */
  const out = [];
  for (const d of diags) {
    const userLine = mapAnalyzerLineToUser(d.line, opts);
    if (userLine == null || userLine < 1) continue;
    out.push({ ...d, line: userLine });
  }
  return out;
}

/**
 * Prelude-only helper (no user source). Prefer `buildParamsInjectedSource` when
 * wrapping real buffers (preserves `--!strict`).
 * @param {Record<string, any>} [values]
 * @returns {{ source: string, lineCount: number }}
 */
export function injectParamsPrelude(values = {}) {
  const built = buildParamsInjectedSource("", values);
  return {
    source: built.source,
    lineCount: built.injectLineCount,
  };
}

/**
 * Values map from a Parameter list (store snapshot).
 * @param {import('./types.js').Parameter[]} list
 * @returns {Record<string, any>}
 */
export function valuesFromParams(list) {
  /** @type {Record<string, any>} */
  const o = {};
  for (const p of list || []) {
    if (p && p.name) o[p.name] = p.value;
  }
  return o;
}
