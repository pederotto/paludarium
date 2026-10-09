// The forelimbs brought to the species' proportions by cutting, done on the file's own triangles (the common frog, 7 Oct 2026; the owner's targets for a ranid at
// SVL 7 cm: humerus 1.45 cm, radioulna 1.25 cm, hand 1.30 cm). A warp along the bone folded 281 faces and was reverted; a Blender cut changed the whole body on the way
// through (its importer merged vertices and dropped faces: 51 folded faces became 103 with nothing cut). Here every triangle and vertex away from the cuts is kept as it is.
// In the body's swimming pose (the bind pose: the arms out from the body, touching nothing):
//   upper arm, forearm   the triangles crossing two planes across the segment split on them, the band between removed (found by flooding the arm's surface between
//                        the two cut lines, so it is the arm's band whatever its shape), everything beyond it moved back along the bone by its length, the two rims
//                        stitched with triangles wound as the faces they close: the segment keeps its own cross-sections, only shorter
//   hand                 scaled evenly about the wrist; the last 80 % of the forearm scaled about the wrist too, by a factor easing from 1 to the hand's
// A vertex made by a split takes the interpolated position, normal, UV and colour, and every other attribute (bone indices and weights: _SKIN, _SKINX, _RIG, ...)
// from the nearer end of its edge: interpolating bone indices would name other bones. The slab's middle is tried half way along the segment, then further toward the
// far joint, until the band is the arm's alone (near the body a skin fold of the scan joins the arm to the flank).
//   node tools/rig/arm-slab.mjs <in.glb> <out.glb> <manifest.json> [--id commonfrog.swim] [--upper 1.45] [--fore 1.25] [--hand 1.30] [--slabs <other>.arms.json]   (--hand 0: hands untouched)
// Writes <out.glb> and <out.glb>.arms.json: the new joints (cm, baked frame) for tools/rig/frogmouth-finish.mjs --arms, the lengths, and where each slab was.
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
await MeshoptDecoder.ready; await MeshoptEncoder.ready;
const args = process.argv.slice(2), [IN, OUT, MAN] = args, opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const FIXED = opt('--slabs', null) ? JSON.parse(fs.readFileSync(opt('--slabs'), 'utf8')) : null;
// how alike two rims must be round (their shapes' RMS difference over their mean size): an arm's own section varies 5-10 % from one place to the next
// (the defaults: the settings that left no new folded face on the common frog, 7 Oct 2026: tools/rig/fold-diff.mjs; RAMP: the share of the forearm the wrist's
// easing spans: over 0.6 or less one crease face at the wrist turned edge-on)
const MIS_ONE = +opt('--mis', 0.16), MIS_REST = +opt('--mis-rest', 0.12), ON = 1e-3, MIN_T1 = +opt('--min-t1', 0.9), RAMP = +opt('--ramp', 0.8);      // (MIN_T1: the nearest an upper arm's cut may come to the shoulder: clear of the armpit's fold)
const ID = opt('--id', 'commonfrog.swim'), TGT = [+opt('--upper', 1.45), +opt('--fore', 1.25), +opt('--hand', 1.3)], GAP = +opt('--gap', 0.04);      // (GAP: the stitch's own length)
const bones = Object.fromEntries(JSON.parse(fs.readFileSync(MAN, 'utf8'))[ID].skeleton.bones.map((b) => [b.name, b]));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(IN), node = doc.getRoot().listNodes().find((x) => x.getMesh()), prim = node.getMesh().listPrimitives()[0];
const MW = node.getWorldMatrix();
if (Math.abs(MW[1]) + Math.abs(MW[2]) + Math.abs(MW[4]) + Math.abs(MW[6]) + Math.abs(MW[8]) + Math.abs(MW[9]) > 1e-9) throw new Error('a rotated node: not handled');      // (a quantized game file has a scale and offset on its node: positions are taken into the world, and written there with an identity node)

