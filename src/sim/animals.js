// Animals: species definitions (look, habitat, needs, diet) and the agents
// that live, move, eat, breed and die in the tank. Every species is one
// instanced, procedurally animated mesh (see creatures.js).

import * as THREE from 'three/webgpu';
import { Builder, PRIM, hash3, clamp, lerp, rng } from '../render/geo.js';
import { CreatureLOD, BODIES, FINISH, withRig } from '../render/creatures.js';
import { loadManifest, loadCreatureGLB } from '../render/creatures/glb.js';
import { packAnim } from '../render/creatures/instanced.js';
import { Tongues } from '../render/creatures/tongue.js';
import { TANK, MAT } from './tank.js';
import { Occupancy } from './occupancy.js';
import { PIECES } from './decor.js';
import { hasGenetics, randomGenotype, genotypeForMorph, morphOf, lociOf } from './genetics.js';

const C = (h) => new THREE.Color(h);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const TAU = Math.PI * 2;
const _f = V(0, 0, 0), _m = V(0, 0, 0), _t = V(0, 0, 0), _p = V(0, 0, 0), _e = new THREE.Euler(), _qo = new THREE.Quaternion();
// Body radius per kind (x species size): animals of one medium keep their distance (see separate()).
const RADIUS = { swim: 0.38, crawlWater: 0.4, crawlLand: 0.3, crab: 0.6, fly: 0.2, frog: 0.85, toad: 0.8, newt: 0.7, axolotl: 0.75, gecko: 0.7 };
const STRENGTH = { swim: 1, frog: 1, toad: 1, newt: 1, axolotl: 1, gecko: 1, crab: 0.8, crawlWater: 0.6, crawlLand: 0.6, fly: 0.3 };
const GROUPS = { water: 1, land: 2, wall: 3, air: 4 };
const CELLG = 5;
const VIS = new Set(['frog', 'toad', 'newt', 'axolotl', 'gecko']);   // animals with idle pulses, twitches and strikes (see vis)
const LIVE = new Set(['frog', 'toad', 'newt', 'axolotl', 'gecko']);   // hunters that really stalk and strike

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
    anim: { lift: 0.06, stride: 0.1 },
    body: () => BODIES.shrimp?.() ?? withRig(shrimpGeo()), note: 'Grazes biofilm and detritus. Breeds in mature tanks.',
  },
  crab: {
    name: 'Vampire crab', group: 'Crustaceans', kind: 'crab', size: 1.0, speed: 2,
    temp: [22, 28], humidity: 70, hungerHours: 200, lifeDays: 900, eats: ['detritus', 'flake', 'springtail'], cap: 10, breed: 0,
    anim: { lift: 0.15, stride: 0.2 },
    body: () => BODIES.crab?.() ?? withRig(crabGeo()), note: 'Semi-terrestrial: needs land and shallow water.',
  },
  isopod: {
    name: 'Dwarf isopods', group: 'Crustaceans', kind: 'crawlLand', size: 1.0, speed: 0.8,
    temp: [18, 28], humidity: 60, hungerHours: 150, lifeDays: 300, eats: ['detritus'], cap: 90, breed: 0.1, adultDays: 12,
    anim: { lift: 0.03, stride: 0.05 },
    body: () => BODIES.isopod?.() ?? withRig(isopodGeo()), note: 'Clean-up crew. Eat detritus on land.',
  },
  springtail: {
    name: 'Springtails', group: 'Insects', kind: 'crawlLand', hop: true, size: 1.4, speed: 0.9,
    temp: [16, 28], humidity: 70, hungerHours: 100, lifeDays: 40, eats: ['detritus'], cap: 160, breed: 0.3, adultDays: 5,
    body: () => BODIES.springtail?.() ?? withRig(springtailGeo()), note: 'Tiny cleaners and frog food. Like damp moss.',
  },
  fly: {
    name: 'Fruit flies', group: 'Insects', kind: 'fly', size: 1.4, speed: 6,
    temp: [18, 30], humidity: 30, hungerHours: 30, lifeDays: 6, eats: ['detritus'], cap: 70, breed: 0.25, adultDays: 2,
    body: () => BODIES.fly?.() ?? withRig(flyGeo()), note: 'Flightless culture: live frog food.',
  },
  dartfrog: {
    name: 'Blue dart frog', scale: 1, group: 'Amphibians', kind: 'frog', size: 1.4, speed: 1,
    temp: [20, 27], humidity: 75, hungerHours: 170, lifeDays: 4000, eats: ['fly', 'springtail', 'isopod'], cap: 8, breed: 0.05, adultDays: 25,
    eggs: { n: 5, days: 10, into: 'tadpole', where: 'shallow' },
    body: sdfBody('dartfrog'), anim: { amp: 0, wave: 1, lift: 0.3, stride: 0.35 },
    note: 'Terrestrial. Needs high humidity and live insects. Lays eggs by shallow water.',
  },
  strawberry: {
    name: 'Strawberry dart frog', scale: 1, group: 'Amphibians', kind: 'frog', size: 1.1, speed: 0.9,
    temp: [21, 27], humidity: 80, hungerHours: 150, lifeDays: 3500, eats: ['springtail', 'fly'], cap: 8, breed: 0.04, adultDays: 25,
    eggs: { n: 4, days: 10, into: 'tadpole', where: 'shallow' },
    body: sdfBody('strawberry'), anim: { amp: 0, wave: 1, lift: 0.22, stride: 0.26 },
    note: 'Tiny red frog with blue legs. Lives on springtails; needs very damp air and plenty of moss.',
  },
  toad: {
    name: 'Fire-bellied toad', scale: 1, group: 'Amphibians', kind: 'toad', size: 1.9, speed: 1.2,
    temp: [18, 26], humidity: 60, hungerHours: 240, lifeDays: 5000, eats: ['fly', 'springtail', 'isopod', 'shrimp'], cap: 6, breed: 0.04, adultDays: 30,
    eggs: { n: 8, days: 7, into: 'tadpole', where: 'water' },
    body: sdfBody('toad'), anim: { amp: 0, wave: 1, lift: 0.35, stride: 0.45 },
    note: 'Semi-aquatic: needs both land and open water. Spawns in the water.',
  },
  newt: {
    name: 'Paddle-tail newt', scale: 1, group: 'Amphibians', kind: 'newt', size: 1.6, speed: 2,
    temp: [15, 24], humidity: 60, hungerHours: 200, lifeDays: 3000, eats: ['springtail', 'fly', 'isopod', 'flake', 'tadpole'], cap: 8, breed: 0.03, adultDays: 30,
    eggs: { n: 6, days: 8, into: 'tadpole', where: 'water' },
    body: sdfBody('newt'), anim: { amp: 0.6, wave: 1.2, lift: 0.2, stride: 0.3 },
    note: 'Mostly aquatic, comes ashore at times. Prefers cool water (under 24 °C).',
  },
  firesal: {
    name: 'Fire salamander', scale: 1, group: 'Amphibians', kind: 'newt', size: 2.4, speed: 1.6, landBias: 0.9,
    temp: [8, 22], humidity: 70, hungerHours: 220, lifeDays: 7000, eats: ['springtail', 'fly', 'isopod'], cap: 6, breed: 0, adultDays: 40,
    body: sdfBody('newt'), anim: { amp: 0.6, wave: 1.2, lift: 0.25, stride: 0.35 },
    note: 'A forest salamander of cool, damp woods: bold black and yellow-orange warns that its skin is toxic. Lives on land, near shallow water.',
  },
  axolotl: {
    name: 'Axolotl', scale: 1, group: 'Amphibians', kind: 'axolotl', size: 2.6, speed: 1.4,
    temp: [14, 21], hungerHours: 260, lifeDays: 5000, eats: ['shrimp', 'flake', 'tadpole'], cap: 8, breed: 0.03, adultDays: 30,
    eggs: { n: 4, days: 10, into: 'axolotl', where: 'water' },
    body: sdfBody('axolotl'), anim: { amp: 0.9, wave: 1.1, lift: 0.25, stride: 0.4 },
    note: 'Fully aquatic and needs cold water (14–21 °C): turn the heater down or it will suffer. A pair lays eggs in the water; its colour genes make morphs.',
  },
  gecko: {
    name: 'Mourning gecko', scale: 1, group: 'Reptiles', kind: 'gecko', size: 1.4, speed: 4,
    temp: [21, 29], humidity: 55, hungerHours: 150, lifeDays: 3500, eats: ['fly', 'springtail'], cap: 10, breed: 0.04, adultDays: 25,
    eggs: { n: 2, days: 12, into: 'gecko', where: 'wall' },
    body: sdfBody('gecko'), anim: { amp: 0.35, wave: 1.0, lift: 0.18, stride: 0.3 },
    note: 'Climbs the background and glass hunting insects. Females lay eggs without males.',
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
    temp: [21, 28], humidity: 70, hungerHours: 170, lifeDays: 4000, eats: ['fly', 'springtail', 'isopod'], cap: 8, breed: 0.05, adultDays: 25,
    eggs: { n: 4, days: 12, into: 'tadpole', where: 'shallow' },
    body: sdfBody('leucomelas'), anim: { amp: 0, wave: 1, lift: 0.3, stride: 0.35 },
    note: 'Bold yellow and black "bumblebee" frog from the Guiana Shield. Hardy and out in the open.',
  },
  auratus: {
    name: 'Green and black poison frog', scale: 1, group: 'Amphibians', kind: 'frog', size: 1.25, speed: 1,
    temp: [21, 28], humidity: 75, hungerHours: 170, lifeDays: 4000, eats: ['fly', 'springtail', 'isopod'], cap: 8, breed: 0.05, adultDays: 25,
    eggs: { n: 4, days: 12, into: 'tadpole', where: 'shallow' },
    body: sdfBody('auratus'), anim: { amp: 0, wave: 1, lift: 0.3, stride: 0.35 },
    note: 'Metallic green on black, from Central America. Its colour differs from island to island.',
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

export const ONE = { neon: 'neon tetra', guppy: 'guppy', cory: 'corydoras', loach: 'clown loach', shrimp: 'cherry shrimp', crab: 'vampire crab', isopod: 'isopod', springtail: 'springtail', fly: 'fruit fly', dartfrog: 'blue dart frog', strawberry: 'strawberry dart frog', toad: 'fire-bellied toad', newt: 'newt', firesal: 'fire salamander', axolotl: 'axolotl', gecko: 'gecko', tadpole: 'tadpole', eggs: 'egg clutch', cardinal: 'cardinal tetra', ember: 'ember tetra', betta: 'betta', oto: 'otocinclus', snail: 'trumpet snail', leucomelas: 'yellow-banded poison frog', auratus: 'green and black poison frog' };
export const one = (id) => ONE[id] ?? SPECIES[id].name.toLowerCase();

export const FOOD_VALUE = { fly: 0.25, springtail: 0.07, isopod: 0.12, shrimp: 0.35, flake: 0.3, tadpole: 0.2 };

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
    wave: a.wave ?? 1, legLift: a.lift ?? 0.25, legStride: a.stride ?? 0.35,
    finish: { ...FINISH[group], ...(src.finish ?? {}) },
    near: 34 + sp.size * 10,
  });
}

