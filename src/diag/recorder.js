// The recorder: what happened, frame by frame and second by second. No DOM, no game: times come in as arguments (all on the
// performance.now() clock, milliseconds since navigation start), so the unit tests drive it with synthetic frames.
//
// What it keeps, and why that shape:
//  * every drawn frame, as five typed arrays (gap since the previous frame, time before the render call, time inside it, time in
//    the tick hooks after it, flags), 0.1 ms resolution: cheap to write (no allocation in a frame), exact percentiles later, and
//    a few kilobytes a minute on the wire;
//  * one bucket per second (frames, p50/p95/max gap, averages, GPU latency, long tasks, gauges that changed): the timeline;
//  * events (resizes, governor moves, long tasks, errors, marks...): what the numbers cannot say;
//  * the blank-frame watch: a canvas whose size changes after the frame was drawn is presented empty (a black flash). See
//    canvasChange and displayTick.
// drain() hands out what is new since the last call, as plain JSON-able records (`k`: fr | sec | ev | snap).

import { toB64 } from './codec.js';

export const FLAG = { WARM: 1, TICK: 2, RESIZED: 4, REBUILT: 8, HIDDEN: 16, BLANK_RISK: 32 };

const q10 = (ms) => Math.min(65535, Math.max(0, Math.round(ms * 10)));
const r1 = (v) => Math.round(v * 10) / 10;
const LIMITS = { longtask: 400, loaf: 300, inp: 200, slow: 400, canvas: 600, console: 120, error: 60, 'window-resize': 200, gov: 200 };

export class Recorder {
  constructor({ sid = 'test', label = '', now = () => performance.now(), cap = 8192, slowMs = 50 } = {}) {
    this.sid = sid; this.label = label; this.now = now; this.slowMs = slowMs;
    this.t0 = now();
    // frames of the chunk being filled
    this.cap = cap; this.n = 0; this.fT0 = 0;
    this.gap = new Uint16Array(cap); this.sim = new Uint16Array(cap); this.rnd = new Uint16Array(cap); this.tck = new Uint16Array(cap); this.flg = new Uint8Array(cap);
    this.lastBegin = -1; this.frames = 0;
    // the frame in progress
    this.inFrame = false; this.fBegin = 0; this.rBegin = 0; this.rEnd = 0; this.rendered = false; this.fFlags = 0;
    this.hidden = false; this.phase = 'boot';
    // one-second buckets
    this.tmp = new Float32Array(2048);
    this.closed = [];
    this.gv = {}; this.gl = {};
    this._open(0);
    // events
    this.ev = []; this.counts = {}; this.dropped = 0;
    this.snaps = [];
    // blank frames
    this.draws = new Float64Array(8).fill(-1); this.dpos = 0;
    this.dirty = null; this.lastTickTs = null;
    this.blank = { risk: 0, outside: 0, presented: 0 };
    this.display = { hz: 0, ticks: 0, maxGap: 0 };
    this.ticks = new Float32Array(240); this.tpos = 0;
    this.selfMs = 0; this.selfN = 0;
  }

  // ---- frames -------------------------------------------------------------------------------------------------------
  // The game's frame function starts. `flags` is what is known already (a warm-up frame, a time-lapse).
  frameBegin(t, flags = 0) { this.inFrame = true; this.fBegin = t; this.rendered = false; this.fFlags = flags; }
  renderBegin(t) { this.rBegin = t; this.draws[this.dpos] = t; this.dpos = (this.dpos + 1) & 7; }
  renderEnd(t) { this.rEnd = t; this.rendered = true; }
  flag(f) { this.fFlags |= f; }
  // The frame function returned. `tick`: the 4 Hz tick hooks ran inside it, after the render.
  frameEnd(t, tick = false) {
    if (!this.inFrame) return;
    const s0 = this.now();
    const begin = this.fBegin;
    const sim = this.rendered ? this.rBegin - begin : t - begin;
    const rnd = this.rendered ? this.rEnd - this.rBegin : 0;
    const tck = tick && this.rendered ? t - this.rEnd : 0;
    this.push(begin, sim, rnd, tck, this.fFlags | (tick ? FLAG.TICK : 0) | (this.hidden ? FLAG.HIDDEN : 0));
    this.inFrame = false; this.rendered = false; this.fFlags = 0;
    this.selfMs += this.now() - s0; this.selfN++;
  }

