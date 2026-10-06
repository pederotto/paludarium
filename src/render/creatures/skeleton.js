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
//   swim     the rig's swim-pose offsets of the hand and foot (forelegs out to the sides, the kick's splay), by the same IK;
//            the kick extends the hind legs like a hop but along the trunk's line (swimExt), so they trail behind the level body.
//   limits   the knee / elbow and the heel / wrist are kept inside the plan's joint ranges; a target past them is not reached.
//   muscles  the plan's muscle bellies swell (or thin) with their joint's flexion against the rest pose: a radial scale of the bone
//            about its axis, so it costs nothing in the shader.
// The swimming body (a skeleton with `bind: 'swim'`: the frog scanned mid-stroke, limbs apart, tools/bake-frogpose.mjs) is posed by
// the stroke instead (poseStroke below): every limb bone pointed by the stroke's joint angles (util/gait.js strokeAngles, armAngles).
// The body (pelvis, spine, head) stays as it rests: a frog's trunk is stiff (bodyplan.js anuran: 0.06 of bend), and breathing, the
// throat and the eyes are the rig's, on the rest pose before the bones move it (render/creatures/instanced.js).

import { PLANS, bendAngle } from '../../util/bodyplan.js';
import { strokeAngles, armAngles, HIND, FORE } from '../../util/gait.js';
import { lizardRig } from './lizardpose.js';
import { bellyRig, writeBellies, MUSCLE_TEXEL0, MUSCLE_PAIR } from './muscles.js';
export { MUSCLE_TEXEL0, MUSCLE_PAIR };

export const ROW_TEXELS = 88;                  // texels in an instance's row of the bone texture (RGBA float each): 22 frog bones (66 texels: 17 to 22, the red-eyed tree frog's fingers and shoulder girdle) then 22 belly texels; a lizard's 25 bones fit too
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
const lerpN = (a, b, t) => a + (b - a) * t;
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
const rotZ = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };     // x' = x c - y s, y' = x s + y c
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
export function skeletonRig(skel, { legLift = 0.25, legStride = 0.35, limb = 1, turn = null, reach = 0.85, muscles = false } = {}) {
  if (!skel?.bones?.length || skel.bones.length > MAX_BONES) return null;
  const plan = PLANS[skel.plan ?? 'anuran'];
  if (skel.plan === 'lizard') return lizardRig(skel, { legLift, legStride, limb, turn, reach }, { musclesOf, writeBones, footOffset });
  if (!plan || (skel.plan ?? 'anuran') !== 'anuran') return null;
  const B = skel.bones, n = B.length, byName = Object.fromEntries(B.map((b, i) => [b.name, i]));
  const head = B.map((b) => b.head), tail = B.map((b) => b.tail);
  const dir = B.map((b) => norm(sub(b.tail, b.head))), L = B.map((b) => len(sub(b.tail, b.head)));
  const parent = B.map((b) => (b.parent != null ? byName[b.parent] ?? -1 : -1));
  if (skel.bind === 'swim') {
    // The swimming body: each limb a chain of bones from its root, and for every bone the side of it that faces the frog's back as
    // it was scanned (a bone keeps that side up as the stroke points it elsewhere, so a leg swings without twisting).
    const limbs = [];
    for (const [s, side] of [['L', -1], ['R', 1]]) {
      for (const [hind, names] of [[true, ['thigh', 'shin', 'foot', 'toes']], [false, ['arm', 'forearm', 'hand', ...(byName['fingers' + s] != null ? ['fingers'] : [])]]]) {
        const bones = names.map((k) => byName[k + s]);
        if (bones.some((i) => i == null)) return null;
        // (`sc`: the scapula a 22-bone frog's arm hangs from; `fingers` is the last bone of an arm that has them)
        limbs.push({ side, hind, limb: B[bones[0]].limb, bones, sc: hind ? null : byName['scapula' + s] ?? null, u0: bones.map((b) => across(dir[b], UP)) });
      }
    }
    // (with a muscle binding the bellies replace the bones' radial swell: render/creatures/muscles.js)
    const belly = muscles ? bellyRig(skel) : null;
    return { n, B, byName, head, tail, dir, L, parent, limbs, muscles: belly ? [] : musclesOf(plan, B, byName, parent, dir, L), belly, plan, stroke: true,
      limits: B.map((b) => plan.joints[b.name.replace(/[LR]$/, '')] ?? null) };
  }
  // The trunk's line as baked (pelvis to head): a scanned frog sits nose up, so "behind the body" is down and back in the model.
  const tf = byName.pelvis != null && byName.head != null ? norm(sub(head[byName.head], head[byName.pelvis])) : [0, 0, 1];
  const ventral = norm([0, -tf[2], tf[1]]);
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
        Lu: L[u], Lw: L[w], Ltot: L[u] + L[w] + ends.reduce((t, e) => t + L[e], 0), ext: norm([s === 'L' ? -0.3 : 0.3, 0.1, -1]),
        // swimming, the legs trail straight back along the trunk, a little under it and open in a V (the user's swimming photo)
        swimExt: norm(addv(addv(mul(tf, -1), mul(ventral, 0.12)), [s === 'L' ? -0.42 : 0.42, 0, 0])) });
    }
  }
  const belly = muscles ? bellyRig(skel) : null;
  return { n, B, byName, head, tail, dir, L, parent, chains, muscles: belly ? [] : musclesOf(plan, B, byName, parent, dir, L), belly, plan, legLift, legStride, limb, turn, reach, ventral,
    limits: B.map((b) => plan.joints[b.name.replace(/[LR]$/, '')] ?? null) };
}

