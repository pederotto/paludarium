// Body plans: the anatomy every animal of a kind shares, as data. One skeleton per plan (the joints a real animal of that build
// bends at, with the range each one has), the muscles that bulge as those joints bend, and how the plan turns. The bake tools
// (tools/rig/skeleton.mjs: poses of a scanned animal) and the game (sim/animals.js turning, the rig channels in draw()) both read
// it, so a pose or a gait can never ask a joint for more than the animal has. docs/SKELETON.md has the audit and the plan.
//
//   joints   { bone: { min, max } }: the angle in degrees between a bone and its parent bone (0: straight on, 180: folded back
//            onto it), for the bones of tools/rig/skeleton.mjs. A pose target that asks for more is brought back to the limit.
//   rig      the same limits as the game's per-vertex rig channels see them (render/creatures/instanced.js rig2): head yaw about
//            the neck (rad), the body's C-bend (`bend`: half the lateral flexion from snout to tail tip, rad) and the tail swing
//            (fraction of the body length at the tip). Sums of the per-vertebra ranges (lateral flexion between two trunk
//            vertebrae of a salamander is about 8 degrees, of a frog about 2).
//   muscles  [{ name, bone, joint, from, to, gain }]: a belly on `bone` between `from` and `to` (fractions along it) that swells
//            along the skin's normal by `gain` x the bone's length x the flexion of `joint` (0 straight … 1 at its limit).
//   turn     pivot: what the body turns about on the spot ('hips': the pelvis and planted hind feet, as a frog, salamander or
//            lizard does; 'centre': legs all round the body, a crab or an insect; 'none': a swimmer turns along its path);
//            stepHz: the fastest leg cycle in a turn (cycles a second), which with the leg sweep sets the fastest yaw a walker can
//            make (util/turn.js); sweep (default 1): how far a turning step swings a foot round the pivot, in walking strides
//            (a frog turns in a few long quick steps, not many short ones: fewer leg cycles a half turn, the same planted feet);
//            swimRate (rad/s): the fastest a swimmer swings round; bend/head/tail: how much of the rig's range a turn at full
//            rate uses (the spine bends into the turn, the head leads, the tail follows).

const deg = (d) => (d * Math.PI) / 180;

