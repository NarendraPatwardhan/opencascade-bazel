/**
 * Fingerprint free-param regions so body-only source edits can skip a full
 * guest params_resolve harvest.
 *
 * Collects:
 *   - explicit --[[params]] / -- @param forms anywhere
 *   - group comments `-- [Name]`
 *   - annotated free locals `local name = … -- …` (including late in file)
 *   - bare require lines that introduce modules
 *
 * Does **not** stop permanently at first solid.* — late annotated params after
 * intermediate geometry are still included (scan whole file for annotations).
 *
 * @param {string} source
 * @returns {string}
 */
export function paramsHeaderFingerprint(source) {
  const text = String(source || "");
  const lines = text.split(/\r?\n/);
  /** @type {string[]} */
  const kept = [];

  let inParamsBlock = false;
  for (const line of lines) {
    const t = line.trim();

    if (inParamsBlock) {
      kept.push(t);
      if (/\]\]/.test(t)) inParamsBlock = false;
      continue;
    }
    if (/--\s*\[\[\s*params\b/.test(t)) {
      inParamsBlock = true;
      kept.push(t);
      continue;
    }
    if (/--\s*@param\b/.test(t)) {
      kept.push(t);
      continue;
    }
    if (/^--\s*\[/.test(t)) {
      kept.push(t);
      continue;
    }
    if (/^require\s*\(/.test(t) || /^local\s+\w+\s*=\s*require\s*\(/.test(t)) {
      kept.push(t);
      continue;
    }
    // Annotated free param anywhere (late params after solid.* still count).
    if (
      /^local\s+\w+\s*=/.test(t) &&
      (/--/.test(t) ||
        /^local\s+\w+\s*=\s*(?:-?\d|true|false|["'])/.test(t))
    ) {
      // Skip pure intermediate locals without annotation that look like body math
      // unless they are simple literal initializers (common param form).
      if (/--/.test(t) || /^local\s+\w+\s*=\s*(?:-?\d+(?:\.\d+)?|true|false|["'][^"']*["'])\s*$/.test(t)) {
        kept.push(t);
      }
    }
  }

  const s = kept.join("\n");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36) + ":" + kept.length;
}
