/**
 * three.js CDN loader + WebGL2 gate (DISPLAY: no soft fallback).
 */

const THREE_URL =
  "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js";

let threePromise;

/** @returns {Promise<typeof import('three')>} */
export function loadThree() {
  if (!threePromise) {
    threePromise = import(/* @vite-ignore */ THREE_URL);
  }
  return threePromise;
}

/** True only when WebGL2 is available. */
export function hasWebGL2() {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2");
    return !!gl;
  } catch {
    return false;
  }
}

/**
 * Hard require WebGL2. Throws if unavailable.
 * @returns {true}
 */
export function requireWebGL2() {
  if (!hasWebGL2()) {
    throw new Error(
      "WebGL2 is required for the CAD viewport (no software/SVG fallback).",
    );
  }
  return true;
}