// muscles: a belly on `bone` swells with the flexion of `joint` (the bend of that bone against its parent) against the rest pose
function musclesOf(plan, B, byName, parent, dir, L) {
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
  return muscles;
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
    ps[2] -= 0.25 * lm * pose; ps[1] += 0.6 * lm * pose; ps[0] += side * 1.4 * lm * pose;   // (held out to the side, a little forward: swimming and floating frogs in the user's photos; the vertex rig's numbers)
  }
  return { off: addv(gait, ps), gait, pose: ps, yaw, lift: sl * go, go };
}

// One instance's bones for a pose state `st` = { phase (gait, rad), tau (turning mix -1 … 1), hop (0 … 1), calm (0 … 1), pose (0 … 1) }:
// writes 12 floats a bone (rows of [R | t], posed = R · rest + t) into `out` from `o`. Returns `info` (if given) with each limb's
// reached tip and whether a joint limit held it ({ tips, clamped }), for the tests.
export function poseBones(rig, st, out, o = 0, info = null) {
  if (rig.pose) return rig.pose(rig, st, out, o, info);
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
    // (in the water a frog draws its legs up beside its flanks, not under its belly as it sits: the foot comes up toward the hip's
    // level, along the trunk's ventral line, so a folded leg in the stroke's recovery does not read as a frog sitting in the water)
    if (c.hind && pose > 0) { const dv = dot(sub(Tg, A), rig.ventral); if (dv > 0) Tg = addv(Tg, mul(rig.ventral, -dv * 0.8 * pose)); }
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
    // (in the water the line is the trunk's, not the jump's: the body is laid level, so the jump's line would lift the legs out of it)
    const xd = c.hind && pose > 0 ? norm(addv(mul(c.ext, 1 - pose), mul(c.swimExt, pose))) : c.ext;
    const T2 = ext > 0 ? addv(mul(Tg, 1 - ext), mul(addv(A, mul(xd, c.Ltot * rig.reach)), ext)) : Tg;
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
  writeBones(rig, R, H, out, o, st);
  return info;
}

// The bones' matrices packed for the GPU: 12 floats a bone (rows of [R | t], posed = R · rest + t) into `out` from `o`, each bone
// turned by R[b] about its head, now at H[b]; the muscles swell first.
function writeBones(rig, R, H, out, o, st = null) {
  const { n, head, dir, muscles } = rig;
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
  if (rig.belly) writeBellies(rig.belly, R, H, head, out, o, st, !!rig.stroke);
}

