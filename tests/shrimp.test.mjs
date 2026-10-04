// The dwarf shrimp's mind (src/sim/shrimp.js): grazing, food, the tail flick, the moult, the males' search, eggs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { shrimpMind, shrimpThink, shrimpDoing, SHRIMP } from '../src/sim/shrimp.js';

// A fixed random sequence so a run is the same every time.
const seq = (seed = 7) => { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };
const base = (o = {}) => ({ t: 0, dt: 0.1, dtMin: 0.1, x: 0, z: 0, yaw: 0, adult: true, female: false, hunger: 0.5, cover: 0, rich: 0.5,
  spots: () => [{ x: 5, z: 0, d: 5, rich: 0.8 }, { x: -12, z: 3, d: 12.4, rich: 0.6 }], ...o });
const run = (m, s, steps, rnd) => { let it; for (let i = 0; i < steps; i++) { it = shrimpThink(m, { ...s, t: i * s.dt }, rnd); if (it.goal && !it.swim) { const dx = it.goal.x - s.x, dz = it.goal.z - s.z, d = Math.hypot(dx, dz); const st = Math.min(d, it.speed * s.dt); if (d > 0) { s.x += dx / d * st; s.z += dz / d * st; } } } return it; };

test('left alone it grazes: pincers picking most of the time, a shuffle or a move to a new patch now and then', () => {
  const rnd = seq(), m = shrimpMind(rnd); m.moultIn = 99;
  const s = base();
  let feeding = 0, moved = 0, n = 2400;
  for (let i = 0; i < n; i++) {
    const it = shrimpThink(m, { ...s, t: i * 0.1 }, rnd);
    if (it.feed > 0.5) feeding++;
    if (it.goal) { moved++; const dx = it.goal.x - s.x, dz = it.goal.z - s.z, d = Math.hypot(dx, dz); if (d > 0) { const st = Math.min(d, it.speed * 0.1); s.x += dx / d * st; s.z += dz / d * st; } }
    assert.equal(it.mode, 'graze');
  }
  assert.ok(feeding / n > 0.55, `picking ${feeding}/${n}`);
  assert.ok(moved > 0, 'it moved now and then');
  assert.ok(Math.hypot(s.x, s.z) > 1, 'over four minutes it went somewhere else');
});

test('food is smelt once its scent has had time to spread, walked or swum to, then eaten at', () => {
  const rnd = seq(3), m = shrimpMind(rnd); m.moultIn = 99;
  const far = { x: 20, z: 0, d: 20, age: 5 };
  assert.notEqual(shrimpThink(m, base({ food: far }), rnd).mode, 'food', 'not before the scent arrives');
  const it = shrimpThink(m, base({ food: { ...far, age: 20 * SHRIMP.smellS + 1 } }), rnd);
  assert.equal(it.mode, 'food');
  assert.ok(it.goal && it.goal.x > 15, 'heads for it');
  assert.equal(it.swim, true, 'a long way: it swims');
  const at = shrimpThink(m, base({ x: 19.6, food: { x: 20, z: 0, d: 0.4, age: 99 } }), rnd);
  assert.equal(at.eating, true); assert.equal(at.feed, 1);
  assert.equal(shrimpDoing(at), 'Eating');
});

test('danger close by: a tail flick away from it, then it hides for a while', () => {
  const rnd = seq(5), m = shrimpMind(rnd); m.moultIn = 99;
  const it = shrimpThink(m, base({ threat: { x: 1, z: 0, d: 1 } }), rnd);
  assert.deepEqual(it.flick, { x: 1, z: 0 });
  const again = shrimpThink(m, base({ threat: { x: 1, z: 0, d: 1 } }), rnd);
  assert.equal(again.flick, null, 'not a second flick straight after');
  assert.equal(again.mode, 'hide');
});

test('the moult: to cover, still, the shell is cast, then soft and hiding', () => {
  const rnd = seq(9), m = shrimpMind(rnd); m.moultIn = 0;
  const s = base({ hide: { x: 3, z: 0, d: 3 } });
  let it = shrimpThink(m, s, rnd);
  assert.equal(it.mode, 'moult'); assert.ok(it.goal, 'goes to cover first');
  s.hide = { x: 0.2, z: 0, d: 0.2 }; s.cover = 0.8;
  let cast = false;
  for (let i = 0; i < 200 && !cast; i++) { it = shrimpThink(m, s, rnd); cast = it.moult; }
  assert.ok(cast, 'the shell is cast');
  assert.ok(m.soft > 0 && m.moultIn > 5);
  assert.equal(shrimpThink(m, s, rnd).mode, 'hide');
});

test('a grown female moults ready: the call goes out and she is berried; a male hearing it searches, swimming', () => {
  const rnd = seq(11), f = shrimpMind(rnd); f.moultIn = 0;
  const sf = base({ female: true, mates: true, cover: 0.9 });
  let it, call = false;
  for (let i = 0; i < 200 && !call; i++) { it = shrimpThink(f, sf, rnd); call = !!it.call; }
  assert.ok(call); assert.ok(f.berried > 20, 'carrying eggs for about a month');
  // Released after the month; fanning while she grazes meanwhile.
  f.soft = 0; f.mode = 'graze'; f.moultIn = 99;
  const g = shrimpThink(f, base({ female: true }), rnd);
  assert.equal(g.berried, 1);
  let male = null;
  for (let k = 0; k < 20 && (!male || male.mode !== 'swarm'); k++) { const mm = shrimpMind(seq(20 + k)); mm.moultIn = 99; male = mm; shrimpThink(mm, base({ call: { x: 5, z: 5, d: 7 } }), seq(20 + k)); }
  assert.equal(male.mode, 'swarm');
  const sw = shrimpThink(male, base(), rnd);
  assert.equal(sw.swim, true); assert.ok(sw.goal);
  // The search ends.
  const done = run(male, base({ dt: 1, dtMin: 1 }), 120, rnd);
  assert.notEqual(done.mode, 'swarm');
});
