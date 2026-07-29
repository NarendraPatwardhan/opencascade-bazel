/**
 * Mesh viewer: Three.js when WebGL is available; otherwise a stats + SVG bbox fallback
 * (headless CI / no GPU still show a successful solid result).
 */

let threePromise;

async function three() {
  if (!threePromise) {
    threePromise = import("https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js");
  }
  return threePromise;
}

function webglOk() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl") || c.getContext("experimental-webgl"));
  } catch {
    return false;
  }
}

function showFallback(container, mesh) {
  const nv = (mesh.positions?.length || 0) / 3;
  const nt = (mesh.indices?.length || 0) / 3;
  const bbox = mesh.bbox;
  const color = mesh.color || "#00a6ff";
  let min = [0, 0, 0];
  let max = [1, 1, 1];
  if (bbox?.min && bbox?.max) {
    min = bbox.min;
    max = bbox.max;
  } else if (mesh.positions?.length >= 3) {
    min = [Infinity, Infinity, Infinity];
    max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < mesh.positions.length; i += 3) {
      min[0] = Math.min(min[0], mesh.positions[i]);
      min[1] = Math.min(min[1], mesh.positions[i + 1]);
      min[2] = Math.min(min[2], mesh.positions[i + 2]);
      max[0] = Math.max(max[0], mesh.positions[i]);
      max[1] = Math.max(max[1], mesh.positions[i + 1]);
      max[2] = Math.max(max[2], mesh.positions[i + 2]);
    }
  }
  const dx = Math.max(1e-6, max[0] - min[0]);
  const dy = Math.max(1e-6, max[1] - min[1]);
  // Isometric-ish 2D box projection for a visual cue
  const w = 280;
  const h = 200;
  const sx = (w * 0.55) / dx;
  const sy = (h * 0.55) / dy;
  const s = Math.min(sx, sy);
  const cx = w / 2;
  const cy = h / 2;
  const proj = (x, y, z) => {
    const X = (x - (min[0] + max[0]) / 2) * s + (z - (min[2] + max[2]) / 2) * s * 0.35;
    const Y = -((y - (min[1] + max[1]) / 2) * s) + (z - (min[2] + max[2]) / 2) * s * 0.25;
    return [cx + X, cy + Y];
  };
  const corners = [
    [min[0], min[1], min[2]],
    [max[0], min[1], min[2]],
    [max[0], max[1], min[2]],
    [min[0], max[1], min[2]],
    [min[0], min[1], max[2]],
    [max[0], min[1], max[2]],
    [max[0], max[1], max[2]],
    [min[0], max[1], max[2]],
  ].map(([x, y, z]) => proj(x, y, z));
  const edges = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  const lines = edges
    .map(([a, b]) => {
      const [x1, y1] = corners[a];
      const [x2, y2] = corners[b];
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="1.5"/>`;
    })
    .join("");

  container.innerHTML = `
    <div style="padding:12px;font:13px/1.4 ui-monospace,monospace;color:#c8d0e0">
      <div style="margin-bottom:8px;color:#8b93a7">WebGL unavailable — bbox preview</div>
      <svg width="${w}" height="${h}" style="display:block;margin:0 auto;background:#151820;border-radius:8px">
        ${lines}
      </svg>
      <div style="margin-top:10px">vertices=${nv} · triangles=${nt}
      ${mesh.volume != null ? ` · volume≈${Number(mesh.volume).toFixed(2)}` : ""}</div>
      <div>bbox min=(${min.map((v) => v.toFixed(2)).join(",")})
        max=(${max.map((v) => v.toFixed(2)).join(",")})</div>
    </div>`;
  return () => {
    container.replaceChildren();
  };
}

/**
 * @param {HTMLElement} container
 * @param {{ positions: Float32Array, normals?: Float32Array, indices: Uint32Array, color?: string, bbox?: object, volume?: number }} mesh
 */
export async function showMesh(container, mesh) {
  container.replaceChildren();
  container.style.position = "relative";

  if (!webglOk()) {
    return showFallback(container, mesh);
  }

  try {
    const THREE = await three();
    const width = container.clientWidth || 640;
    const height = container.clientHeight || 480;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1d23);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 1e5);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    container.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 0.55);
    scene.add(ambient);
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(2, 4, 3);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x88aaff, 0.35);
    fill.position.set(-3, -1, -2);
    scene.add(fill);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
    if (mesh.normals && mesh.normals.length === mesh.positions.length) {
      geometry.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
    } else {
      geometry.computeVertexNormals();
    }
    geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    geometry.computeBoundingSphere();

    const color = new THREE.Color(mesh.color || "#00a6ff");
    const material = new THREE.MeshStandardMaterial({
      color,
      metalness: 0.15,
      roughness: 0.45,
      side: THREE.DoubleSide,
    });
    const object = new THREE.Mesh(geometry, material);
    scene.add(object);

    const edges = new THREE.EdgesGeometry(geometry, 25);
    const line = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0x0a2540, transparent: true, opacity: 0.35 }),
    );
    object.add(line);

    const sphere = geometry.boundingSphere;
    const r = Math.max(sphere.radius, 1e-3);
    camera.position.set(r * 2.2, r * 1.6, r * 2.4);
    camera.lookAt(sphere.center);

    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const target = sphere.center.clone();
    const offset = camera.position.clone().sub(target);

    const onDown = (e) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onUp = () => {
      dragging = false;
    };
    const onMove = (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      const spherical = new THREE.Spherical().setFromVector3(offset);
      spherical.theta -= dx * 0.01;
      spherical.phi = Math.min(Math.PI - 0.05, Math.max(0.05, spherical.phi - dy * 0.01));
      offset.setFromSpherical(spherical);
      camera.position.copy(target).add(offset);
      camera.lookAt(target);
    };
    const onWheel = (e) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.08 : 0.92;
      offset.multiplyScalar(factor);
      camera.position.copy(target).add(offset);
      camera.lookAt(target);
    };

    renderer.domElement.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });

    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      renderer.render(scene, camera);
    };
    tick();

    const ro = new ResizeObserver(() => {
      const w = container.clientWidth || width;
      const h = container.clientHeight || height;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(container);

    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("wheel", onWheel);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      container.replaceChildren();
    };
  } catch (err) {
    console.warn("WebGL viewer failed, using fallback", err);
    return showFallback(container, mesh);
  }
}
