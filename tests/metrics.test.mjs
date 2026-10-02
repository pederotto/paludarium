// The metrics recorder (src/diag): statistics, wire encoding, per-frame and per-second recording, and the blank-frame watch.
// The browser-side wiring (probes, overlay) is checked in a real browser by tools/steps/metrics.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameHist, quantile, describe, refreshRate, binOf, binMid, NBINS } from '../src/diag/stats.js';
import { toB64, fromB64 } from '../src/diag/codec.js';
import { Recorder, FLAG } from '../src/diag/recorder.js';

test('histogram percentiles stay within half a bin of the exact ones', () => {
  const h = new FrameHist(), vals = [];
  let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < 5000; i++) { const v = 8 + rnd() * 20 + (rnd() < 0.02 ? 80 * rnd() : 0); vals.push(v); h.add(v); }
  vals.sort((a, b) => a - b);
  for (const p of [0.5, 0.9, 0.95, 0.99]) assert.ok(Math.abs(h.percentile(p) - quantile(vals, p)) <= 0.13, `p${p * 100}: ${h.percentile(p)} vs ${quantile(vals, p)}`);
  assert.equal(h.percentile(1), vals[vals.length - 1], 'the maximum is exact');
  assert.equal(h.n, 5000);
  assert.ok(Math.abs(h.mean() - vals.reduce((a, b) => a + b) / vals.length) < 1e-9);
});

test('histogram bins cover 0 to 10 s and above, in order', () => {
  let prev = -1;
  for (const ms of [0, 0.2, 0.25, 16.7, 99.9, 100, 104.9, 105, 999, 1000, 1049, 1050, 9999, 10000, 1e6]) {
    const b = binOf(ms); assert.ok(b >= prev && b < NBINS, `${ms} -> ${b}`); prev = b;
  }
  assert.ok(Math.abs(binMid(binOf(16.7)) - 16.7) < 0.13);
  assert.equal(binOf(NaN), 0);
  const a = new FrameHist(), b = new FrameHist();
  a.add(10); b.add(30); b.add(50);
  assert.equal(a.merge(b).n, 3);
  assert.equal(a.max, 50); assert.equal(a.min, 10);
});

test('describe and refreshRate', () => {
  const d = describe([5, 1, 3, 2, 4]);
  assert.deepEqual([d.n, d.min, d.p50, d.max], [5, 1, 3, 5]);
  assert.equal(describe([]).n, 0);
  const jitter = (base) => Array.from({ length: 200 }, (_, i) => base + ((i * 7) % 5 - 2) * 0.05 + (i % 40 === 0 ? 30 : 0));
  assert.equal(refreshRate(jitter(16.67)), 60);
  assert.equal(refreshRate(jitter(8.33)), 120);
  assert.equal(refreshRate(jitter(6.94)), 144);
  assert.equal(refreshRate([16, 17]), 0, 'too few gaps to say');
});

test('typed arrays survive the base64 round trip, at any length', () => {
  for (const n of [0, 1, 2, 3, 100, 70000]) {
    const a = new Uint16Array(n).map((_, i) => (i * 2654435761) >>> 16), b = new Uint8Array(n).map((_, i) => i * 31);
    assert.deepEqual(Array.from(fromB64(toB64(a), Uint16Array)), Array.from(a));
    assert.deepEqual(Array.from(fromB64(toB64(b))), Array.from(b));
  }
  const view = new Uint16Array([1, 2, 3, 4, 5]).subarray(1, 4);   // a view with an offset, as drain() sends
  assert.deepEqual(Array.from(fromB64(toB64(view), Uint16Array)), [2, 3, 4]);
});

// A recorder on a fake clock; `frame` plays one game frame the way the adapter reports it.
function make(opts = {}) {
  const clock = { t: 1000 };
  const rec = new Recorder({ sid: 't', now: () => clock.t, ...opts });
  const frame = (begin, { sim = 4, rnd = 6, tck = 0, flags = 0 } = {}) => {
    clock.t = begin;
    rec.frameBegin(begin, flags);
    rec.renderBegin(begin + sim); rec.renderEnd(begin + sim + rnd);
    rec.frameEnd(begin + sim + rnd + tck, tck > 0);
    clock.t = begin + sim + rnd + tck;
  };
  return { rec, clock, frame };
}
const decode = (records) => {
  const fr = records.filter((r) => r.k === 'fr');
  return fr.flatMap((r) => Array.from(fromB64(r.gap, Uint16Array)).map((g, i) => ({ gap: g / 10, sim: fromB64(r.sim, Uint16Array)[i] / 10, rnd: fromB64(r.rnd, Uint16Array)[i] / 10, flg: fromB64(r.flg)[i] })));
};

