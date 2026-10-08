// The air pump and airstone (run "sets", owner's word 7 Oct): a shop item, a controller actuator and an oxygen sensor, an Env field that is saved,
// a running cost, and oxygen in the main pool's target (sim/waterbodies.js AIR_O2).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GEAR, ACTUATORS, SENSORS } from '../src/content/equipment.js';
import { runningCosts, GEAR_SIZING } from '../src/content/upkeep.js';
import { Env } from '../src/sim/env.js';
import { TANKS } from '../src/content/tanks.js';

test('the air pump is a water item with a price, a level and a lesson', () => {
  const g = GEAR.airpump;
  assert.ok(g && g.group === 'Water' && g.price > 0 && g.level >= 1 && g.icon === 'bubbles');
  assert.ok(g.blurb.length > 20 && g.teach.length > 60);
});

test('a controller rule can switch it on by the oxygen reading', () => {
  assert.equal(ACTUATORS.air.gear, 'airpump');
  assert.equal(ACTUATORS.air.key, 'air');
  assert.equal(typeof SENSORS.oxygen.get({ oxygen: 5.5 }), 'number');
});

test('Env keeps and saves the air setting', () => {
  const e = new Env();
  assert.equal(e.air, 0);
  e.air = 0.6;
  assert.equal(e.serialize().air, 0.6);
});

test('it costs power in proportion to its setting and the tank', () => {
  const tank = TANKS.standard, has = (id) => id === 'airpump';
  const off = runningCosts(tank, { air: 0 }, has, { water: 100 }), on = runningCosts(tank, { air: 1 }, has, { water: 100 });
  const cost = (r) => (r.parts ?? r).filter?.((p) => /air/i.test(p[0])).reduce((s, p) => s + p[1], 0) ?? 0;
  assert.ok(GEAR_SIZING.airpump === 'litres');
  assert.ok(cost(on) > cost(off));
});

test('the main pool\'s oxygen target counts the airstone (source check)', () => {
  const src = fs.readFileSync(new URL('../src/sim/waterbodies.js', import.meta.url), 'utf8');
  assert.match(src, /AIR_O2/);
  assert.match(src, /\(E\.air \?\? 0\) \* \(b === sump \? AIR_O2/);
});

test('the Care panel has its slider (source check)', () => {
  const care = fs.readFileSync(new URL('../src/ui/panels/Care.jsx', import.meta.url), 'utf8');
  assert.match(care, /gear="airpump"/);
});
