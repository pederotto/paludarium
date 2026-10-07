// Joint placement aid: top / side / front views of a scan in the bake's rig frame (scan units after rotY), coloured by limb with
// legT bands, plus the centroid of each limb's legT band printed. MARK (env, JSON {name: [x,y,z]}) draws candidate joints.
//   SRC=frog_mesh ROT=-90 PRE=22000 RIG=frog node tools/rig/joints-view.mjs out.png      (run from the repository root)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld } from '@gltf-transform/functions';
import fs from 'node:fs';
import sharp from 'sharp';
import { MeshoptSimplifier } from 'meshoptimizer';
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const SRC = process.env.SRC ?? 'frog_mesh', ROT = +(process.env.ROT ?? -90), PRE = +(process.env.PRE ?? 0), RIG = process.env.RIG ?? 'frog';
const doc = await io.read(`art-src/raw/${SRC}.glb`); await doc.transform(weld());
const p = doc.getRoot().listMeshes()[0].listPrimitives()[0];
let pos = Float32Array.from(p.getAttribute('POSITION').getArray()), idx = Uint32Array.from(p.getIndices().getArray());
if (PRE && idx.length / 3 > PRE) {
  const [out] = MeshoptSimplifier.simplify(idx, pos, 3, Math.floor(PRE * 3), 0.02, []);
  const [remap, count] = MeshoptSimplifier.compactMesh(out);
  const np = new Float32Array(count * 3);
  for (let i = 0; i < pos.length / 3; i++) if (remap[i] !== 0xffffffff) { const j = remap[i] * 3; np[j] = pos[i * 3]; np[j + 1] = pos[i * 3 + 1]; np[j + 2] = pos[i * 3 + 2]; }
  pos = np; idx = out;
}
const a = ROT * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
for (let i = 0; i < pos.length; i += 3) { const x = pos[i], z = pos[i + 2]; pos[i] = x * ca + z * sa; pos[i + 2] = -x * sa + z * ca; }

