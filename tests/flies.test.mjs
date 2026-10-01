// The fruit fly life cycle (sim/flylife.js): temperature-dependent development, boom and bust on a food supply,
// maggots that turn litter into humus and fertility, and saving.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FlyLife, rateOf, FLY } from '../src/sim/flylife.js';
import { Humus } from '../src/sim/humus.js';
import fs from 'node:fs';

// animals.js needs a browser (three/webgpu); the numbers the life cycle relies on are mirrored here.
const SPECIES = { fly: { hungerHours: 30, lifeDays: 14, cap: 70 }, flylarva: { hungerHours: 30, lifeDays: 16, cap: 150 }, flypupa: { hungerHours: 1e9, lifeDays: 16, cap: 150 } };
const SRC = fs.readFileSync(new URL('../src/sim/animals.js', import.meta.url), 'utf8');

function world({ T = 25, soil = 0.6, litter = 0.15, water = 0 } = {}) {
  const cs = 3, nx = 24, nz = 16, n = nx * nz;
  const C = {
    cs, nx, nz, litter: new Float32Array(n).fill(litter), humus: new Float32Array(n).fill(0.1), fert: new Float32Array(n).fill(0.05),
    soil: new Float32Array(n).fill(soil), temp: new Float32Array(n).fill(T), f: { water: new Float32Array(n).fill(water) },
    idx(x, z) { const i = Math.max(0, Math.min(nx - 1, Math.floor((x + nx * cs / 2) / cs))), j = Math.max(0, Math.min(nz - 1, Math.floor((z + nz * cs / 2) / cs))); return j * nx + i; },
    sample(map, x, z) { return map[this.idx(x, z)]; },
    tempAt() { return T; }, splat() {},
  };
  const by = { fly: [], flylarva: [], flypupa: [] };
  let id = 1;
  const V = (x, y, z) => ({ x, y, z, clone() { return V(this.x, this.y, this.z); } });
  const animals = {
    by,
    add(sp, pos, o = {}) { if (by[sp].length >= SPECIES[sp].cap + 20) return null; const a = { id: id++, sp, pos: V(pos.x, pos.y, pos.z), hunger: o.hunger ?? 0.2, health: 1, age: o.age ?? 0, T }; by[sp].push(a); return a; },
    remove(a) { const i = by[a.sp].indexOf(a); if (i >= 0) by[a.sp].splice(i, 1); a.dead = true; },
    count: (s) => by[s]?.length ?? 0,
  };
  const w = {
    climate: C, env: { detritus: 0, nitrate: 0, mold: 0, humidity: 70, fan: 0, lid: false, temp: T, culture: false }, animals, plants: { list: [] },
    terrain: { heightAt: () => 3, normalAt: () => V(0, 1, 0) },
    wall: { zAt: () => -24, field: { gradient: () => [0, 0] } },
    water: { surfaceAt: () => (water > 0 ? 3 : -Infinity) },
  };
  w.humus = new Humus(w);
  w.flies = new FlyLife(w, V);
  return w;
}
// One day of the generic animal loop (sim.js: age, hunger, old age) plus the life cycle and the litter's own rot.
function day(w) {
  const E = w.env;
  for (let k = 0; k < 288; k++) {
    for (const arr of Object.values(w.animals.by)) for (const a of [...arr]) {
      const sp = SPECIES[a.sp];
      a.age += 5; a.hunger = Math.min(1, a.hunger + 5 / (sp.hungerHours * 60));
      if (a.age > sp.lifeDays * 1440) w.animals.remove(a);
    }
    w.flies.step(5);
    w.humus.step(5);
  }
  void E;
}
const seedAdults = (w, n) => { for (let k = 0; k < n; k++) w.animals.add('fly', { x: (k % 7) * 4 - 12, y: 6, z: (k % 5) * 3 - 6 }, { age: 3 * 1440, hunger: 0.2 }); };
const counts = (w) => ({ a: w.animals.by.fly.length, l: w.animals.by.flylarva.length, p: w.animals.by.flypupa.length });

test('development is temperature dependent: about ten days at 25 C, slower when cool, none when cold', () => {
  assert.ok(Math.abs(FLY.egg + FLY.larva + FLY.pupa - 9.8) < 0.5);
  assert.equal(rateOf(25), 1);
  assert.ok(rateOf(18) < 0.5 && rateOf(18) > 0.3);
  assert.equal(rateOf(10), 0);
  assert.equal(rateOf(36), 0);
  assert.ok(rateOf(28) > 1);
});