// --- the mesh as plain arrays (positions in cm) -------------------------------------------------------------------------------------------------------------------
const names = prim.listSemantics(), A = {};
for (const nm of names) { const a = prim.getAttribute(nm), n = a.getCount(), c = a.getElementSize(), e = [], arr = []; for (let i = 0; i < n; i++) { a.getElement(i, e); arr.push([...e]); } A[nm] = { c, arr, type: a.getType(), norm: a.getNormalized(), ct: a.getComponentType() }; }
const P = A.POSITION.arr.map((e) => [0, 1, 2].map((r) => (MW[r] * e[0] + MW[4 + r] * e[1] + MW[8 + r] * e[2] + MW[12 + r]) * 100));
// each vertex's place before any cut (cm): written as _ORIG, so the colour can be baked from the uncut body onto the cut one's new layout (frogmouth-finish.mjs --plain)
const O = P.map((p) => [...p]);
let T = []; { const I = prim.getIndices().getArray(); for (let t = 0; t < I.length; t += 3) T.push([I[t], I[t + 1], I[t + 2]]); }
const LERP = new Set(['POSITION', 'NORMAL', 'TEXCOORD_0', 'TEXCOORD_1', 'COLOR_0']);
const newVert = (a, b, f) => {                                  // a vertex on edge a-b at fraction f from a
  const i = P.length;
  P.push(P[a].map((v, k) => v + (P[b][k] - v) * f)); O.push(O[a].map((v, k) => v + (O[b][k] - v) * f));
  for (const nm of names) {
    if (nm === 'POSITION') continue;
    const src = A[nm].arr;
    if (LERP.has(nm)) { let v = src[a].map((x, k) => x + (src[b][k] - x) * f); if (nm === 'NORMAL') { const l = Math.hypot(...v) || 1; v = v.map((x) => x / l); } src.push(v); }
    else src.push([...src[f < 0.5 ? a : b]]);
  }
  return i;
};
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], len = (a) => Math.hypot(...a);
const addS = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
// welded ids by position, for the topology only (a GLB splits vertices along UV seams)
const wkey = (p) => p.map((v) => Math.round(v * 1e4)).join(',');
let W = [], wmap = new Map();
const weld = () => { wmap = new Map(); W = P.map((p) => { const k = wkey(p); if (!wmap.has(k)) wmap.set(k, wmap.size); return wmap.get(k); }); };

const segParam = (p, a, b) => { const d = sub(b, a), L = len(d), u = d.map((v) => v / L), t = dot(sub(p, a), u), tc = Math.max(0, Math.min(L, t)); return { t, dist: len(sub(p, addS(a, u, tc))), L, u }; };
const nearestSeg = (p, chain) => { let best = null; for (let k = 0; k < chain.length - 1; k++) { const s = segParam(p, chain[k], chain[k + 1]); if (!best || s.dist < best.dist) best = { k, ...s }; } return best; };

