// A stream down a slope (tools/stream-physics.mjs): it carries the water of everything that feeds it, at the speed
// a natural bed allows, so a stream fed by two outlets is a real stream and not a film racing down at the model's limit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { streamWorld, crossSection } from '../tools/stream-physics.mjs';

const run = (H, seconds, dt = 0.05) => { for (let t = 0; t < seconds; t += dt) H.step(dt); };

test('a joined stream carries the sum of its feeders, deeper and wider than either, at a natural speed', () => {
  const { H, f } = streamWorld();
  run(H, 60);
  const fed = H.outlets.reduce((s, o) => s + o.q * 3.6, 0);
  const feeders = crossSection(H, f, -10), joined = crossSection(H, f, 0);
  assert.ok(fed > 120, `the pump feeds both outlets (${fed.toFixed(0)} L/h)`);
  assert.ok(Math.abs(joined.lph - fed) < 0.05 * fed, `the joined stream carries what the outlets give: ${joined.lph.toFixed(0)} of ${fed.toFixed(0)} L/h`);
  assert.ok(joined.v > 8 && joined.v < 60, `it runs at a natural speed for its depth and slope (${joined.v.toFixed(0)} cm/s)`);
  assert.ok(joined.dmax > 0.3, `it is millimetres deep, not a film (${(joined.dmax * 10).toFixed(1)} mm)`);
  assert.ok(joined.dmax > feeders.dmax, `deeper than its feeders (${(joined.dmax * 10).toFixed(1)} vs ${(feeders.dmax * 10).toFixed(1)} mm)`);
  assert.ok(joined.width > feeders.width / 2, `wider than one feeder (${joined.width.toFixed(1)} vs ${(feeders.width / 2).toFixed(1)} cm)`);
});
