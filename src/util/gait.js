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

// Buoyancy bob: a slow swell of the water surface under a floating animal plus a dip as the legs push. Centimetres, for
// an animal of body length `size` cm. `t` seconds, `phase` the kick phase (0 when the legs are not kicking).
export function bob(t, size, phase = 0, kicking = 0) {
  const swell = Math.sin(t * TAU * 0.38) * 0.05 + Math.sin(t * TAU * 0.71 + 1.3) * 0.025;
  return size * (swell - 0.05 * kicking * Math.sin(Math.PI * frac(phase)));
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
// The legs drive from cocked to straight as hopLegs says, hips and knees first and the ankles and feet after them (the order a
// frog's joints extend in a take-off: Biomimetics 9(3):168, 2024), trail through the flight and fold up before the landing; the
// forelegs leave the ground, lie back under the chest in the air and reach forward and down to land on.
export function leapStroke(t, out = null) {
  t = clamp01(t);
  const o = out ?? { legA: new Float32Array(9), armA: new Float32Array(6) }, C = HIND.cock, L = HIND.leap;
  const e = hopLegs(t), late = hopLegs(Math.max(0, t - 0.04));      // (the ankles and feet a moment behind the hips and knees)
  for (let c = 0; c < 9; c++) o.legA[c] = lerp(C[c], L[c], c === 2 || c === 3 || c === 6 || c === 7 || c === 8 ? late : e);
  const S = FORE.stand, T = FORE.air, R = FORE.reach;
  const up = smooth(t / 0.16), down = smooth((t - 0.5) / 0.3), home = smooth((t - 0.85) / 0.15);
  for (let c = 0; c < 6; c++) { const air = lerp(lerp(S[c], T[c], up), R[c], down); o.armA[c] = lerp(air, S[c], home); }
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
//   swimStep(st, prof, { urgency, floating, steer, bodyLen }, dt)   the stroke clock: kick rate from urgency, bursts of kicks with
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
  cock: [125, -22, 95, 100, -16, 18, -25, -25, 0],
  kick: [85, 30, 80, 95, -8, 6, -20, -20, 0],
  open: [36, 24, 34, 40, -5, 0, -8, -5, 35],
  glide: [14, -4, 0, 2, -4, 3, 2, 0, 90],
  draw: [62, -32, 0, 4, -8, 10, 0, 0, 90],
  turn: [100, -38, 20, 30, -13, 16, -10, -12, 55],
  // resting at the surface: the thighs straight out, the shins hanging back, the feet out and down (a leopard frog floating)
  float: [80, 5, 45, 50, -20, -25, -30, -30, 20],
  // in the air: the legs trailing behind, a little apart and a little bent, the feet stretched back (a leaping frog, the user's photo)
  leap: [30, 10, 16, 20, -12, -6, -4, 0, 70],
};
export const FORE = {
  tuck: [22, 6, 0, -22, -6, 0],             // laid back along the flanks: a frog driving through the water
  spread: [76, 109, 119, 10, -9, -2],       // held out to the sides, hands flat (the swimming scan's own pose; the user's photo)
  hang: [95, 125, 125, -30, -40, -50],      // floating: out and down, the hands hanging
  stand: [95, 172, 172, -52, -56, -6],      // on the ground: the arm down and out, the forearm down, the hand forward (a sitting frog)
  reach: [150, 165, 172, -38, -48, -12],    // reaching forward and down for the landing
  air: [35, 20, 10, -40, -30, -12],         // in the air: drawn back and down under the chest
};
export const STROKE_KEYS = [[0, 'cock'], [0.08, 'kick'], [0.16, 'open'], [0.26, 'glide'], [0.6, 'glide'], [0.74, 'draw'], [0.88, 'turn'], [1, 'cock']];
// (the thrust: the legs drive from cocked to open; the phase a resting frog holds its legs at)
export const STROKE = { thrust: 0.16, close: 0.26, glide: 0.6, recover: 1 };
export const GLIDE_HOLD = 0.45;

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
// kicks (less: toward the floating posture, a leg that paddles or trails as a rudder); `float` (0 … 1): resting at the surface.
export function strokeAngles(p, out, o = 0, amp = 1, float = 0) {
  const u = frac(p) * STROKE_N, i = Math.min(STROKE_N - 1, Math.floor(u)), f = u - i, F = HIND.float, k = amp * (1 - float);
  for (let c = 0; c < HC; c++) {
    const v = STROKE_TAB[i * HC + c] * (1 - f) + STROKE_TAB[(i + 1) * HC + c] * f;
    out[o + c] = F[c] + (v - F[c]) * k;
  }
  return out;
}

// A foreleg's angles (degrees, the six of FORE) for `open` (0 laid back along the flank … 1 held out) and `float`.
export function armAngles(open, out, o = 0, float = 0) {
  const T = FORE.tuck, S = FORE.spread, H = FORE.hang;
  for (let c = 0; c < 6; c++) { const v = T[c] + (S[c] - T[c]) * open; out[o + c] = v + (H[c] - v) * float; }
  return out;
}

// How far the forelegs are held out through a stroke: laid back as the legs drive and through the glide (`glide`: a poison frog,
// a poor swimmer, keeps them half out to balance), out as it draws its legs up (`draw`), swept back with the kick.
export function armOpen(p, draw = 1, glide = 0) {
  p = frac(p);
  if (p < 0.12) return lerp(draw, glide, smooth(p / 0.12));
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
export const swimState = (rnd = Math.random) => ({ phase: 0.9 + rnd() * 0.08, burst: 0, rest: 0, v: 0, kicks: 0, rested: false, alt: 0, fl: 0, steer: 0 });

// Kicks a second at an urgency 0 (pottering) … 1 (a dash for the way out).
export const kickRate = (prof, urgency) => lerp(prof.kickHz[0], prof.kickHz[1], clamp01(urgency));

export function swimStep(st, prof, { urgency = 0.5, floating = false, steer = 0, bodyLen = 4, rnd = Math.random } = {}, dt) {
  if (!(dt > 0)) return st.v;
  // (eased, so the legs pass from one way of swimming to another instead of jumping: floating, one leg after the other, steering)
  const ease = (k, to, rate) => { st[k] = (st[k] ?? 0) + (to - (st[k] ?? 0)) * Math.min(1, dt * rate); };
  ease('fl', floating ? 1 : 0, 2.5);
  ease('alt', !floating && urgency < 0.3 ? 1 : 0, 3);
  ease('steer', Math.max(-1, Math.min(1, steer)), 6);
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
  const hz = kickRate(prof, urgency), before = st.phase;
  st.phase += dt * hz;
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
  st.v = (prof.reach * bodyLen * hz / KICK_MEAN) * lerp(both, one, st.alt) * (1 - 0.3 * Math.abs(st.steer));
  return st.v;
}

// The pose at this moment (see the header). `level`: the pitch that lays the body's trunk flat (0 for the swimming body, which is
// level as made; the sitting body's own trunk pitch when that is drawn instead).
export function swimPose(st, prof, { level = prof.level, t = 0, floating = null } = {}) {
  const p = st.phase - Math.floor(st.phase), f = floating != null ? (floating ? 1 : 0) : st.fl ?? 0, alt = st.alt ?? 0, steer = st.steer ?? 0;
  const push = p < STROKE.thrust ? Math.sin(Math.PI * p / STROKE.thrust) * (1 - f) : 0;
  // floating at rest, the limbs lie spread, sculling gently
  const ext = lerp(legExtension(p), 0.55 + 0.15 * Math.sin(TAU * p), f);
  const open = prof.arms ?? [1, 0.15];
  return {
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
      float: f, scull: 0.1 * Math.sin(TAU * p),
      arms: lerp(armOpen(p, open[0], open[1]), 1, 0.6 * alt), push,
    },
  };
}
