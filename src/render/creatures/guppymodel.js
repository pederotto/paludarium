// The guppy's models in the game: the owner's male and female (public/assets/creatures/guppy.glb, guppy-female.glb, prepared by
// art-src/guppy/prep_glb.py and tools/guppy-import.mjs), each look (content/guppy.js: a strain, a female, a fry) drawn with its own
// texture, painted from the model's maps by guppypaint.js in a worker the first time the look appears in a tank.
//
//   guppyModel(look, meta) -> Promise<{ lo, hi, textures, finish }>   (meta: the manifest's "guppy" entry)
import * as THREE from 'three/webgpu';
import { loadCreatureGLB, creaturePartGeometry } from './glb.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { parseGuppyLook, tailSize } from '../../content/guppy.js';
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
  return { N: bmp.width, H: bmp.height, data: new Uint8Array(g.getImageData(0, 0, bmp.width, bmp.height).data.buffer) };
}
function maps(sex, m) {
  if (!MAPS.has(sex)) MAPS.set(sex, Promise.all([m.coords, m.parts, m.base].map((f) => pixels(new URL(f, base()).href)))
    .then(([c, p, b]) => ({ N: c.N, H: c.H, coords: c.data, parts: p.data, base: b.data })));
  return MAPS.get(sex);
}

