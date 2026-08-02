/**
 * Monaco Editor + Luau Monarch language.
 *
 * Loader: @monaco-editor/loader → monaco-editor AMD bundle.
 * Language: monaco-luau-language.js (icebearc/monaco-luau MIT lineage).
 * Phase A: cad-api-catalog completions + hover.
 * Phase B: markers applied from luau-analyze (via setAnalyzeMarkers).
 */

import { registerLuauLanguage } from "./monaco-luau-language.js";
import { registerCadCompletions } from "./monaco-cad-complete.js";

/**
 * @typedef {object} LuauEditorHandle
 * @property {() => string} getValue
 * @property {(doc: string) => void} setValue
 * @property {() => void} focus
 * @property {() => boolean} hasTextFocus
 * @property {() => void} destroy
 * @property {() => import('monaco-editor').editor.ITextModel | null} getModel
 * @property {(diags: import('./analyze-parse.js').CadDiagnostic[]) => void} setAnalyzeMarkers
 * @property {() => void} clearAnalyzeMarkers
 * @property {import('monaco-editor')} monaco
 */

const MARKER_OWNER = "luau-analyze";

let monacoPromise;

async function loadMonaco() {
  if (monacoPromise) return monacoPromise;
  monacoPromise = (async () => {
    const loaderMod = await import("https://cdn.jsdelivr.net/npm/@monaco-editor/loader@1.5.0/+esm");
    const loader = loaderMod.default;
    loader.config({
      paths: {
        vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs",
      },
    });
    const monaco = await loader.init();
    registerLuauLanguage(monaco);
    registerCadCompletions(monaco);
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

  monaco.editor.defineTheme("occ-cad-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#1a1b1b",
      "editor.foreground": "#e5e5e5",
      "editorLineNumber.foreground": "#5a5a5a",
      "editorLineNumber.activeForeground": "#949494",
      "editor.selectionBackground": "#00a6ff33",
      "editor.lineHighlightBackground": "#ffffff08",
      "editorCursor.foreground": "#00a6ff",
      "editorWidget.background": "#212121",
      "editorWidget.border": "#3b3b3b",
      "editorSuggestWidget.background": "#212121",
      "editorSuggestWidget.border": "#3b3b3b",
      "scrollbarSlider.background": "#3b3b3b66",
      "scrollbarSlider.hoverBackground": "#5a5a5a99",
    },
  });
  monaco.editor.setTheme("occ-cad-dark");

  const editor = monaco.editor.create(parent, {
    value: opts.doc ?? "",
    language: "luau",
    theme: "occ-cad-dark",
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 13,
    fontFamily: 'var(--mono, ui-monospace, "SF Mono", Menlo, monospace)',
    lineNumbers: "on",
    scrollBeyondLastLine: false,
    wordWrap: "on",
    tabSize: 2,
    renderLineHighlight: "line",
    padding: { top: 12, bottom: 12 },
    overviewRulerLanes: 0,
    hideCursorInOverviewRuler: true,
    overviewRulerBorder: false,
    scrollbar: {
      verticalScrollbarSize: 8,
      horizontalScrollbarSize: 8,
    },
    quickSuggestions: {
      other: true,
      comments: false,
      strings: true,
    },
    suggestOnTriggerCharacters: true,
    wordBasedSuggestions: "off",
    snippetSuggestions: "inline",
    parameterHints: { enabled: true },
  });

  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
    opts.onRun?.(editor.getValue());
  });

  editor.onDidChangeModelContent(() => {
    opts.onChange?.(editor.getValue());
  });

  if (opts.autoFocus) editor.focus();

  const severityMap = {
    error: monaco.MarkerSeverity.Error,
    warning: monaco.MarkerSeverity.Warning,
    info: monaco.MarkerSeverity.Info,
  };

  return {
    monaco,
    getValue: () => editor.getValue(),
    setValue: (doc) => {
      if (editor.getValue() !== doc) editor.setValue(doc);
    },
    focus: () => editor.focus(),
    /** True when Monaco's text surface owns keyboard input (not just widget chrome). */
    hasTextFocus: () => {
      try {
        return !!editor.hasTextFocus?.();
      } catch {
        return false;
      }
    },
    destroy: () => editor.dispose(),
    getModel: () => editor.getModel(),
    clearAnalyzeMarkers: () => {
      const model = editor.getModel();
      if (model) monaco.editor.setModelMarkers(model, MARKER_OWNER, []);
    },
    setAnalyzeMarkers: (diags) => {
      const model = editor.getModel();
      if (!model) return;
      const markers = (diags || []).map((d) => {
        const line = Math.min(Math.max(1, d.line), model.getLineCount());
        const lineLen = model.getLineMaxColumn(line);
        const col = Math.min(Math.max(1, d.column), lineLen);
        return {
          severity: severityMap[d.severity] ?? monaco.MarkerSeverity.Error,
          message: d.message,
          startLineNumber: line,
          startColumn: col,
          endLineNumber: line,
          endColumn: Math.min(lineLen, col + 1),
          source: "luau-analyze",
        };
      });
      monaco.editor.setModelMarkers(model, MARKER_OWNER, markers);
    },
  };
}
