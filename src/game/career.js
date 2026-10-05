// The career: funds, reputation, rank, what you own and know, and the
// counters that achievements read. Pure logic (no rendering, no DOM), so it
// can be tested under Node. Sandbox mode is the same object with everything
// unlocked and free: info() and buy() then say "no restrictions".
//
// The UI calls:  info(kind, id)  buy(kind, id, n)  refund()  newcomer(id)
//                knows()/discover()  snapshot()  canSell()/sellQuote()/sellAnimal()
// kinds: 'animal' | 'plant' | 'piece' | 'gear' | 'tank'.

import { START_FUNDS, entry, bulkFactor, REP_FIRST, PROMOTION_BONUS, SOURCES, ANIMALS, unlocksAt, morphFactor } from '../content/economy.js';
import { TANKS } from '../content/tanks.js';
import { GEAR } from '../content/equipment.js';
import { gearPrice, upsizeCost, GEAR_SIZING } from '../content/upkeep.js';
import { RANKS, rankFor } from '../content/levels.js';
import { ACHIEVEMENTS } from '../content/achievements.js';
import { sellPrice, sellQuote, isSellable } from './market.js';

const COUNTERS = ['animalsBought', 'animalsSold', 'animalsBorn', 'births', 'metamorphs', 'plantsPlaced', 'piecesPlaced', 'moneyEarned', 'moneySpent', 'deaths',
  'commissionsDone', 'vacationsSurvived', 'rulesWritten', 'rainPrograms', 'photos', 'pagesRead', 'bestGrade', 'grandBuilt', 'rainBreedings', 'heatwavesSurvived', 'axolotlDays', 'tanksBuilt', 'mirrorUsed', 'kitsPlaced', 'timelapses',
  'billsPaid'];

const litres = (id) => { const t = TANKS[id]; return t ? t.w * t.d * t.h : 0; };

export class Career {
  constructor({ mode = 'career' } = {}) {
    this.mode = mode;
    this.funds = mode === 'sandbox' ? 0 : START_FUNDS;
    this.rep = 0;
    this.gear = new Set();                 // bought gear (starter gear is always owned)
    this.tanks = new Set(['jar']);         // tank tiers you have bought
    this.gearFor = {};                     // sized gear (content/upkeep.js) → the tank tier it was bought or last resized for
    this.bills = { owed: 0, week: 0, weekParts: {}, since: 1 };   // running costs not yet paid, and this week's total
    this.known = { animal: {}, plant: {}, piece: {}, gear: {}, tank: {}, concept: {} };
    this.stats = Object.fromEntries(COUNTERS.map((k) => [k, 0]));
    this.achievements = {};                // id → day earned
    this.journal = [];                     // { day, text, kind }
    this.day = 1;
    this.day0 = 0;
    this.portfolio = [];                   // tanks you have moved on from: { id, tier, name, day, animals }
    // Hooks (set by the UI).
    this.onLevelUp = null; this.onAchievement = null; this.onChange = null; this.onSell = null;
    this.commissionsSnapshot = null;       // set by the commissions engine
    this.game = null;
  }

  get sandbox() { return this.mode === 'sandbox'; }
  get level() { return rankFor(this.rep).level; }
  levelInfo() { return { ...rankFor(this.rep), rep: this.rep }; }
  has(n) { return this.sandbox || this.funds >= n; }

  // --- What is for sale -----------------------------------------------------------
  info(kind, id) {
    if (this.sandbox) return null;
    const e = entry(kind, id);
    if (!e) return { locked: true, level: 99, price: 0 };
    const owned = (kind === 'gear' && (e.owned || this.gear.has(id))) || (kind === 'tank' && this.tanks.has(id));
    const out = { locked: e.rank > this.level, level: e.rank, price: owned ? 0 : kind === 'gear' || kind === 'tank' ? this.cost(kind, id) : e.price, owned, sold: e.sold !== false };
    if (kind === 'tank' && !owned) { const up = this.upsize(id); out.upsize = up.total; out.upsizeParts = up.parts; out.tankPrice = e.price; }
    if (kind === 'gear' && GEAR_SIZING[id]) out.sizedFor = this.gearTank();
    return out;
  }

  // --- Gear sized for the tank ---------------------------------------------------------------------
  // Gear is shared by all your tanks (it is fitted to whichever you are looking at), so a heater, a filter or a light is
  // bought for the biggest tank you own and costs more when that is a bigger tank (content/upkeep.js). Buying a bigger
  // tank resizes the sized gear you already own; the difference is part of the tank's price.
  gearTank() {
    let best = 'jar';
    for (const id of this.tanks) if (TANKS[id] && litres(id) > litres(best)) best = id;
    return best;
  }

  // What resizing your sized gear for tank `tier` costs: { total, parts: [[gear name, ¤]] }.
  upsize(tier) {
    const to = TANKS[tier], parts = [];
    if (!to || this.sandbox) return { total: 0, parts };
    for (const id of this.gear) {
      if (!GEAR_SIZING[id]) continue;
      const c = upsizeCost(id, TANKS[this.gearFor[id] ?? this.gearTank()], to);
      if (c > 0) parts.push([GEAR[id]?.name ?? id, c]);
    }
    return { total: parts.reduce((s, p) => s + p[1], 0), parts };
  }

