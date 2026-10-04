// The graphics governor: it must move rarely, ignore warm-up and stalls, not retry a level that just failed, and end at a
// level that leaves the GPU some idle time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Governor, PRESETS, autoCeiling } from '../src/engine/governor.js';

// Drives a governor with frames of a given length for a given number of seconds of (fake) time. Returns the changes it made.
// `cpu` is the main thread's time a frame, `gpu` the GPU latency sampled every fourth frame (both optional, in ms).
// `ms` is a frame's length, or a function of the governor's level giving it (a machine that a smaller picture speeds up).
function run(gov, clock, ms, seconds, { jitter = 0, stallEvery = 0, stallMs = 0, cpu, gpu } = {}) {
  const changes = []; let n = 0;
  for (let t = 0; t < seconds * 1000;) {
    const dt = (typeof ms === 'function' ? ms(gov.level) : ms) + (jitter ? ((n * 7) % 5 - 2) * jitter : 0) + (stallEvery && n % stallEvery === stallEvery - 1 ? stallMs : 0);
    clock.t += dt; t += dt; n++;
    if (gpu !== undefined && n % 4 === 0) gov.gpu(gpu);
    const c = gov.frame(dt / 1000, cpu);
    if (c) changes.push({ at: Math.round(clock.t / 1000), ...c });
  }
  return changes;
}
// A GPU that pixels keep busy: at full scale 60 % of its frame is per-pixel work, which shrinks with the scale squared.
const pixels = (base) => (L) => base * (0.4 + 0.6 * L.scale * L.scale);
const make = (opts = {}) => { const clock = { t: 0 }; return { clock, gov: new Governor({ now: () => clock.t, ...opts }) }; };

test('a comfortable level is left alone', () => {
  const { gov, clock } = make();
  assert.deepEqual(run(gov, clock, 16.7, 120, { jitter: 0.4 }), []);
  assert.deepEqual(gov.level, { q: 2, scale: 1, cap: 60 });
});

test('warm-up is not measured, however slow', () => {
  const { gov, clock } = make();
  gov.warm(300);
  assert.deepEqual(run(gov, clock, 60, 12), []);           // 200 frames of 60 ms: all inside the warm-up
});

test('a stall in a window does not trigger a change (the window is judged by its median)', () => {
  const { gov, clock } = make();
  assert.deepEqual(run(gov, clock, 16.7, 90, { stallEvery: 20, stallMs: 900 }), []);
});

test('a slow machine steps down the ladder: scale first, then preset, then the 30 fps cap, one rung at a time', () => {
  const { gov, clock } = make();
  const ch = run(gov, clock, pixels(38), 240);
  const seq = ch.map((c) => `${PRESETS[c.q]}@${c.scale}/${c.cap}`);
  assert.deepEqual(seq.slice(0, 3), ['high@0.85/60', 'high@0.7/60', 'high@0.6/60']);
  assert.ok(seq.includes('balanced@0.85/60'), seq.join(' '));
  assert.ok(seq.includes('low@0.85/60'), seq.join(' '));
  assert.equal(gov.level.cap, 30, `ends capped at 30 fps (${seq.join(' ')})`);
  for (let i = 1; i < ch.length; i++) assert.ok(ch[i].at - ch[i - 1].at >= 4, 'changes are at least a few seconds apart');
});

// Runs until the governor makes a change (or the time is up); returns it.
function runUntilChange(gov, clock, ms, maxSeconds) {
  for (let t = 0; t < maxSeconds * 1000; t += ms) { clock.t += ms; const c = gov.frame(ms / 1000); if (c) return c; }
  return null;
}

test('a level that failed is not retried for a while, then it is', () => {
  const { gov, clock } = make();
  const down = run(gov, clock, 38, 20);                    // too slow at full scale
  assert.equal(down.length, 1, JSON.stringify(down));
  assert.equal(gov.level.scale, 0.85);
  const quiet = run(gov, clock, 16.7, 70);                 // fast ever after: it may creep back up, but never to the level that failed
  for (const c of quiet) assert.ok(c.scale < 1, `retried the failed level inside the memory: ${JSON.stringify(c)}`);
  assert.ok(gov.level.scale < 1);
  const later = run(gov, clock, 16.7, 80);                 // the memory has expired
  assert.equal(gov.level.scale, 1, JSON.stringify(later));
});

test('a retry that fails again is remembered for longer', () => {
  const { gov, clock } = make();
  run(gov, clock, 38, 20);                                  // down to 0.85: the failure is remembered
  assert.ok(runUntilChange(gov, clock, 16.7, 200), 'it creeps back up');
  const firstFor = gov.badFor;
  assert.ok(runUntilChange(gov, clock, 38, 60), 'and the new level is too slow too');
  assert.ok(gov.badFor > firstFor, `${gov.badFor} > ${firstFor}`);
});

test('a lowered frame-rate cap is not tried again soon (frames at the cap say nothing about the GPU)', () => {
  const { gov, clock } = make({ q: 0, scale: 0.6, cap: 30, capMax: 60 });   // as loaded from a saved profile
  assert.deepEqual(run(gov, clock, 33.3, 200), [], 'no attempt to go back to 60 inside five minutes');
  const later = run(gov, clock, 33.3, 150);
  assert.ok(later.some((c) => c.cap === 60 || c.scale > 0.6), 'after that it may look again');
});

