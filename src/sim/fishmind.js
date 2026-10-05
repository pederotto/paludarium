// A swimmer's energy-aware mind (B5a). The water carries a fish (its velocity over the ground is the water's plus its own through
// the water, animals.js swim()); where it points follows where it swims, which follows where it wants to go, never the current
// itself (a fish holding its place in a current faces upstream only because holding is swimming upstream). Swimming costs power
// P(u) = BASAL + (u/Us)^3 (drag ~ u², power ~ u³), Us the fastest it keeps up; above Us it runs into a debt (fatigue F, 0 … 1) that
// it pays back slowly below. Every THINK s it weighs a few spots by the work to get there and to hold there and picks the cheapest
// (slack water, the lee of a solid, the floor's boundary layer), rides a current that goes its way, rests in slack water when tired,
// and bursts out across the flow when it is carried at the glass or the intake.
// Pure: the world comes in as callbacks (probe(x, y, z, out) the water there, ok(x, y, z) swimmable, edge(x, y, z, m) within m cm of
// the glass or the intake; sim/currentat.js makes them for the tank), its random numbers from its own seeded stream.
import { seededRng } from './swimrest.js';

// ALL GUESSES, to be tuned (nothing in the project data gives them):
export const SUSTAIN = 1.6;       // Us = SUSTAIN x cruising speed (sp.speed): the fastest it keeps up without tiring
export const BURST = 2.1;         // Ub = BURST x cruising speed: a burst (the food dart's old factor)
export const BASAL = 0.15;        // power at rest, in units of the swimming power at Us
export const FATIGUE_S = 20;      // s to fill F at twice the power it can sustain (a burst at Ub fills it in about 16 s)
export const RECOVER_S = 120;     // s to empty F while holding still
export const TIRED = 0.6, SPENT = 0.9, RESTED = 0.2;   // F at which it is tired (rests), spent (barely swims), rested again
export const THINK = 0.5;         // s between choices
export const REACH = 10;          // cm: how far the spots it weighs lie
export const HORIZON = 10;        // s of holding a spot that the score counts
export const TIRED_HOLD = 4;      // weight on holding when tired
export const WANT = 1.5;          // pull (power x s) of the way its behaviour wants to go (wander, school)
export const SLACK = 0.3;         // slack water: slower than SLACK x Us
export const FLOW_DEFAULT = 0.5;  // sp.flow (the most current it bears, 0 … 1) for a row without one
export const OVER = 10;           // weight on water faster than Us at a spot
export const EDGE = 20;           // weight on a spot within a body length of the glass or the intake in water faster than slack
export const GRIP = 4;            // cm/s: a body lying on the floor holds against slower water
export const HYST = 0.2;          // a new spot must score this share better than the current goal
export const REST_LABEL = 'Resting in slack water';
export const COST = { ms: 0, frames: 0, t: null };   // time spent here and in currentAt (ms) and the frames it ran in

const now = () => globalThis.performance?.now() ?? 0;
const ZERO = Object.freeze({ x: 0, y: 0, z: 0 });
export const power = (m, u) => BASAL + (u / m.Us) ** 3;

export function fishMind(sp, phase = 0) {
  const rnd = seededRng((Math.floor((phase ?? 0) * 1e6) ^ 0x5BD1E995) >>> 0), v = sp.speed ?? 3;
  return {
    v, Us: SUSTAIN * v, Ub: BURST * v, flow: sp.flow ?? FLOW_DEFAULT, size: sp.size ?? 3, F: 0, work: 0, rnd,
    next: rnd() * THINK, goal: null, best: null, tired: false, resting: false, side: rnd() < 0.5 ? -1 : 1, escT: 0,
    I: { dir: null, hold: true, escape: false, cap: 0, burst: 0, label: null }, _d: { x: 0, z: 0 },
    st: { t: 0, slack: 0, pin: 0, pinMax: 0, c: 0, s: 0, d: 0 },
  };
}

// Fatigue and work of swimming at u cm/s through the water for dt s.
export function fishEnergy(m, u, dt) {
  const x = (u / m.Us) ** 3;
  m.F = Math.min(1, Math.max(0, m.F + (x > 1 ? (x - 1) / FATIGUE_S : -(1 - x) / RECOVER_S) * dt));
  m.work += (BASAL + x) * dt;
  return m.F;
}

// The water that moves the body: all of it, except that a body lying on the floor grips against water slower than GRIP.
export const fishCarry = (w, resting) => (resting && Math.hypot(w.x, w.y, w.z) < GRIP ? ZERO : w);