  // `morph`: the colour morph of an animal being bought (rare morphs cost more).
  cost(kind, id, n = 1, morph = null) {
    const e = entry(kind, id);
    if (!e) return 0;
    const mf = kind === 'animal' ? morphFactor(id, morph) : 1;
    if (kind === 'gear') return gearPrice(id, TANKS[this.gearTank()]);
    if (kind === 'tank') return e.price + this.upsize(id).total;
    return Math.ceil(e.price * mf * n * bulkFactor(n));
  }

  // Returns null when the purchase went through, or an error message.
  buy(kind, id, n = 1, morph = null) {
    if (this.sandbox) { this.discover(kind, id); this.count(kind, n); return null; }
    const e = entry(kind, id);
    if (!e) return 'That is not for sale.';
    if (e.sold === false) return 'That cannot be bought: it has to be bred.';
    if (e.rank > this.level) return `Unlocked at rank ${e.rank}: ${RANKS[e.rank - 1].name}.`;
    if (kind === 'gear' && (e.owned || this.gear.has(id))) return 'You already own that.';
    if (kind === 'tank' && this.tanks.has(id)) return 'You already own that tank.';
    const price = this.cost(kind, id, n, morph);
    const up = kind === 'tank' ? this.upsize(id) : null;
    if (this.funds < price) return `Not enough funds: this costs ¤${price}${up?.total ? ` (¤${e.price} for the tank and ¤${up.total} to resize your gear for it)` : ''} and you have ¤${Math.floor(this.funds)}.`;
    this.funds -= price;
    this.stats.moneySpent += price;
    if (kind === 'gear') { this.gear.add(id); if (GEAR_SIZING[id]) this.gearFor[id] = this.gearTank(); }
    if (kind === 'tank') {
      this.tanks.add(id); this.stats.tanksBuilt++;
      // Owned sized gear now serves the biggest tank (resized if this one is bigger, paid for above).
      const big = this.gearTank();
      for (const g of this.gear) if (GEAR_SIZING[g] && litres(big) > litres(this.gearFor[g] ?? 'jar')) this.gearFor[g] = big;
      if (up.total) this.note(`Resized your gear for the ${e.name}: ${up.parts.map(([n, c]) => `${n} ¤${c}`).join(', ')}.`, 'info');
    }
    this.count(kind, n);
    if (!this.known[kind][id]) { this.discover(kind, id); this.addRep(REP_FIRST[kind] ?? 0, `first ${e.name}`); }
    this.changed();
    return null;
  }

  count(kind, n) {
    if (kind === 'animal') this.stats.animalsBought += n;
    else if (kind === 'plant') this.stats.plantsPlaced += n;
    else if (kind === 'piece') this.stats.piecesPlaced += n;
  }

  refund(kind, id, n = 1, morph = null) {
    if (this.sandbox) return;
    this.funds += this.cost(kind, id, n, morph);
    this.stats.moneySpent -= this.cost(kind, id, n, morph);
    if (kind === 'animal') this.stats.animalsBought -= n;
    if (kind === 'plant') this.stats.plantsPlaced -= n;
    this.changed();
  }

  // Extra options for Animals.add: shop and wild stock arrive a little stressed.
  newcomer(id) {
    if (this.sandbox) return {};
    const src = SOURCES[ANIMALS[id]?.source] ?? SOURCES.captive;
    return { health: src.health, hunger: src.hunger };
  }

  // --- Field guide --------------------------------------------------------------------
  knows(kind, id) {
    if (this.sandbox) return true;
    return !!this.known[kind]?.[id];
  }
  discover(kind, id) {
    if (!this.known[kind] || this.known[kind][id]) return;
    this.known[kind][id] = this.day;
    if (kind === 'concept') this.stats.pagesRead++;
  }

  // --- Money and reputation ---------------------------------------------------------------
  addFunds(n, reason = '') {
    this.funds += n;
    if (n > 0) this.stats.moneyEarned += n;
    if (reason && n) this.note(`${n > 0 ? '+' : ''}¤${Math.round(n)} ${reason}`, 'gold');
    this.changed();
  }

  addRep(n, reason = '') {
    if (!n) return;
    const before = this.level;
    this.rep += n;
    if (reason && n >= 10) this.note(`+${n} reputation: ${reason}`, 'good');
    const after = this.level;
    for (let lv = before + 1; lv <= after; lv++) {
      const r = RANKS[lv - 1];
      const bonus = PROMOTION_BONUS * lv;
      this.funds += bonus;
      this.stats.moneyEarned += bonus;
      const unlocks = unlocksAt(lv);
      this.note(`Promoted to ${r.name} (rank ${lv}). ${r.text}`, 'gold');
      this.onLevelUp?.(lv, r.name, unlocks, bonus);
    }
    this.changed();
  }

