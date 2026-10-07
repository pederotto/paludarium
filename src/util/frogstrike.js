// A frog's tongue strike as ONE movement (gate 4, the common frog, 7 Oct 2026; docs/SKELETON.md "Skulls and mandibles"). Pure: no three, no sim.
// The owner's rule: the jaw, the hyoid and the tongue are bones driven by one timeline, never free sliders that allow impossible poses. Anatomy (sources in
// .agents/skin/AUDIT-2026-10-07.md): the tongue is attached at the front of the lower jaw and lies folded back over the hyoid; the jaw drops (up to 3,700 deg/s in Rana)
// and the tongue flips about 180 deg over the jaw tip, whip-like (its base first), stretching to about 130 % of its length while it thins; it comes back as the jaws
// close; the floor of the mouth (on the hyoid) drops as the mouth opens and lifts in the gulp.
//   strikeCurves(t, P)       t 0 .. 1 along the strike -> { gape (rad), p (projection 0..1), s (stretch 1..P.stretch), h (hyoid drop, cm) }
//   tongueAngles(p, P, out)  the four tongue segments' turns (rad, about the jaw's lateral axis, base first by P.lag each)
//   strikeTime(phase, tIn, dur)  the sim's strike phases (sim/animals.js strikes: aim, out, back, gulp) -> t on the timeline
// The numbers are the ones checked frame by frame on the common frog's mouth (.agents/skin/eu1007/strike_sweep.py: 0 tongue vertices in tissue in 26 frames). Gape,
// timing and the hyoid drop are guesses until checked against film of the species.
export const FROG_STRIKE = { gapeDeg: 45, a0Deg: 150, dDeg: -5, lag: 0.22, stretch: 1.3, hyoidDropCm: 0.21, gulpLiftCm: 0.08 };

// The lunge that carries the strike to prey on the ground (the owner, 7 Oct 2026, "longer tongue?": a sitting common frog's mouth is 3-4 cm up and tilted
// nose up, so its tongue alone flicks level or upward): with the hind feet planted the legs open and tip the body nose down about its vent (the root motion,
// dipDeg) and slide it forward (slideCm), the toes peeling a little (peel of a hop's peel), the arms leaving the ground and swinging forward (armMix of
// FORE[armKey]), while the tongue goes out; it comes back up as the catch is drawn in. dip and slide are chosen per strike by the sim from where the prey is
// (sim/animals.js lungeFit), within maxDipDeg and maxSlideCm; dipDeg and slideCm are the defaults for the tools. contactT: the timeline's contact (the end of `out`).
export const FROG_LUNGE = { dipDeg: 15, slideCm: 1.0, maxDipDeg: 40, maxSlideCm: 1.4, peel: 0.6, short: 0, liftPerDeg: 0.02, armKey: 'reach', armMix: 0.5, contactT: 0.40 };

const sm = (x) => { const c = x < 0 ? 0 : x > 1 ? 1 : x; return c * c * (3 - 2 * c); };
const RAD = Math.PI / 180;

// how far into the lunge (0 sitting .. 1 fully thrown forward) at t on the strike's timeline: out by contact, back by the time the jaws shut
export const lungeCurve = (t) => sm(t / 0.36) - sm((t - 0.46) / 0.36);

