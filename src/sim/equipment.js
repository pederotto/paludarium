// What is installed in the tank, where the placeable pieces sit, and the
// automation controller that runs rules against the sensors.
//
// A rule reads: WHEN <sensor> <above|below> <value> [between <from> and <to> h]
// THEN <actuator> on. While the rule is true the actuator runs; when it is
// false, it falls back to "off" unless another rule wants it. Rules are
// checked once per game minute, like a real controller's loop, and each has a
// small hysteresis band so it doesn't chatter. Rain is a pulse: it runs for a
// few minutes and then waits a cool-down.

import { GEAR, SENSORS, ACTUATORS } from '../content/equipment.js';
import { clamp } from '../render/geo.js';

const DEFAULT_OWNED = Object.values(GEAR).filter((g) => g.owned).map((g) => g.id);

export class Equipment {
  constructor(world) {
    this.world = world;
    this.all = false;                       // sandbox: everything is available
    this.owned = new Set(DEFAULT_OWNED);
    this.pos = { fogger: { x: 0, z: -10 }, basking: { x: -18, z: 0 } };
    this.rules = [];                        // { id, sensor, op, value, from, to, actuator, hys, on }
    this.nextRule = 1;
    this.lastRain = -1e9;
    this.lastEval = -1;
    this.trace = [];                        // recent rule firings for the Vacation report
  }

  has(id) { return this.all || this.owned.has(id); }
  buy(id) { this.owned.add(id); }

  // Sets an Env field for a piece of gear if it is fitted.
  set(key, value) {
    this.world.env[key] = value;
  }

  addRule(rule = {}) {
    const r = { id: this.nextRule++, sensor: 'humidity', op: 'below', value: 80, from: 0, to: 24, actuator: 'fogger', hys: 2, on: false, ...rule };
    this.rules.push(r);
    return r;
  }
  removeRule(id) { this.rules = this.rules.filter((r) => r.id !== id); }

  // Runs once per game minute (called from the sim tick, so it also runs
  // during fast-forward and the Vacation test).
  evaluate() {
    const W = this.world, E = W.env;
    if (!this.has('controller') || !this.rules.length) return;
    const minute = Math.floor(E.minute);
    if (minute === this.lastEval) return;
    this.lastEval = minute;
    const hour = (E.minute % 1440) / 60;
    const want = {};   // actuator → value
    for (const r of this.rules) {
      const s = SENSORS[r.sensor], a = ACTUATORS[r.actuator];
      if (!s || !a || !this.has(a.gear)) continue;
      const v = s.get(E, W);
      const inWindow = r.from <= r.to ? hour >= r.from && hour < r.to : hour >= r.from || hour < r.to;
      // Hysteresis: once on, stay on until the reading is past the threshold by `hys`.
      const hys = r.hys ?? 0;
      let cond;
      if (r.op === 'below') cond = r.on ? v < r.value + hys : v < r.value;
      else cond = r.on ? v > r.value - hys : v > r.value;
      cond = cond && inWindow;
      r.on = cond;
      if (cond) {
        if (a.pulse) {
          if (E.minute - this.lastRain > 45 && E.minute >= E.rainUntil) { E.rainUntil = E.minute + a.pulse; this.lastRain = E.minute; this.trace.push({ m: E.minute, text: `Rain shower (${s.name} ${r.op} ${r.value})` }); }
        } else want[r.actuator] = a.on;
      } else if (!a.pulse && want[r.actuator] === undefined) want[r.actuator] = a.off;
    }
    for (const [name, value] of Object.entries(want)) {
      const a = ACTUATORS[name];
      if (E[a.key] !== value) {
        E[a.key] = value;
      }
    }
    if (this.trace.length > 200) this.trace.splice(0, this.trace.length - 200);
  }

  serialize() {
    return { owned: [...this.owned], pos: this.pos, rules: this.rules.map((r) => ({ ...r, on: false })), next: this.nextRule };
  }
  load(o) {
    if (!o) return;
    this.owned = new Set([...DEFAULT_OWNED, ...(o.owned ?? [])]);
    this.pos = { ...this.pos, ...(o.pos ?? {}) };
    this.rules = (o.rules ?? []).map((r) => ({ ...r }));
    this.nextRule = o.next ?? this.rules.length + 1;
  }
}

export { clamp };
