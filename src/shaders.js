// Shared TSL (three.js shading language) uniforms and functions. TSL compiles
// to WGSL on WebGPU and to GLSL on the WebGL 2 fallback, so the same code runs
// on both back ends.

import * as THREE from 'three/webgpu';
import {
  Fn, uniform, vec2, vec3, float, positionWorld, time, mix, smoothstep, clamp,
  mx_worley_noise_float, mx_noise_float, vertexColor, exp, max, attribute, sin, cos, instanceIndex,
  positionLocal, texture, pow, abs, normalWorld, uv,
} from 'three/tsl';
import { TEX } from './assets.js';

export const U = {
  waterLevel: uniform(14),
  daylight: uniform(1),         // 0 night … 1 full light
  caustics: uniform(1),         // strength
  tint: uniform(new THREE.Color(0.35, 0.72, 0.78)),
  swayTime: uniform(0),
};

// Two drifting layers of cellular noise. Where the cell borders of both layers
// line up you get the bright, net-like lines that light makes on a pool floor
// after the wavy surface focuses it.
export const causticsAt = Fn(([p]) => {
  const t = time.mul(0.45);
  const q = p.mul(0.16);
  const a = mx_worley_noise_float(vec3(q.x, q.y, t));
  const b = mx_worley_noise_float(vec3(q.x.mul(1.3).add(5.2), q.y.mul(1.3).sub(1.7), t.mul(1.25).add(3.0)));
  const la = smoothstep(0.42, 0.95, a);
  const lb = smoothstep(0.42, 0.95, b);
  return la.mul(lb).mul(2.4).add(la.add(lb).mul(0.18));
});

// Per-material texture tint and tiling (1 / centimetres per tile). Same order
// as MATERIALS in config.js.
const GROUND = [
  { tint: [0.46, 0.35, 0.28], scale: 1 / 16 }, // soil
  { tint: [1.12, 1.04, 0.9], scale: 1 / 22 },  // sand
  { tint: [0.95, 0.95, 0.95], scale: 1 / 11 }, // gravel
  { tint: [1.0, 0.98, 0.95], scale: 1 / 24 },  // rock
  { tint: [0.6, 0.82, 0.48], scale: 1 / 9 },   // moss
  { tint: [1.35, 1.05, 0.8], scale: 1 / 26 },  // cork / bark
];

// Triplanar sample: project the texture along x, y and z and blend by the
// surface normal, so steep banks and the vertical wall aren't smeared.
function triplanar(tex, scale, pw, bf) {
  return texture(tex, pw.yz.mul(scale)).rgb.mul(bf.x)
    .add(texture(tex, pw.zx.mul(scale)).rgb.mul(bf.y))
    .add(texture(tex, pw.xy.mul(scale)).rgb.mul(bf.z));
}

// Substrate / background material: six textured materials blended by
// per-vertex weights (painted with the brush), dimmed and tinted with depth
// below the water line, and lit by caustics.
export function substrateMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0 });
  const pw = positionWorld;
  const depth = U.waterLevel.sub(pw.y);
  const under = smoothstep(-0.15, 0.6, depth);
  const nb = pow(abs(normalWorld), vec3(4));
  const bf = nb.div(nb.x.add(nb.y).add(nb.z));
  const w0 = attribute('w0', 'vec3'), w1 = attribute('w1', 'vec3');
  const ws = [w0.x, w0.y, w0.z, w1.x, w1.y, w1.z];
  let base = vec3(0);
  GROUND.forEach((g, k) => {
    base = base.add(triplanar(TEX.ground[k], g.scale, pw, bf).mul(vec3(...g.tint)).mul(ws[k]));
  });
  // Wet band just above the water line reads darker.
  const wet = smoothstep(1.6, 0.0, depth.negate()).mul(float(1).sub(under)).mul(0.35);
  const absorb = exp(max(depth, 0).mul(-0.035));
  const underCol = mix(U.tint.mul(0.35), base, absorb);
  m.colorNode = mix(base.mul(float(1).sub(wet)), underCol, under);
  const c = causticsAt(pw.xz).mul(under).mul(absorb).mul(U.daylight).mul(U.caustics);
  m.emissiveNode = base.add(0.25).mul(c).mul(0.55);
  m.roughnessNode = mix(float(0.95), float(0.55), wet.add(under.mul(0.3)));
  return m;
}

// Vertex-coloured material for instanced plants. A `sway` vertex attribute
// (0 at the base, 1 at the tip) bends the plant; submerged plants sway more.
export function plantMaterial({ amp = 0.6, speed = 1.0, underwaterAmp = 2.2, map = null } = {}) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.75, side: THREE.DoubleSide, vertexColors: true });
  if (map) {
    // Alpha-tested leaf card (SeedThree textures).
    const tx = texture(map, uv());
    m.colorNode = tx.rgb;
    m.opacityNode = tx.a;
    m.alphaTest = 0.45;
  }
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
  const depth = U.waterLevel.sub(positionWorld.y);
  const under = smoothstep(-0.1, 0.5, depth);
  const c = causticsAt(positionWorld.xz).mul(under).mul(U.daylight).mul(U.caustics);
  m.emissiveNode = vec3(0.2, 0.3, 0.15).mul(c).mul(0.5);
  return m;
}

export function creatureMaterial({ rough = 0.5, emissive = null } = {}) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: rough, metalness: 0.05, vertexColors: true, side: THREE.DoubleSide });
  const depth = U.waterLevel.sub(positionWorld.y);
  const under = smoothstep(-0.1, 0.5, depth);
  const c = causticsAt(positionWorld.xz).mul(under).mul(U.daylight).mul(U.caustics);
  let e = vec3(0.35, 0.4, 0.4).mul(c).mul(0.5);
  if (emissive) e = e.add(emissive);
  m.emissiveNode = e;
  return m;
}

export { vec2 };
