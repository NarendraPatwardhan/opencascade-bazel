/**
 * Shared mesh materials (DISPLAY K3 / E5 clash palette).
 */

const CLASH_PALETTE = [
  0x00a6ff, // primary cyan
  0xff6b4a, // clash A
  0x5cb86a, // clash B
  0xe0c070, // amber
  0xc47cff, // violet
  0x4ad4c8, // teal
];

/**
 * @param {typeof import('three')} THREE
 * @param {string|number} [color]
 */
export function createSolidMaterial(THREE, color = "#00a6ff") {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    metalness: 0.18,
    roughness: 0.42,
    side: THREE.DoubleSide,
  });
}

/**
 * @param {typeof import('three')} THREE
 * @param {number} [hex]
 */
export function createEdgeMaterial(THREE, hex = 0xd8e6f8) {
  return new THREE.LineBasicMaterial({
    color: hex,
    transparent: true,
    opacity: 0.55,
  });
}

/**
 * Stable multi-body clash color by index.
 * @param {number} index
 * @returns {string}
 */
export function bodyColor(index) {
  const c = CLASH_PALETTE[index % CLASH_PALETTE.length];
  return "#" + c.toString(16).padStart(6, "0");
}

export { CLASH_PALETTE };