// Its own velocity through the water (into out; out may be d) for the ground velocity d its behaviour asks for, in water w, within cap.
// mode 0 travel: the ground speed with the least work per distance (faster when the water helps: riding); d = 0: it drifts.
// mode 1 urgent (dart, flight, wall): exactly d over the ground. mode 2 hold: d = 0 means keep its place (swim against w).
// Water it cannot make way against: it swims across the flow, toward d's side, at the cap.
const G = [0, 0, 0];
export function fishOwn(m, d, w, cap, mode, out) {
  const t0 = now(), dx = d.x, dy = d.y, dz = d.z, dl = Math.hypot(dx, dz), wl = Math.hypot(w.x, w.z);
  let ox = dx - w.x, oz = dz - w.z;
  if (dl < 1e-3 && mode !== 2) ox = oz = 0;
  else if (mode === 0 && dl >= 1e-3) {
    const ux = dx / dl, uz = dz / dl, wp = w.x * ux + w.z * uz;
    let n = 1, bg = 0, best = Infinity;
    G[0] = dl;
    if (wp > 0.3) { G[1] = wp + 0.3 * m.v; G[2] = wp + 0.6 * m.v; n = 3; }
    for (let pass = 0; pass < 2 && !bg; pass++) {
      if (pass) { G[0] = dl / 2; G[1] = dl / 4; n = 2; }
      for (let k = 0; k < n; k++) {
        const g = G[k], u = Math.hypot(g * ux - w.x, g * uz - w.z);
        if (g < 0.05 || u > cap) continue;
        const c = power(m, u) / g;
        if (c < best) { best = c; bg = g; }
      }
    }
    if (bg) { ox = ux * bg - w.x; oz = uz * bg - w.z; }
  }
  const ol = Math.hypot(ox, oz);
  if (ol > cap * 1.0001) {
    if (wl >= 0.5 * cap) {
      const px = -w.z / wl, pz = w.x / wl, q = dx * px + dz * pz;
      const s = dl > 1e-3 && Math.abs(q) > 0.1 * dl ? Math.sign(q) : m.side;
      ox = px * s * cap; oz = pz * s * cap;
    } else { ox *= cap / ol; oz *= cap / ol; }
  }
  out.x = ox; out.y = dy - w.y; out.z = oz;
  COST.ms += now() - t0;
  return out;
}

// The work (power x s) to get from (x, z) to (cx, cz) through water that is w here and wc there.
function travel(m, x, z, cx, cz, w, wc) {
  const dx = cx - x, dz = cz - z, D = Math.hypot(dx, dz);
  if (D < 0.5) return 0;
  const ux = dx / D, uz = dz / D, wx = (w.x + wc.x) / 2, wz = (w.z + wc.z) / 2, wp = wx * ux + wz * uz;
  let best = Infinity;
  for (let k = 0; k < 4; k++) {
    const g = k === 0 ? 0.6 * m.v : k === 1 ? m.v : k === 2 ? wp + 0.3 * m.v : wp + 0.6 * m.v;
    if (!(g > 0.1)) continue;
    const u = Math.hypot(g * ux - wx, g * uz - wz);
    if (u <= m.Ub) best = Math.min(best, power(m, u) * D / g);
  }
  return best < Infinity ? best : power(m, m.Ub) * D / (0.3 * m.v);
}

// Weigh the spots: stay, the goal, the slackest spot seen, the way it wants to go, three at random within REACH.
const CX = new Float64Array(8), CZ = new Float64Array(8), WV = { x: 0, y: 0, z: 0 };
function choose(m, s) {
  const { x, y, z, w, want } = s;
  let n = 0;
  CX[n] = x; CZ[n++] = z;
  const gk = m.goal ? n : -1;
  if (m.goal) { CX[n] = m.goal.x; CZ[n++] = m.goal.z; }
  if (m.best && Math.hypot(m.best.x - x, m.best.z - z) > 2 * REACH) m.best = null;
  if (m.best) { CX[n] = m.best.x; CZ[n++] = m.best.z; }
  const wn = want ? Math.hypot(want.x, want.z) : 0, wk = wn > 1e-3 ? n : -1;
  if (wk >= 0) { CX[n] = x + want.x / wn * 0.6 * REACH; CZ[n++] = z + want.z / wn * 0.6 * REACH; }
  for (let k = 0; k < 3; k++) { const a = m.rnd() * 2 * Math.PI, r = REACH * Math.sqrt(m.rnd()); CX[n] = x + Math.sin(a) * r; CZ[n++] = z + Math.cos(a) * r; }
  let bi = 0, bs = Infinity, cur = Infinity, bh = Infinity, bhi = -1;
  for (let k = 0; k < n; k++) {
    const cx = CX[k], cz = CZ[k];
    if (k > 0 && !s.ok(cx, y, cz)) continue;
    const wc = k === 0 ? w : s.probe(cx, y, cz, WV), cl = Math.hypot(wc.x, wc.z), hold = power(m, cl);
    const sc = travel(m, x, z, cx, cz, w, wc) + hold * HORIZON * (m.tired ? TIRED_HOLD : 1)
      + (1 - m.flow) * Math.max(0, cl - m.flow * m.Us) + OVER * Math.max(0, cl - m.Us) - (k === wk ? WANT : 0)
      + (cl >= SLACK * m.Us && s.edge?.(cx, y, cz, m.size) ? EDGE : 0);
    if (k === gk) cur = sc;
    if (sc < bs) { bs = sc; bi = k; }
    if (hold < bh) { bh = hold; bhi = k; }
  }
  if (bhi >= 0) { m.best ??= { x: 0, z: 0 }; m.best.x = CX[bhi]; m.best.z = CZ[bhi]; }
  if (gk >= 0 && bi !== gk && bs > cur - HYST * Math.abs(cur) - 0.05) return;
  m.goal ??= { x: 0, z: 0 };
  m.goal.x = CX[bi]; m.goal.z = CZ[bi];
}

