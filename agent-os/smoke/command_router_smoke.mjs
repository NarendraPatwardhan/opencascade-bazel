#!/usr/bin/env node
/**
 * Unit smoke: view command focus policy (no full browser).
 *   node agent-os/smoke/command_router_smoke.mjs
 */

import {
  isNativeTextEntry,
  isParamChrome,
  isTextEntryTarget,
  shouldHandleViewKey,
  blurActiveToView,
  installViewKeyRouter,
} from "../src/view/command-router.js";

let failed = 0;
function expect(cond, msg) {
  if (!cond) {
    failed++;
    console.error("FAIL:", msg);
  } else {
    console.log("ok:", msg);
  }
}

function el(tag, opts = {}) {
  const className = opts.className || "";
  const type = opts.type;
  const contentEditable = opts.contentEditable;
  const attrs = opts.attrs || {};
  const ancestors = opts.ancestors || [];
  const node = {
    tagName: tag.toUpperCase(),
    type,
    isContentEditable: !!contentEditable,
    className,
    blur() {
      node._blurred = true;
    },
    focus() {
      node._focused = true;
    },
    getAttribute(name) {
      if (name === "contenteditable") {
        if (contentEditable === true) return "true";
        if (contentEditable === "") return "";
        return null;
      }
      return attrs[name] ?? null;
    },
    closest(sel) {
      const chain = [node, ...ancestors];
      for (const c of chain) {
        if (sel.includes(".monaco-editor") && c.className?.includes("monaco-editor"))
          return c;
        if (sel.includes(".cad-slider") && c.className?.includes("cad-slider"))
          return c;
        if (sel.includes(".param-switch") && c.className?.includes("param-switch"))
          return c;
        if (sel.includes(".param-toggle-item") && c.className?.includes("param-toggle-item"))
          return c;
        if (sel.includes(".param-group-trigger") && c.className?.includes("param-group-trigger"))
          return c;
        if (sel.includes(".param-toggle-group") && c.className?.includes("param-toggle-group"))
          return c;
        if (sel.includes(".param-sheet") && c.className?.includes("param-sheet"))
          return c;
        if (sel.includes(".param-number") && c.className?.includes("param-number"))
          return c;
        if (sel.includes("contenteditable")) {
          if (c.isContentEditable || c.getAttribute?.("contenteditable") === "true")
            return c;
        }
      }
      return null;
    },
  };
  return node;
}

const input = el("input", { type: "text" });
const checkbox = el("input", { type: "checkbox" });
const range = el("input", { type: "range" });
const ta = el("textarea");
const select = el("select");
const slider = el("div", { className: "cad-slider" });
const sw = el("button", { className: "param-switch" });
const toggle = el("button", { className: "param-toggle-item" });
const groupTrig = el("button", { className: "param-group-trigger" });
const toggleGroup = el("div", { className: "param-toggle-group" });
const editable = el("div", { contentEditable: true });
const editableChild = el("span", {
  ancestors: [el("div", { contentEditable: true })],
});
const monacoTa = el("textarea", {
  className: "inputarea",
  ancestors: [el("div", { className: "monaco-editor" })],
});
const div = el("div");

expect(isNativeTextEntry(input) === true, "input text is text entry");
expect(isNativeTextEntry(checkbox) === false, "checkbox is not text entry");
expect(isNativeTextEntry(range) === false, "range is not text entry");
expect(isNativeTextEntry(ta) === true, "textarea is text entry");
expect(isNativeTextEntry(select) === true, "select is text entry");
expect(isNativeTextEntry(editable) === true, "contenteditable is text entry");
expect(isNativeTextEntry(editableChild) === true, "contenteditable ancestor is text entry");
expect(isNativeTextEntry(slider) === false, "slider div not native text");
expect(isParamChrome(slider) === true, "cad-slider is param chrome");
expect(isParamChrome(sw) === true, "param-switch is param chrome");
expect(isParamChrome(toggle) === true, "param-toggle-item is param chrome");
expect(isParamChrome(groupTrig) === true, "param-group-trigger is param chrome");
expect(isParamChrome(toggleGroup) === true, "param-toggle-group is param chrome");
expect(isParamChrome(input) === false, "plain input not param chrome");

expect(
  isTextEntryTarget({ target: input }) === true,
  "text entry: native input",
);
expect(
  isTextEntryTarget({ target: slider }) === false,
  "text entry: slider is not",
);
expect(
  isTextEntryTarget({ target: div }, { isEditorFocused: () => true }) === true,
  "text entry: editor hasTextFocus wins",
);
expect(
  isTextEntryTarget({ target: monacoTa }) === true,
  "text entry: monaco surface",
);
expect(
  isTextEntryTarget({ target: editable }) === true,
  "text entry: contenteditable",
);

