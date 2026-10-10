// Helpers for rigs of models whose limbs are separate pieces (a Meshy shrimp or crayfish: each leg, claw, swimmeret strip and antenna is its
// own connected piece of mesh next to the body). Shape-diameter segmentation (tools/rig/appendages.mjs) needs a closed body; these models
// are labelled by their pieces instead, as the panther crab's rig is labelled by geometry.
//   const P = pieces(pos, idx)      -> { list: [{ v: vertex ids, tris, c: centroid, lo, hi, ext }], of: per-vertex piece index }, biggest first
//   rootAndReach(pos, idx, piece, body) -> per-vertex distance over the piece's surface from its root (the vertex nearest to `body`)
const key = (x) => x;

export function pieces(pos, idx) {
  const n = pos.length / 3, par = Int32Array.from({ length: n }, (_, i) => i);
  const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  for (let t = 0; t < idx.length; t += 3) { const a = find(idx[t]), b = find(idx[t + 1]), c = find(idx[t + 2]); par[b] = a; par[c] = a; }
  const by = new Map();
  for (let t = 0; t < idx.length; t += 3) { const r = find(idx[t]); let p = by.get(r); if (!p) by.set(r, (p = { v: new Set(), tris: 0 })); p.tris++; for (let k = 0; k < 3; k++) p.v.add(idx[t + k]); }
  const list = [...by.values()].map((p) => {
    const v = [...p.v], lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9], c = [0, 0, 0];
    for (const i of v) for (let k = 0; k < 3; k++) { const x = pos[i * 3 + k]; lo[k] = Math.min(lo[k], x); hi[k] = Math.max(hi[k], x); c[k] += x / v.length; }
    return { v, tris: p.tris, c, lo, hi, ext: hi.map((h, k) => h - lo[k]) };
  }).sort((a, b) => b.tris - a.tris);
  const of = new Int32Array(n).fill(-1);
  list.forEach((p, k) => { for (const i of p.v) of[i] = k; });
  return { list, of };
}

// Surface distance (over the triangles) from the piece's root to each of its vertices. The root is the piece's vertex nearest to the
// vertices in `near` (the body it grows from). Returns { d: Map vertex -> distance, root, reach }.
export function rootAndReach(pos, idx, piece, near) {
  const inP = new Set(piece.v), adj = new Map();
  for (const i of piece.v) adj.set(i, []);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    if (!inP.has(a)) continue;
    adj.get(a).push(b, c); adj.get(b).push(a, c); adj.get(c).push(a, b);
  }
  let root = piece.v[0], best = Infinity;
  for (const i of piece.v) for (const j of near) {
    const d = (pos[i * 3] - pos[j * 3]) ** 2 + (pos[i * 3 + 1] - pos[j * 3 + 1]) ** 2 + (pos[i * 3 + 2] - pos[j * 3 + 2]) ** 2;
    if (d < best) { best = d; root = i; }
  }
  const d = new Map([[root, 0]]), heap = [[0, root]];
  const push = (e) => { heap.push(e); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { let m = i; for (const c of [2 * i + 1, 2 * i + 2]) if (c < heap.length && heap[c][0] < heap[m][0]) m = c; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  while (heap.length) {
    const [dv, v] = pop(); if (dv > d.get(v)) continue;
    for (const w of adj.get(v)) { const nd = dv + Math.hypot(pos[v * 3] - pos[w * 3], pos[v * 3 + 1] - pos[w * 3 + 1], pos[v * 3 + 2] - pos[w * 3 + 2]); if (nd < (d.get(w) ?? Infinity)) { d.set(w, nd); push([nd, w]); } }
  }
  let reach = 0; for (const v of d.values()) reach = Math.max(reach, v);
  return { d, root, reach };
}
