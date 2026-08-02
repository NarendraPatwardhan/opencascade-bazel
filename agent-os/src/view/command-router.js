/**
 * Global view-command routing (DISPLAY keyboard policy).
 *
 * Single-key view cmds (F fit, G grid, O/numpad ortho, …) fire unless focus is
 * "text entry". Param chrome (cad-slider, switches, toggles, group triggers) is
 * NOT text entry — F still fits after scrubbing a slider.
 *
 * Text entry =
 *   - Monaco has text focus (via isEditorFocused callback), or
 *   - native input/textarea/select (text-like), or
 *   - contenteditable / contenteditable ancestor
 *
 * Modifiers: Ctrl/Meta/Alt suppress view keys. Shift is allowed (Shift+F fits).
 * Key-repeat (`e.repeat`) is ignored for view cmds and Escape.
 */

/** Classes / roles that are param chrome, not text entry. */
const PARAM_CHROME_SEL =
  ".cad-slider, .param-switch, .param-toggle-item, .param-group-trigger, .param-toggle-group";

/**
 * @param {EventTarget | null | undefined} el
 * @returns {el is Element}
 */
function asElement(el) {
  return !!el && typeof /** @type {any} */ (el).closest === "function";
}

/**
 * True when the element is a native control that expects character input.
 * Checkbox / radio / button / range are not text entry.
 * @param {EventTarget | null | undefined} el
 */
export function isNativeTextEntry(el) {
  if (!asElement(el)) return false;
  const node = /** @type {HTMLElement} */ (el);
  const tag = (node.tagName || "").toLowerCase();
  if (tag === "textarea" || tag === "select") return true;
  if (tag === "input") {
    const type = String(
      /** @type {HTMLInputElement} */ (node).type || "text",
    ).toLowerCase();
    if (
      type === "button" ||
      type === "checkbox" ||
      type === "radio" ||
      type === "submit" ||
      type === "reset" ||
      type === "file" ||
      type === "image" ||
      type === "range" ||
      type === "color" ||
      type === "hidden"
    ) {
      return false;
    }
    return true;
  }
  if (node.isContentEditable) return true;
  if (node.getAttribute?.("contenteditable") === "true") return true;
  if (node.getAttribute?.("contenteditable") === "") return true;
  if (node.closest?.('[contenteditable="true"], [contenteditable=""]')) {
    return true;
  }
  return false;
}

/**
 * True when focus is on custom param sheet chrome (not the numeric input).
 * @param {EventTarget | null | undefined} el
 */
export function isParamChrome(el) {
  if (!asElement(el)) return false;
  return !!/** @type {Element} */ (el).closest(PARAM_CHROME_SEL);
}

/**
 * Is the event target (or editor) in a text-entry context?
 * @param {KeyboardEvent | { target?: EventTarget | null }} ev
 * @param {{ isEditorFocused?: () => boolean }} [opts]
 */
export function isTextEntryTarget(ev, opts = {}) {
  if (opts.isEditorFocused?.()) return true;
  const t = ev?.target;
  if (!t) return false;
  // Monaco's hidden textarea is native text entry; also treat editor surface.
  if (asElement(t) && /** @type {Element} */ (t).closest(".monaco-editor")) {
    return true;
  }
  return isNativeTextEntry(t);
}

/**
 * Should a single-key view binding handle this keydown?
 * Shift is allowed; Ctrl/Meta/Alt are not. Key-repeat is ignored.
 * @param {KeyboardEvent} ev
 * @param {{ isEditorFocused?: () => boolean }} [opts]
 */
export function shouldHandleViewKey(ev, opts = {}) {
  if (!ev || ev.defaultPrevented) return false;
  if (ev.repeat) return false;
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return false;
  if (isTextEntryTarget(ev, opts)) return false;
  return true;
}

/**
 * Blur active param / text control and optionally focus the view surface.
 * @param {{ getViewSurface?: () => HTMLElement | null | undefined }} [opts]
 * @returns {boolean} true if something was blurred / focus moved
 */
export function blurActiveToView(opts = {}) {
  const active = document.activeElement;
  if (!active || active === document.body || active === document.documentElement) {
    const surface = opts.getViewSurface?.();
    if (surface && typeof surface.focus === "function") {
      surface.focus({ preventScroll: true });
      return true;
    }
    return false;
  }
  // Never steal from Monaco — Escape there dismisses widgets.
  if (asElement(active) && /** @type {Element} */ (active).closest(".monaco-editor")) {
    return false;
  }
  if (
    isNativeTextEntry(active) ||
    isParamChrome(active) ||
    (asElement(active) &&
      /** @type {Element} */ (active).closest(".param-sheet, .param-number, .viewport-proj-btn"))
  ) {
    /** @type {HTMLElement} */ (active).blur?.();
    const surface = opts.getViewSurface?.();
    if (surface && typeof surface.focus === "function") {
      surface.focus({ preventScroll: true });
    }
    return true;
  }
  return false;
}

/**
 * Install window-level view key router.
 *
 * @param {{
 *   isEditorFocused?: () => boolean,
 *   getViewSurface?: () => HTMLElement | null | undefined,
 *   handlers: {
 *     fit?: () => void,
 *     grid?: () => void,
 *     ortho?: () => void,
 *     front?: () => void,
 *     right?: () => void,
 *     top?: () => void,
 *   },
 *   keys?: {
 *     fit?: string[],
 *     grid?: string[],
 *     ortho?: string[],
 *     front?: string[],
 *     right?: string[],
 *     top?: string[],
 *   },
 * }} opts
 * @returns {() => void} dispose
 */
export function installViewKeyRouter(opts) {
  const keys = {
    fit: opts.keys?.fit ?? ["f", "F"],
    grid: opts.keys?.grid ?? ["g", "G"],
    ortho: opts.keys?.ortho ?? ["5", "o", "O"],
    front: opts.keys?.front ?? ["1"],
    right: opts.keys?.right ?? ["3"],
    top: opts.keys?.top ?? ["7"],
  };
  const handlers = opts.handlers || {};

  /** @param {KeyboardEvent} e */
  const onKey = (e) => {
    // Ignore OS key-repeat for all view routing (incl. Escape).
    if (e.repeat) return;

    if (e.key === "Escape") {
      if (opts.isEditorFocused?.()) return;
      if (blurActiveToView({ getViewSurface: opts.getViewSurface })) {
        e.preventDefault();
      }
      return;
    }

    if (!shouldHandleViewKey(e, { isEditorFocused: opts.isEditorFocused })) {
      return;
    }

    const k = e.key;
    const run = (fn) => {
      if (!fn) return false;
      e.preventDefault();
      fn();
      return true;
    };

    if (keys.fit.includes(k)) run(handlers.fit);
    else if (keys.grid.includes(k)) run(handlers.grid);
    else if (keys.ortho.includes(k)) run(handlers.ortho);
    else if (keys.front.includes(k)) run(handlers.front);
    else if (keys.right.includes(k)) run(handlers.right);
    else if (keys.top.includes(k)) run(handlers.top);
  };

  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}