test('Auto off: the preset is never touched (scale and cap still move)', () => {
  const { gov, clock } = make({ autoQuality: false });
  const ch = run(gov, clock, pixels(38), 300);
  for (const c of ch) assert.equal(c.q, 2);
  assert.equal(gov.level.q, 2);
  assert.ok(gov.level.scale <= 0.6 + 1e-9 && gov.level.cap === 30);
});

test('a level set by hand is taken as it is, with a fresh warm-up', () => {
  const { gov, clock } = make();
  run(gov, clock, 38, 12);
  gov.set({ q: 1, scale: 1 });
  assert.deepEqual(gov.level, { q: 1, scale: 1, cap: 60 });
  assert.deepEqual(run(gov, clock, 50, 2), [], 'the first moments after a set are not measured');
});

test('the ceiling Auto may reach: any preset on WebGPU, the one it started on on WebGL 2', () => {
  assert.equal(autoCeiling('WebGPU', 'high'), 2);
  assert.equal(autoCeiling('WebGPU', 'low'), 2);
  assert.equal(autoCeiling('WebGL 2', 'low'), 0);
  assert.equal(autoCeiling('WebGL 2', 'balanced'), 1);
  assert.equal(autoCeiling('WebGL 2', 'ultra'), 0, 'a preset Auto does not know starts at the bottom');
});

test('with a ceiling the preset is never raised by Auto, however fast the frames, while the resolution still recovers and it can still step down', () => {
  const { gov, clock } = make({ q: 1, qMax: 1, scale: 0.7 });
  const ch = run(gov, clock, 12, 300);                       // very fast frames for five minutes
  assert.ok(ch.length >= 1, 'the resolution comes back');
  for (const c of ch) assert.equal(c.q, 1, JSON.stringify(c));
  assert.equal(gov.level.scale, 1);
  assert.equal(gov.level.q, 1, 'balanced stays balanced');
  const down = run(gov, clock, 40, 120);                     // then the machine struggles: it may still go down
  assert.ok(down.some((c) => c.q === 0), JSON.stringify(down));
});

test('frames the browser paces (an iPhone in Low Power Mode: 30 a second, GPU and main thread mostly idle) change nothing', () => {
  const { gov, clock } = make();
  assert.deepEqual(run(gov, clock, 33.3, 300, { jitter: 0.3, cpu: 6, gpu: 9 }), []);
  assert.deepEqual(gov.level, { q: 2, scale: 1, cap: 60 });
  assert.equal(gov.why, 'paced');
});

test('a main thread that is the bottleneck lowers only the frame cap, never the picture', () => {
  const { gov, clock } = make();
  const ch = run(gov, clock, 38, 300, { cpu: 31, gpu: 8 });
  assert.equal(ch.length, 1, JSON.stringify(ch));
  assert.deepEqual(gov.level, { q: 2, scale: 1, cap: 30 });
  assert.equal(ch[0].reason, 'cpu');
});

test('a GPU that is the bottleneck (its latency a frame or more) still steps down as before', () => {
  const { gov, clock } = make();
  const ch = run(gov, clock, pixels(38), 240, { cpu: 6, gpu: 45 });
  const seq = ch.map((c) => `${PRESETS[c.q]}@${c.scale}/${c.cap}`);
  assert.deepEqual(seq.slice(0, 3), ['high@0.85/60', 'high@0.7/60', 'high@0.6/60']);
  assert.equal(gov.level.cap, 30, 'and ends at the bottom of the ladder');
});

test('a busy main thread that delays the GPU answer reads as a busy GPU (the old behaviour, never a wrong "paced")', () => {
  const { gov, clock } = make();
  const ch = run(gov, clock, 38, 30, { cpu: 31, gpu: 30 });
  assert.ok(ch.length >= 1 && ch[0].scale < 1, JSON.stringify(ch));
});

test('the scale floor the graphics set (a phone: one render pixel a CSS pixel) is where the scale steps stop', () => {
  const { gov, clock } = make({ scaleMin: 0.82 });
  const seq = run(gov, clock, pixels(38), 240).map((c) => `${PRESETS[c.q]}@${c.scale}/${c.cap}`);
  assert.deepEqual(seq.slice(0, 3), ['high@0.85/60', 'high@0.82/60', 'balanced@0.85/60'], seq.join(' '));
});

test('a GPU busy with something other than pixels (frames as slow at any scale) gets its resolution back: the preset and the cap do the rest', () => {
  const { gov, clock } = make();
  const ch = run(gov, clock, 38, 300, { cpu: 6, gpu: 30 });     // as Safari on the Mac recorded it: 0.6 no faster than 1
  const seq = ch.map((c) => `${PRESETS[c.q]}@${c.scale}/${c.cap}`);
  assert.deepEqual(seq.slice(0, 2), ['high@0.85/60', 'high@1/60'], seq.join(' '));
  assert.equal(ch[1].reason, 'no-gain');
  for (const c of ch.slice(2)) assert.equal(c.scale, 1, `no second try at fewer pixels: ${seq.join(' ')}`);
  assert.deepEqual(gov.level, { q: 0, scale: 1, cap: 30 }, seq.join(' '));
  gov.set({ q: 2, scale: 1, cap: 60 });
  assert.equal(gov.pixelFloor, 0, 'a level set by hand forgets it');
});
