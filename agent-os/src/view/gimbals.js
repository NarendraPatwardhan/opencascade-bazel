/**
 * Scene param gimbals — REACTIVITY §9 + DISPLAY draw/pick.
 *
 * Values are owned by the param store. This module only draws and reports hits.
 * Only params with `frame` + `axis` + scrub xform/rebuild get handles.
 * If no frames are registered, nothing is drawn (no fake gimbals).
 */

/**
 * @typedef {{
 *   id: string,
 *   matrix?: number[]|Float32Array,  // 16-element column-major world SE(3)
 *   origin?: [number, number, number],
 *   axes?: { x:[number,number,number], y:[number,number,number], z:[number,number,number] },
 * }} FrameDesc
 */

/**
 * @param {typeof import('three')} THREE
 * @param {{
 *   onChange?: (name: string, value: number) => void,
 *   onCommit?: (name: string, value: number) => void,
 *   getBindings?: () => Array<{ name:string, value:any, scrub?:string, frame?:string, axis?:string, min?:number, max?:number, type?:string, unit?:string }>,
 * }} [handlers]
 */
export function createGimbals(THREE, handlers = {}) {
  const group = new THREE.Group();
  group.name = "ParamGimbals";

  /** @type {Map<string, { origin: import('three').Vector3, x: import('three').Vector3, y: import('three').Vector3, z: import('three').Vector3 }>} */
  const frames = new Map();

  /** @type {import('three').Object3D[]} */
  let handleMeshes = [];

  let handleScale = 1;
  let dragging = null;
  const _raycaster = new THREE.Raycaster();
  const _ndc = new THREE.Vector2();
  const _v = new THREE.Vector3();
  const _w = new THREE.Vector3();

  function mat4OriginAxes(m16) {
    // column-major three.js Matrix4 elements
    const origin = new THREE.Vector3(m16[12], m16[13], m16[14]);
    const x = new THREE.Vector3(m16[0], m16[1], m16[2]).normalize();
    const y = new THREE.Vector3(m16[4], m16[5], m16[6]).normalize();
    const z = new THREE.Vector3(m16[8], m16[9], m16[10]).normalize();
    return { origin, x, y, z };
  }

  /**
   * @param {FrameDesc[]} list
   */
  function setFrames(list) {
    frames.clear();
    for (const f of list || []) {
      if (f.matrix && f.matrix.length >= 16) {
        frames.set(f.id, mat4OriginAxes(f.matrix));
      } else if (f.origin) {
        frames.set(f.id, {
          origin: new THREE.Vector3(f.origin[0], f.origin[1], f.origin[2]),
          x: new THREE.Vector3(...(f.axes?.x || [1, 0, 0])).normalize(),
          y: new THREE.Vector3(...(f.axes?.y || [0, 1, 0])).normalize(),
          z: new THREE.Vector3(...(f.axes?.z || [0, 0, 1])).normalize(),
        });
      }
    }
    rebuild();
  }

  function clearHandles() {
    for (const o of handleMeshes) {
      group.remove(o);
      o.traverse((c) => {
        c.geometry?.dispose?.();
        c.material?.dispose?.();
      });
    }
    handleMeshes = [];
  }

  function axisVec(frame, axis) {
    const a = (axis || "z").toLowerCase();
    if (a === "x") return frame.x;
    if (a === "y") return frame.y;
    return frame.z;
  }

  function rebuild() {
    clearHandles();
    const params = handlers.getBindings?.() || [];
    for (const p of params) {
      if (!p.frame || !frames.has(p.frame)) continue;
      if (p.type === "boolean" || p.type === "enum") continue;
      const fr = frames.get(p.frame);
      const axis = axisVec(fr, p.axis);
      const scrub = p.scrub || "rebuild";

      // Rotate ring for angle-like params (unit rad or name theta/yaw/angle)
      const isAngle =
        p.unit === "rad" ||
        p.unit === "deg" ||
        /theta|yaw|angle|rot/i.test(p.name);

      if (isAngle || scrub === "xform") {
        // Ring in plane perpendicular to axis
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(handleScale * 0.55, handleScale * 0.03, 12, 48),
          new THREE.MeshBasicMaterial({
            color: scrub === "xform" ? 0x8fd4a0 : 0xe0c070,
            transparent: true,
            opacity: 0.9,
            depthTest: true,
          }),
        );
        ring.position.copy(fr.origin);
        // Torus lies in XY; orient so its normal = axis
        ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis);
        ring.userData = {
          kind: "rotate",
          param: p.name,
          axis: axis.clone(),
          origin: fr.origin.clone(),
          startValue: Number(p.value) || 0,
        };
        group.add(ring);
        handleMeshes.push(ring);
      } else {
        // Translate arrow along axis
        const arrow = new THREE.ArrowHelper(
          axis,
          fr.origin,
          handleScale,
          scrub === "rebuild" ? 0xe0c070 : 0x8fd4a0,
          handleScale * 0.2,
          handleScale * 0.12,
        );
        arrow.userData = {
          kind: "translate",
          param: p.name,
          axis: axis.clone(),
          origin: fr.origin.clone(),
          startValue: Number(p.value) || 0,
        };
        // ArrowHelper is Object3D; pick via line/cone children
        arrow.traverse((c) => {
          c.userData = arrow.userData;
        });
        group.add(arrow);
        handleMeshes.push(arrow);
      }
    }
  }

  function setHandleScale(s) {
    handleScale = Math.max(s, 0.05);
    rebuild();
  }

  /**
   * @param {import('three').Camera} camera
   * @param {HTMLElement} dom
   * @param {PointerEvent} e
   */
  function pick(camera, dom, e) {
    if (!handleMeshes.length) return null;
    const rect = dom.getBoundingClientRect();
    _ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    _ndc.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    _raycaster.setFromCamera(_ndc, camera);
    const hits = _raycaster.intersectObjects(handleMeshes, true);
    if (!hits.length) return null;
    let obj = hits[0].object;
    while (obj && !obj.userData?.param) obj = obj.parent;
    return obj?.userData?.param ? { object: obj, userData: obj.userData, point: hits[0].point } : null;
  }

  function beginDrag(hit, clientX, clientY, camera, dom) {
    dragging = {
      ...hit.userData,
      startX: clientX,
      startY: clientY,
      startValue: hit.userData.startValue,
    };
  }

  function moveDrag(clientX, clientY, camera, dom) {
    if (!dragging) return;
    const dx = clientX - dragging.startX;
    // Screen-space scrub: horizontal drag changes value
    const sensitivity =
      dragging.kind === "rotate" ? 0.01 : handleScale * 0.02;
    const next = dragging.startValue + dx * sensitivity;
    dragging.lastValue = next;
    handlers.onChange?.(dragging.param, next);
  }

  function endDrag() {
    if (!dragging) return;
    const v = dragging.lastValue !== undefined ? dragging.lastValue : dragging.startValue;
    handlers.onCommit?.(dragging.param, v);
    dragging = null;
  }

  return {
    group,
    setFrames,
    rebuild,
    setHandleScale,
    pick,
    beginDrag,
    moveDrag,
    endDrag,
    get isDragging() {
      return !!dragging;
    },
    dispose() {
      clearHandles();
    },
  };
}