// One worker for all looks (painting is ~0.2 s a look at 512 px); the main thread paints when workers are unavailable.
let worker = null, failed = false, next = 1;
const pending = new Map(), sent = new Set();
function paintOff(look, sex, mp) {
  if (!failed && !worker && typeof Worker !== 'undefined') {
    try {
      worker = new Worker(new URL('./guppypaint.worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => { const p = pending.get(e.data.id); pending.delete(e.data.id); if (!p) return; if (e.data.error) p.fallback(); else p.resolve({ N: e.data.N, H: e.data.H, rgba: e.data.rgba }); };
      worker.onerror = () => { failed = true; for (const p of pending.values()) p.fallback(); pending.clear(); };
    } catch { failed = true; }
  }
  return new Promise((resolve) => {
    const local = () => setTimeout(() => resolve(paintGuppyModel(look, mp)), 0);
    if (failed || !worker) return local();
    const id = next++;
    pending.set(id, { resolve, fallback: local });
    const first = !sent.has(sex); sent.add(sex);
    worker.postMessage({ id, look, sex, maps: first ? { N: mp.N, H: mp.H, coords: mp.coords.slice(), parts: mp.parts.slice(), base: mp.base.slice() } : null });
  });
}
function texture(look, sex, m) {
  if (!TEX.has(look)) TEX.set(look, maps(sex, m).then((mp) => paintOff(look, sex, mp)).then(({ N, H, rgba }) => {
    const t = new THREE.DataTexture(rgba, N, H ?? N, THREE.RGBAFormat);
    t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.anisotropy = 8; t.flipY = false; t.needsUpdate = true;
    return t;
  }));
  return TEX.get(look);
}

// The analytic eye (render/creatures/material.js) at the eye the prep found, coloured from the owner's photos: a large black pupil in a
// silvery-gold iris with a darker rim (red in an albino). `c` may be moved in by seatEyes.
function eyes(m, albino, c = m.eye?.c) {
  if (!m.eye) return null;
  const n = new THREE.Vector3(1, 0.12, 0.35).normalize(), h = new THREE.Vector3().crossVectors(n, new THREE.Vector3(0, 1, 0)).normalize(), w = new THREE.Vector3().crossVectors(n, h).normalize();
  const lin = (x) => { const k = new THREE.Color(x); return [k.r, k.g, k.b]; };
  return [{ c, r: m.eye.r, axis: n.toArray(), h: h.toArray(), w: w.toArray(), pupil: [0.6, 0.6], cap: 0.92, seed: 5,
    inner: albino ? lin(0xd04040) : lin(0xc9bd8a), outer: albino ? lin(0xf0a8a0) : lin(0x8a8058), limb: albino ? lin(0x7a1c1c) : lin(0x23211a),
    ...(albino ? { rim: lin(0x5a0808) } : {}) }];                                  // (an albino's pupil shows the blood behind it: dark red)
}

// The owner's male has eyeballs of their own (separate little spheres), standing out of the head by most of their size: a real
// guppy's eye sits almost flush under its cornea. Each ball (a small piece of the mesh round the eye) is moved in until it stands
// SEAT x its radius proud of the head beside it; returns the eye centre moved with it (the shader draws the eye there).
const SEAT = 0.22;
function seatEyes(geo, eye) {
  if (!eye) return null;
  const P = geo.attributes.position, I = geo.index, n = P.count, [cx, cy, cz] = eye.c, r = eye.r / 0.9;
  const near = (i) => Math.hypot(Math.abs(P.getX(i)) - Math.abs(cx), P.getY(i) - cy, P.getZ(i) - cz) < r * 1.6;
  // pieces of the mesh near the eye (union of triangles sharing a vertex index)
  const par = new Int32Array(n).map((_, i) => i), root = (i) => { while (par[i] !== i) i = par[i] = par[par[i]]; return i; };
  const tri = I ? I.count : n, at = (k) => (I ? I.getX(k) : k);
  for (let k = 0; k < tri; k += 3) { const a = at(k), b = at(k + 1), c = at(k + 2); if (near(a) || near(b) || near(c)) { par[root(b)] = root(a); par[root(c)] = root(a); } }
  const groups = new Map();
  for (let i = 0; i < n; i++) if (near(i)) { const g = root(i); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(i); }
  let moved = 0;
  for (const [, list] of groups) {
    // a ball: every vertex of its piece within 1.4 r of the eye centre (the head's skin piece reaches far beyond)
    let all = 0, inside = 0;
    for (let i = 0; i < n; i++) if (root(i) === root(list[0])) { all++; if (Math.hypot(Math.abs(P.getX(i)) - Math.abs(cx), P.getY(i) - cy, P.getZ(i) - cz) < r * 1.4) inside++; }
    if (all > 400 || inside < all * 0.98) continue;
    const side = Math.sign(P.getX(list[0])) || 1;
    // the head's surface beside it: the outermost skin vertex in a ring just outside the ball, seen from the side
    let skin = 0;
    for (let i = 0; i < n; i++) {
      if (root(i) === root(list[0]) || Math.sign(P.getX(i)) !== side) continue;
      const d = Math.hypot(P.getY(i) - cy, P.getZ(i) - cz);
      if (d > r * 0.9 && d < r * 1.5) skin = Math.max(skin, Math.abs(P.getX(i)));
    }
    let outer = 0; for (let i = 0; i < n; i++) if (root(i) === root(list[0])) outer = Math.max(outer, Math.abs(P.getX(i)));
    const depth = Math.max(0, outer - (skin + SEAT * r));
    for (let i = 0; i < n; i++) if (root(i) === root(list[0])) P.setX(i, P.getX(i) - side * depth);
    moved = Math.max(moved, depth);
  }
  P.needsUpdate = true; geo.computeBoundingBox();
  return moved ? [Math.sign(cx) * (Math.abs(cx) - moved), cy, cz] : eye.c;
}

// ---- tail shapes ----------------------------------------------------------------------------------------------------------------------
// A male wears the tail of his strain: one of twelve tails built in Blender on the owner's male (art-src/guppy/tails.py, from the
// Encyclo-Fish shapes sheet), in his own UVs, so the strain's painted texture lies on it as it lay on his own tail. His own tail (his
// fin faces behind meta.tails.zCut) is taken off and the strain's put on; its rays start inside the stalk, so the join is hidden.
// A female's tail is her own, grown or shrunk with her line (SCALE); so is a male's when the tail files are missing (an old manifest).
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
const TAILS = new Map();
const tailFile = (t, shape, lod) => (lod === 'lo' ? t.lo : t.file).replace('{shape}', shape);
function tailGeometry(t, shape, lod) {
  const k = `${shape}:${lod}`;
  if (!TAILS.has(k)) TAILS.set(k, creaturePartGeometry(tailFile(t, shape, lod), { keep: ['uv1'] }).catch((e) => { console.warn('guppy tail failed', shape, e.message); return null; }));
  return TAILS.get(k);
}
// His body without his own tail, with the strain's tail on: the tail's vertices get the rig the body's spine had (spine 0 at the snout,
// 1 where his own tail ended, a little past it for a long sword), material id 2 (a membrane).
function wearTail(body, tail, zCut, zEnd) {
  const both = !!body.index && !!tail.index;
  const g = both ? body.clone() : body.toNonIndexed(), t = both ? tail.clone() : tail.toNonIndexed();
  const P = g.attributes.position, R = g.attributes.rig, I = g.index, nt = I ? I.count : P.count;
  const at = (k) => (I ? I.getX(k) : k);
  const keep = [];
  for (let k = 0; k < nt; k += 3) {
    const a = at(k), b = at(k + 1), c = at(k + 2);
    const fin = Math.round(R.getW(a)) === 2 && Math.round(R.getW(b)) === 2 && Math.round(R.getW(c)) === 2;
    if (!(fin && (P.getZ(a) + P.getZ(b) + P.getZ(c)) / 3 < zCut)) keep.push(a, b, c);
  }
  body.computeBoundingBox();
  const zmax = body.boundingBox.max.z, zmin = body.boundingBox.min.z;
  // (his own tail's vertices stay in the buffer, unused by any triangle)
  if (I) g.setIndex(keep);
  else { const s0 = keep; for (const name of Object.keys(g.attributes)) { const A = g.attributes[name], sz = A.itemSize, o = new Float32Array(s0.length * sz); s0.forEach((i, k) => o.set(A.array.subarray(i * sz, (i + 1) * sz), k * sz)); g.setAttribute(name, new THREE.BufferAttribute(o, sz)); } }
  // the spine (0 snout … 1 tail tip: the shader's body wave, and it must not pass 1) runs on from the stalk's end to the tip of THIS
  // tail, so a long sword and a short round tail both end at 1 and the body keeps the wave it had
  const tp = t.attributes.position, tr = new Float32Array(tp.count * 4), E = t.attributes.uv1;
  let ztip = Infinity; for (let i = 0; i < tp.count; i++) ztip = Math.min(ztip, tp.getZ(i));
  const sEnd = (zmax - zEnd) / (zmax - zmin);
  for (let i = 0; i < tp.count; i++) {
    const z = tp.getZ(i), s = z > zEnd ? (zmax - z) / (zmax - zmin) : sEnd + (1 - sEnd) * (zEnd - z) / Math.max(1e-6, zEnd - ztip);
    tr[i * 4] = Math.min(1, Math.max(0, s)); tr[i * 4 + 3] = 2;
    tr[i * 4 + 1] = 21 + 0.98 * (E ? E.getX(i) : 0);              // the tail (21) + how near its rim (finRig, material.js finFray)
  }
  t.setAttribute('rig', new THREE.BufferAttribute(tr, 4));
  for (const name of Object.keys(t.attributes)) if (!g.attributes[name]) t.deleteAttribute(name);
  for (const name of Object.keys(g.attributes)) if (!t.attributes[name]) g.deleteAttribute(name);
  const out = mergeGeometries([g, t], false);
  out.computeBoundingBox();
  return { geo: out, tailFrom: g.attributes.position.count };
}

// ---- fins in the water -----------------------------------------------------------------------------------------------------------------
// The shader moves a membrane by how far it is from where it leaves the body and by which fin it is (instanced.js finFlow): rig.y = the
// fin (21 tail, 22 dorsal, 23 pectoral, 24 belly fins: pelvic and gonopodium) plus, on a new tail, 0.98 x how near its rim (the
// fraction: material.js finFray thins and frays the margin by it), rig.z = the distance from the nearest body vertex, cm.
// The fin is read from the parts map at the vertex's UV (a vertex of a new tail is tail).
const FIN_OF = [[200, 21], [160, 22], [120, 23], [80, 24]];
export function finRig(geo, parts, tailFrom = Infinity) {
  const P = geo.attributes.position, R = geo.attributes.rig, U = geo.attributes.uv, n = P.count;
  const C = 0.08, cell = new Map(), key = (x, y, z) => `${Math.floor(x / C)},${Math.floor(y / C)},${Math.floor(z / C)}`;
  for (let i = 0; i < n; i++) if (Math.round(R.getW(i)) === 0) {
    const k = key(P.getX(i), P.getY(i), P.getZ(i)); if (!cell.has(k)) cell.set(k, []); cell.get(k).push(i);
  }
  for (let i = 0; i < n; i++) {
    if (Math.round(R.getW(i)) !== 2) continue;
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    const cx = Math.floor(x / C), cy = Math.floor(y / C), cz = Math.floor(z / C);
    let best = Infinity;
    for (let r = 0; r < 40 && (best === Infinity || (r - 1) * C < Math.sqrt(best)); r++) {
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue;
        const l = cell.get(`${cx + dx},${cy + dy},${cz + dz}`);
        if (l) for (const j of l) { const d = (P.getX(j) - x) ** 2 + (P.getY(j) - y) ** 2 + (P.getZ(j) - z) ** 2; if (d < best) best = d; }
      }
    }
    let fin = 21;
    if (i < tailFrom && parts) {
      const u = U.getX(i), v = U.getY(i), N = parts.N, H = parts.H ?? N, px = Math.min(N - 1, Math.max(0, Math.floor(u * N))), py = Math.min(H - 1, Math.max(0, Math.floor(v * H)));
      const c = parts.data[(py * N + px) * 4];
      fin = FIN_OF.reduce((a, [code, id]) => (Math.abs(c - code) < Math.abs(c - a[0]) ? [code, id] : a), [999, 22])[1];
    }
    R.setY(i, i >= tailFrom && R.getY(i) >= 21 ? R.getY(i) : fin); R.setZ(i, Math.sqrt(best));
  }
  R.needsUpdate = true;
  return geo;
}

const SHAPED = new Map();
function shapeKey(look) {
  const p = parseGuppyLook(look);
  if (!p) return null;
  // a male: his own tail of the twelve; a female: her size class; plus the long fins of ribbon and swallow fish
  const size = tailSize(p.tail), fins = (p.ribbon ? '+ribbon' : '') + (p.swallow ? '+swallow' : '');
  if (p.sex === 'male') return (p.tail ?? 'delta') + fins;
  return `female_${p.sex === 'juv' ? 'round' : size}${fins}`;
}

// Ribbon: the belly fins (pelvic fins and gonopodium) drawn out into long ribbons; swallow: the dorsal and the belly fins long.
// A stretch of the model's own fin vertices away from where each fin leaves the body.
function warpFins(geo, ribbon, swallow) {
  if (!ribbon && !swallow) return geo;
  const g = geo.clone();
  const P = g.attributes.position, R = g.attributes.rig, n = P.count;
  g.computeBoundingBox();
  const zHead = g.boundingBox.max.z, L = zHead - g.boundingBox.min.z;
  let zRoot = zHead;
  const NB = 32, top = new Float32Array(NB).fill(-1e9), bot = new Float32Array(NB).fill(1e9), bin = (z) => Math.max(0, Math.min(NB - 1, Math.floor((zHead - z) / L * NB)));
  for (let i = 0; i < n; i++) if (Math.round(R.getW(i)) === 0) { const z = P.getZ(i), b = bin(z); top[b] = Math.max(top[b], P.getY(i)); bot[b] = Math.min(bot[b], P.getY(i)); zRoot = Math.min(zRoot, z); }
  const belly = ribbon ? 2.6 : 1.8, back = swallow ? 1.5 : 1;
  for (let i = 0; i < n; i++) {
    if (Math.round(R.getW(i)) !== 2) continue;
    const z = P.getZ(i), y = P.getY(i), b = bin(z);
    if (z < zRoot + 0.04 * L) continue;                            // the tail, and the dorsal's trailing tip over it, stay
    if (y < bot[b] && bot[b] < 1e8) {                              // a belly fin: out and back from the belly line
      const d = bot[b] - y;
      P.setY(i, bot[b] - d * belly); P.setZ(i, z - d * (belly - 1) * 0.9);
    } else if (swallow && y > top[b] && top[b] > -1e8) {           // the dorsal: taller and swept back
      const d = y - top[b];
      P.setY(i, top[b] + d * back); P.setZ(i, z - d * (back - 1) * 1.2);
    }
  }
  P.needsUpdate = true; g.computeVertexNormals(); g.computeBoundingBox();
  return g;
}

// A strain the owner sent a model of (meta.guppy.strains, tools/guppy-import.mjs): an adult male of exactly that strain is drawn with
// it and its own colour, normal and roughness maps; his fins move as the painted ones (finRig from the model's parts map).
const STRAIN = new Map();
async function strainModel(look, st, meta) {
  if (!STRAIN.has(look)) STRAIN.set(look, (async () => {
    const [g, parts] = await Promise.all([loadCreatureGLB(`guppy-${look}`, { ...meta, file: st.file, lo: st.lo, legs: false }), pixels(new URL(st.parts, base()).href)]);
    if (!g) return null;
    const P = { N: parts.N, H: parts.H, data: parts.data };
    const lo = finRig(g.lo.clone(), P), hi = g.hi === g.lo ? lo : finRig(g.hi.clone(), P);
    return { lo, hi, textures: g.textures };
  })());
  const w = await STRAIN.get(look);
  if (!w) return null;
  const e = st.eye ? eyes(st, false) : null;
  return { lo: w.lo, hi: w.hi, textures: w.textures, finish: e ? { eyes: e } : {} };
}

export async function guppyModel(look, meta) {
  const st = meta.guppy.strains?.[look];
  if (st && parseGuppyLook(look)?.sex === 'male') {
    const r = await strainModel(look, st, meta);
    if (r) return r;
  }
  const sex = guppySexOf(look), m = meta.guppy[sex];
  if (!GEO.has(sex)) GEO.set(sex, loadCreatureGLB(`guppy-${sex}`, { ...meta, file: m.file, lo: m.lo, legs: false }));
  const [g0, map, mp] = await Promise.all([GEO.get(sex), texture(look, sex, m), maps(sex, m)]);
  if (!g0) return null;
  const sk = shapeKey(look) ?? '';
  const key = `${sex}:${sk}`;
  if (!SHAPED.has(key)) SHAPED.set(key, (async () => {
    // (loadCreatureGLB has added the rig with addRig: rig.w is the material id, 2 on the fins)
    const [tk, ...fins] = sk.split('+'), rib = fins.includes('ribbon'), swa = fins.includes('swallow');
    const parts = { N: mp.N, H: mp.H, data: mp.parts };
    const make = async (geo, lod) => {
      let g = geo, tailFrom = Infinity;
      if (sex === 'male' && m.tails && tk) {
        const tail = await tailGeometry(m.tails, tk, lod);
        if (tail) ({ geo: g, tailFrom } = wearTail(geo, tail, m.tails.zCut, m.tails.zEnd));
        else g = warpTail(geo, tailSize(tk) === 'delta' ? '' : tailSize(tk));
      } else if (sex === 'male') g = warpTail(geo, tailSize(tk) === 'delta' ? '' : tailSize(tk));
      else g = warpTail(geo, tk);
      if (g === geo) g = geo.clone();
      const c = seatEyes(g, m.eye);
      const out = finRig(warpFins(g, rib, swa), parts, tailFrom);
      out.userData.eyeC = c;
      return out;
    };
    const lo = await make(g0.lo, 'lo'), hi = g0.hi === g0.lo ? lo : await make(g0.hi, 'hi');
    return { lo, hi };
  })());
  const w = await SHAPED.get(key);
  const e = eyes(m, parseGuppyLook(look)?.ground === 'albino', w.hi.userData.eyeC ?? m.eye?.c);
  return { lo: w.lo, hi: w.hi, textures: { map, normalMap: null, roughnessMap: null }, finish: e ? { eyes: e } : {} };
}
