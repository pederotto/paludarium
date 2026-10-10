// A one-body frog's feet on the ground (9 Oct 2026, the owner's movement rule: "no yaw without the legs stepping": a one-body frog turned on the spot like a turntable and could not walk).
// Pure: no three, no sim. Each foot is PLANTED at a point of the world and stays there while the body moves or turns over it; when the body has carried the foot's home (where the sitting
// stance has it, under the body) further than `thr` from it, the foot lifts, swings and is planted again at where its home will be by touchdown. Never two feet of one girdle (the two
// hind feet, the two hands) or of one side (hand and hind foot) are in the air together: the diagonal pairs trot, a turn steps its feet round one pair at a time.
// When the body stops, the feet step home one pair at a time and the stepper goes quiet (`active` false: the caller draws the plain sitting stance, byte for byte).
//   homes   [{ key, G: [x, y, z] (the stance's foot tip in the frog's ground frame, cm at scale 1: x right, y up, z ahead), D: [x, y, z] (the foot's direction there) }]
//   S = stepperNew(homes);  stepperStep(S, { pos: [x, y, z] (the frog's ground point), q: [x, y, z, w] (its orientation: yaw, slope), sc }, dt, P)   (P: STEP below, scaled by the frog's snout-vent
//   length svl in cm)    ->  S.feet[i] = { key, W: [x, y, z] (world), D: [x, y, z] (world), u (0 planted, else the swing 0 .. 1), lift (cm) }
// The time a step takes at this size (s): a small frog's feet are quick (time grows as the square root of the length: the frog's own pendulum), `P.swing` at a harlequin's 2.73 cm.
export const stepSwing = (svl, P = STEP) => P.swing * Math.sqrt(svl / 2.73);
// The fastest yaw (rad/s) its feet can follow: each foot may be carried `thr` (the reach it has to spare, 0.8 of it) between its steps, one pair after the other (two swings), at about 0.55 of the
// snout-vent length from the hips. The sim never turns a one-body frog faster (Animals.turnTo): a faster turn would pull a planted foot out of reach.
export const stepTurnCap = (svl, P = STEP) => (0.8 * P.thr) / stepSwing(svl, P) / 0.55;
// Units: cm and seconds of animal time (distance-driven like the leg cycle: at fast-forward the feet keep pace with the body).
export const STEP = {
  thr: 0.17,       // how far (x svl) the home may be carried from the planted foot before it steps; a trot of 0.34 svl a step
  settle: 0.03,    // (x svl) the stance's own place: a body at rest steps its feet home until they are this near
  swing: 0.13,     // s in the air (animal time), at a 3.3 cm frog: a short quick step, as a small frog's
  lift: 0.08,      // (x svl) how high the foot is carried
  over: 0.25,      // how far past its home (of the step) the foot lands: a stride that keeps ahead of the body instead of arriving as it passes
  min: 0.07,       // (x svl) the least a foot is let be carried, however little reach the stance leaves it
  moving: 0.012,   // (x svl per second) the body counts as still below this, and below `turning` rad/s
  turning: 0.05,
};

const rot = (q, v) => {                 // v rotated by the unit quaternion q = [x, y, z, w]
  const [x, y, z, w] = q, tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
};
const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const qyaw = (a) => [0, Math.sin(a / 2), 0, Math.cos(a / 2)];
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
// which feet may not be in the air with this one: the other of its girdle and the other of its side
const girdle = (k) => k.slice(0, 1), side = (k) => k.slice(1);

export function stepperNew(homes) {
  return { homes, feet: homes.map((h) => ({ key: h.key, W: [0, 0, 0], D: [0, 0, 1], u: 0, lift: 0, from: null, to: null, dur: 0 })), init: false, active: false, last: null, yaw: 0 };
}

const homeW = (h, pos, q, sc) => { const g = rot(q, [h.G[0] * sc, h.G[1] * sc, h.G[2] * sc]); return [pos[0] + g[0], pos[1] + g[1], pos[2] + g[2]]; };

