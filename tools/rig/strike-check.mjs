// The frog's tongue strike checked on the SHIPPED file through the game's own pose code (gate 4, 7 Oct 2026): the near body of <id> decoded, its bones from the
// manifest, every frame of the strike posed by render/creatures/skeleton.js (poseHeadAtRest: the body at rest, the jaw, hyoid and tongue by util/frogstrike.js),
// skinned on the CPU with the file's own four-bone weights, then every tongue vertex tested against the rest of the body (ray parity, a vote of three axes).
// Exit 1 when a tongue vertex (away from its root) is inside tissue in any frame.
//   node tools/rig/strike-check.mjs [id] [--frames 26]
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { skeletonRig, poseHeadAtRest, ROW_FLOATS } from '../../src/render/creatures/skeleton.js';
import { strikeCurves } from '../../src/util/frogstrike.js';
await MeshoptDecoder.ready;
const args = process.argv.slice(2), id = args.find((a) => !a.startsWith('--')) ?? 'commonfrog.swim', FR = +(args.includes('--frames') ? args[args.indexOf('--frames') + 1] : 26);
const DIR = 'public/assets/creatures/', man = JSON.parse(fs.readFileSync(DIR + 'manifest.json', 'utf8'))[id];
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(DIR + man.file), node = doc.getRoot().listNodes().find((n) => n.getMesh()), prim = node.getMesh().listPrimitives()[0], Mw = node.getWorldMatrix();
const get = (name) => { const a = prim.getAttribute(name), n = a.getCount(), c = a.getElementSize(), o = new Float32Array(n * c), e = []; for (let i = 0; i < n; i++) { a.getElement(i, e); for (let k = 0; k < c; k++) o[i * c + k] = e[k]; } return o; };
const P0 = get('POSITION'), SK = get('_SKIN'), SX = get('_SKINX'), I = prim.getIndices().getArray(), n = P0.length / 3;
for (let i = 0; i < n; i++) { const x = P0[i * 3], y = P0[i * 3 + 1], z = P0[i * 3 + 2]; for (let r = 0; r < 3; r++) P0[i * 3 + r] = (Mw[r] * x + Mw[4 + r] * y + Mw[8 + r] * z + Mw[12 + r]) * 100; }   // cm
const bones = (i) => [[SK[i * 4] * 32, SK[i * 4 + 2]], [SK[i * 4 + 1] * 32, SK[i * 4 + 3]], [SX[i * 4] * 32, SX[i * 4 + 2]], [SX[i * 4 + 1] * 32, SX[i * 4 + 3]]].map(([b, w]) => [Math.round(b), w]);
const rig = skeletonRig(man.skeleton, {}), T1 = rig.byName.tongue1, att = rig.head[T1];
const tw = new Float32Array(n); for (let i = 0; i < n; i++) for (const [b, w] of bones(i)) if (b >= T1 && b <= T1 + 3) tw[i] += w;
// (the root: the first 5 % of the tongue's length from its attachment, along its axis, where it grows out of the floor: as strike_sweep.py's t <= 0.05)
const tip = rig.tail[T1 + 3], ax0 = [tip[0] - att[0], tip[1] - att[1], tip[2] - att[2]], tlen = Math.hypot(...ax0);
const tongue = [], root = new Uint8Array(n), along = new Float32Array(n);
for (let i = 0; i < n; i++) if (tw[i] > 0.5) { tongue.push(i); along[i] = ((P0[i * 3] - att[0]) * ax0[0] + (P0[i * 3 + 1] - att[1]) * ax0[1] + (P0[i * 3 + 2] - att[2]) * ax0[2]) / (tlen * tlen); if (along[i] <= 0.05) root[i] = 1; }
const tset = new Uint8Array(n); for (const i of tongue) tset[i] = 1;
const body = []; for (let t = 0; t < I.length; t += 3) if (!(tset[I[t]] && tset[I[t + 1]] && tset[I[t + 2]])) body.push(I[t], I[t + 1], I[t + 2]);
const out = new Float32Array(ROW_FLOATS), Q = new Float32Array(n * 3);
const skin = () => { for (let i = 0; i < n; i++) { let x = 0, y = 0, z = 0; for (const [b, w] of bones(i)) { if (w <= 1e-6) continue; const m = b * 12, px = P0[i * 3], py = P0[i * 3 + 1], pz = P0[i * 3 + 2];
  x += w * (out[m] * px + out[m + 1] * py + out[m + 2] * pz + out[m + 3]); y += w * (out[m + 4] * px + out[m + 5] * py + out[m + 6] * pz + out[m + 7]); z += w * (out[m + 8] * px + out[m + 9] * py + out[m + 10] * pz + out[m + 11]); } Q[i * 3] = x; Q[i * 3 + 1] = y; Q[i * 3 + 2] = z; } };
