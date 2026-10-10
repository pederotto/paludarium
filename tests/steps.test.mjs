// A one-body frog's feet on the ground (9 Oct 2026; util/steps.js, render/creatures/skeleton.js stepDirs, sim/animals.js oneBodySteps). The owner's movement rule: no yaw without the legs
// stepping, no slide while posed. The stepper is pure and is tested alone; the legs solved to its feet are measured on the shipped file by tools/rig/steps-check.mjs (CPU skinning).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { STEP, stepperNew, stepperStep, stepSwing, stepTurnCap } from '../src/util/steps.js';

const HOMES = [{ key: 'h-1', G: [-0.9, -0.2, -1.6], D: [0, -0.3, 0.9], slack: 3 }, { key: 'h1', G: [0.9, -0.2, -1.6], D: [0, -0.3, 0.9], slack: 3 }, { key: 'f-1', G: [-0.8, 0, 1.1], D: [0, -0.2, 1], slack: 0.7 }, { key: 'f1', G: [0.8, 0, 1.1], D: [0, -0.2, 1], slack: 0.7 }];
const SVL = 2.73, dt = 1 / 60;
const qyaw = (a) => [0, Math.sin(a / 2), 0, Math.cos(a / 2)];
// a body turned at `rate` rad/s and walked at `speed` cm/s for `secs`, the stepper's feet recorded each tick
function film({ rate = 0, speed = 0, secs = 1.5, rest = 1.5 }) {
  const S = stepperNew(HOMES), log = []; let yaw = 0, pos = [0, 0, 0];
  for (let f = 0; f < Math.round((secs + rest) / dt); f++) {
    if (f < Math.round(secs / dt)) { yaw += rate * dt; pos = [pos[0] + Math.sin(yaw) * speed * dt, 0, pos[2] + Math.cos(yaw) * speed * dt]; }
    const active = stepperStep(S, { pos, q: qyaw(yaw), sc: 1 }, dt, STEP, SVL);
    log.push({ active, yaw, feet: S.feet.map((ft) => ({ key: ft.key, W: ft.W.slice(), air: !!ft.to })) });
  }
  return { S, log };
}

test('a body at rest keeps the plain stance: the stepper stays quiet', () => {
  const { log } = film({ secs: 1, rest: 0 });
  assert.ok(log.every((l) => !l.active), 'no foot moved');
});

test('a body turned on the spot steps its feet round, and never two feet of one girdle or one side in the air together', () => {
  const { log } = film({ rate: 1.6, secs: 2 });
  let starts = 0, bad = 0;
  for (let i = 1; i < log.length; i++) for (const ft of log[i].feet) { const was = log[i - 1].feet.find((o) => o.key === ft.key); if (ft.air && !was.air) starts++; }
  for (const l of log) { const air = l.feet.filter((f) => f.air); for (let i = 0; i < air.length; i++) for (let j = i + 1; j < air.length; j++) if (air[i].key[0] === air[j].key[0] || air[i].key.slice(1) === air[j].key.slice(1)) bad++; }
  assert.ok(starts >= 12, `a half turn took ${starts} steps`);
  assert.equal(bad, 0, 'two feet of a girdle or a side in the air together');
});

test('a planted foot stays exactly where it was put while the body moves over it (no slide)', () => {
  for (const run of [{ rate: 1.6, secs: 2 }, { speed: 3, secs: 2 }, { rate: 0.8, speed: 2.5, secs: 2 }]) {
    const { log } = film(run); let slide = 0;
    for (let i = 1; i < log.length; i++) if (log[i].active && log[i - 1].active) for (const ft of log[i].feet) { const was = log[i - 1].feet.find((o) => o.key === ft.key); if (!ft.air && !was.air) slide = Math.max(slide, Math.hypot(ft.W[0] - was.W[0], ft.W[1] - was.W[1], ft.W[2] - was.W[2])); }
    assert.ok(slide < 1e-9, `${JSON.stringify(run)}: a planted foot moved ${slide} cm`);
  }
});

test('a walk steps every foot, about a step of a centimetre each', () => {
  const { log } = film({ speed: 3, secs: 3, rest: 0 }), who = new Set(); let n = 0;
  for (let i = 1; i < log.length; i++) log[i].feet.forEach((ft, k) => { if (ft.air && !log[i - 1].feet[k].air) { who.add(ft.key); n++; } });
  assert.equal(who.size, 4, 'all four feet stepped');
  // 3 cm/s for 3 s is 9 cm: a step carries a foot about a centimetre, so each foot steps six to ten times
  assert.ok(n >= 16 && n <= 60, `${n} steps in a 9 cm walk`);
});

test('after the body stops the feet step home and the stepper goes quiet (the plain stance again)', () => {
  const { log } = film({ rate: 1.6, secs: 1, rest: 2 });
  const last = log[log.length - 1], quietAt = log.findIndex((l, i) => i > 60 && !l.active);
  assert.equal(last.active, false, 'still stepping 2 s after it stopped');
  assert.ok(quietAt > 0 && (quietAt - 60) / 60 < 1, `quiet ${(quietAt - 60) / 60} s after it stopped`);
  assert.ok(last.feet.every((f) => !f.air));
});

test('a smaller frog steps faster and a bigger one turns slower: the step time grows as the root of the length, the fastest yaw falls with it', () => {
  assert.ok(stepSwing(2.73) < stepSwing(5.72));
  assert.ok(stepTurnCap(2.73) > stepTurnCap(5.72));
  assert.ok(stepTurnCap(2.73) > 1.2 && stepTurnCap(2.73) < 3, `harlequin ${stepTurnCap(2.73)} rad/s`);
});

// The legs solved to those feet on the harlequin's shipped file: the tips where the feet are, nothing sliding, nothing through the floor (the stance's own skin height, 1.5 mm).
test('the harlequin walks and turns on its feet: the legs reach them, nothing slides, nothing goes through the ground', () => {
  const j = JSON.parse(execFileSync(process.execPath, ['tools/rig/steps-check.mjs', 'harlequin.swim', '--json', '--rate', '1.9', '--speed', '3.5', '--secs', '2', '--every', '4'], { cwd: new URL('..', import.meta.url), encoding: 'utf8', maxBuffer: 1 << 24 }).trim().split('\n').pop());
  for (const r of j.runs) {
    assert.ok(r.steps >= 16, `${r.run}: ${r.steps} steps`);
    assert.equal(r.conflicts, 0, `${r.run}: feet of one girdle or side in the air together`);
    assert.ok(r.tipErrCm <= 0.12, `${r.run}: a foot ${r.tipErrCm} cm from where it should be`);
    assert.ok(r.plantedSlideCm <= 0.06, `${r.run}: a planted foot slid ${r.plantedSlideCm} cm`);
    assert.ok(r.lowestCm >= Math.min(j.stanceLow, 0) - 0.15, `${r.run}: the skin ${r.lowestCm} cm under the ground (the stance's ${j.stanceLow})`);
  }
});
