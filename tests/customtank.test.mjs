import test from 'node:test';
import assert from 'node:assert/strict';
import { setCustomTank, TANKS } from '../src/content/tanks.js';
import { stampTankSize } from '../src/app/saves.js';

test('a saved tank carries its own size, and restoring it does not overwrite the remembered slider size', () => {
  const store = {};
  globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
  setCustomTank(70, 35, 45);
  const live = { id: 'custom', w: 70, d: 35, h: 45 };
  const save = stampTankSize({ tank: 'custom', world: { tank: { id: 'custom' } } }, live);
  assert.deepEqual(save.world.tank, { id: 'custom', w: 70, d: 35, h: 45 });
  setCustomTank(110, 50, 70);                                   // a different tank is built afterwards
  assert.equal(JSON.parse(store['paludarium.custom']).w, 110);
  const sz = save.world.tank;
  setCustomTank(sz.w, sz.d, sz.h, { remember: false });         // what Game.loadTank does
  assert.equal(TANKS.custom.w, 70);
  assert.equal(JSON.parse(store['paludarium.custom']).w, 110);  // the slider memory is untouched
  // A save of some other tank is not stamped with the live custom size.
  assert.equal(stampTankSize({ world: { tank: { id: 'standard' } } }, live).world.tank.w, undefined);
  delete globalThis.localStorage;
});
