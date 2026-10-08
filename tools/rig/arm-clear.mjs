// The forelimbs' clearance from the rest of the body, measured exactly on the posed skin (the common frog, 7 Oct 2026; the owner: at least 0.5 mm between the
// arm and the chest and throat, no arm skin inside the body). One measure for the check (tools/rig/sit-check.mjs) and the stance fitter (tools/rig/lunge-check.mjs
// --fit-limbs), so the fitter aims at the number the check reports.
//   const C = armClear({ P0, I, dom, names, seamCm })   once per body: rest positions (cm), the triangles, each vertex's main bone, the bones' names
//   C.measure(Q, opts)                                  for posed positions Q (cm) -> { closest, bySide, nUnder, inside, pen, list }
// An arm vertex is any whose main bone is an arm, forearm or hand; the band of arm skin within seamCm of its seam with the body (measured along the skin at rest) is
// left out: there the arm's skin runs into the trunk's and the body's surface is open, so no inside or outside is meaningful. Each other arm vertex: its distance to
// the nearest point of the body's skin (every triangle not wholly the arms'), negative when it is inside the body. Inside is the body's winding number at the
// vertex (the solid angles of all its skin's triangles, over 4 pi: 1 inside, 0 outside), with the holes where the arms join capped flat. (A vote of rays along the
// three axes was tried first: near the armpit a ray leaves through the arm's open root, and the vote called skin outside the body inside; rays in 14 directions
// disagreed with it at every vertex it flagged, 7 Oct 2026.)
const ARM = ['armL', 'forearmL', 'handL', 'armR', 'forearmR', 'handR'];