if (process.env.CENTER) { const cx = +process.env.CENTER; for (let i = 0; i < pos.length; i += 3) pos[i] -= cx; }   // (as the bake's job.center)
// LEVEL=1: the bake's own levelling (tools/bake-frogpose.mjs analyse step 1): a least-squares line through the trunk, rotated about x until flat
if (process.env.LEVEL) {
  let sz = 0, sy = 0, szz = 0, szy = 0, m = 0;
  for (let i = 0; i < pos.length; i += 3) { const x = pos[i], y = pos[i + 1], z = pos[i + 2]; if (Math.abs(x) < 0.2 && z > -0.2 && z < 0.6) { sz += z; sy += y; szz += z * z; szy += z * y; m++; } }
  const b = (m * szy - sz * sy) / (m * szz - sz * sz), th = Math.atan(b), c = Math.cos(th), s = Math.sin(th);
  for (let i = 0; i < pos.length; i += 3) { const y = pos[i + 1], z = pos[i + 2]; pos[i + 1] = y * c - z * s; pos[i + 2] = y * s + z * c; }
  console.log('levelled by', (th * 180 / Math.PI).toFixed(1), 'deg');
}
const n = pos.length / 3;
let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], pos[i * 3 + k]); mx[k] = Math.max(mx[k], pos[i * 3 + k]); }
console.log('verts', n, 'bbox', mn.map((v) => v.toFixed(3)), mx.map((v) => v.toFixed(3)));
// DUMP=<file.json>: the framed mesh as { pos, idx } (for a look in Blender), nothing else
if (process.env.DUMP) { fs.writeFileSync(process.env.DUMP, JSON.stringify({ pos: [...pos].map((v) => +v.toFixed(4)), idx: [...idx] })); console.log('dumped', process.env.DUMP); process.exit(0); }
let rig = null;
if (RIG !== 'none') { const M = await import(`./${RIG}.mjs`); rig = M[`${RIG}Rig`](pos, idx, JSON.parse(process.env.RIGOPT ?? '{}')); }
else { const { segment } = await import('./appendages.mjs'); const seg = segment(pos, idx, JSON.parse(process.env.SEG ?? '{"thin":0.24,"eyeMax":30,"distal":0.08,"minLimb":30}')); rig = { leg: Uint8Array.from(seg.limb, (l) => l + 1), legT: new Float32Array(n) }; for (const L of seg.limbs) console.log('limb', L.k, 'n', L.n, 'c', L.c.map((v) => +v.toFixed(2)), 'reach', +L.reach.toFixed(2)); }
// legT band centroids per limb
for (let l = 1; l <= 4 && rig.legT; l++) {
  const rows = [];
  for (let b = 0; b < 10; b++) {
    let s = [0, 0, 0], c = 0;
    for (let i = 0; i < n; i++) if (rig.leg[i] === l && rig.legT[i] >= b / 10 && rig.legT[i] < (b + 1) / 10 + (b === 9 ? 0.01 : 0)) { s[0] += pos[i * 3]; s[1] += pos[i * 3 + 1]; s[2] += pos[i * 3 + 2]; c++; }
    if (c) rows.push(`${(b / 10).toFixed(1)}:[${s.map((v) => (v / c).toFixed(2)).join(',')}]`);
  }
  console.log('leg', l, rows.join(' '));
}
let MARK = JSON.parse(process.env.MARK ?? '{}'), CHAINS = JSON.parse(process.env.CHAINS ?? '[]');
// SKEL (a JSON file { bones: 'frog', joints, radius }): the skeleton drawn and the skin coloured by the bone each vertex is bound to
// (bindCapsules, the runtime binding), the second bone's share shading it.
let bind = null, bones = null;
if (process.env.SKEL) {
  const fs = await import('node:fs'), S = await import('./skeleton.mjs');
  const sk = JSON.parse(fs.readFileSync(process.env.SKEL, 'utf8'));
  bones = S[`${sk.bones ?? 'frog'}Bones`](sk.joints);
  bind = S.bindCapsules(pos, bones, { radius: sk.radius ?? {}, rig, tris: idx, smooth: sk.smooth ?? 6 });
  MARK = { ...sk.joints, ...MARK };
  CHAINS = [...CHAINS, ...bones.map((b) => [b.head, b.tail])];
  const cnt = bones.map(() => 0); for (let i = 0; i < n; i++) cnt[bind.idx[i * 2]]++;
  console.log('vertices per bone', bones.map((b, i) => `${b.name} ${cnt[i]}`).join(', '));
}
const PAL = [[200, 200, 200], [150, 150, 170], [230, 230, 150], [230, 70, 70], [240, 150, 60], [240, 230, 60], [140, 240, 80], [60, 200, 240], [80, 120, 250], [190, 90, 240], [230, 70, 70], [240, 150, 60], [240, 230, 60], [140, 240, 80], [60, 200, 240], [80, 120, 250], [190, 90, 240], [250, 120, 180], [120, 250, 200], [250, 250, 250], [100, 100, 100]];
// ZOOM and C (env: a centre [x, y, z]) look closer at one part
const ZOOM = +(process.env.ZOOM ?? 1), CEN = JSON.parse(process.env.C ?? '[0,0,0]');
const S = 800, half = Math.max(...mx.map(Math.abs), ...mn.map(Math.abs)) * 1.08 / ZOOM, sc = S / 2 / half;
const views = [['top', (q) => [q[0], -q[2]], (q) => q[1]], ['side', (q) => [q[2], -q[1]], (q) => q[0]], ['front', (q) => [q[0], -q[1]], (q) => q[2]]];
const P3 = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
const outs = [];
for (const [name, pr, depth] of views) {
  const img = Buffer.alloc(S * S * 3, 20), zb = new Float32Array(S * S).fill(-1e9);
  const [cu, cv] = pr(CEN);
  const P = (i) => { const q = P3(i), [u, v] = pr(q); return [(u - cu + half) * sc, (v - cv + half) * sc, depth(q)]; };
  for (let t = 0; t < idx.length; t += 3) {
    const A = P(idx[t]), B = P(idx[t + 1]), C = P(idx[t + 2]);
    const u = [0, 1, 2].map((k) => pos[idx[t + 1] * 3 + k] - pos[idx[t] * 3 + k]), v = [0, 1, 2].map((k) => pos[idx[t + 2] * 3 + k] - pos[idx[t] * 3 + k]);
    let nn = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; const l = Math.hypot(...nn) || 1; nn = nn.map((x) => x / l);
    const lit = 0.35 + 0.65 * Math.abs(name === 'top' ? nn[1] : name === 'side' ? nn[0] : nn[2]);
    const leg = rig.leg[idx[t]], lt = rig.legT?.[idx[t]] ?? 0;
    let col = leg ? [[220, 80, 80], [80, 220, 80], [80, 120, 240], [230, 220, 60], [200, 90, 220], [90, 220, 220]][(leg - 1) % 6] : [200, 200, 200];
    if (leg && Math.floor(lt * 10) % 2) col = col.map((c) => c * 0.6);
    if (bind) { const v0 = idx[t]; col = PAL[bind.idx[v0 * 2] % PAL.length].map((c) => c * (0.55 + 0.45 * bind.w[v0])); }
    const x0 = Math.max(0, Math.floor(Math.min(A[0], B[0], C[0]))), x1 = Math.min(S - 1, Math.ceil(Math.max(A[0], B[0], C[0])));
    const y0 = Math.max(0, Math.floor(Math.min(A[1], B[1], C[1]))), y1 = Math.min(S - 1, Math.ceil(Math.max(A[1], B[1], C[1])));
    const d = (B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1]); if (Math.abs(d) < 1e-9) continue;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const w1 = ((x - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (y - A[1])) / d, w2 = ((B[0] - A[0]) * (y - A[1]) - (x - A[0]) * (B[1] - A[1])) / d, w0 = 1 - w1 - w2;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = w0 * A[2] + w1 * B[2] + w2 * C[2]; const k = y * S + x; if (z <= zb[k]) continue; zb[k] = z;
      img[k * 3] = col[0] * lit; img[k * 3 + 1] = col[1] * lit; img[k * 3 + 2] = col[2] * lit;
    }
  }
  const svg = [];
  const step = half > 3 ? 0.5 : 0.1;
  for (let g = -3; g <= 3 + 1e-6; g += step) {
    const qx = (g - cu + half) * sc, qy = (g - cv + half) * sc, strong = Math.abs(Math.round(g / step)) % 2 === 0;
    if (qx > 0 && qx < S) svg.push(`<line x1="${qx}" y1="0" x2="${qx}" y2="${S}" stroke="${strong ? '#5af' : '#246'}" opacity="0.5"/>`);
    if (qy > 0 && qy < S) svg.push(`<line x1="0" y1="${qy}" x2="${S}" y2="${qy}" stroke="${strong ? '#5af' : '#246'}" opacity="0.5"/>`);
    if (strong && qx > 0 && qx < S) svg.push(`<text x="${qx + 2}" y="12" font-size="11" fill="#8cf">${g.toFixed(1)}</text>`);
    if (strong && qy > 0 && qy < S) svg.push(`<text x="2" y="${qy - 2}" font-size="11" fill="#8cf">${(-g).toFixed(1)}</text>`);
  }
  const at = (pt) => { const [u, v] = pr(pt); return [(u - cu + half) * sc, (v - cv + half) * sc]; };
  for (const [k, pt] of Object.entries(MARK)) { const [X, Y] = at(pt); svg.push(`<circle cx="${X}" cy="${Y}" r="4" fill="#f0f"/><text x="${X + 5}" y="${Y - 5}" font-size="11" fill="#f6f">${k}</text>`); }
  for (const ch of CHAINS) svg.push(`<polyline points="${ch.map((k) => at(typeof k === 'string' ? MARK[k] : k).join(',')).join(' ')}" fill="none" stroke="#f0f" stroke-width="2"/>`);
  svg.push(`<text x="10" y="${S - 10}" font-size="16" fill="#fff">${name}</text>`);
  outs.push(await sharp(img, { raw: { width: S, height: S, channels: 3 } }).composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">${svg.join('')}</svg>`) }]).png().toBuffer());
}
await sharp({ create: { width: S * 3, height: S, channels: 3, background: '#000' } }).composite(outs.map((b, i) => ({ input: b, left: i * S, top: 0 }))).png().toFile(process.argv[2] ?? 'joints.png');
