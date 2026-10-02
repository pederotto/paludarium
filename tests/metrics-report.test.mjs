// The report (src/diag/report.js): recorded sessions in, numbers and findings out. Sessions here are made with the real recorder
// on a fake clock, so the whole path (frames -> chunks -> NDJSON -> summary) is covered.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Recorder, FLAG } from '../src/diag/recorder.js';
import { summarize, renderText, compareText, parseNdjson, decodeFrames } from '../src/diag/report.js';

// spec.segments: [{ phase, secs, ms, sim, rnd, warm }]; spec.events: [[atMs, name, fields]] relative to the start; spec.gauges: set before the first frame.
function session(spec = {}) {
  const clock = { t: 5000 };
  const rec = new Recorder({ sid: spec.sid ?? 'sess1', label: spec.label ?? 'test', now: () => clock.t });
  const t0 = rec.t0;
  const env = { k: 'env', ver: 1, label: rec.label, t0, wall: Date.UTC(2026, 9, 1, 12, 0, 0), ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/142', cores: 12, memGB: 8, touch: 10, secure: false,
    uaHigh: spec.uaHigh ?? { architecture: 'arm', bitness: '64', platform: 'Windows', platformVersion: '15.0.0', fullVersionList: [{ brand: 'Not.A/Brand', version: '99' }, { brand: 'Google Chrome', version: '142.0.1' }] },
    screen: { w: 2880, h: 1800, dpr: 2 }, win: { iw: 1440, ih: 900 }, display: {} };
  const evq = [...(spec.events ?? [])].sort((a, b) => a[0] - b[0]);
  for (const [k, v] of Object.entries(spec.gauges ?? { q: 'low', sc: 0.85, cap: 60, pr: 1.7, calls: 220, tris: 2300000, animals: 106, plants: 51 })) rec.gauge(k, v);
  rec.event('gpu-info', { api: 'webgl2', renderer: spec.gpu ?? 'ANGLE (Qualcomm, Adreno X2-45 GPU Direct3D11)', timer: false }, t0 + 1);
  rec.event('game', { backend: 'WebGL 2', quality: 'low', cap: 60, governor: true, params: [] }, t0 + 1);
  let t = t0 + 100;
  for (const seg of spec.segments ?? [{ phase: 'play', secs: 10, ms: 1000 / 60 }]) {
    rec.setPhase(seg.phase);
    const end = t + seg.secs * 1000;
    let n = 0;
    for (; t < end; n++) {
      while (evq.length && t0 + evq[0][0] <= t) { const [at, name, f] = evq.shift(); rec.event(name, f, t0 + at); }
      const ms = typeof seg.ms === 'function' ? seg.ms(n) : seg.ms;
      clock.t = t;
      rec.frameBegin(t, n < (seg.warm ?? 0) ? FLAG.WARM : 0);
      const rnd = typeof seg.rnd === 'function' ? seg.rnd(n) : seg.rnd ?? 3;
      rec.renderBegin(t + (seg.sim ?? 2)); rec.renderEnd(t + (seg.sim ?? 2) + rnd);
      rec.frameEnd(t + (seg.sim ?? 2) + rnd, n % 15 === 0);
      if (seg.gpu) rec.gpu(seg.gpu);
      t += ms;
    }
  }
  while (evq.length) { const [at, name, f] = evq.shift(); rec.event(name, f, t0 + at); }
  clock.t = t;
  const records = [env, ...rec.drain(true)].map((r) => ({ sid: rec.sid, ...r }));
  return { records, rec, t0 };
}

test('a healthy session reads as healthy: the numbers, the phases, and nothing wrong', () => {
  const { records } = session({ segments: [{ phase: 'title', secs: 3, ms: 16.7, warm: 20 }, { phase: 'play', secs: 20, ms: 16.7, gpu: 6 }] });
  const S = summarize(records);
  assert.equal(S.sid, 'sess1');
  assert.deepEqual(S.phases.map((p) => p.name), ['title', 'play']);
  const H = S.headline;
  assert.ok(Math.abs(H.fps - 60) < 1, `fps ${H.fps}`);
  assert.ok(H.p95 < 17.5 && H.max < 17.5, `p95 ${H.p95} max ${H.max}`);
  assert.equal(H.frames, S.phases[1].frames);
  assert.equal(S.phases[0].warm, 20, 'warm-up frames are counted apart');
  assert.deepEqual(S.findings.map((f) => f.sev), ['info', 'ok'].filter((x) => S.findings.some((f) => f.sev === x)));
  assert.ok(S.findings.some((f) => f.sev === 'ok'), JSON.stringify(S.findings));
  assert.equal(S.device.os, 'Windows 11');
  assert.equal(S.device.browser, 'Google Chrome 142');
  assert.equal(S.device.arch, 'arm-64');
  assert.match(S.gpu.name, /Adreno/);
  assert.equal(H.level.animals, 106);
});

