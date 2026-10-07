// The fire salamander's mouth, built into the baked mesh (6 Oct, the owner: "do the mouth animation along the way too"). The scan's head is a
// closed smooth form with no mouth line, so the mouth is cut into the FINAL mesh (after the bake's simplifier, which would close a slit made
// earlier) and the lower jaw is weighted to a `jaw` bone:
//   fitMouth(P, snoutZ, cfg)   the lip surface from the mesh (a line y(z) through 38 % of the head's height down its middle band), the mouth angle
//                              (the jaw hinge) `hingeBackCm` behind the snout, the jaw bone's two joints
//   addMouth(a, spec, jawIdx)  the head cut along the lip surface from the snout to the hinge (each triangle that straddles it is split, the cut
//                              points doubled: an upper and a lower copy a hair apart), a palate and a floor pushed in from the two lips, a back wall
//                              and two seals at the hinge ends, the inside painted dark; weights: everything below the lip surface in front of the
//                              hinge moves with the jaw, blended smoothly over `blendCm` either side of the hinge
// Units: metres, the baked frame (x lateral, y up, z forward, origin at the middle of the length). `a` holds the level's arrays
// (idx, pos, nor, uv, rig, skin, skinx, col). Returns new arrays. Checked by tools/rig/firesal-jawpreview.mjs (the jaw opened by a fraction
// of its range, written as a plain GLB for the Blender head views) and tests/firesal-mouth.test.mjs.

export const MOUTH = {
  lipFrac: 0.38,         // the lip line, as a share of the head's height from its underside, along the middle band
  hingeBackCm: 2.2,      // the mouth angle behind the snout (16 cm animal: behind the eye, as in the animal)
  centerBand: 0.3,       // cm each side of the midline used to read the head's height (not the eye domes, not the cheeks)
  halfWidthCm: 1.3,      // the head's half width: nothing wider is the head (the forelegs reach z 7 cm at 2.4-3.2 cm out)
  gapCm: 0.03,           // the hairline between the two copies of a cut point (they must not weld)
  shrink: 0.55,          // the pockets' inner outline, toward the middle of the opening
  depthUpCm: 0.16, depthDownCm: 0.14,
  blendCm: 0.3,          // the jaw's weight eases in over this far either side of the hinge
  interior: [0.10, 0.025, 0.03],   // the inside of the mouth (linear colour)
  maxOpenDeg: 38,        // the widest gape (guess: salamandrids open 30-40 degrees; checked against a strike clip when one is seen)
};

const smooth = (t) => { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };

export function fitMouth(P, snoutZ, cfg = {}) {
  const m = { ...MOUTH, ...cfg }, n = P.length / 3, zH = snoutZ - m.hingeBackCm / 100, span = snoutZ - zH, NB = 9;
  const bins = Array.from({ length: NB }, () => ({ lo: Infinity, hi: -Infinity }));
  for (let i = 0; i < n; i++) {
    const z = P[i * 3 + 2];
    if (z < zH || z > snoutZ || Math.abs(P[i * 3]) > m.centerBand / 100) continue;
    const b = bins[Math.min(NB - 1, Math.floor(((snoutZ - z) / span) * NB))];
    b.lo = Math.min(b.lo, P[i * 3 + 1]); b.hi = Math.max(b.hi, P[i * 3 + 1]);
  }
  const pts = bins.map((b, k) => (b.hi > b.lo ? [snoutZ - ((k + 0.5) / NB) * span, b.lo + m.lipFrac * (b.hi - b.lo)] : null)).filter(Boolean);
  if (pts.length < 3) throw new Error('fitMouth: the head is not where the snout is');
  const mz = pts.reduce((s, p) => s + p[0], 0) / pts.length, my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  let sxy = 0, sxx = 0; for (const [z, y] of pts) { sxy += (z - mz) * (y - my); sxx += (z - mz) ** 2; }
  const slope = sxx > 0 ? sxy / sxx : 0, y0 = my - slope * mz;       // y = y0 + slope * z
  const lipY = (z) => y0 + slope * z;
  const hinge = [0, lipY(zH), zH], chin = [0, lipY(snoutZ - 0.002) - 0.0004, snoutZ - 0.002];
  return { ...m, lipY, zH, zFront: snoutZ, hinge, chin, slope, y0, lipPts: pts.length };
}

