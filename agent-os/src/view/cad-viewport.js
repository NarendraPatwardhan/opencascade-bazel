/**
 * Viewport composition — DISPLAY public surface.
 *
 * Factory: createViewport(container, options?) → Viewport
 * No showMesh one-shot, no SVG fallback, no DOM singleton.
 * WebGL2 required.
 */

import { loadThree, requireWebGL2 } from "./three-loader.js";
import { createEditorCam } from "./editor-cam.js";
import { createGroundGrid } from "./ground-grid.js";
import { createTriad } from "./triad.js";
import { mountViewCube } from "./view-cube.js";
import { createGimbals } from "./gimbals.js";
import {
  createSolidMaterial,
  createEdgeMaterial,
  bodyColor,
} from "./materials.js";
import {
  bboxFromMeshData,
  sphereFromBBox,
  unionBBoxes,
  FIT_PAD,
} from "./fit.js";
import { BINDINGS } from "./bindings.js";

/**
 * @typedef {import('./index.js').MeshBody} MeshBody
 * @typedef {import('./index.js').Frame} Frame
 * @typedef {import('./index.js').GimbalBinding} GimbalBinding
 * @typedef {import('./index.js').Viewport} Viewport
 */

/**
 * @param {HTMLElement} container
 * @param {{ grid?: boolean }} [options]
 * @returns {Promise<Viewport>}
 */
export async function createViewport(container, options = {}) {
  requireWebGL2();
  const THREE = await loadThree();
  return new ViewportImpl(container, THREE, options);
}

