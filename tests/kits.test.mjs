import test from 'node:test';
import assert from 'node:assert/strict';
import { KITS, kitCounts, kitPrice, kitRank, kitReach, kitById } from '../src/content/kits.js';
import { PIECES, entry } from '../src/content/economy.js';
import { ACHIEVEMENTS } from '../src/content/achievements.js';
import { Career } from '../src/game/career.js';

test('kit data is well formed', () => {
  assert.ok(KITS.length >= 5);
  assert.equal(new Set(KITS.map((k) => k.id)).size, KITS.length);
  for (const k of KITS) {
    assert.ok(k.name && k.blurb && k.teaches, k.id + ' needs a name, blurb and teaching line');
    assert.ok(k.pieces.length >= 3, k.id);
    for (const p of k.pieces) {
      assert.ok(PIECES[p.type], `${k.id}: unknown piece ${p.type}`);
      assert.ok(p.size > 0 && Number.isFinite(p.dx) && Number.isFinite(p.dz), k.id);
    }
    if (k.outlet) assert.ok(k.pieces[k.outlet.on], k.id + ' outlet needs a piece to sit on');
    for (const p of k.pieces) for (const i of p.bridge ?? []) assert.ok(k.pieces[i], k.id + ' bridge index');
    assert.ok(kitReach(k) > 5, k.id);
    assert.equal(kitById(k.id), k);
  }
});

test('composition rules: odd counts of the main pieces, graded sizes', () => {
  const steps = kitById('steps').pieces, spires = kitById('spires').pieces;
  assert.equal(steps.length % 2, 1);
  assert.equal(spires.length % 2, 1);
  for (const list of [steps, spires]) for (let i = 1; i < list.length; i++) assert.ok(list[i].size < list[i - 1].size, 'graded from big to small');
});

test('a kit costs the sum of its pieces and unlocks with its priciest piece', () => {
  for (const k of KITS) {
    const counts = kitCounts(k);
    assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), k.pieces.length);
    // The price matches what Career charges for those pieces, type by type.
    const c = new Career();
    let sum = 0;
    for (const [type, n] of Object.entries(counts)) sum += c.cost('piece', type, n);
    assert.equal(kitPrice(k), sum, k.id);
    assert.ok(kitPrice(k) > 0);
    // The priciest piece sets the rank, and no piece needs a higher one.
    const priciest = [...k.pieces].sort((a, b) => entry('piece', b.type).price - entry('piece', a.type).price)[0];
    assert.equal(kitRank(k), entry('piece', priciest.type).rank, k.id);
    assert.equal(kitRank(k), Math.max(...k.pieces.map((p) => entry('piece', p.type).rank)), k.id + ': all pieces unlocked by the kit rank');
  }
});

test('buying a kit in a career takes its price; the sandbox is free', () => {
  const k = kitById('waterfall');
  const poor = new Career();
  assert.match(poor.buy('piece', 'cliff'), /Unlocked at rank/);   // rank-locked at the start
  const c = new Career();
  c.rep = 20000; c.funds = 1000;
  const f0 = c.funds;
  for (const [type, n] of Object.entries(kitCounts(k))) assert.equal(c.buy('piece', type, n), null);
  assert.equal(f0 - c.funds, kitPrice(k));
  const sb = new Career({ mode: 'sandbox' });
  for (const [type, n] of Object.entries(kitCounts(k))) assert.equal(sb.buy('piece', type, n), null);
  assert.equal(sb.funds, 0);
});

test('Symmetry and Kit builder achievements follow their stats', () => {
  const sym = ACHIEVEMENTS.find((a) => a.id === 'symmetry'), kit = ACHIEVEMENTS.find((a) => a.id === 'kit-builder');
  assert.ok(sym && kit);
  const c = new Career();
  assert.equal(c.stats.mirrorUsed, 0);
  assert.equal(c.stats.kitsPlaced, 0);
  assert.equal(sym.test(c.stats), false);
  c.stat('mirrorUsed');
  assert.equal(sym.test(c.stats), true);
  c.stat('kitsPlaced'); c.stat('kitsPlaced');
  assert.equal(kit.test(c.stats), false);
  c.stat('kitsPlaced');
  assert.equal(kit.test(c.stats), true);
  const earned = c.checkAchievements({});
  assert.deepEqual(earned.map((a) => a.id).sort(), ['kit-builder', 'symmetry']);
});
