// The sitting stance checked on a shipped body file through the game's own pose code (the common frog, 7 Oct 2026, the owner: "the chest mark is a hole: faces
// inverted, the arm pushed through the chest wall"): the body posed by render/creatures/skeleton.js poseStroke with the stance (util/frogstrike.js lungePose at
// rest), skinned on the CPU with the file's four-bone weights, then
//   inverted   triangles whose posed normal points against their bind normal carried by their main bone (turned inside out: the renderer culls them and the body
//              shows a hole), counted by the bone they belong to;
//   inside     arm, forearm and hand vertices inside the rest of the body, and each one's clearance from it (tools/rig/arm-clear.mjs: the winding number, the nearest skin
//              exactly; the armpit's own crease left out), with --where the ones under 0.5 mm: where they are and which way they face;
//   thickness  each arm segment's mean skin radius about its bone at rest, to compare files.
//   hands      each hand's lowest skin and how much of it lies flat on the ground; exterior (--exterior, tools/rig/exterior.mjs) the holes seen from outside.
//   node tools/rig/sit-check.mjs [file.glb] [--sit '<json>'] [--id commonfrog.swim] [--swim | --bind] [--where] [--exterior] [--seam 0.4]
//   (no --sit: SPECIES.<species>.sit from src/sim/animals.js's text; --swim: the gliding swim pose; --bind: unposed)
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { skeletonRig, poseStroke, ROW_FLOATS } from '../../src/render/creatures/skeleton.js';
import { lungePose } from '../../src/util/frogstrike.js';
import { HIND, FORE } from '../../src/util/gait.js';
import { armClear } from './arm-clear.mjs';
import { exterior } from './exterior.mjs';
await MeshoptDecoder.ready;
const args = process.argv.slice(2), opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const id = opt('--id', 'commonfrog.swim'), DIR = 'public/assets/creatures/', man = JSON.parse(opt('--manifest', null) ? fs.readFileSync(opt('--manifest'), 'utf8') : fs.readFileSync(DIR + 'manifest.json', 'utf8'))[id];
const FILE = args[0] && !args[0].startsWith('--') ? args[0] : DIR + man.file;
let SIT = opt('--sit', null) ? JSON.parse(opt('--sit')) : null;
if (!SIT) { const src = fs.readFileSync('src/sim/animals.js', 'utf8'), m = src.match(/sit: (\{ pitchDeg[^\n]*?\}),?\n/); SIT = Function('return ' + m[1].replace(/, mouthCm[\s\S]*$/, ' }'))(); }
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(FILE), node = doc.getRoot().listNodes().find((n) => n.getMesh()), prim = node.getMesh().listPrimitives()[0], Mw = node.getWorldMatrix();
const get = (name) => { const a = prim.getAttribute(name), n = a.getCount(), c = a.getElementSize(), o = new Float32Array(n * c), e = []; for (let i = 0; i < n; i++) { a.getElement(i, e); for (let k = 0; k < c; k++) o[i * c + k] = e[k]; } return o; };
const P0 = get('POSITION'), SK = get('_SKIN'), SX = get('_SKINX'), I = prim.getIndices().getArray(), n = P0.length / 3;
for (let i = 0; i < n; i++) { const x = P0[i * 3], y = P0[i * 3 + 1], z = P0[i * 3 + 2]; for (let r = 0; r < 3; r++) P0[i * 3 + r] = (Mw[r] * x + Mw[4 + r] * y + Mw[8 + r] * z + Mw[12 + r]) * 100; }
const bones = (i) => [[SK[i * 4] * 32, SK[i * 4 + 2]], [SK[i * 4 + 1] * 32, SK[i * 4 + 3]], [SX[i * 4] * 32, SX[i * 4 + 2]], [SX[i * 4 + 1] * 32, SX[i * 4 + 3]]].map(([b, w]) => [Math.round(b), w]);
const rig = skeletonRig(man.skeleton, {}), N = rig.byName, dom = new Int16Array(n);
for (let i = 0; i < n; i++) dom[i] = bones(i).reduce((m, x) => (x[1] > m[1] ? x : m), [0, -1])[0];
const out = new Float32Array(ROW_FLOATS), st = args.includes('--swim') ? null : lungePose(SIT, 0, 0, 0, HIND, FORE, {}); poseStroke(rig, st, out);
// (--bind: the body as it was bound, unposed (every bone at rest), the model's own shape: what the skin's own creases measure before any pose)
if (args.includes('--bind')) for (let b = 0; b < rig.B.length; b++) out.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0], b * 12);      // (--swim: the gliding swim pose instead, the pose the body was bound in, for comparison)
// faces wound inside out already at rest (their winding against their own vertex normals), by main bone: a fold made in the mesh itself, not by the pose
const NR = get('NORMAL'), restFold = {}; let nFold = 0;
for (let t = 0; t < I.length; t += 3) { const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3, e1 = [P0[b] - P0[a], P0[b + 1] - P0[a + 1], P0[b + 2] - P0[a + 2]], e2 = [P0[c] - P0[a], P0[c + 1] - P0[a + 1], P0[c + 2] - P0[a + 2]];
  const fn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], vn = [0, 1, 2].map((k) => NR[a + k] + NR[b + k] + NR[c + k]);
  if (fn[0] * vn[0] + fn[1] * vn[1] + fn[2] * vn[2] < 0) { const nm = 'b' + I[t]; nFold++; restFold[nm] = 1; } }
