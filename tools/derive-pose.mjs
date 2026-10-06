// Derives one pose body of an animal from another (owner, 6 Oct 2026: the sitting scan is the master; the swimming body is the same animal posed):
// the baked body's mesh, UVs, skin weights and skeleton, the bones turned to the target pose's directions and the skin blended through the same
// weights, so the new body has the same girth, the same UVs and the same maps. The coarse level is the new fine one simplified keeping its seams.
// The trunk of a swimming body is two bones (T4: spine and spineB, the old spine's weight shared by util/rig/skeleton.mjs spineRamp).
//
//   node tools/derive-pose.mjs <from id> <to id> [--pose=swim]          (run from the repository root; then: node tools/rig/muscles.mjs <to id> --write)
//   T4_OUT=<dir> writes into <dir> (and reads its manifest) instead of public/assets/creatures
//
// Target poses are bone directions in the new body's frame (head +z, y up), from a body measured in that pose (swim: the owner's swimming scan,
// tools/bake-frogpose.mjs). The turn of a bone is the shortest arc from its direction to the target's; a chain keeps its lengths.
import fs from 'node:fs';
import path from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { quantize, meshopt } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { spineRamp } from './rig/skeleton.mjs';

await MeshoptDecoder.ready; await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const OUT = process.env.T4_OUT || 'public/assets/creatures';
const args = process.argv.slice(2), [FROM, TO] = args.filter((a) => !a.startsWith('--')), pose = (args.find((a) => a.startsWith('--pose=')) ?? '--pose=swim').slice(7);
if (!FROM || !TO) throw new Error('usage: node tools/derive-pose.mjs <from id> <to id> [--pose=swim]');

// --- the poses: each bone's direction (right side; the left mirrors x) -------------------------------------------------------------------
const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
const POSES = {
  // read off the owner's swimming scan, measured as the bake sees it (levelled; tools/bake-frogpose.mjs TOAD_SWIM_SKELETON): the trunk flat, the head a little up,
  // the forelegs forward and out, the hind legs trailing in a flat V
  swim: {
    pelvis: [0, 0, 1], spine: [0, 0, 1], head: [0, 0.19, 1],
    thigh: [0.27, 0.08, -0.01], shin: [0.04, 0.07, -0.43], foot: [0.23, 0.07, -0.14], toes: [0.15, -0.09, -0.12],
    arm: [0.14, -0.13, 0.02], forearm: [0.01, -0.07, 0.14], hand: [0.09, -0.04, 0.14],
  },
};
const P = POSES[pose]; if (!P) throw new Error(`no pose ${pose}`);

// --- 3 x 3 helpers (row-major arrays of 9) -------------------------------------------------------------------------------------------------
const mv = (R, v) => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// the shortest rotation taking unit a to unit b (Rodrigues)
function arc(a, b) {
  const c = dot(a, b), v = cross(a, b), s2 = dot(v, v);
  if (s2 < 1e-12) { if (c > 0) return [1, 0, 0, 0, 1, 0, 0, 0, 1]; const t = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], ax = norm(cross(a, t)); return [2 * ax[0] * ax[0] - 1, 2 * ax[0] * ax[1], 2 * ax[0] * ax[2], 2 * ax[1] * ax[0], 2 * ax[1] * ax[1] - 1, 2 * ax[1] * ax[2], 2 * ax[2] * ax[0], 2 * ax[2] * ax[1], 2 * ax[2] * ax[2] - 1]; }
  const k = (1 - c) / s2;
  return [1 + k * (-v[2] * v[2] - v[1] * v[1]), -v[2] + k * v[0] * v[1], v[1] + k * v[0] * v[2], v[2] + k * v[0] * v[1], 1 + k * (-v[2] * v[2] - v[0] * v[0]), -v[0] + k * v[1] * v[2], -v[1] + k * v[0] * v[2], v[0] + k * v[1] * v[2], 1 + k * (-v[1] * v[1] - v[0] * v[0])];
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

