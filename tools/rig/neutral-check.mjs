// The red-eye walking scan taken back to neutral through its skeleton, and what that says about the rig (owner, 6 Oct 2026): the head's roll fitted from the two eye
// bumps and undone about the head bone's axis; the skin's stretch from that (the scan's edges before and after), the eyes level afterwards, the bone lengths left against
// right, and the longissimus strap (content/anuranmuscles.js) at rest and in the neutral pose.   node tools/rig/neutral-check.mjs [--roll=<deg>] [--passes=40]
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { bindCapsules, frogBones } from './skeleton.mjs';
import { headWeight, rollHead, fitHeadRoll } from './neutral.mjs';
import { anuranMuscleSet, musclePathLength } from '../../src/content/anuranmuscles.js';
await MeshoptSimplifier.ready;
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const J = JSON.parse(fs.readFileSync(new URL('./redeye-walk-joints.json', import.meta.url), 'utf8')), PRE = +arg('pre', 60000), PASSES = +arg('passes', 40);
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read('art-src/raw/redeye_walk_mesh.glb'); await doc.transform(weld());
const pr = doc.getRoot().listMeshes()[0].listPrimitives()[0];
let pos = Float32Array.from(pr.getAttribute('POSITION').getArray()), idx = Uint32Array.from(pr.getIndices().getArray());
{ const [out] = MeshoptSimplifier.simplify(idx, pos, 3, PRE * 3, 0.02, []); const [remap, count] = MeshoptSimplifier.compactMesh(out);
  const np = new Float32Array(count * 3); for (let i = 0; i < pos.length / 3; i++) if (remap[i] !== 0xffffffff) { const j = remap[i] * 3; np[j] = pos[i * 3]; np[j + 1] = pos[i * 3 + 1]; np[j + 2] = pos[i * 3 + 2]; } pos = np; idx = out; }
// the bake's frame: rotY, the trunk's x to 0, levelled (tools/bake-frogpose.mjs analyse)
{ const a = J.frame.rotY * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a); for (let i = 0; i < pos.length; i += 3) { const x = pos[i], z = pos[i + 2]; pos[i] = x * ca + z * sa - J.frame.center; pos[i + 2] = -x * sa + z * ca; }
  let sz = 0, sy = 0, szz = 0, szy = 0, m = 0; for (let i = 0; i < pos.length; i += 3) { const x = pos[i], y = pos[i + 1], z = pos[i + 2]; if (Math.abs(x) < 0.2 && z > -0.2 && z < 0.6) { sz += z; sy += y; szz += z * z; szy += z * y; m++; } }
  const th = Math.atan((m * szy - sz * sy) / (m * szz - sz * sz)), c = Math.cos(th), s = Math.sin(th); for (let i = 0; i < pos.length; i += 3) { const y = pos[i + 1], z = pos[i + 2]; pos[i + 1] = y * c - z * s; pos[i + 2] = y * s + z * c; } }