const Q = new Float32Array(n * 3);
for (let i = 0; i < n; i++) { let x = 0, y = 0, z = 0; for (const [b, w] of bones(i)) { if (w <= 1e-6) continue; const m = b * 12, px = P0[i * 3], py = P0[i * 3 + 1], pz = P0[i * 3 + 2];
  x += w * (out[m] * px + out[m + 1] * py + out[m + 2] * pz + out[m + 3]); y += w * (out[m + 4] * px + out[m + 5] * py + out[m + 6] * pz + out[m + 7]); z += w * (out[m + 8] * px + out[m + 9] * py + out[m + 10] * pz + out[m + 11]); }
  Q[i * 3] = x; Q[i * 3 + 1] = y; Q[i * 3 + 2] = z; }
const tri = (A, t) => { const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3, e1 = [A[b] - A[a], A[b + 1] - A[a + 1], A[b + 2] - A[a + 2]], e2 = [A[c] - A[a], A[c + 1] - A[a + 1], A[c + 2] - A[a + 2]];
  return [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]; };
// inverted: the posed face normal against the bind normal turned by the triangle's main bone
const inv = {}; let nInv = 0, nInvArea = 0;
for (let t = 0; t < I.length; t += 3) {
  const b = dom[I[t]], m = b * 12, n0 = tri(P0, t), n1 = tri(Q, t), area = Math.hypot(...n0) / 2;
  if (area < 1e-6) continue;
  const r = [out[m] * n0[0] + out[m + 1] * n0[1] + out[m + 2] * n0[2], out[m + 4] * n0[0] + out[m + 5] * n0[1] + out[m + 6] * n0[2], out[m + 8] * n0[0] + out[m + 9] * n0[1] + out[m + 10] * n0[2]];
  if (r[0] * n1[0] + r[1] * n1[1] + r[2] * n1[2] < 0) { const nm = rig.B[b].name; inv[nm] = (inv[nm] ?? 0) + 1; nInv++; nInvArea += area; }
}
// inside and clearance (tools/rig/arm-clear.mjs, the measure the stance fitter uses): each arm vertex outside the band along its seam with the body (--seam, cm
// along the arm's skin: 0.4, the armpit's own crease, the narrowest band at which the unposed model (--bind) is itself 0.5 mm clear: at 0.3 its right armpit has
// arm skin 0.47 mm from the throat before any pose), its distance to
// the body's skin, negative inside; with --where, every one closer than 0.5 mm: where on its bone (cm from the joint, how far from the seam) and which way it faces
const SEAM = +(opt('--seam', 0.4)), WHERE = args.includes('--where') ? [] : null, AC = armClear({ P0, I, dom, names: rig.B.map((b) => b.name), seamCm: SEAM }), M = AC.measure(Q, { where: !!WHERE });
const ins = M.inside, armV = AC.armV, clearMin = M.closest, clearWhere = M.at, nUnder = M.nUnder, clearBy = Object.fromEntries(Object.entries(M.bySide).map(([k, v]) => [k, +v.toFixed(4)]));
if (WHERE) for (const e of M.list) {
  const i = e.v, b = dom[i], h = rig.head[b], tl = rig.tail[b], d = [tl[0] - h[0], tl[1] - h[1], tl[2] - h[2]], L = Math.hypot(...d), r = [P0[i * 3] - h[0], P0[i * 3 + 1] - h[1], P0[i * 3 + 2] - h[2]], tt = (r[0] * d[0] + r[1] * d[1] + r[2] * d[2]) / L;
  // (which way the skin there faces in the pose: the vertex's offset from its posed bone, as lateral (away from the midline), up and forward)
  const bm = b * 12, at = (p) => [0, 1, 2].map((k) => out[bm + k * 4] * p[0] + out[bm + k * 4 + 1] * p[1] + out[bm + k * 4 + 2] * p[2] + out[bm + k * 4 + 3]), hp = at(h), tp = at(tl);
  const u = tp.map((v, k) => (v - hp[k]) / L), rq = [0, 1, 2].map((k) => Q[i * 3 + k] - hp[k]), tq = rq[0] * u[0] + rq[1] * u[1] + rq[2] * u[2], rad = rq.map((v, k) => v - u[k] * tq), rl = Math.hypot(...rad);
  WHERE.push({ ...e, alongCm: +tt.toFixed(2), ofCm: +L.toFixed(2), fromSeamCm: +AC.seamDist[i].toFixed(2), facing: { lateral: +(rad[0] * Math.sign(h[0]) / rl).toFixed(2), up: +(rad[1] / rl).toFixed(2), fwd: +(rad[2] / rl).toFixed(2) } });
}
// thickness at rest: mean distance of a segment's own vertices (middle 60 % of it) from its bone's axis
const thick = {};
for (const k of ['armL', 'forearmL', 'handL', 'armR', 'forearmR', 'handR']) {
  const b = N[k], h = rig.head[b], t = rig.tail[b], d = [t[0] - h[0], t[1] - h[1], t[2] - h[2]], L = Math.hypot(...d); let s = 0, c = 0;
  for (let i = 0; i < n; i++) { if (dom[i] !== b) continue; const r = [P0[i * 3] - h[0], P0[i * 3 + 1] - h[1], P0[i * 3 + 2] - h[2]], u = (r[0] * d[0] + r[1] * d[1] + r[2] * d[2]) / (L * L); if (u < 0.2 || u > 0.8) continue;
    const p = r.map((v, j) => v - d[j] * u); s += Math.hypot(...p); c++; }
  thick[k] = { lenCm: +L.toFixed(2), meanRadiusCm: c ? +(s / c).toFixed(3) : null, verts: c };
}
// the hands on the ground (the stance's ground frame: tilted by pitchDeg, lifted by offsetCm): each hand's lowest skin, how much of it lies within 1.8 mm of the
// ground (a hand planted flat), and the lowest skin of the rest of the body (none of it may be under the ground)
const handsOn = {}; { const a = -SIT.pitchDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), o = SIT.offsetCm, gy = (i) => c * Q[i * 3 + 1] - s * Q[i * 3 + 2] + o[1];
  for (const k of ['handL', 'handR']) { const ys = []; for (let i = 0; i < n; i++) if (dom[i] === N[k]) ys.push(gy(i)); ys.sort((u, v) => u - v); handsOn[k] = { lowestCm: +ys[0].toFixed(3), flatShare: +(ys.filter((y) => y - ys[0] < 0.18).length / ys.length).toFixed(2), p20Cm: +ys[Math.round(ys.length * 0.2)].toFixed(3) }; }
  let low = 9; for (let i = 0; i < n; i++) if (!['handL', 'handR', 'forearmL', 'forearmR', 'footL', 'footR', 'toesL', 'toesR', 'shinL', 'shinR'].includes(rig.B[dom[i]].name)) low = Math.min(low, gy(i)); handsOn.bodyLowestCm = +low.toFixed(3); }