test('frames are recorded with their gaps, split times and flags, and survive a drain', () => {
  const { rec, frame } = make();
  for (let i = 0; i < 10; i++) frame(1000 + i * 16.7, { tck: i === 5 ? 3 : 0, flags: i < 2 ? FLAG.WARM : 0 });
  const out = rec.drain();
  const f = decode(out);
  assert.equal(f.length, 10);
  assert.equal(f[0].gap, 0, 'the first frame has no predecessor');
  assert.ok(f.slice(1).every((x) => Math.abs(x.gap - 16.7) < 0.11), JSON.stringify(f.map((x) => x.gap)));
  assert.ok(Math.abs(f[3].sim - 4) < 0.11 && Math.abs(f[3].rnd - 6) < 0.11);
  assert.equal(f[0].flg & FLAG.WARM, FLAG.WARM);
  assert.equal(f[5].flg & FLAG.TICK, FLAG.TICK);
  assert.equal(out.find((r) => r.k === 'fr').t0, 1000);
  assert.deepEqual(rec.drain(), [], 'nothing new, nothing handed out');
  frame(1000 + 10 * 16.7);
  const next = rec.drain().find((r) => r.k === 'fr');
  assert.ok(Math.abs(fromB64(next.gap, Uint16Array)[0] / 10 - 16.7) < 0.11, 'the gap to the previous chunk is kept');
});

test('one-second buckets: counts, percentiles, empty seconds, gauges sent only when they change', () => {
  const { rec, frame } = make();
  rec.gauge('q', 'high');
  for (let i = 0; i < 60; i++) frame(1000 + i * (1000 / 60));                 // second 0: a smooth 60 fps
  for (let i = 0; i < 20; i++) frame(2000 + i * 50 + (i === 10 ? 400 : 0));   // second 1 and on: 20 fps with one 450 ms stall
  rec.gauge('q', 'high'); rec.gauge('sc', 0.85);
  frame(6000);                                                                 // a gap of whole seconds before this
  const recs = rec.drain(true);
  const sec = recs.filter((r) => r.k === 'sec').flatMap((r) => r.list);
  assert.equal(sec[0].s, 0);
  assert.equal(sec[0].n, 60);
  assert.ok(Math.abs(sec[0].g50 - 16.7) < 0.2 && sec[0].g95 < 17.5 && sec[0].gx < 17.5, JSON.stringify(sec[0]));
  assert.deepEqual(sec[0].g, { q: 'high' });
  const stallSec = sec.find((s) => s.gx > 400);
  assert.ok(stallSec, 'the stall shows in a bucket maximum');
  assert.ok(sec.some((s) => s.n === 0), 'empty seconds are emitted');
  assert.deepEqual(sec.filter((s) => s.g).map((s) => Object.keys(s.g).join()), ['q', 'sc'], 'q is not repeated once it is known');
  assert.ok(sec.every((s, i) => i === 0 || s.s === sec[i - 1].s + 1), 'seconds are consecutive');
});

test('slow frames and other events are listed, with a cap per kind that still counts', () => {
  const { rec, frame } = make();
  frame(1000); frame(1016.7); frame(1200);                                     // the last is a 183 ms frame
  rec.event('longtask', { d: 120 });
  for (let i = 0; i < 700; i++) rec.event('longtask', { d: 60 });
  const ev = rec.drain().find((r) => r.k === 'ev').list;
  const slow = ev.filter((e) => e.n === 'slow');
  assert.equal(slow.length, 1);
  assert.ok(Math.abs(slow[0].gap - 183.3) < 0.2);
  assert.equal(ev.filter((e) => e.n === 'longtask').length, 400, 'capped');
  assert.equal(rec.counts.longtask, 701, 'but all counted');
  assert.ok(rec.dropped >= 301);
});

test('phases are logged as events, and a bucket carries the phase in force when its second ended', () => {
  const { rec, frame } = make();
  frame(1000); rec.setPhase('title'); frame(1500); frame(2100); rec.setPhase('play'); frame(3100);
  const recs = rec.drain(true);
  const sec = recs.filter((r) => r.k === 'sec').flatMap((r) => r.list);
  assert.deepEqual(sec.map((s) => s.ph), ['title', 'play', 'play']);
  const ph = recs.find((r) => r.k === 'ev').list.filter((e) => e.n === 'phase');
  assert.deepEqual(ph.map((e) => [e.from, e.to]), [['boot', 'title'], ['title', 'play']]);
  rec.setPhase('play');
  assert.equal(rec.ev.length, 0, 'setting the same phase again logs nothing');
});

test('GPU latency and long tasks are summarised in the second they happened in', () => {
  const { rec, frame } = make();
  frame(1000); rec.gpu(8); rec.gpu(12); rec.longTask(80);
  frame(2100);
  const sec = rec.drain(true).filter((r) => r.k === 'sec').flatMap((r) => r.list);
  assert.deepEqual(sec[0].gpu, [2, 10, 12]);
  assert.deepEqual(sec[0].lt, [1, 80]);
});

