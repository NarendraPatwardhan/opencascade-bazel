/**
 * Framework params public surface.
 *
 * Product schema path: guest syntax → POD → resolveParamsFromPods
 * (worker kind "params_resolve"). resolveParams() is cold/fallback only.
 *
 *   import { resolveParamsFromPods, injectParamsPrelude, createParamStore } from './params/index.js'
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
export {
  resolveParams,
  resolveParamsFromPods,
  normalizeParamPods,
  mergeParamLayers,
} from "./resolve.js";
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
export { paramsHeaderFingerprint } from "./header-fingerprint.js";
export { schemaSignature } from "./schema-signature.js";
export { createParamStore } from "./store.js";
export { mountParamSheet, sheetSchemaSignature } from "./sheet.js";