// split the triangles the plane crosses along the whole line it draws on the surface, starting at the arm (`seedOk`: a crossing triangle by the arm's bone): a line
// split only part of the way would leave T-junctions, open edges, where a split triangle meets an unsplit one
function splitPlane(c, u, seedOk) {
  // (a vertex within ON cm of the plane counts as on it, unmoved: the line passes through it; split beside it, a sliver would be left)
  const d = P.map((p) => { const v = dot(sub(p, c), u); return Math.abs(v) < ON ? 0 : v; }), cache = new Map(), out = [];
  const crosses = (tri) => { const s = tri.map((i) => Math.sign(d[i])); return s.includes(1) && s.includes(-1); };
  weld();
  const byV = new Map(); T.forEach((tri, ti) => { if (crosses(tri)) for (const i of tri) (byV.get(W[i]) ?? byV.set(W[i], []).get(W[i])).push(ti); });
  const pick = new Set(), st = [];
  T.forEach((tri, ti) => { if (crosses(tri) && seedOk(tri)) { pick.add(ti); st.push(ti); } });
  while (st.length) { const ti = st.pop(); for (const i of T[ti]) for (const tj of byV.get(W[i]) ?? []) if (!pick.has(tj)) { pick.add(tj); st.push(tj); } }
  const cross = (a, b) => { const k = a + ',' + b; if (!cache.has(k)) { const i = newVert(a, b, d[a] / (d[a] - d[b])); cache.set(k, i); cache.set(b + ',' + a, i); d.push(0); } return cache.get(k); };
  T.forEach((tri, ti) => {
    if (!pick.has(ti)) { out.push(tri); return; }
    const s = tri.map((i) => Math.sign(d[i]));
    // rotate so the vertex on the plane (or the lone one) comes first, keeping the winding
    let r = [0, 1, 2].find((k) => s[k] === 0);
    if (r !== undefined) { const [a, b, c2] = [tri[r], tri[(r + 1) % 3], tri[(r + 2) % 3]], x = cross(b, c2); out.push([a, b, x], [a, x, c2]); return; }
    r = [0, 1, 2].find((k) => s[k] !== s[(k + 1) % 3] && s[k] !== s[(k + 2) % 3]);
    const [a, b, c2] = [tri[r], tri[(r + 1) % 3], tri[(r + 2) % 3]], x = cross(a, b), y = cross(a, c2);
    out.push([a, x, y], [x, b, c2], [x, c2, y]);
  });
  T = out; return pick.size;
}

const report = [], arms = {}, REJ = [], RENORM = new Set();      // (RENORM: vertices whose surround the cut changed: their normals are made again from it)
// the best place for a slab of length D (rims most alike round), or null; each try undone
function bestSlab(chain, k, a, u, L, D, sideNm, reachMax) {
  const tries = [];
  if (FIXED) tries.push(...FIXED[sideNm].slabs.filter((q) => q.seg === k && Math.abs(q.D - D) < 1e-3).map((q) => q.t1));
  else for (let t1_ = k === 0 ? MIN_T1 : 0.3; t1_ + D + GAP <= L - 0.15 + 1e-9; t1_ += 0.02) tries.push(t1_);
  let best = null;
  for (const t1 of tries) {
    const save = { P: P.map((p) => p), O: O.length, T: T.map((t) => t), attrs: Object.fromEntries(names.map((nm) => [nm, A[nm].arr.length])) };
    const res = tryCut(chain, k, a, u, L, D, t1, t1 + D + GAP, sideNm, true, reachMax);
    P.length = save.P.length; for (let i = 0; i < P.length; i++) P[i] = save.P[i]; O.length = save.O; T = save.T; for (const nm of names) A[nm].arr.length = save.attrs[nm];
    if (res && (!best || res.mis < best.mis)) best = { t1, mis: res.mis };
  }
  return best;
}

