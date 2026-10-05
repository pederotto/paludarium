// A frog's hop as real frogs make it (.agents/muscles/refs/JUMPS.md: the owner's two clips, Essner et al. 2022, Li et al. 2021,
// Duman et al. 2023), one description for the game (sim/animals.js moves the frog by it, draws it by it) and the tests
// (tests/frog-hop.test.mjs). Three phases:
//   launch  the hind feet stay planted while the legs straighten down and back; the body accelerates along the take-off line, from
//           rest to the take-off speed over the distance the legs straighten (uniformly: the launch takes 2 s / v)
//   flight  a ballistic arc under gravity from where the legs left the ground to the landing place
//   land    forelimbs first, then the body; the legs fold (a short settle, the body already in place)
// No imports (tests/architecture.test.mjs: util imports nothing). Units: cm, s; the frog heads +z from the origin, y up.
//
// Until 5 Oct the hop was one parabola from the first frame (0.33-0.47 s for 1.5-7.7 cm, felt gravity 0.065-0.09 g, no launch:
// the legs had nothing to push against, so they dragged on the ground or swung in the air).
export const G_CM = 981;                           // cm/s²
export const HOPK = {
  angle: 40,                // take-off angle (deg) on the flat for a long jump; short hops take off steeper, up to angle + steep (clip A rises
  steep: 15,                // first, then travels); raised further as needed to reach a higher landing
  pushOf: 0.6,              // how much of the hop's distance the launch covers, bounded by the legs: [lo, hi] of their straightening
  pushLeg: [0.55, 0.9],     // (even a short hop straightens the legs more than halfway: clip A, 5 Oct)
  legs: 0.6,                // how far the legs straighten in a full launch, in snout-vent lengths (crouched hip-to-toe 2.0 cm to about 4.3 cm extended on the
                            // dart frog's swimming body, SVL 3.6 cm: 0.63; guess for other species until their bodies are measured)
  land: 0.06,               // the landing settle (s): forelimbs down, body down, legs fold
  hands: 0.15,              // the body is held this high (snout-vent lengths) on its reaching forelimbs as they touch down, then settles onto its
                            // belly (Essner et al. 2022: forelimbs first; clip A 1.53-1.61); without it the chin hit the ground first (5 Oct)
  noseDown: 15,             // the most the nose dips (deg) coming down to land
  noseUp: 30,               // the most the nose rises (deg) along a steep take-off (clip B's long jump lies along its path at about 30)
  short: 1.5,               // hops shorter than this many snout-vent lengths fold the legs out to the sides at once (clip A); longer ones
                            // hold them straight behind into mid-flight (clip B)
  launch: [0.03, 0.09],     // the launch's duration (s): 41 ms mean in 1 cm Brachycephalus, among the shortest of 23 genera (Essner et al.
                            // 2022); the push is shortened or lengthened to keep it in range (C1b round 3: 7 ms at 56 g, 188-340 ms before)
  pushMin: 0.15,            // the shortest push, of the legs' straightening, for the smallest hops
  descend: 2.6,             // the take-off at least this steep against the landing's slope (tan theta >= descend dy/dz; 2 is the apex on
                            // the landing spot): the frog comes down onto a higher ledge, not up through its face (C1b round 3)
  tag: 'scaled from the clips and papers in JUMPS.md; angle, pushOf and legs are guesses bounded by them',
};
export const svlOf = (size, sc = 1) => 2.6 * size * sc;     // snout-vent length (cm) from the species' size (dart frog 1.4: 3.64 cm, its model)