// --- The swimming body's stroke ----------------------------------------------------------------------------------------------------
const UP = [0, 1, 0], RAD = Math.PI / 180;
// the unit vector across `d` nearest to `up`
function across(d, up) {
  const k = dot(up, d), v = [up[0] - d[0] * k, up[1] - d[1] * k, up[2] - d[2] * k];
  return len(v) > 1e-6 ? norm(v) : norm(cross(d, [1, 0, 0]));
}
// A segment's direction from its two angles (util/gait.js HIND, degrees): `th` from straight back (-z) out to its side (x) and
// round to straight forward (+z), `ph` its lift toward the back (+y).
function segDir(th, ph, side) {
  const c = Math.cos(ph * RAD);
  return [side * Math.sin(th * RAD) * c, Math.sin(ph * RAD), -Math.cos(th * RAD) * c];
}
const _hind = new Float32Array(9), _fore = new Float32Array(6), _hind2 = new Float32Array(9), _fore2 = new Float32Array(6), _fore4 = new Float32Array(8);
// A frog between strokes, for a swimming body drawn without one: legs trailing, forelegs half out.
export const GLIDING = { pL: 0.45, pR: 0.45, ampL: 1, ampR: 1, float: 0, scull: 0, arms: 0.35, push: 0 };

// Trunk channel signs (the game's own senses; the twist sign is a guess): yaw positive turns the head toward +x (the frog's right, as
// the sim's a.yaw = atan2(dx, dz)); pitch positive tips the nose DOWN (util/gait.js swimPose); twist positive sinks the right side
// (+x). Order: twist about the bone's own axis first, then pitch, then yaw, about the bone's head (its joint). The head bone turns
// about its own head point, carried by the spine's turn (the bones do not chain: the baked head joint lies 0.35 cm (toad) ahead of
// the spine's tail, accepted as baked). The arms hang from the spine and turn with it; the pelvis and the hind legs stay.
const _ltr = (a, lim) => clamp(a || 0, lim ? lim[0] : -90, lim ? lim[1] : 90) * RAD;
const trunkRot = (d, y, p, t) => mm(rotY(y), mm(rotX(p), rotAxis(d, -t)));
function trunkQ(rig, s) {
  const T = s.trunk;
  if (!T || !rig.byName || rig.byName.spine == null || rig.byName.head == null) return null;
  let any = false; for (let i = 0; i < 6; i++) if (T[i]) any = true;
  if (!any) return null;
  const rh = rig.plan?.rom?.head, sb = rig.byName.spine, hb = rig.byName.head, bB = rig.byName.spineB;
  const Qh = trunkRot(rig.dir[hb], _ltr(T[3], rh?.yaw), _ltr(T[4], rh?.pitch), _ltr(T[5], rh?.twist));
  if (bB == null) {   // (17 bones: one trunk joint, as before)
    const rs = rig.plan?.rom?.spine, Qs = trunkRot(rig.dir[sb], _ltr(T[0], rs?.yaw), _ltr(T[1], rs?.pitch), _ltr(T[2], rs?.twist));
    const Js = rig.head[sb];
    return { Qs, Q0: Qs, Qh, Js, J0: Js, at: (p) => addv(Js, mv(Qs, sub(p, Js))) };
  }
  // T4: spine and spineB, the total (clamped to rom.spineB) shared half and half; spineB turns about its own head point, carried by the spine
  const rt = rig.plan?.rom?.spineB ?? { yaw: [-35, 35], pitch: [-25, 25], twist: [-25, 25] };
  const y = _ltr(T[0], rt.yaw) / 2, p = _ltr(T[1], rt.pitch) / 2, t = _ltr(T[2], rt.twist) / 2;
  const Q0 = trunkRot(rig.dir[sb], y, p, t), J0 = rig.head[sb], JB = addv(J0, mv(Q0, sub(rig.head[bB], J0)));
  const Qs = mm(Q0, trunkRot(rig.dir[bB], y, p, t));
  return { Qs, Q0, Qh, Js: JB, J0, at: (q) => addv(JB, mv(Qs, sub(q, rig.head[bB]))) };   // (`at`, Qs: the front half, spineB's turn)
}
// the roll (degrees, clamped to the plan's rom) of limb bone i of limb c: fore forearm (1) and hand (2), hind thigh (0)
function rollOf(rig, c, i, roll, left) {
  const rom = rig.plan?.rom;
  const nm = c.hind ? (i === 0 ? 'thigh' : null) : i === 1 ? 'forearm' : i === 2 ? 'hand' : null;
  if (!nm) return 0;
  const v = c.hind ? roll[left ? 4 : 5] : roll[(left ? 0 : 2) + (i - 1)], lim = rom?.[nm]?.roll;
  return v ? clamp(v, lim ? lim[0] : -90, lim ? lim[1] : 90) : 0;
}

