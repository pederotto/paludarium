// The fire salamander's joints (art-src/raw/salamander_mesh.glb, the user's scan of Salamandra salamandra: one piece, 93,776 tris, no
// UVs or materials; length 1.988 along x with the head at -x, y up), for the lizard bone list (tools/rig/lizard.mjs, 25 bones).
// Baked by `node tools/bake-lizard.mjs firesal` (R2). The skink's method (tools/rig/lizard-skink.mjs) with these differences:
//   the frame     readRaw turns the scan as the old bake job did (rotY 90: head to +z) and scales it to length 1, so the skink's
//                 measuring constants (slice widths, the tail tracer's reach) apply unchanged
//   the tail      lies on the ground in the scan (tip 0.03-0.05 below the soles) and curls to one side. NOT levelled: the skink's
//                 levelTail (aimed at the vent's height) tore it (R2 attempt 1: 14,644 edges past 2x, the hind limbs lost). The
//                 bake's top-view straightening aims the tip at the ground (y 0), where a salamander drags it; the soles are the
//                 limbs' own (measureFiresal), not the lowest point, which is the tail tip
//   the hind legs the scan holds them as a straight diagonal hip -> foot (feet at ~0.9 of full reach), which caps the stride (the
//                 gecko's lesson, reports/R1.proposal.md). bendHind flexes each knee in the bake to `hindReach` of the leg's length:
//                 the heel moved in toward the hip at its own height, the knee found by two-bone IK (bent up and out), the skin carried
//                 by the curved skeleton's own binding (thigh, shin rotated; foot and toes moved flat). A bake pose, not a re-rig.
//   the paint     vertex colours from tools/paint/firesal.mjs, the frame of tools/bake-creature.mjs build() (the scan has no UVs)
// Real size: total length 18 cm (the old bake job; Species board 15-25 cm); the snout-vent length from the scan's vent at 0.577 of the
// length (10.4 cm), the rest in the model's proportions.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import { lizardBones, bindLizard, dist } from './lizard.mjs';
import { levelTail, measureSkink } from './lizard-skink.mjs';

export const FIRESAL = {
  id: 'firesal', raw: 'art-src/raw/salamander_mesh.glb', source: null,
  svlCm: 10.4, tris: [32000, 8000], paint: 'firesal', legs: true, nape: 0.11, vent: 0.577, srcLen: 1,
  // fractions of the length from the snout (R2 slices of the scan, +-0.02)
  trunk: [0.29, 0.385], fore: [0.10, 0.29], hind: [0.37, 0.58],
  hindReach: 0.65,          // the bake pose: heel to hip as a share of thigh + shin (the lead's 0.6-0.7)
  duty: 0.75,               // stance share of a slow walk (general knowledge, 0.7-0.8), for the stride cap
  kneeMax: 120,             // the knee's flexion limit (bodyplan.js PLANS.caudate.rom.shin)
  radius: { head: 0.08, neck: 0.08, spine: 0.075, pelvis: 0.07, tail1: 0.05, tail2: 0.04, tail3: 0.032, tail4: 0.025, tail5: 0.018,
    arm: 0.022, forearm: 0.02, hand: 0.012, fingers: 0.007, thigh: 0.026, shin: 0.02, foot: 0.013, toes: 0.008 },
};

