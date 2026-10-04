// Runtime skeletons: the pose of a scanned animal's bones each frame, from the same state the vertex rig reads (gait phase, turning
// mix, hop, calm, swim pose: util/gait.js packAnim), as joint rotations inside the body plan's ranges (util/bodyplan.js), packed for
// the GPU (skin.js: one texture row an instance, the vertex shader blends two bones a vertex). docs/SKELETON.md.
//
// A skeleton comes from the bake (tools/bake-creature.mjs, manifest `skeleton`): { plan, bones: [{ name, parent, head, tail, limb, r }] }
// in cm of the model, head +z, feet on y = 0. Bones of tools/rig/skeleton.mjs frogBones: pelvis, spine, head; per side (L x < 0,
// R x > 0) thigh, shin, foot, toes (hind legs, rig ids 3 / 4) and arm, forearm, hand (front legs, 1 / 2).
//
// The legs (anuran):
//   feet     the toe (or finger) tip goes where the vertex rig puts it (the gait's lift and sweep, the turn's swing round the pivot:
//            util/turn.js footRig; walking, a hind foot is set a sweep further out from the hip than the sitting frog has it).
//            A hind leg turns about the hip as a whole and opens or closes its Z fold (knee and heel together) for the reach; a
//            foreleg reaches its hand, laid down as it rests and yawed with the turn, by two-bone IK (the elbow bends, no shear).
//   hop      the hind legs extend: the foot pitches back about the heel and the toe's target goes out behind the hip along the
//            line of the jump, to `reach` of the leg's whole length when fully extended (the rig's hop only slid the foot back).
//   swim     the rig's swim-pose offsets of the hand and foot (forelegs back along the flanks, the kick's splay), by the same IK.
//   limits   the knee / elbow and the heel / wrist are kept inside the plan's joint ranges; a target past them is not reached.
//   muscles  the plan's muscle bellies swell (or thin) with their joint's flexion against the rest pose: a radial scale of the bone
//            about its axis, so it costs nothing in the shader.
// The body (pelvis, spine, head) stays as it rests: a frog's trunk is stiff (bodyplan.js anuran: 0.06 of bend), and breathing, the
// throat and the eyes are the rig's, on the rest pose before the bones move it (render/creatures/instanced.js).

import { PLANS, bendAngle } from '../../util/bodyplan.js';

export const ROW_TEXELS = 64;                  // texels in an instance's row of the bone texture (RGBA float each)
export const BONE_TEXELS = 3;                  // a bone is an affine 3 x 4 matrix: three rows of [m0, m1, m2, t]
export const MAX_BONES = Math.floor(ROW_TEXELS / BONE_TEXELS);
export const ROW_FLOATS = ROW_TEXELS * 4;

const TAU = Math.PI * 2;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const addv = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
// 3 x 3 matrices as 9 numbers, row-major
const I3 = () => [1, 0, 0, 0, 1, 0, 0, 0, 1];
const mv = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
const mm = (a, b) => {
  const o = new Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return o;
};
// the rotation taking the orthonormal frame (a0, b0, a0 x b0) to (a1, b1, a1 x b1): F1 · F0ᵀ
function frameRot(a0, b0, a1, b1) {
  const c0 = cross(a0, b0), c1 = cross(a1, b1), o = new Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a1[r] * a0[c] + b1[r] * b0[c] + c1[r] * c0[c];
  return o;
}
const rotY = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };     // x' = x c + z s, z' = -x s + z c
const rotX = (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; };     // y' = y c - z s, z' = y s + z c
// the shortest-arc rotation turning unit a onto unit b (Rodrigues)
function arc(a, b) {
  const v = cross(a, b), c = dot(a, b), k = 1 / (1 + Math.max(c, -0.999999));
  return [c + v[0] * v[0] * k, v[0] * v[1] * k - v[2], v[0] * v[2] * k + v[1],
    v[1] * v[0] * k + v[2], c + v[1] * v[1] * k, v[1] * v[2] * k - v[0],
    v[2] * v[0] * k - v[1], v[2] * v[1] * k + v[0], c + v[2] * v[2] * k];
}

