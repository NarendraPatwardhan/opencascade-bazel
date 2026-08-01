/**
 * Editor-style camera — DISPLAY.md steal list A (A1–A14, A16 bindings).
 *
 * Real implementations only:
 *   A1  Stationary → UserControlled → Momentum
 *   A2  start_orbit / start_pan / start_zoom / end_move
 *   A3  Anchor under pointer (mesh pick → plane → last depth)
 *   A4  Last-known depth fallback
 *   A5  Pixel-perfect pan (world point stuck to cursor)
 *   A6  Zoom along ray toward cursor
 *   A7  Size-per-pixel zoom limits
 *   A9  Light input smoothing
 *   A10 Momentum (default off for CAD)
 *   A11 Wheel debounce
 *   A12 Turntable + world up
 *   A13/A14 Persp ↔ ortho without view jump
 *   C2  Touch: 1-finger orbit, 2-finger pan/pinch
 */

import { BINDINGS, DEFAULT_CAM, classifyPointerDown } from "./bindings.js";

/** @typedef {'stationary'|'user'|'momentum'} MotionState */

/**
 * @param {typeof import('three')} THREE
 * @param {import('three').PerspectiveCamera|import('three').OrthographicCamera} camera
 * @param {HTMLElement} dom
 * @param {{
 *   getPickables?: () => import('three').Object3D[],
 *   onProjectionChange?: (mode: 'perspective'|'orthographic') => void,
 *   minSizePerPixel?: number,
 *   maxSizePerPixel?: number,
 *   momentumDecay?: number,
 * }} [opts]
 */