export async function readRaw(file = FIRESAL.raw, { level = false } = {}) {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.read(file);
  await doc.transform(weld());
  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0], src = prim.getAttribute('POSITION').getArray(), n = src.length / 3;
  let x0 = Infinity, x1 = -Infinity;
  for (let i = 0; i < n; i++) { x0 = Math.min(x0, src[i * 3]); x1 = Math.max(x1, src[i * 3]); }
  const s = 1 / (x1 - x0), pos = new Float32Array(n * 3);
  // rotY 90: (x, z) -> (z, -x), the head (-x) to +z; scaled to length 1
  for (let i = 0; i < n; i++) { pos[i * 3] = src[i * 3 + 2] * s; pos[i * 3 + 1] = src[i * 3 + 1] * s; pos[i * 3 + 2] = -src[i * 3] * s; }
  const raw = { doc, prim, pos, uv: null, idx: Uint32Array.from(prim.getIndices().getArray()), srcLen: x1 - x0 };
  if (level) { const L = levelTail(raw.pos, raw.idx, FIRESAL); raw.pos = L.pos; raw.level = L.stats; console.log(JSON.stringify({ firesalTailLevel: L.stats })); }
  return raw;
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => mul(a, 1 / (Math.hypot(...a) || 1));
// the rotation (3x3, rows) turning direction a onto direction b
function turn(a, b) {
  a = norm(a); b = norm(b);
  const v = cross(a, b), c = dot(a, b), k = 1 / (1 + c);
  return [[v[0] * v[0] * k + c, v[0] * v[1] * k - v[2], v[0] * v[2] * k + v[1]],
    [v[1] * v[0] * k + v[2], v[1] * v[1] * k + c, v[1] * v[2] * k - v[0]],
    [v[2] * v[0] * k - v[1], v[2] * v[1] * k + v[0], v[2] * v[2] * k + c]];
}
const rot = (R, p) => [dot(R[0], p), dot(R[1], p), dot(R[2], p)];
const mm = (A, B) => A.map((r) => [0, 1, 2].map((c) => r[0] * B[0][c] + r[1] * B[1][c] + r[2] * B[2][c]));

// Per leg: reach (heel / wrist to hip / shoulder over the two bones' length) and the fore-aft span the heel can sweep at its own
// lateral place and height between the knee's flexion limit and 0.97 of full reach: half-spans ahead and behind, and the stride
// cap 2 x min(half-span) / duty (reports/R1.proposal.md's definition). `u` scales model units to cm.
export function legReach(j, u = 1, cfg = FIRESAL) {
  const out = {};
  for (const [leg, a0, a1, a2] of [['LF', 'shoulderL', 'elbowL', 'wristL'], ['RF', 'shoulderR', 'elbowR', 'wristR'], ['LH', 'hipL', 'kneeL', 'heelL'], ['RH', 'hipR', 'kneeR', 'heelR']]) {
    const H = j[a0], E = j[a2], a = dist(H, j[a1]), b = dist(j[a1], E), L = a + b;
    const rMax = 0.97 * L, rMin = Math.sqrt(a * a + b * b - 2 * a * b * Math.cos(Math.PI - (cfg.kneeMax * Math.PI) / 180));
    const dp = Math.hypot(E[0] - H[0], E[1] - H[1]), dz = E[2] - H[2];
    const zOut = rMax > dp ? Math.sqrt(rMax * rMax - dp * dp) : 0, zIn = rMin > dp ? Math.sqrt(rMin * rMin - dp * dp) : 0;
    // the heel's z (from the hip) allowed in [rMin, rMax] at its lateral offset dp: the interval holding the rest point
    const [lo, hi] = dp >= rMin ? [-zOut, zOut] : dz >= 0 ? [zIn, zOut] : [-zOut, -zIn], ahead = Math.max(0, hi - dz), behind = Math.max(0, dz - lo);
    out[leg] = { reach: +(dist(H, E) / L).toFixed(3), aheadCm: +(ahead * u).toFixed(2), behindCm: +(behind * u).toFixed(2),
      strideCapCm: +((2 * Math.min(ahead, behind)) / cfg.duty * u).toFixed(2) };
  }
  return out;
}

