// The panther crab's rig, baked from the owner's Meshy model (tools/bake-creature.mjs, job "panther"). The same output as
// tools/rig/crab.mjs (leg 1-4 the walking legs, 5 left claw, 6 right claw, 0 shell; legT 0 at the hip ... 1 at the tip; part) for
// render/creatures/instanced.js, but labelled by geometry instead of by thickness: the model's surface is noisy (bristles, spines), its legs
// are as thick as the claws' arms and the thin underside joins left and right legs, so the shape-diameter segmentation fused them
// (tools/rig/appendages.mjs). Its limbs fan out from the carapace, so: the carapace is an ellipse in plan view; the vertices well outside
// it (`far`) fall into 10 connected pieces, the two biggest the claws and the other eight the walking legs, front to back on each side;
// the vertices between (the limbs' roots) join the nearest piece over the surface; legT is the distance over the surface from the
// carapace, per limb. Scan units, head +z, up +y. opt: { c: [x, z] centre, rx, rz: carapace half-axes, edge, far: ellipse scales, top: a
// vertex above this height and inside 1.35 is carapace }.
const legId = (i, left) => (left ? (i % 2 ? 3 : 1) : (i % 2 ? 4 : 2));

export function pantherRig(pos, idx, opt = {}) {
  const n = pos.length / 3;
  const [cx, cz] = opt.c ?? [0, 0.07], rx = opt.rx ?? 0.345, rz = opt.rz ?? 0.295, edge = opt.edge ?? 1.06, far = opt.far ?? 1.25, top = opt.top ?? 0.08;
  const adj = Array.from({ length: n }, () => []);
  for (let t = 0; t < idx.length; t += 3) for (let k = 0; k < 3; k++) adj[idx[t + k]].push(idx[t + (k + 1) % 3], idx[t + (k + 2) % 3]);
  const rho = new Float32Array(n), out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    rho[i] = Math.hypot((pos[i * 3] - cx) / rx, (pos[i * 3 + 2] - cz) / rz);
    out[i] = rho[i] >= edge && !(pos[i * 3 + 1] > top && rho[i] < 1.35) ? 1 : 0;
  }
  const len = (i, j) => Math.hypot(pos[i * 3] - pos[j * 3], pos[i * 3 + 1] - pos[j * 3 + 1], pos[i * 3 + 2] - pos[j * 3 + 2]);
  // 1. the far pieces
  const seen = new Uint8Array(n), pieces = [];
  for (let s = 0; s < n; s++) {
    if (seen[s] || !out[s] || rho[s] < far) continue;
    const st = [s], c = []; seen[s] = 1;
    while (st.length) { const v = st.pop(); c.push(v); for (const w of adj[v]) if (!seen[w] && out[w] && rho[w] >= far) { seen[w] = 1; st.push(w); } }
    if (c.length >= (opt.minPiece ?? 40)) pieces.push(c);
  }
  // A claw piece can have swallowed the raised front leg beside it (they touch): the model is near mirror-symmetric, so a vertex of
  // it whose mirror image lies nearer the other side's legs than the other claw is a leg's.
  const cen = (c) => c.reduce((s, i) => s + pos[i * 3], 0) / c.length;
  const bigs = pieces.map((c, k) => [c.length, k]).sort((a, b) => b[0] - a[0]).slice(0, 2).map((v) => v[1]);
  if (bigs.length === 2 && cen(pieces[bigs[0]]) * cen(pieces[bigs[1]]) < 0) {
    for (const kc of bigs) {
      const other = bigs.find((k) => k !== kc), xs = cen(pieces[kc]);
      const mine = new Set(pieces[kc]), tg = [];
      pieces.forEach((c, k) => { if (k === kc) return; if (k === other) c.forEach((i) => tg.push([i, 0])); else if (cen(c) * xs < 0) c.forEach((i) => tg.push([i, 1])); });
      const legPart = [];
      for (const i of mine) {
        let best = 1e9, kind = 0;
        for (const [j, kd] of tg) { const d = (pos[i * 3] + pos[j * 3]) ** 2 + (pos[i * 3 + 1] - pos[j * 3 + 1]) ** 2 + (pos[i * 3 + 2] - pos[j * 3 + 2]) ** 2; if (d < best) { best = d; kind = kd; } }
        if (kind === 1) legPart.push(i);
      }
      if (legPart.length >= (opt.minPiece ?? 40)) { const gone = new Set(legPart); pieces[kc] = pieces[kc].filter((i) => !gone.has(i)); pieces.push(legPart); }
    }
  }
  if (pieces.length < 10 || pieces.length > 11) throw new Error(`panther rig: expected 8-9 legs and 2 claws, found ${pieces.length} pieces outside the carapace (${pieces.map((c) => c.length).join(', ')})`);
  const info = pieces.map((c, k) => ({ k, n: c.length, x: c.reduce((s, i) => s + pos[i * 3], 0) / c.length, z: c.reduce((s, i) => s + pos[i * 3 + 2], 0) / c.length }));
  const ids = new Uint8Array(pieces.length);
  const claws = [...info].sort((a, b) => b.n - a.n).slice(0, 2);
  for (const c of claws) ids[c.k] = c.x < 0 ? 5 : 6;
  if (ids.filter((v) => v === 5).length !== 1 || ids.filter((v) => v === 6).length !== 1) throw new Error('panther rig: the two biggest pieces are not one claw a side');
  for (const left of [true, false]) {
    const side = info.filter((p) => !ids[p.k] && (p.x < 0) === left).sort((a, b) => b.z - a.z);
    if (side.length < 3 || side.length > 5) throw new Error(`panther rig: ${side.length} legs on the ${left ? 'left' : 'right'}`);
    side.forEach((p, i) => { ids[p.k] = legId(i, left); });
  }
  // 2. every other outside vertex joins the nearest piece over the surface (a multi-source sweep, nearest first)
  const lab = new Int16Array(n).fill(-1), dist = new Float32Array(n).fill(Infinity), heap = [];
  const push = (d, v) => { heap.push([d, v]); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top0 = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { let m = i; for (const c of [2 * i + 1, 2 * i + 2]) if (c < heap.length && heap[c][0] < heap[m][0]) m = c; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top0; };
  pieces.forEach((c, k) => { for (const i of c) { lab[i] = k; dist[i] = 0; push(0, i); } });
  while (heap.length) { const [d, v] = pop(); if (d > dist[v]) continue; for (const w of adj[v]) if (out[w]) { const nd = d + len(v, w); if (nd < dist[w]) { dist[w] = nd; lab[w] = lab[v]; push(nd, w); } } }
  // 3. legT: the distance over the surface from the limb's root (its vertices that touch the carapace), 0 … 1 per limb
  const g = new Float32Array(n).fill(Infinity);
  for (let i = 0; i < n; i++) if (lab[i] >= 0 && adj[i].some((w) => !out[w])) { g[i] = 0; push(0, i); }
  while (heap.length) { const [d, v] = pop(); if (d > g[v]) continue; for (const w of adj[v]) if (lab[w] === lab[v] && d + len(v, w) < g[w]) { g[w] = d + len(v, w); push(g[w], w); } }
  const reach = new Float32Array(pieces.length);
  for (let i = 0; i < n; i++) if (lab[i] >= 0 && g[i] < Infinity) reach[lab[i]] = Math.max(reach[lab[i]], g[i]);
  const leg = new Uint8Array(n), legT = new Float32Array(n), part = new Array(n).fill('shell');
  for (let i = 0; i < n; i++) if (lab[i] >= 0) { leg[i] = ids[lab[i]]; legT[i] = g[i] < Infinity ? Math.min(1, g[i] / reach[lab[i]]) : 0; part[i] = leg[i] >= 5 ? 'claw' : 'leg'; }
  // The carapace's plan-view extent sets the crab's scale and centre (the scan's bounding box is set by the legs).
  const xs = [], zs = [];
  for (let i = 0; i < n; i++) if (!leg[i] && pos[i * 3 + 1] > -0.02) { xs.push(pos[i * 3]); zs.push(pos[i * 3 + 2]); }
  xs.sort((a, b) => a - b); zs.sort((a, b) => a - b);
  const q = (a, f) => a[Math.floor(f * (a.length - 1))];
  return { leg, legT, part, shell: { x0: q(xs, 0.005), x1: q(xs, 0.995), z0: q(zs, 0.005), z1: q(zs, 0.995) } };
}
