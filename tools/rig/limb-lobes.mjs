// A folded limb cut into its lobes by the creases between them, an axis fitted to each lobe: for a scan whose thigh lies against its shin (the red-eye's hind legs) a
// distance over the surface (limb-axes.mjs) jumps across the touching skin, but the crease where two tubes meet is a concave line of the surface. Per vertex the
// concavity is the mean of (neighbour - vertex) . normal / distance over the neighbours (> 0: the neighbours lie above the tangent plane, a crease), smoothed;
// the vertices over THRESH are removed, the rest of the BOX falls into lobes (connected pieces), and each lobe with at least MIN vertices gets its principal axis
// (its two ends at the 2nd and 98th percentile of the projection) and its radius (the mean distance to the axis). The joints are where one lobe's end meets the next's.
//   SRC=redeye_walk_mesh ROT=128 CENTER=0.274 LEVEL=1 PRE=40000 BOX="x0,x1,y0,y1,z0,z1" [THRESH=0.05] [SMOOTH=3] [MIN=250] [OUT=lobes.json] node tools/rig/limb-lobes.mjs
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
await MeshoptSimplifier.ready;
const E = process.env, SRC = E.SRC, ROT = +(E.ROT ?? 0), PRE = +(E.PRE ?? 40000), THRESH = +(E.THRESH ?? 0.05), SMOOTH = +(E.SMOOTH ?? 3), MIN = +(E.MIN ?? 250);
const BOX = (E.BOX ?? '-9,9,-9,9,-9,9').split(',').map(Number);
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(`art-src/raw/${SRC}.glb`); await doc.transform(weld());
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
const n = pos.length / 3, P = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
const nb = Array.from({ length: n }, () => new Set()), N = new Float64Array(n * 3);
for (let t = 0; t < idx.length; t += 3) {
  const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]], A = P(a), B = P(b), C = P(c), u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]], f = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  for (const i of [a, b, c]) { N[i * 3] += f[0]; N[i * 3 + 1] += f[1]; N[i * 3 + 2] += f[2]; }
  for (const [x, y] of [[a, b], [b, c], [c, a]]) { nb[x].add(y); nb[y].add(x); }
}
for (let i = 0; i < n; i++) { const l = Math.hypot(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]) || 1; N[i * 3] /= l; N[i * 3 + 1] /= l; N[i * 3 + 2] /= l; }
// (the mesh winding: outward normals have the vertex's own position on the positive side of the body's centre; flip if most normals point inward at the box's extremes)
let conc = new Float64Array(n);
for (let i = 0; i < n; i++) { let s = 0, k = 0; const p = P(i); for (const j of nb[i]) { const q = P(j), d = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) || 1; s += ((q[0] - p[0]) * N[i * 3] + (q[1] - p[1]) * N[i * 3 + 1] + (q[2] - p[2]) * N[i * 3 + 2]) / d; k++; } conc[i] = k ? s / k : 0; }
{ // winding check: on a convex tube the mean concavity is negative with outward normals
  let m = 0, c = 0; for (let i = 0; i < n; i++) { const p = P(i); if (p[0] > BOX[0] && p[0] < BOX[1] && p[1] > BOX[2] && p[1] < BOX[3] && p[2] > BOX[4] && p[2] < BOX[5]) { m += conc[i]; c++; } }
  if (m / c > 0) { for (let i = 0; i < n; i++) conc[i] = -conc[i]; console.log('normals flipped'); }
}
for (let it = 0; it < SMOOTH; it++) { const c2 = new Float64Array(n); for (let i = 0; i < n; i++) { let s = conc[i], k = 1; for (const j of nb[i]) { s += conc[j]; k++; } c2[i] = s / k; } conc = c2; }
const inBox = (i) => { const p = P(i); return p[0] > BOX[0] && p[0] < BOX[1] && p[1] > BOX[2] && p[1] < BOX[3] && p[2] > BOX[4] && p[2] < BOX[5]; };
const keep = (i) => inBox(i) && conc[i] < THRESH, comp = new Int32Array(n).fill(-1), lobes = [];
for (let s = 0; s < n; s++) { if (!keep(s) || comp[s] >= 0) continue; const st = [s], vs = [s]; comp[s] = lobes.length; while (st.length) { const u = st.pop(); for (const v of nb[u]) if (comp[v] < 0 && keep(v)) { comp[v] = lobes.length; st.push(v); vs.push(v); } } lobes.push(vs); }
const res = [];
for (const vs of lobes) {
  if (vs.length < MIN) continue;
  const c = [0, 1, 2].map((k) => vs.reduce((a, i) => a + P(i)[k], 0) / vs.length); let C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const i of vs) { const p = P(i).map((x, k) => x - c[k]); for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) C[a][b] += p[a] * p[b] / vs.length; }
  let ax = [1, 0.3, 0.2]; for (let it = 0; it < 60; it++) { const y = C.map((r) => r[0] * ax[0] + r[1] * ax[1] + r[2] * ax[2]), l = Math.hypot(...y); ax = y.map((v) => v / l); }
  const pr_ = vs.map((i) => P(i).reduce((a, x, k) => a + (x - c[k]) * ax[k], 0)).sort((a, b) => a - b), t0 = pr_[Math.floor(0.02 * pr_.length)], t1 = pr_[Math.floor(0.98 * pr_.length)];
  const r = vs.reduce((a, i) => { const p = P(i).map((x, k) => x - c[k]), t = p[0] * ax[0] + p[1] * ax[1] + p[2] * ax[2]; return a + Math.hypot(p[0] - ax[0] * t, p[1] - ax[1] * t, p[2] - ax[2] * t); }, 0) / vs.length;
  res.push({ n: vs.length, c, a: c.map((x, k) => x + ax[k] * t0), b: c.map((x, k) => x + ax[k] * t1), len: t1 - t0, r });
}
res.sort((a, b) => b.n - a.n);
res.forEach((l, i) => console.log(`lobe ${i}: n ${l.n}  from [${l.a.map((x) => x.toFixed(2))}] to [${l.b.map((x) => x.toFixed(2))}]  length ${l.len.toFixed(2)}  radius ${l.r.toFixed(3)}`));
if (E.OUT) fs.writeFileSync(E.OUT, JSON.stringify(res));
