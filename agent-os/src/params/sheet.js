/**
 * Parameter sheet — CADAM-faithful layout & chrome (reimplemented).
 * Row: [label 80px] [slider | number | unit]  — single line, dense type.
 */

import { autoStep } from "./types.js";
import { createCadamSlider } from "./slider.js";

/**
 * @param {HTMLElement} host
 * @param {ReturnType<import('./store.js').createParamStore>} store
 * @param {{ debounceMs?: number }} [opts]
 */
export function mountParamSheet(host, store, opts = {}) {
  const debounceMs = opts.debounceMs ?? 200;
  host.classList.add("param-sheet");
  host.replaceChildren();

  const header = document.createElement("div");
  header.className = "param-sheet-header";
  const title = document.createElement("span");
  title.className = "param-sheet-title";
  title.textContent = "Parameters";
  header.appendChild(title);

  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "param-sheet-reset";
  resetBtn.title = "Reset all parameters";
  resetBtn.setAttribute("aria-label", "Reset all parameters");
  resetBtn.innerHTML =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>';
  resetBtn.addEventListener("click", () => store.reset());
  header.appendChild(resetBtn);
  host.appendChild(header);

  const body = document.createElement("div");
  body.className = "param-sheet-body";
  host.appendChild(body);

  /** @type {Map<string, ReturnType<typeof setTimeout>>} */
  const timers = new Map();
  /** @type {Map<string, any>} */
  const inputs = new Map();

  function scheduleCommit(name, value) {
    store.set(name, value, { phase: "change" });
    if (timers.has(name)) clearTimeout(timers.get(name));
    timers.set(
      name,
      setTimeout(() => {
        timers.delete(name);
        store.set(name, value, { phase: "commit", force: true });
      }, debounceMs),
    );
  }

  function commit(name, value) {
    store.set(name, value, { phase: "commit", force: true });
  }

  function parseOpt(opt) {
    if (typeof opt === "object" && opt) {
      return {
        value: String(opt.value),
        text: opt.label ?? String(opt.value),
        raw: opt.value,
      };
    }
    return { value: String(opt), text: String(opt), raw: opt };
  }

  function coerceEnum(raw) {
    const asNum = Number(raw);
    return Number.isFinite(asNum) && String(asNum) === String(raw) ? asNum : raw;
  }

  function render() {
    body.replaceChildren();
    inputs.clear();
    const params = store.list();
    /** @type {Map<string, typeof params>} */
    const groups = new Map();
    for (const p of params) {
      const g = p.group || "Main";
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(p);
    }

    for (const [gname, list] of groups) {
      const section = document.createElement("div");
      section.className = "param-group";

      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "param-group-trigger";
      trigger.innerHTML = `<span class="param-group-trigger-label">${escapeHtml(gname)}<span class="param-group-count">${list.length}</span></span><span class="param-group-chevron" aria-hidden="true">▾</span>`;
      section.appendChild(trigger);

      const content = document.createElement("div");
      content.className = "param-group-content";
      let open = true;
      trigger.setAttribute("aria-expanded", "true");
      trigger.addEventListener("click", () => {
        open = !open;
        content.hidden = !open;
        trigger.setAttribute("aria-expanded", open ? "true" : "false");
        trigger.classList.toggle("is-collapsed", !open);
      });

      for (const p of list) {
        content.appendChild(buildRow(p));
      }
      section.appendChild(content);
      body.appendChild(section);
    }
  }

  /**
   * @param {import('./types.js').Parameter} p
   */
  function buildRow(p) {
    const row = document.createElement("div");
    row.className = "param-row";
    row.dataset.name = p.name;

    const label = document.createElement("label");
    label.className = "param-label";
    label.htmlFor = `param-${p.name}`;
    label.textContent = p.displayName || p.name;
    label.title = p.displayName || p.name;
    row.appendChild(label);

    if (p.type === "boolean") {
      const sw = document.createElement("button");
      sw.type = "button";
      sw.className = "param-switch";
      sw.id = `param-${p.name}`;
      sw.setAttribute("role", "switch");
      sw.setAttribute("aria-checked", p.value ? "true" : "false");
      if (p.value) sw.classList.add("is-on");
      const thumb = document.createElement("span");
      thumb.className = "param-switch-thumb";
      sw.appendChild(thumb);
      sw.addEventListener("click", () => {
        const next = !sw.classList.contains("is-on");
        sw.classList.toggle("is-on", next);
        sw.setAttribute("aria-checked", next ? "true" : "false");
        commit(p.name, next);
      });
      row.appendChild(sw);
      inputs.set(p.name, {
        _kind: "switch",
        setValue(v) {
          const on = !!v;
          sw.classList.toggle("is-on", on);
          sw.setAttribute("aria-checked", on ? "true" : "false");
        },
      });
      return row;
    }

    if (p.type === "enum" && p.options?.length) {
      const group = document.createElement("div");
      group.className = "param-toggle-group";
      group.id = `param-${p.name}`;
      group.setAttribute("role", "group");
      group.setAttribute("aria-labelledby", `param-${p.name}-label`);
      label.id = `param-${p.name}-label`;

      /** @type {HTMLButtonElement[]} */
      const buttons = [];
      const setPressed = (value) => {
        const v = String(value);
        for (const btn of buttons) {
          btn.setAttribute(
            "aria-pressed",
            btn.dataset.value === v ? "true" : "false",
          );
        }
      };

      for (const opt of p.options) {
        const { value, text } = parseOpt(opt);
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "param-toggle-item";
        btn.dataset.value = value;
        btn.textContent = text;
        btn.title = text;
        btn.setAttribute(
          "aria-pressed",
          String(p.value) === value ? "true" : "false",
        );
        btn.addEventListener("click", () => {
          setPressed(value);
          commit(p.name, coerceEnum(value));
        });
        buttons.push(btn);
        group.appendChild(btn);
      }
      row.appendChild(group);
      inputs.set(p.name, {
        _kind: "toggle",
        setValue(v) {
          setPressed(v);
        },
      });
      return row;
    }

    // Number (default): slider + compact value + unit  (CADAM ParameterInput)
    const step = autoStep(p);
    const min = p.min != null ? Number(p.min) : 0;
    const max = p.max != null ? Number(p.max) : 100;
    const hasRange = p.min != null && p.max != null && max > min;

    const controls = document.createElement("div");
    controls.className = "param-controls";

    /** @type {ReturnType<typeof createCadamSlider> | null} */
    let slider = null;
    if (hasRange) {
      slider = createCadamSlider({
        min,
        max,
        step,
        value: Number(p.value),
        defaultValue: p.defaultValue,
        id: `param-${p.name}`,
        onChange(v) {
          num.value = formatNum(v, step);
          scheduleCommit(p.name, v);
        },
        onCommit(v) {
          num.value = formatNum(v, step);
          commit(p.name, v);
        },
      });
      controls.appendChild(slider.el);
    }

    const valueWrap = document.createElement("div");
    valueWrap.className = "param-value-wrap";

    const num = document.createElement("input");
    num.type = "text";
    num.inputMode = "decimal";
    num.autocomplete = "off";
    num.className = "param-number";
    if (!hasRange) num.id = `param-${p.name}`;
    num.value = formatNum(Number(p.value), step);
    num.addEventListener("focus", () => num.select());
    num.addEventListener("keydown", (e) => {
      if (e.key === "Enter") num.blur();
    });
    num.addEventListener("input", () => {
      const v = Number(num.value);
      if (!Number.isFinite(v)) return;
      if (slider) slider.setValue(v, { silent: true });
      scheduleCommit(p.name, v);
    });
    num.addEventListener("change", () => {
      let v = Number(num.value);
      if (!Number.isFinite(v)) v = Number(p.defaultValue) || 0;
      if (p.min != null && v < p.min) v = p.min;
      if (p.max != null && v > p.max) v = p.max;
      num.value = formatNum(v, step);
      if (slider) slider.setValue(v, { silent: true });
      commit(p.name, v);
    });
    valueWrap.appendChild(num);

    const unit = document.createElement("span");
    unit.className = "param-unit";
    unit.textContent = p.unit || "";
    valueWrap.appendChild(unit);

    controls.appendChild(valueWrap);
    row.appendChild(controls);

    inputs.set(p.name, {
      _kind: "number",
      setValue(v) {
        const n = Number(v);
        num.value = formatNum(n, step);
        if (slider) slider.setValue(n, { silent: true });
      },
    });
    return row;
  }

  render();
  const unsub = store.subscribe((params, meta) => {
    if (meta.tier === "replace" || meta.tier === "reset") {
      render();
      return;
    }
    if (meta.name && inputs.has(meta.name)) {
      const p = params.find((x) => x.name === meta.name);
      if (!p) return;
      const el = inputs.get(meta.name);
      if (el && typeof el.setValue === "function") el.setValue(p.value);
    }
  });

  return {
    render,
    refresh: render,
    dispose() {
      unsub();
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      host.replaceChildren();
    },
  };
}

function formatNum(v, step) {
  if (!Number.isFinite(v)) return "0";
  const decimals =
    step >= 1 ? 0 : Math.max(0, -Math.floor(Math.log10(step || 1)));
  if (decimals <= 0) return String(Math.round(v));
  return String(Number(v.toFixed(decimals)));
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