// A segment shortened to `target`: one slab where its rims match (MIS_ONE); else the longest slab the even stretch of the arm allows (MIS_ONE), then the rest where
// alike rims can be found (MIS_REST, wider rings allowed: the elbow's bulge is still the arm alone, which the cut proves)
function cut(chain, k, target, sideNm) {
  const a = chain[k], b = chain[k + 1], { L, u } = segParam(b, a, b), D = L - target;
  if (D <= 0.01) { report.push(`${sideNm} seg ${k}: ${L.toFixed(2)} cm, no cut`); return { chain, far: new Set() }; }
  const run = (ch, Dp, reachMax, why) => { const s0 = segParam(ch[k + 1], ch[k], ch[k + 1]), best = bestSlab(ch, k, ch[k], s0.u, s0.L, Dp, sideNm, reachMax);
    if (!best) return null; report.push(`${sideNm} seg ${k}: ${why} slab ${Dp.toFixed(2)} cm at ${best.t1.toFixed(2)} cm (rims ${(best.mis * 100).toFixed(1)} % apart round)`);
    return tryCut(ch, k, ch[k], s0.u, s0.L, Dp, best.t1, best.t1 + Dp + GAP, sideNm, false, reachMax); };
  if (FIXED) { let r = { chain }; for (const q of FIXED[sideNm].slabs.filter((q) => q.seg === k)) r = run(r.chain, q.D, 2.0, 'the given'); return r; }
  const one = bestSlab(chain, k, a, u, L, D, sideNm, 1.1);
  if (process.env.ARMDBG) console.log(`  [dbg] ${sideNm} seg ${k}: one slab ${D.toFixed(2)}: best shape ${one ? (one.mis * 100).toFixed(1) + ' % at ' + one.t1.toFixed(2) : 'none'}`);
  if (one && one.mis <= MIS_ONE) return run(chain, D, 1.1, 'one');
  for (let D1 = Math.floor((D - 0.05) * 20) / 20; D1 >= 0.15; D1 -= 0.05) {
    const b1 = bestSlab(chain, k, a, u, L, D1, sideNm, 1.1);
    if (process.env.ARMDBG) console.log(`  [dbg] ${sideNm} seg ${k}: slab ${D1.toFixed(2)}: best shape ${b1 ? (b1.mis * 100).toFixed(1) + ' % at ' + b1.t1.toFixed(2) : 'none'}`);
    if (!b1 || b1.mis > MIS_ONE) continue;
    const r1 = run(chain, D1, 1.1, 'the even stretch\'s'), D2 = D - D1;
    const s1 = segParam(r1.chain[k + 1], r1.chain[k], r1.chain[k + 1]), b2 = bestSlab(r1.chain, k, r1.chain[k], s1.u, s1.L, D2, sideNm, 1.6);
    if (b2 && b2.mis <= MIS_REST) return run(r1.chain, D2, 1.6, 'the rest\'s');
    report.push(`${sideNm} seg ${k}: no place for the last ${D2.toFixed(2)} cm with alike rims (the best: ${b2 ? (b2.mis * 100).toFixed(1) + " % at " + b2.t1.toFixed(2) + " cm" : "none that cuts the arm alone"}): the segment is left ${D2.toFixed(2)} cm longer than asked`);
    return r1;
  }
  throw new Error(`${sideNm} seg ${k}: no slab with matching rims`);
}

