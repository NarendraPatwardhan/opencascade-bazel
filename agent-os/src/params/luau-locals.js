/**
 * FALLBACK / unit-test double — host-side Luau line walk for free parameters.
 *
 * **Product truth** is guest `require("syntax")` via batteries/params_resolve.luau
 * (worker kind `params_resolve` → POD JSON). Do not extend this file as the
 * schema authority; use the syntax battery for metaprogramming / AST walks.
 *
 * Kept for:
 *   - cold UI before AgentOS VM is warm
 *   - node unit smokes without loom
 *   - inject rewrite position helper (`applyParamValuesToSource`)
 *
 * Preferred authoring look (CADAM-like, interleaved):
 *
 *   -- [Size]
 *   local width = 40 -- [16:0.5:120] mm
 *   local base = solid.box({ dx = width, ... })
 */

import { normalizeParam } from "./types.js";

/**
 * @typedef {{
 *   name: string,
 *   value: any,
 *   line: number,
 *   col: number,
 *   litStart: number,
 *   litEnd: number,
 *   comment: string,
 *   groupHint: string,
 *   displayHint: string,
 * }} LocalBinding
 */

/**
 * Split source into logical lines with absolute offsets.
 * @param {string} source
 * @returns {{ text: string, start: number, line: number }[]}
 */
export function splitLines(source) {
  /** @type {{ text: string, start: number, line: number }[]} */
  const lines = [];
  let start = 0;
  let line = 1;
  for (let i = 0; i <= source.length; i++) {
    if (i === source.length || source[i] === "\n") {
      const end = i;
      let text = source.slice(start, end);
      if (text.endsWith("\r")) text = text.slice(0, -1);
      lines.push({ text, start, line });
      start = i + 1;
      line++;
    }
  }
  return lines;
}

/**
 * Parse CADAM-style range / enum from a trailing comment body (after --).
 * Forms:
 *   [min:max]  [min:step:max]  [a, b, c]  unit  scrub  group words
 * @param {string} comment
 */
export function parseTrailingAnnotation(comment) {
  /** @type {Record<string, any>} */
  const out = {};
  let rest = String(comment || "").replace(/^\s*--\s?/, "").trim();
  if (!rest) return out;

  // Optional leading display phrase before '[' or keywords
  const bracket = rest.match(/\[([^\]]*)\]/);
  if (bracket) {
    const inner = bracket[1].trim();
    const before = rest.slice(0, bracket.index).trim();
    if (before && !/^(view|xform|rebuild)$/i.test(before)) {
      out.displayName = before.replace(/:$/, "").trim();
    }
    if (/,/.test(inner) && !/^-?[\d.]/.test(inner)) {
      // enum options
      out.type = "enum";
      out.options = inner.split(",").map((s) => s.trim()).filter(Boolean);
    } else {
      const parts = inner.split(":").map((s) => s.trim());
      if (parts.length === 2) {
        const min = Number(parts[0]);
        const max = Number(parts[1]);
        if (Number.isFinite(min)) out.min = min;
        if (Number.isFinite(max)) out.max = max;
      } else if (parts.length >= 3) {
        const min = Number(parts[0]);
        const step = Number(parts[1]);
        const max = Number(parts[2]);
        if (Number.isFinite(min)) out.min = min;
        if (Number.isFinite(step) && step > 0) out.step = step;
        if (Number.isFinite(max)) out.max = max;
      }
    }
    rest = (rest.slice(0, bracket.index) + rest.slice(bracket.index + bracket[0].length)).trim();
  }

  // tokens: unit, scrub, group=
  const tokens = rest.split(/\s+/).filter(Boolean);
  for (const t of tokens) {
    if (/^(view|xform|rebuild)$/i.test(t)) {
      out.scrub = t.toLowerCase();
      continue;
    }
    if (/^group=/i.test(t)) {
      out.group = t.slice(6);
      continue;
    }
    if (/^unit=/i.test(t)) {
      out.unit = t.slice(5);
      continue;
    }
    if (/^(mm|cm|m|deg|°|rad|in)$/i.test(t)) {
      out.unit = t === "deg" ? "°" : t;
      continue;
    }
    // leftover word as group if no group yet
    if (!out.group && !/^\[/.test(t) && t.length < 32) {
      // don't treat displayName leftovers as group if already set
      if (!out.displayName || t !== out.displayName.split(/\s+/)[0]) {
        if (!/^(view|xform|rebuild)$/i.test(t)) out.group = out.group || t;
      }
    }
  }
  return out;
}

/**
 * Group / section markers on their own line:
 *   -- [Size]
 *   --# Boss
 *   --- Size ---
 * @param {string} line
 */
export function parseGroupMarker(line) {
  const t = line.trim();
  let m = t.match(/^--\s*\[\s*([^\]]+)\]\s*$/);
  if (m) return m[1].trim();
  m = t.match(/^--#\s*(.+)$/);
  if (m) return m[1].trim();
  m = t.match(/^---+\s*(.+?)\s*---+$/);
  if (m) return m[1].trim();
  return null;
}

