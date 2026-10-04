// The false bottom's own water (src/sim/plenum.js): it fills from the soil after rain, the pump in the tower draws it down,
// it is open to the pool through a screen, and it floods the land when it climbs over the mesh.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PLENUM, plenumStep, stepPlenum, litresAt, levelOf, plenumArea } from '../src/sim/plenum.js';
import { plenumState } from '../src/content/equipment.js';
import { Hydro } from '../src/sim/hydro.js';

const base = { plenumH: 6, cm2: 2400, floor: 90 * 45, pool: 5, pumpLph: 0, rain: 0, mist: 0, soil: 0.6 };
const run = (s, i, minutes, step = 5) => { let f; for (let t = 0; t < minutes; t += step) f = plenumStep(s, i, step); return f; };

test('litres and level are each other\'s inverse, below and over the mesh', () => {
  for (const lv of [0, 1.5, 5.9, 6, 7.3, 9]) assert.ok(Math.abs(levelOf(litresAt(lv, 6, 2400), 6, 2400) - lv) < 1e-9, String(lv));
  assert.ok(litresAt(6, 6, 2400) > 10 && litresAt(6, 6, 2400) < 14, 'a 6 cm plenum under 2400 cm² of land holds about 12 L');
  assert.ok(litresAt(7, 6, 2400) - litresAt(6, 6, 2400) < litresAt(1, 6, 2400), 'a centimetre in the soil holds less than in the open plenum');
});

test('open to the pool with the pump off: the plenum settles at the pool\'s level', () => {
  const s = { level: 2, soak: 0 };
  run(s, base, 120);
  assert.ok(Math.abs(s.level - 5) < 0.05, `level ${s.level}`);
});

test('the pump in the tower draws it under the pool by its flow over the screen, and it comes back when the pump stops', () => {
  const s = { level: 5, soak: 0 };
  const f = run(s, { ...base, pumpLph: 160 }, 360);
  const drop = 5 - s.level, want = 160 / 60 / PLENUM.gap;
  assert.ok(Math.abs(drop - want) < 0.1, `drawn down ${drop.toFixed(2)} cm, expected about ${want.toFixed(2)}`);
  assert.ok(Math.abs(f.pump - 160 / 60) < 0.01 && Math.abs(f.gap - f.pump) < 0.02, 'the pool refills what the pump takes');
  run(s, base, 120);
  assert.ok(s.level > 4.95, 'back at the pool level');
  // Steps of any size land on the same level (the relaxation is exact).
  const a = { level: 3, soak: 0 }, b = { level: 3, soak: 0 };
  run(a, { ...base, pumpLph: 160 }, 60, 0.5); run(b, { ...base, pumpLph: 160 }, 60, 5);
  assert.ok(Math.abs(a.level - b.level) < 0.02);
});

test('no pool: rain fills it through the soil, late; days of rain stop at the drain\'s lip, under the mesh', () => {
  const i = { ...base, pool: null };
  const s = { level: 1, soak: 0 };
  run(s, { ...i, rain: 1, soil: 0.9 }, 60);
  const afterShower = s.level;
  run(s, i, 300);
  assert.ok(s.level > afterShower + 0.05, `still dripping in after the shower: ${afterShower.toFixed(2)} -> ${s.level.toFixed(2)}`);
  assert.ok(s.soak >= 0);
  let drained = 0;
  for (let day = 0; day < 40; day++) { drained += run(s, { ...i, rain: 1, soil: 0.9 }, 60).drain; run(s, i, 1380); }
  assert.ok(s.level <= 6 - PLENUM.drain + 1e-6, `held at the lip: ${s.level.toFixed(3)}`);
  assert.notEqual(plenumState({ drainage: 1, plenumH: 6 }, s.level).state, 'mud');
  assert.ok(drained > 0, 'the drain ran');
});

test('dry soil wicks water back up when it is near the mesh; the pool over the mesh floods it', () => {
  const s = { level: 5.5, soak: 0 };
  run(s, { ...base, pool: null, soil: 0.2 }, 1440);
  assert.ok(s.level < 5.5, 'the drying soil drew some up');
  const t = { level: 5, soak: 0 };
  // A pool standing over the mesh (held there: it does not fall) feeds the screen faster than the drain carries it away.
  const f = run(t, { ...base, pool: 9 }, 60);
  assert.equal(plenumState({ drainage: 1, plenumH: 6 }, t.level).state, 'mud');
  assert.ok(t.level > 6 && t.level < 9, `between the mesh and the pool: ${t.level.toFixed(2)}`);
  assert.ok(Math.abs(f.drain - PLENUM.drainLpm) < 1e-9, 'the drain at full flow');
});

test('stepPlenum: undefined without a false bottom; fitted just over the water, filled from the pool', () => {
  const W = {
    water: { level: 4.2, volumeLitres: () => 30, hydro: { groundVer: 1, pump: { on: true, running: true, lph: 120 } } },
    terrain: { baseAt: (x) => (x > 0 ? 12 : 2) },
  };
  const E = { drainage: 0.6, plenumH: 0, rain: 0, mist: 0, soil: 0.6, plenumLevel: 3 };
  assert.equal(stepPlenum(W, E, 5), null);
  assert.equal(E.plenumLevel, undefined);
  E.drainage = 1;
  const pl = stepPlenum(W, E, 5);
  assert.equal(E.plenumH, 5, "half-centimetre steps, a centimetre over the water");
  assert.ok(pl.open && pl.state === 'good' && E.plenumL > 0, JSON.stringify(pl));
  for (let k = 0; k < 100; k++) stepPlenum(W, E, 5);
  assert.ok(E.plenumLevel < 4.2 - 0.5, 'the pump keeps it under the pool');
});