// rotation by angle t about unit axis n (Rodrigues)
function rotAxis(n, t) {
  const c = Math.cos(t), s = Math.sin(t), k = 1 - c, [x, y, z] = n;
  return [c + x * x * k, x * y * k - z * s, x * z * k + y * s, y * x * k + z * s, c + y * y * k, y * z * k - x * s, z * x * k - y * s, z * y * k + x * s, c + z * z * k];
}
// A hind leg's fold opened by `p` radians at the knee and at the heel each (negative: folded tighter), in the rest frame: the heel E,
// the toe tip T and the foot's rotation Rf (the shin's is Rk).
function fold(c, p) {
  const Rk = rotAxis(c.nk, -p), E = addv(c.K, mv(Rk, sub(c.E, c.K)));
  const Rh = rotAxis(mv(Rk, c.nh), -p), Rf = mm(Rh, Rk);
  return { Rk, Rf, E, T: addv(E, mv(Rf, sub(c.T, c.E))) };
}
const foldReach = (c, p) => len(sub(fold(c, p).T, c.A));

// The runtime form of a baked skeleton: indices, rest directions and lengths, the leg chains and the muscles. `anim`: the species'
// rig numbers ({ legLift, legStride, limb }) and its turning frame ({ pz, R }: render/creatures/instanced.js turnFinish). Returns
// null for a skeleton this runtime cannot pose (another plan, too many bones, a missing leg).
export function skeletonRig(skel, { legLift = 0.25, legStride = 0.35, limb = 1, turn = null, reach = 0.85 } = {}) {
  if (!skel?.bones?.length || skel.bones.length > MAX_BONES) return null;
  const plan = PLANS[skel.plan ?? 'anuran'];
  if (!plan || (skel.plan ?? 'anuran') !== 'anuran') return null;
  const B = skel.bones, n = B.length, byName = Object.fromEntries(B.map((b, i) => [b.name, i]));
  const head = B.map((b) => b.head), tail = B.map((b) => b.tail);
  const dir = B.map((b) => norm(sub(b.tail, b.head))), L = B.map((b) => len(sub(b.tail, b.head)));
  const parent = B.map((b) => (b.parent != null ? byName[b.parent] ?? -1 : -1));
  const chains = [];
  for (const [s, fore, hind] of [['L', 1, 3], ['R', 2, 4]]) {
    const H = ['thigh', 'shin', 'foot', 'toes'].map((k) => byName[k + s]), F = ['arm', 'forearm', 'hand'].map((k) => byName[k + s]);
    if (H.some((i) => i == null) || F.some((i) => i == null)) return null;
    for (const [limbId, [u, w, ...ends]] of [[hind, H], [fore, F]]) {
      const A = head[u], K = head[w], E = head[ends[0]], T = tail[ends[ends.length - 1]];
      // the leg's plane: the line from the root to the hand / foot and the side the knee / elbow points to
      const ab = norm(sub(E, A)), kp = sub(K, A), pole = norm(sub(kp, mul(ab, dot(kp, ab))));
      // (and the hind leg's hip-heel-toe triangle: its plane and the directions of its two sides)
      const n0 = norm(cross(sub(E, A), sub(T, E)));
      // (the knee's and the heel's hinge axes, for the fold: across the thigh-shin and the shin-foot planes)
      const nk = norm(cross(sub(K, A), sub(E, K))), nh = norm(cross(sub(E, K), sub(T, E)));
      chains.push({ limb: limbId, hind: limbId >= 3, side: s === 'L' ? -1 : 1, u, w, ends, A, K, E, T, ab, pole, nrm0: norm(cross(ab, pole)),
        n0, dAE0: norm(sub(E, A)), dET0: norm(sub(T, E)), dh: len(sub(E, A)), Lf: len(sub(T, E)), nk, nh, reach0: len(sub(T, A)), out: norm([T[0] - A[0], 0, T[2] - A[2]]),
        Lu: L[u], Lw: L[w], Ltot: L[u] + L[w] + ends.reduce((t, e) => t + L[e], 0), ext: norm([s === 'L' ? -0.3 : 0.3, 0.1, -1]) });
    }
  }
  // muscles: a belly on `bone` swells with the flexion of `joint` (the bend of that bone against its parent) against the rest pose
  const muscles = [];
  for (const m of plan.muscles) {
    if (!m.gain || !m.joint) continue;
    for (const s of ['L', 'R', '']) {
      const b = byName[m.bone + s], j = byName[m.joint + s];
      if (b == null || j == null || parent[j] < 0) continue;
      const lim = plan.joints[m.joint];
      if (!lim) continue;
      const flex0 = clamp((bendAngle(dir[parent[j]], dir[j]) - lim.min) / (lim.max - lim.min), 0, 1);
      // radial swell per unit of flexion: the belly's gain in bone lengths over the bone's radius, the belly's mean profile (1/2)
      const k = (m.gain * L[b] * (m.to - m.from) * 0.5) / Math.max(0.02, B[b].r ?? 0.1);
      muscles.push({ b, j, lim, flex0, k });
    }
  }
  return { n, B, byName, head, tail, dir, L, parent, chains, muscles, plan, legLift, legStride, limb, turn, reach,
    limits: B.map((b) => plan.joints[b.name.replace(/[LR]$/, '')] ?? null) };
}

