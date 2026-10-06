// The test lab's exact-size obstacles (src/sim/labshapes.js): footprints, heights, edges and how shapes combine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { maskAt, heightAfter, local, EDGE, FLOOR_MIN, DEFAULTS, KINDS } from '../src/sim/labshapes.js';

const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

test('a step is its full height on top, nothing beyond its edge, and a short slope in between', () => {
  const s = { kind: 'step', x: 0, z: 0, w: 10, d: 6, h: 4 };
  assert.equal(heightAfter(3, [s], 0, 0), 7, 'on top: the ground plus 4');
  assert.equal(heightAfter(3, [s], 4.9, 2.9), 7, 'still on top at the corner');
  assert.equal(heightAfter(3, [s], 5 + EDGE + 0.01, 0), 3, 'clear of it');
  const side = heightAfter(3, [s], 5 + EDGE / 2, 0);
  assert.ok(side > 3 && side < 7, `half way down its side: ${side}`);
});

test('a rotated shape swaps its sides: 90 degrees turns the long way across z', () => {
  const wall = { kind: 'wall', x: 0, z: 0, w: 20, d: 2, h: 5, rot: 0 };
  assert.equal(heightAfter(0, [wall], 9, 0), 5);
  assert.equal(heightAfter(0, [wall], 0, 9), 0);
  const turned = { ...wall, rot: Math.PI / 2 };
  assert.equal(heightAfter(0, [turned], 9, 0), 0);
  assert.ok(near(heightAfter(0, [turned], 0, 9), 5, 1e-9));
});

test('a ramp climbs along its x axis from nothing to its height, then drops at the top', () => {
  const r = { kind: 'ramp', x: 0, z: 0, w: 20, d: 10, h: 6 };
  const h = (x) => heightAfter(0, [r], x, 0);
  assert.ok(h(-9.9) < 0.1 && h(0) > 2.9 && h(0) < 3.1 && h(9.9) > 5.8, `${h(-9.9)} ${h(0)} ${h(9.9)}`);
  for (let x = -9; x < 9; x += 1) assert.ok(h(x + 1) >= h(x), 'never goes down on the way up');
  assert.equal(h(10 + EDGE + 0.1), 0, 'past the top edge it is flat ground again');
});

test('a trench lowers the ground but never below the floor the lab keeps', () => {
  const t = { kind: 'trench', x: 0, z: 0, w: 10, d: 4, h: 2 };
  assert.equal(heightAfter(3, [t], 0, 0), 1);
  assert.equal(heightAfter(3, [{ ...t, h: 10 }], 0, 0), FLOOR_MIN);
  assert.equal(heightAfter(3, [t], 8, 0), 3);
});

test('a mound peaks in the middle, is flat at its rim, and is round when w equals d', () => {
  const m = { kind: 'mound', x: 5, z: -3, w: 20, d: 20, h: 5 };
  assert.ok(near(heightAfter(3, [m], 5, -3), 8));
  assert.ok(near(heightAfter(3, [m], 15, -3), 3));
  assert.ok(near(maskAt(m, 5 + 6, -3), maskAt(m, 5, -3 + 6), 1e-9), 'the same all round');
  assert.ok(maskAt(m, 8, -3) < 1 && maskAt(m, 8, -3) > maskAt(m, 12, -3), 'falls away from the middle');
});

test('shapes combine in order: two steps take the higher, a trench cut into a step cuts the step', () => {
  const a = { kind: 'step', x: 0, z: 0, w: 10, d: 10, h: 2 }, b = { kind: 'step', x: 0, z: 0, w: 4, d: 4, h: 5 };
  assert.equal(heightAfter(3, [a, b], 0, 0), 8);
  assert.equal(heightAfter(3, [a, b], 4, 0), 5);
  const cut = { kind: 'trench', x: 0, z: 0, w: 4, d: 4, h: 1 };
  assert.equal(heightAfter(3, [a, cut], 0, 0), 2, 'cut from the base ground (3 - 1), under the step top (5): the trench wins at the spot');
});

test('local() turns a point into the shape frame and back to the same distance', () => {
  const s = { x: 2, z: 1, rot: 0.7 };
  const [lx, lz] = local(s, 7, 4);
  assert.ok(near(Math.hypot(lx, lz), Math.hypot(5, 3), 1e-9));
});

test('every kind has sizes to start from', () => {
  for (const k of Object.keys(KINDS)) { const d = DEFAULTS[k]; assert.ok(d && d.w > 0 && d.d > 0 && d.h > 0, k); }
});
