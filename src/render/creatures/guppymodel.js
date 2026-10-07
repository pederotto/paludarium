// The guppy's models in the game: the owner's male and female (public/assets/creatures/guppy.glb, guppy-female.glb, prepared by
// art-src/guppy/prep_glb.py and tools/guppy-import.mjs), each look (content/guppy.js: a strain, a female, a fry) drawn with its own
// texture, painted from the model's maps by guppypaint.js in a worker the first time the look appears in a tank.
//
//   guppyModel(look, meta) -> Promise<{ lo, hi, textures, finish }>   (meta: the manifest's "guppy" entry)
import * as THREE from 'three/webgpu';
import { loadCreatureGLB } from './glb.js';
import { parseGuppyLook } from '../../content/guppy.js';
import { paintGuppyModel } from './guppypaint.js';

const base = () => new URL(`${import.meta.env.BASE_URL}assets/creatures/`, location.href);
const GEO = new Map(), MAPS = new Map(), TEX = new Map();

export const guppySexOf = (look) => (parseGuppyLook(look)?.sex === 'male' ? 'male' : 'female');

// RGBA bytes of an image file, exactly as stored (no colour management: the coordinate map is data).
async function pixels(url) {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(bmp.width, bmp.height) : Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0);
  return { N: bmp.width, data: new Uint8Array(g.getImageData(0, 0, bmp.width, bmp.height).data.buffer) };
}
function maps(sex, m) {
  if (!MAPS.has(sex)) MAPS.set(sex, Promise.all([m.coords, m.parts, m.base].map((f) => pixels(new URL(f, base()).href)))
    .then(([c, p, b]) => ({ N: c.N, coords: c.data, parts: p.data, base: b.data })));
  return MAPS.get(sex);
}

