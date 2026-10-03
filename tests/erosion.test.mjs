// Erosion, sediment, slumping and the support model, under Node with a bare heightfield.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { Hydro } from '../src/sim/hydro.js';
import { Erosion } from '../src/sim/erosion.js';
import { Jobs } from '../src/sim/jobs.js';
import { slumpPass, retainMap, stressMap, limit } from '../src/sim/support.js';
import { MAT, NMAT } from '../src/sim/tank.js';

const NX = 120, NY = 60, W = 90, D = 45;

class Field {
  constructor() {
    this.nx = NX; this.ny = NY; this.cols = NX + 1; this.rows = NY + 1;
    this.da = W / NX; this.db = D / NY; this.oa = -W / 2; this.ob = -D / 2;
    this.h = new Float32Array(this.cols * this.rows);
    this.base = this.h;
    this.stamped = new Uint8Array(this.cols * this.rows);
    this.mat = new Float32Array(this.cols * this.rows * NMAT);
    this.maxH = 52;
    for (let n = 0; n < this.cols * this.rows; n++) this.mat[n * NMAT + MAT.soil] = 1;
  }
  toGrid(a, b) { return [(a - this.oa) / this.da, (b - this.ob) / this.db]; }
  toWorld(i, j) { return [this.oa + i * this.da, this.ob + j * this.db]; }
  idx(i, j) { return j * this.cols + i; }
}
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Floor at 3, a shelf along the back at 15 with a pond bowl and a notch in its lip, a ramp down to the floor.
function makeWorld(matAt = null) {
  const f = new Field();
  for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) {
    const [x, z] = f.toWorld(i, j);
    let h = 3 + smooth(-2, -9, z) * 12;
    const r = Math.hypot(x + 26, z + 15);
    h -= (1 - smooth(0, 6, r)) * 5.5;
    h -= (1 - smooth(0, 2.2, Math.hypot(x + 26, z + 9.2))) * 1.5;
    f.h[f.idx(i, j)] = h;
  }
  if (matAt) for (let n = 0; n < f.cols * f.rows; n++) { const k = matAt(n); for (let m = 0; m < NMAT; m++) f.mat[n * NMAT + m] = m === k ? 1 : 0; }
  const world = {
    terrain: { field: f, heightAt: (x, z) => { const [a, b] = f.toGrid(x, z); return f.h[f.idx(Math.max(0, Math.min(NX, Math.round(a))), Math.max(0, Math.min(NY, Math.round(b))))]; } },
    wall: { zAt: () => 0 }, log: () => {}, env: { detritus: 0 }, logs: [],
  };
  const H = new Hydro(world);
  H.pump.intake = { x: 8, z: 12 };
  H.rebuild();
  H.setLevel(10);
  H.addOutlet(new THREE.Vector3(-26, f.h[f.idx(Math.round((-26 + W / 2) / f.da), Math.round((-15 + D / 2) / f.db))] + 0.2, -15), false);
  const E = new Erosion(H);
  return { world, H, f, E };
}
// Runs the circuit and the erosion pass together: hydro seconds `sec`, with `morf` virtual seconds per hydro second.
function run(H, E, sec, morf = 1, dt = 0.05) {
  let acc = 0;
  for (let t = 0; t < sec; t += dt) {
    H.step(dt);
    acc += dt;
    if (acc >= 0.2) { E.run(acc, acc * morf); H.rebuild(true); acc = 0; }
  }
}
const sum = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; };

test('erosion conserves soil volume (bed + suspended) and water mass', () => {
  const { H, E, f } = makeWorld();
  run(H, E, 60);                       // the circuit fills and starts to spill
  const v0 = E.volume(), w0 = H.total();
  const b0 = f.base.slice();
  run(H, E, 120, 40);
  const v1 = E.volume(), w1 = H.total();
  let moved = 0;
  for (let n = 0; n < b0.length; n++) moved += Math.abs(f.base[n] - b0[n]);
  assert.ok(E.stats.eroded > 0.5, `soil was eroded (${E.stats.eroded.toFixed(2)} cm3)`);
  assert.ok(moved * E.area > 0.5, 'the height field really changed');
  assert.ok(Math.abs(v1 - v0) < 1e-4 * v0, `soil volume drift ${(v1 - v0).toFixed(3)} cm3 of ${v0.toFixed(0)}`);
  assert.ok(Math.abs(w1 - w0) < 0.01 * w0, `water ${w1.toFixed(0)} vs ${w0.toFixed(0)} cm3`);
  assert.ok(H.ledger.check.maxImbalance < 5, `ledger imbalance ${H.ledger.check.maxImbalance}`);
});