export function armClear({ P0, I, dom, names, seamCm = 0.3 }) {
  const n = P0.length / 3, armB = new Set(ARM.map((k) => names.indexOf(k)).filter((b) => b >= 0));
  const rest = []; for (let t = 0; t < I.length; t += 3) if (!(armB.has(dom[I[t]]) && armB.has(dom[I[t + 1]]) && armB.has(dom[I[t + 2]]))) rest.push(I[t], I[t + 1], I[t + 2]);
  // the seam band: along the skin from the arm/body seam (positions coincide along UV seams: vertices at one place count as one)
  const adj = new Map(); for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) { const a = I[t + e], b = I[t + (e + 1) % 3]; (adj.get(a) ?? adj.set(a, new Set()).get(a)).add(b); (adj.get(b) ?? adj.set(b, new Set()).get(b)).add(a); }
  const pkey = (i) => `${Math.round(P0[i * 3] * 1e4)},${Math.round(P0[i * 3 + 1] * 1e4)},${Math.round(P0[i * 3 + 2] * 1e4)}`, same = new Map();
  for (let i = 0; i < n; i++) (same.get(pkey(i)) ?? same.set(pkey(i), []).get(pkey(i))).push(i);
  const nbrs = (i) => { const o = new Set(); for (const j of same.get(pkey(i))) for (const q of adj.get(j) ?? []) o.add(q); return o; };
  const dist = new Float32Array(n).fill(1e9), heap = [];
  for (let i = 0; i < n; i++) if (armB.has(dom[i]) && [...nbrs(i)].some((q) => !armB.has(dom[q]))) { dist[i] = 0; heap.push(i); }
  while (heap.length) { heap.sort((a, b) => dist[b] - dist[a]); const v = heap.pop(); for (const q of nbrs(v)) { if (!armB.has(dom[q])) continue; const d = dist[v] + Math.hypot(P0[v * 3] - P0[q * 3], P0[v * 3 + 1] - P0[q * 3 + 1], P0[v * 3 + 2] - P0[q * 3 + 2]); if (d < dist[q] && d < seamCm + 0.5) { dist[q] = d; heap.push(q); } } }
  const armV = []; for (let i = 0; i < n; i++) if (armB.has(dom[i]) && dist[i] >= seamCm) armV.push(i);
  // the rims of the holes the arms leave in the body's skin: edges of the body's triangles used once (by position), that an arm's triangle has too; chained into loops
  const canon = new Int32Array(n); for (const g of same.values()) for (const i of g) canon[i] = g[0];
  const dirE = new Map(), armE = new Set(), ek = (a, b) => a * 1048576 + b;
  for (let t = 0; t < rest.length; t += 3) for (let e = 0; e < 3; e++) { const a = canon[rest[t + e]], b = canon[rest[t + (e + 1) % 3]]; dirE.set(ek(a, b), (dirE.get(ek(a, b)) ?? 0) + 1); }
  for (let t = 0; t < I.length; t += 3) if (armB.has(dom[I[t]]) && armB.has(dom[I[t + 1]]) && armB.has(dom[I[t + 2]])) for (let e = 0; e < 3; e++) { const a = canon[I[t + e]], b = canon[I[t + (e + 1) % 3]]; armE.add(ek(Math.min(a, b), Math.max(a, b))); }
  const next = new Map();
  for (const [k, c] of dirE) { const a = Math.floor(k / 1048576), b = k % 1048576; if (c === 1 && !dirE.has(ek(b, a)) && armE.has(ek(Math.min(a, b), Math.max(a, b)))) next.set(a, b); }
  const loops = [], seen = new Set();
  for (const a0 of next.keys()) { if (seen.has(a0)) continue; const L = []; let a = a0; while (a != null && !seen.has(a)) { seen.add(a); L.push(a); a = next.get(a); } if (a === a0 && L.length >= 3) loops.push(L); }
  const CELL = 0.25, fl = (v) => Math.floor(v / CELL);

  function measure(Q, { side = null, where = false } = {}) {
    const V = side ? armV.filter((i) => names[dom[i]].endsWith(side)) : armV;
    // only the body's skin near the arms matters: the arms' box, 0.6 cm wider
    const lo = [9e9, 9e9, 9e9], hi = [-9e9, -9e9, -9e9];
    for (const i of V) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], Q[i * 3 + k]); hi[k] = Math.max(hi[k], Q[i * 3 + k]); }
    for (let k = 0; k < 3; k++) { lo[k] -= 0.6; hi[k] += 0.6; }
    // a 3-d grid of the near triangles (the nearest point) and, per axis, a 2-d grid of all of them across that axis (a ray along it: the parity)
    const g3 = new Map(), g2 = [new Map(), new Map(), new Map()];
    for (let t = 0; t < rest.length; t += 3) {
      const a = rest[t] * 3, b = rest[t + 1] * 3, c = rest[t + 2] * 3, tl = [0, 1, 2].map((k) => Math.min(Q[a + k], Q[b + k], Q[c + k])), th = [0, 1, 2].map((k) => Math.max(Q[a + k], Q[b + k], Q[c + k]));
      for (let ax = 0; ax < 3; ax++) { const o1 = (ax + 1) % 3, o2 = (ax + 2) % 3; if (th[o1] < lo[o1] || tl[o1] > hi[o1] || th[o2] < lo[o2] || tl[o2] > hi[o2]) continue;
        for (let u = fl(tl[o1]); u <= fl(th[o1]); u++) for (let v = fl(tl[o2]); v <= fl(th[o2]); v++) { const k = u * 65536 + v; (g2[ax].get(k) ?? g2[ax].set(k, []).get(k)).push(t); } }
      if (th[0] < lo[0] || tl[0] > hi[0] || th[1] < lo[1] || tl[1] > hi[1] || th[2] < lo[2] || tl[2] > hi[2]) continue;
      for (let x = fl(tl[0]); x <= fl(th[0]); x++) for (let y = fl(tl[1]); y <= fl(th[1]); y++) for (let z = fl(tl[2]); z <= fl(th[2]); z++) { const k = `${x},${y},${z}`; (g3.get(k) ?? g3.set(k, []).get(k)).push(t); }
    }
    const ray = (q, ax) => {      // the crossings of the ray from q along +axis with the body's skin, odd = inside
      const o1 = (ax + 1) % 3, o2 = (ax + 2) % 3; let cnt = 0;
      for (const t of g2[ax].get(fl(q[o1]) * 65536 + fl(q[o2])) ?? []) {
        const a = rest[t] * 3, b = rest[t + 1] * 3, cc = rest[t + 2] * 3;
        if (Math.max(Q[a + ax], Q[b + ax], Q[cc + ax]) < q[ax]) continue;
        const d = [0, 0, 0]; d[ax] = 1;
        const e1 = [Q[b] - Q[a], Q[b + 1] - Q[a + 1], Q[b + 2] - Q[a + 2]], e2 = [Q[cc] - Q[a], Q[cc + 1] - Q[a + 1], Q[cc + 2] - Q[a + 2]];
        const h = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]], det = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2];
        if (Math.abs(det) < 1e-12) continue;
        const f = 1 / det, s = [q[0] - Q[a], q[1] - Q[a + 1], q[2] - Q[a + 2]], u = f * (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]); if (u < 0 || u > 1) continue;
        const qq = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]], v = f * qq[ax]; if (v < 0 || u + v > 1) continue;
        if (f * (e2[0] * qq[0] + e2[1] * qq[1] + e2[2] * qq[2]) > 1e-9) cnt++;
      }
      return cnt & 1;
    };
    // the winding number: the body's skin and the caps over the arms' holes (each rim fanned from its middle, wound against the skin's own edge)
    const caps = []; for (const L of loops) { const c = [0, 0, 0]; for (const a of L) for (let k = 0; k < 3; k++) c[k] += Q[a * 3 + k] / L.length; for (let j = 0; j < L.length; j++) caps.push([L[(j + 1) % L.length], L[j], c]); }
    const P = (i) => [Q[i * 3], Q[i * 3 + 1], Q[i * 3 + 2]];
    const wind = (q) => { let w = 0; for (let t = 0; t < rest.length; t += 3) w += solid(q, P(rest[t]), P(rest[t + 1]), P(rest[t + 2])); for (const [a, b, c] of caps) w += solid(q, P(a), P(b), c); return w / (4 * Math.PI); };
    let closest = 9, at = '', nUnder = 0, pen = 0; const bySide = {}, inside = {}, list = [];
    for (const i of V) {
      const q = [Q[i * 3], Q[i * 3 + 1], Q[i * 3 + 2]], cx = fl(q[0]), cy = fl(q[1]), cz = fl(q[2]); let best = 9, bt = -1;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (const t of g3.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
        const d = ptTri(q, Q, rest[t] * 3, rest[t + 1] * 3, rest[t + 2] * 3); if (d < best) { best = d; bt = t; } }
      // (inside or out only matters near the skin; a vertex deep inside is at least near some of it, within the grid's reach, or the arm is through the body)
      const ins = best < 0.25 ? wind(q) > 0.5 : false, sd = ins ? -best : best, nm = names[dom[i]];
      if (ins) inside[nm] = (inside[nm] ?? 0) + 1;
      if (sd < 0.05) { nUnder++; pen += (0.05 - sd) ** 2; if (where) list.push({ v: i, bone: nm, sdMm: +(sd * 10).toFixed(2), against: bt >= 0 ? names[dom[rest[bt]]] : null }); }
      if (sd < closest) { closest = sd; at = nm; }
      const k = nm.slice(-1); if (sd < (bySide[k] ?? 9)) bySide[k] = sd;
    }
    return { closest, at, bySide, nUnder, inside, pen, list, checked: V.length };
  }
  return { measure, armV, seamDist: dist, rest, loops };
}

