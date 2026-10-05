// The lizard's muscles (G2), made the way the frog's are: the plan's bellies (util/bodyplan.js PLANS.lizard.muscles, one list for
// every lizard; each species' gains and channel numbers in PLANS.lizard.species) swell their bone radially as the joint they cross
// bends, applied by the frog's own writeBones (render/creatures/skeleton.js) as the bones are written. Pure functions, no state:
//   lizardMuscles  the records writeBones takes ({ b, j, lim, flex0, k }), one a side, from a baked lizard skeleton
//   swellOf        the swell writeBones gives a record at a bend angle (the same formula and clamp), for the pose and the tests
//   tailBaseSwing  the tail base's yaw from the hind femurs' retraction (the caudofemoralis ties them), with its lag
//   toePeel        the toe and finger fans' peel (0 attached flat … 1 peeled), an angle about the fan's knuckle
//   throatFlutter  the throat channel's breathing pulse at rest; headSwell the head's swell for the jaw and throat channels
import { PLANS, bendAngle } from './bodyplan.js';

export const SWELL_CAP = 0.2, SWELL_MIN = -0.08;   // the frog's clamp on a swell (skeleton.js writeBones)
const RAD = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const FULL = { min: 0, max: 180 };                 // the records' angle scale (degrees from straight): no dead zone at a range's end

export const LIZARD_GROUPS = PLANS.lizard.muscles.map((m) => m.id);

// A species' numbers: its own table, else the gecko's (the only lizard measured so far; the skink builder adds `skink`).
export function lizardSpecies(sp) {
  const S = PLANS.lizard.species;
  return S[sp] ?? S.gecko;
}

// The axis a fan bone (toes, fingers) turns about to peel: its tip goes up, then back over the foot toward the heel.
export function peelAxis(d) {
  const n = [-d[2], 0, d[0]], l = Math.hypot(n[0], n[2]) || 1;   // d × up
  return [n[0] / l, 0, n[2] / l];
}
const rot = (n, t, v) => {                          // v turned by t about unit n (Rodrigues)
  const c = Math.cos(t), s = Math.sin(t), k = (n[0] * v[0] + n[1] * v[1] + n[2] * v[2]) * (1 - c);
  return [0, 1, 2].map((i) => v[i] * c + (n[(i + 1) % 3] * v[(i + 2) % 3] - n[(i + 2) % 3] * v[(i + 1) % 3]) * s + n[i] * k);
};

// +1 when the joint's bend angle (bodyplan bendAngle, 0 straight) grows as the muscle acts, -1 when it shrinks: 'fold' grows it by
// definition; 'retract' (the bone's tip swung back about the body's up), 'protract' (forward) and 'peel' are measured on the rest pose.
function senseOf(acts, pd, d) {
  if (acts === 'fold') return 1;
  let v;
  if (acts === 'peel') v = rot(peelAxis(d), 0.02, d);
  else { const e = 0.02 * (Math.sign(d[0]) || 1); v = rot([0, 1, 0], e, d); }
  const s = Math.sign(bendAngle(pd, v) - bendAngle(pd, d));
  return acts === 'protract' ? -s : s;
}

// The muscle records of a lizard skeleton (bones, name -> index, parents, rest directions and lengths). A belly on `bone` driven by
// `joint` gets a record a side (a bone without a side, the tail base, takes one from each leg); its swell is `gain` (bone lengths
// over the bone's radius, the belly's mean profile) at a bend of the joint's whole range in the muscle's direction, zero at rest.
export function lizardMuscles(B, byName, parent, dir, L, sp = 'gecko', plan = PLANS.lizard) {
  const gains = lizardSpecies(sp).gains, out = [];
  for (const m of plan.muscles) {
    const g = gains[m.id], lim = m.joint && plan.joints[m.joint];
    if (!g || !lim) continue;
    const span = lim.max - lim.min;
    for (const s of ['L', 'R', '']) {
      const j = byName[m.joint + s], b = byName[m.bone + s] ?? (s ? byName[m.bone] : undefined);
      if (b == null || j == null || parent[j] < 0) continue;
      const pd = dir[parent[j]], sense = senseOf(m.acts, pd, dir[j]);
      if (!sense) continue;
      const k = ((sense * g * L[b] * (m.to - m.from) * 0.5) / Math.max(0.02, B[b].r ?? 0.1)) * (180 / span);
      out.push({ id: m.id, b, j, side: s, lim: FULL, flex0: bendAngle(pd, dir[j]) / 180, k, sense, span });
    }
  }
  return out;
}

// The swell writeBones gives record `m` with its joint bent `angle` degrees (skeleton.js writeBones, the same clamp).
export function swellOf(m, angle) {
  const flex = clamp((angle - m.lim.min) / (m.lim.max - m.lim.min), 0, 1);
  return clamp((flex - m.flex0) * m.k, SWELL_MIN, SWELL_CAP) + 0;
}

// The tail base's yaw (rad, about the body's up; + turns the backward-pointing tail toward -x, the left) from the hind femurs'
// retraction (rad, + = swung back, left and right): it swings toward the side whose leg is pulling back, by `gain` x the difference,
// inside the tail joint's range, and follows with a first-order lag (`lag` s). `prev`: last frame's value; dt in s.
export function tailBaseSwing(prev, retL, retR, dt, c = lizardSpecies('gecko').tailBase) {
  const m = PLANS.lizard.rom.tail.yaw[1] * RAD, target = clamp(c.gain * (retL - retR), -m, m);
  const a = c.lag > 0 ? 1 - Math.exp(-Math.max(0, dt) / c.lag) : 1;
  return prev + (target - prev) * a;
}

// The peel of a fan ('toes' or 'fingers'), rad about peelAxis: channel 0 attached flat (the rest pose) … 1 peeled to the plan's limit
// (PLANS.lizard.rom[fan].hinge[0], the digits curled up off the surface), held inside 0 … 1.
export function toePeel(v, fan = 'toes', plan = PLANS.lizard) {
  return clamp(v, 0, 1) * -plan.rom[fan].hinge[0] * RAD;
}

// The throat channel at time t (s) for an animal `rest` (0 moving … 1 still) at rest: the breathing flutter of the gular pump,
// base + amp x a raised cosine at hz; 0 … 1.
export function throatFlutter(t, rest, c = lizardSpecies('gecko').throat) {
  return clamp(rest, 0, 1) * clamp(c.base + c.amp * (0.5 - 0.5 * Math.cos(2 * Math.PI * c.hz * t)), 0, 1);
}

// The head's swell for the jaw channel (0 … 1: the adductors clenched, a bite; widens the head) and the throat channel (0 … 1: the
// throat lowered; deepens it), as fractions of the head's radius: the species' `jaw` and `throat` gains at 1.
export function headSwell(jaw, throat, sp = 'gecko') {
  const g = lizardSpecies(sp).gains;
  return { jaw: clamp(jaw, 0, 1) * g.jaw + 0, throat: clamp(throat, 0, 1) * g.throat + 0 };
}
