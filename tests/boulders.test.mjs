// R2c: a boulder within a surface walker's step limit is not a cliff to it; a taller wall is. Pure: a hand-built height function.
import test from 'node:test';
import assert from 'node:assert/strict';
import { faceRise, isCliff, FACE_R } from '../src/sim/facerise.js';
import { CLIMB } from '../src/sim/surfaces.js';

// z-independent ground along x (cm): flat 3.0, a ramp up to 6.7 (a 3.7 cm boulder), a drop back to 3.0, then a 6.0-high wall (3.0 -> 9.0).
const hAt = (x) => (x < -4 ? 3.0 : x < 0 ? 3.0 + (x + 4) * (3.7 / 4) : x < 4 ? 6.7 : x < 5 ? 6.7 - (x - 4) * 3.7 : x < 12 ? 3.0 : x < 13 ? 3.0 + (x - 12) * 6 : 9.0);
const h = (x) => hAt(x);
const grad2 = (x) => { const g = (hAt(x + 0.05) - hAt(x - 0.05)) / 0.1; return g * g; };
const hh = (x, z) => hAt(x);

test('faceRise: max - min over the 9-point stencil', () => {
  assert.equal(faceRise(() => 5, 0, 0), 0);
  assert.ok(Math.abs(faceRise((x) => x, 0, 0, 2.5) - 5) < 1e-9);
  assert.equal(FACE_R, 2.5);
});
test('the 3.7 cm boulder face is steep but within every surface walker step limit', () => {
  const x = 4.5;                                              // its far side: 3.7 cm over 1 cm, grad2 > 3
  assert.ok(grad2(x) > 3);
  const r = faceRise(hh, x, 0);
  assert.ok(r < 4.0 && r > 3.0, 'rise ' + r);
  for (const k of ['skink', 'crab', 'newt']) assert.equal(isCliff(grad2(x), r, CLIMB[k].up), false, k);
});
test('the 6.0 cm wall is a cliff to all of them; a gentle ramp never is', () => {
  const x = 12.5;
  assert.ok(grad2(x) > 3);
  const r = faceRise(hh, x, 0);
  assert.ok(r >= 5.9, 'rise ' + r);
  for (const k of ['skink', 'crab', 'newt']) assert.equal(isCliff(grad2(x), r, CLIMB[k].up), true, k);
  assert.equal(isCliff(1.0, 10, 4.5), false);                 // not steep: never a cliff whatever the rise
});
