// Animals: species definitions (look, habitat, needs, diet) and the agents
// that live, move, eat, breed and die in the tank. Every species is one
// instanced, procedurally animated mesh (see creatures.js).

import * as THREE from 'three/webgpu';
import { Builder, PRIM } from '../render/geo.js';
import { hash3, clamp, lerp, rng } from '../util/math.js';
import { CreatureLOD, BODIES, FINISH, withRig } from '../render/creatures.js';
import { loadManifest, loadCreatureGLB } from '../render/creatures/glb.js';
import { packAnim } from '../render/creatures/instanced.js';
import { frogSwimPose, kickPeriod, kickSpeed, bob, frac, strideRate, hopLegs, callSac, toeTap } from '../util/gait.js';
import { Tongues } from '../render/creatures/tongue.js';
import { TANK, MAT } from './tank.js';
import { Occupancy } from './occupancy.js';
import { CRAB, PANTHER, crabMind, crabThink, crabHeading, crabGaitRate } from './crab.js';
import { hideScore } from './habitat.js';
import { SKINK, skinkMind, skinkThink } from './skink.js';
import { herpMind, herpThink, profileFor, doing } from './herp.js';
import { BURROW, burrowSpot, pitDepth, digRate, excavate } from './burrow.js';
import { PIECES } from './decor.js';
import { hasGenetics, randomGenotype, genotypeForMorph, morphOf, lociOf } from './genetics.js';

const C = (h) => new THREE.Color(h);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const TAU = Math.PI * 2;
const _f = V(0, 0, 0), _m = V(0, 0, 0), _t = V(0, 0, 0), _p = V(0, 0, 0), _e = new THREE.Euler(), _qo = new THREE.Quaternion();
// Body radius per kind (x species size): animals of one medium keep their distance (see separate()).
const RADIUS = { skink: 0.6, swim: 0.38, crawlWater: 0.4, crawlLand: 0.3, crab: 0.6, fly: 0.2, frog: 0.85, toad: 0.8, newt: 0.7, axolotl: 0.75, gecko: 0.7 };
const STRENGTH = { skink: 1, swim: 1, frog: 1, toad: 1, newt: 1, axolotl: 1, gecko: 1, crab: 0.8, crawlWater: 0.6, crawlLand: 0.6, fly: 0.3 };
const GROUPS = { water: 1, land: 2, wall: 3, air: 4 };
const CELLG = 5;
const VIS = new Set(['frog', 'toad', 'newt', 'axolotl', 'gecko', 'skink']);   // animals with idle pulses, twitches and strikes (see vis)
const LIVE = new Set(['frog', 'toad', 'newt', 'axolotl', 'gecko', 'skink']);   // hunters that really stalk and strike

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
//   habitat maxDepth (content/habitats.js) with no way out.
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
    name: 'Cherry shrimp', group: 'Crustaceans', kind: 'crawlWater', size: 1.0, speed: 1.2,
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
    name: 'Fruit flies', group: 'Insects', kind: 'fly', size: 1.4, speed: 6,
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
    temp: [20, 27], humidity: 75, hungerHours: 170, lifeDays: 4000, eats: ['fly', 'springtail', 'isopod', 'flylarva'], cap: 8, breed: 0.05, adultDays: 25,
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
    temp: [18, 26], humidity: 60, hungerHours: 240, lifeDays: 5000, eats: ['fly', 'springtail', 'isopod', 'shrimp', 'flylarva'], cap: 6, breed: 0.04, adultDays: 30,
    eggs: { n: 8, days: 7, into: 'tadpole', where: 'water' },
    ph: [6.8, 7.6], land: 0.5, flock: [3, 6],
    body: sdfBody('toad'), anim: { amp: 0, wave: 1, lift: 0.35, stride: 0.45, swimLevel: 0, limb: 1.25 },
    note: 'Semi-aquatic: needs both land and open water. Spawns in the water.',
  },
  newt: {
    name: 'Paddle-tail newt', scale: 1, group: 'Amphibians', kind: 'newt', size: 1.6, speed: 2,
    temp: [15, 24], humidity: 60, hungerHours: 200, lifeDays: 3000, eats: ['springtail', 'fly', 'isopod', 'flake', 'tadpole', 'flylarva'], cap: 8, breed: 0.03, adultDays: 30,
    eggs: { n: 6, days: 8, into: 'tadpole', where: 'water' },
    body: sdfBody('newt'), anim: { amp: 0.85, wave: 1.25, lift: 0.3, stride: 0.85, rig2: { neck: 0.26, s0: 0.04, s1: 0.31, neckY: 0.75, len: 10.8 } },
    note: 'A cool-stream newt. Wedges itself between rocks by day, walks the bottom at night with its head sweeping, swims in bursts, rises to gulp air, and on damp nights may wander the bank. Needs cool water (under 24 °C) and a hide.',
  },
  firesal: {
    name: 'Fire salamander', scale: 1, group: 'Amphibians', kind: 'newt', size: 2.4, speed: 1.6, landBias: 0.9,
    temp: [8, 22], humidity: 70, hungerHours: 220, lifeDays: 7000, eats: ['springtail', 'fly', 'isopod', 'flylarva'], cap: 6, breed: 0, adultDays: 40,
    body: sdfBody('newt'), anim: { amp: 1.15, wave: 1.3, lift: 0.4, stride: 1.1, rig2: { neck: 0.27, s0: 0.04, s1: 0.31, neckY: 1.4, len: 18 } },
    note: 'A forest salamander of cool, damp woods (8–22 °C). Out on dark, damp nights and after rain; by day it sits in a hide (wood, a rock, leaf litter) and comes back to the same one. Creeps up on prey and freezes, dries out without damp ground or a shallow dish to soak in, and warns with its black and yellow-orange instead of running.',
  },
  axolotl: {
    name: 'Axolotl', scale: 1, group: 'Amphibians', kind: 'axolotl', size: 2.6, speed: 1.4,
    temp: [14, 21], hungerHours: 260, lifeDays: 5000, eats: ['shrimp', 'flake', 'tadpole'], cap: 8, breed: 0.03, adultDays: 30,
    eggs: { n: 4, days: 10, into: 'axolotl', where: 'water' },
    body: sdfBody('axolotl'), anim: { amp: 0.9, wave: 1.1, lift: 0.22, stride: 0.6, rig2: { neck: 0.27, s0: 0.05, s1: 0.31, neckY: 0.9, len: 12 } },
    note: 'Fully aquatic and needs cold water (14–21 °C): turn the heater down or it will suffer. Shuns bright light (give it a cave or shade), sits on the bottom with its gills fanning, rises now and then to gulp air, and finds food by smell. A pair lays eggs in the water; its colour genes make morphs.',
  },
  gecko: {
    name: 'Mourning gecko', scale: 1, group: 'Reptiles', kind: 'gecko', size: 1.4, speed: 4,
    temp: [21, 29], humidity: 55, hungerHours: 150, lifeDays: 3500, eats: ['fly', 'springtail', 'flylarva'], cap: 10, breed: 0.04, adultDays: 25,
    eggs: { n: 2, days: 12, into: 'gecko', where: 'wall' },
    body: sdfBody('gecko'), anim: { amp: 0.6, wave: 1.1, lift: 0.28, stride: 0.75, rig2: { neck: 0.24, s0: 0.04, s1: 0.28, neckY: 0.43, len: 9.5 } },
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
    temp: [22, 26], hungerHours: 110, lifeDays: 1100, eats: ['flake'], cap: 40, breed: 0.015, adultDays: 45,
    ph: [6.5, 7.5], gh: [5, 12], flow: 0.45, flock: [6, 40],
    body: sdfBody('cpd'), anim: { amp: 0.2, wave: 1.7 },
    note: 'A 2 cm pearl-spotted danio from Myanmar. Shy: keep 6 to 10 or more, with dense moss and roots and only a gentle current. Fry survive in thick moss.',
  },
  pygmy: {
    name: 'Everglades pygmy sunfish', scale: 1, group: 'Fish', kind: 'swim', band: 'bottom', school: false, size: 3, speed: 2,
    temp: [18, 24], hungerHours: 100, lifeDays: 1100, eats: ['flake', 'shrimp'], cap: 12, breed: 0.01, adultDays: 60,
    ph: [6.5, 7.5], gh: [3, 12], flow: 0.15, territorial: true, flock: [1, 12],
    body: sdfBody('pygmy'), anim: { amp: 0.24, wave: 1.4 },
    note: 'A 3 cm micro-predator for the water under a land setup: still water, thick moss and stems. Males turn velvet black with electric-blue spangles and dance at each other: one male to two or three females. Eats live food and baby shrimp.',
  },
  blueshrimp: {
    name: 'Blue dream shrimp', group: 'Crustaceans', kind: 'crawlWater', size: 1.0, speed: 1.2,
    temp: [20, 26], hungerHours: 200, lifeDays: 365, eats: ['detritus', 'biofilm', 'flake'], cap: 80, breed: 0.04, adultDays: 20,
    ph: [6.8, 8.0], gh: [6, 12], flow: 0.6, flock: [10, 80],
    anim: { lift: 0.06, stride: 0.1 },
    body: () => (BODIES.blueshrimp ?? BODIES.shrimp)(), note: 'A deep-blue Neocaridina. Grazes biofilm and needs stable, not-too-soft water; keep 10 to 15 to start a colony, apart from cherry shrimp or the colours wash out.',
  },
  panther: {
    name: 'Panther crab', group: 'Crustaceans', kind: 'crab', crabProfile: PANTHER, size: 2.4, speed: 3,
    temp: [24, 28], humidity: 70, hungerHours: 220, lifeDays: 1500, eats: ['detritus', 'flake', 'shrimp', 'snail', 'springtail'], cap: 4, breed: 0,
    ph: [7.5, 8.5], gh: [8, 15], land: 0.2, territorial: true, flock: [1, 2],
    anim: { lift: 0.3, stride: 0.47, legAxis: 'x', limb: 1 },
    body: () => (BODIES.panther ?? BODIES.crab)(),
    note: 'A big leopard-spotted crab from Lake Matano (Sulawesi). Mostly aquatic: deep (15-25 cm), hard, alkaline water with strong biological filtration, slate caves and roots it can climb out on. Keep one, or a true pair: males fight. It eats shrimp and snails.',
  },
  skink: {
    name: 'Red-eyed crocodile skink', scale: 1, group: 'Reptiles', kind: 'skink', size: 3, speed: 3,
    temp: [23, 27], humidity: 70, hungerHours: 260, lifeDays: 4000, eats: ['isopod', 'fly', 'flylarva', 'springtail', 'pandaking'], cap: 2, breed: 0.006, adultDays: 120,
    eggs: { n: 1, days: 60, into: 'skink', where: 'land' },
    bask: 28.5, uvb: 2, land: 0.8, territorial: true, flock: [1, 2], ph: [6.5, 7.8],
    body: sdfBody('skink'), anim: { amp: 0.4, wave: 1.0, lift: 0.15, stride: 0.6 },
    note: 'A shy, armoured little lizard of humid stream banks in New Guinea, with orange rings round its eyes. 80% land, a shallow pool (5-7 cm at most) to soak in, 23-27 °C with a 28-29 °C warm spot, 80-90% humidity, low UVB; cork bark, leaf litter and moss to hide in. Out at dusk. One, or a male and a female.',
  },
  bumblebee: {
    name: 'Bumblebee toad', scale: 1, group: 'Amphibians', kind: 'frog', size: 1.0, speed: 0.7,
    temp: [20, 24], humidity: 70, hungerHours: 140, lifeDays: 3000, eats: ['springtail', 'flylarva', 'fly', 'isopod', 'springpink'], cap: 8, breed: 0.02, adultDays: 40,
    eggs: { n: 6, days: 6, into: 'tadpole', where: 'shallow' },
    land: 0.8, flock: [4, 8], drowns: true,
    body: sdfBody('bumblebee'), anim: { amp: 0, wave: 1, lift: 0.22, stride: 0.24 },
    note: 'A small black toad with canary-yellow spots and fiery red soles, out by day. It walks more than it hops and swims badly: water no deeper than 2-3 cm, with gentle gravel slopes, or it drowns. Keep 4 to 6; feeds on springtails and fruit flies.',
  },
  reedfrog: {
    name: 'Starry night reed frog', scale: 1, group: 'Amphibians', kind: 'frog', perch: true, size: 1.2, speed: 1,
    temp: [24, 29], humidity: 70, hungerHours: 150, lifeDays: 2500, eats: ['fly', 'flylarva', 'springtail'], cap: 8, breed: 0.03, adultDays: 30,
    eggs: { n: 8, days: 5, into: 'tadpole', where: 'water' },
    ph: [6.5, 7.5], land: 0.3, flock: [3, 8],
    body: sdfBody('reedfrog'), anim: { amp: 0, wave: 1, lift: 0.32, stride: 0.42 },
    note: 'A jet-black reed frog from Madagascar dotted with yellow-white stars and with orange legs. Sits by day high on broad leaves, bamboo and wood above the water, hunts flies at dusk. Wants a tall tank, 70% water, warm air (24-29 °C). Keep 3 to 5.',
  },
  marbled: {
    name: 'Marbled newt', scale: 1, group: 'Amphibians', kind: 'newt', size: 1.8, speed: 1.8,
    temp: [14, 21], humidity: 75, hungerHours: 220, lifeDays: 5000, eats: ['flake', 'tadpole', 'springtail', 'isopod', 'flylarva', 'fly'], cap: 6, breed: 0.02, adultDays: 60,
    eggs: { n: 6, days: 10, into: 'tadpole', where: 'water' },
    ph: [7, 7.5], flow: 0.2, land: 0.5, flock: [2, 4],
    body: () => (BODIES.marbled ?? BODIES.newt)(), anim: { amp: 0.6, wave: 1.2, lift: 0.2, stride: 0.3 },
    note: 'A European newt in velvet green laced with black, the females with an orange stripe down the back. Needs it cool: 15-21 °C, and suffers above 23 °C. Half water (10-15 cm, still, with a slate ramp) and half damp mossy land. One male to two or three females.',
  },
  purpleiso: {
    name: 'Dwarf purple isopods', group: 'Crustaceans', kind: 'crawlLand', deep: true, size: 1.0, speed: 0.6,
    temp: [20, 28], humidity: 65, hungerHours: 160, lifeDays: 300, eats: ['detritus'], cap: 90, breed: 0.08, adultDays: 14, crew: 1,
    anim: { lift: 0.03, stride: 0.05 },
    body: () => (BODIES.purpleiso ?? BODIES.isopod)(), note: 'Clean-up crew that lives down by the drainage layer in very damp soil; rarely seen, never drowns.',
  },
  pandaking: {
    name: 'Panda king isopods', group: 'Crustaceans', kind: 'crawlLand', size: 2.0, speed: 0.9,
    temp: [22, 27], humidity: 65, hungerHours: 200, lifeDays: 700, eats: ['detritus'], cap: 30, breed: 0.025, adultDays: 45, crew: 2.5, drowns: true,
    anim: { lift: 0.04, stride: 0.07 },
    body: () => (BODIES.pandaking ?? BODIES.isopod)(), note: 'A big black-and-white Cubaris that rolls into a ball. A strong cleaner, but heavy: it can fall into open water and drown. Give it raised ground and sloped bark ramps out of the water.',
  },
  springpink: {
    name: 'Pink springtails', group: 'Insects', kind: 'crawlLand', hop: true, size: 1.6, speed: 0.9,
    temp: [20, 28], humidity: 68, hungerHours: 100, lifeDays: 50, eats: ['detritus'], cap: 110, breed: 0.18, adultDays: 6, crew: 0.3,
    body: () => (BODIES.springpink ?? BODIES.springtail)(), note: 'Tropical pink springtails: a little bigger and slower to breed than the whites, eat mould and frog food all the same.',
  },
  tadpole: {
    name: 'Tadpoles', scale: 1, group: 'Amphibians', kind: 'swim', band: 'bottom', school: false, size: 1.2, speed: 1.6, young: true,
    temp: [16, 29], hungerHours: 90, lifeDays: 90, eats: ['biofilm', 'detritus', 'flake'], cap: 80, breed: 0, metamorphDays: 14,
    body: sdfBody('tadpole'), anim: { amp: 0.25, wave: 1.2 },
    note: 'Hatch from eggs; grow legs and leave the water after about two weeks.',
  },
  eggs: {
    name: 'Egg clutches', scale: 1, group: 'Amphibians', kind: 'egg', size: 1, speed: 0, young: true,
    temp: [12, 32], hungerHours: 1e9, lifeDays: 60, eats: [], cap: 30, breed: 0,
    body: sdfBody('eggs'), note: 'Laid by frogs, newts and geckos. They hatch after a while.',
  },
};