// One tick. Returns S.active.
export function stepperStep(S, body, dt, P = STEP, svl = 3.3) {
  const { pos, q } = body, sc = body.sc ?? 1;
  // the yaw of the body about the vertical, for its rate: from its orientation
  const f = rot(q, [0, 0, 1]), yaw = Math.atan2(f[0], f[2]);
  const reset = () => { for (let i = 0; i < S.homes.length; i++) { const h = S.homes[i], ft = S.feet[i]; ft.W = homeW(h, pos, q, sc); const d = rot(q, h.D); ft.D = d; ft.u = 0; ft.lift = 0; ft.from = ft.to = null; } S.init = true; S.active = false; };
  if (!S.init || !S.last || Math.hypot(pos[0] - S.last[0], pos[2] - S.last[2]) > 3 * svl) { reset(); S.last = [pos[0], pos[1], pos[2]]; S.yaw = yaw; return false; }
  if (!(dt > 1e-6)) return S.active;
  const vx = (pos[0] - S.last[0]) / dt, vz = (pos[2] - S.last[2]) / dt, speed = Math.hypot(vx, vz);
  let dy = yaw - S.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
  const w = dy / dt;
  S.last = [pos[0], pos[1], pos[2]]; S.yaw = yaw;
  const still = speed < P.moving * svl && Math.abs(w) < P.turning;
  const thr = (still ? P.settle : P.thr) * svl, dur = stepSwing(svl, P);
  // feet in the air: advance them
  let air = 0;
  for (const ft of S.feet) {
    if (ft.to) {
      ft.u += dt / ft.dur; air++;
      const e = smooth(ft.u);
      if (ft.u >= 1) { ft.W = ft.to; ft.lift = 0; ft.u = 0; ft.from = ft.to = null; air--; }
      else { ft.W = [ft.from[0] + (ft.to[0] - ft.from[0]) * e, ft.from[1] + (ft.to[1] - ft.from[1]) * e, ft.from[2] + (ft.to[2] - ft.from[2]) * e]; ft.lift = P.lift * svl * Math.sin(Math.PI * ft.u); }
    }
  }
  // feet that want to step, the furthest first
  const want = [];
  for (let i = 0; i < S.feet.length; i++) {
    const ft = S.feet[i]; if (ft.to) continue;
    const hw = homeW(S.homes[i], pos, q, sc), d = Math.hypot(hw[0] - ft.W[0], hw[2] - ft.W[2]), h = S.homes[i];
    // (a foot with little reach to spare, a hand held out nearly straight, steps sooner: carried as far as the others it would be out of reach)
    const lim = still ? thr : Math.min(thr, Math.max(P.min * svl, 0.8 * (h.slack ?? 1e9) * sc));
    if (d > lim) want.push([d, i, hw]);
  }
  want.sort((a, b) => b[0] - a[0]);
  for (const [, i, hw] of want) {
    const ft = S.feet[i], k = ft.key;
    // (not with the other foot of its girdle or of its side in the air)
    if (S.feet.some((o) => o.to && o !== ft && (girdle(o.key) === girdle(k) || side(o.key) === side(k)))) continue;
    // where its home will be at touchdown: the body carried on at its speed and yaw rate, the foot landing a little ahead of that
    const pos2 = [pos[0] + vx * dur, pos[1], pos[2] + vz * dur], q2 = qmul(qyaw(w * dur), q), h2 = homeW(S.homes[i], pos2, q2, sc);
    const to = [h2[0] + (h2[0] - ft.W[0]) * P.over, h2[1], h2[2] + (h2[2] - ft.W[2]) * P.over];
    // (a body at rest lands it exactly home)
    if (still) { to[0] = h2[0]; to[1] = h2[1]; to[2] = h2[2]; }
    ft.from = ft.W.slice(); ft.to = to; ft.u = 0; ft.dur = still ? dur * 1.3 : dur;
    ft.D = rot(q2, S.homes[i].D);
  }
  const quiet = air === 0 && want.length === 0 && still && S.feet.every((ft) => !ft.to);
  if (quiet) { S.active = false; return false; }      // (home, within the settle distance: the plain stance is drawn; the feet stay planted where they are, ready for the next step)
  S.active = true;
  return true;
}
