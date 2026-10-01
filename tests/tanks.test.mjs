import test from 'node:test';
import assert from 'node:assert/strict';
import { TANKS, TANK_ORDER, CUSTOM_LIMITS, clampCustom, cellsFor, setCustomTank } from '../src/content/tanks.js';
import { PRESETS } from '../src/content/presets.js';

test('every tank in the order exists, with sane data and a grid of similar size', () => {
  assert.equal(new Set(TANK_ORDER).size, TANK_ORDER.length);
  for (const id of TANK_ORDER) {
    const t = TANKS[id];
    assert.ok(t, id);
    assert.equal(t.id, id);
    assert.ok(t.w >= 25 && t.d >= 20 && t.h >= 25, id);
    const ground = Math.round(t.w * t.cellsPerCm) * Math.round(t.d * t.cellsPerCm);
    const wall = Math.round(t.w * t.cellsPerCm) * Math.round(t.h * t.cellsPerCm);
    assert.ok(ground >= 2000 && ground <= 11000, `${id} ground cells ${ground}`);
    assert.ok(wall <= 13000, `${id} wall cells ${wall}`);
  }
  for (const id of ['cube', 'tall', 'long', 'wide', 'show', 'jar', 'nano', 'standard', 'grand']) assert.ok(TANK_ORDER.includes(id), id);
});

test('prices and ranks are sensible: the show tank is the dearest and unlocks last', () => {
  for (const id of TANK_ORDER) { assert.ok(TANKS[id].price >= 0); assert.ok(TANKS[id].level >= 1 && TANKS[id].level <= 12); }
  const top = TANK_ORDER.map((id) => TANKS[id]).sort((a, b) => b.price - a.price)[0];
  assert.equal(top.id, 'show');
  assert.ok(TANKS.show.level >= TANKS.grand.level);
  assert.ok(TANKS.cube.price < TANKS.nano.price);
});

test('custom size is clamped to safe limits and a volume cap', () => {
  const L = CUSTOM_LIMITS;
  for (const [w, d, h] of [[1, 1, 1], [999, 999, 999], [200, 80, 100], [60, 30, 40], ['x', null, undefined]]) {
    const c = clampCustom(w, d, h);
    assert.ok(c.w >= L.w[0] && c.w <= L.w[1] && c.d >= L.d[0] && c.d <= L.d[1] && c.h >= L.h[0] && c.h <= L.h[1]);
    assert.ok(c.w * c.d * c.h / 1000 <= L.maxLitres);
    const cpc = cellsFor(c.w, c.d, c.h);
    assert.ok(cpc >= 0.8 && cpc <= 2);
  }
  const t = setCustomTank(100, 50, 60);
  assert.equal(TANKS.custom, t);
  assert.deepEqual([t.w, t.d, t.h], [100, 50, 60]);
});

test('every preset lists only tank sizes that exist', () => {
  for (const p of Object.values(PRESETS)) for (const t of p.tiers) assert.ok(TANKS[t], `${p.id} -> ${t}`);
});
