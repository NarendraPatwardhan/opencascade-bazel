/**
 * Phase A: Monaco completion + hover from cad-api-catalog.
 * Registers once per monaco instance for language id "luau".
 */

import {
  SOLID_METHODS,
  MODULES,
  SNIPPETS,
  LUAU_KEYWORDS,
} from "./cad-api-catalog.js";

const LANG = "luau";
let registered = false;

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

      // solid.<method>
      const solidDot = until.match(/solid\s*\.\s*([A-Za-z_]*)$/);
      if (solidDot) {
        for (const m of SOLID_METHODS) {
          suggestions.push({
            label: m.name,
            kind: Kind.Method,
            detail: m.returns ? `→ ${m.returns}` : "solid",
            documentation: { value: methodMarkdown(m) },
            insertText: m.insertText,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range,
            sortText: `0_${m.name}`,
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

      // After "local solid = " or general: solid module + methods as solid.x + snippets + keywords
      for (const m of SOLID_METHODS) {
        suggestions.push({
          label: m.label,
          kind: Kind.Method,
          detail: m.returns ? `→ ${m.returns}` : undefined,
          documentation: { value: methodMarkdown(m) },
          insertText: `solid.${m.insertText}`,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
          sortText: `1_${m.name}`,
        });
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

      // solid.method: hover on method name after a dot
      const line = model.getLineContent(position.lineNumber);
      const before = line.slice(0, word.startColumn - 1);
      if (/\bsolid\s*\.\s*$/.test(before) || before.endsWith("solid.")) {
        const method = SOLID_METHODS.find((m) => m.name === name);
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

      const method = SOLID_METHODS.find((m) => m.name === name);
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
      for (const m of SOLID_METHODS) {
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
