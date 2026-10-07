// A clean limb copied across the body: where one of a scan's limbs is fused to itself (the red-eye's right hind leg lies in a Z whose thigh, shin and foot are one skin) and its
// mirror image is not, the fused one is removed and the other mirrored into its place: the faces that touch the source limb (the limb's own vertices and the ring of body skin
// around them) are copied with x -> 2 mirrorX - x and their winding reversed, the faces that touch the fused limb are removed, and the two rims (the copy's, the hole's) are
// stitched with a band of triangles. Vertices are appended; none is moved.
//   graftMirror({ pos, idx, isFrom, isTo, mirrorX, normals? }) -> { pos, idx, src (new vertex -> the vertex it copies, or -1 for an old one), shift, stats }
//   isFrom(i), isTo(i): the vertices of the source limb, of the limb replaced.
import { vertexNormals } from './skeleton.mjs';

const ek = (a, b) => (a < b ? `${a},${b}` : `${b},${a}`);
function loopsOf(faces, keepEdge = null) {
  const cnt = new Map();
  for (let t = 0; t < faces.length; t += 3) for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) { const u = faces[t + a], v = faces[t + b], k = ek(u, v), e = cnt.get(k); if (e) e.n++; else cnt.set(k, { u, v, n: 1 }); }
  const adj = new Map(), E = [...cnt.values()].filter((e) => e.n === 1 && (!keepEdge || keepEdge(e.u, e.v)));
  for (const e of E) { (adj.get(e.u) ?? adj.set(e.u, []).get(e.u)).push(e); (adj.get(e.v) ?? adj.set(e.v, []).get(e.v)).push(e); }
  const used = new Set(), loops = [];
  for (const e0 of E) {
    if (used.has(e0)) continue;
    used.add(e0); const loop = [e0.u]; let cur = e0.v, guard = 0;
    while (cur !== e0.u && guard++ < 1e6) { loop.push(cur); const nx = (adj.get(cur) ?? []).find((e) => !used.has(e)); if (!nx) break; used.add(nx); cur = nx.u === cur ? nx.v : nx.u; }
    if (cur === e0.u && loop.length >= 3) loops.push(loop);
  }
  return loops.sort((a, b) => b.length - a.length);
}

