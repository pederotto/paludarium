// Ties the tank together: substrate, background, water, rocks, plants,
// animals and the environment. Also builds the starter layout and handles
// saving and loading.

import * as THREE from 'three/webgpu';
import { Terrain, Wall } from './terrain.js';
import { Water } from './water.js';
import { Plants, PLANTS } from './plants.js';
import { Animals, SPECIES } from './animals.js';
import { Decor } from './decor.js';
import { Env, Sim } from './sim.js';
import { TANK, MAT, NMAT } from './config.js';
import { rng, smooth, clamp, lerp } from './geo.js';

export class World {
  constructor(scene) {
    this.scene = scene;
    this.logs = [];
    this.onLog = null;
    this.env = new Env();
    this.terrain = new Terrain(scene);
    this.wall = new Wall(scene);
    this.water = new Water(scene, this.terrain);
    this.decor = new Decor(scene, this);
    this.plants = new Plants(scene);
    this.animals = new Animals(scene, this);
    this.sim = new Sim(this);
    this._moss = 0;
  }

  log(msg, kind = 'info') {
    const entry = { t: this.env.day + 1 + ' ' + this.env.clock, msg, kind };
    this.logs.unshift(entry);
    if (this.logs.length > 60) this.logs.pop();
    this.onLog?.(entry);
  }

