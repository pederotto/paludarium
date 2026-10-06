// A limb's centreline from the mesh alone, for a scan whose limbs are apart and bent (a frog walking): geodesic distance over the surface from a root point,
// the tips (the farthest places, clustered), and per tip the vertices on its shortest path's tube cut into bands by the distance: each band's centroid is a point
// of the limb's axis; the sharp turns of that polyline are the knee and the heel, the digits' fan the foot. Prints the polylines and their turning angles.
//   SRC=redeye_walk_mesh ROT=128 LEVEL=1 PRE=40000 ROOT="0.25,-0.2,-0.3" [K=8] [BAND=0.05] [TUBE=0.22] node tools/rig/limb-axes.mjs
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
await MeshoptSimplifier.ready;
const SRC = process.env.SRC, ROT = +(process.env.ROT ?? 0), PRE = +(process.env.PRE ?? 40000), BAND = +(process.env.BAND ?? 0.05), TUBE = +(process.env.TUBE ?? 0.22), K = +(process.env.K ?? 8);
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(`art-src/raw/${SRC}.glb`); await doc.transform(weld());
const pr = doc.getRoot().listMeshes()[0].listPrimitives()[0];
let pos = Float32Array.from(pr.getAttribute('POSITION').getArray()), idx = Uint32Array.from(pr.getIndices().getArray());
if (PRE && idx.length / 3 > PRE) {
  const [out] = MeshoptSimplifier.simplify(idx, pos, 3, Math.floor(PRE * 3), 0.02, []); const [remap, count] = MeshoptSimplifier.compactMesh(out);
  const np = new Float32Array(count * 3); for (let i = 0; i < pos.length / 3; i++) if (remap[i] !== 0xffffffff) { const j = remap[i] * 3; np[j] = pos[i * 3]; np[j + 1] = pos[i * 3 + 1]; np[j + 2] = pos[i * 3 + 2]; }
  pos = np; idx = out;
}
{ const a = ROT * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a); for (let i = 0; i < pos.length; i += 3) { const x = pos[i], z = pos[i + 2]; pos[i] = x * ca + z * sa; pos[i + 2] = -x * sa + z * ca; } }
if (process.env.LEVEL) {   // (as joints-view.mjs and the bake: a line through the trunk, rotated about x until flat; the trunk window follows the scan's own centre in x)
  let cx = 0, c0 = 0; for (let i = 0; i < pos.length; i += 3) if (pos[i + 2] > -0.2 && pos[i + 2] < 0.6) { cx += pos[i]; c0++; }
  cx /= c0; let sz = 0, sy = 0, szz = 0, szy = 0, m = 0;
  for (let i = 0; i < pos.length; i += 3) { const x = pos[i] - cx, y = pos[i + 1], z = pos[i + 2]; if (Math.abs(x) < 0.2 && z > -0.2 && z < 0.6) { sz += z; sy += y; szz += z * z; szy += z * y; m++; } }
  const b = (m * szy - sz * sy) / (m * szz - sz * sz), th = Math.atan(b), c = Math.cos(th), s = Math.sin(th);
  for (let i = 0; i < pos.length; i += 3) { const y = pos[i + 1], z = pos[i + 2]; pos[i + 1] = y * c - z * s; pos[i + 2] = y * s + z * c; }
  console.log('levelled by', (th * 180 / Math.PI).toFixed(1), 'deg, trunk centre x', cx.toFixed(3));
}
const n = pos.length / 3, P = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]], dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const adj = Array.from({ length: n }, () => []);
for (let t = 0; t < idx.length; t += 3) for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) { const u = idx[t + a], v = idx[t + b], w = dist(P(u), P(v)); adj[u].push([v, w]); adj[v].push([u, w]); }
function dijkstra(src) {   // (a binary heap)
  const d = new Float64Array(n).fill(Infinity), H = [[0, src]]; d[src] = 0;
  const push = (x) => { H.push(x); let i = H.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (H[p][0] <= H[i][0]) break; [H[p], H[i]] = [H[i], H[p]]; i = p; } };
  const pop = () => { const top = H[0], last = H.pop(); if (H.length) { H[0] = last; let i = 0; for (;;) { let l = 2 * i + 1, r = l + 1, s = i; if (l < H.length && H[l][0] < H[s][0]) s = l; if (r < H.length && H[r][0] < H[s][0]) s = r; if (s === i) break; [H[s], H[i]] = [H[i], H[s]]; i = s; } } return top; };
  while (H.length) { const [du, u] = pop(); if (du > d[u]) continue; for (const [v, w] of adj[u]) if (du + w < d[v]) { d[v] = du + w; push([d[v], v]); } }
  return d;
}
const nearest = (q) => { let b = 0, bd = Infinity; for (let i = 0; i < n; i++) { const e = dist(P(i), q); if (e < bd) { bd = e; b = i; } } return b; };
const ROOT = (process.env.ROOT ?? '0,0,0').split(',').map(Number), root = nearest(ROOT), dr = dijkstra(root);
// the tips: the farthest vertices, clustered by position
const order = [...Array(n).keys()].sort((a, b) => dr[b] - dr[a]), tips = [];
for (const v of order) { if (!isFinite(dr[v])) continue; if (tips.length >= K) break; if (tips.every((t) => dist(P(t.v), P(v)) > +(process.env.SEP ?? 0.25))) tips.push({ v, d: dr[v] }); }
console.log('root', root, P(root).map((x) => x.toFixed(2)), 'tips (geodesic d, position):'); tips.forEach((t, i) => console.log(' ', i, t.d.toFixed(2), P(t.v).map((x) => x.toFixed(2)).join(',')));
// per tip: the tube round its shortest path, cut into bands of the distance from the root, each band's centroid
const ONLY = (process.env.ONLY ?? '').split(',').filter(Boolean).map(Number);
for (let ti = 0; ti < tips.length; ti++) {
  if (ONLY.length && !ONLY.includes(ti)) continue;
  const dt = dijkstra(tips[ti].v), D = tips[ti].d, bands = new Map();
  for (let i = 0; i < n; i++) if (dr[i] + dt[i] < D + TUBE) { const b = Math.floor(dr[i] / BAND), s = bands.get(b) ?? { c: [0, 0, 0], k: 0, r: 0 }; const p = P(i); s.c[0] += p[0]; s.c[1] += p[1]; s.c[2] += p[2]; s.k++; bands.set(b, s); }
  const line = [...bands.entries()].sort((a, b) => a[0] - b[0]).map(([b, s]) => ({ d: (b + 0.5) * BAND, p: s.c.map((x) => x / s.k), k: s.k }));
  // the radius of the tube at each band (mean distance of its vertices to the centroid), then the turns of the polyline over ~0.15
  const R = new Map(); for (let i = 0; i < n; i++) if (dr[i] + dt[i] < D + TUBE) { const b = Math.floor(dr[i] / BAND), s = bands.get(b); R.set(b, (R.get(b) ?? 0) + dist(P(i), s.c.map((x) => x / s.k))); }
  line.forEach((l) => { l.r = R.get(Math.round(l.d / BAND - 0.5)) / l.k; });
  const turns = line.map((l, i) => { const a = line[Math.max(0, i - 3)], c = line[Math.min(line.length - 1, i + 3)], u = [l.p[0] - a.p[0], l.p[1] - a.p[1], l.p[2] - a.p[2]], v = [c.p[0] - l.p[0], c.p[1] - l.p[1], c.p[2] - l.p[2]], lu = Math.hypot(...u), lv = Math.hypot(...v); return lu * lv < 1e-9 ? 0 : Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (lu * lv)))) * 180 / Math.PI; });
  console.log(`tip ${ti}: ${line.length} bands`);
  line.forEach((l, i) => { if (i % 2 === 0 || turns[i] > 35) console.log(`  d ${l.d.toFixed(2)}  [${l.p.map((x) => x.toFixed(2)).join(', ')}]  r ${l.r.toFixed(3)}  turn ${turns[i].toFixed(0)}`); });
}