// ray parity along +axis, the body's triangles prefiltered by their box
function inside(q, axis) {
  const o1 = (axis + 1) % 3, o2 = (axis + 2) % 3; let c = 0;
  for (let t = 0; t < body.length; t += 3) {
    const a = body[t] * 3, b = body[t + 1] * 3, cc = body[t + 2] * 3;
    const lo1 = Math.min(Q[a + o1], Q[b + o1], Q[cc + o1]), hi1 = Math.max(Q[a + o1], Q[b + o1], Q[cc + o1]); if (q[o1] < lo1 || q[o1] > hi1) continue;
    const lo2 = Math.min(Q[a + o2], Q[b + o2], Q[cc + o2]), hi2 = Math.max(Q[a + o2], Q[b + o2], Q[cc + o2]); if (q[o2] < lo2 || q[o2] > hi2) continue;
    if (Math.max(Q[a + axis], Q[b + axis], Q[cc + axis]) < q[axis]) continue;
    const d = [0, 0, 0]; d[axis] = 1;
    const e1 = [Q[b] - Q[a], Q[b + 1] - Q[a + 1], Q[b + 2] - Q[a + 2]], e2 = [Q[cc] - Q[a], Q[cc + 1] - Q[a + 1], Q[cc + 2] - Q[a + 2]];
    const h = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]], det = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2];
    if (Math.abs(det) < 1e-12) continue;
    const f = 1 / det, s = [q[0] - Q[a], q[1] - Q[a + 1], q[2] - Q[a + 2]], u = f * (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]); if (u < 0 || u > 1) continue;
    const qq = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]], v = f * qq[axis]; if (v < 0 || u + v > 1) continue;
    if (f * (e2[0] * qq[0] + e2[1] * qq[1] + e2[2] * qq[2]) > 1e-9) c++;
  }
  return c & 1;
}
let worst = 0; const snoutZ = Math.max(...rig.head.map((h, b) => (rig.B[b].name === 'head' ? rig.tail[b][2] : -1e9)));
for (let f = 0; f < FR; f++) {
  const t = f / (FR - 1); poseHeadAtRest(rig, { strikeT: t }, out); skin();
  let bad = 0, rootIn = 0, reach = -1e9;
  for (const i of tongue) { const q = [Q[i * 3], Q[i * 3 + 1], Q[i * 3 + 2]], v = inside(q, 0) + inside(q, 1) + inside(q, 2) >= 2; if (v) { if (root[i]) rootIn++; else bad++; } reach = Math.max(reach, q[2] - snoutZ); }
  worst = Math.max(worst, bad); const c = strikeCurves(t);
  if (bad && process.env.WHERE) { const L = []; for (const i of tongue) { const q = [Q[i * 3], Q[i * 3 + 1], Q[i * 3 + 2]]; if (!root[i] && inside(q, 0) + inside(q, 1) + inside(q, 2) >= 2) L.push(along[i].toFixed(2)); } console.log('   in tissue at tongue position', [...new Set(L)].join(' ')); }
  console.log(`t ${t.toFixed(2)} gape ${(c.gape * 180 / Math.PI).toFixed(1)} p ${c.p.toFixed(2)} s ${c.s.toFixed(2)} | tongue in tissue ${String(bad).padStart(3)} (root ${rootIn}) | reach ${reach >= 0 ? '+' : ''}${reach.toFixed(2)} cm past the snout bone's tip`);
}
console.log(`${id}: ${tongue.length} tongue vertices, ${body.length / 3} body triangles; WORST ${worst} in tissue over ${FR} frames`);
process.exit(worst ? 1 : 0);
