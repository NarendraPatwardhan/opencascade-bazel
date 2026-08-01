/**
 * DISPLAY package — WebGL2 CAD viewport.
 *
 * @example
 *   const vp = await createViewport(el, { grid: true });
 *   vp.setBodies([{ positions, indices, normals, bbox }]);
 *   vp.setOptions({ grid: false });
 *   vp.dispose();
 */

export { createViewport } from "./cad-viewport.js";
export { BINDINGS, DEFAULT_CAM, classifyPointerDown } from "./bindings.js";
export { requireWebGL2, hasWebGL2, loadThree } from "./three-loader.js";

/**
 * @typedef {{
 *   id?: string,
 *   positions: Float32Array|number[],
 *   normals?: Float32Array|number[],
 *   indices: Uint32Array|Uint16Array|number[],
 *   bbox?: { min: number[], max: number[] },
 *   volume?: number,
 *   color?: string,
 * }} MeshBody
 */

/**
 * @typedef {{
 *   id: string,
 *   origin?: [number, number, number],
 *   axes?: {
 *     x: [number, number, number],
 *     y: [number, number, number],
 *     z: [number, number, number],
 *   },
 *   matrix?: number[]|Float32Array,
 * }} Frame
 */

/**
 * @typedef {{
 *   name: string,
 *   value: number,
 *   min?: number,
 *   max?: number,
 *   frame: string,
 *   axis?: string,
 *   scrub?: string,
 *   unit?: string,
 *   type?: string,
 * }} GimbalBinding
 */

/**
 * @typedef {{
 *   setBodies(bodies: MeshBody[], opts?: { fit?: boolean }): void,
 *   setBodyMatrix(id: string, mat4: ArrayLike<number>): void,
 *   setRootMatrix(mat4: ArrayLike<number>): void,
 *   setFrames(frames: Frame[]): void,
 *   setGimbals(bindings: GimbalBinding[], handlers?: {
 *     onChange?: (name: string, value: number) => void,
 *     onCommit?: (name: string, value: number) => void,
 *   }): void,
 *   setOptions(opts: {
 *     grid?: boolean,
 *     projection?: 'perspective'|'orthographic',
 *     stale?: boolean,
 *     staleMessage?: string,
 *   }): void,
 *   fit(): void,
 *   dispose(): void,
 *   readonly projection: 'perspective'|'orthographic',
 *   readonly hasBodies: boolean,
 * }} Viewport
 */