  // --- Running costs --------------------------------------------------------------------------------
  // The tank's electricity, water and food (content/upkeep.js), charged as the game clock runs: `days` of a tank whose
  // running costs are `perDay` (¤) and broken down as `parts` ([[label, ¤ a day]]). Whole coins are paid as they add up;
  // a week's total goes in the journal. Bills never take the funds below zero: an unpaid bill is forgiven, so a broke
  // keeper can still sell animals and finish commissions.
  payBills(days, perDay, parts = [], day = this.day) {
    if (this.sandbox || !(days > 0) || !(perDay > 0)) return 0;
    const B = this.bills;
    if (day < B.since) B.since = day;   // another tank, with its own clock: the week runs from its day
    B.owed += perDay * days;
    for (const [k, v] of parts) B.weekParts[k] = (B.weekParts[k] ?? 0) + v * days;
    let paid = 0;
    if (B.owed >= 1) {
      const due = Math.floor(B.owed);
      B.owed -= due;
      paid = Math.min(due, Math.max(0, Math.floor(this.funds)));
      this.funds -= paid;
      this.stats.moneySpent += paid;
      this.stats.billsPaid += paid;
      B.week += paid;
    }
    if (day - B.since >= 7) {
      if (B.week >= 1) {
        const top = Object.entries(B.weekParts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k.toLowerCase()} ¤${Math.round(v)}`).join(', ');
        this.note(`Running costs, days ${B.since}–${day - 1}: ¤${Math.round(B.week)} (${top}).`, 'info');
      }
      B.week = 0; B.weekParts = {}; B.since = day;
    }
    if (paid) this.changed();
    return paid;
  }

  stat(name, delta = 1) { this.stats[name] = (this.stats[name] ?? 0) + delta; }
  setStatMax(name, v) { if (v > (this.stats[name] ?? 0)) this.stats[name] = v; }

  note(text, kind = 'info') {
    this.journal.unshift({ day: this.day, text, kind });
    if (this.journal.length > 80) this.journal.pop();
  }

  changed() { this.onChange?.(); }

  // --- Selling --------------------------------------------------------------------------------
  canSell(animal) { return !this.sandbox && isSellable(animal.sp) && sellPrice(animal, this.day) > 0; }
  sellQuote(animal) { return sellQuote(animal, this.day); }
  sellAnimal(animal) {
    const price = sellPrice(animal, this.day);
    if (!price) return 0;
    this.stat('animalsSold');
    this.addFunds(price);
    this.onSell?.(animal, price);
    return price;
  }

  // --- Achievements ------------------------------------------------------------------------------
  checkAchievements(ctx) {
    const earned = [];
    if (this.sandbox) return earned;
    for (const a of ACHIEVEMENTS) {
      if (this.achievements[a.id]) continue;
      let ok = false;
      try { ok = !!a.test(this.stats, ctx); } catch { ok = false; }
      if (!ok) continue;
      this.achievements[a.id] = this.day;
      if (!this.sandbox) { this.funds += a.funds; this.stats.moneyEarned += a.funds; }
      this.note(`Achievement: ${a.name}`, 'gold');
      this.onAchievement?.(a);
      earned.push(a);
      if (!this.sandbox) this.addRep(a.rep, a.name);
    }
    return earned;
  }

  // --- UI snapshot ------------------------------------------------------------------------------------
  snapshot() {
    const lv = this.levelInfo();
    const c = this.commissionsSnapshot?.() ?? { active: [], available: [], done: [], attention: false };
    return {
      mode: this.mode, funds: this.funds, rep: this.rep, level: lv.level, rank: lv.rank, levelProgress: lv.progress, nextIn: lv.nextIn,
      active: c.active, available: c.available, done: c.done, attention: c.attention,
      stats: { ...this.stats }, achievements: Object.keys(this.achievements), journal: this.journal.slice(0, 20), day: this.day,
    };
  }

  serialize() {
    return {
      v: 1, mode: this.mode, funds: this.funds, rep: this.rep, gear: [...this.gear], tanks: [...this.tanks], gearFor: this.gearFor, bills: this.bills, known: this.known,
      stats: this.stats, achievements: this.achievements, journal: this.journal.slice(0, 40), day: this.day, portfolio: this.portfolio,
    };
  }

  static load(o) {
    const c = new Career({ mode: o?.mode ?? 'career' });
    if (!o) return c;
    c.funds = o.funds ?? c.funds; c.rep = o.rep ?? 0;
    c.gear = new Set(o.gear ?? []); c.tanks = new Set(o.tanks ?? ['jar']);
    // Saves from before gear was sized: what was bought then counts as sized for the biggest tank owned, so nothing is charged again.
    c.gearFor = { ...(o.gearFor ?? {}) };
    for (const id of c.gear) if (GEAR_SIZING[id] && !TANKS[c.gearFor[id]]) c.gearFor[id] = c.gearTank();
    c.bills = { ...c.bills, ...(o.bills ?? {}) };
    c.known = { ...c.known, ...(o.known ?? {}) };
    c.stats = { ...c.stats, ...(o.stats ?? {}) };
    c.achievements = o.achievements ?? {};
    c.journal = o.journal ?? [];
    c.day = o.day ?? 1;
    c.portfolio = o.portfolio ?? [];
    return c;
  }
}
