// Pure animation arithmetic for the creature rig (no scene, no DOM, no state): the curves behind a frog's kick, a
// swimmer's bob, a crab's scuttle and the "no foot slip" rule that ties leg swing to the distance walked. The vertex
// shader (render/creatures/instanced.js) only applies what these functions say, so the shapes can be unit-tested.
// tests/gait.test.mjs checks the properties that matter: periodic, bounded, continuous, and a walking foot that stays
// where it was put.

export const TAU = Math.PI * 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smooth = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
const easeOut = (t) => { t = clamp01(t); return 1 - (1 - t) * (1 - t) * (1 - t); };
export const frac = (x) => x - Math.floor(x);
const lerp = (a, b, t) => a + (b - a) * t;

// --- Frog kick ---------------------------------------------------------------------------------------------
// One breaststroke cycle, phase 0 … 1 (it repeats). The hind legs are folded under the body at rest (ext 0) and
// stretched out behind it at full extension (ext 1), exactly the two poses the rig's `hop` input blends between.
//
//   0.00 – 0.17  THRUST   the legs snap out behind: ext 0 → 1, all the push of the stroke comes here
//   0.17 – 0.56  GLIDE    legs trail together, ext 1 → 0.96 (they relax a little), the body coasts
//   0.56 – 0.86  RECOVER  the knees fold up and the feet come in: ext 0.96 → 0, slowly (the way a frog gathers itself)
//   0.86 – 1.00  GATHER   folded, about to kick
//
// `push` (0 … 1) is the forward force: a half sine over the thrust. `splay` (0 … 1) is how far the feet are turned
// outward: it is largest halfway through the extension, in both directions (the feet sweep out and round).
export const KICK = { thrust: 0.17, glide: 0.56, recover: 0.86 };

export function frogKick(phase) {
  const p = frac(phase);
  let ext, push = 0;
  if (p < KICK.thrust) {
    const u = p / KICK.thrust;
    ext = easeOut(u);
    push = Math.sin(Math.PI * u);
  } else if (p < KICK.glide) {
    ext = 1 - 0.04 * smooth((p - KICK.thrust) / (KICK.glide - KICK.thrust));
  } else if (p < KICK.recover) {
    ext = 0.96 * (1 - smooth((p - KICK.glide) / (KICK.recover - KICK.glide)));
  } else ext = 0;
  return { ext, push, splay: splaySwing(ext) };
}
export const splaySwing = (ext) => 4 * ext * (1 - ext);

// Forward speed of a kicking swimmer as a fraction of its peak, for a phase 0 … 1: it rises through the thrust, peaks as
// the legs finish extending and then decays (drag) while the animal glides, so it moves in pulses. Continuous across
// the cycle boundary; its mean over a cycle is KICK_MEAN of the peak.
export const KICK_DECAY = 3.0;
export function kickSpeed(phase) {
  const p = frac(phase);
  if (p < KICK.thrust) {
    const c = Math.exp(-KICK_DECAY * (1 - KICK.thrust));      // what is left of the last surge
    return c + (1 - c) * smooth(p / KICK.thrust);
  }
  return Math.exp(-KICK_DECAY * (p - KICK.thrust));
}
export const KICK_MEAN = (() => { let s = 0; const n = 400; for (let i = 0; i < n; i++) s += kickSpeed(i / n); return s / n; })();

// The cycle length in seconds of a swimmer at `urgency` 0 (floating about) … 1 (a dash for the bank).
export const kickPeriod = (urgency) => 1.7 - 0.7 * clamp01(urgency);

// A swimming frog's own heave through a kick: a dip as the legs push. Centimetres, for an animal of body length `size` cm, at kick
// phase `phase`; nothing when the legs are not kicking. (The water under it is not a made-up swell: it rides the drawn surface's
// real height, ripples and all, read back from the GPU: Animals.ride.)
export function kickHeave(size, phase = 0, kicking = 0) {
  return -0.05 * kicking * size * Math.sin(Math.PI * frac(phase));
}

// The rig parameters of a swimming frog or toad at kick phase `phase`, ready for packAnim: `hop` (the hind-leg extension),
// `pose` (forelegs swept back along the flanks, feet splayed during the stroke), `calm` (the walking gait is off) and
// the body's pitch and roll in radians (positive pitch tips the nose down). `floating` (0 … 1) blends toward a frog resting
// on the surface: legs half folded and paddling gently, forelegs only loosely held. `level` is the pitch that brings a
// sitting model (head up) to a level body; the stroke lifts the nose a little as the legs drive.
export function frogSwimPose(phase, { floating = 0, level = 0.28, t = 0 } = {}) {
  const k = frogKick(phase);
  const idle = 0.5 + 0.16 * Math.sin(TAU * phase * 1.0);
  const ext = k.ext + (idle - k.ext) * floating;
  const push = k.push * (1 - floating);
  return {
    hop: ext,
    pose: 1 - 0.45 * floating,
    calm: 1,
    pitch: level - 0.14 * push + 0.03 * Math.sin(t * TAU * 0.4),
    roll: 0.05 * Math.sin(TAU * phase + 1.1) * (1 - floating) + 0.025 * Math.sin(t * TAU * 0.33),
  };
}

// A newt or salamander swimming: legs held back against the body (hind legs trailing, forelegs swept back), the body
// undulating from the head to the tail. `speed01` 0 … 1 scales the undulation (0 is a drift, 1 a dash).
export function salamanderSwimPose(speed01 = 0.5) {
  const s = clamp01(speed01);
  return { hop: 1, pose: 1, calm: 1, ampScale: 1.5 + 1.5 * s, rate: 5 + 5 * s };
}

// --- Walking -----------------------------------------------------------------------------------------------
// The rig lifts a foot for half a cycle (sin(phase) > 0: the swing) and keeps it on the ground for the other half (the
// stance). A planted foot must not slide, so during the stance it moves back relative to the body at exactly the body's
// speed: for a stride of `strideCm` (body travel per full leg cycle) and a duty factor of one half, the foot travels
// 2 x amp = strideCm / 2 back over the stance, so amp = strideCm / 4 and the leg phase advances 2 pi per stride.
// (The swing, with the foot in the air, is a smooth reach forward.)
export const gaitRate = (strideCm) => TAU / strideCm;              // radians of leg phase per cm walked
export const sweepFor = (strideCm, duty = 0.5) => (strideCm * duty) / 2;
export const strideFor = (amp) => amp * 4;                          // body travel per leg cycle for a sweep amplitude `amp`

