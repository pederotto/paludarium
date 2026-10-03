// The geometry behind keeping animals apart (sim/animals.js separate): long bodies are capsules, pushed apart where they come closest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closestOnSegments } from '../src/util/math.js';

const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);

test('two newts lying side by side are pushed apart flank to flank, not centre to centre', () => {
  // Parallel, 1 cm apart, offset along their length: the closest points face each other across the gap.
  const [px, pz, qx, qz] = closestOnSegments(0, -4, 0, 4, 1, 2, 1, 10);
  near(qx - px, 1); near(qz - pz, 0);
});

test('crossing bodies meet at the crossing', () => {
  const [px, pz, qx, qz] = closestOnSegments(-3, 0, 3, 0, 0, -3, 0, 3);
  near(px, 0); near(pz, 0); near(qx, 0); near(qz, 0);
});

test('nose to tail: the ends are the closest points', () => {
  const [px, pz, qx, qz] = closestOnSegments(0, 0, 0, 5, 0, 7, 0, 12);
  near(pz, 5); near(qz, 7); near(px, 0); near(qx, 0);
});

test('a circle (a zero-length segment) against a body is its distance to the nearest point of the body', () => {
  const [px, pz, qx, qz] = closestOnSegments(2, 3, 2, 3, 0, 0, 0, 10);
  near(px, 2); near(pz, 3); near(qx, 0); near(qz, 3);
  const [ax, az, bx, bz] = closestOnSegments(0, 0, 0, 10, 2, -3, 2, -3);
  near(ax, 0); near(az, 0); near(bx, 2); near(bz, -3);
});
