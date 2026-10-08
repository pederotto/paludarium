// R6a: the stuck watchdog reads a swimmer's own intent (src/sim/stuckintent.js). Table of states -> intent, the 150 s cap, insideSolid first,
// and the walker predicates untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stuckIntent, asleep, HOLD_CAP } from '../src/sim/stuckintent.js';

const fish = (o = {}) => ({ pos: { x: 0, z: 0 }, fm: { goal: { x: 0.4, z: 0 }, resting: false, fleeT: 0, I: { hold: true, escape: false } }, ...o });
const SP = { kind: 'swim' };

test('HOLD_CAP is the owner\'s 150 s', () => assert.equal(HOLD_CAP, 150));

test('intent table', () => {
  assert.equal(stuckIntent(fish(), SP), 'hold');                                                    // within 1 cm of its spot
  assert.equal(stuckIntent(fish({ fm: { ...fish().fm, goal: { x: 1.8, z: 0 } } }), SP), 'creep');    // 1-2.5 cm
  assert.equal(stuckIntent(fish({ fm: { ...fish().fm, goal: { x: 6, z: 0 } } }), SP), 'go');         // a real spot
  assert.equal(stuckIntent(fish({ fm: { ...fish().fm, goal: { x: 6, z: 0 }, resting: true } }), SP), 'rest');
  assert.equal(stuckIntent(fish({ nib: { t: 0.4 }, fm: { ...fish().fm, goal: { x: 6, z: 0 } } }), SP), 'hold');   // nibbling beats a far spot
  assert.equal(stuckIntent(fish({ fm: { ...fish().fm, fleeT: 2, goal: { x: 0, z: 0 } } }), SP), 'go');
  assert.equal(stuckIntent(fish({ fm: { ...fish().fm, I: { hold: false, escape: true } } }), SP), 'go');
  assert.equal(stuckIntent(fish({ dart: { t: 1 } }), SP), 'go');
  assert.equal(stuckIntent({ pos: { x: 0, z: 0 }, rest: { resting: true } }, SP), 'rest');          // a tadpole on the floor
  assert.equal(stuckIntent({ pos: { x: 0, z: 0 } }, SP), 'none');                                    // no mind: watchdog as before
  assert.deepEqual(['rest', 'hold', 'creep', 'go', 'none'].filter(asleep), ['rest', 'hold', 'creep']);
});

test('a Lab drive goal is go (the masking control); a driven animal with no goal holds', () => {
  assert.equal(stuckIntent(fish({ lab: { drive: {}, goal: { x: 9, z: 9 } } }), SP), 'go');
  assert.equal(stuckIntent(fish({ lab: { drive: {}, goal: null } }), SP), 'hold');
});

test('an asleep intent lasts at most HOLD_CAP seconds in a row, then the watchdog is awake', () => {
  assert.equal(stuckIntent(fish(), SP, { holdS: 149.9, cap: HOLD_CAP }), 'hold');
  assert.equal(stuckIntent(fish(), SP, { holdS: 150.1, cap: HOLD_CAP }), 'go');
  assert.equal(stuckIntent(fish({ nib: {} }), SP, { holdS: 200, cap: HOLD_CAP }), 'go');
  assert.equal(stuckIntent(fish({ fm: { ...fish().fm, goal: { x: 6, z: 0 } } }), SP, { holdS: 999, cap: HOLD_CAP }), 'go');
});

test('animals.js: insideSolid is checked before any intent; only the swim case of wantsMove changed', () => {
  const src = fs.readFileSync(new URL('../src/sim/animals.js', import.meta.url), 'utf8');
  const keep = src.slice(src.indexOf('  keepFree(a, sp, dt) {'), src.indexOf('  // --- Turning'));
  assert.ok(keep.indexOf('this.insideSolid(a, sp)') > 0 && keep.indexOf('this.insideSolid(a, sp)') < keep.indexOf('stuckIntent('), 'penetration first');
  const w = src.slice(src.indexOf('  wantsMove(a, sp'), src.indexOf('  keepFree(a, sp, dt) {'));
  assert.match(w, /case 'swim': \{ const k = stuckIntent\(/);
  // shrimp / newt / axolotl / snail / crab predicates are the pre-R6a lines
  assert.ok(w.includes("case 'crawlWater': case 'crawlLand': case 'crab': return a.state === 'walk' && !!a.target && Math.hypot(a.target.x - a.pos.x, a.target.z - a.pos.z) > 0.5;"));
  assert.ok(w.includes("case 'newt': case 'axolotl': return a.herp ? !!a.wantMove : a.swimming ? true : a.state === 'walk' && !!a.target;"));
});