// Leg phase offsets, in the order the rig gives them (leg ids 1 front-left, 2 front-right, 3 back-left, 4 back-right).
// Diagonal pairs (1 + 4, 2 + 3) move together: the trot of a salamander, lizard or frog walking.
export const TROT = { 1: 0, 2: Math.PI, 3: Math.PI, 4: 0 };

// The rig's convention for a leg at phase `phi` (radians) with sweep `amp`, positive forward along the body: the foot is up
// while sin(phi) > 0 (the swing: it rises, and reaches from the rearmost point to the foremost one along a smooth curve)
// and planted for the other half, when it moves back at a constant speed (linear in phase: no slip, see above).
export function footSwing(phi, amp) {
  const u = frac(phi / TAU);
  return amp * (u < 0.5 ? -Math.cos(u * TAU) : 3 - 4 * u);
}
export const footLift = (phi, amp) => amp * Math.max(Math.sin(phi), 0);
export const footGrounded = (phi) => Math.sin(phi) <= 0;

// Leg phase per cm walked for an animal whose rig sweeps a foot `legStride` cm (the species' anim.stride, in the mesh's own
// centimetres) drawn at instance `scale`: one leg cycle per stride, so a planted foot stays where it was put.
export const strideRate = (legStride, scale = 1) => gaitRate(strideFor(legStride) * Math.max(0.05, scale));

// --- Frog hop ----------------------------------------------------------------------------------------------
// Hind-leg extension through one hop, t = 0 (take-off) … 1 (landing). A frog's jump is the legs straightening in the first
// few hundredths of a second, so they snap out while the feet still push (HOP.push), trail straight through the flight and
// fold up under the body before it lands (by HOP.fold), ready to absorb the landing.
export const HOP = { push: 0.14, hold: 0.45, fold: 0.85 };
export function hopLegs(t) {
  t = clamp01(t);
  if (t < HOP.push) return easeOut(t / HOP.push);
  if (t < HOP.hold) return 1;
  return 1 - smooth((t - HOP.hold) / (HOP.fold - HOP.hold));
}

// A leap, drawn by the swimming body's skeleton (render/creatures/skeleton.js poseStroke: its limbs are apart, so they straighten
// without smearing): the joint angles at hop time t = 0 … 1, as { legA (the nine of HIND, both legs), armA (the six of FORE) }.
// The legs drive from cocked to straight as hopLegs says, hips and knees first and the ankles and feet after them (the order taken
// from Biomimetics 9(3):168, 2024, which is a robot simulation: real frogs extend knee and ankle together, Li et al. 2021), trail
// through the flight and fold up before the landing; the
// forelegs leave the ground, lie back under the chest in the air and reach forward and down to land on.
// (Since 5 Oct the game hops with leapPose below, as real frogs do; leapStroke stays for the swim tests and older tools.)
export function leapStroke(t, out = null) {
  t = clamp01(t);
  const o = out ?? { legA: new Float32Array(9), armA: new Float32Array(6) }, C = HIND.fold, L = HIND.leap;
  const e = hopLegs(t), late = hopLegs(Math.max(0, t - 0.04));      // (the ankles and feet a moment behind the hips and knees)
  for (let c = 0; c < 9; c++) o.legA[c] = lerp(C[c], L[c], c === 2 || c === 3 || c === 6 || c === 7 || c === 8 ? late : e);
  const S = FORE.stand, T = FORE.air, R = FORE.reach;
  const up = smooth(t / 0.16), down = smooth((t - 0.5) / 0.3), home = smooth((t - 0.85) / 0.15);
  for (let c = 0; c < 6; c++) { const air = lerp(lerp(S[c], T[c], up), R[c], down); o.armA[c] = lerp(air, S[c], home); }
  o.t = t;                                                           // (the muscles' motor pattern reads where in the leap it is)
  return o;
}

