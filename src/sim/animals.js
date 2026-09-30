// Animals: species definitions (look, habitat, needs, diet) and the agents
// that live, move, eat, breed and die in the tank. Every species is one
// instanced, procedurally animated mesh (see creatures.js).

import * as THREE from 'three/webgpu';
import { Builder, PRIM, hash3, clamp, lerp, rng } from '../render/geo.js';
import { CreatureLOD, BODIES, FINISH, withRig } from '../render/creatures.js';
import { loadManifest, loadCreatureGLB } from '../render/creatures/glb.js';
import { TANK, MAT } from './tank.js';

const C = (h) => new THREE.Color(h);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);

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
  axolotl: {
    name: 'Axolotl', scale: 1, group: 'Amphibians', kind: 'axolotl', size: 2.6, speed: 1.4,
    temp: [14, 21], hungerHours: 260, lifeDays: 5000, eats: ['shrimp', 'flake', 'tadpole'], cap: 4, breed: 0,
    body: sdfBody('axolotl'), anim: { amp: 0.9, wave: 1.1, lift: 0.25, stride: 0.4 },
    note: 'Fully aquatic and needs cold water (14–21 °C): turn the heater down or it will suffer.',
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
    temp: [24, 30], hungerHours: 130, lifeDays: 1200, eats: ['flake'], cap: 4, breed: 0,
    body: sdfBody('betta'), anim: { amp: 0.32, wave: 1.3 },
    note: 'Long-finned labyrinth fish: it breathes air from the surface. Keep one male alone.',
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

export const ONE = { neon: 'neon tetra', guppy: 'guppy', cory: 'corydoras', shrimp: 'cherry shrimp', crab: 'vampire crab', isopod: 'isopod', springtail: 'springtail', fly: 'fruit fly', dartfrog: 'blue dart frog', strawberry: 'strawberry dart frog', toad: 'fire-bellied toad', newt: 'newt', axolotl: 'axolotl', gecko: 'gecko', tadpole: 'tadpole', eggs: 'egg clutch', cardinal: 'cardinal tetra', ember: 'ember tetra', betta: 'betta', oto: 'otocinclus', snail: 'trumpet snail', leucomelas: 'yellow-banded poison frog', auratus: 'green and black poison frog' };
export const one = (id) => ONE[id] ?? SPECIES[id].name.toLowerCase();

export const FOOD_VALUE = { fly: 0.25, springtail: 0.07, isopod: 0.12, shrimp: 0.35, flake: 0.3, tadpole: 0.2 };

// ---------------------------------------------------------------------------

// The instanced mesh for one species (also used by the creature bench).
export function createSpeciesMesh(scene, id, { cap = null } = {}) {
  const sp = SPECIES[id];
  const a = sp.anim ?? {};
  const src = (BODY_CACHE[id] ??= sp.body());
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
    this.meshes = {};
    this.tails = {};
    this.food = [];
    this.camera = null;   // set by Game: fine meshes are used for animals near it
    for (const [id, sp] of Object.entries(SPECIES)) {
      this.by[id] = [];
      this.meshes[id] = createSpeciesMesh(scene, id);
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
    const a = {
      id: nextId++, sp: id, pos: pos.clone(), vel: V(0, 0, 0), yaw: Math.random() * Math.PI * 2, pitch: 0,
      hunger: opt.hunger ?? 0.2, health: opt.health ?? 1, age: opt.age ?? (sp.adultDays ?? 10) * 1440,
      state: 'idle', timer: Math.random() * 3, target: null, wander: Math.random() * Math.PI * 2,
      phase: Math.random() * 10, home: pos.clone(), hop: null, name: null, cause: null,
    };
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
    for (const [id, arr] of Object.entries(this.by)) {
      const sp = SPECIES[id];
      for (const a of arr) {
        const px = a.pos.x, py = a.pos.y, pz = a.pos.z;
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
        // Distance walked drives the leg cycle.
        const moved = Math.hypot(a.pos.x - px, a.pos.y - py, a.pos.z - pz);
        a.gait = (a.gait ?? a.phase) + moved * 2.6;
        a.speedNow = dt > 0 ? moved / dt : 0;
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

  swim(a, sp, arr, dt) {
    const W = this.world, T = W.terrain;
    const L = W.water.level;
    const floor = T.heightAt(a.pos.x, a.pos.z);
    if (L - floor < 1.2) {
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
    // Food.
    if (a.hunger > 0.25 && this.food.length) {
      let best = null, bd = 30;
      for (const f of this.food) {
        if (f.eaten) continue;
        if (sp.band !== 'bottom' && f.settled) continue;
        const d = f.pos.distanceTo(a.pos);
        if (d < bd) { bd = d; best = f; }
      }
      if (best) {
        desired.copy(best.pos).sub(a.pos).normalize().multiplyScalar(sp.speed * 1.4);
        if (bd < 0.9) { best.eaten = true; a.hunger = Math.max(0, a.hunger - FOOD_VALUE.flake); a.ate = (a.ate ?? 0) + 1; }
      }
    }
    // Depth preference.
    const band = sp.band === 'top' ? L - 2.5 : sp.band === 'bottom' ? floor + 1.0 : lerp(floor, L, 0.5);
    desired.y += (band - a.pos.y) * 0.8;
    // Look ahead for walls, banks and the surface.
    const sp2 = a.vel.lengthSq() > 0.01 ? a.vel.clone().normalize() : V(Math.sin(a.yaw), 0, Math.cos(a.yaw));
    const ahead = a.pos.clone().addScaledVector(sp2, 4);
    const hx = TANK.w / 2 - 1.5, hz = TANK.d / 2 - 1.5;
    const blocked = Math.abs(ahead.x) > hx || Math.abs(ahead.z) > hz || T.heightAt(ahead.x, ahead.z) > Math.min(L - 1, a.pos.y - 0.3);
    if (blocked) {
      if (a.home.distanceTo(a.pos) < 3 || !W.water.isWater(a.home.x, a.home.z, 2)) a.home = this.randomWater(2) ?? a.home;
      desired.addScaledVector(a.home.clone().sub(a.pos).setY(0).normalize(), sp.speed * 2.5);
      a.wander = Math.atan2(a.home.x - a.pos.x, a.home.z - a.pos.z);
    }
    a.vel.lerp(desired, Math.min(1, dt * 1.8));
    const maxS = sp.speed * (a.hunger > 0.25 ? 1.5 : 1);
    if (a.vel.length() > maxS) a.vel.setLength(maxS);
    const prev = a.pos.clone();
    a.pos.addScaledVector(a.vel, dt);
    a.pos.x = clamp(a.pos.x, -hx - 0.5, hx + 0.5);
    a.pos.z = clamp(a.pos.z, -hz - 0.5, hz + 0.5);
    const f2 = T.heightAt(a.pos.x, a.pos.z);
    if (L - f2 < 1.3) a.pos.copy(prev);
    a.pos.y = clamp(a.pos.y, T.heightAt(a.pos.x, a.pos.z) + 0.5, L - 0.5);
    const hs = Math.hypot(a.vel.x, a.vel.z);
    if (hs > 0.05) a.yaw = Math.atan2(a.vel.x, a.vel.z);
    a.pitch = lerp(a.pitch, -Math.atan2(a.vel.y, Math.max(0.3, hs)) * 0.6, Math.min(1, dt * 4));
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
    if (medium === 'water') return depth > 1;
    if (medium === 'land') return !(depth > -0.2);
    return !(depth > maxDepth);
  }

  crawl(a, sp, dt, medium) {
    const W = this.world, T = W.terrain;
    a.timer -= dt;
    if (!a.target || a.timer <= 0) {
      if (a.state === 'walk' || Math.random() < 0.4) {
        a.state = 'rest';
        a.timer = 1 + Math.random() * 4;
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
        const step = sp.speed * dt * (0.7 + 0.3 * Math.sin(this.t * 6 + a.phase));
        const nx = a.pos.x + d.x * step, nz = a.pos.z + d.z * step;
        if (this.okFor(medium, nx, nz)) { a.pos.x = nx; a.pos.z = nz; }
        else a.timer = 0;
        const want = Math.atan2(d.x, d.z) + (sp.kind === 'crab' ? Math.PI / 2 : 0);
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
  }

  fly(a, sp, dt) {
    const W = this.world, T = W.terrain;
    a.timer -= dt;
    if (a.state === 'rest') {
      if (a.timer <= 0) { a.state = 'fly'; a.timer = 2 + Math.random() * 5; }
      a.pos.y = Math.max(T.heightAt(a.pos.x, a.pos.z), W.water.surfaceAt(a.pos.x, a.pos.z));
      return;
    }
    a.wander += (Math.random() - 0.5) * dt * 8;
    const d = V(Math.sin(a.wander), Math.sin(this.t * 1.7 + a.phase) * 0.6, Math.cos(a.wander)).multiplyScalar(sp.speed * 0.6);
    a.vel.lerp(d, Math.min(1, dt * 3));
    a.pos.addScaledVector(a.vel, dt);
    const g = Math.max(T.heightAt(a.pos.x, a.pos.z), W.water.surfaceAt(a.pos.x, a.pos.z));
    if (a.pos.y < g + 1.2) { a.pos.y = g + 1.2; a.vel.y = Math.abs(a.vel.y); }
    if (a.pos.y > TANK.h - 3) a.pos.y = TANK.h - 3;
    const hx = TANK.w / 2 - 1, hz = TANK.d / 2 - 1;
    if (Math.abs(a.pos.x) > hx) { a.pos.x = Math.sign(a.pos.x) * hx; a.wander = Math.atan2(-a.pos.x, 0); }
    if (Math.abs(a.pos.z) > hz) { a.pos.z = Math.sign(a.pos.z) * hz; a.wander = Math.atan2(0, -a.pos.z); }
    const wz = W.wall.zAt(a.pos.x, a.pos.y) + 1;
    if (a.pos.z < wz) { a.pos.z = wz; a.wander = 0; }
    a.yaw = Math.atan2(a.vel.x, a.vel.z);
    if (a.timer <= 0) {
      a.timer = 3 + Math.random() * 8;
      // Land only on dry ground.
      if (W.water.surfaceAt(a.pos.x, a.pos.z) === -Infinity) a.state = 'rest';
    }
  }

  // --- Frogs and toads ---------------------------------------------------------
  // On land they sit, turn, creep a step or two and hop. A hop is a real
  // ballistic arc: it only goes where the frog can land (dry, not too steep,
  // not too high) and it never crosses water the arc wouldn't clear. A dart
  // frog that ends up in water paddles to the nearest bank and climbs out;
  // toads like the water and float at the surface, kicking along.
  frog(a, sp, dt) {
    const W = this.world, T = W.terrain;
    const toad = sp.kind === 'toad';
    if (a.tongue) a.tongue = Math.max(0, a.tongue - dt);
    if (a.hop) {
      const hp = a.hop;
      hp.t += dt / hp.dur;
      const t = Math.min(1, hp.t);
      a.pos.lerpVectors(hp.from, hp.to, t);
      a.pos.y += 4 * hp.h * t * (1 - t);
      a.pitch = -Math.atan2(hp.to.y - hp.from.y + 4 * hp.h * (1 - 2 * t), Math.max(0.1, hp.from.distanceTo(hp.to))) * 0.6;
      if (t >= 1) {
        a.hop = null;
        a.pitch = 0;
        a.state = 'sit';
        a.timer = 0.8 + Math.random() * 4;
        if (hp.splash) W.fx?.addDrop(a.pos.x, a.pos.z, -4, 0.8);
      }
      return;
    }
    const g = T.heightAt(a.pos.x, a.pos.z);
    const s = W.water.surfaceAt(a.pos.x, a.pos.z, 0.2);
    const inWater = s > g + 0.9 * sp.size;
    a.swimming = inWater;
    a.timer -= dt;
    if (inWater) { this.frogSwim(a, sp, dt, s, toad); return; }
    a.pos.y = g;
    a.normal = T.normalAt(a.pos.x, a.pos.z);
    // Hunt: turn to face prey, creep or hop closer, then the tongue.
    if (a.hunger > 0.2) {
      let best = null, bd = 16;
      for (const pid of sp.eats) {
        if (!this.catchable(pid)) continue;
        for (const p of this.by[pid] ?? []) {
          const d = p.pos.distanceTo(a.pos);
          if (d < bd) { bd = d; best = p; }
        }
      }
      if (best) {
        a.yaw = angLerp(a.yaw, Math.atan2(best.pos.x - a.pos.x, best.pos.z - a.pos.z), Math.min(1, dt * 6));
        if (bd < 2.2 * sp.size && Math.abs(best.pos.y - a.pos.y) < 3) {
          this.remove(best, `eaten by a ${sp.name.toLowerCase()}`);
          a.hunger = Math.max(0, a.hunger - (FOOD_VALUE[best.sp] ?? 0.1));
          a.tongue = 0.25;
          if (Math.random() < 0.4) this.world.log(`${sp.name} caught a ${one(best.sp)}.`, 'eat');
          return;
        }
        if (a.timer <= 0) {
          const dir = best.pos.clone().sub(a.pos).setY(0);
          const len = Math.min(dir.length() - 1.2 * sp.size, 7 * sp.size);
          if (len < 2 && this.frogStep(a, sp, dir, dt)) return;
          if (this.hopTo(a, sp, a.pos.clone().addScaledVector(dir.normalize(), Math.max(1.5, len)))) return;
          a.timer = 0.4;
        }
      }
    }
    if (a.timer <= 0) {
      // Wander: mostly short hops; toads now and then head for water.
      const wantWater = toad && Math.random() < 0.3;
      // A stressed frog (air too dry or cold) casts a wider net and goes for the best spot.
      const uneasy = (a.why?.length ?? 0) > 0;
      const cands = [];
      for (let k = 0; k < (uneasy ? 16 : 10); k++) {
        const ang = a.yaw + (Math.random() - 0.5) * (k < 5 && !uneasy ? 2 : 6.28), r = (1.8 + Math.random() * 4) * sp.size * (uneasy ? 2.2 : 1);
        const to = V(a.pos.x + Math.sin(ang) * r, 0, a.pos.z + Math.cos(ang) * r);
        cands.push({ to, sc: this.comfortAt(sp, to.x, T.heightAt(to.x, to.z), to.z) * (uneasy ? 6 : 3) + Math.random() });
      }
      cands.sort((p, q) => q.sc - p.sc);
      for (const c of cands) if (this.hopTo(a, sp, c.to, wantWater)) return;
      a.timer = 1 + Math.random() * 3;
    }
  }

  // A careful step (for the last few centimetres to prey).
  frogStep(a, sp, dir, dt) {
    const W = this.world;
    const d = dir.clone().setY(0).normalize().multiplyScalar(sp.speed * 0.6 * dt);
    const nx = a.pos.x + d.x, nz = a.pos.z + d.z;
    if (W.water.surfaceAt(nx, nz, 0.3) > -Infinity) return false;
    a.pos.x = nx; a.pos.z = nz;
    a.pos.y = W.terrain.heightAt(nx, nz);
    return true;
  }

  frogSwim(a, sp, dt, s, toad) {
    const W = this.world, T = W.terrain;
    a.pos.y = s - 0.35 * sp.size;
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
    if (Math.abs(nx) < TANK.w / 2 - 1 && Math.abs(nz) < TANK.d / 2 - 1) { a.pos.x = nx; a.pos.z = nz; }
    if (push > 0.9 && Math.random() < dt * 4) W.fx?.addDrop(a.pos.x, a.pos.z, -1.2, 0.5);
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

  hopTo(a, sp, to, intoWater = false) {
    const W = this.world, T = W.terrain;
    if (Math.abs(to.x) > TANK.w / 2 - 1.5 || Math.abs(to.z) > TANK.d / 2 - 1.5) return false;
    const g = T.heightAt(to.x, to.z);
    const s = W.water.surfaceAt(to.x, to.z, 0.3);
    const wet = s > g + 0.2;
    // Dart frogs never hop into water; toads only when they mean to.
    if (wet && !(sp.kind === 'toad' && intoWater)) return false;
    if (!wet && T.normalAt(to.x, to.z).y < 0.6) return false;       // too steep to land on
    if (!wet && W.water.nearestFall(V(to.x, g, to.z), 1.5)) return false;
    to.y = wet ? s - 0.35 * sp.size : g;
    const rise = to.y - a.pos.y;
    if (rise > 5 * sp.size || rise < -14 * sp.size) return false;
    const dist = Math.hypot(to.x - a.pos.x, to.z - a.pos.z);
    const h = 1 + dist * 0.28 + Math.max(0, rise);
    // Standing in a puddle or the shallows: the arc starts at the surface.
    const y0 = Math.max(a.pos.y, W.water.surfaceAt(a.pos.x, a.pos.z, 0.05));
    // The arc must clear everything under it: ground, rocks and water.
    for (let i = 1; i < 8; i++) {
      const t = i / 8;
      const x = a.pos.x + (to.x - a.pos.x) * t, z = a.pos.z + (to.z - a.pos.z) * t;
      const y = y0 + (to.y - y0) * t + 4 * h * t * (1 - t);
      const under = Math.max(T.heightAt(x, z), W.water.surfaceAt(x, z, 0.3));
      if (y < under + 0.3 && !(wet && t > 0.75)) return false;
    }
    this.startHop(a, to, h, wet);
    return true;
  }

  startHop(a, to, h, splash = false) {
    const d = a.pos.distanceTo(to);
    a.hop = { from: a.pos.clone(), to, t: 0, dur: 0.22 + Math.sqrt(d) * 0.1, h: Math.max(h, 0.6), splash };
    a.yaw = Math.atan2(to.x - a.pos.x, to.z - a.pos.z);
    a.floating = false;
  }

  // --- Newts: mostly swimming, now and then a walk on land ------------------
  newt(a, sp, arr, dt) {
    const W = this.world, T = W.terrain;
    a.modeT = (a.modeT ?? 20 + Math.random() * 40) - dt;
    const inWater = W.water.surfaceAt(a.pos.x, a.pos.z) > T.heightAt(a.pos.x, a.pos.z) + 1.5;
    if (a.modeT <= 0) {
      a.modeT = 20 + Math.random() * 50;
      a.mode = a.mode === 'land' ? 'water' : Math.random() < 0.35 ? 'land' : 'water';
    }
    if (a.mode === 'land') {
      // Walk toward the nearest shore, then potter about on land.
      this.crawl(a, sp, dt, inWater ? 'any' : 'land');
      if (inWater && a.state !== 'walk') a.pos.y = T.heightAt(a.pos.x, a.pos.z);
      a.swimming = false;
    } else if (inWater) {
      this.swim(a, { ...sp, band: 'bottom', school: false, speed: sp.speed }, arr, dt);
      a.swimming = true;
    } else {
      this.crawl(a, sp, dt, 'any');
      a.swimming = false;
    }
    this.hunt(a, sp, 4);
  }

  // --- Axolotls: walk the bottom, sometimes drift up and swim ----------------
  axolotl(a, sp, arr, dt) {
    const W = this.world;
    a.modeT = (a.modeT ?? 30 + Math.random() * 30) - dt;
    if (a.modeT <= 0) { a.modeT = 20 + Math.random() * 40; a.mode = Math.random() < 0.3 ? 'swim' : 'walk'; }
    if (a.mode === 'swim') { this.swim(a, { ...sp, band: 'mid', school: false }, arr, dt); a.swimming = true; }
    else { this.crawl(a, sp, dt, 'water'); a.swimming = false; }
    this.hunt(a, sp, 3);
  }

  // Snap up prey within reach (newts, axolotls).
  hunt(a, sp, reach) {
    if (a.hunger < 0.25) return;
    for (const pid of sp.eats) {
      if (!this.catchable(pid)) continue;
      for (const p of this.by[pid] ?? []) {
        if (p.pos.distanceTo(a.pos) < reach * 0.5) {
          this.remove(p, `eaten by a ${one(a.sp)}`);
          a.hunger = Math.max(0, a.hunger - (FOOD_VALUE[pid] ?? 0.1));
          if (Math.random() < 0.3) this.world.log(`A ${one(a.sp)} ate a ${one(pid)}.`, 'eat');
          return;
        }
      }
    }
  }

  // --- Geckos: run over the ground, climb the background, hunt insects ------
  gecko(a, sp, dt) {
    const W = this.world, T = W.terrain, Wl = W.wall;
    a.timer -= dt;
    // Hunt: lunge at a fly or springtail close by.
    if (a.hunger > 0.2) {
      let best = null, bd = 10;
      for (const pid of sp.eats) for (const p of this.catchable(pid) ? this.by[pid] : []) {
        const d = p.pos.distanceTo(a.pos);
        if (d < bd) { bd = d; best = p; }
      }
      if (best && bd < 1.6) {
        this.remove(best, 'eaten by a gecko');
        a.hunger = Math.max(0, a.hunger - (FOOD_VALUE[best.sp] ?? 0.1));
        if (Math.random() < 0.3) W.log(`A gecko caught a ${one(best.sp)}.`, 'eat');
      } else if (best && !a.onWall) a.target = best.pos.clone().setY(0);
    }
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
      const cm = this.meshes[id];
      const an = sp.anim ?? {};
      cm.begin();
      for (const a of arr) {
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
        // Undulation: strong when swimming, a gentle sway when walking.
        let amp = (an.amp ?? 0) * (swimming ? 0.6 + rel * 0.6 : rel * 0.35);
        if (a.stranded) amp = (an.amp ?? 0.3) * 2.5;
        a.wph = (a.wph ?? a.phase) + dt * (swimming ? 5 + rel * 7 : 3 + rel * 4) * 2;
        // Legs: stretched out through the first part of a hop and tucked in
        // for the landing; a swimming frog kicks.
        let hop = 0;
        if (a.hop) { const t = Math.min(1, a.hop.t); hop = t < 0.6 ? Math.sin((t / 0.6) * Math.PI * 0.5) : 1 - (t - 0.6) / 0.4; }
        else if ((sp.kind === 'frog' || sp.kind === 'toad') && a.swimming) hop = 0.45 + 0.55 * Math.max(0, Math.sin((a.kick ?? 0) * Math.PI));
        cm.put(a.pos, q, sc, a.wph, amp, a.gait ?? 0, hop, cam ? cam.distanceToSquared(a.pos) : 1e9);
      }
      cm.end();
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
    return this.all.map((a) => ({ sp: a.sp, p: a.pos.toArray().map((v) => +v.toFixed(2)), h: +a.hunger.toFixed(3), hp: +a.health.toFixed(3), age: Math.round(a.age), x: pick(a, ['parent', 'into', 'n', 'hatch', 'where', 'onWall']) }));
  }
}

function pick(o, keys) {
  const r = {};
  for (const k of keys) if (o[k] !== undefined) r[k] = o[k];
  return Object.keys(r).length ? r : undefined;
}

function angLerp(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return a + d * t;
}
