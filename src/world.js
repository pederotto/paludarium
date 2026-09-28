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
    this.fx?.updateTerrain();
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
    this.wall.field.setMaterial(MAT.stone);
    this.water.setLevel(0);
    this.groundChanged();
    this.log('Empty tank. Sculpt some ground, then add water.');
  }

  async init() {
    await Promise.all([this.decor.preload(), this.plants.preload()]);
  }

  // A layout after classic waterfall paludariums: tall mossy stone and a cliff
  // face across the back, a waterfall down the middle into a clear, sandy
  // lagoon, an upper pool on the right that spills over, roots hanging into
  // the water, ferns and moss on every ledge.
  starter() {
    this.clearAll();
    const r = rng(2024);
    const T = this.terrain.field;
    const L = 16;
    for (let j = 0; j <= T.ny; j++) for (let i = 0; i <= T.nx; i++) {
      const [x, z] = T.toWorld(i, j);
      const n = T.idx(i, j);
      // Banks rise toward the back on both sides; the lagoon fills the front
      // and reaches back in the middle, under the waterfall.
      const back = smooth(4, -20, z);
      const sides = smooth(8, 30, Math.abs(x + 4));
      const bank = Math.max(back * (0.55 + 0.45 * sides), sides * smooth(14, -6, z) * 0.9);
      const noise = Math.sin(x * 0.31 + z * 0.17) * 0.7 + Math.sin(x * 0.13 - z * 0.37) * 0.9;
      let h = 4 + (1 - back) * smooth(22, 5, z) * 1.2 + bank * 22 + noise * (0.3 + bank);
      // Hollow for the upper pool on the right plateau.
      const hollow = Math.max(0, 1 - Math.hypot((x - 30) / 6, (z + 9) / 4.5));
      h -= hollow * hollow * 6;
      T.h[n] = Math.max(1, h);
      const m = new Float32Array(NMAT);
      if (h < L - 0.6) m[MAT.sand] = 1;
      else if (h < L + 1.2) { m[MAT.gravel] = 0.6; m[MAT.soil] = 0.4; }
      else {
        m[MAT.soil] = 1;
        const mossy = Math.sin(x * 0.23 + 1) * Math.sin(z * 0.29) + r() * 0.4;
        if (mossy > -0.1) { m.fill(0); m[MAT.moss] = 1; }
      }
      T.mat.set(m, n * NMAT);
    }
    T.dirty = true;

    // Background: dark stone with bulges, mossy higher up.
    const Wf = this.wall.field;
    for (let j = 0; j <= Wf.ny; j++) for (let i = 0; i <= Wf.nx; i++) {
      const [x, y] = Wf.toWorld(i, j);
      const n = Wf.idx(i, j);
      const bumps = 2.5 + Math.sin(x * 0.21 + y * 0.13) * 1.4 + Math.sin(x * 0.07 - y * 0.29) * 1.8 + Math.abs(Math.sin(y * 0.35 + x * 0.05)) * 1.2;
      Wf.h[n] = clamp(bumps, 0.4, Wf.maxH);
      const m = new Float32Array(NMAT);
      const mossy = Math.sin(x * 0.17 + y * 0.09) + Math.sin(y * 0.21 - x * 0.05);
      if (mossy > 0.6 && y > L + 4) m[MAT.moss] = 1;
      else m[MAT.stone] = 1;
      Wf.mat.set(m, n * NMAT);
    }
    Wf.dirty = true;
    this.terrain.update();
    this.wall.update();
    this.water.setLevel(L);

    // Hardscape. Spires frame the waterfall; the cliff face sits behind it.
    const D = this.decor;
    D.addPiece('cliff', -3, -16, { size: 30, rot: 0, variant: 0, scale: [1, 1.5, 0.8], sink: 0.05 });
    const spires = [[-15, -15, 46, 0.62], [-27, -13, 38, 0.7], [-38, -16, 30, 0.8], [10, -16, 44, 0.6], [21, -14, 34, 0.7], [37, -17, 40, 0.75], [-33, -4, 18, 0.9], [30, -3, 16, 1]];
    spires.forEach(([x, z, h, w], i) => D.addPiece('spire', x, z, { size: h, variant: i % 5, rot: r() * 6.28, scale: [w, 1, w * 0.85], tilt: [(r() - 0.5) * 0.12, (r() - 0.5) * 0.12] }));
    const boulders = [[-8, 2, 9], [4, -3, 7], [-20, 5, 8], [16, 4, 8], [26, 9, 6], [-30, 10, 7], [-4, 12, 4], [10, 14, 3.5], [36, 12, 5], [-40, 4, 6]];
    boulders.forEach(([x, z, s], i) => D.addPiece('boulder', x, z, { size: s, variant: i * 3 + 1, sink: 0.25 }));
    D.addPiece('roots', -24, 3, { size: 16, rot: 0.6, sink: 0.3 });
    D.addPiece('wood', 18, 0, { size: 34, rot: 2.3, tilt: [0.35, 0.1], y: L + 2 });
    D.addPiece('stump', -36, -8, { size: 12 });
    this.terrain.update();

    // Upper pool on the right; the central waterfall pours off the cliff top,
    // and the pool overflows down the rocks.
    const pond = this.water.addPond(30, -9);
    if (pond.error) console.warn(pond.error);
    // Source on the front lip of the cliff, so it pours down the face toward you.
    let lipZ = -13;
    for (let z = 4; z > -20; z -= 0.5) if (this.terrain.heightAt(-3, z) > L + 10) { lipZ = z - 0.8; break; }
    this.water.addFall(new THREE.Vector3(-3, this.terrain.heightAt(-3, lipZ) + 0.3, lipZ), null);
    if (pond.pond) {
      const f = this.terrain.field;
      const n = pond.pond.spillCell;
      const [sx, sz] = f.toWorld(n % f.cols, Math.floor(n / f.cols));
      this.water.addFall(new THREE.Vector3(sx, f.h[n] + 0.2, sz), null);
    }

    // Plants.
    const put = (id, n, test, opt = {}) => {
      for (let k = 0; k < n; k++) {
        const p = this.randomSpot(test, 400, r);
        if (p) this.plants.add(id, p, { normal: this.terrain.normalAt(p.x, p.z), grown: 0.75 + r() * 0.25, rot: r() * 6.28, ...opt });
      }
    };
    const land = (x, y, z, s) => s === -Infinity && y > L + 1.5;
    const ledge = (x, y, z, s) => land(x, y, z, s) && y > L + 6 && this.terrain.normalAt(x, z).y > 0.75;
    const shore = (x, y, z, s) => Math.abs(y - L) < 1.2;
    const deep = (d) => (x, y, z, s) => s - y > d;
    put('fernph', 7, ledge);
    put('fern', 4, land);
    put('weed', 5, ledge);
    put('bilberry', 2, ledge);
    put('grass', 8, (x, y, z, s) => shore(x, y, z, s) || (land(x, y, z, s) && y < L + 5));
    put('cattail', 2, shore);
    put('vallisneria', 9, (x, y, z, s) => deep(7)(x, y, z, s) && z < 4);
    put('sword', 2, deep(5));
    put('javafern', 3, deep(3));
    for (let k = 0; k < 3; k++) {
      const p = this.randomSpot(deep(4), 200, r);
      if (p) this.plants.add('frogbit', p.setY(L), { grown: 0.8 });
    }
    // Epiphytes on the background.
    for (const [x, y, id] of [[-40, 48, 'bromeliad'], [42, 50, 'bromeliad'], [-8, 53, 'bromeliad'], [26, 47, 'bromeliad']]) {
      const z = this.wall.zAt(x, y);
      const [gx, gy] = this.wall.field.gradient(x, y);
      this.plants.add(id, new THREE.Vector3(x, y, z + 0.2), { surface: 'wall', normal: new THREE.Vector3(-gx, -gy, 1).normalize(), grown: 0.85 });
    }

    // Animals.
    const add = (id, n, test) => {
      for (let k = 0; k < n; k++) {
        const p = this.randomSpot(test, 400, r);
        if (!p) continue;
        const pl = this.animals.placement(id, { point: p });
        if (pl.pos) this.animals.add(id, pl.pos, { age: (SPECIES[id].adultDays ?? 10) * 1440 * (1 + r()) });
      }
    };
    add('neon', 12, deep(6));
    add('cory', 4, deep(4));
    add('shrimp', 12, deep(2));
    add('dartfrog', 2, land);
    add('isopod', 16, land);
    add('springtail', 40, land);
    add('fly', 14, land);
    if (SPECIES.newt) add('newt', 2, shore);
    if (SPECIES.gecko) add('gecko', 2, land);

    this.env.cycle = 0.8;
    this.env.nitrate = 8;
    this.env.humidity = 85;
    this.updateMoss();
    this.decor.scatterMoss();
    this.fx?.updateTerrain();
    this.log('Welcome! This starter paludarium is already planted and stocked.');
  }

  // --- Save / load -------------------------------------------------------
  serialize() {
    const E = this.env;
    return {
      app: 'paludarium', v: 2,
      terrain: this.terrain.field.serialize(),
      wall: this.wall.field.serialize(),
      water: this.water.serialize(),
      pieces: this.decor.serialize(),
      plants: this.plants.serialize(),
      animals: this.animals.serialize(),
      env: {
        minute: E.minute, temp: E.temp, humidity: E.humidity, ammonia: E.ammonia, nitrite: E.nitrite, nitrate: E.nitrate,
        oxygen: E.oxygen, cycle: E.cycle, detritus: E.detritus, biofilm: E.biofilm, lights: E.lights, heater: E.heater,
        setpoint: E.setpoint, lid: E.lid, filter: E.filter, room: E.room, autoFeed: E.autoFeed, lastFed: E.lastFed, culture: E.culture, lastCulture: E.lastCulture,
      },
    };
  }

  load(o) {
    if (!o || o.app !== 'paludarium') throw new Error('Not a Paludarium save.');
    this.clearAll();
    this.terrain.field.deserialize(o.terrain);
    this.wall.field.deserialize(o.wall);
    // Hardscape was stamped into the saved heightfield already.
    this.decor.restore(o.pieces ?? []);
    this.terrain.update();
    this.wall.update();
    this.water.setLevel(o.water.level);
    for (const [x, z] of o.water.ponds) this.water.addPond(x, z);
    for (const s of o.water.falls) this.water.addFall(new THREE.Vector3(...s), this.wall);
    for (const p of o.plants) {
      if (!PLANTS[p.id]) continue;
      this.plants.add(p.id, new THREE.Vector3(...p.pos), { normal: new THREE.Vector3(...p.n), surface: p.s, rot: p.r, scale: p.sc, grown: p.g, health: p.h, variant: p.v });
    }
    for (const a of o.animals) {
      if (!SPECIES[a.sp]) continue;
      const n = this.animals.add(a.sp, new THREE.Vector3(...a.p), { hunger: a.h, health: a.hp, age: a.age });
      if (n && a.x) Object.assign(n, a.x);
      if (n?.onWall) { n.wallMode = true; n.normal = new THREE.Vector3(0, 0, 1); }
    }
    Object.assign(this.env, o.env);
    this.fx?.updateTerrain();
    this.updateMoss();
    this.decor.scatterMoss();
    this.log('Tank loaded.');
  }
}

export { lerp };
