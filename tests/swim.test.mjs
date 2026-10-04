// The anuran swimming blueprint's motion layer (util/gait.js, util/bodyplan.js SWIM): a frog kicks and travels with the stroke.
import test from 'node:test';
import assert from 'node:assert/strict';
import { swimState, swimStep, swimPose, kickRate } from '../src/util/gait.js';
import { SWIM, swimProfile } from '../src/util/bodyplan.js';

const seeded = (s = 7) => () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
// Swims for `secs` at 30 ticks a second: distance, kicks, the speeds, the share of ticks with no stroke (resting between bursts).
function run(id, { urgency = 0.95, floating = false, bodyLen = 4.2, secs = 30 } = {}) {
  const prof = swimProfile(id), st = swimState(seeded()), rnd = seeded(11), dt = 1 / 30;
  let d = 0, still = 0;
  const vs = [];
  for (let i = 0; i < secs * 30; i++) {
    const v = swimStep(st, prof, { urgency, floating, bodyLen, rnd }, dt);
    d += v * dt; vs.push(v);
    if (st.rest > 0) still++;          // (between bursts: no stroke)
  }
  vs.sort((a, b) => a - b);
  return { d, kicks: st.kicks, still: still / (secs * 30), p50: vs[vs.length >> 1], p95: vs[Math.floor(vs.length * 0.95)] };
}

test('every frog profile is complete and the toad out-swims a poison frog', () => {
  for (const id of Object.keys(SWIM)) {
    const p = swimProfile(id);
    for (const k of ['kickHz', 'reach', 'burst', 'rest', 'drag', 'sink', 'level', 'headUp']) assert.ok(p[k] != null, `${id}.${k}`);
    assert.ok(p.kickHz[1] > p.kickHz[0] && p.kickHz[1] <= 3.2, `${id}: urgent kicks a second`);
  }
  assert.ok(swimProfile('toad').reach > swimProfile('dartfrog').reach && swimProfile('toad').float && !swimProfile('dartfrog').float);
  assert.ok(kickRate(swimProfile('dartfrog'), 1) >= 2 && kickRate(swimProfile('dartfrog'), 1) <= 3, 'a small frog fleeing kicks 2-3 times a second');
});

test('a frog travels by its kicks: about `reach` body lengths a kick, in pulses', () => {
  for (const id of ['dartfrog', 'strawberry', 'bumblebee', 'redeye', 'toad']) {
    const r = run(id), prof = swimProfile(id), perKick = r.d / r.kicks / 4.2;
    assert.ok(Math.abs(perKick - prof.reach) < prof.reach * (prof.float ? 0.4 : 0.25), `${id}: ${perKick.toFixed(2)} body lengths a kick, want ${prof.reach}`);
    assert.ok(r.p95 > 2 * r.p50, `${id}: surges (p95 ${r.p95.toFixed(2)} vs median ${r.p50.toFixed(2)} cm/s)`);
  }
  // a dart frog of 4.2 cm making for the bank: 3 to 6 cm a second
  const r = run('dartfrog');
  assert.ok(r.d / 30 > 3 && r.d / 30 < 6, `${(r.d / 30).toFixed(2)} cm/s`);
});

test('swimming, the legs work: little of the time without a stroke', () => {
  // (the toad, a strong swimmer at home in the water, glides and rests longer: not held to this)
  for (const id of ['dartfrog', 'strawberry', 'bumblebee', 'reedfrog', 'redeye']) {
    const r = run(id, { urgency: 0.95 });
    assert.ok(r.still < 0.25, `${id}: no stroke ${(r.still * 100).toFixed(0)}% of the time`);
  }
});

test('the stroke: both legs snap out, trail straight through the glide, fold in the recovery; posture level, head up', () => {
  const prof = swimProfile('leucomelas'), at = (phase) => swimPose({ phase, rest: 0 }, prof);
  assert.ok(at(0.02).hop < 0.4 && at(0.17).hop > 0.95 && at(0.4).hop === 1 && at(0.65).hop === 1 && at(0.9).hop < 0.4 && at(0.98).hop < 0.05);
  // the legs are drawn up (a sitting frog's fold) only briefly before each thrust: under 15% of the stroke
  let folded = 0; for (let p = 0; p < 1; p += 0.001) if (at(p).hop < 0.3) folded++;
  assert.ok(folded < 150, `${folded / 10}% of the stroke folded`);
  for (let p = 0; p < 1; p += 0.05) {
    const s = at(p);
    assert.ok(s.pose === 1 && s.calm === 1, 'forelegs back along the flanks, the walk off');
    assert.ok(s.pitch < prof.level && s.pitch > prof.level - 0.3, 'trunk flat with the nose a little up');
  }
});

test('the fire-bellied toad rests floating, limbs spread, hardly moving', () => {
  const r = run('toad', { floating: true, secs: 20 });
  assert.ok(r.d < 2, `drifted ${r.d.toFixed(2)} cm`);
  const s = swimPose({ phase: 3.3, rest: 0 }, swimProfile('toad'), { floating: true });
  assert.ok(s.hop > 0.35 && s.hop < 0.75 && s.pose < 1);
});
