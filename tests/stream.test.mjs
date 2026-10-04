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

// Where a fall lands (render/falls.js): the foam leaves the foot along the fall's own heading, bends toward the pool's
// outlet (the pump's intake) and piles up at the bank instead of running over dry ground; landing on dry ground it is
// only the ring round the foot.
test('the plunge foam trails off toward the outlet and stops at the bank', async () => {
  const THREE = await import('three/webgpu');
  const { plungeGeometry } = await import('../src/render/falls.js');
  const centre = (g) => {
    const p = g.attributes.position.array, d = g.attributes.pdat.array, out = [];
    for (let i = 0; i < d.length / 4; i++) if (d[i * 4 + 1] === 0) out.push({ x: p[i * 3], z: p[i * 3 + 2], s: d[i * 4] });
    return out;
  };
  const foot = new THREE.Vector3(0, 10, 0), R = 3;
  const line = centre(plungeGeometry({ foot, dir: [1, 0], toward: { x: 0, z: 20 }, R, q: 30, wet: (x, z) => z < 12 }));
  const first = line.find((v) => v.s > 1.5 && v.s < 3);
  assert.ok(line[0].s < 0 && line[0].x < 0, 'the ring reaches back under the sheet');
  assert.ok(first.x > Math.abs(first.z), `it leaves along the fall's heading (${first.x.toFixed(1)}, ${first.z.toFixed(1)})`);
  const last = line[line.length - 1];
  assert.ok(last.z > 5 && Math.hypot(last.x, last.z - 20) < 20, `it bends toward the outlet (ends at ${last.x.toFixed(1)}, ${last.z.toFixed(1)})`);
  assert.ok(line.every((v) => v.s <= R || v.z < 12), 'no foam beyond the bank');
  const dry = centre(plungeGeometry({ foot, dir: [1, 0], toward: null, R, q: 30, wet: () => false }));
  assert.ok(Math.max(...dry.map((v) => v.s)) < R + 1, 'on dry ground it is only the ring');
});
