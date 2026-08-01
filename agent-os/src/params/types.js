/**
 * Parameter contract — REACTIVITY.md §3 (CADAM C1).
 */

/**
 * @typedef {{
 *   name: string,
 *   displayName?: string,
 *   value: any,
 *   defaultValue?: any,
 *   type?: 'number'|'boolean'|'enum'|'string',
 *   min?: number,
 *   max?: number,
 *   step?: number,
 *   unit?: string,
 *   scrub?: 'view'|'xform'|'rebuild',
 *   group?: string,
 *   description?: string,
 *   options?: Array<string|{label:string,value:any}>,
 *   frame?: string,
 *   axis?: string,
 * }} Parameter
 */

/**
 * @param {Partial<Parameter> & { name: string }} raw
 * @returns {Parameter}
 */
export function normalizeParam(raw) {
  const type =
    raw.type ||
    (typeof raw.value === "boolean"
      ? "boolean"
      : Array.isArray(raw.options)
        ? "enum"
        : "number");
  const defaultValue =
    raw.defaultValue !== undefined
      ? raw.defaultValue
      : raw.default !== undefined
        ? raw.default
        : raw.value;
  return {
    name: raw.name,
    displayName: raw.displayName || raw.display_name || raw.name,
    value: raw.value ?? defaultValue,
    defaultValue,
    type,
    min: raw.min,
    max: raw.max,
    step: raw.step,
    unit: raw.unit,
    scrub: raw.scrub || "rebuild",
    group: raw.group || "Main",
    description: raw.description || "",
    options: raw.options,
    frame: raw.frame,
    axis: raw.axis || "z",
  };
}

/**
 * @param {Parameter} p
 * @param {any} value
 */
export function clampParam(p, value) {
  if (p.type === "boolean") return !!value;
  if (p.type === "enum") {
    if (!p.options?.length) return value;
    const vals = p.options.map((o) =>
      typeof o === "object" && o ? o.value : o,
    );
    return vals.includes(value) ? value : vals[0];
  }
  let n = Number(value);
  if (!Number.isFinite(n)) n = Number(p.defaultValue) || 0;
  if (p.min != null && n < p.min) n = p.min;
  if (p.max != null && n > p.max) n = p.max;
  if (p.step != null && p.step > 0 && p.min != null) {
    const k = Math.round((n - p.min) / p.step);
    n = p.min + k * p.step;
    // avoid float dust
    n = Math.round(n / p.step) * p.step;
    if (p.min != null && n < p.min) n = p.min;
    if (p.max != null && n > p.max) n = p.max;
  }
  return n;
}

/** C7 auto step from magnitude when step missing. */
export function autoStep(p) {
  if (p.step != null && p.step > 0) return p.step;
  if (p.min == null || p.max == null) return 0.01;
  const span = Math.abs(p.max - p.min);
  if (span >= 100) return 1;
  if (span >= 10) return 0.1;
  if (span >= 1) return 0.01;
  if (span >= 0.1) return 0.001;
  return span / 100 || 0.001;
}
