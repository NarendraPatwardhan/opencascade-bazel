/**
 * Parameter sheet — sliders write the store; host eval is always live.
 * No Apply / Live checkbox (product noise).
 */

import { autoStep } from "./types.js";

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
  header.innerHTML = `<h2>Parameters</h2>`;
  host.appendChild(header);

  const body = document.createElement("div");
  body.className = "param-sheet-body";
  host.appendChild(body);

  const actions = document.createElement("div");
  actions.className = "param-sheet-actions";
  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.textContent = "Reset";
  resetBtn.addEventListener("click", () => store.reset());
  actions.appendChild(resetBtn);
  host.appendChild(actions);

  /** @type {Map<string, ReturnType<typeof setTimeout>>} */
  const timers = new Map();
  /** @type {Map<string, HTMLElement>} */
  const inputs = new Map();

  function commitNumber(name, value, phase) {
    store.set(name, value, { phase });
  }

  function scheduleCommit(name, value) {
    // change → xform/view live; rebuild also live (debounced by scheduler)
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
      const title = document.createElement("div");
      title.className = "param-group-title";
      title.textContent = gname;
      section.appendChild(title);

      for (const p of list) {
        const row = document.createElement("div");
        row.className = "param-row";
        row.dataset.name = p.name;

        const label = document.createElement("label");
        label.className = "param-label";
        label.htmlFor = `param-${p.name}`;
        label.textContent = p.displayName || p.name;
        if (p.unit) {
          const u = document.createElement("span");
          u.className = "param-unit";
          u.textContent = p.unit;
          label.appendChild(u);
        }
        row.appendChild(label);

        if (p.type === "boolean") {
          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.id = `param-${p.name}`;
          cb.checked = !!p.value;
          cb.addEventListener("change", () => {
            store.set(p.name, cb.checked, { phase: "commit" });
          });
          row.appendChild(cb);
          inputs.set(p.name, cb);
        } else if (p.type === "enum" && p.options?.length) {
          const sel = document.createElement("select");
          sel.id = `param-${p.name}`;
          sel.className = "param-select";
          for (const opt of p.options) {
            const o = document.createElement("option");
            if (typeof opt === "object" && opt) {
              o.value = String(opt.value);
              o.textContent = opt.label ?? String(opt.value);
            } else {
              o.value = String(opt);
              o.textContent = String(opt);
            }
            if (String(p.value) === o.value) o.selected = true;
            sel.appendChild(o);
          }
          sel.addEventListener("change", () => {
            const raw = sel.value;
            const asNum = Number(raw);
            store.set(
              p.name,
              Number.isFinite(asNum) && String(asNum) === raw ? asNum : raw,
              { phase: "commit" },
            );
          });
          row.appendChild(sel);
          inputs.set(p.name, sel);
        } else {
          const step = autoStep(p);
          const sliderWrap = document.createElement("div");
          sliderWrap.className = "param-slider-wrap";
          const span =
            p.min != null && p.max != null ? p.max - p.min : 0;
          if (span > 0 && Number.isFinite(Number(p.defaultValue))) {
            const pct = Math.max(
              0,
              Math.min(100, ((Number(p.defaultValue) - p.min) / span) * 100),
            );
            const mark = document.createElement("div");
            mark.className = "param-default-mark";
            mark.style.left = `${pct}%`;
            mark.title = `Default: ${p.defaultValue}`;
            sliderWrap.appendChild(mark);
          }
          const slider = document.createElement("input");
          slider.type = "range";
          slider.className = "param-slider";
          slider.id = `param-${p.name}`;
          if (p.min != null) slider.min = String(p.min);
          if (p.max != null) slider.max = String(p.max);
          slider.step = String(step);
          slider.value = String(p.value);
          sliderWrap.appendChild(slider);

          const num = document.createElement("input");
          num.type = "number";
          num.className = "param-number";
          if (p.min != null) num.min = String(p.min);
          if (p.max != null) num.max = String(p.max);
          num.step = String(step);
          num.value = String(p.value);

          const controls = document.createElement("div");
          controls.className = "param-controls";
          controls.appendChild(sliderWrap);
          controls.appendChild(num);
          row.appendChild(controls);

          const sync = (v) => {
            slider.value = String(v);
            num.value = String(v);
          };
          slider.addEventListener("input", () => {
            const v = Number(slider.value);
            sync(v);
            scheduleCommit(p.name, v);
          });
          slider.addEventListener("change", () => {
            const v = Number(slider.value);
            sync(v);
            commitNumber(p.name, v, "commit");
          });
          num.addEventListener("input", () => {
            const v = Number(num.value);
            if (!Number.isFinite(v)) return;
            slider.value = String(v);
            scheduleCommit(p.name, v);
          });
          num.addEventListener("change", () => {
            const v = Number(num.value);
            if (!Number.isFinite(v)) return;
            sync(v);
            commitNumber(p.name, v, "commit");
          });
          inputs.set(p.name, slider);
          inputs.set(p.name + ":num", num);
        }

        section.appendChild(row);
      }
      body.appendChild(section);
    }
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
      if (el instanceof HTMLInputElement) {
        if (el.type === "checkbox") el.checked = !!p.value;
        else el.value = String(p.value);
      } else if (el instanceof HTMLSelectElement) {
        el.value = String(p.value);
      }
      const num = inputs.get(meta.name + ":num");
      if (num instanceof HTMLInputElement) num.value = String(p.value);
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