// One step of the mind. s = { dt, x, y, z, w (the water here), want ({x, z}, the way its behaviour wants to go, or null), probe, ok,
// edge }. Returns m.I = { dir ({x, z} toward its goal, length min(1, distance / 2 cm), or null), hold (within 1 cm: keep station), escape, cap, burst (speed limits through the
// water: steady, and for a dart or an escape), label }.
export function fishThink(m, s) {
  const t0 = now(), I = m.I, { x, y, z, w } = s, wl = Math.hypot(w.x, w.z);
  if (m.F > TIRED) m.tired = true; else if (m.F < RESTED) m.tired = false;
  const look = Math.max(2, 1.5 * wl);
  I.escape = wl > m.Us || (wl > SLACK * m.Us && !!s.edge?.(x + w.x / wl * look, y, z + w.z / wl * look, m.size));
  if (I.escape && m.escT <= 0) {                     // out across the flow, to the slower side (kept for a second)
    const px = -w.z / wl * 4, pz = w.x / wl * 4;
    const a = s.ok(x + px, y, z + pz) ? Math.hypot(...Object.values(s.probe(x + px, y, z + pz, WV))) : Infinity;
    const b = s.ok(x - px, y, z - pz) ? Math.hypot(...Object.values(s.probe(x - px, y, z - pz, WV))) : Infinity;
    if (a !== b) m.side = a < b ? 1 : -1;
    m.escT = 1;
  }
  m.next -= s.dt;
  if (m.next <= 0) { m.next = Math.max(m.next + THINK, 0.1); choose(m, s); }
  const g = m.goal, dx = g ? g.x - x : 0, dz = g ? g.z - z : 0, dl = Math.hypot(dx, dz), there = !g || dl < 1;
  m.resting = m.tired && there && wl < SLACK * m.Us;
  if (dl < 1e-3) I.dir = null; else { const k = Math.min(1, dl / 2) / dl; m._d.x = dx * k; m._d.z = dz * k; I.dir = m._d; }   // slows on the last 2 cm
  I.hold = there;
  I.cap = m.F > SPENT ? 0.5 * m.Us : m.tired ? 0.8 * m.Us : m.Us;
  I.burst = m.F > SPENT ? 0.8 * m.Us : m.tired ? m.Us : m.Ub;
  I.label = m.resting ? REST_LABEL : null;
  COST.ms += now() - t0;
  return I;
}

// After the move: energy, and the numbers the tank check reads (time, time in slack water, the longest stretch held at the glass or the
// intake in moving water, heading against the flow weighted by the ground covered). t: the frame's clock (counts frames for COST).
export function fishAfter(m, a, w, dt, edge, t) {
  const t0 = now(), v = a.vel, st = m.st;
  fishEnergy(m, Math.hypot(v.x, v.y, v.z), dt);
  m.escT -= dt;
  const wl = Math.hypot(w.x, w.z), gd = Math.hypot(v.x + w.x, v.z + w.z) * dt;
  st.t += dt;
  if (wl < SLACK * m.Us) st.slack += dt;
  if (wl >= SLACK * m.Us && edge?.(a.pos.x, a.pos.y, a.pos.z, m.size)) { st.pin += dt; st.pinMax = Math.max(st.pinMax, st.pin); } else st.pin = 0;
  if (wl > 0.5 && gd > 0) { const r = a.yaw - Math.atan2(w.x, w.z); st.c += Math.cos(r) * gd; st.s += Math.sin(r) * gd; st.d += gd; }
  if (t !== COST.t) { COST.t = t; COST.frames++; }
  COST.ms += now() - t0;
}