// A hop's limb angles as real frogs move them (.agents/muscles/refs/JUMPS.md), for the swimming body (render/creatures/skeleton.js
// poseStroke): `at` = util/hop.js hopAt(plan, t), `plan` its hopPlan. Returns the stroke { legA (both legs: [0..8] left, [9..17] right),
// armA, t, plant: { L, R } }: plant[side] is the part of the launch that leg is still pushing in (0 … 1), or 0 once its toes are off
// the ground (then legA holds its pose). Before toe-off the renderer solves that leg to keep its toes where they were planted;
// legA then gives only the foot's and toes' slant. Short hops (plan.short 1) fold the legs out to the sides at once; long ones
// hold them straight behind into mid-flight (clip B). One leg leads: plan.lead ('L' | 'R') leaves the ground plan.lag of the launch
// before the other.
const _leg = new Float32Array(9);
export const RELEASE = 0.03;     // s: a leg's hand-over from pushing to its pose in the air
const PUSH_FOOT_PH = -62, PUSH_TOES_PH = -30;    // deg: the tarsus and toes as the toes leave the ground (heel up, toes peeling; guess from clip A)
export function leapPose(plan, at, out = null) {
  const o = out ?? { legA: new Float32Array(18), armA: new Float32Array(6), t: 0, plant: { L: 0, R: 0 }, release: { L: 0, R: 0 }, hop: true };
  o.hop = true;
  const C = HIND.crouch, X = HIND.leap, Sp = HIND.spread, sh = plan.short ?? 0;
  for (const [side, off] of [['L', 0], ['R', 9]]) {
    const lead = plan.lead === side, offAt = lead ? 1 - (plan.lag ?? 0) : 1;       // (when this leg's toes leave, in launch fractions)
    let A;
    if (at.phase === 'launch' && at.u < offAt) {
      // pushing: the foot keeps pointing the way it was set down while the heel lifts and the tarsus tilts up; the toes stay flat and
      // start to peel (the rest is solved to the plant). Swinging the foot's heading back with the toes planted dragged the heels in
      // under the belly and crossed the legs (the owner, 5 Oct: "photograms 1 2 and 3 show a real and huge problem")
      const e = smooth(at.u / offAt);
      for (let c = 0; c < 9; c++) _leg[c] = C[c];
      _leg[6] = lerp(C[6], PUSH_FOOT_PH, e); _leg[7] = lerp(C[7], PUSH_TOES_PH, e);
      o.plant[side] = Math.max(1e-3, Math.min(1, at.u / offAt));
      if (o.release) o.release[side] = 0;
      A = _leg;
    } else {
      o.plant[side] = 0;
      // (just off the ground: the renderer blends the planted solution into this pose over RELEASE seconds, no pop)
      const since = at.s - offAt * plan.tLaunch;
      o.release = o.release ?? { L: 0, R: 0 };
      o.release[side] = since >= 0 && since < RELEASE ? 1 - since / RELEASE : 0;
      // in the air: the take-off pose, then out to the sides and folding (short), or held straight and folding from mid-flight (long)
      const air = at.phase === 'launch' ? 0 : at.phase === 'flight' ? at.u : 1;   // (landing: the fold it had at touchdown, then on to the crouch)
      // (a short hop lands with its legs still out to the sides and folds them in the landing, clip A; a long jump folds them before)
      const hold = lerp(0.45, 0.05, sh), end = lerp(0.95, 1.4, sh), fold = smooth((air - hold) / (end - hold));
      const landed = at.phase === 'land' ? lerp(fold, 1, smooth(at.u)) : fold;
      for (let c = 0; c < 9; c++) { const up = lerp(X[c], Sp[c], sh); _leg[c] = lerp(up, C[c], landed); }
      A = _leg;
    }
    for (let c = 0; c < 9; c++) o.legA[off + c] = A[c];
    o.legA[off + 8] = Math.min(20, o.legA[off + 8]);     // (the foot turns its sole up a little as it trails, no more: 20 deg, no source for more)
  }
  // forelimbs: off the ground as the launch gets going; a short hop holds them open for balance, elbows bent (clip A); a long jump
  // lays them back along the flanks for the flight (clip C 6.5 s; A2 16); coming down they reach forward and down, the hands wide
  // apart to meet the floor; drawn in under the body only once landed
  const B = FORE.balance, T = FORE.tuck, Sp2 = FORE.splay, St = FORE.stand;
  const lift = at.phase === 'launch' ? smooth(at.u / 0.4) : 1, lower = at.phase === 'flight' ? smooth((at.u - 0.6) / 0.4) : at.phase === 'land' ? 1 : 0;
  const settle = at.phase === 'land' ? smooth((at.u - 0.35) / 0.65) : 0;
  for (let c = 0; c < 6; c++) o.armA[c] = lerp(lerp(lerp(St[c], lerp(T[c], B[c], sh), lift), Sp2[c], lower), St[c], settle);
  o.t = at.s;
  o.short = sh;
  return o;
}

// --- Frog calls ----------------------------------------------------------------------------------------------
// A dart frog's call is a buzz: the vocal sac pulses some 5 times a second for a few seconds. `t` seconds into a bout of
// `dur` seconds: the sac's inflation 0 … 1 (rising in, pulsing, and collapsing at the end).
export function callSac(t, dur) {
  if (t <= 0 || t >= dur) return 0;
  const env = smooth(t / 0.35) * smooth((dur - t) / 0.4);
  return env * (0.55 + 0.45 * Math.abs(Math.sin(t * Math.PI * 5.2)));
}

// Toe tapping: hunting dart frogs twitch their hind toes while they watch prey. A small, fast twitch of the hind feet, as a
// hop extension (0 … 0.08) at time `t` seconds.
export const toeTap = (t) => 0.08 * Math.max(0, Math.sin(t * TAU * 6.5)) ** 3;

// --- Crab scuttle ------------------------------------------------------------------------------------------
// A crab moves in bursts: it accelerates, runs a few body lengths sideways and stops dead. `scuttleSpeed(u)` is the
// speed profile (0 … 1, peak 1) over a burst, u = 0 … 1: a quick start, a plateau, a short stop.
export function scuttleSpeed(u) {
  u = clamp01(u);
  return smooth(u / 0.18) * smooth((1 - u) / 0.22);
}
// The length of one leg cycle for a crab with a carapace `width` cm wide: about 0.9 widths, so eight fast legs.
export const crabStride = (width) => 0.9 * width;

// How long (seconds) a crab holds a claw-wave: eased up, held, eased down. v 0 … 1.
export function clawRaise(t, dur) {
  if (t <= 0 || t >= dur) return 0;
  return smooth(t / 0.18) * smooth((dur - t) / 0.3);
}

// --- The rig's per-instance word ------------------------------------------------------------------------------------
// Everything a pose needs beside the gait phase rides in one float32 (the vertex shader unpacks it with the same
// arithmetic, render/creatures/instanced.js):  w = hop + 2 * (breath + 8 * (throat + 8 * (eye + 8 * (pose + 16 * calm))))
// `hop` 0 … 1 is the fraction; breath, throat and eye (3 bits each, 0 … 7: the idle pulses), pose (4 bits, 0 … 15: swim
// pose, or a crab's claw wave) and calm (3 bits, 0 … 7: legs held still) are given as 0 … 1. A plain hop (< 2) is no pulses,
// no pose and no calm. The largest word is 131071, where a float32 still resolves the hop to 1/128.
export function packAnim(hop, breath = 0, throat = 0, eye = 0, pose = 0, calm = 0) {
  const q = (v, n) => Math.max(0, Math.min(n, Math.round(v * n)));
  return Math.max(0, Math.min(1, hop)) + 2 * (q(breath, 7) + 8 * (q(throat, 7) + 8 * (q(eye, 7) + 8 * (q(pose, 15) + 16 * q(calm, 7)))));
}
export function unpackAnim(w) {
  const f = Math.fround;
  w = f(w);
  const n0 = Math.floor(w * 0.5), hop = w - n0 * 2;
  const n1 = Math.floor(n0 * 0.125), n2 = Math.floor(n1 * 0.125), n3 = Math.floor(n2 * 0.125), n4 = Math.floor(n3 * 0.0625);
  return { hop, breath: (n0 - n1 * 8) / 7, throat: (n1 - n2 * 8) / 7, eye: (n2 - n3 * 8) / 7, pose: (n3 - n4 * 16) / 15, calm: n4 / 7 };
}

