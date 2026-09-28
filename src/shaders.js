// Shared TSL (three.js shading language) materials. TSL compiles to WGSL on
// WebGPU and to GLSL on the WebGL 2 fallback, so the same code runs on both.

import * as THREE from 'three/webgpu';
import {
  Fn, vec3, float, positionWorld, time, mix, smoothstep, clamp, mx_noise_float, exp, max, attribute, sin, cos,
  instanceIndex, positionLocal, texture, pow, abs, normalWorld, uv, normalView, cameraViewMatrix, vec4, normalize,
} from 'three/tsl';
import { TEX } from './assets.js';
import { U } from './uniforms.js';
import { causticLight } from './waterfx.js';

export { U };

// Anything below the water line: light is absorbed with depth (red first,
// which turns deep things teal-green) and the caustics play over it. Returns
// [color, emissive] for a base colour at world position pw.
export function wet(base, pw = positionWorld) {
  const depth = U.waterLevel.sub(pw.y);
  const under = smoothstep(-0.2, 0.4, depth);
  const d = max(depth, 0);
  const absorb = exp(vec3(0.05, 0.018, 0.014).mul(d).negate());
  const color = mix(base, base.mul(absorb).add(U.tint.mul(0.04).mul(float(1).sub(absorb.g))), under);
  const c = causticLight(pw);
  // Only the focused light above the average shows as lines; peaks can be
  // 20× the average, so they're compressed to keep the sand from glaring.
  const lines = clamp(c.sub(0.9), vec3(0), vec3(2.5)).mul(0.4);
  const emissive = color.mul(lines).mul(under).mul(U.daylight).mul(U.caustics);
  return [color, emissive];
}

// Per-material texture tint and tiling (1 / centimetres per tile). Same order
// as MATERIALS in config.js.
const GROUND = [
  { tint: [0.8, 0.78, 0.74], scale: 1 / 20 },  // soil (Poly Haven forest_ground_04)
  { tint: [0.82, 0.78, 0.7], scale: 1 / 12 },  // sand (clean_pebbles)
  { tint: [0.95, 0.95, 0.95], scale: 1 / 11 }, // gravel (SeedThree)
  { tint: [0.95, 0.95, 0.92], scale: 1 / 22 }, // rock (mossy_rock)
  { tint: [0.6, 0.82, 0.48], scale: 1 / 9 },   // moss (SeedThree grass, tinted)
  { tint: [0.85, 0.85, 0.85], scale: 1 / 26 }, // dark stone (lichen_rock)
];

// Triplanar sample: project along x, y and z and blend by the normal, so
// steep banks and the vertical wall aren't smeared.
function triplanar(tex, scale, pw, bf) {
  return texture(tex, pw.yz.mul(scale)).rgb.mul(bf.x)
    .add(texture(tex, pw.zx.mul(scale)).rgb.mul(bf.y))
    .add(texture(tex, pw.xy.mul(scale)).rgb.mul(bf.z));
}
const blendWeights = () => {
  const nb = pow(abs(normalWorld), vec3(4));
  return nb.div(nb.x.add(nb.y).add(nb.z));
};

// Substrate / background: six textures blended by per-vertex weights
// (painted with the brush).
export function substrateMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0 });
  const pw = positionWorld;
  const bf = blendWeights();
  const w0 = attribute('w0', 'vec3'), w1 = attribute('w1', 'vec3');
  const ws = [w0.x, w0.y, w0.z, w1.x, w1.y, w1.z];
  let base = vec3(0);
  GROUND.forEach((g, k) => {
    base = base.add(triplanar(TEX.ground[k], g.scale, pw, bf).mul(vec3(...g.tint)).mul(ws[k]));
  });
  // A wet band just above the water line reads darker and glossier.
  const above = pw.y.sub(U.waterLevel);
  const wetBand = smoothstep(1.8, 0.0, above).mul(smoothstep(-0.3, 0.1, above)).mul(0.4);
  const [color, emissive] = wet(base.mul(float(1).sub(wetBand)), pw);
  m.colorNode = color;
  m.emissiveNode = emissive;
  m.roughnessNode = mix(float(0.95), float(0.45), wetBand.mul(2));
  return m;
}