// The plan of a hop of `d` cm forward and `rise` cm up for a frog of snout-vent length `svl` (cm): { theta, push (cm), v (cm/s),
// tLaunch, tFlight, tLand, dur (s), short (0 long … 1 short), end: the launch's end point [y, z], ok: false when no arc reaches the
// landing coming down onto it (a ledge too high for so short a hop: the game does not take that hop) }.
// rnd: two numbers 0 … 1 drawn once a hop (which leg leads, by how much): the legs push out of step by 10-35 % of the launch (clip A:
// about a quarter to a third), and the body rolls a little toward the leg that pushes last.
export function hopPlan({ d, rise = 0 }, svl, rnd = [0.5, 0.5]) {
  const ext = HOPK.legs * svl, hands = HOPK.hands * svl;
  const short = Math.max(0, Math.min(1, (HOPK.short * svl - d) / (0.5 * svl) + 0.5));
  let push = Math.max(HOPK.pushLeg[0] * ext, Math.min(HOPK.pushLeg[1] * ext, HOPK.pushOf * d));
  let theta = 0, v = 0, dz = 0, dy = 0, ok = false;
  // (the arc and the push depend on each other: the push sets where the flight starts, the flight's speed sets how long the push
  // takes; a few rounds settle both)
  for (let pass = 0; pass < 6; pass++) {
    theta = ((HOPK.angle + HOPK.steep * short) * Math.PI) / 180;
    for (let k = 0; k < 60; k++) {
      dz = d - push * Math.cos(theta); dy = rise + hands - push * Math.sin(theta);
      const q = dz * Math.tan(theta) - dy, falls = dy <= 0 || Math.tan(theta) >= (HOPK.descend * dy) / Math.max(dz, 1e-3);
      if (dz > 0.05 && q > 0.02 && falls) { v = Math.sqrt((G_CM * dz * dz) / (2 * Math.cos(theta) ** 2 * q)); ok = true; break; }
      if (theta >= (80 * Math.PI) / 180) break;
      theta = Math.min((80 * Math.PI) / 180, theta + 0.02);          // (a high landing: jump steeper)
    }
    if (!v) { ok = false; dz = Math.max(0.05, dz); v = Math.sqrt(G_CM * Math.max(0.5, Math.hypot(dz, Math.max(0, dy)))); }
    const tL = (2 * push) / v, want = Math.max(HOPK.launch[0], Math.min(HOPK.launch[1], tL));
    const next = Math.max(HOPK.pushMin * ext, Math.min(HOPK.pushLeg[1] * ext, (v * want) / 2));
    if (Math.abs(next - push) < 1e-3 || pass === 5) break;
    push = next; v = 0; ok = false;
  }
  const tLaunch = (2 * push) / v, tFlight = dz / (v * Math.cos(theta)), tLand = HOPK.land;
  const lead = rnd[0] < 0.5 ? 'L' : 'R', lag = 0.1 + 0.25 * rnd[1], roll = (lead === 'L' ? 1 : -1) * lag * 0.25;
  return { ok, theta, push, v, tLaunch, tFlight, tLand, dur: tLaunch + tFlight + tLand, short, d, rise, hands, lead, lag, roll, end: [push * Math.sin(theta), push * Math.cos(theta)] };
}

// Where the frog's reference point (its place on the ground when sitting) is at hop time t (0 … 1 of plan.dur), and its phase:
// { pos: [0, y, z], vy, vz (cm/s), phase: 'launch' | 'flight' | 'land', u (0 … 1 within the phase), s (seconds since the start) }.
export function hopAt(plan, t) {
  const s = Math.max(0, Math.min(1, t)) * plan.dur, c = Math.cos(plan.theta), n = Math.sin(plan.theta);
  if (s < plan.tLaunch) {
    const u = s / plan.tLaunch, k = plan.push * u * u, vv = (2 * plan.push * u) / plan.tLaunch;
    return { pos: [0, k * n, k * c], vy: vv * n, vz: vv * c, phase: 'launch', u, s };
  }
  const f = s - plan.tLaunch;
  if (f < plan.tFlight) {
    const y = plan.end[0] + plan.v * n * f - 0.5 * G_CM * f * f, z = plan.end[1] + plan.v * c * f;
    return { pos: [0, y, z], vy: plan.v * n - G_CM * f, vz: plan.v * c, phase: 'flight', u: f / plan.tFlight, s };
  }
  const u = Math.min(1, (f - plan.tFlight) / plan.tLand), e = u * u * (3 - 2 * u);
  return { pos: [0, plan.rise + (plan.hands ?? 0) * (1 - e), plan.d], vy: 0, vz: 0, phase: 'land', u, s };
}

