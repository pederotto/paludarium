// Personal space (owner, 10 Oct 2026): sim/space.js (bubble, pressure, the need over time) and the goal contract's inbound half
// (animal.offerGoal, each mind's own offer: taken only when what the mind is doing allows).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SPACE, spaceClass, spaceProfile, bubble, press, needStep, R_MIN, R_MAX, REST, NEED_MAX } from '../src/sim/space.js';
import { offerGoal } from '../src/sim/goals.js';
import { shrimpMind } from '../src/sim/shrimp.js';
import { fishMind } from '../src/sim/fishmind.js';
import { skinkMind } from '../src/sim/skink.js';
import { crabMind } from '../src/sim/crab.js';
import { herpMindFor } from '../src/sim/herp.js';

test('space class follows the species sheet: school, territorial, group by the fewest it is kept in, else solitary', () => {
  assert.equal(spaceClass({ school: true, flock: [10, 80] }), 'school');
  assert.equal(spaceClass({ territorial: true, flock: [1, 2] }), 'territorial');
  assert.equal(spaceClass({ flock: [6, 40] }), 'group');
  assert.equal(spaceClass({ flock: [2, 5] }), 'solitary');
  assert.equal(spaceClass({}), 'solitary');
  assert.ok(SPACE.school.patience > SPACE.group.patience && SPACE.group.patience > SPACE.solitary.patience && SPACE.solitary.patience > SPACE.territorial.patience);
});

test('bubble scales with body length and stays within its limits', () => {
  const P = SPACE.solitary;
  assert.equal(bubble(P, 4, true), 6);
  assert.equal(bubble(P, 4, false), 4);
  assert.equal(bubble(P, 0.2, true), R_MIN);
  assert.equal(bubble(SPACE.territorial, 20, true), R_MAX);
});

test('pressure: 0 at the bubble edge, 1 touching, a smaller body counts by its share', () => {
  assert.equal(press(10, 10), 0);
  assert.equal(press(0, 10), 1);
  assert.equal(press(5, 10), 0.5);
  assert.equal(press(5, 10, 0.5), 0.25);
  assert.equal(press(5, 10, 3), 0.5);
});

test('the need fills while shared, drains alone, fills slower at rest and for a patient temper', () => {
  const P = SPACE.group;
  let n = 0, t = 0;
  while (n < 1 && t < 1000) { n = needStep(n, 0.5, 0.5, P); t += 0.5; }
  assert.ok(Math.abs(t - P.patience) <= 1, `fills in its patience with one neighbour halfway in (${t} s)`);
  let r = 0, tr = 0;
  while (r < 1 && tr < 5000) { r = needStep(r, 0.5, 0.5, P, true); tr += 0.5; }
  assert.ok(Math.abs(tr - P.patience * REST) <= 1, 'a resting body bears it REST times longer');
  let k = 0, tk = 0;
  while (k < 1 && tk < 5000) { k = needStep(k, 0.5, 0.5, P, false, 1.3); tk += 0.5; }
  assert.ok(tk > t, 'a patient one waits longer');
  let d = 1, td = 0;
  while (d > 0 && td < 1000) { d = needStep(d, 0, 0.5, P); td += 0.5; }
  assert.ok(Math.abs(td - P.relief) <= 1, 'drains in its relief time alone');
  assert.equal(needStep(NEED_MAX, 5, 10, P), NEED_MAX);
});

test('offerGoal: the mind decides; a mind without offer() never takes one; the engine writes nothing into the mind', () => {
  const g = { x: 3, z: 4, d: 5 };
  const a = { mind: fishMind({ speed: 4 }) };
  assert.equal(offerGoal.call(a, g, 'space'), false);
  assert.equal(offerGoal.call({}, g, 'space'), false);

  const sh = shrimpMind(() => 0.5); sh.mode = 'graze'; sh.soft = 0; sh.fear = 0;
  assert.equal(offerGoal.call({ mind: sh }, g, 'space'), true);
  assert.deepEqual([sh.goal.x, sh.goal.z], [3, 4]);
  assert.notEqual(sh.goal, g, 'the mind keeps its own copy (the engine reuses its offer object)');
  for (const mode of ['food', 'hide', 'moult', 'swarm']) { const m = shrimpMind(() => 0.5); m.mode = mode; assert.equal(offerGoal.call({ mind: m }, g), false, mode); }

  const sk = skinkMind(() => 0.5); sk.mode = 'forage';
  assert.equal(offerGoal.call({ mind: sk }, g), true);
  assert.ok(sk.walkT > 0, 'walked at once');
  for (const mode of ['hide', 'flee', 'freeze', 'bask', 'rest']) { const m = skinkMind(() => 0.5); m.mode = mode; assert.equal(offerGoal.call({ mind: m }, g), false, mode); }

  const cb = crabMind(() => 0.5); cb.mode = 'forage';
  assert.equal(offerGoal.call({ mind: cb }, g), true);
  for (const mode of ['hide', 'flee', 'eat', 'display', 'rest']) { const m = crabMind(() => 0.5); m.mode = mode; assert.equal(offerGoal.call({ mind: m }, g), false, mode); }

  const hp = herpMindFor('newt', () => 0.5); hp.mode = 'forage';
  assert.equal(offerGoal.call({ mind: hp }, g), true);
  assert.ok(hp.moveLeft >= 6 && hp.pauseLeft === 0, 'its next leg, walked at once');
  for (const mode of ['rest', 'hide', 'flee', 'court', 'patrol']) { const m = herpMindFor('newt', () => 0.5); m.mode = mode; assert.equal(offerGoal.call({ mind: m }, g), false, mode); }
});

test('animals.js: the space goal goes through offerGoal and isValidGoal, never straight into a mind', () => {
  const src = fs.readFileSync(new URL('../src/sim/animals.js', import.meta.url), 'utf8');
  const i = src.indexOf('  spaceTick(dt) {'), j = src.indexOf('\n  }\n', i);
  assert.ok(i > 0 && j > i);
  const body = src.slice(i, j);
  assert.match(body, /a\.offerGoal\(/);
  assert.match(body, /this\.isValidGoal\(a, gx, gz\)/);
  assert.doesNotMatch(body, /\b(fm|sm|sk|cb|hm|mind)\.goal\s*=/);
  assert.doesNotMatch(body, /new |\[\]|=> /, 'allocation-free in the loop');
  assert.doesNotMatch(src, /\bm\.(goal|goalOk)\s*=[^=]/, 'no engine write into a mind (the herp flight goes through offerGoal too)');
  assert.doesNotMatch(src, /abortGoal\('blocked', BLOCKED_BAN_MS\)/, 'a blocked walk bans the spot it could not get to, not where it stands');
});

test('herp flight offer: taken while fleeing, marks the flight vetted even with no goal', () => {
  const m = herpMindFor('newt', () => 0.5); m.mode = 'flee'; m.goalOk = false; m.goal = { x: 9, z: 9 };
  assert.equal(offerGoal.call({ mind: m }, null, 'flight'), false);
  assert.equal(m.goalOk, true);
  assert.deepEqual(m.goal, { x: 9, z: 9 });
  assert.equal(offerGoal.call({ mind: m }, { x: 1, z: 2 }, 'flight'), true);
  assert.deepEqual(m.goal, { x: 1, z: 2 });
  const r = herpMindFor('newt', () => 0.5); r.mode = 'forage';
  assert.equal(offerGoal.call({ mind: r }, { x: 1, z: 2 }, 'flight'), false);
});
