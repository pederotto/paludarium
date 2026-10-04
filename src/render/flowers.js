// Flowers: one instanced mesh per flowering species (one draw call, no shadow), all drawn by ONE shared material.
//
// A species' flower geometry (its `flower.build`, see sim/plants.js and the FLOWER CONTRACT) is one flower at the origin opening
// along +Y, with leaf coordinates on the petals (v 0 base … 1 tip) and a palette MASK as vertex colour. Per head the mesh gets
// four vectors (WebGPU allows 8 vertex buffers a pipeline: position, normal, `fl` and these four make 7):
//   iPos   xyz where the head sits (world), w its scale
//   iRot   its orientation (quaternion)
//   iPal   the plant's three colours (8-bit sRGB packed into one float each, exact up to 2^24), w = 2 × daily mode + translucency
//          (mode 0 stays open, 1 opens by day, 2 by night; translucency 0 waxy … 1 a thin petal that glows when back-lit)
//   iBloom x how open (0 a shut bud … 1 open), y green bud (< 0) or fading (> 0), z petals left (1 … 0), w the sway of the
//          stalk tip it sits on (packSway: the same sway plantMaterial gives that spot, so flower and stalk move together)
// The vertex stage folds the petals shut about the flower's base (toward +Y, more at the tips: leaf v), by the bud stage and by
// the time of day (FLOWER.day), droops and browns them as they fade, shrinks them away as they drop, and mixes the colour from
// the mask; the fragment stage only lights it (a cheap back-light term for thin petals, no noise).
import * as THREE from 'three/webgpu';
import {
  attribute, positionLocal, positionWorld, float, vec3, vec4, sin, cos, max, min, floor, mix, normalize, cross, dot, length, saturate,
  smoothstep, step, time, transformNormalToView, varying, pow, mrt, packNormalToRGB, normalView, normalWorld, faceDirection,
  screenCoordinate, fract, cameraPosition, uniform,
} from 'three/tsl';
import { U } from './uniforms.js';
import { AIR } from './airflow.js';
import { FOLIAGE } from './shaders.js';

// day: 0 night … 1 day, as a 'day' flower sees it (sim/bloom.js dayOpen); Plants.step sets it from the game clock.
export const FLOWER = { day: uniform(1) };

const qrot = (q, v) => v.add(cross(q.xyz, cross(q.xyz, v).add(v.mul(q.w))).mul(2));
const TAU = Math.PI * 2;

// --- Packing (CPU side) ------------------------------------------------------------------------------------------------
const _c = new THREE.Color();
const _hsl = { h: 0, s: 0, l: 0 };
// A palette colour (hex, sRGB) as one float, nudged by `j` (0 … 1): a little hue and value, so no two plants match exactly.
export function packRGB(hex, j = 0.5) {
  _c.setHex(hex).getHSL(_hsl, THREE.SRGBColorSpace);
  _c.setHSL((_hsl.h + (j - 0.5) * 0.03 + 1) % 1, _hsl.s, clamp01(_hsl.l * (1 + (j - 0.5) * 0.08)), THREE.SRGBColorSpace);
  return _c.getHex();    // sRGB 0xRRGGBB = (r × 256 + g) × 256 + b
}
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
// The stalk tip's sway (plantMaterial: amp × sway², its speed and the plant's two phases) in 6 bits each: exact in a float.
export function packSway(amp, speed, phx, phz) {
  const q = (v, top) => Math.round(clamp01(v / top) * 63);
  const ph = (v) => Math.round((((v % TAU) + TAU) % TAU) / TAU * 64) % 64;
  return ((q(amp, 2) * 64 + q(speed, 2)) * 64 + ph(phx)) * 64 + ph(phz);
}