/**
 * Display name from a pure comment line above a binding:
 *   -- Plate width
 *   local width = 40
 * @param {string} line
 */
export function parseDisplayComment(line) {
  const t = line.trim();
  if (!t.startsWith("--")) return null;
  if (parseGroupMarker(t)) return null;
  if (/^--\[\[/.test(t)) return null;
  if (/^--\s*@param\b/.test(t)) return null;
  if (/^--\s*!/.test(t)) return null;
  const body = t.replace(/^--\s?/, "").trim();
  if (!body || body.length > 48) return null;
  if (/[=\[\]{}()]/.test(body)) return null;
  return body;
}

/**
 * Walk source for top-level `local name = <literal>` bindings (header region).
 * Comment-aware: uses original lines so trailing annotations survive.
 * @param {string} source
 * @returns {LocalBinding[]}
 */
export function findHeaderLocalBindings(source) {
  if (!source) return [];
  const lines = splitLines(source);
  /** @type {LocalBinding[]} */
  const out = [];
  let groupHint = "";
  let displayHint = "";
  let inBlockComment = false;

  for (const { text, start, line } of lines) {
    const trimmed = text.trim();

    // block comment state (coarse)
    if (inBlockComment) {
      if (trimmed.includes("]]")) inBlockComment = false;
      continue;
    }
    if (/^--\[\[/.test(trimmed) && !trimmed.includes("]]")) {
      inBlockComment = true;
      continue;
    }
    if (/^--\[\[/.test(trimmed)) continue;

    const gm = parseGroupMarker(trimmed);
    if (gm) {
      groupHint = gm;
      displayHint = "";
      continue;
    }

    const dc = parseDisplayComment(trimmed);
    if (dc) {
      displayHint = dc;
      continue;
    }

    // Stop at functions / control flow (chunk body)
    if (/^(local\s+)?function\b/.test(trimmed)) break;
    if (/^(if|for|while|repeat|do)\b/.test(trimmed)) break;

    // Stop at first non-require call (geometry body starts)
    if (isNonRequireCallLine(trimmed)) break;

    // local name = literal -- comment
    // local a, b = 1, 2
    const lm = text.match(
      /^(\s*)local\s+([A-Za-z_][\w\s,]*)\s*=\s*(.+)$/,
    );
    if (!lm) {
      displayHint = "";
      continue;
    }

    const indent = lm[1];
    // only top-level (no indent beyond optional whitespace we allow full line)
    // Skip if line is inside a block we can't see — top-level only: no leading tabs after strip of empty
    if (/^\s+/.test(text) && text.search(/\S/) > 0) {
      // still top-level if only spaces at file indent 0-ish — allow spaces
    }

    let rhsFull = lm[3];
    let comment = "";
    // split trailing comment (not inside quotes)
    const cmt = splitTrailingComment(rhsFull);
    rhsFull = cmt.code.trim();
    comment = cmt.comment;

    if (/require\s*\(/.test(rhsFull)) {
      displayHint = "";
      continue;
    }

    const names = lm[2]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!names.length) continue;

    const values = splitTopLevelCommas(rhsFull);
    if (values.length !== names.length) {
      // single name with complex expr — skip (not a free param)
      if (names.length === 1 && isBareLiteral(rhsFull)) {
        // ok single
      } else {
        displayHint = "";
        continue;
      }
    }

    const valList =
      values.length === names.length ? values : [rhsFull];

    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
      if (name.startsWith("_")) continue;
      if (/^[A-Z][A-Z0-9_]*$/.test(name)) continue; // ALL_CAPS constant

      const raw = (valList[i] || "").trim();
      if (!isBareLiteral(raw)) continue;

      let value;
      if (raw === "true" || raw === "false") value = raw === "true";
      else {
        value = Number(raw);
        if (!Number.isFinite(value)) continue;
      }

      // locate literal in original line for rewrite
      const nameIdx = text.indexOf(name);
      const eqIdx = text.indexOf("=", nameIdx);
      const litIdx = text.indexOf(raw, eqIdx);
      const litStart =
        litIdx >= 0 ? start + litIdx : start + eqIdx + 1;
      const litEnd = litStart + raw.length;

      out.push({
        name,
        value,
        line,
        col: (indent || "").length,
        litStart,
        litEnd,
        comment,
        groupHint,
        displayHint: i === 0 ? displayHint : "",
      });
    }
    displayHint = "";
  }
  return out;
}

/**
 * Bindings → Parameter[] with annotations + range inference.
 * @param {LocalBinding[]} bindings
 * @returns {import('./types.js').Parameter[]}
 */
export function bindingsToParams(bindings) {
  /** @type {Map<string, import('./types.js').Parameter>} */
  const byName = new Map();
  for (const b of bindings) {
    const ann = parseTrailingAnnotation(b.comment);
    /** @type {Record<string, any>} */
    const obj = {
      name: b.name,
      value: b.value,
      defaultValue: b.value,
      displayName:
        ann.displayName || b.displayHint || humanize(b.name),
      group: ann.group || b.groupHint || "Main",
      scrub: ann.scrub || (typeof b.value === "boolean" ? "view" : "rebuild"),
      unit: ann.unit || "",
    };
    if (typeof b.value === "boolean") {
      obj.type = "boolean";
    } else if (ann.type === "enum" && ann.options) {
      obj.type = "enum";
      obj.options = ann.options;
    } else {
      obj.type = "number";
      if (ann.min != null) obj.min = ann.min;
      if (ann.max != null) obj.max = ann.max;
      if (ann.step != null) obj.step = ann.step;
      if (obj.min == null || obj.max == null) {
        const r = rangeFromMagnitude(Number(b.value));
        if (obj.min == null) obj.min = r.min;
        if (obj.max == null) obj.max = r.max;
        if (obj.step == null) {
          obj.step =
            Number.isInteger(b.value) && Math.abs(b.value) >= 1
              ? 1
              : r.step;
        }
      }
    }
    byName.set(b.name, normalizeParam(obj));
  }
  return [...byName.values()];
}

/**
 * Analyze source → params (primary static path).
 * @param {string} source
 */
export function analyzeLuauParams(source) {
  return bindingsToParams(findHeaderLocalBindings(source));
}

/**
 * Rewrite bare local literals for execute inject-without-params-table.
 * Preserves trailing comments. Editor buffer can stay as-is; this is for run.
 *
 * Inject position truth is this host helper (findHeaderLocalBindings). Guest POD
 * litStart/litEnd are optional future fields — not required here.
 *
 * @param {string} source
 * @param {Record<string, any>} values
 */
export function applyParamValuesToSource(source, values) {
  if (!source || !values || typeof values !== "object") return source;
  const bindings = findHeaderLocalBindings(source);
  // apply from end so offsets stay valid
  const sorted = [...bindings].sort((a, b) => b.litStart - a.litStart);
  let out = source;
  for (const b of sorted) {
    if (!Object.prototype.hasOwnProperty.call(values, b.name)) continue;
    const v = values[b.name];
    if (v === undefined) continue;
    let lit;
    if (typeof v === "boolean") lit = v ? "true" : "false";
    else if (typeof v === "number" && Number.isFinite(v)) lit = formatNum(v);
    else if (typeof v === "string") lit = JSON.stringify(v);
    else continue;
    out = out.slice(0, b.litStart) + lit + out.slice(b.litEnd);
  }
  return out;
}

/** @param {number} n */
function rangeFromMagnitude(n) {
  const a = Math.abs(n);
  if (a === 0) return { min: -10, max: 10, step: 0.1 };
  if (a >= 100) {
    return { min: Math.min(0, n - a), max: n + a, step: 1 };
  }
  if (a >= 10) {
    return {
      min: Number.isInteger(n) ? Math.max(0, Math.floor(n * 0.25)) : 0,
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
  return { min: 0, max: Math.max(1, a * 10), step: 0.01 };
}

function humanize(name) {
  return name
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatNum(v) {
  if (Number.isInteger(v)) return String(v);
  const s = String(Number(v.toPrecision(10)));
  return s;
}

function isBareLiteral(s) {
  const t = s.trim();
  if (t === "true" || t === "false") return true;
  return /^-?[\d]+(?:\.[\d]+)?(?:[eE][+-]?\d+)?$/.test(t);
}

function isNonRequireCallLine(t) {
  if (!t.includes("(")) return false;
  if (/require\s*\(/.test(t)) return false;
  if (/^local\s+[\w,\s]+\s*=\s*.+\(/.test(t)) return true;
  if (!/^local\s/.test(t) && /^[A-Za-z_].*\(/.test(t)) return true;
  return false;
}

/** @param {string} rhs */
function splitTrailingComment(rhs) {
  let inS = false;
  let inD = false;
  for (let i = 0; i < rhs.length - 1; i++) {
    const c = rhs[i];
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS) inD = !inD;
    else if (!inS && !inD && c === "-" && rhs[i + 1] === "-") {
      return { code: rhs.slice(0, i), comment: rhs.slice(i) };
    }
  }
  return { code: rhs, comment: "" };
}

/** @param {string} s */
function splitTopLevelCommas(s) {
  /** @type {string[]} */
  const parts = [];
  let depth = 0;
  let inS = false;
  let inD = false;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS) inD = !inD;
    else if (!inS && !inD) {
      if (c === "(" || c === "{" || c === "[") depth++;
      else if (c === ")" || c === "}" || c === "]") depth--;
      else if (c === "," && depth === 0) {
        parts.push(cur.trim());
        cur = "";
        continue;
      }
    }
    cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}