// the distance from p to triangle (a, b, c) of the flat array A (Ericson, the closest point on a triangle)
function ptTri(p, A, ia, ib, ic) {
  const a = [A[ia], A[ia + 1], A[ia + 2]], b = [A[ib], A[ib + 1], A[ib + 2]], c = [A[ic], A[ic + 1], A[ic + 2]];
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]], d = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const d1 = d(ab, ap), d2 = d(ac, ap); if (d1 <= 0 && d2 <= 0) return Math.hypot(...ap);
  const bp = [p[0] - b[0], p[1] - b[1], p[2] - b[2]], d3 = d(ab, bp), d4 = d(ac, bp); if (d3 >= 0 && d4 <= d3) return Math.hypot(...bp);
  const vc = d1 * d4 - d3 * d2; if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return Math.hypot(ap[0] - ab[0] * v, ap[1] - ab[1] * v, ap[2] - ab[2] * v); }
  const cp = [p[0] - c[0], p[1] - c[1], p[2] - c[2]], d5 = d(ab, cp), d6 = d(ac, cp); if (d6 >= 0 && d5 <= d6) return Math.hypot(...cp);
  const vb = d5 * d2 - d1 * d6; if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return Math.hypot(ap[0] - ac[0] * w, ap[1] - ac[1] * w, ap[2] - ac[2] * w); }
  const va = d3 * d6 - d5 * d4; if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return Math.hypot(p[0] - (b[0] + (c[0] - b[0]) * w), p[1] - (b[1] + (c[1] - b[1]) * w), p[2] - (b[2] + (c[2] - b[2]) * w)); }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den; return Math.hypot(p[0] - (a[0] + ab[0] * v + ac[0] * w), p[1] - (a[1] + ab[1] * v + ac[1] * w), p[2] - (a[2] + ab[2] * v + ac[2] * w));
}

// the solid angle of triangle (a, b, c) seen from p, signed by its winding (van Oosterom and Strackee)
function solid(p, a, b, c) {
  const A = [a[0] - p[0], a[1] - p[1], a[2] - p[2]], B = [b[0] - p[0], b[1] - p[1], b[2] - p[2]], C = [c[0] - p[0], c[1] - p[1], c[2] - p[2]];
  const la = Math.hypot(...A), lb = Math.hypot(...B), lc = Math.hypot(...C), d = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const det = A[0] * (B[1] * C[2] - B[2] * C[1]) - A[1] * (B[0] * C[2] - B[2] * C[0]) + A[2] * (B[0] * C[1] - B[1] * C[0]);
  return 2 * Math.atan2(det, la * lb * lc + d(A, B) * lc + d(A, C) * lb + d(B, C) * la);
}
