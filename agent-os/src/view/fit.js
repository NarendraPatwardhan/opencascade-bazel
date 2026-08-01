/**
 * Fit / framing (DISPLAY E2).
 */

/**
 * @param {{ positions: Float32Array|number[], bbox?: { min: number[], max: number[] } }} mesh
 */
export function bboxFromMeshData(mesh) {
  if (mesh.bbox?.min && mesh.bbox?.max) {
    return {
      min: [mesh.bbox.min[0], mesh.bbox.min[1], mesh.bbox.min[2]],
      max: [mesh.bbox.max[0], mesh.bbox.max[1], mesh.bbox.max[2]],
    };
  }
  const p = mesh.positions;
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i],
      y = p[i + 1],
      z = p[i + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  if (!Number.isFinite(minX)) {
    return { min: [-1, -1, -1], max: [1, 1, 1] };
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

/**
 * @param {{ min: number[], max: number[] }} bbox
 */
export function sphereFromBBox(bbox) {
  const cx = (bbox.min[0] + bbox.max[0]) * 0.5;
  const cy = (bbox.min[1] + bbox.max[1]) * 0.5;
  const cz = (bbox.min[2] + bbox.max[2]) * 0.5;
  const dx = bbox.max[0] - bbox.min[0];
  const dy = bbox.max[1] - bbox.min[1];
  const dz = bbox.max[2] - bbox.min[2];
  const radius = 0.5 * Math.hypot(dx, dy, dz);
  return { center: [cx, cy, cz], radius: Math.max(radius, 1e-3) };
}

/**
 * Union of several bboxes.
 * @param {Array<{ min: number[], max: number[] }>} boxes
 */
export function unionBBoxes(boxes) {
  if (!boxes.length) return { min: [-1, -1, -1], max: [1, 1, 1] };
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const b of boxes) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], b.min[i]);
      max[i] = Math.max(max[i], b.max[i]);
    }
  }
  return { min, max };
}

/**
 * Framing radius pad for perspective fit (E2).
 * padFactor multiplies sphere radius for camera distance.
 */
export const FIT_PAD = 2.55;
