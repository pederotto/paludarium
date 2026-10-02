// Background jobs: generators shared out in small pieces under a time budget.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Jobs } from '../src/sim/jobs.js';

const counter = (n, log, name = 'a') => (function* () { for (let i = 0; i < n; i++) { log.push(name + i); yield; } })();
const spin = (ms) => { const t = performance.now(); while (performance.now() - t < ms); };

test('pump always runs at least one piece, and a job finishes however small the budget', () => {
  const j = new Jobs(), log = [];
  j.add(counter(5, log));
  assert.ok(j.busy);
  let frames = 0;
  while (j.busy && frames < 100) { j.pump(1e-9); frames++; }
  assert.equal(log.length, 5);
  assert.ok(!j.busy);
  assert.ok(frames <= 6, `${frames} frames`);
});

test('pump stops once the budget is spent and resumes where it left off', () => {
  const j = new Jobs(), log = [];
  j.add((function* () { for (let i = 0; i < 6; i++) { log.push(i); spin(3); yield; } })());
  j.pump(5);                                 // two pieces of 3 ms fit in 5 ms (the second overshoots a little)
  assert.ok(log.length >= 1 && log.length <= 3, `ran ${log.length} pieces`);
  const n = log.length;
  j.pump(1000);
  assert.equal(log.length, 6);
  assert.ok(n < 6);
  assert.ok(!j.busy);
});

test('jobs run oldest first; a zero or negative budget runs nothing; clear drops them', () => {
  const j = new Jobs(), log = [];
  j.add(counter(2, log, 'a')); j.add(counter(2, log, 'b'));
  j.pump(0); j.pump(-3);
  assert.equal(log.length, 0);
  j.pump(1000);
  assert.deepEqual(log, ['a0', 'a1', 'b0', 'b1']);
  j.add(counter(3, log, 'c'));
  j.clear();
  assert.ok(!j.busy);
  j.pump(1000);
  assert.equal(log.length, 4);
});