// --- read the source body --------------------------------------------------------------------------------------------------------------------
const manPath = path.join(OUT, 'manifest.json'), man = JSON.parse(fs.readFileSync(fs.existsSync(manPath) ? manPath : 'public/assets/creatures/manifest.json', 'utf8'));
const SRC = 'public/assets/creatures/', mf = JSON.parse(fs.readFileSync(SRC + 'manifest.json', 'utf8'))[FROM];
if (!mf?.skeleton) throw new Error(`${FROM} has no skeleton in the manifest`);
const doc = await io.read(SRC + mf.file), node = doc.getRoot().listNodes().find((n) => n.getMesh()), prim = node.getMesh().listPrimitives()[0], M = node.getWorldMatrix();
const attr = (k) => { const a = prim.getAttribute(k); if (!a) return null; const e = a.getElementSize(), c = a.getCount(), out = new Float32Array(c * e), el = []; for (let i = 0; i < c; i++) { a.getElement(i, el); for (let j = 0; j < e; j++) out[i * e + j] = el[j]; } return out; };
const P0 = attr('POSITION'), N0 = attr('NORMAL'), UV = attr('TEXCOORD_0'), RIG = attr('_RIG'), SK = attr('_SKIN'), SX = attr('_SKINX'), n = P0.length / 3;
if (!SK || !SX || !UV) throw new Error(`${FROM}: needs _SKIN, _SKINX and TEXCOORD_0`);
const idx = Uint32Array.from(prim.getIndices().getArray());
const pos = new Float64Array(n * 3);                                                  // cm
for (let i = 0; i < n; i++) for (let r = 0; r < 3; r++) pos[i * 3 + r] = (M[r] * P0[i * 3] + M[4 + r] * P0[i * 3 + 1] + M[8 + r] * P0[i * 3 + 2] + M[12 + r]) * 100;
const mat = doc.getRoot().listMaterials()[0], imgC = mat.getBaseColorTexture()?.getImage(), imgN = mat.getNormalTexture()?.getImage();

// --- the bones: turn each to the target direction, chain them -------------------------------------------------------------------------
const B = mf.skeleton.bones, nb = B.length, by = Object.fromEntries(B.map((b, i) => [b.name, i]));
const d0 = B.map((b) => norm(sub(b.tail, b.head))), Lb = B.map((b) => Math.hypot(...sub(b.tail, b.head)));
const d1 = B.map((b) => { const base = b.name.replace(/[LR]$/, ''), t = P[base]; if (!t) throw new Error(`pose ${pose} has no bone ${base}`); const v = norm(t); return b.name.endsWith('L') ? [-v[0], v[1], v[2]] : v; });
const R = B.map((_, i) => arc(d0[i], d1[i]));
const H = new Array(nb), T = new Array(nb);
for (let i = 0; i < nb; i++) {
  const b = B[i], p = b.parent == null ? -1 : by[b.parent];
  if (p < 0) H[i] = b.head.slice();
  else if (Math.hypot(...sub(b.head, B[p].tail)) < 1e-3) H[i] = T[p];                    // a chain: it starts where its parent ends
  else H[i] = add(H[p], mv(R[p], sub(b.head, B[p].head)));                              // hung on its parent: carried rigidly
  T[i] = add(H[i], mul(d1[i], Lb[i]));
}

// --- the skin: the source weights blend each bone's turn -----------------------------------------------------------------------------------------
const bone4 = (i) => [[SK[i * 4], SK[i * 4 + 2]], [SK[i * 4 + 1], SK[i * 4 + 3]], [SX[i * 4], SX[i * 4 + 2]], [SX[i * 4 + 1], SX[i * 4 + 3]]].map(([b, w]) => [Math.round(b * 32), w]).filter(([, w]) => w > 0);
const np = new Float64Array(n * 3), nn = new Float32Array(n * 3), W = new Array(n);
for (let i = 0; i < n; i++) {
  const p = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]], nv = [N0[i * 3], N0[i * 3 + 1], N0[i * 3 + 2]], ws = bone4(i), tw = ws.reduce((s, [, w]) => s + w, 0) || 1;
  let q = [0, 0, 0], m = [0, 0, 0];
  for (const [b, w] of ws) { q = add(q, mul(add(mv(R[b], sub(p, B[b].head)), H[b]), w / tw)); m = add(m, mul(mv(R[b], nv), w / tw)); }
  np.set(q, i * 3); nn.set(norm(m), i * 3); W[i] = ws;
}
// the dominant bone of every vertex: the trunk's vertices measure the new frame
const dom = (i) => W[i].reduce((a, c) => (c[1] > a[1] ? c : a), [0, -1])[0];
// the new frame (the swimming bodies' convention: origin mid-trunk, belly on y = 0): x as it is, z so the middle of the trunk (snout to vent) is 0, y so the belly is 0
let zs = -1e9; const ys = [];
for (let i = 0; i < n; i++) { const b = dom(i), nm = B[b].name; if (nm === 'head') zs = Math.max(zs, np[i * 3 + 2]); if (nm === 'pelvis' || nm === 'spine') ys.push(np[i * 3 + 1]); }
ys.sort((a, c) => a - c);
const zv = H[by.pelvis][2], sz = -(zs + zv) / 2, sy = -ys[Math.floor(ys.length * 0.02)];
for (let i = 0; i < n; i++) { np[i * 3 + 1] += sy; np[i * 3 + 2] += sz; }
const shift = (v) => [v[0], v[1] + sy, v[2] + sz];
const bones = B.map((b, i) => ({ ...b, head: shift(H[i]).map((v) => +v.toFixed(3)), tail: shift(T[i]).map((v) => +v.toFixed(3)) }));