// The body's pitch (rad, + nose down: Euler x, as draw() sets it): nose up along the take-off line as the legs push, then along the
// arc, level again as it lands. How much of the line and the arc the body follows grows with the hop's length: a short hop keeps the
// body near level (clip A: "body at its highest in the launch, level"), a long jump lies along its path (clip B). (Until 5 Oct 14:50
// every hop followed 0.6 of them: a short hop pitched 33 deg up and turned 16 deg a frame, up to 43 on a step: C1b round 5.)
export function hopPitch(plan, at) {
  const k = 0.25 + 0.35 * (1 - (plan.short ?? 0)), cap = (HOPK.noseDown * Math.PI) / 180, up = (HOPK.noseUp * Math.PI) / 180;
  const lim = (q) => Math.max(-up, Math.min(cap, q));
  // (nose up along the take-off line over the first two thirds of the push. In the owner's clips C and D the body tilts up BEFORE
  // the legs move: that needs an aim phase ahead of the launch, open; tilting faster inside a 30-90 ms launch, 2-5 frames, turned
  // the body up to 27 deg a frame, 5 Oct)
  if (at.phase === 'launch') return lim(-plan.theta * k * Math.min(1, at.u * 1.5));
  if (at.phase === 'flight') return lim(-Math.atan2(at.vy, Math.max(1e-3, at.vz)) * k);
  // (landing: from the pitch it came down with, eased level)
  const vy = plan.v * Math.sin(plan.theta) - G_CM * plan.tFlight, e = at.u * at.u * (3 - 2 * at.u);
  return lim(-Math.atan2(vy, plan.v * Math.cos(plan.theta)) * k) * (1 - e);
}

// The drawn frame at hop time t: which body draws it, where, how pitched, and the maps between its model (cm) and the world.
// The swimming body draws the whole hop near the camera until the landing has settled (LEAP_TO of the landing phase), lifted as
// draw() lifts it; the sitting body draws the rest.
export const LEAP_TO = 0.85;                        // of the landing phase
// The roll (rad, about the body's length; + right side down, Euler z) from the uneven push: builds through the launch, eases off in
// the air.
export function hopRoll(plan, at) {
  const r = plan.roll ?? 0;
  if (at.phase === 'launch') return r * at.u;
  if (at.phase === 'flight') return r * (1 - at.u);
  return 0;
}
// `pivot` (model cm, optional): the point the swimming body pitches and rolls about, its hips: the legs push there, so the hips follow
// the launch path and the head tips up (about the model's origin, the rear sank as the nose rose: 5 Oct).
export function hopFrame(t, hop, size, sc = 1, pivot = null) {
  const plan = hop.plan ?? hopPlan(hop, svlOf(size, sc)), at = hopAt(plan, t);
  const swim = at.phase !== 'land' || at.u < LEAP_TO;
  const pitch = hopPitch(plan, at), roll = hopRoll(plan, at), lift = swim ? 0.27 * size * sc : 0;
  const c = Math.cos(pitch), s = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll), pos = [at.pos[0], at.pos[1] + lift, at.pos[2]];
  if (swim && pivot) {
    // (the instance's position moved so the rotation turns about the pivot: pos + pivot - R pivot)
    const x0 = pivot[0] * sc, y0 = pivot[1] * sc, z = pivot[2] * sc, x = x0 * cr - y0 * sr, y = x0 * sr + y0 * cr;
    pos[0] += x0 - x; pos[1] += y0 - (y * c - z * s); pos[2] += z - (y * s + z * c);
  }
  // (three.js Euler 'YXZ' with no yaw: R = Rx(pitch) Rz(roll))
  return {
    body: swim ? 'swim' : 'sit', pos, pitch, roll, at, plan,
    toWorld: (p) => {
      const x0 = p[0] * sc, y0 = p[1] * sc, z = p[2] * sc, x = x0 * cr - y0 * sr, y = x0 * sr + y0 * cr;
      return [pos[0] + x, pos[1] + y * c - z * s, pos[2] + y * s + z * c];
    },
    toModel: (w) => {
      const x = w[0] - pos[0], yy = w[1] - pos[1], zz = w[2] - pos[2], y = yy * c + zz * s, z = -yy * s + zz * c;
      return [(x * cr + y * sr) / sc, (-x * sr + y * cr) / sc, z / sc];
    },
  };
}
