// Shared TSL (three.js shading language) materials. TSL compiles to WGSL on
// WebGPU and to GLSL on the WebGL 2 fallback, so the same code runs on both.

import * as THREE from 'three/webgpu';
import {
  Fn, If, vec3, float, positionWorld, time, mix, smoothstep, clamp, exp, max, min, attribute, sin, cos,
  instanceIndex, positionLocal, dot, saturate, instanceColor, texture, pow, abs, normalWorld, uv, normalView, cameraViewMatrix, vec4, normalize, cameraPosition, sign,
  mrt, packNormalToRGB, screenCoordinate, fract, step, vec2, uniform, faceDirection,
} from 'three/tsl';
import { noise3 } from './noise3.js';
import { TEX } from './assets.js';
import { positionView, cross } from 'three/tsl';   // (the floor's moss relief, substrateMaterial)
import { positionGeometry, specularColor, specularColorBlended, specularF90 } from 'three/tsl';   // (orchid leaves: wax, mottling)
import { U, SOIL } from './uniforms.js';
import { AIR } from './airflow.js';
import { BEND_MAX, V50, ATANH_HALF } from '../util/plantbend.js';
import { causticLight, surfaceHeight, FX, tankUV } from './waterfx.js';
import { TANK } from '../sim/tank.js';

export { U, noise3 };

