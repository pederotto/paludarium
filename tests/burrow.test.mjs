// Crab burrows (src/sim/burrow.js): digging moves soil and never makes or loses any, stays off hardscape and rock, keeps a
// floor, leaves a pit with a heap beside it, and its walls slump more in sand than in soil.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAT, NMAT, TANK, TERRAIN_RES } from '../src/sim/tank.js';
import { BURROW, digRate, pitDepth, burrowSpot, excavate } from '../src/sim/burrow.js';
import { slumpPass } from '../src/sim/support.js';
import { CRAB, crabMind, crabThink } from '../src/sim/crab.js';

// The terrain Field's arithmetic (sim/terrain.js, which pulls in the renderer, so it is not imported under Node).
class Field {
  constructor(nx, ny, sizeA, sizeB, oa, ob, maxH) {
    Object.assign(this, { nx, ny, cols: nx + 1, rows: ny + 1, oa, ob, maxH, da: sizeA / nx, db: sizeB / ny });
    this.h = this.base = new Float32Array(this.cols * this.rows);
    this.stamped = new Uint8Array(this.cols * this.rows);
    this.mat = new Float32Array(this.cols * this.rows * NMAT);
  }
  toGrid(a, b) { return [(a - this.oa) / this.da, (b - this.ob) / this.db]; }
  toWorld(i, j) { return [this.oa + i * this.da, this.ob + j * this.db]; }
  sample(a, b, arr = this.h) {
    let [fi, fj] = this.toGrid(a, b);
    fi = Math.min(Math.max(fi, 0), this.nx - 1e-4); fj = Math.min(Math.max(fj, 0), this.ny - 1e-4);
    const i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j, c = this.cols;
    return (arr[j * c + i] * (1 - u) + arr[j * c + i + 1] * u) * (1 - v) + (arr[(j + 1) * c + i] * (1 - u) + arr[(j + 1) * c + i + 1] * u) * v;
  }
  gradient(a, b) { const e = this.da; return [(this.sample(a + e, b) - this.sample(a - e, b)) / (2 * e), (this.sample(a, b + e) - this.sample(a, b - e)) / (2 * e)]; }
}
function ground(mat = MAT.soil, h = 4) {
  const f = new Field(TERRAIN_RES.nx, TERRAIN_RES.nz, TANK.w, TANK.d, -TANK.w / 2, -TANK.d / 2, 52);
  f.base.fill(h);
  for (let n = 0; n < f.cols * f.rows; n++) f.mat[n * NMAT + mat] = 1;
  return f;
}
const total = (f) => f.base.reduce((s, v) => s + v, 0) * f.da * f.db;

test('a load moves soil from the pit to the heap: volume is conserved', () => {
  const f = ground();
  const v0 = total(f);
  let moved = 0;
  for (let i = 0; i < 20; i++) moved += excavate(f, 0, 0, { dir: { x: 0, z: 1 }, bottom: 4 - BURROW.depth }).moved;
  assert.ok(moved > 3, `moved ${moved.toFixed(2)} cm3`);
  assert.ok(Math.abs(total(f) - v0) < 1e-3, `volume drift ${(total(f) - v0).toExponential(2)}`);
  assert.ok(pitDepth(f, 0, 0) > 0.8, `pit ${pitDepth(f, 0, 0).toFixed(2)} cm deep`);
  // The heap is on the mouth side and higher than the ground round it; the far side is untouched.
  assert.ok(f.sample(0, BURROW.spoil, f.base) > 4.2, 'heap beside the mouth');
  assert.ok(Math.abs(f.sample(0, -BURROW.spoil - 1, f.base) - 4) < 1e-6, 'nothing behind the burrow');
});

test('the pit stops at the depth it was dug to and never goes below the floor', () => {
  const f = ground(MAT.soil, 4);
  for (let i = 0; i < 200; i++) excavate(f, 0, 0, { dir: { x: 1, z: 0 }, bottom: 4 - 1.3 });
  assert.ok(f.sample(0, 0, f.base) >= 4 - 1.3 - 1e-4, 'not deeper than asked');
  const g = ground(MAT.soil, 1.2);
  for (let i = 0; i < 200; i++) excavate(g, 0, 0, { dir: { x: 1, z: 0 }, bottom: -5 });
  assert.ok(Math.min(...g.base) >= BURROW.floor - 1e-4, 'the floor holds');
});

test('rock, hardscape and root mats resist; gravel and moss are slow', () => {
  const soil = ground(MAT.soil), rock = ground(MAT.rock), gravel = ground(MAT.gravel), moss = ground(MAT.moss);
  assert.equal(digRate(soil, 0, 0), 1);
  assert.equal(digRate(rock, 0, 0), 0);
  assert.ok(digRate(gravel, 0, 0) < 0.4 && digRate(moss, 0, 0) < 0.5);
  assert.equal(burrowSpot(rock, 0, 0), null);
  assert.equal(excavate(rock, 0, 0, { bottom: 0 }).moved, 0);
  const stamped = ground();
  const [ci, cj] = stamped.toGrid(0, 0);
  stamped.stamped[Math.round(cj) * stamped.cols + Math.round(ci)] = 1;
  assert.equal(digRate(stamped, 0, 0), 0, 'under a piece');
  const root = new Float32Array(soil.cols * soil.rows).fill(1);
  assert.ok(digRate(soil, 0, 0, root) < 0.3, 'a root mat holds the ground');
});