// --- The head-steering rig's packed floats ------------------------------------------------------------------------------------
// The second per-instance vector of a species with finish.rig2 is (head yaw, head pitch, A, B). WebGPU allows 8 vertex buffers a
// pipeline and the creature meshes already use them, so the rest rides packed in two floats (each below 2^24, exact in float32):
//   A = bend + 1024 * tail            bend -1 … 1 and tail -0.5 … 0.5 (fractions of the body length), 0 … 1022 steps each: 0 is exact
//   B = tailLength * 63 + 64 * (dullness * 63 + 64 * (piece * 127 + 128 * lift))    tail length 0 … 1, skin dullness 0 … 1, the tail
//       piece's cut 0 … 1, and the tail's lift -0.3 … 0.3 (a fraction of the body length at the tip, in 30 steps: 0 is exact), which
//       curves the tail up or down so it lies along the ground behind a body that stands on a slope or a stone
// render/creatures/material.js rig2Unpack is the same arithmetic as a node graph.
// A also carries the turning mix tau (-1 … 1, util/turn.js) in its top bits: A += TURN_Q * (|tau| * 7 + (tau < 0 ? 8 : 0)), in
// sevenths, 0 when not turning (so a vector packed without it reads as no turn). The largest A is just under 2^24. The vertex
// shader (render/creatures/instanced.js) takes it off before material.js unpacks the rest.
export const LIFT_MAX = 0.3;
export const TURN_Q = 1048576;
export function rig2Pack(bend, tail, tailF = 1, dull = 0, piece = 0, lift = 0, turn = 0) {
  const q = (v, n) => Math.round(clamp01(v) * n);
  const tm = Math.round(Math.min(1, Math.abs(turn)) * 7), tq = tm + (turn < 0 && tm ? 8 : 0);
  return [q((bend + 1) / 2, 1022) + 1024 * q(tail + 0.5, 1022) + TURN_Q * tq, q(tailF, 63) + 64 * (q(dull, 63) + 64 * (q(piece, 127) + 128 * q((lift + LIFT_MAX) / (2 * LIFT_MAX), 30)))];
}
export function rig2Unpack(a, b) {
  const uq = Math.floor(a / TURN_Q), turn = ((uq % 8) / 7) * (uq >= 8 ? -1 : 1);
  a -= uq * TURN_Q;
  const tq = Math.floor(a / 1024), bq = a - tq * 1024;
  const hq = Math.floor(b / 4096), r = b - hq * 4096, dq = Math.floor(r / 64), fq = r - dq * 64;
  const lq = Math.floor(hq / 128), pq = hq - lq * 128;
  return { bend: (bq / 1022) * 2 - 1, tail: tq / 1022 - 0.5, tailF: fq / 63, dull: dq / 63, piece: pq / 127, lift: (lq / 30) * 2 * LIFT_MAX - LIFT_MAX, turn };
}

// --- Swimming: the anuran blueprint's stroke clock and pose (moved here from util/swim.js: a util module imports nothing) ---

// The anuran swimming blueprint, motion layer (pure: no scene, no state outside what it is handed). docs/SKELETON.md "Swimming
// blueprint". Every frog and toad swims with these functions, driven by its SWIM profile (util/bodyplan.js swimProfile) and its
// body's measurements (body length; the skeleton's own bone lengths do the rest):
//
//   swimStep(st, prof, { urgency, floating, steer, sitting, bodyLen }, dt)   the stroke clock: kick rate from urgency, bursts of kicks with
//            a short rest between them for a weak swimmer, the drift of a frog floating at rest, the legs kicking together when
//            it means to get somewhere and one after the other when it potters. Advances `st` and returns the forward speed in
//            cm/s: a surge as the legs drive, a glide that decays, so a frog moves in pulses and covers `reach` body lengths a
//            kick on average.
//   swimPose(st, prof, { level, t })   the posture for that moment: the stroke for the skeleton (`stroke`: each hind leg's phase
//            and how fully it kicks, how far the forelegs are held out, how much of the floating posture), and for the far level
//            of detail's vertex rig the hind-leg extension (`hop`) and `pose`; the body's pitch and roll (near level at the
//            surface, head up, the nose lifting as the legs drive) and how deep it lies.
//   strokeAngles / armAngles   the stroke itself, as joint angles (below).
//
// The behaviour layer (sim/animals.js frogSwim: when to swim, where to, the way out) only sets urgency, steering and heading and
// reads the speed; the render layer only draws the pose (render/creatures/skeleton.js poseStroke).