function tryCut(chain, k, a, u, L, D, t1, t2, sideNm, dry = false, reachMax = 1.1) {
  const tof = (i) => dot(sub(P[i], a), u);
  for (const tp of [t1, t2]) {
    const c = addS(a, u, tp), seedOk = (tri) => tri.every((i) => segParam(P[i], a, addS(a, u, L)).dist < 1.0);
    splitPlane(c, u, seedOk);
  }
  weld();
  const on = (i, tp) => Math.abs(tof(i) - tp) < ON + 1e-6;
  const ekey = (x, y) => (W[x] < W[y] ? W[x] + ':' + W[y] : W[y] + ':' + W[x]);
  const wall = (x, y) => (on(x, t1) && on(y, t1)) || (on(x, t2) && on(y, t2));
  const byEdge = new Map(); T.forEach((tri, ti) => { for (let e = 0; e < 3; e++) { const kk = ekey(tri[e], tri[(e + 1) % 3]); (byEdge.get(kk) ?? byEdge.set(kk, []).get(kk)).push(ti); } });
  const cen = (tri) => tri.reduce((s, i) => s + tof(i), 0) / 3, mid = addS(a, u, (t1 + t2) / 2);
  let seed = -1, sd = 1e9;
  T.forEach((tri, ti) => { const c = cen(tri); if (c > t1 && c < t2) { const p = [0, 1, 2].map((q) => (P[tri[0]][q] + P[tri[1]][q] + P[tri[2]][q]) / 3), d = len(sub(p, mid)); if (d < sd) { sd = d; seed = ti; } } });
  const slab = new Set([seed]), stack = [seed];
  while (stack.length) {
    const ti = stack.pop(), tri = T[ti];
    for (let e = 0; e < 3; e++) {
      const x = tri[e], y = tri[(e + 1) % 3]; if (wall(x, y)) continue;
      for (const tj of byEdge.get(ekey(x, y))) { if (slab.has(tj)) continue; const c = cen(T[tj]); if (!(c > t1 - 1e-4 && c < t2 + 1e-4)) return null; slab.add(tj); stack.push(tj); }
    }
    if (slab.size > 30000) return null;
  }
  T = T.filter((_, ti) => !slab.has(ti));
  // the rims: welded edges used once, on either plane
  const use = new Map(), dirOf = new Map();
  for (const tri of T) for (let e = 0; e < 3; e++) { const x = tri[e], y = tri[(e + 1) % 3], kk = ekey(x, y); use.set(kk, (use.get(kk) ?? 0) + 1); dirOf.set(kk, [x, y]); }
  const rim = (tp) => [...use].filter(([kk, n]) => n === 1 && dirOf.get(kk).every((i) => on(i, tp))).map(([kk]) => dirOf.get(kk));
  const r1 = rim(t1), r2 = rim(t2);
  const ring = (edges) => { const nb = new Map(); for (const [x, y] of edges) for (const [p, q] of [[x, y], [y, x]]) (nb.get(W[p]) ?? nb.set(W[p], []).get(W[p])).push(q); return nb; };
  const R1 = ring(r1), R2 = ring(r2);
  if (![...R1.values(), ...R2.values()].every((l) => l.length === 2) || r1.length < 3 || r2.length < 3) return null;
  // both rims rings round the arm itself: none of it further than 1.1 cm from the bone (a ring through the armpit's fold reaches the flank), and alike in size
  const reach = (edges) => Math.max(...edges.flat().map((i) => { const q = sub(P[i], a); return len(addS(q, u, -dot(q, u))); }));
  const m1 = reach(r1), m2 = reach(r2);
  if (m1 > reachMax || m2 > reachMax || Math.max(r1.length, r2.length) > 2.2 * Math.min(r1.length, r2.length)) { REJ.push(`rims reach ${m1.toFixed(2)}/${m2.toFixed(2)} cm from the bone, ${r1.length}/${r2.length} edges`); return null; }
  // the piece beyond: welded vertices connected to the far rim; it must be cut off from the near one
  const adj = new Map(); for (const tri of T) for (let e = 0; e < 3; e++) { const x = W[tri[e]], y = W[tri[(e + 1) % 3]]; (adj.get(x) ?? adj.set(x, new Set()).get(x)).add(y); (adj.get(y) ?? adj.set(y, new Set()).get(y)).add(x); }
  const far = new Set(R2.keys()), st = [...far];
  while (st.length) { const v = st.pop(); for (const w of adj.get(v) ?? []) if (!far.has(w)) { far.add(w); st.push(w); } }
  if ([...R1.keys()].some((w) => far.has(w))) return null;
  // how alike the two rims are: each one's distance from its own centre across the bone at 36 angles (the farthest of its points in each sector), compared with the
  // centres laid on each other, as a fraction of their mean size (a perimeter alone let a ring with a trace of the armpit's fold pass for a round one)
  const shape = (edges) => { const vs = [...new Set(edges.flat())], c = vs.reduce((q, i) => addS(q, P[i], 1 / vs.length), [0, 0, 0]);
    let e1 = sub(P[vs[0]], c); e1 = addS(e1, u, -dot(e1, u)); const l1 = len(e1); e1 = e1.map((v) => v / l1); const e2 = [u[1] * e1[2] - u[2] * e1[1], u[2] * e1[0] - u[0] * e1[2], u[0] * e1[1] - u[1] * e1[0]];
    return { c, e1, e2, vs }; };
  const s1 = shape(r1), s2 = shape(r2), bins = (sh, e1, e2) => { const r = new Array(36).fill(0); for (const i of sh.vs) { const q = sub(P[i], sh.c), x = dot(q, e1), y = dot(q, e2), bn = Math.floor(((Math.atan2(y, x) + Math.PI) / (2 * Math.PI)) * 36) % 36; r[bn] = Math.max(r[bn], Math.hypot(x, y)); } for (let k2 = 0; k2 < 36; k2++) if (!r[k2]) r[k2] = r[(k2 + 35) % 36] || r[(k2 + 1) % 36]; return r; };
  const b1 = bins(s1, s1.e1, s1.e2), b2 = bins(s2, s1.e1, s1.e2), mr = (b1.reduce((x, y) => x + y, 0) + b2.reduce((x, y) => x + y, 0)) / 72;
  const mis = Math.sqrt(b1.reduce((x, v, k2) => x + (v - b2[k2]) ** 2, 0) / 36) / mr;
  if (dry) return { mis };
  for (let i = 0; i < P.length; i++) if (far.has(W[i])) P[i] = addS(P[i], u, -D);
  // the stitch: each rim walked in its own order, both turning the same way about the bone and started on the same side, zipped by the fraction of the way round;
  // each new triangle wound against the existing face it shares a rim edge with
  const walk = (edges) => {
    const next = new Map(); for (const [x, y] of edges) next.set(W[x], [x, y]);          // (each rim edge as the face it bounds goes along it)
    const start = edges[0][0]; const order = [start]; let cur = edges[0][1];
    while (W[cur] !== W[start] && order.length <= edges.length) { order.push(cur); cur = next.get(W[cur])?.[1]; if (cur === undefined) return null; }
    return order.length === edges.length ? order : null;
  };
  let O1 = walk(r1), O2 = walk(r2); if (!O1 || !O2) return null;
  const c1 = O1.reduce((s, i) => addS(s, P[i], 1 / O1.length), [0, 0, 0]), c2 = O2.reduce((s, i) => addS(s, P[i], 1 / O2.length), [0, 0, 0]);
  const turn = (O, c) => { let s = 0; for (let i = 0; i < O.length; i++) { const p = sub(P[O[i]], c), q = sub(P[O[(i + 1) % O.length]], c); s += dot([p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]], u); } return s; };
  // (walked along their bounding faces' edges the two rims turn opposite ways about the bone: one is reversed to zip them side by side)
  if (Math.sign(turn(O1, c1)) === Math.sign(turn(O2, c2))) return null;
  const O2r = [...O2].reverse();
  let ref = sub(P[O1[0]], c1); ref = addS(ref, u, -dot(ref, u));
  const k2 = O2r.reduce((bi, i, j) => (dot(sub(P[i], c2), ref) > dot(sub(P[O2r[bi]], c2), ref) ? j : bi), 0), R2o = [...O2r.slice(k2), ...O2r.slice(0, k2)];
  // (zipped by the angle round each rim's own centre, from the aligned starts, kept rising: for rims of one shape it pairs opposite points; by the fraction of the
  // way round, rims of slightly different shape were paired askew and the strip twisted over)
  const fr = (O, c) => { const e1 = (() => { let q = sub(P[O[0]], c); q = addS(q, u, -dot(q, u)); const l = len(q); return q.map((v) => v / l); })(), e2 = [u[1] * e1[2] - u[2] * e1[1], u[2] * e1[0] - u[0] * e1[2], u[0] * e1[1] - u[1] * e1[0]];
    const ang = O.map((i) => { const q = sub(P[i], c); return Math.atan2(dot(q, e2), dot(q, e1)); }), sgn = Math.sign(ang.slice(1, 6).reduce((x, y) => x + y, 0)) || 1;
    const out = [0]; let prev = 0; for (let i = 1; i < O.length; i++) { let a2 = sgn * ang[i]; while (a2 < prev - Math.PI) a2 += 2 * Math.PI; out.push(Math.max(prev, a2)); prev = out[i]; }
    out.push(2 * Math.PI); return out.map((x) => Math.min(1, x / (2 * Math.PI))); };
  const f1 = fr(O1, c1), f2 = fr(R2o, c2), n1 = O1.length, n2 = R2o.length, made = [];
  let i = 0, j = 0;
  while (i < n1 || j < n2) {
    if (j >= n2 || (i < n1 && f1[i + 1] <= f2[j + 1])) { made.push([O1[i], O1[(i + 1) % n1], R2o[j % n2], 'r1', O1[i], O1[(i + 1) % n1]]); i++; }
    else { made.push([O1[i % n1], R2o[(j + 1) % n2], R2o[j], 'r2', R2o[j], R2o[(j + 1) % n2]]); j++; }
  }
  // winding: the existing face runs the rim edge one way (dirOf); the stitch runs it the other way
  let flips = 0;
  for (const m of made) {
    const [x, y, z, , ex, ey] = m, d0 = dirOf.get(ekey(ex, ey)), tri = [x, y, z];
    const runs = (t, p, q) => [0, 1, 2].some((e) => W[t[e]] === W[p] && W[t[(e + 1) % 3]] === W[q]);
    if (runs(tri, d0[0], d0[1])) { T.push([x, z, y]); flips++; } else T.push(tri);
  }
  const newChain = chain.map((p, q) => (q > k ? addS(p, u, -D) : p));
  report.push(`${sideNm} seg ${k}: ${L.toFixed(2)} -> ${(L - D).toFixed(2)} cm (slab ${D.toFixed(2)} at ${t1.toFixed(2)}-${t2.toFixed(2)}, ${slab.size} triangles), rims ${n1}/${n2}, ${made.length} stitch triangles, ${far.size} vertices moved; rims ${(mis * 100).toFixed(1)} % apart round`);
  (arms[sideNm] ??= { slabs: [] }).slabs.push({ seg: k, t1: +t1.toFixed(4), t2: +t2.toFixed(4), D: +D.toFixed(4), L: +L.toFixed(4) });
  return { chain: newChain, far };
}

