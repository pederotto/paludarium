// Splits a welded, single-surface animal scan into its body and its appendages (legs, claws, eye stalks), for baking a
// per-vertex rig (tools/bake-creature.mjs). Used for the vampire crab, whose scan is one closed surface.
//
//   segment(pos, idx, { thin, eyeMax, distal }) -> { part, limb, legT, body, limbs, eyes }
//
// 1. Shape diameter: from every vertex a small cone of rays goes inward to the far side of the surface; the median hit
//    distance is the local thickness. The shell is thick, legs and claws are thin (`thin`, in mesh units).
// 2. Thin vertices form connected pieces. Small pieces (< `eyeMax` vertices) are the eye stalks; the rest are limbs, but
//    limbs that touch at their bases (a crab's legs under the shell) come out as one piece.
// 3. Geodesic distance from the body along the thin surface; beyond `distal` the limbs no longer touch, so those far
//    parts are one piece per limb. Each limb's label then grows back towards the body (nearest far part by geodesic
//    distance), which splits the touching bases.
// legT is the geodesic distance from the body divided by that limb's longest distance (0 at the hip, 1 at the tip).
// part: 0 body, 1 limb, 2 eye stalk. limb: index into `limbs` or -1.

export function segment(pos, idx, { thin = 0.22, eyeMax = 150, distal = 0.15, minLimb = 20 } = {}) {
  const n = pos.length / 3;
  const nor = normals(pos, idx);
  const adj = adjacency(n, idx);
  let s = shapeDiameter(pos, idx, nor);
  for (let it = 0; it < 3; it++) {                          // a little smoothing over the mesh graph
    const o = new Float32Array(n);
    for (let i = 0; i < n; i++) { let a = s[i], c = 1; for (const j of adj[i]) { a += s[j]; c++; } o[i] = a / c; }
    s = o;
  }
  const isThin = (i) => s[i] < thin;
  const pieces = components(n, adj, isThin);
  const eye = new Uint8Array(n);
  const eyes = [];
  for (const c of pieces) if (c.length < eyeMax) { eyes.push(c); for (const i of c) eye[i] = 1; }
  const app = (i) => isThin(i) && !eye[i];
  const len = (i, j) => Math.hypot(pos[i * 3] - pos[j * 3], pos[i * 3 + 1] - pos[j * 3 + 1], pos[i * 3 + 2] - pos[j * 3 + 2]);
  const seeds = [];
  for (let i = 0; i < n; i++) if (!isThin(i)) for (const j of adj[i]) if (app(j)) { seeds.push([i, 0]); break; }
  const g = dijkstra(n, adj, len, seeds, app).d;
  const far = components(n, adj, (i) => app(i) && g[i] > distal).filter((c) => c.length >= minLimb);
  const grown = dijkstra(n, adj, len, far.flatMap((c, k) => c.map((i) => [i, k])), app);
  const part = new Uint8Array(n), limb = new Int16Array(n).fill(-1), legT = new Float32Array(n);
  const reach = new Float32Array(far.length);
  for (let i = 0; i < n; i++) {
    if (eye[i]) part[i] = 2;
    else if (app(i) && grown.src[i] >= 0) { part[i] = 1; limb[i] = grown.src[i]; reach[limb[i]] = Math.max(reach[limb[i]], g[i]); }
  }
  for (let i = 0; i < n; i++) if (limb[i] >= 0) legT[i] = Math.min(1, g[i] / reach[limb[i]]);
  // Per limb: vertex count, centroid, tip (the point farthest from the body), length.
  const limbs = far.map((_, k) => ({ k, n: 0, c: [0, 0, 0], tip: null, reach: reach[k] }));
  for (let i = 0; i < n; i++) if (limb[i] >= 0) {
    const L = limbs[limb[i]]; L.n++;
    for (let a = 0; a < 3; a++) L.c[a] += pos[i * 3 + a];
    if (!L.tip || g[i] > L.tipG) { L.tip = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]; L.tipG = g[i]; }
  }
  for (const L of limbs) L.c = L.c.map((v) => v / L.n);
  const body = [];
  for (let i = 0; i < n; i++) if (part[i] === 0) body.push(i);
  return { part, limb, legT, body, limbs, eyes, thickness: s };
}

