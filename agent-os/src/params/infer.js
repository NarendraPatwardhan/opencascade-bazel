/**
 * Tier-1 conservative param inference from Luau header locals (CADAM-like).
 *
 * Only bare top-level `local name = <number|bool>` (and simple multi-assign
 * of numbers) in the **header region**:
 *   - before first function / control-flow keyword
 *   - before first non-`require` call assignment or bare call statement
 *
 * Never invents params from deep magic numbers, ALL_CAPS constants, or
 * locals after geometry calls.
 */

import { normalizeParam } from "./types.js";

/** @param {number} n */
function rangeFromMagnitude(n) {
  const a = Math.abs(n);
  if (a === 0) return { min: -10, max: 10, step: 0.1 };
  if (a >= 100) {
    return {
      min: Math.max(0, n - a),
      max: n + a,
      step: 1,
    };
  }
  if (a >= 10) {
    return {
      min: Math.max(0, Math.floor(n * 0.25)),
      max: Math.ceil(n * 2.5),
      step: 0.5,
    };
  }
  if (a >= 1) {
    return {
      min: Math.max(0, Math.floor(n * 0.1 * 10) / 10),
      max: Math.ceil(n * 3 * 10) / 10,
      step: 0.1,
    };
  }
  return {
    min: 0,
    max: Math.max(1, a * 10),
    step: 0.01,
  };
}

/**
 * Strip block comments and line comments for a coarse header scan.
 * Keeps line structure (newlines) so we can stop at function defs.
 * @param {string} source
 */
function stripComments(source) {
  let s = source.replace(/--\[\[[\s\S]*?\]\]/g, (m) =>
    m.replace(/[^\n]/g, " "),
  );
  s = s.replace(/--[^\n]*/g, "");
  return s;
}

/**
 * True if this top-level line is a non-require call (assignment or statement).
 * Ends the param header so post-call locals are not inferred.
 * @param {string} t trimmed line
 */
function isNonRequireCallLine(t) {
  if (!t.includes("(")) return false;
  if (/require\s*\(/.test(t)) return false;
  // local x = foo(...) or local x = solid.box({...})
  if (/^local\s+[\w,\s]+\s*=\s*.+\(/.test(t)) return true;
  // bare call: solid.finish(...), print(...), foo()
  if (!/^local\s/.test(t) && /^[A-Za-z_].*\(/.test(t)) return true;
  return false;
}

/**
 * Header region: bare locals only, before functions / control flow / first call.
 * @param {string} stripped
 */
function headerRegion(stripped) {
  const lines = stripped.split(/\r?\n/);
  /** @type {string[]} */
  const out = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      out.push(line);
      continue;
    }
    // Stop at top-level function definitions
    if (/^(local\s+)?function\b/.test(t)) break;
    // Stop at do/if blocks that look like program body
    if (/^(if|for|while|repeat|do)\b/.test(t)) break;
    // Stop at first non-require call — leftover locals after geometry are not params
    if (isNonRequireCallLine(t)) break;
    out.push(line);
  }
  return out.join("\n");
}

/**
 * Infer parameters from bare header locals.
 * @param {string} source
 * @returns {import('./types.js').Parameter[]}
 */
export function inferParams(source) {
  if (!source || typeof source !== "string") return [];
  const stripped = stripComments(source);
  const header = headerRegion(stripped);

  /** @type {Map<string, import('./types.js').Parameter>} */
  const byName = new Map();

  // local a = 40
  // local a, b = 40, 50
  // local flag = true
  const localRe =
    /^\s*local\s+([A-Za-z_][\w\s,]*)\s*=\s*([^\n]+)$/gm;
  let m;
  while ((m = localRe.exec(header))) {
    const namesRaw = m[1];
    const valuesRaw = m[2].trim();
    // Skip table / require / call expressions — not bare literals
    if (/require\s*\(/.test(valuesRaw)) continue;
    if (/[{([]/.test(valuesRaw) && !/^(true|false|-?\d)/.test(valuesRaw)) {
      if (!/^(-?[\d.eE+]+|true|false)(\s*,\s*(-?[\d.eE+]+|true|false))*$/.test(
        valuesRaw.replace(/\s/g, ""),
      )) {
        continue;
      }
    }
    const isPureLiteralList =
      /^(-?[\d.eE+]+|true|false)(\s*,\s*(-?[\d.eE+]+|true|false))*$/.test(
        valuesRaw.replace(/\s/g, ""),
      );
    if (
      !isPureLiteralList &&
      (/[+\-*/%^]|\.\.|and\b|or\b|not\b/.test(valuesRaw) ||
        /[A-Za-z_]/.test(valuesRaw.replace(/true|false/g, "")))
    ) {
      continue;
    }

    const names = namesRaw.split(",").map((s) => s.trim()).filter(Boolean);
    const values = valuesRaw.split(",").map((s) => s.trim());
    if (names.length !== values.length) continue;

    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
      // Skip private-ish / loop temps
      if (name.startsWith("_")) continue;
      // Skip ALL_CAPS constants (PI, MAX_COUNT, …)
      if (/^[A-Z][A-Z0-9_]*$/.test(name)) continue;
      const raw = values[i];
      if (raw === "true" || raw === "false") {
        byName.set(
          name,
          normalizeParam({
            name,
            value: raw === "true",
            type: "boolean",
            scrub: "rebuild",
            group: "Inferred",
          }),
        );
        continue;
      }
      const num = Number(raw);
      if (!Number.isFinite(num)) continue;
      const range = rangeFromMagnitude(num);
      const isInt = Number.isInteger(num);
      byName.set(
        name,
        normalizeParam({
          name,
          value: num,
          defaultValue: num,
          min: range.min,
          max: range.max,
          step: isInt && Math.abs(num) >= 1 ? 1 : range.step,
          unit: "",
          scrub: "rebuild",
          group: "Inferred",
        }),
      );
    }
  }

  return [...byName.values()];
}