// Photoscanned hardscape (Poly Haven): keeps the scan's own textures and grows
// moss on the faces that point up (more with the `moss` amount), the way moss
// covers the tops of stones in a humid tank.
export function hardscapeMaterial(src, { moss = 0.6, mossScale = 1 / 9 } = {}) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0 });
  m.shadowSide = THREE.BackSide;
  const pw = positionWorld;
  let base = src.map ? texture(src.map, uv()).rgb : vec3(src.color?.r ?? 0.5, src.color?.g ?? 0.5, src.color?.b ?? 0.5);
  if (src.normalMap) {
    m.normalMap = src.normalMap;
    m.normalScale = new THREE.Vector2(1, 1);
  }
  if (src.roughnessMap) m.roughnessMap = src.roughnessMap;
  if (moss > 0) {
    const up = normalWorld.y;
    const n = mx_noise_float(pw.mul(0.25)).mul(0.5).add(mx_noise_float(pw.mul(0.9)).mul(0.25));
    const aboveWater = smoothstep(0.0, 1.5, pw.y.sub(U.waterLevel));
    const cover = smoothstep(0.75 - moss * 0.6, 0.95 - moss * 0.5, up.add(n)).mul(aboveWater);
    const mossCol = triplanar(TEX.ground[4], mossScale, pw, blendWeights()).mul(vec3(0.55, 0.8, 0.42));
    base = mix(base, mossCol, cover);
  }
  const [color, emissive] = wet(base, pw);
  m.colorNode = color;
  m.emissiveNode = emissive;
  return m;
}

// Vertex-coloured or leaf-card material for instanced plants. A `sway`
// vertex attribute (0 at the base, 1 at the tip) bends the plant; submerged
// plants sway more.
export function plantMaterial({ amp = 0.6, speed = 1.0, underwaterAmp = 2.2, map = null, normalMap = null } = {}) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.75, side: THREE.DoubleSide, vertexColors: true });
  let base = vec3(1);
  if (map) {
    const tx = texture(map, uv());
    base = tx.rgb;
    m.opacityNode = tx.a;
    m.alphaTest = 0.45;
  }
  if (normalMap) m.normalMap = normalMap;
  const sw = attribute('sway', 'float');
  const phase = float(instanceIndex).mul(1.618);
  const pw = positionLocal;
  const underw = smoothstep(0.0, 1.5, U.waterLevel.sub(pw.y));
  const a = mix(float(amp), float(underwaterAmp), underw).mul(sw).mul(sw);
  const t = time.mul(speed);
  const off = vec3(
    sin(t.mul(1.1).add(phase).add(pw.x.mul(0.05))).mul(a),
    0,
    cos(t.mul(0.8).add(phase.mul(1.3)).add(pw.z.mul(0.07))).mul(a.mul(0.7)),
  );
  m.positionNode = positionLocal.add(off);
  const [color, emissive] = wet(base);
  m.colorNode = color;
  // Thin leaves let light through; a little of it keeps shaded foliage from
  // going black (a cheap stand-in for SeedThree's leaf translucency).
  m.emissiveNode = emissive.add(color.mul(U.daylight.mul(0.16).add(0.02)));
  return m;
}

export function creatureMaterial({ rough = 0.5 } = {}) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: rough, metalness: 0.05, vertexColors: true, side: THREE.DoubleSide });
  const [color, emissive] = wet(vec3(1));
  m.colorNode = color;
  m.emissiveNode = emissive;
  return m;
}

export { triplanar, blendWeights, Fn, normalView, cameraViewMatrix, vec4, normalize, clamp };