export function normals(pos, idx) {
  const n = new Float32Array(pos.length);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const i of [a, b, c]) { n[i] += nx; n[i + 1] += ny; n[i + 2] += nz; }
  }
  for (let i = 0; i < n.length; i += 3) { const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1; n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; }
  return n;
}

function adjacency(n, idx) {
  const S = Array.from({ length: n }, () => new Set());
  for (let t = 0; t < idx.length; t += 3) for (let k = 0; k < 3; k++) { S[idx[t + k]].add(idx[t + (k + 1) % 3]); S[idx[t + k]].add(idx[t + (k + 2) % 3]); }
  return S.map((s) => [...s]);
}

function components(n, adj, pred) {
  const seen = new Uint8Array(n), out = [];
  for (let i = 0; i < n; i++) {
    if (seen[i] || !pred(i)) continue;
    const c = [i]; seen[i] = 1;
    for (let q = 0; q < c.length; q++) for (const j of adj[c[q]]) if (!seen[j] && pred(j)) { seen[j] = 1; c.push(j); }
    out.push(c);
  }
  return out;
}

// Multi-source shortest paths over the mesh edges, restricted to vertices where allow(j); src = label of the nearest seed.
function dijkstra(n, adj, len, seeds, allow) {
  const d = new Float64Array(n).fill(Infinity), src = new Int32Array(n).fill(-1), h = [];
  const push = (v, i) => { h.push([v, i]); let k = h.length - 1; while (k) { const p = (k - 1) >> 1; if (h[p][0] <= h[k][0]) break; [h[p], h[k]] = [h[k], h[p]]; k = p; } };
  const pop = () => {
    const top = h[0], last = h.pop();
    if (h.length) { h[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < h.length && h[l][0] < h[m][0]) m = l; if (r < h.length && h[r][0] < h[m][0]) m = r; if (m === k) break; [h[m], h[k]] = [h[k], h[m]]; k = m; } }
    return top;
  };
  for (const [i, lab] of seeds) { d[i] = 0; src[i] = lab; push(0, i); }
  while (h.length) {
    const [v, i] = pop();
    if (v > d[i]) continue;
    for (const j of adj[i]) { if (!allow(j)) continue; const nv = v + len(i, j); if (nv < d[j]) { d[j] = nv; src[j] = src[i]; push(nv, j); } }
  }
  return { d, src };
}

// Ray caster over a triangle mesh with a uniform grid: cast(origin, unitDir, maxDist = Infinity) -> nearest hit
// distance (Infinity if none). A few hundred thousand rays a second for ten thousand triangles.
export function rayCaster(pos, idx) {
  const n = pos.length / 3, tris = idx.length / 3, G = 24;
  const T = new Float32Array(tris * 9);
  for (let t = 0; t < tris; t++) for (let k = 0; k < 3; k++) for (let c = 0; c < 3; c++) T[t * 9 + k * 3 + c] = pos[idx[t * 3 + k] * 3 + c];
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) { mn[c] = Math.min(mn[c], pos[i * 3 + c]); mx[c] = Math.max(mx[c], pos[i * 3 + c]); }
  const cs = mx.map((v, c) => (v - mn[c]) / G + 1e-6);
  const cell = Array.from({ length: G * G * G }, () => []);
  for (let t = 0; t < tris; t++) {
    const lo = [0, 1, 2].map((c) => Math.floor((Math.min(T[t * 9 + c], T[t * 9 + 3 + c], T[t * 9 + 6 + c]) - mn[c]) / cs[c]));
    const hi = [0, 1, 2].map((c) => Math.min(G - 1, Math.floor((Math.max(T[t * 9 + c], T[t * 9 + 3 + c], T[t * 9 + 6 + c]) - mn[c]) / cs[c])));
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) cell[(x * G + y) * G + z].push(t);
  }
  const stamp = new Int32Array(tris).fill(-1);
  const step = Math.min(...cs) * 0.5;
  let ray = 0;
  return (o, d, maxDist = Infinity) => {
    ray++;
    let best = Infinity, last = -1;
    const p = [...o];
    for (let s = 0; s < 400 && s * step < maxDist + step; s++) {
      const ci = [0, 1, 2].map((c) => Math.floor((p[c] - mn[c]) / cs[c]));
      if (ci.some((v) => v < 0 || v >= G)) break;
      const id = (ci[0] * G + ci[1]) * G + ci[2];
      if (id !== last) {
        last = id;
        for (const t of cell[id]) {
          if (stamp[t] === ray) continue;
          stamp[t] = ray;
          const ax = T[t * 9], ay = T[t * 9 + 1], az = T[t * 9 + 2];
          const e1x = T[t * 9 + 3] - ax, e1y = T[t * 9 + 4] - ay, e1z = T[t * 9 + 5] - az, e2x = T[t * 9 + 6] - ax, e2y = T[t * 9 + 7] - ay, e2z = T[t * 9 + 8] - az;
          const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
          const det = e1x * px + e1y * py + e1z * pz;
          if (Math.abs(det) < 1e-12) continue;
          const inv = 1 / det, tx = o[0] - ax, ty = o[1] - ay, tz = o[2] - az;
          const u = (tx * px + ty * py + tz * pz) * inv;
          if (u < 0 || u > 1) continue;
          const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
          const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
          if (v < 0 || u + v > 1) continue;
          const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
          if (tt > 1e-4 && tt < best) best = tt;
        }
      }
      if (best < (s + 1) * step) break;
      p[0] += d[0] * step; p[1] += d[1] * step; p[2] += d[2] * step;
    }
    return best;
  };
}