export function addMouth(a, spec, jawIdx) {
  const n = a.pos.length / 3, P = a.pos, lip = spec.lipY, zH = spec.zH, zF = spec.zFront, hw = spec.halfWidthCm / 100;
  const inHead = (i) => P[i * 3 + 2] > zH - 0.004 && Math.abs(P[i * 3]) < hw;
  const d = (i) => P[i * 3 + 1] - lip(P[i * 3 + 2]);
  const gap = spec.gapCm / 100;
  const cutEdge = new Map(), newV = [];
  let nv = n;
  const cutAt = (i, j) => {
    const key = i < j ? `${i}_${j}` : `${j}_${i}`;
    let e = cutEdge.get(key); if (e) return e;
    const di = d(i), dj = d(j), t = di / (di - dj);
    e = { x: P[i * 3] + (P[j * 3] - P[i * 3]) * t, y: P[i * 3 + 1] + (P[j * 3 + 1] - P[i * 3 + 1]) * t, z: P[i * 3 + 2] + (P[j * 3 + 2] - P[i * 3 + 2]) * t, t, i, j, src: t < 0.5 ? i : j, u: nv++, l: nv++ };
    newV.push(e); cutEdge.set(key, e); return e;
  };
  const crossZ = (i, j) => { const di = d(i), dj = d(j), t = di / (di - dj); return P[i * 3 + 2] + (P[j * 3 + 2] - P[i * 3 + 2]) * t; };
  const tris = [], segs = [];
  for (let t = 0; t < a.idx.length; t += 3) {
    const v = [a.idx[t], a.idx[t + 1], a.idx[t + 2]];
    const up = v.map((i) => d(i) >= 0);
    if ((up[0] === up[1] && up[1] === up[2]) || !v.every(inHead)) { tris.push(...v); continue; }
    // the lone vertex L (alone on its side), then the other two in the triangle's own winding
    const L = up[0] !== up[1] && up[0] !== up[2] ? 0 : up[1] !== up[0] && up[1] !== up[2] ? 1 : 2;
    const l = v[L], o1 = v[(L + 1) % 3], o2 = v[(L + 2) % 3];
    if (crossZ(l, o1) < zH || crossZ(l, o2) < zH) { tris.push(...v); continue; }
    const p1 = cutAt(l, o1), p2 = cutAt(l, o2), lUp = d(l) >= 0, X = lUp ? 'u' : 'l', Y = lUp ? 'l' : 'u';
    tris.push(l, p1[X], p2[X]);
    tris.push(p1[Y], o1, o2, p1[Y], o2, p2[Y]);
    segs.push([p1, p2]);
  }
  // the chain of cut points, snout around to the hinge's other side
  const adj = new Map();
  for (const [p, q] of segs) { (adj.get(p) ?? adj.set(p, []).get(p)).push(q); (adj.get(q) ?? adj.set(q, []).get(q)).push(p); }
  const ends = [...adj.keys()].filter((p) => adj.get(p).length === 1);
  const chain = []; let cur = ends[0] ?? [...adj.keys()][0], prev = null;
  while (cur && !chain.includes(cur)) { chain.push(cur); const nx = adj.get(cur).find((q) => q !== prev && !chain.includes(q)); prev = cur; cur = nx; }
  if (chain.length < 6) throw new Error(`addMouth: the lip cut is ${chain.length} points long (the lip surface misses the head?)`);
  // the pockets
  const zMid = (zH + zF) / 2, c = [0, lip(zMid), zMid], vtx = [];            // vtx: appended vertices that are not cut points
  const add = (x, y, z, src, kind) => { vtx.push({ x, y, z, src, kind, id: nv }); return nv++; };
  const inU = chain.map((e) => add(c[0] + (e.x - c[0]) * spec.shrink, e.y + spec.depthUpCm / 100, c[2] + (e.z - c[2]) * spec.shrink, e.src, 'U'));
  const inL = chain.map((e) => add(c[0] + (e.x - c[0]) * spec.shrink, e.y - spec.depthDownCm / 100, c[2] + (e.z - c[2]) * spec.shrink, e.src, 'L'));
  const pos = (id) => { if (id < n) return [P[id * 3], P[id * 3 + 1], P[id * 3 + 2]]; const e = id - n; return e < newV.length * 2 ? (() => { const q = newV[e >> 1]; return [q.x, q.y + (e & 1 ? -gap / 2 : gap / 2), q.z]; })() : (() => { const q = vtx[e - newV.length * 2]; return [q.x, q.y, q.z]; })(); };
  // (cut point ids: e.u = n + 2k, e.l = n + 2k + 1 in creation order, so pos() reads them back; the pockets' vertices follow)
  const wallTris = [], toward = (a1, b1, c1, centre) => {
    const A = pos(a1), B = pos(b1), C = pos(c1), nx = (B[1] - A[1]) * (C[2] - A[2]) - (B[2] - A[2]) * (C[1] - A[1]), ny = (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]), nz = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
    const g = [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3, (A[2] + B[2] + C[2]) / 3];
    return nx * (centre[0] - g[0]) + ny * (centre[1] - g[1]) + nz * (centre[2] - g[2]) >= 0 ? [a1, b1, c1] : [a1, c1, b1];
  };
  for (let k = 0; k + 1 < chain.length; k++) {
    wallTris.push(...toward(chain[k].u, chain[k + 1].u, inU[k + 1], c), ...toward(chain[k].u, inU[k + 1], inU[k], c));
    wallTris.push(...toward(chain[k].l, chain[k + 1].l, inL[k + 1], c), ...toward(chain[k].l, inL[k + 1], inL[k], c));
  }
  // the back wall: a fan around the centre of the two inner outlines, facing the snout
  const loop = [...inU, ...inL.slice().reverse()];
  let bx = 0, by = 0, bz = 0; for (const id of loop) { const p = pos(id); bx += p[0]; by += p[1]; bz += p[2]; }
  const cb = add(bx / loop.length, by / loop.length, bz / loop.length, vtx[0].src, 'B');
  const front = [0, c[1], zF + 0.05];
  for (let k = 0; k < loop.length; k++) wallTris.push(...toward(cb, loop[k], loop[(k + 1) % loop.length], front));
  // the seals at the hinge ends
  for (const k of [0, chain.length - 1]) wallTris.push(...toward(chain[k].u, chain[k].l, inL[k], c), ...toward(chain[k].u, inL[k], inU[k], c));
  // arrays
  const N = nv, out = { idx: Uint32Array.from([...tris, ...wallTris]) };
  const grow = (arr, w) => { const o = new Float32Array(N * w); o.set(arr); return o; };
  out.pos = grow(a.pos, 3); out.nor = grow(a.nor, 3); out.uv = grow(a.uv, 2); out.rig = grow(a.rig, 4); out.skin = grow(a.skin, 4); out.skinx = grow(a.skinx, 4);
  if (a.col) out.col = grow(a.col, 3);
  const copy = (to, from) => { for (const [arr, w] of [[out.nor, 3], [out.uv, 2], [out.rig, 4], [out.skin, 4], [out.skinx, 4], ...(out.col ? [[out.col, 3]] : [])]) for (let q = 0; q < w; q++) arr[to * w + q] = arr[from * w + q]; };
  newV.forEach((e, k) => { for (const [id, dy] of [[n + 2 * k, gap / 2], [n + 2 * k + 1, -gap / 2]]) { out.pos[id * 3] = e.x; out.pos[id * 3 + 1] = e.y + dy; out.pos[id * 3 + 2] = e.z; copy(id, e.src); } });
  for (const v of vtx) { out.pos[v.id * 3] = v.x; out.pos[v.id * 3 + 1] = v.y; out.pos[v.id * 3 + 2] = v.z; copy(v.id, v.src); if (out.col) for (let q = 0; q < 3; q++) out.col[v.id * 3 + q] = spec.interior[q]; }
  // normals of the inside faces (the cut points keep the skin's), from the oriented wall triangles
  const nacc = new Float32Array(N * 3), inside = new Uint8Array(N); for (const v of vtx) inside[v.id] = 1;
  for (let t = 0; t < wallTris.length; t += 3) {
    const [i0, i1, i2] = [wallTris[t], wallTris[t + 1], wallTris[t + 2]], A = pos(i0), B = pos(i1), C = pos(i2);
    const nx = (B[1] - A[1]) * (C[2] - A[2]) - (B[2] - A[2]) * (C[1] - A[1]), ny = (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]), nz = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
    for (const i of [i0, i1, i2]) if (inside[i]) { nacc[i * 3] += nx; nacc[i * 3 + 1] += ny; nacc[i * 3 + 2] += nz; }
  }
  for (let i = 0; i < N; i++) if (inside[i]) { const l = Math.hypot(nacc[i * 3], nacc[i * 3 + 1], nacc[i * 3 + 2]) || 1; for (let q = 0; q < 3; q++) out.nor[i * 3 + q] = nacc[i * 3 + q] / l; }
  // the jaw's weights
  const blend = spec.blendCm / 100, wj = new Float32Array(N);
  for (let i = 0; i < n; i++) if (inHead(i) && d(i) < 0) wj[i] = smooth((P[i * 3 + 2] - (zH - blend)) / (2 * blend));
  newV.forEach((e, k) => { wj[n + 2 * k + 1] = smooth((e.z - (zH - blend)) / (2 * blend)); });
  for (const v of vtx) wj[v.id] = v.kind === 'L' ? smooth((v.z - (zH - blend)) / (2 * blend)) : v.kind === 'B' ? 0.5 : 0;
  let moved = 0;
  for (let i = 0; i < N; i++) {
    const w = wj[i]; if (w <= 0.001) continue; moved++;
    const bw = new Map();
    for (const [arr] of [[out.skin], [out.skinx]]) for (const o of [0, 1]) { const b = Math.round(arr[i * 4 + o] * 32), q = arr[i * 4 + 2 + o]; if (q > 0) bw.set(b, (bw.get(b) ?? 0) + q * (1 - w)); }
    bw.set(jawIdx, (bw.get(jawIdx) ?? 0) + w);
    const top = [...bw.entries()].sort((p, q) => q[1] - p[1] || p[0] - q[0]).slice(0, 4), s = top.reduce((x, y) => x + y[1], 0) || 1;
    while (top.length < 4) top.push([top[0][0], 0]);
    out.skin[i * 4] = top[0][0] / 32; out.skin[i * 4 + 1] = top[1][0] / 32; out.skin[i * 4 + 2] = top[0][1] / s; out.skin[i * 4 + 3] = top[1][1] / s;
    out.skinx[i * 4] = top[2][0] / 32; out.skinx[i * 4 + 1] = top[3][0] / 32; out.skinx[i * 4 + 2] = top[2][1] / s; out.skinx[i * 4 + 3] = top[3][1] / s;
  }
  out.info = { cutPoints: chain.length, newVerts: N - n, wallTris: wallTris.length / 3, jawVerts: moved, hinge: spec.hinge, chin: spec.chin };
  out.jawWeight = wj;
  return out;
}
