// The vampire crab's behaviour (src/sim/crab.js): every rule of the keeper's sheet that the sim acts on, checked on the
// pure brain with fixed senses and a fixed random source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CRAB, crabMind, crabThink, crabHeading, crabComfort, dryRate, crabCapacity, crabGroupIssue, crabGaitRate } from '../src/sim/crab.js';
import { crabStride } from '../src/util/gait.js';

const seq = (seed = 1) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
// A comfortable night on damp land: the crab should be out.
const base = (o = {}) => ({ t: 0, dt: 0.1, dtMin: 0.1, x: 0, z: 0, depth: -1, wetGround: 0.5, light: 0, rain: 0, rh: 85, temp: 26, cover: 0, hunger: 0.5, food: null, threat: null, other: null, home: { x: 10, z: 0 }, shore: { x: -8, z: 0, d: 8 }, bank: null, male: false, ...o });
function run(m, s, seconds, rnd, each = null) {
  const out = [];
  for (let t = 0; t < seconds; t += s.dt) { const i = crabThink(m, { ...s, t }, rnd); out.push(i); each?.(i, t); }
  return out;
}

test('comfort follows the keeper ranges: 24-28 °C and 80-90% humidity', () => {
  assert.equal(crabComfort(26, 85), 1);
  assert.equal(crabComfort(24, 80), 1);
  assert.ok(crabComfort(20, 85) < 0.01);
  assert.ok(crabComfort(26, 60) < 0.01);
  assert.ok(crabComfort(26, 70) > 0.4 && crabComfort(26, 70) < 0.6);
});

test('gills dry faster in dry, hot air and slower on wet ground', () => {
  assert.ok(dryRate(60, 26) > dryRate(85, 26) * 2);
  assert.ok(dryRate(85, 30) > dryRate(85, 26));
  assert.ok(dryRate(85, 26, 1) < dryRate(85, 26, 0) * 0.5);
  assert.ok(Math.abs(dryRate(85, 26) - 1 / CRAB.dryMin) < 1e-9);
});

test('out at night, foraging in bursts with stops', () => {
  const m = crabMind(seq(3));
  const it = run(m, base(), 30, seq(4));
  assert.ok(it.some((i) => i.mode === 'forage'));
  const moving = it.filter((i) => i.speed > 0).length, still = it.filter((i) => i.speed === 0).length;
  assert.ok(moving > 20 && still > 20, `bursts and pauses: ${moving} moving, ${still} still`);
  assert.ok(it.every((i) => i.speed <= CRAB.speed * 1.6 + 1e-9));
});

test('by day in the lamp it goes home and sinks into its burrow', () => {
  const m = crabMind(seq(5));
  const s = base({ light: 1, rh: 82, x: 10, z: 0, home: { x: 10, z: 0 } });
  const it = run(m, s, 5, seq(6));
  assert.equal(it.at(-1).mode, 'hide');
  assert.ok(it.at(-1).sink > 0.55, 'sunk until the eyes show');
});

test('dry gills send it to the shallows, and it stays there until wet', () => {
  const m = crabMind(seq(7));
  m.wet = 0.2;
  const it = crabThink(m, base({ rh: 70 }), seq(8));
  assert.equal(it.mode, 'soak');
  assert.ok(!it.goal || (it.goal.x === -8 && it.goal.z === 0));
  const s = base({ depth: 1, x: -8 });
  let last;
  run(m, s, 60, seq(9), (i) => { last = i; });
  assert.ok(m.wet > 0.95);
  assert.notEqual(last.mode, 'soak', 'leaves once wet');
});

test('in water deeper than it can stand it heads for the bank; with no bank it eventually drowns and the keeper is told', () => {
  const m = crabMind(seq(10));
  const deep = base({ depth: 6, bank: { x: 3, z: 0, d: 3 } });
  const a = crabThink(m, deep, seq(11));
  assert.equal(a.mode, 'exit');
  assert.deepEqual(a.goal, { x: 3, z: 0 });
  const m2 = crabMind(seq(12));
  const trap = base({ depth: 6, bank: null, dt: 1, dtMin: 1 });
  let said = 0, drowned = false;
  for (let k = 0; k < 200; k++) { const i = crabThink(m2, trap, seq(13)); if (i.say) said++; if (i.drown) drowned = true; }
  assert.equal(said, 1, 'one warning');
  assert.ok(drowned);
});