// --- The stroke as joint angles -------------------------------------------------------------------------------------------------
// A frog's kick, read off films of swimming frogs from above (a leopard frog crossing a basin and floating; a frog in a pool:
// the user's references, .agents/refs) and the four beats a swimming teacher counts for the "frog kick": draw up, turn out, kick,
// close. One cycle, phase 0 … 1:
//
//   0.00 COCKED  thighs forward beside the flanks, shins folded back onto them, the feet turned out to the sides, webs spread
//   0.08 KICK    the hips and knees drive first, then the ankles (as in a jump: proximal to distal): the feet sweep out and back
//                in a wide arc, pushing water behind
//   0.16 OPEN    the legs straight, in a V
//   0.26 GLIDE   the legs close on each other and trail together, toes pointed: the body coasts (to 0.60; a weak swimmer resting
//                between bursts holds this)
//   0.74 DRAW    the knees come out to the sides and forward, the shins angle back in to the midline, feet trailing together
//                (from above the legs make a diamond): slowly, it costs way
//   0.88 TURN    the knees reach the flanks, the feet begin to turn out
//   1.00 COCKED
//
// A segment's direction is two angles in the frog's own frame, in degrees: `th`, in its frontal plane, from straight back (0) out to
// the side (90) and on round to straight forward (180); `ph`, its lift toward the back (+) or the belly (-).
//   hind  [thigh th, shin th, foot th, toes th, thigh ph, shin ph, foot ph, toes ph, foot roll]
//   fore  [arm th, forearm th, hand th, arm ph, forearm ph, hand ph]
// (foot roll: the foot turned about its own length, from the web held upright behind the shin as it pushes (0) to lying flat,
// sole up, as it trails (90).)
export const HIND = {
  // cocked: knees at the sides at or a little ahead of the hip, shins folded back in, the feet turned out to the sides, soles back
  // (the owner's pool frog 14.7 s and toad 3.2 s, .agents/muscles/refs/SWIM.md; less hip flexion than the sitting crouch, as Peters
  // 1996; checked by anatomy specialist A2, control/anatomy-A2.md 24). Until 5 Oct the thigh was at 125, the feet forward of sideways.
  cock: [105, -25, 80, 85, -14, 16, -22, -22, 0],
  kick: [85, 30, 80, 95, -8, 6, -20, -20, 0],
  open: [36, 24, 34, 40, -5, 0, -8, -5, 35],
  glide: [14, -4, 0, 2, -4, 3, 2, 0, 90],
  // the diamond: knees out, heels together on the midline behind the vent, feet trailing in a fishtail, held a moment before the
  // turn-out (pool 12.6-13.7 s; A2 22); a leg that kicks less, steering, holds it (pool 13.8-14.4: one leg kicks, the other holds)
  draw: [48, -30, 8, 14, -6, 8, 0, 0, 70],
  // the turn-out: the knees come forward to the sides, the heels part (about 0.2-0.3 snout-vent lengths), the feet turn out (pool
  // 14.6; A2 21, 23). Until 5 Oct the shin was at -38 and kept the heels on the midline while the feet turned out: an X from above.
  turn: [95, -25, 45, 55, -12, 14, -10, -12, 30],
  // folded as it sits (on the bottom of the water, and the old leap's take-off): the stroke's cocked pose until 5 Oct
  fold: [125, -22, 95, 100, -16, 18, -25, -25, 0],
  // resting at the surface, two ways by species (the owner, 5 Oct: "species based mix"): `float`, the limbs spread, the shins
  // hanging, the feet out and down (a leopard frog floating; the fire-bellied toad, spread-eagled); `floatTrail`, the legs trailing
  // back a little apart, the body near level, back dry (the owner's toad clip 1.0, 7.0 s; SWIM.md B)
  float: [80, 5, 45, 50, -20, -25, -30, -30, 20],
  floatTrail: [25, 5, 10, 12, -10, -8, -5, -5, 80],
  // in the air after a long jump: the legs straight behind, close together in a narrow V, the feet stretched back (the owner's clips B
  // and C-E, .agents/muscles/refs/JUMPS.md; A2 16). Until 5 Oct the thighs were at 30, a wide V.
  leap: [15, 6, 8, 10, -12, -6, -4, 0, 70],
  // crouched to jump, as the sitting scan holds its legs (measured on the dart frog's skeleton against its pelvis line, 5 Oct; the toad
  // and the reed frog are within 7 deg): thigh forward and out, shin back along it, foot and toes forward under the body, sole down
  crouch: [133, -25, 141, 158, -11, 2, -24, -17, 0],
  // in the air after a short hop (the owner's clip A, 5 Oct): thighs out to the sides and level, shanks and feet trailing out and back
  spread: [92, 38, 28, 22, 2, -8, -12, -8, 60],
};
export const FORE = {
  tuck: [22, 6, 0, -22, -6, 0],             // laid back along the flanks: a frog driving through the water
  spread: [76, 109, 119, 10, -9, -2],       // held out to the sides, hands flat (the swimming scan's own pose; the user's photo)
  // swimming, drawing the legs up: the arm a little forward of sideways, the elbow bent, the hand forward (pool 13.4-13.9 s, toad
  // 3.2-3.8 s; a guess blended in at most halfway, never out like wings: A2 26). Until 5 Oct the stroke opened the arms to `spread`.
  brace: [115, 150, 160, -10, -20, -10],
  hang: [95, 125, 125, -30, -40, -50],      // floating: out and down, the hands hanging
  stand: [95, 172, 172, -52, -56, -6],      // on the ground: the arm down and out, the forearm down, the hand forward (a sitting frog)
  reach: [150, 165, 172, -38, -48, -12],    // reaching forward and down for the landing
  air: [35, 20, 10, -40, -30, -12],         // in the air: drawn back and down under the chest
  // through a hop the arms stay open (the owner, 5 Oct: "staying open backwards", not drawn in to the body nor aimed at the ground),
  // but not held straight like wings (13:48, "let's also fix the arms"): the upper arm out to the side and a little back and down, the
  // elbow bent (about 130 deg inside; cane toads flex it at take-off, Cox et al. 2018 via research/dynamics-params.json), the forearm
  // and hand angled forward and down (clip A, 1.29-1.45 s)
  balance: [72, 120, 138, -8, -34, -28],
  // coming down: the upper arm brought forward (protracted) and down, the elbow still bent as the hands meet the floor wide apart (107
  // deg inside: cane toads at touchdown, Cox et al. 2018 Table 2 110 +- 12 sd; Duman et al. 2023 Fig 4B 62.7, the wrist-elbow-shoulder
  // angle; the two not reconciled, control/round-4.md; clip A, 1.45-1.61 s)
  splay: [95, 172, 175, -12, -62, -20],
};
// (the kick keeps its quarter of the cycle, front-loaded, Peters 1996 and Nauwelaerts 2005; the legs pass through the diamond at 0.72
// and a frog pottering holds it there, DIAMOND_HOLD; a fleeing one does not: A2 25, C2 round 2. Until 5 Oct the legs went straight
// through the draw to the turn.)
export const STROKE_KEYS = [[0, 'cock'], [0.08, 'kick'], [0.16, 'open'], [0.26, 'glide'], [0.55, 'glide'], [0.72, 'draw'], [0.92, 'turn'], [1, 'cock']];
// (the thrust: the legs drive from cocked to open; the phase a resting frog holds its legs at)
export const STROKE = { thrust: 0.16, close: 0.26, glide: 0.55, recover: 1 };
export const GLIDE_HOLD = 0.45;
// The diamond held a while longer, by how much a stroke depends on urgency: up to `max` of a cycle for a frog pottering, none for one
// fleeing (the pool frog held it 1.1 s, about twice its draw, one stroke of one clip: A2 25 asks for it variable; the amount a guess).
export const DIAMOND_HOLD = { at: 0.72, max: 0.12 };

