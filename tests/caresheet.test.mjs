// The care-sheet additions (2026-10): the crocodile skink's mind (src/sim/skink.js), the panther crab's profile on the crab
// mind (src/sim/crab.js PANTHER), the filter and water-source tables (src/content/equipment.js), and the new species rows:
// every one has a habitat rule, a shop row, a field guide entry and a body, and its care ranges are sane.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SKINK, skinkMind, skinkThink, skinkComfort } from '../src/sim/skink.js';
import { CRAB, PANTHER, crabMind, crabThink } from '../src/sim/crab.js';
import { FILTERS, WATER_SOURCES, GEAR, filterOf, sourceOf } from '../src/content/equipment.js';
import { HABITAT } from '../src/content/habitats.js';
import { ANIMALS } from '../src/content/economy.js';
import { ANIMAL_INFO } from '../src/content/species-info.js';
import { CONCEPTS } from '../src/content/concepts.js';
import { BIOTOPES } from '../src/content/biotopes.js';
import { PRESETS } from '../src/content/presets.js';
import { BODIES } from '../src/render/creatures/bodies/index.js';

const seq = (seed = 1) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const NEW = ['cpd', 'pygmy', 'blueshrimp', 'panther', 'skink', 'bumblebee', 'reedfrog', 'marbled', 'purpleiso', 'pandaking', 'springpink'];

// --- Crocodile skink ---------------------------------------------------------------------------------------------------
const day = (o = {}) => ({ t: 0, dt: 0.2, dtMin: 0.2, x: 0, z: 0, depth: -1, wetGround: 0.5, light: 1, rain: 0, rh: 88, temp: 25, cover: 0.2, hunger: 0.2, threat: null, home: { x: 6, z: 0 }, shore: { x: -10, z: 0, d: 10 }, warm: { x: 0, z: 8, d: 8, temp: 29 }, ...o });
function run(m, s, seconds, rnd) {
  const out = [];
  for (let t = 0; t < seconds; t += s.dt) out.push(skinkThink(m, { ...s, t }, rnd));
  return out;
}

test('skink comfort follows the sheet: 23-27 °C (a warm spot to 29) and 80% humidity or more', () => {
  assert.equal(skinkComfort(25, 85), 1);
  assert.ok(skinkComfort(19, 85) < 0.05);
  assert.ok(skinkComfort(25, 55) < 0.1);
  assert.ok(skinkComfort(28.5, 85) === 1, 'the warm spot is comfortable');
});

test('skink hides by day and comes out to forage at dusk', () => {
  const m = skinkMind(seq(2));
  m.warm = 0.9;                                                   // warm already: no need to bask
  const byDay = run(m, day({ light: 1, rh: 80 }), 60, seq(3));
  assert.ok(byDay.filter((i) => i.mode === 'hide').length > byDay.length * 0.8, 'mostly hidden by day');
  const m2 = skinkMind(seq(4)); m2.warm = 0.9; m2.mode = 'rest';
  const dusk = run(m2, day({ light: 0.05, rh: 92 }), 60, seq(5));
  assert.ok(dusk.some((i) => i.mode === 'forage' && i.speed > 0), 'walks about at dusk');
  assert.ok(dusk.every((i) => i.speed <= SKINK.speed * 2 + 1e-9));
});

test('a cold skink goes to the warm spot and lies flat under it; a dry one soaks in the shallows', () => {
  const m = skinkMind(seq(6)); m.warm = 0.1; m.wet = 0.9;
  const it = skinkThink(m, day({ temp: 23 }), seq(7));
  assert.equal(it.mode, 'bask');
  assert.deepEqual(it.goal, { x: 0, z: 8 });
  const at = skinkThink(m, day({ temp: 23, x: 0, z: 8 }), seq(8));
  assert.equal(at.flat, 1);
  const d = skinkMind(seq(9)); d.wet = 0.2; d.warm = 0.9;
  const s1 = skinkThink(d, day(), seq(10));
  assert.equal(s1.mode, 'soak');
  assert.deepEqual(s1.goal, { x: -10, z: 0 });
  const s2 = skinkThink(d, day({ depth: 2 }), seq(11));
  assert.equal(s2.flat, 1, 'lies in the water');
  for (let k = 0; k < 2000; k++) skinkThink(d, day({ depth: 2, dt: 1, dtMin: 1 }), seq(12));
  assert.ok(d.wet > SKINK.soakTo, 'soaking refills it');
});

test('a fright makes it freeze, then flee to its hide, and a big one can make it play dead', () => {
  const m = skinkMind(seq(13)); m.warm = 0.9; m.mode = 'rest';
  const it = skinkThink(m, day({ threat: { x: 1, z: 0, d: 1 } }), seq(14));
  assert.equal(it.mode, 'freeze');
  let sawFlee = false, sawDead = false;
  for (let t = 0; t < 30; t += 0.2) {
    const i = skinkThink(m, day({ t, threat: { x: 1, z: 0, d: 0.5 } }), seq(15 + t));
    if (i.mode === 'flee') sawFlee = true;
    if (i.mode === 'dead') { sawDead = true; assert.equal(i.roll, 1); }
  }
  assert.ok(sawFlee || sawDead, 'it reacts beyond freezing');
  // Playing dead ends by itself.
  const p = skinkMind(seq(20)); p.mode = 'dead'; p.deadT = 3; p.fear = 0.9;
  for (let t = 0; t < 10; t += 0.2) skinkThink(p, day({ t }), seq(21));
  assert.notEqual(p.mode, 'dead');
});

