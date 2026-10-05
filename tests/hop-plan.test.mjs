// The hop's plan (util/hop.js) over the hops the game can ask for: 1-8 cm forward, a step down of 2 cm to a step up of 3 cm, for the
// dart frog (C1b round 3, .agents/muscles/control/round-3.md: the pitch snapped up to 58 deg in one frame landing on a step, 42 plans
// came up through the face of a higher ledge while still rising, and launches ran from 7 ms at 56 g to 340 ms).
import test from 'node:test';
import assert from 'node:assert/strict';
import { hopPlan, hopAt, hopPitch, svlOf, G_CM, HOPK } from '../src/util/hop.js';

const SVL = svlOf(1.4, 1), PLANS = [];
for (let d = 1; d <= 8; d += 0.5) for (let rise = -2; rise <= 3; rise += 0.5) for (const rnd of [[0.2, 0.3], [0.8, 0.9]]) PLANS.push({ d, rise, p: hopPlan({ d, rise }, SVL, rnd) });
const ok = PLANS.filter((h) => h.p.ok), tag = (h) => `${h.d} cm, rise ${h.rise}`;

test('a hop is refused only when no arc can come down onto a ledge that high so near (the game then does not take it)', () => {
  assert.deepEqual([...new Set(PLANS.filter((h) => !h.p.ok && !(h.d <= 1.5 && h.rise >= 2)).map(tag))], []);
  assert.ok(ok.length >= PLANS.length * 0.95, `${ok.length} of ${PLANS.length} plans`);
});

test('every hop comes down onto its landing (falling there, not rising through a ledge\'s face), exactly at it', () => {
  const bad = [];
  for (const h of ok) {
    const { p } = h, vy = p.v * Math.sin(p.theta) - G_CM * p.tFlight, end = hopAt(p, (p.tLaunch + p.tFlight) / p.dur - 1e-9);
    if (vy >= 0) bad.push(`${tag(h)}: rising ${vy.toFixed(1)} cm/s`);
    if (Math.abs(end.pos[2] - h.d) > 0.02 || Math.abs(end.pos[1] - (h.rise + p.hands)) > 0.02) bad.push(`${tag(h)}: ends at ${end.pos[2].toFixed(2)}, ${end.pos[1].toFixed(2)}`);
  }
  assert.deepEqual([...new Set(bad)], []);
});

test(`the launch takes ${HOPK.launch[0] * 1000}-${HOPK.launch[1] * 1000} ms (Essner et al. 2022: 41 ms mean in 1 cm frogs)`, () => {
  assert.deepEqual(ok.filter((h) => h.p.tLaunch < HOPK.launch[0] - 1e-4 || h.p.tLaunch > HOPK.launch[1] + 1e-4).map((h) => `${tag(h)}: ${(h.p.tLaunch * 1000).toFixed(0)} ms`), []);
});

// Per frame of the game (1/60 s), not per fraction of the hop: the 1/400 the test took until 14:50 let the pitch turn 43 deg in one
// frame (C1b round 5). A hop's launch lasts 2-5 frames, so the body turns fast; at most 18 deg a frame (about 1000 deg/s). A short
// hop keeps the body within 20 deg of level (clip A).
test('the body\'s pitch turns at most 18 deg a frame, landing on a step too, and a short hop stays near level', () => {
  const bad = [];
  for (const h of ok) {
    let prev = null, worst = 0, most = 0;
    for (let s = 0; s <= h.p.dur + 1e-9; s += 1 / 60) {
      const q = hopPitch(h.p, hopAt(h.p, s / h.p.dur));
      if (prev != null) worst = Math.max(worst, Math.abs(q - prev));
      prev = q; most = Math.max(most, Math.abs(q));
    }
    if (worst * 180 / Math.PI > 18) bad.push(`${tag(h)}: ${(worst * 180 / Math.PI).toFixed(0)} deg in a frame`);
    if (h.p.short >= 1 && most * 180 / Math.PI > 20) bad.push(`${tag(h)}: short hop pitched ${(most * 180 / Math.PI).toFixed(0)} deg`);
  }
  assert.deepEqual([...new Set(bad)], []);
});
