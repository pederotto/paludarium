// Animals: species definitions (look, habitat, needs, diet) and the agents
// that live, move, eat, breed and die in the tank. Every species is one
// instanced, procedurally animated mesh (see creatures.js).

import * as THREE from 'three/webgpu';
import { Builder, PRIM } from '../render/geo.js';
import { hash3, clamp, lerp, rng, closestOnSegments } from '../util/math.js';
import { bodyFootprint } from '../util/body.js';
import { surfaceFrame, pitchFrame, glassPush, feetPlane, steadyNormal, easeAngle } from '../util/contain.js';
import { CreatureLOD, BODIES, FINISH, withRig, ContactShadows, CastShells } from '../render/creatures.js';
import { loadManifest, loadCreatureGLB } from '../render/creatures/glb.js';
import { packAnim } from '../render/creatures/instanced.js';
import { frogSwimPose, salamanderSwimPose, kickPeriod, kickSpeed, kickHeave, frac, strideRate, hopLegs, callSac, toeTap, LIFT_MAX } from '../util/gait.js';
import { limbFrame, turnFrame, turnStep, pivotShift, turnSteps, turnPose, steerLimit } from '../util/turn.js';
import { PLANS, planOf, limitRig, swimProfile } from '../util/bodyplan.js';
import { swimState, swimStep, swimPose, leapPose } from '../util/gait.js';
import { swimMotion, spinHz, queuePush, pushPending } from '../util/swimturn.js';
import { hopPlan, hopAt, hopPitch, hopFrame, svlOf } from '../util/hop.js';
import { buccalState, buccalStep, pumpThroat, pumpBreath, swallowDrive, eyeStep } from '../content/anuranheadmuscles.js';
import { Tongues } from '../render/creatures/tongue.js';
import { TANK, MAT } from './tank.js';
import { driveStep, crossTrack } from './labdrive.js';
import { Occupancy } from './occupancy.js';
import { CRAB, PANTHER, crabMind, crabThink, crabHeading, crabGaitRate } from './crab.js';
import { hideScore } from './habitat.js';
import { herpSpot, depthCap, depthOk, deepWithin } from './placement.js';
import { HABITAT } from '../content/habitats.js';
import { restStep, isNight, REST_LABEL, LARVA_REST } from './swimrest.js';
import { SKINK, skinkMind, skinkThink, skinkRefugeOk } from './skink.js';
import { freeWalledIn } from './walledin.js';
import { SHRIMP, shrimpMind, shrimpThink, shrimpDoing } from './shrimp.js';
import { herpMindFor, herpThink, profileFor, doing } from './herp.js';
import { BURROW, burrowSpot, pitDepth, digRate, excavate } from './burrow.js';
import { PIECES } from './decor.js';
import { PLANTS } from './plants.js';
import { hasGenetics, randomGenotype, genotypeForMorph, morphOf, lociOf, morphList } from './genetics.js';
import { shrimpPalette } from '../content/morphs.js';
import { ITEMS, isItem, dietOf, eatsItem } from '../content/foods.js';
import { filterDrift, filterAvoid } from './filterflow.js';
import { fishMind, fishThink, fishOwn, fishCarry, fishAfter, REST_LABEL as FISH_REST } from './fishmind.js';
import { flowSenses } from './currentat.js';

const C = (h) => new THREE.Color(h);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const TAU = Math.PI * 2;
const _fu = V(0, 1, 0), _f = V(0, 0, 0), _m = V(0, 0, 0), _t = V(0, 0, 0), _d = V(0, 0, 0), _p = V(0, 0, 0), _e = new THREE.Euler(), _qo = new THREE.Quaternion(), _qh = new THREE.Quaternion();
const _box = new THREE.Box3(), _ray = new THREE.Raycaster(), DOWN = V(0, -1, 0), _gb = V(0, 0, 0);
const _fr = new Array(9), _gp = [0, 0, 0], _bb = { X: 0, z0: 0, z1: 0, H: 0 }, _sd = [0, 0, 0];     // (whole-body containment: inGlass, bodyBox, stemDepth)
// Perches besides plants (reed frogs): hardscape a frog can sit on top of, and the glass (inward normals).
const PERCH_PIECES = new Set(['wood', 'roots', 'stump', 'cork', 'bamboopole', 'floatlog']);
// Plants a perching frog uses: broad leaves to sit on, or reed stems to cling to (grass and creeping plants hold no frog).
const PERCH_PLANTS = { bromeliad: 'leaf', guzmania: 'leaf', neoregelia: 'leaf', monstera: 'leaf', fern: 'leaf', fernph: 'leaf', cattail: 'stem', bamboo: 'stem' };   // (frogs sit in a bromeliad's cup leaves)
const _pm = new THREE.Mesh(undefined, new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide }));   // a plant instance, for rays
_pm.matrixAutoUpdate = false;
// The heading that puts a frog's head up when its belly is to a vertical surface with outward normal N (Animals.draw turns
// UP onto the normal, then the heading about it).
function clingYaw(N) {
  const v = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), N).invert());
  return Math.atan2(v.x, v.z);
}
const GLASS_N = { front: V(0, 0, -1), left: V(1, 0, 0), right: V(-1, 0, 0) };
// How far the pane is from the belly plane a frog clinging to it is drawn from (the pads' thickness; Animals.inGlass keeps 0.1 clear). It was 0.7 (0.4 where
// the second look clamps), and the straight line from the foot of the climb to the top kept it further out while it went up: frogs floating off the glass
// (owner, 6 Oct 2026; tools/steps/glass-cling.mjs).
const GLASS_GAP = 0.12;
// Where the belly plane of a frog on a piece (wood, roots, a stump, cork, a pole) is from its surface: pads on it, not the 0.35 it sat at.
const PIECE_GAP = 0.12;
// Frogs without toe pads (the bumblebee toad, the fire-bellied toad): out of the water they climb rough faces only up to about 70
// degrees, and not the glass (Animals.exitClimb, exitGlass).
const PADLESS = new Set(['bumblebee', 'toad']);
const EXIT_LOOK = 160;      // how far across the water a frog in it looks for a way out (cm: past the far side of any tank)
const _gf = new Array(9);
// Body radius per kind (x species size): animals of one medium keep their distance (see separate()).
const RADIUS = { skink: 0.6, swim: 0.38, crawlWater: 0.4, crawlLand: 0.3, crab: 0.6, fly: 0.2, frog: 0.85, toad: 0.8, newt: 0.7, axolotl: 0.75, gecko: 0.7 };
const STRENGTH = { skink: 1, swim: 1, frog: 1, toad: 1, newt: 1, axolotl: 1, gecko: 1, crab: 1, crawlWater: 0.85, crawlLand: 0.85, fly: 0.3 };
const GROUPS = { water: 1, land: 1, wall: 3, air: 4 };     // land and water share a grid: a newt on the pool's bottom meets the shrimp there
const TINY = 0.1;                                            // bodies narrower than this (cm: springtails, fruit flies) are not separated
const CELLG = 5;
const VIS = new Set(['frog', 'toad', 'newt', 'axolotl', 'gecko', 'skink']);   // animals with idle pulses, twitches and strikes (see vis)
const CORE_WALKERS = new Set(['frog', 'toad', 'newt', 'axolotl', 'gecko', 'skink', 'crab']);   // kept out of plant stems (see plantCores)
// The radius of a plant's stems that walkers are kept out of (Animals.plantCores), or 0 for a plant they walk through.
function coreR(q) {
  if (q.surface === 'wall' || NO_CORE.has(q.id)) return 0;
  const hab = PLANTS[q.id]?.habitat ?? '';
  if (hab === 'floating' || hab === 'aquatic') return 0;
  return clamp((q.reach ?? 3) * (0.3 + 0.7 * q.grown) * 0.18, 0.5, 2.5);
}
const NO_CORE = new Set(['javamoss', 'pothos']);                                            // carpets and creepers: walked over
const LIVE = new Set(['frog', 'toad', 'newt', 'axolotl', 'gecko', 'skink']);   // hunters that really stalk and strike
const TAILED = new Set(['newt', 'axolotl', 'gecko', 'skink']);                  // a long tail behind the hind feet (footing stands them on their feet)
// Where a four-legged body's feet are along it (cm, the mesh's rest pose): the lowest point of each leg of the rig, the mean of the
// fore pair and of the hind pair. Null for other bodies (a crab's legs and claws, a fish).
function feetOf(P, R) {
  if (!R) return null;
  const low = new Map();
  for (let i = 0, n = P.length / 3; i < n; i++) {
    const k = R[i * 4 + 1];
    if (k <= 0.5) continue;
    const j = low.get(k);
    if (j == null || P[i * 3 + 1] < P[j * 3 + 1]) low.set(k, i);
  }
  if (low.size !== 4) return null;
  const z = [...low.values()].map((i) => P[i * 3 + 2]).sort((p, q) => q - p);
  return { fore: (z[0] + z[1]) / 2, hind: (z[2] + z[3]) / 2 };
}

// ---------------------------------------------------------------------------
// Looks. All built facing +z, feet/belly at y = 0 for walkers, centred for
// swimmers and fliers. Sizes are in centimetres.

function fishBody({ len, h, w, color }) {
  const b = new Builder();
  b.add(PRIM.sphere, { s: [w / 2, h / 2, len / 2], color });
  // Dorsal and pectoral fins.
  b.add(PRIM.tri, { p: [0, h * 0.38, -len * 0.05], r: [-Math.PI / 2 - 0.5, 0, 0], s: [1, h * 0.35, len * 0.22], color: (l, v) => color(new THREE.Vector3(0, 0.8, -0.2), v) });
  b.add(PRIM.tri, { p: [w * 0.4, -h * 0.15, len * 0.18], r: [0, 0.9, 0], s: [1, h * 0.2, len * 0.14], color: 0xd6dde2 });
  b.add(PRIM.tri, { p: [-w * 0.4, -h * 0.15, len * 0.18], r: [0, -0.9, 0], s: [1, h * 0.2, len * 0.14], color: 0xd6dde2 });
  // Eyes.
  for (const s of [-1, 1]) b.add(PRIM.sphereLo, { p: [s * w * 0.36, h * 0.12, len * 0.33], s: len * 0.05, color: 0x111111 });
  return b.build();
}

function fishTail({ len, h, color, spread = 1 }) {
  const b = new Builder();
  b.add(PRIM.tri, { s: [1, h * 0.55 * spread, len * 0.32 * spread], color });
  return b.build();
}

const neonColor = (l) => {
  if (l.y > 0.05 && l.y < 0.38) return C(0x2fc2ff);
  if (l.y < 0.05 && l.y > -0.55 && l.z < 0.35) return C(0xe3332f);
  if (l.y >= 0.38) return C(0x6b6a4e);
  return C(0xd8dfe3);
};

function shrimpGeo() {
  const b = new Builder();
  const col = (l, v) => C(0xd8323a).lerp(C(0xff8a7a), hash3(v.x, v.y, v.z) * 0.4);
  const segs = [[0, 0.45, 0.55, 0.42], [0, 0.5, 0.18, 0.4], [0, 0.48, -0.18, 0.36], [0, 0.42, -0.5, 0.3], [0, 0.34, -0.78, 0.24], [0, 0.28, -1.0, 0.18]];
  for (const [x, y, z, r] of segs) b.add(PRIM.sphere, { p: [x, y, z], s: [r * 0.85, r, r * 1.2], color: col });
  b.add(PRIM.tri, { p: [0, 0.26, -1.1], r: [Math.PI / 2, 0, 0], s: [1, 0.35, 0.3], color: 0xe25a55 });
  // Legs and antennae.
  for (let i = 0; i < 5; i++) for (const s of [-1, 1]) b.add(PRIM.cyl, { p: [s * 0.25, 0.15, 0.5 - i * 0.22], r: [0, 0, s * 0.5], s: [0.03, 0.4, 0.03], color: 0xe58076 });
  for (const s of [-1, 1]) b.add(PRIM.cyl, { p: [s * 0.2, 0.7, 1.3], r: [0.9, s * 0.3, 0], s: [0.02, 1.6, 0.02], color: 0xe58076 });
  for (const s of [-1, 1]) b.add(PRIM.sphereLo, { p: [s * 0.18, 0.62, 0.9], s: 0.07, color: 0x111111 });
  return b.build();
}

function crabGeo() {
  const b = new Builder();
  b.add(PRIM.sphere, { p: [0, 0.55, 0], s: [1.3, 0.45, 1.0], color: (l) => (l.y > 0.3 ? C(0x5a2c6e) : C(0x3b2146)) });
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) {
    const z = 0.45 - i * 0.35;
    b.add(PRIM.cyl, { p: [s * 1.45, 0.55, z], r: [0, 0, s * 1.2], s: [0.08, 0.9, 0.08], color: 0x6a3a7e });
    b.add(PRIM.cyl, { p: [s * 2.0, 0.25, z], r: [0, 0, s * -0.45], s: [0.07, 0.7, 0.07], color: 0x6a3a7e });
  }
  for (const s of [-1, 1]) {
    b.add(PRIM.sphere, { p: [s * 0.95, 0.55, 1.15], s: [0.35, 0.28, 0.5], color: 0xe9a12c });
    b.add(PRIM.sphereLo, { p: [s * 0.35, 0.95, 0.8], s: 0.12, color: 0xf2d33b });
  }
  return b.build();
}

function isopodGeo() {
  const b = new Builder();
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    b.add(PRIM.sphere, { p: [0, 0.22, 0.5 - t * 1.0], s: [0.42 - Math.abs(t - 0.4) * 0.3, 0.22, 0.14], color: i % 2 ? 0x6c6c68 : 0x7f7e78, jitter: 0.2 });
  }
  for (const s of [-1, 1]) b.add(PRIM.cyl, { p: [s * 0.18, 0.25, 0.7], r: [1.1, s * 0.5, 0], s: [0.02, 0.4, 0.02], color: 0x55544f });
  return b.build();
}

function springtailGeo() {
  const b = new Builder();
  b.add(PRIM.sphere, { p: [0, 0.12, 0], s: [0.1, 0.1, 0.22], color: 0xf1ede2 });
  b.add(PRIM.sphereLo, { p: [0, 0.14, 0.2], s: 0.08, color: 0xe7e1d0 });
  return b.build();
}

function flyGeo() {
  const b = new Builder();
  b.add(PRIM.sphere, { s: [0.09, 0.09, 0.2], color: 0x8a6a3a });
  b.add(PRIM.sphereLo, { p: [0, 0.02, 0.17], s: 0.08, color: 0xb42f22 });
  for (const s of [-1, 1]) b.add(PRIM.sphereLo, { p: [s * 0.14, 0.08, -0.02], r: [0, s * 0.3, 0], s: [0.14, 0.02, 0.2], color: 0xd9e2e8 });
  return b.build();
}

function frogGeo({ back, belly, spots = null, eye = 0x111111, size = 1 }) {
  const b = new Builder();
  const skin = (l, v) => {
    if (l.y < -0.2) return C(belly);
    if (spots && hash3(Math.floor(v.x * 3), Math.floor(v.y * 3), Math.floor(v.z * 3)) > 0.78) return C(spots);
    return C(back);
  };
  b.add(PRIM.sphere, { p: [0, 0.75, -0.1], s: [0.75, 0.55, 1.0], r: [-0.25, 0, 0], color: skin });
  b.add(PRIM.sphere, { p: [0, 0.95, 0.75], s: [0.62, 0.42, 0.55], color: skin });
  for (const s of [-1, 1]) {
    b.add(PRIM.sphereLo, { p: [s * 0.38, 1.28, 0.85], s: 0.2, color: eye });
    // Back legs (folded) and front legs.
    b.add(PRIM.sphere, { p: [s * 0.72, 0.35, -0.6], s: [0.25, 0.3, 0.65], r: [0.3, s * 0.4, 0], color: skin });
    b.add(PRIM.sphere, { p: [s * 0.95, 0.08, -0.1], s: [0.18, 0.08, 0.45], r: [0, s * -0.5, 0], color: C(back).multiplyScalar(0.8) });
    b.add(PRIM.cyl, { p: [s * 0.55, 0.3, 0.7], r: [0.2, 0, s * 0.3], s: [0.1, 0.6, 0.1], color: skin });
  }
  return b.build();
}

// ---------------------------------------------------------------------------
// Species. `kind` picks the behaviour. Ranges: temp in °C, humidity in %RH.
// hungerHours: time from fed to starving. breed: births per adult per day.

// `scale`: geometry is already in centimetres, so instances use this (1) and
// `size` only tunes behaviour (reach, hop length). `anim`: undulation
// amplitude (cm), wave count along the body, leg lift and stride (cm).
// `eggs`: how the species reproduces (clutch size, days to hatch, what hatches).
// Keeper's-sheet needs (all optional; sim.js turns them into stress, the Field guide and the Add menu show them):
//   ph [lo, hi] and gh [lo, hi] (°dH) of the water it lives in or soaks in; flow: the most current it bears (0 still … 1 any,
//   see WaterBodies flow); bask: °C it wants at its warm spot; uvb: the UV index it needs (0: none); land: the share of the
//   tank that should be land (0 … 1, a hint only); flock: [fewest, most] of its kind that keep it well (lonely below, crowded
//   above); territorial: males fight (two adult males in one tank stress each other); crew: how much it cleans as a
//   bioactive crew member (1 = a dwarf isopod; mould and litter); drowns: it cannot swim and drowns in water deeper than its
//   habitat maxDepth (content/habitats.js) with no way out; minL / minH: the smallest tank (litres) and height (cm) it is kept
//   in (Sim.tankRules: a cramped animal is mildly stressed, and the Field guide shows it against this tank).
// Small animals' moves (Animals.takeOff / startle): hop jumps (springtails, crickets; a fruit fly hops on its wings), swims (a
// shrimp leaves the bottom for short bouts), flicks (it shoots away backwards from danger), rolls (a panda king rolls into a ball).
const sdfBody = (k) => () => BODIES[k]();

export const SPECIES = {
  neon: {
    name: 'Neon tetra', scale: 1, group: 'Fish', kind: 'swim', band: 'mid', school: true, size: 3.2, speed: 5,
    temp: [21, 27], hungerHours: 120, lifeDays: 1500, eats: ['flake'], cap: 60, breed: 0,
    body: sdfBody('neon'), anim: { amp: 0.22, wave: 1.6 },
    note: 'Schooling fish. Keep 6 or more.',
  },
  guppy: {
    name: 'Guppy', scale: 1, group: 'Fish', kind: 'swim', band: 'top', school: false, size: 3.0, speed: 4.5,
    temp: [22, 28], hungerHours: 120, lifeDays: 700, eats: ['flake'], cap: 40, breed: 0.05, adultDays: 8,
    body: sdfBody('guppy'), anim: { amp: 0.25, wave: 1.6 },
    note: 'Livebearer: breeds on its own when well fed.',
  },
  cory: {
    name: 'Corydoras', scale: 1, group: 'Fish', kind: 'swim', band: 'bottom', school: true, size: 4.0, speed: 3,
    temp: [21, 26], hungerHours: 140, lifeDays: 1800, eats: ['flake', 'detritus'], cap: 20, breed: 0,
    body: sdfBody('cory'), anim: { amp: 0.25, wave: 1.4 },
    note: 'Bottom cleaner. Eats leftovers on the sand.',
  },
  loach: {
    name: 'Clown loach', scale: 1, group: 'Fish', kind: 'swim', band: 'bottom', school: true, size: 5.0, speed: 3.2,
    temp: [24, 30], hungerHours: 150, lifeDays: 5000, eats: ['flake', 'detritus'], cap: 8, breed: 0,
    body: sdfBody('cory'), anim: { amp: 0.25, wave: 1.4 },
    note: 'A lively bottom fish that loves company. Needs warm, clean water and hiding places.',
  },
  shrimp: {
    name: 'Cherry shrimp', group: 'Crustaceans', kind: 'crawlWater', shrimp: true, swims: true, flicks: true, size: 1.0, speed: 1.2,
    temp: [18, 28], hungerHours: 200, lifeDays: 365, eats: ['detritus', 'biofilm', 'flake'], cap: 80, breed: 0.04, adultDays: 20,
    ph: [6.8, 8.0], gh: [6, 12], flow: 0.6, flock: [10, 80],
    anim: { lift: 0.06, stride: 0.1 },
    body: () => BODIES.shrimp?.() ?? withRig(shrimpGeo()), note: 'Grazes biofilm and detritus. Breeds in mature tanks.',
  },
  crab: {
    name: 'Vampire crab', group: 'Crustaceans', kind: 'crab', size: 1.0, speed: 2,
    temp: [24, 28], humidity: 80, hungerHours: 200, lifeDays: 900, eats: ['detritus', 'flake', 'springtail', 'fly'], cap: 10, breed: 0,
    // Sideways walker (legAxis 'x', render/creatures/instanced.js); stride = a quarter of the leg cycle (util/gait.js crabStride) so feet do not slip.
    anim: { lift: 0.3, stride: 0.47, legAxis: 'x', limb: 1 },
    body: () => BODIES.crab?.() ?? withRig(crabGeo()),
    note: 'Lives on land and wets its gills in shallow water; out at dusk, in its burrow by day. Wants 24–28 °C and 80–90% humidity, a pool no deeper than a few cm with a ramp out, soil, moss and cork to hide in. One male to two or three females.',
  },
  isopod: {
    name: 'Dwarf white isopods', group: 'Crustaceans', kind: 'crawlLand', size: 1.0, speed: 0.8,
    temp: [18, 28], humidity: 60, hungerHours: 150, lifeDays: 300, eats: ['detritus'], cap: 90, breed: 0.1, adultDays: 12, crew: 1,
    anim: { lift: 0.03, stride: 0.05 },
    body: () => BODIES.isopod?.() ?? withRig(isopodGeo()), note: 'Clean-up crew. Eat detritus on land.',
  },
  springtail: {
    name: 'Springtails', group: 'Insects', kind: 'crawlLand', hop: true, size: 1.4, speed: 0.9,
    temp: [16, 28], humidity: 70, hungerHours: 100, lifeDays: 40, eats: ['detritus'], cap: 160, breed: 0.3, adultDays: 5, crew: 0.25,
    body: () => BODIES.springtail?.() ?? withRig(springtailGeo()), note: 'Tiny cleaners and frog food. Like damp moss.',
  },
  fly: {
    name: 'Fruit flies', group: 'Insects', kind: 'fly', hop: true, size: 1.4, speed: 6,
    temp: [18, 30], humidity: 30, hungerHours: 30, lifeDays: 14, eats: ['detritus'], cap: 70, breed: 0, adultDays: 2,   // eggs: sim/flylife.js
    body: () => BODIES.fly?.() ?? withRig(flyGeo()), note: 'Flightless culture: live frog food. Lays eggs on rotting fruit and litter.',
  },
  // The fruit fly's young (sim/flylife.js): egg -> maggot -> pupa -> adult. They are made by the life cycle, never bought.
  flylarva: {
    name: 'Fruit fly maggots', group: 'Insects', kind: 'crawlLand', litterLover: true, crawlOpt: { restP: 0.3, rest: [1, 4], speed: 1 }, size: 1.4, r: 0.35, speed: 0.16,
    temp: [14, 34], hungerHours: 30, lifeDays: 16, eats: [], cap: 150, breed: 0, adultDays: 4.5,
    body: sdfBody('flylarva'), anim: { amp: 1.4, wave: 2.4, lift: 0, stride: 0 }, note: 'Fruit fly larvae: live in rotting litter and fruit and eat it, which speeds up composting.',
  },
  flypupa: {
    name: 'Fruit fly pupae', group: 'Insects', kind: 'crawlLand', sessile: true, size: 1.4, r: 0.3, speed: 0,
    temp: [12, 36], hungerHours: 1e9, lifeDays: 16, eats: [], cap: 150, breed: 0, adultDays: 0.2,
    body: sdfBody('flypupa'), anim: { amp: 0, wave: 1, lift: 0, stride: 0 }, note: 'The still stage between maggot and fly, stuck to a wall or leaf.',
  },
  dartfrog: {
    name: 'Blue dart frog', scale: 1, group: 'Amphibians', kind: 'frog', size: 1.4, speed: 1,
    temp: [20, 27], humidity: 75, hungerHours: 170, lifeDays: 4000, eats: ['fly', 'springtail', 'isopod', 'flylarva', 'springsea'], cap: 8, breed: 0.05, adultDays: 25,
    eggs: { n: 5, days: 10, into: 'tadpole', where: 'shallow' },
    body: sdfBody('dartfrog'), anim: { amp: 0, wave: 1, lift: 0.3, stride: 0.35, swimLevel: 0 },
    note: 'Terrestrial. Needs high humidity and live insects. Lays eggs by shallow water.',
  },
  strawberry: {
    name: 'Strawberry dart frog', scale: 1, group: 'Amphibians', kind: 'frog', size: 1.1, speed: 0.9,
    temp: [21, 27], humidity: 80, hungerHours: 150, lifeDays: 3500, eats: ['springtail', 'fly', 'flylarva'], cap: 8, breed: 0.04, adultDays: 25,
    eggs: { n: 4, days: 10, into: 'tadpole', where: 'shallow' },
    body: sdfBody('strawberry'), anim: { amp: 0, wave: 1, lift: 0.22, stride: 0.26 },
    note: 'Tiny red frog with blue legs. Lives on springtails; needs very damp air and plenty of moss.',
  },
  toad: {
    name: 'Fire-bellied toad', scale: 1, group: 'Amphibians', kind: 'toad', size: 1.9, speed: 1.2,
    minL: 60, temp: [18, 26], humidity: 60, hungerHours: 240, lifeDays: 5000, eats: ['fly', 'springtail', 'isopod', 'shrimp', 'flylarva', 'cricket', 'earthworm', 'waxworm', 'bloodworm'], cap: 6, breed: 0.04, adultDays: 30,
    eggs: { n: 8, days: 7, into: 'tadpole', where: 'water' },
    ph: [6.8, 7.6], land: 0.5, flock: [3, 6],
    body: sdfBody('toad'), anim: { amp: 0, wave: 1, lift: 0.35, stride: 0.45, swimLevel: 0, limb: 1.25 },
    note: 'Semi-aquatic: needs both land and open water. Spawns in the water.',
  },
  newt: {
    name: 'Paddle-tail newt', scale: 1, group: 'Amphibians', kind: 'newt', size: 1.6, speed: 2,
    temp: [15, 24], humidity: 60, hungerHours: 200, lifeDays: 3000, eats: ['springtail', 'fly', 'isopod', 'flake', 'tadpole', 'larva', 'flylarva', 'earthworm'], cap: 8, breed: 0.03, adultDays: 30,
    eggs: { n: 6, days: 8, into: 'larva', where: 'water' },
    body: sdfBody('newt'), anim: { amp: 0.85, wave: 1.25, lift: 0.3, stride: 0.85, rig2: { neck: 0.22, s0: 0.05, s1: 0.32, neckY: 0.64, len: 11 } },
    note: 'A cool-stream newt. Wedges itself between rocks by day, walks the bottom at night with its head sweeping, swims in bursts, rises to gulp air, and on damp nights may wander the bank. Needs cool water (under 24 °C) and a hide.',
  },
  firesal: {
    name: 'Fire salamander', scale: 1, group: 'Amphibians', kind: 'newt', size: 2.4, speed: 1.6, landBias: 0.9,
    minL: 60, temp: [8, 22], humidity: 70, hungerHours: 220, lifeDays: 7000, eats: ['springtail', 'fly', 'isopod', 'flylarva', 'earthworm', 'cricket', 'dubia', 'waxworm'], cap: 6, breed: 0, adultDays: 40,
    body: sdfBody('newt'), anim: { amp: 1.15, wave: 1.3, lift: 0.4, stride: 1.1, rig2: { neck: 0.27, s0: 0.04, s1: 0.31, neckY: 1.4, len: 18 } },
    note: 'A forest salamander of cool, damp woods (8–22 °C). Out on dark, damp nights and after rain; by day it sits in a hide (wood, a rock, leaf litter) and comes back to the same one. Creeps up on prey and freezes, dries out without damp ground or a shallow dish to soak in, and warns with its black and yellow-orange instead of running.',
  },
  axolotl: {
    name: 'Axolotl', scale: 1, group: 'Amphibians', kind: 'axolotl', size: 2.6, speed: 1.4,
    minL: 80, temp: [14, 21], hungerHours: 260, lifeDays: 5000, eats: ['shrimp', 'flake', 'tadpole', 'larva'], cap: 8, breed: 0.03, adultDays: 30,
    eggs: { n: 4, days: 10, into: 'axolotl', where: 'water' },
    body: sdfBody('axolotl'), anim: { amp: 0.9, wave: 1.1, lift: 0.22, stride: 0.6, rig2: { neck: 0.27, s0: 0.05, s1: 0.31, neckY: 0.9, len: 12 } },
    note: 'Fully aquatic and needs cold water (14–21 °C): turn the heater down or it will suffer. Shuns bright light (give it a cave or shade), sits on the bottom with its gills fanning, rises now and then to gulp air, and finds food by smell. A pair lays eggs in the water; its colour genes make morphs.',
  },
  gecko: {
    name: 'Mourning gecko', scale: 1, group: 'Reptiles', kind: 'gecko', size: 1.4, speed: 4,
    minH: 40, temp: [21, 29], humidity: 55, hungerHours: 150, lifeDays: 3500, eats: ['fly', 'springtail', 'flylarva', 'cricket', 'waxworm'], cap: 10, breed: 0.04, adultDays: 25,
    eggs: { n: 2, days: 12, into: 'gecko', where: 'wall' },
    body: sdfBody('gecko'), anim: { amp: 0.7, wave: 1.1, waveHead: 0.45, lift: 0.3, stride: 0.75, rig2: { neck: 0.2, s0: 0.04, s1: 0.24, neckY: 1.5, len: 7.05, tail0: 0.62, tailY: 0.69 } },   // (the baked model, manifest gecko: 7.05 cm, neck base at spine 0.2 and 1.5 cm up, vent at 0.62)
    note: 'Climbs the background and glass. Sleeps by day in a crevice, often with others, comes out at dusk, drinks droplets after rain or misting, stalks insects with its tail waving, and licks its own eyes clean. Females lay eggs without males.',
  },
  cardinal: {
    name: 'Cardinal tetra', scale: 1, group: 'Fish', kind: 'swim', band: 'mid', school: true, size: 3.4, speed: 5,
    temp: [24, 29], hungerHours: 120, lifeDays: 1500, eats: ['flake'], cap: 60, breed: 0,
    body: sdfBody('cardinal'), anim: { amp: 0.22, wave: 1.6 },
    note: 'Blackwater schooling fish with a red stripe from nose to tail. Likes it warm and soft.',
  },
  ember: {
    name: 'Ember tetra', scale: 1, group: 'Fish', kind: 'swim', band: 'mid', school: true, size: 2.2, speed: 4.5,
    temp: [23, 29], hungerHours: 110, lifeDays: 800, eats: ['flake'], cap: 70, breed: 0,
    body: sdfBody('ember'), anim: { amp: 0.2, wave: 1.7 },
    note: 'A glowing orange nano fish, barely 2 cm. Shy: give it plants and company.',
  },
  betta: {
    name: 'Betta', scale: 1, group: 'Fish', kind: 'swim', band: 'top', school: false, size: 5, speed: 3,
    temp: [24, 30], hungerHours: 130, lifeDays: 1200, eats: ['flake'], cap: 6, breed: 0.02, adultDays: 40,
    body: sdfBody('betta'), anim: { amp: 0.32, wave: 1.3 },
    note: 'Long-finned labyrinth fish: it breathes air from the surface. A pair can breed; its colour genes make morphs.',
  },
  oto: {
    name: 'Otocinclus', scale: 1, group: 'Fish', kind: 'swim', band: 'bottom', school: true, size: 3, speed: 2.5,
    temp: [22, 27], hungerHours: 100, lifeDays: 1000, eats: ['biofilm', 'detritus', 'flake'], cap: 20, breed: 0,
    body: sdfBody('oto'), anim: { amp: 0.2, wave: 1.5 },
    note: 'A tiny algae grazer that clings to leaves and glass. Fragile in new tanks: wait until there is biofilm.',
  },
  snail: {
    name: 'Trumpet snail', scale: 1, group: 'Molluscs', kind: 'crawlWater', size: 1.2, speed: 0.5,
    temp: [18, 30], hungerHours: 200, lifeDays: 500, eats: ['detritus', 'biofilm', 'flake'], cap: 120, breed: 0.2, adultDays: 14,
    body: () => BODIES.snail(), anim: { amp: 0, wave: 1 },
    note: 'Burrows through the substrate and keeps it aerated. Overfeed and it multiplies fast.',
  },
  leucomelas: {
    name: 'Yellow-banded poison frog', scale: 1, group: 'Amphibians', kind: 'frog', size: 1.3, speed: 1,
    temp: [21, 28], humidity: 70, hungerHours: 170, lifeDays: 4000, eats: ['fly', 'springtail', 'isopod', 'flylarva'], cap: 8, breed: 0.05, adultDays: 25,
    eggs: { n: 4, days: 12, into: 'tadpole', where: 'shallow' },
    body: sdfBody('leucomelas'), anim: { amp: 0, wave: 1, lift: 0.3, stride: 0.35 },
    note: 'Bold yellow and black "bumblebee" frog from the Guiana Shield. Hardy and out in the open.',
  },
  auratus: {
    name: 'Green and black poison frog', scale: 1, group: 'Amphibians', kind: 'frog', size: 1.25, speed: 1,
    temp: [21, 28], humidity: 75, hungerHours: 170, lifeDays: 4000, eats: ['fly', 'springtail', 'isopod', 'flylarva'], cap: 8, breed: 0.05, adultDays: 25,
    eggs: { n: 4, days: 12, into: 'tadpole', where: 'shallow' },
    body: sdfBody('auratus'), anim: { amp: 0, wave: 1, lift: 0.3, stride: 0.35, swimLevel: 0 },
    note: 'Metallic green on black, from Central America. Its colour differs from island to island.',
  },
  // ---- From the keeper's care sheets (2026-10) -------------------------------------------------------------------
  cpd: {
    name: 'Celestial pearl danio', scale: 1, group: 'Fish', kind: 'swim', band: 'mid', school: true, size: 2.2, speed: 4,
    minL: 30, temp: [22, 26], hungerHours: 110, lifeDays: 1100, eats: ['flake'], cap: 40, breed: 0.015, adultDays: 45,
    ph: [6.5, 7.5], gh: [5, 12], flow: 0.45, flock: [6, 40],
    body: sdfBody('cpd'), anim: { amp: 0.2, wave: 1.7 },
    note: 'A 2 cm pearl-spotted danio from Myanmar. Shy: keep 6 to 10 or more, with dense moss and roots and only a gentle current. Fry survive in thick moss.',
  },
  pygmy: {
    name: 'Everglades pygmy sunfish', scale: 1, group: 'Fish', kind: 'swim', band: 'bottom', school: false, size: 3, speed: 2,
    minL: 40, temp: [18, 24], hungerHours: 100, lifeDays: 1100, eats: ['bloodworm', 'shrimp'], cap: 12, breed: 0.01, adultDays: 60,
    ph: [6.5, 7.5], gh: [3, 12], flow: 0.15, territorial: true, flock: [1, 12],
    body: sdfBody('pygmy'), anim: { amp: 0.24, wave: 1.4 },
    note: 'A 3 cm micro-predator for the water under a land setup: still water, thick moss and stems. Males turn velvet black with electric-blue spangles and dance at each other: one male to two or three females. Eats live food and baby shrimp.',
  },
  blueshrimp: {
    name: 'Blue dream shrimp', group: 'Crustaceans', kind: 'crawlWater', shrimp: true, swims: true, flicks: true, size: 1.0, speed: 1.2,
    temp: [20, 26], hungerHours: 200, lifeDays: 365, eats: ['detritus', 'biofilm', 'flake'], cap: 80, breed: 0.04, adultDays: 20,
    ph: [6.8, 8.0], gh: [6, 12], flow: 0.6, flock: [10, 80],
    anim: { lift: 0.06, stride: 0.1 },
    body: () => (BODIES.blueshrimp ?? BODIES.shrimp)(), note: 'A deep-blue Neocaridina. Grazes biofilm and needs stable, not-too-soft water; keep 10 to 15 to start a colony, apart from cherry shrimp or the colours wash out.',
  },
  panther: {
    name: 'Panther crab', group: 'Crustaceans', kind: 'crab', crabProfile: PANTHER, size: 2.4, speed: 3,
    minL: 100, temp: [24, 28], humidity: 70, hungerHours: 220, lifeDays: 1500, eats: ['detritus', 'flake', 'shrimp', 'snail', 'springtail'], cap: 4, breed: 0,
    ph: [7.5, 8.5], gh: [8, 15], land: 0.2, territorial: true, flock: [1, 2],
    anim: { lift: 0.3, stride: 0.47, legAxis: 'x', limb: 1 },
    body: () => (BODIES.panther ?? BODIES.crab)(),
    note: 'A big leopard-spotted crab from Lake Matano (Sulawesi). Mostly aquatic: deep (15-25 cm), hard, alkaline water with strong biological filtration, slate caves and roots it can climb out on. Keep one, or a true pair: males fight. It eats shrimp and snails.',
  },
  skink: {
    name: 'Red-eyed crocodile skink', scale: 1, group: 'Reptiles', kind: 'skink', size: 3, speed: 3,
    minL: 100, temp: [23, 27], humidity: 70, hungerHours: 260, lifeDays: 4000, eats: ['isopod', 'fly', 'flylarva', 'springtail', 'pandaking', 'cricket', 'dubia', 'earthworm', 'waxworm'], cap: 2, breed: 0.006, adultDays: 120,
    eggs: { n: 1, days: 60, into: 'skink', where: 'land' },
    bask: 28.5, uvb: 2, land: 0.8, territorial: true, flock: [1, 2], ph: [6.5, 7.8],
    body: sdfBody('skink'), anim: { amp: 0.4, wave: 1.0, lift: 0.15, stride: 0.6, rig2: { neck: 0.24, s0: 0.03, s1: 0.28, neckY: 2.78, len: 16.8, tail0: 0.536, tailY: 1.83 } },   // (the baked model, manifest skink: 16.8 cm, neck base at spine 0.24 and 2.78 cm up, vent at 9/16.8 and 1.83 cm up: S1a)
    note: 'A shy, armoured little lizard of humid stream banks in New Guinea, with orange rings round its eyes. 80% land, a shallow pool (5-7 cm at most) to soak in, 23-27 °C with a 28-29 °C warm spot, 80-90% humidity, low UVB; cork bark, leaf litter and moss to hide in. Out at dusk. One, or a male and a female.',
  },
  bumblebee: {
    name: 'Bumblebee toad', scale: 1, group: 'Amphibians', kind: 'frog', size: 1.0, speed: 0.7,
    minL: 40, temp: [20, 24], humidity: 70, hungerHours: 140, lifeDays: 3000, eats: ['springtail', 'flylarva', 'fly', 'isopod', 'springpink', 'springsea'], cap: 8, breed: 0.02, adultDays: 40,
    eggs: { n: 6, days: 6, into: 'tadpole', where: 'shallow' },
    land: 0.8, flock: [4, 8], drowns: true,
    body: sdfBody('bumblebee'), anim: { amp: 0, wave: 1, lift: 0.22, stride: 0.24 },
    note: 'A small black toad with canary-yellow spots and fiery red soles, out by day. It walks more than it hops and swims badly: water no deeper than 2-3 cm, with gentle gravel slopes, or it drowns. Keep 4 to 6; feeds on springtails and fruit flies.',
  },
  reedfrog: {
    name: 'Starry night reed frog', scale: 1, group: 'Amphibians', kind: 'frog', perch: true, perchSwim: true, size: 1.2, speed: 1,
    minL: 60, minH: 45, temp: [24, 29], humidity: 70, hungerHours: 150, lifeDays: 2500, eats: ['fly', 'flylarva', 'springtail', 'cricket'], cap: 8, breed: 0.03, adultDays: 30,
    eggs: { n: 8, days: 5, into: 'tadpole', where: 'water' },
    ph: [6.5, 7.5], land: 0.3, flock: [3, 8],
    body: sdfBody('reedfrog'), anim: { amp: 0, wave: 1, lift: 0.32, stride: 0.42 },
    note: 'A jet-black reed frog from Madagascar dotted with yellow-white stars and with orange legs. Sits by day high on broad leaves, bamboo and wood above the water, hunts flies at dusk. Wants a tall tank, 70% water, warm air (24-29 °C). Keep 3 to 5.',
  },
  redeye: {
    name: 'Red-eyed tree frog', scale: 1, group: 'Amphibians', kind: 'frog', perch: true, size: 1.8, speed: 1.1,
    minL: 60, minH: 60, temp: [22, 28], humidity: 75, hungerHours: 170, lifeDays: 3600, eats: ['fly', 'cricket', 'waxworm', 'dubia'], cap: 6, breed: 0.02, adultDays: 45,
    eggs: { n: 30, days: 7, into: 'tadpole', where: 'water' },
    ph: [6.5, 7.5], land: 0.4, flock: [2, 5],
    body: sdfBody('redeye'), anim: { amp: 0, wave: 1, lift: 0.45, stride: 0.6, limb: 1.4 },
    note: 'The red-eyed tree frog of Central American rainforests: leaf green, with blue-and-cream barred flanks and orange hands and feet that it hides when it sleeps. By day it sleeps stuck to a leaf, a stem or the glass, legs tucked in and eyes shut; at night it wakes, clambers about and hunts. Wants a tall tank with broad-leaved plants over water, 22-28 °C and damp air. Keep 2 to 5.',
  },
  marbled: {
    name: 'Marbled newt', scale: 1, group: 'Amphibians', kind: 'newt', size: 1.8, speed: 1.8,
    minL: 60, temp: [14, 21], humidity: 75, hungerHours: 220, lifeDays: 5000, eats: ['flake', 'tadpole', 'larva', 'springtail', 'isopod', 'flylarva', 'fly', 'earthworm', 'cricket'], cap: 6, breed: 0.02, adultDays: 60,
    eggs: { n: 6, days: 10, into: 'larva', where: 'water' },
    ph: [7, 7.5], flow: 0.2, land: 0.5, flock: [2, 4],
    body: sdfBody('marbled'), anim: { amp: 0.85, wave: 1.25, lift: 0.3, stride: 0.9, rig2: { neck: 0.24, s0: 0.04, s1: 0.31, neckY: 0.7, len: 11.9 } },
    note: 'A European newt in velvet green laced with black, the females with an orange stripe down the back. Needs it cool: 15-21 °C, and suffers above 23 °C. Half water (10-15 cm, still, with a slate ramp) and half damp mossy land. One male to two or three females.',
  },
  purpleiso: {
    name: 'Dwarf purple isopods', group: 'Crustaceans', kind: 'crawlLand', deep: true, size: 1.0, speed: 0.6,
    temp: [20, 28], humidity: 65, hungerHours: 160, lifeDays: 300, eats: ['detritus'], cap: 90, breed: 0.08, adultDays: 14, crew: 1,
    anim: { lift: 0.03, stride: 0.05 },
    body: () => (BODIES.purpleiso ?? BODIES.isopod)(), note: 'Clean-up crew that lives down by the drainage layer in very damp soil; rarely seen, never drowns.',
  },
  pandaking: {
    name: 'Panda king isopods', group: 'Crustaceans', kind: 'crawlLand', rolls: true, size: 2.0, speed: 0.9,
    temp: [22, 27], humidity: 65, hungerHours: 200, lifeDays: 700, eats: ['detritus'], cap: 30, breed: 0.025, adultDays: 45, crew: 2.5, drowns: true,
    anim: { lift: 0.04, stride: 0.07 },
    body: () => (BODIES.pandaking ?? BODIES.isopod)(), note: 'A big black-and-white Cubaris that rolls into a ball. A strong cleaner, but heavy: it can fall into open water and drown. Give it raised ground and sloped bark ramps out of the water.',
  },
  springpink: {
    name: 'Pink springtails', group: 'Insects', kind: 'crawlLand', hop: true, size: 1.6, speed: 0.9,
    temp: [20, 28], humidity: 68, hungerHours: 100, lifeDays: 50, eats: ['detritus'], cap: 110, breed: 0.18, adultDays: 6, crew: 0.3,
    body: () => (BODIES.springpink ?? BODIES.springtail)(), note: 'Tropical pink springtails: a little bigger and slower to breed than the whites, eat mould and frog food all the same.',
  },
  // Seashore springtails (Anurida maritima type): water-repellent, they walk on the surface film and graze its scum along the
  // shoreline (they clean the film, `film`), and take to the water when disturbed. Frog and fish food.
  springsea: {
    name: 'Seashore springtails', group: 'Insects', kind: 'crawlLand', surface: true, size: 1.5, speed: 0.8,         // (no furcula: it cannot jump)
    temp: [16, 28], humidity: 60, hungerHours: 100, lifeDays: 45, eats: ['detritus', 'biofilm'], cap: 140, breed: 0.22, adultDays: 6, crew: 0.15, film: 1,
    body: () => (BODIES.springsea ?? BODIES.springtail)(), note: 'Blue-grey springtails that live on the water itself: they walk the surface film, graze the scum on it and the wet shoreline, and feed fish and frogs.',
  },
  // Feeders (2026-10): bought by the cup from the Care panel's Feeding tab (Care.feeders) for the animals that eat them. They
  // do not breed in the tank and live days to weeks; whatever is not eaten hides (crickets, roaches) or digs in (earthworms,
  // which work the soil like the crew). They never count as losses.
  cricket: {
    name: 'Crickets', group: 'Insects', kind: 'crawlLand', feeder: true, hop: true, size: 1, speed: 2.4,
    crawlOpt: { restP: 0.55, rest: [2, 9], speed: 1 },
    temp: [18, 32], humidity: 30, hungerHours: 120, lifeDays: 21, eats: ['detritus'], cap: 40, breed: 0, adultDays: 1,
    body: () => BODIES.cricket(), anim: { lift: 0.12, stride: 0.3 },
    note: 'Banded crickets, dusted with calcium: the staple for skinks, geckos, toads and salamanders. Feed a few at a time; the ones left over hide and chew on plants.',
  },
  dubia: {
    name: 'Dubia roaches', group: 'Insects', kind: 'crawlLand', feeder: true, litterLover: true, size: 1, speed: 1.4,
    crawlOpt: { restP: 0.6, rest: [3, 12], speed: 1 },
    temp: [20, 34], humidity: 40, hungerHours: 200, lifeDays: 60, eats: ['detritus'], cap: 30, breed: 0, adultDays: 1,
    body: () => BODIES.dubia(), anim: { lift: 0.06, stride: 0.2 },
    note: 'Slow, soft, meaty roaches that cannot climb glass or fly: easy prey for a skink or a salamander. They dig into the litter if not eaten.',
  },
  earthworm: {
    name: 'Earthworms', group: 'Insects', kind: 'crawlLand', feeder: true, litterLover: true, deep: true, size: 1, speed: 0.35,
    crawlOpt: { restP: 0.5, rest: [3, 10], speed: 1 },
    temp: [10, 26], humidity: 75, hungerHours: 300, lifeDays: 40, eats: ['detritus'], cap: 30, breed: 0, adultDays: 1, crew: 0.6,
    body: () => BODIES.earthworm(), anim: { amp: 0.35, wave: 1.4, lift: 0, stride: 0 },
    note: 'Red wigglers: the best whole food for newts, salamanders and toads. The ones not eaten dig into damp soil and turn litter into humus.',
  },
  waxworm: {
    name: 'Waxworms', group: 'Insects', kind: 'crawlLand', feeder: true, size: 1, speed: 0.12,
    crawlOpt: { restP: 0.5, rest: [2, 8], speed: 1 },
    temp: [15, 32], humidity: 30, hungerHours: 1e9, lifeDays: 10, eats: [], cap: 20, breed: 0, adultDays: 1,
    body: () => BODIES.waxworm(), anim: { amp: 0.6, wave: 1.6, lift: 0, stride: 0 },
    note: 'Fat moth larvae: a treat, not a staple. Good for fattening a thin animal; too many make it fat.',
  },
  tadpole: {
    name: 'Tadpoles', scale: 1, group: 'Amphibians', kind: 'swim', band: 'bottom', school: false, size: 1.2, speed: 1.6, young: true,
    temp: [16, 29], hungerHours: 90, lifeDays: 90, eats: ['biofilm', 'detritus', 'flake'], cap: 80, breed: 0, metamorphDays: 14,
    body: sdfBody('tadpole'), anim: { amp: 0.25, wave: 1.2 },
    note: 'Hatch from eggs; grow legs and leave the water after about two weeks.',
  },
  // B3: the aquatic young of fire salamanders (born as larvae) and newts (hatched from eggs); `from` lists the parents (world.js
  // loads their old 'tadpole' saves as larvae). Size, metamorphDays and hungerHours are guesses; the body is bodies/salamanders.js.
  larva: {
    name: 'Salamander larvae', scale: 1, group: 'Amphibians', kind: 'swim', band: 'bottom', school: false, size: 1.4, speed: 1.3, young: true,
    temp: [8, 24], hungerHours: 120, lifeDays: 120, eats: ['bloodworm', 'flake'], cap: 40, breed: 0, metamorphDays: 20, from: ['firesal', 'newt', 'marbled'],
    // N1: [cm at birth/hatching, cm at metamorphosis] by parent; general knowledge, to check (fire salamander born 2.5-3.5 cm, smooth newt
    // hatches 0.7-1.0 cm; marbled newt values a guess). cmAt1 = drawn length at scale 1 (N1b: geoLen 11.939, amph-life-day AMPH_LARVA).
    sizeBy: { firesal: [3.0, 5.5], newt: [0.85, 3.5], marbled: [1.0, 5.0] }, cmAt1: 11.939,
    body: sdfBody('larva'), anim: { amp: 0.3, wave: 1.1 },
    note: 'Young of fire salamanders and newts: feathery gills, four legs, a finned tail. Sit on the bottom between short swims, eat small live food, and leave the water as young salamanders.',
  },
  eggs: {
    name: 'Egg clutches', scale: 1, group: 'Amphibians', kind: 'egg', size: 1, speed: 0, young: true,
    temp: [12, 32], hungerHours: 1e9, lifeDays: 60, eats: [], cap: 30, breed: 0,
    body: sdfBody('eggs'), note: 'Laid by frogs, newts and geckos. They hatch after a while.',
  },
};

export const ONE = { neon: 'neon tetra', guppy: 'guppy', cory: 'corydoras', loach: 'clown loach', shrimp: 'cherry shrimp', crab: 'vampire crab', isopod: 'isopod', springtail: 'springtail', fly: 'fruit fly', flylarva: 'fruit fly maggot', flypupa: 'fruit fly pupa', dartfrog: 'blue dart frog', strawberry: 'strawberry dart frog', toad: 'fire-bellied toad', newt: 'newt', firesal: 'fire salamander', axolotl: 'axolotl', gecko: 'gecko', tadpole: 'tadpole', larva: 'salamander larva', eggs: 'egg clutch', cardinal: 'cardinal tetra', ember: 'ember tetra', betta: 'betta', oto: 'otocinclus', snail: 'trumpet snail', leucomelas: 'yellow-banded poison frog', auratus: 'green and black poison frog', cpd: 'celestial pearl danio', pygmy: 'pygmy sunfish', blueshrimp: 'blue dream shrimp', panther: 'panther crab', skink: 'crocodile skink', bumblebee: 'bumblebee toad', reedfrog: 'starry night reed frog', redeye: 'red-eyed tree frog', marbled: 'marbled newt', purpleiso: 'dwarf purple isopod', pandaking: 'panda king isopod', springpink: 'pink springtail', springsea: 'seashore springtail', cricket: 'cricket', dubia: 'dubia roach', earthworm: 'earthworm', waxworm: 'waxworm', flake: 'flake', pellet: 'pellet', bloodworm: 'bloodworm' };
export const one = (id) => ONE[id] ?? SPECIES[id]?.name.toLowerCase() ?? (isItem(id) ? id : String(id));

export const FOOD_VALUE = { fly: 0.25, flylarva: 0.03, springtail: 0.07, springpink: 0.08, springsea: 0.07, isopod: 0.12, pandaking: 0.3, shrimp: 0.35, blueshrimp: 0.35, snail: 0.3, flake: 0.3, pellet: 0.4, bloodworm: 0.12, tadpole: 0.2, cricket: 0.3, dubia: 0.4, earthworm: 0.45, waxworm: 0.35 };

// Prepared foods (flakes, pellets, bloodworms) and who eats them: content/foods.js.
export { ITEMS, isItem, dietOf, eatsItem };

// ---------------------------------------------------------------------------

// Which body a (species, morph) is drawn with: the morph's own variant `BODIES['<species>:<morph>']` when the
// body library has one, otherwise the species' default. The result is also the key of its instanced mesh.
export function meshKeyFor(id, morph) {
  return morph && BODIES[`${id}:${morph}`] ? `${id}:${morph}` : id;
}

// The instanced mesh for one species and morph (also used by the creature bench and the portraits).
export function createSpeciesMesh(scene, id, { cap = null, morph = null } = {}) {
  const sp = SPECIES[id];
  const a = sp.anim ?? {};
  const key = meshKeyFor(id, morph);
  const src = (BODY_CACHE[key] ??= key === id ? sp.body() : BODIES[key]());
  const group = sp.group === 'Fish' ? 'fish' : sp.group === 'Amphibians' ? 'amphibian' : sp.group === 'Reptiles' ? 'reptile' : 'invert';
  return new CreatureLOD(scene, src, {
    cap: cap ?? sp.cap + 20,
    wave: a.wave ?? 1, legLift: a.lift ?? 0.25, legStride: a.stride ?? 0.35, legAxis: a.legAxis ?? 'z', limb: a.limb ?? 1,
    finish: { ...FINISH[group], ...(src.finish ?? {}), ...(a.waveHead != null ? { waveHead: a.waveHead } : {}), ...(a.rig2 ? { rig2: a.rig2 } : {}), ...turnRigFinish(sp) },
    near: 34 + sp.size * 10,
  });
}

// The turning rig a species' mesh is built with (render/creatures/instanced.js turnFinish): four-legged walkers swing their legs round
// the pivot in a turn (`turnSweep`: the body plan, measured on the mesh), and a fish gets the rig2 bend channel for the C-bend of a
// turn (head yaw unused; its length is measured on the mesh). Insects, crabs and shrimp step round with their own leg rigs.
export function turnRigFinish(sp) {
  const plan = planOf(sp), a = sp.anim ?? {};
  if ((plan === 'anuran' || plan === 'caudate' || plan === 'lizard') && a.stride && (a.legAxis ?? 'z') === 'z') return { turnSweep: plan };
  if (plan === 'fish' && !a.rig2) return { rig2: { neck: 0, s0: 0, s1: 0.02, neckY: 0 } };
  return {};
}

const READY = new Map();         // id → (scene, cap) => mesh: models already loaded, so a later tank uses them at once
const GLB_CACHE = new Map();     // id → Promise<{lo, hi, textures} | null>, shared by every tank
const WALKERS = ['skink', 'frog', 'toad', 'newt', 'axolotl', 'gecko', 'crab', 'crawlLand', 'crawlWater'];

let nextId = 1;

// Body meshes take a moment to build (surface nets), so they are built once and shared by every tank.
const BODY_CACHE = {};

// The textured model of a species (public/assets/creatures/manifest.json), as a function that makes its mesh in a scene, or
// null when the species has none. Used by Animals.upgradeModels and by the portraits (engine/portraits.js), so a menu picture
// shows the model the tank shows. `cap`: how many instances the mesh holds.
export async function modelBuilder(id, meta = null) {
  meta ??= (await loadManifest())[id];
  const sp = SPECIES[id.split(':')[0]];                // 'dartfrog:sky_clean': a morph's own model, drawn like its species
  if (!sp || !meta || meta.disabled || meta.pose) return null;
  const ck = meta.file ?? id;                          // (by file: a morph that is the species' default look shares its files)
  if (!GLB_CACHE.has(ck)) GLB_CACHE.set(ck, loadCreatureGLB(id, { legs: WALKERS.includes(sp.kind), ...meta }));
  const g = await GLB_CACHE.get(ck);
  if (!g) return null;
  const a = sp.anim ?? {};
  const group = sp.group === 'Fish' ? 'fish' : sp.group === 'Amphibians' ? 'amphibian' : sp.group === 'Reptiles' ? 'reptile' : 'invert';
  // A palette model (one file for every colour line: the dwarf shrimp) is coloured here for the line in its key ('shrimp:blue'), or
  // the line the manifest fixes for a species (blue dream), or the species' default.
  const palette = meta.palette ? paletteFinish(id.includes(':') ? id.split(':')[1] : meta.paletteMorph ?? 'red', meta) : null;
  return (scene, cap = sp.cap + 20) => new CreatureLOD(scene, g.lo, {
    cap, wave: a.wave ?? 1, legLift: a.lift ?? 0.25, legStride: a.stride ?? 0.35, legAxis: a.legAxis ?? 'z', limb: a.limb ?? 1,
    finish: { ...FINISH[group], bump: 0, tone: 0.02, grain: 1, ...(meta.finish ?? {}), ...(palette ? { palette } : {}), ...(a.waveHead != null ? { waveHead: a.waveHead } : {}), ...(a.rig2 ? { rig2: a.rig2 } : {}), ...turnRigFinish(sp) }, near: 34 + sp.size * 10, hiGeometry: g.hi === g.lo ? null : g.hi, textures: g.textures,
  });
}

// The colours of one dwarf-shrimp line for the palette shader (render/creatures/material.js): linear colours from content/morphs.js,
// a glassier wild line, and for a rili line the clear band, from a third to three fifths of the body back from the rostrum (bodyZ).
export function paletteFinish(morph, meta) {
  const P = shrimpPalette(morph), lin = (h) => { const c = new THREE.Color().setHex(h); return [c.r, c.g, c.b]; };
  const [z0, z1] = meta.bodyZ ?? [-0.8, 0.8], L = z1 - z0;
  return { base: lin(P.base), deep: lin(P.deep), glass: lin(P.glass), egg: lin(0xd8b830), clear: morph === 'wild' ? 0.7 : 0, rili: P.rili, riliZ: [z1 - L * 0.32, z1 - L * 0.62] };
}

export class Animals {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.by = {};
    this.meshes = {};     // instanced meshes by key: the species id (its default look) or '<species>:<morph>', each built when first drawn
    this.keys = {};       // species id -> the keys of the meshes built for it so far (the default and every morph drawn)
    this.models = {};     // species id -> builds its textured model's mesh, once that model has loaded (upgradeModels)
    this.poseMeta = {};   // species id -> { swim: { key, meta } }: the manifest entries of its pose models, loaded when the species first shows up (ensurePose)
    this.poseModels = {}; // species id -> { swim: builds the mesh of its swimming-pose model } (loadPose); drawn instead of the sitting one while it swims
    this.tails = {};
    this.food = [];
    this.camera = null;   // set by Game: fine meshes are used for animals near it
    this.occ = new Occupancy();   // hardscape that is not part of the height field (roots, wood, overhangs)
    this.avoid = true;            // steer around it and unstick animals (the stuck test switches it off for a baseline)
    this._occWall = 0; this._occSigT = 0;
    this.stuckStats = { unstuck: 0, relocated: 0, worst: 0 };
    this.warp = 1;                // game minutes per animal second (1 at 1x; the vacation test runs at about 10)
    this.tf = 1;                  // animal time per real time this frame (1 … 4): strikes and hops play in real time
    this.grid = new Map(); this._stamp = 0; this.striking = new Set();
    this.tails = [];                // dropped gecko tails: { sp, pos, q, sc, age, phase, vy, yaw } (see draw)
    this.tongues = new Tongues(scene);
    this.contacts = new ContactShadows(scene);   // the dark spot where an animal meets the ground (render/creatures/contact.js)
    this.shells = [];               // cast shrimp shells on the bottom: { sp, pos, yaw, roll, left, life } (sim/shrimp.js moult)
    this.castShells = new CastShells(scene);
    this.shrimpCalls = [];          // females that have just moulted ready to breed: { sp, x, z, t, id } (the males' search)
    for (const id of Object.keys(SPECIES)) {
      this.by[id] = [];
      this.keys[id] = [];
    }
    this.upgradeModels().catch((e) => console.warn('creature models', e));
    // Food in the water: one material for all three shapes (flake, pellet, bloodworm), coloured per instance.
    const fg = new THREE.IcosahedronGeometry(0.22, 0);
    fg.scale(1, 0.35, 1);
    const pg = new THREE.IcosahedronGeometry(0.26, 1);
    const wg = new THREE.CapsuleGeometry(0.06, 0.75, 2, 5);
    wg.rotateX(Math.PI / 2);
    const fm = new THREE.MeshStandardNodeMaterial({ color: 0xffffff, roughness: 0.75 });
    this.foodMeshes = {};
    for (const [k, geo] of [['flake', fg], ['pellet', pg], ['bloodworm', wg]]) {
      const m = new THREE.InstancedMesh(geo, fm, 200);
      const col = new THREE.Color(ITEMS[k].color);
      for (let i = 0; i < 200; i++) m.setColorAt(i, col);
      m.count = 0; m.frustumCulled = false;
      scene.add(m);
      this.foodMeshes[k] = m;
    }
    this.foodMesh = this.foodMeshes.flake;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
  }

  // Swap in textured models (public/assets/creatures/) for any species that has one. A manifest key is a mesh key: the species
  // ('dartfrog') or one of its morphs ('dartfrog:sky_clean'), and '<mesh key>.<pose>' for a pose model.
  async upgradeModels() {
    const man = await loadManifest();
    for (const [id, meta] of Object.entries(man)) {
      if (meta.pose) { const [b, p] = id.split('.'); (this.poseMeta[b] ??= {})[p] = { key: id, meta }; if (this.meshes[b]) this.ensurePose(b, p); continue; }
      if (SPECIES[id.split(':')[0]] && !meta.disabled) (this.modelMeta ??= {})[id] = meta;
      if (this.meshes[id]) this.loadModel(id);
      // A palette model serves every colour line of its species (the genetics' morphs) from the one file.
      if (meta.palette && !id.includes(':') && SPECIES[id] && hasGenetics(id)) for (const m of morphList(id)) {
        const k = `${id}:${m}`;
        this.modelMeta[k] ??= meta;
        if (this.meshes[k]) this.loadModel(k);
      }
    }
  }

  // A species' textured model is fetched the first time an animal of it is drawn (meshFor), not at start: every model
  // together is over 1.5 MB and fetching them all held the loading screen 4 to 5 s on the live site. Once loaded (READY,
  // shared by every tank) a new tank builds the model directly; until then the procedural body stands in and is swapped.
  loadModel(id) {
    const meta = this.modelMeta?.[id];
    if (!meta || this.models[id] || this._loadingModel?.has(id)) return;
    (this._loadingModel ??= new Set()).add(id);
    this.modelsLoading = (this.modelsLoading ?? 0) + 1;   // the loading veil waits for these (ui/Veil.jsx)
    modelBuilder(id, meta).then((build) => {
      if (!build) return;
      READY.set(id, build);
      this.models[id] = () => build(this.scene);
      // A species that is already drawn with its procedural body switches over.
      const old = this.meshes[id];
      if (old && this.scene.parent) { this.meshes[id] = this.models[id](); old.remove(); }
    }).catch((e) => console.warn('creature model', id, e)).finally(() => { this.modelsLoading--; });
  }

  // A pose model is the same animal in another body, drawn while it does one thing: manifest key '<mesh key>.<pose>', e.g.
  // 'leucomelas.swim' or 'dartfrog:sky_clean.swim', a frog mid-stroke with its legs out (made by tools/bake-frogpose.mjs). It has no
  // rig of its own: it moves as a whole (the stroke's surge and glide, the bob and roll of Animals.draw), and the sitting model is
  // drawn the rest of the time. Fetched only when a tank has an animal of the species (and not at all on a tank without one).
  // `id` here is a mesh key (meshKeyFor): the species, or the species and morph.
  ensurePose(id, pose = 'swim') {
    const m = this.poseMeta[id]?.[pose];
    if (!m || this.poseModels[id]?.[pose] || this._posing?.has(m.key)) return;
    (this._posing ??= new Set()).add(m.key);
    this.modelsLoading = (this.modelsLoading ?? 0) + 1;
    this.loadPose(m.key, m.meta).catch((e) => console.warn('pose model', m.key, e)).finally(() => { this.modelsLoading--; });
  }

  async loadPose(key, meta) {
    const [id, pose] = key.split('.');
    const sp = SPECIES[id.split(':')[0]];
    if (!sp || meta.disabled) return;
    if (!GLB_CACHE.has(key)) GLB_CACHE.set(key, loadCreatureGLB(key, { legs: false, ...meta }));
    const g = await GLB_CACHE.get(key);
    if (!g) return;
    const group = sp.group === 'Fish' ? 'fish' : sp.group === 'Amphibians' ? 'amphibian' : sp.group === 'Reptiles' ? 'reptile' : 'invert';
    (this.poseModels[id] ??= {})[pose] = () => new CreatureLOD(this.scene, g.lo, {
      cap: sp.cap + 20, wave: 1, legLift: 0, legStride: 0,
      finish: { ...FINISH[group], bump: 0, tone: 0.02, grain: 1, ...(meta.finish ?? {}) }, near: 34 + sp.size * 10, hiGeometry: g.hi === g.lo ? null : g.hi, textures: g.textures,
    });
    this.warmPose(id, pose);
  }

  // Building a mesh is a shader to compile, so a pose mesh is made a few seconds after its species first shows up, not in the frame
  // a frog first goes swimming (and not during the load): one hitch early in the game instead of one at a random moment.
  warmPose(id, pose) {
    const key = `${id}#${pose}`;
    if (this.meshes[key] || this._warming?.has(key)) return;
    (this._warming ??= new Set()).add(key);
    const [sid, morph] = id.split(':');
    setTimeout(() => { if (this.scene.parent) this.meshFor(sid, morph ?? null, pose); }, 6000 + Math.random() * 4000);
  }

  get all() { return Object.values(this.by).flat(); }

  // The mesh that draws a species, or one morph of it; built on first use. A tank holds a dozen of the species, and a
  // mesh is a body to mesh, a material to make and a shader to build, so only the ones in use exist. The species' default
  // mesh stands in when the body library has no variant for the morph (so counts stay right and nothing is built twice).
  meshFor(id, morph = null, pose = null) {
    const key = meshKeyFor(id, morph);
    if (pose) {
      // a morph without a pose model of its own swims in the species' one
      const pk = this.poseModels[key]?.[pose] ? key : this.poseMeta[key]?.[pose] ? null : id;
      const build = pk && this.poseModels[pk]?.[pose], mk = `${pk}#${pose}`;
      if (!build) return null;
      if (!this.meshes[mk]) { this.meshes[mk] = build(); this.keys[id].push(mk); }
      return this.meshes[mk];
    }
    if (!this.meshes[key]) {
      // The textured model of this species or morph once it has loaded; the procedural body stands in until then.
      if (!this.models[key] && READY.has(key)) { const b = READY.get(key); this.models[key] = () => b(this.scene); }
      this.meshes[key] = this.models[key] ? this.models[key]() : createSpeciesMesh(this.scene, id, { morph });
      if (!this.models[key]) this.loadModel(key);
      this.keys[id].push(key);
      for (const pose of new Set(['swim', ...Object.keys(this.poseMeta[key] ?? {})])) {
        this.ensurePose(key, pose);
        if (this.poseModels[key]?.[pose]) this.warmPose(key, pose);
      }
    }
    return this.meshes[key];
  }

  // --- Mates -----------------------------------------------------------------------------------
  // The animal marked as this one's mate (null if none, or if it has left the tank).
  mateOf(a) {
    if (a.mate == null) return null;
    const b = (this.by[a.sp] ?? []).find((x) => x.id === a.mate);
    return b && !b.dead ? b : null;
  }
  // Mark two animals of one species as a pair; breeding then prefers them for each other.
  pairUp(a, b) {
    if (!a || !b || a === b || a.sp !== b.sp) return false;
    this.unpair(a); this.unpair(b);
    a.mate = b.id; b.mate = a.id;
    return true;
  }
  unpair(a) {
    const b = this.mateOf(a);
    if (b && b.mate === a.id) b.mate = null;
    a.mate = null;
  }
  // Who would `a` breed with right now? A marked mate (if it is fit), else a random fit adult that is not marked.
  partnerFor(a) {
    const sp = SPECIES[a.sp];
    const fit = (x) => x !== a && !x.dead && x.age > (sp.adultDays ?? 10) * 1440 && x.hunger < 0.5 && x.health > 0.7;
    const m = this.mateOf(a);
    if (m) return fit(m) ? m : null;
    const pool = this.by[a.sp].filter((x) => fit(x) && !this.mateOf(x));
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
  }

  // Moss and leaf litter hide the last few of any prey species.
  refuge() { return 6 + Math.round(this.world.mossFraction() * 20); }
  catchable(pid) { return (this.by[pid]?.length ?? 0) > (SPECIES[pid]?.feeder ? 0 : this.refuge()); }
  count(id) { return this.by[id].length; }

  // How comfortable is this spot for the species (0 … 1)? Combines the local
  // temperature and humidity against what it needs, so land animals wander
  // toward the damp, warm-enough parts of the tank when it is dry or cold.
  comfortAt(sp, x, y, z) {
    const C = this.world.climate;
    let c = 1;
    if (sp.humidity) c *= clamp(1 - Math.max(0, sp.humidity - C.humidityAt(x, y, z)) / 8, 0.05, 1);
    const T = C.tempAt(x, y, z), [lo, hi] = sp.temp;
    if (T < lo) c *= clamp(1 - (lo - T) / 3, 0.05, 1);
    else if (T > hi) c *= clamp(1 - (T - hi) / 3, 0.05, 1);
    return c;
  }

  // Where may species `id` be placed for a hit? Returns {pos} or {error}.
  placement(id, hit) {
    const sp = SPECIES[id];
    const W = this.world;
    const { x, z } = hit.point;
    const ground = W.terrain.heightAt(x, z);
    const wl = W.water.level;
    const depth = wl - ground;
    const surf = W.water.surfaceAt(x, z);
    switch (sp.kind) {
      case 'swim':
        if (depth < 3) return { error: `${sp.name} need open water at least 3 cm deep.` };
        return { pos: V(x, ground + depth * (sp.band === 'bottom' ? 0.15 : sp.band === 'top' ? 0.8 : 0.5), z) };
      case 'crawlWater':
        if (depth < 1) return { error: `${sp.name} live under water.` };
        return { pos: V(x, ground, z) };
      case 'crawlLand':
        if (sp.surface) return W.nearWater(V(x, ground, z), 3) || surf > ground ? { pos: V(x, Math.max(ground, surf), z) } : { error: `${sp.name} live on the water's surface and the wet shore.` };
        if (surf > ground) return { error: `${sp.name} live on land.` };
        return { pos: V(x, ground, z) };
      case 'crab':
        if (sp.crabProfile?.aquatic) return { pos: V(x, ground, z) };
        if (depth > 6) return { error: 'Too deep for a crab.' };
        return { pos: V(x, Math.max(ground, 0), z) };
      case 'fly':
        return { pos: V(x, Math.max(ground, surf) + 3, z) };
      case 'frog':
        if (surf > ground) return { error: `${sp.name} can’t swim well. Put it on land.` };
        return { pos: V(x, ground, z) };
      case 'toad':
        if (surf > ground) return { pos: V(x, surf - 0.3, z) };
        return { pos: V(x, ground, z) };
      case 'newt': case 'axolotl': {          // (placement.js herpSpot: the habitat row decides; a fire salamander is never put on a pool floor)
        const r = herpSpot(HABITAT[id], { ground, surf, wl, nearWater: (d) => W.nearWater(V(x, ground, z), d), deepNear: (r, m) => deepWithin((px, pz) => this.wDepth(px, pz), x, z, r, m) });
        return r.error ? r : { pos: V(x, r.y, z) };
      }
      case 'gecko':
        if (hit.surface === 'wall') return { pos: hit.point.clone(), wall: true };
        if (surf > ground) return { error: 'Geckos live on land and on the background.' };
        return { pos: V(x, ground, z) };
      case 'skink':
        if (surf - ground > 4) return { error: `${sp.name} wade in shallow water but cannot swim well. Put it on land or in water under 4 cm.` };
        return { pos: V(x, ground, z) };
      case 'egg':
        return { pos: V(x, Math.max(ground, surf - 1), z) };
    }
    return { error: 'Can’t place here.' };
  }

  add(id, pos, opt = {}) {
    const sp = SPECIES[id];
    if (this.by[id].length >= sp.cap + 20) return null;
    let uid = nextId++;
    while (this.all.some((o) => o.id === uid)) uid = nextId++;      // a loaded save may already use this number
    const a = {
      id: uid, sp: id, pos: pos.clone(), vel: V(0, 0, 0), yaw: Math.random() * Math.PI * 2, pitch: 0,
      hunger: opt.hunger ?? 0.2, health: opt.health ?? 1, age: opt.age ?? (sp.adultDays ?? 10) * 1440,
      state: 'idle', timer: Math.random() * 3, target: null, wander: Math.random() * Math.PI * 2,
      phase: Math.random() * 10, home: pos.clone(), hop: null, name: null, cause: null,
      gen: opt.gen ?? 0, parents: opt.parents ?? null, nick: opt.nick ?? null, mate: null,
    };
    // Genes: founders get the genotype of the chosen morph (or a random wild one); children are given theirs.
    // Tadpoles carry the genes of the frog they will become.
    if (hasGenetics(id)) {
      const ok = Array.isArray(opt.genes) && opt.genes.length === SPECIES_LOCI(id);
      let genes = ok ? [...opt.genes] : null;
      if (!genes && opt.morph) { try { genes = genotypeForMorph(id, opt.morph); } catch { genes = null; } }
      a.genes = genes ?? randomGenotype(id);
      a.morph = morphOf(id, a.genes);
    } else if (opt.genes && opt.gsp) {
      a.genes = [...opt.genes]; a.morph = opt.morph ?? morphOf(opt.gsp, a.genes); a.gsp = opt.gsp;
    }
    // Territorial species (males fight) come as a sexed group, as a dealer sells them: one male, the rest females.
    if (sp.territorial) a.male = opt.male ?? !this.by[id].some((b) => b.male);
    this.by[id].push(a);
    return a;
  }

  remove(a, cause = null) {
    const arr = this.by[a.sp];
    const i = arr.indexOf(a);
    if (i >= 0) arr.splice(i, 1);
    a.dead = true;
    a.cause = cause;
  }

  feed(kind = 'flake') {
    const W = this.world, I = ITEMS[kind] ?? ITEMS.flake;
    const cand = [];
    for (let k = 0; k < 60; k++) {
      const x = (Math.random() - 0.5) * (TANK.w - 6), z = (Math.random() - 0.5) * (TANK.d - 6);
      if (W.water.isWater(x, z, 3)) cand.push([x, z]);
    }
    if (!cand.length) return 0;
    const [cx, cz] = cand[Math.floor(Math.random() * cand.length)];
    // Enough for everyone: about two flakes (one pellet, a few worms) per animal that eats it in the water.
    let fish = 0;
    for (const id in SPECIES) {
      const sp = SPECIES[id];
      if ((sp.kind === 'swim' || sp.kind === 'crawlWater' || sp.kind === 'crab' || sp.kind === 'newt' || sp.kind === 'axolotl') && dietOf(sp).includes(kind)) fish += this.by[id].length * (sp.kind === 'crawlWater' ? 0.2 : 1);
    }
    const n = Math.max(I.min, Math.round(fish * I.per));
    // A cube of bloodworms thaws in one spot; flakes and pellets scatter.
    const spread = kind === 'bloodworm' ? 4 : 10;
    for (let k = 0; k < n; k++) {
      if (this.food.length >= 190) break;
      this.food.push({ kind, pos: V(cx + (Math.random() - 0.5) * spread, W.water.level - 0.1, cz + (Math.random() - 0.5) * spread * 0.8), sink: I.sink[0] + Math.random() * (I.sink[1] - I.sink[0]), float: I.float, age: 0, settled: false });
    }
    return n;
  }

  // ---------------------------------------------------------------------
  // Movement, run every frame. dt: real seconds (already speed-scaled and
  // clamped). dtMin: game minutes, for needs.
  move(dt) {
    const W = this.world;
    this.t = (this.t ?? 0) + dt;
    this.trackTime(dt);
    if (dt > 0) { this.syncOccupancy(); this.buildGrid(); }
    for (const [id, arr] of Object.entries(this.by)) {
      const sp = SPECIES[id];
      for (const a of arr) {
        const px = a.pos.x, py = a.pos.y, pz = a.pos.z;
        if (a.st) { a.speedNow = 0; continue; }          // mid-strike: the strike moves it
        if (a.lab && dt > 0) this.labDrive(a, dt);       // the test lab (src/lab) names a goal; the mind below is muted for it
        switch (sp.kind) {
          case 'swim': this.swim(a, sp, arr, dt, a.lab?.drive ? this.labCtl(a, sp) : null); break;
          case 'crawlWater': if (sp.shrimp) this.shrimp(a, sp, dt); else this.crawl(a, sp, dt, 'water'); break;
          case 'crawlLand': if (!sp.sessile) this.crawl(a, sp, dt, sp.surface ? 'surface' : 'land', sp.crawlOpt ?? null); break;
          case 'crab': this.crab(a, sp, dt); break;
          case 'fly': this.fly(a, sp, dt); break;
          case 'frog':
          case 'toad': if (!((sp.perch || a.perch) && !a.lab?.drive && this.perchFrog(a, sp, dt))) this.frog(a, sp, dt); break;   // (a.perch: any frog climbing out of the water)
          case 'newt': case 'axolotl': case 'gecko': this.herp(a, sp, arr, dt); break;
          case 'skink': this.skink(a, sp, dt); break;
          case 'egg': break;
        }
        if (a.lookTo != null) {
          // Looking round (vis): a body without a neck turns on the spot, while it is sitting or resting and nothing else moves it.
          const rest = !a.hop && !a.swimming && !a.perch && !a.wallMode && !a.onWall && !a.st && (sp.kind === 'frog' || sp.kind === 'toad' ? a.fs === 'sit' : a.state !== 'walk');
          if (!rest || Math.abs(angDiff(a.lookTo, a.yaw ?? 0)) < 0.02) a.lookTo = null;
          else if (dt > 0) this.turnTo(a, sp, a.lookTo, sp.kind === 'frog' || sp.kind === 'toad' ? dt / this.tf : dt, 4);
        }
        if (dt > 0 && LIVE.has(sp.kind)) this.hunter(a, sp, dt);
        if (dt > 0 && this.avoid) this.keepFree(a, sp, dt);
        if (dt > 0 && this.avoid && CORE_WALKERS.has(sp.kind)) this.offCliff(a, sp, px, py, pz);
        // Distance walked drives the leg cycle: one cycle per stride of this animal at its size (util/gait.js strideRate), so
        // a planted foot does not slide. A frog or salamander turning on the spot steps round too (its feet travel about half a
        // body length per radian), and `stepping` says the legs are working, so they come to rest planted when it stops.
        const moved = Math.hypot(a.pos.x - px, a.pos.y - py, a.pos.z - pz);
        // Turning drives the legs too (util/turn.js): the feet travel R a radian round the pivot, R measured on the mesh, so there is
        // no yaw without the legs stepping; the turning mix (a.turnMix) tells the rig to swing them round instead of back.
        const dyaw = a._py != null ? angDiff(a.yaw ?? 0, a._py) : 0;
        a._py = a.yaw ?? 0;
        let steps = moved, tau = 0;
        if (dyaw && !a.hop && !a.swimming && sp.kind !== 'swim') {
          const ts = turnSteps(Math.max(0, moved - (a.pivotMoved ?? 0)), dyaw, this.turnRadius(a, sp));
          steps = ts.steps; tau = ts.tau;
        }
        a.pivotMoved = 0;
        if (dt > 0) this.turnPoseStep(a, sp, dyaw, tau, sp.kind === 'frog' || sp.kind === 'toad' ? dt / this.tf : dt);
        const rate = sp.kind === 'crab' ? crabGaitRate((sp.crabProfile ?? CRAB).shellCm) : VIS.has(sp.kind) && sp.anim?.stride ? strideRate(sp.anim.stride, drawScale(a, sp)) : 2.6;
        a.gait = (a.gait ?? a.phase) + steps * rate;
        if (dt > 0) a.stepping = steps > 1e-4 ? 0.18 : Math.max(0, (a.stepping ?? 0) - dt / this.tf);
        if (a.tapT > 0) a.tapT -= dt / this.tf;
        a.speedNow = dt > 0 ? moved / (sp.kind === 'frog' || sp.kind === 'toad' ? dt / this.tf : dt) : 0;
      }
    }
    this.separate(dt);
    this.strikes(dt);
    // Second look: nobody may end the step inside a piece or under the ground (animals that moved after their own check).
    if (this.avoid && dt > 0) {
      const T = W.terrain;
      for (const [id, arr] of Object.entries(this.by)) {
        const sp = SPECIES[id];
        for (const a of arr) {
          // Never beyond the glass: its middle, then the whole body as it is drawn (inGlass). (A frog clinging to the pane is held GLASS_GAP off it,
          // not 0.4: the toes' pads on the glass, not a gap of a seventh of its length.)
          const cling = a.perch?.glassN && a.perch.ph !== 'go' && a.normal && a.normal.dot(a.perch.glassN) > 0.99 ? GLASS_GAP : 0.4;
          const hx = TANK.w / 2 - cling, hz = TANK.d / 2 - cling;
          a.pos.x = clamp(a.pos.x, -hx, hx); a.pos.y = clamp(a.pos.y, 0, TANK.h - 0.5);
          if (!a.wallMode) a.pos.z = clamp(a.pos.z, -hz, hz);
          if (sp.kind !== 'egg') this.inGlass(a, sp);
          if (a.onWall || a.hop || a.wallMode || (a.perch && a.perch.ph !== 'go')) continue;
          if (sp.kind !== 'swim') { const g = T.heightAt(a.pos.x, a.pos.z); if (a.pos.y < g - 0.3) a.pos.y = g; }
          if (sp.kind !== 'egg') this.clearOfWall(a, sp);
          if (CORE_WALKERS.has(sp.kind)) this.outOfStems(a, sp);
          if (CORE_WALKERS.has(sp.kind)) this.outOfBank(a, sp);
          if (this.insideSolid(a, sp)) this.relocate(a, sp, false, true);
          if (sp.kind !== 'egg') this.inGlass(a, sp);                    // (again: the pushes above may not take it through the glass)
        }
      }
    }
    // Food flakes drift and sink, then settle.
    for (const f of this.food) {
      const g = W.terrain.heightAt(f.pos.x, f.pos.z) + 0.1;
      if (f.pos.y > g) {
        f.pos.y -= f.sink * dt * (f.age < (f.float ?? 20) ? 0.15 : 1);
        f.pos.x += Math.sin(this.t + f.sink * 40) * dt * (f.kind === 'pellet' ? 0.05 : 0.3);
      } else { f.pos.y = g; f.settled = true; }
      f.age += dt;
    }
    filterDrift(W, this.food, dt); filterAvoid(W, this.all, SPECIES, dt);   // the filter's current (sim/filterflow.js)
    this.draw(dt);
  }


  // Time bookkeeping: `tf` (animal time per real time, 1 … 4) so hops and strikes play in real time at 5x and 20x, and
  // `warp` (game minutes per animal second, measured over about a second of animal time) so that waiting times scale
  // down in fast-forward and an animal does as much per game hour at 60x as at 1x.
  trackTime(dt) {
    const now = performance.now();
    const rt = (now - (this._rt ?? now)) / 1000;
    this._rt = now;
    this.tf = dt > 0 && rt > 0.004 && rt < 0.12 ? clamp(dt / rt, 1, 4) : 1;
    // The camera's velocity in real time (cm/s, smoothed), for camThreat: a lens swooping in is a danger, one that sits or follows is not.
    const cam = this.camera?.position;
    if (cam && rt > 0.004 && rt < 0.25) {
      const p = (this._camP ??= cam.clone()), v = (this.camVel ??= cam.clone().set(0, 0, 0)), k = Math.min(1, rt * 8);
      // A jump of more than 15 cm in one frame is a cut or a view jump, not a lens swooping in: no velocity, and a second's grace.
      if (p.distanceTo(cam) > 15) { this.camCutT = 1; v.set(0, 0, 0); }
      else { v.x += ((cam.x - p.x) / rt - v.x) * k; v.y += ((cam.y - p.y) / rt - v.y) * k; v.z += ((cam.z - p.z) / rt - v.z) * k; }
      p.copy(cam);
    } else if (cam) this._camP = cam.clone();
    if (this.camCutT > 0) this.camCutT -= Math.min(Math.max(rt, 0), 0.25);
    if (!(dt > 0)) return;
    const E = this.world.env;
    this._wDt = (this._wDt ?? 0) + dt;
    this._wM0 ??= E.minute;
    if (this._wDt >= 1) {
      this.warp = clamp((E.minute - this._wM0) / this._wDt, 1, 40);
      this._wDt = 0; this._wM0 = E.minute;
    }
  }

  // --- Occupancy: keep animals out of roots and wood, and unstick them -------------------------------------------------
  // Rebuild the occupancy grid when a piece was added, moved or removed (at most four times a second).
  syncOccupancy(force = false) {
    const D = this.world.decor;
    if (!D) return;
    let stale = this.occ.stale(D);
    if (!stale && this.t - this._occSigT > 1) {
      this._occSigT = this.t;
      stale = Occupancy.signature(D) !== this.occ.sig;       // a piece that was dragged without a version bump
    }
    if (!stale) return;
    const now = performance.now();
    if (!force && now - this._occWall < 250) return;
    this._occWall = now;
    this.occ.rebuild(D, PIECES);
  }

  // The water surface where a fish is (-Infinity when there is no water there).
  waterTop(x, z) {
    const s = this.world.water.surfaceAt(x, z, 0.3);
    return Number.isFinite(s) ? s : -Infinity;
  }

  // The height at which a walker's body is tested against the occupancy grid.
  bodyY(a, sp) { return sp.kind === 'swim' || a.swimming ? a.pos.y : a.pos.y + 0.5; }
  insideSolid(a, sp) {
    if (a.onWall || a.hop || a.wallMode) return false;
    const x = a.pos.x, y = this.bodyY(a, sp), z = a.pos.z, swim = sp.kind === 'swim' || a.swimming, h = Math.max(0.2, a.bh ?? 0.5);
    if (swim ? !this.occ.solidAt(x, y, z) : !this.occ.solidAt(x, a.pos.y + Math.min(0.5, h * 0.5), z) && !this.occ.solidAt(x, a.pos.y + h * 0.8, z)) return false;
    // (in a solid cell: is the body really in the piece? asked again only once it has moved, the rays cost)
    const c = a._ins;
    if (c && c.v === this.occ.version && Math.abs(c.x - x) + Math.abs(c.y - y) + Math.abs(c.z - z) < 0.05) return c.in;
    const r = swim ? this.occ.inside(x, y, z) : this.occ.insideBody(x, a.pos.y, z, h);
    a._ins = { x, y, z, v: this.occ.version, in: r };
    return r;
  }

  // Keeps the whole body in front of the background relief: the far end of its capsule (or its circle) and its radius, at the
  // height of its body, not only its middle (a crab walking sideways along the back put its legs into the wall). Swimmers too.
  clearOfWall(a, sp) {
    const swim = sp.kind === 'swim' || a.swimming, need = this.wallNeed(a, a.pos.x, a.pos.y, a.pos.z, a.yaw, swim);
    if (need > 0) {
      a.pos.z += need;
      if (!swim) a.pos.y = Math.max(a.pos.y, this.world.terrain.heightAt(a.pos.x, a.pos.z) - 0.3);
    }
  }

  // How far a body at (x, y, z) facing `yaw` would have to come forward to be clear of the relief (clearOfWall; hopCheck asks it
  // of a landing, so a frog does not land where it is then pushed off a ledge).
  wallNeed(a, x, y, z, yaw, swim) {
    const Wl = this.world.wall, T = this.world.terrain, r = a.rad ?? 0.4;
    let wx = x, zmin = z;
    if (a.cap) {
      const fx = Math.sin(yaw ?? 0), fz = Math.cos(yaw ?? 0);
      for (const t of [a.cap.zc - a.cap.hl, a.cap.zc + a.cap.hl]) { const zt = z + fz * t; if (zt < zmin) { zmin = zt; wx = x + fx * t; } }
    }
    // (at its feet and at the top of its back: the relief is not flat, and a small walker hugs it at either height)
    const y0 = swim ? y - (a.bh ?? 0.5) * 0.5 : Math.max(y, T.heightAt(x, z)) + 0.1, y1 = y0 + Math.max(0.3, a.bh ?? 1);
    return Math.max(Wl.zAt(wx, y0), Wl.zAt(wx, y1)) + Math.max(0.3, r * 0.9) - zmin;
  }

  // The drawn body's box at its size (util/contain.js): half its width with the legs out, its tail and snout ends along its heading,
  // its height. Before its mesh is measured: a round body of its radius. (A shared object: read it before the next call.)
  bodyBox(a, sp) {
    // (a swimming frog is drawn in its swimming-pose model, hind legs stretched out behind)
    const b = (a.swimming && !a.hop && (sp.kind === 'frog' || sp.kind === 'toad') && this.meshes?.[`${a.sp}#swim`] && this.bodyOf(`${a.sp}#swim`)) || this.bodyOf(a.sp), sc = drawScale(a, sp);
    if (!b) { const r = a.rad ?? this.radiusOf(a, sp); _bb.X = r; _bb.z0 = -r; _bb.z1 = r; _bb.H = r; return _bb; }
    _bb.X = (b.hw / 0.6) * sc; _bb.z0 = (b.zc - b.hlen) * sc; _bb.z1 = (b.zc + b.hlen) * sc; _bb.H = b.hh * sc;
    return _bb;
  }

  // The frame its body is drawn in (as draw() turns it): belly to the background, the glass or a leaf, or by heading and pitch.
  frameOf(a) {
    const N = a.wallMode || (a.perch && a.perch.ph !== 'go') ? a.normal : null;
    return N ? surfaceFrame(N.x, N.y, N.z, a.yaw ?? 0, _fr) : pitchFrame(a.pitch ?? 0, a.yaw ?? 0, _fr);
  }

  // Never beyond the glass: the whole drawn body, turned as it is drawn, inside the inner glass box (not only its middle: a frog
  // facing the front glass at the edge of the ground had its head through it, one in a corner its flank). A walker moved in from
  // the glass stands on the ground there; a gecko on the background stays on it.
  inGlass(a, sp) {
    const d = glassPush(a.pos.x, a.pos.y, a.pos.z, this.frameOf(a), this.bodyBox(a, sp), TANK.w / 2, TANK.d / 2, TANK.h, 0.1, _gp);
    if (!d[0] && !d[1] && !d[2]) return false;
    const Wl = this.world.wall, z0 = a.wallMode ? Wl.zAt(a.pos.x, a.pos.y) : 0;
    a.pos.x += d[0]; a.pos.y += d[1];
    if (a.wallMode) a.pos.z += Wl.zAt(a.pos.x, a.pos.y) - z0;            // (along the relief, as far off it as it was)
    else a.pos.z += d[2];
    if (!a.wallMode && !a.onWall && !a.hop && !a.perch && !a.swimming && sp.kind !== 'swim' && sp.kind !== 'fly') a.pos.y = this.world.terrain.heightAt(a.pos.x, a.pos.z);
    return true;
  }

  // Is there room for a perching frog's body at a perch top: inside the glass and in front of the background relief all round it,
  // whichever way it turns while it sits (its reach from its middle, a circle), at its feet and at the top of its back. A leaf by
  // the background had the frog sitting half inside the relief.
  // Clinging to a stem (N, its outward normal): head up, its hind end may not reach into the ground.
  perchFits(a, sp, top, N = null, yaws = null) {
    const bx = this.bodyBox(a, sp), R = Math.max(bx.X, -bx.z0, bx.z1) + 0.1, H = bx.H, Wl = this.world.wall;
    if (Math.abs(top.x) > TANK.w / 2 - R || Math.abs(top.z) > TANK.d / 2 - R || top.y + H > TANK.h - 0.2) return false;
    for (const dy of [0, H]) for (const dx of [-R, 0, R]) if (top.z - R < Wl.zAt(top.x + dx, top.y + dy) + 0.15) return false;
    // and clear of the ground all round (a stem by a raised bank had the frog half inside the bank)
    const T = this.world.terrain;
    if (N) {
      // Clinging to a stem: every corner and edge of its box as it clings (head up, or turned by `yaws` as it shuffles round on it while
      // it sits, perchFrog), above the ground there (five points round the perch missed a bank beside the stem's foot).
      const zm = (bx.z0 + bx.z1) / 2;
      for (const yaw of yaws ?? [clingYaw(N)]) {
        const f = surfaceFrame(N.x, N.y, N.z, yaw, _fr);
        for (const u of [-bx.X, 0, bx.X]) for (const v of [bx.z0, zm, bx.z1]) for (const w of [0, H]) {
          const x = top.x + f[3] * u + f[0] * v + f[6] * w, y = top.y + f[4] * u + f[1] * v + f[7] * w, z = top.z + f[5] * u + f[2] * v + f[8] * w;
          if (y < T.heightAt(x, z) + 0.2) return false;
        }
      }
      return true;
    }
    for (const [dx, dz] of [[0, 0], [R, 0], [-R, 0], [0, R], [0, -R]]) if (top.y < T.heightAt(top.x + dx, top.z + dz) + 0.2) return false;
    return true;
  }

  // A gecko on the background lies on the plane through the relief under its four feet (as footing() does on the ground), not on
  // the slope under its middle: the gradient of one cell of the relief rocked it as it walked. The plane's normal is held through
  // small changes and turns at most 5 rad/s (util/contain.js steadyNormal), and the body stands that plane's height off the relief.
  wallFrame(a, sp, dt) {
    const Wl = this.world.wall, b = this.bodyOf(a.sp), sc = drawScale(a, sp);
    const n0 = a.normal ?? V(0, 0, 1), f = surfaceFrame(n0.x, n0.y, n0.z, a.yaw ?? 0, _fr);
    const zc = b ? b.zc * sc : 0, fore = b ? zc + b.hlen * sc * 0.5 : 0.8, hind = b ? zc - b.hlen * sc * 0.45 : -0.8, side = b ? (b.hw / 0.6) * sc * 0.75 : 0.6;
    const foot = (al, ac) => { const x = a.pos.x + f[0] * al + f[3] * ac, y = a.pos.y + f[1] * al + f[4] * ac; return [x, y, Wl.zAt(x, y)]; };
    const F = foot(fore, 0), B = foot(hind, 0), R = foot(0, side), L = foot(0, -side);
    const pl = feetPlane(F, B, R, L, [0, 0, 1]);
    const zMid = Wl.zAt(a.pos.x, a.pos.y);
    let want = null, z = zMid;
    if (pl && pl.n[2] > 0.25) {
      want = pl.n;
      // that plane, moved out until each foot is on the relief
      const zp = (x, y) => pl.p[2] - (pl.n[0] * (x - pl.p[0]) + pl.n[1] * (y - pl.p[1])) / pl.n[2];
      let lift = zMid - zp(a.pos.x, a.pos.y) - 0.2;                    // (its middle may press into a bump a little, as its belly would)
      for (const q of [F, B, R, L]) lift = Math.max(lift, q[2] - zp(q[0], q[1]));
      z = zp(a.pos.x, a.pos.y) + Math.max(0, lift);
    } else { const [gx, gy] = Wl.field.gradient(a.pos.x, a.pos.y); const l = Math.hypot(gx, gy, 1); want = [-gx / l, -gy / l, 1 / l]; }
    a._wn = steadyNormal(a._wn, want, dt);
    a.pos.z = z + 0.12;                                                  // (its feet on the relief, not 0.35 cm off it)
    a.normal = V(a._wn.n[0], a._wn.n[1], a._wn.n[2]);
  }

  // A climber's drawn frame turns smoothly: onto the background or the glass, up a stem, over the lip of a leaf, and back onto the
  // ground, at most 5 rad/s and easing in (util/contain.js easeAngle), rather than in one frame. Off its climb it follows its frame
  // exactly again once it has caught up, so walking and turning on the ground are untouched.
  steadyFrame(a, q, dt, climbing) {
    const c = a._cq;
    if (!c) { a._cq = q.clone(); return; }
    if (!climbing && !a._cqOn) { c.copy(q); return; }
    const ang = c.angleTo(q);
    if (ang > 1e-5) c.rotateTowards(q, easeAngle(ang, dt));
    q.copy(c);
    a._cqOn = climbing || ang > 0.02;
  }

  // The ground is solid too: a walker does not step onto a face of the ground steeper than it can stand on (the cliff of a raised
  // bank: it was drawn tipped on its side with half its body in the bank), nor push its nose into one. It stays where it was; its
  // walk then turns or gives up as it does at a rock. Off such a face it may always step.
  // (A gecko climbs: steep ground is a surface to it, drawn on the plane under its feet.)
  cliffAt(x, z) { const [gx, gz] = this.world.terrain.field.gradient(x, z); return gx * gx + gz * gz > 3; }      // (ground normal y < 0.5)
  offCliff(a, sp, px, py, pz) {
    if (a.hop || a.perch || a.onWall || a.wallMode || a.swimming || sp.kind === 'gecko' || a.relocT === this.t) return;
    const T = this.world.terrain, bx = this.bodyBox(a, sp), ux = Math.sin(a.yaw ?? 0), uz = Math.cos(a.yaw ?? 0), nose = bx.z1 * 0.8;
    const bad = (x, z) => this.cliffAt(x, z) || this.cliffAt(x + ux * nose, z + uz * nose);
    if ((a.pos.x !== px || a.pos.z !== pz) && bad(a.pos.x, a.pos.z) && !bad(px, pz)) { a.pos.set(px, py, pz); return; }
    // Standing on a cliff face however it got there (put there, the ground dug or raised under it): it slides down off it.
    if (this.cliffAt(a.pos.x, a.pos.z) && sp.kind !== 'crab') {
      const [gx, gz] = T.field.gradient(a.pos.x, a.pos.z), l = Math.hypot(gx, gz), nx = a.pos.x - gx / l * 0.3, nz = a.pos.z - gz / l * 0.3;
      // (a frog does not slide off into water deeper than half its body: it scrambles to a place it can sit instead, frogOut)
      if ((sp.kind === 'frog' || sp.kind === 'toad') && this.tooDeep(a, sp, nx, nz)) { this.frogOut(a, sp); return; }
      if ((this.okFor(this.mediumOf(sp), nx, nz, 99) || this.okFor('any', nx, nz, 99)) && this.depthOkFor(a, sp, nx, nz)) { a.pos.x = nx; a.pos.z = nz; a.pos.y = T.heightAt(nx, nz); }
      return;
    }
  }

  // Its snout, tail or a flank inside a bank of the ground (a tail swung into it as it turned at the foot, a frog landed or swimming
  // against it): the ground at the ends of its body stands above the plane it stands on (footing: a slope it stands on is fine) by
  // more than half its height. It steps away from those points, 0.3 cm a tick, to where it is free. (Not a crab in the pit it digs, nor
  // a body boxed in on all sides: a burrow. A crab anywhere else does: one going for water at the foot of a cliff stood with its back
  // half in it for minutes.)
  outOfBank(a, sp) {
    if (a.hop || a.perch || a.onWall || a.wallMode) return;
    if (sp.kind === 'crab' && a.home && Math.hypot(a.home.x - a.pos.x, a.home.z - a.pos.z) < BURROW.r * 1.4 && pitDepth(this.world.terrain.field, a.home.x, a.home.z) > 0.3) return;
    // (a frog wedged in a crevice narrower than itself, banks higher than its body at its ends, climbs out: frogOut)
    const frog = (sp.kind === 'frog' || sp.kind === 'toad') && !a.swimming;
    if (frog && !this.sitFits(a, sp, a.pos.x, a.pos.y, a.pos.z, a.yaw ?? 0, false)) this.frogOut(a, sp);
    const T = this.world.terrain, bx = this.bodyBox(a, sp), X = bx.X * 0.8, z0 = bx.z0 * 0.85, z1 = bx.z1 * 0.85, H = bx.H;
    const fx = Math.sin(a.yaw ?? 0), fz = Math.cos(a.yaw ?? 0), x0 = a.pos.x, z0w = a.pos.z;
    const ft = a.swimming ? null : this.footing(a, sp);
    const y0 = a.pos.y + (ft ? ft.dy : 0), up = ft?.up;
    const plane = (x, z) => (up ? y0 - (up.x * (x - x0) + up.z * (z - z0w)) / up.y : y0);
    // (how deep its snout, tail and flanks are in banks, standing there facing (ux, uz); mx, mz: the way away from them)
    let mx = 0, mz = 0, n = 0;
    // (a tail lies on the ground from the hips back, groundBend: on a steep footing plane, a gecko with its fore feet up a bank, the
    // plane drawn on behind the hips lay far under the ground and the tail counted as in a bank, which pushed it into the bank ahead)
    const hips = TAILED.has(sp.kind) ? (this.bodyOf(a.sp)?.feet?.hind ?? 0) * drawScale(a, sp) : null;
    const bank = (ux, uz, away) => {
      let d = 0, i = 0;
      for (const [ox, oz] of [[ux * z1, uz * z1], [ux * z0, uz * z0], [uz * X, -ux * X], [-uz * X, ux * X]]) {
        const tail = i++ === 1 && hips != null, px = x0 + ox, pz = z0w + oz;
        // (and lies up a gentle rise behind it, its tip lifted, groundBend: only ground rising more steeply than about 20 degrees is a bank)
        const e = T.heightAt(px, pz) - (tail ? Math.max(plane(px, pz), plane(x0 + ux * hips, z0w + uz * hips)) + Math.max(H * 0.5, -z0 * 0.4) : plane(px, pz) + H * 0.5);
        if (e > 0) { d += e; if (away) { mx -= ox; mz -= oz; n++; } }
      }
      return d;
    };
    const d0 = bank(fx, fz, true);
    if (!n) return;
    // Boxed in on all sides (a burrow, for a crab or a newt), or no step out: a frog in a crevice narrower than itself climbs out.
    if (n === 4) { if (frog) this.frogOut(a, sp); return; }
    const l = Math.hypot(mx, mz), ux = l < 1e-6 ? 0 : mx / l, uz = l < 1e-6 ? 0 : mz / l;
    // A long body in a gully, its snout in the bank ahead and its tail in the one behind, stepped back and forth every tick for minutes
    // (each step only put its other end in): it turns where it stands instead, toward the heading with less of it in the banks.
    const prev = a._oob, back = !!prev && this.t - prev.t < 0.15 && ux * prev.x + uz * prev.z < -0.5;
    if (TAILED.has(sp.kind) && (l < 1e-6 || back)) {
      let best = d0 - 1e-3, turn = 0;
      for (const dy of [0.1, -0.1]) { const y = (a.yaw ?? 0) + dy, d = bank(Math.sin(y), Math.cos(y), false); if (d < best) { best = d; turn = dy; } }
      if (turn) a.yaw = (a.yaw ?? 0) + turn;
      return;
    }
    const nx = x0 + ux * 0.3, nz = z0w + uz * 0.3;
    if (l < 1e-6 || Math.abs(nx) > TANK.w / 2 - 0.5 || Math.abs(nz) > TANK.d / 2 - 0.5 || (!a.swimming && this.cliffAt(nx, nz)) || (this.occ.count && this.occ.solidAt(nx, T.heightAt(nx, nz) + 0.5, nz))
      || (!a.swimming && !((this.okFor(this.mediumOf(sp), nx, nz, 99) || this.okFor('any', nx, nz, 99)) && this.depthOkFor(a, sp, nx, nz)))
      || (frog && this.tooDeep(a, sp, nx, nz))) { if (frog) this.frogOut(a, sp); return; }   // (not pushed off into deep water: it scrambles out)
    a.pos.x = nx; a.pos.z = nz;
    if (!a.swimming) a.pos.y = T.heightAt(nx, nz);
    a._oob = { t: this.t, x: ux, z: uz };
  }

  // Water depth at (x, z) (-Infinity dry), and whether a land salamander may go there from where it is (placement.js depthOk, N9s).
  wDepth(x, z) { return this.world.water.surfaceAt(x, z) - this.world.terrain.heightAt(x, z); }
  depthOkFor(a, sp, nx, nz) { const cap = depthCap(HABITAT[a.sp], sp.kind); return cap >= 99 || depthOk(cap, this.wDepth(a.pos.x, a.pos.z), this.wDepth(nx, nz)); }

  // Water at (x, z) deeper than half a frog's body: what a poison frog, a toad or a tree frog does not wade into (nor is pushed into).
  tooDeep(a, sp, x, z) {
    return this.world.water.surfaceAt(x, z, 0.2) - this.world.terrain.heightAt(x, z) > 0.5 * this.bodyBox(a, sp).H;
  }

  // A frog wedged where it cannot sit (a crevice between stones narrower than its body, where it was put or fell): once a second it
  // looks for the nearest place it can sit (sitFits) within 8 cm and scrambles up onto it, as a frog climbs out of a gap.
  frogOut(a, sp) {
    if (a.hop || a.perch || (a.outT ?? -1) > this.t) return;
    a.outT = this.t + 1;
    const W = this.world, T = W.terrain;
    for (let r = 2; r <= 8; r += 1.5) {
      for (let k = 0; k < 12; k++) {
        const ang = (k / 12) * TAU + r, x = a.pos.x + Math.sin(ang) * r, z = a.pos.z + Math.cos(ang) * r;
        if (Math.abs(x) > TANK.w / 2 - 2 || Math.abs(z) > TANK.d / 2 - 2 || W.water.surfaceAt(x, z, 0.3) !== -Infinity) continue;
        const y = T.heightAt(x, z), rise = y - a.pos.y;
        if (rise > 6 * sp.size || T.normalAt(x, z).y < 0.6 || !this.sitFits(a, sp, x, y, z, ang) || this.stemDepth(a, x, y, z, ang) > 0.02
          || (this.occ.count && this.occ.solidAt(x, y + 0.5, z)) || this.wallNeed(a, x, y, z, ang, false) > 0.05) continue;
        this.startHop(a, V(x, y, z), 0.5 + r * 0.25 + Math.max(0, rise));
        return;
      }
    }
  }

  // Is it plausible that this animal is trying to get somewhere right now?
  wantsMove(a, sp = SPECIES[a.sp]) {
    if (a.rest?.resting) return false;                          // (a tadpole at rest on the floor is not stuck: swim() holds it still)
    if (a.dead || a.hop || a.onWall || a.stranded) return false;
    switch (sp.kind) {
      case 'swim': return true;
      case 'crawlWater': case 'crawlLand': case 'crab': return a.state === 'walk' && !!a.target && Math.hypot(a.target.x - a.pos.x, a.target.z - a.pos.z) > 0.5;   // (there: not stuck)
      // (a frog resting at the surface or sitting on the bottom means to be still: taken for stuck, a floating toad was put ashore)
      case 'frog': case 'toad': return (a.hopFail ?? 0) >= 1 || (!!a.swimming && !!a.shore && !a.floating && a.dive?.ph !== 'sit');
      case 'newt': case 'axolotl': return a.herp ? !!a.wantMove : a.swimming ? true : a.state === 'walk' && !!a.target;
      case 'fly': return a.state === 'walk' && !!a.target;
    }
    return false;
  }

  // Per animal and tick: a body inside a solid cell is moved out; one that wants to move but has hardly moved
  // for several seconds backs off and picks a new target, and as a last resort jumps to the nearest free cell.
  keepFree(a, sp, dt) {
    if (a.dead || (a.perch && a.perch.ph !== 'go')) return;          // a reed frog climbing, sitting on or leaving its perch
    // Ground that rose under a walker (a piece was dropped on it, erosion): stand on it again.
    if (sp.kind !== 'swim' && !a.onWall && !a.hop && !a.wallMode) {
      const g = this.world.terrain.heightAt(a.pos.x, a.pos.z);
      if (a.pos.y < g - 0.3) a.pos.y = g;
    }
    if (this.insideSolid(a, sp)) { this.stuckStats.inside = (this.stuckStats.inside ?? 0) + 1; const by = this.stuckStats.by ??= {}; by[a.sp] = (by[a.sp] ?? 0) + 1; this.relocate(a, sp, false, true); return; }
    if (sp.kind === 'egg') return;
    if (freeWalledIn(this, a, sp, dt)) return;                    // N11c: walled in by solid cells (walledin.js)
    if (!this.wantsMove(a, sp)) { a.stillT = 0; a.anchor = null; return; }
    if (!a.anchor) { a.anchor = a.pos.clone(); a.stillT = 0; return; }
    if (a.pos.distanceTo(a.anchor) > 0.25 + 0.1 * sp.size) { a.anchor.copy(a.pos); a.stillT = 0; return; }
    a.stillT = (a.stillT ?? 0) + dt;
    this.stuckStats.worst = Math.max(this.stuckStats.worst, a.stillT);
    if (a.stillT < 3.5) return;
    // Stuck.
    this.stuckStats.unstuck++;
    const recent = this.t - (a.lastStuck ?? -1e9) < 25;
    a.lastStuck = this.t;
    a.stuckLevel = recent ? (a.stuckLevel ?? 0) + 1 : 1;
    a.stillT = 0; a.anchor = null;
    if (a.stuckLevel >= 2) { this.relocate(a, sp); return; }
    // Back off: away from the nearest free space's opposite, i.e. toward free space, and choose again.
    const nf = this.occ.count ? this.occ.nearestFree(a.pos.x, this.bodyY(a, sp), a.pos.z, null, 4) : null;
    const ang = nf && (nf[0] !== a.pos.x || nf[2] !== a.pos.z) ? Math.atan2(nf[0] - a.pos.x, nf[2] - a.pos.z) : Math.random() * Math.PI * 2;
    a.target = null; a.shore = null; a.hop = null; a.timer = 0; a.hopFail = 0; a.fs = null; this.dropStrike(a);
    a.wander = ang; a.side = -(a.side ?? 1);
    // A swimmer swings round to its new course (its heading follows the velocity through turnTo); a walker, nudged aside
    // below, faces the free way at once.
    if (!(sp.kind === 'swim' || a.swimming)) a.yaw = ang;
    if (sp.kind === 'swim' || a.swimming) {
      a.vel.set(Math.sin(ang), 0, Math.cos(ang)).multiplyScalar(sp.speed);
      a.home = this.randomWater(2) ?? a.home;
    } else {
      a.state = 'idle';
      const nx = a.pos.x + Math.sin(ang) * 0.8, nz = a.pos.z + Math.cos(ang) * 0.8;
      if (this.okFor(this.mediumOf(sp), nx, nz)) { a.pos.x = nx; a.pos.z = nz; }
    }
  }

  // --- Turning (util/turn.js, util/bodyplan.js: docs/SKELETON.md) ---------------------------------------------------------------
  // How a species turns: its body plan's pivot (the hips of a frog, salamander or lizard; the middle of a crab or an insect), the
  // distance of its farthest foot from it and its fastest yaw, measured on the drawn mesh (the plan's numbers until it has arrived).
  turnFrameOf(id) {
    const sp = SPECIES[id], m = this.meshes?.[id], geo = (m?._lo ?? m)?.geometry ?? null;
    const c = (this._turnF ??= {})[id];
    if (c && c.geo === geo) return c;
    const b = geo ? this.bodyOf(id) : null;
    const f = geo ? limbFrame(geo.attributes.position.array, geo.attributes.rig?.array ?? null) : null;
    return (this._turnF[id] = { ...turnFrame(PLANS[planOf(sp)], f, sp.anim?.stride ?? 0, b?.tc ?? 0), geo, span: b?.span ?? 0 });
  }

  // How far the feet travel a radian of yaw (cm, world): the frame's R, or half the leg span of an animal without four walking legs.
  turnRadius(a, sp) {
    const tf = this.turnFrameOf(a.sp);
    return (tf.legs ? tf.R : Math.max(tf.span, a.rad ?? 0.3)) * drawScale(a, sp);
  }

  // Turns toward heading `want` the way the animal can (util/turn.js turnStep): no faster than its legs step round (swimming: its
  // body bends round), easing in, and on the ground about its pivot, which stays where it is (`pivot` false: about the origin).
  // Returns the new yaw.
  turnTo(a, sp, want, dt, gain = 8, pivot = true) {
    const tf = this.turnFrameOf(a.sp), st = (a.turnSt ??= { w: 0, t: -1 });
    if (this.t - st.t > 0.3) st.w = 0;           // a new turn starts from rest
    st.t = this.t;
    const swim = a.swimming || sp.kind === 'swim';
    let rate = tf.maxRate * (swim && tf.legs ? 1.5 : 1);
    if (a.dart || a.hm?.mode === 'flee' || a.sk?.mode === 'flee') rate *= 1.8;      // an escape: the legs (or the tail) at full tilt
    const y0 = a.yaw ?? 0;
    a.yaw = turnStep(y0, want, dt, rate, st, gain);
    if (pivot && tf.legs && tf.pz && !swim && !a.hop && !a.wallMode && !a.onWall) {
      const [dx, dz] = pivotShift(y0, a.yaw, tf.pz, drawScale(a, sp));
      const nx = a.pos.x + dx, nz = a.pos.z + dz;
      if (!(this.avoid && this.occ.count && this.occ.solidAt(nx, this.bodyY(a, sp), nz)) && this.depthOkFor(a, sp, nx, nz)) { a.pos.x = nx; a.pos.z = nz; a.pivotMoved = (a.pivotMoved ?? 0) + Math.hypot(dx, dz); }
    }
    return a.yaw;
  }

  // The turn's pose, once a step (move()): the yaw rate (smoothed), the legs' turning mix and the spine's bend, head lead and tail
  // lag (util/turn.js turnPose), inside the body plan's joint limits. draw() hands them to the rig.
  turnPoseStep(a, sp, dyaw, tau, dtR) {
    if (!(dtR > 0)) return;
    const tf = this.turnFrameOf(a.sp);
    a.turnW = (a.turnW ?? 0) + (dyaw / dtR - (a.turnW ?? 0)) * Math.min(1, dtR / 0.12);
    a.turnMix = (a.turnMix ?? 0) + (tau - (a.turnMix ?? 0)) * Math.min(1, dtR / 0.03);
    if (!tau && Math.abs(a.turnMix) < 1e-3) a.turnMix = 0;
    a.turnPose = turnPose(tf.plan, a.turnW, tf.maxRate, dtR, (a.turnPs ??= {}));
  }

  mediumOf(sp) {
    switch (sp.kind) {
      case 'crawlWater': case 'axolotl': return 'water';
      case 'crawlLand': return sp.surface ? 'surface' : 'land';
      case 'frog': case 'toad': case 'gecko': case 'fly': return 'land';
      case 'newt': return sp.landBias >= 0.5 ? 'land' : 'any';       // (the fire salamander: relocate must not pick another pool cell)
      default: return 'any';
    }
  }

  // Last resort: the nearest free cell that suits the animal; when that is where it already is (a pool or an
  // island too small to leave) or it keeps happening, a random free spot of the right kind.
  relocate(a, sp, far = a.stuckLevel >= 3, inside = false) {
    const W = this.world, T = W.terrain, occ = this.occ;
    const from = a.pos.clone();
    this.stuckStats.relocated++;
    a.relocT = this.t;                                                         // (offCliff must not put it back this tick)
    a.stillT = 0; a.anchor = null; a.target = null; a.shore = null; a.hop = null; a.hopFail = 0;
    a.timer = 0; a.state = 'idle'; a.vel.set(0, 0, 0); a.fs = null; this.dropStrike(a); a.crouch = 0; a.chain = 0;
    const swimmer = sp.kind === 'swim' || (a.swimming && sp.kind !== 'frog' && sp.kind !== 'toad');
    if (!swimmer) a.swimming = false;
    const fly = false;                                                         // (fruit flies walk: placed like any land crawler)
    const wx = TANK.w / 2 - 2, wz = TANK.d / 2 - 2;
    const okSwim = (x, y, z) => {
      const f = T.heightAt(x, z), L = this.waterTop(x, z);
      return L - f >= 1.6 && y >= f + 0.6 && y <= L - 0.6 && Math.abs(x) < wx - 0.5 && Math.abs(z) < wz - 0.5;
    };
    const okFly = (x, y, z) => y > Math.max(T.heightAt(x, z), this.waterTop(x, z)) + 1.2 && y < TANK.h - 3 && Math.abs(x) < wx && Math.abs(z) < wz;
    if (swimmer || fly) {
      const ok = fly ? okFly : okSwim;
      // (stuck, not inside: the nearest free water at least 2 cm away; it used to be a random spot anywhere in the tank)
      const minD = inside ? 0 : far ? 4 : 2, okAway = minD ? (x, y, z) => ok(x, y, z) && Math.hypot(x - from.x, y - from.y, z - from.z) >= minD : ok;
      let to = occ.nearestFree(a.pos.x, a.pos.y, a.pos.z, okAway, 14);
      for (let k = 0; k < 250 && !to; k++) {
        const x = (Math.random() - 0.5) * (TANK.w - 6), z = (Math.random() - 0.5) * (TANK.d - 6);
        if (fly) {
          const y = Math.max(T.heightAt(x, z), this.waterTop(x, z)) + 2 + Math.random() * 6;
          if (okFly(x, y, z) && !occ.solidAt(x, y, z)) to = [x, y, z];
        } else if (this.waterTop(x, z) - T.heightAt(x, z) >= 1.7) {
          const f = T.heightAt(x, z), y = lerp(f, this.waterTop(x, z), 0.3 + Math.random() * 0.4);
          if (okSwim(x, y, z) && !occ.solidAt(x, y, z)) to = [x, y, z];
        }
      }
      if (to) { a.pos.set(to[0], to[1], to[2]); a.home = a.pos.clone(); a.wander = Math.random() * 6.28; }
      return;
    }
    const medium = this.mediumOf(sp);
    const free = (x, z) => this.okFor(medium, x, z) && !occ.solidAt(x, T.heightAt(x, z) + 0.5, z) && !(CORE_WALKERS.has(sp.kind) && this.cliffAt(x, z));
    let best = null;
    for (let r = far ? 4.5 : 1.5; r <= 30 && !best; r += 1.5) {           // (stuck again and again: a little further, not anywhere in the tank)
      const n = Math.ceil(r * 2.4);
      for (let k = 0; k < n; k++) {
        const ang = (k / n) * Math.PI * 2;
        const x = a.pos.x + Math.sin(ang) * r, z = a.pos.z + Math.cos(ang) * r;
        if (free(x, z)) { best = [x, z]; break; }
      }
    }
    for (let k = 0; k < 300 && !best; k++) {
      const x = (Math.random() - 0.5) * (TANK.w - 4), z = (Math.random() - 0.5) * (TANK.d - 4);
      if (free(x, z)) best = [x, z];
    }
    if (best) { a.pos.x = best[0]; a.pos.z = best[1]; a.pos.y = T.heightAt(best[0], best[1]); a.home = a.pos.clone(); }
  }

  // A heading (radians) that is free of solids for the next `reach` cm from (x, y, z), nearest to `want`.
  freeHeading(x, y, z, want, reach, ok = null) {
    const occ = this.occ;
    for (const da of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.3, -2.3]) {
      const h = want + da, dx = Math.sin(h), dz = Math.cos(h);
      let free = true;
      for (let d = reach * 0.4; d <= reach; d += reach * 0.3) {
        if (occ.solidAt(x + dx * d, y, z + dz * d) || (ok && !ok(x + dx * d, y, z + dz * d))) { free = false; break; }
      }
      if (free) return h;
    }
    return null;
  }

  // ctl: { x, y, z, speed } steers it to that point instead of wandering (a salamander's or newt's mind, herp.js).
  swim(a, sp, arr, dt, ctl = null) {
    const W = this.world, T = W.terrain;
    const L = this.waterTop(a.pos.x, a.pos.z);
    const floor = T.heightAt(a.pos.x, a.pos.z);
    if (!(L - floor >= 1.2)) {
      // Stranded: flop and suffocate.
      a.stranded = true;
      a.pos.y = floor + 0.3;
      a.pitch = Math.PI / 2 * Math.sin(this.t * 12 + a.phase) * 0.3;
      return;
    }
    a.stranded = false;
    // A tadpole rests on the floor between swim bouts, wakes and flees from a threat, and still feeds (sim/swimrest.js).
    const env = this.world.env, RP = sp === SPECIES.larva ? LARVA_REST : undefined;   // N19: the larva ambushes from the floor
    const R = sp.young && !ctl ? restStep(a, dt, { profile: RP, night: isNight(env.minute, env.lightsOn, env.lightsOff), hungry: a.hunger > 0.25 && this.food.length > 0, foodNear: !!RP && this.food.some((f) => !f.eaten && eatsItem(sp, f) && f.pos.distanceTo(a.pos) < 3), danger: () => this.danger(a, sp, true), bh: a.bh }) : null;
    if (R) a.doing = R.resting ? REST_LABEL : null;
    const desired = V(0, 0, 0);
    a.wander += (Math.random() - 0.5) * dt * 2.5;
    desired.set(Math.sin(a.wander), 0, Math.cos(a.wander)).multiplyScalar(sp.speed * 0.6);
    // The water carries it; where it swims, and so points, is its mind's choice by energy (sim/fishmind.js, sim/currentat.js).
    const FS = this._fs ??= flowSenses((x, z) => this.waterTop(x, z));
    FS.W = W; FS.occ = this.avoid && this.occ.count ? this.occ : null;
    const wv = ctl ? null : FS.probe(a.pos.x, a.pos.y, a.pos.z, a._w ??= { x: 0, y: 0, z: 0 });
    const I = ctl || R?.resting ? null : fishThink(a.fm ??= fishMind(sp, a.phase), FS.sense(a, wv, desired, dt));
    if (I) { desired.set(I.dir?.x ?? 0, 0, I.dir?.z ?? 0).multiplyScalar(sp.speed * 0.6); if (I.label || a.doing === FISH_REST) a.doing = I.label; }
    if (sp.school) {
      const c = V(0, 0, 0), al = V(0, 0, 0), sep = V(0, 0, 0);
      // Keep about 0.7 of a body length between neighbours (a 4 cm corydoras at the old fixed 1.8 cm lay inside its neighbours).
      const len = a.cap ? 2 * (a.cap.hl + a.rad) : sp.size, keep = Math.max(1.8, 0.7 * len);
      let n = 0;
      for (const b of arr) {
        if (b === a) continue;
        const d = b.pos.distanceTo(a.pos);
        if (d > 9) continue;
        n++;
        c.add(b.pos); al.add(b.vel);
        if (d < keep) sep.addScaledVector(a.pos.clone().sub(b.pos), (keep - d) / Math.max(0.1, d));
      }
      if (n) {
        c.divideScalar(n).sub(a.pos).multiplyScalar(0.35);
        al.divideScalar(n).multiplyScalar(0.6);
        desired.add(c).add(al).addScaledVector(sep, 2.5);
      }
    }
    // Food: a dart to the nearest flake, then a short nibble before it is gone.
    const dtS = dt / this.tf;
    a.dart = false;
    if (a.nib) {
      a.nib.t -= dtS;
      if (a.nib.f.eaten) a.nib = null;
      else if (a.nib.t <= 0) { a.nib.f.eaten = true; a.hunger = Math.max(0, a.hunger - FOOD_VALUE[a.nib.f.kind ?? 'flake']); a.ate = (a.ate ?? 0) + 1; a.nib = null; }
    } else if (a.hunger > 0.25 && this.food.length && !ctl) {
      let best = null, bd = 30;
      for (const f of this.food) {
        if (f.eaten || !eatsItem(sp, f)) continue;
        if (sp.band !== 'bottom' && f.settled) continue;
        const d = f.pos.distanceTo(a.pos);
        if (d < bd) { bd = d; best = f; }
      }
      if (best) {
        a.dart = bd < 14;
        desired.copy(best.pos).sub(a.pos).normalize().multiplyScalar(sp.speed * (a.dart ? 2.1 : 1.4));
        if (bd < 1.1) a.nib = { f: best, t: 0.35 + Math.random() * 0.3 };
      }
    }
    // A newt or axolotl swimming after prey it has been ordered to hunt.
    const ot = a.order?.target;
    if (ot && !a.st && !ctl && this.validPrey(ot, a)) desired.copy(ot.pos).sub(a.pos).normalize().multiplyScalar(sp.speed * 1.6);
    // Depth preference.
    const band = sp.band === 'top' ? L - 2.5 : sp.band === 'bottom' ? floor + 1.0 : lerp(floor, L, 0.5);
    if (ctl) { a.nib = null; a.dart = false; desired.set(ctl.x - a.pos.x, ctl.y - a.pos.y, ctl.z - a.pos.z); const dl = desired.length(); desired.multiplyScalar(dl > 1e-4 ? ctl.speed * Math.min(1, dl / 1.5) / dl : 0); }
    else desired.y += (band - a.pos.y) * 0.8;
    // Look ahead for walls, banks and the surface.
    const sp2 = a.vel.lengthSq() > 0.01 ? a.vel.clone().normalize() : V(Math.sin(a.yaw), 0, Math.cos(a.yaw));
    const ahead = a.pos.clone().addScaledVector(sp2, 4);
    const hx = TANK.w / 2 - 1.5, hz = TANK.d / 2 - 1.5;
    const Lh = this.waterTop(ahead.x, ahead.z);
    const blocked = Math.abs(ahead.x) > hx || Math.abs(ahead.z) > hz || T.heightAt(ahead.x, ahead.z) > Math.min(Lh - 1, a.pos.y - 0.3) || !(Lh > -Infinity);
    // Roots and wood: steer round them.
    const occ = this.avoid && this.occ.count ? this.occ : null;
    if (occ && (occ.solidAt(ahead.x, ahead.y, ahead.z) || occ.solidAt(a.pos.x + sp2.x * 2, a.pos.y + sp2.y * 2, a.pos.z + sp2.z * 2))) {
      const okWater = (x, y, z) => this.waterTop(x, z) - T.heightAt(x, z) >= 1.5 && Math.abs(x) < hx && Math.abs(z) < hz;
      const h = this.freeHeading(a.pos.x, a.pos.y, a.pos.z, Math.atan2(sp2.x, sp2.z), 4.5, okWater);
      if (h !== null) {
        desired.set(Math.sin(h), 0, Math.cos(h)).multiplyScalar(sp.speed * 1.4);
        a.wander = h;
      } else {
        desired.set(-sp2.x, 0, -sp2.z).multiplyScalar(sp.speed * 1.4);
        desired.y += (occ.solidAt(a.pos.x, a.pos.y + 2.5, a.pos.z) ? -1 : 1) * sp.speed;
        a.wander = Math.atan2(-sp2.x, -sp2.z) + (Math.random() - 0.5);
      }
    }
    if (blocked) {
      if (a.home.distanceTo(a.pos) < 3 || !W.water.isWater(a.home.x, a.home.z, 2)) a.home = this.randomWater(2) ?? a.home;
      desired.addScaledVector(a.home.clone().sub(a.pos).setY(0).normalize(), sp.speed * 2.5);
      a.wander = Math.atan2(a.home.x - a.pos.x, a.home.z - a.pos.z);
    }
    if (R?.resting) desired.set(0, (floor + R.y - a.pos.y) * 2, 0);                  // sits on the floor, body touching
    else if (R?.flee) { desired.set(R.flee.x, 0, R.flee.z).multiplyScalar(sp.speed * 2); a.wander = Math.atan2(R.flee.x, R.flee.z); a.dart = true; }
    if (a.nib) desired.multiplyScalar(0.1);
    if (I) fishOwn(a.fm, desired, wv, a.dart || I.escape ? I.burst : I.cap, a.dart || blocked || R?.flee ? 1 : I.hold ? 2 : 0, desired);
    // (a swimmer swings round an arc, util/turn.js steerLimit: it does not stop and spin when the way it wants is behind it)
    if (!blocked && !R?.resting) steerLimit(a.vel, desired, ctl ? 1.6 : 1.2, desired);
    a.vel.lerp(desired, Math.min(1, dt * (a.dart || R?.resting || I?.escape ? 4 : 1.8)));
    let maxS = ctl ? Math.max(0.1, ctl.speed * 1.1) : sp.speed * (a.dart ? 2.1 : a.hunger > 0.25 ? 1.5 : 1);
    if (I) maxS = Math.min(a.dart || I.escape ? I.burst : I.cap, maxS + Math.hypot(wv.x, wv.z));
    if (a.vel.length() > maxS) a.vel.setLength(maxS);
    const prev = a.pos.clone();
    a.pos.addScaledVector(a.vel, dt);
    if (wv) { const c = fishCarry(wv, !!R?.resting); a.pos.x += c.x * dt; a.pos.y += c.y * dt; a.pos.z += c.z * dt; }
    a.pos.x = clamp(a.pos.x, -hx - 0.5, hx + 0.5);
    a.pos.z = clamp(a.pos.z, -hz - 0.5, hz + 0.5);
    let f2 = T.heightAt(a.pos.x, a.pos.z), L2 = this.waterTop(a.pos.x, a.pos.z);
    if (!(L2 - f2 >= 1.3)) { a.pos.copy(prev); f2 = T.heightAt(a.pos.x, a.pos.z); L2 = L; }
    a.pos.y = clamp(a.pos.y, f2 + (R?.resting ? R.y : 0.5), Math.max(f2 + 0.6, L2 - 0.5));
    if (occ && occ.solidAt(a.pos.x, a.pos.y, a.pos.z)) {
      // Inside a piece: slide along it on whichever single axis is free, else stay where we were.
      const t = [[a.pos.x, prev.y, prev.z], [prev.x, a.pos.y, prev.z], [prev.x, prev.y, a.pos.z]];
      const hit = t.find(([x, y, z]) => {
        const f = T.heightAt(x, z), Lt = this.waterTop(x, z);
        return !occ.solidAt(x, y, z) && Lt - f >= 1.3 && y >= f + 0.45 && y <= Lt - 0.4;
      });
      if (hit) a.pos.set(hit[0], hit[1], hit[2]); else a.pos.copy(prev);
      a.vel.multiplyScalar(0.3);
      a.wander += (Math.random() < 0.5 ? -1 : 1) * (0.8 + Math.random());
    }
    const hs = Math.hypot(a.vel.x, a.vel.z);
    if (hs > 0.05) this.turnTo(a, sp, Math.atan2(a.vel.x, a.vel.z), dt, 12, false);
    a.pitch = lerp(a.pitch, a.nib ? 0.5 : -Math.atan2(a.vel.y, Math.max(0.3, hs)) * 0.6, Math.min(1, dt * 4));
    a.swimSpeed = a.vel.length();
    if (a.fm && wv) fishAfter(a.fm, a, wv, dt, FS.edge, this.t);
  }

  randomWater(minDepth) {
    const W = this.world;
    for (let k = 0; k < 40; k++) {
      const x = (Math.random() - 0.5) * (TANK.w - 6), z = (Math.random() - 0.5) * (TANK.d - 6);
      if (W.water.isWater(x, z, minDepth)) {
        const g = W.terrain.heightAt(x, z);
        return V(x, lerp(g, W.water.level, 0.5), z);
      }
    }
    return null;
  }

  // Does (x, z) suit a crawler of this medium?
  // `r`: the body's radius (a.rad), kept clear of the background as well as its middle.
  okFor(medium, x, z, maxDepth = 5, r = 0, fine = 0) {
    const W = this.world;
    if (Math.abs(x) > TANK.w / 2 - 1 || Math.abs(z) > TANK.d / 2 - 1) return false;
    const g = W.terrain.heightAt(x, z);
    const s = W.water.surfaceAt(x, z);
    const depth = s - g;
    // (fine: a solid cell the body is not really in is open, as for insideSolid: two newts under one root could not be parted)
    if (this.avoid && this.occ.count && this.occ.solidAt(x, g + 0.5, z) && !(fine && !this.occ.insideBody(x, g, z, fine))) return false;
    if (this.avoid && z < W.wall.zAt(x, g + 1) + Math.max(0.4, r)) return false;       // not into the background relief
    if (medium === 'water') return depth > 1;
    if (medium === 'land') return !(depth > -0.2);
    // The water's surface film and the wet shore (seashore springtails): open water, or land within 3 cm of it.
    if (medium === 'surface') return depth > 0.3 || W.nearWater(V(x, g, z), 3);
    return !(depth > maxDepth);
  }

  // opt: { rest: [min, max] s, restP: chance to pause instead of setting off, speed: multiplier } (salamanders potter and pause).
  crawl(a, sp, dt, medium, opt = null) {
    const W = this.world, T = W.terrain;
    // In the water however it got there (a fall, a push in a crowd): a heavy crawler that cannot swim heads for a way out.
    if (!a.sunk && sp.drowns && medium === 'land' && W.water.surfaceAt(a.pos.x, a.pos.z) > T.heightAt(a.pos.x, a.pos.z) + 0.3) a.sunk = { t: 0, exit: null, look: 0 };
    if (a.sunk) { this.sunkCrawl(a, sp, dt); return; }
    // In the air (a springtail's jump, a cricket's, a fruit fly's flutter) or swimming (a shrimp's bout, its tail flick): carried
    // through to the landing. Rolled up (a panda king): it stays put until the danger has gone.
    if (a.hop?.kind && this.leap(a, sp, dt, medium)) return;
    if (this.startle(a, sp, dt, medium)) return;
    a.timer -= dt;
    if (!a.target || a.timer <= 0) {
      // Between two walks a jumper may jump instead, and a shrimp swim to somewhere else (leap).
      if (!a.hop && (sp.hop || sp.swims) && Math.random() < (sp.swims ? 0.18 : 0.3) && this.takeOff(a, sp, medium, sp.swims ? 'swim' : sp.kind === 'fly' ? 'flutter' : 'jump')) return;
      if (a.state === 'walk' || Math.random() < (opt?.restP ?? 0.4)) {
        a.state = 'rest';
        a.timer = opt ? opt.rest[0] + Math.random() * (opt.rest[1] - opt.rest[0]) : 1 + Math.random() * 4;
        a.target = null;
      } else {
        // Pick a spot; land crawlers prefer moss and damp spots.
        let best = null, bs = -1;
        const r = medium === 'any' ? 14 : 8;
        for (let k = 0; k < 6; k++) {
          const x = a.pos.x + (Math.random() - 0.5) * r * 2, z = a.pos.z + (Math.random() - 0.5) * r * 2;
          if (!this.okFor(medium, x, z)) continue;
          let s = Math.random();
          if (sp.litterLover) s += W.climate.sample(W.climate.litter, x, z) * 5 + W.climate.sample(W.climate.humus, x, z) * 1.5;   // maggots head for rot
          if (medium === 'land') s += T.field.matAt(x, z, MAT.moss) * 1.5 + (W.nearWater(V(x, T.heightAt(x, z), z), 6) ? 0.5 : 0) + this.comfortAt(sp, x, T.heightAt(x, z), z) * 3;
          if (medium === 'any') s += (W.nearWater(V(x, T.heightAt(x, z), z), 4) ? 1 : 0) + this.comfortAt(sp, x, T.heightAt(x, z), z) * 2;
          if (s > bs) { bs = s; best = V(x, 0, z); }
        }
        if (best) { a.target = best; a.state = 'walk'; a.timer = 4 + Math.random() * 6; }
        else { a.timer = 1; a.state = 'rest'; }
      }
    }
    if (a.state === 'walk' && a.target) {
      const d = V(a.target.x - a.pos.x, 0, a.target.z - a.pos.z);
      const dist = d.length();
      if (dist < 0.3) { a.timer = 0; a.state = 'walk'; }
      else {
        d.normalize();
        const step = sp.speed * (opt?.speed ?? 1) * dt * (0.7 + 0.3 * Math.sin(this.t * 6 + a.phase));
        let nx = a.pos.x + d.x * step, nz = a.pos.z + d.z * step;
        let dirx = d.x, dirz = d.z;
        if (this.okFor(medium, nx, nz, 5, a.rad) && !this.bumps(a, nx, nz) && this.occ.walkFree(a, a.pos.x, a.pos.y, a.pos.z, nx, this.world.terrain.heightAt(nx, nz), nz) === 1) { a.pos.x = nx; a.pos.z = nz; a.blockedN = 0; a.blockT = 0; }
        else {
          // Something is in the way: slide round it, trying the side that worked last time first.
          let moved = false;
          if (this.avoid) {
            const sd = a.side ?? 1, base = Math.atan2(d.x, d.z);
            for (const da of [0.7 * sd, -0.7 * sd, 1.4 * sd, -1.4 * sd, 2.1 * sd]) {
              const sx = Math.sin(base + da), sz = Math.cos(base + da);
              nx = a.pos.x + sx * step * 1.2; nz = a.pos.z + sz * step * 1.2;
              if (this.okFor(medium, nx, nz, 5, a.rad) && !this.bumps(a, nx, nz) && this.occ.walkFree(a, a.pos.x, a.pos.y, a.pos.z, nx, this.world.terrain.heightAt(nx, nz), nz) === 1) { a.pos.x = nx; a.pos.z = nz; dirx = sx; dirz = sz; a.side = Math.sign(da) || 1; moved = true; break; }
            }
          }
          // Sliding along something for long (a crowd round a scrap of food) gets nowhere: rest, then choose somewhere else.
          a.blockedN = (a.blockedN ?? 0) + 1; a.blockT = (a.blockT ?? 0) + dt;
          if (!moved || a.blockedN > 40 || a.blockT > 1.5) { a.timer = 0; a.blockedN = 0; a.blockT = 0; }
        }
        const want = Math.atan2(dirx, dirz) + (sp.kind === 'crab' ? Math.PI / 2 : 0);
        this.turnTo(a, sp, want, dt, 6);
        // A heavy crawler that cannot swim, walking along a steep bank, now and then loses its footing and tumbles in.
        if (sp.drowns && medium === 'land' && Math.random() < dt * 0.02 && this.slipsIn(a, a.pos.x + dirx, a.pos.z + dirz)) return;
      }
    }
    // Jumpers take off now and then on the way too (a springtail's furcula, a cricket's hind legs, a fly's buzz).
    if (sp.hop && !a.hop && Math.random() < dt * (sp.kind === 'fly' ? 0.08 : 0.12)) this.takeOff(a, sp, medium, sp.kind === 'fly' ? 'flutter' : 'jump');
    const gy = T.heightAt(a.pos.x, a.pos.z), sy = medium === 'surface' ? W.water.surfaceAt(a.pos.x, a.pos.z) : -Infinity;
    a.pos.y = Math.max(gy, sy);
    a.normal = sy > gy ? UP : T.normalAt(a.pos.x, a.pos.z);
    a.grazing = a.state === 'rest' && !a.hop;     // head-down pauses (see vis)
  }

  // --- Dwarf shrimp ------------------------------------------------------------------------------------------------------
  // The decisions are in sim/shrimp.js (pure); this senses for it and carries them out: walks and grazing shuffles on the bottom,
  // swims (takeOff 'swim' to a chosen patch), the tail flick, eating at the food it crowds round, the moult and its cast shell, and
  // a female's call that sends the males searching. The rig gets the pincers, swimmerets and antennae (invertPose).
  shrimp(a, sp, dt) {
    const W = this.world, T = W.terrain;
    const m = (a.sm ??= shrimpMind(Math.random));
    a.female ??= Math.random() < 0.55;
    a.sizeK ??= a.female ? 0.95 + Math.random() * 0.1 : 0.76 + Math.random() * 0.08;     // males stay smaller and slimmer
    if (a.hop?.kind && this.leap(a, sp, dt, 'water')) { a.sFeed = 0; a.sAnt = 1; a.sFan = a.hop?.kind === 'swim' ? 1 : 0; return; }
    const x = a.pos.x, z = a.pos.z, g = T.heightAt(x, z), depth = this.waterTop(x, z) - g;
    const dtMin = dt * Math.min(this.warp ?? 1, 40);
    // Slow senses every few seconds: cover here and the best cover near, how rich the grazing is.
    a.ssT = (a.ssT ?? Math.random() * 2) - dt;
    if (a.ssT <= 0) {
      a.ssT = 2 + Math.random() * 2;
      a.sCover = this.shrimpCover(x, z);
      a.sRich = this.grazeRich(x, z);
      a.sHide = a.sCover > 0.6 ? null : this.shrimpHide(a);
      a.sMates = (this.by[a.sp] ?? []).some((b) => b !== a && !b.female && b.age / 1440 >= (sp.adultDays ?? 20));
    }
    // Food, a few times a second: settled food of its diet, and cast shells (they are eaten for their minerals).
    a.sfT = (a.sfT ?? Math.random() * 0.4) - dt;
    if (a.sfT <= 0) {
      a.sfT = 0.3 + Math.random() * 0.3;
      let best = null, bd = SHRIMP.smell;
      for (const f of this.food) {
        if (f.eaten || !f.settled || !eatsItem(sp, f)) continue;
        const d = Math.hypot(f.pos.x - x, f.pos.z - z);
        if (d < bd && Math.abs(f.pos.y - a.pos.y) < 4) { bd = d; best = { f, x: f.pos.x, z: f.pos.z, d, age: f.age ?? 99 }; }
      }
      if (!best && a.hunger > 0.3) for (const sh of this.shells) {
        const d = Math.hypot(sh.pos.x - x, sh.pos.z - z);
        if (d < Math.min(bd, 15)) { bd = d; best = { shell: sh, x: sh.pos.x, z: sh.pos.z, d, age: 999 }; }
      }
      a.sFood = best;
      const dg = this.danger(a, sp);
      a.sThreat = dg ? { x: dg.x, z: dg.z, d: Math.hypot(dg.x - x, dg.z - z) } : null;
    } else if (a.sFood) a.sFood.d = Math.hypot(a.sFood.x - x, a.sFood.z - z);
    // A female's call: the nearest recent one of this species, once per male per call.
    let call = null;
    if (!a.female && this.shrimpCalls.length) {
      this.shrimpCalls = this.shrimpCalls.filter((c) => this.t - c.t < 30);
      for (const c of this.shrimpCalls) if (c.sp === a.sp && c.id !== m.heard && Math.hypot(c.x - x, c.z - z) < 45) { call = c; m.heard = c.id; break; }
    }
    const sense = {
      t: this.t, dt, dtMin, x, z, yaw: a.yaw ?? 0, adult: a.age / 1440 >= (sp.adultDays ?? 20), female: a.female, hunger: a.hunger,
      food: a.sFood ? { x: a.sFood.x, z: a.sFood.z, d: a.sFood.d, age: a.sFood.age + (this.t - (a.sFood.t0 ??= this.t)) } : null,
      threat: a.sThreat, cover: a.sCover ?? 0, hide: a.sHide ? { x: a.sHide.x, z: a.sHide.z, d: Math.hypot(a.sHide.x - x, a.sHide.z - z) } : null,
      rich: a.sRich, spots: () => this.grazeSpots(a), call: call && { x: call.x, z: call.z, d: Math.hypot(call.x - x, call.z - z) },
      mates: !!a.sMates, inWater: depth > 0.5,
    };
    const it = shrimpThink(m, sense);
    a.sIt = it;
    a.doing = shrimpDoing(it);
    // Carry it out.
    if (it.flick) { const away = Math.atan2(x - it.flick.x, z - it.flick.z); this.takeOff(a, sp, 'water', 'flick', away); a.yaw = away + Math.PI; }
    else if (it.goal && it.swim && Math.hypot(it.goal.x - x, it.goal.z - z) > 4) {
      if (!this.takeOff(a, sp, 'water', 'swim', null, it.goal)) { m.goal = null; m.left = Math.min(m.left ?? 9, 3); }
    } else if (it.goal && it.speed > 0) this.shrimpWalk(a, it.goal, it.speed, dt, m);
    else if (it.face) this.turnTo(a, sp, Math.atan2(it.face.x - x, it.face.z - z), dt, 3);
    if (!a.hop) { a.pos.y = T.heightAt(a.pos.x, a.pos.z); a.normal = T.normalAt(a.pos.x, a.pos.z); }
    // Eating: every shrimp at a flake takes its share; the flake goes when it has been picked clean.
    if (it.eating && a.sFood) {
      const F = a.sFood;
      if (F.f) { F.f.bites = (F.f.bites ?? 0) + dt; if (F.f.bites > ({ flake: 25, pellet: 70, bloodworm: 18 }[F.f.kind ?? 'flake'] ?? 25)) F.f.eaten = true; }
      else if (F.shell) F.shell.left -= dt * 0.004;
      a.hunger = Math.max(0, a.hunger - dt * 0.003);
      if (F.f?.eaten || (F.shell && F.shell.left <= 0)) a.sFood = null;
    }
    if (it.moult) {
      // The old shell stays where it was cast, on its side.
      this.shells.push({ sp: a.sp, pos: a.pos.clone(), yaw: (a.yaw ?? 0) + (Math.random() - 0.5) * 0.6, roll: (Math.random() < 0.5 ? -1 : 1) * (1.2 + Math.random() * 0.35), left: 1, age: 0, life: 1440 * (1 + Math.random()) });
      if (this.shells.length > 40) this.shells.shift();
      if (Math.random() < 0.3) W.log(`A ${one(a.sp)} moulted: its old shell lies on the bottom.`, 'info');
    }
    if (it.call) { this.shrimpCalls.push({ sp: a.sp, x: a.pos.x, z: a.pos.z, t: this.t, id: a.id + ':' + Math.round(this.t) }); }
    a.berried = it.berried > 0;
    a.sFeed = it.feed; a.sFan = it.fan; a.sAnt = it.ant;
    a.state = it.goal ? 'walk' : 'rest'; a.target = it.goal ? V(it.goal.x, 0, it.goal.z) : null;
    a.grazing = it.feed > 0.3;
  }

  // A few steps toward a point on the bottom: turn first when it is well off the heading, slide round what is in the way, give the
  // goal up when it cannot get on.
  shrimpWalk(a, goal, speed, dt, m) {
    const dx = goal.x - a.pos.x, dz = goal.z - a.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.05) return;
    const want = Math.atan2(dx, dz), diff = ((want - (a.yaw ?? 0) + Math.PI) % TAU + TAU) % TAU - Math.PI;
    this.turnTo(a, SPECIES[a.sp], want, dt, 6);
    const fwd = clamp(1 - Math.abs(diff) / 1.2, 0, 1), step = Math.min(d, speed * dt * fwd);
    if (step <= 0) return;
    let ux = Math.sin(a.yaw), uz = Math.cos(a.yaw);
    const nx = a.pos.x + ux * step, nz = a.pos.z + uz * step;
    if (this.okFor('water', nx, nz, 99, a.rad) && !this.bumps(a, nx, nz)) { a.pos.x = nx; a.pos.z = nz; a.sBlock = 0; return; }
    const sd = a.side ?? 1;
    for (const da of [0.8 * sd, -0.8 * sd, 1.6 * sd, -1.6 * sd]) {
      ux = Math.sin(a.yaw + da); uz = Math.cos(a.yaw + da);
      const sx = a.pos.x + ux * step, sz = a.pos.z + uz * step;
      if (this.okFor('water', sx, sz, 99, a.rad) && !this.bumps(a, sx, sz)) { a.pos.x = sx; a.pos.z = sz; a.side = Math.sign(da); return; }
    }
    a.sBlock = (a.sBlock ?? 0) + dt;
    if (a.sBlock > 1) { a.sBlock = 0; m.goal = null; m.pause = 1 + Math.random() * 2; }
  }

  // How much cover a spot on the bottom gives a shrimp: an overhang (wood, a ledge, a root), moss, or stems close round it.
  shrimpCover(x, z) {
    const T = this.world.terrain, g = T.heightAt(x, z);
    let c = this.occ.count && this.occ.solidAt(x, g + 1.2, z) ? 0.9 : 0;
    c += T.field.matAt(x, z, MAT.moss) * 0.7;
    // (water plants: their stems and leaves; the plant cores leave the aquatic ones out, so the list is read here)
    let n = 0;
    for (const q of this.world.plants?.list ?? []) {
      if (q.surface === 'wall' || Math.abs(q.pos.x - x) > 6 || Math.abs(q.pos.z - z) > 6) continue;
      if (Math.hypot(q.pos.x - x, q.pos.z - z) < (q.reach ?? 3) * 0.35 * (0.4 + 0.6 * (q.grown ?? 1)) + 0.8 && q.pos.y < this.waterTop(q.pos.x, q.pos.z)) n++;
    }
    return Math.min(1, c + Math.min(0.6, n * 0.3));
  }

  // How good the grazing is: biofilm grows on everything that has been in the water a while, most on moss, wood, stone and leaves,
  // least on bare sand.
  grazeRich(x, z) {
    const T = this.world.terrain, g = T.heightAt(x, z);
    let r = 0.25 + T.field.matAt(x, z, MAT.moss) * 0.5;
    if (this.occ.count && (this.occ.solidAt(x + 1.2, g + 0.6, z) || this.occ.solidAt(x - 1.2, g + 0.6, z) || this.occ.solidAt(x, g + 0.6, z + 1.2) || this.occ.solidAt(x, g + 0.6, z - 1.2))) r += 0.3;
    if (T.field.matAt(x, z, MAT.sand) > 0.6) r -= 0.12;
    return clamp(r, 0, 1);
  }

  // Patches a shrimp might move to: a ring of points 3 … 26 cm away under water, each with its richness.
  grazeSpots(a) {
    const out = [];
    for (let k = 0; k < 10; k++) {
      const ang = Math.random() * TAU, r = 3 + Math.random() * 23;
      const x = a.pos.x + Math.sin(ang) * r, z = a.pos.z + Math.cos(ang) * r;
      if (!this.okFor('water', x, z, 99, a.rad)) continue;
      out.push({ x, z, d: r, rich: this.grazeRich(x, z) });
    }
    return out;
  }

  // The best cover within reach (for a moult, or after a fright).
  shrimpHide(a) {
    let best = null, bs = 0.35;
    for (let k = 0; k < 14; k++) {
      const ang = Math.random() * TAU, r = 1.5 + Math.random() * 18;
      const x = a.pos.x + Math.sin(ang) * r, z = a.pos.z + Math.cos(ang) * r;
      if (!this.okFor('water', x, z, 99, a.rad)) continue;
      const sc = this.shrimpCover(x, z) - r * 0.012;
      if (sc > bs) { bs = sc; best = { x, z }; }
    }
    return best;
  }

  // --- Leaps, swims and startles (insects and crustaceans) ----------------------------------------------------------------
  // A move through the air or the water from where it stands to a spot it can land on, as one arc: `jump` (a springtail flips
  // over as it goes, a cricket kicks out its hind legs; util: the rig's hop channel), `flutter` (a flightless fruit fly hops a
  // few centimetres on buzzing wings), `swim` (a shrimp lifts off the bottom and paddles to another spot), `flick` (a shrimp
  // shoots backwards with its tail snapped under). Returns false when there is nowhere to land.
  takeOff(a, sp, medium, kind, away = null, to = null) {
    const W = this.world, T = W.terrain, s = drawScale(a, sp);
    const R = { jump: sp.kind === 'fly' ? [2, 4] : sp.size >= 1 && !sp.surface && sp.speed > 1.5 ? [5, 12] : [1.5, 4.5], flutter: [2, 5], swim: [5, 14], flick: [2.5, 5] }[kind];
    for (let k = 0; k < 6; k++) {
      const base = away ?? (to ? Math.atan2(to.x - a.pos.x, to.z - a.pos.z) : a.target ? Math.atan2(a.target.x - a.pos.x, a.target.z - a.pos.z) : a.yaw ?? 0);
      // (a given destination: tried as it is first, then a little to either side and nearer or farther)
      const ang = base + (to ? (k ? (Math.random() - 0.5) * 0.6 : 0) : (Math.random() - 0.5) * (away != null ? 0.7 : k < 2 ? 0.8 : 2.4));
      const d = to ? Math.hypot(to.x - a.pos.x, to.z - a.pos.z) * (k ? 0.75 + Math.random() * 0.4 : 1)
        : (R[0] + Math.random() * (R[1] - R[0])) * (kind === 'swim' || kind === 'flick' ? 1 : Math.min(1.4, Math.max(0.7, s)));
      const x1 = a.pos.x + Math.sin(ang) * d, z1 = a.pos.z + Math.cos(ang) * d;
      if (!this.okFor(medium, x1, z1, 5, a.rad) || this.bumps(a, x1, z1)) continue;
      const g1 = T.heightAt(x1, z1), y1 = medium === 'surface' ? Math.max(g1, W.water.surfaceAt(x1, z1)) : g1;
      const top = Math.min(this.waterTop(a.pos.x, a.pos.z), this.waterTop(x1, z1));
      let h = kind === 'swim' ? Math.min(1.5 + Math.random() * 2.5, Math.max(0.6, top - Math.max(a.pos.y, y1) - 0.8)) : kind === 'flick' ? 0.8 : d * (kind === 'flutter' ? 0.45 : 0.35);
      // nothing solid on the way, and the ground under the path stays below it (a hump between here and there would be walked
      // through: the arc is raised over it, or the leap is not made)
      const midY = Math.max(a.pos.y, y1) + h;
      if (this.occ.solidAt((a.pos.x + x1) / 2, midY, (a.pos.z + z1) / 2) || this.occ.solidAt(a.pos.x + (x1 - a.pos.x) * 0.75, (midY + y1) / 2, a.pos.z + (z1 - a.pos.z) * 0.75)) continue;
      let need = 0;
      for (let i = 1; i < 8; i++) {
        const f = i / 8, arc = kind === 'swim' ? Math.pow(Math.sin(Math.PI * f), 0.6) : 4 * f * (1 - f);
        need = Math.max(need, (T.heightAt(a.pos.x + (x1 - a.pos.x) * f, a.pos.z + (z1 - a.pos.z) * f) + (a.bh ?? 0.3) * 0.3 - (a.pos.y + (y1 - a.pos.y) * f)) / Math.max(arc, 0.05) - h);
      }
      if (need > 0) { if (kind === 'flick' || h + need > (kind === 'swim' ? top - Math.max(a.pos.y, y1) - 0.5 : d)) continue; h += need; }
      // the whole arc once, as leap() will fly it (B4b: the two points above let a hop pass through thin wood): blocked, next try
      if (this.occ.count) {
        const lift = sp.kind === 'swim' || a.swimming ? 0 : 0.5;
        let px = a.pos.x, py = a.pos.y + lift, pz = a.pos.z, hit = false;
        for (let i = 1; i <= 8 && !hit; i++) {
          const t = i / 8, e = kind === 'swim' ? t * t * (3 - 2 * t) : kind === 'flick' ? 1 - (1 - t) ** 3 : t;
          const qx = a.pos.x + (x1 - a.pos.x) * e, qz = a.pos.z + (z1 - a.pos.z) * e;
          const qy = a.pos.y + (y1 - a.pos.y) * e + h * (kind === 'swim' ? Math.pow(Math.sin(Math.PI * t), 0.6) : 4 * t * (1 - t)) + lift;
          hit = this.occ.segmentFreeAt(a, px, py, pz, qx, qy, qz, 0) < 1; px = qx; py = qy; pz = qz;
        }
        if (hit) continue;
      }
      const dur = kind === 'swim' ? d / (sp.speed * 2.2) : kind === 'flick' ? 0.35 : kind === 'flutter' ? 0.5 + d * 0.05 : 0.3 + d * 0.025;
      a.hop = { kind, t: 0, dur, x0: a.pos.x, z0: a.pos.z, y0: a.pos.y, x1, z1, y1, h, spin: kind === 'jump' && sp.speed < 1.5 ? (Math.random() < 0.5 ? -1 : 1) * TAU * (1 + Math.floor(Math.random() * 2)) : 0 };   // (a springtail tumbles)
      if (kind !== 'flick') a.yaw = ang;
      a.state = 'walk'; a.target = null; a.timer = 0;
      return true;
    }
    return false;
  }

  // One step of a leap; true while it is still under way.
  leap(a, sp, dt, medium) {
    const H = a.hop;
    H.t = Math.min(1, H.t + dt / H.dur);
    const t = H.t, e = H.kind === 'swim' ? t * t * (3 - 2 * t) : H.kind === 'flick' ? 1 - (1 - t) ** 3 : t;
    const ox = a.pos.x, oy = a.pos.y, oz = a.pos.z;
    a.pos.x = H.x0 + (H.x1 - H.x0) * e; a.pos.z = H.z0 + (H.z1 - H.z0) * e;
    // a jump is a parabola; a swim rises, cruises and settles
    const arc = H.kind === 'swim' ? Math.pow(Math.sin(Math.PI * t), 0.6) : 4 * t * (1 - t);
    a.pos.y = H.y0 + (H.y1 - H.y0) * e + H.h * arc;
    // (B4b) a long tick cuts the arc's corners: a piece across this tick's chord ends the leap short of it
    if (this.occ.count) {
      const lift = sp.kind === 'swim' || a.swimming ? 0 : 0.5, f = this.occ.segmentFreeAt(a, ox, oy + lift, oz, a.pos.x, a.pos.y + lift, a.pos.z);
      if (f < 1) { a.pos.set(ox + (a.pos.x - ox) * f, oy + (a.pos.y - oy) * f, oz + (a.pos.z - oz) * f); a.hop = null; a.hopCut = (a.hopCut ?? 0) + 1; a.state = 'rest'; a.timer = 0.5 + Math.random(); return false; }
    }
    if (H.kind === 'swim') a.yaw = angLerp(a.yaw ?? 0, Math.atan2(H.x1 - H.x0, H.z1 - H.z0), Math.min(1, dt * 4));
    if (t < 1) return true;
    a.hop = null;
    a.pos.y = H.y1;
    a.state = 'rest'; a.timer = 0.5 + Math.random() * 2;
    return false;
  }

  // Danger close by: a shrimp flicks away from it, a panda king rolls into a ball and waits; everything else carries on (and a
  // springtail may jump). A danger is the camera right at the glass or a bigger animal that eats this one, near and on its level.
  // Checked a few times a second. True while it is rolled up (it does nothing else then).
  startle(a, sp, dt, medium) {
    const C = a.curl;
    if (C) {
      C.t += dt;
      C.now = C.t < C.hold ? Math.min(1, C.now + dt * 2.5) : Math.max(0, C.now - dt * 0.9);
      if (C.now <= 0 && C.t >= C.hold) a.curl = null;
      a.state = 'rest'; a.target = null;
      return true;
    }
    if (!(sp.flicks || sp.rolls || sp.hop)) return false;
    a.dangerT = (a.dangerT ?? Math.random() * 0.4) - dt;
    if (a.dangerT > 0) return false;
    a.dangerT = 0.35 + Math.random() * 0.2;
    const d = this.danger(a, sp);
    if (!d) return false;
    const away = Math.atan2(a.pos.x - d.x, a.pos.z - d.z);
    if (sp.rolls) { a.curl = { t: 0, hold: 4 + Math.random() * 8, now: 0 }; a.target = null; return true; }
    if (sp.flicks && !a.hop) { this.takeOff(a, sp, medium, 'flick', away); a.yaw = away + Math.PI; return false; }       // shoots backwards, head to the danger
    if (sp.hop && !a.hop && Math.random() < 0.6) this.takeOff(a, sp, medium, sp.kind === 'fly' ? 'flutter' : 'jump', away);
    return false;
  }

  // The nearest danger to a small animal, or null: the camera within 7 cm (as the crabs feel it), or an animal that eats it
  // (or a fish, frog, newt or crab twice its size) within its own body length plus 3 cm, on its level.
  // threatOnly (a resting tadpole or larva; B3, at the lead's request): only a predator or a camera swoop, not any big fish passing.
  danger(a, sp, threatOnly = false) {
    const ct = this.camThreat(a, 9);
    if (ct) return ct;
    const reach = 3 + 2 * (a.rad ?? 0.4);
    let best = null, bd = reach;
    const visit = (b) => {
      if (b === a || b.dead || b.sp === a.sp) return;
      const bs = SPECIES[b.sp];
      if (!(bs.eats.includes(a.sp) || (!threatOnly && (bs.kind === 'swim' || VIS.has(bs.kind) || bs.kind === 'crab') && bs.size > sp.size * 2))) return;
      if (Math.abs(b.pos.y - a.pos.y) > 3) return;
      const dd = Math.hypot(b.pos.x - a.pos.x, b.pos.z - a.pos.z) - (b.rad ?? 0.5);
      if (dd < bd) { bd = dd; best = { x: b.pos.x, z: b.pos.z }; }
    };
    this.near('land', a.pos.x, a.pos.y, a.pos.z, visit);
    return best;
  }

  // The camera as a danger: only when it swoops at the animal (closes in faster than about 10 cm/s within `range` cm). An animal
  // that is watched, or followed, by a lens that keeps its distance carries on as it was: kept animals get used to the keeper, and
  // one that bolted whenever it was looked at could never be watched. Returns { x, y, z, d } or null; d (cm) is the distance made
  // shorter the faster the lens comes, so the usual `scareCm` rules apply to it.
  camThreat(a, range = 22) {
    const cam = this.camera?.position, v = this.camVel;
    if (!cam || !v || a === this.watched) return null;
    const dx = a.pos.x - cam.x, dy = a.pos.y - cam.y, dz = a.pos.z - cam.z, d = Math.hypot(dx, dy, dz);
    if (d > range) return null;
    const closing = (v.x * dx + v.y * dy + v.z * dz) / (d || 1);
    if (closing < 10) return null;
    return { x: cam.x, y: cam.y, z: cam.z, d: d * clamp(16 / closing, 0.3, 1) * 0.6 };
  }

  // --- Heavy crawlers that cannot swim (panda king isopods) ----------------------------------------------------------
  // At a steep bank (the ground drops more than a few millimetres into the water) the crawler can lose its footing and
  // tumble in. True when it did.
  slipsIn(a, nx, nz) {
    const W = this.world, T = W.terrain;
    // The bank a centimetre ahead: a drop of more than 6 mm into water is steep enough to tumble.
    const dx = nx - a.pos.x, dz = nz - a.pos.z, dl = Math.hypot(dx, dz) || 1;
    nx = a.pos.x + (dx / dl) * 1.2; nz = a.pos.z + (dz / dl) * 1.2;
    const g0 = T.heightAt(a.pos.x, a.pos.z), g1 = T.heightAt(nx, nz), s1 = W.water.surfaceAt(nx, nz);
    if (!(s1 > g1 + 0.2) || g0 - g1 < 0.6 || (this.avoid && this.occ.count && this.occ.solidAt(nx, g1 + 0.5, nz))) return false;
    a.pos.x = nx; a.pos.z = nz; a.pos.y = g1;
    a.sunk = { t: 0, exit: null, look: 0 };
    a.target = null; a.state = 'walk';
    return true;
  }

  // In the water: it walks the bottom toward the nearest way out it can climb (a slope of under a centimetre per step, or
  // wood, rock or bark that reaches into the water). Without one it stays under and drowns (sim.js careStress).
  sunkCrawl(a, sp, dt) {
    const W = this.world, T = W.terrain, S = a.sunk;
    S.t += dt; S.look -= dt;
    if (S.look <= 0) {
      S.look = 1.5;
      S.exit = null;
      let bd = 1e9;
      for (let k = 0; k < 16; k++) {
        const ang = (k / 16) * TAU;
        let px = a.pos.x, pz = a.pos.z, gPrev = T.heightAt(px, pz);
        for (let r = 0.5; r <= 6; r += 0.5) {
          px = a.pos.x + Math.sin(ang) * r; pz = a.pos.z + Math.cos(ang) * r;
          const g = T.heightAt(px, pz);
          const ramp = this.occ.count && this.occ.solidAt(px, Math.min(g + 0.5, W.water.level - 0.2), pz);
          if (g - gPrev > 0.5 && !ramp) break;                                  // a ledge it cannot climb
          gPrev = g;
          if (W.water.surfaceAt(px, pz) <= g && this.okFor('land', px, pz)) { if (r < bd) { bd = r; S.exit = V(px, 0, pz); } break; }
        }
      }
    }
    if (S.exit) {
      const dx = S.exit.x - a.pos.x, dz = S.exit.z - a.pos.z, dist = Math.hypot(dx, dz);
      const step = Math.min(dist, sp.speed * 0.6 * dt);
      if (dist > 1e-3) { a.pos.x += (dx / dist) * step; a.pos.z += (dz / dist) * step; a.yaw = angLerp(a.yaw ?? 0, Math.atan2(dx, dz), Math.min(1, dt * 4)); }
      if (dist < 0.3) { a.sunk = null; a.under = 0; a.timer = 0; }
    }
    a.pos.y = T.heightAt(a.pos.x, a.pos.z);
    a.normal = T.normalAt(a.pos.x, a.pos.z);
  }

  // --- Perching frogs (the starry night reed frog, the red-eyed tree frog) -------------------------------------------
  // By day a perching frog climbs a tall plant, a wall plant, wood or the glass and sits pressed flat on it, legs tucked in
  // (it saves water); at dusk, or when hungry, it climbs down and hunts on the ground like any frog (frog()). Returns true
  // while it is on its way, climbing, perched or climbing down (frog() is skipped), false when frog() is in charge.
  // The way (perchRoute): on foot to the foot of the climb, then along `path`, points on the climb itself (up the stem, up the
  // background, over the wood, up the glass), and back down the same way. A tree frog keeps its feet dry the whole way; a reed
  // frog (sp.perchSwim) may swim to the foot, in the stroke. Neither walks over water.
  perchFrog(a, sp, dt) {
    const W = this.world, T = W.terrain;
    const want = W.env.bright() > 0.25 && a.hunger < 0.6 && !a.swimming && !a.order && !a.hop;
    const P = a.perch;
    if (P && !P.path) a.perch = null;                                    // (a perch from an older version: start again)
    else if (P) {
      const gone = (P.plant && !W.plants.list.includes(P.plant)) || (P.piece && !W.decor.pieces.includes(P.piece));
      if (P.ph === 'go' && gone) { this.perchQuit(a, P); return false; }
      if ((P.ph === 'sit' && (!want || gone)) || (P.ph === 'up' && gone)) {
        P.left = gone ? 'gone' : a.order ? 'hunting' : a.hop ? 'hop' : a.hunger >= 0.6 ? 'hungry' : 'dusk';
        P.i = P.ph === 'sit' ? P.path.length - 2 : P.i - 1;              // back down the way it came
        P.ph = 'down';
      }
      a.speedNow = 0; a.state = 'rest';
      if (P.ph === 'go') {
        const dx = P.base.x - a.pos.x, dz = P.base.z - a.pos.z, dist = Math.hypot(dx, dz);
        // No headway for 3 s (a rock or the background pushes it back), or water ahead for a frog that keeps its feet dry
        // (a pump move, a spring): it gives up on this perch.
        if (dist < P.near - 0.25) { P.near = dist; P.stuck = 0; } else P.stuck += dt;
        // Held off the foot by a neighbour's stems or a body in the way, but nearly there: it starts the climb from where it is.
        if (P.stuck > 1 && dist < 1.5) { P.path[0] = a.pos.clone(); P.base = P.path[0]; P.ph = 'up'; P.i = 1; a.swimming = false; return true; }
        const step = Math.min(dist, sp.speed * 2.2 * dt);
        const nx = a.pos.x + (dx / (dist || 1)) * step, nz = a.pos.z + (dz / (dist || 1)) * step;
        if (P.stuck > 3 || (step > 1e-4 && !this.okFor(sp.perchSwim ? 'any' : 'land', nx, nz, 99, (a.rad ?? 0.5) * 0.9))) { this.perchQuit(a, P); return false; }
        a.pos.x = nx; a.pos.z = nz;
        const g = T.heightAt(nx, nz), s = W.water.surfaceAt(nx, nz, 0.2);
        a.swimming = s > g + 0.9 * sp.size;                              // (only a reed frog gets here: it swims, in the stroke)
        if (a.swimming) {
          a.pos.y = s - this.swimDepth(a, sp); a.normal = null; a.pitch = 0;
          this.swimClock(a, sp, 0.9, dt);
        } else { a.pos.y = g; a.normal = T.normalAt(nx, nz); }
        if (dist > 0.05) a.yaw = angLerp(a.yaw ?? 0, Math.atan2(dx, dz), Math.min(1, dt * 6));
        a.speedNow = step / Math.max(1e-4, dt); a.state = 'walk';
        if (dist - step < 0.05) { P.ph = 'up'; P.i = 1; a.swimming = false; a.normal ??= T.normalAt(a.pos.x, a.pos.z); }
        return true;
      }
      if (P.ph === 'up' || P.ph === 'down') {
        const goal = P.path[P.i];
        const dx = goal.x - a.pos.x, dy = goal.y - a.pos.y, dz = goal.z - a.pos.z, dist = Math.hypot(dx, dy, dz), dh = Math.hypot(dx, dz);
        const step = Math.min(dist, sp.speed * 1.4 * dt);
        if (dist > 1e-3) { a.pos.x += (dx / dist) * step; a.pos.y += (dy / dist) * step; a.pos.z += (dz / dist) * step; }
        // Climbing out of the water and held back (the glass or a bank keeps its body off the next point for 2 s): it lets go and
        // swims for another way out (that one is no good for a while).
        if (P.exit) {
          if (P.gi !== P.i) { P.gi = P.i; P.near = Infinity; P.stuck = 0; }
          if (dist < P.near - 0.05) { P.near = dist; P.stuck = 0; }
          else if ((P.stuck += dt) > 2) {
            a.perch = null; a.pitch = 0; a.normal = null; a.timer = 0;
            (a.badShore ??= []).push([P.top.x, P.top.z]); if (a.badShore.length > 8) a.badShore.shift();
            return false;
          }
        }
        let onGlass = false;
        if (P.exit === 'glass') {
          // Out of the water up the glass: belly to it, heading the way it climbs (up, along the pane, down onto the land); at the
          // foot of the glass in the water and on the land beyond it, by its heading.
          if (P.i >= 2 && P.i <= P.glassTo) { a.normal = P.glassN; onGlass = true; if (dist > 0.05) a.yaw = this.glassYawTo(P.glassN, dx, dy, dz); }
          else { a.normal = P.i > P.glassTo ? T.normalAt(a.pos.x, a.pos.z) : null; if (dh > 0.05) a.yaw = angLerp(a.yaw ?? 0, Math.atan2(dx, dz), Math.min(1, dt * 6)); }
          a.pitch = 0;
        } else if (P.glassN) {
          // On the glass belly to it, head up (head first coming down); across the ground at its foot, standing on the ground.
          if (Math.abs(dy) > dh * 1.5) { a.normal = P.glassN; onGlass = true; a.yaw = P.glassYaw + (dy < 0 ? Math.PI : 0); }
          else { a.normal = T.normalAt(a.pos.x, a.pos.z); if (dh > 0.05) a.yaw = angLerp(a.yaw ?? 0, Math.atan2(dx, dz), Math.min(1, dt * 6)); }
          a.pitch = 0;
        } else if (goal.n) {
          // Up the side of a piece: belly to its surface here, heading the way it climbs, the belly plane on the surface (as on the glass).
          a.normal = goal.n; onGlass = true; a.pitch = 0;
          if (dist > 0.05) a.yaw = this.glassYawTo(goal.n, dx, dy, dz);
        } else {
          // Up a stem or the background, over wood: drawn by heading and pitch, nose up the climb (head first coming down).
          a.normal = null;
          if (dh > 0.05) a.yaw = angLerp(a.yaw ?? 0, Math.atan2(dx, dz), Math.min(1, dt * 6));
          if (dist > 0.05) a.pitch = lerp(a.pitch ?? 0, clamp(-Math.atan2(dy, dh), -1.25, 1.25), Math.min(1, dt * 8));
        }
        // Belly to the glass it is ON the glass: the belly plane GLASS_GAP off the pane all the way up, not on the straight line from the foot of
        // the climb to the top, which kept it 2 cm out in the air at the start (the plane through the pane's points of the path: its top).
        if (onGlass && goal.n && !P.glassN) {                            // (a piece's side: the plane through the point it is climbing to, along its normal)
          const n = goal.n, off = (a.pos.x - goal.x) * n.x + (a.pos.y - goal.y) * n.y + (a.pos.z - goal.z) * n.z, k = Math.min(1, dt * 8) * off;
          a.pos.x -= n.x * k; a.pos.y -= n.y * k; a.pos.z -= n.z * k;
        } else if (onGlass) {
          const n = P.glassN, gp = P.exit ? P.path[2] : P.top, off = (a.pos.x - gp.x) * n.x + (a.pos.z - gp.z) * n.z, k = Math.min(1, dt * 8) * off;
          a.pos.x -= n.x * k; a.pos.z -= n.z * k;
        }
        a.speedNow = step / Math.max(1e-4, dt); a.state = 'walk';
        if (dist - step < 0.05) {
          P.i += P.ph === 'up' ? 1 : -1;
          if (P.ph === 'up' && P.i >= P.path.length) {
            // Out of the water (startExit): it sits on the land it climbed onto, a moment, then frog() is in charge again.
            if (P.exit) {
              a.perch = null; a.pitch = 0; a.fs = 'sit'; a.fsT = 0.6 + Math.random() * 1.5; a.chain = 0; a.crouch = 0; a.timer = 0; a.hd = a.yaw;
              a.pos.y = T.heightAt(a.pos.x, a.pos.z); a.normal = T.normalAt(a.pos.x, a.pos.z);
              return true;
            }
            P.ph = 'sit'; a.pitch = 0;
          }
          else if (P.ph === 'down' && P.i < 0) {
            a.perch = null; a.pitch = 0; a.fs = 'sit'; a.fsT = 1 + Math.random() * 2; a.perchT = 20 + Math.random() * 20;
            a.pos.y = T.heightAt(a.pos.x, a.pos.z); a.normal = T.normalAt(a.pos.x, a.pos.z);
            return true;
          }
        }
        return true;
      }
      a.pos.copy(P.top); a.pitch = 0;
      a.crouch = 0.6;                                                    // pressed flat on the leaf, the wood or the glass
      a.normal = P.glassN ?? P.up ?? UP;                                 // (on a leaf: tilted with it)
      if (P.glassN) {
        // (it shuffles round where its body stays clear of the ground: perchFits at the new heading)
        if (Math.random() < dt * 0.03) { const y = P.glassYaw + (Math.random() - 0.5) * 0.9; if (!P.plant || this.perchFits(a, sp, P.top, P.glassN, [y])) a.yaw = y; }
      }
      else if (Math.random() < dt * 0.05) a.yaw += (Math.random() - 0.5) * 0.6;   // shuffles round now and then
      return true;
    }
    if (!want) return false;
    a.perchT = (a.perchT ?? Math.random() * 6) - dt;
    if (a.perchT > 0) return false;
    a.perchT = 8 + Math.random() * 8;
    const r = this.perchSpot(a, sp);
    if (!r) return false;
    a.perch = { ph: 'go', top: r.p, plant: r.plant, piece: r.piece, glassN: r.glassN, glassYaw: r.glassYaw, up: r.up, base: r.base, path: r.path, near: Infinity, stuck: 0 };
    a.fs = null;
    return true;
  }

  // Off the way to a perch (stuck, or water ahead): back to frog(), and that perch is left alone for a few minutes.
  perchQuit(a, P) {
    a.perch = null; a.pitch = 0; a.swimming = false;
    a.perchT = 8 + Math.random() * 8;
    a.perchBad = [...(a.perchBad ?? []).slice(-3), { x: P.top.x, y: P.top.y, z: P.top.z, t: this.t }];
  }

  // The best perch within reach: the top of a tall plant (or a wall plant), wood, or the glass; better high and over or near
  // water, not taken, and with a way there (perchRoute).
  perchSpot(a, sp) {
    const W = this.world, T = W.terrain;
    // Each frog has a favourite kind of perch (leaves, wood and bamboo, or the glass), as real ones settle into habits.
    const like = (a.perchLike ??= ['plant', 'plant', 'piece', 'glass'][Math.floor(Math.random() * 4)]);
    const fav = (k) => (k === like ? 8 : 0);
    const taken = (top) => (this.by[a.sp] ?? []).some((b) => b !== a && b.perch && b.perch.top.distanceTo(top) < 2.5)
      || (a.perchBad ?? []).some((q) => this.t - q.t < 180 && Math.hypot(q.x - top.x, q.y - top.y, q.z - top.z) < 4);
    let best = null, bs = -1e9;
    const list = W.plants.list;
    for (let i = 0, n = Math.min(list.length, 300); i < n; i++) {
      const p = list[i], kind = PERCH_PLANTS[p.id];
      if (!kind) continue;
      const d = Math.hypot(p.pos.x - a.pos.x, p.pos.z - a.pos.z);
      if (d > 40) continue;
      // A broad leaf facing up that the frog can sit on (found on the plant's own mesh), or a reed stem to cling to.
      const c = kind === 'stem' ? this.stemPerch(a, p) : this.leafPerch(p);
      if (!c) continue;
      const top = c.top;
      if (Math.abs(top.x) > TANK.w / 2 - 1 || Math.abs(top.z) > TANK.d / 2 - 1 || !this.perchFits(a, sp, top, kind === 'stem' ? c.glassN : null)) continue;
      const gy = T.heightAt(top.x, top.z);
      if (top.y - gy < 3) continue;
      const wet = W.nearWater(V(top.x, gy, top.z), 12) ? 6 : 0;
      const sc = Math.min(20, top.y - gy) + wet - d * 0.25 + Math.random() * 6 + fav('plant');   // high is good, up to a point
      if (sc <= bs || taken(top)) continue;
      const r = this.perchRoute(a, sp, c);
      if (r) { bs = sc; best = r; }
    }
    // Wood, cork, roots, a stump, a bamboo pole or a floating log: the highest point of its top surface (found by dropping a
    // ray on it at a few points of its footprint).
    for (const pc of W.decor?.pieces ?? []) {
      if (!PERCH_PIECES.has(pc.type)) continue;
      const m = pc.mesh;
      _box.setFromObject(m);
      const cx = (_box.min.x + _box.max.x) / 2, cz = (_box.min.z + _box.max.z) / 2;
      if (Math.hypot(cx - a.pos.x, cz - a.pos.z) > 45) continue;
      let top = null;
      for (let k = 0; k < 5; k++) {
        const px = lerp(_box.min.x, _box.max.x, 0.2 + Math.random() * 0.6), pz = lerp(_box.min.z, _box.max.z, 0.2 + Math.random() * 0.6);
        _ray.set(_t.set(px, _box.max.y + 2, pz), DOWN);
        const hit = _ray.intersectObject(m, false)[0];
        if (hit && (!top || hit.point.y > top.y)) top = V(hit.point.x, hit.point.y + PIECE_GAP, hit.point.z);
      }
      if (!top || Math.abs(top.x) > TANK.w / 2 - 1 || Math.abs(top.z) > TANK.d / 2 - 1 || taken(top) || !this.perchFits(a, sp, top)) continue;
      const gy = T.heightAt(top.x, top.z), over = W.water.surfaceAt(top.x, top.z) > gy;
      if (top.y - gy < 2) continue;
      const sc = Math.min(20, top.y - gy) + (over || W.nearWater(V(top.x, gy, top.z), 12) ? 6 : 0) - Math.hypot(top.x - a.pos.x, top.z - a.pos.z) * 0.25 + Math.random() * 6 + fav('piece');
      if (sc <= bs) continue;
      const r = this.perchRoute(a, sp, { top, piece: pc });
      if (r) { bs = sc; best = r; }
    }
    // The glass: front or side, above the water or the bank, where a reed frog sits pressed flat by day.
    for (let k = 0; k < 4; k++) {
      const side = k === 0 || k === 1 ? 0 : k === 2 ? 1 : -1;
      let x, z, n, yaw;
      if (side === 0) { x = clamp(a.pos.x + (Math.random() - 0.5) * 30, -TANK.w / 2 + 3, TANK.w / 2 - 3); z = TANK.d / 2 - GLASS_GAP; n = GLASS_N.front; yaw = 0; }
      else { x = side * (TANK.w / 2 - GLASS_GAP); z = clamp(a.pos.z + (Math.random() - 0.5) * 16, -TANK.d / 2 + 4, TANK.d / 2 - 3); n = side > 0 ? GLASS_N.right : GLASS_N.left; yaw = side * Math.PI / 2; }
      const bx = x + n.x * 1.2, bz = z + n.z * 1.2;                       // the foot of the climb, a little in from the glass
      const gy = T.heightAt(bx, bz), y = Math.min(TANK.h - 4, Math.max(gy, W.water.level) + 5 + Math.random() * 14);
      const top = V(x, y, z);
      if (y - gy < 4 || taken(top)) continue;
      // (in front of the background relief by its body all the way up, its back too: on a side pane by the back a frog climbed inside it)
      const bb = this.bodyBox(a, sp), R = Math.max(bb.X, -bb.z0, bb.z1) + 0.3, dH = n.x * bb.H;
      let clear = true;
      for (let yy = gy; clear && yy <= y + R; yy += 1.5) clear = z - R >= Math.max(W.wall.zAt(x, yy), W.wall.zAt(x + dH, yy)) + 0.15;
      if (!clear) continue;
      const sc = Math.min(20, y - gy) + (W.nearWater(V(bx, gy, bz), 12) ? 5 : 0) - Math.hypot(x - a.pos.x, z - a.pos.z) * 0.25 + Math.random() * 6 - 2 + fav('glass');
      if (sc <= bs) continue;
      const r = this.perchRoute(a, sp, { top, glassN: n, glassYaw: yaw });
      if (r) { bs = sc; best = r; }
    }
    return best;
  }

  // The way to a perch candidate `c` ({ top, plant | piece | glassN + glassYaw }): `base`, the foot of the climb, and `path`, the
  // points of the climb from the base to the top. Null when there is no way: the foot cannot be walked to in a straight line (over
  // dry ground, or for sp.perchSwim also through water), or the way over the wood has a gap.
  perchRoute(a, sp, c) {
    const W = this.world, T = W.terrain, top = c.top, medium = sp.perchSwim ? 'any' : 'land';
    // in front of the background relief, by more than the push that keeps a body clear of it (clearOfWall)
    const gap = Math.max(0.8, (a.rad ?? 0.5) * 0.9 + 0.4), front = (x, y, z) => Math.max(z, W.wall.zAt(x, y) + gap, W.wall.zAt(x, y + 1.5) + gap);
    const dryAt = (x, z) => !(W.water.surfaceAt(x, z, 0.2) > T.heightAt(x, z) + 0.2);
    let base, path;
    if (c.glassN) {
      // The glass, or a reed stem (`plant`): from the ground in front of it straight up, belly to it.
      // (to the glass until its snout touches it, not through it: then up, turning belly to it)
      const reach = c.plant ? 0 : this.bodyBox(a, sp).z1 + 0.15;
      const n = c.glassN, off = c.plant ? coreR(c.plant) + (a.rad ?? 0.5) * 0.7 + 0.3 : Math.max(1.2, reach + 0.4);
      const bx = top.x + n.x * off, bz = front(bx, T.heightAt(bx, top.z + n.z * off) + 0.1, top.z + n.z * off);
      base = V(bx, T.heightAt(bx, bz), bz);
      const fx = top.x + n.x * reach, fz = top.z + n.z * reach;
      path = [base, V(fx, Math.max(T.heightAt(fx, fz), base.y), fz), top];
    } else if (c.plant) {
      const p = c.plant, gy = T.heightAt(p.pos.x, p.pos.z);
      if (p.pos.y - gy > 1.5) {
        // A wall plant (a bromeliad on the background): up the background from the ground under it.
        const bz = front(top.x, gy + 1, top.z);
        base = V(top.x, T.heightAt(top.x, bz), bz);
        path = [base];
        const n = Math.max(1, Math.ceil((top.y - base.y) / 1.5));
        for (let i = 1; i < n; i++) { const y = lerp(base.y, top.y, i / n); path.push(V(top.x, y, front(top.x, y, lerp(base.z, top.z, i / n)))); }
        path.push(top);
      } else {
        // Up the stem from its foot, on the frog's side of the plant: just outside the stems that walkers are kept out of.
        let ux = a.pos.x - p.pos.x, uz = a.pos.z - p.pos.z;
        const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
        const off = coreR(p) + (a.rad ?? 0.5) * 0.7 + 0.3;
        const bx = p.pos.x + ux * off, bz = front(bx, gy + 1, p.pos.z + uz * off);
        base = V(bx, T.heightAt(bx, bz), bz);
        if (!sp.perchSwim && !dryAt(p.pos.x, p.pos.z)) return null;      // a plant standing in the water
        // up the stem to the height of the leaf, then out along it
        const sz = front(p.pos.x, gy + 1, p.pos.z);
        path = [base, V(p.pos.x, gy + 0.3, sz), V(p.pos.x, Math.max(gy + 0.3, top.y - 0.4), front(p.pos.x, top.y, sz)), top];
      }
    } else {
      // Wood: from just outside its footprint on the frog's side, up its side and along its top (a ray onto it every 0.8 cm).
      const m = c.piece.mesh;
      _box.setFromObject(m);
      const cx = (_box.min.x + _box.max.x) / 2, cz = (_box.min.z + _box.max.z) / 2;
      let dx = a.pos.x - cx, dz = a.pos.z - cz;
      const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
      const rx = (_box.max.x - _box.min.x) / 2 + 1, rz = (_box.max.z - _box.min.z) / 2 + 1, k = Math.min(rx / Math.max(1e-3, Math.abs(dx)), rz / Math.max(1e-3, Math.abs(dz)));
      const bx = clamp(cx + dx * k, -TANK.w / 2 + 1.5, TANK.w / 2 - 1.5), bz = clamp(cz + dz * k, -TANK.d / 2 + 1.5, TANK.d / 2 - 1.5);
      base = V(bx, T.heightAt(bx, bz), bz);
      path = [base];
      const n = Math.min(60, Math.max(2, Math.ceil(Math.hypot(top.x - bx, top.z - bz) / 0.8)));
      let on = false;
      for (let i = 1; i < n; i++) {
        const x = lerp(bx, top.x, i / n), z = lerp(bz, top.z, i / n);
        _ray.set(_t.set(x, _box.max.y + 2, z), DOWN);
        const hit = _ray.intersectObject(m, false)[0];
        if (!hit) {
          if (on) return null;                                           // a gap in the wood
          if (!sp.perchSwim && !dryAt(x, z)) return null;                // water before the wood (a floating log)
          continue;
        }
        const y = hit.point.y + PIECE_GAP;
        if (!on) {
          on = true; const g = Math.max(T.heightAt(x, z), path[path.length - 1].y);
          // Up its side: the points ON the surface (a ray into it from the frog's side every 1.2 cm of height), each with the surface's normal, so it climbs
          // belly to the wood, not along a straight line from the foot to the top through the air (which kept a frog on a pole up to 14 cm off it).
          const ux = (top.x - bx) / Math.max(1e-3, Math.hypot(top.x - bx, top.z - bz)), uz = (top.z - bz) / Math.max(1e-3, Math.hypot(top.x - bx, top.z - bz));
          const side = [];
          for (let h = g + 0.6; h < y - 0.4; h += 1.2) {
            _ray.set(_t.set(x - ux * 3, h, z - uz * 3), _d.set(ux, 0, uz));
            const sh = _ray.intersectObject(m, false)[0];
            if (!sh || !sh.face) continue;
            const N = sh.face.normal.clone().transformDirection(m.matrixWorld);
            if (N.dot(_d) > 0) N.negate();                                // (facing the frog)
            const q = V(sh.point.x + N.x * PIECE_GAP, sh.point.y + N.y * PIECE_GAP, sh.point.z + N.z * PIECE_GAP); q.n = N;
            if (Math.abs(N.y) < 0.85) side.push(q);                       // (a wall, not the top: that is the ray from above's)
          }
          if (side.length >= 2) path.push(...side); else path.push(V(x, g, z));
        }
        path.push(V(x, y, z));
      }
      if (!on) path.push(V(top.x, Math.max(T.heightAt(top.x, top.z), base.y), top.z));
      path.push(top);
    }
    // The foot, and the straight way to it from here.
    const rb = (a.rad ?? 0.5) * 0.9 + 0.1;                              // (clear of the background by its body, as clearOfWall keeps it)
    if (!this.okFor(medium, base.x, base.z, 99, rb)) return null;
    // A swimmer starts a climb from the water at the surface; for a tree frog no point of the climb may be under water.
    for (const q of path) {
      const s = W.water.surfaceAt(q.x, q.z, 0.2);
      if (!(s > q.y)) continue;
      if (!sp.perchSwim) return null;
      q.y = Math.max(q.y, s - 0.35 * sp.size);
    }
    const d = Math.hypot(base.x - a.pos.x, base.z - a.pos.z), n = Math.ceil(d / 0.8);
    for (let i = 1; i < n; i++) if (!this.okFor(medium, lerp(a.pos.x, base.x, i / n), lerp(a.pos.z, base.z, i / n), 99, rb)) return null;
    return { p: top, plant: c.plant ?? null, piece: c.piece ?? null, glassN: c.glassN ?? null, glassYaw: c.glassYaw ?? 0, up: c.up ?? null, base, path };
  }

  // A leaf to sit on: rays dropped onto the plant's mesh (its instance, at its size and lean) at a few points of its crown; the
  // highest hit on a face turned up (a broad leaf, not a blade or a stalk). { top, plant, up } or null.
  leafPerch(p) {
    const PL = this.world.plants, im = PL.meshes?.[PL.key(p)];
    if (!im || p.index == null) return null;
    const geo = im.geometry;
    if (!geo.boundsTree && geo.computeBoundsTree) geo.computeBoundsTree();
    im.getMatrixAt(p.index, _pm.matrixWorld);
    _pm.geometry = geo;
    const h = PL.heightOf(p), r = Math.max(1, (p.reach ?? 3) * (0.3 + 0.7 * (p.grown ?? 1)) * 0.6);
    let best = null;
    for (let k = 0; k < 10; k++) {
      const ang = Math.random() * TAU, rr = r * Math.sqrt(Math.random());
      _ray.set(_t.set(p.pos.x + Math.sin(ang) * rr, p.pos.y + h * 1.3 + 3, p.pos.z + Math.cos(ang) * rr), DOWN);
      const hit = _ray.intersectObject(_pm, false)[0];
      if (!hit?.face) continue;
      const up = hit.face.normal.clone().transformDirection(_pm.matrixWorld);
      if (up.y < 0) up.negate();                                         // (leaves are two-sided)
      if (up.y < 0.6 || (best && hit.point.y <= best.top.y)) continue;
      best = { top: hit.point.clone().addScaledVector(up, 0.35), plant: p, up };
    }
    return best;
  }

  // A reed or sedge stem to cling to, belly to it and head up (as on the glass), on the frog's side of it, half to four fifths up.
  // The frog's side first, then round the stem either way: the first side with room for its whole body as it clings (perchFits) and
  // a foot of the climb that is not a cliff (a side away from a bank left a frog starting up from a 60 degree slope). None: not this stem.
  stemPerch(a, p) {
    const W = this.world, T = W.terrain, h = W.plants.heightOf(p), sp = SPECIES[a.sp];
    let nx = a.pos.x - p.pos.x, nz = a.pos.z - p.pos.z;
    const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
    const a0 = Math.atan2(nx, nz), off = coreR(p) + (a.rad ?? 0.5) * 0.7 + 0.3, f0 = 0.5 + Math.random() * 0.3;
    for (const da of [0, 0.8, -0.8, 1.6, -1.6, 2.4, -2.4]) {
      let ux = Math.sin(a0 + da), uz = Math.cos(a0 + da);
      if (uz < -0.3) { if (da) continue; uz = -0.3; const k = Math.hypot(ux, uz); ux /= k; uz /= k; }   // (not round the back, against the background)
      if (this.cliffAt(p.pos.x + ux * off, p.pos.z + uz * off)) continue;
      const N = V(ux, 0, uz);
      // (half to four fifths up; higher up the stem where the ground beside it is high)
      for (const f of f0 < 0.8 ? [f0, 0.8] : [f0]) {
        const top = V(p.pos.x + ux * 0.7, p.pos.y + h * f, p.pos.z + uz * 0.7);
        if (this.perchFits(a, sp, top, N)) return { top, plant: p, glassN: N, glassYaw: clingYaw(N) };
      }
    }
    return null;
  }

  // --- Crocodile skink ------------------------------------------------------------------------------------------
  // The decisions are in skink.js (pure); this senses the world and carries the intent out: a slow walk on the ground that
  // may wade into shallows, lying flat under the warm spot or in the water, backing into its hide, playing dead.
  skink(a, sp, dt) {
    const W = this.world, T = W.terrain, E = W.env, C = W.climate;
    const m = (a.sk ??= skinkMind());
    a.male ??= Math.random() < 0.5;
    const x = a.pos.x, z = a.pos.z, g = T.heightAt(x, z);
    const depth = W.water.surfaceAt(x, z) - g;
    a.skT = (a.skT ?? 0) - dt;
    if (a.skT <= 0) {
      a.skT = 2.5 + Math.random() * 2;
      if (!a.home || this.skinkHide(a, sp, a.home.x, a.home.z) < 0.35) a.home = this.skinkFindHome(a, sp) ?? a.home ?? null;
      // Two males never share a hide (species data: territorial): the later male picks again while its home is within
      // 2 x rivalCm of an earlier male's home.
      for (let k = 0; k < 4 && a.male && a.home && this.skinkHomeTaken(a, a.home); k++) a.home = this.skinkFindHome(a, sp);
      a.skShore = this.crabFind(x, z, 35, (px, pz, d) => d >= SKINK.soakDepth[0] && d <= SKINK.soakDepth[1]);
      // The nearest cover (S3 `refuge`): where it stands if that is cover already, else the closest land point within 20 cm
      // whose skinkCover is 0.6 or more (0.6 a guess: the 0.5 edge of a patch is reached short by the stop distance).
      // N4b: 8 angles on each ring, rings 1 … 20 cm every 1.5 cm, nearest ring first; the hit is pushed 2 cm further along its
      // ray while cover holds, so the stop (SKINK.inCover short of the point) lands inside the patch, not on its edge.
      let ref = skinkRefugeOk(this.skinkCover(x, z), depth) ? { x, z, r: 0 } : null;   // (N11c: on land only)
      for (let r = 1; !ref && r <= 20; r += 1.5) {
        let best = -1;
        for (let k = 0; k < 8; k++) {
          const t = k * 0.785 + a.phase, sx = Math.sin(t), cz = Math.cos(t), px = x + sx * r, pz = z + cz * r;
          const c = this.okFor('land', px, pz) ? this.skinkCover(px, pz) : 0;
          if (c < 0.6 || c <= best) continue;
          best = c; ref = { x: px, z: pz, r };
          const qx = x + sx * (r + 2), qz = z + cz * (r + 2);
          if (this.okFor('land', qx, qz) && this.skinkCover(qx, qz) >= c) ref = { x: qx, z: qz, r: r + 2 };
        }
      }
      a.skRefuge = ref;
      // The warm spot: the warmest of a ring of points around it (the basking lamp warms the cells under it, climate.js).
      let warm = null;
      for (let k = 0; k < 12; k++) {
        const r = 4 + (k % 3) * 8, t = k * 2.4 + a.phase, px = x + Math.sin(t) * r, pz = z + Math.cos(t) * r;
        if (!this.okFor('land', px, pz)) continue;
        const tp = C.tempAt(px, T.heightAt(px, pz) + 0.5, pz);
        if (!warm || tp > warm.temp) warm = { x: px, z: pz, d: r, temp: tp };
      }
      a.skWarm = warm;
    }
    let threat = this.camThreat(a, 20);
    for (const id of ['toad', 'panther', 'firesal', 'axolotl']) for (const b of this.by[id] ?? []) {
      const d = Math.hypot(b.pos.x - x, b.pos.z - z);
      if (d < SKINK.scareCm * 0.5 && (!threat || d < threat.d)) threat = { x: b.pos.x, z: b.pos.z, d };
    }
    const it = (a.si = skinkThink(m, {
      t: this.t, dt, dtMin: dt * (this.warp ?? 1), x, z, depth, light: clamp(E.bright(), 0, 1), rain: E.rain ?? 0,
      rh: C.humidityAt(x, g + 1, z), temp: C.tempAt(x, g + 0.5, z), wetGround: Math.min(1, T.field.matAt(x, z, MAT.moss) + C.sample(C.soil, x, z) * 0.5),
      cover: this.skinkCover(x, z), hunger: a.hunger, threat, home: a.home, shore: a.skShore,
      refuge: a.skRefuge && { x: a.skRefuge.x, z: a.skRefuge.z, d: Math.hypot(a.skRefuge.x - x, a.skRefuge.z - z) },
      rival: a.male ? this.skinkRival(a, x, z) : null, warm: a.skWarm, hunting: !!a.order,
    }));
    if (it.say && Math.random() < 0.5) W.log(it.say, 'info');
    let goal = it.goal, speed = it.speed;
    if (it.mode === 'hunt' && a.target) { goal = { x: a.target.x, z: a.target.z }; speed = SKINK.speed * 0.7; }
    if (a.lab?.drive) { goal = a.lab.goal; speed = goal ? SKINK.speed * a.lab.k : 0; }          // (the test lab)
    a.state = goal && speed > 0 ? 'walk' : 'rest';
    a.speedNow = 0;
    if (goal && speed > 0) {
      const dx = goal.x - x, dz = goal.z - z, dist = Math.hypot(dx, dz);
      if (dist > 0.25) {
        const step = Math.min(dist, speed * dt);
        let ux = dx / dist, uz = dz / dist;
        const maxD = it.mode === 'flee' && depth > SKINK.maxDepth ? 99 : SKINK.maxDepth;
        if (!this.okFor('any', x + ux * step, z + uz * step, maxD, a.rad) || this.bumps(a, x + ux * step, z + uz * step)) {
          const sd = a.side ?? 1, base = Math.atan2(ux, uz);
          let ok = false;
          for (const da of [0.7 * sd, -0.7 * sd, 1.4 * sd, -1.4 * sd, 2.1 * sd]) {
            const sx = Math.sin(base + da), sz = Math.cos(base + da);
            if (this.okFor('any', x + sx * step, z + sz * step, maxD, a.rad) && !this.bumps(a, x + sx * step, z + sz * step)) { ux = sx; uz = sz; a.side = Math.sign(da) || 1; ok = true; break; }
          }
          if (!ok) { ux = 0; uz = 0; m.goal = null; if (a.order) a.target = null; }
        }
        a.pos.x += ux * step; a.pos.z += uz * step;
        a.speedNow = (ux || uz) ? step / Math.max(1e-4, dt) : 0;
        if (ux || uz) this.turnTo(a, sp, Math.atan2(ux, uz), dt, 5);
      }
    }
    a.pos.y = T.heightAt(a.pos.x, a.pos.z);
    a.normal = T.normalAt(a.pos.x, a.pos.z);
    a.crouch = Math.max(it.flat ?? 0, a.crouch && a.st ? a.crouch : 0) * 0.6;
    a.grazing = it.mode === 'forage' && a.state === 'rest';
    m.sinkNow = lerp(m.sinkNow ?? 0, it.sink ?? 0, Math.min(1, dt * 1.5));
    m.rollNow = lerp(m.rollNow ?? 0, it.roll ?? 0, Math.min(1, dt * 4));
  }

  // The nearest other male skink, for a male (territorial: SPECIES row; species data: never two males).
  skinkRival(a, x, z) {
    let r = null;
    for (const b of this.by.skink ?? []) if (b !== a && b.male) { const d = Math.hypot(b.pos.x - x, b.pos.z - z); if (!r || d < r.d) r = { x: b.pos.x, z: b.pos.z, d }; }
    return r;
  }

  // Whether an earlier male (by order in by.skink) already keeps a home within 2 x rivalCm of p.
  skinkHomeTaken(a, p) {
    for (const b of this.by.skink ?? []) { if (b === a) return false; if (b.male && b.home && Math.hypot(b.home.x - p.x, b.home.z - p.z) < SKINK.rivalCm * 2) return true; }
    return false;
  }

  skinkCover(x, z) { return Math.min(1, this.crabCover(x, z) + this.world.climate.sample(this.world.climate.litter, x, z) * 0.8); }

  // A hide for a skink: cover (wood, cork, a stone overhang, litter, moss), shade, damp air, near (habitat.js hideScore).
  skinkHide(a, sp, x, z) {
    const W = this.world, C = W.climate, g = W.terrain.heightAt(x, z);
    if (!this.okFor('land', x, z)) return 0;
    return hideScore({ cover: this.skinkCover(x, z), light: C.lightAt(x, z), rh: C.humidityAt(x, g + 1, z), rhIdeal: 85, temp: C.tempAt(x, g + 1, z), tIdeal: 25, dist: Math.hypot(x - a.pos.x, z - a.pos.z) });
  }

  skinkFindHome(a, sp) {
    let best = null, bs = 0.3;
    for (let k = 0; k < 20; k++) {
      const r = 2 + Math.random() * 20, t = Math.random() * Math.PI * 2;
      const x = a.pos.x + Math.sin(t) * r, z = a.pos.z + Math.cos(t) * r;
      const sc = this.skinkHide(a, sp, x, z);
      if (sc > bs) { bs = sc; best = { x, z }; }
    }
    return best;
  }

  // --- Vampire crab ----------------------------------------------------------------------------------------------
  // The decisions are in crab.js (pure); this senses the world for it and carries the intent out: a sideways walk in
  // bursts that leads with whichever side needs less turning, stops to face food or another crab, sinks into its burrow.
  crab(a, sp, dt) {
    const W = this.world, T = W.terrain, E = W.env, C = W.climate;
    const P = sp.crabProfile ?? CRAB;
    const m = (a.cb ??= crabMind(Math.random, P));
    a.male ??= Math.random() < 0.35;
    const x = a.pos.x, z = a.pos.z, g = T.heightAt(x, z);
    const depth = W.water.surfaceAt(x, z) - g;
    const dtMin = dt * (this.warp ?? 1);
    // Slow senses (home, shore, a way out) every few seconds; fast ones every step.
    a.cbT = (a.cbT ?? 0) - dt;
    if (a.cbT <= 0 || (depth > 0.2 && !a.cbBank && m.mode === 'exit')) {
      a.cbT = 2 + Math.random() * 2;
      if (!a.home || this.crabHideScore(a, sp, a.home.x, a.home.z) < 0.35) { a.home = this.crabFindHome(a, sp) ?? a.home ?? null; m.digBest = 0; m.digLoads = 0; }
      a.cbDig = this.crabDigSite(a);
      a.cbShore = this.crabFind(x, z, 30, (px, pz, d) => d >= P.soakDepth[0] && d <= P.soakDepth[1]);
      a.cbBank = depth > 0.2 ? this.crabBank(x, z) : null;
      if (P.aquatic && a.cbBank && Math.hypot(a.cbBank.x - x, a.cbBank.z - z) > 40) a.cbBank = null;   // too far to haul out to
    }
    const food = this.crabFood(a, x, z, sp, P);
    let threat = this.camThreat(a, 22);
    for (const id of ['leucomelas', 'dartfrog', 'auratus', 'toad', 'firesal', 'newt', 'axolotl', 'gecko']) for (const b of this.by[id] ?? []) {
      const d = Math.hypot(b.pos.x - x, b.pos.z - z);
      if (d < P.scareCm * sp.size && Math.abs(b.pos.y - a.pos.y) < 6 && (!threat || d < threat.d)) threat = { x: b.pos.x, z: b.pos.z, d };
    }
    let other = null;
    for (const b of this.by[a.sp]) {
      if (b === a || b.dead) continue;
      const d = Math.hypot(b.pos.x - x, b.pos.z - z);
      if (!other || d < other.d) other = { x: b.pos.x, z: b.pos.z, d, male: !!b.male, morph: b.morph ?? null };
    }
    const sense = {
      t: this.t, dt, dtMin, x, z, depth, light: clamp(E.bright(), 0, 1), rain: E.rain ?? 0,
      rh: C.humidityAt(x, g + 1, z), temp: C.tempAt(x, g + 1, z),
      wetGround: Math.min(1, T.field.matAt(x, z, MAT.moss) + (W.nearWater(V(x, g, z), 3) ? 0.5 : 0)),
      cover: this.crabCover(x, z), hunger: a.hunger, food: food && { x: food.p.pos.x, z: food.p.pos.z, d: food.d, kind: food.pid },
      threat, other, home: a.home, shore: a.cbShore, bank: a.cbBank, male: a.male, morph: a.morph ?? null,
      // The pit is measured every step (cheap, and digging changes it at once); the rest of the site every few seconds.
      burrow: a.cbDig && { ...a.cbDig, depth: pitDepth(T.field, a.home.x, a.home.z) },
    };
    const it = (a.ci = crabThink(m, sense, Math.random, P));
    if (a.lab?.drive) this.labCrab(a, P, it);
    if (it.say) W.log(it.say, 'warn');
    if (it.eat && food) {
      if (isItem(food.pid)) { food.p.eaten = true; a.hunger = Math.max(0, a.hunger - FOOD_VALUE[food.pid]); }
      else this.consume(a, sp, food.pid, food.p);
    }
    if (it.drown) { a.health = Math.max(0, a.health - dtMin / 120); if (a.health <= 0) { this.remove(a, 'drowned: it could not climb out of the water'); return; } }
    if (it.dig && a.cbDig) this.crabDig(a, m);
    if (it.badHome) { (this.badHomes ??= []).push({ x: a.home.x, z: a.home.z, until: (E.minute ?? 0) + P.digRest }); a.home = this.crabFindHome(a, sp) ?? null; a.cbDig = this.crabDigSite(a); }
    // Sinking into the ground only reads as a burrow under something (wood, cork, rock overhead); on open soil or moss a crab
    // that sank whole looked like it was melting into the ground, so there it only hunkers down.
    const covered = this.occ.count > 0 && this.occ.solidAt(x, g + 2.5, z);
    m.sinkNow = lerp(m.sinkNow ?? 0, covered ? it.sink : Math.min(it.sink, 0.25), Math.min(1, dt * 1.5));
    // Carry it out.
    a.state = it.goal && it.speed > 0 ? 'walk' : 'rest';
    a.target = it.goal ? V(it.goal.x, 0, it.goal.z) : null;
    if (a.target && it.speed > 0) {
      const dx = it.goal.x - x, dz = it.goal.z - z, dist = Math.hypot(dx, dz);
      if (dist > 0.2) {
        const step = Math.min(dist, it.speed * dt);
        const maxD = m.mode === 'exit' ? 99 : m.mode === 'soak' ? P.soakDepth[1] + 0.5 : P.safeDepth;
        let ux = dx / dist, uz = dz / dist;
        if (!this.okFor('any', x + ux * step, z + uz * step, maxD, a.rad) || this.bumps(a, x + ux * step, z + uz * step)) {
          // Blocked: slide round it, trying the side that worked last time first.
          const sd = a.side ?? 1, base = Math.atan2(ux, uz);
          let ok = false;
          for (const da of [0.7 * sd, -0.7 * sd, 1.4 * sd, -1.4 * sd, 2.1 * sd]) {
            const sx = Math.sin(base + da), sz = Math.cos(base + da);
            if (this.okFor('any', x + sx * step, z + sz * step, maxD, a.rad) && !this.bumps(a, x + sx * step, z + sz * step)) { ux = sx; uz = sz; a.side = Math.sign(da) || 1; ok = true; break; }
          }
          if (!ok) { ux = 0; uz = 0; m.goal = null; }
        }
        a.pos.x += ux * step; a.pos.z += uz * step;
        if (ux || uz) {
          const h = crabHeading(ux, uz, a.yaw ?? 0);
          // Keep the leading side through a burst; choose again when it starts from a standstill.
          if ((a.speedNow ?? 0) < 0.3) m.lead = h.lead;
          const want = Math.atan2(ux, uz) + (m.lead > 0 ? Math.PI / 2 : -Math.PI / 2);
          this.turnTo(a, sp, want, dt, 8);
        }
      }
    } else if (it.face) {
      this.turnTo(a, sp, Math.atan2(it.face.x - x, it.face.z - z), dt, 5);
    }
    a.pos.y = T.heightAt(a.pos.x, a.pos.z);
    a.normal = T.normalAt(a.pos.x, a.pos.z);
    a.grazing = it.mode === 'eat' || it.nose;
  }

  // The crab's home as a dig site (sim/burrow.js): how easily it gives, the soil left above the floor, and where the spoil goes
  // (fixed per home, so the heap grows in one place). Null where it cannot dig: rock, hardscape, standing water.
  crabDigSite(a) {
    const h = a.home;
    if (!h) return null;
    const W = this.world, T = W.terrain;
    if (W.water.surfaceAt(h.x, h.z) > T.heightAt(h.x, h.z) + 0.2) return null;
    const spot = burrowSpot(T.field, h.x, h.z, W.water.erosion?.root);
    if (!spot) return null;
    h.dir ??= spot.dir;
    const sx = h.x + h.dir.x * BURROW.spoil, sz = h.z + h.dir.z * BURROW.spoil;
    if (!this.okFor('land', sx, sz)) h.dir = spot.dir;            // the old side is blocked now (a piece moved there)
    return { want: BURROW.depth, wantMolt: BURROW.depth + 0.4, room: spot.room, rate: spot.rate, spoil: { x: h.x + h.dir.x * BURROW.spoil, z: h.z + h.dir.z * BURROW.spoil } };
  }

  // One load out of the burrow: the soil really moves (bowl to spoil heap), the heap takes the material that was dug, the pit
  // shows bare soil, and the water is told so it commits the new ground (mesh, water, plants).
  crabDig(a, m) {
    const W = this.world, f = W.terrain.field, h = a.home;
    const rim = pitDepth(f, h.x, h.z) + f.sample(h.x, h.z, f.base);
    const want = m.moltIn < 2 * 1440 ? a.cbDig.wantMolt : a.cbDig.want;
    // The material of the dug ground (the heap is made of it).
    let k = MAT.soil, best = -1;
    for (const id of [MAT.soil, MAT.sand, MAT.gravel]) { const w = f.matAt(h.x, h.z, id); if (w > best) { best = w; k = id; } }
    const r = excavate(f, h.x, h.z, { dir: h.dir, bottom: rim - want, root: W.water.erosion?.root, paint: (n, w) => f.paintAt(n, k, 0.3 * w) });
    if (r.moved <= 0) return;
    f.brush(h.x, h.z, BURROW.r * 0.75, 'paint', 0.45, { mat: MAT.soil });     // the pit shows bare damp soil (moss scraped away): a dark mouth
    W.water.groundDisturbed?.();
  }

  // How good a burrow or hide (x, z) is for a crab: cover, shade, damp air, near the animal (habitat.js hideScore).
  crabHideScore(a, sp, x, z) {
    const W = this.world, g = W.terrain.heightAt(x, z), C = W.climate;
    const wet = sp.crabProfile?.aquatic;   // an aquatic crab hides under water: under a root, a slate or a stone
    if (wet ? !this.okFor('water', x, z) : !this.okFor('land', x, z)) return 0;
    if (wet) return hideScore({ cover: this.crabCover(x, z), light: C.lightAt(x, z), rh: 90, rhIdeal: 85, temp: 26, tIdeal: 26, dist: Math.hypot(x - a.pos.x, z - a.pos.z) });
    if (this.badHomes?.some((b) => b.until > (W.env.minute ?? 0) && Math.hypot(b.x - x, b.z - z) < 3)) return 0;
    // Ground it can dig is a burrow to be: better by a stone or a root (it digs in under the edge, and the face holds).
    const T = W.terrain, root = W.water.erosion?.root, rate = digRate(T.field, x, z, root);
    // Room for its body: a home at the foot of a cliff (the stone face of a raised bank, a rock) had the crab resting and digging with
    // half its body and its legs inside the cliff (the ground is a height field: a burrow cannot run in under a bank). Round it, at its
    // trunk's and its legs' reach, the ground may not rise above the pit's rim more steeply than about 40 degrees.
    const bx = this.bodyBox(a, sp), rim = g + Math.max(0, pitDepth(T.field, x, z)), reach = Math.max(bx.X, bx.z1, -bx.z0);
    for (const d of [reach * 0.4, reach * 0.85]) {
      for (let k = 0; k < 8; k++) if (T.heightAt(x + Math.sin(k * Math.PI / 4) * d, z + Math.cos(k * Math.PI / 4) * d) > rim + d * 0.85) return 0;
    }
    let edge = 0;
    if (rate > 0.15) for (let k = 0; k < 8 && !edge; k++) { const t = k * Math.PI / 4; if (digRate(T.field, x + Math.sin(t) * 2.2, z + Math.cos(t) * 2.2, root) < 0.15) edge = 1; }
    const cover = Math.max(this.crabCover(x, z), rate * (0.35 + 0.3 * edge));
    return hideScore({ cover, light: C.lightAt(x, z), rh: C.humidityAt(x, g + 1, z), rhIdeal: 85, temp: C.tempAt(x, g + 1, z), tIdeal: 26, dist: Math.hypot(x - a.pos.x, z - a.pos.z) });
  }

  crabCover(x, z) {
    const W = this.world, T = W.terrain, g = T.heightAt(x, z);
    const over = this.occ.count && this.occ.solidAt(x, g + 2.5, z) ? 1 : 0;      // wood, cork or rock overhead
    const pit = clamp(pitDepth(T.field, x, z) / BURROW.depth, 0, 1) * 0.8;       // a burrow it (or another crab) dug
    return Math.min(1, over + T.field.matAt(x, z, MAT.moss) * 0.6 + pit);
  }

  // A burrow: the best hide among a few dozen spots within 25 cm. Crabs keep it and come back to it.
  crabFindHome(a, sp) {
    let best = null, bs = 0.3;
    for (let k = 0; k < 24; k++) {
      const r = 3 + Math.random() * 22, t = Math.random() * Math.PI * 2;
      const x = a.pos.x + Math.sin(t) * r, z = a.pos.z + Math.cos(t) * r;
      const s = this.crabHideScore(a, sp, x, z);
      if (s > bs) { bs = s; best = { x, z }; }
    }
    return best;
  }

  // The nearest point within maxR cm where ok(x, z, depth) holds (rings outward), or null.
  crabFind(x, z, maxR, ok) {
    const W = this.world;
    for (let r = 1.5; r <= maxR; r += 1.5) {
      const n = Math.max(8, Math.ceil(r * 1.6));
      for (let k = 0; k < n; k++) {
        const t = (k / n) * Math.PI * 2 + r * 0.37, px = x + Math.sin(t) * r, pz = z + Math.cos(t) * r;
        if (Math.abs(px) > TANK.w / 2 - 1 || Math.abs(pz) > TANK.d / 2 - 1) continue;
        const d = W.water.surfaceAt(px, pz) - W.terrain.heightAt(px, pz);
        if (ok(px, pz, d)) return { x: px, z: pz, d: r };
      }
    }
    return null;
  }

  // From water: the nearest dry ground it can walk up to. The way there must not climb more than 1 cm per 0.6 cm (a steep
  // glass-smooth bank traps it) unless hardscape (rock, wood, cork) stands at the water line to climb on.
  crabBank(x, z) {
    const W = this.world, T = W.terrain;
    const climbable = (px, pz) => {
      const L = Math.hypot(px - x, pz - z), n = Math.ceil(L / 0.6);
      let h = T.heightAt(x, z);
      for (let i = 1; i <= n; i++) {
        const qx = x + (px - x) * i / n, qz = z + (pz - z) * i / n, hh = T.heightAt(qx, qz);
        const ramp = this.occ.count && this.occ.solidAt(qx, W.water.surfaceAt(qx, qz) - 0.3, qz);
        if (hh - h > 1 && !ramp) return false;
        h = hh;
      }
      return true;
    };
    return this.crabFind(x, z, 40, (px, pz, d) => !(d > -0.2) && this.okFor('land', px, pz) && climbable(px, pz));
  }

  // The nearest food it can smell: settled flakes and pellets, springtails, resting fruit flies.
  crabFood(a, x, z, sp = SPECIES.crab, P = CRAB) {
    let best = null, bd = P.smell;
    const look = (pid, list, ok) => { for (const p of list ?? []) { if (!ok(p) || !this.validPrey(p, a)) continue; const d = Math.hypot(p.pos.x - x, p.pos.z - z); if (d < bd && Math.abs(p.pos.y - a.pos.y) < 3) { bd = d; best = { pid, p, d }; } } };
    for (const k of Object.keys(ITEMS)) if (dietOf(sp).includes(k)) look(k, this.food, (f) => f.settled && !f.eaten && (f.kind ?? 'flake') === k);
    look('springtail', this.by.springtail, () => true);
    look('fly', this.by.fly, (f) => !f.hop);
    // Other live food on its list (a panther crab takes shrimp and snails off the bottom).
    for (const pid of sp.eats) if (pid !== 'springtail' && pid !== 'fly' && SPECIES[pid] && pid !== a.sp) look(pid, this.by[pid], () => true);
    if (sp.eats.includes('flake') || sp.eats.includes('pellet')) for (const k of ['earthworm', 'cricket']) if (this.by[k]?.length) look(k, this.by[k], () => true);
    return best;
  }

  // Fruit flies: a flightless culture walks, stops to groom, and hops a few centimetres on buzzing wings (crawl with the
  // 'flutter' leap). They used to cruise more than a centimetre above the ground, which a fly that cannot fly does not do.
  fly(a, sp, dt) {
    if (a.state === 'fly') { a.state = 'rest'; a.timer = 0; }                 // (a save from when they flew)
    this.crawl(a, sp, dt, 'land', { restP: 0.45, rest: [0.8, 4], speed: 0.35 });
  }

  // --- Frogs and toads ---------------------------------------------------------
  // Sit-and-wait animals. A frog sits still for tens of seconds to minutes (breathing, blinking, small head turns,
  // see vis()), then makes one short burst: it turns to face the way, crouches, and makes one to three small hops
  // (toads) or walks a few centimetres (poison frogs, who also make short hops). How long it sits depends on the
  // time of day, rain, hunger, humidity and whether it is uneasy (activity()). Heading persists from burst to
  // burst. A hop is a real ballistic arc: it only goes where the frog can land (dry, not too steep, not too high,
  // nobody there) and never crosses water the arc wouldn't clear. A dart frog that ends up in water paddles to the
  // nearest bank and climbs out; toads like the water and float at the surface, kicking along.
  // Hunting: see hunter() (an order from the sim, or an ambush when very hungry) and strikes().
  frog(a, sp, dt) {
    const W = this.world, T = W.terrain;
    const toad = sp.kind === 'toad';
    const dtS = dt / this.tf;
    if (a.hop) {
      const hp = a.hop;
      hp.t += dtS / hp.dur;
      const t = Math.min(1, hp.t);
      if (hp.plan) {
        // along a real frog's path (util/hop.js): its reference point forward along the line to the landing place and up
        const at = hopAt(hp.plan, t), d = Math.max(1e-6, hp.plan.d);
        a.pos.lerpVectors(hp.from, hp.to, Math.min(1, at.pos[2] / d));
        a.pos.y = hp.from.y + at.pos[1];
        a.pitch = hopPitch(hp.plan, at);
      } else {
        a.pos.lerpVectors(hp.from, hp.to, t);
        a.pos.y += 4 * hp.h * t * (1 - t);
        a.pitch = -Math.atan2(hp.to.y - hp.from.y + 4 * hp.h * (1 - 2 * t), Math.max(0.1, hp.from.distanceTo(hp.to))) * 0.6;
      }
      // (the twist toward the landing is made as the legs push off and in the first part of the flight, not in one frame)
      if (hp.y1 != null) a.yaw = hp.y0 + angDiff(hp.y1, hp.y0) * Math.min(1, t / 0.3);
      if (t >= 1) {
        a.hop = null;
        a.pitch = 0;
        a.settle = 1;
        this.frogEnd(a, sp, true);
        if (hp.splash) W.fx?.addDrop(a.pos.x, a.pos.z, -7, 1.2);       // (a frog landing in the water: a real splash)
      }
      return;
    }
    const g = T.heightAt(a.pos.x, a.pos.z);
    const s = W.water.surfaceAt(a.pos.x, a.pos.z, 0.2);
    const inWater = s > g + (a.swimming ? 0.5 : 0.9) * sp.size;      // (once swimming, it swims on through the shallows to its bank)
    if (inWater && !a.swimming) { a.sw = swimState(); a.wetT = 0; a.wetStay = 90 + Math.random() * 240; a.dive = null; a.diveP = 0; }   // (into the water: legs drawn up, and it kicks off)
    if (!inWater && a.swimming) { a.dryT = 0; a.dive = null; a.diveP = 0; }
    a.swimming = inWater;
    a.timer -= dt;
    if (inWater) { a.wetT = (a.wetT ?? 0) + dtS; this.frogSwim(a, sp, dt, s, toad); a.fs = null; return; }
    a.dryT = (a.dryT ?? 0) + dtS;
    a.pos.y = g;
    a.normal = T.normalAt(a.pos.x, a.pos.z);
    if (!a.fs) { a.fs = 'sit'; a.fsT = this.pickSit(a, sp) * Math.random(); a.chain = 0; a.crouch = 0; }
    switch (a.fs) {
      case 'sit': {
        a.fsT -= dt * (a.order || a.lab?.goal ? 1 : this.warp);
        a.crouch = Math.max(0, (a.crouch ?? 0) - dtS * 4);
        if (a.lab?.goal && !a.lab.kicked) { a.lab.kicked = true; a.fsT = Math.min(a.fsT, 0.3); }      // (a driven frog does not sit out its long rest)
        if (a.order && !a.order.kicked) { a.order.kicked = true; a.fsT = Math.min(a.fsT, 0.4 + Math.random() * 1.2); }
        if (a.fsT <= 0) this.frogPlan(a, sp);
        break;
      }
      case 'turn': {
        // Face the way first (a deliberate turn on the spot, stepping round about the hips: turnTo), then crouch or walk.
        this.turnTo(a, sp, a.faceTo, dtS, 10);
        if (Math.abs(angDiff(a.faceTo, a.yaw)) < 0.02) {
          a.yaw = a.faceTo;
          // (turning about the hips carried the body's middle round: the planned leap or walk goes with it, so it still runs straight ahead)
          const p = a.plan;
          if (p?.x0 != null) { p.to.x += a.pos.x - p.x0; p.to.z += a.pos.z - p.z0; p.x0 = a.pos.x; p.z0 = a.pos.z; }
          a.fs = a.afterTurn ?? 'sit';
          a.walkT = 0;
          if (a.fs === 'crouch') a.fsT = 0.22 + Math.random() * 0.25;
          else if (a.fs === 'sit') a.fsT = a.order || a.lab?.goal ? 0.2 : this.pickSit(a, sp, true);
        }
        break;
      }
      case 'crouch': {
        // Anticipation: sink onto the hind legs, then spring.
        a.crouch = Math.min(1, (a.crouch ?? 0) + dtS * 5);
        a.fsT -= dtS;
        if (a.fsT <= 0) {
          const p = a.plan;
          a.crouch = 0;
          if (!(p && this.hopTo(a, sp, p.to, p.water))) { a.fs = 'sit'; a.fsT = 1 + Math.random() * 3; a.hopFail = (a.hopFail ?? 0) + 1; a.chain = 0; }
        }
        break;
      }
      case 'walk': this.frogWalk(a, sp, dtS); break;
    }
  }

  // Back to sitting after a hop or a walk: the next segment of the burst soon, else a long sit.
  frogEnd(a, sp, hopped) {
    a.hopFail = 0;
    a.fs = 'sit';
    if (a.lab?.goal) { a.chain = 0; a.chainNext = false; a.fsT = hopped ? 0.35 + Math.random() * 0.35 : 0.1; return; }   // (the test lab: a driven frog goes on after the pause between two hops)
    if (a.chain > 0) { a.chain--; a.chainNext = true; a.fsT = hopped ? 0.35 + Math.random() * 0.5 : 0.8 + Math.random() * 2; }
    else { a.chainNext = false; a.fsT = a.order || a.lab?.goal ? 0.5 + Math.random() * 0.5 : this.pickSit(a, sp); }
  }

  // How long to sit (animal seconds at 1x; counted down faster at high speed so the pace per game hour stays).
  pickSit(a, sp, short = false) {
    if (short) return 0.6 + Math.random() * 2.5;
    let base = 6 + -Math.log(1 - Math.random()) * 38;
    if (Math.random() < 0.12) base *= 3;
    if (sp.kind === 'toad') base *= 1.3;
    return clamp(base, 5, 420) / this.activity(a, sp);
  }

  // 0.15 … 3.5: how active a land sit-and-wait animal is now.
  activity(a, sp) {
    const E = this.world.env;
    const light = clamp(E.bright(), 0, 1);
    let act = 0.3 + 0.9 * light;                                 // quiet at night, active in the light period
    act *= 1 + 1.4 * (E.rain ?? 0);                              // out and about after rain
    act *= 0.75 + 0.7 * clamp(a.hunger, 0, 1);
    const RH = a.RH ?? E.humidity;
    act *= clamp(0.55 + (RH - (sp.humidity ?? 60)) / 40, 0.45, 1.3);
    if ((a.why?.length ?? 0) > 0) act *= 1.6;                    // uneasy: searching for a better spot
    return clamp(act, 0.15, 3.5);
  }

  // Choose the next burst: toward prey when hunting, else a wander with a persistent heading.
  frogPlan(a, sp) {
    const W = this.world, T = W.terrain, toad = sp.kind === 'toad';
    const o = a.order, lg = a.lab?.goal;
    let plan = null, chain = 0;
    if (lg) {
      plan = this.labFrogPlan(a, sp, lg);
      if (plan === 'wait') { a.fsT = 0.25; return; }
    } else if (o && this.validPrey(o.target, a)) {
      const p = o.target.pos, dx = p.x - a.pos.x, dz = p.z - a.pos.z, d = Math.hypot(dx, dz);
      const reach = this.reachOf(a, sp), gap = d - reach * 0.6, ang = Math.atan2(dx, dz);
      if (gap < 0.4) { a.fsT = 0.25; return; }                 // close enough: hunter() will aim and strike
      const walk = !toad && d < 9 + 3 * Math.random();
      for (const f of [1, 0.7, 0.45]) {
        const len = walk ? Math.min(gap, 1.4 + Math.random() * 1.8) * f : clamp(gap, 1.5, 5.5 * sp.size) * f;
        plan = this.checkPlan(a, sp, walk ? 'walk' : 'hop', V(a.pos.x + Math.sin(ang) * len, 0, a.pos.z + Math.cos(ang) * len), ang, false);
        if (plan) break;
      }
    } else {
      const E = W.env, light = clamp(E.bright(), 0, 1);
      const uneasy = (a.why?.length ?? 0) > 0, cont = !!a.chainNext;
      // (a fire-bellied toad spends much of its day in the water: after a while on land it makes for the nearest it can find)
      const wantWater = toad && !cont && a.hunger < 0.6 && Math.random() < ((a.dryT ?? 0) > 25 ? 0.7 : 0.15);
      const pond = wantWater ? this.crabFind(a.pos.x, a.pos.z, 30, (px, pz, d) => d > 1.2 * sp.size) : null;
      const hd0 = pond ? Math.atan2(pond.x - a.pos.x, pond.z - a.pos.z) : a.hd ?? a.yaw;
      const mid = (sp.temp[0] + sp.temp[1]) / 2;
      const cands = [];
      for (let k = 0; k < (uneasy ? 14 : 8); k++) {
        let ang = hd0 + gauss() * (cont ? 0.3 : pond ? 0.25 : 0.6);
        if (k >= 5 || (uneasy && k >= 3)) ang = Math.random() * Math.PI * 2;                       // now and then somewhere else entirely
        else if (!cont && !pond && k === 4) ang = hd0 + Math.PI * (0.7 + 0.6 * Math.random());    // turn back
        const walk = cont && a.plan ? a.plan.type === 'walk' : toad ? Math.random() < (pond ? 0 : 0.2) : Math.random() < 0.68;
        const len = pond && k < 4 ? Math.min(pond.d + 1.5, (2.2 + Math.random() * 2.4) * 1.7) : (walk ? 2 + Math.random() * 5 : (1.4 + Math.random() * 2.6) * (toad ? 1.7 : 1)) * (uneasy ? 1.8 : 1);
        const to = V(a.pos.x + Math.sin(ang) * len, 0, a.pos.z + Math.cos(ang) * len);
        const g = T.heightAt(to.x, to.z);
        let sc = this.comfortAt(sp, to.x, g, to.z) * (uneasy ? 6 : 3) + Math.random() * 0.8 + Math.cos(ang - hd0) * 0.4;
        // Cover and moss at night, a warm spot by day.
        const cover = this.occ.count && this.occ.solidAt(to.x, g + 3, to.z) ? 1 : 0;
        sc += (cover + T.field.matAt(to.x, to.z, MAT.moss)) * (1.6 * (1 - light) + 0.4);
        sc += clamp((W.climate.tempAt(to.x, g, to.z) - mid) / 5, -0.6, 0.6) * light * 0.8;
        if (pond && k < 4) sc += 3;                                    // (toward the water first)
        cands.push({ to, ang, walk, sc });
      }
      cands.sort((p, q) => q.sc - p.sc);
      for (const c of cands) { plan = this.checkPlan(a, sp, c.walk ? 'walk' : 'hop', c.to, c.ang, wantWater && !c.walk); if (plan) break; }
      if (plan) chain = plan.type === 'hop' ? (Math.random() * 2.6 | 0) + (uneasy ? 1 : 0) : Math.random() < 0.4 ? 1 : 0;
    }
    if (!plan) { a.hopFail = (a.hopFail ?? 0) + 1; a.fsT = lg ? 0.6 : 1.5 + Math.random() * 3; a.chain = 0; a.chainNext = false; return; }
    a.plan = plan; a.hd = plan.ang; a.chain = chain; plan.x0 = a.pos.x; plan.z0 = a.pos.z;
    a.faceTo = plan.ang; a.afterTurn = plan.type === 'hop' ? 'crouch' : 'walk';
    a.fs = 'turn'; a.crouch = 0; a.walkT = 0;
  }

  // A burst segment that can be done from here: { type, to, ang, water, v } or null.
  checkPlan(a, sp, type, to, ang, water) {
    if (type === 'hop') return this.hopCheck(a, sp, to.clone(), water) ? { type, to, ang, water, v: 1 } : null;
    const medium = this.mediumOf(sp);
    for (const f of [0.3, 0.6, 1]) {
      const x = a.pos.x + (to.x - a.pos.x) * f, z = a.pos.z + (to.z - a.pos.z) * f;
      if (!this.okFor(medium, x, z) || (this.cliffAt(x, z) && !this.cliffAt(a.pos.x, a.pos.z))) return null;     // (offCliff would undo every step)
    }
    if (this.crowded(a, sp, to.x, to.z)) return null;
    return { type, to, ang, water: false, v: 0.7 + Math.random() * 0.7 };
  }

  frogWalk(a, sp, dtS) {
    const p = a.plan;
    if (!p) { this.frogEnd(a, sp, false); return; }
    const dx = p.to.x - a.pos.x, dz = p.to.z - a.pos.z, d = Math.hypot(dx, dz);
    a.walkT = (a.walkT ?? 0) + dtS;
    let ok = d > 0.2 && a.walkT < 14;
    // No headway for 0.6 s (each step undone: a cliff under the snout, offCliff; a neighbour; a bank): it stops instead of treading on the spot.
    if (!(d > (p.best ?? Infinity) - 0.05)) { p.best = d; p.bestT = a.walkT; } else if (a.walkT - p.bestT > 0.6) ok = false;
    if (ok) {
      const v = sp.speed * 2.0 * p.v * Math.min(1, 0.35 + d * 0.5);       // about 2 cm/s, easing in to the stop
      const step = Math.min(d, v * dtS);
      const nx = a.pos.x + dx / d * step, nz = a.pos.z + dz / d * step;
      if (this.okFor(this.mediumOf(sp), nx, nz) && !this.crowded(a, sp, nx, nz) && !this.walkBlocked(a, nx, nz)) { a.pos.x = nx; a.pos.z = nz; a.pos.y = this.world.terrain.heightAt(nx, nz); a.hopFail = 0; }
      else ok = false;
      this.turnTo(a, sp, Math.atan2(dx, dz), dtS, 6);
    }
    if (!ok) this.frogEnd(a, sp, false);
  }

  // A careful step (kept for callers; the state machine in frog() walks by itself).
  frogStep(a, sp, dir, dt) {
    const W = this.world;
    const d = dir.clone().setY(0).normalize().multiplyScalar(sp.speed * 0.6 * dt);
    const nx = a.pos.x + d.x, nz = a.pos.z + d.z;
    if (W.water.surfaceAt(nx, nz, 0.3) > -Infinity || !this.okFor('land', nx, nz)) return false;
    a.pos.x = nx; a.pos.z = nz;
    a.pos.y = W.terrain.heightAt(nx, nz);
    return true;
  }

  // A frog in water deep enough to float: a breaststroke. The legs kick (the stroke is a cycle, `a.kick` in cycles, drawn
  // by the rig's swim pose, see util/gait.js frogSwimPose) and the animal moves in pulses: a surge as the legs drive, then a
  // glide (kickSpeed). Dart frogs avoid deep water and head for the nearest bank at once, kicking hard; a toad floats about and
  // now and then decides to climb out.
  frogSwim(a, sp, dt, s, toad) {
    const W = this.world, T = W.terrain, prof = swimProfile(a.sp), ground = T.heightAt(a.pos.x, a.pos.z), top = s - this.swimDepth(a, sp);
    a.normal = null;
    // (under the water: a dive to the bottom, a rest there, the swim back up: frogDive runs it until the frog is at the surface again)
    if (a.dive && this.frogDive(a, sp, dt, s, top, ground)) return;
    a.diveP = (a.diveP ?? 0) * Math.max(0, 1 - dt * 4);
    a.pos.y = Math.max(top, ground);
    if (!a.shore || a.timer <= 0) {
      a.timer = 4 + Math.random() * 4;
      // (the way out it was making for, if any: kept below when a new look finds none nearer)
      const prev = a.shore && !a.roam && (a.shoreLand || a.exit) ? { shore: a.shore, land: a.shoreLand, exit: a.exit } : null;
      a.shore = null; a.shoreLand = null; a.roam = false; a.toBank = null;
      // A frog that has no business in the water makes for the way out at once. One at home in it (a toad) stays: it rests at the
      // surface, potters about, dives, and leaves when it has had its time in the water (or is hungry: it hunts on land).
      const leave = !toad || Math.random() < ((a.wetT ?? 0) > (a.wetStay ?? 120) || a.hunger > 0.6 ? 0.5 : 0.04);
      if (leave) {
        a.floating = false;
        // The way out: along each of 32 lines the first dry ground (the bank it would swim into: land beyond a bank is not reached by
        // swimming, and swimming at it had a frog pushed back off that bank for minutes), and the nearest of those it can climb
        // (shoreLand), however far across the water it is: a frog sees the far bank of a pool and makes for it. It keeps making for
        // the way out it has unless it now sees a nearer one (the lines fan out with distance and can miss a far bank from one
        // place and find it from the next). Nowhere to climb out seen: it swims to the nearest bank and along it (each stretch it
        // tried counts as no good), where the lines lie close and find a place to get out. (Looking only 30 cm out, and roaming
        // at random when that found nothing, a bumblebee toad dropped in the middle of a big lagoon zigzagged about for up to a
        // minute and a half before it got out.)
        // (A frog grips what it meets: where the bank is too steep to hop out onto it climbs the face (exitClimb: rock, soil, a root
        // or a stem at the waterline, as a real one pulls itself out), and a frog with toe pads climbs the glass (exitGlass). The
        // nearest way out wins; a climb counts a little further than a hop.)
        let best = Infinity, near = null;
        const bad = (x, z) => a.badShore?.some(([bx, bz, br]) => Math.hypot(x - bx, z - bz) < (br ?? 2));
        a.exit = null;
        for (let k = 0; k < 32; k++) {
          const ang = (k / 32) * TAU, ux = Math.sin(ang), uz = Math.cos(ang);
          for (let r = 1; r < EXIT_LOOK && r < best; r++) {
            const x = a.pos.x + ux * r, z = a.pos.z + uz * r;
            if (Math.abs(x) > TANK.w / 2 - 2 || Math.abs(z) > TANK.d / 2 - 2) {
              const ex = this.exitGlass(a, sp, x, z, s), e = ex?.path[ex.path.length - 1];
              if (ex && r + ex.cost < best && !bad(e.x, e.z)) { best = r + ex.cost; a.shore = V(ex.path[0].x, 0, ex.path[0].z); a.shoreLand = null; a.exit = ex; }
              break;
            }
            if (W.water.surfaceAt(x, z, 0.3) !== -Infinity) { if (this.avoid && this.occ.solidAt(x, a.pos.y, z)) break; continue; }   // (a rock in the way; one out of the water is a bank)
            if (bad(x, z)) break;
            // (the nearest bank it could swim up to: not the background, whose relief stands in the water like a wall)
            if ((!near || r < near.r) && z > W.wall.zAt(x, s) + 1.5) near = { r, x: a.pos.x + ux * (r - 1.2), z: a.pos.z + uz * (r - 1.2), bx: x, bz: z };
            const land = this.shoreLand(a, sp, x, z, ang);
            if (land) { best = r; a.shore = V(x, 0, z); a.shoreLand = land; a.exit = null; break; }
            const ex = this.exitClimb(a, sp, x, z, ang, s);
            if (ex && r + 1 < best) { best = r + 1; a.shore = V(x, 0, z); a.shoreLand = null; a.exit = ex; }
            break;
          }
        }
        if (prev && Math.hypot(prev.shore.x - a.pos.x, prev.shore.z - a.pos.z) < best && !bad(prev.shore.x, prev.shore.z)
          && (!prev.land || W.water.surfaceAt(prev.land.x, prev.land.z, 0.3) === -Infinity)) {
          a.shore = prev.shore; a.shoreLand = prev.land; a.exit = prev.exit;
        }
        // (a stretch of bank tried and found no good counts 5 cm wide: it goes along the bank by that much, not by a toe's width)
        if (!a.shore && !toad && near) { a.shore = V(near.x, 0, near.z); a.roam = true; a.toBank = [near.bx, near.bz, 5]; a.toBankNear = null; a.toBankT = 0; }
        if (!a.shore && !toad) {
          for (let k = 0; k < 8 && !a.shore; k++) {
            const ang = Math.random() * TAU, r = 5 + Math.random() * 6;
            let ok = true;
            for (let i = 1; ok && i <= r; i++) {
              const x = a.pos.x + Math.sin(ang) * i, z = a.pos.z + Math.cos(ang) * i;
              ok = Math.abs(x) < TANK.w / 2 - 2 && Math.abs(z) < TANK.d / 2 - 2 && W.water.surfaceAt(x, z, 0.3) - T.heightAt(x, z) > 0.5 * sp.size && !(this.avoid && this.occ.solidAt(x, a.pos.y, z));
            }
            if (ok) { a.shore = V(a.pos.x + Math.sin(ang) * r, 0, a.pos.z + Math.cos(ang) * r); a.roam = true; }
          }
        }
      } else {
        const ang = Math.random() * Math.PI * 2, u = Math.random();
        a.shore = V(a.pos.x + Math.sin(ang) * 6, 0, a.pos.z + Math.cos(ang) * 6);
        // rest at the surface (most of the time, and for a good while), potter off somewhere, or dive (where the water is deep
        // enough to)
        if (prof.dive && u < 0.1 && top - ground > 2.2 * sp.size) { a.floating = false; a.dive = { ph: 'down', t: 0 }; }
        else if (u < 0.35) { a.floating = false; a.roam = true; a.shore = V(a.pos.x + Math.sin(ang) * (5 + Math.random() * 8), 0, a.pos.z + Math.cos(ang) * (5 + Math.random() * 8)); }
        else { a.floating = true; a.roam = true; a.timer = 15 + Math.random() * 25; }
      }
    }
    // The stroke (util/gait.js, the species' SWIM profile): how urgent it is sets the beat, bursts of kicks, surge and glide. A frog
    // making for its way out kicks with both legs; a toad at home in the water potters about, one leg after the other. It steers
    // with its legs: the leg on the inside of a turn trails while the outer one drives.
    const want = a.shore ? Math.atan2(a.shore.x - a.pos.x, a.shore.z - a.pos.z) : a.yaw;
    // The heading changes only through the legs (util/swimturn.js); a push queued by separate()/nudge() is released by a kick.
    // A frog facing well away from where it is going and nearly stopped pivots on the spot instead of waiting for a stroke: the sim only
    // asks for the intent (sw.spin = +-1); the spin is a body movement (util/gait.js spinStep: head, torso, then hands and legs) whose
    // thrust turns it, and it stops asking when it is within 0.9 rad.
    const err = a.shore && !a.floating ? angDiff(want, a.yaw) : 0, sw0 = a.sw;
    if (sw0) { if (Math.abs(err) > 1.57 && sw0.v < 1.5) sw0.spin = Math.sign(err); else if (Math.abs(err) < 0.9) sw0.spin = 0; }
    const spin = sw0 && sw0.spin && Math.abs(err) > 0.9;
    const urg = a.floating ? 0.1 : toad ? (a.roam || !a.exit && !a.shoreLand ? 0.25 : 0.6) : 0.95;
    let v = this.swimClock(a, sp, urg, dt, angDiff(want, a.yaw) / 0.9, false, spin ? { spin: sw0.spin, spinErr: Math.abs(err), spinHz: spinHz(urg) } : { spinHz: spinHz(urg) });
    const sw = a.sw, spinning = !!(sw.sp && sw.sp.run);      // (a thrust begun is finished after the intent is dropped)
    const mo = swimMotion(a.sw, swimProfile(a.sp), spinning ? { intent: 'spin', dir: sw.sp.dir } : {}, dt);
    a.yaw += mo.dyaw;
    if ((mo.px || mo.pz) && this.occ.segmentFreeAt(a, a.pos.x, a.pos.y, a.pos.z, a.pos.x + mo.px, a.pos.y, a.pos.z + mo.pz) >= 1) { a.pos.x += mo.px; a.pos.z += mo.pz; a.sw.pushOut = Math.hypot(mo.px, mo.pz); } else if (a.sw) a.sw.pushOut = 0;
    if (!a.shore) return;
    const dir = V(a.shore.x - a.pos.x, 0, a.shore.z - a.pos.z);
    const dist = dir.length();
    if (spinning) v = 0;
    const nx = a.pos.x + Math.sin(a.yaw) * v * dt, nz = a.pos.z + Math.cos(a.yaw) * v * dt;
    // (resting or pottering it stays in water it can swim in: it turns back from the shallows instead of drifting ashore; one making
    // for a bank swims on into them)
    if ((a.roam || a.floating) && !a.toBank && !(W.water.surfaceAt(nx, nz, 0.2) > T.heightAt(nx, nz) + 1.1 * sp.size)) { a.shore = null; a.timer = 0; return; }
    const inTank = (x, z) => Math.abs(x) < TANK.w / 2 - 1 && Math.abs(z) < TANK.d / 2 - 1;
    if (this.avoid && this.occ.solidAt(nx, a.pos.y, nz)) {
      // A rock or a root in the way. It slides along it (a stroke angled off to one side or the other, the nearest that is clear),
      // keeping its goal. Only when it faces its goal and nothing near that way is clear is the goal no good: still turning toward
      // it, the rock was in the way it happened to face (a frog pressed against a sunken root blamed every way out it thought of,
      // the far ones behind it too, until it had none left and paddled on the spot for minutes).
      let slid = false;
      for (const d of [0.5, -0.5, 1, -1, 1.5, -1.5]) {
        const sx = a.pos.x + Math.sin(a.yaw + d) * v * dt, sz = a.pos.z + Math.cos(a.yaw + d) * v * dt;
        if (inTank(sx, sz) && !this.occ.solidAt(sx, a.pos.y, sz) && W.water.surfaceAt(sx, sz, 0.2) > -Infinity) { a.pos.x = sx; a.pos.z = sz; slid = true; break; }
      }
      if (!slid && Math.abs(angDiff(want, a.yaw)) < 0.6) {
        const bad = a.toBank ?? (!a.roam ? [a.shore.x, a.shore.z] : null);
        if (bad) { (a.badShore ??= []).push(bad); if (a.badShore.length > 8) a.badShore.shift(); }
        a.shore = null; a.timer = 0; a.toBank = null;
      }
    } else if (inTank(nx, nz)) { a.pos.x = nx; a.pos.z = nz; }
    if (!a.shore) return;
    if (a.roam) {
      // (at the bank it swam to for want of a way out, or as near it as the rock lets it come (no closer for two seconds:
      // a bank under a steep face can keep a body further off than a centimetre, and it swam at the same spot for a minute): that
      // stretch is no good, the next look goes along the bank from here)
      if (a.toBank) {
        if (dist < (a.toBankNear ?? Infinity) - 0.3) { a.toBankNear = dist; a.toBankT = 0; } else a.toBankT = (a.toBankT ?? 0) + dt / this.tf;
      }
      if (dist < 1 || (a.toBank && a.toBankT > 1.8)) {
        if (a.toBank) { (a.badShore ??= []).push(a.toBank); if (a.badShore.length > 8) a.badShore.shift(); a.toBank = null; }
        a.toBankNear = null; a.toBankT = 0;
        a.shore = null; a.timer = 0;
      }
      return;
    }
    // At the foot of its climb (its snout at the bank or the glass): it takes hold and climbs out (perchFrog, phase 'up').
    if (a.exit) {
      const f = a.exit.path[0];
      if (Math.hypot(f.x - a.pos.x, f.z - a.pos.z) < (a.exit.kind === 'glass' ? 0.8 : this.bodyBox(a, sp).z1 + 0.8)) this.startExit(a, sp);
      return;
    }
    // Close to the bank: climb out with a hop. A clean one if it can (hopCheck: the arc clears the bank, it lands clear of stems, the
    // relief and a cliff), at the spot it swam for or one beside it; else it scrambles up onto the bank there (an arc over the lip),
    // unless the relief or a plant's stems would push it straight back off (hopping up anywhere dry put a frog on a ledge by the
    // background, pushed off it into the water again, for minutes); then that bit of shore is no good and it looks for another.
    if (dist < 2.5 * sp.size) {
      const sx = a.shore.x, sz = a.shore.z, a0 = Math.atan2(sx - a.pos.x, sz - a.pos.z);
      let out = !!a.shoreLand && this.hopTo(a, sp, a.shoreLand.clone());
      for (let k = 0; k < 14 && !out; k++) {
        const ang = a0 + (k % 7 ? ((k % 7) % 2 ? 1 : -1) * Math.ceil((k % 7) / 2) * 0.35 : 0), r = dist + (k < 7 ? 0 : 1);
        const to = V(a.pos.x + Math.sin(ang) * r, 0, a.pos.z + Math.cos(ang) * r);
        if (W.water.surfaceAt(to.x, to.z, 0.3) === -Infinity) out = this.hopTo(a, sp, to);
      }
      const to = (a.shoreLand ?? a.shore).clone();
      if (!out && W.water.surfaceAt(to.x, to.z, 0.3) === -Infinity) {
        to.y = T.heightAt(to.x, to.z);
        const rise = to.y - a.pos.y;
        if (rise < 6 * sp.size && this.wallNeed(a, to.x, to.y, to.z, a0, false) <= 0.05 && !this.stemDepth(a, to.x, to.y, to.z, a0)) { this.startHop(a, to, 0.5 + dist * 0.25 + Math.max(0, rise)); out = true; }
      }
      if (out) a.badShore = null;
      else { (a.badShore ??= []).push([sx, sz]); if (a.badShore.length > 8) a.badShore.shift(); }
      a.shore = null;
    }
  }

  // Under the water (a frog at home in it: SWIM `dive`): it tips its nose down and kicks to the bottom, sits there a while as it
  // sits on land, then pushes off and kicks up to the surface, where it rests. `top`: where it lies at the surface, `ground`: the
  // bottom under it. Returns true while the dive goes on. (Seen in film of a leopard frog in a basin and of a frog in a pool.)
  frogDive(a, sp, dt, s, top, ground) {
    const D = a.dive, bottom = ground + 0.05, lean = (to) => { a.diveP = (a.diveP ?? 0) + (to - (a.diveP ?? 0)) * Math.min(1, dt * 3); };
    const free = (x, y, z) => Math.abs(x) < TANK.w / 2 - 1.5 && Math.abs(z) < TANK.d / 2 - 1.5 && !(this.avoid && this.occ.solidAt(x, y, z)) && this.world.water.surfaceAt(x, z, 0.3) > -Infinity;
    // (forward and up or down together if the way is clear, else only up or down, else only forward: it slides along what it meets)
    const go = (v, dy) => {
      const nx = a.pos.x + Math.sin(a.yaw) * v * dt, nz = a.pos.z + Math.cos(a.yaw) * v * dt, ny = Math.max(bottom, Math.min(top, a.pos.y + dy * dt));
      if (free(nx, ny, nz)) { a.pos.x = nx; a.pos.z = nz; a.pos.y = ny; return true; }
      if (free(a.pos.x, ny, a.pos.z)) { a.pos.y = ny; return true; }
      if (free(nx, a.pos.y, nz)) { a.pos.x = nx; a.pos.z = nz; }
      return false;
    };
    a.floating = false;
    D.t += dt;
    if (D.ph === 'down') {
      lean(0.75);
      const v = this.swimClock(a, sp, 0.7, dt);
      // down to the bottom, or onto whatever lies in the way (a sunken branch, a stone)
      const ok = go(v * Math.cos(a.diveP), -(v * Math.sin(a.diveP) + 0.6));
      if (!ok || a.pos.y <= bottom + 0.02 || D.t > 12) { D.ph = 'sit'; D.t = 0; D.len = 4 + Math.random() * 14; }
    } else if (D.ph === 'sit') {
      lean(0);
      this.swimClock(a, sp, 0, dt, 0, true);
      if (D.t > D.len) { D.ph = 'up'; D.t = 0; }
    } else {
      lean(-0.8);
      const v = this.swimClock(a, sp, 0.8, dt);
      if (!go(v * Math.cos(a.diveP), v * Math.sin(-a.diveP) + 0.8)) a.yaw += dt * 1.2;      // (under something: it works its way round)
      if (a.pos.y >= top - 0.02 || D.t > 40) { a.pos.y = Math.max(top, ground); a.dive = null; a.floating = true; a.roam = true; a.timer = 8 + Math.random() * 15; a.shore = V(a.pos.x + Math.sin(a.yaw) * 2, 0, a.pos.z + Math.cos(a.yaw) * 2); return false; }
    }
    return true;
  }

  // The stroke clock of a frog in the water (util/gait.js swimStep with its SWIM profile and body length): advances its kick (a.kick,
  // the phase the rig draws) and returns its speed in cm/s. (The water it moves: its hull and feet in the ripple field, hulls().)
  swimClock(a, sp, urgency, dt, steer = 0, sitting = false, spin = null) {
    const st = (a.sw ??= swimState()), b = this.bodyOf(a.sp);
    const v = swimStep(st, swimProfile(a.sp), { urgency, floating: !!a.floating, steer, sitting, bodyLen: b ? 2 * b.hlen * drawScale(a, sp) : 3 * sp.size, wake: pushPending(st) > 0.3 && !a.floating, ...spin }, dt);
    a.kick = st.phase;
    return v;
  }

  // How far under the surface a swimming frog's origin lies (cm). Its swimming body (the `<id>.swim` model, belly on y = 0) floats
  // with its back awash and its eyes and nostrils out: the surface a little over the height of its spine. Without that body, the
  // sitting one by its SWIM profile's `sink`. Floating at rest it hangs lower, head up.
  swimDepth(a, sp) {
    const sc = drawScale(a, sp), key = meshKeyFor(a.sp, a.morph ?? null);
    const meta = (this.poseModels[key]?.swim ? this.poseMeta[key] : this.poseModels[a.sp]?.swim ? this.poseMeta[a.sp] : null)?.swim?.meta;
    const sk = meta?.skeleton?.bind === 'swim' ? meta.skeleton.bones.find((b) => b.name === 'spine') : null;
    const fl = a.sw?.fl ?? 0;
    if (!sk) return swimProfile(a.sp).sink * sp.size;
    return (sk.head[1] + 0.5 * sk.r + 0.35 * sk.r * fl) * sc;
  }

  // Where a swimming frog can climb out at the bank it meets at (x, z), swimming along heading `ang`: there or up to 3 cm inland, a
  // place it can sit (a slope it can stand on, clear of stems, as far out from the background as the relief keeps a body) no higher
  // above it than it can hop. The bank's own face may be steep where it is low (a step up out of the water, a root, the edge of a
  // stone): a slope over 53 degrees right at the waterline left the frogs of a karst tank swimming most of the time. V or null.
  shoreLand(a, sp, x, z, ang) {
    const W = this.world, T = W.terrain, ux = Math.sin(ang), uz = Math.cos(ang);
    for (let d = 0; d <= 3; d += 0.75) {
      const px = x + ux * d, pz = z + uz * d;
      const zs = pz + Math.max(0, this.wallNeed(a, px, T.heightAt(px, pz), pz, ang, false)), gs = T.heightAt(px, zs);
      if (gs - a.pos.y >= 6 * sp.size) return null;                     // (a cliff: inland only gets higher)
      if (W.water.surfaceAt(px, zs, 0.3) === -Infinity && T.normalAt(px, zs).y > 0.6 && !this.stemDepth(a, px, gs, zs, ang)
        && this.wallNeed(a, px, gs, zs, ang, false) <= 0.05 && this.sitFits(a, sp, px, gs, zs, ang, false)) return V(px, gs, zs);
    }
    return null;
  }

  // A frog in the water climbs out where the bank is too steep to hop onto: up the face from the waterline, along heading `ang` from
  // the first dry ground at (x, z), to the first place within 12 cm it can sit (as shoreLand: a slope it can stand on, clear of stems,
  // the relief and a fall). Soil, moss, rock (a stamped stone is ground), a root: a frog with toe pads grips any face, the toads
  // (PADLESS) faces up to about 70 degrees. Not through wood or a piece standing there, nor more than 15 cm up. `s`: the water's
  // surface where it swims. { path, kind: 'bank' } (the climb's points, from the waterline up) or null.
  exitClimb(a, sp, x, z, ang, s) {
    const W = this.world, T = W.terrain, ux = Math.sin(ang), uz = Math.cos(ang), grip = PADLESS.has(a.sp) ? 0.34 : 0;
    const x0 = x - ux * 0.5, z0 = z - uz * 0.5, path = [V(x0, Math.max(T.heightAt(x0, z0), s - 0.35 * sp.size), z0)];
    for (let d = 0; d <= 12; d += 0.5) {
      const px = x + ux * d, pz = z + uz * d;
      if (Math.abs(px) > TANK.w / 2 - 1.5 || Math.abs(pz) > TANK.d / 2 - 1.5) return null;
      const gy = T.heightAt(px, pz);
      if (gy - s > 15) return null;
      if (W.water.surfaceAt(px, pz, 0.3) !== -Infinity) { if (d > 1.5) return null; continue; }   // (water again beyond a thin spit)
      if (T.normalAt(px, pz).y < grip) return null;
      if (this.avoid && this.occ.count && this.occ.solidAt(px, gy + 0.5, pz)) return null;
      if (this.wallNeed(a, px, gy, pz, ang, false) > 0.05) return null;
      path.push(V(px, gy, pz));
      if (d >= 0.5 && T.normalAt(px, pz).y > 0.6 && this.sitFits(a, sp, px, gy, pz, ang) && !this.stemDepth(a, px, gy, pz, ang)
        && !(this.avoid && this.occ.count && this.occ.solidAt(px, gy + 1.2, pz)) && !W.water.nearestFall(V(px, gy, pz), 1.5)) return { path, kind: 'bank' };
    }
    return null;
  }

  // A frog with toe pads that swims to the glass climbs out up it: up out of the water, along the pane to where land meets the glass
  // (the nearest within 30 cm), and down onto it. (x, z): where its way meets the glass; `s`: the water's surface. The front and the
  // side panes (the back is the background). { path, glassN, glassTo, cost, kind: 'glass' } or null.
  exitGlass(a, sp, x, z, s) {
    if (PADLESS.has(a.sp)) return null;
    const W = this.world, T = W.terrain, hx = TANK.w / 2, hz = TANK.d / 2;
    let N, along;
    if (z > hz - 2.5 && Math.abs(x) < hx - 2) { N = GLASS_N.front; along = (o) => [x + o, hz - GLASS_GAP]; }
    else if (Math.abs(x) > hx - 2.5 && z > -hz + 4) { N = x < 0 ? GLASS_N.left : GLASS_N.right; along = (o) => [Math.sign(x) * (hx - GLASS_GAP), z + o]; }
    else return null;
    const bb = this.bodyBox(a, sp), up = Math.max(1.2, bb.z1), yaw = clingYaw(N);
    // the land: the nearest stretch of the pane, either way, with ground it can sit on just inside the glass
    for (let o = 0; o <= 30; o += 1) for (const sg of o ? [1, -1] : [1]) {
      const [gx, gz] = along(o * sg), fx = gx + N.x * 1.6, fz = gz + N.z * 1.6;
      if (Math.abs(fx) > hx - 1.5 || Math.abs(fz) > hz - 1.5) continue;
      if (W.water.surfaceAt(fx, fz, 0.3) !== -Infinity) continue;
      const fy = T.heightAt(fx, fz);
      if (T.normalAt(fx, fz).y < 0.6 || !this.sitFits(a, sp, fx, fy, fz, yaw + Math.PI) || this.stemDepth(a, fx, fy, fz, yaw + Math.PI)) continue;
      if (this.wallNeed(a, fx, fy, fz, yaw + Math.PI, false) > 0.05 || (this.avoid && this.occ.count && this.occ.solidAt(fx, fy + 0.5, fz))) continue;
      // along the glass clear of the ground, the relief and the pieces standing against it
      const [sx, sz] = along(0);
      let top = s + up;
      for (let t = 0; t <= 1; t += 0.1) top = Math.max(top, T.heightAt(sx + (gx - sx) * t + N.x * 0.3, sz + (gz - sz) * t + N.z * 0.3) + up);
      if (top > s + 14) continue;
      let clear = true;
      for (let t = 0; clear && t <= 1; t += 0.1) {
        const px = sx + (gx - sx) * t, pz = sz + (gz - sz) * t;
        clear = !(this.avoid && this.occ.count && this.occ.solidAt(px + N.x * 0.6, top, pz + N.z * 0.6)) && pz - 0.8 > W.wall.zAt(px, top) + 0.3;
      }
      if (!clear) continue;
      // (it swims up until its snout touches the pane, then goes up it belly to the glass)
      const ground = Math.max(T.heightAt(gx + N.x * 0.3, gz + N.z * 0.3), s), r0 = bb.z1 + 0.35;
      const path = [V(sx + N.x * r0, s - 0.35 * sp.size, sz + N.z * r0), V(sx, top, sz), V(gx, top, gz), V(gx, ground + 0.6, gz), V(fx, fy, fz)];
      return { path, glassN: N, glassTo: 3, cost: o * 0.4, kind: 'glass' };
    }
    return null;
  }

  // Takes hold at the foot of the way out it swam for (a.exit) and climbs out along it (perchFrog, phase 'up', flagged `exit`).
  startExit(a, sp) {
    const ex = a.exit;
    a.perch = { ph: 'up', exit: ex.kind, i: 1, path: [a.pos.clone(), ...ex.path], top: ex.path[ex.path.length - 1], base: a.pos.clone(),
      glassN: ex.glassN ?? null, glassYaw: ex.glassN ? clingYaw(ex.glassN) : 0, glassTo: ex.glassTo != null ? ex.glassTo + 1 : -1, plant: null, piece: null, near: Infinity, stuck: 0 };
    a.swimming = false; a.floating = false; a.shore = null; a.shoreLand = null; a.exit = null; a.fs = null; a.badShore = null;
  }

  // The heading on a pane with normal N that points the frog along (dx, dy, dz) (as Animals.draw turns UP onto N, then the heading).
  glassYawTo(N, dx, dy, dz) {
    surfaceFrame(N.x, N.y, N.z, 0, _gf);
    return Math.atan2(dx * _gf[3] + dy * _gf[4] + dz * _gf[5], dx * _gf[0] + dy * _gf[1] + dz * _gf[2]);
  }

  // Room to sit at (x, y, z) facing `yaw`: at its snout, tail and flanks no bank higher than its body (a slope it can stand on, not
  // against a cliff nor down a crevice between stones, where a tree frog sat for minutes trying to turn round) and, with `feet`, the
  // ground no further below than a third of its height at two of them at least (the top of a stone spire narrower than its body had
  // it sitting on a point, all four feet in the air).
  sitFits(a, sp, x, y, z, yaw, feet = true) {
    const T = this.world.terrain, bx = this.bodyBox(a, sp), ux = Math.sin(yaw), uz = Math.cos(yaw), H = bx.H, tol = Math.max(0.6, H * 0.33);
    let n = 0;
    for (const [ox, oz] of [[ux * bx.z1, uz * bx.z1], [ux * bx.z0, uz * bx.z0], [uz * bx.X, -ux * bx.X], [-uz * bx.X, ux * bx.X]]) {
      const gh = T.heightAt(x + ox * 0.85, z + oz * 0.85);
      if (gh > y + Math.max(H, 0.9 * Math.hypot(ox, oz))) return false;
      if (gh > y - tol) n++;
    }
    return !feet || n >= 2;
  }

  // Can the frog hop to `to` from here? Returns { h, wet } (and sets to.y), or null.
  hopCheck(a, sp, to, intoWater = false) {
    const W = this.world, T = W.terrain;
    if (Math.abs(to.x) > TANK.w / 2 - 1.5 || Math.abs(to.z) > TANK.d / 2 - 1.5) return null;
    // The whole body where it lands, facing the way it hops, inside the glass (the middle 1.5 cm in left a frog's head through it).
    const hd = Math.atan2(to.x - a.pos.x, to.z - a.pos.z), ux = Math.sin(hd), uz = Math.cos(hd), bx = this.bodyBox(a, sp), nose = bx.z1, H = bx.H;
    const gp = glassPush(to.x, a.pos.y, to.z, pitchFrame(0, hd, _fr), bx, TANK.w / 2, TANK.d / 2, TANK.h, 0.15, _gp);
    if (gp[0] || gp[2]) return null;
    const g = T.heightAt(to.x, to.z);
    const s = W.water.surfaceAt(to.x, to.z, 0.3);
    const wet = s > g + 0.2;
    // Dart frogs never hop into water; toads only when they mean to.
    if (wet && !(sp.kind === 'toad' && intoWater)) return null;
    if (!wet && T.normalAt(to.x, to.z).y < 0.6) return null;       // too steep to land on
    if (this.avoid && this.wallNeed(a, to.x, g, to.z, hd, false) > 0.05) return null;     // (nor where the relief would push it off)
    if (!wet && W.water.nearestFall(V(to.x, g, to.z), 1.5)) return null;
    to.y = wet ? Math.max(s - 0.35 * sp.size, g) : g;
    if (this.avoid && this.occ.solidAt(to.x, to.y + 0.5, to.z)) return null;
    if (!wet && this.crowded(a, sp, to.x, to.z)) return null;      // nobody sits where it would land
    if (!wet && this.stemDepth(a, to.x, to.y, to.z, hd) > 0.02) return null;     // nor in a plant's stems (its trunk, as outOfStems)
    // nor with its snout, tail or a flank in a bank of the ground (it lands on a slope it can stand on, not against a cliff)
    // (and on dry ground with ground under its feet, sitFits)
    if (!this.sitFits(a, sp, to.x, to.y, to.z, hd, !wet)) return null;
    const rise = to.y - a.pos.y;
    if (rise > 5 * sp.size || rise < -14 * sp.size) return null;
    const dist = Math.hypot(to.x - a.pos.x, to.z - a.pos.z);
    const h = 0.5 + dist * 0.25 + Math.max(0, rise);
    // Standing in a puddle or the shallows: the arc starts at the surface.
    const y0 = Math.max(a.pos.y, W.water.surfaceAt(a.pos.x, a.pos.z, 0.05));
    // The path a real frog takes (util/hop.js: the launch along the take-off line, then a ballistic arc) must clear everything under
    // it: ground, rocks and water in the middle of the flight (it starts and ends on the ground), solids all the way.
    const plan = hopPlan({ d: dist, rise: to.y - y0 }, svlOf(sp.size, drawScale(a, sp)));
    if (!plan.ok) return null;             // (no arc comes down onto it: too high a ledge for so short a hop)
    for (let i = 1; i < 8; i++) {
      const u = i / 8, at = hopAt(plan, (plan.tLaunch + u * plan.tFlight) / plan.dur), k = at.pos[2] / Math.max(1e-6, dist), t = u;
      const x = a.pos.x + (to.x - a.pos.x) * k, z = a.pos.z + (to.z - a.pos.z) * k;
      const y = y0 + at.pos[1];
      const under = Math.max(T.heightAt(x, z), W.water.surfaceAt(x, z, 0.3));
      if (u >= 0.25 && u <= 0.75 && y < under + Math.min(0.3, plan.v * plan.v * Math.sin(plan.theta) ** 2 / (2 * 981) * 0.5) && !(wet && t > 0.75)) return null;
      // (its nose and the top of its back too, not only its middle: the arc may not pass through wood or a rock)
      if (this.avoid && (this.occ.solidAt(x, y + 0.4, z) || this.occ.solidAt(x + ux * nose, y + 0.4, z + uz * nose) || this.occ.solidAt(x, y + H, z))) return null;
    }
    return { h, wet };
  }

  hopTo(a, sp, to, intoWater = false) {
    const r = this.hopCheck(a, sp, to, intoWater);
    if (!r) return false;
    this.startHop(a, to, r.h, r.wet);
    return true;
  }

  // A frog's drawn frame in its hop (util/hop.js hopFrame) at hop time t (default: now), about its swimming body's hips.
  // `mesh`: the swimming body's mesh (its skeleton's hips are the pivot), or none for where the frog is and which body draws it.
  leapFrame(a, sp, sc, t = a.hop.t, mesh = null) {
    const rig = mesh?.skinned?.skinRig ?? null;
    let pv = rig ? PIVOTS.get(rig) : null;
    if (rig && pv === undefined) {
      const L = rig.byName.thighL, R = rig.byName.thighR;
      pv = L != null && R != null ? rig.head[L].map((v, i) => (v + rig.head[R][i]) / 2) : null;
      PIVOTS.set(rig, pv);
    }
    return hopFrame(Math.min(1, t), a.hop, sp.size, sc, pv);
  }

  startHop(a, to, h, splash = false) {
    const d = a.pos.distanceTo(to);
    a.hopFail = 0;
    // (a real frog's hop: launch, ballistic flight, landing, util/hop.js; which leg leads and by how much drawn once a hop. Until 5 Oct:
    // one floating parabola of 0.22 + 0.09 sqrt(d) s)
    const sp = SPECIES[a.sp.split(':')[0]] ?? SPECIES[a.sp], dd = Math.hypot(to.x - a.pos.x, to.z - a.pos.z);
    const plan = hopPlan({ d: dd, rise: to.y - a.pos.y }, svlOf(sp?.size ?? 1, sp ? drawScale(a, sp) : 1), [Math.random(), Math.random()]);
    a.hop = { from: a.pos.clone(), to, t: 0, dur: plan.dur, plan, h: Math.max(h, 0.5), splash, y0: a.yaw ?? 0, y1: Math.atan2(to.x - a.pos.x, to.z - a.pos.z) };
    a.floating = false;
    a.crouch = 0;
  }

  // --- Hunting ---------------------------------------------------------------------------------
  // The sim (sim.js) decides *when* a hungry hunter eats, at the same rate as always, and calls order(): the animal
  // then really hunts a prey animal near it (notice, face, stalk, strike). If it has not caught anything by the
  // deadline (which shrinks with the simulation speed, so fast-forward and the vacation test stay statistical) it
  // eats one at once, exactly as before. Very hungry animals also snap up prey that wanders into reach.
  reachOf(a, sp) {
    if (sp.kind === 'frog' || sp.kind === 'toad') return 2.6 * sp.size + 0.4;
    if (a.sp === 'firesal') return 1.6 * sp.size + 0.4;
    if (sp.kind === 'gecko') return 1.2 * sp.size;
    return 0.9 * sp.size;
  }

  validPrey(p, a) { return !!p && !p.dead && !p.eaten && (!p.taken || p.takenBy === a); }

  huntable(a, sp, pid, p) {
    const water = isItem(pid) || pid === 'tadpole' || pid === 'larva' || pid === 'shrimp' || pid === 'blueshrimp' || pid === 'cpd';
    switch (sp.kind) {
      case 'frog': case 'toad': return !water && !a.swimming;
      case 'newt': return water === !!a.swimming;
      case 'axolotl': return water;
      case 'skink': return !water;
      case 'gecko': return !water && (!a.wallMode || p.pos.z - this.world.wall.zAt(p.pos.x, p.pos.y) < 7);
    }
    return false;
  }

  nearestPrey(a, sp, pid, maxD, any = false) {
    const item = isItem(pid), list = item ? this.food : this.by[pid];
    if (!list) return null;
    let best = null, bd = maxD;
    for (const p of list) {
      if (item && (p.kind ?? 'flake') !== pid) continue;
      if (!this.validPrey(p, a) || (!any && !this.huntable(a, sp, pid, p))) continue;
      const d = Math.hypot(p.pos.x - a.pos.x, p.pos.y - a.pos.y, p.pos.z - a.pos.z);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  // --- The test lab (src/lab) -----------------------------------------------------------------------------------------------------
  // A driven animal has `a.lab = { drive, pace }` (sim/labdrive.js). While it has a drive its own mind is muted (no hunger, flight,
  // courtship or hunt) and the drive names a goal, a.lab.goal; the species' own movement gets it there: its hop or step cycle, its
  // turning, its bumping and the glass. Nothing here writes a position, a heading or a pose. a.lab.stats says how well it went.
  labDrive(a, dt) {
    const L = a.lab;
    if (!L.drive) { L.goal = null; return; }
    const r = driveStep(L.drive, a.pos, this.labDots ?? {}, dt);
    if (!r.goal && L.goal) L.kicked = false;
    L.goal = r.goal;
    L.k = L.pace * (r.pace ?? 1);                    // (the drive's pace times what the waypoint asks)
    const S = L.stats ??= { t: 0, dist: 0, xteSum: 0, xteN: 0, xteMax: 0, last: a.pos.clone() };
    S.t += dt;
    S.dist += Math.hypot(a.pos.x - S.last.x, a.pos.z - S.last.z);
    S.last.copy(a.pos);
    const D = L.drive;
    if (D.type === 'path' && D.reached > 0) { const e = crossTrack(D.pts, a.pos, D.closed); S.xteSum += e; S.xteN++; if (e > S.xteMax) S.xteMax = e; }
  }

  // A fish told where to go: swim's own control input (the same one the herps use in the water).
  labCtl(a, sp) {
    const L = a.lab, g = L.goal;
    return g ? { x: g.x, y: g.y ?? a.pos.y, z: g.z, speed: sp.speed * 0.6 * L.k } : { x: a.pos.x, y: a.pos.y, z: a.pos.z, speed: 0 };
  }

  // The next burst of a frog or toad on land, toward a goal: a hop (as far as one hop goes) or a few steps. L.gait: 'auto', 'walk' or
  // 'hop'. 'wait': there already. null: nothing it can do from here (a rock, water: the caller waits and tries again).
  labFrogPlan(a, sp, g) {
    const toad = sp.kind === 'toad', L = a.lab;
    const dx = g.x - a.pos.x, dz = g.z - a.pos.z, d = Math.hypot(dx, dz), ang = Math.atan2(dx, dz);
    if (d < 0.4) return 'wait';
    const walk = L.gait === 'walk' || (L.gait !== 'hop' && (toad ? d < 3 : d < 9));
    for (const f of [1, 0.7, 0.45]) {
      const len = (walk ? Math.min(d, 3) : Math.min(d, 5.5 * sp.size * (toad ? 1.2 : 1))) * f;
      const plan = this.checkPlan(a, sp, walk ? 'walk' : 'hop', V(a.pos.x + Math.sin(ang) * len, 0, a.pos.z + Math.cos(ang) * len), ang, false);
      if (plan) { if (walk) plan.v = L.k; return plan; }
    }
    return null;
  }

  // A newt, axolotl or gecko told where to go: what its mind thought is replaced by the goal, at its walking (or swimming) pace.
  labHerp(a, P, it, depth) {
    const g = a.lab.goal;
    it.goal = g ? { x: g.x, z: g.z } : null;
    it.swim = !!g && depth > 1.3;
    it.speed = g ? (it.swim ? P.swim ?? P.walk : P.walk) * a.lab.k : 0;
    it.wantWall = false; it.face = null; it.needHome = false; it.tuck = 0;
    it.mated = false; it.birth = null; it.dropTail = false; it.shed = false; it.say = null;
  }

  labCrab(a, P, it) {
    const g = a.lab.goal;
    it.goal = g ? { x: g.x, z: g.z } : null;
    it.speed = g ? P.speed * 0.5 * a.lab.k : 0;
    it.face = null; it.eat = false; it.drown = false; it.dig = false; it.badHome = false; it.say = null; it.nose = false;
  }

  newOrder(pid, p) { return { pid, target: p, t: 0, deadline: Math.max(4, (55 + Math.random() * 35) / this.warp), miss: 0 }; }

  // Called by the sim when a hunter's meal is due. True: the animal will really hunt (it eats when it strikes).
  order(a, pid) {
    const sp = SPECIES[a.sp];
    // (already hunting or striking: that hunt is the meal; false made the sim hand it a second one at once, from anywhere)
    if (LIVE.has(sp.kind) && (a.order || a.st) && !a.dead && this.avoid) return true;
    if (!LIVE.has(sp.kind) || a.dead || a.stranded || !this.avoid) return false;
    const p = this.nearestPrey(a, sp, pid, 40);
    if (!p) return false;
    a.order = this.newOrder(pid, p);
    return true;
  }

  // The meal, at once and unseen (a missed deadline).
  eatNow(a, sp, o) {
    a.order = null;
    let p = this.validPrey(o.target, a) ? o.target : this.nearestPrey(a, sp, o.pid, 1e9, true);
    if (p) this.consume(a, sp, o.pid, p);
  }

  consume(a, sp, pid, p) {
    if (p.dead || p.eaten) return;           // gone already (eaten off its tongue by the sim's meal): no second meal of one prey
    if (isItem(pid)) p.eaten = true; else this.remove(p, `eaten by a ${one(a.sp)}`);
    a.hunger = Math.max(0, a.hunger - (FOOD_VALUE[pid] ?? 0.1));
    if (Math.random() < 0.3) this.world.log(`A ${one(a.sp)} ${isItem(pid) ? 'took ' + (pid === 'bloodworm' ? 'a bloodworm' : pid === 'pellet' ? 'a pellet' : 'a flake') : 'caught a ' + one(pid)}.`, 'eat');
  }

  fwdOf(a, out) {
    if (a.wallMode) return out.set(Math.sin(a.yaw), -Math.cos(a.yaw), 0);
    const p = a.swimming || SPECIES[a.sp].kind === 'swim' ? (a.pitch ?? 0) : 0;
    return out.set(Math.sin(a.yaw) * Math.cos(p), -Math.sin(p), Math.cos(a.yaw) * Math.cos(p));
  }

  // Where the mouth is (including the lunge of a strike in progress).
  mouth(a, sp, out) {
    this.fwdOf(a, _f);
    out.copy(a.pos).addScaledVector(_f, sp.size * 0.9 + (a.lunge ?? 0));
    if (a.wallMode) out.z += 0.3; else if (!a.swimming && sp.kind !== 'axolotl') out.y += sp.size * (sp.kind === 'frog' || sp.kind === 'toad' ? 1.35 : a.sp === 'firesal' ? 0.9 : 0.45);   // the mouth sits at head height
    return out;
  }

  hunter(a, sp, dt) {
    if (a.dead || a.st || a.stranded) return;
    let o = a.order;
    if (!o) {
      if (a.hunger < (a.hm?.mode === 'hunt' ? 0.4 : 0.55) || !this.avoid) return;
      a.scanT = (a.scanT ?? Math.random()) - dt;
      if (a.scanT > 0) return;
      a.scanT = 0.8 + Math.random() * 0.8;
      const reach = this.reachOf(a, sp);
      for (const pid of dietOf(sp)) {
        if (!isItem(pid) && !this.catchable(pid)) continue;
        const p = this.nearestPrey(a, sp, pid, reach * 1.3);
        if (p) { o = a.order = this.newOrder(pid, p); break; }
      }
      if (!o) return;
    }
    o.t += dt;
    if (!this.validPrey(o.target, a)) {
      const p = this.nearestPrey(a, sp, o.pid, 40);
      if (!p) { a.order = null; return; }
      o.target = p;
    }
    if (o.t > o.deadline) { this.eatNow(a, sp, o); return; }
    const tp = o.target.pos, reach = this.reachOf(a, sp);
    this.mouth(a, sp, _m);
    const d = Math.hypot(tp.x - _m.x, tp.y + 0.15 - _m.y, tp.z - _m.z);
    const frog = sp.kind === 'frog' || sp.kind === 'toad';
    if (frog) {
      if (a.swimming || a.hop) return;
      if (d < reach * 2.5 && sp.kind === 'frog') a.tapT = 0.4;     // watching it: the hind toes twitch (dart frogs do this)
      if (d > reach) return;
      const diff = angDiff(Math.atan2(tp.x - a.pos.x, tp.z - a.pos.z), a.yaw);
      if (Math.abs(diff) < 0.6 && (a.fs === 'sit' || a.fs === 'turn' || a.fs === 'walk')) this.beginStrike(a, sp, o);
      else if (a.fs === 'sit') { a.faceTo = a.yaw + diff; a.afterTurn = 'sit'; a.fs = 'turn'; }
      return;
    }
    if (d <= reach * 0.9) { this.beginStrike(a, sp, o); return; }
    // Go for it: crawlers aim their walk at the prey, swimmers do so in swim(). (Salamanders, newts, axolotls and geckos have a
    // mind that creeps up on it, herp.js.)
    if (a.herp) return;
    if (sp.kind === 'gecko' && a.onWall) { a.target = V(clamp(tp.x, -TANK.w / 2 + 2, TANK.w / 2 - 2), clamp(tp.y, this.world.water.level + 2, TANK.h - 3), 0); a.timer = Math.max(a.timer, 1); }
    else if (!a.swimming) { a.state = 'walk'; a.target = V(tp.x, 0, tp.z); a.timer = Math.max(a.timer, 1.5); }
  }

  beginStrike(a, sp, o) {
    const tongue = sp.kind === 'frog' || sp.kind === 'toad' || a.sp === 'firesal';
    a.st = { prey: o.target, pid: o.pid, kind: tongue ? 'tongue' : 'snap', ph: 'aim', t: 0, dur: tongue ? 0.32 + Math.random() * 0.35 : 0.2 + Math.random() * 0.25, got: false, miss: Math.random() < 0.15, lunge: 0, lmax: 0, pitch: 0, cap: V(0, 0, 0) };
    a.speedNow = 0; a.vel.multiplyScalar(0.2);
    this.striking.add(a);
  }

  // A strike cut short (the animal was moved: unstuck, relocated): the prey it held is let go (a prey left `taken` could never be
  // hunted by anyone else again) and the tongue is put away.
  dropStrike(a) {
    const p = a.st?.prey;
    if (p && p.takenBy === a) { p.taken = false; p.takenBy = null; }
    a.st = null; a.lunge = 0;
    this.striking?.delete(a);
  }

  endStrike(a, sp, ok) {
    a.st = null; a.lunge = 0; a.crouch = 0;
    this.striking.delete(a);
    if (sp.kind === 'frog' || sp.kind === 'toad') { a.fs = 'sit'; a.fsT = ok ? 2.5 + Math.random() * 4 : 1.2 + Math.random() * 2; a.chain = 0; a.chainNext = false; }
    else { a.timer = ok ? 1.5 + Math.random() * 2 : 1 + Math.random(); a.state = 'rest'; a.target = null; }
    if (!ok && a.order) { a.order.miss++; a.order.kicked = true; }
  }

  // Advance every strike in progress and draw the tongues. Aim (face the prey, crouch), out (150 ms flick, the
  // lunge), back (the prey is carried to the mouth), gulp (throat pulses, eyes sink), then a pause.
  strikes(dt) {
    const tg = this.tongues;
    tg.begin();
    const dtS = dt / this.tf;
    for (const a of this.striking) {
      const st = a.st;
      if (!st || a.dead) { a.lunge = 0; a.st = null; this.striking.delete(a); continue; }
      const sp = SPECIES[a.sp], p = st.prey, tongue = st.kind === 'tongue';
      if (st.ph !== 'gulp' && (st.got ? p.dead || p.eaten : !this.validPrey(p, a))) { this.endStrike(a, sp, false); continue; }
      st.t += dtS;
      switch (st.ph) {
        case 'aim': {
          const dx = p.pos.x - a.pos.x, dz = p.pos.z - a.pos.z;
          const want = a.wallMode ? Math.atan2(dx, -(p.pos.y - a.pos.y)) : Math.atan2(dx, dz);
          this.turnTo(a, sp, want, dtS, 9);
          a.crouch = Math.min(1, st.t / 0.25) * 0.8;
          if (st.t >= st.dur) {
            this.mouth(a, sp, _m);
            st.up = p.pos.y > _m.y + 0.4;
            st.lmax = tongue ? 0.5 : Math.min(1.1, 0.45 * sp.size);
            st.ph = 'out'; st.t = 0; st.dur = tongue ? 0.075 : 0.1;
          }
          break;
        }
        case 'out': {
          const k = Math.min(1, st.t / st.dur);
          st.lunge = k * st.lmax;
          st.pitch = k * (tongue ? (st.up ? -0.28 : 0.2) : (st.up ? -0.2 : 0.3));
          a.crouch = 0.8 * (1 - k);
          if (tongue) { this.mouth(a, sp, _m); _t.copy(p.pos); _t.y += 0.1; tg.show(_m, _t, k * (st.miss ? 0.8 : 1), sp.size > 1.5 ? 1.3 : 1); }
          if (st.t >= st.dur) {
            if (!st.miss) { st.got = true; st.cap.copy(p.pos); p.taken = true; p.takenBy = a; }
            st.ph = 'back'; st.t = 0; st.dur = tongue ? 0.09 : 0.13;
          }
          break;
        }
        case 'back': {
          const k = Math.min(1, st.t / st.dur);
          st.lunge = (1 - k) * st.lmax;
          st.pitch *= 0.85;
          this.mouth(a, sp, _m);
          if (st.got) p.pos.lerpVectors(st.cap, _m, k);
          if (tongue) { _t.copy(st.got ? p.pos : p.pos); tg.show(_m, _t, st.got ? 1 : (1 - k) * 0.8, sp.size > 1.5 ? 1.3 : 1); }
          if (st.t >= st.dur) {
            if (st.got) {
              this.consume(a, sp, st.pid, p);
              a.order = null;
              st.ph = 'gulp'; st.t = 0; st.dur = 0.5 + Math.random() * 0.2; st.lunge = 0; st.pitch = 0;
            } else { this.endStrike(a, sp, false); continue; }
          }
          break;
        }
        case 'gulp':
          if (st.t >= st.dur) { this.endStrike(a, sp, true); continue; }
          break;
      }
      a.lunge = st.lunge;
    }
    tg.end();
  }

  // --- Keeping apart ---------------------------------------------------------------------------
  // Animals of the same medium (water, land, the background wall, air) steer apart when closer than the sum of
  // their body radii, using a spatial hash rebuilt every tick: nobody sits on top of anyone else.
  groupOf(a, sp) {
    if (sp.kind === 'egg' || sp.sessile) return null;
    if (a.wallMode) return 'wall';
    if (a.perch && a.perch.ph !== 'go') return null;                         // up on its perch (or on the way up or down): out of the crowd
    if (sp.kind === 'fly') return 'land';                                     // (flightless: it walks with everyone else)
    if (sp.kind === 'swim' || sp.kind === 'crawlWater' || sp.kind === 'axolotl' || a.swimming) return 'water';
    return 'land';
  }

  radiusOf(a, sp) {
    const grow = clamp(0.35 + (a.age / 1440) / (sp.adultDays ?? 10) * 0.65, 0.35, 1);
    return (RADIUS[sp.kind] ?? 0.4) * (sp.r ?? sp.size) * (0.5 + 0.5 * grow);
  }

  cellKey(g, x, y, z) {
    const u = Math.floor(x / CELLG), v = Math.floor((g === 'wall' ? y : z) / CELLG);
    return GROUPS[g] * 1000000 + (u + 200) * 500 + (v + 200);
  }

  // Every body goes into each grid cell its footprint covers (a newt's capsule, a crab's legs), so two bodies that overlap always
  // share a cell and the separation only has to look in its own cells (a.cells). Searching a block of cells as wide as the longest
  // animal made it twice as slow once bodies were measured from their meshes.
  buildGrid() {
    const G = this.grid;
    for (const l of G.values()) l.length = 0;
    this.plantCores();
    for (const [id, arr] of Object.entries(this.by)) {
      const body = arr.length ? this.bodyOf(id) : null;
      for (const a of arr) {
      if (a.dead) { a.grp = null; continue; }
      const sp = SPECIES[a.sp], g = this.groupOf(a, sp);
      a.grp = g;
      if (!g) continue;
      a.rad = this.radiusOf(a, sp);
      this.capsuleOf(a, sp, g, body);
      if (a.rad < TINY) { a.grp = null; continue; }
      // (cached for the tick, for the pair tests: the height its body spans, its middle's offset ahead of a.pos, a round radius)
      const h = a.bh ?? a.rad;
      a._y0 = sp.kind === 'swim' ? a.pos.y - h : a.pos.y; a._y1 = a.pos.y + h;
      const off = a.cap ? a.cap.zc : 0;
      a._ox = Math.sin(a.yaw ?? 0) * off; a._oz = Math.cos(a.yaw ?? 0) * off; a._cr = a.rad + (a.cap ? a.cap.hl * 0.6 : 0);
      let x0 = a.pos.x, x1 = a.pos.x, v0 = g === 'wall' ? a.pos.y : a.pos.z, v1 = v0;
      if (a.cap) {
        const fx = Math.sin(a.yaw ?? 0), fz = Math.cos(a.yaw ?? 0);
        for (const t of [a.cap.zc - a.cap.hl, a.cap.zc + a.cap.hl]) { const x = a.pos.x + fx * t, v = a.pos.z + fz * t; x0 = Math.min(x0, x); x1 = Math.max(x1, x); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
      }
      const cells = a.cells ??= [];
      cells.length = 0;
      const base = GROUPS[g] * 1000000;
      for (let u = Math.floor((x0 - a.rad) / CELLG); u <= Math.floor((x1 + a.rad) / CELLG); u++) for (let v = Math.floor((v0 - a.rad) / CELLG); v <= Math.floor((v1 + a.rad) / CELLG); v++) {
        const k = base + (u + 200) * 500 + (v + 200);
        let l = G.get(k);
        if (!l) G.set(k, l = []);
        l.push(a);
        cells.push(k);
      }
      }
    }
  }

  // Calls fn(b) once for every animal b of group g (land and water are one) in the cells around (x, y, z).
  near(g, x, y, z, fn, span = 1) {
    const u = Math.floor(x / CELLG), v = Math.floor((g === 'wall' ? y : z) / CELLG), base = GROUPS[g] * 1000000, st = ++this._stamp;
    for (let du = -span; du <= span; du++) for (let dv = -span; dv <= span; dv++) {
      const l = this.grid.get(base + (u + du + 200) * 500 + (v + dv + 200));
      if (l) for (let i = 0; i < l.length; i++) { const b = l[i]; if (b._st === st) continue; b._st = st; fn(b); }
    }
  }

  // Would a land animal landing or walking to (x, z) overlap another one?
  crowded(a, sp, x, z) {
    const ra = a.rad ?? this.radiusOf(a, sp);
    let hit = false;
    this.near('land', x, 0, z, (b) => {
      if (hit || b === a || b.dead || b.grp !== 'land') return;
      if (Math.hypot(b.pos.x - x, b.pos.z - z) < (ra + b.rad) * 0.9) hit = true;
    });
    return hit;
  }

  // The body as drawn, measured once per mesh (util/body.js bodyFootprint): null until the species' mesh has arrived. Keyed by the
  // geometry, so a species whose procedural body is swapped for its model (the vampire crab) is measured again.
  bodyOf(id) {
    const m = this.meshes?.[id], geo = (m?._lo ?? m)?.geometry, P = geo?.attributes?.position?.array;
    if (!P) return null;
    const c = (this.bodies ??= {})[id];
    if (c && c.geo === geo) return c;
    const R = geo.attributes.rig?.array ?? null, b = bodyFootprint(P, R);
    if (!b) return null;
    return (this.bodies[id] = { ...b, feet: feetOf(P, R), geo });
  }

  // The body as the separation sees it, from the drawn mesh (bodyOf) at the animal's size: a.rad, the trunk's half width (a crab
  // also keeps its legs out of a neighbour's: most of its leg span counts), a.bh its height (not a.hh: that is a salamander's home), and for a body longer than it is wide
  // (a newt, a shrimp, a snail, a cricket, a roach) a capsule along the heading, a.cap = { hl, zc }: the half length of the
  // straight part and how far its middle sits ahead of a.pos (cm). A circle either let two long bodies lie across each other or
  // kept them a body length apart. Before the mesh arrives: the old circle per kind.
  capsuleOf(a, sp, g, b = this.bodyOf(a.sp)) {
    a.cap = null; a.trunk = null;
    if (g !== 'land' && g !== 'water' && g !== 'wall') return;
    if (!b) return;
    const sc = drawScale(a, sp);
    a.rad = Math.max(b.tw, b.span * (sp.kind === 'crab' ? 0.8 : VIS.has(sp.kind) ? 0.6 : 0.5), 0.08) * sc;   // (a crab's legs sprawl: most of their span counts)
    a.bh = Math.max(b.hh, 0.1) * sc;
    const hl = b.tl * sc - a.rad;
    if (hl > 0.15 && g !== 'wall') a.cap = { hl, zc: b.tc * sc };
    // (the trunk alone, legs left out: a capsule of its half width along the heading, what outOfStems keeps out of plants' stems)
    a.trunk = { zc: b.tc * sc, hl: Math.max(0, b.tl - b.tw) * sc, r: b.tw * sc };
  }

  // The stems of the plants on the ground, which a frog or salamander walks round rather than through (it may sit under the
  // leaves). Bucketed by CELLG once a second; carpets and creepers (java moss, pothos) are walked over.
  plantCores() {
    const P = this.world?.plants;
    if (!P) return;
    const now = this.t ?? 0;
    if (this._coresT != null && now - this._coresT < 1 && this._coresN === P.list.length) return;
    this._coresT = now; this._coresN = P.list.length;
    const G = this.cores ??= new Map();
    G.clear();
    for (const q of P.list) {
      const r = coreR(q);
      if (!r) continue;
      const k = Math.floor(q.pos.x / CELLG) * 1000 + Math.floor(q.pos.z / CELLG);
      let l = G.get(k);
      if (!l) G.set(k, l = []);
      l.push({ x: q.pos.x, y: q.pos.y, z: q.pos.z, r, q });
    }
  }

  // How deep a body at (x, y, z) facing `yaw` is in plants' stems (plantCores): its trunk (a.trunk: a capsule along the heading, its
  // own half width, at least 0.7 of the body's radius with the legs) against the deepest stem core, or 0 when clear; out[1], out[2]:
  // the way out of all of them together (a long body between two plants is not pushed from one into the other). Not the plant it is
  // climbing.
  stemDepth(a, x, y, z, yaw, out = _sd) {
    out[0] = out[1] = out[2] = 0;
    if (!this.cores?.size || a.rad == null) return 0;
    const tr = a.trunk, fx = Math.sin(yaw ?? 0), fz = Math.cos(yaw ?? 0), hl = tr ? tr.hl : 0, rr = Math.max(tr ? tr.r : 0, a.rad * 0.7);
    const mx = x + fx * (tr ? tr.zc : 0), mz = z + fz * (tr ? tr.zc : 0), u = Math.floor(x / CELLG), v = Math.floor(z / CELLG);
    for (let du = -1; du <= 1; du++) for (let dv = -1; dv <= 1; dv++) {
      const l = this.cores.get((u + du) * 1000 + (v + dv));
      if (l) for (const c of l) {
        if (Math.abs(c.y - y) > 4 || c.q === a.perch?.plant) continue;
        const t = clamp((c.x - mx) * fx + (c.z - mz) * fz, -hl, hl), dx = mx + fx * t - c.x, dz = mz + fz * t - c.z, d = Math.hypot(dx, dz);
        if (d >= c.r + rr) continue;
        const p = c.r + rr - d;
        out[0] = Math.max(out[0], p); out[1] += p * (d < 1e-3 ? Math.cos(a.id * 2.4) : dx / d); out[2] += p * (d < 1e-3 ? Math.sin(a.id * 2.4) : dz / d);
      }
    }
    return out[0];
  }

  // Out of plants' stems at the end of the tick, as out of the glass: separate() pushes a little at a time, but a walker held against
  // that push (walking at a hide among the stems, a push the ground refused) stayed inside them for minutes. Its trunk (stemDepth)
  // is moved straight out to the stems' edge, so it slides round them; where that way is shut (the glass, the background, a rock, the
  // water for a walker or the bank for a swimmer) it slides round the stem sideways instead (a frog between the front pane and a
  // bamboo, a newt between a fern and a rock stayed in the stems for minutes). A swimmer keeps its height.
  outOfStems(a, sp) {
    const T = this.world.terrain, hx = TANK.w / 2 - 0.5, hz = TANK.d / 2 - 0.5;
    const free = (nx, nz) => {
      if (Math.abs(nx) > hx || Math.abs(nz) > hz || (this.avoid && this.wallNeed(a, nx, a.pos.y, nz, a.yaw, a.swimming) > 0.05)) return false;
      if (this.occ.count && this.occ.solidAt(nx, (a.swimming ? a.pos.y : T.heightAt(nx, nz)) + 0.5, nz)) return false;
      const dep = this.world.water.surfaceAt(nx, nz, 0.3) - T.heightAt(nx, nz);
      return a.swimming ? dep > 0.5 * sp.size : !(dep > 0.9 * sp.size);
    };
    for (let k = 0; k < 3; k++) {
      if (!this.stemDepth(a, a.pos.x, a.pos.y, a.pos.z, a.yaw)) return;
      const px = _sd[1], pz = _sd[2], s = a.id % 2 ? 1 : -1;
      let ok = false;
      for (const [ux, uz] of [[px, pz], [-pz * s, px * s], [pz * s, -px * s]]) {
        const nx = a.pos.x + ux, nz = a.pos.z + uz;
        if (!free(nx, nz)) continue;
        a.pos.x = nx; a.pos.z = nz;
        if (!a.swimming) a.pos.y = T.heightAt(nx, nz);
        ok = true; break;
      }
      if (!ok) return;
    }
  }

  // Is a step to (nx, nz) into a plant's stems or onto a cliff of the ground (from outside them)? The walk then goes round, as round a
  // rock, or gives up: walking at a hide in a plant's middle held a gecko inside the stems against the push out, and one walking at a
  // bank's cliff was drawn half inside it. (The same trunk as outOfStems: a step that takes it no deeper is allowed.)
  walkBlocked(a, nx, nz) {
    const d1 = this.stemDepth(a, nx, a.pos.y, nz, a.yaw);
    if (d1 > 0.02 && d1 > this.stemDepth(a, a.pos.x, a.pos.y, a.pos.z, a.yaw) + 1e-3) return true;
    return SPECIES[a.sp].kind !== 'gecko' && this.cliffAt(nx, nz) && !this.cliffAt(a.pos.x, a.pos.z);
  }

  // Would a step to (nx, nz) take this walker further into a neighbour's body? Crawlers go round one another the way they go round
  // a stone, instead of walking in and leaving the separation to pull them apart (two roaches heading for the same leaf litter
  // otherwise met in the middle of each other). Bodies are circles here, a long one widened by part of its length.
  bumps(a, nx, nz) {
    const g = a.grp;
    // (tiny ones, springtails and fruit flies, have no group: they slip between the others)
    if (!this.avoid || (g !== 'land' && g !== 'water')) return false;
    const a0 = a._y0, a1 = a._y1, ra = a._cr, ax = nx + a._ox, az = nz + a._oz, px = a.pos.x + a._ox, pz = a.pos.z + a._oz;
    let worse = false;
    const visit = (b) => {
      if (worse || b === a || b.dead || (b.grp !== 'land' && b.grp !== 'water')) return;
      if (Math.min(a1, b._y1) - Math.max(a0, b._y0) < 0.1 * Math.min(a1 - a0, b._y1 - b._y0)) return;
      const bx = b.pos.x + b._ox, bz = b.pos.z + b._oz, R = (ra + b._cr) * 0.8;
      const ex = ax - bx, ez = az - bz, d1 = ex * ex + ez * ez;
      if (d1 < R * R && d1 < (px - bx) ** 2 + (pz - bz) ** 2 - 1e-8) worse = true;
    };
    this.near('land', nx, a.pos.y, nz, visit);
    return worse;
  }

  // Closest points of two capsules' axes in the ground plane (or the circles' centres): [ax, az, bx, bz].
  axes(a, b) {
    const seg = (c) => {
      if (!c.cap) return [c.pos.x, c.pos.z, c.pos.x, c.pos.z];
      const fx = Math.sin(c.yaw ?? 0), fz = Math.cos(c.yaw ?? 0), mx = c.pos.x + fx * c.cap.zc, mz = c.pos.z + fz * c.cap.zc;
      return [mx - fx * c.cap.hl, mz - fz * c.cap.hl, mx + fx * c.cap.hl, mz + fz * c.cap.hl];
    };
    const [p0x, p0z, p1x, p1z] = seg(a), [q0x, q0z, q1x, q1z] = seg(b);
    return closestOnSegments(p0x, p0z, p1x, p1z, q0x, q0z, q1x, q1z);
  }

  separate(dt) {
    if (!this.avoid || !(dt > 0)) return;
    const k = Math.min(1, dt * 12);
    for (const arr of Object.values(this.by)) for (const a of arr) {
      const g = a.grp;
      if (!g || a.dead || a.st || a.hop) continue;
      const sp = SPECIES[a.sp];
      let px = 0, py = 0, pz = 0, n = 0;
      const ma = (a.speedNow ?? 0) > 0.15 ? 1 : 0.4;
      // Land and water animals meet wherever their bodies share a height: a newt walking the bottom of a pool among shrimp and
      // snails, a crab at the edge of the water by a toad. (They used to be kept apart only from their own group.)
      const a0 = a._y0, a1 = a._y1;
      const swimA = sp.kind === 'swim' && !a.cap;
      const visit = (b) => {
        if (b === a || b.dead || !b.grp) return;
        if (g === 'wall' ? b.grp !== 'wall' : b.grp !== 'land' && b.grp !== 'water') return;
        let dx = a.pos.x - b.pos.x, dy = a.pos.y - b.pos.y, dz = a.pos.z - b.pos.z;
        if (g === 'wall') dz = 0;
        else {
          if (Math.min(a1, b._y1) - Math.max(a0, b._y0) < 0.1 * Math.min(a1 - a0, b._y1 - b._y0)) return;    // one passes over the other
          if (a.cap || b.cap) {
            // Long bodies: push apart where the two bodies come closest (along the flanks, head to tail), not centre to centre.
            const c = this.axes(a, b);
            dx = c[0] - c[2]; dz = c[1] - c[3]; dy = 0;
          } else if (!(swimA && SPECIES[b.sp].kind === 'swim')) dy = 0;          // two fish in open water part in 3D
        }
        let d = Math.hypot(dx, dy, dz);
        const R = a.rad + b.rad;
        if (d >= R) return;
        const o = R - d;
        if (d < 1e-3) { dx = Math.cos(a.id * 2.4 + b.id); dz = g === 'wall' ? 0 : Math.sin(a.id * 2.4 + b.id); dy = g === 'wall' ? Math.sin(a.id * 2.4) : 0; d = Math.hypot(dx, dy, dz) || 1; }
        const mb = (b.speedNow ?? 0) > 0.15 ? 1 : 0.4;
        const w = o / d * (ma / (ma + mb)) * 1.4;
        px += dx * w; py += dy * w; pz += dz * w; n++;
      };
      const st = ++this._stamp;
      for (const key of a.cells) { const l = this.grid.get(key); if (l) for (let i = 0; i < l.length; i++) { const b = l[i]; if (b._st === st) continue; b._st = st; visit(b); } }
      // Out of the plants' stems (a frog sitting in a bromeliad or climbing a stem is on its perch, not in this group).
      if (g === 'land' && CORE_WALKERS.has(sp.kind) && this.cores?.size) {
        const u = Math.floor(a.pos.x / CELLG), v = Math.floor(a.pos.z / CELLG);
        for (let du = -1; du <= 1; du++) for (let dv = -1; dv <= 1; dv++) {
          const l = this.cores.get((u + du) * 1000 + (v + dv));
          if (l) for (const c of l) {
            if (Math.abs(c.y - a.pos.y) > 4 || c.q === a.perch?.plant) continue;     // (not the plant it is about to climb)
            let qx, qz;
            if (a.cap) { const fx = Math.sin(a.yaw ?? 0), fz = Math.cos(a.yaw ?? 0), mx = a.pos.x + fx * a.cap.zc, mz = a.pos.z + fz * a.cap.zc; const t = clamp((c.x - mx) * fx + (c.z - mz) * fz, -a.cap.hl, a.cap.hl); qx = mx + fx * t; qz = mz + fz * t; }
            else { qx = a.pos.x; qz = a.pos.z; }
            let dx = qx - c.x, dz = qz - c.z, d = Math.hypot(dx, dz);
            const R = c.r + a.rad * 0.7;
            if (d >= R) continue;
            if (d < 1e-3) { dx = Math.cos(a.id * 2.4); dz = Math.sin(a.id * 2.4); d = 1; }
            const w = (R - Math.min(d, R)) / d * 1.2;
            px += dx * w; pz += dz * w; n++;
          }
        }
      }
      if (!n) continue;
      const str = (STRENGTH[sp.kind] ?? 0.6) * k;
      let len = Math.hypot(px, py, pz) * str;
      if (len < 1e-4) continue;
      const cap = Math.max(0.4, sp.speed * dt * 3);
      const f = str * Math.min(1, cap / len);
      // Blocked that way (the glass, a bank, the water's edge, a root): it slides round the other body instead. Two frogs on one
      // sitting spot by the glass, or two newts in one hide, stayed inside each other for a minute.
      if (!this.nudge(a, sp, g, px * f, py * f, pz * f) && g !== 'wall') {
        const s = a.id % 2 ? 1 : -1;
        if (!this.nudge(a, sp, g, -pz * f * s, py * f, px * f * s)) this.nudge(a, sp, g, pz * f * s, py * f, -px * f * s);
      }
    }
  }

  // Move `a` by (dx, dy, dz) if it can stand there (full step, else half).
  nudge(a, sp, g, dx, dy, dz) {
    const W = this.world, T = W.terrain;
    for (const f of [1, 0.5]) {
      const x = a.pos.x + dx * f, y = a.pos.y + dy * f, z = a.pos.z + dz * f;
      // (B4b) a push never goes through a piece: a 2.5 cm nudge carried a fleeing skink through thin wood
      const nl = sp.kind === 'swim' || a.swimming ? 0 : 0.5;
      if (this.occ.segmentFreeAt(a, a.pos.x, a.pos.y + nl, a.pos.z, x, y + nl, z) < 1) continue;
      if (g === 'water') {
        const fl = T.heightAt(x, z), L = this.waterTop(x, z);
        const swimmer = sp.kind === 'swim' || (a.swimming && sp.kind !== 'frog' && sp.kind !== 'toad');
        if (Math.abs(x) > TANK.w / 2 - 1.2 || Math.abs(z) > TANK.d / 2 - 1.2) continue;
        if (swimmer) {
          if (!(L - fl >= 1.3) || y < fl + 0.45 || y > L - 0.4 || this.occ.solidAt(x, y, z)) continue;
          a.pos.set(x, y, z);
          if (sp.kind === 'swim') { a.vel.x += dx * 2; a.vel.y += dy * 2; a.vel.z += dz * 2; }
        } else if (sp.kind === 'frog' || sp.kind === 'toad') {
          if (!(L - fl >= 0.9 * sp.size) || this.occ.solidAt(x, a.pos.y, z)) continue;
          queuePush(a.sw ??= swimState(), x - a.pos.x, z - a.pos.z);      // (released by a kick: util/swimturn.js)
        } else {
          if (!this.okFor('water', x, z, 5, 0, Math.max(0.2, a.bh ?? 0.5))) continue;
          a.pos.x = x; a.pos.z = z; a.pos.y = fl;
        }
        return true;
      }
      if (g === 'land') {
        if (!this.okFor(this.mediumOf(sp), x, z, 5, 0, Math.max(0.2, a.bh ?? 0.5)) || (CORE_WALKERS.has(sp.kind) && sp.kind !== 'gecko' && this.cliffAt(x, z) && !this.cliffAt(a.pos.x, a.pos.z))) continue;
        // Never into a piece (then relocated: a teleport), and one standing on wood or stone above the ground keeps its height
        // while it still has the piece under it, instead of being dropped to the ground below in one step.
        const gy = T.heightAt(x, z), up = a.pos.y > gy + 1;
        if (up && (!this.occ.solidAt(x, a.pos.y - 0.5, z) || this.occ.solidAt(x, a.pos.y + 0.5, z))) continue;
        a.pos.x = x; a.pos.z = z; if (!up) a.pos.y = gy;
        return true;
      }
      if (g === 'air') {
        if (Math.abs(x) > TANK.w / 2 - 1 || Math.abs(z) > TANK.d / 2 - 1 || y < Math.max(T.heightAt(x, z), this.waterTop(x, z)) + 1.2 || y > TANK.h - 3 || this.occ.solidAt(x, y, z) || z < W.wall.zAt(x, y) + 1) continue;
        a.pos.set(x, y, z);
        return true;
      }
      if (g === 'wall') {
        if (Math.abs(x) > TANK.w / 2 - 2 || y > TANK.h - 2 || y < W.water.level + 1.5) continue;
        a.pos.x = x; a.pos.y = y; a.pos.z = W.wall.zAt(x, y) + 0.35;
        return true;
      }
    }
    return false;
  }

  // --- How animals look right now: idle pulses, twitches, crouches and strikes (read by draw) -------------
  vis(a, sp, dtV) {
    const v = a.v ??= { bp: Math.random() * 6, tp: Math.random() * 6, blinkT: 2 + Math.random() * 8, blink: 0, twT: Math.random() * 6, yawT: 0, yaw: 0, rollT: 0, roll: 0, alert: 0, off: V(0, 0, 0), breath: 0, throat: 0, eye: 0, pitch: 0, y: 0, hop: 0, nose: 0 };
    const frog = sp.kind === 'frog' || sp.kind === 'toad';
    const st = a.st;
    const busy = !!a.order || !!st || a.fs === 'walk' || a.fs === 'turn' || a.fs === 'crouch' || !!a.hop;
    v.alert += ((busy ? 1 : 0) - v.alert) * Math.min(1, dtV * 3);
    v.bp += dtV * TAU * (0.7 + 0.5 * v.alert);
    v.tp += dtV * TAU * (2.2 + 1.6 * v.alert);
    v.breath = 0.5 + 0.5 * Math.sin(v.bp);
    let th = (0.5 + 0.5 * Math.sin(v.tp)) * (0.15 + 0.4 * v.alert) * 0.62;   // (the rig's throat range fits a full vocal sac)
    let eye = 0;
    // Blink.
    v.blinkT -= dtV;
    if (v.blinkT <= 0) { v.blink = 0.2; v.blinkT = 2.5 + Math.random() * 9; }
    if (v.blink > 0) { eye = Math.sin(Math.PI * (1 - v.blink / 0.2)); v.blink -= dtV; }
    const gulp = st && st.ph === 'gulp' ? st.t / st.dur : -1;
    if (frog) {
      // A frog breathes with its throat (content/anuranheadmuscles.js): the floor muscles flutter it, and every dozen or so flutters
      // a lung breath empties the flanks and pumps them full again; a swallow pulls the eyes down twice with the floor raised.
      const bu = (v.bu ??= buccalState()), sw = gulp >= 0 ? swallowDrive(gulp) : null;
      buccalStep(bu, dtV, v.alert, sw ? { hi: sw.hi } : null);
      v.breath = pumpBreath(bu); th = pumpThroat(bu);
      v.eyeA = eyeStep(v.eyeA ?? 0, sw ? sw.eye : 0, dtV);
      eye = Math.max(eye, v.eyeA);
    } else if (gulp >= 0) {
      // Gulp: two throat pulses, eyes pulled in.
      th = Math.max(th, Math.pow(Math.sin(gulp * Math.PI * 2), 2) * (1 - gulp * 0.3) * 0.62);
      eye = Math.max(eye, Math.sin(Math.min(1, gulp * 1.4) * Math.PI));
    }
    // Calling: a male dart frog sits up and buzzes, the vocal sac pulsing, in bouts of a few seconds, mostly in the morning
    // after the lamp comes on and after rain. A calling male sets off the other males near it.
    const call = this.frogCall(a, sp, v, dtV, busy);
    if (call > 0) th = Math.max(th, call);
    v.throat = th; v.eye = eye;
    // Head twitches while sitting (or resting); none while moving.
    const calm = !busy && (frog ? a.fs === 'sit' : a.state === 'rest' || a.state === 'idle');
    v.twT -= dtV;
    if (v.twT <= 0) {
      if (v.yawT === 0 && calm) {
        const big = Math.random() < 0.15;
        v.yawT = (Math.random() < 0.5 ? -1 : 1) * (big ? 0.45 + Math.random() * 0.4 : 0.08 + Math.random() * 0.22);
        // A body with a neck (rig2) looks round with its head (draw); one without (a frog, a crab, a bug) turns on the spot to look,
        // stepping round about its pivot (move(): a.lookTo), never by the body spinning on its own.
        if (!sp.anim?.rig2) a.lookTo = (a.yaw ?? 0) + v.yawT;
        v.rollT = Math.random() < 0.5 ? (Math.random() - 0.5) * 0.1 : 0;
        v.twT = big ? 1.5 + Math.random() * 2 : 0.7 + Math.random() * 1.8;
      } else { v.yawT = 0; v.rollT = 0; v.twT = 3 + Math.random() * 11; }
    }
    if (!calm) { v.yawT = 0; v.rollT = 0; }
    v.yaw += (v.yawT - v.yaw) * Math.min(1, dtV * (v.yawT === 0 ? 1.6 : 5));
    v.roll += (v.rollT - v.roll) * Math.min(1, dtV * 0.8);
    // Pose.
    let pitch = Math.sin(v.bp * 0.31) * 0.012, y = 0, hop = 0;
    const size = sp.size;
    if (call > 0) { pitch -= 0.1 * Math.min(1, call * 2); y += 0.05 * size * Math.min(1, call * 2); }   // sits up to call
    const cr = a.crouch ?? 0;
    pitch += -0.16 * cr; y -= 0.1 * size * cr;
    if (a.settle > 0) {
      a.settle = Math.max(0, a.settle - dtV / 0.4);
      const p = 1 - a.settle;
      y -= 0.12 * size * Math.sin(Math.PI * p);
      pitch += 0.12 * Math.sin(Math.PI * p);
      hop = 0.12 * a.settle * a.settle;                              // the legs were folded for the landing: only a little give
    }
    v.off.set(0, 0, 0);
    if (st) {
      pitch += st.pitch;
      if (a.lunge > 0) { this.fwdOf(a, _f); v.off.copy(_f).multiplyScalar(a.lunge); }
      if (st.ph === 'out' || st.ph === 'back') hop = Math.max(hop, 0.4 * (a.lunge / Math.max(0.1, st.lmax)));
    }
    // Nosing about (salamanders and newts at rest on the ground), head-down grazing (crawlers).
    let yawN = 0;
    if (a.grazing) {
      if (sp.kind === 'newt' || sp.kind === 'gecko' || sp.kind === 'axolotl') { v.nose += dtV; pitch += 0.16 + 0.06 * Math.sin(v.nose * 3.1); yawN = 0.4 * Math.sin(v.nose * 1.2 + a.phase) + 0.15 * Math.sin(v.nose * 3.7); }
      else pitch += 0.3 * (0.7 + 0.3 * Math.sin(this.t * 2.5 + a.phase));
    }
    v.pitch = pitch; v.y = y; v.hop = hop; v.yawN = yawN;
    return v;
  }

  // The rig channels of an insect, isopod or shrimp (render/creatures/instanced.js `invert`): how busy its antennae are (always a
  // little, steadily while it walks or grazes, in bursts of feeling about when it rests), the hop channel (a jump's kick, a tail
  // flick or a roll, see takeOff / startle), the beat (wings buzzing on a flutter, swimmerets on a swim), feeding (a shrimp's
  // pincers picking while it grazes), the wings' spread (a fly flicks them now and then at rest), legs settling when it stops,
  // and a springtail's tumble.
  invertPose(a, sp, dtV) {
    const u = a.iv ??= { burst: 0, bT: 1 + Math.random() * 4, wing: 0, wT: 2 + Math.random() * 6 };
    const H = a.hop, moving = (a.speedNow ?? 0) > 0.05 || a.state === 'walk';
    u.bT -= dtV;
    if (u.bT <= 0) { u.burst = 1; u.bT = 1.5 + Math.random() * 6; }
    u.burst = Math.max(0, u.burst - dtV * 0.7);
    let ant = a.curl ? 0 : moving || H ? 0.7 : a.grazing ? 0.8 : 0.2 + 0.8 * u.burst;
    let hop = 0, beat = 0, spread = 0, spin = 0, feed = 0;
    if (H?.kind) {
      const t = H.t;
      if (H.kind === 'jump') { hop = t < 0.12 ? t / 0.12 : Math.max(0, 1 - (t - 0.12) / 0.4); spin = H.spin * t; }
      else if (H.kind === 'flutter') { beat = 1; spread = 0.75; }
      else if (H.kind === 'swim') { beat = 1; ant = 1; }
      else if (H.kind === 'flick') hop = t < 0.25 ? 1 : Math.max(0, 1 - (t - 0.25) / 0.45);
    }
    if (a.curl) hop = a.curl.now;
    if (sp.kind === 'fly' && !H) {
      // a fly at rest flicks its wings out and back now and then (and grooms, which the antennae show)
      u.wT -= dtV;
      if (u.wT <= 0) { u.wing = 1; u.wT = 2 + Math.random() * 8; }
      u.wing = Math.max(0, u.wing - dtV * 2.5);
      spread = Math.sin(Math.PI * u.wing) * 0.7;
    }
    if (a.sm) {
      // A dwarf shrimp (sim/shrimp.js): its mind says how hard the pincers pick, the swimmerets fan (a berried female over her eggs,
      // and a little always) and the antennae work; the eggs show under the tail while she carries them.
      if (!H) feed = a.sFeed ?? 0;
      beat = Math.max(beat, (a.sFan ?? 0) * 0.45);
      if (!H) ant = Math.max(a.curl ? 0 : 0.15, a.sAnt ?? ant);
      spread = a.berried ? 1 : 0;
    } else if (sp.flicks && !H && !moving) feed = a.grazing ? 1 : 0.35;          // a shrimp picks at the bottom whenever it stands still
    a.legCalm = (a.legCalm ?? 1) + ((a.stepping > 0 || H ? 0 : 1) - (a.legCalm ?? 1)) * Math.min(1, dtV * 7);
    return { hop, ant, beat, feed, spread, calm: a.legCalm, spin };
  }

  // A calling bout (see vis): the vocal sac's inflation 0 … 1 now, or 0. Males of the dart frogs only; sitting, not hunting.
  frogCall(a, sp, v, dtV, busy) {
    if (sp.kind !== 'frog' || sp.breed <= 0) return 0;
    a.male ??= Math.random() < 0.5;
    if (!a.male || a.age / 1440 < (sp.adultDays ?? 10)) return 0;
    if (v.call) {
      v.call.t += dtV;
      if (busy || a.fs !== 'sit' || v.call.t >= v.call.dur) { v.call = null; v.callNext = 20 + Math.random() * 60; return 0; }
      return callSac(v.call.t, v.call.dur);
    }
    const E = this.world.env, sinceOn = ((E.minute % 1440) - (E.lightsOn ?? 480) + 1440) % 1440;
    const mood = (sinceOn < 240 ? 1 : 0.15) * (E.light() > 0.2 ? 1 : 0.2) * (1 + 2 * (E.rain ?? 0));
    v.callNext = (v.callNext ?? 5 + Math.random() * 40) - dtV * mood;
    if (v.callNext > 0 || busy || a.fs !== 'sit') return 0;
    v.call = { t: 0, dur: 3 + Math.random() * 6 };
    // Answering: other males within 25 cm call soon after.
    for (const b of this.by[a.sp] ?? []) if (b !== a && b.male && b.v && !b.v.call && a.pos.distanceTo(b.pos) < 25) b.v.callNext = Math.min(b.v.callNext ?? 99, 1 + Math.random() * 3);
    return 0;
  }

  // --- Salamanders, newts, axolotls and geckos ---------------------------------------------------------------------------
  // The decisions are in herp.js (pure); this senses the world for them and carries the intent out: it walks, swims, climbs the
  // background, creeps up on prey (the strike itself is hunter()/strikes()), and hands the head and tail posture to the rig
  // (a.hr, see draw()).
  herp(a, sp, arr, dt) {
    const W = this.world, T = W.terrain, E = W.env, C = W.climate, Wl = W.wall;
    const P = profileFor(a.sp, sp.kind);
    const m = (a.hm ??= herpMindFor(a.sp, Math.random, sp.kind));
    a.herp = true;
    a.male ??= sp.kind === 'gecko' ? false : Math.random() < 0.5;       // (mourning geckos are all female)
    const gecko = sp.kind === 'gecko', axo = sp.kind === 'axolotl';
    const wall = gecko && !!a.onWall;
    const x = a.pos.x, z = a.pos.z;
    const g = T.heightAt(x, wall ? Wl.zAt(x, a.pos.y) + 1.5 : z);
    const top = this.waterTop(x, z);
    const depth = top > -Infinity ? top - g : -1;
    const dtMin = dt * Math.min(this.warp ?? 1, 5);       // (at the fast speeds a breath would be all they did)
    const pl = (px, py, pz, onWall) => ({ x: px, z: onWall ? -py : pz });          // the plane the mind works in (see herp.js)
    const here = pl(x, a.pos.y, z, wall);
    // A shelter, and the slow senses, every few seconds.
    a.hhT = (a.hhT ?? 0) - dt;
    if (a.hhT <= 0) {
      a.hhT = 2 + Math.random() * 2;
      if (!a.hh || this.herpHomeScore(a, sp, P, a.hh) < 0.28) a.hh = this.herpFindHome(a, sp, P) ?? a.hh ?? null;
      a.hShore = null;
      if (sp.kind === 'newt' && a.sp === 'firesal') a.hShore = this.crabFind(x, z, 40, (px, pz, d) => d >= 0.3 && d <= 1.8);
      else if (depth <= 0.3) a.hShore = this.crabFind(x, z, 40, (px, pz, d) => d >= 1.6);
      if (gecko) a.hWet = this.geckoWetSpot(a, wall);
    }
    const mouth = this.mouth(a, sp, _m);
    // Looking for prey is the costly part (every list of everything it eats): a few times a second is plenty; in between the one it has
    // found is followed.
    a.hpT = (a.hpT ?? 0) - dt;
    if (a.hpT <= 0 || (a.hPrey && !this.validPrey(a.hPrey.p, a)) || a.order) { a.hpT = 0.25 + Math.random() * 0.2; a.hPrey = this.herpPrey(a, sp, P, mouth, wall); }
    else if (a.hPrey) { const pp = a.hPrey.p.pos; a.hPrey.d = Math.hypot(pp.x - mouth.x, pp.y + 0.15 - mouth.y, pp.z - mouth.z); a.hPrey.x = pp.x; a.hPrey.z = wall ? -pp.y : pp.z; a.hPrey.y = pp.y; }
    const prey = a.hPrey;
    const threat = this.herpThreat(a, sp, P, wall);
    const home = a.hh && { x: a.hh.x, z: gecko && a.hh.wall ? -a.hh.y : a.hh.z, wall: !!a.hh.wall };
    const Q = depth > 0.3 ? W.water.bodies.at(x, z) ?? E : E;
    const hy = wall ? a.pos.y : g + 1;
    const sense = {
      t: this.t, dt, dtMin, dtAir: dt * Math.min(this.warp ?? 1, 2), x: here.x, z: here.z, yaw: a.yaw ?? 0, kind: sp.kind, onWall: wall, depth,
      light: clamp(E.bright(), 0, 1), rain: E.rain ?? 0, rh: C.humidityAt(x, hy, z), temp: depth > 0.3 ? Q.temp ?? E.temp : C.tempAt(x, hy, z), oxygen: depth > 0.3 ? Q.oxygen : undefined,
      wetGround: Math.min(1, T.field.matAt(x, z, MAT.moss) + (W.nearWater(V(x, g, z), 3) ? 0.5 : 0)),
      cover: wall ? 0 : this.herpCover(x, z), hunger: a.hunger, health: a.health,
      male: !!a.male, adult: a.age / 1440 >= (sp.adultDays ?? 10), mate: this.herpMate(a, sp, P),
      // The lens is no danger to the animal being followed, nor in the second after a cut (trackTime: camCutT). Glass, bark and leaf
      // cannot be told apart yet: a wall is 'wall'.
      followed: a === this.watched, camCut: (this.camCutT ?? 0) > 0, surface: wall ? 'wall' : 'ground',
      prey, threat, home, reach: this.reachOf(a, sp), moved: a.hmoved ?? 0, toSurface: depth > 0.3 ? top - a.pos.y : 99,
      shore: a.hShore && { x: a.hShore.x, z: a.hShore.z, d: a.hShore.d },
      wetSpot: gecko && a.hWet ? { x: a.hWet.x, z: a.hWet.wall ? -a.hWet.y : a.hWet.z, d: Math.hypot(a.hWet.x - x, (a.hWet.wall ? -a.hWet.y : a.hWet.z) - here.z), wall: a.hWet.wall } : null,
      dew: E.condense ?? 0, mist: E.mist ?? 0,
      legsFn: () => this.herpLegs(a, sp, P, m, wall),
    };
    // A water animal in water too shallow to swim in, with no way out of it, is stranded (as swim() does it).
    if (axo && depth < 1.0 && !a.swimming) { a.stranded = true; a.pos.y = g + 0.3; a.pitch = Math.PI / 2 * Math.sin(this.t * 12 + a.phase) * 0.3; return; }
    a.stranded = false;
    const it = herpThink(m, sense);
    if (a.lab?.drive) this.labHerp(a, P, it, depth);
    // An escape the mind aimed at blindly (straight away from the danger) may be out of the water or behind a rock: swap it for one
    // it can reach, or none (it freezes where it is). Checked once per flight.
    if (m.mode === 'flee' && m.goal && !m.goalOk && !gecko) {
      m.goalOk = true;
      if (!(a.hh && m.goal.x === a.hh.x && m.goal.z === a.hh.z)) m.goal = this.herpEscape(a, sp, threat, depth > 0.3 ? 'water' : 'land');
      it.goal = m.goal; if (!m.goal) { it.speed = 0; it.swim = false; }
    }
    // Not getting anywhere (a goal it cannot walk or swim to): give it up and pause, rather than tread on the spot.
    if (it.goal && it.speed > 0.1 && (a.hmoved ?? 1) < 0.004 * Math.max(1, dt * 60)) a.hStuck = (a.hStuck ?? 0) + dt;
    else a.hStuck = 0;
    if (a.hStuck > 1.2) {
      a.hStuck = 0; m.goal = null; m.moveLeft = 0; m.pauseLeft = 1 + Math.random() * 2;
      if (m.mode === 'flee') m.fear = Math.min(m.fear, 0.3);
      it.goal = null; it.speed = 0;
    }
    if (it.say === 'warn' && Math.random() < 0.3) W.log(`A ${one(a.sp)} froze and showed its warning colours.`, 'info');
    a.hit = it;
    // Courtship partner (kept for the whole courtship), a mating, a birth, a dropped tail, a shed skin.
    a.courtWith = it.mode === 'court' ? (sense.mate?.ref ?? a.courtWith ?? null) : null;
    if (it.mated) {
      a.courtedUntil = (E.minute ?? 0) + 4 * 1440;       // (sim.js breeds courted animals more readily)
      if (a.male && Math.random() < 0.5) W.log(`A ${one(a.sp)} pair courted and mated.`, 'good');
    }
    if (it.birth) this.herpBirth(a, sp, it.birth);
    if (it.dropTail) { a.dropNow = true; W.log(`A ${one(a.sp)} dropped its tail to escape.`, 'info'); }
    if (it.shed && Math.random() < 0.25) W.log(`A ${one(a.sp)} shed its skin and ate it.`, 'info');
    a.doing = doing(it.mode, sp.kind, { prey: prey && prey.pid ? (prey.pid === 'flake' ? 'a food flake' : `a ${one(prey.pid)}`) : null, asleep: !!it.tuck, hot: sense.temp > P.tHot, wet: m.wet });
    a.hr = a.hr ?? [0, 0, 0, 0];
    a.hr[0] = it.head; a.hr[1] = it.headP; a.hr[2] = it.bend; a.hr[3] = it.tail;
    a.hpump = it.throat; a.heye = it.eye; a.hgill = it.gill;
    if (it.needHome && (a.hhT > 0.5)) a.hhT = 0.2;
    // --- Carry it out ---------------------------------------------------------------------------------------------------
    const px = a.pos.x, py = a.pos.y, pz = a.pos.z;
    const goal = it.goal;
    a.wantMove = !!goal && it.speed > 0.1;
    a.state = a.wantMove ? 'walk' : 'rest';
    a.target = goal ? V(goal.x, 0, gecko && wall ? 0 : goal.z) : null;
    if (gecko) this.geckoMove(a, sp, P, it, wall, dt);
    else if (depth > 1.3 && (it.swim || (goal && (m.mode === 'shore' || m.mode === 'return' || m.mode === 'flee') && depth > 1.6))) {
      // Swimming: to the goal, at the height the mode wants (the bottom, the surface, the prey).
      const ty = it.rise ? top - 0.5 : prey && m.mode === 'hunt' ? clamp(prey.p.pos.y, g + 0.6, top - 0.5) : it.bottom ? g + 0.9 : lerp(g, top, 0.55);
      const to = goal ?? (it.calm && !it.rise ? { x, z } : null);
      const sc = { x: to ? to.x : x, y: ty, z: to ? to.z : z, speed: goal ? it.speed : 0 };
      this.swim(a, { ...sp, band: 'bottom', school: false }, arr, dt, sc);
      a.swimming = true;
    } else {
      if (a.swimming) { a.swimming = false; a.vel.multiplyScalar(0.2); }
      const amph = m.mode === 'shore' || m.mode === 'return' || m.mode === 'flee' || !!a.lab?.drive;        // a newt in the water stays in it unless it is going ashore
      const medium = axo ? 'water' : a.sp === 'firesal' ? (m.mode === 'soak' ? 'any' : 'land') : amph || depth <= 0.3 ? 'any' : 'water';
      const maxD = a.sp === 'firesal' ? (m.mode === 'soak' ? 1.8 : 0.6) : 99;
      if (goal && it.speed > 0.1) this.herpStep(a, sp, P, goal, it.speed, dt, medium, maxD);
      else { a.hsp = (a.hsp ?? 0) * Math.max(0, 1 - dt * 8); if (it.face) this.turnTo(a, sp, Math.atan2(it.face.x - x, it.face.z - z), dt, 4); }
      const gy = T.heightAt(a.pos.x, a.pos.z);
      const ny = a.pos.y > gy + 0.05 ? Math.max(gy, lerp(a.pos.y, gy, Math.min(1, dt * 6))) : gy;
      // (one that stops swimming over sunken wood settles on it, not into it: it was relocated, swam back, and so on, many times a second)
      if (!(this.avoid && this.occ.count && ny < a.pos.y && this.occ.solidAt(a.pos.x, ny + 0.5, a.pos.z) && !this.occ.solidAt(a.pos.x, a.pos.y + 0.5, a.pos.z))) a.pos.y = ny;
      a.normal = T.normalAt(a.pos.x, a.pos.z);
    }
    a.hmoved = Math.hypot(a.pos.x - px, a.pos.y - py, a.pos.z - pz);
    a.grazing = false;
  }

  // Walking toward a point on the ground (or the bottom): turn first if it is behind, slide round what is in the way.
  herpStep(a, sp, P, goal, speed, dt, medium, maxD) {
    const x = a.pos.x, z = a.pos.z;
    const dx = goal.x - x, dz = goal.z - z, dist = Math.hypot(dx, dz);
    if (dist < 0.15) { a.hsp = (a.hsp ?? 0) * 0.5; return; }
    const want = Math.atan2(dx, dz), diff = angDiff(want, a.yaw ?? 0);
    // Pivot on the spot (about the hips) when the goal is well off the heading; the legs step round (move() counts the turn).
    this.turnTo(a, sp, want, dt, 8);
    const fwd = clamp(1 - Math.abs(diff) / 1.1, 0, 1);
    a.hsp = (a.hsp ?? 0) + (speed * fwd - (a.hsp ?? 0)) * Math.min(1, dt * 5);
    const step = Math.min(dist, a.hsp * dt);
    let ux = Math.sin(a.yaw), uz = Math.cos(a.yaw);
    if (fwd > 0.95) { ux = dx / dist; uz = dz / dist; }
    // (An animal standing where it is not allowed, in the margin by the glass, may step toward the middle.)
    const here = this.okFor(medium, x, z, maxD, a.rad);
    // (the way out toward the middle never leads into a piece: a newt on a pool's bottom hid in under the wood, was relocated, and
    // walked back in, several times a second)
    const solid = (nx, nz) => this.avoid && this.occ.count && this.occ.solidAt(nx, this.world.terrain.heightAt(nx, nz) + 0.5, nz);
    // (and nothing solid between here and there: a long step at the fast speeds walked through thin wood, B4b)
    const swept = (nx, nz) => !this.avoid || this.occ.walkFree(a, x, a.pos.y, z, nx, this.world.terrain.heightAt(nx, nz), nz) === 1;
    const free = (nx, nz) => (this.okFor(medium, nx, nz, maxD, a.rad) || (!here && Math.hypot(nx, nz * 1.6) < Math.hypot(x, z * 1.6) - 0.02 && !solid(nx, nz))) && !this.walkBlocked(a, nx, nz) && swept(nx, nz) && this.depthOkFor(a, sp, nx, nz);
    const probe = Math.max(step, 0.15);       // (the first step of a start has no length yet)
    if (!free(x + ux * probe, z + uz * probe)) {
      const sd = a.side ?? 1, base = Math.atan2(ux, uz);
      let ok = false;
      for (const da of [0.7 * sd, -0.7 * sd, 1.4 * sd, -1.4 * sd, 2.1 * sd]) {
        const sx = Math.sin(base + da), sz = Math.cos(base + da);
        if (free(x + sx * probe * 1.2, z + sz * probe * 1.2)) { ux = sx; uz = sz; a.side = Math.sign(da) || 1; ok = true; break; }
      }
      if (!ok) { a.hsp = 0; a.hm.goal = null; a.hm.moveLeft = 0; a.hm.pauseLeft = 1 + Math.random(); return; }
    }
    a.pos.x += ux * step; a.pos.z += uz * step;
  }

  // The gecko moves in the plane it is on; getting between the wall and the ground is a step at the foot of the wall.
  geckoMove(a, sp, P, it, wall, dt) {
    const W = this.world, T = W.terrain, Wl = W.wall;
    const goal = it.goal, hx = TANK.w / 2 - 2;
    const lo = W.water.level + 2, hi = TANK.h - 3;
    // On the wall it may not go lower than the soil that meets the wall there, by its own length: where the land rises against
    // the background, `lo` (just above the water) lies under the ground, and a gecko down there was drawn inside the soil.
    const b = this.bodyOf(a.sp), reach = b ? (b.tl + Math.abs(b.tc)) * drawScale(a, sp) : 2;
    const footAt = (x, y) => { const wz = Wl.zAt(x, y); return Math.max(T.heightAt(x, wz + 0.4), T.heightAt(x, wz + 1.5)); };
    // (the lowest point of the body: its length along the way it faces up or down the wall, its width across)
    const loAt = (x, y) => Math.max(lo, footAt(x, y) + reach * Math.abs(Math.cos(a.yaw ?? 0)) + (a.rad ?? 0.5) + 0.2);
    const lift = (low) => { if (a.pos.y < low) a.pos.y = Math.min(low, a.pos.y + dt * Math.max(P.walk ?? 2, 2.5)); };   // just climbed on: walks up clear
    const stepPlane = (tx, ty, speed, onWall) => {
      const dx = tx - a.pos.x, dy = ty - a.pos.y, d = Math.hypot(dx, dy);
      if (d < 0.2) { a.hsp = 0; return d; }
      a.yaw = angLerp(a.yaw ?? 0, Math.atan2(dx, -dy), Math.min(1, dt * 9));
      a.hsp = (a.hsp ?? 0) + (speed - (a.hsp ?? 0)) * Math.min(1, dt * 7);
      let st = Math.min(d, a.hsp * dt);
      // (B4b) a piece against the wall is stopped at, not walked through
      const sf = this.occ.segmentFreeAt(a, a.pos.x, a.pos.y + 0.5, a.pos.z, a.pos.x + dx / d * st, a.pos.y + dy / d * st + 0.5, a.pos.z);
      if (sf < 1) st *= sf;
      a.pos.x = clamp(a.pos.x + dx / d * st, -hx, hx);
      const y = a.pos.y + dy / d * st, low = onWall ? Math.min(loAt(a.pos.x, a.pos.y), hi) : 0;
      a.pos.y = Math.min(hi, y >= low ? y : a.pos.y >= low ? low : Math.max(y, a.pos.y));        // never further down while under it
      if (onWall) lift(low);
      return d;
    };
    if (wall) {
      let tx = goal ? goal.x : a.pos.x, ty = goal ? -goal.z : a.pos.y;
      const ground = T.heightAt(a.pos.x, Wl.zAt(a.pos.x, a.pos.y) + 1.5), low = Math.min(loAt(a.pos.x, a.pos.y), hi);
      if (!it.wantWall) { tx = a.pos.x; ty = low; }                       // down to the foot of the wall first
      if (goal || !it.wantWall) stepPlane(tx, clamp(ty, low, hi), it.wantWall || !goal ? (goal ? it.speed : P.walk) : P.walk, true);
      else a.hsp = (a.hsp ?? 0) * Math.max(0, 1 - dt * 8);
      lift(Math.min(loAt(a.pos.x, a.pos.y), hi));
      if (it.face && !goal) a.yaw = angLerp(a.yaw ?? 0, Math.atan2(it.face.x - a.pos.x, -(-it.face.z - a.pos.y)), Math.min(1, dt * 6));
      this.wallFrame(a, sp, dt);
      a.wallMode = true;
      // Off the wall at its lowest point: it steps down onto the ground in front.
      if (!it.wantWall && a.pos.y < low + 0.3) {
        a.onWall = false; a.wallMode = false; a.target = null; a._wn = null;
        let fz = Wl.zAt(a.pos.x, ground + 1) + Math.max(1.5, (a.rad ?? 0.5) + 0.6);
        for (let k = 0; k < 4 && this.crowded(a, sp, a.pos.x, fz); k++) fz += (a.rad ?? 0.5) * 1.2;      // not onto a frog sitting at the foot of the wall
        a.pos.set(a.pos.x, T.heightAt(a.pos.x, fz), fz);
      }
      return;
    }
    // On the ground.
    if (it.wantWall) {
      // To the back of the tank, then up the background.
      const wz = Wl.zAt(a.pos.x, a.pos.y + 1);
      if (a.pos.z < wz + 2.6) { a.onWall = true; a.pos.y += 1; a.hsp = 0; return; }
      this.herpStep(a, sp, P, { x: a.pos.x, z: wz + 1.5 }, goal ? it.speed : P.walk, dt, 'land', 5);
    } else if (goal && it.speed > 0.1) this.herpStep(a, sp, P, goal, it.speed, dt, 'land', 0.3);
    else { a.hsp = (a.hsp ?? 0) * Math.max(0, 1 - dt * 8); if (it.face) this.turnTo(a, sp, Math.atan2(it.face.x - a.pos.x, it.face.z - a.pos.z), dt, 5); }
    a.pos.y = T.heightAt(a.pos.x, a.pos.z);
    a.normal = T.normalAt(a.pos.x, a.pos.z);
    a.wallMode = false; a._wn = null;
  }

  // --- What they sense ---
  // How well covered a spot on the ground is: wood, cork or rock overhead, moss, leaf litter.
  herpCover(x, z) {
    const W = this.world, T = W.terrain, g = T.heightAt(x, z);
    const over = this.occ.count && this.occ.solidAt(x, g + 2.2, z) ? 1 : 0;
    return Math.min(1, over + T.field.matAt(x, z, MAT.moss) * 0.5 + Math.min(0.4, W.climate.sample(W.climate.litter, x, z) * 2));
  }

  // Cover under water: a ledge, a root or a rock close to the bottom, or a plant bed.
  herpWaterCover(x, z) {
    const g = this.world.terrain.heightAt(x, z);
    if (!this.occ.count) return 0;
    let c = this.occ.solidAt(x, g + 1.6, z) ? 1 : 0;
    for (const [dx, dz] of [[1.6, 0], [-1.6, 0], [0, 1.6], [0, -1.6]]) if (this.occ.solidAt(x + dx, g + 0.8, z + dz)) c += 0.2;
    return Math.min(1, c);
  }

  // Where a shelter is and how good: { x, z, y, wall } in world coordinates (a wall home has y, a ground home has z).
  herpHomeScore(a, sp, P, h) {
    const W = this.world, T = W.terrain, C = W.climate;
    if (sp.kind === 'gecko') {
      if (h.wall) {
        const wz = W.wall.zAt(h.x, h.y);
        const cov = this.occ.count && (this.occ.solidAt(h.x, h.y, wz + 1.6) || this.occ.solidAt(h.x, h.y + 1.2, wz + 1.6)) ? 1 : 0.15;
        let near = 0;
        for (const b of this.by[a.sp] ?? []) if (b !== a && b.hh && Math.hypot(b.hh.x - h.x, (b.hh.y ?? 0) - h.y) < 7) near = 1;
        const warm = 1 - clamp((C.tempAt(h.x, h.y, wz + 1) - P.tHot) / 4, 0, 1);
        return clamp(cov * 0.5 + near * 0.25 + C.humidityAt(h.x, h.y, wz + 1) / 100 * 0.15 + warm * 0.1 - (h.y > TANK.h - 6 ? 0.15 : 0), 0, 1);
      }
      if (!this.okFor('land', h.x, h.z)) return 0;
      return this.herpCover(h.x, h.z) * 0.8 + 0.1;
    }
    const d = this.waterTop(h.x, h.z) - T.heightAt(h.x, h.z);
    if (sp.kind === 'newt' && (a.sp === 'firesal' || a.hm?.onLand)) {             // (a newt in its land life hides on land too)
      if (!this.okFor('land', h.x, h.z)) return 0;
      if (this.badHomes?.some((b) => b.until > (W.env.minute ?? 0) && Math.hypot(b.x - h.x, b.z - h.z) < 3)) return 0;
      const g = T.heightAt(h.x, h.z);
      return hideScore({ cover: this.herpCover(h.x, h.z), light: C.lightAt(h.x, h.z), rh: C.humidityAt(h.x, g + 1, h.z), rhIdeal: P.rhIdeal, temp: C.tempAt(h.x, g + 1, h.z), tIdeal: P.tIdeal, dist: Math.hypot(h.x - a.pos.x, h.z - a.pos.z) });
    }
    if (!(d >= 1.6)) return 0;
    const shade = 1 - clamp(C.lightAt(h.x, h.z), 0, 1);
    return clamp(this.herpWaterCover(h.x, h.z) * 0.65 + shade * (P.lightShy ?? 0.3) * 0.5 + 0.12 - Math.hypot(h.x - a.pos.x, h.z - a.pos.z) * 0.003, 0, 1);
  }

  herpFindHome(a, sp, P) {
    const gecko = sp.kind === 'gecko';
    let best = null, bs = 0.25;
    for (let k = 0; k < 28; k++) {
      const r = 3 + Math.random() * (gecko ? 30 : 24), t = Math.random() * Math.PI * 2;
      let h;
      if (gecko && (a.onWall || Math.random() < 0.7)) {
        const y = clamp(a.pos.y + Math.cos(t) * r * 0.8, this.world.water.level + 3, TANK.h - 5);
        h = { x: clamp(a.pos.x + Math.sin(t) * r, -TANK.w / 2 + 3, TANK.w / 2 - 3), y, z: 0, wall: true };
      } else h = { x: a.pos.x + Math.sin(t) * r, z: a.pos.z + Math.cos(t) * r, y: 0, wall: false };
      const sc = this.herpHomeScore(a, sp, P, h) + Math.random() * 0.04;
      if (sc > bs) { bs = sc; best = h; }
    }
    return best;
  }

  // Candidates for the next leg of a patrol (herp.js pickLeg): points a few cm away that the animal can walk to, with what it
  // likes about them. Computed only when a leg is chosen.
  herpLegs(a, sp, P, m, wall) {
    const W = this.world, T = W.terrain, C = W.climate;
    const out = [];
    const land = a.sp === 'firesal' || m.mode === 'shore';
    const gecko = sp.kind === 'gecko';
    for (let k = 0; k < 6; k++) {
      const r = 4 + Math.random() * 12, t = Math.random() * Math.PI * 2;
      if (gecko && wall) {
        const x = clamp(a.pos.x + Math.sin(t) * r, -TANK.w / 2 + 2, TANK.w / 2 - 2), y = clamp(a.pos.y + Math.cos(t) * r, W.water.level + 2, TANK.h - 3);
        out.push({ x, z: -y, damp: C.humidityAt(x, y, W.wall.zAt(x, y) + 1) / 100, near: W.nearWater(V(x, y, 0), 8) ? 1 : 0, cover: this.occ.count && this.occ.solidAt(x, y, W.wall.zAt(x, y) + 1.6) ? 1 : 0, wall: true });
        continue;
      }
      const x = a.pos.x + Math.sin(t) * r, z = a.pos.z + Math.cos(t) * r;
      if (!this.okFor(gecko || land ? 'land' : 'water', x, z)) continue;
      const g = T.heightAt(x, z);
      let food = 0;
      if (a.hunger > 0.3) for (const pid of sp.eats) { const p = this.by[pid]?.[0]; if (p && Math.hypot(p.pos.x - x, p.pos.z - z) < 8) food = 1; }
      out.push({ x, z, damp: T.field.matAt(x, z, MAT.moss) + (W.nearWater(V(x, g, z), 5) ? 0.6 : 0), near: W.nearWater(V(x, g, z), 6) ? 1 : 0, cover: gecko || land ? this.herpCover(x, z) : this.herpWaterCover(x, z), food, wall: false });
    }
    return out;
  }

  // The wettest place a gecko can drink at: drops on the glass after rain or misting (any spot within a few cm), or the water's edge.
  geckoWetSpot(a, wall) {
    const W = this.world, E = W.env;
    if ((E.rain ?? 0) > 0.1 || (E.mist ?? 0) > 0.2 || (E.condense ?? 0) > 0.3) {
      const y = clamp(a.pos.y + (Math.random() - 0.3) * 10, W.water.level + 2, TANK.h - 4), x = clamp(a.pos.x + (Math.random() - 0.5) * 14, -TANK.w / 2 + 2, TANK.w / 2 - 2);
      return { x, y, z: 0, wall: true };
    }
    const sh = this.crabFind(a.pos.x, wall ? W.wall.zAt(a.pos.x, a.pos.y) + 4 : a.pos.z, 40, (px, pz, d) => d >= 0.3 && d <= 2.5);
    if (!sh) return null;
    return { x: sh.x, z: sh.z, y: 0, wall: false };
  }

  // The nearest of its kind of the other sex that it could court or be courted by, in the same medium (herp.js `mate`).
  herpMate(a, sp, P) {
    if (!P.court) return null;
    const T = this.world.terrain;
    const adult = (x) => x.age / 1440 >= (SPECIES[x.sp].adultDays ?? 10);
    const wet = (x) => this.waterTop(x.pos.x, x.pos.z) - T.heightAt(x.pos.x, x.pos.z) > 1.2;
    const same = (x) => (P.court === 'water' ? wet(x) : !x.swimming && !wet(x));
    const busy = new Set(['court', 'receive', 'follow', 'rest', 'forage', 'hide', 'shore', 'larviposit']);
    let best = null, bd = 35, courting = null;
    for (const b of this.by[a.sp] ?? []) {
      if (b === a || b.dead || !!b.male === !!a.male || !b.hm) continue;
      const d = Math.hypot(b.pos.x - a.pos.x, b.pos.z - a.pos.z);
      if (d >= 35) continue;
      if (!a.male && b.hm.mode === 'court' && b.courtWith === a) courting = { b, d };
      if (a.male && a.hm?.mode === 'court' && a.courtWith === b) { best = { b, d }; bd = -1; continue; }
      if (d < bd && adult(b) && adult(a) && same(b) && same(a) && busy.has(b.hm.mode) && !b.hm.gravid && b.hm.pregnant <= 0) { bd = d; best = { b, d }; }
    }
    const pick = courting ?? best;
    if (!pick) return null;
    const b = pick.b;
    return { x: b.pos.x, z: b.pos.z, d: pick.d, ok: true, courting: !!courting, phase: b.hm.cp, recv: b.hm.recv, ref: b };
  }

  // A fire salamander gives birth in the shallows: larvae into the water nearby (they grow up as tadpoles do, and leave it).
  herpBirth(a, sp, n) {
    const W = this.world, T = W.terrain;
    const mine = (this.by.larva ?? []).filter((t) => t.parent === a.sp).length + this.by[a.sp].length;
    const room = Math.max(0, sp.cap * 2 - mine);
    const pt = this.crabFind(a.pos.x, a.pos.z, 40, (px, pz, d) => d >= 1.6);
    if (!pt || !room) return;
    let k = 0;
    for (let i = 0; i < Math.min(n, room); i++) {
      const x = pt.x + (Math.random() - 0.5) * 2, z = pt.z + (Math.random() - 0.5) * 2;
      const g = T.heightAt(x, z), top = this.waterTop(x, z);
      if (!(top - g > 1.2)) continue;
      const c = this.add('larva', V(x, g + (top - g) * 0.4, z), { age: 0, hunger: 0.3 });
      if (c) { c.parent = a.sp; k++; }
    }
    if (k) W.log(`A ${one(a.sp)} gave birth to ${k} larvae in the water.`, 'good');
  }

  // The prey it is after: the one it has been ordered to hunt, or the nearest it can see or smell when it is hungry. `d` is from the mouth.
  herpPrey(a, sp, P, mouth, wall) {
    let p = null, pid = null, mine = false;
    const o = a.order;
    if (o && !a.st && this.validPrey(o.target, a)) { p = o.target; pid = o.pid; mine = true; }
    else if (a.hunger > 0.3 && !a.st) {
      let bd = Math.max(P.smell, P.sight);
      for (const id of dietOf(sp)) {
        if (!isItem(id) && !this.catchable(id)) continue;
        const q = this.nearestPrey(a, sp, id, bd);
        if (q) { const d = a.pos.distanceTo(q.pos); if (d < bd) { bd = d; p = q; pid = id; } }
      }
    }
    if (!p) return null;
    const pp = p.pos;
    return { p, pid, mine, d: Math.hypot(pp.x - mouth.x, pp.y + 0.15 - mouth.y, pp.z - mouth.z), x: pp.x, z: wall ? -pp.y : pp.z, y: pp.y, wall: sp.kind === 'gecko' && pp.y > a.pos.y - 8 && wall ? true : sp.kind === 'gecko' && pp.y > this.world.terrain.heightAt(pp.x, pp.z) + 3 && pp.z - this.world.wall.zAt(pp.x, pp.y) < 5,
      moving: p.state === 'fly' || p.state === 'walk' || !!p.hop || (p.vel ? p.vel.lengthSq() > 0.02 : false) };
  }

  // The nearest big thing that looms: the camera right up at the glass, a larger animal in the same medium that is close and moving.
  herpThreat(a, sp, P, wall) {
    const planar = (v) => ({ x: v.x, z: wall ? -v.y : v.z });
    const ct = this.camThreat(a, 22);
    let t = ct ? { ...planar(ct), d: ct.d, cam: true } : null;   // cam: the keeper's lens (the gecko brain caps its fear, herp.js geckoSeen)
    for (const id of ['leucomelas', 'dartfrog', 'auratus', 'toad', 'crab', 'firesal', 'newt', 'axolotl', 'gecko']) {
      if (id === a.sp) continue;
      const osp = SPECIES[id];
      if (osp.size < sp.size * 1.25) continue;
      for (const b of this.by[id] ?? []) {
        if (b.dead || !!b.swimming !== !!a.swimming && (sp.kind !== 'gecko') && Math.abs(b.pos.y - a.pos.y) > 3) continue;
        const d = Math.hypot(b.pos.x - a.pos.x, b.pos.y - a.pos.y, b.pos.z - a.pos.z);
        if (d < P.scareCm * 0.7 && ((b.speedNow ?? 0) > 0.6 || d < 3.5) && (!t || d < t.d)) t = { ...planar(b.pos), d: d * 1.1 };
      }
    }
    return t;
  }

  // A long body standing on uneven ground (a slope, the edge of a stone, a bank): the footing plane carries the trunk, but the tail
  // beyond the hind feet would run on in a straight line into the ground (or stick out over a drop) and the snout ahead of the fore
  // feet into a bank. Returns { lift, head }: the tail's lift (rig2Pack: a fraction of the body length at the tip, the curve growing
  // from the middle of the body) that lays it on the ground, never under it, and the head pitch (radians, nose up) that keeps the chin
  // above it. Measured at three stations along the tail and one under the chin, in the drawn pose (q, pos, scale sc).
  groundBend(id, pos, q, sc, rig2) {
    const b = this.bodyOf(id);
    if (!b || !rig2) return null;
    const T = this.world.terrain, len = rig2.len, zS = b.zc + b.hlen, zT = b.zc - b.hlen;
    const gap = (s, y) => { _gb.set(0, y, zS - s * (zS - zT)).multiplyScalar(sc).applyQuaternion(q).add(pos); return _gb.y - T.heightAt(_gb.x, _gb.z); };
    let need = -Infinity, room = Infinity;
    for (const s of [0.72, 0.86, 1]) {
      const tt = (s - 0.5) * 2, k = tt * tt * len * sc, g = gap(s, 0.06 * (rig2.neckY ?? 0.7));
      need = Math.max(need, -g / k); room = Math.min(room, g / k);
    }
    const lift = clamp(need > 0 ? need : -room * 0.85, -LIFT_MAX, LIFT_MAX);
    const chin = gap(0.03, 0.3 * (rig2.neckY ?? 0.7)), arm = Math.max(0.5, (rig2.neck - 0.03) * len * sc);
    return { lift, head: chin < 0 ? clamp(Math.atan2(-chin, arm), 0, 0.7) : 0 };
  }

  // A spot to flee to, 6 to 14 cm away from the danger and reachable in a straight line: through water at least 1.6 cm deep for a
  // water animal, over ground it may walk on for a land one, and nothing solid on the way. The farthest of a few tries, or null.
  herpEscape(a, sp, threat, medium) {
    const W = this.world, T = W.terrain, x = a.pos.x, z = a.pos.z;
    const away = threat ? Math.atan2(x - threat.x, z - threat.z) : (a.yaw ?? 0) + Math.PI;
    const deep = (px, pz) => this.waterTop(px, pz) - T.heightAt(px, pz) >= 1.6;
    const ok = (px, pz) => (medium === 'water' ? deep(px, pz) && this.okFor('water', px, pz, 99, a.rad) : this.okFor(medium, px, pz, a.sp === 'firesal' ? 0.6 : 99, a.rad))
      && !(this.occ.count && this.occ.solidAt(px, T.heightAt(px, pz) + 0.8, pz));
    let best = null, bs = -1e9;
    for (let k = 0; k < 12; k++) {
      const ang = away + (k < 6 ? (k - 2.5) * 0.28 : (Math.random() - 0.5) * 2.6), r = 6 + Math.random() * 8;
      const gx = x + Math.sin(ang) * r, gz = z + Math.cos(ang) * r;
      let fine = ok(gx, gz);
      for (let i = 1; fine && i < 4; i++) fine = ok(x + (gx - x) * i / 4, z + (gz - z) * i / 4);
      if (!fine) continue;
      const sc = (threat ? Math.hypot(gx - threat.x, gz - threat.z) : r) + this.herpWaterCover(gx, gz) * 4 - Math.abs(ang - away) * 2;
      if (sc > bs) { bs = sc; best = { x: gx, z: gz }; }
    }
    return best;
  }

  // Where the feet are: the ground under the fore and hind feet and under both flanks (from the species' mesh, as in
  // capsuleOf), a plane fitted through them, and how far the body must move up or down from a.pos (the ground under its
  // middle) to stand on that plane. Returns { up, dy } or null before the mesh is measured. On a hump the middle is high and
  // the feet would dangle: the body comes down onto them, but never sinks more than a third of its height into the ground.
  footing(a, sp) {
    const b = this.bodyOf(a.sp);
    if (!b) return null;
    const T = this.world.terrain, sc = drawScale(a, sp);
    const fx = Math.sin(a.yaw ?? 0), fz = Math.cos(a.yaw ?? 0), rx = fz, rz = -fx;
    // (a gecko's or a newt's tail is not a foot: the hind point half the length back lay on the tail, on the ground behind it, and a
    // gecko in a hollow was drawn 2.3 cm up in the air on its tail and snout, or sunk into the rise ahead; they stand on their feet)
    const ff = TAILED.has(sp.kind) && b.feet, zc = b.zc * sc, side = (b.hw / 0.6) * sc * 0.75;
    const fore = ff ? ff.fore * sc : zc + b.hlen * sc * 0.5, hind = ff ? ff.hind * sc : zc - b.hlen * sc * 0.45;
    const x = a.pos.x, z = a.pos.z;
    // (standing on level ground at the foot of a bank, ground rising beside it steeper than it can stand on, as cliffAt, is the bank,
    // not a foothold: a frog there, a flank's point up it, was drawn tipped on its side and lifted 2.6 cm, floating, a gecko 3.9 cm; it
    // stands on what is under it until it is on the slope.)
    const [gx, gz] = T.field.gradient(x, z), h0 = T.heightAt(x, z), wall = gx * gx + gz * gz < 0.56;
    const foot = (h, d) => (wall && h - h0 > 1.73 * Math.max(0.3, Math.abs(d)) ? h0 : h);
    const hF = foot(T.heightAt(x + fx * fore, z + fz * fore), fore), hB = foot(T.heightAt(x + fx * hind, z + fz * hind), hind);
    const hR = foot(T.heightAt(x + rx * side, z + rz * side), side), hL = foot(T.heightAt(x - rx * side, z - rz * side), side);
    const span = Math.max(0.3, fore - hind);
    // Up from the two tangents of the plane: along the body (hind to fore) and across it (left to right).
    const t1x = fx * span, t1y = hF - hB, t1z = fz * span, t2x = rx * 2 * side, t2y = hR - hL, t2z = rz * 2 * side;
    const up = _fu.set(t1y * t2z - t1z * t2y, t1z * t2x - t1x * t2z, t1x * t2y - t1y * t2x);
    if (up.y < 0) up.negate();
    up.normalize();
    if (up.y < 0.35 && sp.kind !== 'gecko') return null;               // a cliff edge: leave it to the old tilt (a gecko climbs it)
    const yPlane = 0.5 * (hB + (hF - hB) * (-hind / span)) + 0.25 * (hL + hR);
    const dy = Math.max(yPlane - h0, -b.hh * sc * 0.33);     // a.pos.y is the ground under its middle
    return { up, dy };
  }

  // Bodies at the water, for the ripples (render/waterfx.js addHull: the water a body pushes aside as it moves goes into the ripple
  // field): every animal that can be in or on the water is a sphere at its body's middle, as wide as its body, while it is within
  // reach of a surface (the surface over it is looked up every few frames, every frame while it is in the air). A swimming frog is
  // its skeleton instead: a sphere at its trunk and at every joint of its limbs, where the stroke puts them (draw).
  hulls() {
    const fx = this.world.fx;
    if (!fx?.addHull) return;
    const Wt = this.world.water, f = (this._hf = (this._hf ?? 0) + 1);
    for (const [id, arr] of Object.entries(this.by)) {
      const sp = SPECIES[id], k = HULL[sp.kind];
      if (!k) continue;
      for (const a of arr) {
        if (a.hop || a.wetS === undefined || ((f + a.id) & 7) === 0) a.wetS = Wt.surfaceAt(a.pos.x, a.pos.z, 0.2);
        const s = a.wetS;
        if (!(s > -1e9)) continue;
        const r = Math.max(0.25, k * sp.size * drawScale(a, sp)), y = a.pos.y + (sp.kind === 'swim' ? 0 : r * 0.9);
        if (y - r > s + 4 || s - (y + r) > 3 * r) continue;           // well above the water, or deep under it
        if (a.swHull && a.swHullF >= f - 2) continue;                 // (a swimming frog: its skeleton's spheres, from draw)
        fx.addHull(a.id * 32, a.pos.x, y, a.pos.z, r);
      }
    }
  }

  // A body at the surface rides the water (render/waterfx.js probe: the height of the drawn surface under it, the ripples and the
  // small travelling waves, averaged over its footprint, read back from the GPU a frame or two late): it rises and falls with the
  // rings a kick, a drop or a fall sends past it and tips with their slope, eased as its mass would, so on still water it lies still.
  // Returns a.ride { y, p, r }: cm up, and the pitch (nose down positive) and roll (+x flank up positive) in radians that lay it on
  // the slope. A frog under the water (a dive) and a newt below the surface ride nothing; on a platform without readings, nothing.
  ride(a, sp, sc, dt) {
    const fx = this.world.fx, R = (a.ride ??= { y: 0, p: 0, r: 0 });
    const rad = Math.max(0.3, (HULL[sp.kind] ?? 0.4) * sp.size * sc);
    let w = 1;
    if (sp.kind === 'frog' || sp.kind === 'toad') w = a.dive ? 0 : 1;
    else {
      // (a newt or axolotl: as much as its back is up at the surface)
      const s = a.wetS ?? this.world.water.surfaceAt(a.pos.x, a.pos.z, 0.2);
      w = s > -1e9 ? clamp((a.pos.y + rad - (s - 1)) / 0.8, 0, 1) : 0;
    }
    let y = 0, p = 0, r = 0;
    if (w > 0 && fx?.probe) {
      fx.probe(a.id, a.pos.x, a.pos.z, rad);
      const s = fx.surface(a.id);
      if (s) {
        const sy = Math.sin(a.yaw), cy = Math.cos(a.yaw);
        y = clamp(s.h, -RIDE_MAX, RIDE_MAX) * w;
        p = -clamp(Math.atan(s.sx * sy + s.sz * cy), -RIDE_TIP, RIDE_TIP) * w;
        r = clamp(Math.atan(s.sx * cy - s.sz * sy), -RIDE_TIP, RIDE_TIP) * w;
      }
    }
    const k = Math.min(1, dt * 14), kt = Math.min(1, dt * 9);
    R.y += (y - R.y) * k; R.p += (p - R.p) * kt; R.r += (r - R.r) * kt;
    return R;
  }

  draw(dt = 0.016) {
    this.hulls();
    const q = this._q;
    const e = new THREE.Euler();
    const tq = new THREE.Quaternion();
    const fix = new THREE.Quaternion();
    const cam = this.camera?.position;
    const CS = this.contacts, T = this.world.terrain;
    CS.begin();
    for (const [id, arr] of Object.entries(this.by)) {
      const sp = SPECIES[id];
      const an = sp.anim ?? {};
      const morphs = hasGenetics(id);
      const dm = arr.length ? this.meshFor(id) : null;   // built the first time the species has an animal
      const invRig = !!dm?.opts?.finish?.invert;          // insects, isopods and shrimp with antennae, wings, swimmerets … (invertPose)
      for (const k of this.keys[id]) this.meshes[k].begin();
      for (const a of arr) {
        const cm = morphs && a.morph ? this.meshFor(id, a.morph) : dm;
        const sc = drawScale(a, sp);
        const swimming = sp.kind === 'swim' || a.swimming;
        // A swimming frog or toad is drawn in the breaststroke pose (forelegs along the flanks, hind legs kicking), level, bobbing on the water.
        const frogish = sp.kind === 'frog' || sp.kind === 'toad';
        // A species with a swimming-pose model draws that one (level already, legs out); the others get the pose from the rig.
        // A frog asleep on its perch (sitting on a leaf, wood or the glass) draws its sleeping-pose model where it has one
        // (legs folded tight, hands under the chin: made from its skeleton, tools/rig/skeleton.mjs).
        const sleepMesh = frogish && !a.swimming && !a.hop && a.perch?.ph === 'sit' ? this.meshFor(id, null, 'sleep') : null;
        // A frog in the water is drawn by its own body, legs driven through the stroke (util/gait.js swimPose: the skeleton near
        // the camera, the vertex rig far); the static swimming-pose models (<id>.swim.glb) are no longer drawn: a frozen pose sliding
        // through the water read as floating and twitching.
        const poseMesh = sleepMesh;
        // A frog in the water is drawn in its swimming body (`<id>.swim`: the frog scanned mid-stroke, its limbs apart, skinned by its
        // own skeleton through the stroke: render/creatures/skeleton.js poseStroke); until that has loaded, in the sitting one.
        const swimMesh = frogish && a.swimming && !a.hop ? this.meshFor(id, morphs && a.morph ? a.morph : null, 'swim') : null;
        const sw = frogish && a.swimming && !a.hop ? swimPose(a.sw ??= swimState(), swimProfile(id), { t: this.t + a.phase, ...(swimMesh ? { level: 0 } : {}) }) : null;
        // At the surface it rides the water: up and down with the ripples under it and tipped with their slope (ride).
        const rd = a.swimming && !a.hop && (frogish || sp.kind === 'newt' || sp.kind === 'axolotl') ? this.ride(a, sp, sc, dt / this.tf) : null;
        if (a.wallMode || (a.perch?.glassN && a.perch.ph !== 'go')) {
          // On the background (or a reed frog on the glass): belly to the wall, heading within its plane.
          q.setFromUnitVectors(UP, a.normal ?? UP);
          q.multiply(tq.setFromAxisAngle(UP, a.yaw));
        } else if (a.normal && !swimming && !a.hop) {
          // Standing on the ground: on the plane through the ground under its feet (see footing), so on a bank or a hump the
          // front and hind feet both touch, rather than the body tilting with the slope under its middle and its feet in the air.
          const ft = !a.perch && (VIS.has(sp.kind) || (a.rad ?? 0) >= 0.4) ? this.footing(a, sp) : null;   // (a broad roach or a crab too)
          const up = ft ? ft.up : a.normal.clone().lerp(UP, 0.3).normalize();
          q.setFromUnitVectors(UP, up);
          q.multiply(tq.setFromAxisAngle(UP, a.yaw));
          if (ft) { a._fy = ft.dy; }
        } else {
          e.set((sw ? sw.pitch + (a.diveP ?? 0) : a.pitch ?? 0) + (rd ? rd.p : 0), a.yaw + (sw?.yaw ?? 0), (sw ? sw.roll : 0) + (rd ? rd.r : 0), 'YXZ');
          q.setFromEuler(e);
        }
        // A gecko or a frog on a climb (a perching frog, one climbing out of the water): its frame turns smoothly while it climbs, gets
        // on and gets off (steadyFrame; off a climb it is drawn as it stands).
        if (sp.kind === 'gecko' || frogish) this.steadyFrame(a, q, dt / this.tf, !!(a.wallMode || a.onWall || (a.perch && a.perch.ph !== 'go')));
        const rel = Math.min(1.5, (a.speedNow ?? 0) / Math.max(0.1, sp.speed));
        const walker = sp.kind === 'newt' || sp.kind === 'axolotl' || sp.kind === 'gecko' || sp.kind === 'skink';
        // Undulation: strong when swimming; walking salamanders, newts and geckos bend sideways in step with the legs.
        let amp = (an.amp ?? 0) * (swimming ? 0.6 + rel * 0.6 : walker ? Math.min(1, rel * 1.2) * 0.9 : rel * 0.35);
        if (a.stranded) amp = (an.amp ?? 0.3) * 2.5;
        a.wph = (a.wph ?? a.phase) + dt * (swimming ? 5 + rel * 7 : 3 + rel * 4) * 2 * (a.herp ? 0.5 + (a.hgill ?? 0.3) * 1.4 : 1) * (a.sm ? 1 + 2.4 * (a.sFeed ?? 0) : 1);
        if (walker && !swimming && (a.speedNow ?? 0) > 0.05) a.wph = (a.gait ?? 0) + a.phase;
        // Legs: stretched out through the first part of a hop and tucked in
        // for the landing; a swimming frog kicks.
        let hop = 0;
        if (a.hop) hop = hopLegs(a.hop.t);
        else if (sw) hop = sw.hop;
        let pos = a.pos, packed = hop;
        if (VIS.has(sp.kind) || sp.kind === 'crawlWater' || sp.kind === 'crawlLand' || sp.kind === 'crab' || sp.kind === 'fly') {
          const v = this.vis(a, sp, dt / this.tf);
          if (VIS.has(sp.kind) && !a.swimming) {
            a.swimFold = 0;
            if (!a.hop) hop = Math.max(hop, v.hop, a.tapT > 0 ? toeTap(this.t + a.phase) : 0);
            // Legs work while it walks or turns; when it stops they settle planted (an unstopped gait left two feet in the air).
            a.legCalm = (a.legCalm ?? 1) + ((a.stepping > 0 || a.hop ? 0 : 1) - (a.legCalm ?? 1)) * Math.min(1, dt / this.tf * 7);
            if (a.herp) { v.throat = Math.max(v.throat, (a.hpump ?? 0) * 0.62); v.eye = Math.max(v.eye, a.heye ?? 0); }
            // A perching frog asleep on its leaf by day: eyes shut (drawn down into the head), easing open as it wakes.
            a.sleepEye = (a.sleepEye ?? 0) + ((a.perch?.ph === 'sit' ? 0.85 : 0) - (a.sleepEye ?? 0)) * Math.min(1, dt / this.tf * 2);
            if (a.sleepEye > 0.01) v.eye = Math.max(v.eye, a.sleepEye);
            packed = packAnim(hop, v.breath, v.throat, v.eye, 0, a.legCalm);
            if (!a.hop) pos = _p.copy(a.pos).add(v.off); pos.y += v.y;
          } else if (VIS.has(sp.kind)) {
            // A swimming frog or toad is in the stroke pose; a swimming newt or axolotl folds its legs back along the body and drives
            // with the tail (util/gait.js salamanderSwimPose: the forelegs laid back against the flanks, the hind legs trailing).
            // (the swimming body far off or without its skeleton: the rig only stretches its legs back a little with the kick)
            if (swimMesh) packed = packAnim(sw.hop * 0.5, v.breath, 0, v.eye, 0, 1);
            else if (sw) packed = packAnim(hop, v.breath, 0, v.eye, sw.pose, sw.calm);
            else if (sp.kind === 'newt' || sp.kind === 'axolotl') {
              const ss = salamanderSwimPose(rel);
              a.swimFold = Math.min(1, (a.swimFold ?? 0) + dt * 3);
              packed = packAnim(ss.hop * a.swimFold, v.breath, 0, v.eye, ss.pose * a.swimFold, ss.calm);
            } else packed = packAnim(hop, v.breath, 0, v.eye);
            if (sw) { pos = _p.copy(a.pos); if (!a.dive) pos.y += kickHeave(sp.size, frac(a.kick ?? 0), a.floating ? 0 : 1); }
          }
          if (!sw) {
            // (the look-round and nosing yaw is not a spin of the whole body: the head turns it, a.visYaw, or the animal steps round)
            a.visYaw = v.yaw + v.yawN;
            if (!a.hop && !a.wallMode) _qo.setFromEuler(_e.set(v.pitch, 0, v.roll, 'YXZ')); else _qo.setFromEuler(_e.set(v.pitch, 0, 0, 'YXZ'));
            if (!a.hop) q.multiply(_qo);
          }
          if (invRig) {
            const ip = this.invertPose(a, sp, dt / this.tf);
            packed = packAnim(ip.hop, ip.ant, ip.beat, ip.feed, ip.spread, ip.calm);
            if (ip.spin) q.multiply(_qo.setFromAxisAngle(_t.set(1, 0, 0), ip.spin));
          }
        }
        if (a._fy) { if (pos === a.pos) pos = _p.copy(a.pos); pos.y += a._fy; a._fy = 0; }
        if (rd?.y) { if (pos === a.pos) pos = _p.copy(a.pos); pos.y += rd.y; }
        if (sp.kind === 'skink' && a.sk) {
          // Playing dead: rolled onto its back; hiding: sunk into the litter with the head out.
          if (a.sk.rollNow > 0.01) { q.multiply(_qo.setFromAxisAngle(_t.set(0, 0, 1), Math.PI * a.sk.rollNow)); pos = _p.copy(pos); pos.y += 0.5 * sc * Math.sin(Math.PI * a.sk.rollNow) + 0.35 * sc * a.sk.rollNow; }
          if (a.sk.sinkNow > 0.01) { pos = _p.copy(pos); pos.y -= a.sk.sinkNow * 0.5 * sc; }
        }
        if (sp.kind === 'crab' && a.cb) {
          // anim.y: the direction of travel along the body's x (the leading side), anim.x: the claw wave phase; claw pose and
          // still legs ride in the packed word; a crab in its burrow sinks until only the eye stalks show.
          const cb = a.cb, i = a.ci ?? {};
          cb.wph = (cb.wph ?? 0) + dt * (i.mode === 'eat' ? 4 : 2.6);
          amp = -cb.lead; a.wph = cb.wph;
          packed = packAnim(0, 0, 0, 0, i.claw ?? 0, Math.min(i.calm ?? 1, 1 - Math.min(1, Math.abs(a.turnW ?? 0) / 0.6)));   // (the legs step while it turns)
          if (cb.sinkNow > 0.01) { pos = _p.copy(pos); pos.y -= cb.sinkNow * 1.35 * sc; }
        }
        // The swimming-pose model flexes a little in time with the stroke; everything else is the rig's business.
        // A frog in the air is drawn in its swimming body too, posed as a leap (util/gait.js leapStroke): that body's legs are apart
        // and straighten cleanly, where the sitting scan's folded legs smear when they are stretched. From just after the feet leave
        // the ground to just before they land; the body's line follows the leap, nose up as it goes.
        // (since 5 Oct the whole hop, launch and landing included, as real frogs hop: util/hop.js and leapPose; the sitting body only once
        // the landing has settled)
        const hf0 = frogish && a.hop?.plan && !a.hop.kind && !sleepMesh ? this.leapFrame(a, sp, sc) : null;
        const leapMesh = hf0?.body === 'swim' ? this.meshFor(id, morphs && a.morph ? a.morph : null, 'swim') : null;
        if (leapMesh?.strokes) {
          const hp = a.hop, hf = this.leapFrame(a, sp, sc, hp.t, leapMesh), st = a.leapA = leapPose(hp.plan, hf.at, a.leapA ?? null);
          st.frames = { f0: hp.f0 ??= this.leapFrame(a, sp, sc, 0, leapMesh), ft: hf };
          // (the frame is the hop's own, heading along its line: turned into the tank by that heading, the body by its yaw)
          const hd = hp.y1 ?? a.yaw, ch = Math.cos(hd), sh = Math.sin(hd);
          _p.set(hp.from.x + hf.pos[0] * ch + hf.pos[2] * sh, hp.from.y + hf.pos[1], hp.from.z - hf.pos[0] * sh + hf.pos[2] * ch);
          q.setFromEuler(e.set(hf.pitch, a.yaw, hf.roll, 'YXZ'));
          leapMesh.put(_p, q, sc, 0, 0, 0, packAnim(0, 0, 0, 0, 0, 1), cam ? cam.distanceToSquared(a.pos) : 1e9, 0, 0, 0, 0, 1, 0, 0, 0, 0, st);
        } else if (sleepMesh) sleepMesh.put(pos, q, sc, 0, 0, 0, packed, cam ? cam.distanceToSquared(a.pos) : 1e9);   // (breathing, eyes shut)
        else if (swimMesh) {
          sw.stroke.info = a.swTips ??= {};
          swimMesh.put(pos, q, sc, 0, 0, 0, packed, cam ? cam.distanceToSquared(a.pos) : 1e9, 0, 0, 0, 0, 1, 0, 0, 0, 0, sw.stroke);
          // its body in the water as the stroke posed it (the trunk and every joint of its limbs: skeleton.js poseStroke `hull`), for
          // the ripples: the knees sweeping out, the feet driving back and the hands each move their own water
          // (where it would be on still water: riding the ripples moves no water, and counted as moving it the frog would feed its
          // own bobbing)
          const hull = a.swTips.hull, fx = this.world.fx;
          a.swHull = false;
          if (hull?.length && fx?.addHull) {
            const qh = rd ? _qh.setFromEuler(e.set(sw.pitch + (a.diveP ?? 0), a.yaw + sw.yaw, sw.roll, 'YXZ')) : q, dy = rd ? rd.y : 0;
            for (let k = 0; k < hull.length; k++) {
              const h = hull[k];
              _t.set(h[0], h[1], h[2]).multiplyScalar(sc).applyQuaternion(qh).add(pos);
              fx.addHull(a.id * 32 + 1 + k, _t.x, _t.y - dy, _t.z, h[3] * sc);
            }
            a.swHull = true; a.swHullF = this._hf;
          }
        }
        else if (poseMesh) poseMesh.put(pos, q, sc, (a.kick ?? 0) * TAU, 0.16, 0, 0, cam ? cam.distanceToSquared(a.pos) : 1e9);
        else if (a.hr && an.rig2) {
          // The mind's head, bend and tail, plus what the gait adds: the head swings against the body wave as the feet step, and
          // follows the wave (late) when swimming.
          const r = a.hr, lk = walker && !swimming ? Math.min(1, rel * 1.5) : 0;
          const hy = r[0] + 0.2 * lk * Math.sin((a.gait ?? 0) + 1) + (swimming ? 0.14 * Math.min(1, rel) * Math.sin(a.wph - 0.7) : 0);
          // On the ground the tail lies along it and the snout stays out of a bank ahead (groundBend); swimming, both straighten.
          const gb = !swimming && !a.wallMode && !a.hop && !a.stranded ? this.groundBend(id, pos, q, sc, an.rig2) : null;
          const kb = Math.min(1, dt * 7);
          a.tLift = (a.tLift ?? 0) + ((gb ? gb.lift : 0) - (a.tLift ?? 0)) * kb;
          a.hLift = (a.hLift ?? 0) + ((gb ? gb.head : 0) - (a.hLift ?? 0)) * kb;
          // A turn adds its own pose (turnPoseStep): the spine bends into it, the head leads, the tail follows; all of it inside the
          // body plan's joint limits (util/bodyplan.js), whatever the mind and the gait ask for on top.
          const tp = a.turnPose ?? NO_TURN, [hy2, bend2, tail2] = limitRig(planOf(sp), hy + tp[0] + (a.visYaw ?? 0), r[2] + tp[1], r[3] + tp[2]);
          cm.put(pos, q, sc, a.wph, amp, a.gait ?? 0, packed, cam ? cam.distanceToSquared(a.pos) : 1e9, hy2, r[1] + a.hLift, bend2, tail2, a.hm?.tailF ?? 1, a.hm?.dull ?? 0, 0, a.tLift, a.turnMix ?? 0);
          if (a.dropNow) {
            // The tail has just come off: a piece of it stays where it was, falls and thrashes.
            a.dropNow = false;
            const n = this.tails.filter((t) => t.sp === id).length;
            if (n >= 6) this.tails.splice(this.tails.findIndex((t) => t.sp === id), 1);
            this.tails.push({ sp: id, pos: pos.clone(), q: q.clone(), sc, age: 0, phase: 0, vy: 0, wall: !!a.wallMode, cut: 0.5 + 0.5 * 0.1, lie: false });
          }
        } else if (cm?._lo?.finish?.rig2) {
          // A body that bends without a mind steering its head (a fish, the skink): the turn's C-bend and tail, and the legs' turning mix.
          const tp = a.turnPose ?? NO_TURN, [hy2, bend2, tail2] = limitRig(planOf(sp), tp[0] + (a.visYaw ?? 0), tp[1], tp[2]);
          cm.put(pos, q, sc, a.wph, amp, a.gait ?? 0, packed, cam ? cam.distanceToSquared(a.pos) : 1e9, hy2, 0, bend2, tail2, 1, 0, 0, 0, a.turnMix ?? 0);
        } else cm.put(pos, q, sc, a.wph, cm?._lo?.finish?.turnSweep?.inY ? a.turnMix ?? 0 : amp, a.gait ?? 0, packed, cam ? cam.distanceToSquared(a.pos) : 1e9);   // (a frog's anim.y: the turning mix)
        // Its contact shadow: the body's outline (or a disc for the small and the unmeasured), fading as it leaves the ground.
        if (!swimming && !a.wallMode && !a.perch && !a.onWall && sp.kind !== 'egg' && (a.rad ?? 0) >= 0.25) {
          const b = this.bodyOf(id), fx = Math.sin(a.yaw ?? 0), fz = Math.cos(a.yaw ?? 0);
          const w = b ? (b.hw / 0.6) * 2 * sc * 1.05 : a.rad * 2.6, l = b ? b.hlen * 2 * sc * 1.05 : a.rad * 2.8, zc = b ? b.zc * sc : 0;
          const gx = a.pos.x + fx * zc, gz = a.pos.z + fz * zc, gy = T.heightAt(gx, gz);
          const lift = pos.y - gy;
          if (lift < l) CS.put(_p.set(gx, gy, gz), a.normal ?? UP, a.yaw ?? 0, w * (1 + Math.max(0, lift) / l * 0.4), l * (1 + Math.max(0, lift) / l * 0.4), 0.55 * (1 - Math.max(0, lift) / l));
        }
      }
      // Dropped tails (geckos): the part of the gecko mesh beyond the cut, thrashing for a few seconds, then lying still, then gone.
      if (this.tails.length && an.rig2 && dm) {
        for (let i = this.tails.length - 1; i >= 0; i--) {
          const t = this.tails[i];
          if (t.sp !== id) continue;
          t.age += dt;
          if (t.age > 90) { this.tails.splice(i, 1); continue; }
          const g = this.world.terrain.heightAt(t.pos.x, t.pos.z) + 0.1;
          if (!t.lie) {
            t.vy -= 30 * dt; t.pos.y += t.vy * dt;
            if (t.pos.y <= g) {
              t.pos.y = g; t.lie = true;
              t.q.setFromEuler(e.set(0, Math.random() * TAU, 0));     // it lands flat
              t.cut = 0.55;
            }
          }
          const thrash = Math.max(0, 1 - t.age / 22), ph = t.age * (9 + 6 * thrash);
          dm.put(t.pos, t.q, t.sc, 0, 0, 0, 0, 1e9, 0, 0, 0.0, 0.26 * thrash * Math.sin(ph), 1, 0, t.cut, 0);
        }
      }
      for (const k of this.keys[id]) this.meshes[k].end();
    }
    CS.end();
    void fix;
    // Cast shrimp shells: they lie where they were left and crumble as they are picked at, gone in a day or two.
    if (this.shells.length || this.castShells.meshes.size) {
      const dm = Math.min(this.warp ?? 1, 40) * dt;
      for (const sh of this.shells) { sh.age += dm; sh.left = Math.min(sh.left, 1 - sh.age / sh.life); }
      this.shells = this.shells.filter((sh) => sh.left > 0);
      this.castShells.draw(this.shells, (sp) => this.meshFor(sp)?.lo?.geometry ?? null);
    }
    // Build one fine mesh per frame at most, and only for species the camera is close to.
    for (const cm of Object.values(this.meshes)) if (cm.wants && cm.canRefine) { cm.refine(); cm.wants = false; break; }
    this.food = this.food.filter((f) => !f.eaten);
    const fq = this._q, FM = this.foodMeshes, cnt = { flake: 0, pellet: 0, bloodworm: 0 };
    for (const f of this.food) {
      const kind = f.kind ?? 'flake', k = cnt[kind];
      if (k >= 200) continue;
      // Bloodworms keep wriggling, on the way down and on the bottom.
      const w = kind === 'bloodworm' ? Math.sin(this.t * 7 + f.sink * 90) : 0;
      fq.setFromEuler(e.set(w * 0.5, f.sink * 30 + w * 0.6, kind === 'bloodworm' ? Math.cos(this.t * 5 + f.sink * 50) * 0.5 : 0));
      this._m.compose(f.pos, fq, this._s.set(1, 1, 1));
      FM[kind].setMatrixAt(k, this._m);
      cnt[kind] = k + 1;
    }
    for (const kind in FM) { FM[kind].count = cnt[kind]; FM[kind].instanceMatrix.needsUpdate = true; }
  }

  // Nearest animal to a ray (for the inspect tool).
  pick(ray, maxDist = 2.5) {
    let best = null, bd = maxDist;
    for (const a of this.all) {
      const d = ray.distanceToPoint(a.pos) / Math.max(0.6, SPECIES[a.sp].size * 0.7);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }

  // The tank is going (Game.unloadTank): its meshes give back what they hold outside the scene, the rows of the shared bone texture
  // their skinned bodies drew with (render/creatures/skin.js). Never given back, a few tank changes used them all up, and every
  // frog after that was drawn without its bones.
  release() {
    for (const m of Object.values(this.meshes)) m?.skinned?.releaseSkin?.();
  }

  clear() {
    for (const k of Object.keys(this.by)) this.by[k] = [];
    this.food = [];
    this.tails = [];
    this.shells = []; this.shrimpCalls = [];
    this.striking.clear();          // (a strike in flight would go on for an animal no longer in the tank: load, restart)
    this.draw();
  }

  serialize() {
    return this.all.map((a) => ({ sp: a.sp, p: a.pos.toArray().map((v) => +v.toFixed(2)), h: +a.hunger.toFixed(3), hp: +a.health.toFixed(3), age: Math.round(a.age), x: pick(a, ['id', 'parent', 'into', 'n', 'hatch', 'where', 'onWall', 'genes', 'morph', 'gsp', 'gen', 'parents', 'nick', 'mate', 'pg', 'gp', 'mut', 'dev', 'female', 'sizeK', 'male']) }));
  }
}

const SPECIES_LOCI = (id) => lociOf(id).length;

// The scale an animal is drawn at (its species' scale grown with age): the same number Animals.draw hands the rig.
// The radius of an animal's hull in the water, as a share of its species size (Animals.hulls): a frog's body is about as wide as
// that; a fish, a newt or a lizard is slender.
const HULL = { frog: 0.55, toad: 0.5, newt: 0.3, axolotl: 0.3, swim: 0.2, crab: 0.5, skink: 0.25, gecko: 0.25 };
// The most a floating body rides up or down (cm) and tips (radians) on the water (Animals.ride): a splash can throw the surface
// further than a small body would follow.
const RIDE_MAX = 0.8, RIDE_TIP = 0.35;

export function drawScale(a, sp) {
  // N1: salamander larvae grow from their parent species' length at birth/hatching to their length at metamorphosis (cm, sizeBy),
  // drawn at `cm / cmAt1` (cmAt1: the drawn length of the body at scale 1, measured by tools/steps/amph-life-day.mjs AMPH_LARVA=1).
  const L = sp.sizeBy && (sp.sizeBy[a.parent] ?? sp.sizeBy.newt);
  if (L) return (L[0] + (L[1] - L[0]) * clamp(a.age / 1440 / sp.metamorphDays, 0, 1)) / sp.cmAt1;
  const grow = clamp(0.35 + (a.age / 1440) / (sp.adultDays ?? 10) * 0.65, 0.35, 1);
  return (sp.scale ?? sp.size) * grow * (a.sizeK ?? 1);
}

function pick(o, keys) {
  const r = {};
  for (const k of keys) if (o[k] !== undefined) r[k] = o[k];
  return Object.keys(r).length ? r : undefined;
}

const NO_TURN = [0, 0, 0];
const PIVOTS = new WeakMap();        // a swimming body's rig -> its hips (the point a hop pitches it about)

function angDiff(to, from) {
  return ((to - from + Math.PI) % TAU + TAU) % TAU - Math.PI;
}

const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 1.1547;     // about N(0, 1)

function angLerp(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return a + d * t;
}
