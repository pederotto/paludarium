// Shared TSL (three.js shading language) materials. TSL compiles to WGSL on
// WebGPU and to GLSL on the WebGL 2 fallback, so the same code runs on both.

import * as THREE from 'three/webgpu';
import {
  Fn, vec3, float, positionWorld, time, mix, smoothstep, clamp, mx_noise_float, exp, max, min, attribute, sin, cos,
  instanceIndex, positionLocal, dot, vec2, saturate, instanceColor, texture, pow, abs, normalWorld, uv, normalView, cameraViewMatrix, vec4, normalize, cameraPosition, sign,
} from 'three/tsl';
import { TEX } from './assets.js';
import { U, SOIL } from './uniforms.js';
import { AIR } from './airflow.js';
import { causticLight } from './waterfx.js';
import { TANK } from '../sim/tank.js';

export { U };

// Anything under water. Two things happen to the light:
//  - on the way down from the lamp, water soaks up red first, so deep
//    things turn teal-green and darker;
//  - on the way to your eye it is absorbed again and the water scatters
//    its own faint colour into the view (Beer–Lambert along the view ray,
//    up to where the ray leaves the water: the surface or the glass). This
//    is what makes a tank look full of water rather than of air, and it is
//    thicker when the water is green with algae or cloudy.
// The caustics play over everything below the surface. Returns
// [color, emissive] for a base colour at world position pw; `surf` is the
// height of the water surface above this point.
export function wet(base, pw = positionWorld, surf = U.waterLevel, k = 1, fogK = 1) {
  const depth = surf.sub(pw.y);
  const under = smoothstep(-0.2, 0.4, depth);
  const d = max(depth, 0);
  // (Stronger than pure water, as in a planted tank with tannins and fine
  // suspended matter; it keeps the sand from glaring under the LED.)
  const down = exp(vec3(0.075, 0.032, 0.024).mul(d).add(0.25).mul(U.turbidity.add(1)).mul(k).negate());
  const toEye = normalize(cameraPosition.sub(pw));
  const tSurf = toEye.y.greaterThan(0.01).select(d.div(max(toEye.y, 0.01)), float(1e4));
  const tFront = toEye.z.greaterThan(0.01).select(float(TANK.d / 2).sub(pw.z).div(max(toEye.z, 0.01)), float(1e4));
  const tSide = float(TANK.w / 2).sub(pw.x.mul(sign(toEye.x))).div(max(abs(toEye.x), 0.01));
  const path = clamp(min(tSurf, min(tFront, tSide)), 0, 250);
  const sigma = vec3(0.022, 0.011, 0.0095).mul(U.turbidity.mul(3).add(1)).mul(k);
  const T = exp(sigma.mul(path).negate());
  const fog = U.tint.mul(U.daylight.mul(0.16).add(0.015)).mul(exp(d.mul(-0.02)));
  const color = mix(base, base.mul(down).mul(T), under);
  const c = causticLight(pw);
  // Only the focused light above the average shows as lines; peaks can be
  // 20× the average, so they're compressed to keep the sand from glaring.
  const lines = clamp(c.sub(0.9), vec3(0), vec3(2.5)).mul(0.28);
  const emissive = color.mul(lines).mul(U.daylight).mul(U.caustics).add(fog.mul(float(1).sub(T)).mul(fogK)).mul(under);
  return [color, emissive];
}