// --- the trunk in two bones (swimming bodies): spineB between the middle of the old spine and its end ------------------------------------------
const sp = bones[by.spine], mid2 = sp.head.map((v, k) => +((v + sp.tail[k]) / 2).toFixed(3));
const nb2 = JSON.parse(JSON.stringify(bones)); nb2[by.spine].tail = mid2;
nb2.splice(by.spine + 1, 0, { ...JSON.parse(JSON.stringify(sp)), name: 'spineB', parent: 'spine', head: mid2, tail: sp.tail });
for (const b of nb2) if (b.parent === 'spine' && b.name !== 'spineB') b.parent = 'spineB';
const ax = sub(sp.tail, sp.head), ax2 = dot(ax, ax);
// the weights: a bone from the spine on moves one place up; the old spine's share goes to spine and spineB along the old spine
function split4(ws, p) {
  const t = dot(sub(p, sp.head), ax) / ax2, f = spineRamp(t), nw = new Map();
  for (const [b, w] of ws) { if (b === by.spine) { nw.set(by.spine, (nw.get(by.spine) ?? 0) + w * (1 - f)); nw.set(by.spine + 1, (nw.get(by.spine + 1) ?? 0) + w * f); } else nw.set(b > by.spine ? b + 1 : b, (nw.get(b > by.spine ? b + 1 : b) ?? 0) + w); }
  const top = [...nw].filter(([, w]) => w > 0).sort((a, c) => c[1] - a[1] || a[0] - c[0]).slice(0, 4); while (top.length < 4) top.push([top[0][0], 0]);
  const s = top.reduce((q, [, w]) => q + w, 0); return top.map(([b, w]) => [b, w / s]);
}
const toArrays = (verts, wsOf) => {
  const m = verts.length, sk = new Float32Array(m * 4), sx = new Float32Array(m * 4);
  for (let i = 0; i < m; i++) { const t = wsOf(i); sk[i * 4] = t[0][0] / 32; sk[i * 4 + 1] = t[1][0] / 32; sk[i * 4 + 2] = t[0][1]; sk[i * 4 + 3] = t[1][1]; sx[i * 4] = t[2][0] / 32; sx[i * 4 + 1] = t[3][0] / 32; sx[i * 4 + 2] = t[2][1]; sx[i * 4 + 3] = t[3][1]; }
  return { sk, sx };
};