export const ONE = { neon: 'neon tetra', guppy: 'guppy', cory: 'corydoras', loach: 'clown loach', shrimp: 'cherry shrimp', crab: 'vampire crab', isopod: 'isopod', springtail: 'springtail', fly: 'fruit fly', flylarva: 'fruit fly maggot', flypupa: 'fruit fly pupa', dartfrog: 'blue dart frog', strawberry: 'strawberry dart frog', toad: 'fire-bellied toad', newt: 'newt', firesal: 'fire salamander', axolotl: 'axolotl', gecko: 'gecko', tadpole: 'tadpole', eggs: 'egg clutch', cardinal: 'cardinal tetra', ember: 'ember tetra', betta: 'betta', oto: 'otocinclus', snail: 'trumpet snail', leucomelas: 'yellow-banded poison frog', auratus: 'green and black poison frog', cpd: 'celestial pearl danio', pygmy: 'pygmy sunfish', blueshrimp: 'blue dream shrimp', panther: 'panther crab', skink: 'crocodile skink', bumblebee: 'bumblebee toad', reedfrog: 'starry night reed frog', marbled: 'marbled newt', purpleiso: 'dwarf purple isopod', pandaking: 'panda king isopod', springpink: 'pink springtail' };
export const one = (id) => ONE[id] ?? SPECIES[id].name.toLowerCase();

