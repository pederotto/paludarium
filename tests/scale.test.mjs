// Real sizes in any tank (src/sim/scale.js): the standard tank is the reference, pieces keep their real size in every tank and
// always fit, counts follow the floor, and a generated tank is never stocked with animals it cannot keep.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pieceScale, coverCount, fogScale, waterRoom, stockCount } from '../src/sim/scale.js';
import { STANDARD as STD, sizeFactors, roomFor } from '../src/sim/tank.js';
import { TANKS } from '../src/content/tanks.js';

const T = (id) => TANKS[id];

test('the standard tank is the reference: every factor is 1', () => {
  assert.equal(pieceScale(STD), 1);
  assert.equal(fogScale(STD), 1);
  assert.equal(coverCount(10, STD), 10);
  assert.equal(pieceScale(T('standard')), 1);
});

test('pieces never grow with a big tank and shrink only to fit a low, shallow or small one', () => {
  for (const id of ['show', 'grand', 'wide', 'tall']) assert.equal(pieceScale(T(id)), 1, id);   // was 1.2 in the show tank
  for (const t of Object.values(TANKS)) {
    const k = pieceScale(t);
    assert.ok(k <= t.h / STD.h + 1e-9 && k <= t.d / STD.d + 1e-9 || k === 0.4, `${t.id} ${k}`);
    assert.ok(k >= 0.4 && k <= 1, `${t.id} ${k}`);
  }
  assert.ok(pieceScale(T('cube')) <= 0.5 + 1e-9);
  assert.ok(pieceScale(T('long')) < 1);
});

test('a bigger tank holds more pieces, a smaller one fewer', () => {
  assert.ok(coverCount(10, T('show')) > 15);
  assert.ok(coverCount(10, T('long')) > 12);
  assert.ok(coverCount(10, T('cube')) < 10);
  assert.ok(coverCount(1, T('jar')) >= 1);
});

test('a fogger is turned down in a small tank and a little up in a big one', () => {
  const cube = 0.55 * fogScale(T('cube')), nano = 0.55 * fogScale(T('nano')), show = 0.55 * fogScale(T('show'));
  assert.ok(cube >= 0.15 && cube <= 0.2, `cube ${cube}`);
  assert.ok(nano > 0.25 && nano < 0.4, `nano ${nano}`);
  assert.ok(show > 0.6 && show < 0.75, `show ${show}`);
});

test('stocking: the smallest group or none, never more than the room, never what the tank is too small for', () => {
  const shrimp = { kind: 'crawlWater', size: 1, cap: 80, flock: [10, 80] };
  const neon = { kind: 'swim', size: 3.2, cap: 60, school: true };
  const gecko = { kind: 'gecko', size: 1.4, cap: 10, minH: 40 };
  const toad = { kind: 'toad', size: 1.9, cap: 6, minL: 60, flock: [3, 6] };
  const frog = { kind: 'frog', size: 1.4, cap: 8 };
  // Seven cherry shrimp in a cube are lonely; ten need about 3.3 litres of water: none in a 1.9 L puddle, ten in 9 L.
  assert.equal(stockCount(shrimp, 7, T('cube'), 1.9), 0);
  assert.equal(stockCount(shrimp, 7, T('nano'), 9), 10);
  assert.equal(stockCount(shrimp, 3, T('cube'), 0.2), 0);
  // A schooling fish comes in threes or not at all.
  assert.equal(stockCount(neon, 3, T('cube'), 1.9), 0);
  assert.equal(stockCount(neon, 8, STD, 18), 8);
  // Geckos need height to climb, toads 60 litres.
  assert.equal(stockCount(gecko, 2, T('cube')), 0);
  assert.equal(stockCount(gecko, 2, T('nano')), 2);
  assert.equal(stockCount(toad, 3, T('cube')), 0);
  // Never more than the room: three dart frogs crowd a cube, a show tank has room for many more.
  assert.ok(stockCount(frog, 9, T('cube')) <= roomFor(frog, sizeFactors(T('cube'))).crowd);
  assert.equal(stockCount(frog, 9, T('show')), 9);
  // Land animals are not limited by the water.
  assert.equal(waterRoom(frog, 0), Infinity);
});