const keyF = (target, extra = {}) =>
  /** @type {any} */ ({
    key: "f",
    target,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    ...extra,
  });

expect(
  shouldHandleViewKey(keyF(slider)) === true,
  "view key: F on slider → handle",
);
expect(
  shouldHandleViewKey(keyF(toggle)) === true,
  "view key: F on toggle-item → handle",
);
expect(
  shouldHandleViewKey(keyF(groupTrig)) === true,
  "view key: F on group-trigger → handle",
);
expect(
  shouldHandleViewKey(keyF(checkbox)) === true,
  "view key: F on checkbox → handle",
);
expect(
  shouldHandleViewKey(keyF(range)) === true,
  "view key: F on range → handle",
);
expect(
  shouldHandleViewKey(keyF(div)) === true,
  "view key: F on plain div → handle",
);
expect(
  shouldHandleViewKey(keyF(input)) === false,
  "view key: F on input → skip",
);
expect(
  shouldHandleViewKey(keyF(select)) === false,
  "view key: F on select → skip",
);
expect(
  shouldHandleViewKey(keyF(editable)) === false,
  "view key: F on contenteditable → skip",
);
expect(
  shouldHandleViewKey(keyF(div), { isEditorFocused: () => true }) === false,
  "view key: F while Monaco focused → skip",
);
expect(
  shouldHandleViewKey(keyF(slider, { ctrlKey: true })) === false,
  "view key: Ctrl+F → skip",
);
expect(
  shouldHandleViewKey(keyF(slider, { metaKey: true })) === false,
  "view key: Meta+F → skip",
);
expect(
  shouldHandleViewKey(keyF(slider, { altKey: true })) === false,
  "view key: Alt+F → skip",
);
expect(
  shouldHandleViewKey(keyF(slider, { defaultPrevented: true })) === false,
  "view key: defaultPrevented → skip",
);
expect(
  shouldHandleViewKey(keyF(slider, { repeat: true })) === false,
  "view key: key-repeat → skip",
);
expect(
  shouldHandleViewKey(keyF(slider, { /* Shift allowed */ })) === true,
  "view key: Shift not set → handle (Shift allowed when present)",
);
// Shift alone does not suppress (no shiftKey check)
expect(
  shouldHandleViewKey({ ...keyF(slider), shiftKey: true }) === true,
  "view key: Shift+F → handle",
);

// --- Escape / blurActiveToView + dispose with document/window mocks ---
{
  const canvas = el("canvas");
  canvas.focus = () => {
    canvas._focused = true;
  };

  // Mock document.activeElement as slider
  const g = globalThis;
  const prevDoc = g.document;
  const prevWin = g.window;

  const listeners = new Map();
  g.window = {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
  };

  let active = slider;
  g.document = {
    get activeElement() {
      return active;
    },
    body: el("body"),
    documentElement: el("html"),
  };

  const blurred = blurActiveToView({ getViewSurface: () => canvas });
  expect(blurred === true, "escape blur: slider blurred");
  expect(slider._blurred === true, "escape blur: blur() called");
  expect(canvas._focused === true, "escape blur: canvas focused");

  // Monaco active → refuse
  active = monacoTa;
  const refuse = blurActiveToView({ getViewSurface: () => canvas });
  expect(refuse === false, "escape blur: monaco refused");

  // dispose unsubscribes
  let fitCount = 0;
  const dispose = installViewKeyRouter({
    handlers: { fit: () => fitCount++ },
    getViewSurface: () => canvas,
  });
  expect(listeners.get("keydown")?.size === 1, "router: installed listener");
  const handler = [...listeners.get("keydown")][0];
  handler(keyF(div));
  expect(fitCount === 1, "router: fit fired once");
  handler(keyF(div, { repeat: true }));
  expect(fitCount === 1, "router: repeat ignored");
  dispose();
  expect(listeners.get("keydown")?.size === 0, "router: dispose removes listener");

  // Escape with isEditorFocused skips preventDefault path (no throw)
  active = slider;
  let escapePd = false;
  const dispose2 = installViewKeyRouter({
    isEditorFocused: () => true,
    handlers: {},
    getViewSurface: () => canvas,
  });
  const escHandler = [...listeners.get("keydown")][0];
  escHandler({
    key: "Escape",
    repeat: false,
    preventDefault() {
      escapePd = true;
    },
  });
  expect(escapePd === false, "escape: Monaco focused → no preventDefault");
  dispose2();

  g.document = prevDoc;
  g.window = prevWin;
}

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log("\ncommand_router_smoke: all passed");