// Per-material texture tint and tiling (1 / centimetres per tile). Same order
// as MATERIALS in config.js.
const GROUND = [
  { tint: [0.8, 0.78, 0.74], scale: 1 / 20 },  // soil (Poly Haven forest_ground_04)
  { tint: [0.62, 0.58, 0.5], scale: 1 / 12 },  // sand (clean_pebbles)
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
export function substrateMaterial({ perVertexWater = false } = {}) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0 });
  const pw = positionWorld;
  const bf = blendWeights();
  const w0 = attribute('w0', 'vec3'), w1 = attribute('w1', 'vec3');
  const ws = [w0.x, w0.y, w0.z, w1.x, w1.y, w1.z];
  let base = vec3(0);
  GROUND.forEach((g, k) => {
    base = base.add(triplanar(TEX.ground[k], g.scale, pw, bf).mul(vec3(...g.tint)).mul(ws[k]));
  });
  // The water over this point: the main pool, or (substrate) any pool or
  // stream, written per vertex by the water simulation.
  const surf = perVertexWater ? attribute('wsurf', 'float') : U.waterLevel;
  if (perVertexWater) {
    // The floor (not the background): humus darkens and enriches the soil, and leaf litter
    // darkens it in patches (both written by sim/humus.js into one small texture).
    const g = texture(SOIL.tex, vec2(pw.x.div(TANK.w).add(0.5), pw.z.div(TANK.d).add(0.5)));
    const soilW = clamp(ws[0].add(ws[4].mul(0.35)), 0, 1);
    const humusA = clamp(g.r.mul(1.15), 0, 1).mul(soilW);
    const richer = base.mul(vec3(0.34, 0.27, 0.2)).add(vec3(0.02, 0.012, 0.006));
    base = mix(base, richer, humusA.mul(0.88));
    const dryLand = smoothstep(-0.3, 0.4, pw.y.sub(surf));
    const nz1 = mx_noise_float(pw.mul(0.55)).mul(0.5).add(0.5), nz2 = mx_noise_float(pw.mul(2.6)).mul(0.5).add(0.5);
    const patches = smoothstep(float(1).sub(g.g.mul(1.5)), float(1.16).sub(g.g.mul(1.5)), nz1.mul(0.65).add(nz2.mul(0.35)));
    const litterCol = mix(vec3(0.30, 0.17, 0.07), vec3(0.17, 0.10, 0.05), nz2);
    base = mix(base, litterCol, patches.mul(smoothstep(0.03, 0.2, g.g)).mul(0.62).mul(dryLand).mul(float(1).sub(ws[4].mul(0.6))));
  }
  // A wet band just above the water line reads darker and glossier.
  const above = pw.y.sub(surf);
  const wetBand = smoothstep(1.8, 0.0, above).mul(smoothstep(-0.3, 0.1, above)).mul(0.4);
  // Algae film on everything under water (green), or brown diatoms in a new tank.
  const film = smoothstep(0.2, -0.5, above).mul(U.algaeFilm).mul(mx_noise_float(pw.mul(0.4)).mul(0.4).add(0.6));
  base = mix(base, U.algaeColor, clamp(film, 0, 0.75));
  const [color, emissive] = wet(base.mul(float(1).sub(wetBand)), pw, surf);
  m.colorNode = color;
  m.emissiveNode = emissive;
  m.roughnessNode = mix(float(0.95), float(0.45), wetBand.mul(2));
  return m;
}

// White mould creeping over wood and stone in stale, wet air: patches open up
// where a coarse noise passes a threshold that falls as U.mold rises, with a
// fine fuzz inside them. Only above the waterline.
export function mouldMix(base, pw) {
  const coarse = mx_noise_float(pw.mul(1.7)).mul(0.5).add(0.5);
  const mid = mx_noise_float(pw.mul(6.3)).mul(0.5).add(0.5);
  const n = coarse.mul(0.78).add(mid.mul(0.22));
  const edge = float(1.02).sub(U.mold.mul(0.62));
  const dry = smoothstep(0.0, 1.0, pw.y.sub(U.waterLevel));
  const patch = smoothstep(edge, edge.add(0.2), n).mul(smoothstep(0.02, 0.12, U.mold)).mul(dry);
  const fuzz = mx_noise_float(pw.mul(24)).mul(0.5).add(0.5);
  return mix(base, mix(vec3(0.68, 0.7, 0.64), vec3(0.88, 0.89, 0.84), fuzz), patch.mul(0.72));
}