// The bake pose of the hind legs (see the header). Writes `pos` in place, moves the joints in `j`; returns the per-leg change and the
// edge stretch it caused (p99.9, worst, edges past 2x).
export function bendHind(pos, idx, j, cfg = FIRESAL) {
  const bones = lizardBones(j), bind = bindLizard(pos, bones, idx, { radius: cfg.radius }), n = pos.length / 3;
  const T = bones.map(() => null), before = Float32Array.from(pos), log = {};
  for (const s of ['L', 'R']) {
    const H = j['hip' + s], K = j['knee' + s], E = j['heel' + s], a = dist(H, K), b = dist(K, E), want = cfg.hindReach * (a + b);
    // the heel moved in toward the hip at its own height
    const Hf = [H[0], E[1], H[2]];
    let lo = 0, hi = 1;
    for (let it = 0; it < 40; it++) { const t = (lo + hi) / 2; if (dist(H, add(E, mul(sub(Hf, E), t))) > want) lo = t; else hi = t; }
    const E2 = add(E, mul(sub(Hf, E), lo)), d = dist(H, E2), u = norm(sub(E2, H));
    const xk = (a * a - b * b + d * d) / (2 * d), hk = Math.sqrt(Math.max(0, a * a - xk * xk));
    let p = sub(K, H); p = sub(p, mul(u, dot(p, u)));
    p = norm(add(norm(p), mul(sub([0, 1, 0], mul(u, u[1])), 0.5)));     // bent up and out
    const K2 = add(H, add(mul(u, xk), mul(p, hk)));
    const R1 = turn(sub(K, H), sub(K2, H)), E1 = add(H, rot(R1, sub(E, H))), R2 = mm(turn(sub(E1, K2), sub(E2, K2)), R1);
    const shift = sub(E2, E);
    const name = (k) => bones.findIndex((bn) => bn.name === k + s);
    T[name('thigh')] = (q) => add(H, rot(R1, sub(q, H)));
    T[name('shin')] = (q) => add(K2, rot(R2, sub(q, K)));
    for (const k of ['foot', 'toes']) if (name(k) >= 0) T[name(k)] = (q) => add(q, shift);
    for (const k of ['ball', 'toe']) j[k + s] = add(j[k + s], shift);
    log[s + 'H'] = { reachBefore: +(dist(H, E) / (a + b)).toFixed(3), reachAfter: +(d / (a + b)).toFixed(3), kneeLift: +(K2[1] - K[1]).toFixed(3) };
    j['knee' + s] = K2; j['heel' + s] = E2;
  }
  const w2 = bind.w.length === n * 2;
  for (let i = 0; i < n; i++) {
    const q = [before[i * 3], before[i * 3 + 1], before[i * 3 + 2]], b0 = bind.idx[i * 2], b1 = bind.idx[i * 2 + 1];
    if (!T[b0] && !T[b1]) continue;
    const w0 = w2 ? bind.w[i * 2] : bind.w[i], w1 = w2 ? bind.w[i * 2 + 1] : 1 - w0;
    const p0 = T[b0] ? T[b0](q) : q, p1 = T[b1] ? T[b1](q) : q;
    for (let c = 0; c < 3; c++) pos[i * 3 + c] = (p0[c] * w0 + p1[c] * w1) / (w0 + w1 || 1);
  }
  const R = [];
  for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) {
    const A = idx[t + e] * 3, C = idx[t + (e + 1) % 3] * 3, l0 = Math.hypot(before[A] - before[C], before[A + 1] - before[C + 1], before[A + 2] - before[C + 2]);
    if (l0 > 1e-7) R.push(Math.hypot(pos[A] - pos[C], pos[A + 1] - pos[C + 1], pos[A + 2] - pos[C + 2]) / l0);
  }
  const Rs = Float64Array.from(R).sort();
  return { ...log, stretchP999: +Rs[Math.floor(Rs.length * 0.999)].toFixed(2), stretchMax: +Rs[Rs.length - 1].toFixed(2), over2x: R.filter((r) => r > 2).length };
}

// The skink's measure, then the hind-knee bake pose; `pos` is the bake's own array (bendHind writes it in place)
export function measureFiresal(pos, cfg = FIRESAL, idx = null) {
  const m = measureSkink(pos, cfg);
  m.ySole = Math.min(...Object.values(m.info).map((v) => v.sole));     // the limbs' soles (the tail tip lies lower)
  m.restJ = structuredClone(m.j);
  m.legReach = (J, u) => legReach(J, u, cfg);
  if (idx && cfg.hindReach) m.bend = bendHind(pos, idx, m.j, cfg);
  return m;
}
