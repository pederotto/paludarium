import test from 'node:test';
import assert from 'node:assert/strict';
import { Career } from '../src/game/career.js';
import { rankFor, RANKS } from '../src/content/levels.js';
import { ANIMALS, PLANTS, PIECES, entry, START_FUNDS } from '../src/content/economy.js';
import { sellPrice, demand } from '../src/game/market.js';
import { ACHIEVEMENTS } from '../src/content/achievements.js';

test('ranks are monotonic and rankFor finds the right one', () => {
  for (let i = 1; i < RANKS.length; i++) assert.ok(RANKS[i].rep > RANKS[i - 1].rep);
  assert.equal(rankFor(0).level, 1);
  assert.equal(rankFor(99).level, 1);
  assert.equal(rankFor(100).level, 2);
  assert.equal(rankFor(1e6).level, 12);
});

test('buying deducts funds, respects locks and affordability', () => {
  const c = new Career();
  assert.equal(c.funds, START_FUNDS);
  assert.equal(c.buy('plant', 'fern', 3), null);
  assert.ok(c.funds < START_FUNDS);
  assert.match(c.buy('animal', 'axolotl'), /Unlocked at rank/);
  const poor = new Career(); poor.funds = 1;
  assert.match(poor.buy('plant', 'fern'), /Not enough funds/);
  assert.equal(c.info('animal', 'axolotl').locked, true);
  assert.equal(c.info('plant', 'fern').locked, false);
});

test('refund returns the money', () => {
  const c = new Career();
  const f0 = c.funds;
  c.buy('animal', 'springtail', 20);
  c.refund('animal', 'springtail', 20);
  assert.equal(c.funds, f0);
});

test('sandbox is free and unlocked', () => {
  const c = new Career({ mode: 'sandbox' });
  assert.equal(c.info('animal', 'axolotl'), null);
  assert.equal(c.buy('animal', 'axolotl'), null);
  assert.equal(c.knows('animal', 'axolotl'), true);
});

test('reputation levels up, pays a bonus and fires the callback', () => {
  const c = new Career();
  let got = null; c.onLevelUp = (lv, name) => { got = [lv, name]; };
  const f0 = c.funds;
  c.addRep(120);
  assert.equal(c.level, 2);
  assert.deepEqual(got, [2, 'Keeper']);
  assert.ok(c.funds > f0);
});

test('discovery: buying something teaches its field-guide page and gives first-time reputation', () => {
  const c = new Career();
  assert.equal(c.knows('plant', 'fern'), false);
  c.buy('plant', 'fern');
  assert.equal(c.knows('plant', 'fern'), true);
  assert.ok(c.rep > 0);
});

test('market: juveniles and sick animals fetch little, prices are capped, demand varies', () => {
  const adult = { sp: 'dartfrog', age: 40 * 1440, health: 1 };
  const young = { sp: 'dartfrog', age: 2 * 1440, health: 1 };
  const sick = { sp: 'dartfrog', age: 40 * 1440, health: 0.35 };
  assert.ok(sellPrice(adult, 5) > 0);
  assert.equal(sellPrice(young, 5), 0);
  assert.ok(sellPrice(sick, 5) < sellPrice(adult, 5));
  assert.ok(sellPrice(adult, 5) <= Math.floor(ANIMALS.dartfrog.price * 0.8));
  const ds = new Set(Array.from({ length: 30 }, (_, d) => demand('dartfrog', d).toFixed(2)));
  assert.ok(ds.size > 10);
  assert.equal(sellPrice({ sp: 'springtail', age: 1e6, health: 1 }, 3), 0);
});

test('achievements pay out once', () => {
  const c = new Career();
  c.stats.plantsPlaced = 1;
  const first = c.checkAchievements({});
  assert.ok(first.find((a) => a.id === 'first-plant'));
  assert.equal(c.checkAchievements({}).length, 0);
  assert.ok(ACHIEVEMENTS.length >= 30);
});

test('save and load round-trip', () => {
  const c = new Career();
  c.buy('plant', 'fern', 2); c.addRep(150); c.stat('births');
  const d = Career.load(JSON.parse(JSON.stringify(c.serialize())));
  assert.equal(d.funds, c.funds); assert.equal(d.rep, c.rep); assert.equal(d.stats.births, 1);
  assert.equal(d.knows('plant', 'fern'), true);
});

test('every economy row has a sane price and rank', () => {
  for (const t of [ANIMALS, PLANTS, PIECES]) for (const [id, e] of Object.entries(t)) {
    assert.ok(e.rank >= 1 && e.rank <= 12, id);
    assert.ok(e.price >= 0, id);
  }
  assert.ok(entry('gear', 'fan').rank >= 1);
});
