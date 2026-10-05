// N11c: a walker in a pocket of solid cells (every step refused) is found and set on the nearest open ground.
import test from 'node:test';
import assert from 'node:assert/strict';
import { walledIn, nearestOpen } from '../src/sim/walledin.js';

// A ring wall of radius 0.2-2 cm round the origin (solid), open beyond 2 cm; the origin itself is free (the crab's spot).
const blocked = (x, z) => { const d = Math.hypot(x, z); return d > 0.2 && d < 2; };
const open = (x, z) => !blocked(x, z);

test('a body in a pocket whose every step is blocked is walled in; one at the open edge is not', () => {
  assert.equal(walledIn(0, 0, 0.3, blocked), true);
  assert.equal(walledIn(2.2, 0, 0.3, blocked), false);
});
test('the way out is the nearest open, not walled-in ground, within a few cm', () => {
  const p = nearestOpen(0, 0, 0.3, open, blocked);
  assert.ok(p && p.r >= 2 && p.r <= 3, JSON.stringify(p));
  assert.equal(nearestOpen(0, 0, 0.3, () => false, blocked), null);
});
