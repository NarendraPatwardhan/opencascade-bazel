/**
 * Phase A: Monaco completion + hover from cad-api-catalog.
 * Registers once per monaco instance for language id "luau".
 */

import {
  SOLID_METHODS,
  ROUTE_METHODS,
  FRAMES_METHODS,
  QUERY_METHODS,
  IR_METHODS,
  MODULES,
  SNIPPETS,
  LUAU_KEYWORDS,
} from "./cad-api-catalog.js";

const LANG = "luau";
let registered = false;

/** @type {{ prefix: string, methods: import('./cad-api-catalog.js').CadMethod[] }[]} */
const DOT_TABLES = [
  { prefix: "solid", methods: SOLID_METHODS },
  { prefix: "route", methods: ROUTE_METHODS },
  { prefix: "frames", methods: FRAMES_METHODS },
  { prefix: "query", methods: QUERY_METHODS },
  { prefix: "ir", methods: IR_METHODS },
];

const ALL_METHODS = [
  ...SOLID_METHODS,
  ...ROUTE_METHODS,
  ...FRAMES_METHODS,
  ...QUERY_METHODS,
  ...IR_METHODS,
];

/**
 * @param {import('monaco-editor')} monaco
 */
export function registerCadCompletions(monaco) {
  if (registered) return;
  registered = true;

  const Kind = monaco.languages.CompletionItemKind;

  monaco.languages.registerCompletionItemProvider(LANG, {
    triggerCharacters: [".", '"', "'", "{", ",", " "],
    provideCompletionItems(model, position) {
      const line = model.getLineContent(position.lineNumber);
      const until = line.slice(0, position.column - 1);
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      /** @type {import('monaco-editor').languages.CompletionItem[]} */
      const suggestions = [];

      // mod.<method> for solid / route / frames / query / ir
      for (const { prefix, methods } of DOT_TABLES) {
        const re = new RegExp(`\\b${prefix}\\s*\\.\\s*([A-Za-z_]*)$`);
        if (re.test(until)) {
          for (const m of methods) {
            suggestions.push({
              label: m.name,
              kind: Kind.Method,
              detail: m.returns ? `→ ${m.returns}` : prefix,
              documentation: { value: methodMarkdown(m) },
              insertText: m.insertText,
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
              sortText: `0_${m.name}`,
            });
          }
          return { suggestions };
        }
      }

      // cad.solid / cad.route / … (aggregator fields)
      if (/\bcad\s*\.\s*([A-Za-z_]*)$/.test(until)) {
        for (const name of ["solid", "route", "frames", "query", "ir"]) {
          suggestions.push({
            label: name,
            kind: Kind.Module,
            detail: "cad.*",
            documentation: MODULES.find((m) => m.name === name)?.documentation,
            insertText: name,
            range,
            sortText: `0_${name}`,
          });
        }
        return { suggestions };
      }

      // require("…
      if (/require\s*\(\s*["'][^"']*$/.test(until)) {
        for (const mod of MODULES) {
          const bare = mod.name;
          suggestions.push({
            label: bare,
            kind: Kind.Module,
            detail: "module",
            documentation: mod.documentation,
            insertText: bare,
            range,
            sortText: `0_${bare}`,
          });
        }
        return { suggestions };
      }

      // General: methods as prefix.x + modules + snippets + keywords
      for (const { prefix, methods } of DOT_TABLES) {
        for (const m of methods) {
          suggestions.push({
            label: m.label,
            kind: Kind.Method,
            detail: m.returns ? `→ ${m.returns}` : undefined,
            documentation: { value: methodMarkdown(m) },
            insertText: `${prefix}.${m.insertText}`,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range,
            sortText: `1_${prefix}_${m.name}`,
          });
        }
      }

      for (const mod of MODULES) {
        suggestions.push({
          label: mod.label,
          kind: Kind.Module,
          documentation: mod.documentation,
          insertText: mod.insertText,
          range,
          sortText: `2_${mod.name}`,
        });
      }

      for (const sn of SNIPPETS) {
        suggestions.push({
          label: sn.label,
          kind: Kind.Snippet,
          documentation: sn.documentation,
          insertText: sn.insertText,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
          sortText: `3_${sn.label}`,
        });
      }

      for (const kw of LUAU_KEYWORDS) {
        suggestions.push({
          label: kw,
          kind: Kind.Keyword,
          insertText: kw,
          range,
          sortText: `9_${kw}`,
        });
      }

      return { suggestions };
    },
  });

  monaco.languages.registerHoverProvider(LANG, {
    provideHover(model, position) {
      const word = model.getWordAtPosition(position);
      if (!word) return null;
      const name = word.word;

      const line = model.getLineContent(position.lineNumber);
      const before = line.slice(0, word.startColumn - 1);

      for (const { prefix, methods } of DOT_TABLES) {
        const re = new RegExp(`\\b${prefix}\\s*\\.\\s*$`);
        if (re.test(before) || before.endsWith(`${prefix}.`)) {
          const method = methods.find((m) => m.name === name);
          if (method) {
            return {
              range: new monaco.Range(
                position.lineNumber,
                word.startColumn,
                position.lineNumber,
                word.endColumn,
              ),
              contents: [{ value: methodMarkdown(method) }],
            };
          }
        }
      }

      const method = ALL_METHODS.find((m) => m.name === name);
      if (method) {
        return {
          range: new monaco.Range(
            position.lineNumber,
            word.startColumn,
            position.lineNumber,
            word.endColumn,
          ),
          contents: [{ value: methodMarkdown(method) }],
        };
      }

      const mod = MODULES.find((m) => m.name === name);
      if (mod) {
        return {
          contents: [
            { value: `**${mod.name}**` },
            { value: mod.documentation || "" },
          ],
        };
      }

      // Param field names inside tables: dx, dy, radius, …
      const paramHits = [];
      for (const m of ALL_METHODS) {
        for (const p of m.params || []) {
          if (p.name === name) paramHits.push({ method: m.label, param: p });
        }
      }
      if (paramHits.length === 1) {
        const { method, param } = paramHits[0];
        return {
          contents: [
            { value: `**${param.name}** \`${param.type || "any"}\` — *${method}*` },
            { value: param.documentation || "" },
          ],
        };
      }
      if (paramHits.length > 1) {
        const lines = paramHits.map(
          ({ method, param }) =>
            `- **${param.name}** (\`${param.type || "any"}\`) on *${method}*${param.documentation ? `: ${param.documentation}` : ""}`,
        );
        return { contents: [{ value: lines.join("\n") }] };
      }

      return null;
    },
  });
}

/**
 * @param {CadMethod} m
 */
function methodMarkdown(m) {
  const params = (m.params || [])
    .map((p) => {
      const opt = p.optional ? "?" : "";
      const doc = p.documentation ? ` — ${p.documentation}` : "";
      return `- \`${p.name}${opt}\`: \`${p.type || "any"}\`${doc}`;
    })
    .join("\n");
  const ret = m.returns ? `\n\n**Returns:** \`${m.returns}\`` : "";
  return `### \`${m.label}\`\n\n${m.documentation || ""}${params ? `\n\n**Parameters**\n${params}` : ""}${ret}`;
}