// ---- the blank-frame watch --------------------------------------------------------------------------------------
test('a canvas resize before the render call is fine; after it, it is a blank frame in the making', () => {
  const { rec } = make();
  rec.frameBegin(1000); rec.canvasChange(1002, 1440, 900); rec.renderBegin(1003); rec.renderEnd(1010); rec.frameEnd(1011);
  assert.equal(rec.blank.risk, 0);
  rec.frameBegin(1020); rec.renderBegin(1021); rec.renderEnd(1030); rec.canvasChange(1031, 1200, 800); rec.frameEnd(1032);
  assert.equal(rec.blank.risk, 1);
  const ev = rec.drain().find((r) => r.k === 'ev').list;
  assert.ok(ev.some((e) => e.n === 'blank-risk' && e.sinceRenderMs === 1));
  const fl = decode(rec.drain()).length;                                       // (flags are checked through the frames below)
  assert.equal(fl, 0);
});

test('width and height assigned one after the other are one blank frame, not two', () => {
  const { rec } = make();
  drawn(rec);
  rec.frameBegin(1000); rec.renderBegin(1001); rec.renderEnd(1005); rec.canvasChange(1006, 800, 150); rec.canvasChange(1006.4, 800, 600); rec.frameEnd(1007);
  assert.equal(rec.blank.risk, 1);
  rec.displayTick(1010);
  rec.canvasChange(1011, 640, 480); rec.canvasChange(1011.3, 640, 360);       // outside the loop, a window resize
  assert.equal(rec.blank.outside, 1);
});

test('nothing is lost by a resize before the first frame (the page is still loading)', () => {
  const { rec } = make();
  rec.displayTick(1000); rec.canvasChange(1004, 1280, 150); rec.displayTick(1016.7); rec.displayTick(1033.4);
  assert.deepEqual(rec.blank, { risk: 0, outside: 0, presented: 0 });
});

test('the blank-risk flag lands on the frame it happened in', () => {
  const { rec } = make();
  rec.frameBegin(1000); rec.renderBegin(1001); rec.renderEnd(1005); rec.canvasChange(1006, 10, 10); rec.frameEnd(1007);
  const f = decode(rec.drain());
  assert.equal(f[0].flg & FLAG.BLANK_RISK, FLAG.BLANK_RISK);
});

// The game has been drawing: one frame before the display ticks the tests are about.
const drawn = (rec) => { rec.frameBegin(990); rec.renderBegin(991); rec.renderEnd(996); rec.frameEnd(997); };

test('a resize outside a frame is clean if the game draws before the next display frame ends', () => {
  const { rec } = make();
  drawn(rec);
  rec.displayTick(1000);
  rec.canvasChange(1004, 800, 600);                                            // a resize event, before this display frame's callbacks
  rec.frameBegin(1006); rec.renderBegin(1007); rec.renderEnd(1012); rec.frameEnd(1013);
  rec.displayTick(1016.7);
  assert.deepEqual(rec.blank, { risk: 0, outside: 1, presented: 0 });
  assert.equal(rec.dirty, null);
});

test('a resize outside a frame is a blank display frame if the game skips that frame (frame cap)', () => {
  const { rec } = make();
  drawn(rec);
  rec.displayTick(1000);
  rec.canvasChange(1004, 800, 600);
  // the game's callback runs but returns early (a frame-rate cap): no frameBegin, no render
  rec.displayTick(1008.3);                                                     // the next display frame begins: the one before it was painted blank
  assert.equal(rec.blank.presented, 1);
  rec.frameBegin(1010); rec.renderBegin(1011); rec.renderEnd(1016); rec.frameEnd(1017);
  rec.displayTick(1016.7);
  assert.equal(rec.dirty, null, 'cleared once the game draws');
  assert.equal(rec.blank.presented, 1);
});

test('a resize after the game drew in the same display frame (a ResizeObserver) is caught on the next tick', () => {
  const { rec } = make();
  drawn(rec);
  rec.displayTick(1000);
  rec.frameBegin(1001); rec.renderBegin(1002); rec.renderEnd(1008); rec.frameEnd(1009);
  rec.canvasChange(1010, 800, 600);                                            // after the frame, outside it: nothing draws it again
  rec.displayTick(1016.7);
  assert.equal(rec.blank.presented, 1);
});

test('display ticks keep the cadence statistics and the refresh estimate input', () => {
  const { rec } = make();
  for (let i = 0; i < 300; i++) rec.displayTick(1000 + i * 8.33 + (i === 100 ? 40 : 0));
  assert.equal(rec.display.ticks, 299);
  assert.ok(rec.display.maxGap > 48);
  assert.equal(refreshRate(rec.tickGaps()), 120);
  const sec = rec.drain(true).filter((r) => r.k === 'sec').flatMap((r) => r.list);
  assert.ok(sec.some((s) => s.tn > 100), JSON.stringify(sec[0]));
});

test('the recorder knows what it costs itself', () => {
  const { rec, frame } = make();
  for (let i = 0; i < 100; i++) frame(1000 + i * 16.7);
  assert.equal(rec.selfN, 100);
  assert.ok(rec.selfMs >= 0);
});

test('a drain that is overdue overwrites the last frame instead of growing', () => {
  const { rec, frame } = make({ cap: 16 });
  for (let i = 0; i < 40; i++) frame(1000 + i * 16.7);
  assert.equal(rec.n, 16);
  assert.equal(rec.frames, 40);
});