  // One finished frame. Also the entry point when frames are inferred from display ticks (no game to wrap).
  push(begin, sim, rnd, tck, flags) {
    const gap = this.lastBegin < 0 ? 0 : begin - this.lastBegin;
    this.lastBegin = begin; this.frames++;
    if (this.n >= this.cap) this.n = this.cap - 1;        // a drain is overdue: overwrite the last frame rather than grow
    if (this.n === 0) this.fT0 = begin;
    const i = this.n++;
    this.gap[i] = q10(gap); this.sim[i] = q10(sim); this.rnd[i] = q10(rnd); this.tck[i] = q10(tck); this.flg[i] = flags;
    this._roll(begin);
    const b = this.b;
    if (gap > 0 && b.gn < this.tmp.length) this.tmp[b.gn++] = gap;
    b.n++; b.sim += sim; b.rnd += rnd; b.tck += tck;
    if (rnd > b.rndMax) b.rndMax = rnd;
    if (gap > b.gmax) b.gmax = gap;
    if (flags & FLAG.WARM) b.warm++;
    // A frame is slow when the wait before it was long or when it took long itself (the arrays clamp at 6.5 s, the event is exact).
    const dur = sim + rnd + tck;
    if ((gap > this.slowMs || dur > this.slowMs) && !(flags & FLAG.HIDDEN)) this.event('slow', { gap: r1(gap), dur: r1(dur), sim: r1(sim), rnd: r1(rnd), tck: r1(tck), fl: flags }, begin);
  }

  // ---- seconds ------------------------------------------------------------------------------------------------------
  _open(s) {
    this.b = { s, n: 0, gn: 0, sim: 0, rnd: 0, tck: 0, rndMax: 0, gmax: 0, warm: 0, gpuN: 0, gpuSum: 0, gpuMax: 0, ltN: 0, ltMs: 0, tn: 0, tx: 0, ph: this.phase };
  }
  _close() {
    const b = this.b, o = { s: b.s, n: b.n, ph: b.ph };
    if (b.n) {
      const g = this.tmp.subarray(0, b.gn).sort(), m = g.length;
      o.g50 = r1(m ? g[m >> 1] : 0); o.g95 = r1(m ? g[Math.min(m - 1, Math.ceil(m * 0.95) - 1)] : 0); o.gx = r1(b.gmax);
      o.sim = r1(b.sim / b.n); o.rnd = r1(b.rnd / b.n); o.rx = r1(b.rndMax);
      if (b.tck > 0) o.tck = r1(b.tck / b.n);
      if (b.warm) o.w = b.warm;
    }
    if (b.gpuN) o.gpu = [b.gpuN, r1(b.gpuSum / b.gpuN), r1(b.gpuMax)];
    if (b.ltN) o.lt = [b.ltN, r1(b.ltMs)];
    if (b.tn) { o.tn = b.tn; o.tx = r1(b.tx); }
    const g = {};
    for (const k in this.gv) if (this.gv[k] !== this.gl[k]) { g[k] = this.gv[k]; this.gl[k] = this.gv[k]; }
    if (Object.keys(g).length) o.g = g;
    this.closed.push(o);
  }
  // Move to the second containing `t`, closing the one that ended and emitting empty buckets for seconds nothing happened in.
  _roll(t) {
    const s = Math.floor((t - this.t0) / 1000);
    if (s <= this.b.s) return;
    this._close();
    for (let k = this.b.s + 1, n = 0; k < s && n < 120; k++, n++) this.closed.push({ s: k, n: 0, ph: this.phase });
    this._open(s);
  }
  roll(t = this.now()) { this._roll(t); }

  setHidden(h) { this.hidden = !!h; }
  gauge(k, v) { this.gv[k] = v; }
  gpu(ms) { const b = this.b; b.gpuN++; b.gpuSum += ms; if (ms > b.gpuMax) b.gpuMax = ms; }
  longTask(ms) { this.b.ltN++; this.b.ltMs += ms; }
  setPhase(name) {
    if (name === this.phase) return;
    this.event('phase', { from: this.phase, to: name });
    this.phase = name; this.b.ph = name;
  }

