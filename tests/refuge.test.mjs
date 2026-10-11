// The refuge profiles (sim/refuge.js): what a frightened animal of each kind runs to.
import test from 'node:test';
import assert from 'node:assert/strict';
import { REFUGE, refugeScore, HIGH_CM } from '../src/sim/refuge.js';

const spot = (o = {}) => ({ cover: 0, wcover: 0, height: 0, depth: -1, crest: false, shallowMax: 2, ...o });

test('a gecko is safe up high, nowhere on the open floor', () => {
  assert.equal(REFUGE.gecko, 'high');
  assert.equal(refugeScore('high', spot()), 0);
  assert.equal(refugeScore('high', spot({ height: HIGH_CM - 0.1 })), 0);
  assert.ok(refugeScore('high', spot({ height: 6 })) > refugeScore('high', spot({ height: 3 })));
});

test('a crab is safe low under cover or in shallow water, not in deep water', () => {
  assert.ok(refugeScore('low', spot({ cover: 0.8 })) > 0);
  assert.ok(refugeScore('low', spot({ depth: 1 })) > 0);
  assert.equal(refugeScore('low', spot({ depth: 4 })), 0);
});

test('a newt runs to the water line; deeper water is a refuge too, dry ground is none', () => {
  assert.equal(refugeScore('waterline', spot({ depth: -0.5 })), 0);
  assert.ok(refugeScore('waterline', spot({ depth: 1 })) > refugeScore('waterline', spot({ depth: 6 })));
  assert.ok(refugeScore('waterline', spot({ depth: 6 })) > 0);
});

test('skink and crab score as before the refuge module (cover 8, crest 4, shallow water 5)', () => {
  assert.equal(refugeScore('cover', spot({ cover: 0.6, crest: true })), 12);
  assert.equal(refugeScore('low', spot({ cover: 0.6, depth: 1 })), 13);
});