// An orthonormal frame [u, w] around the unit vector N.
function frame(N) {
  const a = Math.abs(N[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  let u = [N[1] * a[2] - N[2] * a[1], N[2] * a[0] - N[0] * a[2], N[0] * a[1] - N[1] * a[0]];
  const ul = Math.hypot(...u); u = u.map((c) => c / ul);
  return [u, [N[1] * u[2] - N[2] * u[1], N[2] * u[0] - N[0] * u[2], N[0] * u[1] - N[1] * u[0]]];
}

// Median distance along seven rays (the inverted normal and a 19-degree cone around it) to the far side of the surface.
function shapeDiameter(pos, idx, nor) {
  const n = pos.length / 3, cast = rayCaster(pos, idx);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const N = [-nor[i * 3], -nor[i * 3 + 1], -nor[i * 3 + 2]];
    const o = [pos[i * 3] + N[0] * 1e-4, pos[i * 3 + 1] + N[1] * 1e-4, pos[i * 3 + 2] + N[2] * 1e-4];
    const [u, w] = frame(N);
    const ds = [];
    for (let k = 0; k < 7; k++) {
      const ang = (k * 2 * Math.PI) / 6, sp = k ? 0.35 : 0;
      let d = [0, 1, 2].map((c) => N[c] + sp * (Math.cos(ang) * u[c] + Math.sin(ang) * w[c]));
      const l = Math.hypot(...d); d = d.map((c) => c / l);
      const r = cast(o, d);
      if (r < Infinity) ds.push(r * (k ? Math.cos(Math.atan(sp)) : 1));
    }
    ds.sort((x, y) => x - y);
    out[i] = ds.length ? ds[Math.floor(ds.length / 2)] : 0;
  }
  return out;
}

// Ambient occlusion per vertex: the cosine-weighted fraction of `rays` hemisphere rays that hit the mesh within `reach`
// (0 open … 1 fully enclosed). Baked into the vertex colour, it costs nothing at run time.
export function ambientOcclusion(pos, idx, nor, { rays = 48, reach = 0.3 } = {}) {
  const n = pos.length / 3, cast = rayCaster(pos, idx);
  const out = new Float32Array(n);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const N = [nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]];
    const o = [pos[i * 3] + N[0] * 2e-3, pos[i * 3 + 1] + N[1] * 2e-3, pos[i * 3 + 2] + N[2] * 2e-3];
    const [u, w] = frame(N);
    let hit = 0;
    for (let k = 0; k < rays; k++) {
      const r = Math.sqrt((k + 0.5) / rays), a = k * golden, z = Math.sqrt(1 - r * r);   // cosine-weighted spiral
      const d = [0, 1, 2].map((c) => N[c] * z + u[c] * r * Math.cos(a) + w[c] * r * Math.sin(a));
      const t = cast(o, d, reach);
      if (t < reach) hit += 1 - t / reach * 0.5;
    }
    out[i] = hit / rays;
  }
  return out;
}
