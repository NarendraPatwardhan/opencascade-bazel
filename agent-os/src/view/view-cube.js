/**
 * CAD-style 3D view cube — DISPLAY.md steal list D1 (CADAM ViewGizmo).
 *
 * Mini orthographic scene: cube tracks main camera orientation;
 * face click snaps main cam; drag orbits. NOT a button list.
 */

const FACE_META = [
  // BoxGeometry material order: +X, -X, +Y, -Y, +Z, -Z
  { label: "RIGHT", dir: [1, 0, 0], up: [0, 1, 0], color: "#2a3344" },
  { label: "LEFT", dir: [-1, 0, 0], up: [0, 1, 0], color: "#2a3344" },
  { label: "TOP", dir: [0, 1, 0], up: [0, 0, -1], color: "#323c50" },
  { label: "BOTTOM", dir: [0, -1, 0], up: [0, 0, 1], color: "#222833" },
  { label: "FRONT", dir: [0, 0, 1], up: [0, 1, 0], color: "#2e384a" },
  { label: "BACK", dir: [0, 0, -1], up: [0, 1, 0], color: "#2e384a" },
];

/**
 * @param {typeof import('three')} THREE
 * @param {string} label
 * @param {string} bg
 */
function makeFaceTexture(THREE, label, bg) {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, "rgba(255,255,255,0.08)");
  grad.addColorStop(1, "rgba(0,0,0,0.18)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = "rgba(200, 214, 232, 0.55)";
  ctx.lineWidth = 10;
  ctx.strokeRect(8, 8, size - 16, size - 16);

  ctx.fillStyle = "#e8eef8";
  ctx.font = "bold 48px system-ui, Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 6;
  ctx.fillText(label, size / 2, size / 2);

  const tex = new THREE.CanvasTexture(canvas);
  if ("SRGBColorSpace" in THREE) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * @param {typeof import('three')} THREE
 * @param {HTMLElement} container
 * @param {{
 *   onFace: (dir: number[], up: number[]) => void,
 *   onOrbitDelta?: (dx: number, dy: number) => void,
 * }} handlers
 */
export function mountViewCube(THREE, container, handlers) {
  const SIZE = 108;

  const host = document.createElement("div");
  host.className = "view-cube-host";
  host.setAttribute("role", "group");
  host.setAttribute(
    "aria-label",
    "View cube — click a face to snap orientation",
  );
  host.title = "View cube — click face to snap · drag to orbit";

  const canvas = document.createElement("canvas");
  canvas.className = "view-cube-canvas";
  canvas.width = SIZE * 2;
  canvas.height = SIZE * 2;
  canvas.style.width = `${SIZE}px`;
  canvas.style.height = `${SIZE}px`;
  host.appendChild(canvas);

  const isoBtn = document.createElement("button");
  isoBtn.type = "button";
  isoBtn.className = "view-cube-iso";
  isoBtn.textContent = "Iso";
  isoBtn.title = "Isometric view";
  isoBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    handlers.onFace([1, 1, 1], [0, 1, 0]);
  });
  host.appendChild(isoBtn);

  container.appendChild(host);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1.35, 1.35, 1.35, -1.35, 0.1, 20);
  camera.position.set(0, 0, 4);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    premultipliedAlpha: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(SIZE, SIZE, false);
  renderer.setClearColor(0x000000, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.85));
  const key = new THREE.DirectionalLight(0xffffff, 0.65);
  key.position.set(2, 3, 4);
  scene.add(key);

  const materials = FACE_META.map(
    (f) =>
      new THREE.MeshStandardMaterial({
        map: makeFaceTexture(THREE, f.label, f.color),
        roughness: 0.55,
        metalness: 0.08,
        emissive: new THREE.Color(0x000000),
        emissiveIntensity: 0,
      }),
  );

  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(1.05, 1.05, 1.05),
    materials,
  );
  scene.add(cube);

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.06, 1.06, 1.06)),
    new THREE.LineBasicMaterial({
      color: 0xc8d4e8,
      transparent: true,
      opacity: 0.55,
    }),
  );
  cube.add(edges);

  const cornerMat = new THREE.MeshBasicMaterial({ color: 0x8aa0bc });
  const cornerGeom = new THREE.SphereGeometry(0.06, 10, 10);
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const s = new THREE.Mesh(cornerGeom, cornerMat);
        s.position.set(sx * 0.525, sy * 0.525, sz * 0.525);
        cube.add(s);
      }
    }
  }

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const _offset = new THREE.Vector3();
  const _up = new THREE.Vector3();

  let hoverFace = null;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let moved = false;

  function setHover(faceIndex) {
    if (hoverFace === faceIndex) return;
    if (hoverFace != null && materials[hoverFace]) {
      materials[hoverFace].emissive.setHex(0x000000);
      materials[hoverFace].emissiveIntensity = 0;
    }
    hoverFace = faceIndex;
    if (faceIndex != null && materials[faceIndex]) {
      materials[faceIndex].emissive.setHex(0x3d9cf0);
      materials[faceIndex].emissiveIntensity = 0.35;
    }
  }

  function pickFace(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -(((clientY - rect.top) / rect.height) * 2 - 1);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(cube, false);
    if (!hits.length) return null;
    const face = hits[0].face;
    if (!face) return null;
    return face.materialIndex ?? null;
  }

  function onPointerDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    moved = false;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e) {
    if (dragging) {
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
      lastX = e.clientX;
      lastY = e.clientY;
      handlers.onOrbitDelta?.(dx, dy);
      return;
    }
    setHover(pickFace(e.clientX, e.clientY));
  }

  function onPointerUp(e) {
    if (!dragging) return;
    dragging = false;
    try {
      canvas.releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
    if (moved) return;
    const idx = pickFace(e.clientX, e.clientY);
    if (idx == null) return;
    const meta = FACE_META[idx];
    if (!meta) return;
    handlers.onFace(meta.dir, meta.up);
  }

  function onPointerLeave() {
    if (!dragging) setHover(null);
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  /**
   * Sync mini-camera to main camera look direction (CADAM / drei gizmo style).
   * @param {import('three').Camera} mainCamera
   * @param {import('three').Vector3} [target]
   */
  function update(mainCamera, target) {
    const t = target || new THREE.Vector3(0, 0, 0);
    _offset.copy(mainCamera.position).sub(t);
    if (_offset.lengthSq() < 1e-8) _offset.set(1, 1, 1);
    _offset.normalize().multiplyScalar(3.2);
    camera.position.copy(_offset);
    _up.copy(mainCamera.up).normalize();
    camera.up.copy(_up);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    renderer.render(scene, camera);
  }

  camera.position.set(2, 1.6, 2.4);
  camera.lookAt(0, 0, 0);
  renderer.render(scene, camera);

  return {
    el: host,
    update,
    dispose() {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      for (const m of materials) {
        m.map?.dispose();
        m.dispose();
      }
      cube.geometry.dispose();
      edges.geometry.dispose();
      edges.material.dispose();
      cornerGeom.dispose();
      cornerMat.dispose();
      renderer.dispose();
      host.remove();
    },
  };
}
