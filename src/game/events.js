// Occasionally something happens to the tank: a heatwave, a power cut, a
// springtail boom, mould, algae, a dry spell, visitors. At most one at a time,
// never in a young tank, seeded so a saved game replays the same weather.

import { EVENTS, EVENT_BY_ID } from '../content/events.js';

function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

export class EventDirector {
  constructor(seed = 1) {
    this.seed = seed;
    this.active = null;          // { id, endMinute }
    this.lastRoll = -1;
    this.history = [];
    this.enabled = true;
    this.onEvent = null; this.onEnd = null;
    this.rate = 0.11;            // chance per day
  }

  // Called from the game's second tick with the world and a metrics snapshot.
  tick(world, m) {
    const E = world.env, minute = E.minute;
    if (this.active) {
      if (minute >= this.active.endMinute) this.finish(world);
      return;
    }
    if (!this.enabled || E.tankDays < 8) return;
    const day = Math.floor(minute / 1440);
    if (day < 1 || day === this.lastRoll || (minute % 1440) < 8 * 60) return;   // never on the first day of a game
    this.lastRoll = day;
    const r = rng(this.seed * 7919 + day * 104729);
    if (r() > this.rate) return;
    const pool = EVENTS.filter((e) => e.canStart(m, world));
    if (!pool.length) return;
    let t = r() * pool.reduce((s, e) => s + e.weight, 0);
    for (const e of pool) { t -= e.weight; if (t <= 0) { this.start(world, e, m); return; } }
  }

  start(world, e, m) {
    e.start(world);
    this.active = { id: e.id, endMinute: world.env.minute + e.duration * 1440 };
    this.history.push({ id: e.id, day: world.env.day + 1 });
    world.log(`${e.title}: ${e.text}`, e.kind === 'good' ? 'good' : 'bad');
    if (e.reward) {
      const ok = !m || m.animals.total === 0 || m.animals.healthy / m.animals.total >= e.reward.needsHealthy;
      this.onEvent?.(e, ok ? e.reward : null);
    } else this.onEvent?.(e, null);
  }

  force(world, id) {
    const e = EVENT_BY_ID[id];
    if (!e) return false;
    if (this.active) this.finish(world);
    this.start(world, e, null);
    return true;
  }

  finish(world) {
    const e = EVENT_BY_ID[this.active.id];
    e.end(world);
    world.log(`${e.title} is over.`, 'good');
    this.onEnd?.(e);
    this.active = null;
  }

  // Undo an event's changes (loading another tank).
  cancel(world) { if (this.active) this.finish(world); }

  get current() { return this.active ? EVENT_BY_ID[this.active.id] : null; }

  serialize() { return { seed: this.seed, active: this.active, lastRoll: this.lastRoll, history: this.history.slice(-30) }; }
  load(o) { if (!o) return; this.seed = o.seed ?? this.seed; this.active = o.active ?? null; this.lastRoll = o.lastRoll ?? -1; this.history = o.history ?? []; }
}
