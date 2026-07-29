/**
 * Luau Monarch language for Monaco Editor.
 *
 * Source: icebearc/monaco-luau (MIT) — client/src/language/language.ts
 *   https://github.com/icebearc/monaco-luau
 * Credits there also cite arnoson/monaco-lua-example.
 *
 * Adapted for AgentOS CAD:
 *  - language id `luau` (not `lua`)
 *  - keep Luau syntax (continue, compound assigns, type/export type)
 *  - drop Roblox-only Instance type names / Enum noise from the keyword table
 *    (harmless if present, but we are not a Roblox editor)
 *
 * This is Monaco's modern Monarch tokenizer API — not CodeMirror legacy-modes.
 */

/** @param {import('monaco-editor').languages} languages */
export function registerLuauLanguage(monaco) {
  const id = "luau";
  const already = monaco.languages.getLanguages().some((l) => l.id === id);
  if (!already) {
    monaco.languages.register({
      id,
      extensions: [".luau", ".lua"],
      aliases: ["Luau", "luau", "Lua"],
    });
  }

  monaco.languages.setLanguageConfiguration(id, languageConfiguration);
  monaco.languages.setMonarchTokensProvider(id, monarchLanguage);
  return id;
}

/** @type {import('monaco-editor').languages.LanguageConfiguration} */
export const languageConfiguration = {
  comments: {
    lineComment: "--",
    blockComment: ["--[[", "]]"],
  },
  brackets: [
    ["{", "}"],
    ["[", "]"],
    ["(", ")"],
  ],
  autoClosingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: "'", close: "'", notIn: ["string", "comment"] },
    { open: '"', close: '"', notIn: ["string", "comment"] },
  ],
  surroundingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],
  autoCloseBefore: "})]",
  indentationRules: {
    increaseIndentPattern:
      /^((?!(--)).)*((\b(function|do|repeat)\b((?!\b(end|until)\b).)*)|({\s*)|(\b(then|else)\b[;\s]*))$/,
    decreaseIndentPattern: /^\s*((\b(end|until)\b)|(\})|(\))|(\b(else)\b[;\s]*))/,
  },
};

/**
 * Monarch tokenizer — Luau-aware (continue, +=, type annotations, long strings).
 * @type {import('monaco-editor').languages.IMonarchLanguage}
 */
