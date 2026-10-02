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
