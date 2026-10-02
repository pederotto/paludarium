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

export const PRESETS = ['low', 'balanced', 'high'];   // what Auto may choose between (Ultra is only ever picked by hand)
const COST = [1, 1.7, 2.6];                           // relative cost of a preset, per pixel

export class Governor {
  constructor({
    cap = 60, capMax = cap, capMin = 30, scale = 1, q = PRESETS.length - 1, qMax = PRESETS.length - 1, autoQuality = true,
    scaleMin = 0.6, scaleStep = 0.15, upStep = 0.1, window = 90, warm = 180, down = 2, up = 6,
    holdDown = 4500, holdUp = 12000, badFor = 90000, now = () => performance.now(),
  } = {}) {
    Object.assign(this, { capMax, capMin, qMax, autoQuality, scaleMin, scaleStep, upStep, window, warmFrames: warm, needDown: down, needUp: up, holdDown, holdUp, now });
    this.level = { q, scale, cap };
    this.buf = [];
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
  warm(frames = this.warmFrames) { this.skip = Math.max(this.skip, frames); this.buf.length = 0; this.slowRun = 0; this.fastRun = 0; }

  // Takes the level somebody set by hand (the player chose a preset, a saved profile was loaded).
  set(level) { Object.assign(this.level, level); this.warm(); this.bad = null; this.remember(this.level); }

  // Call once for every frame that was drawn, `dt` seconds after the previous one. Returns the new level when it moves, else null.
  frame(dt) {
    if (this.skip > 0) { this.skip--; return null; }
    this.buf.push(dt * 1000);
    if (this.buf.length < this.window) return null;
    const s = this.buf.sort((a, b) => a - b), med = s[s.length >> 1], p90 = s[Math.floor(s.length * 0.9)];
    this.buf.length = 0;
    const budget = 1000 / Math.min(this.level.cap, 60);   // no display shows more than 60 of them to this game's measure
    if (med > budget * 1.3) { this.slowRun++; this.fastRun = 0; }
    else if (med < budget * 1.1 && p90 < budget * 1.8) { this.fastRun++; this.slowRun = 0; }
    else { this.slowRun = 0; this.fastRun = 0; }
    const now = this.now();
    if (this.slowRun >= this.needDown && now - this.lastChange >= this.holdDown) return this.stepDown(now);
    if (this.fastRun >= this.needUp && now - this.lastChange >= this.holdUp) return this.stepUp(now);
    return null;
  }

  stepDown(now) {
    const L = this.level; let to = null;
    if (L.scale > this.scaleMin + 1e-6) to = { ...L, scale: Math.max(this.scaleMin, +(L.scale - this.scaleStep).toFixed(3)) };
    else if (this.autoQuality && L.q > 0) to = { ...L, q: L.q - 1, scale: Math.max(L.scale, 0.85) };   // a cheaper preset gets some resolution back
    else if (L.cap > this.capMin) to = { ...L, cap: this.capMin };
    this.slowRun = 0;
    if (!to) return null;
    // A level that was tried again soon after it failed is a level that fails: wait longer before the next try.
    if (now - this.lastUp < 30000) this.badFor = Math.min(this.badFor * 2, 600000); else this.badFor = this.badBase;
    this.bad = { ...L }; this.badUntil = now + (to.cap < L.cap ? 300000 : this.badFor);
    return this.commit(to, now, 'slow');
  }

  stepUp(now) {
    const L = this.level; let to = null;
    if (L.cap < this.capMax) to = { ...L, cap: this.capMax };
    else if (L.scale < 1 - 1e-6) to = { ...L, scale: Math.min(1, +(L.scale + this.upStep).toFixed(3)) };
    else if (this.autoQuality && L.q < this.qMax) to = { ...L, q: L.q + 1, scale: 0.85 };
    this.fastRun = 0;
    if (!to) return null;
    if (this.bad && now < this.badUntil && this.cost(to) >= this.cost(this.bad) * 0.97) return null;   // that was too much a moment ago
    this.lastUp = now;
    return this.commit(to, now, 'fast');
  }

  commit(to, now, reason) {
    this.level = to; this.lastChange = now; this.warm();
    return { ...to, reason };
  }
}
