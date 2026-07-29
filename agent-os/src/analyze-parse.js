/**
 * Parse luau-analyze stdout into structured diagnostics.
 * Observed format: `/path/file.luau:LINE:COL: message`
 * Summary lines like `luau-analyze: 1 error` are ignored.
 */

/**
 * @typedef {{
 *   path?: string,
 *   line: number,
 *   column: number,
 *   message: string,
 *   severity: "error"|"warning"|"info"
 * }} CadDiagnostic
 */

/**
 * @param {string} text
 * @returns {CadDiagnostic[]}
 */
export function parseLuauAnalyzeOutput(text) {
  /** @type {CadDiagnostic[]} */
  const out = [];
  if (!text) return out;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^luau-analyze:\s*\d+\s+error/i.test(line)) continue;
    // Prefer path:line:col: message; also accept path:line: message (runtime).
    let m = line.match(/^(.*?):(\d+):(\d+):\s*(.+)$/);
    if (m) {
      const path = m[1];
      const lineno = Number(m[2]);
      const col = Number(m[3]);
      if (!Number.isFinite(lineno) || !Number.isFinite(col) || lineno < 1 || col < 1) continue;
      const message = m[4].trim();
      if (!message) continue;
      const severity = /warning/i.test(message) ? "warning" : "error";
      out.push({ path, line: lineno, column: col, message, severity });
      continue;
    }
    m = line.match(/^(.*?):(\d+):\s*(.+)$/);
    if (!m) continue;
    const path = m[1];
    const lineno = Number(m[2]);
    if (!Number.isFinite(lineno) || lineno < 1) continue;
    const message = m[3].trim();
    if (!message || /^\d+\s+error/i.test(message)) continue;
    const severity = /warning/i.test(message) ? "warning" : "error";
    out.push({ path, line: lineno, column: 1, message, severity });
  }
  return out;
}

/**
 * Keep diagnostics whose path ends with one of the given basenames (or full suffixes).
 * @param {CadDiagnostic[]} diags
 * @param {string|string[]} pathSuffix e.g. "main.luau" or ["/tmp/cad/main.luau"]
 */
export function filterDiagnosticsByPath(diags, pathSuffix) {
  const suffixes = (Array.isArray(pathSuffix) ? pathSuffix : [pathSuffix]).filter(Boolean);
  if (!suffixes.length) return diags;
  return diags.filter((d) => {
    const p = d.path || "";
    return suffixes.some((s) => p === s || p.endsWith("/" + s) || p.endsWith(s));
  });
}

/**
 * Map analyzer line numbers from a file that includes a synthetic prelude.
 * @param {CadDiagnostic[]} diags
 * @param {number} preludeLines number of lines prepended before user source (0 if none)
 */
export function adjustPreludeLines(diags, preludeLines) {
  if (!preludeLines) return diags;
  return diags
    .map((d) => ({
      ...d,
      line: d.line - preludeLines,
    }))
    .filter((d) => d.line >= 1);
}