// A limb's joint angles in the stroke `s` (a hop's legA, a spin's armA, or the stroke clock's two legs and the arms), written to the given buffers.
function limbAngles(c, left, s, hb, fb) {
  if (c.hind && s.legA) return s.legA.length >= 18 ? s.legA.subarray(left ? 0 : 9, left ? 9 : 18) : s.legA;   // (a hop gives each leg its own: util/gait.js leapPose)
  if (!c.hind && s.armA) return s.armA.length >= 12 ? s.armA.slice(left ? 0 : 6, left ? 6 : 12) : s.armA;   // (12 numbers: left then right, like legA)
  if (c.hind) {
    const A = strokeAngles(left ? s.pL : s.pR, hb, 0, left ? s.ampL : s.ampR, s.float, s.floatPose);
    // (floating, the legs scull gently about their spread, one side then the other)
    if (s.float > 0) { const w = s.float * (s.scull ?? 0) * (left ? 1 : -1) * 60; A[0] += w; A[1] += w * 0.6; A[2] -= w * 0.8; }
    return A;
  }
  return armAngles(s.arms, fb, 0, s.float, s.floatPose);
}

// One instance of the swimming body (a rig from a `bind: 'swim'` skeleton) in the stroke `st` (util/gait.js swimPose().stroke:
// { pL, pR (each hind leg's phase), ampL, ampR (how fully it kicks), float, scull, arms (0 laid back … 1 held out) }, or a leap's
// { legA, armA }: the angles themselves): every limb
// bone pointed by its joint angles from the limb's root outward, keeping its length and the side it turns to the frog's back.
// Writes the bones like poseBones; `info` (if given) gets each limb's tip and the bend of every joint, for the tests.
export function poseStroke(rig, st, out, o = 0, info = null) {
  const { n, head, dir, L, limbs } = rig, s = st ?? GLIDING;
  const R = new Array(n), H = new Array(n);
  for (let b = 0; b < n; b++) { R[b] = I3(); H[b] = head[b]; }
  if (info) {
    info.tips = {}; info.bend = {};
    // (the body as spheres, for the water it moves: [x, y, z, radius] in the model's cm: the trunk here, the limbs' joints below)
    const P = (info.hull ??= []); P.length = 0;
    for (const nm of ['pelvis', 'spine', 'head']) { const b = rig.byName[nm]; if (b != null) P.push([(head[b][0] + rig.tail[b][0]) / 2, (head[b][1] + rig.tail[b][1]) / 2, (head[b][2] + rig.tail[b][2]) / 2, (rig.B[b].r ?? 0.3) * 0.85]); }
  }
  // The trunk's channels (stroke.trunk, degrees: [spine yaw, pitch, twist, head yaw, pitch, twist]; absent or all zero = the body as it
  // rests, byte for byte) and the limb rolls (stroke.roll: [forearmL, handL, forearmR, handR, thighL, thighR]), each clamped to the plan's rom.
  const tq = trunkQ(rig, s);
  for (const c of limbs) {
    const left = c.side < 0, k = c.bones.length, hull0 = info ? info.hull.length : 0;
    let A = limbAngles(c, left, s, _hind, _fore);
    // (a stroke with a `blend` (util/gait.js swimPose: into and out of a spin) is a mix of two poses, `bw` of the blend's, so no limb pops)
    if (s.blend && s.bw > 0) { const B = limbAngles(c, left, s.blend, _hind2, _fore2), k = Math.min(1, s.bw); for (let i = 0; i < A.length; i++) A[i] += (B[i] - A[i]) * k; }
    // (sitting on the bottom: the legs folded and the hands down, as it sits on land)
    if (s.sit > 0 && !s.legA) { const to = c.hind ? HIND.fold : FORE.stand; for (let i = 0; i < to.length; i++) A[i] += (to[i] - A[i]) * s.sit; }
    // (a 22-bone frog's fingers continue the hand: bent toward the belly by the stroke's `fcurl` [left, right], in degrees: the pad peeling or pressed, the
    // fingers curled; and its scapula turns about the back's point by `scap` [protraction left, elevation left, protraction right, elevation right], which lifts
    // and swings the shoulder the arm hangs from: the reach overhead)
    if (!c.hind && k === 4) { const F = _fore4; for (let i = 0; i < 3; i++) { F[i] = A[i]; F[4 + i] = A[3 + i]; } F[3] = A[2]; F[7] = A[5] - (s.fcurl ? s.fcurl[left ? 0 : 1] : 0); A = F; }
    let J = head[c.bones[0]], dPrev = null;
    if (c.sc != null) {
      const sc = c.sc, pr = s.scap ? s.scap[left ? 0 : 2] : 0, el = s.scap ? s.scap[left ? 1 : 3] : 0;
      R[sc] = mm(rotZ(c.side * el * RAD), rotY(-c.side * pr * RAD)); H[sc] = head[sc];
      J = addv(head[sc], mv(R[sc], sub(head[c.bones[0]], head[sc])));
    }
    // (a hind leg still pushing in a hop's launch: its toes stay where they were planted; util/gait.js leapPose, util/hop.js hopFrame)
    const P = c.hind ? plantDirs(rig, c, A, s) : null;
    for (let i = 0; i < k; i++) {
      const b = c.bones[i], d1 = P ? P[i] : segDir(A[i], A[k + i], c.side);
      // (a hop turns each bone by the shortest arc from its rest, so nothing rolls about its length but the foot's roll; the swimming
      // stroke keeps each bone's back up, as approved)
      let u1 = s.hop ? mv(arc(dir[b], d1), c.u0[i]) : across(d1, UP);
      // (the foot rolls about its own length: the web upright as it pushes, flat as it trails)
      if (c.hind && i >= 2 && A[8]) u1 = mv(rotAxis(d1, A[8] * RAD * c.side), u1);
      // (a segment's roll about its own axis: the thigh, the forearm, the hand; the chain's joints do not move)
      if (s.roll) { const rl = rollOf(rig, c, i, s.roll, left); if (rl) u1 = mv(rotAxis(d1, rl * RAD * c.side), u1); }
      R[b] = frameRot(dir[b], c.u0[i], d1, u1);
      H[b] = J;
      J = addv(J, mul(d1, L[b]));
      if (info && dPrev) info.bend[rig.B[b].name] = bendAngle(dPrev, d1);
      // (each bone's far end: the knee, the heel, the foot and the toes; the elbow, the wrist and the hand)
      if (info) info.hull.push([J[0], J[1], J[2], Math.max(0.12, (rig.B[b].r ?? 0.15) * (c.hind && i >= 2 ? 2.2 : 1.1))]);    // (a foot is a paddle: its web is wider than its bone)
      dPrev = d1;
    }
    // (in a hop no limb goes through the floor: a limb reaching below it turns up about its root just enough to rest on it, as a
    // limb pressing on the ground does; util/hop.js frames carry the body's place, so the floor is known in the model's terms)
    if (s.frames) J = floorLimb(c, R, H, J, head[c.bones[0]], s.frames.ft);
    // (an arm hangs from the spine: it turns with it, about the spine's joint)
    if (tq && !c.hind) {
      for (const b of c.bones) { R[b] = mm(tq.Qs, R[b]); H[b] = tq.at(H[b]); }
      if (c.sc != null) { R[c.sc] = mm(tq.Qs, R[c.sc]); H[c.sc] = tq.at(H[c.sc]); }
      J = tq.at(J);
      if (info) for (let h = hull0; h < info.hull.length; h++) { const q = tq.at(info.hull[h]); info.hull[h][0] = q[0]; info.hull[h][1] = q[1]; info.hull[h][2] = q[2]; }
    }
    if (info) info.tips[c.limb] = J;
  }
  if (tq) {
    const sb = rig.byName.spine, hb = rig.byName.head;
    R[sb] = tq.Q0; H[sb] = tq.J0;
    if (rig.byName.spineB != null) { R[rig.byName.spineB] = tq.Qs; H[rig.byName.spineB] = tq.Js; }
    R[hb] = mm(tq.Qs, tq.Qh); H[hb] = tq.at(head[hb]);
    if (info) {
      const hu = info.hull, c1 = tq.at(hu[1]), c2 = addv(H[hb], mv(R[hb], sub(hu[2], head[hb])));
      hu[1][0] = c1[0]; hu[1][1] = c1[1]; hu[1][2] = c1[2]; hu[2][0] = c2[0]; hu[2][1] = c2[1]; hu[2][2] = c2[2];
    }
  }
  writeBones(rig, R, H, out, o, s);
  return info;
}

