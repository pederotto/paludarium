// The step machine for the first-jar tutorial (content/tutorial.js). It listens
// to tool events for its flags and advances when the current step's `done` is
// true. The UI shows `current()` as a coach card.

import { TUTORIAL } from '../content/tutorial.js';

export class Tutorial {
  constructor(career) {
    this.career = career;
    this.step = 0;
    this.finished = false;
    this.flags = { looked: false, edit: {}, placed: {} };
    this.ctx = {};
    this.onStep = null;
  }

  bind(events) {
    events.on('edit', (tool) => { this.flags.edit[tool ?? 'any'] = true; });
    events.on('placed', (kind) => { this.flags.placed[kind] = true; });
    events.on('looked', () => { this.flags.looked = true; });
  }

  current() { return this.finished ? null : TUTORIAL[this.step]; }

  tick(m) {
    if (this.finished) return;
    this.ctx.startDay ??= m.day;
    const s = TUTORIAL[this.step];
    let ok = false;
    try { ok = !!s.done(m, this.flags, this.ctx, this.career); } catch { ok = false; }
    if (ok) this.next();
  }

  next() {
    this.step++;
    if (this.step >= TUTORIAL.length) { this.finished = true; this.onStep?.(null); return; }
    this.ctx.startDay = null;
    this.onStep?.(TUTORIAL[this.step]);
  }

  skip() { this.finished = true; this.onStep?.(null); }

  serialize() { return { step: this.step, finished: this.finished }; }
  load(o) { if (o) { this.step = o.step ?? 0; this.finished = !!o.finished; } }
}