test('warm-up frames, however slow, do not poison the steady numbers', () => {
  const { records } = session({ segments: [{ phase: 'play', secs: 12, ms: (n) => (n < 4 ? 400 : 16.7), warm: 5 }] });   // five warm frames, the first four of them 400 ms apart
  const S = summarize(records);
  assert.ok(S.headline.p99 < 18 && S.headline.max < 18, `max ${S.headline.max}`);
  assert.equal(S.headline.warm, 5);
});

test('a struggling session is called out: freezes, a slow GPU, a lost context, blank frames, hunting governor, battery', () => {
  const events = [[3000, 'blank-risk', { sinceRenderMs: 2 }], [3000, 'canvas', { w: 1200, h: 700, inFrame: true, afterRender: true }], [9000, 'context-lost', {}],
    [2000, 'battery', { charging: false, level: 41 }], [4000, 'console', { l: 'error', m: 'THREE.WebGLProgram: Shader Error 0' }]];
  for (let i = 0; i < 10; i++) events.push([1000 + i * 1500, 'gov', { from: { q: 'low', sc: 1, cap: 60 }, to: { q: 'low', sc: 0.85, cap: 60 }, why: 'slow' }]);
  const { records } = session({ segments: [{ phase: 'play', secs: 20, ms: (n) => (n % 40 === 0 ? 180 : 45), gpu: 38 }], events });
  const S = summarize(records);
  const bad = S.findings.filter((f) => f.sev === 'bad').map((f) => f.text).join(' | '), warn = S.findings.filter((f) => f.sev === 'warn').map((f) => f.text).join(' | ');
  assert.match(bad, /resized after a frame had been drawn 1 time/);
  assert.match(bad, /GPU or its context was lost 1 time/);
  assert.match(bad, /Frame time is poor/);
  assert.match(bad, /took over 100 ms/);
  assert.match(bad, /GPU is the limit: a frame takes 38\.0 ms/);
  assert.match(warn, /governor changed settings 10 times/);
  assert.match(warn, /on battery \(41%\)/);
  assert.match(warn, /error or warning message/);
  assert.equal(S.errors[0].m, 'THREE.WebGLProgram: Shader Error 0');
  assert.ok(S.headline.fps < 30);
  const text = renderText(S);
  for (const must of ['## Findings', '## Headline', '## Load', '## Frames by phase', '## Black flashes', '## Responsiveness', '## Errors and warnings', 'Adreno']) assert.ok(text.includes(must), must);
});

test('a 30 Hz screen on battery is called the energy saver, and the numbers are marked unrepresentative', () => {
  const { records } = session({ events: [[500, 'battery', { charging: false, level: 19 }], [600, 'display', { hz: 30, maxGap: 40 }]] });
  const S = summarize(records);
  assert.ok(S.findings.some((f) => f.sev === 'bad' && /energy saver/.test(f.text) && /19%/.test(f.text)), JSON.stringify(S.findings));
});

test('an x64 browser on a Qualcomm laptop is flagged as emulated', () => {
  const { records } = session({ uaHigh: { architecture: 'x86', bitness: '64', platform: 'Windows', platformVersion: '15.0.0', fullVersionList: [{ brand: 'Microsoft Edge', version: '142' }] } });
  const S = summarize(records);
  assert.ok(S.findings.some((f) => /emulation/.test(f.text)), JSON.stringify(S.findings));
  assert.equal(S.device.browser, 'Microsoft Edge 142');
});

test('one touch is one slow input, however many events it made; a canvas resize is one change however many assignments', () => {
  const events = [[1000, 'inp', { type: 'pointerdown', d: 300, id: 7 }], [1001, 'inp', { type: 'pointerup', d: 310, id: 7 }], [1002, 'inp', { type: 'click', d: 320, id: 7 }], [5000, 'inp', { type: 'keydown', d: 90, id: 8 }],
    [2000, 'canvas', { w: 800, h: 150, inFrame: true, afterRender: false }], [2000.4, 'canvas', { w: 800, h: 600, inFrame: true, afterRender: false }], [6000, 'canvas', { w: 900, h: 600, inFrame: true, afterRender: false }]];
  const S = summarize(session({ events }).records);
  assert.equal(S.inp.n, 2);
  assert.equal(S.inp.worst, 320);
  assert.equal(S.inp.over200, 1);
  assert.equal(S.blank.changes, 2);
});