test('rock and dark stone do not erode, gravel erodes less than sand', () => {
  const eroded = (kind) => {
    const { H, E, f } = makeWorld(() => MAT[kind]);
    run(H, E, 40);
    const e0 = E.stats.eroded;
    run(H, E, 50, 40);
    void f;
    return E.stats.eroded - e0;
  };
  const rock = eroded('rock'), stone = rock, gravel = eroded('gravel'), sand = eroded('sand'), soil = eroded('soil');
  assert.ok(rock < 1e-6 && stone < 1e-6, `rock ${rock} stone ${stone}`);
  assert.ok(gravel < sand * 0.6, `gravel ${gravel.toFixed(2)} vs sand ${sand.toFixed(2)}`);
  assert.ok(soil > 0.3, `soil ${soil.toFixed(2)}`);
});

test('hardscape-stamped cells and root mats resist', () => {
  const { H, E, f } = makeWorld();
  run(H, E, 60);
  // Stamp the whole ramp and see that it stays put.
  const b0 = f.base.slice();
  for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) { const [x, z] = f.toWorld(i, j); if (z > -9 && z < -2) f.stamped[f.idx(i, j)] = 1; }
  run(H, E, 90, 40);
  let lost = 0;
  for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) { const [x, z] = f.toWorld(i, j); const n = f.idx(i, j); if (z > -8 && z < -3) lost += Math.abs(f.base[n] - b0[n]); }
  assert.ok(lost * E.area < 0.5, `stamped ground moved ${(lost * E.area).toFixed(2)} cm3`);
});

test('sediment settles in still water: silt on a pond floor, turbidity falls', () => {
  const { H, E, f } = makeWorld();
  run(H, E, 60);
  const pond = H.pools[0];
  assert.ok(pond, 'a pond');
  const c = pond.cells[(pond.cells.length / 2) | 0];
  const v0 = E.volume(), floor0 = f.base[c];
  E.s[c] += 0.4;                        // a puff of mud
  const v1 = E.volume();
  for (let k = 0; k < 40; k++) { E.run(0.2, 2); H.rebuild(true); }
  assert.ok(E.s[c] < 0.1 * 0.4 + 0.02, `suspended sediment fell to ${E.s[c]}`);
  assert.ok(Math.abs(E.volume() - v1) < 1e-3 * v1, 'conserved while settling');
  assert.ok(sum(E.s) * E.area < 0.4 * E.area * 0.5, 'most of it settled');
  assert.ok(f.base[c] + E.s[c] >= floor0, 'it raised the pond floor');
  void v0;
});

test('a steep soil bank slumps to its angle of repose and conserves volume; rock holds it', () => {
  const mk = (stampBeside) => {
    const f = new Field();
    f.h.fill(3);
    for (let j = 0; j <= NY; j++) for (let i = 60; i <= NX; i++) f.h[f.idx(i, j)] = 13;     // a 10 cm vertical soil face
    if (stampBeside) for (let j = 0; j <= NY; j++) f.stamped[f.idx(60, j)] = f.stamped[f.idx(59, j)] = 1;
    const ret = new Float32Array(f.cols * f.rows);
    retainMap(f, null, ret);
    return { f, ret };
  };
  const { f, ret } = mk(false);
  const dz = new Float32Array(f.h.length);
  const v0 = sum(f.h);
  let moved = 0;
  for (let p = 0; p < 200; p++) moved += slumpPass(f, ret, 0.35, dz);
  assert.ok(moved > 5, 'material moved');
  assert.ok(Math.abs(sum(f.h) - v0) < 1e-3 * v0, 'volume conserved');
  const stress = stressMap(f, ret, new Float32Array(f.h.length));
  let worst = 0;
  for (const s of stress) worst = Math.max(worst, s);
  assert.ok(worst < 1.15, `slope relaxed to near the limit (stress ${worst.toFixed(2)})`);
  // the same face beside a stamped rock wall: soil cells next to it are held, nothing moves into the rock
  const held = mk(true);
  const top0 = held.f.h.slice();
  for (let p = 0; p < 50; p++) slumpPass(held.f, held.ret, 0.35, dz);
  for (const n of [held.f.idx(59, 10), held.f.idx(60, 10)]) assert.equal(held.f.h[n], top0[n], 'stamped cells are untouched');
  assert.ok(limit(f, 0, 1) > 0.5, 'limit has a value');
});

