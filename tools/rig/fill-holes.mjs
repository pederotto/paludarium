// Closes the openings in a body's skin (the common frog, 7 Oct 2026: the owner's model has three, kept through every step since: one 1.3 cm across under the right
// side of the chest, between the throat and the arm, where the owner saw "a transparent hole"; and two pinholes on the left shoulder and the back). Each opening's rim
// (edges used by one triangle only, vertices welded by position) gets a patch: the rim laid flat as seen from outside (across its mean normal; edge-on across its
// flattest direction if that crosses itself), cut into triangles (ear clipping), refined with inner points as fine as the rim's own edges (Delaunay flips), then faired (the patch's inner points moved to make the skin's bending as even as it can across the rim: least squares of the umbrella Laplacian over the
// patch, its rim and one ring beyond, all but the patch held). No vertex of the body moves; the rim's normals take in the patch's faces. A new vertex's other data
// (skin weights, the jaw, hyoid and tongue weights, the painter's fields, colour, _ORIG) is the rim's, by inverse square distance in the flat layout; the skin
// weights keep their four largest bones.
//   node tools/rig/fill-holes.mjs <in.glb> <out.glb> [--max-rim 8]      (in: a mouth file, tools/rig/frogmouth-finish.mjs's input; the .jaw.json and .arms.json beside
//                                                                          it are not touched: copy them; writes <out.glb>.fill.json, the new vertices for fill-colour.mjs)
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { Earcut } from 'three/src/extras/Earcut.js';
await MeshoptDecoder.ready;
const args = process.argv.slice(2), [IN, OUT] = args, opt = (k, d) => (args.includes(k) ? +args[args.indexOf(k) + 1] : d), MAXRIM = opt('--max-rim', 8);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(IN), prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
const A = {}; for (const s of prim.listSemantics()) { const acc = prim.getAttribute(s), c = acc.getElementSize(), n = acc.getCount(), o = new Float64Array(n * c), e = []; for (let i = 0; i < n; i++) { acc.getElement(i, e); for (let k = 0; k < c; k++) o[i * c + k] = e[k]; } A[s] = { c, o, acc }; }
const P = A.POSITION.o, n0 = P.length / 3, I0 = Array.from(prim.getIndices().getArray());
// welded by position
const key = new Map(), canon = new Int32Array(n0);
for (let i = 0; i < n0; i++) { const k = `${Math.round(P[i * 3] * 1e7)},${Math.round(P[i * 3 + 1] * 1e7)},${Math.round(P[i * 3 + 2] * 1e7)}`; if (!key.has(k)) key.set(k, i); canon[i] = key.get(k); }
const ek = (a, b) => (a < b ? a * 4194304 + b : b * 4194304 + a), cnt = new Map(), count = () => { cnt.clear(); for (let t = 0; t < I0.length; t += 3) for (let j = 0; j < 3; j++) { const u = canon[I0[t + j]], v = canon[I0[t + (j + 1) % 3]]; cnt.set(ek(u, v), (cnt.get(ek(u, v)) ?? 0) + 1); } };
count();
// (a loose face, none of its edges shared, is a stray of the scan, not skin: the owner's model has one lying in the slit on the left shoulder, joined only at one
// corner; it goes, and the slit round it is closed like any other opening)
const loose = []; for (let t = 0; t < I0.length; t += 3) if ([0, 1, 2].every((j) => cnt.get(ek(canon[I0[t + j]], canon[I0[t + (j + 1) % 3]])) === 1)) loose.push(t);
for (const t of loose.reverse()) I0.splice(t, 3);
count();
// the rims, run against the faces' winding (so a patch face over rim edge v->u is wound as the body's): rim edge v -> u for each face edge u -> v used once; the
// vertex the face itself uses at each end
const out = new Map();
for (let t = 0; t < I0.length; t += 3) for (let j = 0; j < 3; j++) { const iu = I0[t + j], iv = I0[t + (j + 1) % 3], u = canon[iu], v = canon[iv]; if (cnt.get(ek(u, v)) !== 1) continue; (out.get(v) ?? out.set(v, []).get(v)).push({ to: u, iv, iu, t }); }
const used = new Set(), loops = [];
for (const [s, es] of out) for (const e0 of es) {
  if (used.has(e0)) continue;
  const walk = []; let e = e0, v = s;
  while (e && !used.has(e)) { used.add(e); walk.push({ c: v, i: e.iv, t: e.t }); v = e.to; e = (out.get(v) ?? []).find((x) => !used.has(x)); }
  // (a rim through a pinch vertex, two openings touching at one point: split the closed walk at a repeated vertex into simple loops)
  const stack = [];
  for (const w of walk) { const at = stack.findIndex((q) => q.c === w.c); if (at >= 0) { loops.push(stack.splice(at)); } stack.push(w); }
  if (stack.length >= 3) loops.push(stack);
}
const pt = (i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], len = (a) => Math.hypot(a[0], a[1], a[2]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
// growing arrays: the new vertices' data and the new faces
const add = {}; for (const s in A) add[s] = [];
const faces = [];
const SCALE = 100;      // (metres -> cm, for the report)
const report = [];
for (const L of loops) {
  const m = L.length; if (m < 3) continue;
  const R = L.map((w) => w.i), RP = R.map(pt), RT = L.map((w) => w.t);
  let per = 0; for (let j = 0; j < m; j++) per += len(sub(RP[(j + 1) % m], RP[j]));
  if (per * SCALE > MAXRIM) { report.push(`rim of ${m} vertices, ${(per * SCALE).toFixed(2)} cm: longer than --max-rim, left open`); continue; }
  // the rim's plane (its principal axes), the rim drawn in it
  const c = [0, 1, 2].map((k) => RP.reduce((u, p) => u + p[k], 0) / m), C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of RP) { const d = sub(p, c); for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) C[a][b] += d[a] * d[b]; }
  // (seen from outside first: across the rim's mean normal, where a slit's two lips lie side by side; else across the rim's flattest direction)
  const nm = [0, 1, 2].map((k) => R.reduce((u, i) => u + A.NORMAL.o[i * 3 + k], 0)), nl = len(nm), ax = eig3(C);
  const planes = [nl > 1e-9 ? frame(nm.map((v) => v / nl)) : null, [ax[0], ax[1]]].filter(Boolean);
  let e0 = null, e1 = null, q = null;
  for (const [u, w] of planes) { const qq = RP.map((p) => { const d = sub(p, c); return [d[0] * u[0] + d[1] * u[1] + d[2] * u[2], d[0] * w[0] + d[1] * w[1] + d[2] * w[2]]; }); if (simple(qq)) { e0 = u; e1 = w; q = qq; break; } }
  if (!q) {
    // (a slit whose lips cross over each other from every side: the triangles of least area over the rim itself, in 3-d, each also kept from bending against the
    // body's face it meets across a rim edge (dynamic programming over the rim, Liepa's hole filling); no inner points)
    const T = dpFill(RP, RT.map((t) => faceN(t)));
    for (const f of T) faces.push(R[f[0]], R[f[1]], R[f[2]]);
    report.push({ rimVertices: m, rimCm: +(per * SCALE).toFixed(2), faces: T.length, newVertices: 0, at: c.map((v) => +(v * SCALE).toFixed(2)), how: 'least area, in 3-d' });
    continue;
  }
  const area2 = (a, b, d) => (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]);
  let sgn = 0; for (let j = 0; j < m; j++) sgn += q[j][0] * q[(j + 1) % m][1] - q[(j + 1) % m][0] * q[j][1]; sgn = Math.sign(sgn);
  // ear clipping (three's Earcut), each face wound as the rim runs (so as the body's faces beside it)
  const V2 = q.map((p) => [...p]), T = [];
  const ear = Earcut.triangulate(q.flat(), [], 2); for (let t = 0; t < ear.length; t += 3) { const f = [ear[t], ear[t + 1], ear[t + 2]]; if (Math.sign(area2(V2[f[0]], V2[f[1]], V2[f[2]])) !== sgn) f.reverse(); T.push(f); }
  // refined: the longest inner edge split at its middle while longer than the rim's edges, then Delaunay flips (the rim's own edges never change)
  const h = per / m, eKey = (a, b) => (a < b ? a + ',' + b : b + ',' + a);
  const edges = () => { const E = new Map(); T.forEach((f, ti) => { for (let j = 0; j < 3; j++) { const k = eKey(f[j], f[(j + 1) % 3]); (E.get(k) ?? E.set(k, []).get(k)).push(ti); } }); return E; };
  const d2 = (a, b) => Math.hypot(V2[a][0] - V2[b][0], V2[a][1] - V2[b][1]);
  const flip = () => { let any = true, guard = 0; while (any && guard++ < 200) { any = false; for (const [k, ts] of edges()) { if (ts.length !== 2) continue; const [a, b] = k.split(',').map(Number), f1 = T[ts[0]], f2 = T[ts[1]], o1 = f1.find((v) => v !== a && v !== b), o2 = f2.find((v) => v !== a && v !== b);
    const ang = (o, x, y) => { const u = [V2[x][0] - V2[o][0], V2[x][1] - V2[o][1]], w = [V2[y][0] - V2[o][0], V2[y][1] - V2[o][1]]; return Math.acos(Math.max(-1, Math.min(1, (u[0] * w[0] + u[1] * w[1]) / (Math.hypot(...u) * Math.hypot(...w))))); };
    if (ang(o1, a, b) + ang(o2, a, b) <= Math.PI + 1e-9) continue;
    // (the new pair wound as the old: o1 -> o2 replaces the edge; keep each face's turn the polygon's way, and skip a flip that would fold one)
    const n1 = [o1, o2, 0], n2 = [o2, o1, 0]; const i1 = f1.indexOf(o1), next1 = f1[(i1 + 1) % 3]; n1[2] = next1 === a ? a : b; n2[2] = n1[2] === a ? b : a;
    const g1 = [o1, n1[2], o2], g2 = [o2, n2[2], o1];
    if (Math.sign(area2(V2[g1[0]], V2[g1[1]], V2[g1[2]])) !== sgn || Math.sign(area2(V2[g2[0]], V2[g2[1]], V2[g2[2]])) !== sgn) continue;
    T[ts[0]] = g1; T[ts[1]] = g2; any = true; break; } } };
  flip();
  for (let guard = 0; guard < 2000; guard++) {
    let best = null, bl = 1.25 * h; for (const [k, ts] of edges()) { if (ts.length !== 2) continue; const [a, b] = k.split(',').map(Number), l = d2(a, b); if (l > bl) { bl = l; best = [a, b, ts]; } }
    if (!best) break;
    const [a, b, ts] = best, mi = V2.length; V2.push([(V2[a][0] + V2[b][0]) / 2, (V2[a][1] + V2[b][1]) / 2]);
    for (const ti of ts) { const f = T[ti], j = f.findIndex((v, k) => (v === a && f[(k + 1) % 3] === b) || (v === b && f[(k + 1) % 3] === a)), x = f[j], y = f[(j + 1) % 3], o = f[(j + 2) % 3]; T[ti] = [x, mi, o]; T.push([mi, y, o]); }
    flip();
  }
  // the new vertices: in the plane at first (faired below), their data from the rim's, by inverse square distance in the plane
  const base = n0 + add.POSITION.length / 3, idx = (j) => (j < m ? R[j] : base + j - m);
  for (const f of T) faces.push(idx(f[0]), idx(f[1]), idx(f[2]));
  const wts = []; for (let j = m; j < V2.length; j++) { const w = q.map((p) => 1 / ((p[0] - V2[j][0]) ** 2 + (p[1] - V2[j][1]) ** 2 + 1e-12)), s = w.reduce((u, v) => u + v, 0); wts.push(w.map((v) => v / s)); }
  for (const s in A) {
    if (s === '_SKIN' || s === '_SKINX') continue;
    const cc = A[s].c;
    for (let j = m; j < V2.length; j++) { if (s === 'POSITION') { const [x, y] = V2[j]; for (let k = 0; k < 3; k++) add[s].push(c[k] + x * e0[k] + y * e1[k]); continue; }
      const w = wts[j - m], v = new Array(cc).fill(0); R.forEach((i, r) => { for (let k = 0; k < cc; k++) v[k] += w[r] * A[s].o[i * cc + k]; }); add[s].push(...v); }
  }
  if (A._SKIN) for (let j = m; j < V2.length; j++) {
    const W = new Map(), w = wts[j - m];
    R.forEach((i, r) => { for (const [x, y] of [[0, 2], [1, 3]]) for (const S of [A._SKIN.o, A._SKINX.o]) { const b = Math.round(S[i * 4 + x] * 32), ww = S[i * 4 + y]; if (ww > 0) W.set(b, (W.get(b) ?? 0) + w[r] * ww); } });
    const top = [...W].sort((p, q2) => q2[1] - p[1]).slice(0, 4); while (top.length < 4) top.push([top[0][0], 0]); const sum = top.reduce((u, x) => u + x[1], 0);
    add._SKIN.push(top[0][0] / 32, top[1][0] / 32, top[0][1] / sum, top[1][1] / sum); add._SKINX.push(top[2][0] / 32, top[3][0] / 32, top[2][1] / sum, top[3][1] / sum);
  }
  const ext = [Math.max(...q.map((p) => p[0])) - Math.min(...q.map((p) => p[0])), Math.max(...q.map((p) => p[1])) - Math.min(...q.map((p) => p[1]))];
  report.push({ rimVertices: m, rimCm: +(per * SCALE).toFixed(2), sizeCm: ext.map((v) => +(v * SCALE).toFixed(2)), faces: T.length, newVertices: V2.length - m, at: c.map((v) => +(v * SCALE).toFixed(2)) });
}
// all positions together, the faces together
const nAdd = add.POSITION.length / 3, N = n0 + nAdd, X = new Float64Array(N * 3); X.set(P); X.set(add.POSITION, n0 * 3);
const F = [...I0, ...faces];
// fairing: the new vertices move to make the umbrella Laplacian small over the patch, its rim and one ring beyond (welded by position: the rim's duplicates are one)
const cn = new Int32Array(N); for (let i = 0; i < n0; i++) cn[i] = canon[i]; for (let i = n0; i < N; i++) cn[i] = i;
const nb = new Map(); for (let t = 0; t < F.length; t += 3) for (let j = 0; j < 3; j++) { const u = cn[F[t + j]], v = cn[F[t + (j + 1) % 3]]; (nb.get(u) ?? nb.set(u, new Set()).get(u)).add(v); (nb.get(v) ?? nb.set(v, new Set()).get(v)).add(u); }
const free = new Set(); for (let i = n0; i < N; i++) free.add(i);
const zone = new Set(free); for (let r = 0; r < 2; r++) for (const v of [...zone]) for (const q of nb.get(v)) zone.add(q);
const lap = (v) => { const s = nb.get(v), o = [0, 0, 0]; for (const q of s) for (let k = 0; k < 3; k++) o[k] += X[q * 3 + k] / s.size; for (let k = 0; k < 3; k++) o[k] -= X[v * 3 + k]; return o; };
for (let it = 0; it < 4000; it++) {
  const Lv = new Map(); for (const v of zone) Lv.set(v, lap(v));
  for (const i of free) { const g = Lv.get(i).map((x) => -2 * x); for (const v of nb.get(i)) { if (!Lv.has(v)) continue; const d = nb.get(v).size; for (let k = 0; k < 3; k++) g[k] += 2 * Lv.get(v)[k] / d; }
    for (let k = 0; k < 3; k++) X[i * 3 + k] -= 0.08 * g[k]; }
}
// normals: the new vertices' from their faces; the rim's take in the patch's faces (weighted by area, with their own as the faces they had)
const fn = (t) => { const a = [X[F[t] * 3], X[F[t] * 3 + 1], X[F[t] * 3 + 2]], b = [X[F[t + 1] * 3], X[F[t + 1] * 3 + 1], X[F[t + 1] * 3 + 2]], c = [X[F[t + 2] * 3], X[F[t + 2] * 3 + 1], X[F[t + 2] * 3 + 2]]; return cross(sub(b, a), sub(c, a)); };
const NRM = new Float64Array(N * 3), oldArea = new Float64Array(N);
for (let t = 0; t < F.length; t += 3) { const v = fn(t), ar = len(v); for (let j = 0; j < 3; j++) { const i = cn[F[t + j]]; if (t < I0.length) oldArea[i] += ar; else for (let k = 0; k < 3; k++) NRM[i * 3 + k] += v[k]; } }
const NR = A.NORMAL.o, newN = new Float64Array(N * 3);
for (let i = 0; i < N; i++) { const c = cn[i], o = i < n0 ? [NR[i * 3] * oldArea[c], NR[i * 3 + 1] * oldArea[c], NR[i * 3 + 2] * oldArea[c]] : [0, 0, 0], v = [o[0] + NRM[c * 3], o[1] + NRM[c * 3 + 1], o[2] + NRM[c * 3 + 2]], l = len(v) || 1;
  for (let k = 0; k < 3; k++) newN[i * 3 + k] = i < n0 && NRM[c * 3] === 0 && NRM[c * 3 + 1] === 0 && NRM[c * 3 + 2] === 0 ? NR[i * 3 + k] : v[k] / l; }
