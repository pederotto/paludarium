// The common frog's sitting stance against the owner's own SITTING model of the species (7 Oct 2026, the owner: "the arms are still so wrong, compare with the other
// .glb we have for consistency": the Drop's two models, sample_...204629 the swimming one the game body is made from, sample_...204453 sitting). The sitting model
// has no skeleton; it is laid over the posed game body by the trunk and the head: its scale, height, fore-aft place and tilt fitted so the game body's trunk and
// head skin lie on its surface (least mean distance; it is symmetric, so its midline is x = 0). Then, part by part (each arm, each leg), how far the posed skin
// lies from it, both ways: the game body's limb skin from the model's surface, and the model's surface in that limb's region from the game body's skin.
//   node tools/rig/ref-sit.mjs <sitting.glb> [--sit '<json>'] [--png out.png] [--json out.json] [--align earlier.json]      (no --sit: SPECIES.commonfrog.sit
//   from src/sim/animals.js; --align: an alignment written before with --json, kept: the stance's trunk is the same)
//   import { loadRef, refAlign } from './ref-sit.mjs'   (the fitter's term: tools/rig/lunge-check.mjs --fit-limbs --ref-glb)
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

// the reference: its triangles in its own frame (z ahead, y up, as the game's), centred across, for nearest-point queries on a grid
export async function loadRef(file) {
  const d = await io.read(file), nd = d.getRoot().listNodes().find((x) => x.getMesh()), M = nd.getWorldMatrix(), p = nd.getMesh().listPrimitives()[0], a = p.getAttribute('POSITION'), n = a.getCount(), P = new Float64Array(n * 3), e = [];
  for (let i = 0; i < n; i++) { a.getElement(i, e); for (let r = 0; r < 3; r++) P[i * 3 + r] = M[r] * e[0] + M[4 + r] * e[1] + M[8 + r] * e[2] + M[12 + r]; }
  let x0 = 9e9, x1 = -9e9; for (let i = 0; i < n; i++) { x0 = Math.min(x0, P[i * 3]); x1 = Math.max(x1, P[i * 3]); } for (let i = 0; i < n; i++) P[i * 3] -= (x0 + x1) / 2;
  return { P, I: p.getIndices().getArray(), n };
}
// the reference placed in the game body's ground frame: scale s, tilted by th (rad, nose up positive) about its own origin, then lifted by dy and moved ahead by dz
export function placeRef(R, { s, th, dy, dz }) {
  const c = Math.cos(th), sn = Math.sin(th), Q = new Float64Array(R.P.length);
  for (let i = 0; i < R.n; i++) { const x = R.P[i * 3] * s, y = R.P[i * 3 + 1] * s, z = R.P[i * 3 + 2] * s; Q[i * 3] = x; Q[i * 3 + 1] = c * y + sn * z + dy; Q[i * 3 + 2] = -sn * y + c * z + dz; }
  return Q;
}
// nearest-point distances to a placed triangle set (a grid of 0.25 cm cells; farther than `far` reads as far)
export function surface(Q, I, cell = 0.25) {
  const g = new Map(), fl = (v) => Math.floor(v / cell), key = (x, y, z) => (x + 512) * 1048576 + (y + 512) * 1024 + (z + 512);
  for (let t = 0; t < I.length; t += 3) { const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const lo = [0, 1, 2].map((k) => fl(Math.min(Q[a + k], Q[b + k], Q[c + k]))), hi = [0, 1, 2].map((k) => fl(Math.max(Q[a + k], Q[b + k], Q[c + k])));
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) { const k = key(x, y, z); (g.get(k) ?? g.set(k, []).get(k)).push(t); } }
  return (p, far = 1.0) => { const cx = fl(p[0]), cy = fl(p[1]), cz = fl(p[2]), R = Math.ceil(far / cell); let best = far;
    for (let r = 0; r <= R; r++) { if (r > 0 && (r - 1) * cell > best) break;
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) { if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue;
        for (const t of g.get(key(cx + dx, cy + dy, cz + dz)) ?? []) best = Math.min(best, ptTri(p, Q, I[t] * 3, I[t + 1] * 3, I[t + 2] * 3)); } }
    return best; };
}
export function ptTri(p, A, ia, ib, ic) {
  const ab = [A[ib] - A[ia], A[ib + 1] - A[ia + 1], A[ib + 2] - A[ia + 2]], ac = [A[ic] - A[ia], A[ic + 1] - A[ia + 1], A[ic + 2] - A[ia + 2]], ap = [p[0] - A[ia], p[1] - A[ia + 1], p[2] - A[ia + 2]], d = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const d1 = d(ab, ap), d2 = d(ac, ap); if (d1 <= 0 && d2 <= 0) return Math.hypot(...ap);
  const bp = [p[0] - A[ib], p[1] - A[ib + 1], p[2] - A[ib + 2]], d3 = d(ab, bp), d4 = d(ac, bp); if (d3 >= 0 && d4 <= d3) return Math.hypot(...bp);
  const vc = d1 * d4 - d3 * d2; if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return Math.hypot(ap[0] - ab[0] * v, ap[1] - ab[1] * v, ap[2] - ab[2] * v); }
  const cp = [p[0] - A[ic], p[1] - A[ic + 1], p[2] - A[ic + 2]], d5 = d(ab, cp), d6 = d(ac, cp); if (d6 >= 0 && d5 <= d6) return Math.hypot(...cp);
  const vb = d5 * d2 - d1 * d6; if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return Math.hypot(ap[0] - ac[0] * w, ap[1] - ac[1] * w, ap[2] - ac[2] * w); }
  const va = d3 * d6 - d5 * d4; if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return Math.hypot(p[0] - (A[ib] + (A[ic] - A[ib]) * w), p[1] - (A[ib + 1] + (A[ic + 1] - A[ib + 1]) * w), p[2] - (A[ib + 2] + (A[ic + 2] - A[ib + 2]) * w)); }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den; return Math.hypot(p[0] - (A[ia] + ab[0] * v + ac[0] * w), p[1] - (A[ia + 1] + ab[1] * v + ac[1] * w), p[2] - (A[ia + 2] + ab[2] * v + ac[2] * w));
}
// the alignment: the game body's trunk and head points (ground frame) onto the reference surface, by a coordinate search over s, th, dy, dz from a start
export function refAlign(R, trunkPts, start) {
  const cost = (a) => { const S = surface(placeRef(R, a), R.I); let c = 0; for (const p of trunkPts) { const d = S(p, 1.0); c += d * d; } return c / trunkPts.length; };
  let A = { ...start }, best = cost(A);
  for (const [k, steps] of [['s', [0.4, 0.2, 0.1, 0.05, 0.02, 0.01]], ['dz', [1, 0.5, 0.25, 0.1, 0.05]], ['dy', [0.5, 0.25, 0.1, 0.05]], ['th', [0.2, 0.1, 0.05, 0.02]]].flatMap((x) => [x, x]))
    for (const st of steps) for (const sg of [1, -1]) { let moved = true; while (moved) { moved = false; const B = { ...A, [k]: A[k] + sg * st * (k === 's' ? A.s : 1) }, c = cost(B); if (c < best - 1e-9) { A = B; best = c; moved = true; } } }
  return { ...A, rms: Math.sqrt(best) };
}