export const PLANS = {
  // Frogs and toads: a short stiff trunk (eight or nine vertebrae and the urostyle), almost no neck, long hind legs that fold in
  // a Z (hip, knee, ankle, and the elongated tarsus as a fourth segment), short arms.
  anuran: {
    joints: {
      spine: { min: 0, max: 25 }, head: { min: 0, max: 30 },
      thigh: { min: 10, max: 175 }, shin: { min: 0, max: 175 }, foot: { min: 0, max: 175 }, toes: { min: 0, max: 120 },
      arm: { min: 10, max: 160 }, forearm: { min: 0, max: 160 }, hand: { min: 0, max: 150 },
    },
    rig: { head: deg(10), bend: 0.06, tail: 0 },
    muscles: [
      { name: 'thigh (iliofibularis, cruralis)', bone: 'thigh', joint: 'shin', from: 0.15, to: 0.8, gain: 0.1 },
      { name: 'calf (plantaris longus)', bone: 'shin', joint: 'foot', from: 0.1, to: 0.6, gain: 0.08 },
      { name: 'shoulder (deltoid)', bone: 'arm', joint: 'forearm', from: 0, to: 0.5, gain: 0.06 },
      { name: 'throat (interhyoid: the vocal sac)', bone: 'head', joint: null, from: 0.1, to: 0.6, gain: 0 },   // driven by the call, not a joint
    ],
    turn: { pivot: 'hips', stepHz: 5, sweep: 1.4, bend: 0, head: 0, tail: 0 },
  },
  // Salamanders and newts: a long flexible trunk (14 to 16 vertebrae) that walks in a standing wave, a neck that turns, a long
  // tail; sprawling legs with hip and shoulder swinging well forward and back.
  caudate: {
    joints: {
      spine: { min: 0, max: 60 }, head: { min: 0, max: 40 }, tail: { min: 0, max: 100 },
      thigh: { min: 20, max: 160 }, shin: { min: 0, max: 120 }, foot: { min: 0, max: 100 },
      arm: { min: 20, max: 160 }, forearm: { min: 0, max: 130 }, hand: { min: 0, max: 100 },
    },
    rig: { head: deg(35), bend: 0.55, tail: 0.25 },
    muscles: [
      { name: 'thigh (puboischiofemoralis)', bone: 'thigh', joint: 'shin', from: 0.1, to: 0.7, gain: 0.08 },
      { name: 'epaxial (trunk side, inside of a bend)', bone: 'spine', joint: 'spine', from: 0.2, to: 0.8, gain: 0.05 },
      { name: 'throat (buccal pumping)', bone: 'head', joint: null, from: 0.2, to: 0.7, gain: 0 },
    ],
    turn: { pivot: 'hips', stepHz: 1.8, bend: 0.7, head: 0.6, tail: 0.6 },
  },
  // Geckos and skinks: like a salamander but faster, a more mobile neck, a tail that steers.
  lizard: {
    joints: {
      spine: { min: 0, max: 50 }, head: { min: 0, max: 50 }, tail: { min: 0, max: 120 },
      thigh: { min: 20, max: 160 }, shin: { min: 0, max: 130 }, foot: { min: 0, max: 110 },
      arm: { min: 20, max: 160 }, forearm: { min: 0, max: 140 }, hand: { min: 0, max: 110 },
    },
    rig: { head: deg(45), bend: 0.45, tail: 0.3 },
    muscles: [
      { name: 'thigh (caudofemoralis)', bone: 'thigh', joint: 'shin', from: 0.1, to: 0.7, gain: 0.08 },
      { name: 'jaw (adductor)', bone: 'head', joint: null, from: 0.4, to: 0.8, gain: 0 },
    ],
    turn: { pivot: 'hips', stepHz: 4, bend: 0.7, head: 0.6, tail: 0.6 },
  },
  // Fish and tadpoles: the body is the oar. A turn is a C-bend (head and tail swing to the inside), done while moving.
  fish: {
    joints: { spine: { min: 0, max: 90 }, tail: { min: 0, max: 60 } },
    rig: { head: 0, bend: 0.5, tail: 0.2 },
    muscles: [{ name: 'myomeres (the side that shortens in a bend)', bone: 'spine', joint: 'spine', from: 0.2, to: 0.9, gain: 0.04 }],
    turn: { pivot: 'none', swimRate: 5, bend: 0.8, head: 0, tail: 0.5 },
  },
  // Crabs and shrimp: an exoskeleton; legs all round the body, so a crab turns about its middle by stepping.
  decapod: {
    joints: { leg: { min: 0, max: 120 }, claw: { min: 0, max: 90 }, abdomen: { min: 0, max: 150 } },
    rig: { head: 0, bend: 0, tail: 0 },
    muscles: [],
    turn: { pivot: 'centre', stepHz: 4, bend: 0, head: 0, tail: 0 },
  },
  // Isopods, springtails, crickets, roaches, flies: six or more legs round a rigid body.
  arthropod: {
    joints: { leg: { min: 0, max: 120 } },
    rig: { head: 0, bend: 0, tail: 0 },
    muscles: [],
    turn: { pivot: 'centre', stepHz: 6, bend: 0, head: 0, tail: 0 },
  },
  // Snails, worms and larvae: no legs; a snail glides on its foot and turns slowly about its middle.
  soft: {
    joints: {},
    rig: { head: 0, bend: 0, tail: 0 },
    muscles: [],
    turn: { pivot: 'centre', swimRate: 0.8, bend: 0, head: 0, tail: 0 },
  },
};

// How a frog or toad swims (util/gait.js, docs/SKELETON.md "Swimming blueprint"): the anuran default and each species' own numbers
// over it. A new frog body plugs in with a row here (and its skeleton from the bake).
//   kickHz   kicks a second, [pottering, urgent] (small frogs fleeing kick 2 to 3 times a second)
//   reach    body lengths it moves a kick on average (a weak swimmer half a body length, a strong one most of one)
//   burst    kicks in a burst, [min, max]; rest: seconds it rests between bursts, legs drawn up (less when urgent); drag: how fast
//            a glide dies away (1/s)
//   sink     the line of its belly under the surface, in species size units (eyes and snout stay above); level: the pitch that lays
//            the sitting model level (its skeleton's trunk pitch, pelvis to head, as baked: measured from the manifest); headUp: the nose lifted at the surface (rad)
//   float    rests at the surface with its limbs spread between swims (the fire-bellied toad); hang: how far its body hangs down
//            from its nostrils as it rests there (rad)
//   arms     how far the forelegs are held out, [as it draws its legs up, through the kick and glide] (0 laid back along the flanks
//            … 1 out to the sides): a poison frog, a poor swimmer, keeps them well out to balance; a strong swimmer lays them back
export const SWIM = {
  anuran: { kickHz: [1.0, 2.2], reach: 0.55, burst: [2, 4], rest: [0.3, 0.9], drag: 3, sink: 0.65, level: 0.24, headUp: 0.1, float: false, hang: 0.3, arms: [1, 0.15] },
  // poison frogs: weak swimmers, head up, short bursts straight for the nearest grip
  dartfrog: { kickHz: [1.1, 2.5], reach: 0.5, headUp: 0.12, level: 0.253 },
  leucomelas: { kickHz: [1.1, 2.5], reach: 0.5, headUp: 0.12, level: 0.243 },
  auratus: { kickHz: [1.1, 2.5], reach: 0.5, headUp: 0.12, level: 0.23 },
  strawberry: { kickHz: [1.2, 2.8], reach: 0.5, headUp: 0.12, level: 0.249 },
  // the bumblebee toad swims worst of all (it drowns in deep water): short, laboured bursts
  bumblebee: { kickHz: [1.0, 2.2], reach: 0.42, burst: [1, 3], rest: [0.4, 1.1], headUp: 0.14, level: 0.23 },
  // tree and reed frogs: long legs, better strokes, still out of the water as soon as they can
  reedfrog: { kickHz: [1.0, 2.4], reach: 0.6, level: 0.208, arms: [0.8, 0.08] },
  redeye: { kickHz: [0.9, 2.0], reach: 0.6, arms: [0.8, 0.08] },
  // Bombina: at home in the water, long glides, rests floating spread-eagled at the surface
  toad: { kickHz: [0.8, 2.0], reach: 0.65, burst: [1, 3], rest: [0.6, 2], drag: 1.8, sink: 0.45, headUp: 0.04, float: true, level: 0.179, arms: [0.6, 0.05] },
};
export const swimProfile = (id) => ({ ...SWIM.anuran, ...(SWIM[id] ?? {}) });