test('a looming threat: it freezes first, then runs home', () => {
  const m = crabMind(seq(14));
  const s = base({ threat: { x: 2, z: 0, d: 2 }, home: { x: -10, z: 0 } });
  const it = run(m, s, 3, seq(15));
  assert.equal(it[0].mode, 'flee');
  assert.equal(it[0].speed, 0, 'freezes');
  const r = it.find((i) => i.speed > 0);
  assert.ok(r && r.goal.x === -10, 'then runs for home');
  assert.ok(r.speed > CRAB.speed * 1.5);
});

test('food within reach: it stops, faces it and eats bite by bite', () => {
  const m = crabMind(seq(16));
  const it = run(m, base({ food: { x: 0.5, z: 0.5, d: 0.7, kind: 'flake' } }), 4, seq(17));
  assert.ok(it.every((i) => i.mode === 'eat' && i.speed === 0 && i.face));
  assert.equal(it.filter((i) => i.eat).length, 2);
  assert.ok(it.every((i) => i.feed === 1 && i.claw === 0), 'the feeding cycle runs (claws down, snap, to the mouth), not a plain raise');
});

test('foraging: it picks at the ground between bursts, claws ready while it walks; a display holds the pincers open', () => {
  const m = crabMind(seq(3));
  const it = run(m, base(), 30, seq(4)).filter((i) => i.mode === 'forage');
  const still = it.filter((i) => i.calm === 1), moving = it.filter((i) => i.speed > 0);
  assert.ok(still.length > 20 && still.every((i) => i.feed > 0.5), 'picks at food while it stands');
  assert.ok(moving.length > 20 && moving.every((i) => i.feed === 0 && i.pinch > 0 && i.pinch < 0.5), 'claws half open while it walks');
  const d = run(crabMind(seq(18)), base({ male: true, other: { x: 4, z: 0, d: 4, male: false } }), 2, seq(19));
  assert.ok(d.every((i) => i.pinch >= 0.8), 'a threat display shows open pincers');
  assert.ok(run(crabMind(seq(7)), base({ food: null, hunger: 0 }), 5, seq(8)).every((i) => i.feed <= 1 && i.pinch <= 1), 'in range');
});

test('a male waves its claws at a female and charges a rival that stays', () => {
  const m = crabMind(seq(18));
  const it = run(m, base({ male: true, other: { x: 4, z: 0, d: 4, male: false } }), 4, seq(19));
  assert.ok(it.every((i) => i.mode === 'display'));
  assert.ok(Math.max(...it.map((i) => i.claw)) > 0.9, 'claws raised high');
  assert.ok(it.every((i) => i.speed === 0), 'no charge at a female');
  const m2 = crabMind(seq(20));
  const r = run(m2, base({ male: true, other: { x: 3, z: 0, d: 3, male: true } }), 5, seq(21));
  assert.ok(r.some((i) => i.speed > 0 && i.goal.x === 3), 'charges a rival male');
});

test('different colour morphs fight', () => {
  const m = crabMind(seq(22));
  const r = run(m, base({ male: true, morph: 'purple', other: { x: 3, z: 0, d: 3, male: false, morph: 'orange' } }), 5, seq(23));
  assert.ok(r.some((i) => i.speed > 0));
});

test('molts in its burrow for a day or more, then hides while soft', () => {
  const m = crabMind(seq(24));
  m.moltIn = 0;
  const s = base({ x: 10, z: 0, dt: 60, dtMin: 60 });
  const first = crabThink(m, { ...s, dt: 1, dtMin: 1 }, seq(25));
  assert.equal(first.mode, 'molt');
  assert.equal(first.sink, 1);
  let hours = 0;
  while (m.mode === 'molt' && hours < 48) { crabThink(m, s, seq(26)); hours++; }
  assert.ok(hours >= CRAB.moltHours[0] - 1 && hours <= CRAB.moltHours[1] + 1, `molt took ${hours} h`);
  assert.equal(crabThink(m, { ...s, dt: 1, dtMin: 1 }, seq(27)).mode, 'hide');
});

