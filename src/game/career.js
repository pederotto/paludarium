// The career: funds, reputation, rank, what you own and know, and the
// counters that achievements read. Pure logic (no rendering, no DOM), so it
// can be tested under Node. Sandbox mode is the same object with everything
// unlocked and free: info() and buy() then say "no restrictions".
//
// The UI calls:  info(kind, id)  buy(kind, id, n)  refund()  newcomer(id)
//                knows()/discover()  snapshot()  canSell()/sellQuote()/sellAnimal()
// kinds: 'animal' | 'plant' | 'piece' | 'gear' | 'tank'.

import { START_FUNDS, entry, bulkFactor, REP_FIRST, PROMOTION_BONUS, SOURCES, ANIMALS, unlocksAt } from '../content/economy.js';
import { RANKS, rankFor } from '../content/levels.js';
import { ACHIEVEMENTS } from '../content/achievements.js';
import { sellPrice, sellQuote, isSellable } from './market.js';

const COUNTERS = ['animalsBought', 'animalsSold', 'animalsBorn', 'births', 'metamorphs', 'plantsPlaced', 'piecesPlaced', 'moneyEarned', 'moneySpent', 'deaths',
  'commissionsDone', 'vacationsSurvived', 'rulesWritten', 'rainPrograms', 'photos', 'pagesRead', 'bestGrade', 'grandBuilt', 'rainBreedings', 'heatwavesSurvived', 'axolotlDays', 'tanksBuilt', 'mirrorUsed', 'kitsPlaced', 'timelapses'];

export class Career {
  constructor({ mode = 'career' } = {}) {
    this.mode = mode;
    this.funds = mode === 'sandbox' ? 0 : START_FUNDS;
    this.rep = 0;
    this.gear = new Set();                 // bought gear (starter gear is always owned)
    this.tanks = new Set(['jar']);         // tank tiers you have bought
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
    return { locked: e.rank > this.level, level: e.rank, price: owned ? 0 : e.price, owned, sold: e.sold !== false };
  }

  cost(kind, id, n = 1) {
    const e = entry(kind, id);
    if (!e) return 0;
    return kind === 'gear' || kind === 'tank' ? e.price : Math.ceil(e.price * n * bulkFactor(n));
  }

  // Returns null when the purchase went through, or an error message.
  buy(kind, id, n = 1) {
    if (this.sandbox) { this.discover(kind, id); this.count(kind, n); return null; }
    const e = entry(kind, id);
    if (!e) return 'That is not for sale.';
    if (e.sold === false) return 'That cannot be bought: it has to be bred.';
    if (e.rank > this.level) return `Unlocked at rank ${e.rank}: ${RANKS[e.rank - 1].name}.`;
    if (kind === 'gear' && (e.owned || this.gear.has(id))) return 'You already own that.';
    if (kind === 'tank' && this.tanks.has(id)) return 'You already own that tank.';
    const price = this.cost(kind, id, n);
    if (this.funds < price) return `Not enough funds: this costs ¤${price} and you have ¤${Math.floor(this.funds)}.`;
    this.funds -= price;
    this.stats.moneySpent += price;
    if (kind === 'gear') this.gear.add(id);
    if (kind === 'tank') { this.tanks.add(id); this.stats.tanksBuilt++; }
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

  refund(kind, id, n = 1) {
    if (this.sandbox) return;
    this.funds += this.cost(kind, id, n);
    this.stats.moneySpent -= this.cost(kind, id, n);
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
      v: 1, mode: this.mode, funds: this.funds, rep: this.rep, gear: [...this.gear], tanks: [...this.tanks], known: this.known,
      stats: this.stats, achievements: this.achievements, journal: this.journal.slice(0, 40), day: this.day, portfolio: this.portfolio,
    };
  }

  static load(o) {
    const c = new Career({ mode: o?.mode ?? 'career' });
    if (!o) return c;
    c.funds = o.funds ?? c.funds; c.rep = o.rep ?? 0;
    c.gear = new Set(o.gear ?? []); c.tanks = new Set(o.tanks ?? ['jar']);
    c.known = { ...c.known, ...(o.known ?? {}) };
    c.stats = { ...c.stats, ...(o.stats ?? {}) };
    c.achievements = o.achievements ?? {};
    c.journal = o.journal ?? [];
    c.day = o.day ?? 1;
    c.portfolio = o.portfolio ?? [];
    return c;
  }
}
