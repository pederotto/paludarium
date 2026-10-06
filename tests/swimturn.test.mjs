// A swimming frog's yaw and pushes come from the stroke clock (util/swimturn.js), nothing else.
import test from 'node:test';
import assert from 'node:assert/strict';
import { swimState, swimStep } from '../src/util/gait.js';
import { swimProfile } from '../src/util/bodyplan.js';
import { swimMotion, queuePush, YAW_MAX } from '../src/util/swimturn.js';

const prof = swimProfile('toad'), dt = 0.05;
const run = (steer, secs, o = {}) => {
  const st = swimState(() => 0.5); let yaw = 0, peak = 0;
  for (let i = 0; i < secs / dt; i++) {
    swimStep(st, prof, { urgency: 0.6, steer, rnd: () => 0.5, ...o.step?.(st) }, dt);
    const m = swimMotion(st, prof, o.motion ?? {}, dt); yaw += m.dyaw; peak = Math.max(peak, Math.abs(m.dyaw / dt));
    if (o.push && i === 5) queuePush(st, 2, 0);
    o.after?.(st, m);
  }
  return { st, yaw, peak };
};
test('equal legs: no yaw', () => assert.equal(run(0, 20).yaw, 0));
test('one-leg steer: peak rate at most 30 deg/s, 15-45 deg per cycle', () => {
  const r = run(1, 30), cycles = r.st.phase - 0.9, per = (r.yaw * 180 / Math.PI) / cycles;
  assert.ok(r.peak <= YAW_MAX + 1e-9);
  assert.ok(per >= 15 && per <= 45, `per cycle ${per}`);
});
test('no yaw while held, resting or floating', () => {
  const st = swimState(); st.steer = 1; st.hold = 1; swimStep(st, prof, { urgency: 0.6, steer: 1 }, dt);
  assert.equal(swimMotion(st, prof, {}, dt).dyaw, 0);
  const f = swimState(); swimStep(f, prof, { floating: true, steer: 1 }, dt); assert.equal(swimMotion(f, prof, {}, dt).dyaw, 0);
});
test('a push is released only inside a kick, and wakes a floating frog', () => {
  const st = swimState(() => 0.5); st.phase = 0.3; queuePush(st, 2, 0);
  let moved = 0, ticks = 0;
  for (let i = 0; i < 200 && moved === 0; i++) {
    const before = st.phase;
    swimStep(st, prof, { floating: true, wake: true, rnd: () => 0.5 }, dt);
    const m = swimMotion(st, prof, {}, dt); ticks++;
    if (m.px) { moved = m.px; const p = st.phase - Math.floor(st.phase); assert.ok(p >= 0.08 && st.phase > before); }
  }
  assert.ok(moved > 0 && ticks > 1);
});

test('spin turns only with a stroke playing (st.act, st.sp); a floating body drifts at most DRIFT_MAX without a stroke', async () => {
  const { swimMotion, queuePush, DRIFT_MAX } = await import('../src/util/swimturn.js');
  const st = { act: 0, v: 0 };
  const m = swimMotion(st, {}, { intent: 'spin', dir: -1 }, 0.1);
  assert.ok(m.dyaw === 0 && m.fwd === 0);
  const f = { act: 0, fl: 1, v: 0 }; queuePush(f, 3, 0);
  const d = swimMotion(f, {}, {}, 0.5);
  assert.ok(Math.abs(d.px - DRIFT_MAX * 0.5) < 1e-9 && d.dyaw === 0);
});
