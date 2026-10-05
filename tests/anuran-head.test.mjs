// The frog's buccal pump (content/anuranheadmuscles.js; the owner, 5 Oct: "muscle mechanics should also be applied to breathing,mouth and
// head movements") against the frog it is read from: Vitalis & Shelton 1990 (Rana pipiens, unrestrained): 90 ± 3.2 buccal oscillations
// and 6.3 ± 0.8 lung ventilations a minute; in a lung breath the lungs empty before the floor pumps them full. Ten simulated minutes
// at 60 frames a second, as the game steps it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buccalState, buccalStep, pumpThroat, pumpBreath, BUCCAL, swallowDrive, eyeStep } from '../src/content/anuranheadmuscles.js';

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
function run(minutes, alert = 0) {
  const s = buccalState(0.3, 0.5), dt = 1 / 60, ys = [], lungs = [];
  for (let i = 0; i < minutes * 3600; i++) { buccalStep(s, dt, alert, null, rnd); ys.push(s.y); lungs.push(s.lung); }
  return { s, ys, lungs };
}
const R = run(10);

test('the throat floor oscillates 90 ± 10 times a minute and the lungs fill 6.3 ± 1.6 times a minute (Vitalis & Shelton 1990)', () => {
  // (a buccal cycle seen on the throat: the floor's deepest points, where it turns back up from below a quarter of its travel)
  let lows = 0;
  for (let i = 2; i < R.ys.length; i++) if (R.ys[i - 1] > R.ys[i - 2] && R.ys[i - 1] >= R.ys[i] && R.ys[i - 1] > 0.25) lows++;
  const perMin = (R.s.cycles + R.s.breaths) / 10, lung = R.s.breaths / 10;
  assert.ok(perMin >= 80 && perMin <= 100, `${perMin.toFixed(1)} floor cycles a minute`);
  assert.ok(lung >= 4.7 && lung <= 7.9, `${lung.toFixed(1)} lung breaths a minute`);
  assert.ok(Math.abs(lows / 10 - perMin) < 12, `the floor turned ${(lows / 10).toFixed(1)} times a minute for ${perMin.toFixed(1)} cycles`);
});

test('a lung breath: the floor drops deep, the lungs empty (the flanks sink), then the floor rises and fills them again', () => {
  const s = buccalState(0.95, 0.5), dt = 1 / 60;
  s.n = s.every - 1;                                   // (the next cycle ends in a lung breath)
  let t = 0, lowAt = -1, emptyAt = -1, fullAt = -1, minLung = 1, deep = 0;
  const trace = [];
  while (t < 3) {
    buccalStep(s, dt, 0, null, () => 0.5); t += dt; trace.push([t, s.lung]);
    if (s.mode === 'lung') deep = Math.max(deep, s.y);
    if (s.mode === 'lung' && s.lung < minLung) { minLung = s.lung; emptyAt = t; }
    if (s.mode === 'lung' && s.y > 0.8 && lowAt < 0) lowAt = t;
  }
  fullAt = trace.find(([tt, l]) => tt > emptyAt && l > 0.8)?.[0] ?? -1;
  assert.ok(deep > 0.8, `the floor dropped to ${deep.toFixed(2)} of its travel`);
  assert.ok(minLung < 0.35, `the lungs emptied to ${minLung.toFixed(2)}`);
  assert.ok(lowAt > 0 && emptyAt > lowAt - 0.2 && fullAt > emptyAt, `deep at ${lowAt.toFixed(2)} s, empty at ${emptyAt.toFixed(2)} s, full at ${fullAt.toFixed(2)} s`);
});

test('between lung breaths the lungs hold their air (the glottis shut) while the throat flutters', () => {
  const held = [];
  const s = buccalState(0.1, 0.1), dt = 1 / 60;
  for (let i = 0; i < 900; i++) { buccalStep(s, dt, 0, null, () => 0.9); if (s.mode === 'osc' && s.breaths > 0) held.push(s.lung); }
  assert.ok(held.length > 60 && Math.max(...held) - Math.min(...held) < 0.02, `fill between breaths ${Math.min(...held).toFixed(3)}-${Math.max(...held).toFixed(3)}`);
});

test('the pump drives the rig\'s channels inside their ranges, smoothly (muscle forces, no jumps between frames)', () => {
  const th = R.ys.map((y) => pumpThroat({ y })), br = R.lungs;
  assert.ok(Math.min(...th) >= 0 && Math.max(...th) <= 0.62, `throat ${Math.min(...th).toFixed(2)}-${Math.max(...th).toFixed(2)} (the rig's everyday range is 0.62)`);
  assert.ok(Math.min(...br) >= 0 && Math.max(...br) <= 1, 'flanks 0 … 1');
  let jump = 0;
  for (let i = 1; i < th.length; i++) jump = Math.max(jump, Math.abs(th[i] - th[i - 1]));
  assert.ok(jump < 0.06, `the throat moved ${jump.toFixed(3)} in one frame`);
  // the everyday flutter is small, the lung breath's drop large
  const osc = R.ys.filter((_, i) => i % 7 === 0).sort((a, b) => a - b);
  assert.ok(osc[Math.floor(osc.length * 0.5)] < 0.45, `median floor ${osc[Math.floor(osc.length * 0.5)].toFixed(2)}`);
});

test('with its muscles off the floor settles at rest: it moves only by them', () => {
  const s = buccalState(0, 0); s.y = 0.8; s.vy = 0;
  for (let i = 0; i < 120; i++) { s.aLo = 0; s.aHi = 0; s.mode = 'hold'; buccalStep(s, 1 / 60, 0, null); }
  assert.ok(Math.abs(s.y - BUCCAL.floor.rest) < 0.01, `floor at ${s.y.toFixed(3)}`);
});

test('a swallow pulls the eyes in twice, each push easing back as the retractor relaxes', () => {
  let a = 0, peaks = 0, prev = 0, rising = false;
  for (let i = 0; i <= 60; i++) {
    const d = swallowDrive(i / 60); a = eyeStep(a, d.eye, 0.5 / 60);
    if (a > prev) rising = true; else if (rising && a < prev - 1e-4) { peaks++; rising = false; }
    prev = a;
  }
  assert.equal(peaks, 2);
});