export const monarchLanguage = {
  defaultToken: "",
  tokenPostfix: ".luau",
  keywords:
    "and break continue do else elseif end for function if in local not or repeat return then until while next export type typeof".split(
      " ",
    ),
  constants: "true false nil".split(" "),
  brackets: [
    { token: "delimiter.bracket", open: "{", close: "}" },
    { token: "delimiter.array", open: "[", close: "]" },
    { token: "delimiter.parenthesis", open: "(", close: ")" },
  ],
  // Host / stdlib identifiers we want tinted (AgentOS + Luau stdlib).
  globals: [
    "print",
    "error",
    "warn",
    "require",
    "assert",
    "type",
    "typeof",
    "tonumber",
    "tostring",
    "pairs",
    "ipairs",
    "next",
    "select",
    "pcall",
    "xpcall",
    "unpack",
    "rawget",
    "rawset",
    "rawequal",
    "setmetatable",
    "getmetatable",
    "table",
    "string",
    "math",
    "bit32",
    "coroutine",
    "utf8",
    "buffer",
    "vector",
  ],
  operators: ["+", "-", "*", "/", "%", "^", "#", "=", "..", "...", "+=", "-=", "*=", "/=", "..=", "//", "%="],
  special_operators: ["==", "~=", "<=", ">=", "<", ">", "->"],
  symbols: /[=><!~?:&|+\-*/^%#.]+/,
  escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,
  tokenizer: {
    root: [
      [/(?=(function)(\s+[a-zA-Z_][a-zA-Z0-9_]*[\.:][a-zA-Z_][a-zA-Z0-9_]*)(\<.+\>)(\())/, "", "@function_decl"],
      [/(?=(function)(\s+[a-zA-Z_][a-zA-Z0-9_]*[\.:][a-zA-Z_][a-zA-Z0-9_]*\s*)(\())/, "", "@function_decl"],
      [/(?=(function)(\s+[a-zA-Z_][a-zA-Z0-9_]*)(\<.+\>)(\())/, "", "@function_decl"],
      [/(?=(function)(\s+[a-zA-Z_][a-zA-Z0-9_]*\s*)(\())/, "", "@function_decl"],
      [/(?=(function)(\())/, "", "@function_decl"],

      [/(?<![^.]\.|:)\b(self)\b/, "variable.language.self"],
      [
        /\b(and|break|continue|do|else|elseif|end|for|function|if|in|local|not|or|repeat|return|then|until|while|next|export|type|typeof)\b/,
        "keyword",
      ],
      [/\b(true|false|nil)\b/, "constant"],
      [/\b([a-zA-Z_][a-zA-Z0-9_]*)\b(?=\s*(?:[({\"']|\[\[))/, "entity.name.function"],
      [
        /[a-zA-Z_]\w*/,
        {
          cases: {
            "@keywords": { token: "keyword.$0" },
            "@constants": { token: "constant" },
            "@globals": { token: "variable.predefined" },
            "@default": "identifier",
          },
        },
      ],
      { include: "@whitespace" },
      [/\[([=]*)\[/, "string", "@longstring.$1"],
      [/[{}()\[\]]/, "@brackets"],
      [
        /@symbols/,
        {
          cases: {
            "@operators": "operator",
            "@special_operators": "operator",
            "@default": "operator",
          },
        },
      ],
      [/\d*\.\d+([eE][\-+]?\d+)?/, "number.float"],
      [/0[xX][0-9a-fA-F_]*[0-9a-fA-F]/, "number.hex"],
      [/0[bB][01_]*[01]/, "number.binary"],
      [/\d+/, "number"],
      [/[;,.]/, "delimiter"],
      [/"([^"\\]|\\.)*$/, "string.invalid"],
      [/'([^'\\]|\\.)*$/, "string.invalid"],
      [/"/, "string", '@string."'],
      [/'/, "string", "@string.'"],
    ],
    function_decl: [
      [/function/, "keyword"],
      [
        /(\s+[a-zA-Z_][a-zA-Z0-9_]*)([\.:])([a-zA-Z_][a-zA-Z0-9_]*\s*)/,
        ["entity.name.function", "delimiter", "entity.name.function"],
      ],
      [/\s+[a-zA-Z_][a-zA-Z0-9_]*\s*/, "entity.name.function"],
      [/\(/, "delimiter.parenthesis", "@function_params"],
      [/\)/, "delimiter.parenthesis", "@pop"],
    ],
    function_params: [
      [/\.\.\./, "variable"],
      [/[a-zA-Z_][a-zA-Z0-9_]*/, "variable"],
      [/:|\?:/, "operator"],
      [/,/, "delimiter"],
      [/(?=\))/, "", "@pop"],
    ],
    whitespace: [
      [/[ \t\r\n]+/, ""],
      [/--\[([=]*)\[/, "comment", "@comment.$1"],
      [/--.*$/, "comment"],
    ],
    comment: [
      [
        /\]([=]*)\]/,
        {
          cases: {
            "$1==$S2": { token: "comment", next: "@pop" },
            "@default": "comment",
          },
        },
      ],
      [/./, "comment"],
    ],
    longstring: [
      [/[^\]]+/, "string"],
      [
        /\]([=]*)\]/,
        {
          cases: {
            "$1==$S2": { token: "string", next: "@pop" },
            "@default": "string",
          },
        },
      ],
      [/./, "string"],
    ],
    string: [
      [/[^\\"']+/, "string"],
      [/@escapes/, "string.escape"],
      [/\\./, "string.escape.invalid"],
      [
        /["']/,
        {
          cases: {
            "$#==$S2": { token: "string", next: "@pop" },
            "@default": "string",
          },
        },
      ],
    ],
  },
};