// The keys joined by a curve that passes through each without overshooting (a monotone cubic: Fritsch-Carlson), sampled once.
const STROKE_N = 128, HC = 9;       // samples of the curve, channels of a hind leg
const STROKE_TAB = (() => {
  const K = STROKE_KEYS, n = K.length - 1, tab = new Float32Array((STROKE_N + 1) * HC);
  for (let c = 0; c < HC; c++) {
    const y = K.map(([, k]) => HIND[k][c]), x = K.map(([t]) => t);
    const h = [], d = [];
    for (let i = 0; i < n; i++) { h.push(x[i + 1] - x[i]); d.push((y[i + 1] - y[i]) / h[i]); }
    const m = new Array(n + 1);
    for (let i = 0; i <= n; i++) {
      const a = (i + n - 1) % n, b = i % n;                   // the segments before and after key i (the cycle wraps)
      if (d[a] * d[b] <= 0) { m[i] = 0; continue; }
      const w1 = 2 * h[b] + h[a], w2 = h[b] + 2 * h[a];
      m[i] = (w1 + w2) / (w1 / d[a] + w2 / d[b]);
    }
    for (let s = 0; s <= STROKE_N; s++) {
      const p = s / STROKE_N;
      let i = 0; while (i < n - 1 && p > x[i + 1]) i++;
      const t = (p - x[i]) / h[i], t2 = t * t, t3 = t2 * t;
      tab[s * HC + c] = (2 * t3 - 3 * t2 + 1) * y[i] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * y[i + 1] + (t3 - t2) * h[i] * m[i + 1];
    }
  }
  return tab;
})();

// One hind leg's angles (degrees, the nine of HIND) at stroke phase `p`, written to out[o … o + 8]. `amp` (0 … 1): how fully it
// kicks (less: toward the diamond, a leg that holds while the other kicks to turn, the pool frog 13.8-14.4 s); `float` (0 … 1):
// resting at the surface, in the species' way (`floatPose` 'spread' or 'trail').
// The damping only acts while the other leg kicks (steerWeight): in the glide both legs lie together. The window edges
// (0.72-0.92 ramp in, 0.92 to 0.16 full, 0.16-0.26 ramp out) are GUESSES, not measured on the clip.
export function steerWeight(p) {
  p = frac(p);
  if (p >= 0.92 || p < 0.16) return 1;
  if (p < 0.26) return 1 - smooth((p - 0.16) / 0.1);
  if (p < 0.72) return 0;
  return smooth((p - 0.72) / 0.2);
}
export function strokeAngles(p, out, o = 0, amp = 1, float = 0, floatPose = 'spread') {
  amp = 1 + (amp - 1) * steerWeight(p);
  const u = frac(p) * STROKE_N, i = Math.min(STROKE_N - 1, Math.floor(u)), f = u - i, D = HIND.draw, F = floatPose === 'trail' ? HIND.floatTrail : HIND.float;
  for (let c = 0; c < HC; c++) {
    const v = STROKE_TAB[i * HC + c] * (1 - f) + STROKE_TAB[(i + 1) * HC + c] * f, a = D[c] + (v - D[c]) * amp;
    out[o + c] = a + (F[c] - a) * float;
  }
  return out;
}

// A foreleg's angles (degrees, the six of FORE) for `open` (0 laid back along the flank … 1 braced forward, elbow bent) and `float`
// (spread-eagled floaters hang them out; the others keep them back along the body).
export function armAngles(open, out, o = 0, float = 0, floatPose = 'spread') {
  const T = FORE.tuck, S = FORE.brace, H = floatPose === 'trail' ? FORE.tuck : FORE.hang;
  for (let c = 0; c < 6; c++) { const v = T[c] + (S[c] - T[c]) * open; out[o + c] = v + (H[c] - v) * float; }
  return out;
}

// How far the forelegs are held out through a stroke: laid back as the legs drive and through the glide (`glide`: a poison frog,
// a poor swimmer, keeps them half out to balance), out as it draws its legs up (`draw`), swept back with the kick.
export function armOpen(p, draw = 1, glide = 0) {
  p = frac(p);
  // (swept back over the kick's first half: the arms lie back as the legs drive, A2 26; until 5 Oct over 0.12)
  if (p < 0.06) return lerp(draw, glide, smooth(p / 0.06));
  if (p < 0.58) return glide;
  if (p < 0.9) return lerp(glide, draw, smooth((p - 0.58) / 0.32));
  return draw;
}

// The hind legs' extension through a stroke, 0 (drawn up) … 1 (stretched straight back), from the thigh's angle: the far level of
// detail's rig (its `hop` input) and the tests.
const _ang = new Float32Array(HC);
export function legExtension(p) {
  const th = strokeAngles(p, _ang)[0];
  return clamp01((HIND.cock[0] - th) / (HIND.cock[0] - HIND.glide[0]));
}

// A new frog's stroke clock: legs drawn up, about to kick.
export const swimState = (rnd = Math.random) => ({ phase: 0.9 + rnd() * 0.08, burst: 0, rest: 0, hold: 0, v: 0, kicks: 0, rested: false, alt: 0, fl: 0, steer: 0, sit: 0 });

// Kicks a second at an urgency 0 (pottering) … 1 (a dash for the way out).
export const kickRate = (prof, urgency) => lerp(prof.kickHz[0], prof.kickHz[1], clamp01(urgency));

