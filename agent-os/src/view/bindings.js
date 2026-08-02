/**
 * Input bindings contract — DISPLAY.md §10 (A16).
 * Single source of truth for gesture mapping. Camera code imports this;
 * do not hard-code alternate mappings in editor-cam without updating here.
 */

/** @typedef {'orbit'|'pan'|'zoom'|'none'} GestureKind */

export const BINDINGS = Object.freeze({
  /** LMB drag → orbit about anchor (turntable + world up). */
  orbit: { pointerButtons: [0], requireShift: false, notes: "A12 turntable" },
  /** MMB drag → pixel-perfect pan; Shift+LMB alternate. */
  pan: {
    pointerButtons: [1],
    alternate: { pointerButtons: [0], requireShift: true },
    notes: "A5",
  },
  /** Wheel → zoom toward cursor (not FOV-only). */
  zoom: { wheel: true, notes: "A6" },
  /** RMB: pan (document choice — avoid context menu while dragging). */
  secondary: { pointerButtons: [2], action: "pan", notes: "RMB pan" },
  /** Double-click → focus / set anchor under cursor. */
  focus: { dblclick: true, notes: "P1" },
  keys: {
    fit: ["f", "F"],
    grid: ["g", "G"],
    /** Numpad-ish "5" + letter O; also UI button. */
    ortho: ["5", "o", "O"],
    front: ["1"],
    right: ["3"],
    top: ["7"],
  },
  touch: {
    oneFinger: "orbit",
    twoFingerDrag: "pan",
    pinch: "zoom",
  },
});

/**
 * Classify a pointerdown into a gesture.
 * @param {PointerEvent} e
 * @returns {GestureKind}
 */
export function classifyPointerDown(e) {
  if (e.button === 1) return "pan";
  if (e.button === 2) return "pan"; // RMB pan
  if (e.button === 0 && e.shiftKey) return "pan";
  if (e.button === 0) return "orbit";
  return "none";
}

export const DEFAULT_CAM = Object.freeze({
  orbitSpeed: 0.005,
  /** Momentum decay per second (0 = off). CAD default: snappy stop. */
  momentumDecay: 0,
  /** Screenspace smoothing (0 = raw). Light only (A9). */
  inputSmooth: 0.15,
  /** Trackpad wheel debounce window (ms) (A11). */
  wheelDebounceMs: 16,
  /** World units represented by one pixel at near zoom limit. */
  minSizePerPixel: 1e-5,
  /** World units per pixel at far zoom limit. */
  maxSizePerPixel: 50,
  /** Prefer world-up turntable (A12). */
  turntable: true,
});