function hand(chain, target, sideNm, piece) {
  // the hand scaled about the wrist by s; the forearm's last RAMP share by a factor easing from 1 to s. Which of the two a vertex gets is decided by its side of one plane
  // through the wrist, halfway between the forearm's and the hand's directions, and the easing by its distance before that plane: one smooth field over the skin
  // (decided by the nearest bone, neighbours at the bent wrist took different scales and the skin folded)
  const [, E, Wr, F] = chain, L = len(sub(F, Wr)), s = target / L, Lf = len(sub(Wr, E));
  const uf = sub(Wr, E).map((v) => v / Lf), uh = sub(F, Wr).map((v) => v / L), nb = addS(uf, uh, 1), nl = len(nb), n = nb.map((v) => v / nl), ramp = RAMP * Lf;      // (over most of the forearm: over a fifth, skin far from the bone was sheared enough to fold)
  let nh = 0, nt = 0;
  for (let i = 0; i < P.length; i++) {
    if (!piece.has(W[i])) continue;
    const x = dot(sub(P[i], Wr), n);
    let kk;
    if (x >= 0) { kk = s; nh++; }
    else if (x > -ramp) {
      const y = 1 + x / ramp; kk = 1 + (s - 1) * y * y * (3 - 2 * y); nt++;
      // the normal carried through the easing (p' = W + k(x)(p - W), k varying across the plane: its Jacobian k I + (p - W) (dk/dx n)^T; normals go by its inverse
      // transpose): n' ~ m - g (r . m) / (k + g . r), g = dk/dx n, r = p - W
      const dk = (s - 1) * 6 * y * (1 - y) / ramp, g = n.map((v) => v * dk), r = sub(P[i], Wr), m = A.NORMAL.arr[i];
      const nn = addS(m, g, -dot(r, m) / (kk + dot(g, r))), l = len(nn); if (l > 0) A.NORMAL.arr[i] = nn.map((v) => v / l);
    } else continue;
    P[i] = addS(Wr, sub(P[i], Wr), kk);
  }
  report.push(`${sideNm} hand: ${L.toFixed(2)} -> ${target.toFixed(2)} cm (x ${s.toFixed(3)}), ${nh} hand vertices scaled, ${nt} forearm vertices eased`);
  return [chain[0], chain[1], chain[2], addS(Wr, sub(F, Wr), s)];
}