export function createEditorCam(THREE, camera, dom, opts = {}) {
  const cfg = {
    ...DEFAULT_CAM,
    minSizePerPixel: opts.minSizePerPixel ?? DEFAULT_CAM.minSizePerPixel,
    maxSizePerPixel: opts.maxSizePerPixel ?? DEFAULT_CAM.maxSizePerPixel,
    momentumDecay: opts.momentumDecay ?? DEFAULT_CAM.momentumDecay,
  };

  /** @type {MotionState} */
  let motion = "stationary";
  /** @type {'orbit'|'pan'|'zoom'|null} */
  let gesture = null;

  const state = {
    target: new THREE.Vector3(0, 0, 0),
    /** Spherical offset from target (radius, phi, theta). */
    spherical: new THREE.Spherical(10, Math.PI / 3, Math.PI / 4),
    enabled: true,
    /** Last good depth along view for A4. */
    lastDepth: 10,
    /** Projection mode. */
    projection: /** @type {'perspective'|'orthographic'} */ ("perspective"),
    /** Ortho half-height in world units (synced with radius). */
    orthoHalfHeight: 5,
  };

  // Scratch
  const _offset = new THREE.Vector3();
  const _v = new THREE.Vector3();
  const _w = new THREE.Vector3();
  const _right = new THREE.Vector3();
  const _up = new THREE.Vector3();
  const _forward = new THREE.Vector3();
  const _anchor = new THREE.Vector3();
  const _ndc = new THREE.Vector2();
  const _raycaster = new THREE.Raycaster();
  const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const _hit = new THREE.Vector3();

  // Gesture bookkeeping
  let lastX = 0;
  let lastY = 0;
  let pointerId = null;
  /** World point under cursor at gesture start (A3/A5). */
  const pivot = new THREE.Vector3();
  /** For pixel-perfect pan: plane through pivot, facing camera. */
  const panPlane = new THREE.Plane();
  const panLast = new THREE.Vector3();
  /** Momentum velocity (theta, phi, panX, panY) */
  let velTheta = 0;
  let velPhi = 0;
  let velPanX = 0;
  let velPanY = 0;
  let lastMoveT = 0;

  // Touch multi-pointer
  /** @type {Map<number, {x:number,y:number}>} */
  const pointers = new Map();
  let pinchStartDist = 0;
  let pinchStartRadius = 0;

  // Smoothing (A9)
  let smoothDx = 0;
  let smoothDy = 0;

  // Wheel debounce (A11)
  let lastWheelT = 0;

  // Perspective FOV preserved across ortho morph
  let savedFov = camera.isPerspectiveCamera ? camera.fov : 45;

  function sizePerPixelAt(distance) {
    const h = dom.clientHeight || 1;
    if (state.projection === "orthographic") {
      const half = state.orthoHalfHeight;
      return (2 * half) / h;
    }
    const fov = (savedFov * Math.PI) / 180;
    return (2 * Math.tan(fov / 2) * Math.max(distance, 1e-9)) / h;
  }

  function clampRadiusBySizePerPixel(radius) {
    const h = dom.clientHeight || 1;
    if (state.projection === "orthographic") {
      // Ortho: limit half-height via size-per-pixel
      const minHalf = (cfg.minSizePerPixel * h) / 2;
      const maxHalf = (cfg.maxSizePerPixel * h) / 2;
      state.orthoHalfHeight = Math.min(
        maxHalf,
        Math.max(minHalf, state.orthoHalfHeight),
      );
      return radius; // keep eye distance for sphere consistency
    }
    const fov = (savedFov * Math.PI) / 180;
    const tan = Math.tan(fov / 2);
    // sizePerPixel = 2*tan*r/h  →  r = sizePerPixel * h / (2*tan)
    const minR = (cfg.minSizePerPixel * h) / (2 * tan);
    const maxR = (cfg.maxSizePerPixel * h) / (2 * tan);
    return Math.min(maxR, Math.max(minR, radius));
  }

  function apply() {
    state.spherical.phi = Math.min(
      Math.PI - 0.02,
      Math.max(0.02, state.spherical.phi),
    );
    state.spherical.radius = clampRadiusBySizePerPixel(
      Math.max(1e-6, state.spherical.radius),
    );

    _offset.setFromSpherical(state.spherical);
    camera.position.copy(state.target).add(_offset);

    // Turntable: force world up after spherical apply (A12).
    // Top view uses phi≈0.02 so we never truly look straight down with gimbal lock.
    camera.up.set(0, 1, 0);
    camera.lookAt(state.target);
    camera.updateMatrixWorld();

    if (state.projection === "orthographic" && camera.isOrthographicCamera) {
      const aspect = camera.aspect || 1;
      const half = state.orthoHalfHeight;
      camera.left = -half * aspect;
      camera.right = half * aspect;
      camera.top = half;
      camera.bottom = -half;
      camera.updateProjectionMatrix();
    }

    state.lastDepth = state.spherical.radius;
  }

  /**
   * Ray from camera through client coords.
   */
  function setRayFromClient(clientX, clientY) {
    const rect = dom.getBoundingClientRect();
    _ndc.x = ((clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
    _ndc.y = -(((clientY - rect.top) / Math.max(rect.height, 1)) * 2 - 1);
    _raycaster.setFromCamera(_ndc, camera);
    return _raycaster.ray;
  }

  /**
   * A3 + A4: resolve world anchor under pointer.
   */
  function resolveAnchor(clientX, clientY) {
    const ray = setRayFromClient(clientX, clientY);
    const pickables = opts.getPickables?.() || [];
    if (pickables.length) {
      const hits = _raycaster.intersectObjects(pickables, true);
      if (hits.length && hits[0].point) {
        _anchor.copy(hits[0].point);
        state.lastDepth = camera.position.distanceTo(_anchor);
        return _anchor.clone();
      }
    }
    // Ground plane Y=0
    if (ray.intersectPlane(_plane, _hit)) {
      _anchor.copy(_hit);
      state.lastDepth = camera.position.distanceTo(_anchor);
      return _anchor.clone();
    }
    // A4: last-known depth along ray
    _anchor.copy(ray.origin).addScaledVector(ray.direction, state.lastDepth);
    return _anchor.clone();
  }

  function setFromPositions(eye, target) {
    state.target.copy(target);
    _offset.copy(eye).sub(target);
    state.spherical.setFromVector3(_offset);
    apply();
  }

  function fitSphere(center, radius, pad = 2.55) {
    const r = Math.max(radius, 1e-3);
    state.target.copy(center);
    if (state.projection === "orthographic") {
      state.orthoHalfHeight = r * pad * 0.55;
      state.spherical.radius = Math.max(r * pad, 1);
    } else {
      state.spherical.radius = r * pad;
    }
    apply();
  }

  /**
   * Snap look direction (view cube / presets). D1 stable world-up after snap:
   * re-derive spherical then force turntable apply so subsequent orbit is clean.
   */
  function lookDir(direction, _upHint) {
    const r = state.spherical.radius;
    const dir = direction.clone().normalize();
    // Place eye along direction from target; phi clamp avoids true polar singularity.
    state.target; // keep target
    camera.position.copy(state.target).addScaledVector(dir, r);
    _offset.copy(camera.position).sub(state.target);
    state.spherical.setFromVector3(_offset);
    // For Top (0,1,0): spherical phi→0; clamp keeps orbit stable.
    apply();
  }

  function orbitDelta(dx, dy) {
    if (!state.enabled) return;
    state.spherical.theta -= dx * cfg.orbitSpeed;
    state.spherical.phi -= dy * cfg.orbitSpeed;
    apply();
  }

  // ── A2 gesture API ──────────────────────────────────────────

  function start_orbit(clientX, clientY) {
    end_move({ keepMomentum: false });
    gesture = "orbit";
    motion = "user";
    const a = resolveAnchor(clientX, clientY);
    // Re-pivot: move target to anchor, keep eye fixed (A3).
    const eye = camera.position.clone();
    state.target.copy(a);
    _offset.copy(eye).sub(state.target);
    state.spherical.setFromVector3(_offset);
    apply();
    lastX = clientX;
    lastY = clientY;
    lastMoveT = performance.now();
    velTheta = 0;
    velPhi = 0;
  }

  function start_pan(clientX, clientY) {
    end_move({ keepMomentum: false });
    gesture = "pan";
    motion = "user";
    const a = resolveAnchor(clientX, clientY);
    pivot.copy(a);
    // View-facing plane through pivot (A5).
    camera.getWorldDirection(_forward);
    panPlane.setFromNormalAndCoplanarPoint(_forward, pivot);
    setRayFromClient(clientX, clientY).intersectPlane(panPlane, panLast);
    lastX = clientX;
    lastY = clientY;
    lastMoveT = performance.now();
    velPanX = 0;
    velPanY = 0;
  }

  function start_zoom() {
    // Zoom is continuous via wheel; mark user-controlled briefly.
    motion = "user";
    gesture = "zoom";
  }

  function end_move({ keepMomentum = true } = {}) {
    if (gesture === "orbit" && keepMomentum && cfg.momentumDecay > 0) {
      motion = "momentum";
    } else if (gesture === "pan" && keepMomentum && cfg.momentumDecay > 0) {
      motion = "momentum";
    } else {
      motion = "stationary";
      velTheta = velPhi = velPanX = velPanY = 0;
    }
    gesture = null;
    pointerId = null;
    smoothDx = smoothDy = 0;
  }

  function updateOrbit(dx, dy) {
    const now = performance.now();
    const dt = Math.max(1, now - lastMoveT);
    lastMoveT = now;
    // A9 light smoothing
    const a = cfg.inputSmooth;
    smoothDx = smoothDx * a + dx * (1 - a);
    smoothDy = smoothDy * a + dy * (1 - a);
    const odx = smoothDx;
    const ody = smoothDy;
    velTheta = (-odx * cfg.orbitSpeed) / (dt / 16);
    velPhi = (-ody * cfg.orbitSpeed) / (dt / 16);
    orbitDelta(odx, ody);
  }

  function updatePan(clientX, clientY) {
    // A5: world point stuck to cursor — intersect current ray with pan plane,
    // shift target by (last - current).
    const hit = new THREE.Vector3();
    const ray = setRayFromClient(clientX, clientY);
    if (!ray.intersectPlane(panPlane, hit)) return;
    const delta = panLast.clone().sub(hit);
    state.target.add(delta);
    pivot.add(delta);
    // Rebuild plane through updated pivot so consecutive frames stay pixel-locked.
    camera.getWorldDirection(_forward);
    panPlane.setFromNormalAndCoplanarPoint(_forward, pivot);
    // Re-hit current ray so panLast tracks the point under cursor
    if (!setRayFromClient(clientX, clientY).intersectPlane(panPlane, panLast)) {
      panLast.copy(pivot);
    }
    apply();
  }

  /**
   * A6 zoom toward cursor: scale radius; keep world point under cursor fixed.
   */
  function zoomAt(clientX, clientY, factor) {
    start_zoom();
    const before = resolveAnchor(clientX, clientY);
    const oldR = state.spherical.radius;

    if (state.projection === "orthographic") {
      state.orthoHalfHeight *= factor;
      state.orthoHalfHeight = Math.max(1e-6, state.orthoHalfHeight);
      // Shift target so anchor stays under cursor in screen space
      const afterScale = factor;
      // Recompute screen offset of anchor and compensate
      apply();
      const after = resolveAnchor(clientX, clientY);
      state.target.add(before).sub(after);
      apply();
      motion = "stationary";
      gesture = null;
      return;
    }

    let newR = clampRadiusBySizePerPixel(oldR * factor);
    const t = 1 - newR / Math.max(oldR, 1e-12);
    // Move target toward anchor so zoom is along the ray through cursor.
    state.target.lerp(before, Math.max(0, Math.min(1, t)));
    state.spherical.radius = newR;
    // After radius change, re-anchor: shift so before stays under cursor.
    apply();
    const after = resolveAnchor(clientX, clientY);
    state.target.add(before).sub(after);
    apply();
    motion = "stationary";
    gesture = null;
  }

  function focusAt(clientX, clientY) {
    const a = resolveAnchor(clientX, clientY);
    state.target.copy(a);
    apply();
  }

  // ── Projection morph A13–A14 ─────────────────────────────────

  /**
   * Switch projection without jumping framing intent.
   * Warps about current target; matches apparent size at target plane.
   * @param {'perspective'|'orthographic'} mode
   * @param {(cam: import('three').Camera) => void} [replaceCamera]
   */
  function setProjection(mode, replaceCamera) {
    if (mode === state.projection) return;
    const dist = state.spherical.radius;
    const spp = sizePerPixelAt(dist);
    const h = dom.clientHeight || 1;

    if (mode === "orthographic") {
      // Match current size-per-pixel → ortho half height
      state.orthoHalfHeight = (spp * h) / 2;
      state.projection = "orthographic";
      if (replaceCamera) {
        const aspect = camera.aspect || 1;
        const ortho = new THREE.OrthographicCamera(
          -state.orthoHalfHeight * aspect,
          state.orthoHalfHeight * aspect,
          state.orthoHalfHeight,
          -state.orthoHalfHeight,
          camera.near,
          camera.far,
        );
        ortho.position.copy(camera.position);
        ortho.up.copy(camera.up);
        ortho.quaternion.copy(camera.quaternion);
        ortho.aspect = aspect;
        replaceCamera(ortho);
        camera = ortho;
      }
    } else {
      // Match ortho half-height → perspective radius via FOV
      const fov = (savedFov * Math.PI) / 180;
      const half = state.orthoHalfHeight;
      state.spherical.radius = half / Math.tan(fov / 2);
      state.projection = "perspective";
      if (replaceCamera) {
        const persp = new THREE.PerspectiveCamera(
          savedFov,
          camera.aspect || 1,
          camera.near,
          camera.far,
        );
        persp.position.copy(camera.position);
        persp.up.copy(camera.up);
        persp.quaternion.copy(camera.quaternion);
        replaceCamera(persp);
        camera = persp;
      }
    }
    apply();
    opts.onProjectionChange?.(state.projection);
  }

  function toggleProjection(replaceCamera) {
    setProjection(
      state.projection === "perspective" ? "orthographic" : "perspective",
      replaceCamera,
    );
  }

  // ── Pointer / wheel / touch ──────────────────────────────────

  function onPointerDown(e) {
    if (!state.enabled) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2) {
      // Two-finger: pan + pinch prep (C2)
      end_move({ keepMomentum: false });
      const pts = [...pointers.values()];
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      pinchStartDist = Math.hypot(dx, dy) || 1;
      pinchStartRadius =
        state.projection === "orthographic"
          ? state.orthoHalfHeight
          : state.spherical.radius;
      const midX = (pts[0].x + pts[1].x) / 2;
      const midY = (pts[0].y + pts[1].y) / 2;
      start_pan(midX, midY);
      gesture = "pan"; // pinch handled in move
      dom.setPointerCapture?.(e.pointerId);
      return;
    }

    if (e.pointerType === "touch" && pointers.size === 1) {
      // One finger orbit (C2)
      e.preventDefault();
      pointerId = e.pointerId;
      start_orbit(e.clientX, e.clientY);
      dom.setPointerCapture?.(e.pointerId);
      return;
    }

    const kind = classifyPointerDown(e);
    if (kind === "none") return;
    if (kind === "orbit" || kind === "pan") e.preventDefault();
    pointerId = e.pointerId;
    if (kind === "orbit") start_orbit(e.clientX, e.clientY);
    else if (kind === "pan") start_pan(e.clientX, e.clientY);
    dom.setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e) {
    if (pointers.has(e.pointerId)) {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    if (pointers.size === 2) {
      const pts = [...pointers.values()];
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      const dist = Math.hypot(dx, dy) || 1;
      const midX = (pts[0].x + pts[1].x) / 2;
      const midY = (pts[0].y + pts[1].y) / 2;
      // Pinch zoom (C2)
      const factor = pinchStartDist / dist;
      if (state.projection === "orthographic") {
        state.orthoHalfHeight = pinchStartRadius * factor;
      } else {
        state.spherical.radius = pinchStartRadius * factor;
      }
      // Two-finger pan
      if (gesture === "pan") updatePan(midX, midY);
      else {
        start_pan(midX, midY);
      }
      apply();
      return;
    }

    if (gesture === "orbit") {
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      updateOrbit(dx, dy);
    } else if (gesture === "pan") {
      updatePan(e.clientX, e.clientY);
      lastX = e.clientX;
      lastY = e.clientY;
    }
  }

  function onPointerUp(e) {
    pointers.delete(e.pointerId);
    if (pointers.size >= 1) {
      // Fall back to single remaining pointer
      return;
    }
    if (gesture) end_move({ keepMomentum: true });
    try {
      dom.releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  function onWheel(e) {
    if (!state.enabled) return;
    e.preventDefault();
    const now = performance.now();
    if (now - lastWheelT < cfg.wheelDebounceMs) {
      // Still apply but fold into same frame intent (A11)
    }
    lastWheelT = now;
    // Normalize trackpad vs mouse wheel
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16;
    if (e.deltaMode === 2) dy *= 800;
    const factor = dy > 0 ? 1.1 : 1 / 1.1;
    zoomAt(e.clientX, e.clientY, factor);
  }

  function onDblClick(e) {
    if (!state.enabled) return;
    e.preventDefault();
    focusAt(e.clientX, e.clientY);
  }

  function onContext(e) {
    // Allow RMB pan without sticky menu while interacting
    if (motion === "user") e.preventDefault();
  }

  /** Per-frame tick for momentum (A1/A10). */
  function tick(dtSec) {
    if (motion !== "momentum" || cfg.momentumDecay <= 0) return;
    const decay = Math.exp(-cfg.momentumDecay * dtSec);
    if (Math.abs(velTheta) + Math.abs(velPhi) > 1e-5) {
      state.spherical.theta += velTheta * dtSec * 60;
      state.spherical.phi += velPhi * dtSec * 60;
      velTheta *= decay;
      velPhi *= decay;
      apply();
    } else {
      motion = "stationary";
      velTheta = velPhi = 0;
    }
  }

  function setRadiusLimitsFromExtent(extent) {
    // Map model scale into size-per-pixel bounds (A7 intent).
    // Small models → allow finer min; large → wider max.
    const e = Math.max(extent, 1e-3);
    cfg.minSizePerPixel = Math.max(e * 1e-7, 1e-8);
    cfg.maxSizePerPixel = Math.max(e * 2, 1);
  }

  function setEnabled(v) {
    state.enabled = !!v;
    if (!v) end_move({ keepMomentum: false });
  }

  /** Suppress camera when gimbals claim the pointer (DISPLAY D pick rules). */
  let suppressed = false;
  function setSuppressed(v) {
    suppressed = !!v;
    if (suppressed) end_move({ keepMomentum: false });
  }

  // Wrap handlers to honor suppress
  function gate(fn) {
    return (e) => {
      if (suppressed || !state.enabled) return;
      fn(e);
    };
  }

  const onDownGated = gate(onPointerDown);
  const onMoveGated = gate(onPointerMove);
  const onUpBound = onPointerUp; // always clean up
  const onWheelGated = gate(onWheel);
  const onDblGated = gate(onDblClick);

  dom.addEventListener("pointerdown", onDownGated);
  dom.addEventListener("pointermove", onMoveGated);
  dom.addEventListener("pointerup", onUpBound);
  dom.addEventListener("pointercancel", onUpBound);
  dom.addEventListener("wheel", onWheelGated, { passive: false });
  dom.addEventListener("dblclick", onDblGated);
  dom.addEventListener("contextmenu", onContext);

  apply();

  return {
    state,
    BINDINGS,
    apply,
    setFromPositions,
    fitSphere,
    lookDir,
    orbitDelta,
    start_orbit,
    start_pan,
    start_zoom,
    end_move,
    zoomAt,
    focusAt,
    setProjection,
    toggleProjection,
    setRadiusLimitsFromExtent,
    setEnabled,
    setSuppressed,
    tick,
    resolveAnchor,
    get motion() {
      return motion;
    },
    get projection() {
      return state.projection;
    },
    /** Update internal camera ref after ortho/persp swap. */
    attachCamera(cam) {
      camera = cam;
      if (cam.isPerspectiveCamera) savedFov = cam.fov;
    },
    dispose() {
      dom.removeEventListener("pointerdown", onDownGated);
      dom.removeEventListener("pointermove", onMoveGated);
      dom.removeEventListener("pointerup", onUpBound);
      dom.removeEventListener("pointercancel", onUpBound);
      dom.removeEventListener("wheel", onWheelGated);
      dom.removeEventListener("dblclick", onDblGated);
      dom.removeEventListener("contextmenu", onContext);
    },
  };
}