test('a mark is placed in the recording with what was happening around it', () => {
  const events = [[8000, 'gov', { from: { q: 'high', sc: 1, cap: 60 }, to: { q: 'high', sc: 0.85, cap: 60 }, why: 'slow' }], [8200, 'longtask', { d: 240 }], [8500, 'mark', { label: 'flash' }]];
  const { records } = session({ segments: [{ phase: 'play', secs: 12, ms: (n) => (n === 480 ? 250 : 16.7) }], events });
  const S = summarize(records);
  assert.equal(S.marks.length, 1);
  assert.equal(S.marks[0].label, 'flash');
  assert.ok(S.marks[0].near.some((x) => x.startsWith('gov')) && S.marks[0].near.some((x) => x.startsWith('longtask 240ms')), S.marks[0].near.join());
  assert.ok(S.marks[0].worstGap >= 250, `worst gap ${S.marks[0].worstGap}`);
  assert.match(renderText(S), /"flash": worst frame 2\d\d ms/);
});

test('the same session through NDJSON text gives the same summary, a torn last line is ignored, and a retried chunk is not counted twice', () => {
  const { records } = session({ segments: [{ phase: 'play', secs: 8, ms: 16.7 }] });
  const text = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
  const direct = summarize(records);
  assert.deepEqual(JSON.parse(JSON.stringify(summarize(parseNdjson(text)))), JSON.parse(JSON.stringify(direct)));
  assert.equal(parseNdjson(text + '{"sid":"sess1","k":"fr","t0"').length, records.length, 'a half-written line is dropped');
  const fr = records.find((r) => r.k === 'fr');
  const dup = [...records, fr];
  assert.equal(decodeFrames(dup).n, decodeFrames(records).n);
  assert.equal(summarize(dup).headline.frames, direct.headline.frames);
});

test('compare puts two sessions side by side with the change', () => {
  const a = summarize(session({ sid: 'aaaa1', label: 'before', segments: [{ phase: 'play', secs: 10, ms: 25 }] }).records);
  const b = summarize(session({ sid: 'bbbb1', label: 'after', segments: [{ phase: 'play', secs: 10, ms: 16.7 }] }).records);
  const text = compareText(a, b);
  assert.match(text, /# Compare: before vs after/);
  assert.match(text, /\| frame p95 \(ms\) \| 2\d\.\d \| 1[67]\.\d \| -3\d%/);
  assert.match(text, /\| fps \| 4\d\.\d \| [56]\d\.\d \| \+/);
});

test('a freeze is found with its cause, once, even when the frame after it is warm-up and the headline leaves it out', () => {
  // frame 1500 of the play phase (25 s in) compiles shaders for 20 s inside the frame in which the governor changed the pipeline
  const at = 100 + 1500 * (1000 / 60);
  const events = [[at + 3, 'pipeline-build', { ms: 6, q: 'high' }], [at + 4, 'gov', { from: { q: 'balanced', sc: 1, cap: 60 }, to: { q: 'high', sc: 0.85, cap: 60 }, why: 'fast' }]];
  const { records } = session({ segments: [{ phase: 'play', secs: 60, ms: (n) => (n === 1500 ? 20000 : 1000 / 60), rnd: (n) => (n === 1500 ? 19990 : 3), warm: 0 }], events });
  const S = summarize(records);
  assert.equal(S.freezes.length, 1, JSON.stringify(S.freezes));
  assert.ok(S.freezes[0].ms > 19900 && S.freezes[0].ms < 20100, `${S.freezes[0].ms}`);
  assert.match(S.freezes[0].cause, /pipeline rebuilt \(high\), governor balanced@1 → high@0\.85/);
  const bad = S.findings.filter((f) => f.sev === 'bad').map((f) => f.text).join(' | ');
  assert.match(bad, /froze 1 time for a second or more while playing \(longest 20\.\d s at \d+\.\d s, right after: pipeline rebuilt/);
  assert.match(renderText(S), /## Freezes[^\n]*\n1 in all, 20\.\d s frozen:\n- /);
});

test('a freeze while the tank is still warming up after the screen lifts is not called a freeze in play', () => {
  const { records } = session({ segments: [{ phase: 'play', secs: 6, ms: (n) => (n === 100 ? 1500 : 1000 / 60), rnd: (n) => (n === 100 ? 1490 : 3), warm: 400 }], events: [[10, 'veil', {}]] });
  const S = summarize(records);
  assert.equal(S.freezes.length, 1);
  assert.ok(!S.findings.some((f) => /froze/.test(f.text)), JSON.stringify(S.findings));
});

test('a session with no frames says so instead of failing', () => {
  const S = summarize(session({ segments: [] }).records);
  assert.ok(S.findings.some((f) => /No game frames/.test(f.text)));
  assert.equal(S.headline.frames, 0);
  assert.ok(renderText(S).length > 100);
});
