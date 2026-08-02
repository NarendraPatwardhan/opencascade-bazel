/**
 * Shared schema signature for param store + sheet (not live scrub values).
 * Single source of truth — avoid drift between main.js and sheet.js.
 *
 * @param {import('./types.js').Parameter[]} list
 * @returns {string}
 */
export function schemaSignature(list) {
  if (!Array.isArray(list) || !list.length) return "";
  return list
    .map((p) => {
      const opts = p.options ? JSON.stringify(p.options) : "";
      return [
        p.name,
        p.type,
        p.min,
        p.max,
        p.step,
        p.scrub,
        p.group,
        p.defaultValue,
        p.unit,
        p.frame || "",
        p.displayName || "",
        p.axis || "",
        p.description || "",
        opts,
      ].join("\0");
    })
    .join("\n");
}