// --- write: the fine level, then the coarse one (the fine one simplified keeping its seams: the weights follow the vertices) ------------------
const T2 = await import('./rig/texture.mjs');
const m100 = new Float32Array(np.length); for (let i = 0; i < np.length; i++) m100[i] = np[i] / 100;          // metres
async function writeBody(id, level, g, image, imageN) {
  const doc2 = new Document(), buf = doc2.createBuffer(), m = g.pos.length / 3;
  const mat2 = doc2.createMaterial(id).setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.7).setMetallicFactor(0);
  if (image) {
    doc2.createExtension(EXTTextureWebP).setRequired(true);
    mat2.setBaseColorTexture(doc2.createTexture(`${id}_color`).setImage(image).setMimeType('image/webp'));
    if (imageN) mat2.setNormalTexture(doc2.createTexture(`${id}_normal`).setImage(imageN).setMimeType('image/webp'));
  }
  const rig = new Float32Array(m * 4); for (let i = 0; i < m; i++) for (let c = 0; c < 4; c++) rig[i * 4 + c] = RIG[g.from[i] * 4 + c];
  const { sk, sx } = toArrays(Array(m), (i) => g.ws[i]);
  const pr = doc2.createPrimitive()
    .setAttribute('POSITION', doc2.createAccessor().setType('VEC3').setArray(g.pos).setBuffer(buf))
    .setAttribute('NORMAL', doc2.createAccessor().setType('VEC3').setArray(g.nor).setBuffer(buf))
    .setAttribute('TEXCOORD_0', doc2.createAccessor().setType('VEC2').setArray(g.uv).setBuffer(buf))
    .setAttribute('_RIG', doc2.createAccessor().setType('VEC4').setArray(rig).setBuffer(buf))
    .setAttribute('_SKIN', doc2.createAccessor().setType('VEC4').setArray(sk).setBuffer(buf))
    .setAttribute('_SKINX', doc2.createAccessor().setType('VEC4').setArray(sx).setBuffer(buf))
    .setIndices(doc2.createAccessor().setType('SCALAR').setArray(g.idx).setBuffer(buf)).setMaterial(mat2);
  doc2.createScene().addChild(doc2.createNode(id).setMesh(doc2.createMesh(id).addPrimitive(pr)));
  await doc2.transform(quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 16, quantizeGeneric: 12 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  fs.mkdirSync(OUT, { recursive: true });
  const fid = id.replace(':', '-'), file = path.join(OUT, level === 'hi' ? `${fid}.glb` : `${fid}.lo.glb`);
  await io.write(file, doc2);
  return { file, bytes: fs.statSync(file).size, tris: g.idx.length / 3 };
}
const ws2 = Array.from({ length: n }, (_, i) => split4(W[i], [np[i * 3], np[i * 3 + 1], np[i * 3 + 2]]));
const fromId = new Uint32Array(n); for (let i = 0; i < n; i++) fromId[i] = i;
const hi = await writeBody(TO, 'hi', { pos: m100, nor: nn, uv: UV, idx, from: fromId, ws: ws2 }, imgC, imgN);
const lodTris = Math.round(idx.length / 3 * 0.5), L = T2.simplifyKeepingSeams(m100, idx, lodTris, UV), m = L.from.length;
const LP = new Float32Array(m * 3), LN = new Float32Array(m * 3), LU = new Float32Array(m * 2), LF = new Uint32Array(m), LW = new Array(m);
for (let i = 0; i < m; i++) { const j = L.from[i]; for (let c = 0; c < 3; c++) { LP[i * 3 + c] = m100[j * 3 + c]; LN[i * 3 + c] = nn[j * 3 + c]; } LU[i * 2] = UV[j * 2]; LU[i * 2 + 1] = UV[j * 2 + 1]; LF[i] = j; LW[i] = ws2[j]; }
const lo = await writeBody(TO, 'lo', { pos: LP, nor: LN, uv: LU, idx: L.idx, from: LF, ws: LW }, null, null);

// --- the manifest entry --------------------------------------------------------------------------------------------------------------------------
const size = [0, 1, 2].map((a) => { let lo2 = 1e9, hi2 = -1e9; for (let i = 0; i < n; i++) { lo2 = Math.min(lo2, np[i * 3 + a]); hi2 = Math.max(hi2, np[i * 3 + a]); } return +(hi2 - lo2).toFixed(2); });
const fin = JSON.parse(JSON.stringify(mf.finish)), hb = by.head;
for (const e of fin.eyes ?? []) { e.c = shift(add(H[hb], mv(R[hb], sub(e.c, B[hb].head)))).map((v) => +v.toFixed(3)); for (const k of ['axis', 'h', 'w']) if (e[k]) e[k] = mv(R[hb], e[k]); }
const manifest = JSON.parse(fs.readFileSync(fs.existsSync(manPath) ? manPath : SRC + 'manifest.json', 'utf8'));
manifest[TO] = { file: path.basename(hi.file), lo: path.basename(lo.file), legs: false, pose, tris: { hi: hi.tris, lo: lo.tris }, sizeCm: size, finish: fin, skeleton: { plan: 'anuran', bind: pose, bones: nb2 } };
const SKL = [];
fs.writeFileSync(manPath, JSON.stringify(manifest, (key, v) => (key === 'skeleton' && v && typeof v === 'object' ? `@@skeleton${SKL.push(v) - 1}@@` : v), 1).replace(/"@@skeleton(\d+)@@"/g, (_, i) => JSON.stringify(SKL[+i])));
console.log(`${TO} derived from ${FROM} (${pose}): hi ${hi.tris} tris ${(hi.bytes / 1024) | 0} KB, lo ${lo.tris} tris ${(lo.bytes / 1024) | 0} KB, ${size.join(' x ')} cm (x y z), ${nb2.length} bones`);
