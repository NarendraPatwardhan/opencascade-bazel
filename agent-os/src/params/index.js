/**
 * Framework params public surface.
 *
 *   import { resolveParams, injectParamsPrelude, createParamStore } from './params/index.js'
 */

export { normalizeParam, clampParam, autoStep } from "./types.js";
export { extractParams, extractRegistrationParams, mergeParams } from "./extract.js";
export { inferParams } from "./infer.js";
export {
  analyzeLuauParams,
  findHeaderLocalBindings,
  applyParamValuesToSource,
  parseTrailingAnnotation,
} from "./luau-locals.js";
export { resolveParams } from "./resolve.js";
export {
  injectParamsPrelude,
  buildParamsInjectedSource,
  peelLeadingDirectives,
  formatParamsTable,
  formatInjectBlock,
  valuesFromParams,
  luauLiteral,
  mapAnalyzerLineToUser,
  adjustInjectedDiagnostics,
  PARAMS_INJECT_LINE_COUNT,
} from "./inject.js";
export { createParamStore } from "./store.js";
export { mountParamSheet } from "./sheet.js";