// The plan of a species (an entry of sim/animals.js SPECIES).
export function planOf(sp) {
  switch (sp.kind) {
    case 'frog': case 'toad': return 'anuran';
    case 'newt': case 'axolotl': return 'caudate';
    case 'gecko': case 'skink': return 'lizard';
    case 'swim': return 'fish';
    case 'crab': return 'decapod';
    case 'crawlWater': return sp.shrimp ? 'decapod' : 'soft';
    case 'crawlLand': case 'fly': return sp.anim?.stride ? 'arthropod' : 'soft';
    default: return 'soft';
  }
}

// A bone's limit in a plan, by the bone's name in tools/rig/skeleton.mjs (side suffix L / R ignored), or null.
export function jointLimit(plan, bone) {
  const P = typeof plan === 'string' ? PLANS[plan] : plan;
  return P?.joints?.[bone.replace(/[LR]$/, '')] ?? null;
}

// The angle (degrees) a joint target makes with the parent bone: 0 straight on, 180 folded back.
export function bendAngle(parentDir, childDir) {
  const lp = Math.hypot(...parentDir) || 1, lc = Math.hypot(...childDir) || 1;
  const c = (parentDir[0] * childDir[0] + parentDir[1] * childDir[1] + parentDir[2] * childDir[2]) / (lp * lc);
  return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
}

// A child direction brought inside the limit: turned toward (or away from) the parent's direction, in the plane of the two, so
// the angle between them is within [min, max]. Returns the direction unchanged when it already is.
export function limitDir(parentDir, childDir, lim) {
  if (!lim) return childDir;
  const a = bendAngle(parentDir, childDir);
  const want = Math.max(lim.min, Math.min(lim.max, a));
  if (Math.abs(want - a) < 1e-6) return childDir;
  const lp = Math.hypot(...parentDir) || 1, lc = Math.hypot(...childDir) || 1;
  const p = parentDir.map((v) => v / lp), c = childDir.map((v) => v / lc);
  // an axis perpendicular to the parent, in the plane of the two (any perpendicular when they are parallel)
  let q = c.map((v, i) => v - p[i] * (p[0] * c[0] + p[1] * c[1] + p[2] * c[2]));
  let lq = Math.hypot(...q);
  if (lq < 1e-9) { q = Math.abs(p[1]) < 0.9 ? [p[2], 0, -p[0]] : [0, -p[2], p[1]]; lq = Math.hypot(...q); }
  q = q.map((v) => v / lq);
  const r = (want * Math.PI) / 180;
  return p.map((v, i) => (v * Math.cos(r) + q[i] * Math.sin(r)) * lc);
}

// The rig channels kept inside the plan's range: head yaw (rad), bend and tail (rig2 units, see `rig` above).
export function limitRig(plan, head, bend, tail) {
  const R = (typeof plan === 'string' ? PLANS[plan] : plan)?.rig ?? { head: 0, bend: 0, tail: 0 };
  const c = (v, m) => (v > m ? m : v < -m ? -m : v);
  return [c(head, R.head), c(bend, R.bend), c(tail, R.tail)];
}

// How far a muscle swells (in units of its bone's length) for a joint bent `angle` degrees within `lim`: zero when the joint is
// straight, `gain` at its limit, along a smooth belly between `from` and `to` (t is the position along the bone, 0 … 1).
export function muscleBulge(m, angle, lim, t) {
  if (!m.gain || t <= m.from || t >= m.to) return 0;
  const flex = lim ? Math.max(0, Math.min(1, (angle - lim.min) / Math.max(1e-6, lim.max - lim.min))) : 0;
  const u = (t - m.from) / (m.to - m.from);
  return m.gain * flex * Math.sin(Math.PI * u) ** 2;
}
