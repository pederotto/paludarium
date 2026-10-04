// How hard to work the GPU. Fed the time of every frame that was drawn, the Governor moves along a ladder of cheaper and
// dearer settings (render scale, then graphics preset, then frame-rate cap) and says when. No scene, no DOM: Node tests run it.
//
// Three rules keep it from doing harm on a machine that struggles:
//  * Warm-up is not measured. Compiling shaders after a tank loads or a pipeline is rebuilt makes long frames that say
//    nothing about the GPU, and a window is judged by its median frame, so one stall cannot trigger a change.
//  * A change costs a canvas resize or a pipeline rebuild (a blank frame, a stall), so changes are rare: two slow windows to
//    go down, six fast ones to go up, and a level that failed is not tried again for a while (longer each time it fails).
//  * The bottom of the ladder still has to leave the GPU idle part of the time or the whole desktop stalls with it, hence the
//    frame-rate cap: the cheapest preset at 30 frames a second.
//  * Only a GPU that is the bottleneck is given less to draw. Frames also come slowly when the browser paces them (an iPhone
//    in Low Power Mode or a laptop's energy saver gives 30 a second however idle the GPU is) or when the main thread is the
//    bottleneck; a smaller picture helps neither, and taking it down to the floor there is how a phone ended up blocky. When
//    the GPU's latency is known (gpu(ms), see engine/gpulatency.js) and it was idle half the time, a slow window is 'paced'
//    (nothing changes) or, with the main thread busy, 'cpu' (only the frame cap may drop). Without it, as before.
//  * A smaller picture has to make the frames faster. A GPU can be busy with something other than pixels (vertices: a tank
//    draws a million triangles or more, two million with the shadow pass; a driver, as Safari's WebGL can be), and then every
//    step down the scale only made the picture blockier: in a recording of Safari on the Mac the frames were as slow at
//    0.6 as at 1 while the governor walked down to 0.6. So a step down the scale is a trial: if the next window is not
//    faster by at least a quarter of the share of pixels it took away, the scale goes back and stays there (`pixelFloor`)
//    while the preset and the cap do the rest.

export const PRESETS = ['low', 'balanced', 'high'];   // what Auto may choose between (Ultra is only ever picked by hand)

// The highest preset Auto may move up to by itself, as an index into PRESETS. On WebGPU, any. On WebGL 2, the one the device
// started on: a heavier preset adds ambient occlusion's extra render target, which makes three.js recompile every scene shader
// in the one frame after the switch, and on WebGL 2 that is a frozen page for tens of seconds (20.7 s on an M1, found with the
// metrics recorder; a slow Direct3D compile on a Snapdragon laptop is worse). Lowering the preset is always allowed.
export function autoCeiling(backend, start) { return backend === 'WebGPU' ? PRESETS.length - 1 : Math.max(0, PRESETS.indexOf(start)); }
const COST = [1, 1.7, 2.6];                           // relative cost of a preset, per pixel

export class Governor {
  constructor({
    cap = 60, capMax = cap, capMin = 30, scale = 1, q = PRESETS.length - 1, qMax = PRESETS.length - 1, autoQuality = true,
    scaleMin = 0.6, scaleStep = 0.15, upStep = 0.1, window = 90, warm = 180, down = 2, up = 6,
    holdDown = 4500, holdUp = 12000, badFor = 90000, now = () => performance.now(),
  } = {}) {
    Object.assign(this, { capMax, capMin, qMax, autoQuality, scaleMin, scaleStep, upStep, window, warmFrames: warm, needDown: down, needUp: up, holdDown, holdUp, now });
    this.level = { q, scale, cap };
    this.buf = []; this.cpuBuf = []; this.gpuBuf = [];
    this.why = null;                // what bounded the last slow window: 'gpu', 'cpu' or 'paced'
    this.trial = null;              // a scale step down on probation: { scale (the one before), med (its window's median) }
    this.pixelFloor = 0;            // the scale below which fewer pixels proved not to help
    this.skip = warm;               // frames still to ignore
    this.slowRun = 0; this.fastRun = 0;
    this.bad = null;                // the most expensive level that was too slow, and until when it is not retried
    this.badUntil = 0; this.badFor = badFor; this.badBase = badFor;
    this.lastChange = -Infinity; this.lastUp = -Infinity;
    this.remember(this.level);
  }

  // A frame-rate cap hides how much room the GPU has (the frames arrive at the cap whether it is idle or not), so once the cap
  // is below its maximum the governor does not try to raise it for a good while: a level with a lowered cap was a decision.
  remember(level) {
    if (level.cap < this.capMax) { this.bad = { ...level, cap: this.capMax }; this.badUntil = this.now() + 300000; }
  }

  cost(l) { return COST[l.q] * l.scale * l.scale * (l.cap / 60); }

  // Ignore the next `frames` frames (a tank was built, the pipeline was rebuilt, the canvas was resized).
  warm(frames = this.warmFrames) { this.skip = Math.max(this.skip, frames); this.buf.length = 0; this.cpuBuf.length = 0; this.gpuBuf.length = 0; this.slowRun = 0; this.fastRun = 0; }

