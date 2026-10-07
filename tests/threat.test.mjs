// Who frightens a walking animal (src/sim/threat.js): pure numbers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { threatScore, sizeFactor, escapeScore, THREAT, MOVERS } from '../src/sim/threat.js';

const skink = { id: 'skink', size: 3, y: 3 };
const mk = (id, kind, size, speed = 2, y = 3) => ({ id, kind, size, speed, y });

test('its own kind never frightens it', () => {
  assert.equal(threatScore(skink, mk('skink', 'skink', 3), 2, 10), 0);
});

test('a smaller neighbour does not, a much bigger moving one does', () => {
  assert.equal(threatScore(skink, mk('toad', 'toad', 1.9), 4, 10), 0, 'a toad is 0.63 of a skink');
  const big = threatScore({ id: 'crab', size: 1, y: 3 }, mk('skink', 'skink', 3), 4, 10);
  assert.ok(big > 0.5 && big <= 2, `a skink to a small crab: ${big}`);
});

test('the score falls with distance and is zero beyond the awareness radius', () => {
  const p = { id: 'crab', size: 1, y: 3 }, o = mk('skink', 'skink', 3);
  assert.ok(threatScore(p, o, 2, 10) > threatScore(p, o, 8, 10));
  assert.equal(threatScore(p, o, 10, 10), 0);
  assert.equal(threatScore(p, o, 12, 10), 0);
});

test('a still neighbour is no threat, unless it is right beside it', () => {
  const p = { id: 'crab', size: 1, y: 3 }, still = mk('skink', 'skink', 3, 0);
  assert.equal(threatScore(p, still, 6, 10), 0);
  assert.ok(threatScore(p, still, THREAT.near - 0.5, 10) > 0);
});

test('a crab\'s claws count as extra size', () => {
  const toad = { id: 'toad', size: 1.9, y: 3 };
  assert.equal(threatScore(toad, mk('x', 'skink', 2.2), 3, 10), 0, 'a 2.2 skink against a 1.9 toad: ratio 1.16');
  assert.ok(threatScore(toad, mk('panther', 'crab', 2.4), 3, 10) > 0, 'the same size gap with claws: 1.26 x 1.5');
});

test('a neighbour on another level (the glass, the water) is not a threat; fish and insects never are', () => {
  const p = { id: 'crab', size: 1, y: 3 };
  assert.equal(threatScore(p, mk('gecko', 'gecko', 3, 2, 20), 3, 10), 0);
  assert.equal(threatScore(p, mk('neon', 'swim', 9), 3, 10), 0);
  assert.ok(!MOVERS.has('swim') && !MOVERS.has('crawlLand') && MOVERS.has('crab'));
});

test('an escape spot: far from the threat and in the niche beats a nearer one, a long way round costs', () => {
  const near = { dThreat: 10, niche: 0, len: 6 }, far = { dThreat: 16, niche: 0, len: 12 }, nicheSpot = { dThreat: 12, niche: 8, len: 8 }, longWay = { dThreat: 20, niche: 8, len: 40 };
  assert.ok(escapeScore(far) > escapeScore(near));
  assert.ok(escapeScore(nicheSpot) > escapeScore(far), 'a refuge beats open ground a little further');
  assert.ok(escapeScore(longWay) < escapeScore(nicheSpot), 'but not at forty centimetres of detour');
});

test('size factor: 0 below the trigger, 1 at it, 2 for a much bigger neighbour; claws count', () => {
  const crab = { id: 'crab', size: 1, y: 3 };
  assert.equal(sizeFactor(crab, mk('x', 'skink', 1.2)), 0);
  assert.ok(Math.abs(sizeFactor(crab, mk('x', 'skink', 1.3)) - 1) < 1e-9);
  assert.equal(sizeFactor(crab, mk('skink', 'skink', 3)), 2);
  // a 2.4 panther crab against a 1.9 toad: (2.4 / 1.9) x 1.5 claws = 1.895, over the 1.3 trigger = 1.458
  assert.ok(Math.abs(sizeFactor({ id: 'toad', size: 1.9, y: 3 }, mk('panther', 'crab', 2.4)) - (2.4 / 1.9 * 1.5) / 1.3) < 1e-9);
});
