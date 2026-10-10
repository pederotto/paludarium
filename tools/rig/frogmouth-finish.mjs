// Puts a frog's mouth (tools/blender/frog-mouth.py on its baked swimming body) into the game files with the head's own bones (gate 4, the common frog, 7 Oct 2026):
// the body's 18 bones (tools/bake-frogpose.mjs) + jaw (the quadrate-articular hinge to the chin), hyoid (the floor of the mouth: it drops as the mouth opens) and four tongue
// segments (from the attachment behind the symphysis back to the notched tip, a chain: the strike rolls it over the jaw tip) = 24, the most a row of the bone texture holds
// (render/creatures/skeleton.js ROW_TEXELS).
//   node tools/rig/frogmouth-finish.mjs <mouth.glb> --id commonfrog.swim [--size 1024] [--lo 9000] [--plain out.glb] [--color color.webp] [--arms <mouth.glb>.arms.json]
//   --plain: a plain GLB of the near level with its UVs and the vertex colours (the mouth's marks), for Blender's texture bake onto this atlas
//   --color: the baked colour map embedded in the near file (then no vertex colours); the UVs' hash is printed both times: it must not change between the two runs
// <mouth.glb>: Blender's output, metres, baked frame, with _SKIN/_SKINX (the jaw already folded in as bone 18), _RIG, _HYOW (hyoid weight), _TONGW/_TONGT (tongue and where along
// it, 0 front .. 1 tip), COLOR_0 (white skin, green lining, blue tongue); <mouth.glb>.jaw.json: the jaw bone and the tongue (cm).
// Writes public/assets/creatures/<id>.glb and .lo.glb (re-unwrapped: the colour map has to be baked again onto the new atlas; until then the vertex colours draw it) and the
// manifest entry's skeleton (24 bones). Muscles next: node tools/rig/muscles.mjs <id> --write.
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import crypto from 'node:crypto';
import { quantize, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import fs from 'node:fs';
import { unwrap, uvStats, simplifyKeepingSeams } from './texture.mjs';
await MeshoptEncoder.ready; await MeshoptDecoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const args = process.argv.slice(2), opt = (k, d = null) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const src = args.find((a) => !a.startsWith('--') && fs.existsSync(a)), id = opt('id'), SIZE = +opt('size', 1024), LO = +opt('lo', 9000);
if (!src || !id) throw new Error('usage: node tools/rig/frogmouth-finish.mjs <mouth.glb> --id <manifest id>');
const DIR = 'public/assets/creatures/', manPath = DIR + 'manifest.json', man = JSON.parse(fs.readFileSync(manPath, 'utf8')), entry = man[id];
if (!entry?.skeleton?.bones || entry.skeleton.bones.length !== 18) throw new Error(`${id}: the manifest needs the bake's 18-bone skeleton (bake first: node tools/bake-frogpose.mjs ${id})`);
const J = JSON.parse(fs.readFileSync(src + '.jaw.json', 'utf8'));

const doc = await io.read(src), prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
const take = (name, comps, must = true) => {
  const acc = prim.getAttribute(name); if (!acc) { if (must) throw new Error(`the mouth file has no ${name}`); return null; }
  const n = acc.getCount(), out = new Float32Array(n * comps), el = [];
  for (let i = 0; i < n; i++) { acc.getElement(i, el); for (let c = 0; c < comps; c++) out[i * comps + c] = el[c] ?? 0; }
  return out;
};
const a = { orig: take('_ORIG', 3, false), pos: take('POSITION', 3), nor: take('NORMAL', 3), col: take('COLOR_0', 4) ?? take('COLOR_0', 3), rig: take('_RIG', 4), skin: take('_SKIN', 4), skinx: take('_SKINX', 4),
  hyo: take('_HYOW', 1), tw: take('_TONGW', 1), tt: take('_TONGT', 1), idx: Uint32Array.from(prim.getIndices().getArray()) };
const n = a.pos.length / 3, cc = a.col.length / n;
// A vertex the mouth cut made with no bone at all (the exporter's default, every slot 1.0 = bone 32: two at the harlequin's snout, 8 Oct 2026, where the cut starts) takes the weights of the nearest vertex that has some.
{ const none = (i) => a.skin[i * 4] >= 0.999 && a.skin[i * 4 + 1] >= 0.999, bad = []; for (let i = 0; i < n; i++) if (none(i)) bad.push(i);
  for (const i of bad) { let best = -1, bd = Infinity; for (let j = 0; j < n; j++) { if (none(j)) continue; const d = (a.pos[j * 3] - a.pos[i * 3]) ** 2 + (a.pos[j * 3 + 1] - a.pos[i * 3 + 1]) ** 2 + (a.pos[j * 3 + 2] - a.pos[i * 3 + 2]) ** 2; if (d < bd) { bd = d; best = j; } }
    for (let c = 0; c < 4; c++) { a.skin[i * 4 + c] = a.skin[best * 4 + c]; a.skinx[i * 4 + c] = a.skinx[best * 4 + c]; } }
  if (bad.length) console.log(`  ${bad.length} vertices without a bone took the weights of their nearest neighbour`);
  // and a slot that still names a bone the body does not have (the exporter's default 1.0 = bone 32 beside a real weight: four vertices at the harlequin's snout carried 1.2 % of
  // bone 32, which the game reads from the next instance's row): its weight is dropped and the others renormalised, in the input's numbering (the 18 body bones and the jaw as 18)
  let nStray = 0;
  for (let i = 0; i < n; i++) {
    const sl = [[a.skin, i * 4, 2], [a.skin, i * 4 + 1, 3], [a.skinx, i * 4, 2], [a.skinx, i * 4 + 1, 3]]; let sum = 0, dirty = false;
    for (const [arr, k, w] of sl) { if (Math.round(arr[k] * 32) >= 19 && arr[i * 4 + w] > 1e-6) { arr[i * 4 + w] = 0; dirty = true; } sum += arr[i * 4 + w]; }
    if (dirty && sum > 1e-6) { for (const [arr, , w] of sl) arr[i * 4 + w] /= sum; nStray++; }
  }
  if (nStray) console.log(`  ${nStray} vertices carried a weight on a bone the body does not have: dropped`); }

// --- the six head bones (baked cm), appended after the body's 18 ---------------------------------------------------------------------------------------------------------
const B = entry.skeleton.bones.map((b) => ({ ...b }));
// --arms <file>: the forelimbs' joints after tools/blender/arm-slab.py shortened them (cm, baked frame): the arm, forearm and hand bones follow the cut mesh
if (opt('arms')) {
  const AR = JSON.parse(fs.readFileSync(opt('arms'), 'utf8'));
  for (const s of ['L', 'R']) { const g = (nm) => B.find((b) => b.name === nm + s); g('arm').tail = AR[s].elbow; g('forearm').head = AR[s].elbow; g('forearm').tail = AR[s].wrist; g('hand').head = AR[s].wrist; g('hand').tail = AR[s].finger; }
}
const lerp3 = (p, q, t) => p.map((v, i) => +(v + (q[i] - v) * t).toFixed(3));
const T = J.tongue, zH = J.head[2], snoutZ = J.tail[2] + 0.15;
const floorY = Math.min(T.attach[1], T.tip[1]) - 0.02;
const extra = [
  { name: 'jaw', parent: 'head', head: J.head, tail: J.tail, limb: 0, r: 0.16 },
  { name: 'hyoid', parent: 'head', head: [J.head[0], +floorY.toFixed(3), +(zH + 0.05).toFixed(3)], tail: [J.head[0], +floorY.toFixed(3), +(zH + 0.45 * (snoutZ - zH)).toFixed(3)], limb: 0, r: 0.14 },
];
for (let k = 0; k < 4; k++) extra.push({ name: `tongue${k + 1}`, parent: k ? `tongue${k}` : 'jaw', head: lerp3(T.attach, T.tip, k / 4), tail: lerp3(T.attach, T.tip, (k + 1) / 4), limb: 0, r: 0.06 });
B.push(...extra);
const JAW = 18, HYO = 19, TG0 = 20;
if (B.length !== 24) throw new Error(`expected 24 bones, got ${B.length}`);

// --- the skin: hyoid folded in (it shares with what the vertex had), the tongue on its own chain by _TONGT -------------------------------------------------------------------
const four = (i) => [[a.skin[i * 4] * 32, a.skin[i * 4 + 2]], [a.skin[i * 4 + 1] * 32, a.skin[i * 4 + 3]], [a.skinx[i * 4] * 32, a.skinx[i * 4 + 2]], [a.skinx[i * 4 + 1] * 32, a.skinx[i * 4 + 3]]];
const put = (i, list) => {
  const top = list.filter(([, w]) => w > 1e-4).sort((p, q) => q[1] - p[1] || p[0] - q[0]).slice(0, 4), s = top.reduce((v, [, w]) => v + w, 0) || 1;
  while (top.length < 4) top.push([top[0]?.[0] ?? 3, 0]);
  a.skin[i * 4] = top[0][0] / 32; a.skin[i * 4 + 1] = top[1][0] / 32; a.skin[i * 4 + 2] = top[0][1] / s; a.skin[i * 4 + 3] = top[1][1] / s;
  a.skinx[i * 4] = top[2][0] / 32; a.skinx[i * 4 + 1] = top[3][0] / 32; a.skinx[i * 4 + 2] = top[2][1] / s; a.skinx[i * 4 + 3] = top[3][1] / s;
};
let nHy = 0, nTg = 0;
for (let i = 0; i < n; i++) {
  if (a.tw[i] > 0.5) {                                         // the tongue: between the two nearest segment centres (k + 0.5) / 4 along it
    const s = Math.min(3.5, Math.max(0.5, a.tt[i] * 4)), k = Math.min(2, Math.floor(s - 0.5)), f = s - 0.5 - k;
    put(i, [[TG0 + k, 1 - f], [TG0 + k + 1, f]]); nTg++; continue;
  }
  const h = a.hyo[i];
  if (h > 0.01) {
    const m = new Map(); for (const [b, w] of four(i)) if (w > 0) m.set(Math.round(b), (m.get(Math.round(b)) ?? 0) + w * (1 - h));
    m.set(HYO, (m.get(HYO) ?? 0) + h); put(i, [...m]); nHy++;
  }
}
// the stand-in colours until the texture is baked on the new atlas: skin olive-brown, the mouth's lining pink, the tongue paler pink (linear)
const col = new Float32Array(n * 3);
for (let i = 0; i < n; i++) {
  const r = a.col[i * cc], g = a.col[i * cc + 1], bl = a.col[i * cc + 2];
  const c = bl > 0.7 && r < 0.25 && g < 0.25 ? [0.62, 0.20, 0.22] : g > 0.7 && r < 0.25 && bl < 0.25 ? [0.45, 0.10, 0.12] : [0.16, 0.13, 0.06];
  col.set(c, i * 3);
}

// --- UVs (the whole body again: the mouth added faces) and the low level that keeps the seams -----------------------------------------------------------------------------
const pick = (arr, w, from) => { const o = new Float32Array(from.length * w); for (let i = 0; i < from.length; i++) for (let c = 0; c < w; c++) o[i * w + c] = arr[from[i] * w + c]; return o; };
const u = await unwrap(a.pos, a.idx, SIZE);
const hi = { pos: pick(a.pos, 3, u.from), nor: pick(a.nor, 3, u.from), col: pick(col, 3, u.from), rig: pick(a.rig, 4, u.from), skin: pick(a.skin, 4, u.from), skinx: pick(a.skinx, 4, u.from), uv: Float32Array.from(u.uv), idx: Uint32Array.from(u.idx) };
const st = uvStats(hi.uv, hi.idx, hi.pos, SIZE);
const s = simplifyKeepingSeams(hi.pos, hi.idx, LO, hi.uv);
const lo = { pos: pick(hi.pos, 3, s.from), nor: pick(hi.nor, 3, s.from), col: pick(hi.col, 3, s.from), rig: pick(hi.rig, 4, s.from), skin: pick(hi.skin, 4, s.from), skinx: pick(hi.skinx, 4, s.from), uv: pick(hi.uv, 2, s.from), idx: Uint32Array.from(s.idx) };

async function write(file, b, image = null) {
  const out = new Document(), buf = out.createBuffer(), acc = (type, arr) => out.createAccessor().setType(type).setArray(arr).setBuffer(buf);
  const p = out.createPrimitive().setAttribute('POSITION', acc('VEC3', b.pos)).setAttribute('NORMAL', acc('VEC3', b.nor)).setAttribute('TEXCOORD_0', acc('VEC2', b.uv));
  if (!image) p.setAttribute('COLOR_0', acc('VEC3', b.col));
  p.setAttribute('_RIG', acc('VEC4', b.rig)).setAttribute('_SKIN', acc('VEC4', b.skin)).setAttribute('_SKINX', acc('VEC4', b.skinx)).setIndices(acc('SCALAR', b.idx));
  const mat = out.createMaterial(id).setBaseColorFactor([1, 1, 1, 1]).setMetallicFactor(0).setRoughnessFactor(0.6);
  if (image) { out.createExtension(EXTTextureWebP).setRequired(true); mat.setBaseColorTexture(out.createTexture(`${id}_color`).setImage(fs.readFileSync(image)).setMimeType('image/webp')); }
  p.setMaterial(mat);
  out.createScene().addChild(out.createNode(id).setMesh(out.createMesh(id).addPrimitive(p)));
  await out.transform(quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 16, quantizeGeneric: 12, quantizeColor: 8 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(file, out); return Math.round(fs.statSync(file).size / 1024);
}
const fid = id.replace(':', '-'), hiKb = await write(`${DIR}${fid}.glb`, hi, opt('color')), loKb = await write(`${DIR}${fid}.lo.glb`, lo);
const uvHash = crypto.createHash('sha256').update(Buffer.from(hi.uv.buffer)).update(Buffer.from(hi.idx.buffer)).digest('hex').slice(0, 16);
if (opt('plain')) {
  const d = new Document(), bf = d.createBuffer(), ac = (t, r) => d.createAccessor().setType(t).setArray(r).setBuffer(bf);
  const pp = d.createPrimitive().setAttribute('POSITION', ac('VEC3', hi.pos)).setAttribute('NORMAL', ac('VEC3', hi.nor)).setAttribute('TEXCOORD_0', ac('VEC2', hi.uv)).setAttribute('COLOR_0', ac('VEC3', hi.col)).setIndices(ac('SCALAR', hi.idx));
  d.createScene().addChild(d.createNode(id).setMesh(d.createMesh(id).addPrimitive(pp))); await io.write(opt('plain'), d);
  // (a body cut by tools/rig/arm-slab.mjs: the same mesh, its new layout, at the places its vertices had before the cut, for baking the colour from the uncut body)
  if (a.orig) {
    const d2 = new Document(), b2 = d2.createBuffer(), a2 = (t, r) => d2.createAccessor().setType(t).setArray(r).setBuffer(b2);
    const p2 = d2.createPrimitive().setAttribute('POSITION', a2('VEC3', pick(a.orig, 3, u.from))).setAttribute('NORMAL', a2('VEC3', hi.nor)).setAttribute('TEXCOORD_0', a2('VEC2', hi.uv)).setAttribute('COLOR_0', a2('VEC3', hi.col)).setIndices(a2('SCALAR', hi.idx));
    d2.createScene().addChild(d2.createNode(id).setMesh(d2.createMesh(id).addPrimitive(p2))); await io.write(opt('plain').replace(/\.glb$/, '') + '.orig.glb', d2);
  }
}
entry.skeleton = { ...entry.skeleton, bones: B, head: { jaw: JAW, hyoid: HYO, tongue: [TG0, TG0 + 1, TG0 + 2, TG0 + 3], tongueLenCm: T.lengthCm, strike: { gapeDeg: 45, a0Deg: 150, dDeg: -5, lag: 0.22, stretch: 1.3, hyoidDropCm: 0.21 } } };
entry.tris = { hi: hi.idx.length / 3, lo: lo.idx.length / 3 };
const SK = [];
fs.writeFileSync(manPath, JSON.stringify(man, (key, v) => (key === 'skeleton' && v && typeof v === 'object' ? `@@skeleton${SK.push(v) - 1}@@` : v), 1).replace(/"@@skeleton(\d+)@@"/g, (_, i) => JSON.stringify(SK[+i])));
console.log(JSON.stringify({ id, uvHash, verts: n, hi: { verts: hi.pos.length / 3, tris: hi.idx.length / 3, kb: hiKb }, lo: { verts: lo.pos.length / 3, tris: lo.idx.length / 3, kb: loKb }, uv: st, bones: B.length, hyoidVerts: nHy, tongueVerts: nTg,
  tongue: extra.slice(2).map((b) => b.head) }));