  // How long after a frame was submitted the GPU had finished it, in ms (sampled, arrives late).
  gpu(ms) { if (this.skip <= 0 && this.gpuBuf.length < 256) this.gpuBuf.push(ms); }

  // Takes the level somebody set by hand (the player chose a preset, a saved profile was loaded).
  set(level) { Object.assign(this.level, level); this.warm(); this.bad = null; this.trial = null; this.pixelFloor = 0; this.remember(this.level); }

  // Call once for every frame that was drawn, `dt` seconds after the previous one, with the main thread's time for the frame
  // before it (`cpuMs`, optional). Returns the new level when it moves, else null.
  frame(dt, cpuMs) {
    if (this.skip > 0) { this.skip--; return null; }
    this.buf.push(dt * 1000);
    if (cpuMs >= 0) this.cpuBuf.push(cpuMs);
    if (this.buf.length < this.window) return null;
    const med = this._med = median(this.buf), p90 = this.buf[Math.floor(this.buf.length * 0.9)];
    const cpu = this.cpuBuf.length >= this.window / 2 ? median(this.cpuBuf) : null;
    const gpu = this.gpuBuf.length >= 6 ? median(this.gpuBuf) : null;
    this.buf.length = 0; this.cpuBuf.length = 0; this.gpuBuf.length = 0;
    if (this.trial) {
      const t = this.trial; this.trial = null;
      const took = 1 - (this.level.scale / t.scale) ** 2;          // the share of the pixels the step took away
      if (1 - med / t.med < took * 0.25) { this.pixelFloor = t.scale; return this.commit({ ...this.level, scale: t.scale }, this.now(), 'no-gain'); }
    }
    const budget = 1000 / Math.min(this.level.cap, 60);   // no display shows more than 60 of them to this game's measure
    const slow = med > budget * 1.3;
    this.why = !slow ? null : gpu === null || gpu >= med * 0.5 ? 'gpu' : cpu !== null && cpu >= med * 0.6 ? 'cpu' : 'paced';
    if (this.why === 'paced') { this.slowRun = 0; this.fastRun = 0; return null; }
    if (slow) { this.slowRun++; this.fastRun = 0; }
    else if (med < budget * 1.1 && p90 < budget * 1.8) { this.fastRun++; this.slowRun = 0; }
    else { this.slowRun = 0; this.fastRun = 0; }
    const now = this.now();
    if (this.slowRun >= this.needDown && now - this.lastChange >= this.holdDown) return this.why === 'cpu' ? this.capDown(now) : this.stepDown(now);
    if (this.fastRun >= this.needUp && now - this.lastChange >= this.holdUp) return this.stepUp(now);
    return null;
  }

  stepDown(now) {
    const L = this.level; let to = null;
    if (L.scale > Math.max(this.scaleMin, this.pixelFloor) + 1e-6) to = { ...L, scale: Math.max(this.scaleMin, +(L.scale - this.scaleStep).toFixed(3)) };
    else if (this.autoQuality && L.q > 0) to = { ...L, q: L.q - 1, scale: Math.max(L.scale, 0.85) };   // a cheaper preset gets some resolution back
    else if (L.cap > this.capMin) to = { ...L, cap: this.capMin };
    this.slowRun = 0;
    if (!to) return null;
    // A level that was tried again soon after it failed is a level that fails: wait longer before the next try.
    if (now - this.lastUp < 30000) this.badFor = Math.min(this.badFor * 2, 600000); else this.badFor = this.badBase;
    this.bad = { ...L }; this.badUntil = now + (to.cap < L.cap ? 300000 : this.badFor);
    if (to.scale < L.scale && to.q === L.q) this.trial = { scale: L.scale, med: this._med };
    return this.commit(to, now, 'slow');
  }

  // The main thread is the bottleneck: fewer pixels would not help, a steady 30 frames a second may.
  capDown(now) {
    const L = this.level;
    this.slowRun = 0;
    if (L.cap <= this.capMin) return null;
    this.bad = { ...L }; this.badUntil = now + 300000;
    return this.commit({ ...L, cap: this.capMin }, now, 'cpu');
  }

  stepUp(now) {
    const L = this.level; let to = null;
    if (L.cap < this.capMax) to = { ...L, cap: this.capMax };
    else if (L.scale < 1 - 1e-6) to = { ...L, scale: Math.min(1, +(L.scale + this.upStep).toFixed(3)) };
    else if (this.autoQuality && L.q < this.qMax) to = { ...L, q: L.q + 1, scale: 0.85 };
    this.fastRun = 0;
    if (!to) return null;
    if (this.bad && now < this.badUntil && this.cost(to) >= this.cost(this.bad) * 0.97) return null;   // that was too much a moment ago
    if (to.q > L.q) this.pixelFloor = 0;                          // a dearer preset: its pixels may be what costs
    this.lastUp = now;
    return this.commit(to, now, 'fast');
  }

  commit(to, now, reason) {
    this.level = to; this.lastChange = now; this.warm();
    return { ...to, reason };
  }
}

function median(a) { a.sort((x, y) => x - y); return a[a.length >> 1]; }