export function graftMirror({ pos, idx, isFrom, isTo, mirrorX = 0 }) {
  const n = pos.length / 3, nF = idx.length / 3, inFrom = new Uint8Array(n), inTo = new Uint8Array(n);
  for (let i = 0; i < n; i++) { if (isFrom(i)) inFrom[i] = 1; if (isTo(i)) inTo[i] = 1; }
  const keep = [], patch = [], removed = [];
  for (let f = 0; f < nF; f++) {
    const a = idx[f * 3], b = idx[f * 3 + 1], c = idx[f * 3 + 2];
    const touchesTo = inTo[a] || inTo[b] || inTo[c], touchesFrom = inFrom[a] || inFrom[b] || inFrom[c];
    if (touchesTo) removed.push(a, b, c); else keep.push(a, b, c);
    if (touchesFrom && !touchesTo) patch.push(a, b, c);
  }
  // the hole's rim: edges of the kept faces that were not boundary before (one of their faces is among the removed)
  const edgeBefore = new Map(); for (let t = 0; t < idx.length; t += 3) for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) { const k = ek(idx[t + a], idx[t + b]); edgeBefore.set(k, (edgeBefore.get(k) ?? 0) + 1); }
  const holeLoops = loopsOf(keep, (u, v) => edgeBefore.get(ek(u, v)) === 2), patchLoops = loopsOf(patch);
  if (!holeLoops.length || !patchLoops.length) throw new Error(`leg graft: ${holeLoops.length} hole rims, ${patchLoops.length} patch rims`);
  const H = holeLoops[0], Pl = patchLoops[0];
  // the copy: its vertices appended, mirrored, windings reversed
  const map = new Map(), newPos = [], src = []; const add = (v) => { let k = map.get(v); if (k === undefined) { k = n + newPos.length / 3; map.set(v, k); newPos.push(2 * mirrorX - pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); src.push(v); } return k; };
  const copyF = []; for (let t = 0; t < patch.length; t += 3) copyF.push(add(patch[t]), add(patch[t + 2]), add(patch[t + 1]));
  // the copy's rim, in the copy's own indices
  const A = Pl.map((v) => map.get(v)), cen = (L, get) => [0, 1, 2].map((k) => L.reduce((s, v) => s + get(v, k), 0) / L.length);
  const getN = (v, k) => (v >= n ? newPos[(v - n) * 3 + k] : pos[v * 3 + k]);
  const cA = cen(A, getN), cH = cen(H, getN), shift = [cH[0] - cA[0], cH[1] - cA[1], cH[2] - cA[2]];
  for (let i = 0; i < newPos.length; i += 3) { newPos[i] += shift[0]; newPos[i + 1] += shift[1]; newPos[i + 2] += shift[2]; }
  // normals (outward) of the old mesh; the copy's are the mirror of its source's
  const N0 = vertexNormals(pos, idx), nrm = (v) => (v >= n ? [-N0[src[v - n] * 3], N0[src[v - n] * 3 + 1], N0[src[v - n] * 3 + 2]] : [N0[v * 3], N0[v * 3 + 1], N0[v * 3 + 2]]);
  const P = (v) => [getN(v, 0), getN(v, 1), getN(v, 2)], dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  // the stitch: both rims walked round the hip the same way (the one with the shorter total span), greedy by the shorter diagonal
  const newell = (L) => { const c = cen(L, getN); let x = 0, y = 0, z = 0; for (let i = 0; i < L.length; i++) { const p = P(L[i]), q = P(L[(i + 1) % L.length]), a = [p[0] - c[0], p[1] - c[1], p[2] - c[2]], b = [q[0] - c[0], q[1] - c[1], q[2] - c[2]]; x += a[1] * b[2] - a[2] * b[1]; y += a[2] * b[0] - a[0] * b[2]; z += a[0] * b[1] - a[1] * b[0]; } return [x, y, z]; };
  let B = H.slice(); { const nA = newell(A), nB = newell(B); if (nA[0] * nB[0] + nA[1] * nB[1] + nA[2] * nB[2] < 0) B.reverse(); }
  { let bi = 0, bd = Infinity; for (let j = 0; j < B.length; j++) { const d = dist(P(A[0]), P(B[j])); if (d < bd) { bd = d; bi = j; } } B = B.slice(bi).concat(B.slice(0, bi)); }
  const bridge = []; let i = 0, j = 0;
  while (i < A.length || j < B.length) {
    const a0 = A[i % A.length], a1 = A[(i + 1) % A.length], b0 = B[j % B.length], b1 = B[(j + 1) % B.length];
    const advA = j >= B.length || (i < A.length && dist(P(a1), P(b0)) <= dist(P(a0), P(b1)));
    const tri = advA ? [a0, a1, b0] : [a0, b1, b0];   // (a0 a1 b0 | a0 b1 b0: each wound the same way round the band; fixed against the surface normal below)
    const p0 = P(tri[0]), p1 = P(tri[1]), p2 = P(tri[2]), u = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], w = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]], q = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const rn = [0, 1, 2].map((k) => nrm(tri[0])[k] + nrm(tri[1])[k] + nrm(tri[2])[k]);
    bridge.push(...(q[0] * rn[0] + q[1] * rn[1] + q[2] * rn[2] >= 0 ? tri : [tri[0], tri[2], tri[1]]));
    if (advA) i++; else j++;
  }
  const outPos = new Float32Array(pos.length + newPos.length); outPos.set(pos); outPos.set(newPos, pos.length);
  const outIdx = Uint32Array.from([...keep, ...copyF, ...bridge]);
  return { pos: outPos, idx: outIdx, src: Int32Array.from([...new Int32Array(n).fill(-1), ...src]), shift, stats: { removedFaces: removed.length / 3, copiedFaces: copyF.length / 3, bridgeFaces: bridge.length / 3, holeRim: H.length, patchRim: A.length, shift: shift.map((v) => +v.toFixed(3)) } };
}