export function swimStep(st, prof, { urgency = 0.5, floating = false, steer = 0, sitting = false, bodyLen = 4, rnd = Math.random, wake = false, spin = 0, spinStyle = 'pivot', spinErr = 9, spinHz = 0.67 } = {}, dt) {
  if (!(dt > 0)) return st.v;
  // (st.act / st.dph: the stroke ran this tick, and how far the clock moved: util/swimturn.js turns and pushes only on those; `wake`:
  // a push is queued, so a resting or floating frog takes a stroke to release it)
  st.act = 0; st.dph = 0;
  if (wake && !sitting) { floating = false; st.rest = 0; st.hold = 0; }
  // (eased, so the legs pass from one way of swimming to another instead of jumping: floating, one leg after the other, steering,
  // sitting on the bottom)
  const ease = (k, to, rate) => { st[k] = (st[k] ?? 0) + (to - (st[k] ?? 0)) * Math.min(1, dt * rate); };
  ease('sit', sitting ? 1 : 0, 4);
  if (sitting) { st.v *= Math.exp(-dt * 6); ease('fl', 0, 2.5); ease('alt', 0, 3); ease('steer', 0, 6); return st.v; }    // (on the bottom: no stroke)
  ease('fl', floating ? 1 : 0, 2.5);
  ease('alt', !floating && urgency < 0.3 ? 1 : 0, 3);
  ease('steer', Math.max(-1, Math.min(1, steer)), 6);
  if ((spin || st.sp) && spinStep(st, prof, spin, spinStyle, spinErr, spinHz, dt)) return st.v;
  if (floating) {
    // Resting at the surface, limbs spread (a fire-bellied toad): an idle paddle now and then, hardly any way on.
    st.phase += dt * prof.kickHz[0] * 0.35;
    st.v *= Math.exp(-dt * 2.5);
    return st.v;
  }
  if (st.rest > 0) {
    // Between bursts: the legs trailing (mid-glide), the body coasting to a stop.
    st.rest -= dt;
    st.v *= Math.exp(-dt * prof.drag);
    return st.v;
  }
  if (st.hold > 0) {
    // the diamond held, coasting
    st.hold -= dt;
    st.v *= Math.exp(-dt * prof.drag);
    return st.v;
  }
  const hz = kickRate(prof, urgency), before = st.phase;
  st.phase += dt * hz;
  { const a = before - Math.floor(before), b = st.phase - Math.floor(st.phase);
    if (a < DIAMOND_HOLD.at && b >= DIAMOND_HOLD.at) st.hold = (DIAMOND_HOLD.max * (1 - clamp01(urgency))) / hz; }
  if (Math.floor(st.phase) !== Math.floor(before)) { st.kicks++; st.burst--; st.rested = false; }
  // A burst done: a weak swimmer coasts with its legs trailing straight (mid-glide) a moment before it draws them up and kicks again,
  // less the more urgent it is.
  const p = st.phase - Math.floor(st.phase);
  if (st.burst <= 0 && !st.rested && p >= GLIDE_HOLD && p - dt * hz < GLIDE_HOLD) {
    st.burst = Math.round(lerp(prof.burst[0], prof.burst[1], rnd()));
    st.rest = lerp(prof.rest[0], prof.rest[1], rnd()) * (1 - 0.7 * clamp01(urgency));
    st.rested = true;
    if (st.rest > 0) { st.phase = Math.floor(st.phase) + GLIDE_HOLD; st.v *= Math.exp(-dt * prof.drag); return st.v; }
  }
  // the mean of kickSpeed over a cycle is KICK_MEAN: the peak that makes `reach` body lengths a kick. One leg after the other
  // (pottering) drives half as hard twice a cycle and gets on more slowly; a leg held back to steer drives less.
  const both = kickSpeed(st.phase), one = 0.5 * (kickSpeed(st.phase) + kickSpeed(st.phase + 0.5)) * 0.7;
  const target = (prof.reach * bodyLen * hz / KICK_MEAN) * lerp(both, one, st.alt) * (1 - 0.3 * Math.abs(st.steer));
  // Speed rises only while a leg drives (the thrust part of the stroke, either leg when pottering); anywhere else it can only fall to
  // the glide's curve. A body woken from rest (a floater, a sitter, a coasting stop) at any phase starts from 0: its speed is the
  // momentum of a kick it made, never read off the clock (the body rule, tests/bodyrule.test.mjs).
  const drive = p < KICK.thrust || (st.alt > 0.5 && frac(p + 0.5) < KICK.thrust);
  st.v = drive ? target : Math.min(target, st.v);
  st.act = st.hold > 0 ? 0 : 1; st.dph = dt * hz;      // (the tick the diamond is taken up is its first: no turn)
  return st.v;
}