// --- Geometry --------------------------------------------------------------------------------------------------------
// A Builder geometry (position, normal, colour mask, leaf) → the flower mesh's: position, normal and fl = (leaf u, leaf v,
// mask r, mask g) with the mask normalised (b = 1 - r - g).
export function flowerGeometry(src) {
  const n = src.attributes.position.count;
  const col = src.attributes.color, leaf = src.attributes.leaf;
  const fl = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const r = col ? col.getX(i) : 1, g = col ? col.getY(i) : 0, b = col ? col.getZ(i) : 0, s = Math.max(1e-4, r + g + b);
    fl[i * 4] = leaf ? leaf.getX(i) : 0;
    fl[i * 4 + 1] = leaf ? leaf.getY(i) : -1;
    fl[i * 4 + 2] = r / s;
    fl[i * 4 + 3] = g / s;
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', src.attributes.position.clone());    // (copies: a mesh that is replaced disposes its own)
  g.setAttribute('normal', src.attributes.normal.clone());
  g.setAttribute('fl', new THREE.BufferAttribute(fl, 4));
  if (src.index) g.setIndex(src.index);
  g.instanceCount = 0;
  return g;
}

// --- The shared material ---------------------------------------------------------------------------------------------
let shared = null;
export function flowerMaterial() {
  if (shared) return shared;
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.55, metalness: 0, side: THREE.DoubleSide });
  m.userData.foliage = true;      // thin petals: no ambient-occlusion speckle (render/shaders.js FOLIAGE)
  if (FOLIAGE.mrt) m.mrtNode = mrt({ normal: vec4(packNormalToRGB(normalView), 0) });
  const P = attribute('iPos', 'vec4'), Q = attribute('iRot', 'vec4'), PAL = attribute('iPal', 'vec4'), B = attribute('iBloom', 'vec4');
  const F = attribute('fl', 'vec4');
  const isLeaf = step(0, F.y), v = saturate(F.y);
  const mode = floor(PAL.w.mul(0.5)), transl = PAL.w.sub(mode.mul(2));
  const fade = max(B.y, 0), green = max(B.y.negate(), 0);
  // sway: unpack the stalk's (packSway) and move as plantMaterial moves that spot
  const S = B.w;
  const phz = S.sub(floor(S.div(64)).mul(64)), s1 = floor(S.div(64));
  const phx = s1.sub(floor(s1.div(64)).mul(64)), s2 = floor(s1.div(64));
  const spd = s2.sub(floor(s2.div(64)).mul(64)).div(31.5), amp = floor(s2.div(64)).div(31.5);
  const k = float(TAU / 64);
  const t = time.mul(spd);
  // Daily: a day flower shuts as FLOWER.day falls, a night flower as it rises; a fading flower hardly closes any more.
  const isDay = step(0.5, mode).mul(step(mode, 1.5)), isNight = step(1.5, mode);
  const daily = isDay.mul(float(1).sub(FLOWER.day)).add(isNight.mul(FLOWER.day)).mul(float(1).sub(fade));
  const shut = max(float(1).sub(B.x.mul(float(1).sub(daily.mul(0.92)))), fade.mul(0.4));    // a spent flower half closes
  // petals stir a little in moving air (more at the tips)
  const flutter = sin(time.mul(2.6).add(phx.mul(k)).add(v.mul(1.7))).mul(AIR.air).mul(0.06).mul(v);
  const w = min(shut.mul(v.mul(0.3).add(0.62)).add(flutter), 0.95).mul(isLeaf);
  const droop = fade.mul(1.1).mul(v).mul(isLeaf);
  const p0 = positionLocal;
  const d = max(length(p0), 1e-4);
  const u = p0.div(d);
  const u1 = normalize(mix(u, vec3(0, 1, 0), w));
  const u2 = normalize(u1.sub(vec3(0, droop, 0)));
  const dd = d.mul(mix(float(1), B.z.mul(fade.mul(-0.2).add(1)), isLeaf));      // wilting petals shrivel, dropped ones are gone
  // the normal turns with its petal (Rodrigues: about u × u2 by the angle between them)
  const ax = cross(u, u2), sn = length(ax), cs = dot(u, u2), kx = ax.div(max(sn, 1e-5));
  const n0 = attribute('normal', 'vec3');
  const n1 = n0.mul(cs).add(cross(kx, n0).mul(sn)).add(kx.mul(dot(kx, n0)).mul(float(1).sub(cs)));
  const head = P.xyz;
  const off = vec3(
    sin(t.mul(1.1).add(phx.mul(k)).add(head.x.mul(0.05))).mul(amp),
    0,
    sin(t.mul(0.8).add(phz.mul(k)).add(head.z.mul(0.07)).add(Math.PI / 2)).mul(amp.mul(0.7)),
  ).mul(AIR.air);
  m.positionNode = qrot(Q, u2.mul(dd).mul(P.w)).add(head).add(off);
  m.normalNode = transformNormalToView(normalize(varying(qrot(Q, n1), 'vFlowerN'))).mul(faceDirection);
  // Colour: the plant's three colours mixed by the mask (sRGB to linear), green in a young bud, browning as it fades.
  const unpack = (f) => { const r = floor(f.div(65536)), g = floor(f.sub(r.mul(65536)).div(256)), b = f.sub(r.mul(65536)).sub(g.mul(256)); return pow(vec3(r, g, b).div(255), 2.2); };
  const mb = saturate(float(1).sub(F.z).sub(F.w));
  let col = unpack(PAL.x).mul(F.z).add(unpack(PAL.y).mul(F.w)).add(unpack(PAL.z).mul(mb));
  col = mix(col, vec3(0.08, 0.2, 0.04), green.mul(0.9).mul(isLeaf.mul(0.3).add(0.7)));
  const lum = dot(col, vec3(0.3, 0.59, 0.11));
  col = mix(col, vec3(lum).mul(vec3(0.42, 0.28, 0.14)).add(vec3(0.03, 0.015, 0.0)), min(fade.mul(1.4), 1).mul(0.92));
  const vc = varying(vec4(col, transl), 'vFlowerC');
  // faint parallel veins along each petal and a slightly deeper tone at its base (leaf coordinates; no noise)
  const au = F.x.abs();
  const vein = smoothstep(0.75, 1, cos(au.mul(7 * Math.PI))).mul(smoothstep(0.95, 0.6, au)).mul(0.07);
  m.colorNode = vc.xyz.mul(float(1).sub(vein.add(smoothstep(0.3, 0, F.y).mul(0.12)).mul(isLeaf)));
  // Thin petals glow where the lamp shines through them (the side we see faces away from it, or edge-on), as the leaves do.
  const back = saturate(dot(normalWorld, vec3(0, 1, 0)).mul(-0.7).add(0.35));
  m.emissiveNode = vc.xyz.mul(vc.w).mul(back.mul(0.8).add(0.15)).mul(U.daylight.mul(0.35).add(0.02));
  // Right in front of the lens a flower dissolves like a leaf (plantMaterial's screen-space dither).
  const ign = fract(fract(screenCoordinate.x.mul(0.06711056).add(screenCoordinate.y.mul(0.00583715))).mul(52.9829189));
  m.opacityNode = step(ign, smoothstep(1.5, 3.2, positionWorld.distance(cameraPosition)));
  m.alphaTest = 0.45;
  shared = m;
  return m;
}