// _ORIG: a new vertex where the rim's _ORIG puts it (its own place, plus the rim's offset there)
if (A._ORIG) { const o = add._ORIG; for (let i = 0; i < nAdd; i++) for (let k = 0; k < 3; k++) o[i * 3 + k] = X[(n0 + i) * 3 + k] + (o[i * 3 + k] - add.POSITION[i * 3 + k]); }
// write
for (const s in A) {
  const c = A[s].c, arr = s === 'POSITION' ? X : s === 'NORMAL' ? newN : (() => { const o = new Float64Array(N * c); o.set(A[s].o); o.set(add[s], n0 * c); return o; })();
  const Ctor = A[s].acc.getArray().constructor, typed = new (Ctor === Float64Array ? Float32Array : Ctor)(arr.length);
  for (let i = 0; i < arr.length; i++) typed[i] = A[s].acc.getNormalized() ? arr[i] : arr[i];
  A[s].acc.setArray(Ctor === Float32Array || Ctor === Float64Array ? Float32Array.from(arr) : typed);
}
prim.getIndices().setArray(Uint32Array.from(F));
await io.write(OUT, doc);
// (the new vertices' places, for tools/rig/fill-colour.mjs: the colour bake cannot give the patch its colour, the owner's model having no skin there to take it from)
fs.writeFileSync(OUT + '.fill.json', JSON.stringify({ from: IN, positionsM: Array.from({ length: nAdd }, (_, i) => [0, 1, 2].map((k) => +X[(n0 + i) * 3 + k].toFixed(7))),
  faceCentresM: Array.from({ length: faces.length / 3 }, (_, f) => [0, 1, 2].map((k) => +((X[faces[f * 3] * 3 + k] + X[faces[f * 3 + 1] * 3 + k] + X[faces[f * 3 + 2] * 3 + k]) / 3).toFixed(7))), looseFacesRemoved: loose.length }));
