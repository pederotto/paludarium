// A limb's joints and radii fitted to the scan's skin: a chain of capsules (thigh, shin, foot, toes ...) whose surface should lie on the limb's skin. The score (lower
// is better) is the mean over the limb's skin vertices of min(tau, distance to the nearest capsule SURFACE)^2 (skin the chain does not cover or fills) plus the mean over
// points sampled on the capsules' cylinders of min(tau, distance to the nearest skin vertex)^2 (capsule hanging in the air). Pattern search from the joints already
// measured (INIT), each joint moved +- STEP along each axis, the step halved when nothing improves; the root joint stays. For a scan whose limbs lie against each other,
// where the distance over the surface (limb-axes.mjs) crosses the touching skin and the creases (limb-lobes.mjs) are too shallow to cut by.
//   SRC=redeye_walk_mesh ROT=128 CENTER=0.274 LEVEL=1 PRE=40000 INIT=tools/rig/redeye-walk-joints.json SIDE=R BONES=thigh,shin,foot,toes JOINTS=hip,knee,heel,ankle,toe \
//     REGION="x > 0.25 && z < 0.12" [OUT=fit.json] node tools/rig/fit-chain.mjs
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
await MeshoptSimplifier.ready;
const E = process.env, ROT = +(E.ROT ?? 0), PRE = +(E.PRE ?? 40000), TAU = +(E.TAU ?? 0.1), SIDE = E.SIDE ?? 'R';
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(`art-src/raw/${E.SRC}.glb`); await doc.transform(weld());
const pr = doc.getRoot().listMeshes()[0].listPrimitives()[0];
let pos = Float32Array.from(pr.getAttribute('POSITION').getArray()), idx = Uint32Array.from(pr.getIndices().getArray());
if (PRE && idx.length / 3 > PRE) {
  const [out] = MeshoptSimplifier.simplify(idx, pos, 3, Math.floor(PRE * 3), 0.02, []); const [remap, count] = MeshoptSimplifier.compactMesh(out);
  const np = new Float32Array(count * 3); for (let i = 0; i < pos.length / 3; i++) if (remap[i] !== 0xffffffff) { const j = remap[i] * 3; np[j] = pos[i * 3]; np[j + 1] = pos[i * 3 + 1]; np[j + 2] = pos[i * 3 + 2]; }
  pos = np; idx = out;
}
{ const a = ROT * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a); for (let i = 0; i < pos.length; i += 3) { const x = pos[i], z = pos[i + 2]; pos[i] = x * ca + z * sa; pos[i + 2] = -x * sa + z * ca; } }
if (E.CENTER) for (let i = 0; i < pos.length; i += 3) pos[i] -= +E.CENTER;
if (E.LEVEL) { let sz = 0, sy = 0, szz = 0, szy = 0, m = 0; for (let i = 0; i < pos.length; i += 3) { const x = pos[i], y = pos[i + 1], z = pos[i + 2]; if (Math.abs(x) < 0.2 && z > -0.2 && z < 0.6) { sz += z; sy += y; szz += z * z; szy += z * y; m++; } }
  const th = Math.atan((m * szy - sz * sy) / (m * szz - sz * sz)), c = Math.cos(th), s = Math.sin(th); for (let i = 0; i < pos.length; i += 3) { const y = pos[i + 1], z = pos[i + 2]; pos[i + 1] = y * c - z * s; pos[i + 2] = y * s + z * c; } }
const n = pos.length / 3, inRegion = new Function('x', 'y', 'z', `return ${E.REGION ?? 'true'};`), R = [];
for (let i = 0; i < n; i++) if (inRegion(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2])) R.push(i);
// a grid of every vertex (cell 0.06) for the nearest-skin queries
const CELL = 0.06, grid = new Map(), key = (a, b, c) => `${a},${b},${c}`;
for (let i = 0; i < n; i++) { const k = key(Math.floor(pos[i * 3] / CELL), Math.floor(pos[i * 3 + 1] / CELL), Math.floor(pos[i * 3 + 2] / CELL)); (grid.get(k) ?? grid.set(k, []).get(k)).push(i); }
const nearSkin = (p) => { let best = TAU * TAU; const cx = Math.floor(p[0] / CELL), cy = Math.floor(p[1] / CELL), cz = Math.floor(p[2] / CELL);
  for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) for (let c = -2; c <= 2; c++) { const L = grid.get(key(cx + a, cy + b, cz + c)); if (!L) continue; for (const i of L) { const d = (pos[i * 3] - p[0]) ** 2 + (pos[i * 3 + 1] - p[1]) ** 2 + (pos[i * 3 + 2] - p[2]) ** 2; if (d < best) best = d; } } return best; };
