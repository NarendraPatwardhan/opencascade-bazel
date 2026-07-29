/** Versioned main ↔ runtime-worker protocol (AgentOS CAD). */

export const PROTOCOL = 1;

/** @typedef {"warm"|"execute"|"cancel"} CadRequestKind */

/**
 * @typedef {object} CadExecuteRequest
 * @property {number} id
 * @property {"execute"} kind
 * @property {string} source
 * @property {number} [budget]
 * @property {number} [deflection]
 */

/**
 * @typedef {object} CadWarmRequest
 * @property {number} id
 * @property {"warm"} kind
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
 * @property {number} code  // 0 ok
 * @property {string[]} diagnostics
 * @property {CadMesh} [mesh]
 * @property {object} [meta]
 * @property {string} [stdout]
 * @property {string} [stderr]
 */

/**
 * @typedef {object} CadFailure
 * @property {number} id
 * @property {number} code  // nonzero
 * @property {string[]} diagnostics
 * @property {string} error
 * @property {string} [stdout]
 * @property {string} [stderr]
 */

export function isCadRequest(msg) {
  return msg && typeof msg === "object" && typeof msg.id === "number" && typeof msg.kind === "string";
}