for (const r of report) console.log(typeof r === 'string' ? r : JSON.stringify(r));
if (loose.length) console.log(`${loose.length} loose face(s) of the scan removed (no edge shared with the skin)`);
console.log(`${loops.length} openings, ${nAdd} vertices and ${faces.length / 3} faces added -> ${OUT}`);

// the principal axes of a 3x3 symmetric matrix, largest first (Jacobi rotations)
function eig3(M) {
  const a = M.map((r) => [...r]), v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
    if (Math.abs(a[p][q]) < 1e-18) continue;
    const th = (a[q][q] - a[p][p]) / (2 * a[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
    for (let k = 0; k < 3; k++) { const x = a[k][p], y = a[k][q]; a[k][p] = c * x - s * y; a[k][q] = s * x + c * y; }
    for (let k = 0; k < 3; k++) { const x = a[p][k], y = a[q][k]; a[p][k] = c * x - s * y; a[q][k] = s * x + c * y; }
    for (let k = 0; k < 3; k++) { const x = v[k][p], y = v[k][q]; v[k][p] = c * x - s * y; v[k][q] = s * x + c * y; }
  }
  return [0, 1, 2].sort((i, j) => a[j][j] - a[i][i]).map((i) => [v[0][i], v[1][i], v[2][i]]);
}
// a polygon (2-d, in order) that does not cross itself
function simple(q) {
  const m = q.length, cr = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < m; i++) for (let j = i + 2; j < m; j++) { if (i === 0 && j === m - 1) continue; const a = q[i], b = q[(i + 1) % m], c = q[j], d = q[(j + 1) % m];
    if (cr(a, b, c) * cr(a, b, d) < 0 && cr(c, d, a) * cr(c, d, b) < 0) return false; }
  return true;
}
// two unit vectors across n
function frame(n) { const t = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], u = [n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]], l = Math.hypot(...u), e = u.map((v) => v / l); return [e, [n[1] * e[2] - n[2] * e[1], n[2] * e[0] - n[0] * e[2], n[0] * e[1] - n[1] * e[0]]]; }
// the unit normal of body face t (by its index into the original triangles)
function faceN(t) { const a = pt(I0[t]), b = pt(I0[t + 1]), c = pt(I0[t + 2]), x = cross(sub(b, a), sub(c, a)), l = len(x) || 1; return x.map((v) => v / l); }
// the rim (points in rim order; BN[j] the body face's normal across rim edge j -> j+1) cut into triangles of least cost: each one's area, plus for each rim edge it
// has, its bend against the body face there (1 - cos, times that edge's length squared); faces wound in rim order
function dpFill(V, BN) {
  const m = V.length, W = Array.from({ length: m }, () => new Float64Array(m)), K = Array.from({ length: m }, () => new Int32Array(m).fill(-1));
  const tri = (i, k, j) => { const x = cross(sub(V[k], V[i]), sub(V[j], V[i])), ar = len(x) / 2, nn = x.map((v) => v / (2 * ar || 1)); let pen = 0;
    const bend = (e, a, b) => { const c = nn[0] * BN[e][0] + nn[1] * BN[e][1] + nn[2] * BN[e][2]; pen += (1 - c) * len(sub(V[b], V[a])) ** 2; };
    if (k === i + 1) bend(i, i, k); if (j === k + 1) bend(k, k, j); if (i === 0 && j === m - 1) bend(m - 1, j, i);
    return ar + pen; };
  for (let g = 2; g < m; g++) for (let i = 0; i + g < m; i++) { const j = i + g; let best = Infinity; for (let k = i + 1; k < j; k++) { const w = W[i][k] + W[k][j] + tri(i, k, j); if (w < best) { best = w; K[i][j] = k; } } W[i][j] = best; }
  const T = [], rec = (i, j) => { if (j - i < 2) return; const k = K[i][j]; T.push([i, k, j]); rec(i, k); rec(k, j); }; rec(0, m - 1);
  return T;
}