// Turning on the spot, a body movement of its own (owner, 6 Oct 2026: the head orients first, the torso next, then hands and legs; the
// body's yaw comes out of the leg thrust, util/swimturn.js swimMotion). Its own clock st.sp.p (a cycle of 1/spinHz s). 'pivot': one leg
// kicks while the other is held drawn up; 'opposed': the two kick half a cycle apart. Poses from tools/blender/spin-stroke2.mjs.
const SPIN_BLEND = 0.3;                                 // s the legs and hands take to pass between the stroke and the spin, each way
const SPIN_START = 0.85, SPIN_KICK = [0.08, 0.26];       // the clock starts in the leg's draw: the head moves 0.12 cycle in, the torso 0.24, the first thrust 0.30 (SPIN_KICK: hand-copy of swimturn KICK_WIN)
const spinComp = (p) => (p < 0.5 ? 0.26 * (2 * p) : 0.72 + 0.28 * (2 * p - 1));   // the leg's phase at spin cycle p (skips the long glide)
const spinBump = (x) => { x -= Math.floor(x); return x < 0.5 ? Math.sin(Math.PI * 2 * x) ** 2 : 0; };
const inKick = (q) => q >= SPIN_KICK[0] && q < SPIN_KICK[1];
// One tick of the spin clock; true when it has taken over this tick's stroke. dir: +-1 the intent, or 0; err: rad still to turn.
function spinStep(st, prof, dir, style, err, hz, dt) {
  let S = st.sp;
  // (`ph0`: where the stroke clock stood when the spin began, the pose the legs and hands come from; `mix`: how far the spin's pose is in
  // force, 0 … 1 over SPIN_BLEND s in and out, so nothing pops: swimPose blends the two)
  if (dir && !S) S = st.sp = { dir, style, p: SPIN_START, amt: 0, run: 1, dp: 0, pL: 0, pR: 0, arm: new Float32Array(12), ph0: st.phase, mix: 0, k: [0, 0, 0, 0] };
  if (!S) return false;
  S.dp = 0;
  if (dir) { S.run = 1; S.dir = dir; S.style = style; }
  else if (S.run && !(S.p >= SPIN_KICK[0] / 0.52 && S.p < 0.5)) { S.run = 0; st.phase = spinComp(S.p); }   // told to stop: a thrust begun is finished, else stop at once
  S.mix = Math.max(0, Math.min(1, S.mix + (S.run ? dt : -dt) / SPIN_BLEND));
  const kp0 = S.p;                                                                        // (the kicking legs' phases before this tick, for the push release)
  if (S.run) {
    const p0 = S.p; S.p += dt * hz;
    if (!dir && p0 < 0.5 && S.p >= 0.5) { S.p = 0.5 - 1e-6; S.run = 0; }               // the thrust done
    if (S.p >= 1) S.p -= 1;
    S.dp = (S.p - p0 + 1) % 1;
  }
  const pK = spinComp(S.p), pO = S.style === 'opposed' ? spinComp(1 - S.p) : 0.92;       // the kicking leg's phase, the other's
  S.pL = S.dir > 0 ? pK : pO; S.pR = S.dir > 0 ? pO : pK; S.pK = pK; S.pO = pO;
  S.k[0] = spinComp(kp0); S.k[1] = pK; S.k[2] = S.style === 'opposed' ? spinComp(1 - kp0) : 0.92; S.k[3] = pO;
  S.amt += ((S.run ? Math.max(0, Math.min(1, err / 1.2)) : 0) - S.amt) * Math.min(1, dt * 8);   // head and torso unwind as the body comes round
  if (!S.run) { if (S.amt < 0.01 && S.mix <= 0) st.sp = null; else if (!S.fin) { S.fin = 1; st.phase = pK; } return false; }
  S.fin = 0;
  // (a thrust includes the tick that finishes it: the leg's phase jumps past the window there, and the push queued on the body is released then)
  st.act = inKick(pK) || inKick(S.k[0]) || (S.style === 'opposed' && (inKick(pO) || inKick(S.k[2]))) ? 1 : 0; st.dph = S.dp; st.phase = S.pL;
  st.v *= Math.exp(-dt * prof.drag);
  return true;
}
const _spinT = [0, 0, 0, 0, 0, 0];
// the spin's trunk channels (degrees: spine yaw first, head next, the head leading) and its hands (inside open, outside tucked)
function spinChannels(S) {
  const d = S.dir, a = S.amt, b = spinBump(S.p), tr = _spinT;
  tr[0] = d * a * 8 * spinBump(S.p + 0.06); tr[3] = d * a * 18 * spinBump(S.p + 0.12);     // (guess: leads of 0.06 and 0.12 of a cycle)
  armAngles(0, S.arm, d > 0 ? 0 : 6, 0, 'spread'); armAngles(0.25 + 0.65 * b, S.arm, d > 0 ? 6 : 0, 0, 'spread');   // armA: left then right
  return tr;
}

// The pose at this moment (see the header). `level`: the pitch that lays the body's trunk flat (0 for the swimming body, which is
// level as made; the sitting body's own trunk pitch when that is drawn instead).
export function swimPose(st, prof, { level = prof.level, t = 0, floating = null } = {}) {
  const p = st.phase - Math.floor(st.phase), f = floating != null ? (floating ? 1 : 0) : st.fl ?? 0, alt = st.alt ?? 0, steer = st.steer ?? 0;
  const push = p < STROKE.thrust ? Math.sin(Math.PI * p / STROKE.thrust) * (1 - f) : 0;
  // floating at rest, the limbs lie spread, sculling gently
  const ext = lerp(legExtension(p), 0.55 + 0.15 * Math.sin(TAU * p), f);
  const open = prof.arms ?? [1, 0.15];
  const out = {
    hop: ext,
    pose: 1 - 0.5 * f,                                         // forelegs held out to the sides (floating: looser)
    calm: 1,
    // (positive tips the nose down) level at the surface with the nose up; floating, the body hangs from its nostrils
    pitch: level - prof.headUp - 0.08 * push - (prof.hang ?? 0.3) * f + 0.02 * Math.sin(t * TAU * 0.4),
    roll: 0.03 * Math.sin(TAU * p + 1.1) * (1 - f) + 0.015 * Math.sin(t * TAU * 0.33) + 0.05 * alt * Math.sin(TAU * p) * (1 - f),
    // one leg after the other swings the body a little from side to side; a leg held back turns it
    yaw: 0.07 * alt * Math.sin(TAU * p) * (1 - f),
    sink: prof.sink,
    push,
    stroke: {
      // the legs' phases (the right leg half a cycle behind when it potters), how fully each kicks (the inner leg of a turn trails)
      pL: p, pR: p + 0.5 * alt,
      ampL: (1 - 0.35 * alt) * (1 - 0.75 * Math.max(0, -steer)), ampR: (1 - 0.35 * alt) * (1 - 0.75 * Math.max(0, steer)),
      // floating, the legs scull a little about their resting spread
      float: f, floatPose: prof.floatPose ?? 'spread', scull: 0.1 * Math.sin(TAU * p), sit: st.sit ?? 0,      // (sit: on the bottom, as it sits on land)
      // (braced forward at most halfway, as it draws its legs up; laid back for the kick and the glide: A2 26)
      arms: 0.5 * lerp(armOpen(p, open[0], open[1]), 1, 0.6 * alt), push,
    },
  };
  const S = st.sp;
  if (S) {                                                  // turning on the spot (spinStep): the legs, hands and trunk of the spin
    out.stroke.trunk = spinChannels(S);
    const w = smooth(S.mix ?? 1), spin = { pL: S.pL, pR: S.pR, ampL: 1, ampR: 1, float: 0, scull: 0, arms: 0.25, push: 0, armA: S.arm };
    if (S.run) {
      // into the spin: from the stroke the legs were in when it began (frozen at that phase), over SPIN_BLEND
      const q = S.ph0 ?? p, from = w < 1 ? { ...out.stroke, pL: q, pR: q + 0.5 * alt, scull: 0.1 * Math.sin(TAU * q), arms: 0.5 * lerp(armOpen(q, open[0], open[1]), 1, 0.6 * alt), push: 0 } : null;
      Object.assign(out.stroke, spin); out.push = 0;
      if (from) { out.stroke.blend = from; out.stroke.bw = 1 - w; }
    } else if (w > 0) { out.stroke.blend = spin; out.stroke.bw = w; }        // out of it: the ordinary stroke again, from the spin's last pose
  }
  return out;
}
