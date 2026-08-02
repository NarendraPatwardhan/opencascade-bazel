/** Versioned main ↔ runtime-worker protocol (AgentOS CAD). */

export const PROTOCOL = 1;

/** @typedef {"config"|"warm"|"analyze"|"execute"|"params_resolve"|"cancel"} CadRequestKind */

/**
 * @typedef {object} CadExecuteRequest
 * @property {number} id
 * @property {"execute"} kind
 * @property {string} source
 * @property {number} [budget]
 * @property {number} [deflection]
 */

/**
 * @typedef {object} CadAnalyzeRequest
 * @property {number} id
 * @property {"analyze"} kind
 * @property {string} source
 */

/**
 * @typedef {object} CadWarmRequest
 * @property {number} id
 * @property {"warm"} kind
 */

/**
 * Guest syntax harvest → POD param list (no host Luau parse).
 * @typedef {object} CadParamsResolveRequest
 * @property {number} id
 * @property {"params_resolve"} kind
 * @property {string} source
 */

/**
 * @typedef {object} CadDiagnostic
 * @property {number} line
 * @property {number} column
 * @property {string} message
 * @property {"error"|"warning"|"info"} severity
 */

/**
 * @typedef {object} CadMesh
 * @property {Float32Array} positions
 * @property {Float32Array} [normals]
 * @property {Uint32Array} indices
 * @property {{ min: number[], max: number[] }} [bbox]
 * @property {number} [volume]
 */

/**
 * @typedef {object} CadSuccess
 * @property {number} id
 * @property {string} [kind]
 * @property {number} code  // 0 ok
 * @property {CadDiagnostic[]} diagnostics
 * @property {CadMesh} [mesh]
 * @property {object} [meta]
 * @property {string} [stdout]
 * @property {string} [stderr]
 */

/**
 * @typedef {object} CadFailure
 * @property {number} id
 * @property {string} [kind]
 * @property {number} code  // nonzero
 * @property {CadDiagnostic[]} diagnostics
 * @property {string} error
 * @property {string} [stdout]
 * @property {string} [stderr]
 */

export function isCadRequest(msg) {
  return msg && typeof msg === "object" && typeof msg.id === "number" && typeof msg.kind === "string";
}
