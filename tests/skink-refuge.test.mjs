// N11c: the crocodile skink's refuge is on land. At streambank (S1, seed 1) the game took the covered spot the skink stood on as
// its refuge with no land test (animals.js skink(): `skinkCover(x, z) >= 0.6`), so it hid 8 h in the stream: 71/71 hide samples
// and 99 % of the day in water, against the real 80 % land / 20 % shallow water (skink.js header).
import test from 'node:test';
import assert from 'node:assert/strict';
import { skinkRefugeOk, REFUGE_COVER } from '../src/sim/skink.js';

test('a covered spot under water is no refuge; covered dry ground is', () => {
  assert.equal(skinkRefugeOk(0.8, 4.2), false);          // litter under 4 cm of stream water
  assert.equal(skinkRefugeOk(0.8, 0.5), false);          // a soak puddle is not cover
  assert.equal(skinkRefugeOk(0.8, -Infinity), true);     // dry (surfaceAt gives -Infinity)
  assert.equal(skinkRefugeOk(0.8, -1), true);            // the bank above the waterline
  assert.equal(skinkRefugeOk(REFUGE_COVER - 0.01, -Infinity), false);
});