const GLB_CACHE = new Map();     // id → Promise<{lo, hi, textures} | null>, shared by every tank
const WALKERS = ['frog', 'toad', 'newt', 'axolotl', 'gecko', 'crab', 'crawlLand', 'crawlWater'];

let nextId = 1;

// Body meshes take a moment to build (surface nets), so they are built once and shared by every tank.
const BODY_CACHE = {};

export class Animals {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.by = {};
    this.meshes = {};     // instanced meshes by key: the species id (its default look) or '<species>:<morph>'
    this.keys = {};       // species id -> the keys of all its meshes (the default and every morph drawn so far)
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
    for (const [id, sp] of Object.entries(SPECIES)) {
      this.by[id] = [];
      this.meshes[id] = createSpeciesMesh(scene, id);
      this.keys[id] = [id];
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
      const sp = SPECIES[id];
      if (!sp || meta.disabled) continue;
      if (!GLB_CACHE.has(id)) GLB_CACHE.set(id, loadCreatureGLB(id, { legs: WALKERS.includes(sp.kind), ...meta }));
      const g = await GLB_CACHE.get(id);
      if (!g) continue;
      const a = sp.anim ?? {};
      const group = sp.group === 'Fish' ? 'fish' : sp.group === 'Amphibians' ? 'amphibian' : sp.group === 'Reptiles' ? 'reptile' : 'invert';
      const lod = new CreatureLOD(this.scene, g.lo, {
        cap: sp.cap + 20, wave: a.wave ?? 1, legLift: a.lift ?? 0.25, legStride: a.stride ?? 0.35,
        finish: { ...FINISH[group], bump: 0, tone: 0.02, grain: 1, ...(meta.finish ?? {}) }, near: 34 + sp.size * 10, hiGeometry: g.hi === g.lo ? null : g.hi, textures: g.textures,
      });
      const old = this.meshes[id];
      this.meshes[id] = lod;
      old.lo.mesh.removeFromParent(); old.hi?.mesh.removeFromParent();
    }
  }

  get all() { return Object.values(this.by).flat(); }

  // The mesh that draws a morph of a species; built on first use, and the species' default mesh when the body
  // library has no variant for it (so counts stay right and nothing is built twice).
  meshFor(id, morph) {
    const key = meshKeyFor(id, morph);
    if (!this.meshes[key]) {
      this.meshes[key] = createSpeciesMesh(this.scene, id, { morph });
      this.keys[id].push(key);
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
    const fish = this.by.neon.length + this.by.guppy.length + this.by.cory.length;
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
          case 'crawlLand': this.crawl(a, sp, dt, 'land'); break;
          case 'crab': this.crawl(a, sp, dt, 'any'); break;
          case 'fly': this.fly(a, sp, dt); break;
          case 'frog':
          case 'toad': this.frog(a, sp, dt); break;
          case 'newt': this.newt(a, sp, arr, dt); break;
          case 'axolotl': this.axolotl(a, sp, arr, dt); break;
          case 'gecko': this.gecko(a, sp, dt); break;
          case 'egg': break;
        }
        if (dt > 0 && LIVE.has(sp.kind)) this.hunter(a, sp, dt);
        if (dt > 0 && this.avoid) this.keepFree(a, sp, dt);
        // Distance walked drives the leg cycle.
        const moved = Math.hypot(a.pos.x - px, a.pos.y - py, a.pos.z - pz);
        a.gait = (a.gait ?? a.phase) + moved * 2.6;
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
      case 'newt': case 'axolotl': return a.swimming ? true : a.state === 'walk' && !!a.target;
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

  swim(a, sp, arr, dt) {
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
    } else if (a.hunger > 0.25 && this.food.length) {
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
    if (ot && !a.st && this.validPrey(ot, a)) desired.copy(ot.pos).sub(a.pos).normalize().multiplyScalar(sp.speed * 1.6);
    // Depth preference.
    const band = sp.band === 'top' ? L - 2.5 : sp.band === 'bottom' ? floor + 1.0 : lerp(floor, L, 0.5);
    desired.y += (band - a.pos.y) * 0.8;
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
    const maxS = sp.speed * (a.dart ? 2.1 : a.hunger > 0.25 ? 1.5 : 1);
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

  frogSwim(a, sp, dt, s, toad) {
    const W = this.world, T = W.terrain;
    a.pos.y = Math.max(s - 0.35 * sp.size, T.heightAt(a.pos.x, a.pos.z));
    a.normal = null;
    // Kick now and then; glide in between.
    a.kick = (a.kick ?? 0) + dt * 2.2;
    const push = Math.max(0, Math.sin(a.kick * Math.PI));
    if (!a.shore || a.timer <= 0) {
      a.timer = 4 + Math.random() * 4;
      a.shore = null;
      // Dart frogs head for the nearest bank; toads float about and
      // sometimes decide to climb out.
      if (!toad || Math.random() < 0.35) {
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
    if (!a.shore) return;
    const dir = V(a.shore.x - a.pos.x, 0, a.shore.z - a.pos.z);
    const dist = dir.length();
    a.yaw = angLerp(a.yaw, Math.atan2(dir.x, dir.z), Math.min(1, dt * 3));
    const v = sp.speed * (toad ? 3 : 2.2) * (0.3 + push);
    const nx = a.pos.x + Math.sin(a.yaw) * v * dt, nz = a.pos.z + Math.cos(a.yaw) * v * dt;
    if (this.avoid && this.occ.solidAt(nx, a.pos.y, nz)) { a.shore = null; a.timer = 0; }
    else if (Math.abs(nx) < TANK.w / 2 - 1 && Math.abs(nz) < TANK.d / 2 - 1) { a.pos.x = nx; a.pos.z = nz; }
    if (push > 0.9 && Math.random() < dt * 4) W.fx?.addDrop(a.pos.x, a.pos.z, -1.2, 0.5);
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
    const water = pid === 'flake' || pid === 'tadpole' || pid === 'shrimp';
    switch (sp.kind) {
      case 'frog': case 'toad': return !water && !a.swimming;
      case 'newt': return water === !!a.swimming;
      case 'axolotl': return water;
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
      if (a.hunger < 0.55 || !this.avoid) return;
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
      if (d > reach) return;
      const diff = angDiff(Math.atan2(tp.x - a.pos.x, tp.z - a.pos.z), a.yaw);
      if (Math.abs(diff) < 0.6 && (a.fs === 'sit' || a.fs === 'turn' || a.fs === 'walk')) this.beginStrike(a, sp, o);
      else if (a.fs === 'sit') { a.faceTo = a.yaw + diff; a.afterTurn = 'sit'; a.fs = 'turn'; }
      return;
    }
    if (d <= reach * 0.9) { this.beginStrike(a, sp, o); return; }
    // Go for it: crawlers aim their walk at the prey, swimmers do so in swim().
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
    if (sp.kind === 'egg') return null;
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
    let th = (0.5 + 0.5 * Math.sin(v.tp)) * (0.15 + 0.4 * v.alert);
    let eye = 0;
    // Blink.
    v.blinkT -= dtV;
    if (v.blinkT <= 0) { v.blink = 0.2; v.blinkT = 2.5 + Math.random() * 9; }
    if (v.blink > 0) { eye = Math.sin(Math.PI * (1 - v.blink / 0.2)); v.blink -= dtV; }
    // Gulp: two throat pulses, eyes pulled in.
    if (st && st.ph === 'gulp') {
      const g = st.t / st.dur;
      th = Math.max(th, Math.pow(Math.sin(g * Math.PI * 2), 2) * (1 - g * 0.3));
      eye = Math.max(eye, Math.sin(Math.min(1, g * 1.4) * Math.PI));
    }
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
    const cr = a.crouch ?? 0;
    pitch += -0.16 * cr; y -= 0.1 * size * cr;
    if (a.settle > 0) {
      a.settle = Math.max(0, a.settle - dtV / 0.4);
      const p = 1 - a.settle;
      y -= 0.12 * size * Math.sin(Math.PI * p);
      pitch += 0.12 * Math.sin(Math.PI * p);
      hop = 0.55 * a.settle * a.settle;
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

  // --- Newts: mostly swimming, now and then a walk on land ------------------
  newt(a, sp, arr, dt) {
    const W = this.world, T = W.terrain;
    a.modeT = (a.modeT ?? 20 + Math.random() * 40) - dt;
    const inWater = W.water.surfaceAt(a.pos.x, a.pos.z) > T.heightAt(a.pos.x, a.pos.z) + 1.5;
    if (a.modeT <= 0) {
      a.modeT = 20 + Math.random() * 50;
      const stay = a.mode === 'land' && Math.random() < (sp.landBias ?? 0);
      a.mode = stay ? 'land' : a.mode === 'land' ? 'water' : Math.random() < (sp.landBias ?? 0.35) ? 'land' : 'water';
    }
    if (a.mode === 'land') {
      // Walk toward the nearest shore, then potter about on land.
      this.crawl(a, sp, dt, inWater ? 'any' : 'land', a.sp === 'firesal' ? { rest: [3, 13], restP: 0.65, speed: 0.75 } : { rest: [2, 8], restP: 0.55, speed: 0.9 });
      if (inWater && a.state !== 'walk') a.pos.y = T.heightAt(a.pos.x, a.pos.z);
      a.swimming = false;
    } else if (inWater) {
      this.swim(a, { ...sp, band: 'bottom', school: false, speed: sp.speed }, arr, dt);
      a.swimming = true;
    } else {
      this.crawl(a, sp, dt, 'any', { rest: [2, 8], restP: 0.55, speed: 0.9 });
      a.swimming = false;
    }
  }

  // --- Axolotls: walk the bottom, sometimes drift up and swim ----------------
  axolotl(a, sp, arr, dt) {
    const W = this.world;
    a.modeT = (a.modeT ?? 30 + Math.random() * 30) - dt;
    if (a.modeT <= 0) { a.modeT = 20 + Math.random() * 40; a.mode = Math.random() < 0.3 ? 'swim' : 'walk'; }
    if (a.mode === 'swim') { this.swim(a, { ...sp, band: 'mid', school: false }, arr, dt); a.swimming = true; }
    else { this.crawl(a, sp, dt, 'water', { rest: [2, 9], restP: 0.5, speed: 0.9 }); a.swimming = false; }
  }

  // --- Geckos: run over the ground, climb the background, hunt insects ------
  gecko(a, sp, dt) {
    const W = this.world, T = W.terrain, Wl = W.wall;
    a.timer -= dt;
    // Hunting is in hunter(): it steers `a.target` at the prey and strikes.
    if (a.onWall) {
      if (!a.target || a.timer <= 0) {
        a.timer = 1 + Math.random() * 4;
        a.target = Math.random() < 0.35 ? null : V(clamp(a.pos.x + (Math.random() - 0.5) * 24, -TANK.w / 2 + 2, TANK.w / 2 - 2), clamp(a.pos.y + (Math.random() - 0.5) * 20, W.water.level + 2, TANK.h - 3), 0);
      }
      if (a.target) {
        const dx = a.target.x - a.pos.x, dy = a.target.y - a.pos.y, d = Math.hypot(dx, dy);
        if (d < 0.4) a.target = null;
        else {
          const st = Math.min(d, sp.speed * dt * (0.5 + 0.5 * Math.sin(this.t * 5 + a.phase) ** 2));
          a.pos.x += dx / d * st; a.pos.y += dy / d * st;
          a.yaw = angLerp(a.yaw, Math.atan2(dx, -dy), Math.min(1, dt * 8));
        }
      }
      const z = Wl.zAt(a.pos.x, a.pos.y);
      a.pos.z = z + 0.35;
      const [gx, gy] = Wl.field.gradient(a.pos.x, a.pos.y);
      a.normal = V(-gx, -gy, 1).normalize();
      a.wallMode = true;
      // Climb back down when the wall meets the ground.
      const ground = T.heightAt(a.pos.x, z + 1.5);
      if (a.pos.y < ground + 1.2 && Math.random() < dt * 0.5) {
        a.onWall = false; a.wallMode = false;
        a.pos.set(a.pos.x, ground, z + 1.5);
      }
      return;
    }
    this.crawl(a, { ...sp, speed: sp.speed * 0.8 }, dt, 'land');
    // At the back of the tank, sometimes step up onto the background.
    const wz = Wl.zAt(a.pos.x, a.pos.y + 1);
    if (a.pos.z < wz + 3 && Math.random() < dt * 0.4) {
      a.onWall = true;
      a.pos.y += 1;
      a.target = null;
    }
  }

  draw(dt = 0.016) {
    const q = this._q;
    const e = new THREE.Euler();
    const tq = new THREE.Quaternion();
    const fix = new THREE.Quaternion();
    const cam = this.camera?.position;
    for (const [id, arr] of Object.entries(this.by)) {
      const sp = SPECIES[id];
      const dm = this.meshes[id];
      const an = sp.anim ?? {};
      const morphs = hasGenetics(id);
      for (const k of this.keys[id]) this.meshes[k].begin();
      for (const a of arr) {
        const cm = morphs && a.morph ? this.meshFor(id, a.morph) : dm;
        const grow = clamp(0.35 + (a.age / 1440) / (sp.adultDays ?? 10) * 0.65, 0.35, 1);
        const sc = (sp.scale ?? sp.size) * grow;
        const swimming = sp.kind === 'swim' || a.swimming;
        if (a.wallMode) {
          // On the background: belly to the wall, heading within its plane.
          q.setFromUnitVectors(UP, a.normal);
          q.multiply(tq.setFromAxisAngle(UP, a.yaw));
        } else if (a.normal && !swimming && !a.hop && sp.kind !== 'fly') {
          const up = a.normal.clone().lerp(UP, 0.3).normalize();
          q.setFromUnitVectors(UP, up);
          q.multiply(tq.setFromAxisAngle(UP, a.yaw));
        } else {
          e.set(a.pitch ?? 0, a.yaw, 0, 'YXZ');
          q.setFromEuler(e);
        }
        const rel = Math.min(1.5, (a.speedNow ?? 0) / Math.max(0.1, sp.speed));
        const walker = sp.kind === 'newt' || sp.kind === 'axolotl' || sp.kind === 'gecko';
        // Undulation: strong when swimming; walking salamanders, newts and geckos bend sideways in step with the legs.
        let amp = (an.amp ?? 0) * (swimming ? 0.6 + rel * 0.6 : walker ? Math.min(1, rel * 1.2) * 0.9 : rel * 0.35);
        if (a.stranded) amp = (an.amp ?? 0.3) * 2.5;
        a.wph = (a.wph ?? a.phase) + dt * (swimming ? 5 + rel * 7 : 3 + rel * 4) * 2;
        if (walker && !swimming && (a.speedNow ?? 0) > 0.05) a.wph = (a.gait ?? 0) + a.phase;
        // Legs: stretched out through the first part of a hop and tucked in
        // for the landing; a swimming frog kicks.
        let hop = 0;
        if (a.hop) { const t = Math.min(1, a.hop.t); hop = t < 0.6 ? Math.sin((t / 0.6) * Math.PI * 0.5) : 1 - (t - 0.6) / 0.4; }
        else if ((sp.kind === 'frog' || sp.kind === 'toad') && a.swimming) hop = 0.45 + 0.55 * Math.max(0, Math.sin((a.kick ?? 0) * Math.PI));
        let pos = a.pos, packed = hop;
        if (VIS.has(sp.kind) || sp.kind === 'crawlWater' || sp.kind === 'crawlLand' || sp.kind === 'crab') {
          const v = this.vis(a, sp, dt / this.tf);
          if (VIS.has(sp.kind) && !a.swimming) {
            if (!a.hop) hop = Math.max(hop, v.hop);
            packed = packAnim(hop, v.breath, v.throat, v.eye);
            if (!a.hop) pos = _p.copy(a.pos).add(v.off); pos.y += v.y;
          } else if (VIS.has(sp.kind)) packed = packAnim(hop, v.breath, 0, v.eye);
          if (!a.hop && !a.wallMode) _qo.setFromEuler(_e.set(v.pitch, v.yaw + v.yawN, v.roll, 'YXZ')); else _qo.setFromEuler(_e.set(v.pitch, v.yaw + v.yawN, 0, 'YXZ'));
          if (!a.hop) q.multiply(_qo);
        }
        cm.put(pos, q, sc, a.wph, amp, a.gait ?? 0, packed, cam ? cam.distanceToSquared(a.pos) : 1e9);
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
    return this.all.map((a) => ({ sp: a.sp, p: a.pos.toArray().map((v) => +v.toFixed(2)), h: +a.hunger.toFixed(3), hp: +a.health.toFixed(3), age: Math.round(a.age), x: pick(a, ['id', 'parent', 'into', 'n', 'hatch', 'where', 'onWall', 'genes', 'morph', 'gsp', 'gen', 'parents', 'nick', 'mate', 'pg', 'gp', 'mut']) }));
  }
}

const SPECIES_LOCI = (id) => lociOf(id).length;

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