// The foot's offset as the vertex rig draws the tip of a leg (render/creatures/instanced.js; util/turn.js footRig), and the turn's
// yaw at that foot: { off: [x, y, z] (gait + pose), gait (the walk's lift and sweep), pose (the swim pose's), yaw, lift (0 … 1 of the swing) }.
export function footOffset(rig, limbId, side, phase, tau, calm, hop, pose) {
  const diag = limbId === 1 || limbId === 4;
  const lp = phase + (diag ? 0 : Math.PI), go = 1 - calm;
  const sl = Math.max(Math.sin(lp), 0), u = lp / TAU - Math.floor(lp / TAU);
  const sn = u < 0.5 ? -Math.cos(u * TAU) : 3 - 4 * u;
  const gait = [0, sl * rig.legLift * go, sn * rig.legStride * go * (1 - Math.abs(tau))];
  const yaw = rig.turn?.R ? (sn * go * tau * rig.legStride) / rig.turn.R : 0;
  const lm = rig.limb, ps = [0, 0, 0];
  if (limbId >= 3) {
    const kick = hop * (1 - hop) * 4 * 0.55 * lm - hop * hop * 0.35 * lm;
    ps[0] += side * kick * pose;
  } else {
    ps[2] -= 0.9 * lm * pose; ps[1] += 0.5 * lm * pose; ps[0] -= side * 0.45 * lm * pose;
  }
  return { off: addv(gait, ps), gait, pose: ps, yaw, lift: sl * go, go };
}