// --- One species' heads --------------------------------------------------------------------------------------------------
export class FlowerMesh {
  constructor(scene, geometry, cap = 64, name = 'flower') {
    this.cap = cap;
    const g = this.geometry = geometry;
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    this.iRot = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    this.iPal = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    this.iBloom = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    for (const a of [this.iPos, this.iRot, this.iPal, this.iBloom]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.iPos);
    g.setAttribute('iRot', this.iRot);
    g.setAttribute('iPal', this.iPal);
    g.setAttribute('iBloom', this.iBloom);
    g.instanceCount = 0;
    this.mesh = new THREE.Mesh(g, flowerMaterial());
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.n = 0;
  }

  begin() { this.n = 0; }

  // false when full (the owner then makes a bigger one)
  put(pos, q, scale, pal, bloom) {
    if (this.n >= this.cap) return false;
    const i = this.n++;
    this.iPos.setXYZW(i, pos.x, pos.y, pos.z, scale);
    this.iRot.setXYZW(i, q.x, q.y, q.z, q.w);
    this.iPal.setXYZW(i, pal[0], pal[1], pal[2], pal[3]);
    this.iBloom.setXYZW(i, bloom[0], bloom[1], bloom[2], bloom[3]);
    return true;
  }

  end() {
    this.geometry.instanceCount = this.n;
    this.mesh.visible = this.n > 0;
    for (const a of [this.iPos, this.iRot, this.iPal, this.iBloom]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, Math.max(1, this.n) * 4);
      a.needsUpdate = true;
    }
  }

  dispose() { this.mesh.removeFromParent(); this.geometry.dispose(); }
}