export const FOOD_VALUE = { fly: 0.25, flylarva: 0.03, springtail: 0.07, springpink: 0.08, isopod: 0.12, pandaking: 0.3, shrimp: 0.35, blueshrimp: 0.35, snail: 0.3, flake: 0.3, tadpole: 0.2 };

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
    finish: { ...FINISH[group], ...(src.finish ?? {}), ...(a.waveHead != null ? { waveHead: a.waveHead } : {}), ...(a.rig2 ? { rig2: a.rig2 } : {}) },
    near: 34 + sp.size * 10,
  });
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
  const sp = SPECIES[id];
  if (!sp || !meta || meta.disabled || meta.pose) return null;
  if (!GLB_CACHE.has(id)) GLB_CACHE.set(id, loadCreatureGLB(id, { legs: WALKERS.includes(sp.kind), ...meta }));
  const g = await GLB_CACHE.get(id);
  if (!g) return null;
  const a = sp.anim ?? {};
  const group = sp.group === 'Fish' ? 'fish' : sp.group === 'Amphibians' ? 'amphibian' : sp.group === 'Reptiles' ? 'reptile' : 'invert';
  return (scene, cap = sp.cap + 20) => new CreatureLOD(scene, g.lo, {
    cap, wave: a.wave ?? 1, legLift: a.lift ?? 0.25, legStride: a.stride ?? 0.35, legAxis: a.legAxis ?? 'z', limb: a.limb ?? 1,
    finish: { ...FINISH[group], bump: 0, tone: 0.02, grain: 1, ...(meta.finish ?? {}), ...(a.waveHead != null ? { waveHead: a.waveHead } : {}), ...(a.rig2 ? { rig2: a.rig2 } : {}) }, near: 34 + sp.size * 10, hiGeometry: g.hi === g.lo ? null : g.hi, textures: g.textures,
  });
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
    this.grid = new Map(); this.striking = new Set();
    this.tongues = new Tongues(scene);
    for (const id of Object.keys(SPECIES)) {
      this.by[id] = [];
      this.keys[id] = [];
    }
    this.upgradeModels().catch((e) => console.warn('creature models', e));
    const fg = new THREE.IcosahedronGeometry(0.22, 0);
    fg.scale(1, 0.35, 1);
    this.foodMesh = new THREE.InstancedMesh(fg, new THREE.MeshStandardNodeMaterial({ color: 0xc9772f, roughness: 0.8 }), 200);
    this.foodMesh.count = 0; this.foodMesh.frustumCulled = false;
    scene.add(this.foodMesh);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
  }

  // Swap in textured models (public/assets/creatures/) for any species that has one.
  async upgradeModels() {
    const man = await loadManifest();
    for (const [id, meta] of Object.entries(man)) {
      if (meta.pose) { const [b, p] = id.split('.'); (this.poseMeta[b] ??= {})[p] = { key: id, meta }; if (this.meshes[b]) this.ensurePose(b, p); continue; }
      if (SPECIES[id] && !meta.disabled) (this.modelMeta ??= {})[id] = meta;
      if (this.meshes[id]) this.loadModel(id);
    }
  }

  // A species' textured model is fetched the first time an animal of it is drawn (meshFor), not at start: every model
  // together is over 1.5 MB and fetching them all held the loading screen 4 to 5 s on the live site. Once loaded (READY,
  // shared by every tank) a new tank builds the model directly; until then the procedural body stands in and is swapped.
  loadModel(id) {
    const meta = this.modelMeta?.[id];
    if (!meta || this.models[id] || this._loadingModel?.has(id)) return;
    (this._loadingModel ??= new Set()).add(id);
    modelBuilder(id, meta).then((build) => {
      if (!build) return;
      READY.set(id, build);
      this.models[id] = () => build(this.scene);
      // A species that is already drawn with its procedural body switches over.
      const old = this.meshes[id];
      if (old && this.scene.parent) { this.meshes[id] = this.models[id](); old.remove(); }
    }).catch((e) => console.warn('creature model', id, e));
  }

  // A pose model is the same animal in another body, drawn while it does one thing: manifest key '<species>.<pose>', for now
  // 'leucomelas.swim', a frog mid-stroke with its legs out (made by tools/bake-frogpose.mjs). It has no rig of its own: it moves as a
  // whole (the stroke's surge and glide, the bob and roll of Animals.draw), and the sitting model is drawn the rest of the time.
  // Fetched only when a tank has an animal of the species (and not at all on a tank without one).
  ensurePose(id, pose = 'swim') {
    const m = this.poseMeta[id]?.[pose];
    if (!m || this.poseModels[id]?.[pose] || this._posing?.has(m.key)) return;
    (this._posing ??= new Set()).add(m.key);
    this.loadPose(m.key, m.meta).catch((e) => console.warn('pose model', m.key, e));
  }

  async loadPose(key, meta) {
    const [id, pose] = key.split('.');
    const sp = SPECIES[id];
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
    setTimeout(() => { if (this.scene.parent) this.meshFor(id, null, pose); }, 6000 + Math.random() * 4000);
  }

  get all() { return Object.values(this.by).flat(); }

  // The mesh that draws a species, or one morph of it; built on first use. A tank holds a dozen of the species, and a
  // mesh is a body to mesh, a material to make and a shader to build, so only the ones in use exist. The species' default
  // mesh stands in when the body library has no variant for the morph (so counts stay right and nothing is built twice).
  meshFor(id, morph = null, pose = null) {
    if (pose) {
      const build = this.poseModels[id]?.[pose], key = `${id}#${pose}`;
      if (!build) return null;
      if (!this.meshes[key]) { this.meshes[key] = build(); this.keys[id].push(key); }
      return this.meshes[key];
    }
    const key = meshKeyFor(id, morph);
    if (!this.meshes[key]) {
      if (key === id && !this.models[id] && READY.has(id)) { const b = READY.get(id); this.models[id] = () => b(this.scene); }
      this.meshes[key] = key === id && this.models[id] ? this.models[id]() : createSpeciesMesh(this.scene, id, { morph });
      if (key === id && !this.models[id]) this.loadModel(id);
      this.keys[id].push(key);
      if (key === id) { this.ensurePose(id, 'swim'); if (this.poseModels[id]?.swim) this.warmPose(id, 'swim'); }
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
  catchable(pid) { return (this.by[pid]?.length ?? 0) > this.refuge(); }
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
      case 'newt':
        if (surf > ground) return { pos: V(x, ground + Math.min(1, (surf - ground) * 0.3), z) };
        if (!W.nearWater(V(x, ground, z), 8)) return { error: 'Newts need water nearby.' };
        return { pos: V(x, ground, z) };
      case 'axolotl':
        if (depth < 4) return { error: 'Axolotls need water at least 4 cm deep.' };
        return { pos: V(x, ground, z) };
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
    const W = this.world;
    const cand = [];
    for (let k = 0; k < 60; k++) {
      const x = (Math.random() - 0.5) * (TANK.w - 6), z = (Math.random() - 0.5) * (TANK.d - 6);
      if (W.water.isWater(x, z, 3)) cand.push([x, z]);
    }
    if (!cand.length) return 0;
    const [cx, cz] = cand[Math.floor(Math.random() * cand.length)];
    // Enough for everyone: about two flakes per fish.
    let fish = 0;
    for (const id in SPECIES) if (SPECIES[id].kind === 'swim' && SPECIES[id].eats.includes('flake')) fish += this.by[id].length;
    const n = Math.max(10, Math.round(fish * 2));
    for (let k = 0; k < n; k++) {
      if (this.food.length >= 190) break;
      this.food.push({ pos: V(cx + (Math.random() - 0.5) * 10, W.water.level - 0.1, cz + (Math.random() - 0.5) * 8), sink: 0.15 + Math.random() * 0.3, age: 0, settled: false });
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
        switch (sp.kind) {
          case 'swim': this.swim(a, sp, arr, dt); break;
          case 'crawlWater': this.crawl(a, sp, dt, 'water'); break;
          case 'crawlLand': if (!sp.sessile) this.crawl(a, sp, dt, 'land', sp.crawlOpt ?? null); break;
          case 'crab': this.crab(a, sp, dt); break;
          case 'fly': this.fly(a, sp, dt); break;
          case 'frog':
          case 'toad': if (!(sp.perch && this.perchFrog(a, sp, dt))) this.frog(a, sp, dt); break;
          case 'newt': case 'axolotl': case 'gecko': this.herp(a, sp, arr, dt); break;
          case 'skink': this.skink(a, sp, dt); break;
          case 'egg': break;
        }
        if (dt > 0 && LIVE.has(sp.kind)) this.hunter(a, sp, dt);
        if (dt > 0 && this.avoid) this.keepFree(a, sp, dt);
        // Distance walked drives the leg cycle: one cycle per stride of this animal at its size (util/gait.js strideRate), so
        // a planted foot does not slide. A frog or salamander turning on the spot steps round too (its feet travel about half a
        // body length per radian), and `stepping` says the legs are working, so they come to rest planted when it stops.
        const moved = Math.hypot(a.pos.x - px, a.pos.y - py, a.pos.z - pz);
        let steps = moved;
        if (VIS.has(sp.kind) && !a.hop && !a.swimming && a._py != null) steps += Math.abs(angDiff(a.yaw ?? 0, a._py)) * 0.45 * sp.size;
        a._py = a.yaw ?? 0;
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
          // Never beyond the glass.
          const hx = TANK.w / 2 - 0.4, hz = TANK.d / 2 - 0.4;
          a.pos.x = clamp(a.pos.x, -hx, hx); a.pos.y = clamp(a.pos.y, 0, TANK.h - 0.5);
          if (!a.wallMode) a.pos.z = clamp(a.pos.z, -hz, hz);
          if (a.onWall || a.hop || a.wallMode) continue;
          if (sp.kind !== 'swim' && sp.kind !== 'fly') { const g = T.heightAt(a.pos.x, a.pos.z); if (a.pos.y < g - 0.3) a.pos.y = g; }
          if (sp.kind !== 'swim' && sp.kind !== 'fly' && sp.kind !== 'egg' && !a.swimming) { const wz = W.wall.zAt(a.pos.x, T.heightAt(a.pos.x, a.pos.z) + 1) + 0.3; if (a.pos.z < wz) a.pos.z = wz; }
          if (this.insideSolid(a, sp)) this.relocate(a, sp, true, true);
        }
      }
    }
    // Food flakes drift and sink, then settle.
    for (const f of this.food) {
      const g = W.terrain.heightAt(f.pos.x, f.pos.z) + 0.1;
      if (f.pos.y > g) {
        f.pos.y -= f.sink * dt * (f.age < 20 ? 0.15 : 1);
        f.pos.x += Math.sin(this.t + f.sink * 40) * dt * 0.3;
      } else { f.pos.y = g; f.settled = true; }
      f.age += dt;
    }
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
  bodyY(a, sp) { return sp.kind === 'swim' || sp.kind === 'fly' || a.swimming ? a.pos.y : a.pos.y + 0.5; }
  insideSolid(a, sp) {
    if (a.onWall || a.hop || a.wallMode) return false;
    return this.occ.solidAt(a.pos.x, this.bodyY(a, sp), a.pos.z);
  }

  // Is it plausible that this animal is trying to get somewhere right now?
  wantsMove(a, sp = SPECIES[a.sp]) {
    if (a.dead || a.hop || a.onWall || a.stranded) return false;
    switch (sp.kind) {
      case 'swim': return true;
      case 'crawlWater': case 'crawlLand': case 'crab': return a.state === 'walk' && !!a.target;
      case 'frog': case 'toad': return (a.hopFail ?? 0) >= 1 || (!!a.swimming && !!a.shore);
      case 'newt': case 'axolotl': return a.herp ? !!a.wantMove : a.swimming ? true : a.state === 'walk' && !!a.target;
      case 'fly': return a.state === 'fly';
    }
    return false;
  }

  // Per animal and tick: a body inside a solid cell is moved out; one that wants to move but has hardly moved
  // for several seconds backs off and picks a new target, and as a last resort jumps to the nearest free cell.
  keepFree(a, sp, dt) {
    if (a.dead) return;
    // Ground that rose under a walker (a piece was dropped on it, erosion): stand on it again.
    if (sp.kind !== 'swim' && sp.kind !== 'fly' && !a.onWall && !a.hop && !a.wallMode) {
      const g = this.world.terrain.heightAt(a.pos.x, a.pos.z);
      if (a.pos.y < g - 0.3) a.pos.y = g;
    }
    if (this.insideSolid(a, sp)) { this.stuckStats.inside = (this.stuckStats.inside ?? 0) + 1; const by = this.stuckStats.by ??= {}; by[a.sp] = (by[a.sp] ?? 0) + 1; this.relocate(a, sp, false, true); return; }
    if (sp.kind === 'egg') return;
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
    a.target = null; a.shore = null; a.hop = null; a.timer = 0; a.hopFail = 0; a.fs = null; a.st = null;
    a.wander = ang; a.yaw = ang; a.side = -(a.side ?? 1);
    if (sp.kind === 'swim' || a.swimming) {
      a.vel.set(Math.sin(ang), 0, Math.cos(ang)).multiplyScalar(sp.speed);
      a.home = this.randomWater(2) ?? a.home;
    } else {
      a.state = 'idle';
      const nx = a.pos.x + Math.sin(ang) * 0.8, nz = a.pos.z + Math.cos(ang) * 0.8;
      if (this.okFor(this.mediumOf(sp), nx, nz)) { a.pos.x = nx; a.pos.z = nz; }
    }
  }

  mediumOf(sp) {
    switch (sp.kind) {
      case 'crawlWater': case 'axolotl': return 'water';
      case 'crawlLand': case 'frog': case 'toad': case 'gecko': return 'land';
      default: return 'any';
    }
  }

  // Last resort: the nearest free cell that suits the animal; when that is where it already is (a pool or an
  // island too small to leave) or it keeps happening, a random free spot of the right kind.
  relocate(a, sp, far = a.stuckLevel >= 3, inside = false) {
    const W = this.world, T = W.terrain, occ = this.occ;
    const from = a.pos.clone();
    this.stuckStats.relocated++;
    a.stillT = 0; a.anchor = null; a.target = null; a.shore = null; a.hop = null; a.hopFail = 0;
    a.timer = 0; a.state = 'idle'; a.vel.set(0, 0, 0); a.fs = null; a.st = null; a.crouch = 0; a.chain = 0;
    const swimmer = sp.kind === 'swim' || (a.swimming && sp.kind !== 'frog' && sp.kind !== 'toad');
    if (!swimmer) a.swimming = false;
    const fly = sp.kind === 'fly';
    const wx = TANK.w / 2 - 2, wz = TANK.d / 2 - 2;
    const okSwim = (x, y, z) => {
      const f = T.heightAt(x, z), L = this.waterTop(x, z);
      return L - f >= 1.6 && y >= f + 0.6 && y <= L - 0.6 && Math.abs(x) < wx - 0.5 && Math.abs(z) < wz - 0.5;
    };
    const okFly = (x, y, z) => y > Math.max(T.heightAt(x, z), this.waterTop(x, z)) + 1.2 && y < TANK.h - 3 && Math.abs(x) < wx && Math.abs(z) < wz;
    if (swimmer || fly) {
      const ok = fly ? okFly : okSwim;
      let to = far ? null : occ.nearestFree(a.pos.x, a.pos.y, a.pos.z, ok, 14);
      if (to && !inside && Math.hypot(to[0] - from.x, to[1] - from.y, to[2] - from.z) < 2) to = null;
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
    const free = (x, z) => this.okFor(medium, x, z) && !occ.solidAt(x, T.heightAt(x, z) + 0.5, z);
    let best = null;
    for (let r = far ? 1e9 : 1.5; r <= 30 && !best; r += 1.5) {
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
    const desired = V(0, 0, 0);
    a.wander += (Math.random() - 0.5) * dt * 2.5;
    desired.set(Math.sin(a.wander), 0, Math.cos(a.wander)).multiplyScalar(sp.speed * 0.6);
    if (sp.school) {
      const c = V(0, 0, 0), al = V(0, 0, 0), sep = V(0, 0, 0);
      let n = 0;
      for (const b of arr) {
        if (b === a) continue;
        const d = b.pos.distanceTo(a.pos);
        if (d > 9) continue;
        n++;
        c.add(b.pos); al.add(b.vel);
        if (d < 1.8) sep.addScaledVector(a.pos.clone().sub(b.pos), (1.8 - d) / Math.max(0.1, d));
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
      else if (a.nib.t <= 0) { a.nib.f.eaten = true; a.hunger = Math.max(0, a.hunger - FOOD_VALUE.flake); a.ate = (a.ate ?? 0) + 1; a.nib = null; }
    } else if (a.hunger > 0.25 && this.food.length && !ctl) {
      let best = null, bd = 30;
      for (const f of this.food) {
        if (f.eaten) continue;
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
    if (a.nib) desired.multiplyScalar(0.1);
    a.vel.lerp(desired, Math.min(1, dt * (a.dart ? 4 : 1.8)));
    const maxS = ctl ? Math.max(0.1, ctl.speed * 1.1) : sp.speed * (a.dart ? 2.1 : a.hunger > 0.25 ? 1.5 : 1);
    if (a.vel.length() > maxS) a.vel.setLength(maxS);
    const prev = a.pos.clone();
    a.pos.addScaledVector(a.vel, dt);
    a.pos.x = clamp(a.pos.x, -hx - 0.5, hx + 0.5);
    a.pos.z = clamp(a.pos.z, -hz - 0.5, hz + 0.5);
    let f2 = T.heightAt(a.pos.x, a.pos.z), L2 = this.waterTop(a.pos.x, a.pos.z);
    if (!(L2 - f2 >= 1.3)) { a.pos.copy(prev); f2 = T.heightAt(a.pos.x, a.pos.z); L2 = L; }
    a.pos.y = clamp(a.pos.y, f2 + 0.5, Math.max(f2 + 0.6, L2 - 0.5));
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
    if (hs > 0.05) a.yaw = Math.atan2(a.vel.x, a.vel.z);
    a.pitch = lerp(a.pitch, a.nib ? 0.5 : -Math.atan2(a.vel.y, Math.max(0.3, hs)) * 0.6, Math.min(1, dt * 4));
    a.swimSpeed = a.vel.length();
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
  okFor(medium, x, z, maxDepth = 5) {
    const W = this.world;
    if (Math.abs(x) > TANK.w / 2 - 1 || Math.abs(z) > TANK.d / 2 - 1) return false;
    const g = W.terrain.heightAt(x, z);
    const s = W.water.surfaceAt(x, z);
    const depth = s - g;
    if (this.avoid && this.occ.count && this.occ.solidAt(x, g + 0.5, z)) return false;
    if (this.avoid && z < W.wall.zAt(x, g + 1) + 0.4) return false;       // not into the background relief
    if (medium === 'water') return depth > 1;
    if (medium === 'land') return !(depth > -0.2);
    return !(depth > maxDepth);
  }

  // opt: { rest: [min, max] s, restP: chance to pause instead of setting off, speed: multiplier } (salamanders potter and pause).
  crawl(a, sp, dt, medium, opt = null) {
    const W = this.world, T = W.terrain;
    a.timer -= dt;
    if (!a.target || a.timer <= 0) {
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
        if (this.okFor(medium, nx, nz)) { a.pos.x = nx; a.pos.z = nz; a.blockedN = 0; }
        else {
          // Something is in the way: slide round it, trying the side that worked last time first.
          let moved = false;
          if (this.avoid) {
            const sd = a.side ?? 1, base = Math.atan2(d.x, d.z);
            for (const da of [0.7 * sd, -0.7 * sd, 1.4 * sd, -1.4 * sd, 2.1 * sd]) {
              const sx = Math.sin(base + da), sz = Math.cos(base + da);
              nx = a.pos.x + sx * step * 1.2; nz = a.pos.z + sz * step * 1.2;
              if (this.okFor(medium, nx, nz)) { a.pos.x = nx; a.pos.z = nz; dirx = sx; dirz = sz; a.side = Math.sign(da) || 1; moved = true; break; }
            }
          }
          a.blockedN = (a.blockedN ?? 0) + 1;
          if (!moved || a.blockedN > 40) { a.timer = 0; a.blockedN = 0; }
        }
        const want = Math.atan2(dirx, dirz) + (sp.kind === 'crab' ? Math.PI / 2 : 0);
        a.yaw = angLerp(a.yaw, want, Math.min(1, dt * 6));
      }
    }
    // Springtails pop into the air now and then.
    if (sp.hop && !a.hop && Math.random() < dt * 0.15) a.hop = { t: 0, h: 1.5 + Math.random() };
    let lift = 0;
    if (a.hop) {
      a.hop.t += dt * 3;
      lift = Math.sin(Math.min(1, a.hop.t) * Math.PI) * a.hop.h;
      if (a.hop.t >= 1) a.hop = null;
    }
    a.pos.y = T.heightAt(a.pos.x, a.pos.z) + lift;
    a.normal = T.normalAt(a.pos.x, a.pos.z);
    a.grazing = a.state === 'rest' && !a.hop;     // head-down pauses (see vis)
  }

  // --- Perching frogs (the starry night reed frog) --------------------------------------------------------------
  // By day a perching frog climbs a tall plant, a wall plant or a stem near water and sits pressed flat on it, legs tucked in
  // (it saves water); at dusk, or when hungry, it climbs down and hunts on the ground like any frog (frog()). Returns true
  // while it is on its way up, perched or on its way down (frog() is skipped), false when frog() is in charge.
  perchFrog(a, sp, dt) {
    const W = this.world, T = W.terrain;
    const want = W.env.bright() > 0.25 && a.hunger < 0.6 && !a.swimming && !a.order && !a.hop;
    const P = a.perch;
    if (P) {
      const plantGone = P.plant && !W.plants.list.includes(P.plant);
      if (P.ph === 'sit' && (!want || plantGone)) { P.ph = 'down'; P.goal = V(P.top.x + Math.sin(a.yaw) * 1.5, 0, P.top.z + Math.cos(a.yaw) * 1.5); P.goal.y = T.heightAt(P.goal.x, P.goal.z); }
      const goal = P.ph === 'go' ? P.base : P.ph === 'up' ? P.top : P.ph === 'down' ? P.goal : null;
      a.speedNow = 0; a.state = 'rest';
      if (goal) {
        const dx = goal.x - a.pos.x, dy = goal.y - a.pos.y, dz = goal.z - a.pos.z, dist = Math.hypot(dx, dy, dz);
        const speed = sp.speed * (P.ph === 'go' ? 2.2 : 1.4), step = Math.min(dist, speed * dt);
        if (P.ph === 'go' && !this.okFor('land', a.pos.x + (dx / (dist || 1)) * step, a.pos.z + (dz / (dist || 1)) * step)) { a.perch = null; a.perchT = 6; return false; }
        if (dist > 1e-3) { a.pos.x += (dx / dist) * step; a.pos.y += (dy / dist) * step; a.pos.z += (dz / dist) * step; }
        if (P.ph === 'go') a.pos.y = T.heightAt(a.pos.x, a.pos.z);
        if (Math.hypot(dx, dz) > 0.05) a.yaw = angLerp(a.yaw ?? 0, Math.atan2(dx, dz), Math.min(1, dt * 6));
        a.pitch = P.ph === 'up' ? -1.1 : P.ph === 'down' ? 0.9 : 0;          // nose up climbing, head first coming down
        a.speedNow = step / Math.max(1e-4, dt); a.state = 'walk';
        if (dist - step < 0.05) {
          if (P.ph === 'go') P.ph = 'up';
          else if (P.ph === 'up') { P.ph = 'sit'; a.pitch = 0; }
          else { a.perch = null; a.pitch = 0; a.fs = 'sit'; a.fsT = 1 + Math.random() * 2; a.pos.y = T.heightAt(a.pos.x, a.pos.z); a.perchT = 20 + Math.random() * 20; return true; }
        }
      } else {
        a.pos.copy(P.top); a.pitch = 0;
        a.crouch = 0.6;                                                    // pressed flat on the leaf
        if (Math.random() < dt * 0.05) a.yaw += (Math.random() - 0.5) * 0.6;   // shuffles round now and then
      }
      a.normal = UP;
      return true;
    }
    if (!want) return false;
    a.perchT = (a.perchT ?? Math.random() * 6) - dt;
    if (a.perchT > 0) return false;
    a.perchT = 8 + Math.random() * 8;
    const top = this.perchSpot(a);
    if (!top) return false;
    // The foot of the climb: under the perch, but in front of the background (wall plants hang on it).
    const bz = Math.max(top.p.z, W.wall.zAt(top.p.x, T.heightAt(top.p.x, top.p.z) + 1) + 0.8);
    a.perch = { ph: 'go', top: top.p, plant: top.plant, base: V(top.p.x, T.heightAt(top.p.x, bz), bz) };
    a.fs = null;
    return true;
  }

  // The best perch within reach: the top of a tall plant (or a wall plant), better high and over or near water, not taken.
  perchSpot(a) {
    const W = this.world, T = W.terrain;
    const H = { fernph: 10, weed: 6, fern: 8, bilberry: 9, grass: 6, bromeliad: 7, pothos: 4, cattail: 18, bamboo: 14, monstera: 12 };
    let best = null, bs = -1e9;
    const list = W.plants.list;
    for (let i = 0, n = Math.min(list.length, 300); i < n; i++) {
      const p = list[i], h = H[p.id];
      if (!h) continue;
      const d = Math.hypot(p.pos.x - a.pos.x, p.pos.z - a.pos.z);
      if (d > 40) continue;
      const k = h * (p.scale ?? 1) * (p.grown ?? 1) * 0.8, nrm = p.normal ?? UP;
      const top = V(p.pos.x + nrm.x * k, p.pos.y + Math.max(0.3, nrm.y) * k, p.pos.z + nrm.z * k);
      if (Math.abs(top.x) > TANK.w / 2 - 1 || Math.abs(top.z) > TANK.d / 2 - 1) continue;
      if ((this.by[a.sp] ?? []).some((b) => b !== a && b.perch && b.perch.top.distanceTo(top) < 2.5)) continue;
      const wet = W.nearWater(V(top.x, T.heightAt(top.x, top.z), top.z), 12) ? 6 : 0;
      const sc = (top.y - T.heightAt(top.x, top.z)) + wet - d * 0.25 + Math.random() * 2;
      if (sc > bs) { bs = sc; best = { p: top, plant: p }; }
    }
    return best;
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
      a.skShore = this.crabFind(x, z, 35, (px, pz, d) => d >= SKINK.soakDepth[0] && d <= SKINK.soakDepth[1]);
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
    const cam = this.camera?.position;
    let threat = null;
    if (cam) { const d = Math.hypot(cam.x - x, cam.y - a.pos.y, cam.z - z); if (d < 20) threat = { x: cam.x, z: cam.z, d: (d - 7) * 0.6 }; }
    for (const id of ['toad', 'panther', 'firesal', 'axolotl']) for (const b of this.by[id] ?? []) {
      const d = Math.hypot(b.pos.x - x, b.pos.z - z);
      if (d < SKINK.scareCm * 0.5 && (!threat || d < threat.d)) threat = { x: b.pos.x, z: b.pos.z, d };
    }
    const it = (a.si = skinkThink(m, {
      t: this.t, dt, dtMin: dt * (this.warp ?? 1), x, z, depth, light: clamp(E.bright(), 0, 1), rain: E.rain ?? 0,
      rh: C.humidityAt(x, g + 1, z), temp: C.tempAt(x, g + 0.5, z), wetGround: Math.min(1, T.field.matAt(x, z, MAT.moss) + C.sample(C.soil, x, z) * 0.5),
      cover: this.skinkCover(x, z), hunger: a.hunger, threat, home: a.home, shore: a.skShore, warm: a.skWarm, hunting: !!a.order,
    }));
    if (it.say && Math.random() < 0.5) W.log(it.say, 'info');
    let goal = it.goal, speed = it.speed;
    if (it.mode === 'hunt' && a.target) { goal = { x: a.target.x, z: a.target.z }; speed = SKINK.speed * 0.7; }
    a.state = goal && speed > 0 ? 'walk' : 'rest';
    a.speedNow = 0;
    if (goal && speed > 0) {
      const dx = goal.x - x, dz = goal.z - z, dist = Math.hypot(dx, dz);
      if (dist > 0.25) {
        const step = Math.min(dist, speed * dt);
        let ux = dx / dist, uz = dz / dist;
        const maxD = it.mode === 'flee' && depth > SKINK.maxDepth ? 99 : SKINK.maxDepth;
        if (!this.okFor('any', x + ux * step, z + uz * step, maxD)) {
          const sd = a.side ?? 1, base = Math.atan2(ux, uz);
          let ok = false;
          for (const da of [0.7 * sd, -0.7 * sd, 1.4 * sd, -1.4 * sd, 2.1 * sd]) {
            const sx = Math.sin(base + da), sz = Math.cos(base + da);
            if (this.okFor('any', x + sx * step, z + sz * step, maxD)) { ux = sx; uz = sz; a.side = Math.sign(da) || 1; ok = true; break; }
          }
          if (!ok) { ux = 0; uz = 0; m.goal = null; if (a.order) a.target = null; }
        }
        a.pos.x += ux * step; a.pos.z += uz * step;
        a.speedNow = (ux || uz) ? step / Math.max(1e-4, dt) : 0;
        if (ux || uz) a.yaw = angLerp(a.yaw ?? 0, Math.atan2(ux, uz), Math.min(1, dt * 5));
      }
    }
    a.pos.y = T.heightAt(a.pos.x, a.pos.z);
    a.normal = T.normalAt(a.pos.x, a.pos.z);
    a.crouch = Math.max(it.flat ?? 0, a.crouch && a.st ? a.crouch : 0) * 0.6;
    a.grazing = it.mode === 'forage' && a.state === 'rest';
    m.sinkNow = lerp(m.sinkNow ?? 0, it.sink ?? 0, Math.min(1, dt * 1.5));
    m.rollNow = lerp(m.rollNow ?? 0, it.roll ?? 0, Math.min(1, dt * 4));
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
    const cam = this.camera?.position;
    let threat = null;
    if (cam) { const d = Math.hypot(cam.x - x, cam.y - a.pos.y, cam.z - z); if (d < 22) threat = { x: cam.x, z: cam.z, d: (d - 6) * 0.55 }; }
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
    if (it.say) W.log(it.say, 'warn');
    if (it.eat && food) {
      if (food.pid === 'flake') { food.p.eaten = true; a.hunger = Math.max(0, a.hunger - FOOD_VALUE.flake); }
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
        if (!this.okFor('any', x + ux * step, z + uz * step, maxD)) {
          // Blocked: slide round it, trying the side that worked last time first.
          const sd = a.side ?? 1, base = Math.atan2(ux, uz);
          let ok = false;
          for (const da of [0.7 * sd, -0.7 * sd, 1.4 * sd, -1.4 * sd, 2.1 * sd]) {
            const sx = Math.sin(base + da), sz = Math.cos(base + da);
            if (this.okFor('any', x + sx * step, z + sz * step, maxD)) { ux = sx; uz = sz; a.side = Math.sign(da) || 1; ok = true; break; }
          }
          if (!ok) { ux = 0; uz = 0; m.goal = null; }
        }
        a.pos.x += ux * step; a.pos.z += uz * step;
        if (ux || uz) {
          const h = crabHeading(ux, uz, a.yaw ?? 0);
          // Keep the leading side through a burst; choose again when it starts from a standstill.
          if ((a.speedNow ?? 0) < 0.3) m.lead = h.lead;
          const want = Math.atan2(ux, uz) + (m.lead > 0 ? Math.PI / 2 : -Math.PI / 2);
          a.yaw = angLerp(a.yaw ?? want, want, Math.min(1, dt * 8));
        }
      }
    } else if (it.face) {
      a.yaw = angLerp(a.yaw ?? 0, Math.atan2(it.face.x - x, it.face.z - z), Math.min(1, dt * 5));
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
    look('flake', this.food, (f) => f.settled && !f.eaten);
    look('springtail', this.by.springtail, () => true);
    look('fly', this.by.fly, (f) => f.state === 'rest');
    // Other live food on its list (a panther crab takes shrimp and snails off the bottom).
    for (const pid of sp.eats) if (pid !== 'springtail' && pid !== 'fly' && SPECIES[pid] && pid !== a.sp) look(pid, this.by[pid], () => true);
    return best;
  }

  fly(a, sp, dt) {
    const W = this.world, T = W.terrain;
    a.timer -= dt;
    if (a.state === 'rest') {
      if (a.timer <= 0) { a.state = 'fly'; a.timer = 2 + Math.random() * 5; }
      a.pos.y = Math.max(T.heightAt(a.pos.x, a.pos.z), W.water.surfaceAt(a.pos.x, a.pos.z));
      if (this.avoid && this.occ.solidAt(a.pos.x, a.pos.y, a.pos.z)) { a.state = 'fly'; a.timer = 2 + Math.random() * 3; }   // do not rest inside a root
      return;
    }
    a.wander += (Math.random() - 0.5) * dt * 8;
    const d = V(Math.sin(a.wander), Math.sin(this.t * 1.7 + a.phase) * 0.6, Math.cos(a.wander)).multiplyScalar(sp.speed * 0.6);
    a.vel.lerp(d, Math.min(1, dt * 3));
    const before = a.pos.clone();
    a.pos.addScaledVector(a.vel, dt);
    const g = Math.max(T.heightAt(a.pos.x, a.pos.z), W.water.surfaceAt(a.pos.x, a.pos.z));
    if (a.pos.y < g + 1.2) { a.pos.y = g + 1.2; a.vel.y = Math.abs(a.vel.y); }
    if (a.pos.y > TANK.h - 3) a.pos.y = TANK.h - 3;
    const hx = TANK.w / 2 - 1, hz = TANK.d / 2 - 1;
    if (Math.abs(a.pos.x) > hx) { a.pos.x = Math.sign(a.pos.x) * hx; a.wander = Math.atan2(-a.pos.x, 0); }
    if (Math.abs(a.pos.z) > hz) { a.pos.z = Math.sign(a.pos.z) * hz; a.wander = Math.atan2(0, -a.pos.z); }
    const wz = W.wall.zAt(a.pos.x, a.pos.y) + 1;
    if (a.pos.z < wz) { a.pos.z = wz; a.wander = 0; }
    if (this.avoid && this.occ.solidAt(a.pos.x, a.pos.y, a.pos.z) && !this.occ.solidAt(before.x, before.y, before.z)) { a.pos.copy(before); a.vel.multiplyScalar(-0.5); a.wander += Math.PI * (0.6 + Math.random() * 0.8); }
    a.yaw = Math.atan2(a.vel.x, a.vel.z);
    if (a.timer <= 0) {
      a.timer = 3 + Math.random() * 8;
      // Land only on dry ground.
      if (W.water.surfaceAt(a.pos.x, a.pos.z) === -Infinity && !(this.avoid && this.occ.solidAt(a.pos.x, T.heightAt(a.pos.x, a.pos.z), a.pos.z))) a.state = 'rest';
    }
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
      a.pos.lerpVectors(hp.from, hp.to, t);
      a.pos.y += 4 * hp.h * t * (1 - t);
      a.pitch = -Math.atan2(hp.to.y - hp.from.y + 4 * hp.h * (1 - 2 * t), Math.max(0.1, hp.from.distanceTo(hp.to))) * 0.6;
      if (t >= 1) {
        a.hop = null;
        a.pitch = 0;
        a.settle = 1;
        this.frogEnd(a, sp, true);
        if (hp.splash) W.fx?.addDrop(a.pos.x, a.pos.z, -4, 0.8);
      }
      return;
    }
    const g = T.heightAt(a.pos.x, a.pos.z);
    const s = W.water.surfaceAt(a.pos.x, a.pos.z, 0.2);
    const inWater = s > g + 0.9 * sp.size;
    a.swimming = inWater;
    a.timer -= dt;
    if (inWater) { this.frogSwim(a, sp, dt, s, toad); a.fs = null; return; }
    a.pos.y = g;
    a.normal = T.normalAt(a.pos.x, a.pos.z);
    if (!a.fs) { a.fs = 'sit'; a.fsT = this.pickSit(a, sp) * Math.random(); a.chain = 0; a.crouch = 0; }
    switch (a.fs) {
      case 'sit': {
        a.fsT -= dt * (a.order ? 1 : this.warp);
        a.crouch = Math.max(0, (a.crouch ?? 0) - dtS * 4);
        if (a.order && !a.order.kicked) { a.order.kicked = true; a.fsT = Math.min(a.fsT, 0.4 + Math.random() * 1.2); }
        if (a.fsT <= 0) this.frogPlan(a, sp);
        break;
      }
      case 'turn': {
        // Face the way first (a deliberate turn on the spot), then crouch or walk.
        const d = angDiff(a.faceTo, a.yaw), rate = (toad ? 2.4 : 3.2) * dtS;
        if (Math.abs(d) <= rate) {
          a.yaw = a.faceTo;
          a.fs = a.afterTurn ?? 'sit';
          a.walkT = 0;
          if (a.fs === 'crouch') a.fsT = 0.22 + Math.random() * 0.25;
          else if (a.fs === 'sit') a.fsT = a.order ? 0.2 : this.pickSit(a, sp, true);
        } else a.yaw += Math.sign(d) * rate;
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
    if (a.chain > 0) { a.chain--; a.chainNext = true; a.fsT = hopped ? 0.35 + Math.random() * 0.5 : 0.8 + Math.random() * 2; }
    else { a.chainNext = false; a.fsT = a.order ? 0.5 + Math.random() : this.pickSit(a, sp); }
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
    const o = a.order;
    let plan = null, chain = 0;
    if (o && this.validPrey(o.target, a)) {
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
      const hd0 = a.hd ?? a.yaw, wantWater = toad && !cont && Math.random() < 0.15;
      const mid = (sp.temp[0] + sp.temp[1]) / 2;
      const cands = [];
      for (let k = 0; k < (uneasy ? 14 : 8); k++) {
        let ang = hd0 + gauss() * (cont ? 0.3 : 0.6);
        if (k >= 5 || (uneasy && k >= 3)) ang = Math.random() * Math.PI * 2;                       // now and then somewhere else entirely
        else if (!cont && k === 4) ang = hd0 + Math.PI * (0.7 + 0.6 * Math.random());             // turn back
        const walk = cont && a.plan ? a.plan.type === 'walk' : toad ? Math.random() < 0.2 : Math.random() < 0.68;
        const len = (walk ? 2 + Math.random() * 5 : (1.4 + Math.random() * 2.6) * (toad ? 1.7 : 1)) * (uneasy ? 1.8 : 1);
        const to = V(a.pos.x + Math.sin(ang) * len, 0, a.pos.z + Math.cos(ang) * len);
        const g = T.heightAt(to.x, to.z);
        let sc = this.comfortAt(sp, to.x, g, to.z) * (uneasy ? 6 : 3) + Math.random() * 0.8 + Math.cos(ang - hd0) * 0.4;
        // Cover and moss at night, a warm spot by day.
        const cover = this.occ.count && this.occ.solidAt(to.x, g + 3, to.z) ? 1 : 0;
        sc += (cover + T.field.matAt(to.x, to.z, MAT.moss)) * (1.6 * (1 - light) + 0.4);
        sc += clamp((W.climate.tempAt(to.x, g, to.z) - mid) / 5, -0.6, 0.6) * light * 0.8;
        cands.push({ to, ang, walk, sc });
      }
      cands.sort((p, q) => q.sc - p.sc);
      for (const c of cands) { plan = this.checkPlan(a, sp, c.walk ? 'walk' : 'hop', c.to, c.ang, wantWater && !c.walk); if (plan) break; }
      if (plan) chain = plan.type === 'hop' ? (Math.random() * 2.6 | 0) + (uneasy ? 1 : 0) : Math.random() < 0.4 ? 1 : 0;
    }
    if (!plan) { a.hopFail = (a.hopFail ?? 0) + 1; a.fsT = 1.5 + Math.random() * 3; a.chain = 0; a.chainNext = false; return; }
    a.plan = plan; a.hd = plan.ang; a.chain = chain;
    a.faceTo = plan.ang; a.afterTurn = plan.type === 'hop' ? 'crouch' : 'walk';
    a.fs = 'turn'; a.crouch = 0; a.walkT = 0;
  }

  // A burst segment that can be done from here: { type, to, ang, water, v } or null.
  checkPlan(a, sp, type, to, ang, water) {
    if (type === 'hop') return this.hopCheck(a, sp, to.clone(), water) ? { type, to, ang, water, v: 1 } : null;
    const medium = this.mediumOf(sp);
    for (const f of [0.3, 0.6, 1]) {
      const x = a.pos.x + (to.x - a.pos.x) * f, z = a.pos.z + (to.z - a.pos.z) * f;
      if (!this.okFor(medium, x, z)) return null;
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
    if (ok) {
      const v = sp.speed * 2.0 * p.v * Math.min(1, 0.35 + d * 0.5);       // about 2 cm/s, easing in to the stop
      const step = Math.min(d, v * dtS);
      const nx = a.pos.x + dx / d * step, nz = a.pos.z + dz / d * step;
      if (this.okFor(this.mediumOf(sp), nx, nz) && !this.crowded(a, sp, nx, nz)) { a.pos.x = nx; a.pos.z = nz; a.pos.y = this.world.terrain.heightAt(nx, nz); a.hopFail = 0; }
      else ok = false;
      a.yaw = angLerp(a.yaw, Math.atan2(dx, dz), Math.min(1, dtS * 6));
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
    const W = this.world, T = W.terrain;
    a.pos.y = Math.max(s - 0.35 * sp.size, T.heightAt(a.pos.x, a.pos.z));
    a.normal = null;
    if (!a.shore || a.timer <= 0) {
      a.timer = 4 + Math.random() * 4;
      a.shore = null;
      if (!toad || Math.random() < 0.35) {
        a.floating = false;
        for (let r = 2; r < 30 && !a.shore; r += 2) {
          for (let k = 0; k < 16; k++) {
            const ang = (k / 16) * Math.PI * 2;
            const x = a.pos.x + Math.sin(ang) * r, z = a.pos.z + Math.cos(ang) * r;
            if (Math.abs(x) > TANK.w / 2 - 2 || Math.abs(z) > TANK.d / 2 - 2) continue;
            if (W.water.surfaceAt(x, z, 0.3) === -Infinity && T.normalAt(x, z).y > 0.6) { a.shore = V(x, 0, z); break; }
          }
        }
      } else {
        const ang = Math.random() * Math.PI * 2;
        a.shore = V(a.pos.x + Math.sin(ang) * 6, 0, a.pos.z + Math.cos(ang) * 6);
        a.floating = true;
      }
    }
    // The stroke: how urgent it is sets the beat (1.7 s a stroke floating, 1 s flat out).
    const urgent = a.floating ? 0.1 : toad ? 0.5 : 0.9;
    const before = a.kick ?? Math.random();
    a.kick = before + dt / kickPeriod(urgent);
    if (Math.floor(a.kick) !== Math.floor(before)) W.fx?.addDrop(a.pos.x, a.pos.z, -1.2, 0.5);   // the legs drive: a ripple
    if (!a.shore) return;
    const dir = V(a.shore.x - a.pos.x, 0, a.shore.z - a.pos.z);
    const dist = dir.length();
    a.yaw = angLerp(a.yaw, Math.atan2(dir.x, dir.z), Math.min(1, dt * 3));
    const v = sp.speed * (a.floating ? 1.2 : toad ? 4.6 : 5.4) * kickSpeed(a.kick);   // a stroke's average comes to about 2 cm/s for a dart frog
    const nx = a.pos.x + Math.sin(a.yaw) * v * dt, nz = a.pos.z + Math.cos(a.yaw) * v * dt;
    if (this.avoid && this.occ.solidAt(nx, a.pos.y, nz)) { a.shore = null; a.timer = 0; }
    else if (Math.abs(nx) < TANK.w / 2 - 1 && Math.abs(nz) < TANK.d / 2 - 1) { a.pos.x = nx; a.pos.z = nz; }
    if (!a.shore) return;
    // Close to the bank: climb out with a hop.
    if (dist < 2.5 * sp.size) {
      const to = a.shore.clone();
      if (W.water.surfaceAt(to.x, to.z, 0.3) === -Infinity) {
        to.y = T.heightAt(to.x, to.z);
        if (to.y - a.pos.y < 6 * sp.size) this.startHop(a, to, 1);
      }
      a.shore = null;
    }
  }

  // Can the frog hop to `to` from here? Returns { h, wet } (and sets to.y), or null.
  hopCheck(a, sp, to, intoWater = false) {
    const W = this.world, T = W.terrain;
    if (Math.abs(to.x) > TANK.w / 2 - 1.5 || Math.abs(to.z) > TANK.d / 2 - 1.5) return null;
    const g = T.heightAt(to.x, to.z);
    const s = W.water.surfaceAt(to.x, to.z, 0.3);
    const wet = s > g + 0.2;
    // Dart frogs never hop into water; toads only when they mean to.
    if (wet && !(sp.kind === 'toad' && intoWater)) return null;
    if (!wet && T.normalAt(to.x, to.z).y < 0.6) return null;       // too steep to land on
    if (this.avoid && to.z < W.wall.zAt(to.x, g + 1) + 0.4) return null;
    if (!wet && W.water.nearestFall(V(to.x, g, to.z), 1.5)) return null;
    to.y = wet ? Math.max(s - 0.35 * sp.size, g) : g;
    if (this.avoid && this.occ.solidAt(to.x, to.y + 0.5, to.z)) return null;
    if (!wet && this.crowded(a, sp, to.x, to.z)) return null;      // nobody sits where it would land
    const rise = to.y - a.pos.y;
    if (rise > 5 * sp.size || rise < -14 * sp.size) return null;
    const dist = Math.hypot(to.x - a.pos.x, to.z - a.pos.z);
    const h = 0.5 + dist * 0.25 + Math.max(0, rise);
    // Standing in a puddle or the shallows: the arc starts at the surface.
    const y0 = Math.max(a.pos.y, W.water.surfaceAt(a.pos.x, a.pos.z, 0.05));
    // The arc must clear everything under it: ground, rocks and water.
    for (let i = 1; i < 8; i++) {
      const t = i / 8;
      const x = a.pos.x + (to.x - a.pos.x) * t, z = a.pos.z + (to.z - a.pos.z) * t;
      const y = y0 + (to.y - y0) * t + 4 * h * t * (1 - t);
      const under = Math.max(T.heightAt(x, z), W.water.surfaceAt(x, z, 0.3));
      if (y < under + 0.3 && !(wet && t > 0.75)) return null;
      if (this.avoid && this.occ.solidAt(x, y + 0.4, z)) return null;
    }
    return { h, wet };
  }

  hopTo(a, sp, to, intoWater = false) {
    const r = this.hopCheck(a, sp, to, intoWater);
    if (!r) return false;
    this.startHop(a, to, r.h, r.wet);
    return true;
  }

  startHop(a, to, h, splash = false) {
    const d = a.pos.distanceTo(to);
    a.hopFail = 0;
    a.hop = { from: a.pos.clone(), to, t: 0, dur: (0.22 + Math.sqrt(d) * 0.09) * (0.9 + Math.random() * 0.2), h: Math.max(h, 0.5), splash };
    a.yaw = Math.atan2(to.x - a.pos.x, to.z - a.pos.z);
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
    const water = pid === 'flake' || pid === 'tadpole' || pid === 'shrimp' || pid === 'blueshrimp' || pid === 'cpd';
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
    const list = pid === 'flake' ? this.food : this.by[pid];
    if (!list) return null;
    let best = null, bd = maxD;
    for (const p of list) {
      if (!this.validPrey(p, a) || (!any && !this.huntable(a, sp, pid, p))) continue;
      const d = Math.hypot(p.pos.x - a.pos.x, p.pos.y - a.pos.y, p.pos.z - a.pos.z);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  newOrder(pid, p) { return { pid, target: p, t: 0, deadline: Math.max(4, (55 + Math.random() * 35) / this.warp), miss: 0 }; }

  // Called by the sim when a hunter's meal is due. True: the animal will really hunt (it eats when it strikes).
  order(a, pid) {
    const sp = SPECIES[a.sp];
    if (!LIVE.has(sp.kind) || a.order || a.dead || a.st || a.stranded || !this.avoid) return false;
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
    if (pid === 'flake') p.eaten = true; else this.remove(p, `eaten by a ${one(a.sp)}`);
    a.hunger = Math.max(0, a.hunger - (FOOD_VALUE[pid] ?? 0.1));
    if (Math.random() < 0.3) this.world.log(`A ${one(a.sp)} caught ${pid === 'flake' ? 'a flake' : 'a ' + one(pid)}.`, 'eat');
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
      for (const pid of sp.eats) {
        if (pid !== 'flake' && !this.catchable(pid)) continue;
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
      if (st.ph !== 'gulp' && !st.got && !this.validPrey(p, a)) { this.endStrike(a, sp, false); continue; }
      st.t += dtS;
      switch (st.ph) {
        case 'aim': {
          const dx = p.pos.x - a.pos.x, dz = p.pos.z - a.pos.z;
          const want = a.wallMode ? Math.atan2(dx, -(p.pos.y - a.pos.y)) : Math.atan2(dx, dz);
          a.yaw = angLerp(a.yaw, want, Math.min(1, dtS * 9));
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
    if (sp.kind === 'fly') return 'air';
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

  buildGrid() {
    const G = this.grid;
    for (const l of G.values()) l.length = 0;
    for (const arr of Object.values(this.by)) for (const a of arr) {
      if (a.dead) { a.grp = null; continue; }
      const sp = SPECIES[a.sp], g = this.groupOf(a, sp);
      a.grp = g;
      if (!g) continue;
      a.rad = this.radiusOf(a, sp);
      const k = this.cellKey(g, a.pos.x, a.pos.y, a.pos.z);
      let l = G.get(k);
      if (!l) G.set(k, l = []);
      l.push(a);
    }
  }

  // Calls fn(b) for every animal b of group g in the cells around (x, y, z).
  near(g, x, y, z, fn) {
    const u = Math.floor(x / CELLG), v = Math.floor((g === 'wall' ? y : z) / CELLG), base = GROUPS[g] * 1000000;
    for (let du = -1; du <= 1; du++) for (let dv = -1; dv <= 1; dv++) {
      const l = this.grid.get(base + (u + du + 200) * 500 + (v + dv + 200));
      if (l) for (let i = 0; i < l.length; i++) fn(l[i]);
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

  separate(dt) {
    if (!this.avoid || !(dt > 0)) return;
    const k = Math.min(1, dt * 8);
    for (const arr of Object.values(this.by)) for (const a of arr) {
      const g = a.grp;
      if (!g || a.dead || a.st || a.hop) continue;
      const sp = SPECIES[a.sp];
      let px = 0, py = 0, pz = 0, n = 0;
      const ma = (a.speedNow ?? 0) > 0.15 ? 1 : 0.4;
      this.near(g, a.pos.x, a.pos.y, a.pos.z, (b) => {
        if (b === a || b.dead || b.grp !== g) return;
        let dx = a.pos.x - b.pos.x, dy = a.pos.y - b.pos.y, dz = a.pos.z - b.pos.z;
        if (g === 'wall') dz = 0; else if (g === 'land') { if (Math.abs(dy) > 1.5) return; dy = 0; }
        let d = Math.hypot(dx, dy, dz);
        const R = a.rad + b.rad;
        if (d >= R) return;
        const o = R - d;
        if (d < 1e-3) { dx = Math.cos(a.id * 2.4 + b.id); dz = g === 'wall' ? 0 : Math.sin(a.id * 2.4 + b.id); dy = g === 'wall' ? Math.sin(a.id * 2.4) : 0; d = Math.hypot(dx, dy, dz) || 1; }
        const mb = (b.speedNow ?? 0) > 0.15 ? 1 : 0.4;
        const w = o / d * (ma / (ma + mb)) * 1.4;
        px += dx * w; py += dy * w; pz += dz * w; n++;
      });
      if (!n) continue;
      const str = (STRENGTH[sp.kind] ?? 0.6) * k;
      let len = Math.hypot(px, py, pz) * str;
      if (len < 1e-4) continue;
      const cap = Math.max(0.4, sp.speed * dt * 3);
      const f = str * Math.min(1, cap / len);
      this.nudge(a, sp, g, px * f, py * f, pz * f);
    }
  }

  // Move `a` by (dx, dy, dz) if it can stand there (full step, else half).
  nudge(a, sp, g, dx, dy, dz) {
    const W = this.world, T = W.terrain;
    for (const f of [1, 0.5]) {
      const x = a.pos.x + dx * f, y = a.pos.y + dy * f, z = a.pos.z + dz * f;
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
          a.pos.x = x; a.pos.z = z;
        } else {
          if (!this.okFor('water', x, z)) continue;
          a.pos.x = x; a.pos.z = z; a.pos.y = fl;
        }
        return true;
      }
      if (g === 'land') {
        if (!this.okFor(this.mediumOf(sp), x, z)) continue;
        a.pos.x = x; a.pos.z = z; a.pos.y = T.heightAt(x, z);
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
    // Gulp: two throat pulses, eyes pulled in.
    if (st && st.ph === 'gulp') {
      const g = st.t / st.dur;
      th = Math.max(th, Math.pow(Math.sin(g * Math.PI * 2), 2) * (1 - g * 0.3) * 0.62);
      eye = Math.max(eye, Math.sin(Math.min(1, g * 1.4) * Math.PI));
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
    const m = (a.hm ??= herpMind(a.sp));
    a.herp = true;
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
      cover: wall ? 0 : this.herpCover(x, z), hunger: a.hunger, health: a.health, male: !!a.male,
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
    if (it.say === 'warn' && Math.random() < 0.3) W.log(`A ${one(a.sp)} froze and showed its warning colours.`, 'info');
    a.hit = it;
    a.doing = doing(it.mode, sp.kind, { prey: prey && prey.pid ? `a ${one(prey.pid)}` : null, asleep: !!it.tuck, hot: sense.temp > P.tHot, wet: m.wet });
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
      const amph = m.mode === 'shore' || m.mode === 'return' || m.mode === 'flee';        // a newt in the water stays in it unless it is going ashore
      const medium = axo ? 'water' : a.sp === 'firesal' ? (m.mode === 'soak' ? 'any' : 'land') : amph || depth <= 0.3 ? 'any' : 'water';
      const maxD = a.sp === 'firesal' ? (m.mode === 'soak' ? 1.8 : 0.6) : 99;
      if (goal && it.speed > 0.1) this.herpStep(a, sp, P, goal, it.speed, dt, medium, maxD);
      else { a.hsp = (a.hsp ?? 0) * Math.max(0, 1 - dt * 8); if (it.face) a.yaw = angLerp(a.yaw ?? 0, Math.atan2(it.face.x - x, it.face.z - z), Math.min(1, dt * 4)); }
      const gy = T.heightAt(a.pos.x, a.pos.z);
      a.pos.y = a.pos.y > gy + 0.05 ? Math.max(gy, lerp(a.pos.y, gy, Math.min(1, dt * 6))) : gy;
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
    // Pivot on the spot when the goal is well off the heading; the legs step round (move() counts the turn).
    a.yaw = (a.yaw ?? 0) + clamp(diff, -dt * 3.2, dt * 3.2);
    const fwd = clamp(1 - Math.abs(diff) / 1.1, 0, 1);
    a.hsp = (a.hsp ?? 0) + (speed * fwd - (a.hsp ?? 0)) * Math.min(1, dt * 5);
    const step = Math.min(dist, a.hsp * dt);
    let ux = Math.sin(a.yaw), uz = Math.cos(a.yaw);
    if (fwd > 0.95) { ux = dx / dist; uz = dz / dist; }
    // (An animal standing where it is not allowed, in the margin by the glass, may step toward the middle.)
    const here = this.okFor(medium, x, z, maxD);
    const free = (nx, nz) => this.okFor(medium, nx, nz, maxD) || (!here && Math.hypot(nx, nz * 1.6) < Math.hypot(x, z * 1.6) - 0.02);
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
    const stepPlane = (tx, ty, speed, onWall) => {
      const dx = tx - a.pos.x, dy = ty - a.pos.y, d = Math.hypot(dx, dy);
      if (d < 0.2) { a.hsp = 0; return d; }
      a.yaw = angLerp(a.yaw ?? 0, Math.atan2(dx, -dy), Math.min(1, dt * 9));
      a.hsp = (a.hsp ?? 0) + (speed - (a.hsp ?? 0)) * Math.min(1, dt * 7);
      const st = Math.min(d, a.hsp * dt);
      a.pos.x = clamp(a.pos.x + dx / d * st, -hx, hx); a.pos.y = clamp(a.pos.y + dy / d * st, onWall ? lo : 0, hi);
      return d;
    };
    if (wall) {
      let tx = goal ? goal.x : a.pos.x, ty = goal ? -goal.z : a.pos.y;
      const ground = T.heightAt(a.pos.x, Wl.zAt(a.pos.x, a.pos.y) + 1.5);
      if (!it.wantWall) { tx = a.pos.x; ty = ground + 1.0; }                       // down to the foot of the wall first
      if (goal || !it.wantWall) stepPlane(tx, clamp(ty, lo, hi), it.wantWall || !goal ? (goal ? it.speed : P.walk) : P.walk, true);
      else a.hsp = (a.hsp ?? 0) * Math.max(0, 1 - dt * 8);
      if (it.face && !goal) a.yaw = angLerp(a.yaw ?? 0, Math.atan2(it.face.x - a.pos.x, -(-it.face.z - a.pos.y)), Math.min(1, dt * 6));
      a.pos.z = Wl.zAt(a.pos.x, a.pos.y) + 0.35;
      const [gx, gy] = Wl.field.gradient(a.pos.x, a.pos.y);
      a.normal = V(-gx, -gy, 1).normalize();
      a.wallMode = true;
      if (!it.wantWall && a.pos.y < ground + 1.4) { a.onWall = false; a.wallMode = false; a.pos.set(a.pos.x, ground, Wl.zAt(a.pos.x, ground + 1) + 1.5); a.target = null; }
      return;
    }
    // On the ground.
    if (it.wantWall) {
      // To the back of the tank, then up the background.
      const wz = Wl.zAt(a.pos.x, a.pos.y + 1);
      if (a.pos.z < wz + 2.6) { a.onWall = true; a.pos.y += 1; a.hsp = 0; return; }
      this.herpStep(a, sp, P, { x: a.pos.x, z: wz + 1.5 }, goal ? it.speed : P.walk, dt, 'land', 5);
    } else if (goal && it.speed > 0.1) this.herpStep(a, sp, P, goal, it.speed, dt, 'land', 0.3);
    else { a.hsp = (a.hsp ?? 0) * Math.max(0, 1 - dt * 8); if (it.face) a.yaw = angLerp(a.yaw ?? 0, Math.atan2(it.face.x - a.pos.x, it.face.z - a.pos.z), Math.min(1, dt * 5)); }
    a.pos.y = T.heightAt(a.pos.x, a.pos.z);
    a.normal = T.normalAt(a.pos.x, a.pos.z);
    a.wallMode = false;
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
    if (sp.kind === 'newt' && a.sp === 'firesal') {
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

  // The prey it is after: the one it has been ordered to hunt, or the nearest it can see or smell when it is hungry. `d` is from the mouth.
  herpPrey(a, sp, P, mouth, wall) {
    let p = null, pid = null, mine = false;
    const o = a.order;
    if (o && !a.st && this.validPrey(o.target, a)) { p = o.target; pid = o.pid; mine = true; }
    else if (a.hunger > 0.3 && !a.st) {
      let bd = Math.max(P.smell, P.sight);
      for (const id of sp.eats) {
        if (id !== 'flake' && !this.catchable(id)) continue;
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
    const cam = this.camera?.position;
    let t = null;
    const planar = (v) => ({ x: v.x, z: wall ? -v.y : v.z });
    if (cam) { const d = Math.hypot(cam.x - a.pos.x, cam.y - a.pos.y, cam.z - a.pos.z); if (d < 22) t = { ...planar(cam), d: (d - 6) * 0.55 }; }
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

  draw(dt = 0.016) {
    const q = this._q;
    const e = new THREE.Euler();
    const tq = new THREE.Quaternion();
    const fix = new THREE.Quaternion();
    const cam = this.camera?.position;
    for (const [id, arr] of Object.entries(this.by)) {
      const sp = SPECIES[id];
      const an = sp.anim ?? {};
      const morphs = hasGenetics(id);
      const dm = arr.length ? this.meshFor(id) : null;   // built the first time the species has an animal
      for (const k of this.keys[id]) this.meshes[k].begin();
      for (const a of arr) {
        const cm = morphs && a.morph ? this.meshFor(id, a.morph) : dm;
        const sc = drawScale(a, sp);
        const swimming = sp.kind === 'swim' || a.swimming;
        // A swimming frog or toad is drawn in the breaststroke pose (forelegs along the flanks, hind legs kicking), level, bobbing on the water.
        const frogish = sp.kind === 'frog' || sp.kind === 'toad';
        // A species with a swimming-pose model draws that one (level already, legs out); the others get the pose from the rig.
        const poseMesh = frogish && a.swimming && !a.hop ? this.meshFor(id, null, 'swim') : null;
        const sw = frogish && a.swimming && !a.hop ? frogSwimPose(frac(a.kick ?? 0), { floating: a.floating ? 1 : 0, level: poseMesh ? 0 : an.swimLevel ?? 0.28, t: this.t + a.phase }) : null;
        if (a.wallMode) {
          // On the background: belly to the wall, heading within its plane.
          q.setFromUnitVectors(UP, a.normal);
          q.multiply(tq.setFromAxisAngle(UP, a.yaw));
        } else if (a.normal && !swimming && !a.hop && sp.kind !== 'fly') {
          const up = a.normal.clone().lerp(UP, 0.3).normalize();
          q.setFromUnitVectors(UP, up);
          q.multiply(tq.setFromAxisAngle(UP, a.yaw));
        } else {
          e.set(sw ? sw.pitch : a.pitch ?? 0, a.yaw, sw ? sw.roll : 0, 'YXZ');
          q.setFromEuler(e);
        }
        const rel = Math.min(1.5, (a.speedNow ?? 0) / Math.max(0.1, sp.speed));
        const walker = sp.kind === 'newt' || sp.kind === 'axolotl' || sp.kind === 'gecko' || sp.kind === 'skink';
        // Undulation: strong when swimming; walking salamanders, newts and geckos bend sideways in step with the legs.
        let amp = (an.amp ?? 0) * (swimming ? 0.6 + rel * 0.6 : walker ? Math.min(1, rel * 1.2) * 0.9 : rel * 0.35);
        if (a.stranded) amp = (an.amp ?? 0.3) * 2.5;
        a.wph = (a.wph ?? a.phase) + dt * (swimming ? 5 + rel * 7 : 3 + rel * 4) * 2 * (a.herp ? 0.5 + (a.hgill ?? 0.3) * 1.4 : 1);
        if (walker && !swimming && (a.speedNow ?? 0) > 0.05) a.wph = (a.gait ?? 0) + a.phase;
        // Legs: stretched out through the first part of a hop and tucked in
        // for the landing; a swimming frog kicks.
        let hop = 0;
        if (a.hop) hop = hopLegs(a.hop.t);
        else if (sw) hop = sw.hop;
        let pos = a.pos, packed = hop;
        if (VIS.has(sp.kind) || sp.kind === 'crawlWater' || sp.kind === 'crawlLand' || sp.kind === 'crab') {
          const v = this.vis(a, sp, dt / this.tf);
          if (VIS.has(sp.kind) && !a.swimming) {
            if (!a.hop) hop = Math.max(hop, v.hop, a.tapT > 0 ? toeTap(this.t + a.phase) : 0);
            // Legs work while it walks or turns; when it stops they settle planted (an unstopped gait left two feet in the air).
            a.legCalm = (a.legCalm ?? 1) + ((a.stepping > 0 || a.hop ? 0 : 1) - (a.legCalm ?? 1)) * Math.min(1, dt / this.tf * 7);
            if (a.herp) { v.throat = Math.max(v.throat, (a.hpump ?? 0) * 0.62); v.eye = Math.max(v.eye, a.heye ?? 0); }
            packed = packAnim(hop, v.breath, v.throat, v.eye, 0, a.legCalm);
            if (!a.hop) pos = _p.copy(a.pos).add(v.off); pos.y += v.y;
          } else if (VIS.has(sp.kind)) {
            // A swimming frog or toad is in the stroke pose; other swimmers are as they were.
            packed = sw ? packAnim(hop, v.breath, 0, v.eye, sw.pose, sw.calm) : packAnim(hop, v.breath, 0, v.eye);
            if (sw) { pos = _p.copy(a.pos); pos.y += bob(this.t + a.phase, sp.size, frac(a.kick ?? 0), a.floating ? 0 : 1); }
          }
          if (!sw) {
            if (!a.hop && !a.wallMode) _qo.setFromEuler(_e.set(v.pitch, v.yaw + v.yawN, v.roll, 'YXZ')); else _qo.setFromEuler(_e.set(v.pitch, v.yaw + v.yawN, 0, 'YXZ'));
            if (!a.hop) q.multiply(_qo);
          }
        }
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
          packed = packAnim(0, 0, 0, 0, i.claw ?? 0, i.calm ?? 1);
          if (cb.sinkNow > 0.01) { pos = _p.copy(pos); pos.y -= cb.sinkNow * 1.35 * sc; }
        }
        // The swimming-pose model flexes a little in time with the stroke; everything else is the rig's business.
        if (poseMesh) poseMesh.put(pos, q, sc, (a.kick ?? 0) * TAU, 0.16, 0, 0, cam ? cam.distanceToSquared(a.pos) : 1e9);
        else if (a.hr && an.rig2) {
          // The mind's head, bend and tail, plus what the gait adds: the head swings against the body wave as the feet step, and
          // follows the wave (late) when swimming.
          const r = a.hr, lk = walker && !swimming ? Math.min(1, rel * 1.5) : 0;
          const hy = r[0] + 0.2 * lk * Math.sin((a.gait ?? 0) + 1) + (swimming ? 0.14 * Math.min(1, rel) * Math.sin(a.wph - 0.7) : 0);
          cm.put(pos, q, sc, a.wph, amp, a.gait ?? 0, packed, cam ? cam.distanceToSquared(a.pos) : 1e9, hy, r[1], r[2], r[3]);
        } else cm.put(pos, q, sc, a.wph, amp, a.gait ?? 0, packed, cam ? cam.distanceToSquared(a.pos) : 1e9);
      }
      for (const k of this.keys[id]) this.meshes[k].end();
    }
    void fix;
    // Build one fine mesh per frame at most, and only for species the camera is close to.
    for (const cm of Object.values(this.meshes)) if (cm.wants && cm.canRefine) { cm.refine(); cm.wants = false; break; }
    this.food = this.food.filter((f) => !f.eaten);
    let k = 0;
    const fq = new THREE.Quaternion();
    for (const f of this.food) {
      if (k >= 200) break;
      fq.setFromEuler(e.set(0, f.sink * 30, 0));
      this._m.compose(f.pos, fq, this._s.set(1, 1, 1));
      const m = this._m;
      this.foodMesh.setMatrixAt(k++, m);
    }
    this.foodMesh.count = k;
    this.foodMesh.instanceMatrix.needsUpdate = true;
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

  clear() {
    for (const k of Object.keys(this.by)) this.by[k] = [];
    this.food = [];
    this.draw();
  }

  serialize() {
    return this.all.map((a) => ({ sp: a.sp, p: a.pos.toArray().map((v) => +v.toFixed(2)), h: +a.hunger.toFixed(3), hp: +a.health.toFixed(3), age: Math.round(a.age), x: pick(a, ['id', 'parent', 'into', 'n', 'hatch', 'where', 'onWall', 'genes', 'morph', 'gsp', 'gen', 'parents', 'nick', 'mate', 'pg', 'gp', 'mut', 'dev']) }));
  }
}

const SPECIES_LOCI = (id) => lociOf(id).length;

// The scale an animal is drawn at (its species' scale grown with age): the same number Animals.draw hands the rig.
function drawScale(a, sp) {
  const grow = clamp(0.35 + (a.age / 1440) / (sp.adultDays ?? 10) * 0.65, 0.35, 1);
  return (sp.scale ?? sp.size) * grow;
}

function pick(o, keys) {
  const r = {};
  for (const k of keys) if (o[k] !== undefined) r[k] = o[k];
  return Object.keys(r).length ? r : undefined;
}

function angDiff(to, from) {
  return ((to - from + Math.PI) % TAU + TAU) % TAU - Math.PI;
}

const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 1.1547;     // about N(0, 1)

function angLerp(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return a + d * t;
}