// One instance's bones for a pose state `st` = { phase (gait, rad), tau (turning mix -1 … 1), hop (0 … 1), calm (0 … 1), pose (0 … 1) }:
// writes 12 floats a bone (rows of [R | t], posed = R · rest + t) into `out` from `o`. Returns `info` (if given) with each limb's
// reached tip and whether a joint limit held it ({ tips, clamped }), for the tests.
export function poseBones(rig, st, out, o = 0, info = null) {
  const { n, head, dir, chains, muscles, limits, turn } = rig;
  const R = new Array(n), H = new Array(n);
  for (let b = 0; b < n; b++) { R[b] = I3(); H[b] = head[b]; }
  const hop = clamp(st.hop ?? 0, 0, 1), calm = clamp(st.calm ?? 0, 0, 1), pose = clamp(st.pose ?? 0, 0, 1), tau = st.tau ?? 0;
  const pz = turn?.pz ?? 0;
  if (info) { info.tips = {}; info.clamped = []; }
  for (const c of chains) {
    const f = footOffset(rig, c.limb, c.side, st.phase ?? 0, tau, calm, hop, pose);
    const A = c.A, legT0 = sub(c.T, c.E);
    // Where the rig puts the toe tip (the hand's tip): the walk's lift and sweep and the swim pose's offset, swung round the pivot by
    // the turn (a planted foot stays put while the body turns over it).
    let Tg = addv(c.T, f.off);
    // (walking, a hind foot is set down a stride's sweep further out from the hip than it sits: the sitting frog's leg is folded as far
    // as it goes, so the foot could not come back along the body toward the hip without the knee folding past its range)
    if (c.hind) Tg = addv(Tg, mul(c.out, rig.legStride * f.go));
    if (f.yaw) { const x = Tg[0], z = Tg[2] - pz, cy = Math.cos(f.yaw), sy = Math.sin(f.yaw); Tg = [x * cy + z * sy, Tg[1], -x * sy + z * cy + pz]; }
    let K1, E1, Rf;
    if (c.hind) {
      // A frog's hind leg sits folded in a Z, the heel close to the hip, so no two-bone IK will do (the hip-heel line is short: a
      // small step would swing the knee far). The step is a turn of the whole leg about the hip (a ball joint) and the reach it
      // needs a little more or less fold, shared by the knee and the heel: the folds open or close together until the toe tip is
      // as far from the hip as its target, then the leg turns about the hip to point the toe at it.
      const D = len(sub(Tg, A));
      let p0 = 0, r0 = c.reach0 - D, p1 = 0.15, r1 = foldReach(c, p1) - D;
      for (let it = 0; it < 5 && Math.abs(r1) > 1e-4; it++) {
        const p2 = clamp(p1 - (r1 * (p1 - p0)) / (r1 - r0 || 1e-9), -0.35, 1.2);
        p0 = p1; r0 = r1; p1 = p2; r1 = foldReach(c, p1) - D;
      }
      const F = fold(c, p1), Rhip = arc(norm(sub(F.T, A)), norm(sub(Tg, A)));
      E1 = addv(A, mv(Rhip, sub(F.E, A)));
      Rf = mm(Rhip, F.Rf);
      K1 = addv(A, mv(Rhip, sub(c.K, A)));
      Tg = addv(A, mv(Rhip, sub(F.T, A)));
    } else { Rf = rotY(f.yaw); K1 = c.K; }
    // A hop: the hind leg extends from there (the toe's target goes out behind the hip along the line of the jump, the foot
    // swinging back about the heel until it trails behind the leg); knee and elbow by two-bone IK toward where they were.
    const ext = c.hind ? hop : 0;
    let Rend = ext > 0 ? mm(Rf, rotX(ext * 2.6)) : Rf;
    const T2 = ext > 0 ? addv(mul(Tg, 1 - ext), mul(addv(A, mul(c.ext, c.Ltot * rig.reach)), ext)) : Tg;
    const s2 = ik2(A, sub(T2, mv(Rend, legT0)), c.Lu, c.Lw, sub(K1, A));
    const K = s2.K;
    let E = s2.E, dU = norm(sub(K, A)), dW = norm(sub(E, K));
    // joint ranges: the knee (elbow) between the long bones, the heel (wrist) between the shin and the foot
    const limW = limits[c.w], limE = limits[c.ends[0]];
    if (limW) {
      const a = bendAngle(dU, dW), want = clamp(a, limW.min, limW.max);
      if (Math.abs(want - a) > 1e-3) { dW = norm(rotateToward(dU, dW, want)); E = addv(K, mul(dW, c.Lw)); if (info) info.clamped.push(rig.B[c.w].name); }
    }
    const nrm1 = norm(cross(s2.u, s2.v));
    R[c.u] = frameRot(dir[c.u], norm(cross(c.nrm0, dir[c.u])), dU, norm(cross(nrm1, dU)));
    R[c.w] = frameRot(dir[c.w], norm(cross(c.nrm0, dir[c.w])), dW, norm(cross(nrm1, dW)));
    H[c.w] = K;
    if (limE) {
      const fd = mv(Rend, dir[c.ends[0]]), a = bendAngle(dW, fd), want = clamp(a, limE.min, limE.max);
      if (Math.abs(want - a) > 1e-3) { Rend = mm(arc(fd, norm(rotateToward(dW, fd, want))), Rend); if (info) info.clamped.push(rig.B[c.ends[0]].name); }
    }
    for (const e of c.ends) { R[e] = Rend; H[e] = addv(E, mv(Rend, sub(head[e], c.E))); }
    if (info) info.tips[c.limb] = addv(E, mv(Rend, legT0));
  }
  // muscles: radial swell of a bone about its rest axis, S = I + k (I - d dᵀ), applied before the bone's rotation
  const S = new Array(n).fill(null);
  for (const m of muscles) {
    const pj = rig.parent[m.j];
    const a = bendAngle(mv(R[pj], dir[pj]), mv(R[m.j], dir[m.j]));
    const flex = clamp((a - m.lim.min) / (m.lim.max - m.lim.min), 0, 1);
    const k = clamp((flex - m.flex0) * m.k, -0.08, 0.2);
    if (Math.abs(k) < 1e-4) continue;
    const d = dir[m.b];
    S[m.b] = [1 + k - k * d[0] * d[0], -k * d[0] * d[1], -k * d[0] * d[2], -k * d[1] * d[0], 1 + k - k * d[1] * d[1], -k * d[1] * d[2], -k * d[2] * d[0], -k * d[2] * d[1], 1 + k - k * d[2] * d[2]];
  }
  for (let b = 0; b < n; b++) {
    const M = S[b] ? mm(R[b], S[b]) : R[b], t = sub(H[b], mv(M, head[b])), p = o + b * 12;
    out[p] = M[0]; out[p + 1] = M[1]; out[p + 2] = M[2]; out[p + 3] = t[0];
    out[p + 4] = M[3]; out[p + 5] = M[4]; out[p + 6] = M[5]; out[p + 7] = t[1];
    out[p + 8] = M[6]; out[p + 9] = M[7]; out[p + 10] = M[8]; out[p + 11] = t[2];
  }
  return info;
}

