// Water conservation and the flow ledger, under Node with a bare heightfield
// (no scene): hydro.js and waterbodies.js only need the grid.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { Hydro } from '../src/sim/hydro.js';

const NX = 120, NY = 60, W = 90, D = 45;

class Field {
  constructor() {
    this.nx = NX; this.ny = NY; this.cols = NX + 1; this.rows = NY + 1;
    this.da = W / NX; this.db = D / NY; this.oa = -W / 2; this.ob = -D / 2;
    this.h = new Float32Array(this.cols * this.rows);
    this.base = this.h;
    this.stamped = new Uint8Array(this.cols * this.rows);
  }
  toGrid(a, b) { return [(a - this.oa) / this.da, (b - this.ob) / this.db]; }
  toWorld(i, j) { return [this.oa + i * this.da, this.ob + j * this.db]; }
  idx(i, j) { return j * this.cols + i; }
}
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Floor at 3, a shelf along the back at 15, a pond bowl on the shelf with a
// notch on its front lip, a ramp down to the floor.
function makeWorld() {
  const f = new Field();
  for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) {
    const [x, z] = f.toWorld(i, j);
    let h = 3 + smooth(-2, -9, z) * 12;
    const r = Math.hypot(x + 26, z + 15);
    h -= (1 - smooth(0, 6, r)) * 5.5;                       // bowl, floor at 9.5
    h -= (1 - smooth(0, 2.2, Math.hypot(x + 26, z + 9.2))) * 1.5; // notch in the front lip
    f.h[f.idx(i, j)] = h;
  }
  const logs = [];
  const world = {
    terrain: { field: f, heightAt: (x, z) => { const [a, b] = f.toGrid(x, z); return f.h[f.idx(Math.max(0, Math.min(NX, Math.round(a))), Math.max(0, Math.min(NY, Math.round(b))))]; } },
    wall: { zAt: () => 0 }, log: (m) => logs.push(m), env: {}, logs,
  };
  const H = new Hydro(world);
  H.pump.intake = { x: 8, z: 12 };
  H.rebuild();
  H.setLevel(10);
  H.addOutlet(new THREE.Vector3(-26, f.h[f.idx(Math.round((-26 + W / 2) / f.da), Math.round((-15 + D / 2) / f.db))] + 0.2, -15), false);
  return { world, H, f };
}
const run = (H, seconds, dt = 0.05) => { for (let t = 0; t < seconds; t += dt) H.step(dt); };
const bump = (f, cx, cz, r, dh) => {
  for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) {
    const [x, z] = f.toWorld(i, j);
    const k = Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (2 * r * r));
    f.h[f.idx(i, j)] = Math.max(0.5, f.h[f.idx(i, j)] + dh * k);
  }
};
const within = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, b), `${msg}: ${a.toFixed(0)} vs ${b.toFixed(0)} cm3`);

test('the circuit runs: pump lifts to the pond, the pond spills and water returns', () => {
  const { H } = makeWorld();
  run(H, 90);
  assert.ok(H.pump.running, 'pump running');
  assert.ok(H.pools.length >= 1, 'a pond has filled');
  const L = H.ledger;
  assert.ok(L.nodes.find((n) => n.key === 'sump'), 'sump node');
  const pumpOut = L.links.filter((l) => l.kind === 'pump').reduce((s, l) => s + l.lph, 0);
  assert.ok(pumpOut > 100 && pumpOut <= 161, `pump delivers ${pumpOut} L/h`);
  const back = L.links.filter((l) => l.kind === 'return' || l.kind === 'seep').reduce((s, l) => s + l.lph, 0);
  assert.ok(back > 0.5 * pumpOut, `water comes back (${back} of ${pumpOut} L/h)`);
});

test('ledger: every node balances (in = out + change in storage)', () => {
  const { H } = makeWorld();
  run(H, 40);
  for (let k = 0; k < 20; k++) {
    run(H, 1);
    assert.ok(H.ledger.check.maxImbalance < 1, `window imbalance ${H.ledger.check.maxImbalance} cm3`);
  }
  for (const n of H.ledger.nodes) assert.ok(Math.abs(n.imbalanceCm3) < 1, `${n.key} imbalance ${n.imbalanceCm3}`);
});

test('burying the pump intake keeps every drop and moves the intake', () => {
  const { H, f, world } = makeWorld();
  run(H, 30);
  const before = H.total(), seed = H.seed;
  bump(f, H.pump.intake.x, H.pump.intake.z, 4, 14);
  H.rebuild();
  within(H.total(), before, 0.005, 'total after burying the pump');
  assert.notEqual(H.seed, seed, 'intake moved');
  assert.ok(world.logs.some((m) => /intake/i.test(m)), 'the move is logged');
  run(H, 5);
  assert.ok(H.pump.running, 'pump still runs');
  assert.ok(H.level > H.f.h[H.seed] + 2.5, 'intake is submerged');
  within(H.total(), before, 0.005, 'total after running on');
});

test('raising ground under a pond and on slopes conserves volume', () => {
  const { H, f } = makeWorld();
  run(H, 60);
  assert.ok(H.pools.length >= 1);
  for (const [cx, cz, r, dh] of [[-26, -15, 3, 4], [-15, -5, 4, 5], [-10, 0, 5, -2], [20, 5, 6, 6], [-26, -12, 2, 3]]) {
    const before = H.total();
    bump(f, cx, cz, r, dh);
    H.rebuild();
    within(H.total(), before, 0.005, `edit at ${cx},${cz}`);
    assert.ok(H.ledger.check.maxImbalance < 1, 'books balance across the edit');
    run(H, 3);
    within(H.total(), before, 0.005, `after running (${cx},${cz})`);
  }
});

test('valves split the pump flow; the rest circulates through the bypass', () => {
  const { H, f } = makeWorld();
  const o2 = H.addOutlet(new THREE.Vector3(10, f.h[f.idx(Math.round((10 + W / 2) / f.da), Math.round((-5 + D / 2) / f.db))] + 0.2, -5), false);
  H.outlets[0].valve = 0.5; o2.valve = 0.25;
  run(H, 20);
  const P = H.ledger.pump;
  assert.ok(P.bypassLph > 0.2 * P.lph, 'a quarter of the flow bypasses');
  const q0 = H.outlets[0].q, q1 = o2.q;
  assert.ok(q0 > 1.8 * q1 && q0 < 2.2 * q1 * 1.15, `valve shares ${q0} vs ${q1}`);
  const sumpIn = H.ledger.nodes.find((n) => n.key === 'sump');
  assert.ok(sumpIn.inLph > 0);
});

test('pump slows with lift and starves when the intake is dry', () => {
  const { H } = makeWorld();
  run(H, 5);
  const full = H.pump.lph;
  H.setLevel(3.5);
  run(H, 3);
  assert.ok(H.pump.submerge < 1, 'intake under-submerged');
  assert.ok(H.pump.lph < full, 'flow drops');
  assert.ok(H.ledger.warnings.some((w) => /starving/i.test(w.text)), 'warning says so');
});

test('save and load keep valves and water', () => {
  const { H, world } = makeWorld();
  H.outlets[0].valve = 0.4;
  run(H, 20);
  const total = H.total();
  const s = JSON.parse(JSON.stringify(H.serialize()));
  const H2 = new Hydro(world);
  H2.deserialize(s);
  assert.equal(H2.outlets[0].valve, 0.4);
  within(H2.total(), total, 0.01, 'loaded total');
});