test('fruit and litter start a boom: eggs, maggots, pupae and new adults appear, then it busts', () => {
  const w = world();
  seedAdults(w, 6);
  w.flies.addFruit(0, 0, 2.2); w.flies.addFruit(6, 3, 2.2);
  const seen = { l: 0, p: 0, a0: 0 };
  let peakA = 0;
  for (let d = 0; d < 40; d++) {
    day(w);
    const c = counts(w);
    seen.l = Math.max(seen.l, c.l); seen.p = Math.max(seen.p, c.p); peakA = Math.max(peakA, c.a);
  }
  assert.ok(w.flies.stats.laid > 20, `eggs were laid: ${w.flies.stats.laid}`);
  assert.ok(seen.l >= 8, `maggots peaked at ${seen.l}`);
  assert.ok(seen.p >= 3, `pupae peaked at ${seen.p}`);
  assert.ok(w.flies.stats.emerged >= 3, `adults emerged: ${w.flies.stats.emerged}`);
  assert.ok(peakA < 71 + 20, 'adults stay under the cap');
  // The food runs out: the population is not still booming at day 40.
  assert.ok(counts(w).l <= seen.l, 'busted');
});

test('maggots speed up the rot: more humus and fertility than a tank without flies', () => {
  const a = world(), b = world();
  seedAdults(a, 8); a.flies.addFruit(0, 0, 2.2); a.flies.addFruit(-6, 3, 2.2); b.humus.drop(0, 0, 0);
  for (let d = 0; d < 20; d++) { day(a); day(b); }
  const sum = (w, k) => w.climate[k].reduce((s, v) => s + v, 0);
  assert.ok(sum(a, 'humus') > sum(b, 'humus'), `humus ${sum(a, 'humus').toFixed(1)} vs ${sum(b, 'humus').toFixed(1)}`);
  assert.ok(sum(a, 'fert') > sum(b, 'fert'), `fertility ${sum(a, 'fert').toFixed(1)} vs ${sum(b, 'fert').toFixed(1)}`);
  assert.ok(a.env.nitrate > 0, 'a little nitrogen is released');
});

test('cold slows the cycle and a dry or flooded cell kills the young', () => {
  const fast = world({ T: 26 }), slow = world({ T: 18 });
  for (const w of [fast, slow]) { seedAdults(w, 6); w.flies.addFruit(0, 0, 2.2); }
  for (let d = 0; d < 9; d++) { day(fast); day(slow); }
  assert.ok(fast.flies.stats.emerged + counts(fast).p >= slow.flies.stats.emerged + counts(slow).p, 'warm is ahead of cool');
  assert.equal(slow.flies.stats.emerged, 0, 'no adults yet at 18 C after nine days');
  const dry = world({ soil: 0.05 }), wet = world({ water: 1 });
  for (const w of [dry, wet]) { seedAdults(w, 6); w.flies.addFruit(0, 0, 2.2); for (let d = 0; d < 12; d++) day(w); }
  assert.equal(dry.flies.stats.laid, 0, 'no laying on bone-dry ground');
  assert.equal(wet.flies.stats.laid, 0, 'no laying in flooded cells');
});

test('the egg and fruit state is saved and loaded', () => {
  const w = world();
  seedAdults(w, 6); w.flies.addFruit(1, 2, 2); for (let d = 0; d < 2; d++) day(w);
  const s = JSON.parse(JSON.stringify(w.flies.serialize()));
  const w2 = world(); w2.flies.load(s);
  assert.equal(w2.flies.fruit.length, w.flies.fruit.length);
  assert.equal(w2.flies.eggs.length, w.flies.eggs.length);
  assert.ok(Math.abs(w2.flies.fruitTotal() - w.flies.fruitTotal()) < 0.05);
});

test('the new species are defined as tiny crawlLand animals with a cap near 150, and the hunters eat maggots', () => {
  for (const id of ['flylarva', 'flypupa']) {
    const m = SRC.match(new RegExp(`\\n  ${id}: \\{[\\s\\S]*?\\n  \\},`));
    assert.ok(m, id);
    assert.match(m[0], /kind: 'crawlLand'/); assert.match(m[0], /cap: 150/);
    assert.equal(SPECIES[id].cap, 150);
  }
  assert.match(SRC, /eats: \['fly', 'springtail', 'isopod', 'flylarva'\]/);
});