// A real pool (sim/hydro.js) beside a false bottom: what runs through the screen comes out of the pool and the pump's water goes
// back to it, so the pool and the plenum together keep their water (no rain, no evaporation, a wet soil that wicks nothing).
function pondAndLand() {
  const NX = 60, NY = 30, f = { nx: NX, ny: NY, cols: NX + 1, rows: NY + 1, da: 90 / NX, db: 45 / NY, oa: -45, ob: -22.5 };
  f.h = new Float32Array(f.cols * f.rows); f.base = f.h; f.stamped = new Uint8Array(f.cols * f.rows);
  f.toGrid = (a, b) => [(a - f.oa) / f.da, (b - f.ob) / f.db]; f.toWorld = (i, j) => [f.oa + i * f.da, f.ob + j * f.db]; f.idx = (i, j) => j * f.cols + i;
  for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) { const [, z] = f.toWorld(i, j); f.h[f.idx(i, j)] = z < -12 ? 20 : z < -6 ? 20 - (z + 12) / 6 * 19 : 1; }
  const at = (x, z) => { const [a, b] = f.toGrid(x, z); return f.h[f.idx(Math.max(0, Math.min(NX, Math.round(a))), Math.max(0, Math.min(NY, Math.round(b))))]; };
  const world = { terrain: { field: f, heightAt: at, baseAt: at }, wall: { zAt: () => 0 }, log: () => {}, env: {} };
  const H = new Hydro(world);
  H.pump.intake = { x: 0, z: 15 };
  H.rebuild(); H.setLevel(10);
  world.water = { get level() { return H.level; }, volumeLitres: () => H.total() / 1000, hydro: H };
  return { W: world, H };
}
const all = (H, E) => H.total() + (E.plenumL ?? 0) * 1000;
const steps = (W, H, E, n) => { for (let k = 0; k < n; k++) { stepPlenum(W, E, 5); H.solveLevel(); } };

test('the plenum and the pool keep their water between them: the screen and the pump', () => {
  const { W, H } = pondAndLand();
  H.pump.on = true; H.pump.running = true; H.pump.lph = 120;
  const E = { drainage: 1, plenumH: 0, rain: 0, mist: 0, soil: 0.8 }, level0 = H.level, t0 = H.total();
  // fitted (filled with the build) where it settles with the pump running: the pool does not swing
  steps(W, H, E, 1);
  assert.ok(E.plenumL > 1 && Math.abs(H.total() - t0) < 1e-6 * t0, `plenum ${E.plenumL} L, pool changed ${((H.total() - t0) / 1000).toFixed(3)} L`);
  const tf = all(H, E);
  steps(W, H, E, 100);
  assert.ok(Math.abs(all(H, E) - tf) < 1e-6 * tf && Math.abs(H.level - level0) < 0.01, `pool ${level0} -> ${H.level}`);
  H.pump.on = false; H.pump.running = false;
  // siphoned out (that water leaves the tank), it refills through the screen from the pool, and the pool falls
  const level1 = H.level;
  E.plenumLevel = 0.5;
  const t1 = H.total() + litresAt(0.5, E.plenumH, plenumArea(W, E.plenumH)) * 1000;
  steps(W, H, E, 200);
  assert.ok(Math.abs(all(H, E) - t1) < 1e-6 * t1, `the screen made ${((all(H, E) - t1) / 1000).toFixed(3)} L`);
  assert.ok(H.level < level1 - 0.2 && Math.abs(E.plenumLevel - H.level) < 0.1, `pool ${H.level.toFixed(2)} plenum ${E.plenumLevel.toFixed(2)}`);
  // the pump in the tower lifts the plenum's water to the falls, which bring it back to the pool
  H.pump.on = true; H.pump.running = true; H.pump.lph = 120;
  const t2 = all(H, E);
  steps(W, H, E, 200);
  assert.ok(Math.abs(all(H, E) - t2) < 1e-6 * t2, `the pump made ${((all(H, E) - t2) / 1000).toFixed(3)} L`);
  assert.ok(E.plenumLevel < H.level - 0.5, 'the pump keeps the plenum under the pool');
});

test('the drain: over its lip the water leaves the tank, at the same rate whatever the time step', () => {
  for (const pool of [5.8, 7.5]) {
    const rates = [1, 5, 30].map((step) => { const s = { level: 5, soak: 0 }; return run(s, { ...base, pool }, 180, step).drain; });
    for (const r of rates) assert.ok(Math.abs(r - rates[0]) < 1e-6, `pool ${pool}: ${rates.map((x) => x.toFixed(4))}`);
  }
  const s = { level: 5, soak: 0 };
  assert.ok(Math.abs(run(s, { ...base, pool: 5.8 }, 180).drain - PLENUM.gap * (5.8 - (6 - PLENUM.drain))) < 1e-3, 'a fixed pool 0.3 cm over the lip: the screen\'s flow (less the soil\'s wicking)');
  assert.equal(s.level, 6 - PLENUM.drain);
});
