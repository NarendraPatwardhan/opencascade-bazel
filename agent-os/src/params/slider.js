/**
 * CADAM-faithful custom slider (reimplemented; not GPL-copied).
 * Visual model from Adam-CAD/CADAM ParameterSlider + ui/slider:
 * - tall soft track (sky tint), filled range, no thumb
 * - default-value line marker (click to reset)
 * - click track to jump; drag to scrub
 */

/**
 * @param {{
 *   min: number,
 *   max: number,
 *   step: number,
 *   value: number,
 *   defaultValue?: number,
 *   id?: string,
 *   onChange: (v: number) => void,
 *   onCommit: (v: number) => void,
 * }} opts
 */
export function createCadamSlider(opts) {
  const min = Number(opts.min);
  const max = Number(opts.max);
  const step = opts.step > 0 ? Number(opts.step) : 1;
  let value = clamp(Number(opts.value), min, max);
  const defaultValue =
    opts.defaultValue != null && Number.isFinite(Number(opts.defaultValue))
      ? Number(opts.defaultValue)
      : null;

  const root = document.createElement("div");
  root.className = "cad-slider";
  root.setAttribute("role", "slider");
  root.tabIndex = 0;
  if (opts.id) root.id = opts.id;
  root.setAttribute("aria-valuemin", String(min));
  root.setAttribute("aria-valuemax", String(max));

  const track = document.createElement("div");
  track.className = "cad-slider-track";
  const range = document.createElement("div");
  range.className = "cad-slider-range";
  track.appendChild(range);

  /** @type {HTMLElement | null} */
  let mark = null;
  if (defaultValue != null && max > min) {
    mark = document.createElement("div");
    mark.className = "cad-slider-default";
    mark.title = `Reset to default (${defaultValue})`;
    mark.style.left = `${pct(defaultValue)}%`;
    mark.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      e.preventDefault();
    });
    mark.addEventListener("click", (e) => {
      e.stopPropagation();
      setValue(defaultValue, true);
      opts.onCommit(defaultValue);
    });
    track.appendChild(mark);
  }
  root.appendChild(track);

  function pct(v) {
    if (!(max > min)) return 0;
    return Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));
  }

  function snap(v) {
    let n = Math.max(min, Math.min(max, v));
    if (step > 0) {
      const k = Math.round((n - min) / step);
      n = min + k * step;
    }
    const decimals = step >= 1 ? 0 : Math.max(0, -Math.floor(Math.log10(step)));
    const f = 10 ** decimals;
    return Math.round(n * f) / f;
  }

  function paint() {
    range.style.width = `${pct(value)}%`;
    root.setAttribute("aria-valuenow", String(value));
    if (mark) {
      mark.style.display = value === defaultValue ? "none" : "";
    }
  }

  function setValue(v, commitPaint = true) {
    value = snap(v);
    if (commitPaint) paint();
    return value;
  }

  function valueFromClientX(clientX) {
    const rect = track.getBoundingClientRect();
    const w = rect.width || 1;
    const x = Math.min(Math.max(clientX, rect.left), rect.right);
    const ratio = (x - rect.left) / w;
    return snap(min + ratio * (max - min));
  }

  let dragging = false;
  let pointerId = null;

  track.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    dragging = true;
    pointerId = e.pointerId;
    track.setPointerCapture(e.pointerId);
    root.classList.add("is-active");
    const v = valueFromClientX(e.clientX);
    setValue(v);
    opts.onChange(value);
    e.preventDefault();
  });

  track.addEventListener("pointermove", (e) => {
    if (!dragging || e.pointerId !== pointerId) return;
    const v = valueFromClientX(e.clientX);
    setValue(v);
    opts.onChange(value);
  });

  function endDrag(e) {
    if (!dragging) return;
    if (e && pointerId != null && e.pointerId !== pointerId) return;
    dragging = false;
    root.classList.remove("is-active");
    try {
      if (pointerId != null) track.releasePointerCapture(pointerId);
    } catch {
      /* ignore */
    }
    pointerId = null;
    opts.onCommit(value);
  }

  track.addEventListener("pointerup", endDrag);
  track.addEventListener("pointercancel", endDrag);

  root.addEventListener("keydown", (e) => {
    let next = value;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = value - step;
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") next = value + step;
    else if (e.key === "Home") next = min;
    else if (e.key === "End") next = max;
    else if (e.key === "PageDown") next = value - step * 10;
    else if (e.key === "PageUp") next = value + step * 10;
    else return;
    e.preventDefault();
    setValue(next);
    opts.onChange(value);
    opts.onCommit(value);
  });

  paint();

  return {
    el: root,
    get value() {
      return value;
    },
    /**
     * External value apply from store/sheet.
     * Always silent: never fires onChange/onCommit (avoids feedback loops).
     * The `{ silent }` option is accepted for API symmetry and is always treated as true.
     */
    setValue(v, _opts = {}) {
      setValue(v);
    },
  };
}

function clamp(n, lo, hi) {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
