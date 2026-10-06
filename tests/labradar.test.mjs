// The test lab's bug radar (src/sim/labradar.js) on made-up animals: each check fires on the fault it is for, and stays quiet on a
// healthy walk, a hop and a frog's quick twist in the air.
import test from 'node:test';
import assert from 'node:assert/strict';
import { check, newState, overlapping, T } from '../src/sim/labradar.js';

const B = { hw: 45, hd: 22.5, h: 60 };
const mk = (o = {}) => ({ pos: { x: 0, y: 3, z: 0 }, yaw: 0, pitch: 0, ...o });
const ctx = (o = {}) => ({ dt: 0.05, t: 0, size: 1, ground: 3, bounds: B, tableSpeed: 3, ...o });
const kinds = (list) => list.map((f) => f.kind);

// Walks an animal along `path(i)` and returns every flag raised.
function run(path, n = 200, dt = 0.05, c = {}) {
  const s = newState(), got = [];
  for (let i = 0; i < n; i++) {
    const a = path(i);
    got.push(...check(s, a, ctx({ dt, t: i * dt, ...c })));
  }
  return got;
}

test('a healthy walk and a hop raise nothing', () => {
  assert.deepEqual(run((i) => mk({ pos: { x: i * 0.1, y: 3, z: 0 }, yaw: 1.5 })), []);
  // a hop: 5 cm in 0.4 s, with a quick twist (excused while hopping)
  const got = run((i) => mk({ pos: { x: (i % 8) * 0.6, y: 3 + Math.sin(((i % 8) / 8) * Math.PI) * 2, z: 0 }, hop: true, yaw: (i % 8 < 2 ? 1 : 0) * 3 }), 160);
  assert.deepEqual(kinds(got).filter((k) => k !== 'teleport'), []);
});

test('a position that is not a number is bad, and the sample after it does not compare with it', () => {
  const s = newState();
  assert.deepEqual(kinds(check(s, mk({ pos: { x: NaN, y: 3, z: 0 } }), ctx())), ['nan']);
  assert.deepEqual(check(s, mk(), ctx()), []);
});

test('outside the tank, under the ground, stranded', () => {
  assert.ok(kinds(check(newState(), mk({ pos: { x: 50, y: 3, z: 0 } }), ctx())).includes('outside'));
  assert.ok(kinds(check(newState(), mk({ pos: { x: 0, y: 1, z: 0 } }), ctx())).includes('underground'));
  assert.ok(!kinds(check(newState(), mk({ pos: { x: 0, y: 1, z: 0 }, onWall: true }), ctx())).includes('underground'), 'a gecko on the wall is not under the ground');
  assert.ok(!kinds(check(newState(), mk({ pos: { x: 0, y: 2.8, z: 0 } }), ctx())).includes('underground'), 'a little sinking is not a bug');
  assert.ok(kinds(check(newState(), mk({ stranded: true }), ctx({ swim: true }))).includes('stranded'));
});

test('a jump of 8 cm in one step is a teleport; a fast but smooth move is not', () => {
  const got = run((i) => mk({ pos: { x: i < 100 ? 0 : 8, y: 3, z: 0 } }));
  assert.deepEqual(kinds(got), ['teleport']);
  assert.deepEqual(run((i) => mk({ pos: { x: i * 0.9, y: 3, z: 0 } }), 40), [], '18 cm/s is a fast walk, not a pop');
});

test('a spin of more than 9 rad/s is flagged on the ground, excused in a hop and for fish', () => {
  assert.ok(kinds(run((i) => mk({ yaw: i % 2 ? 0 : 1 }))).includes('spin'));
  assert.ok(!kinds(run((i) => mk({ yaw: i % 2 ? 0 : 1, hop: true }))).includes('spin'));
  assert.ok(!kinds(run((i) => mk({ yaw: i % 2 ? 0 : 1 }), 200, 0.05, { swim: true })).includes('spin'));
});

test('a crab turning its heading by half a turn as it swaps sides is not a spin or a shiver', () => {
  assert.ok(!kinds(run((i) => mk({ yaw: i % 2 ? 0 : 3 }), 200, 0.05, { sideways: true })).some((k) => k === 'spin' || k === 'jitter'));
});

test('a heading that reverses six times in two seconds is a shiver', () => {
  const got = run((i) => mk({ yaw: (i % 2 ? 0.2 : -0.2) }), 120, 0.1);
  assert.ok(kinds(got).includes('jitter'));
  assert.ok(!kinds(run((i) => mk({ yaw: i * 0.03 }), 200)).includes('jitter'), 'a steady turn is not a shiver');
});

test('tipped over on level ground is a flip', () => {
  assert.ok(kinds(check(newState(), mk({ pitch: 1.4 }), ctx())).includes('flip'));
  assert.ok(!kinds(check(newState(), mk({ pitch: 1.4 }), ctx({ swim: true }))).includes('flip'));
});

test('a drive that makes no headway for six seconds is stuck; one that is moving is not; one with no goal is not', () => {
  const lab = { drive: { type: 'path' }, goal: { x: 30, z: 0 } };
  const still = run(() => mk({ lab }), 160, 0.05);
  assert.ok(kinds(still).includes('stuck'));
  const moving = run((i) => mk({ pos: { x: i * 0.1, y: 3, z: 0 }, lab }), 400, 0.05);
  assert.ok(!kinds(moving).includes('stuck'));
  assert.ok(!kinds(run(() => mk({ lab: { drive: { type: 'path' }, goal: null } }), 400)).includes('stuck'), 'waiting at a goal is not stuck');
  assert.ok(!kinds(run(() => mk({ lab: { drive: { type: 'goto' }, goal: { x: 0.5, z: 0 } } }), 400)).includes('stuck'), 'already there');
});

test('a go-to that has not arrived after its budget is flagged once', () => {
  const lab = { drive: { type: 'goto', done: false, d0: 20 }, goal: { x: 20, z: 0 }, stats: { t: 0 } };
  const s = newState(), got = [];
  for (let i = 0; i < 100; i++) { lab.stats.t = i; got.push(...check(s, mk({ pos: { x: 0, y: 3, z: 0 }, lab }), ctx({ t: i, dt: 1 }))); }
  assert.equal(kinds(got).filter((k) => k === 'notarriving').length, 1);
});

test('two bodies whose centres are inside 45 % of their radii together overlap', () => {
  const A = { pos: { x: 0, y: 3, z: 0 }, r: 1 }, B2 = { pos: { x: 0.5, y: 3, z: 0 }, r: 1 }, C = { pos: { x: 1.5, y: 3, z: 0 }, r: 1 };
  assert.ok(overlapping(A, B2) != null);
  assert.equal(overlapping(A, C), null);
  assert.ok(T.teleportMin > 0);
});

test('a wall goal is judged across and up: a gecko climbing is not stuck, one that does not climb is', () => {
  const lab = { drive: { type: 'goto', wall: true }, goal: { x: 0, y: 40, z: -22, wall: true } };
  const climbing = run((i) => mk({ pos: { x: 0, y: 3 + i * 0.1, z: -20 }, lab }), 400, 0.05);
  assert.ok(!kinds(climbing).includes('stuck'), 'climbing 2 cm/s is headway even with no change in z');
  const stuck = run(() => mk({ pos: { x: 0, y: 12, z: -20 }, onWall: true, lab }), 160, 0.05);
  assert.ok(kinds(stuck).includes('stuck'));
});