// A limb's bones (R, H, its tip J) turned up about the limb's root until no joint and not the tip lies below the floor (in the hop's
// frame `fr`: the take-off ground at 0, the landing ground at the plan's rise); returns the tip.
function floorLimb(c, R, H, J, root, fr) {
  // (the take-off ground through the launch, the landing ground from mid-flight: a hop up onto a stone lands higher)
  const at = fr.at, floor = !at || at.phase === 'launch' || (at.phase === 'flight' && at.u < 0.5) ? 0 : fr.plan?.rise ?? 0;
  const pts = () => [...c.bones.slice(1).map((b) => H[b]), J];
  const upM = norm(sub(fr.toModel([fr.pos[0], fr.pos[1] + 1, fr.pos[2]]), fr.toModel(fr.pos)));
  for (let it = 0; it < 4; it++) {
    const P = pts(), ys = P.map((p) => fr.toWorld(p)[1] - floor), lo = Math.min(...ys);
    if (lo >= 0) break;
    const k = ys.indexOf(lo), arm = sub(P[k], root), reach = len(arm);
    if (reach < 1e-4) break;
    const ax = norm(cross(arm, upM));
    if (len(ax) < 1e-6) break;
    const Q = rotAxis(ax, Math.min(0.6, (-lo / reach) * 1.05 + 0.002));
    for (const b of c.bones) { R[b] = mm(Q, R[b]); H[b] = addv(root, mv(Q, sub(H[b], root))); }
    J = addv(root, mv(Q, sub(J, root)));
  }
  return J;
}

