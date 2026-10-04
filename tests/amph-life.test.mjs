// Amphibian behaviour regressions (wk-amph-life, 2026-10-04). The day-in-the-life probe is tools/steps/amph-life-day.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { herpMind, herpThink } from '../src/sim/herp.js';

// A courting male leading off whose lead goal was dropped by animals.js (no headway: `m.goal = null`) used to throw in
// dist2(here, null) every frame until the lead timed out (the whole animals step stopped, a page error a frame).
test('a courting lead with no goal waits instead of throwing', () => {
  for (const id of ['newt', 'firesal', 'axolotl']) {
    const m = herpMind(id, () => 0.5);
    Object.assign(m, { mode: 'court', modeT: 3, cp: 'lead', cpT: 1, goal: null, courtDrive: 1, wet: 1, fear: 0, air: 0 });
    const s = {
      t: 10, dt: 0.1, dtMin: 0.1, dtAir: 0.1, x: 0, z: 0, yaw: 0, kind: id === 'axolotl' ? 'axolotl' : 'newt', depth: id === 'firesal' ? 0 : 4,
      light: 0, rain: 0, rh: 85, temp: 16, hunger: 0.2, health: 1, male: true, adult: true, wetGround: 1, cover: 0, reach: 2, moved: 0, toSurface: 2,
      mate: { x: 5, z: 0, d: 5, ok: true, courting: false, phase: null, recv: true },
    };
    let it;
    assert.doesNotThrow(() => { it = herpThink(m, s, () => 0.5); }, id);
    assert.equal(m.cp, 'wait', id);
    assert.ok(it);
  }
});