test('a slope shallower than repose is stable (no slump)', () => {
  const f = new Field();
  for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) f.h[f.idx(i, j)] = 3 + i * 0.4;   // 0.4 cm per 0.75 cm cell: ~28 degrees
  const ret = new Float32Array(f.h.length);
  const dz = new Float32Array(f.h.length);
  assert.equal(slumpPass(f, ret, 0.35, dz), 0);
});

// --- Erosion as a background job: the same physics, taken a few pieces at a time -------------------------------------

test('a run taken in pieces ends exactly where the whole run does', () => {
  const A = makeWorld(), B = makeWorld();
  run(A.H, A.E, 60); run(B.H, B.E, 60);          // identical, deterministic histories
  const whole = A.E.run(0.2, 3);
  const g = B.E.steps(0.2, 3);
  let pieces = 0, last;
  for (;;) { const r = g.next(); if (r.done) { last = r.value; break; } pieces++; }
  assert.equal(last, whole);
  assert.ok(pieces >= 12, `${pieces} pieces: scan, capacity, a sweep each, the pool, the paint, the slumping`);
  for (let n = 0; n < A.f.base.length; n++) {
    assert.equal(B.f.base[n], A.f.base[n], `bed ${n}`);
    assert.equal(B.E.s[n], A.E.s[n], `suspended ${n}`);
  }
});

test('erosion as a background job (windows taken, a piece or two per frame, rare commits) conserves soil and water', () => {
  const { H, E } = makeWorld();
  run(H, E, 60);
  const v0 = E.volume(), w0 = H.total(), e0 = E.stats.eroded, r0 = E.stats.runs;
  const jobs = new Jobs();
  let pending = false, commits = 0;
  const dt = 1 / 60;
  for (let k = 0; k < 60 * 150; k++) {          // 150 s of 60 fps frames, 40 virtual seconds of flow per second
    H.step(dt); E.acc.dt += dt; E.acc.gm += dt * 40;
    if (!jobs.busy) {
      const w = E.take();
      if (w) jobs.add((function* () { if (yield* E.steps(w.dt, w.T)) pending = true; })());
    }
    jobs.pump(0.5);
    if (pending && !jobs.busy && k % 240 === 0) { pending = false; H.rebuild(true); E.markCommitted(); commits++; }
  }
  assert.ok(E.stats.runs - r0 > 20, `${E.stats.runs - r0} runs finished`);
  assert.ok(E.stats.eroded - e0 > 0.2, `soil was eroded (${(E.stats.eroded - e0).toFixed(2)} cm3)`);
  assert.ok(commits >= 3, `${commits} commits`);
  assert.ok(Math.abs(E.volume() - v0) < 1e-4 * v0, `soil volume drift ${(E.volume() - v0).toFixed(3)} cm3 of ${v0.toFixed(0)}`);
  assert.ok(Math.abs(H.total() - w0) < 0.01 * w0, `water ${H.total().toFixed(0)} vs ${w0.toFixed(0)} cm3`);
});

test('drift() is the largest change since the last commit', () => {
  const { E, f } = makeWorld();
  E.markCommitted();
  assert.equal(E.drift(), 0);
  f.base[100] += 0.3; f.base[200] -= 0.1;
  assert.ok(Math.abs(E.drift() - 0.3) < 1e-6);
  E.markCommitted();
  assert.equal(E.drift(), 0);
});

test('a running filter takes silt out of the main pool, and keeps what it took', () => {
  const left = (filterK) => {
    const { H, E } = makeWorld();
    run(H, E, 30);
    let c = -1;
    for (let n = 0; n < H.N; n++) if (H.res[n] && H.level - H.f.h[n] > 5) { c = n; break; }
    E.s[c] += 0.4;                       // a puff of mud in the main pool
    const v1 = E.volume();
    E.filterK = filterK;
    for (let k = 0; k < 20; k++) { E.run(0.2, 2); H.rebuild(true); }
    return { s: sum(E.s) * E.area, caught: E.caught, drift: E.volume() + E.caught - v1, v1 };
  };
  const off = left(0), on = left(0.05);
  assert.equal(off.caught, 0, 'no filter, nothing caught');
  assert.ok(on.caught > 0.01, `the filter caught ${on.caught.toFixed(3)} cm3`);
  assert.ok(on.s < off.s * 0.8, `less silt left in the water: ${on.s.toFixed(4)} vs ${off.s.toFixed(4)} cm3`);
  assert.ok(Math.abs(on.drift) < 1e-3 * on.v1, `soil in the bed, the water and the filter is conserved (${on.drift.toFixed(4)})`);
});