// The body through the lunge: the stroke for render/creatures/skeleton.js poseStroke and the root motion. The hind feet stay planted where the sitting crouch put
// them (poseStroke's planted-leg solver, as in a hop's launch: `plant` and the two `frames`, the sitting one and this one), so the legs open as the body tips
// and slides over them; the arms leave the ground and swing forward (armMix of FORE[armKey]); the head follows the strike's timeline. The root (out.root:
// lungeRoot) is where the body is; the sim draws it there. `HIND`/`FORE` are util/gait.js's keys, passed in to keep this file free of imports.
export function lungePose(sit, t, dipDeg, slideCm, HIND, FORE, out = {}, P = FROG_LUNGE) {
  // (sit.legA / sit.armA: the stance's own leg angles (both sides alike) and arm angles (6, or 12: left then right); else HIND[legKey] and FORE.stand turned down by armDeg [left, right])
  const r = lungeRoot(sit, t, dipDeg, slideCm, (out.root ??= {}), P), k = r.k, am = k * P.armMix, h0 = sit.legA ?? HIND[sit.legKey], f1 = FORE[P.armKey], f0 = FORE.stand;
  const legA = (out.legA ??= new Float32Array(h0.length * 2)), armA = (out.armA ??= new Float32Array(12));
  for (let i = 0; i < h0.length; i++) legA[i] = legA[h0.length + i] = h0[i];
  for (let s = 0; s < 2; s++) for (let i = 0; i < 6; i++) { const a = sit.armA ? sit.armA[(sit.armA.length >= 12 ? s * 6 : 0) + i] : f0[i] - (i === 3 || i === 4 ? sit.armDeg[s] : 0); armA[s * 6 + i] = a + (f1[i] - a) * am; }
  out.crouchA = sit.legA ?? null;
  out.roll = sit.roll ?? null;                       // (the stance's limb rolls: [forearmL, handL, forearmR, handR, thighL, thighR], degrees)                    // (the planted feet are where the stance's legs put them: poseStroke's plantDirs)
  const pl = (out.plant ??= { L: 0, R: 0 }); pl.L = pl.R = k > 1e-3 ? Math.max(1e-3, k * P.peel) : 0;
  out.short = P.short;
  const fr = (out._fr ??= { f0: groundFrame(), ft: groundFrame() });
  lungeRoot(sit, 0, 0, 0, fr.f0.r, P); setFrame(fr.f0); fr.ft.r = r; setFrame(fr.ft);
  out.frames = k > 1e-3 ? fr : null;                 // (sitting: no frames, so nothing is solved and the stance is the plain crouch)
  out.strikeT = t;
  return out;
}

// a frame of the body in the frog's ground frame, as util/hop.js hopFrame's (toWorld / toModel / pos), for poseStroke's planted legs and its floor check
function groundFrame() { return { r: {}, pos: [0, 0, 0], at: null, plan: null, c: 1, s: 0, toWorld(p) { const o = this.r.off; return [p[0] + o[0], this.c * p[1] - this.s * p[2] + o[1], this.s * p[1] + this.c * p[2] + o[2]]; },
  toModel(w) { const o = this.r.off, y = w[1] - o[1], z = w[2] - o[2]; return [w[0] - o[0], this.c * y + this.s * z, -this.s * y + this.c * z]; } }; }
function setFrame(f) { f.c = Math.cos(f.r.pitch); f.s = Math.sin(f.r.pitch); f.pos[0] = f.r.off[0]; f.pos[1] = f.r.off[1]; f.pos[2] = f.r.off[2]; }

// The lunge's root motion (the body as a whole, in the frog's ground frame: model cm, y up from the ground, z ahead): the sitting tilt (sit.pitchDeg nose up about
// the model's origin, then sit.offsetCm) tipped nose down by k * dipDeg about the vent (sit.pivotCm, where the sitting body rests on the ground) and slid
// forward by k * slideCm, the hips lifted with the dip (k * dipDeg * liftPerDeg: the legs' push, so the belly tipping about the vent does not go into the ground).
// out.pitch (rad, about x; negative = nose up) and out.off (cm): a model point p goes to rotX(pitch) p + off.
export function lungeRoot(sit, t, dipDeg, slideCm, out = {}, P = FROG_LUNGE) {
  const k = lungeCurve(t), d = k * dipDeg * RAD, c = Math.cos(d), s = Math.sin(d), V = sit.pivotCm, o = sit.offsetCm;
  const ry = o[1] - V[1], rz = o[2] - V[2];
  out.k = k; out.pitch = -sit.pitchDeg * RAD + d;
  const off = (out.off ??= [0, 0, 0]);
  off[0] = o[0]; off[1] = c * ry - s * rz + V[1] + k * dipDeg * P.liftPerDeg; off[2] = s * ry + c * rz + V[2] + k * slideCm;
  return out;
}

