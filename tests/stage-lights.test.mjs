import test from 'node:test';
import assert from 'node:assert/strict';
import { disposeLightsLater } from '../src/engine/stage.js';

test('stage lights are disposed later, not during Stage.dispose (N20c)', () => {
  let n = 0; const queued = [];
  const lights = [{ dispose: () => n++ }, { dispose: () => n++ }];
  assert.equal(disposeLightsLater(lights, 1000, (fn, ms) => queued.push([fn, ms])), 2);
  assert.equal(n, 0, 'nothing freed while the old frame may still be in flight');
  assert.equal(queued.length, 1); assert.equal(queued[0][1], 1000);
  queued[0][0](); assert.equal(n, 2);
  assert.equal(disposeLightsLater([], 1000, () => assert.fail('no timer for no lights')), 0);
});
