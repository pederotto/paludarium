// The fused contacts of a scan cut and capped: where two parts of a scan lie against each other (the red-eye's thigh against its shin, a hand against the flank) the scan has one
// skin bridging them, and a skeleton that moves the parts apart stretches it into a membrane. A face whose vertices follow two bones is a joint's skin when the bones meet
// (parent and child, the face within `reach` radii of their joint); anywhere else it is a bridge. The bridges are removed, the hole each leaves is split into the part of its rim that
// follows each bone, and every such rim is closed by a cap of its own (ear clipping in the rim's plane, wound outward), so each part has a whole skin and a bone moves only its own.
// No vertex is added or moved; the rim vertices are returned (`pure`) to take their bone's weight alone.
//   cutSeams({ pos, idx, dom, bones, radius, reach? }) -> { idx, pure: Map(vertex -> bone), stats }
//   `pairs`: the neighbouring bones whose skin may be cut away from their joint, as 'thigh,shin' (names without the side letter); other neighbours are never cut (their skin follows the
//   bones in ragged bands, and cutting it tears the limb into pieces); bones that are not neighbours are always cut. Default (null): every neighbouring pair.
//   `force` (a Uint8Array a face): faces cut whatever the bones say (the faces a posing stretched into sheets); `skipRule`: cut only those.
//   `dom`: the bone (index into `bones`) each vertex mostly follows; `bones`: [{ name, parent, head, tail }]; `radius`: by bone name (side letter dropped if not found).
export function cutSeams({ pos, idx, dom, bones, radius, reach = 1.8, pairs = null, minPiece = 600, force = null, skipRule = false }) {
  const byName = Object.fromEntries(bones.map((b, i) => [b.name, i])), par = bones.map((b) => (b.parent != null ? byName[b.parent] ?? -1 : -1));
  const rad = bones.map((b) => radius[b.name] ?? radius[b.name.replace(/[LR]$/, '')] ?? 0.05);
  // (an arm hangs from the scapula, which hangs from the trunk: the skin of the shoulder joins the arm to the trunk itself)
  const joint = (a, b) => {
    if (par[a] === b) return bones[a].head; if (par[b] === a) return bones[b].head;
    if (/^arm/.test(bones[a].name) && par[par[a]] === b) return bones[a].head; if (/^arm/.test(bones[b].name) && par[par[b]] === a) return bones[b].head;
    return null;
  };
  const cut = new Uint8Array(idx.length / 3), cen = [0, 0, 0];
  for (let f = 0; f < cut.length; f++) {
    const v = [idx[f * 3], idx[f * 3 + 1], idx[f * 3 + 2]], d = v.map((i) => dom[i]);
    if (force && force[f]) { cut[f] = 1; continue; }
    if (skipRule || (d[0] === d[1] && d[1] === d[2])) continue;
    for (let k = 0; k < 3; k++) cen[k] = (pos[v[0] * 3 + k] + pos[v[1] * 3 + k] + pos[v[2] * 3 + k]) / 3;
    let bridge = false;
    for (const [x, y] of [[0, 1], [1, 2], [0, 2]]) {
      if (d[x] === d[y]) continue;
      const J = joint(d[x], d[y]);
      if (J && pairs) { const na = bones[d[x]].name.replace(/[LR]$/, ''), nb = bones[d[y]].name.replace(/[LR]$/, ''); if (!pairs.has(`${na},${nb}`) && !pairs.has(`${nb},${na}`)) continue; }
      if (!J || Math.hypot(cen[0] - J[0], cen[1] - J[1], cen[2] - J[2]) > reach * Math.max(rad[d[x]], rad[d[y]]) + 0.03) { bridge = true; break; }
    }
    if (bridge) cut[f] = 1;
  }
  const keep = []; let removed = 0;
  for (let f = 0; f < cut.length; f++) { if (cut[f]) removed++; else keep.push(idx[f * 3], idx[f * 3 + 1], idx[f * 3 + 2]); }
  const dirE = new Set(); for (let t = 0; t < keep.length; t += 3) for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) dirE.add(`${keep[t + a]},${keep[t + b]}`);
  // the rims: edges of the kept faces used once, joined into loops (a rim vertex has two rim edges; where more, the first unused)
  const ek = (a, b) => (a < b ? `${a},${b}` : `${b},${a}`), use = new Map();
  for (let t = 0; t < keep.length; t += 3) for (const [a, b] of [[keep[t], keep[t + 1]], [keep[t + 1], keep[t + 2]], [keep[t + 2], keep[t]]]) { const k = ek(a, b), e = use.get(k); if (e) e.n++; else use.set(k, { a, b, n: 1 }); }
  // only the rims the cut made: a rim edge with an end that had a removed face
  const touched = new Set(); for (let f = 0; f < cut.length; f++) if (cut[f]) for (let k = 0; k < 3; k++) touched.add(idx[f * 3 + k]);
  const next = new Map(); for (const e of use.values()) if (e.n === 1 && touched.has(e.a) && touched.has(e.b)) { (next.get(e.a) ?? next.set(e.a, []).get(e.a)).push(e); (next.get(e.b) ?? next.set(e.b, []).get(e.b)).push(e); }
  const loops = [], done = new Set();
  for (const [s, L] of next) {
    for (const e0 of L) {
      if (done.has(e0)) continue;
      const loop = [s]; done.add(e0); let cur = e0.a === s ? e0.b : e0.a, guard = 0;
      while (cur !== s && guard++ < 100000) { loop.push(cur); const nx = (next.get(cur) ?? []).find((e) => !done.has(e)); if (!nx) break; done.add(nx); cur = nx.a === cur ? nx.b : nx.a; }
      if (cur === s && loop.length >= 3) loops.push(loop);
    }
  }
  // each loop split into its runs of one bone, each run closed by a chord and capped
  let out = keep.slice(); const pure = new Map(); let caps = 0, tris = 0;
  for (const loop of loops) {
    // rotate so the loop starts where the bone changes
    let st = 0; for (let i = 0; i < loop.length; i++) if (dom[loop[i]] !== dom[loop[(i + loop.length - 1) % loop.length]]) { st = i; break; }
    const L = loop.slice(st).concat(loop.slice(0, st)), runs = []; let cur = [];
    for (const v of L) { if (cur.length && dom[v] !== dom[cur[0]]) { runs.push(cur); cur = []; } cur.push(v); }
    if (cur.length) runs.push(cur);
    // a rim whose bone changes at every few vertices (a knee, the skin between fingers) is one hole, capped whole; its vertices keep their own weights
    const mixed = runs.length > 3 || runs.some((r) => r.length < 3);
    const todo = mixed ? [L] : runs;
    for (const run of todo) {
      if (run.length < 3) continue;
      const cnt2 = {}; for (const v of run) cnt2[dom[v]] = (cnt2[dom[v]] ?? 0) + 1;
      const b = mixed ? +Object.entries(cnt2).sort((x, y) => y[1] - x[1])[0][0] : dom[run[0]], c = [0, 1, 2].map((k) => run.reduce((a, v) => a + pos[v * 3 + k], 0) / run.length);
      // the order: a cap runs against the kept faces along the rim (each rim edge is used once by a kept face in one direction, the cap must use the opposite one); where that says nothing,
      // the plane's normal is turned to point away from the bone's axis
      let fw = 0, bw = 0; for (let i = 0; i + 1 < run.length; i++) { if (dirE.has(`${run[i]},${run[i + 1]}`)) fw++; else if (dirE.has(`${run[i + 1]},${run[i]}`)) bw++; }
      const newell = (Q) => { let nx = 0, ny = 0, nz = 0; for (let i = 0; i < Q.length; i++) { const p = Q[i], q = Q[(i + 1) % Q.length], x0 = pos[p * 3] - c[0], y0 = pos[p * 3 + 1] - c[1], z0 = pos[p * 3 + 2] - c[2], x1 = pos[q * 3] - c[0], y1 = pos[q * 3 + 1] - c[1], z1 = pos[q * 3 + 2] - c[2]; nx += y0 * z1 - z0 * y1; ny += z0 * x1 - x0 * z1; nz += x0 * y1 - y0 * x1; } const l = Math.hypot(nx, ny, nz); return l < 1e-12 ? null : [nx / l, ny / l, nz / l]; };
      let P = fw > bw ? run.slice().reverse() : run.slice(), nn = newell(P); if (!nn) continue;
      if (fw === bw) {
        const h = bones[b].head, t = bones[b].tail, ux = t[0] - h[0], uy = t[1] - h[1], uz = t[2] - h[2], L2 = ux * ux + uy * uy + uz * uz || 1e-9, k = Math.max(0, Math.min(1, ((c[0] - h[0]) * ux + (c[1] - h[1]) * uy + (c[2] - h[2]) * uz) / L2));
        if ((c[0] - h[0] - ux * k) * nn[0] + (c[1] - h[1] - uy * k) * nn[1] + (c[2] - h[2] - uz * k) * nn[2] < 0) { P = P.reverse(); nn = nn.map((v) => -v); }
      }
      const [nx, ny, nz] = nn;
      // 2D basis in the plane (the polygon, in P's order, is counter-clockwise about its Newell normal)
      const ax = Math.abs(nx) < 0.9 ? [1, 0, 0] : [0, 1, 0], e1 = [ny * ax[2] - nz * ax[1], nz * ax[0] - nx * ax[2], nx * ax[1] - ny * ax[0]], l1 = Math.hypot(...e1), E1 = e1.map((v) => v / l1), E2 = [ny * E1[2] - nz * E1[1], nz * E1[0] - nx * E1[2], nx * E1[1] - ny * E1[0]];
      const X = P.map((v) => [(pos[v * 3] - c[0]) * E1[0] + (pos[v * 3 + 1] - c[1]) * E1[1] + (pos[v * 3 + 2] - c[2]) * E1[2], (pos[v * 3] - c[0]) * E2[0] + (pos[v * 3 + 1] - c[1]) * E2[1] + (pos[v * 3 + 2] - c[2]) * E2[2]]);
      const ids = P.map((_, i) => i), cross = (o, a, b2) => (a[0] - o[0]) * (b2[1] - o[1]) - (a[1] - o[1]) * (b2[0] - o[0]);
      const inside = (p, a, b2, c2) => { const d1 = cross(a, b2, p), d2 = cross(b2, c2, p), d3 = cross(c2, a, p); return d1 >= 0 && d2 >= 0 && d3 >= 0; };
      let guard = 0;
      while (ids.length > 3 && guard++ < 20000) {
        let ear = -1, best = Infinity;
        for (let i = 0; i < ids.length; i++) {
          const a = X[ids[(i + ids.length - 1) % ids.length]], b2 = X[ids[i]], c2 = X[ids[(i + 1) % ids.length]], ar = cross(a, b2, c2);
          if (ar <= 1e-14) continue;
          let ok = true; for (let j = 0; j < ids.length && ok; j++) { const q = ids[j]; if (q === ids[(i + ids.length - 1) % ids.length] || q === ids[i] || q === ids[(i + 1) % ids.length]) continue; if (inside(X[q], a, b2, c2)) ok = false; }
          if (ok && ar < best) { best = ar; ear = i; }
        }
        if (ear < 0) { ear = 0; let ba = Infinity; for (let i = 0; i < ids.length; i++) { const a = X[ids[(i + ids.length - 1) % ids.length]], b2 = X[ids[i]], c2 = X[ids[(i + 1) % ids.length]], ar = Math.abs(cross(a, b2, c2)); if (ar < ba) { ba = ar; ear = i; } } }
        const i0 = ids[(ear + ids.length - 1) % ids.length], i1 = ids[ear], i2 = ids[(ear + 1) % ids.length];
        out.push(P[i0], P[i1], P[i2]); tris++; ids.splice(ear, 1);
      }
      if (ids.length === 3) { out.push(P[ids[0]], P[ids[1]], P[ids[2]]); tris++; }
      if (!mixed) for (const v of run) pure.set(v, b);
      caps++;
    }
  }
  const nV = pos.length / 3;
  // the pieces of a face list (faces joined by shared vertices): a cut that tears a limb off shows as a small piece, with the bone it follows and where it is
  const pieces = (F) => {
    const uf = new Int32Array(nV).map((_, i) => i), find = (a) => { while (uf[a] !== a) { uf[a] = uf[uf[a]]; a = uf[a]; } return a; };
    for (let t = 0; t < F.length; t += 3) { const a = find(F[t]), b = find(F[t + 1]), c = find(F[t + 2]); uf[b] = a; uf[find(c)] = a; }
    const m = new Map(); for (let t = 0; t < F.length; t += 3) { const r = find(F[t]), e = m.get(r) ?? { n: 0, c: [0, 0, 0], d: {} }; e.n++; for (let k = 0; k < 3; k++) e.c[k] += pos[F[t] * 3 + k]; const nm = bones[dom[F[t]]].name; e.d[nm] = (e.d[nm] ?? 0) + 1; m.set(r, e); }
    return [...m.values()].sort((a, b) => b.n - a.n).slice(0, 8).map((e) => `${e.n} faces at [${e.c.map((v) => (v / e.n).toFixed(2))}] ${Object.entries(e.d).sort((a, b) => b[1] - a[1])[0][0]}`);
  };
  // pieces under `minPiece` faces are what the cut left of the fused sheet itself (a flap with no skin of its own to be): dropped
  let dropped = 0, final = out;
  { const uf = new Int32Array(nV).map((_, i) => i), find = (a) => { while (uf[a] !== a) { uf[a] = uf[uf[a]]; a = uf[a]; } return a; };
    for (let t = 0; t < out.length; t += 3) { const a = find(out[t]), b = find(out[t + 1]), c = find(out[t + 2]); uf[b] = a; uf[find(c)] = a; }
    const cnt = new Map(); for (let t = 0; t < out.length; t += 3) { const r = find(out[t]); cnt.set(r, (cnt.get(r) ?? 0) + 1); }
    final = []; for (let t = 0; t < out.length; t += 3) { if (cnt.get(find(out[t])) >= minPiece) final.push(out[t], out[t + 1], out[t + 2]); else dropped++; } }
  out = final;
  // the rims still open in the result (an edge used once): how many and where
  const openRims = (() => {
    const cntE = new Map(); for (let t = 0; t < out.length; t += 3) for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) { const k = ek(out[t + a], out[t + b]); const e = cntE.get(k); if (e) e.n++; else cntE.set(k, { a: out[t + a], b: out[t + b], n: 1 }); }
    const adj = new Map(); for (const e of cntE.values()) if (e.n === 1) { (adj.get(e.a) ?? adj.set(e.a, []).get(e.a)).push(e.b); (adj.get(e.b) ?? adj.set(e.b, []).get(e.b)).push(e.a); }
    const seen = new Set(), res = [];
    for (const s0 of adj.keys()) { if (seen.has(s0)) continue; const comp = [], st = [s0]; seen.add(s0); while (st.length) { const u = st.pop(); comp.push(u); for (const v of adj.get(u)) if (!seen.has(v)) { seen.add(v); st.push(v); } } res.push({ n: comp.length, c: [0, 1, 2].map((k) => (comp.reduce((a, v) => a + pos[v * 3 + k], 0) / comp.length).toFixed(2)).join(','), bones: [...new Set(comp.map((v) => bones[dom[v]].name))].join('/') }); }
    return res.sort((a, b) => b.n - a.n).slice(0, 8).map((r) => `${r.n} verts at [${r.c}] ${r.bones}`);
  })();
  return { idx: Uint32Array.from(out), pure, stats: { dropped, openRims, facesRemoved: removed, loops: loops.length, caps, capTris: tris, before: pieces(idx), pieces: pieces(out) } };
}
