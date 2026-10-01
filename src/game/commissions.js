// Runs commissions: which are active, which goals are met (some must hold for
// several days), and paying out. It reads a metrics snapshot each second and
// the career's counters, and pays through the career (funds and reputation).

import { COMMISSIONS, COMMISSION_ORDER } from '../content/commissions.js';

const MAX_ACTIVE = 3;

export class Commissions {
  constructor(career) {
    this.career = career;
    this.active = [];        // { id, since, goals: { [goalId]: { done, heldMin, sinceMin } } }
    this.done = {};          // id → day
    this.seen = {};          // ids the player has looked at (for the "new" dot)
    this.onGoal = null; this.onReady = null; this.onComplete = null;
    this.lastProgress = {};
    career.commissionsSnapshot = () => this.snapshot();
  }

  get level() { return this.career.level; }
  get(id) { return COMMISSIONS[id]; }

  isAvailable(id) {
    const c = COMMISSIONS[id];
    if (!c || this.done[id] || this.active.some((a) => a.id === id)) return false;
    if (!this.career.sandbox && c.level > this.level) return false;
    // A commission opens once one that lists it in `next` is done, or it has no parent.
    const parents = COMMISSION_ORDER.filter((p) => COMMISSIONS[p].next?.includes(id));
    return !parents.length || parents.some((p) => this.done[p]);
  }

  available() { return COMMISSION_ORDER.filter((id) => this.isAvailable(id)); }

  accept(id, world) {
    const c = COMMISSIONS[id];
    if (!c) return 'Unknown commission.';
    if (this.active.length >= MAX_ACTIVE) return `You can hold ${MAX_ACTIVE} commissions at a time.`;
    if (!this.career.sandbox && c.level > this.level) return `Needs rank ${c.level}.`;
    if (this.done[id]) return 'Already finished.';
    if (this.active.some((a) => a.id === id)) return null;
    this.active.push({ id, since: world?.env.minute ?? 0, goals: Object.fromEntries(c.goals.map((g) => [g.id, { done: false, heldMin: 0, sinceMin: null }])) });
    this.seen[id] = true;
    c.start?.(world);
    this.career.note(`Accepted: ${c.title}`);
    return null;
  }

  abandon(id) {
    this.active = this.active.filter((a) => a.id !== id);
  }

  ready(a) { return COMMISSIONS[a.id].goals.every((g) => a.goals[g.id]?.done); }

  // Evaluate every active goal. `minute` is the tank's game clock, so holds work at any speed.
  tick(m, minute) {
    const stats = this.career.stats;
    for (const a of this.active) {
      const c = COMMISSIONS[a.id];
      for (const g of c.goals) {
        const st = a.goals[g.id] ?? (a.goals[g.id] = { done: false, heldMin: 0, sinceMin: null });
        if (st.done) continue;
        let ok = false;
        try { ok = !!g.test(m, stats); } catch { ok = false; }
        if (g.hold) {
          if (ok) { st.sinceMin ??= minute; st.heldMin = minute - st.sinceMin; } else { st.sinceMin = null; st.heldMin = 0; }
          ok = st.heldMin >= g.hold * 1440;
        }
        if (ok) {
          st.done = true;
          this.onGoal?.(c, g);
          if (this.ready(a)) this.onReady?.(c);
        }
      }
    }
  }

  claim(id) {
    const a = this.active.find((x) => x.id === id);
    if (!a || !this.ready(a)) return null;
    const c = COMMISSIONS[id];
    this.active = this.active.filter((x) => x !== a);
    this.done[id] = this.career.day;
    this.career.stat('commissionsDone');
    this.career.addFunds(c.reward.funds, `for ${c.title}`);
    this.career.addRep(c.reward.rep, c.title);
    for (const k of c.teaches ?? []) this.career.discover('concept', k);
    this.onComplete?.(c);
    return c;
  }

  snapshot() {
    const world = null; void world;
    const active = this.active.map((a) => {
      const c = COMMISSIONS[a.id];
      const ready = this.ready(a);
      return {
        id: c.id, title: c.title, giver: c.giver, brief: c.brief, teaches: c.teaches, reward: c.reward, ready, biotope: c.biotope,
        goals: c.goals.map((g) => {
          const st = a.goals[g.id];
          const holdText = g.hold && !st.done ? `${(st.heldMin / 1440).toFixed(1)}/${g.hold} d` : null;
          return { id: g.id, text: g.text, done: st.done, progressText: st.done ? '' : holdText ?? this.lastProgress[`${c.id}:${g.id}`] ?? '' };
        }),
      };
    });
    const available = COMMISSION_ORDER.filter((id) => this.isAvailable(id)).map((id) => {
      const c = COMMISSIONS[id];
      return { id, title: c.title, giver: c.giver, tier: c.tier, level: c.level, reward: c.reward, teaches: c.teaches, isNew: !this.seen[id] };
    });
    const locked = COMMISSION_ORDER.filter((id) => !this.done[id] && !this.active.some((a) => a.id === id) && !this.isAvailable(id) && COMMISSIONS[id].level > this.level)
      .slice(0, 6).map((id) => ({ id, title: COMMISSIONS[id].title, tier: COMMISSIONS[id].tier, level: COMMISSIONS[id].level, locked: true }));
    return { active, available: [...available, ...locked], done: Object.keys(this.done), attention: active.some((a) => a.ready) || available.some((a) => a.isNew) };
  }

  // Progress text for goals that report one (called with metrics each tick).
  updateProgressText(m) {
    const stats = this.career.stats;
    for (const a of this.active) {
      const c = COMMISSIONS[a.id];
      for (const g of c.goals) {
        if (a.goals[g.id]?.done || !g.progressText) continue;
        try { this.lastProgress[`${c.id}:${g.id}`] = g.progressText(m, stats); } catch { /* ignore */ }
      }
    }
  }

  markSeen() { for (const id of Object.keys(COMMISSIONS)) this.seen[id] = true; }

  serialize() { return { active: this.active, done: this.done, seen: this.seen }; }
  load(o) {
    if (!o) return;
    this.active = (o.active ?? []).filter((a) => COMMISSIONS[a.id]);
    this.done = o.done ?? {};
    this.seen = o.seen ?? {};
  }
}
