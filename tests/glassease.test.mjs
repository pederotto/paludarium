// The glass correction is eased for a walker whose box grew past the pane (sim/glassease.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { easePush, GLASS_EASE } from '../src/sim/glassease.js';

test('a small correction is applied whole, as before', () => {
  for (const v of [0, 0.05, -0.1, GLASS_EASE, -GLASS_EASE]) assert.equal(easePush(v), v);
});

test('a big correction is limited to the cap in its own direction', () => {
  assert.equal(easePush(3.33), GLASS_EASE);
  assert.equal(easePush(-3.8), -GLASS_EASE);
});

test('a 3.4 cm shift takes a dozen calls, never a jump bigger than the cap, and ends exactly inside', () => {
  let need = 3.4, calls = 0, worst = 0;
  while (need > 1e-9 && calls < 100) { const s = easePush(need); worst = Math.max(worst, s); need -= s; calls++; }
  assert.ok(worst <= GLASS_EASE + 1e-12);
  assert.ok(calls >= 11 && calls <= 13, `calls ${calls}`);
  assert.ok(need <= 1e-9);
});
