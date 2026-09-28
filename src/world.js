// Ties the tank together: substrate, background, water, rocks, plants,
// animals and the environment. Also builds the starter layout, keeps the
// undo history and handles saving and loading.

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
    this.water = new Water(scene, this);
    this.decor = new Decor(scene, this);
    this.plants = new Plants(scene);
    this.animals = new Animals(scene, this);
    this.sim = new Sim(this);
    this.undoStack = [];
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

  // Call after the ground, the wall or the hardscape changed shape.
  // `quick` skips the slower refreshes (while dragging a rock).
  groundChanged({ quick = false } = {}) {
    this.terrain.compose(this.decor.stamps());
    this.terrain.update();
    this.wall.update();
    this.water.groundChanged();
    this.fx?.updateTerrain();
    if (quick) return;
    // Re-seat plants on the new ground.
    for (const p of this.plants.list) {
      if (p.surface === 'terrain' && PLANTS[p.id].habitat !== 'floating') {
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

  // --- Undo ------------------------------------------------------------------
  // Snapshots of everything you shape: ground, background, hardscape, pump
  // and outlets. Water, plants and animals carry on as they are.
  pushUndo() {
    this.undoStack.push({
      terrain: this.terrain.field.snapshot(),
      wall: this.wall.field.snapshot(),
      pieces: this.decor.serialize(),
      outlets: this.water.outlets.map((o) => ({ pos: o.pos.clone(), wall: o.wall })),
      intake: this.water.hydro.pump.intake ? { ...this.water.hydro.pump.intake } : null,
    });
    if (this.undoStack.length > 30) this.undoStack.shift();
  }

  undo() {
    const s = this.undoStack.pop();
    if (!s) return false;
    this.terrain.field.restoreSnapshot(s.terrain);
    this.wall.field.restoreSnapshot(s.wall);
    this.decor.clear();
    this.decor.restore(s.pieces);
    const H = this.water.hydro;
    H.outlets = [];
    H.pump.intake = s.intake;
    for (const o of s.outlets) H.addOutlet(o.pos, o.wall);
    this.groundChanged();
    this.water.updateMarkers();
    return true;
  }

  clearAll() {
    this.plants.clear();
    this.animals.clear();
    this.decor.clear();
    this.water.clear();
    this.env.reset();
    this.logs.length = 0;
    this.undoStack.length = 0;
  }

  // --- Layouts -----------------------------------------------------------
  // A new, empty tank: a flat layer of substrate over the glass, dark
  // stone on the back, no water, and nothing living yet.
  empty() {
    this.clearAll();
    this.terrain.field.base.fill(3);
    this.terrain.field.setMaterial(MAT.soil);
    this.wall.field.h.fill(0.6);
    this.wall.field.setMaterial(MAT.stone);
    this.wall.field.dirty = true;
    this.groundChanged();
    this.water.setLevel(0);
    this.env.newTank();
    this.log('New tank. Sculpt the ground, add hardscape, fill it with water and place the pump outlets. Then plant it and let it settle before adding animals.');
  }

  async init() {
    await Promise.all([this.decor.preload(), this.plants.preload()]);
  }

  // A layout that shows the water system: a pump in the lagoon lifts water
  // to a pool on top of the rock massif on the left; it spills through a
  // notch, pours down the cliff into a middle pool, and a stream winds from
  // there down to the lagoon. On the right a spring runs down the background
  // into a small pool that overflows into a second stream.
  starter() {
    this.clearAll();
    const r = rng(2024);
    const T = this.terrain;
    const B = T.field.base;
    const L = 12;
    for (let j = 0; j <= T.field.ny; j++) for (let i = 0; i <= T.field.nx; i++) {
      const [x, z] = T.field.toWorld(i, j);
      const n = T.field.idx(i, j);
      // A bank rises to a shelf along the back; the lagoon fills the front.
      const back = smooth(0, -9, z);
      const sides = smooth(24, 42, Math.abs(x));
      let h = 3 + back * 15 + sides * smooth(14, -4, z) * 10;
      // The massif: a steep-sided block at the back left.
      const mx = smooth(-6.5, -10.5, x), mz = smooth(-6, -10.5, z);
      h += mx * mz * 17;
      // A raised shelf at the back right for the spring pool.
      h += smooth(18, 26, x) * smooth(-6, -12, z) * 5;
      h += Math.sin(x * 0.31 + z * 0.17) * 0.6 + Math.sin(x * 0.13 - z * 0.37) * 0.8;
      B[n] = Math.max(1, h);
    }
    // Waterways, built with the same tools you use.
    T.digBasin(-26, -15.5, 5.5, 3);                               // top pool
    T.carveChannel([V(-21.5, -14), V(-15, -13), V(-8.5, -12.5)], 1.8, 0.6); // notch to the lip
    T.digBasin(-3, -13, 4.8, 3);                                  // middle pool under the fall
    T.carveChannel([V(-0.5, -9.2), V(3, -7), V(2, -4.5), V(5, -2), V(8, 1)], 2.2, 0.9);
    T.digBasin(32, -15.5, 4.5, 2.2);                              // spring pool
    T.carveChannel([V(30, -12.5), V(27, -9), V(22, -6), V(18, -2), V(14, 2)], 2, 0.9);
    // Materials from shape: steep faces are stone, high ground soil and
    // moss, the shore gravel, the lagoon sand.
    T.compose([]);
    const f = T.field;
    for (let j = 0; j <= f.ny; j++) for (let i = 0; i <= f.nx; i++) {
      const n = f.idx(i, j);
      const [x, z] = f.toWorld(i, j);
      const h = f.base[n];
      const steep = T.normalAt(x, z).y < 0.62;
      const sandy = f.mat[n * NMAT + MAT.sand];
      const m = new Float32Array(NMAT);
      if (steep && h > L) m[MAT.stone] = 1;
      else if (h < L - 0.6) m[MAT.sand] = 1;
      else if (h < L + 1.2) { m[MAT.gravel] = 0.6; m[MAT.soil] = 0.4; }
      else {
        m[MAT.soil] = 1;
        const mossy = Math.sin(x * 0.23 + 1) * Math.sin(z * 0.29) + r() * 0.5;
        if (mossy > -0.2) { m.fill(0); m[MAT.moss] = 1; }
      }
      // Keep the pebbles the channels laid in their beds.
      if (sandy > 0.3 && h >= L - 0.6) { for (let k = 0; k < NMAT; k++) m[k] *= 1 - sandy; m[MAT.sand] += sandy; }
      f.mat.set(m, n * NMAT);
    }
    // Background: dark stone with bulges, mossy higher up.
    const Wf = this.wall.field;
    for (let j = 0; j <= Wf.ny; j++) for (let i = 0; i <= Wf.nx; i++) {
      const [x, y] = Wf.toWorld(i, j);
      const n = Wf.idx(i, j);
      const bumps = 2.5 + Math.sin(x * 0.21 + y * 0.13) * 1.4 + Math.sin(x * 0.07 - y * 0.29) * 1.8 + Math.abs(Math.sin(y * 0.35 + x * 0.05)) * 1.2;
      Wf.h[n] = clamp(bumps, 0.4, Wf.maxH);
      const m = new Float32Array(NMAT);
      const mossy = Math.sin(x * 0.17 + y * 0.09) + Math.sin(y * 0.21 - x * 0.05);
      if (mossy > 0.5 && y > L + 4) m[MAT.moss] = 1;
      else m[MAT.stone] = 1;
      Wf.mat.set(m, n * NMAT);
    }
    Wf.dirty = true;

    // Hardscape frames the water without blocking it.
    const D = this.decor;
    const spires = [[-40, -17, 44, 0.6], [-27, -21, 30, 0.45], [-14, -20.5, 36, 0.42], [10, -18, 38, 0.55], [20, -19.5, 44, 0.5], [41, -18, 40, 0.6], [-40, 0, 16, 0.9]];
    // Spires stay below the lid.
    spires.forEach(([x, z, h, w], i) => D.addPiece('spire', x, z, { size: Math.min(h, (TANK.h - 3 - T.heightAt(x, z)) / 0.9), variant: i % 5, rot: r() * 6.28, scale: [w, 1, w * 0.85], tilt: [(r() - 0.5) * 0.1, (r() - 0.5) * 0.1], sink: 0.1 }));
    const boulders = [[-9, 4, 8], [-17, 7, 6], [9, -1, 6], [24, 6, 7], [30, 10, 5], [-28, 9, 7], [-4, 13, 4], [11, 14, 3.5], [38, 3, 6], [-33, -5, 7], [5, -8, 4]];
    boulders.forEach(([x, z, s], i) => D.addPiece('boulder', x, z, { size: s, variant: i * 3 + 1, sink: 0.25 }));
    D.addPiece('roots', -26, 1, { size: 16, rot: 0.6, y: L - 3 });
    D.addPiece('wood', 28, 12, { size: 30, rot: 2.3, tilt: [0.3, 0.1], y: L + 1.2 });
    D.addPiece('stump', 38, -7, { size: 10 });
    this.groundChanged({ quick: true });

    // Water: fill the tank, put the pump in the lagoon, one outlet in the
    // top pool and one spring on the background, then fill the pools.
    this.water.setPump(8, 12);
    this.water.setLevel(L);
    this.water.addOutlet(new THREE.Vector3(-28, T.heightAt(-28, -16) + 0.2, -16), false);
    const sx = 33, sy = 42;
    this.water.addOutlet(new THREE.Vector3(sx, sy, this.wall.zAt(sx, sy) + 0.6), true);
    this.water.hydro.prime();
    // Let the water settle into its channels.
    for (let k = 0; k < 90; k++) this.water.hydro.step(1 / 30);
    this.water.hydro.targetTotal = this.water.hydro.total();
    this.water.syncLevel();
    this.water.syncFalls(true);

    // Plants.
    const put = (id, n, test, opt = {}) => {
      for (let k = 0; k < n; k++) {
        const p = this.randomSpot(test, 400, r);
        if (p) this.plants.add(id, p, { normal: T.normalAt(p.x, p.z), grown: 0.75 + r() * 0.25, rot: r() * 6.28, ...opt });
      }
    };
    const dry = (x, y, z, s) => s === -Infinity && !this.water.nearestFall(new THREE.Vector3(x, y, z), 2);
    const land = (x, y, z, s) => dry(x, y, z, s) && y > L + 1.5 && !T.field.stamped[this.water.hydro.cellOf(x, z)];
    const ledge = (x, y, z, s) => land(x, y, z, s) && y > L + 5 && T.normalAt(x, z).y > 0.75;
    const shore = (x, y, z, s) => Math.abs(y - L) < 1.2 && this.water.inMainPool(x, z);
    const deep = (d) => (x, y, z, s) => this.water.inMainPool(x, z) && s - y > d;
    const bank = (x, y, z, s) => land(x, y, z, s) && this.nearWater(new THREE.Vector3(x, y, z), 2.5);
    put('fernph', 7, ledge);
    put('fern', 4, land);
    put('weed', 5, ledge);
    put('bilberry', 2, ledge);
    put('grass', 6, bank);
    put('grass', 4, (x, y, z, s) => shore(x, y, z, s) || (land(x, y, z, s) && y < L + 5));
    put('cattail', 2, shore);
    put('vallisneria', 9, (x, y, z, s) => deep(7)(x, y, z, s) && z < 6);
    put('sword', 2, deep(5));
    put('javafern', 3, deep(3));
    for (let k = 0; k < 3; k++) {
      const p = this.randomSpot(deep(4), 200, r);
      if (p) this.plants.add('frogbit', p.setY(this.water.level), { grown: 0.8 });
    }
    // Epiphytes on the background, clear of the spring.
    for (const [x, y, id] of [[-40, 48, 'bromeliad'], [-8, 53, 'bromeliad'], [16, 47, 'bromeliad'], [-22, 44, 'pothos']]) {
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
    add('strawberry', 2, land);
    add('isopod', 16, land);
    add('springtail', 40, land);
    add('fly', 14, land);
    add('newt', 2, shore);
    add('gecko', 2, land);

    this.env.matureTank();
    this.updateMoss();
    this.decor.scatterMoss();
    this.fx?.updateTerrain();
    this.log('Welcome! This starter paludarium is planted and stocked. The pump lifts water to the top pool; follow it down the waterfall and the streams.');
  }

  // --- Save / load -------------------------------------------------------
  serialize() {
    return {
      app: 'paludarium', v: 3,
      terrain: this.terrain.field.serialize(),
      wall: this.wall.field.serialize(),
      water: this.water.serialize(),
      pieces: this.decor.serialize(),
      plants: this.plants.serialize(),
      animals: this.animals.serialize(),
      env: this.env.serialize(),
    };
  }

  load(o) {
    if (!o || o.app !== 'paludarium') throw new Error('Not a Paludarium save.');
    this.clearAll();
    this.terrain.field.deserialize(o.terrain);
    this.wall.field.deserialize(o.wall);
    // Version 2 saved the ground with the rocks already stamped in; that
    // simply becomes the base, and stamping again changes nothing.
    this.decor.restore(o.pieces ?? []);
    this.groundChanged({ quick: true });
    this.water.load(o.water);
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
    this.env.load(o.env);
    this.fx?.updateTerrain();
    this.updateMoss();
    this.decor.scatterMoss();
    this.log('Tank loaded.');
  }
}

function V(x, z) { return new THREE.Vector3(x, 0, z); }

export { lerp };
