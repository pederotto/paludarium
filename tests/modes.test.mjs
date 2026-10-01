// The mode rules table and the pure smart-placement helpers. Run with: node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { MODES, MODE_IDS, normalizeMode, rules, realismFor, isSmart, chemChip, plainWhy, groupLayout, gradedSizes, freeSpot, scatterSpots, mulberry, seedOf } from '../src/app/modes.js';

test('every mode has the full rule set', () => {
  assert.deepEqual(MODE_IDS, ['kids', 'explorer', 'naturalist']);
  for (const id of MODE_IDS) {
    const m = MODES[id];
    for (const k of ['erosion', 'slump', 'support', 'mould', 'harm', 'mercy', 'events', 'eventRate', 'flow', 'chem']) assert.ok(k in m.sim, `${id}.sim.${k}`);
    for (const k of ['numbers', 'chips', 'flowPanel', 'lab', 'waterTools', 'toolOptions']) assert.ok(k in m.hud, `${id}.hud.${k}`);
    assert.ok(m.name && m.tag && m.blurb && m.coach && m.placement);
  }
});

test('explorer is gentler than naturalist, naturalist keeps today\'s behaviour', () => {
  const e = MODES.explorer.sim, n = MODES.naturalist.sim;
  assert.equal(e.erosion, 0.5); assert.equal(n.erosion, null);
  assert.ok(e.slump < n.slump && e.harm < n.harm && e.mould < n.mould && e.eventRate < n.eventRate);
  assert.equal(e.flow, 'auto'); assert.equal(n.flow, 'manual');
  assert.equal(MODES.explorer.hud.flowPanel, false); assert.equal(MODES.naturalist.hud.flowPanel, true);
  assert.equal(MODES.explorer.hud.numbers, false); assert.equal(MODES.naturalist.hud.numbers, true);
  assert.equal(n.harm, 1); assert.equal(n.mould, 1); assert.equal(n.support, 'full');
});

test('unknown modes fall back, smart placement follows the mode', () => {
  assert.equal(normalizeMode('bogus'), 'naturalist');
  assert.equal(rules('explorer').placement, 'smart');
  assert.equal(isSmart('explorer'), true);
  assert.equal(isSmart('naturalist'), false);
  assert.equal(isSmart('naturalist', true), true);
  const r = realismFor('explorer'); r.harm = 9;
  assert.equal(MODES.explorer.sim.harm, 0.4, 'realismFor returns a copy');
});

test('chemistry chips and plain language', () => {
  assert.equal(chemChip({ ammonia: 0, nitrite: 0, nitrate: 10, oxygen: 8 }).ok, true);
  const c = chemChip({ ammonia: 0.6, nitrite: 0, nitrate: 80, oxygen: 8 });
  assert.equal(c.ok, false); assert.match(c.why, /ammonia/);
  assert.match(plainWhy('air too dry'), /mist/);
  assert.equal(plainWhy('something else'), 'something else');
});

test('groups are odd, graded and never overlap', () => {
  for (const n of [3, 5]) {
    for (let seed = 1; seed < 40; seed++) {
      const g = groupLayout(n, 10, 2, 8, { seed, tank: { w: 90, d: 45 } });
      assert.equal(g.length, n);
      assert.ok(g[0].size >= Math.max(...g.map((p) => p.size)) - 1e-9, 'focal piece is the largest');
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const d = Math.hypot(g[i].x - g[j].x, g[i].z - g[j].z);
        assert.ok(d > (g[i].size + g[j].size) * 0.3, `no overlap seed ${seed}: ${d}`);
      }
      for (const p of g) assert.ok(Math.abs(p.x) <= 45 && Math.abs(p.z) <= 22.5);
    }
  }
  assert.equal(groupLayout(4, 0, 0, 5).length, 3, 'even counts become 3');
  const s = gradedSizes(5, 10, mulberry(3));
  assert.ok(s[0] > s[4]);
});

test('a tap in the middle moves a group to a third of the tank', () => {
  const g = groupLayout(3, 1, 0, 8, { seed: 5, thirds: true, tank: { w: 90, d: 45 } });
  assert.ok(Math.abs(Math.abs(g[0].x) - 15) < 1e-9, 'focal piece a third in from the edge: ' + g[0].x);
});

test('free spots and scatter are deterministic and spaced', () => {
  const taken = [{ x: 0, z: 0 }];
  const free = (x, z) => taken.every((t) => Math.hypot(t.x - x, t.z - z) > 3);
  const a = freeSpot(0, 0, free, { seed: 7 }), b = freeSpot(0, 0, free, { seed: 7 });
  assert.deepEqual(a, b); assert.ok(a && free(a.x, a.z));
  assert.equal(freeSpot(0, 0, () => false), null);
  const sp = scatterSpots(0, 0, 8, 2.5, [{ x: 0, z: 0 }], { seed: seedOf(1, 2, 3), max: 6 });
  for (const p of sp) { assert.ok(Math.hypot(p.x, p.z) <= 8 + 1e-9); assert.ok(Math.hypot(p.x, p.z) >= 2.5); }
  for (let i = 0; i < sp.length; i++) for (let j = i + 1; j < sp.length; j++) assert.ok(Math.hypot(sp[i].x - sp[j].x, sp[i].z - sp[j].z) >= 2.5);
});
