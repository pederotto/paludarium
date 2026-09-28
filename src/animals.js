// Animals: species definitions (look, habitat, needs, diet) and the agents
// that live, move, eat, breed and die in the tank. Every species is drawn
// with one InstancedMesh (fish have a second one for the tail, so it can wag).

import * as THREE from 'three/webgpu';
import { Builder, PRIM, hash3, clamp, lerp, rng } from './geo.js';
import { creatureMaterial } from './shaders.js';
import { TANK, MAT } from './config.js';

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

export const SPECIES = {
  neon: {
    name: 'Neon tetra', scale: 1, group: 'Fish', kind: 'swim', band: 'mid', school: true, size: 3.2, speed: 5,
    temp: [21, 27], hungerHours: 120, lifeDays: 1500, eats: ['flake'], cap: 60, breed: 0,
    body: () => fishBody({ len: 3.2, h: 0.85, w: 0.5, color: neonColor }), tail: () => fishTail({ len: 3.2, h: 0.85, color: 0xc9d3d8 }),
    note: 'Schooling fish. Keep 6 or more.',
  },
  guppy: {
    name: 'Guppy', scale: 1, group: 'Fish', kind: 'swim', band: 'top', school: false, size: 3.0, speed: 4.5,
    temp: [22, 28], hungerHours: 120, lifeDays: 700, eats: ['flake'], cap: 40, breed: 0.05, adultDays: 8,
    body: () => fishBody({ len: 3.0, h: 0.8, w: 0.5, color: (l) => (l.z < -0.2 ? C(0xff7a2a) : C(0xb7c4c9)) }),
    tail: () => fishTail({ len: 3.0, h: 1.3, color: (l, v) => (hash3(v.y * 4, v.z * 4, 1) > 0.5 ? C(0x3a7ae0) : C(0xff6a1a)), spread: 1.6 }),
    note: 'Livebearer: breeds on its own when well fed.',
  },
  cory: {
    name: 'Corydoras', scale: 1, group: 'Fish', kind: 'swim', band: 'bottom', school: true, size: 4.0, speed: 3,
    temp: [21, 26], hungerHours: 140, lifeDays: 1800, eats: ['flake', 'detritus'], cap: 20, breed: 0,
    body: () => fishBody({ len: 4.0, h: 1.3, w: 0.9, color: (l, v) => (hash3(Math.floor(v.x * 4), Math.floor(v.y * 4), Math.floor(v.z * 4)) > 0.6 ? C(0x3c3a33) : C(0x9a8f78)) }),
    tail: () => fishTail({ len: 4.0, h: 1.2, color: 0x8c826c }),
    note: 'Bottom cleaner. Eats leftovers on the sand.',
  },
  shrimp: {
    name: 'Cherry shrimp', group: 'Crustaceans', kind: 'crawlWater', size: 1.0, speed: 1.2,
    temp: [18, 28], hungerHours: 200, lifeDays: 365, eats: ['detritus', 'biofilm', 'flake'], cap: 80, breed: 0.04, adultDays: 20,
    body: shrimpGeo, note: 'Grazes biofilm and detritus. Breeds in mature tanks.',
  },
  crab: {
    name: 'Vampire crab', group: 'Crustaceans', kind: 'crab', size: 1.0, speed: 2,
    temp: [22, 28], humidity: 70, hungerHours: 200, lifeDays: 900, eats: ['detritus', 'flake', 'springtail'], cap: 10, breed: 0,
    body: crabGeo, note: 'Semi-terrestrial: needs land and shallow water.',
  },
  isopod: {
    name: 'Dwarf isopods', group: 'Crustaceans', kind: 'crawlLand', size: 1.0, speed: 0.8,
    temp: [18, 28], humidity: 60, hungerHours: 150, lifeDays: 300, eats: ['detritus'], cap: 90, breed: 0.1, adultDays: 12,
    body: isopodGeo, note: 'Clean-up crew. Eat detritus on land.',
  },
  springtail: {
    name: 'Springtails', group: 'Insects', kind: 'crawlLand', hop: true, size: 1.4, speed: 0.9,
    temp: [16, 28], humidity: 70, hungerHours: 100, lifeDays: 40, eats: ['detritus'], cap: 160, breed: 0.3, adultDays: 5,
    body: springtailGeo, note: 'Tiny cleaners and frog food. Like damp moss.',
  },
  fly: {
    name: 'Fruit flies', group: 'Insects', kind: 'fly', size: 1.4, speed: 6,
    temp: [18, 30], humidity: 30, hungerHours: 30, lifeDays: 6, eats: ['detritus'], cap: 70, breed: 0.25, adultDays: 2,
    body: flyGeo, note: 'Flightless culture: live frog food.',
  },
  dartfrog: {
    name: 'Blue dart frog', group: 'Amphibians', kind: 'frog', size: 1.4, speed: 1,
    temp: [20, 27], humidity: 75, hungerHours: 170, lifeDays: 4000, eats: ['fly', 'springtail', 'isopod'], cap: 8, breed: 0,
    body: () => frogGeo({ back: 0x2f6fd8, belly: 0x1f4fa8, spots: 0x0b0f1a }),
    note: 'Terrestrial. Needs high humidity and live insects.',
  },
  toad: {
    name: 'Fire-bellied toad', group: 'Amphibians', kind: 'toad', size: 1.9, speed: 1.2,
    temp: [18, 26], humidity: 60, hungerHours: 240, lifeDays: 5000, eats: ['fly', 'springtail', 'isopod', 'shrimp'], cap: 6, breed: 0,
    body: () => frogGeo({ back: 0x4f8f2f, belly: 0xf05a1c, spots: 0x1a2a12 }),
    note: 'Semi-aquatic: needs both land and open water.',
  },
};

