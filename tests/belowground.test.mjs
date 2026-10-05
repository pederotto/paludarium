// B5d: the water below the substrate (src/sim/plenum.js) in every build: a false bottom (its plenum), a drainage layer of LECA and a
// plain substrate (a simulated water table, open to the pool through the soil). What the renderer is handed (belowGround) is the
// sim's level; rain raises the table and the seep to the pool lets it down; every litre is accounted for, with and without the
// bed filter's pump; the X-ray body's top is the level.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stepPlenum, stepGround, belowGround, groundGrid, bodyTop, LECA, SEEP, LECA_POROSITY } from '../src/sim/plenum.js';
import { FILTERS } from '../src/content/equipment.js';
import { TANK } from '../src/sim/tank.js';
import { Hydro } from '../src/sim/hydro.js';

// The same stub tank as tests/plenum.test.mjs: land 20 cm high along the back, sloping to a 1 cm bed under a 10 cm pool.
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
  H.pump.on = true; H.pump.running = true; H.pump.lph = 120;
  return { W: world, H };
}
const BUILDS = { 'false bottom': 1, LECA: 0.6, 'plain substrate': 0 };
const BED = Object.keys(FILTERS).find((k) => FILTERS[k].mount === 'bed');
// All the water: the pool, the plenum or the water table, and what is on its way down through the soil (litres).
const all = (H, E) => H.total() / 1000 + (E.plenumL ?? 0) + (E.plenumSoak ?? 0) + (E.groundL ?? 0) + (E.groundSoak ?? 0);
// Steps `minutes`; returns the litres that came in (rain and misting on the land) less those that left (wicked into the soil, drained).
const run = (W, H, E, minutes, d = 5) => {
  let net = 0;
  for (let t = 0; t < minutes; t += d) {
    const f = E.drainage >= 1 ? stepPlenum(W, E, d)?.flows : stepGround(W, E, d);
    net += ((f?.land ?? 0) - (f?.wick ?? 0) - (f?.drain ?? 0)) * d;
    H.solveLevel();
  }
  return net;
};

test('base: belowGround hands the renderer the sim\'s level and litres in every build', () => {
  for (const [name, drainage] of Object.entries(BUILDS)) {
    const { W, H } = pondAndLand();
    const E = { drainage, plenumH: 0, rain: 0, mist: 0, soil: 0.8 };
    stepPlenum(W, E, 5); run(W, H, E, 1440);
    const b = belowGround(E, H.level);
    assert.equal(b.mode, drainage >= 1 ? 2 : drainage > 0 ? 1 : 0, name);
    assert.equal(b.level, drainage >= 1 ? E.plenumLevel : E.groundLevel, `${name}: level`);
    assert.equal(b.L, drainage >= 1 ? E.plenumL : E.groundL, `${name}: litres`);
    assert.ok(b.level > 0 && b.L > 0, `${name}: ${b.level} cm, ${b.L} L`);
    if (drainage < 1) assert.ok(Math.abs(b.level - H.level) < 0.05, `${name}: open to the pool, the table settles at its line (${b.level.toFixed(2)} vs ${H.level.toFixed(2)})`);
  }
  assert.equal(belowGround({ drainage: 0.6 }, 10).layerH, LECA.h);
  assert.ok(LECA_POROSITY > 0 && SEEP > 0, 'the guessed constants are named');
});

test('LECA: the level rises with watering and falls back as it drains to the pool', () => {
  const { W, H } = pondAndLand();
  const E = { drainage: 0.6, rain: 0, mist: 0, soil: 0.8 };
  run(W, H, E, 120);
  const start = E.groundLevel, over0 = start - H.level;
  E.rain = 1; run(W, H, E, 360);
  const wet = E.groundLevel, over1 = wet - H.level;
  assert.ok(wet > start + 0.05 && over1 > over0 + 0.05, `rain: ${start.toFixed(3)} -> ${wet.toFixed(3)} cm, over the pool ${over0.toFixed(3)} -> ${over1.toFixed(3)}`);
  E.rain = 0; run(W, H, E, 1440);
  // (the rain that ran through also raised the pool: the table falls back to the pool's line, not under where it started)
  assert.ok(E.groundLevel - H.level < over1 / 3, `drained: ${E.groundLevel.toFixed(3)} cm, pool ${H.level.toFixed(3)}`);
  // a water change: 3 L out of the pool, and the layer drains down after it
  const before = E.groundLevel; H.exchange(-3000); H.solveLevel(); run(W, H, E, 240);
  assert.ok(E.groundLevel < before - 0.3, `water change: ${before.toFixed(3)} -> ${E.groundLevel.toFixed(3)} cm`);
  // Not the old constant: its water stands at the pool's line, here over the 3 cm layer (a layer under the pool's line is flooded).
  assert.ok(E.groundLevel > LECA.h && Math.abs(E.groundLevel - 1.2) > 1);
});

test('plain substrate: the water table rises and falls, and every build keeps its water to 1e-6 L a day (with and without the bed pump)', () => {
  for (const [name, drainage] of Object.entries(BUILDS)) for (const bed of [false, true]) for (const soil of [0.8, 0.3]) {
    const { W, H } = pondAndLand();
    const E = { drainage, plenumH: 0, rain: 0, mist: 0, soil, filter: bed, filterKind: bed ? BED : undefined, filterLph: bed ? 200 : 0 };
    run(W, H, E, 5);
    const t0 = all(H, E), lv0 = belowGround(E, H.level).level - H.level;
    let net = 0;
    E.rain = 1; E.mist = 1; net += run(W, H, E, 360);
    const lv1 = belowGround(E, H.level).level - H.level;
    E.rain = 0; E.mist = 0; net += run(W, H, E, 1080);
    const lv2 = belowGround(E, H.level).level - H.level, err = all(H, E) - t0 - net;
    assert.ok(Math.abs(err) < 1e-6, `${name}${bed ? ' + bed pump' : ''}, soil ${soil}: ${err.toExponential(2)} L made or lost in a day`);
    if (drainage === 0 && !bed && soil === 0.8) assert.ok(lv1 > lv0 + 0.05 && lv2 < lv1 / 3, `table over the pool's line ${lv0.toFixed(3)} -> ${lv1.toFixed(3)} -> ${lv2.toFixed(3)} cm`);
  }
});

test('X-ray body: its top stands at the level wherever the ground is over it, and its grid covers the floor', () => {
  for (const [name, drainage] of Object.entries(BUILDS)) {
    const { W, H } = pondAndLand();
    const E = { drainage, plenumH: 0, rain: 0, mist: 0, soil: 0.8 };
    stepPlenum(W, E, 5); run(W, H, E, 600);
    const G = groundGrid(W), b = belowGround(E, H.level);
    assert.ok(Math.abs(G.cell * G.g.length - TANK.w * TANK.d) < 1e-6, 'the grid covers the floor');
    let top = 0;
    for (const g of G.g) top = Math.max(top, bodyTop(g, b.level));
    assert.equal(top, b.level, `${name}: body top ${top} vs level ${b.level}`);
    assert.ok(bodyTop(1, b.level) < 1, 'under the pool the body stays under its bed');
  }
});