  // ---- events -------------------------------------------------------------------------------------------------------
  event(n, fields, t = this.now()) {
    const c = this.counts[n] = (this.counts[n] ?? 0) + 1;
    if (c > (LIMITS[n] ?? 800)) { this.dropped++; return; }
    this.ev.push({ t: r1(t), n, ...fields });
  }

  // ---- display and blank frames ---------------------------------------------------------------------------------------
  // The canvas's backing store changed size (assigning canvas.width or height clears it).
  //  * In a frame, before the render call: fine, the frame is drawn into the new size.
  //  * In a frame, after the render call: the finished picture is wiped and the empty canvas is presented. A black flash.
  //  * Outside any frame (a resize event, a timer): fine only if the game draws before the next display frame is painted.
  //    displayTick checks that.
  canvasChange(t, w, h) {
    this.event('canvas', { w, h, inFrame: this.inFrame, afterRender: this.inFrame && this.rendered }, t);
    if (this.inFrame) {
      // Width and height are two assignments of one resize, and one frame can only be blank once.
      if (this.rendered) { if (!(this.fFlags & FLAG.BLANK_RISK)) { this.blank.risk++; this.fFlags |= FLAG.BLANK_RISK; this.event('blank-risk', { sinceRenderMs: r1(t - this.rEnd) }, t); } }
      else this.fFlags |= FLAG.RESIZED;
    } else if (this.frames > 0 && !this.dirty) {
      // Before the first frame there is nothing on the canvas to lose (the page is still loading behind its veil).
      this.blank.outside++;
      this.dirty = { t };
    }
  }

  // Called once per display frame from a requestAnimationFrame callback (`ts`: the frame's own timestamp). The frame that ended
  // at `ts` presented a blank canvas if the canvas was cleared before it was painted and nothing was drawn since.
  displayTick(ts) {
    const prev = this.lastTickTs; this.lastTickTs = ts;
    this._roll(ts);
    if (prev !== null) {
      const g = ts - prev;
      this.display.ticks++; this.b.tn++;
      if (g > this.b.tx) this.b.tx = g;
      if (g > this.display.maxGap) this.display.maxGap = g;
      if (!this.display.hz) { this.ticks[this.tpos++] = g; if (this.tpos >= this.ticks.length) this.tpos = 0; }
    }
    const d = this.dirty;
    if (d && d.t < ts) {
      let drew = false;
      for (let i = 0; i < 8; i++) { const x = this.draws[i]; if (x >= d.t && x < ts) { drew = true; break; } }
      if (drew) this.dirty = null;
      else { this.blank.presented++; this.event('blank-frame', { sinceMs: r1(ts - d.t) }, ts); }
    }
  }

  // ---- snapshots and hand-out ---------------------------------------------------------------------------------------
  snapshot(why, w, h, jpeg, t = this.now()) { this.snaps.push({ k: 'snap', t: r1(t), why, w, h, jpeg }); }

  // What is new since the last drain, as records. `final` also closes the second that is open.
  drain(final = false) {
    const out = [];
    if (final) { this._close(); this._open(this.b.s + 1); }
    if (this.n > 0) {
      const n = this.n;
      out.push({ k: 'fr', t0: r1(this.fT0), n, gap: toB64(this.gap.subarray(0, n)), sim: toB64(this.sim.subarray(0, n)), rnd: toB64(this.rnd.subarray(0, n)), tck: toB64(this.tck.subarray(0, n)), flg: toB64(this.flg.subarray(0, n)) });
      this.n = 0;
    }
    if (this.closed.length) { out.push({ k: 'sec', list: this.closed }); this.closed = []; }
    if (this.ev.length) { out.push({ k: 'ev', list: this.ev }); this.ev = []; }
    if (this.snaps.length) { out.push(...this.snaps); this.snaps = []; }
    return out;
  }

  // The display's refresh rate from the gaps between display frames seen so far (0 until there are enough).
  // Left to the caller (probes) because it needs the stats module; see index.js.
  tickGaps() { return Array.from(this.ticks.subarray(0, Math.min(this.display.ticks, this.ticks.length))); }
}