// A point of the posed body (model cm: the jaw's tip, the tongue's tip at contact) in the ground frame at that lunge.
export function lungePoint(sit, t, dipDeg, slideCm, p, out = [0, 0, 0], r = {}) {
  lungeRoot(sit, t, dipDeg, slideCm, r);
  const c = Math.cos(r.pitch), s = Math.sin(r.pitch);
  out[0] = p[0] + r.off[0]; out[1] = c * p[1] - s * p[2] + r.off[1]; out[2] = s * p[1] + c * p[2] + r.off[2];
  return out;
}

export function strikeCurves(t, P = FROG_STRIKE, out = {}) {
  out.gape = P.gapeDeg * RAD * (sm(t / 0.12) - sm((t - 0.62) / 0.22));
  out.p = sm((t - 0.04) / 0.30) - sm((t - 0.45) / 0.30);
  out.s = 1 + (P.stretch - 1) * (sm((t - 0.20) / 0.18) - sm((t - 0.45) / 0.25));
  out.h = P.hyoidDropCm * (sm(t / 0.15) - sm((t - 0.60) / 0.25)) - P.gulpLiftCm * (sm((t - 0.85) / 0.06) - sm((t - 0.95) / 0.05));
  return out;
}

export function tongueAngles(p, P = FROG_STRIKE, out = new Float32Array(4)) {
  for (let k = 0; k < 4; k++) out[k] = (P.a0Deg + k * P.dDeg) * RAD * sm((p - k * P.lag) / (1 - 3 * P.lag));
  return out;
}

// The sim's phases onto the timeline: aiming keeps the mouth shut (the crouch is the body's); `out` (the flick, `dur` s) runs to contact at 0.40;
// `back` (the catch drawn in) to 0.84, the jaws closing; the gulp to 1.
export function strikeTime(phase, tIn, dur) {
  const k = Math.min(1, Math.max(0, tIn / (dur || 1)));
  return phase === 'out' ? 0.40 * k : phase === 'back' ? 0.40 + 0.44 * k : phase === 'gulp' ? 0.84 + 0.16 * k : 0;
}

// The muscles that make the strike (content/anuranheadmuscles.js HEAD_MUSCLES ids), 0 .. 1 each, from the timeline itself: a muscle is active while the movement it makes
// is under way (the rate of its curve, normalised by the curve's fastest rate), and the eye retractors through the gulp. The movement rule: no strike without them.
//   DM depressor mandibulae (the jaw opens), AM adductor mandibulae (it closes), GG genioglossus (the tongue out), HG hyoglossus (back), SH sternohyoid (the throat floor
//   drops), RB retractor bulbi (the eyes pressed down on the prey in the gulp)
export function strikeMuscles(t, P = FROG_STRIKE, out = {}) {
  const e = 1e-3, a = strikeCurves(Math.max(0, t - e), P, {}), b = strikeCurves(Math.min(1, t + e), P, {}), dt = Math.min(1, t + e) - Math.max(0, t - e);
  const rate = (k) => (b[k] - a[k]) / dt, cap = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const g0 = P.gapeDeg * RAD;
  out.DM = cap(rate('gape') / (g0 * 12)); out.AM = cap(-rate('gape') / (g0 * 6));
  out.GG = cap(rate('p') / 5); out.HG = cap(-rate('p') / 5);
  out.SH = cap(rate('h') / (P.hyoidDropCm * 8));
  out.RB = t > 0.84 && t < 1 ? Math.sin(Math.PI * (t - 0.84) / 0.16) : 0;
  return out;
}