export const ONE = { neon: 'neon tetra', guppy: 'guppy', cory: 'corydoras', shrimp: 'cherry shrimp', crab: 'vampire crab', isopod: 'isopod', springtail: 'springtail', fly: 'fruit fly', dartfrog: 'blue dart frog', toad: 'fire-bellied toad' };
export const one = (id) => ONE[id] ?? SPECIES[id].name.toLowerCase();

export const FOOD_VALUE = { fly: 0.25, springtail: 0.07, isopod: 0.12, shrimp: 0.35, flake: 0.3 };

// ---------------------------------------------------------------------------

let nextId = 1;

export class Animals {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.by = {};
    this.meshes = {};
    this.tails = {};
    this.food = [];
    for (const [id, sp] of Object.entries(SPECIES)) {
      this.by[id] = [];
      const cap = sp.cap + 20;
      const mat = creatureMaterial({ rough: sp.group === 'Fish' ? 0.3 : 0.55 });
      const im = new THREE.InstancedMesh(sp.body(), mat, cap);
      im.count = 0; im.frustumCulled = false; im.castShadow = true;
      im.name = 'animal:' + id;
      scene.add(im);
      this.meshes[id] = im;
      if (sp.tail) {
        const tm = new THREE.InstancedMesh(sp.tail(), mat, cap);
        tm.count = 0; tm.frustumCulled = false;
        scene.add(tm);
        this.tails[id] = tm;
      }
    }
    const fg = new THREE.IcosahedronGeometry(0.22, 0);
    fg.scale(1, 0.35, 1);
    this.foodMesh = new THREE.InstancedMesh(fg, new THREE.MeshStandardNodeMaterial({ color: 0xc9772f, roughness: 0.8 }), 200);
    this.foodMesh.count = 0; this.foodMesh.frustumCulled = false;
    scene.add(this.foodMesh);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
  }

  get all() { return Object.values(this.by).flat(); }
  count(id) { return this.by[id].length; }

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
        switch (sp.kind) {
          case 'swim': this.swim(a, sp, arr, dt); break;
          case 'crawlWater': this.crawl(a, sp, dt, 'water'); break;
          case 'crawlLand': this.crawl(a, sp, dt, 'land'); break;
          case 'crab': this.crawl(a, sp, dt, 'any'); break;
          case 'fly': this.fly(a, sp, dt); break;
          case 'frog':
          case 'toad': this.frog(a, sp, dt); break;
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
    this.draw();
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
          if (medium === 'land') s += T.field.matAt(x, z, MAT.moss) * 1.5 + (W.nearWater(V(x, T.heightAt(x, z), z), 6) ? 0.5 : 0);
          if (medium === 'any') s += W.nearWater(V(x, T.heightAt(x, z), z), 4) ? 1 : 0;
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

  frog(a, sp, dt) {
    const W = this.world, T = W.terrain;
    const toad = sp.kind === 'toad';
    if (a.hop) {
      a.hop.t += dt / a.hop.dur;
      const t = Math.min(1, a.hop.t);
      a.pos.lerpVectors(a.hop.from, a.hop.to, t);
      a.pos.y += Math.sin(t * Math.PI) * a.hop.h;
      if (t >= 1) { a.hop = null; a.state = 'sit'; a.timer = 1 + Math.random() * 5; }
      return;
    }
    const swimming = toad && W.water.surfaceAt(a.pos.x, a.pos.z) > T.heightAt(a.pos.x, a.pos.z) + 0.8;
    if (swimming) {
      a.pos.y = W.water.surfaceAt(a.pos.x, a.pos.z) - 0.35;
    } else {
      a.pos.y = T.heightAt(a.pos.x, a.pos.z);
      a.normal = T.normalAt(a.pos.x, a.pos.z);
    }
    a.timer -= dt;
    // Hunt.
    if (a.hunger > 0.2) {
      let best = null, bd = 16;
      for (const pid of sp.eats) {
        for (const p of this.by[pid] ?? []) {
          const d = p.pos.distanceTo(a.pos);
          if (d < bd) { bd = d; best = p; }
        }
      }
      if (best) {
        a.yaw = angLerp(a.yaw, Math.atan2(best.pos.x - a.pos.x, best.pos.z - a.pos.z), Math.min(1, dt * 8));
        if (bd < 2.6 * sp.size) {
          // Tongue strike.
          this.remove(best, `eaten by a ${sp.name.toLowerCase()}`);
          a.hunger = Math.max(0, a.hunger - (FOOD_VALUE[best.sp] ?? 0.1));
          a.tongue = 0.25;
          this.world.log(`${sp.name} caught a ${one(best.sp)}.`, 'eat');
          return;
        }
        if (a.timer <= 0) {
          const dir = best.pos.clone().sub(a.pos).setY(0);
          const len = Math.min(dir.length() - 1, 6 * sp.size);
          const to = a.pos.clone().addScaledVector(dir.normalize(), Math.max(1, len));
          if (this.hopTo(a, sp, to)) return;
          a.timer = 0.5;
        }
      }
    }
    if (a.timer <= 0) {
      // Wander hop. Toads sometimes head for water, sometimes for land.
      for (let k = 0; k < 8; k++) {
        const ang = Math.random() * Math.PI * 2, r = (2 + Math.random() * 5) * sp.size;
        const to = V(a.pos.x + Math.sin(ang) * r, 0, a.pos.z + Math.cos(ang) * r);
        if (this.hopTo(a, sp, to)) return;
      }
      a.timer = 1 + Math.random() * 3;
    }
    if (swimming) {
      a.yaw += dt * 0.3;
    }
    if (a.tongue) a.tongue = Math.max(0, a.tongue - dt);
  }

  hopTo(a, sp, to) {
    const W = this.world, T = W.terrain;
    if (Math.abs(to.x) > TANK.w / 2 - 1.5 || Math.abs(to.z) > TANK.d / 2 - 1.5) return false;
    const g = T.heightAt(to.x, to.z);
    const s = W.water.surfaceAt(to.x, to.z);
    const wet = s > g + 0.2;
    if (wet && sp.kind !== 'toad') return false;
    if (wet && s - g > 25) return false;
    to.y = wet ? s - 0.35 : g;
    const rise = to.y - a.pos.y;
    if (rise > 7 * sp.size) return false;
    a.hop = { from: a.pos.clone(), to, t: 0, dur: 0.35 + a.pos.distanceTo(to) * 0.04, h: 1.5 + Math.max(0, rise) + a.pos.distanceTo(to) * 0.15 };
    a.yaw = Math.atan2(to.x - a.pos.x, to.z - a.pos.z);
    return true;
  }

  draw() {
    const m = this._m, q = this._q, s = this._s;
    const e = new THREE.Euler();
    const tq = new THREE.Quaternion();
    for (const [id, arr] of Object.entries(this.by)) {
      const sp = SPECIES[id];
      const im = this.meshes[id], tm = this.tails[id];
      let i = 0;
      for (const a of arr) {
        const grow = clamp(0.35 + (a.age / 1440) / (sp.adultDays ?? 10) * 0.65, 0.35, 1);
        const sc = (sp.scale ?? sp.size) * grow;
        if (a.normal && sp.kind !== 'swim' && sp.kind !== 'fly') {
          const up = a.normal.clone().lerp(UP, 0.3).normalize();
          q.setFromUnitVectors(UP, up);
          q.multiply(tq.setFromAxisAngle(UP, a.yaw));
        } else {
          e.set(a.pitch ?? 0, a.yaw, 0, 'YXZ');
          q.setFromEuler(e);
        }
        if (sp.kind === 'fly' && a.state !== 'rest') {
          // Flicker the wings by squashing a little.
          s.set(sc, sc * (0.85 + 0.15 * Math.sin(this.t * 90 + a.phase)), sc);
        } else s.set(sc, sc, sc);
        m.compose(a.pos, q, s);
        im.setMatrixAt(i, m);
        if (tm) {
          // Tail hinge sits at the back of the body; wag faster when swimming hard.
          const len = sp.size * 0.46 * grow;
          const back = V(0, 0, -len).applyQuaternion(q);
          const f = 8 + (a.swimSpeed ?? 1) * 3;
          const wag = Math.sin(this.t * f + a.phase) * (a.stranded ? 0.9 : 0.35);
          const tq2 = q.clone().multiply(tq.setFromAxisAngle(UP, wag));
          m.compose(a.pos.clone().add(back), tq2, s);
          tm.setMatrixAt(i, m);
        }
        i++;
      }
      im.count = i;
      im.instanceMatrix.needsUpdate = true;
      if (tm) { tm.count = i; tm.instanceMatrix.needsUpdate = true; }
    }
    this.food = this.food.filter((f) => !f.eaten);
    let k = 0;
    const fq = new THREE.Quaternion();
    for (const f of this.food) {
      if (k >= 200) break;
      fq.setFromEuler(e.set(0, f.sink * 30, 0));
      m.compose(f.pos, fq, s.set(1, 1, 1));
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
    return this.all.map((a) => ({ sp: a.sp, p: a.pos.toArray().map((v) => +v.toFixed(2)), h: +a.hunger.toFixed(3), hp: +a.health.toFixed(3), age: Math.round(a.age) }));
  }
}

function angLerp(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return a + d * t;
}