// Photoscanned hardscape (Poly Haven): keeps the scan's own textures and grows
// moss on the faces that point up (more with the `moss` amount), the way moss
// covers the tops of stones in a humid tank.
export function hardscapeMaterial(src, { moss = 0.6, mossScale = 1 / 9, tint = null } = {}) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0 });
  m.shadowSide = THREE.BackSide;
  const pw = positionWorld;
  let base = src.map ? texture(src.map, uv()).rgb : vec3(src.color?.r ?? 0.5, src.color?.g ?? 0.5, src.color?.b ?? 0.5);
  if (tint) base = base.mul(vec3(tint[0], tint[1], tint[2]));   // per-piece colour variation
  if (src.normalMap) {
    m.normalMap = src.normalMap;
    m.normalScale = new THREE.Vector2(1, 1);
  }
  if (src.roughnessMap) m.roughnessMap = src.roughnessMap;
  if (moss > 0) {
    const up = normalWorld.y;
    const n = mx_noise_float(pw.mul(0.25)).mul(0.5).add(mx_noise_float(pw.mul(0.9)).mul(0.25));
    const aboveWater = smoothstep(0.0, 1.5, pw.y.sub(U.waterLevel));
    const cover = smoothstep(0.75 - moss * 0.6, 0.95 - moss * 0.5, up.add(n).sub(float(1).sub(U.rockMoss).mul(0.9))).mul(aboveWater);
    const mossCol = triplanar(TEX.ground[4], mossScale, pw, blendWeights()).mul(vec3(0.55, 0.8, 0.42));
    base = mix(base, mossCol, cover);
  }
  const film = smoothstep(0.2, -0.5, pw.y.sub(U.waterLevel)).mul(U.algaeFilm).mul(mx_noise_float(pw.mul(0.5)).mul(0.4).add(0.6));
  base = mix(base, U.algaeColor, clamp(film, 0, 0.7));
  base = mouldMix(base, pw);
  const [color, emissive] = wet(base, pw);
  m.colorNode = color;
  m.emissiveNode = emissive;
  return m;
}

// Vertex-coloured or leaf-card material for instanced plants. A `sway`
// vertex attribute (0 at the base, 1 at the tip) bends the plant; submerged
// plants sway more.
//
// Look: matte leaves (no sheen), natural saturated greens, a gentle back-lit
// glow where light shines through the leaf (faces turned away from the lamp),
// and a gentler water absorption than the sand gets (U.plantWater), so a
// submerged leaf stays green instead of washing out to teal-white. Every
// emissive term is multiplied by the leaf's own colour (vertex x instance x
// texture) so nothing glows white.
export function plantMaterial({ amp = 0.6, speed = 1.0, underwaterAmp = 2.2, map = null, normalMap = null } = {}) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.96, metalness: 0, side: THREE.DoubleSide, vertexColors: true });
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
  // `amp` and `underwaterAmp` are the full-strength bends; how much of that happens is set by the real air and
  // water movement (render/airflow.js): still air and still water mean still plants.
  const a = mix(float(amp).mul(AIR.air), float(underwaterAmp).mul(AIR.flow), underw).mul(sw).mul(sw);
  const t = time.mul(speed);
  const off = vec3(
    sin(t.mul(1.1).add(phase).add(pw.x.mul(0.05))).mul(a),
    0,
    cos(t.mul(0.8).add(phase.mul(1.3)).add(pw.z.mul(0.07))).mul(a.mul(0.7)),
  );
  m.positionNode = positionLocal.add(off);
  // The leaf's own colour, as the diffuse term will see it (the material multiplies it in on its own).
  const leaf = base.mul(attribute('color', 'vec3')).mul(instanceColor);
  const [color, emissive] = wet(base, positionWorld, U.waterLevel, U.plantWater, U.plantWater.mul(0.5));
  m.colorNode = color;
  // Caustic light and the water's own scatter in `emissive` were computed on a white base: the caustic part must
  // carry the leaf colour, the scatter is cut down (the leaf is not a mirror of the water).
  const lum = leaf.x.mul(0.3).add(leaf.y.mul(0.59)).add(leaf.z.mul(0.11));
  const sat = mix(vec3(lum), leaf, 1.1);
  const tinted = emissive.mul(sat);
  // Back-light: the face we see is turned away from the lamp (n.up < 0) or edge-on to it.
  const facing = dot(normalWorld, vec3(0, 1, 0));
  const back = saturate(facing.mul(-0.7).add(0.35));
  const glow = sat.mul(vec3(1.0, 1.12, 0.62)).mul(U.daylight.mul(0.2).add(0.02)).mul(back.mul(0.7).add(0.3));
  m.emissiveNode = tinted.add(glow.mul(color));
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