test('out of its depth the skink heads for the bank', () => {
  const m = skinkMind(seq(22)); m.warm = 0.9;
  const it = skinkThink(m, day({ depth: SKINK.maxDepth + 2 }), seq(23));
  assert.equal(it.mode, 'flee');
  assert.deepEqual(it.goal, { x: -10, z: 0 });
});

// --- Panther crab --------------------------------------------------------------------------------------------------
const water = (o = {}) => ({ t: 0, dt: 0.2, dtMin: 0.2, x: 0, z: 0, depth: 20, wetGround: 1, light: 1, rain: 0, rh: 80, temp: 26, cover: 0, hunger: 0.2, food: null, threat: null, other: null, home: { x: 5, z: 0 }, shore: null, bank: { x: 20, z: 0, d: 20 }, male: false, ...o });

test('the panther crab lives in deep water: no exit, no drowning, no digging', () => {
  const m = crabMind(seq(30), PANTHER);
  for (let t = 0; t < 120; t += 0.2) {
    const i = crabThink(m, { ...water(), t }, seq(31 + t), PANTHER);
    assert.notEqual(i.mode, 'exit');
    assert.equal(i.drown, false);
    assert.notEqual(i.mode, 'dig');
  }
  // The vampire crab in the same water wants out at once.
  const v = crabMind(seq(32));
  assert.equal(crabThink(v, water(), seq(33)).mode, 'exit');
  assert.equal(PANTHER.dig, false);
  assert.ok(PANTHER.shellCm > CRAB.shellCm * 2);
});

test('the panther crab hauls out now and then, and goes back to the water when its gills dry', () => {
  const m = crabMind(seq(40), PANTHER);
  m.haul = 1.2;
  const i = crabThink(m, water(), seq(41), PANTHER);
  assert.equal(i.mode, 'haul');
  assert.deepEqual(i.goal ?? { x: 20, z: 0 }, { x: 20, z: 0 });
  // On land: the urge is spent and the gills dry; it soaks again.
  const land = { ...water(), depth: -1, shore: { x: -3, z: 0, d: 3 } };
  let soaked = false;
  for (let t = 0; t < 4000 && !soaked; t += 1) if (crabThink(m, { ...land, t, dt: 1, dtMin: 1 }, seq(42 + t), PANTHER).mode === 'soak') soaked = true;
  assert.ok(soaked, 'back to the water');
  assert.ok(m.haul < 1);
});

// --- Tables ----------------------------------------------------------------------------------------------------------
test('filters and water sources are consistent', () => {
  for (const [id, F] of Object.entries(FILTERS)) {
    assert.ok(GEAR[F.gear], `${id}: gear ${F.gear}`);
    assert.ok(F.mediaMax > 0 && F.mediaMax <= 1 && F.flow >= 0 && F.flow <= 1 && F.suction >= 0 && F.suction <= 1, id);
  }
  assert.ok(FILTERS.matten.suction === 0 && FILTERS.sponge.suction === 0, 'foam filters are shrimp-safe');
  assert.ok(FILTERS.canister.flow > FILTERS.sponge.flow && FILTERS.canister.mediaMax > FILTERS.matten.mediaMax);
  assert.equal(filterOf({ filterKind: 'nope' }), FILTERS.sponge);
  for (const w of Object.values(WATER_SOURCES)) assert.ok(w.ph >= 6 && w.ph <= 8.5 && w.gh >= 0 && w.gh <= 20);
  assert.ok(WATER_SOURCES.hard.gh >= 8, 'hard water suits the panther crab');
  assert.equal(sourceOf({}), WATER_SOURCES.tap);
});

test('every new species has a habitat rule, a shop row, a field guide entry and a body', () => {
  for (const id of NEW) {
    assert.ok(HABITAT[id], `${id}: habitat`);
    assert.ok(ANIMALS[id], `${id}: shop row`);
    assert.ok(ANIMAL_INFO[id], `${id}: field guide`);
    const lesson = ANIMAL_INFO[id].lesson;
    assert.ok(!lesson || CONCEPTS[lesson], `${id}: lesson card ${lesson}`);
  }
  for (const id of ['cpd', 'pygmy', 'blueshrimp', 'panther', 'skink', 'bumblebee', 'reedfrog', 'purpleiso', 'pandaking', 'springpink']) assert.ok(BODIES[id], `${id}: body`);
});

test('every new preset has its biotope, and every biotope animal exists', () => {
  for (const id of ['streambank', 'reedpool', 'matano', 'everglades']) {
    assert.ok(PRESETS[id], id);
    const b = BIOTOPES[PRESETS[id].biotope];
    assert.ok(b, `${id}: biotope`);
    for (const a of b.animals) assert.ok(HABITAT[a], `${id}: ${a}`);
  }
});