class ViewportImpl {
  /**
   * @param {HTMLElement} container
   * @param {typeof import('three')} THREE
   * @param {{ grid?: boolean }} opts
   */
  constructor(container, THREE, opts = {}) {
    this.THREE = THREE;
    this.container = container;
    this.container.replaceChildren();
    this.container.style.position = "relative";

    const width = container.clientWidth || 640;
    const height = container.clientHeight || 480;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1d23);

    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 1e6);
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height);
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.tabIndex = 0;
    container.appendChild(this.renderer.domElement);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(2, 4, 3);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x88aaff, 0.35);
    fill.position.set(-3, -1, -2);
    this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 0.25);
    rim.position.set(0, -2, -3);
    this.scene.add(rim);

    this.solidGroup = new THREE.Group();
    this.solidGroup.name = "Solids";
    this.scene.add(this.solidGroup);

    /** @type {Map<string, import('three').Object3D>} */
    this._bodies = new Map();

    this.grid = createGroundGrid(THREE, {});
    this.grid.setVisible(opts.grid !== false);
    this.scene.add(this.grid.mesh);

    this.triad = createTriad(THREE, 1);
    this.scene.add(this.triad.group);

    /** @type {GimbalBinding[]} */
    this._gimbalBindings = [];
    /** @type {{ onChange?: Function, onCommit?: Function }} */
    this._gimbalHandlers = {};

    this.gimbals = createGimbals(THREE, {
      getBindings: () => this._gimbalBindings,
      onChange: (name, value) => this._gimbalHandlers.onChange?.(name, value),
      onCommit: (name, value) => this._gimbalHandlers.onCommit?.(name, value),
    });
    this.scene.add(this.gimbals.group);

    this.cam = createEditorCam(THREE, this.camera, this.renderer.domElement, {
      getPickables: () => [...this.solidGroup.children],
      onProjectionChange: (mode) => {
        if (this._projBtn) {
          this._projBtn.textContent =
            mode === "orthographic" ? "Persp" : "Ortho";
        }
      },
    });
    this.cam.setFromPositions(
      new THREE.Vector3(12, 10, 14),
      new THREE.Vector3(0, 0, 0),
    );

    this.viewCube = mountViewCube(THREE, container, {
      onFace: (dir, up) => {
        this.cam.lookDir(
          new THREE.Vector3(dir[0], dir[1], dir[2]),
          new THREE.Vector3(up[0], up[1], up[2]),
        );
      },
      onOrbitDelta: (dx, dy) => this.cam.orbitDelta(dx, dy),
    });

    this._lastSphere = { center: [0, 0, 0], radius: 5 };
    this._hasBodies = false;
    this._stale = false;
    this._gimbalDrag = false;

    this._onPtrDown = (e) => {
      if (e.button !== 0 || e.shiftKey) return;
      const hit = this.gimbals.pick(
        this.camera,
        this.renderer.domElement,
        e,
      );
      if (hit) {
        e.stopPropagation();
        this.cam.setSuppressed(true);
        this.gimbals.beginDrag(
          hit,
          e.clientX,
          e.clientY,
          this.camera,
          this.renderer.domElement,
        );
        this._gimbalDrag = true;
      }
    };
    this._onPtrMove = (e) => {
      if (!this._gimbalDrag) return;
      this.gimbals.moveDrag(
        e.clientX,
        e.clientY,
        this.camera,
        this.renderer.domElement,
      );
    };
    this._onPtrUp = () => {
      if (!this._gimbalDrag) return;
      this.gimbals.endDrag();
      this._gimbalDrag = false;
      this.cam.setSuppressed(false);
    };
    this.renderer.domElement.addEventListener(
      "pointerdown",
      this._onPtrDown,
      true,
    );
    window.addEventListener("pointermove", this._onPtrMove);
    window.addEventListener("pointerup", this._onPtrUp);

    this._onKey = (e) => {
      if (e.target && /input|textarea|select/i.test(/** @type {any} */ (e.target).tagName))
        return;
      const k = e.key;
      if (BINDINGS.keys.fit.includes(k)) {
        e.preventDefault();
        this.fit();
      } else if (BINDINGS.keys.grid.includes(k)) {
        e.preventDefault();
        this.setOptions({ grid: !this.grid.mesh.visible });
      } else if (BINDINGS.keys.ortho.includes(k)) {
        e.preventDefault();
        this._toggleProjection();
      } else if (BINDINGS.keys.front.includes(k)) {
        e.preventDefault();
        this.cam.lookDir(
          new THREE.Vector3(0, 0, 1),
          new THREE.Vector3(0, 1, 0),
        );
      } else if (BINDINGS.keys.right.includes(k)) {
        e.preventDefault();
        this.cam.lookDir(
          new THREE.Vector3(1, 0, 0),
          new THREE.Vector3(0, 1, 0),
        );
      } else if (BINDINGS.keys.top.includes(k)) {
        e.preventDefault();
        this.cam.lookDir(
          new THREE.Vector3(0, 1, 0),
          new THREE.Vector3(0, 0, -1),
        );
      }
    };
    window.addEventListener("keydown", this._onKey);

    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(container);

    this._lastT = performance.now();
    this._frame = 0;
    const tick = () => {
      this._frame = requestAnimationFrame(tick);
      const now = performance.now();
      const dt = (now - this._lastT) / 1000;
      this._lastT = now;
      this.cam.tick?.(dt);
      this.grid.update(this.camera);
      this.viewCube.update?.(this.camera, this.cam.state.target);
      this.renderer.render(this.scene, this.camera);
    };
    tick();

    this._hud = document.createElement("div");
    this._hud.className = "viewport-hud";
    this._hud.textContent = "orbit · pan · zoom · F fit · G grid";
    container.appendChild(this._hud);

    this._staleBanner = document.createElement("div");
    this._staleBanner.className = "viewport-stale";
    this._staleBanner.hidden = true;
    this._staleBanner.textContent = "Stale — last good mesh shown";
    container.appendChild(this._staleBanner);

    this._projBtn = document.createElement("button");
    this._projBtn.type = "button";
    this._projBtn.className = "viewport-proj-btn";
    this._projBtn.textContent = "Ortho";
    this._projBtn.title = "Toggle orthographic / perspective";
    this._projBtn.addEventListener("click", () => this._toggleProjection());
    container.appendChild(this._projBtn);
  }

  _resize() {
    const w = this.container.clientWidth || 640;
    const h = this.container.clientHeight || 480;
    if (this.camera.isPerspectiveCamera || this.camera.isOrthographicCamera) {
      this.camera.aspect = w / h;
    }
    if (this.camera.isOrthographicCamera) {
      const half = this.cam.state.orthoHalfHeight || 5;
      this.camera.left = -half * (w / h);
      this.camera.right = half * (w / h);
      this.camera.top = half;
      this.camera.bottom = -half;
    }
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  _toggleProjection() {
    this.cam.toggleProjection((newCam) => {
      newCam.aspect =
        (this.container.clientWidth || 640) /
        (this.container.clientHeight || 480);
      this.camera = newCam;
      this.cam.attachCamera(newCam);
      this._resize();
    });
  }

  _clearBodies() {
    while (this.solidGroup.children.length) {
      const child = this.solidGroup.children[0];
      this.solidGroup.remove(child);
      child.traverse?.((obj) => {
        obj.geometry?.dispose?.();
        if (obj.material) {
          if (Array.isArray(obj.material))
            obj.material.forEach((m) => m.dispose?.());
          else obj.material.dispose?.();
        }
      });
    }
    this._bodies.clear();
  }

  /**
   * @param {MeshBody[]} bodies
   * @param {{ fit?: boolean }} [opts]
   */
  setBodies(bodies, opts = {}) {
    const THREE = this.THREE;
    if (!Array.isArray(bodies) || !bodies.length) return;

    this._clearBodies();
    const boxes = [];

    bodies.forEach((mesh, i) => {
      if (!mesh?.positions || !mesh?.indices) return;
      const id = mesh.id || `body${i}`;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(
          mesh.positions instanceof Float32Array
            ? mesh.positions
            : new Float32Array(mesh.positions),
          3,
        ),
      );
      if (mesh.normals && mesh.normals.length === mesh.positions.length) {
        geometry.setAttribute(
          "normal",
          new THREE.BufferAttribute(
            mesh.normals instanceof Float32Array
              ? mesh.normals
              : new Float32Array(mesh.normals),
            3,
          ),
        );
      } else {
        geometry.computeVertexNormals();
      }
      const idx =
        mesh.indices instanceof Uint32Array ||
        mesh.indices instanceof Uint16Array
          ? mesh.indices
          : new Uint32Array(mesh.indices);
      geometry.setIndex(new THREE.BufferAttribute(idx, 1));
      geometry.computeBoundingSphere();
      geometry.computeBoundingBox();

      const color = mesh.color || bodyColor(i);
      const material = createSolidMaterial(THREE, color);
      const object = new THREE.Mesh(geometry, material);
      object.name = id;
      object.userData.bodyId = id;

      const edges = new THREE.EdgesGeometry(geometry, 25);
      object.add(new THREE.LineSegments(edges, createEdgeMaterial(THREE)));

      this.solidGroup.add(object);
      this._bodies.set(id, object);
      boxes.push(bboxFromMeshData(mesh));
    });

    if (!boxes.length) return;
    this._hasBodies = true;
    // Fresh body load: reset root transform (host re-applies xform tier).
    this.solidGroup.matrixAutoUpdate = true;
    this.solidGroup.matrix.identity();
    this.solidGroup.position.set(0, 0, 0);
    this.solidGroup.rotation.set(0, 0, 0);
    this.solidGroup.scale.set(1, 1, 1);
    this.solidGroup.updateMatrix();
    this.setOptions({ stale: false });

    const bbox = unionBBoxes(boxes);
    const sphere = sphereFromBBox(bbox);
    this._lastSphere = sphere;

    const extent = Math.max(
      bbox.max[0] - bbox.min[0],
      bbox.max[1] - bbox.min[1],
      bbox.max[2] - bbox.min[2],
      sphere.radius,
    );
    this.triad.setLength(Math.max(extent * 0.15, 0.5));
    this.grid.adaptToExtent(extent);
    this.cam.setRadiusLimitsFromExtent(extent);
    this.gimbals.setHandleScale(Math.max(extent * 0.2, 0.3));

    if (opts.fit !== false) this.fit();
  }

  /**
   * @param {string} id
   * @param {ArrayLike<number>} matrix
   */
  setBodyMatrix(id, matrix) {
    const body = this._bodies.get(id);
    if (!body || !matrix || matrix.length < 16) return;
    const m = new this.THREE.Matrix4().fromArray(/** @type {number[]} */ (matrix));
    body.matrixAutoUpdate = false;
    body.matrix.copy(m);
  }

  /**
   * @param {ArrayLike<number>} matrix
   */
  setRootMatrix(matrix) {
    if (!matrix || matrix.length < 16) return;
    const m = new this.THREE.Matrix4().fromArray(/** @type {number[]} */ (matrix));
    this.solidGroup.matrixAutoUpdate = false;
    this.solidGroup.matrix.copy(m);
  }

  /**
   * @param {Frame[]} frames
   */
  setFrames(frames) {
    this.gimbals.setFrames(frames || []);
  }

  /**
   * @param {GimbalBinding[]} bindings
   * @param {{ onChange?: (n:string,v:number)=>void, onCommit?: (n:string,v:number)=>void }} [handlers]
   */
  setGimbals(bindings, handlers = {}) {
    this._gimbalBindings = bindings || [];
    this._gimbalHandlers = handlers || {};
    this.gimbals.rebuild();
  }

  /**
   * @param {{
   *   grid?: boolean,
   *   projection?: 'perspective'|'orthographic',
   *   stale?: boolean,
   *   staleMessage?: string,
   * }} opts
   */
  setOptions(opts = {}) {
    if (opts.grid !== undefined) this.grid.setVisible(!!opts.grid);
    if (opts.projection !== undefined) {
      this.cam.setProjection(opts.projection, (newCam) => {
        newCam.aspect =
          (this.container.clientWidth || 640) /
          (this.container.clientHeight || 480);
        this.camera = newCam;
        this.cam.attachCamera(newCam);
        this._resize();
      });
    }
    if (opts.stale !== undefined) {
      this._stale = !!opts.stale;
      this._staleBanner.hidden = !this._stale;
      if (opts.staleMessage) this._staleBanner.textContent = opts.staleMessage;
      this.solidGroup.traverse((o) => {
        if (o.material && o.material.opacity != null && o.isMesh) {
          o.material.transparent = true;
          o.material.opacity = this._stale ? 0.55 : 1;
        }
      });
    }
  }

  fit() {
    if (!this._hasBodies) return;
    const s = this._lastSphere;
    this.cam.fitSphere(
      new this.THREE.Vector3(s.center[0], s.center[1], s.center[2]),
      s.radius,
      FIT_PAD,
    );
  }

  get projection() {
    return this.cam.projection;
  }

  get hasBodies() {
    return this._hasBodies;
  }

  dispose() {
    cancelAnimationFrame(this._frame);
    this._ro.disconnect();
    window.removeEventListener("keydown", this._onKey);
    window.removeEventListener("pointermove", this._onPtrMove);
    window.removeEventListener("pointerup", this._onPtrUp);
    this.renderer.domElement.removeEventListener(
      "pointerdown",
      this._onPtrDown,
      true,
    );
    this.cam.dispose();
    this.grid.dispose();
    this.triad.dispose();
    this.gimbals.dispose();
    this.viewCube.dispose();
    this._clearBodies();
    this.renderer.dispose();
    this.container.replaceChildren();
  }
}