const PEEL = 30;                          // deg below the horizontal as the toes leave the ground: the toes peeling (guess from clip A)
const MIN_KA = 0.6;                       // the knee's nearest to the planted toe joint, beyond |shank - tarsus|, in thigh lengths

// A planted hind leg's four segment directions, or null when the leg is free: the toes end where the crouch planted them (the
// crouch's toe tip carried from the hop's start frame into this one: s.frames { f0, ft }, util/hop.js hopFrame) and peel up; the
// thigh swings out to a wide knee and the shank and tarsus reach from it to the toes (below), so the leg pushes without sliding or
// twisting.
function plantDirs(rig, c, A, s) {
  const side = c.side < 0 ? 'L' : 'R', rel = s.release?.[side] ?? 0;
  if ((!s.plant?.[side] && !rel) || !s.frames) return null;
  const k = c.bones.length, L = c.bones.map((b) => rig.L[b]), hip = rig.head[c.bones[0]];
  const tip0 = ((rig.crouchTip ??= {})[side] ??= (() => {
    let J = hip;
    for (let i = 0; i < k; i++) J = addv(J, mul(segDir(HIND.crouch[i], HIND.crouch[k + i], c.side), L[i]));
    return J;
  })());
  const f0 = s.frames.f0, ft = s.frames.ft, w0 = f0.toWorld(tip0);
  const T = ft.toModel([w0[0], Math.max(w0[1], 0), w0[2]]);                // (the planted tip on the floor, not a hair under it)
  // the toes and tarsus set against the ground, not the tilting body (the body pitches nose up as it pushes: a slant read in its
  // frame turned the toes up and sank the ankle into the floor): each keeps the heading it had in the crouch, the toes peel up to
  // PEEL as the push goes on and the heel lifts the tarsus to HEEL (deg below the horizontal, toward the toe tip)
  const e = s.plant?.[side] ?? 1, wdir = (fr, p, d) => { const a = fr.toWorld(p), b = fr.toWorld(addv(p, d)); return norm(sub(b, a)); };
  const mdir = (fr, d) => { const a = fr.toModel(fr.pos), b = fr.toModel(addv(fr.pos, d)); return norm(sub(b, a)); };
  const slant = (d0, deg) => { const h = norm([d0[0], 0, d0[2]]), r = (deg * Math.PI) / 180; return [h[0] * Math.cos(r), -Math.sin(r), h[2] * Math.cos(r)]; };
  const C = HIND.crouch, cD = [0, 1, 2, 3].map((i) => segDir(C[i], C[k + i], c.side));
  const cT = wdir(f0, tip0, cD[3]), sT = (Math.asin(Math.max(-1, Math.min(1, -cT[1]))) * 180) / Math.PI;
  const dT = mdir(ft, slant(cT, sT + (PEEL - sT) * e)), Bp = sub(T, mul(dT, L[3]));
  // The leg from the hip down, set in the world as clip A shows it from behind (0.97-1.29 s; the owner, 13:47, "pics 2,3,4 ... the
  // hips and first half of the leg"): the thigh swings out of the crouch to the side and back a little, near level, to a wide knee
  // (down and back in a long jump's push, clip B); the shank and the tarsus then reach from the knee to the planted toes with the
  // heel behind the knee and out under it, so from behind the shank drops from the knee. (Solved from the toes up, as until 13:50,
  // the ankle sat in by the vent and pulled the knee in under the hip.) The scan's shank and tarsus are long (together 2.7 thighs;
  // a real frog's about 1.6), so the knee keeps between MIN_KA and their full reach from the toes: closer, the shank and tarsus fold
  // flat on each other and the toes slide.
  // (sh: how much of a short hop it is, sharpened: below 0.25 a long jump's push, above 0.75 a short hop's)
  const sh0 = clamp(((s.short ?? 1) - 0.25) / 0.5, 0, 1), sh = sh0 * sh0 * (3 - 2 * sh0), eTh = e * e * (3 - 2 * e), eA = Math.min(1, e / 0.35), eAs = eA * eA * (3 - 2 * eA);
  const hipW = ft.toWorld(hip), BpW = ft.toWorld(Bp);
  const crouchK = addv(hip, mul(cD[0], L[0])), crouchA = addv(crouchK, mul(cD[1], L[1]));
  // (a long jump's push retracts the thigh, the thigh and tarsus parallel from above, the shank swinging in to the midline at
  // take-off, no wide knees: Porro et al. 2017, the owner's clips C and D; anatomy specialists A1 14 and A2 19. A short hop's push is
  // wide-kneed: clip A)
  const thE = (lerpN(20, 85, sh) * Math.PI) / 180, elE = (lerpN(-22, -8, sh) * Math.PI) / 180;
  const dE = [c.side * Math.sin(thE) * Math.cos(elE), Math.sin(elE), -Math.cos(thE) * Math.cos(elE)];
  const dThW = norm(addv(mul(wdir(f0, hip, cD[0]), 1 - eTh), mul(dE, eTh)));
  let K = addv(hipW, mul(dThW, L[0]));
  // A long jump's push (Porro et al. 2017, read by anatomy specialist A1: control/anatomy-A1.md 14): the shank keeps its crouch
  // direction through the first ~80 % of the push and retracts at the end; the thigh and the tarsus turn together, parallel from
  // above. With the shank fixed, the thigh and tarsus close the chain to the planted toes in the one vertical plane: a two-link reach,
  // its knee the one nearer the crouch's. (Retracting the thigh on its own, the knee went behind the toes, the shank and tarsus folded
  // shut and the heel dipped under the floor.) Blended with the short hop's wide knees by `sh`.
  const sC = wdir(f0, crouchK, cD[1]), late = clamp((e - 0.8) / 0.2, 0, 1), lt = late * late * (3 - 2 * late);
  const s1 = norm(addv(mul(sC, 1 - lt), mul(norm([0, -0.55, -1]), lt)));
  if (sh < 1) {
    const V = sub(sub(BpW, hipW), mul(s1, L[1])), X = Math.hypot(V[0], V[2]), hx = X > 1e-6 ? [V[0] / X, 0, V[2] / X] : [0, 0, -1];
    const Dd = clamp(Math.hypot(X, V[1]), Math.abs(L[0] - L[2]) + 1e-3, (L[0] + L[2]) * 0.999), base = Math.atan2(V[1], X);
    const A1 = Math.acos(clamp((L[0] * L[0] + Dd * Dd - L[2] * L[2]) / (2 * L[0] * Dd), -1, 1));
    const thighAt = (el) => [hx[0] * Math.cos(el), Math.sin(el), hx[2] * Math.cos(el)], cTh = wdir(f0, hip, cD[0]);
    const ta = thighAt(base + A1), tb = thighAt(base - A1), dL = dot(ta, cTh) >= dot(tb, cTh) ? ta : tb;
    K = addv(hipW, mul(norm(addv(mul(dL, 1 - sh), mul(norm(sub(K, hipW)), sh))), L[0]));
  }
  // (out of the shank and tarsus's reach, or too near the toes: the knee on the thigh's circle nearest the wanted direction at the
  // nearest distance allowed)
  // (the long jump's chain is exact, so it may fold the shank and tarsus closer than the short hop's guard)
  const far = (L[1] + L[2]) * 0.995, near = Math.min(far, Math.abs(L[1] - L[2]) + lerpN(0.05, MIN_KA * L[0], sh)), dK = len(sub(BpW, K));
  if (dK > far || dK < near) K = ik2(hipW, BpW, L[0], dK > far ? far : near, dThW).K;
  // (the heel: a short hop's back and down, out under the knee; a long jump's along the shank it keeps)
  const poleShort = norm(addv(mul(norm(sub(f0.toWorld(crouchA), f0.toWorld(crouchK))), 1 - eAs), mul(norm([c.side * 0.25, -0.45, -1]), eAs)));
  const pole = norm(addv(mul(s1, 1 - sh), mul(poleShort, sh)));
  const r = ik2(K, BpW, L[1], L[2], pole);
  const P = [mdir(ft, norm(sub(K, hipW))), mdir(ft, norm(sub(r.K, K))), mdir(ft, norm(sub(r.E, r.K))), norm(sub(T, Bp))];
  if (s.plant?.[side]) return P;
  // just off the ground: from the pushing leg into the pose in the air
  return P.map((d, i) => norm(addv(mul(d, rel), mul(segDir(A[i], A[k + i], c.side), 1 - rel))));
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