const n = pos.length / 3, bones = frogBones(J.joints); for (const b of bones) b.r = J.radius[b.name] ?? J.radius[b.name.replace(/[LR]$/, '')] ?? 0.05;
console.log(`${n} vertices, ${bones.length} bones: ${bones.map((b) => b.name).join(' ')}`);
const bind = bindCapsules(pos, bones, { radius: J.radius, tris: idx, smooth: 6 });
const w = headWeight(bones, bind, n, idx, PASSES), hb = bones.find((b) => b.name === 'head'), c = hb.head, ax = hb.tail.map((v, i) => v - hb.head[i]);
console.log(`head weight: ${[...w].filter((x) => x > 0.5).length} vertices above 0.5, ${[...w].filter((x) => x > 0.02 && x < 0.98).length} in the neck band`);
const fit = arg('roll', '') === '' ? fitHeadRoll(pos, w, c, ax) : { deg: +arg('roll'), gap: NaN };
console.log(`head roll fitted: ${fit.deg.toFixed(1)} deg (eye centroids L [${(fit.left ?? []).map((x) => x.toFixed(2))}] R [${(fit.right ?? []).map((x) => x.toFixed(2))}])`);
const neu = rollHead(pos, w, c, ax, fit.deg);
// the eye bumps before and after
const eyes = (P) => ['L', 'R'].map((sd) => { const V = []; for (let i = 0; i < n; i++) if (w[i] > 0.5 && P[i * 3 + 1] > 0.02 && Math.sign(P[i * 3]) === (sd === 'R' ? 1 : -1)) V.push([P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]); const cc = [0, 1, 2].map((k) => V.reduce((a, p) => a + p[k], 0) / V.length); const ys = V.map((p) => p[1]).sort((a, b) => a - b); return `${sd} centroid [${cc.map((x) => x.toFixed(2))}] top y ${ys[Math.floor(ys.length * 0.98)].toFixed(3)}`; });
console.log('eyes before:', eyes(pos).join(' | ')); console.log('eyes after: ', eyes(neu).join(' | '));
// the skin's stretch: every edge's length after against before
let over13 = 0, over2 = 0, worst = 1, edges = 0; const seen = new Set();
for (let t = 0; t < idx.length; t += 3) for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) { const u = idx[t + a], v = idx[t + b], k = u < v ? u * n + v : v * n + u; if (seen.has(k)) continue; seen.add(k); edges++;
  const d0 = Math.hypot(pos[u * 3] - pos[v * 3], pos[u * 3 + 1] - pos[v * 3 + 1], pos[u * 3 + 2] - pos[v * 3 + 2]), d1 = Math.hypot(neu[u * 3] - neu[v * 3], neu[u * 3 + 1] - neu[v * 3 + 1], neu[u * 3 + 2] - neu[v * 3 + 2]), r = d1 / Math.max(d0, 1e-9); if (r > 1.3) over13++; if (r > 2) over2++; worst = Math.max(worst, r); }
console.log(`stretch of the neutral pose: ${edges} edges, > 1.3x ${(100 * over13 / edges).toFixed(2)} %, > 2x ${(100 * over2 / edges).toFixed(2)} %, worst ${worst.toFixed(2)}x`);
// the bones left against right (lengths, scan units)
const L = (b) => Math.hypot(b.tail[0] - b.head[0], b.tail[1] - b.head[1], b.tail[2] - b.head[2]);
for (const nm of ['thigh', 'shin', 'foot', 'toes', 'scapula', 'arm', 'forearm', 'hand', 'fingers']) { const l = bones.find((b) => b.name === nm + 'L'), r = bones.find((b) => b.name === nm + 'R'); if (l && r) console.log(`  ${nm.padEnd(8)} L ${L(l).toFixed(2)}  R ${L(r).toFixed(2)}  R/L ${(L(r) / L(l)).toFixed(2)}`); }
// the longissimus strap in the scanned pose and with the head rolled back (its head end follows the head bone's roll; the other points stay)
const skel = { plan: 'anuran', bones: bones.map((b) => ({ ...b })) }, set = anuranMuscleSet(skel);
if (!set) console.log('no muscle set'); else for (const sd of ['L', 'R']) { const m = set.find((x) => x.id === 'LGD' && x.side === sd), hi = skel.bones.findIndex((b) => b.name === 'head'), th = fit.deg * Math.PI / 180;
  const U = ax.map((v) => v / Math.hypot(...ax)), Rm = (p) => { const x = p[0] - c[0], y = p[1] - c[1], z = p[2] - c[2], q = [U[0], U[1], U[2]], cs = Math.cos(th), sn = Math.sin(th), k = 1 - cs, R = [cs + q[0] * q[0] * k, q[0] * q[1] * k - q[2] * sn, q[0] * q[2] * k + q[1] * sn, q[1] * q[0] * k + q[2] * sn, cs + q[1] * q[1] * k, q[1] * q[2] * k - q[0] * sn, q[2] * q[0] * k - q[1] * sn, q[2] * q[1] * k + q[0] * sn, cs + q[2] * q[2] * k]; return [c[0] + R[0] * x + R[1] * y + R[2] * z, c[1] + R[3] * x + R[4] * y + R[5] * z, c[2] + R[6] * x + R[7] * y + R[8] * z]; };
  const L0 = musclePathLength(m, skel, (b, p) => p), L1 = musclePathLength(m, skel, (b, p) => (b === hi ? Rm(p) : p));
  console.log(`  LGD ${sd}: ${m.pts.length} points, path ${L0.toFixed(3)} scanned, ${L1.toFixed(3)} with the head rolled back (${(100 * (L1 / L0 - 1)).toFixed(1)} %), ${(L0 / 1.55).toFixed(2)} of the trunk`); }
