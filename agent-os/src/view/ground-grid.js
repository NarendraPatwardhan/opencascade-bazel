/**
 * Infinite ground grid — DISPLAY.md Option B (B1–B13).
 *
 * Camera-relative plane sampling world XZ (B8). Shader does major/minor AA
 * lines (B4, B7), distance fade (B6), axis emphasis (B10), depthWrite off (B9).
 */

const VERT = /* glsl */ `
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
precision highp float;
varying vec3 vWorldPos;
uniform vec3 uCameraPos;
uniform float uMinor;
uniform float uMajor;
uniform vec3 uMinorColor;
uniform vec3 uMajorColor;
uniform float uMinorOpacity;
uniform float uMajorOpacity;
uniform float uFadeStart;
uniform float uFadeEnd;
uniform float uOpacity;
uniform float uAxisWidth;
uniform vec3 uAxisXColor;
uniform vec3 uAxisZColor;

// AA line from distance to cell edge in world units (B7 / B12)
float aaLine(float coord, float cell) {
  float halfCell = cell * 0.5;
  float d = abs(mod(coord + halfCell, cell) - halfCell);
  float w = fwidth(coord);
  // ~1px line thickness in screen space via fwidth
  return 1.0 - smoothstep(0.0, w * 1.25, d);
}

void main() {
  float x = vWorldPos.x;
  float z = vWorldPos.z;

  float minorX = aaLine(x, uMinor);
  float minorZ = aaLine(z, uMinor);
  float majorX = aaLine(x, uMajor);
  float majorZ = aaLine(z, uMajor);

  float minor = max(minorX, minorZ);
  float major = max(majorX, majorZ);

  vec3 col = uMinorColor;
  float a = minor * uMinorOpacity;

  if (major > 0.0) {
    col = mix(col, uMajorColor, major);
    a = max(a, major * uMajorOpacity);
  }

  // Axis emphasis through origin (B10)
  float w = fwidth(x) + fwidth(z);
  float ax = 1.0 - smoothstep(0.0, w * uAxisWidth, abs(z)); // X axis along z≈0
  float az = 1.0 - smoothstep(0.0, w * uAxisWidth, abs(x)); // Z axis along x≈0
  if (ax > 0.01) {
    col = mix(col, uAxisXColor, ax);
    a = max(a, ax * 0.95);
  }
  if (az > 0.01) {
    col = mix(col, uAxisZColor, az);
    a = max(a, az * 0.95);
  }

  float dist = length(uCameraPos.xz - vWorldPos.xz);
  float fade = 1.0 - smoothstep(uFadeStart, uFadeEnd, dist);
  a *= fade * uOpacity;

  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
}
`;

/**
 * @typedef {object} InfiniteGridSettings
 * @property {number} [minor]
 * @property {number} [major]
 * @property {number} [planeSize]  visual plane extent (camera-centered)
 * @property {number} [opacity]
 * @property {number} [fadeStart]
 * @property {number} [fadeEnd]
 * @property {boolean} [visible]
 * @property {boolean} [axisEmphasis]
 */

/**
 * @param {typeof import('three')} THREE
 * @param {InfiniteGridSettings} [opts]
 */
export function createGroundGrid(THREE, opts = {}) {
  /** @type {Required<InfiniteGridSettings>} */
  const settings = {
    minor: opts.minor ?? 1,
    major: opts.major ?? 10,
    planeSize: opts.planeSize ?? 200,
    opacity: opts.opacity ?? 1,
    fadeStart: opts.fadeStart ?? 40,
    fadeEnd: opts.fadeEnd ?? 95,
    visible: opts.visible !== false,
    axisEmphasis: opts.axisEmphasis !== false,
  };

  // Unit plane in XZ (rotate from XY); scaled + recentered each frame (B8)
  const geom = new THREE.PlaneGeometry(1, 1, 1, 1);
  geom.rotateX(-Math.PI / 2);

  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false, // B9
    depthTest: true,
    side: THREE.DoubleSide,
    uniforms: {
      uCameraPos: { value: new THREE.Vector3() },
      uMinor: { value: settings.minor },
      uMajor: { value: settings.major },
      uMinorColor: { value: new THREE.Color(0x3a4558) },
      uMajorColor: { value: new THREE.Color(0x5a6a82) },
      uMinorOpacity: { value: 0.35 },
      uMajorOpacity: { value: 0.55 },
      uFadeStart: { value: settings.fadeStart },
      uFadeEnd: { value: settings.fadeEnd },
      uOpacity: { value: settings.opacity },
      uAxisWidth: { value: settings.axisEmphasis ? 2.5 : 0.0 },
      uAxisXColor: { value: new THREE.Color(0xc45c5c) },
      uAxisZColor: { value: new THREE.Color(0x4a7fd4) },
    },
  });

  const mesh = new THREE.Mesh(geom, mat);
  mesh.name = "GroundGrid";
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  mesh.visible = settings.visible;

  /**
   * B8: center plane on camera XZ; scale so fadeEnd is covered.
   * @param {import('three').Camera} camera
   */
  function update(camera) {
    const pos = camera.position;
    mat.uniforms.uCameraPos.value.copy(pos);

    // Scale plane to cover fade sphere with margin
    const cover = Math.max(settings.fadeEnd * 2.2, settings.planeSize);
    mesh.scale.set(cover, 1, cover);
    mesh.position.set(pos.x, 0, pos.z);
  }

  function setCellSizes(minor, major) {
    settings.minor = Math.max(minor, 1e-9);
    settings.major = Math.max(major, settings.minor);
    mat.uniforms.uMinor.value = settings.minor;
    mat.uniforms.uMajor.value = settings.major;
  }

  /**
   * Auto cell sizes from model extent.
   * @param {number} extent
   */
  function adaptToExtent(extent) {
    const e = Math.max(extent, 1e-3);
    let minor;
    if (e > 200) minor = 10;
    else if (e > 50) minor = 5;
    else if (e > 5) minor = 1;
    else if (e > 0.5) minor = 0.1;
    else minor = 0.01;
    setCellSizes(minor, minor * 10);
    // Fade scales with model so horizon stays clean
    settings.fadeStart = Math.max(e * 3, 8);
    settings.fadeEnd = Math.max(e * 8, 24);
    mat.uniforms.uFadeStart.value = settings.fadeStart;
    mat.uniforms.uFadeEnd.value = settings.fadeEnd;
  }

  function setVisible(v) {
    settings.visible = !!v;
    mesh.visible = settings.visible;
  }

  function setSettings(partial) {
    Object.assign(settings, partial);
    mat.uniforms.uMinor.value = settings.minor;
    mat.uniforms.uMajor.value = settings.major;
    mat.uniforms.uOpacity.value = settings.opacity;
    mat.uniforms.uFadeStart.value = settings.fadeStart;
    mat.uniforms.uFadeEnd.value = settings.fadeEnd;
    mat.uniforms.uAxisWidth.value = settings.axisEmphasis ? 2.5 : 0.0;
    mesh.visible = settings.visible;
  }

  return {
    mesh,
    settings,
    update,
    setCellSizes,
    adaptToExtent,
    setVisible,
    setSettings,
    dispose() {
      geom.dispose();
      mat.dispose();
    },
  };
}
