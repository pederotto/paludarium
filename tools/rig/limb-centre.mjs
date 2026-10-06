// Joint measuring aid: the centreline of a limb of a scan, as the centroid of each band of geodesic distance from its tip (rotated frame: head +z).
//   SRC=toad_swim_mesh ROT=-90 LIMBS='[[name, [tip x,y,z], [box x0,x1,y0,y1,z0,z1], bandWidth]]' node tools/rig/limb-centre.mjs   (run from the repository root)
import { NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions'; import { weld } from '@gltf-transform/functions'; import { MeshoptSimplifier } from 'meshoptimizer';
await MeshoptSimplifier.ready;
const SRC = process.env.SRC, ROT = +process.env.ROT, PRE = +(process.env.PRE ?? 30000);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS); const doc = await io.read(`art-src/raw/${SRC}.glb`); await doc.transform(weld());
const p = doc.getRoot().listMeshes()[0].listPrimitives()[0];
let pos = Float32Array.from(p.getAttribute('POSITION').getArray()), idx = Uint32Array.from(p.getIndices().getArray());
{ const [out] = MeshoptSimplifier.simplify(idx, pos, 3, PRE * 3, 0.02, []); const [remap, count] = MeshoptSimplifier.compactMesh(out); const np = new Float32Array(count * 3); for (let i = 0; i < pos.length / 3; i++) if (remap[i] !== 0xffffffff) { const j = remap[i] * 3; np[j] = pos[i*3]; np[j+1] = pos[i*3+1]; np[j+2] = pos[i*3+2]; } pos = np; idx = out; }
const a = ROT * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
for (let i = 0; i < pos.length; i += 3) { const x = pos[i], z = pos[i + 2]; pos[i] = x * ca + z * sa; pos[i + 2] = -x * sa + z * ca; }

// LEVEL=1: the bake's own levelling (tools/bake-frogpose.mjs analyse step 1): a least-squares line through the trunk, rotated about x until flat
if (process.env.LEVEL) {
  let sz = 0, sy = 0, szz = 0, szy = 0, m = 0;
  for (let i = 0; i < pos.length; i += 3) { const x = pos[i], y = pos[i + 1], z = pos[i + 2]; if (Math.abs(x) < 0.2 && z > -0.2 && z < 0.6) { sz += z; sy += y; szz += z * z; szy += z * y; m++; } }
  const b = (m * szy - sz * sy) / (m * szz - sz * sz), th = Math.atan(b), c = Math.cos(th), s = Math.sin(th);
  for (let i = 0; i < pos.length; i += 3) { const y = pos[i + 1], z = pos[i + 2]; pos[i + 1] = y * c - z * s; pos[i + 2] = y * s + z * c; }
  console.log('levelled by', (th * 180 / Math.PI).toFixed(1), 'deg');
}
const n = pos.length / 3, adj = Array.from({ length: n }, () => []);
for (let t = 0; t < idx.length; t += 3) for (let k = 0; k < 3; k++) { const u = idx[t + k], v = idx[t + (k + 1) % 3]; const d = Math.hypot(pos[u*3]-pos[v*3], pos[u*3+1]-pos[v*3+1], pos[u*3+2]-pos[v*3+2]); adj[u].push([v, d]); adj[v].push([u, d]); }
function geod(src) { const D = new Float64Array(n).fill(1e9); D[src] = 0; const h = [[0, src]]; // simple binary heap
  const push = (x) => { h.push(x); let i = h.length - 1; while (i > 0) { const q = (i - 1) >> 1; if (h[q][0] <= h[i][0]) break; [h[q], h[i]] = [h[i], h[q]]; i = q; } };
  const pop = () => { const top = h[0], last = h.pop(); if (h.length) { h[0] = last; let i = 0; for (;;) { let l = 2*i+1, r = l+1, m = i; if (l < h.length && h[l][0] < h[m][0]) m = l; if (r < h.length && h[r][0] < h[m][0]) m = r; if (m === i) break; [h[m], h[i]] = [h[i], h[m]]; i = m; } } return top; };
  while (h.length) { const [d, u] = pop(); if (d > D[u]) continue; for (const [v, w] of adj[u]) if (d + w < D[v]) { D[v] = d + w; push([D[v], v]); } } return D; }
