/**
 * Monaco Editor + Luau Monarch language (not CodeMirror legacy-modes).
 *
 * Loader: @monaco-editor/loader (jsDelivr ESM) → monaco-editor AMD bundle.
 * Language: ./monaco-luau-language.js (adapted from icebearc/monaco-luau MIT).
 *
 * API mirrors the previous CM helper so main.js stays small.
 */

import { registerLuauLanguage } from "./monaco-luau-language.js";

/**
 * @typedef {object} LuauEditorHandle
 * @property {() => string} getValue
 * @property {(doc: string) => void} setValue
 * @property {() => void} focus
 * @property {() => void} destroy
 */

let monacoPromise;

async function loadMonaco() {
  if (monacoPromise) return monacoPromise;
  monacoPromise = (async () => {
    const loaderMod = await import("https://cdn.jsdelivr.net/npm/@monaco-editor/loader@1.5.0/+esm");
    const loader = loaderMod.default;
    // Pin monaco-editor build used by the loader.
    loader.config({
      paths: {
        vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs",
      },
    });
    const monaco = await loader.init();
    registerLuauLanguage(monaco);
    return monaco;
  })();
  return monacoPromise;
}

/**
 * @param {object} opts
 * @param {HTMLElement} opts.parent
 * @param {string} [opts.doc]
 * @param {(doc: string) => void} [opts.onChange]
 * @param {(doc: string) => void} [opts.onRun]
 * @param {boolean} [opts.autoFocus]
 * @returns {Promise<LuauEditorHandle>}
 */
export async function mountLuauEditor(opts) {
  const monaco = await loadMonaco();
  const parent = opts.parent;
  parent.replaceChildren();
  parent.classList.add("monaco-host");

  const editor = monaco.editor.create(parent, {
    value: opts.doc ?? "",
    language: "luau",
    theme: "vs-dark",
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 13,
    fontFamily: 'var(--mono, ui-monospace, "SF Mono", Menlo, monospace)',
    lineNumbers: "on",
    scrollBeyondLastLine: false,
    wordWrap: "on",
    tabSize: 2,
    renderLineHighlight: "line",
    padding: { top: 10, bottom: 10 },
    // Avoid worker CDN issues for demo: disable features that need workers if they fail.
    quickSuggestions: false,
    suggestOnTriggerCharacters: false,
  });

  // Ctrl/Cmd-Enter → run (same as agent-os-search mc-editor)
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
    opts.onRun?.(editor.getValue());
  });

  editor.onDidChangeModelContent(() => {
    opts.onChange?.(editor.getValue());
  });

  if (opts.autoFocus) editor.focus();

  return {
    getValue: () => editor.getValue(),
    setValue: (doc) => {
      if (editor.getValue() !== doc) editor.setValue(doc);
    },
    focus: () => editor.focus(),
    destroy: () => editor.dispose(),
  };
}