test('the spoil goes away from a stone at the edge (it digs in under it)', () => {
  const f = ground();
  // A stone 2 cm to the -x side of the burrow.
  for (let n = 0; n < f.cols * f.rows; n++) { const i = n % f.cols, [x, z] = f.toWorld(i, Math.floor(n / f.cols)); if (Math.hypot(x + 2.5, z) < 1.5) f.stamped[n] = 1; }
  const s = burrowSpot(f, 0, 0);
  assert.ok(s && s.dir.x > 0.8, `mouth points away from the stone: ${JSON.stringify(s?.dir)}`);
});

test('the pit walls slump more in sand than in soil, and a soil pit stands', () => {
  const dz = new Float32Array(121 * 61), ret = new Float32Array(121 * 61);
  const pit = (mat) => {
    const f = ground(mat);
    for (let i = 0; i < 40; i++) excavate(f, 0, 0, { dir: { x: 0, z: 1 }, bottom: 4 - BURROW.depth });
    const d0 = pitDepth(f, 0, 0);
    for (let i = 0; i < 60; i++) slumpPass(f, ret, 1, dz);
    return [d0, pitDepth(f, 0, 0)];
  };
  const [s0, s1] = pit(MAT.sand), [o0, o1] = pit(MAT.soil);
  assert.ok(o0 > 1 && o1 > o0 * 0.9, `soil stands: ${o0.toFixed(2)} -> ${o1.toFixed(2)}`);
  assert.ok(s0 - s1 > o0 - o1, `sand loses more: ${s0.toFixed(2)} -> ${s1.toFixed(2)}`);
});

// The brain: a crab that should hide and has a shallow burrow at home digs it out load by load.
const seq = (seed = 1) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
test('a crab digs its burrow before hiding: scrape, carry, drop, back', () => {
  const f = ground();
  const m = crabMind(seq(2));
  const home = { x: 0, z: 0 }, spoil = { x: 0, z: BURROW.spoil };
  let x = 0, z = 0, loads = 0;
  const modes = new Set(), phases = new Set();
  for (let t = 0; t < 300 && pitDepth(f, 0, 0) < BURROW.depth - 0.05; t += 0.1) {
    const s = { t, dt: 0.1, dtMin: 0.1, x, z, depth: -1, wetGround: 1, light: 1, rain: 0, rh: 95, temp: 26, cover: 0, hunger: 0, home, shore: null, male: false,
      burrow: { depth: pitDepth(f, 0, 0), want: BURROW.depth, wantMolt: BURROW.depth + 0.4, room: 3, rate: 1, spoil } };
    const it = crabThink(m, s, seq(Math.floor(t * 10) + 7));
    modes.add(it.mode); if (m.dig) phases.add(m.dig.ph);
    if (it.goal && it.speed > 0) { const dx = it.goal.x - x, dz = it.goal.z - z, d = Math.hypot(dx, dz); if (d > 1e-6) { const st = Math.min(d, it.speed * 0.1); x += dx / d * st; z += dz / d * st; } }
    if (it.dig) { loads++; excavate(f, 0, 0, { dir: { x: 0, z: 1 }, bottom: 4 - BURROW.depth }); }
  }
  assert.ok(modes.has('dig'), [...modes].join());
  for (const p of ['scrape', 'carry', 'dump', 'back']) assert.ok(phases.has(p), `phase ${p}`);
  assert.ok(loads >= 5, `${loads} loads`);
  assert.ok(pitDepth(f, 0, 0) >= BURROW.depth - 0.05, `dug to ${pitDepth(f, 0, 0).toFixed(2)} cm`);
});

test('no digging on rock, in water, or while soft after a molt; a spot that keeps filling in is given up', () => {
  const s = (o = {}) => ({ t: 0, dt: 0.1, dtMin: 0.1, x: 0, z: 0, depth: -1, wetGround: 1, light: 1, rh: 95, temp: 26, home: { x: 0, z: 0 }, burrow: { depth: 0, want: 1.3, room: 3, rate: 1, spoil: { x: 0, z: 2.9 } }, ...o });
  assert.equal(crabThink(crabMind(seq(1)), s(), seq(2)).mode, 'dig');
  assert.notEqual(crabThink(crabMind(seq(1)), s({ burrow: null }), seq(2)).mode, 'dig');
  assert.notEqual(crabThink(crabMind(seq(1)), s({ depth: 0.5 }), seq(2)).mode, 'dig');
  const soft = crabMind(seq(1)); soft.soft = 100;
  assert.notEqual(crabThink(soft, s(), seq(2)).mode, 'dig');
  // Sand running back in: the pit never deepens, so after CRAB.digStall loads it gives the spot up.
  const m = crabMind(seq(3));
  let bad = false, x = 0, z = 0;
  for (let t = 0; t < 600 && !bad; t += 0.1) {
    const it = crabThink(m, s({ t, x, z }), seq(Math.floor(t * 10) + 1));
    if (it.goal && it.speed > 0) { const dx = it.goal.x - x, dz = it.goal.z - z, d = Math.hypot(dx, dz); if (d > 1e-6) { const st = Math.min(d, it.speed * 0.1); x += dx / d * st; z += dz / d * st; } }
    bad = it.badHome;
  }
  assert.ok(bad, 'gave the spot up');
  assert.ok(m.digRest > 0);
  assert.notEqual(crabThink(m, s(), seq(5)).mode, 'dig', 'and does not dig there again at once');
});