test('either side may lead: the heading needs at most a quarter turn', () => {
  for (let k = 0; k < 64; k++) {
    const dir = (k / 64) * Math.PI * 2, yaw0 = Math.sin(k * 7.1) * 3;
    const h = crabHeading(Math.sin(dir), Math.cos(dir), yaw0);
    const turn = Math.abs(((h.yaw - yaw0 + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI);
    assert.ok(turn <= Math.PI / 2 + 1e-9, `turn ${turn}`);
    assert.ok(Math.abs(Math.abs(h.lead) - 1) < 1e-9);
  }
});

test('the leg cycle matches the stride (no foot slip) and the keeper capacity', () => {
  assert.ok(Math.abs(crabGaitRate(2.1) * crabStride(2.1) - Math.PI * 2) < 1e-12);
  assert.equal(crabCapacity(50 * 25 * 0.8), 3);                  // a 10 gallon tank, 80% land: 3 crabs
  assert.equal(crabGroupIssue(1, 2), null);
  assert.ok(crabGroupIssue(2, 2));
});

test('the baked crabs carry their claw rig: hinge, opening axis and feeding targets, well formed', async () => {
  const fs = await import('node:fs');
  const man = JSON.parse(fs.readFileSync(new URL('../public/assets/creatures/manifest.json', import.meta.url), 'utf8'));
  for (const id of ['crab', 'panther', 'cambarellus']) {      // (the crayfish's claws are rig ids 15 and 16, the fit is keyed 5 and 6 by side all the same)
    const C = man[id]?.finish?.claws;
    assert.ok(C && C[5] && C[6], `${id}: claws 5 and 6 fitted (tools/rig/claws.mjs)`);
    for (const k of [5, 6]) {
      const c = C[k], u = (v) => Math.hypot(...v);
      for (const f of ['h', 'a', 'tip', 'ground', 'mouth']) assert.ok(c[f].length === 3 && c[f].every(Number.isFinite), `${id} ${k} ${f}`);
      assert.ok(Math.abs(u(c.a) - 1) < 0.02, `${id} ${k}: unit hinge axis`);
      assert.ok(c.shut >= 0.05 && c.shut <= 0.6, `${id} ${k}: the angle that shuts the pincer is small and positive`);
      assert.ok(c.t0 > 0.3 && c.t0 < 0.95, `${id} ${k}: fingers part past the palm`);
      assert.ok(Math.abs(c.mouth[0]) < 1e-6 && c.mouth[1] < 1, `${id} ${k}: the mouth is low on the midline`);
      assert.ok(Math.hypot(c.ground[0] - c.tip[0], c.ground[2] - c.tip[2]) < 1.5 * c.len, `${id} ${k}: it reaches a claw's length, not across the tank`);
    }
  }
});

test('gills drying with no water in reach: it searches on foot, it does not stand still', () => {
  const m = crabMind(seq(31)); m.wet = 0.2;
  const it = run(m, base({ shore: null, depth: -1, hunger: 0.6 }), 40, seq(32));
  assert.ok(it.every((i) => i.mode !== 'soak'), 'nowhere to soak');
  assert.ok(it.some((i) => i.speed > 0), 'it moves');
  const m2 = crabMind(seq(33)); m2.wet = 0.2;
  assert.ok(run(m2, base({ shore: { x: 4, z: 0 }, depth: -1 }), 5, seq(34)).some((i) => i.mode === 'soak'), 'with water in reach it goes to soak');
});

test('a stand-off with another crab ends: it does not face it for ever', () => {
  const m = crabMind(seq(41));
  const s = base({ male: true, other: { x: 5, z: 0, d: 5, male: true } });
  const it = run(m, s, 60, seq(42));
  const first = it.findIndex((i) => i.mode === 'display'), last = it.map((i) => i.mode).lastIndexOf('display');
  assert.ok(first >= 0, 'it displays at first');
  assert.ok(it.slice(Math.round(30 / 0.1)).some((i) => i.mode !== 'display'), 'and turns away after about 25 s');
  assert.ok(last - first >= 0);
});