// --exterior: holes seen from outside (tools/rig/exterior.mjs): the posed body in its ground frame (the stance's tilt and lift; the gliding swim pose as it is)
let ext = null;
if (args.includes('--exterior')) { const a = -SIT.pitchDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), o = SIT.offsetCm, swim = args.includes('--swim');
  ext = exterior(Q, I, (t) => dom[I[t]], rig.B.map((b) => b.name), { toGround: swim ? (p) => p : (p) => [p[0] + o[0], c * p[1] - s * p[2] + o[1], s * p[1] + c * p[2] + o[2]], ground: !swim, views: +opt('--views', 96), pixelCm: +opt('--pixel', 0.02) }); }
const foldBy = {}; for (let t = 0; t < I.length; t += 3) { const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3, e1 = [P0[b] - P0[a], P0[b + 1] - P0[a + 1], P0[b + 2] - P0[a + 2]], e2 = [P0[c] - P0[a], P0[c + 1] - P0[a + 1], P0[c + 2] - P0[a + 2]]; const fn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], vn = [0, 1, 2].map((k) => NR[a + k] + NR[b + k] + NR[c + k]); if (fn[0] * vn[0] + fn[1] * vn[1] + fn[2] * vn[2] < 0) { const nm = rig.B[dom[I[t]]].name; foldBy[nm] = (foldBy[nm] ?? 0) + 1; } }
if (WHERE) { WHERE.sort((a, b) => a.sdMm - b.sdMm); for (const w of WHERE) console.error(JSON.stringify(w)); }
console.log(JSON.stringify({ foldedAtRest: { triangles: nFold, byBone: foldBy }, file: FILE, stance: { pitchDeg: SIT.pitchDeg, arms: SIT.armA ? 'armA' : 'armDeg ' + SIT.armDeg }, inverted: { triangles: nInv, areaCm2: +nInvArea.toFixed(3), byBone: inv }, armInsideBody: ins, exterior: ext, handsOnGround: args.includes('--swim') || args.includes('--bind') ? null : handsOn, armClearance: { closestCm: +clearMin.toFixed(4), at: clearWhere, bySide: clearBy, verticesUnder05mm: nUnder, seamBandCm: SEAM, armVerticesChecked: armV.length }, thickness: thick }, null, 1));