const init = JSON.parse(fs.readFileSync(E.INIT, 'utf8')), J = (E.JOINTS ?? 'hip,knee,heel,ankle,toe').split(',').map((k) => init.joints[k + SIDE].slice()), names = (E.BONES ?? 'thigh,shin,foot,toes').split(',');
const rad = names.map((k) => init.radius[k]), nb = names.length;
const segDist = (p, h, t) => { const ux = t[0] - h[0], uy = t[1] - h[1], uz = t[2] - h[2], L2 = ux * ux + uy * uy + uz * uz || 1e-12, k = Math.max(0, Math.min(1, ((p[0] - h[0]) * ux + (p[1] - h[1]) * uy + (p[2] - h[2]) * uz) / L2)); return Math.hypot(p[0] - h[0] - ux * k, p[1] - h[1] - uy * k, p[2] - h[2] - uz * k); };
const Rv = R.map((i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]);
function score(J, rad) {
  let A = 0; for (const p of Rv) { let d = Infinity; for (let b = 0; b < nb; b++) d = Math.min(d, Math.abs(segDist(p, J[b], J[b + 1]) - rad[b])); A += Math.min(TAU, d) ** 2; } A /= Rv.length;
  let B = 0, m = 0;
  for (let b = 0; b < nb; b++) { const h = J[b], t = J[b + 1], u = [t[0] - h[0], t[1] - h[1], t[2] - h[2]], L = Math.hypot(...u) || 1e-9, e = u.map((v) => v / L), a = Math.abs(e[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const f = [e[1] * a[2] - e[2] * a[1], e[2] * a[0] - e[0] * a[2], e[0] * a[1] - e[1] * a[0]], fl = Math.hypot(...f), f1 = f.map((v) => v / fl), g = [e[1] * f1[2] - e[2] * f1[1], e[2] * f1[0] - e[0] * f1[2], e[0] * f1[1] - e[1] * f1[0]];
    for (let s = 0; s <= 8; s++) for (let q = 0; q < 8; q++) { const th = q * Math.PI / 4, t0 = L * (s / 8), p = [0, 1, 2].map((k) => h[k] + e[k] * t0 + rad[b] * (Math.cos(th) * f1[k] + Math.sin(th) * g[k])); B += nearSkin(p); m++; } }
  let pen = 0; for (let b = 0; b < nb; b++) { const L = Math.hypot(J[b + 1][0] - J[b][0], J[b + 1][1] - J[b][1], J[b + 1][2] - J[b][2]); if (L < 0.15) pen += (0.15 - L) ** 2 * 10; if (rad[b] < 0.02) pen += 1; }
  return A + B / m + pen;
}
let best = score(J, rad), step = +(E.STEP ?? 0.06); const s0 = best;
const moves = []; for (let j = 1; j <= nb; j++) for (let k = 0; k < 3; k++) moves.push(['J', j, k]); if (!E.FIXRAD) for (let b = 0; b < nb; b++) moves.push(['R', b, 0]);
for (let sweep = 0; sweep < 200 && step > 0.003; sweep++) {
  let improved = false;
  for (const [t, a, k] of moves) for (const sg of [1, -1]) {
    const d = step * (t === 'R' ? 0.4 : 1) * sg;
    if (t === 'J') J[a][k] += d; else rad[a] += d;
    const s = score(J, rad); if (s < best - 1e-9) { best = s; improved = true; } else if (t === 'J') J[a][k] -= d; else rad[a] -= d;
  }
  if (!improved) step /= 2;
}
const f = (a) => `[${a.map((x) => x.toFixed(2))}]`;
console.log(`region ${Rv.length} vertices; score ${s0.toFixed(5)} -> ${best.toFixed(5)}`);
(E.JOINTS ?? 'hip,knee,heel,ankle,toe').split(',').forEach((k, i) => console.log(`  ${k + SIDE}: ${f(init.joints[k + SIDE])} -> ${f(J[i])}`));
names.forEach((k, b) => console.log(`  ${k}: length ${Math.hypot(...J[b + 1].map((v, i) => v - J[b][i])).toFixed(2)}, radius ${init.radius[k]} -> ${rad[b].toFixed(3)}`));
if (E.OUT) fs.writeFileSync(E.OUT, JSON.stringify({ joints: Object.fromEntries((E.JOINTS ?? 'hip,knee,heel,ankle,toe').split(',').map((k, i) => [k + SIDE, J[i].map((x) => +x.toFixed(3))])), radius: Object.fromEntries(names.map((k, b) => [k, +rad[b].toFixed(3)])) }));