// open edges before and after (on the welded mesh): every cut closed by its stitch leaves the count unchanged
const openCount = (tris) => { weld(); const m = new Map(); for (const t of tris) for (let e = 0; e < 3; e++) { const x = W[t[e]], y = W[t[(e + 1) % 3]], kk = x < y ? x + ':' + y : y + ':' + x; m.set(kk, (m.get(kk) ?? 0) + 1); } return [...m.values()].filter((v) => v === 1).length; };
const OPEN0 = openCount(T);
const nV0 = P.length, nT0 = T.length;
for (const sd of ['L', 'R']) {
  let ch = [bones['arm' + sd].head, bones['forearm' + sd].head, bones['hand' + sd].head, bones['hand' + sd].tail];
  let r = cut(ch, 0, TGT[0], sd); ch = r.chain;
  r = cut(ch, 1, TGT[1], sd); ch = r.chain;
  if (TGT[2] > 0) ch = hand(ch, TGT[2], sd, r.far);
  arms[sd] = { ...(arms[sd] ?? { slabs: [] }), wristEase: TGT[2] > 0 ? RAMP : 0, shoulder: ch[0].map((v) => +v.toFixed(4)), elbow: ch[1].map((v) => +v.toFixed(4)), wrist: ch[2].map((v) => +v.toFixed(4)), finger: ch[3].map((v) => +v.toFixed(4)), lengthsCm: [0, 1, 2].map((q) => +len(sub(ch[q + 1], ch[q])).toFixed(3)) };
}
for (const r of report) console.log('  ' + r);
console.log(`  open edges: ${OPEN0} before, ${openCount(T)} after (every cut closed by its stitch: equal)`);
// (normals: a vertex a split made keeps the normal interpolated along its edge; recomputed from the faces round it, slivers along a cut line gave it any direction.
// Moved vertices keep theirs, the eased ones carry theirs through the easing.)
// --- out --------------------------------------------------------------------------------------------------------------------------------------------------------------
A.POSITION.arr = P.map((p) => p.map((v) => v / 100));
const buf = doc.getRoot().listBuffers()[0];
for (const nm of names) { const a = A[nm], flat = new Float32Array(a.arr.length * a.c); a.arr.forEach((v, i) => flat.set(v, i * a.c)); prim.setAttribute(nm, doc.createAccessor().setType(a.type).setArray(flat).setBuffer(buf)); }
{ const flat = new Float32Array(O.length * 3); O.forEach((v, i) => flat.set(v.map((x) => x / 100), i * 3)); prim.setAttribute('_ORIG', doc.createAccessor().setType('VEC3').setArray(flat).setBuffer(buf)); }
prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(Uint32Array.from(T.flat())).setBuffer(buf));
node.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
await io.write(OUT, doc);
fs.writeFileSync(OUT + '.arms.json', JSON.stringify(arms, null, 1));
console.log(`arms: ${JSON.stringify(Object.fromEntries(Object.entries(arms).map(([k, v]) => [k, v.lengthsCm])))} | vertices ${nV0} -> ${P.length}, triangles ${nT0} -> ${T.length} | wrote ${OUT}`);