const near = (q) => { let b = 0, bd = 1e9; for (let i = 0; i < n; i++) { const d = Math.hypot(pos[i*3]-q[0], pos[i*3+1]-q[1], pos[i*3+2]-q[2]); if (d < bd) { bd = d; b = i; } } return b; };
// a limb: the vertices whose geodesic distance from `tip` is below `reach` and which lie in the box; bins by distance from the tip
const jobs = JSON.parse(process.env.LIMBS);
for (const [name, tip, box, step] of jobs) {
  const s = near(tip), D = geod(s), bins = new Map();
  for (let i = 0; i < n; i++) { const x = pos[i*3], y = pos[i*3+1], z = pos[i*3+2]; if (x < box[0] || x > box[1] || y < box[2] || y > box[3] || z < box[4] || z > box[5]) continue; const b = Math.floor(D[i] / step); const e = bins.get(b) ?? [0, 0, 0, 0, 1e9, -1e9]; e[0] += x; e[1] += y; e[2] += z; e[3]++; bins.set(b, e); }
  console.log(name, 'tip', tip.join(','), ':', [...bins.keys()].sort((a, b) => a - b).map((b) => { const e = bins.get(b); return `${(b * step).toFixed(2)}:[${(e[0]/e[3]).toFixed(2)},${(e[1]/e[3]).toFixed(2)},${(e[2]/e[3]).toFixed(2)}]n${e[3]}`; }).join(' '));
}
// TRUNK=1: the trunk's sections along z (|x| < 0.2): lowest and highest y, widest x
if (process.env.TRUNK) for (let z = -0.5; z <= 1.0; z += 0.1) { let y0 = 1e9, y1 = -1e9, xw = 0, c = 0; for (let i = 0; i < n; i++) { const q = pos[i * 3 + 2]; if (q < z || q >= z + 0.1 || Math.abs(pos[i * 3]) > 0.3) continue; y0 = Math.min(y0, pos[i * 3 + 1]); y1 = Math.max(y1, pos[i * 3 + 1]); xw = Math.max(xw, Math.abs(pos[i * 3])); c++; } console.log('z', z.toFixed(1), 'y', y0.toFixed(2), y1.toFixed(2), 'xmax', xw.toFixed(2), 'n', c); }
// EYES=1: the eye bumps: the highest vertices of the head on each side
if (process.env.EYES) for (const sgn of [1, -1]) {
  let top = -1e9; for (let i = 0; i < n; i++) { const x = pos[i * 3] * sgn, z = pos[i * 3 + 2]; if (x > 0.03 && x < 0.2 && z > 0.55 && z < 0.95) top = Math.max(top, pos[i * 3 + 1]); }
  let c = [0, 0, 0, 0], lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (let i = 0; i < n; i++) { const x = pos[i * 3] * sgn, y = pos[i * 3 + 1], z = pos[i * 3 + 2]; if (x > 0.03 && x < 0.2 && z > 0.55 && z < 0.95 && y > top - 0.06) { c[0] += pos[i*3]; c[1] += y; c[2] += z; c[3]++; for (const [k, v] of [[0, pos[i*3]], [1, y], [2, z]]) { lo[k] = Math.min(lo[k], v); hi[k] = Math.max(hi[k], v); } } }
  console.log('eye', sgn > 0 ? 'R' : 'L', 'top y', top.toFixed(3), 'bump centroid', [c[0] / c[3], c[1] / c[3], c[2] / c[3]].map((v) => v.toFixed(3)).join(','), 'extent', lo.map((v, k) => (hi[k] - v).toFixed(3)).join(','), 'n', c[3]);
}