// --- the command: the posed game body against the reference ---
if (import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
  const { skeletonRig, poseStroke, ROW_FLOATS } = await import('../../src/render/creatures/skeleton.js');
  const { lungePose } = await import('../../src/util/frogstrike.js');
  const { HIND, FORE } = await import('../../src/util/gait.js');
  let SIT = opt('--sit', null) ? JSON.parse(opt('--sit')) : null;
  if (!SIT) { const src = fs.readFileSync('src/sim/animals.js', 'utf8'), m = src.match(/sit: (\{ pitchDeg[^\n]*?\}),?\n/); SIT = Function('return ' + m[1].replace(/, mouthCm[\s\S]*$/, ' }'))(); }
  const man = JSON.parse(fs.readFileSync('public/assets/creatures/manifest.json', 'utf8'))['commonfrog.swim'], d = await io.read('public/assets/creatures/' + man.file);
  const nd = d.getRoot().listNodes().find((x) => x.getMesh()), Mw = nd.getWorldMatrix(), pr = nd.getMesh().listPrimitives()[0];
  const get = (nm) => { const a = pr.getAttribute(nm), n = a.getCount(), c = a.getElementSize(), o = new Float32Array(n * c), e = []; for (let i = 0; i < n; i++) { a.getElement(i, e); for (let k = 0; k < c; k++) o[i * c + k] = e[k]; } return o; };
  const P0 = get('POSITION'), SK = get('_SKIN'), SX = get('_SKINX'), n = P0.length / 3;
  for (let i = 0; i < n; i++) { const x = P0[i * 3], y = P0[i * 3 + 1], z = P0[i * 3 + 2]; for (let r = 0; r < 3; r++) P0[i * 3 + r] = (Mw[r] * x + Mw[4 + r] * y + Mw[8 + r] * z + Mw[12 + r]) * 100; }
  const bw = (i) => [[SK[i * 4] * 32, SK[i * 4 + 2]], [SK[i * 4 + 1] * 32, SK[i * 4 + 3]], [SX[i * 4] * 32, SX[i * 4 + 2]], [SX[i * 4 + 1] * 32, SX[i * 4 + 3]]].map(([b, w]) => [Math.round(b), w]);
  const rig = skeletonRig(man.skeleton, {}), out = new Float32Array(ROW_FLOATS); poseStroke(rig, lungePose(SIT, 0, 0, 0, HIND, FORE, {}), out);
  const a = -SIT.pitchDeg * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a), o = SIT.offsetCm, G = [], part = [];
  for (let i = 0; i < n; i++) { let x = 0, y = 0, z = 0, dm = [0, -1]; for (const [b, w] of bw(i)) { if (w <= 1e-6) continue; const m = b * 12, p = [P0[i * 3], P0[i * 3 + 1], P0[i * 3 + 2]]; x += w * (out[m] * p[0] + out[m + 1] * p[1] + out[m + 2] * p[2] + out[m + 3]); y += w * (out[m + 4] * p[0] + out[m + 5] * p[1] + out[m + 6] * p[2] + out[m + 7]); z += w * (out[m + 8] * p[0] + out[m + 9] * p[1] + out[m + 10] * p[2] + out[m + 11]); if (w > dm[1]) dm = [b, w]; }
    G.push([x + o[0], c * y - sn * z + o[1], sn * y + c * z + o[2]]); const nm = rig.B[dm[0]].name; part.push(/^(arm|forearm|hand)L$/.test(nm) ? 'armL' : /^(arm|forearm|hand)R$/.test(nm) ? 'armR' : /^(thigh|shin|foot|toes)L$/.test(nm) ? 'legL' : /^(thigh|shin|foot|toes)R$/.test(nm) ? 'legR' : /^tongue/.test(nm) ? 'tongue' : 'trunk'); }
  const R = await loadRef(args[0]), trunk = G.filter((_, i) => part[i] === 'trunk' && i % 6 === 0);
  // (start: the reference's length to the game body's snout-to-rump length; its lowest point on the ground; its front at the game body's snout)
  let zr0 = 9e9, zr1 = -9e9, yr0 = 9e9; for (let i = 0; i < R.n; i++) { zr0 = Math.min(zr0, R.P[i * 3 + 2]); zr1 = Math.max(zr1, R.P[i * 3 + 2]); yr0 = Math.min(yr0, R.P[i * 3 + 1]); }
  let zg0 = 9e9, zg1 = -9e9; for (const p of G) { zg0 = Math.min(zg0, p[2]); zg1 = Math.max(zg1, p[2]); }
  const s0 = (zg1 - zg0) / (zr1 - zr0), A = opt('--align', null) ? JSON.parse(fs.readFileSync(opt('--align'), 'utf8')).align : refAlign(R, trunk, { s: s0, th: 0, dy: -yr0 * s0, dz: zg1 - zr1 * s0 });
  const RQ = placeRef(R, A), S = surface(RQ, R.I);
  console.log('alignment: scale', A.s.toFixed(3), 'cm per unit, tilt', (A.th * 180 / Math.PI).toFixed(1), 'deg, lift', A.dy.toFixed(2), 'ahead', A.dz.toFixed(2), '| trunk and head off its surface: rms', (A.rms * 10).toFixed(2), 'mm');
  // each part: the game body's skin from the reference's surface (mean, 90th percentile), and the reference's points in that part's region from the game body
  const gGrid = new Map(), gk = (p) => `${Math.floor(p[0] / 0.25)},${Math.floor(p[1] / 0.25)},${Math.floor(p[2] / 0.25)}`; G.forEach((p, i) => { const k = gk(p); (gGrid.get(k) ?? gGrid.set(k, []).get(k)).push(i); });
  const nearG = (p) => { let best = 9, bi = -1; const [x, y, z] = [0, 1, 2].map((k) => Math.floor(p[k] / 0.25)); for (let r = 0; r <= 6; r++) { for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) { if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue; for (const i of gGrid.get(`${x + dx},${y + dy},${z + dz}`) ?? []) { const d = Math.hypot(p[0] - G[i][0], p[1] - G[i][1], p[2] - G[i][2]); if (d < best) { best = d; bi = i; } } } if (bi >= 0 && best < r * 0.25) break; } return [best, bi]; };
  const rep = {};
  for (const k of ['trunk', 'armL', 'armR', 'legL', 'legR']) { const ds = []; G.forEach((p, i) => { if (part[i] === k && i % 2 === 0) ds.push(S(p, 2)); }); ds.sort((u, v) => u - v); rep[k] = { gameToRefMeanMm: +(ds.reduce((u, v) => u + v, 0) / ds.length * 10).toFixed(2), gameToRefP90Mm: +(ds[Math.floor(ds.length * 0.9)] * 10).toFixed(2) }; }
  // (the reference's points: which game part they are nearest to, and how far)
  const refBy = {}; for (let i = 0; i < R.n; i += 3) { const p = [RQ[i * 3], RQ[i * 3 + 1], RQ[i * 3 + 2]], [dd, gi] = nearG(p); if (gi < 0) continue; (refBy[part[gi]] ??= []).push(dd); }
  for (const [k, ds] of Object.entries(refBy)) { if (!rep[k]) continue; ds.sort((u, v) => u - v); rep[k].refToGameMeanMm = +(ds.reduce((u, v) => u + v, 0) / ds.length * 10).toFixed(2); rep[k].refToGameP90Mm = +(ds[Math.floor(ds.length * 0.9)] * 10).toFixed(2); }
  console.log(JSON.stringify(rep, null, 1));
  if (opt('--json', null)) fs.writeFileSync(opt('--json'), JSON.stringify({ align: A, report: rep }));
  // pictures: the reference (grey) and the game body (trunk dark, arms red, legs blue), side, front and top, as points
  if (opt('--png', null)) {
    const sharp = (await import('sharp')).default, W = 420, H = 420, img = Buffer.alloc(W * 3 * H * 3, 255), all = [...G];
    let lo = [9e9, 9e9, 9e9], hi = [-9e9, -9e9, -9e9]; for (const p of all) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
    const span = Math.max(...hi.map((v, k) => v - lo[k])) * 1.1, mid = lo.map((v, k) => (v + hi[k]) / 2);
    const put = (p, u, v, k, col) => { const x = Math.floor((p[u] - mid[u]) / span * (W - 20) + W / 2) + k * W, y = Math.floor(H / 2 - (p[v] - mid[v]) / span * (H - 20)); if (x < k * W || x >= (k + 1) * W || y < 0 || y >= H) return; const q = (y * W * 3 + x) * 3; img[q] = col[0]; img[q + 1] = col[1]; img[q + 2] = col[2]; };
    const views = [[2, 1], [0, 1], [0, 2]];
    for (let i = 0; i < R.n; i += 2) views.forEach(([u, v], k) => put([RQ[i * 3], RQ[i * 3 + 1], RQ[i * 3 + 2]], u, v, k, [175, 175, 175]));
    const colOf = { trunk: [60, 60, 60], armL: [220, 30, 30], armR: [220, 120, 30], legL: [30, 70, 220], legR: [30, 170, 200], tongue: [60, 60, 60] };
    G.forEach((p, i) => { if (i % 2) return; views.forEach(([u, v], k) => put(p, u, v, k, colOf[part[i]])); });
    await sharp(img, { raw: { width: W * 3, height: H, channels: 3 } }).png().toFile(opt('--png'));
  }
}