  nearWater(p, r) {
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
      if (this.water.surfaceAt(x, z) > this.terrain.heightAt(x, z)) return true;
    }
    return this.water.surfaceAt(p.x, p.z) > this.terrain.heightAt(p.x, p.z);
  }

  // Fraction of visible surface covered with moss (cached; updated on paint).
  mossFraction() { return this._moss; }
  updateMoss() {
    let s = 0, n = 0;
    for (const f of [this.terrain.field, this.wall.field]) {
      for (let i = 0; i < f.h.length; i++) { s += f.mat[i * NMAT + MAT.moss]; n++; }
    }
    this._moss = s / n;
  }

  // Call after the ground or wall changed shape.
  groundChanged({ ponds = true, falls = true } = {}) {
    this.terrain.update();
    this.wall.update();
    if (ponds) this.water.refreshPonds();
    if (falls) this.water.refreshFalls(this.wall);
    // Re-seat plants on the new ground.
    for (const p of this.plants.list) {
      if (p.surface === 'terrain') {
        p.pos.y = this.terrain.heightAt(p.pos.x, p.pos.z);
        p.normal.copy(this.terrain.normalAt(p.pos.x, p.pos.z));
        this.plants.writeInstance(p);
      }
    }
    this.plants.onWaterChanged(this);
    this.updateMoss();
    this.decor.scatterMoss();
  }

  setWaterLevel(y) {
    this.water.setLevel(y);
    this.water.refreshFalls(this.wall);
    this.plants.onWaterChanged(this);
    this.decor.scatterMoss();
  }

  randomSpot(test, tries = 200, r = Math.random) {
    for (let k = 0; k < tries; k++) {
      const x = (r() - 0.5) * (TANK.w - 6), z = (r() - 0.5) * (TANK.d - 6);
      const y = this.terrain.heightAt(x, z);
      const s = this.water.surfaceAt(x, z);
      if (test(x, y, z, s)) return new THREE.Vector3(x, y, z);
    }
    return null;
  }

  clearAll() {
    this.plants.clear();
    this.animals.clear();
    this.decor.clear();
    for (const p of [...this.water.ponds]) this.water.removePond(p);
    for (const f of [...this.water.falls]) this.water.removeFall(f);
    this.env.reset();
    this.logs.length = 0;
  }

  // --- Layouts -----------------------------------------------------------
  empty() {
    this.clearAll();
    this.terrain.flatDefault();
    this.wall.field.h.fill(0.6);
    this.wall.field.setMaterial(MAT.cork);
    this.water.setLevel(0);
    this.groundChanged();
    this.log('Empty tank. Sculpt some ground, then add water.');
  }

  starter() {
    this.clearAll();
    const r = rng(2024);
    const T = this.terrain.field;
    const L = 12;
    // Land rises to the back left; a small island sits in the water on the
    // right; the front is a sandy lagoon.
    for (let j = 0; j <= T.ny; j++) for (let i = 0; i <= T.nx; i++) {
      const [x, z] = T.toWorld(i, j);
      const n = T.idx(i, j);
      const land = smooth(6, -22, x + Math.sin(z * 0.15) * 5) * (0.55 + 0.45 * smooth(18, -18, z));
      const island = Math.max(0, 1 - Math.hypot((x - 24) / 8, (z + 2) / 6));
      const noise = Math.sin(x * 0.31 + z * 0.17) * 0.8 + Math.sin(x * 0.11 - z * 0.37) * 1.1;
      let h = 3 + land * 24 + island * island * 14 + noise * (0.4 + land);
      // Hollow for a pond on the plateau.
      const hollow = Math.max(0, 1 - Math.hypot((x + 30) / 6, (z + 6) / 4.5));
      h -= hollow * hollow * 7;
      T.h[n] = Math.max(0.8, h);
      // Materials.
      const m = new Float32Array(NMAT);
      if (h < L - 0.5) {
        m[z > 6 ? MAT.sand : MAT.gravel] = 1;
        if (z > 0 && z < 8) { m[MAT.sand] = 0.5; m[MAT.gravel] = 0.5; }
      } else {
        m[MAT.soil] = 1;
        const mossy = Math.sin(x * 0.23 + 1) * Math.sin(z * 0.29) + r() * 0.3;
        if (mossy > 0.15) { m.fill(0); m[MAT.moss] = 1; }
      }
      T.mat.set(m, n * NMAT);
    }
    // Steep slopes read as rock.
    for (let j = 0; j <= T.ny; j++) for (let i = 0; i <= T.nx; i++) {
      const [x, z] = T.toWorld(i, j);
      const [gx, gz] = T.gradient(x, z);
      if (Math.hypot(gx, gz) > 1.2) {
        const n = T.idx(i, j);
        for (let k = 0; k < NMAT; k++) T.mat[n * NMAT + k] = k === MAT.rock ? 1 : 0;
      }
    }
    T.dirty = true;

    // Background: cork relief with a mossy ledge high on the left.
    const Wf = this.wall.field;
    for (let j = 0; j <= Wf.ny; j++) for (let i = 0; i <= Wf.nx; i++) {
      const [x, y] = Wf.toWorld(i, j);
      const n = Wf.idx(i, j);
      const bumps = 2 + Math.sin(x * 0.21 + y * 0.13) * 1.2 + Math.sin(x * 0.07 - y * 0.29) * 1.5 + Math.sin(x * 0.5 + y * 0.6) * 0.3;
      const ledge = Math.max(0, 1 - Math.hypot((x + 27) / 14, (y - 40) / 4)) * 9;
      const column = Math.max(0, 1 - Math.abs(x - 30) / 6) * smooth(0, 45, y) * 5;
      Wf.h[n] = clamp(bumps + ledge + column, 0.4, Wf.maxH);
      const m = new Float32Array(NMAT);
      const mossy = Math.sin(x * 0.17 + y * 0.09) + Math.sin(y * 0.21 - x * 0.05) + (ledge > 1 ? 1.2 : 0);
      if (mossy > 0.9 && y > L + 2) m[MAT.moss] = 1;
      else m[MAT.cork] = 1;
      Wf.mat.set(m, n * NMAT);
    }
    Wf.dirty = true;

    this.terrain.update();
    this.wall.update();
    this.water.setLevel(L);

    // Rocks along the shore and on the island.
    for (const [x, z, s] of [[-3, 8, 4.5], [3, -8, 3.5], [22, -2, 5], [28, 2, 3], [-8, 14, 2.6], [12, 12, 2.2], [-20, -4, 3]]) {
      this.decor.addRock(x, z, s);
    }
    this.terrain.update();

    const pond = this.water.addPond(-30, -6);
    if (pond.error) console.warn(pond.error);
    // Waterfall from the ledge into the pond; the pond overflows as a stream.
    const wz = this.wall.zAt(-27, 43);
    this.water.addFall(new THREE.Vector3(-27, 43, wz + 0.6), this.wall);
    if (pond.pond) {
      const f = this.terrain.field;
      const n = pond.pond.spillCell;
      const [sx, sz] = f.toWorld(n % f.cols, Math.floor(n / f.cols));
      this.water.addFall(new THREE.Vector3(sx, f.h[n] + 0.2, sz), null);
    }

    // Plants.
    const put = (id, n, test) => {
      for (let k = 0; k < n; k++) {
        const p = this.randomSpot(test, 300, r);
        if (p) this.plants.add(id, p, { normal: this.terrain.normalAt(p.x, p.z), grown: 0.7 + r() * 0.3, rot: r() * 6.28 });
      }
    };
    const land = (x, y, z, s) => s === -Infinity && y > L + 1;
    const shore = (x, y, z, s) => Math.abs(y - L) < 1.5;
    const deep = (d) => (x, y, z, s) => s - y > d;
    put('fern', 5, (x, y, z, s) => land(x, y, z, s) && z < 5);
    put('bilberry', 2, land);
    put('grass', 7, (x, y, z, s) => land(x, y, z, s) || shore(x, y, z, s));
    put('cattail', 3, shore);
    put('vallisneria', 7, (x, y, z, s) => deep(6)(x, y, z, s) && z < -4);
    put('sword', 2, deep(4));
    put('javafern', 2, deep(3));
    for (let k = 0; k < 3; k++) {
      const p = this.randomSpot(deep(4), 200, r);
      if (p) this.plants.add('frogbit', p.setY(L), { grown: 0.8 });
    }
    const lp = this.randomSpot(deep(6), 200, r);
    if (lp) this.plants.add('lily', lp.setY(L), { grown: 0.9 });
    // Epiphytes on the background.
    for (const [x, y, id] of [[-33, 47, 'bromeliad'], [-19, 43, 'bromeliad'], [30, 38, 'bromeliad'], [10, 30, 'pothos'], [-5, 40, 'pothos'], [36, 24, 'pothos'], [-40, 30, 'pothos']]) {
      const z = this.wall.zAt(x, y);
      const [gx, gy] = this.wall.field.gradient(x, y);
      this.plants.add(id, new THREE.Vector3(x, y, z + 0.2), { surface: 'wall', normal: new THREE.Vector3(-gx, -gy, 1).normalize(), grown: 0.85 });
    }

    // Animals.
    const add = (id, n, test) => {
      for (let k = 0; k < n; k++) {
        const p = this.randomSpot(test, 300, r);
        if (!p) continue;
        const pl = this.animals.placement(id, { point: p });
        if (pl.pos) this.animals.add(id, pl.pos, { age: (SPECIES[id].adultDays ?? 10) * 1440 * (1 + r()) });
      }
    };
    add('neon', 10, deep(5));
    add('cory', 4, deep(4));
    add('guppy', 4, deep(5));
    add('shrimp', 12, deep(2));
    add('dartfrog', 2, land);
    add('toad', 1, shore);
    add('isopod', 16, land);
    add('springtail', 40, land);
    add('fly', 18, land);
    add('crab', 2, shore);

    this.env.cycle = 0.8;
    this.env.nitrate = 8;
    this.updateMoss();
    this.decor.scatterMoss();
    this.log('Welcome! This starter paludarium is already planted and stocked.');
  }

  // --- Save / load -------------------------------------------------------
  serialize() {
    const E = this.env;
    return {
      app: 'paludarium', v: 1,
      terrain: this.terrain.field.serialize(),
      wall: this.wall.field.serialize(),
      water: this.water.serialize(),
      rocks: this.decor.serialize(),
      plants: this.plants.serialize(),
      animals: this.animals.serialize(),
      env: {
        minute: E.minute, temp: E.temp, humidity: E.humidity, ammonia: E.ammonia, nitrite: E.nitrite, nitrate: E.nitrate,
        oxygen: E.oxygen, cycle: E.cycle, detritus: E.detritus, biofilm: E.biofilm, lights: E.lights, heater: E.heater,
        setpoint: E.setpoint, lid: E.lid, filter: E.filter, room: E.room, autoFeed: E.autoFeed, lastFed: E.lastFed,
      },
    };
  }

  load(o) {
    if (!o || o.app !== 'paludarium') throw new Error('Not a Paludarium save.');
    this.clearAll();
    this.terrain.field.deserialize(o.terrain);
    this.wall.field.deserialize(o.wall);
    // Rocks were stamped into the saved heightfield already; just redraw them.
    for (const r of o.rocks ?? []) this.decor.rocks.push({ x: r.x, y: r.y, z: r.z, sx: r.sx, sy: r.sy, sz: r.sz, rot: r.rot, variant: r.v, saved: [] });
    this.decor.drawRocks();
    this.terrain.update();
    this.wall.update();
    this.water.setLevel(o.water.level);
    for (const [x, z] of o.water.ponds) this.water.addPond(x, z);
    for (const s of o.water.falls) this.water.addFall(new THREE.Vector3(...s), this.wall);
    for (const p of o.plants) {
      if (!PLANTS[p.id]) continue;
      this.plants.add(p.id, new THREE.Vector3(...p.pos), { normal: new THREE.Vector3(...p.n), surface: p.s, rot: p.r, scale: p.sc, grown: p.g, health: p.h });
    }
    for (const a of o.animals) {
      if (!SPECIES[a.sp]) continue;
      this.animals.add(a.sp, new THREE.Vector3(...a.p), { hunger: a.h, health: a.hp, age: a.age });
    }
    Object.assign(this.env, o.env);
    this.updateMoss();
    this.decor.scatterMoss();
    this.log('Tank loaded.');
  }
}

export { lerp };