// One worker for all looks (painting is ~0.2 s a look at 512 px); the main thread paints when workers are unavailable.
let worker = null, failed = false, next = 1;
const pending = new Map(), sent = new Set();
function paintOff(look, sex, mp) {
  if (!failed && !worker && typeof Worker !== 'undefined') {
    try {
      worker = new Worker(new URL('./guppypaint.worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => { const p = pending.get(e.data.id); pending.delete(e.data.id); if (!p) return; if (e.data.error) p.fallback(); else p.resolve({ N: e.data.N, rgba: e.data.rgba }); };
      worker.onerror = () => { failed = true; for (const p of pending.values()) p.fallback(); pending.clear(); };
    } catch { failed = true; }
  }
  return new Promise((resolve) => {
    const local = () => setTimeout(() => resolve(paintGuppyModel(look, mp)), 0);
    if (failed || !worker) return local();
    const id = next++;
    pending.set(id, { resolve, fallback: local });
    const first = !sent.has(sex); sent.add(sex);
    worker.postMessage({ id, look, sex, maps: first ? { N: mp.N, coords: mp.coords.slice(), parts: mp.parts.slice(), base: mp.base.slice() } : null });
  });
}
function texture(look, sex, m) {
  if (!TEX.has(look)) TEX.set(look, maps(sex, m).then((mp) => paintOff(look, sex, mp)).then(({ N, rgba }) => {
    const t = new THREE.DataTexture(rgba, N, N, THREE.RGBAFormat);
    t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.anisotropy = 8; t.flipY = false; t.needsUpdate = true;
    return t;
  }));
  return TEX.get(look);
}

// The analytic eye (render/creatures/material.js) at the eye the prep found: a dark iris ring round a black pupil, red in an albino.
function eyes(m, albino) {
  if (!m.eye) return null;
  const c = m.eye.c, n = new THREE.Vector3(1, 0.12, 0.35).normalize(), h = new THREE.Vector3().crossVectors(n, new THREE.Vector3(0, 1, 0)).normalize(), w = new THREE.Vector3().crossVectors(n, h).normalize();
  const lin = (x) => { const k = new THREE.Color(x); return [k.r, k.g, k.b]; };
  return [{ c, r: m.eye.r, axis: n.toArray(), h: h.toArray(), w: w.toArray(), pupil: [0.5, 0.5], cap: 0.9, seed: 5,
    inner: albino ? lin(0xc83a3a) : lin(0xbfc4b8), outer: albino ? lin(0xf0a8a0) : lin(0x6a6c60), limb: albino ? lin(0x7a1c1c) : lin(0x141412) }];
}

// ---- tail shapes: the owner's tail, scaled ------------------------------------------------------------------------------------------
// The owner's male has one tail, a broad rounded fan whose lobes reach forward over and under the stalk; it is drawn for the delta.
// The fan and the round tail are that tail scaled about its root (length, height); a female's tail grows or shrinks with her line.
// Swords and the lyre cannot be bent out of a round tail honestly: they need tails of their own from the owner (NOT DONE: until then a
// double sword or lyre male is drawn with the delta tail, his genes and name unchanged). UVs stay, so the painted textures fit.
const SCALE = { fan: [0.88, 0.78], round: [0.58, 0.6], female_delta: [1.2, 1.2], female_fan: [1.0, 1.0], female_round: [0.85, 0.85] };
function warpTail(geo, shape) {
  const k = SCALE[shape];
  if (!k) return geo;
  const g = geo.clone(), P = g.attributes.position, R = g.attributes.rig, n = P.count;
  g.computeBoundingBox();
  const zHead = g.boundingBox.max.z, L = zHead - g.boundingBox.min.z;
  // the tail root: the rearmost body vertex; the tail: the fin vertices behind it
  let zRoot = zHead, yRoot = 0;
  for (let i = 0; i < n; i++) if (Math.round(R.getW(i)) === 0 && P.getZ(i) < zRoot) { zRoot = P.getZ(i); yRoot = P.getY(i); }
  const z0 = zRoot + 0.03 * L;
  for (let i = 0; i < n; i++) {
    const z = P.getZ(i);
    if (Math.round(R.getW(i)) !== 2 || z > z0) continue;
    const f = Math.min(1, (z0 - z) / (0.06 * L));                 // eased in over the first few millimetres behind the stalk
    P.setZ(i, z0 - (z0 - z) * (1 + (k[0] - 1) * f));
    P.setY(i, yRoot + (P.getY(i) - yRoot) * (1 + (k[1] - 1) * f));
  }
  P.needsUpdate = true; g.computeVertexNormals(); g.computeBoundingBox();
  return g;
}
const SHAPED = new Map();
function shapeKey(look) {
  const p = parseGuppyLook(look);
  if (!p) return null;
  if (p.sex === 'male') return p.tail === 'fan' || p.tail === 'round' ? p.tail : null;
  if (p.sex === 'female') return `female_${p.tail === 'delta' ? 'delta' : p.tail === 'fan' || p.tail === 'lyre' ? 'fan' : 'round'}`;
  return 'female_round';
}

export async function guppyModel(look, meta) {
  const sex = guppySexOf(look), m = meta.guppy[sex];
  if (!GEO.has(sex)) GEO.set(sex, loadCreatureGLB(`guppy-${sex}`, { ...meta, file: m.file, lo: m.lo, legs: false }));
  const [g0, map] = await Promise.all([GEO.get(sex), texture(look, sex, m)]);
  if (!g0) return null;
  const sk = shapeKey(look);
  let g = g0;
  if (sk) {
    // (loadCreatureGLB has added the rig with addRig: rig.w is the material id, 2 on the fins)
    if (!SHAPED.has(`${sex}:${sk}`)) SHAPED.set(`${sex}:${sk}`, { lo: warpTail(g0.lo, sk), hi: g0.hi === g0.lo ? null : warpTail(g0.hi, sk) });
    const w = SHAPED.get(`${sex}:${sk}`); g = { ...g0, lo: w.lo, hi: w.hi ?? w.lo };
  }
  const e = eyes(m, parseGuppyLook(look)?.ground === 'albino');
  return { lo: g.lo, hi: g.hi, textures: { map, normalMap: null, roughnessMap: null }, finish: e ? { eyes: e } : {} };
}