// Foliage and ambient occlusion: GTAO on thin, overlapping blades is noisy (a dark speckle across dense clumps),
// so plant materials write 0 into the alpha of the scene pass's normal target, and gfx.js skips the AO darkening
// where that alpha is 0. Only valid while the scene pass has an MRT (AO or photo mode): gfx.js flips it.
export const FOLIAGE = { mrt: false };
export function setFoliageMRT(m, on) {
  m.mrtNode = on ? mrt({ normal: vec4(packNormalToRGB(normalView), 0) }) : null;
  m.needsUpdate = true;
}

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
// height of the water surface above this point. `edge` (cm, optional): the
// waterline as a sharp line of that half-width instead of a soft band
// (animals: the line where the drawn surface cuts the body, see waterAt).
export function wet(base, pw = positionWorld, surf = U.waterLevel, k = 1, fogK = 1, edge = null) {
  const depth = surf.sub(pw.y);
  const under = edge ? smoothstep(edge.negate(), edge, depth) : smoothstep(-0.2, 0.4, depth);
  const d = max(depth, 0);
  // (Stronger than pure water, as in a planted tank with tannins and fine
  // suspended matter; it keeps the sand from glaring under the LED.)
  const down = exp(vec3(0.075, 0.032, 0.024).mul(d).add(0.25).mul(U.turbidity.add(1)).mul(k).negate());
  const toEye = normalize(cameraPosition.sub(pw));
  const tSurf = toEye.y.greaterThan(0.01).select(d.div(max(toEye.y, 0.01)), float(1e4));
  const tFront = toEye.z.greaterThan(0.01).select(U.tankHalf.y.sub(pw.z).div(max(toEye.z, 0.01)), float(1e4));
  const tSide = U.tankHalf.x.sub(pw.x.mul(sign(toEye.x))).div(max(abs(toEye.x), 0.01));
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

// The water's surface over world point pw as it is drawn: the main pool's level moved by its ripples and small waves
// (render/waterfx.js surfaceAt), or a still pond's own level where one lies higher (its surface is not moved). Far below
// everything where there is no water. For things that pierce the surface (an animal floating), so their waterline is where the
// drawn surface cuts them, rising and falling as a ring passes.
export function waterAt(pw = positionWorld) {
  return max(U.waterLevel.add(surfaceHeight(pw.xz)), FX.terrainH.sample(tankUV(pw.xz)).g);
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
  // (2026-10-04) The floor's soil and moss. The soil photo repeated every 20 cm across the land as one print: a second read,
  // turned and scaled, is blended in by a slow noise, and the tone drifts with it. The moss was a lawn-grass photo tinted
  // yellow-green, a repeating speckle close up and a flat green from across the room: now cushions of moss (a 2 cm noise:
  // lit tops, dark crevices) in greens that drift from deep to yellowish and brown where it is drier, the grass photo only a
  // fine fuzz on them, and the soil showing between cushions where the moss is thin.
  // The cushions are the lumps of a noise, shaded a little darker along its zero lines (the crevices between them), its
  // lattice warped by the slow noise so its 19 cm period does not show.
  const slow = perVertexWater ? noise3(pw.mul(0.06)) : null;
  const cn = perVertexWater ? noise3(pw.mul(0.42).add(vec3(slow, slow.mul(-0.7), slow.mul(0.9)).mul(2.2))) : null;
  const cushion = perVertexWater ? cn.mul(0.5).add(0.5).mul(smoothstep(0.0, 0.14, abs(cn)).mul(0.3).add(0.7)) : null;
  let soilC = null, mossH = null;
  GROUND.forEach((g, k) => {
    let c = perVertexWater && k === 4 ? null : triplanar(TEX.ground[k], g.scale, pw, bf).mul(vec3(...g.tint));
    if (perVertexWater && k === 0) {
      const q = pw.xz.mul(0.8).add(pw.mul(vec3(1, 0, -1)).zx.mul(0.6)).mul(g.scale * 0.71).add(0.37);   // turned 37 degrees
      const turned = texture(TEX.ground[0], q).rgb.mul(vec3(...g.tint));
      c = mix(c, turned, smoothstep(-0.2, 0.2, slow).mul(bf.y)).mul(slow.mul(0.3).add(1));
      soilC = c;
    }
    if (perVertexWater && k === 4) {
      // Fine fuzz: the grass photo at 2 cm, and tufts of a few millimetres (a fine noise on the same warped lattice).
      const fuzz = mix(float(1), dot(triplanar(TEX.ground[4], 1 / 2.2, pw, bf), vec3(0.3, 0.59, 0.11)).div(0.12), 0.75);
      const tuft = noise3(pw.mul(1.9).add(vec3(slow.mul(3.1), cn.mul(0.6), slow.mul(-2.3)))).mul(0.5).add(0.5);
      const hue = mix(mix(vec3(0.03, 0.08, 0.014), vec3(0.085, 0.165, 0.028), smoothstep(-0.45, 0.45, slow)), vec3(0.09, 0.08, 0.034), smoothstep(0.35, 0.75, slow).mul(0.55));
      const moss = hue.mul(cushion.mul(0.65).add(0.45)).mul(tuft.mul(0.6).add(0.7)).mul(fuzz);
      mossH = cushion.mul(0.35).add(tuft.mul(0.07)).mul(ws[4]);   // cm of relief, for the normal below
      c = mix(soilC.mul(0.75), moss, smoothstep(-0.05, 0.2, cushion.mul(0.5).add(slow).add(0.35)));
    }
    // (2026-10-03) The dark stone's lichen scan is pale specks on brown: the specks are pressed down (a power curve keeps the
    // dark rock and lowers the bright flecks), so a wall of it reads as weathered stone rather than a camouflage print.
    if (k === 5) c = pow(c, vec3(1.45)).mul(1.35);
    base = base.add(c.mul(ws[k]));
  });
  // Rock (mossy rock, dark stone): large-scale variation in tone and warmth, so a big wall of one texture is not one even
  // tile; close up a stretched scan blurs, so the stone gets detail of its own: fine grain and branching cracks (the zero lines
  // of a warped noise), dark in the crack with a pale lip beside it; and the relief of a rock normal map (below). Skipped on the
  // Low preset (U.surfaceDetail: a branch on a uniform, so the texture reads are not made and no shader is rebuilt).
  const rockW = clamp(ws[3].add(ws[5]), 0, 1);
  const plain = base;
  base = Fn(() => {
    const out = plain.toVar();
    If(U.surfaceDetail.greaterThan(0.5), () => {
      const macroN = noise3(pw.mul(0.045)), macro = macroN.mul(0.5).add(0.5), warm = smoothstep(-0.6, 0.6, macroN.mul(-1.3).add(0.15));
      const rockTone = plain.mul(macro.mul(0.55).add(0.72)).mul(mix(vec3(0.92, 0.97, 1.04), vec3(1.08, 0.98, 0.88), warm));
      const grain = noise3(pw.mul(2.4)).mul(0.5).add(0.5);
      const cw = pw.mul(0.22).add(vec3(grain, grain.mul(-1), 0).mul(0.35));     // (the grain wobbles the crack lines: no extra lookup)
      const cn = abs(noise3(cw)), crack = smoothstep(0.045, 0.0, cn).mul(smoothstep(0.3, 0.7, macro)), lip = smoothstep(0.1, 0.05, cn).sub(crack).mul(0.5);
      const detailed = rockTone.mul(grain.mul(0.3).add(0.85)).mul(float(1).sub(crack.mul(0.65))).add(lip.mul(0.02));
      out.assign(mix(plain, detailed, rockW));
    });
    return out;
  })();
  // The water over this point: the main pool, or (substrate) any pool or
  // stream, written per vertex by the water simulation.
  const surf = perVertexWater ? attribute('wsurf', 'float') : U.waterLevel;
  if (perVertexWater) {
    // The floor (not the background): humus darkens and enriches the soil, and leaf litter
    // darkens it in patches (both written by sim/humus.js into one small texture).
    const g = texture(SOIL.tex, pw.xz.div(U.tankHalf.mul(2)).add(0.5));
    const soilW = clamp(ws[0].add(ws[4].mul(0.35)), 0, 1);
    const humusA = clamp(g.r.mul(1.15), 0, 1).mul(soilW);
    const richer = base.mul(vec3(0.34, 0.27, 0.2)).add(vec3(0.02, 0.012, 0.006));
    base = mix(base, richer, humusA.mul(0.88));
    const dryLand = smoothstep(-0.3, 0.4, pw.y.sub(surf));
    const nz1 = noise3(pw.mul(0.55)).mul(0.5).add(0.5), nz2 = noise3(pw.mul(2.6)).mul(0.5).add(0.5);
    const patches = smoothstep(float(1).sub(g.g.mul(1.5)), float(1.16).sub(g.g.mul(1.5)), nz1.mul(0.65).add(nz2.mul(0.35)));
    const litterCol = mix(vec3(0.30, 0.17, 0.07), vec3(0.17, 0.10, 0.05), nz2);
    base = mix(base, litterCol, patches.mul(smoothstep(0.03, 0.2, g.g)).mul(0.62).mul(dryLand).mul(float(1).sub(ws[4].mul(0.6))));
  }
  if (!perVertexWater) {
    // The background as black expanding foam sealed with silicone and dusted with coir: lumpy, near-black, flecked brown.
    // Moss painted on it stays (keepers glue moss onto foam); a uniform, so switching costs no shader build.
    const lump = noise3(pw.mul(0.32)).mul(0.5).add(0.5), fleck = noise3(pw.mul(3.1)).mul(0.5).add(0.5);
    const foam = mix(vec3(0.018, 0.017, 0.016), vec3(0.075, 0.05, 0.032), smoothstep(0.55, 0.85, fleck)).mul(lump.mul(0.7).add(0.6));
    base = mix(base, foam, U.backdrop.mul(float(1).sub(ws[4].mul(0.8))));
  }
  // A wet band just above the water line reads darker and glossier.
  const above = pw.y.sub(surf);
  const wetBand = smoothstep(1.8, 0.0, above).mul(smoothstep(-0.3, 0.1, above)).mul(0.4);
  // Algae film on everything under water (green), or brown diatoms in a new tank.
  const film = smoothstep(0.2, -0.5, above).mul(U.algaeFilm).mul(noise3(pw.mul(0.4)).mul(0.4).add(0.6));
  base = mix(base, U.algaeColor, clamp(film, 0, 0.75));
  const [color, emissive] = wet(base.mul(float(1).sub(wetBand)), pw, surf);
  m.colorNode = color;
  m.emissiveNode = emissive;
  m.roughnessNode = mix(float(0.95), float(0.45), wetBand.mul(2));
  // Relief on rock: a triplanar rock normal map (three texture reads), as the spires have; soil, sand and moss stay as they were.
  // Its blend weights are its own nodes, not `bf`: shared, three declared their sum inside this branch and the colour above
  // divided by it, so with the branch off (the Low preset) the sum was never set and the whole wall and floor drew near black.
  m.normalNode = Fn(() => {
    const nOut = normalView.toVar();
    if (mossH) {
      // The moss's cushions and tufts in relief: a bump from the screen-space slope of their height (Mikkelsen 2010), no
      // extra reads. Worked out before the branch below (slopes need every pixel of the quad).
      const pv = positionView, sx = pv.dFdx(), sy = pv.dFdy(), r1 = cross(sy, normalView), r2 = cross(normalView, sx);
      const det = dot(sx, r1), grad = r1.mul(mossH.dFdx()).add(r2.mul(mossH.dFdy())).mul(sign(det));
      nOut.assign(normalize(normalView.mul(abs(det)).sub(grad)));
    }
    const nBase = nOut.toVar();
    If(U.surfaceDetail.greaterThan(0.5), () => {
      const nd = triplanar(TEX.rockNormal, 1 / 16, pw, blendWeights()).mul(2).sub(vec3(1, 1, 2));
      nOut.assign(normalize(nBase.add(cameraViewMatrix.mul(vec4(nd, 0)).xyz.mul(rockW.mul(1.1)))));
    });
    return nOut;
  })();
  return m;
}

// White mould creeping over wood and stone in stale, wet air: patches open up
// where a coarse noise passes a threshold that falls as U.mold rises, with a
// fine fuzz inside them. Only above the waterline.
export function mouldMix(base, pw) {
  const coarse = noise3(pw.mul(1.7)).mul(0.5).add(0.5);
  const mid = noise3(pw.mul(6.3)).mul(0.5).add(0.5);
  const n = coarse.mul(0.78).add(mid.mul(0.22));
  const edge = float(1.02).sub(U.mold.mul(0.62));
  const dry = smoothstep(0.0, 1.0, pw.y.sub(U.waterLevel));
  const patch = smoothstep(edge, edge.add(0.2), n).mul(smoothstep(0.02, 0.12, U.mold)).mul(dry);
  const fuzz = noise3(pw.mul(24)).mul(0.5).add(0.5);
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
    const n = noise3(pw.mul(0.25)).mul(0.5).add(noise3(pw.mul(0.9)).mul(0.25));
    const aboveWater = smoothstep(0.0, 1.5, pw.y.sub(U.waterLevel));
    const cover = smoothstep(0.75 - moss * 0.6, 0.95 - moss * 0.5, up.add(n).sub(float(1).sub(U.rockMoss).mul(0.9))).mul(aboveWater);
    const mossCol = triplanar(TEX.ground[4], mossScale, pw, blendWeights()).mul(vec3(0.55, 0.8, 0.42));
    base = mix(base, mossCol, cover);
  }
  const film = smoothstep(0.2, -0.5, pw.y.sub(U.waterLevel)).mul(U.algaeFilm).mul(noise3(pw.mul(0.5)).mul(0.4).add(0.6));
  base = mix(base, U.algaeColor, clamp(film, 0, 0.7));
  base = mouldMix(base, pw);
  // Rock under running water: dark and glossy where a stream or a thin film runs over it (render/water.js syncStill puts the
  // wetness of the cells on rock in the blue channel of the tank's height texture). Only near the rock's top, which the ground
  // stores 0.15 cm under its face: the sides and the overhangs under it stay dry. One read of a texture the water already uploads.
  const ht = FX.terrainH.sample(tankUV(pw.xz)), above = pw.y.sub(ht.r);
  const wetRock = ht.b.mul(smoothstep(-0.5, -0.1, above)).mul(smoothstep(1.0, 0.5, above)).mul(smoothstep(0.3, 0.6, normalWorld.y.add(0.4)));
  base = base.mul(float(1).sub(wetRock.mul(0.45)));
  const rough0 = src.roughnessMap ? texture(src.roughnessMap, uv()).g.mul(0.9) : float(0.9);
  m.roughnessNode = mix(rough0, float(0.22), wetRock.mul(0.9));
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
// `leafVeins`: the geometry carries leaf coordinates (render/geo.js Builder: u across -1 … 1, v base 0 … tip 1; v < 0 is not a leaf), and
// the leaves get a midrib, veins and a darker margin. `veins`: { kind: 'pinnate' (side veins from the midrib towards the tip, n per
// unit length) | 'parallel' (n lines either side running base to tip, following the margin: the arcuate veins of a sword plant, the
// parallel ones of a grass), n, slope (how steeply pinnate veins run to the tip), rib (midrib width), k (strength), cross (faint
// cross-veins between parallel ones) }.
// `flowBend`: the plant leans in the water's push (B5b; only aquatic and emergent plants set it, sim/plants.js flowOptions); `bend`: the
// lean of a tip at full push in the plant's own units; `stiffness`: 1 an average leaf.
export function plantMaterial({ amp = 0.6, speed = 1.0, underwaterAmp = 2.2, map = null, normalMap = null, leafVeins = false, veins = {}, flowBend = false, bend = 2, stiffness = 1, rough = 0.96, leafMap = null, leafPale = null, leafBack = null, gloss = null, leafRelief = null, relief = 1, wax = null, leafNoise = null, mottle = null } = {}) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: rough, metalness: 0, side: THREE.DoubleSide, vertexColors: true });
  m.userData.foliage = true;
  m.userData.flowBend = flowBend;
  if (FOLIAGE.mrt) m.mrtNode = mrt({ normal: vec4(packNormalToRGB(normalView), 0) });
  let base = vec3(1);
  // Leaves right in front of the lens dissolve (a screen-space dither, so no sorting and no blending): zooming into a clump
  // or orbiting low through the grass looks through the blades instead of filling the view with one blurred leaf. Shadow
  // maps are drawn without the opacity node (three's Renderer._getShadowNodes), so the leaves' shadows stay whole.
  const ign = fract(fract(screenCoordinate.x.mul(0.06711056).add(screenCoordinate.y.mul(0.00583715))).mul(52.9829189));
  // While an animal is followed (U.focus), leaves on the line from the lens to it dissolve too, so it stays in view inside
  // a clump.
  const seg = U.focus.xyz.sub(cameraPosition), segLen = seg.length();
  const along = clamp(dot(positionWorld.sub(cameraPosition), seg).div(max(segLen.mul(segLen), 1e-4)), 0, 1);
  const offLine = positionWorld.distance(cameraPosition.add(seg.mul(along)));
  const veil = smoothstep(U.focus.w, U.focus.w.mul(0.55), offLine).mul(smoothstep(0.97, 0.85, along)).mul(step(0.01, U.focus.w));
  const keep = step(ign, smoothstep(1.5, 3.2, positionWorld.distance(cameraPosition)).mul(float(1).sub(veil)));
  if (map) {
    const tx = texture(map, uv());
    base = tx.rgb;
    m.opacityNode = tx.a.mul(keep);
  } else m.opacityNode = keep;
  m.alphaTest = 0.45;
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
  // The water's push at this plant (sim/plants.js writes `flow` = last sample's xz then the new one's, cm/s in the plant's own axes,
  // and `flowDepth` = the water over its base; render/airflow.js plantFlow refreshes them every 0.4 s and AIR.blend carries the plant
  // from one sample to the next). The same formula as util/plantbend.js plantBend: a steady lean along the flow, the tip most, the
  // part above the water (flowDepth - y < 0) not at all, and a small sag so the blade keeps its length. The wobble above stays on top.
  let lean = vec3(0, 0, 0);
  if (flowBend) {
    const fl = attribute('flow', 'vec4');
    const v = mix(fl.xy, fl.zw, AIR.blend);
    const spd = v.length();
    const dirv = v.div(max(spd, 1e-3));
    const x = min(spd.mul(ATANH_HALF / (V50 * Math.max(0.05, stiffness))), 8);
    const k = float(BEND_MAX).mul(float(1).sub(float(2).div(exp(x.mul(2)).add(1))));   // BEND_MAX * tanh(x)
    const l = k.mul(sw).mul(sw).mul(smoothstep(0.0, 1.5, attribute('flowDepth', 'float').sub(pw.y)));
    lean = vec3(dirv.x.mul(l).mul(bend), l.mul(l).mul(-0.5 * bend), dirv.y.mul(l).mul(bend));
  }
  m.positionNode = positionLocal.add(off).add(lean);
  // The leaf's own colour, as the diffuse term will see it (the material multiplies it in on its own).
  const leaf = base.mul(attribute('color', 'vec3')).mul(instanceColor);
  // A natural leaf: a soft patchy variation along the leaf (a faint vein and mottling), a little less saturated, and darker
  // the deeper it stands in the water.
  const pl = positionLocal;
  const vein = sin(pl.x.mul(9).add(pl.z.mul(6.5)).add(pl.y.mul(0.45))).mul(0.5).add(sin(pl.x.mul(23).sub(pl.z.mul(17))).mul(0.5));
  const patch = noise3(positionWorld.mul(0.55)).mul(0.5);
  const under = smoothstep(-0.5, 2.5, U.waterLevel.sub(positionWorld.y));
  const tone = mix(vec3(1.0), vec3(0.62, 0.74, 0.72), under).mul(vein.mul(0.035).add(patch.mul(0.12)).add(1));
  const leafTint = vec3(0.9, 0.8, 0.86).mul(tone);
  base = base.mul(leafTint);
  if (leafVeins && !leafMap) {
    const L = attribute('leaf', 'vec2');
    const isLeaf = step(0, L.y), au = abs(L.x), lv = saturate(L.y);
    const { kind = 'pinnate', n = 8, slope = 1.6, rib = 0.07, k = 1, cross = 0 } = veins;
    const TAU = Math.PI * 2;
    const ribK = smoothstep(rib, rib * 0.25, au).mul(smoothstep(0.98, 0.7, lv));
    let line;
    if (kind === 'parallel') {
      line = smoothstep(0.86, 1, cos(au.mul(n * Math.PI))).mul(smoothstep(rib, rib * 2, au)).mul(smoothstep(0.97, 0.85, au));
      if (cross) line = max(line, smoothstep(0.93, 1, cos(lv.mul(cross * TAU).add(au.mul(1.3)))).mul(0.35));
    } else {
      const ph = lv.mul(n).sub(au.mul(slope));
      line = smoothstep(0.84, 1, cos(ph.mul(TAU))).mul(smoothstep(rib * 1.2, rib * 3, au)).mul(smoothstep(0.95, 0.75, au));
    }
    // between the veins the blade puckers a little (lighter), the margin is darker, the midrib and veins paler and yellower
    const margin = smoothstep(0.8, 1, au);
    // (a leaf's own light: lighter along the veins, a little darker in the blade between them and at the margin, so it reads as
    // a leaf and not a flat green sheet, and a soft lengthwise variation from leaf to leaf)
    const vary = noise3(vec3(L.x.mul(0.3), lv.mul(2.0), float(instanceIndex).mul(0.37).add(positionLocal.y.mul(0.05)))).sub(0.5).mul(0.22);
    const shade = vec3(1).add(vec3(0.4, 0.5, 0.1).mul(ribK.add(line.mul(0.75))).mul(k))
      .mul(float(1).sub(margin.mul(0.2 * k)).sub(float(1).sub(line).mul(0.06 * k)).add(vary));
    base = base.mul(mix(vec3(1), shade, isLeaf));
  }
  let spec = null;
  if (leafMap) {
    // Optional painted leaf (the orchids, sim/orchid-leaves.js), read at the leaf coordinates (u across, t along; no uv
    // buffer): R = shade (x2, 0.5 = as the vertex colour), G = toward `leafPale` (midrib, warts), B = how much the back face
    // takes the `leafBack` tint, A = the outline (alpha cut: smooth margins on a coarse blade). Stems (t < 0) stay as they are.
    // The colours are uniforms, so every species with a leafMap shares one program.
    const L = attribute('leaf', 'vec2'), isLeaf = step(0, L.y);
    const tx = texture(leafMap, vec2(L.x.mul(0.5).add(0.5), saturate(L.y)));
    const vc = max(attribute('color', 'vec3').mul(instanceColor), vec3(0.02));
    const pale = uniform(new THREE.Vector3(...(leafPale ?? [0.8, 0.85, 0.65]))), back = uniform(new THREE.Vector3(...(leafBack ?? [1, 1, 1])));
    let c = base.mul(mix(float(1), tx.r.mul(2), isLeaf));
    c = mix(c, pale.div(vc), tx.g.mul(isLeaf));
    base = mix(c, c.mul(back), tx.b.mul(isLeaf).mul(step(faceDirection, 0)));
    m.opacityNode = keep.mul(mix(float(1), tx.a, isLeaf));
    const Lc = vec2(L.x.mul(0.5).add(0.5), saturate(L.y));
    if (leafNoise && mottle) {
      // (T3) Mottling and leaf-to-leaf tone: a small tileable noise (sim/orchid-leaves.js orchidLeafNoise) read at the
      // object-space position (positionGeometry: before the sway, so it never swims), shifted per plant by its instance
      // colour. R = leaf-scale tone (each blade sits in another part of the field: no two leaves alike), G = patches inside
      // a blade. Mean 0.5 = the colour unchanged; lighter patches lean yellow-green. mottle = [cycles per cm, leaf amp, patch amp].
      const Mo = uniform(new THREE.Vector3(...mottle)), pg = positionGeometry;
      const off = vec2(dot(instanceColor, vec3(3.7, 5.3, 2.9)), dot(instanceColor, vec3(4.1, 1.9, 6.7)));
      const nz = texture(leafNoise, vec2(pg.x.add(pg.z.mul(0.63)), pg.y.sub(pg.z.mul(0.41))).mul(Mo.x).add(off));
      const lt = nz.r.sub(0.5).mul(2).mul(Mo.y), pt = nz.g.sub(0.5).mul(2).mul(Mo.z);
      base = base.mul(mix(vec3(1), vec3(1).add(lt).add(vec3(1.5, 1.3, 0.4).mul(pt)), isLeaf));
    }
    if (wax) {
      // (T3) A waxy cuticle lit by the scene's own lamp and environment (no fake lobe): roughness falls from wax.y (margin,
      // underside, stems) to wax.x where the relief map's B (wax mask) is full, and the Fresnel ceiling F90 drops from 1 to
      // wax.z, so a blade seen edge-on cannot wash pale while the lamp-facing core stays bright. Uniforms: one program.
      const Wx = uniform(new THREE.Vector3(...wax));
      const wm = leafRelief ? texture(leafRelief, Lc).z : float(1);
      m.roughnessNode = mix(Wx.y, Wx.x, wm.mul(isLeaf).mul(step(0, faceDirection)));
      m.setupSpecular = () => { specularColor.assign(vec3(0.04)); specularColorBlended.assign(vec3(0.04)); specularF90.assign(Wx.z); };
    }
    if (leafRelief) {
      // Optional relief (T2, sim/orchid-leaves.js orchidLeafRelief): the painted slopes across (R) and along (G) the blade
      // tilt the normal in a frame built from the screen-space change of the `leaf` coordinate (Schueler's cotangent
      // frame: no uv or tangent buffer). The back face reads the same relief inverted (a groove on top is a keel below).
      // The gloss below and the lights then see the midrib groove, the vein ridges and the warts. `relief` scales it.
      const rs = uniform(relief * 2 * 2);   // x 2 * SLOPE: the map stores 0.5 + slope / (2 * SLOPE), SLOPE = 2
      m.normalNode = Fn(() => {
        const N = normalView, dp1 = positionView.dFdx(), dp2 = positionView.dFdy(), d1 = L.dFdx(), d2 = L.dFdy();
        const p2 = cross(dp2, N), p1 = cross(N, dp1), sg = sign(dot(dp1, p2));
        const Tg = p2.mul(d1.x).add(p1.mul(d2.x)).mul(sg), Bg = p2.mul(d1.y).add(p1.mul(d2.y)).mul(sg);
        const Tu = Tg.div(max(Tg.length(), 1e-20)), Bt = Bg.div(max(Bg.length(), 1e-20));
        const r = texture(leafRelief, vec2(L.x.mul(0.5).add(0.5), saturate(L.y))).xy.sub(0.5).mul(rs).mul(isLeaf).mul(faceDirection);
        return normalize(N.sub(Tu.mul(r.x)).sub(Bt.mul(r.y)));
      })();
    }
    if (gloss) {
      // Optional waxy highlight (T1b): a small, soft-edged spot where the lamp's half-vector meets the visible face, added as
      // light (never a whitening of the whole blade, which the low roughness did at grazing angles). gloss = [strength,
      // size (cos of the spot's edge), softness]; the warts and midrib (tx.g) keep it a little less.
      // (uniforms, so every orchid with a gloss shares one program)
      // The lamp as a point over the tank's middle (not the sun's direction): L and V turn across a flat blade, so the spot is
      // small and moves over the leaf as the camera moves, like the photos' wax.
      const G = uniform(new THREE.Vector3(...gloss)), Ls = normalize(vec3(0, TANK.h + 25, 0).sub(positionWorld)), Vw = normalize(cameraPosition.sub(positionWorld)), H = normalize(Ls.add(Vw));
      const nh = saturate(dot(normalWorld, H));
      spec = smoothstep(G.y.sub(G.z), G.y.add(G.z.mul(0.5)), nh).mul(G.x).mul(U.daylight)
        .mul(isLeaf).mul(float(1).sub(tx.g.mul(0.5))).mul(saturate(dot(normalWorld, Ls).mul(3)));
      // (T2) the relief map's B: the wax highlight fades toward the margin (no bright rim along a blade's edge)
      if (leafRelief) spec = spec.mul(texture(leafRelief, vec2(L.x.mul(0.5).add(0.5), saturate(L.y))).z);
    }
  }
  const [color, emissive] = wet(base, positionWorld, U.waterLevel, U.plantWater, U.plantWater.mul(0.5));
  m.colorNode = color;
  // Caustic light and the water's own scatter in `emissive` were computed on a white base: the caustic part must
  // carry the leaf colour, the scatter is cut down (the leaf is not a mirror of the water).
  const lum = leaf.x.mul(0.3).add(leaf.y.mul(0.59)).add(leaf.z.mul(0.11));
  const sat = mix(vec3(lum), leaf, 0.8);
  const tinted = emissive.mul(sat);
  // Back-light: the face we see is turned away from the lamp (n.up < 0) or edge-on to it.
  const facing = dot(normalWorld, vec3(0, 1, 0));
  const back = saturate(facing.mul(-0.7).add(0.35));
  const glow = sat.mul(vec3(1.0, 1.1, 0.7)).mul(U.daylight.mul(0.16).add(0.02)).mul(back.mul(0.8).add(0.3));
  m.emissiveNode = spec ? tinted.add(glow.mul(color)).add(vec3(1, 0.98, 0.92).mul(spec)) : tinted.add(glow.mul(color));
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
