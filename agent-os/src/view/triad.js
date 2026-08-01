/**
 * World-origin axis triad (DISPLAY E1).
 * Arrowed axes, not three bare segments.
 */

/**
 * @param {typeof import('three')} THREE
 * @param {number} [length]
 */
export function createTriad(THREE, length = 1) {
  const group = new THREE.Group();
  group.name = "WorldTriad";

  const axes = [
    { dir: new THREE.Vector3(1, 0, 0), color: 0xc45c5c, name: "X" },
    { dir: new THREE.Vector3(0, 1, 0), color: 0x5cb86a, name: "Y" },
    { dir: new THREE.Vector3(0, 0, 1), color: 0x4a7fd4, name: "Z" },
  ];

  /** @type {import('three').Object3D[]} */
  const parts = [];

  for (const a of axes) {
    const shaftLen = length * 0.82;
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(length * 0.02, length * 0.02, shaftLen, 8),
      new THREE.MeshBasicMaterial({
        color: a.color,
        depthTest: true,
        transparent: true,
        opacity: 0.92,
      }),
    );
    // Cylinder default along Y; reorient to a.dir
    const mid = a.dir.clone().multiplyScalar(shaftLen * 0.5);
    shaft.position.copy(mid);
    shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), a.dir);
    group.add(shaft);
    parts.push(shaft);

    const head = new THREE.Mesh(
      new THREE.ConeGeometry(length * 0.05, length * 0.16, 10),
      new THREE.MeshBasicMaterial({
        color: a.color,
        depthTest: true,
        transparent: true,
        opacity: 0.95,
      }),
    );
    head.position.copy(a.dir.clone().multiplyScalar(length * 0.9));
    head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), a.dir);
    group.add(head);
    parts.push(head);
  }

  return {
    group,
    setLength(len) {
      const s = Math.max(len, 1e-3) / length;
      group.scale.setScalar(s);
    },
    setVisible(v) {
      group.visible = !!v;
    },
    dispose() {
      group.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
    },
  };
}