// Two-bone IK: from root A toward target E with bone lengths a and b, the joint on its circle at the point nearest A + `toward`. The
// target is brought within reach. Returns { K (the joint), E (the end reached), u (A to E), v (A's side of the joint, across u) }.
// `yWant` (optional): of the joint's circle, the point at that height (the nearer to `toward` of the two), or as near it as the
// circle goes.
function ik2(A, E, a, b, toward, yWant = null) {
  const dAE = sub(E, A);
  let d = len(dAE);
  const u = d > 1e-6 ? mul(dAE, 1 / d) : norm(toward);
  const dmax = (a + b) * 0.999, dmin = Math.abs(a - b) + 1e-3;
  if (d > dmax || d < dmin) { d = clamp(d, dmin, dmax); E = addv(A, mul(u, d)); }
  let v = sub(toward, mul(u, dot(toward, u)));
  v = len(v) > 1e-6 ? norm(v) : norm(cross(u, Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  const ca = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1), sa = Math.sqrt(1 - ca * ca);
  if (yWant != null) {
    // the circle: centre C, radius r, in the plane across u spanned by v and w; y(t) = C.y + r (v.y cos t + w.y sin t)
    const w = cross(u, v), C = addv(A, mul(u, a * ca)), r = a * sa, m = r * Math.hypot(v[1], w[1]);
    if (m > 1e-6) {
      const ph = Math.atan2(w[1], v[1]), k = Math.acos(clamp((yWant - C[1]) / m, -1, 1));
      // of t = ph ± k, the one nearer t = 0 (the side of `toward`)
      const wrap = (t) => Math.atan2(Math.sin(t), Math.cos(t)), t1 = wrap(ph + k), t2 = wrap(ph - k), t = Math.abs(t1) < Math.abs(t2) ? t1 : t2;
      const vv = addv(mul(v, Math.cos(t)), mul(w, Math.sin(t)));
      return { K: addv(C, mul(vv, r)), E, u, v: vv };
    }
  }
  return { K: addv(A, mul(addv(mul(u, ca), mul(v, sa)), a)), E, u, v };
}

// `child` turned in the plane of it and `parentDir` so the angle between them is `deg` (bodyplan.js limitDir, unit vectors).
function rotateToward(parentDir, child, deg) {
  const p = norm(parentDir), c = norm(child);
  let q = sub(c, mul(p, dot(p, c)));
  if (len(q) < 1e-9) q = Math.abs(p[1]) < 0.9 ? [p[2], 0, -p[0]] : [0, -p[2], p[1]];
  q = norm(q);
  const r = (deg * Math.PI) / 180;
  return addv(mul(p, Math.cos(r)), mul(q, Math.sin(r)));
}

// A packed bone applied to a point (the shader's arithmetic, for the tests): rows of [R | t] at `o + bone * 12`.
export function applyBone(row, o, b, p) {
  const k = o + b * 12;
  return [0, 1, 2].map((r) => row[k + r * 4] * p[0] + row[k + r * 4 + 1] * p[1] + row[k + r * 4 + 2] * p[2] + row[k + r * 4 + 3]);
}

// Rows of the shared bone texture, handed out in runs: each skinned mesh holds one run (an instance's row is the run's start + its
// index), freed when the mesh goes. `take(k)` returns the first row of a free run of k, or -1 when none is left.
export class RowAllocator {
  constructor(rows) { this.used = new Uint8Array(rows); }
  take(k) {
    const u = this.used;
    for (let s = 0, run = 0; s < u.length; s++) {
      run = u[s] ? 0 : run + 1;
      if (run === k) { u.fill(1, s - k + 1, s + 1); return s - k + 1; }
    }
    return -1;
  }
  free(start, k) { if (start >= 0) this.used.fill(0, start, start + k); }
}
