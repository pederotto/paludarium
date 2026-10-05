// The director connects the game to its rules: once a second it measures the
// tank, and feeds the metrics to commissions, achievements, the tutorial, the
// event director and the Curator, then publishes a snapshot for the UI. It
// also owns starting a career or a sandbox, saving and loading.

import { Career } from '../game/career.js';
import { Commissions } from '../game/commissions.js';
import { Tutorial } from '../game/tutorial.js';
import { EventDirector } from '../game/events.js';
import { computeMetrics } from '../game/metrics.js';
import { score, GRADE_ORDER, visitorAppeal } from '../game/curator.js';
import { stockAdvice } from '../game/stocking.js';
import { upkeepOf } from './snapshot.js';
import { RUNNING_COSTS } from '../content/upkeep.js';
import { SPECIES } from '../sim/animals.js';
import { sizeFactors } from '../sim/tank.js';
import { FIRST_COMMISSION } from '../content/commissions.js';
import { TUTORIAL } from '../content/tutorial.js';
import { S, toast, closeModal } from '../ui/store.js';
import { ctx } from './ctx.js';
import { Saves, Meta } from './saves.js';
import { TANKS } from '../content/tanks.js';
import { START_TANK } from '../content/economy.js';
import { loadGenerator } from './lazy-gen.js';
import { setMode } from './modes-runtime.js';
import { MODES } from './modes.js';

const SLOT = 'slot1';

export class Director {
  constructor(game) {
    this.game = game;
    this.career = null;
    this.commissions = null;
    this.tutorial = null;
    this.events = null;
    this.curator = null;           // latest { overall, grade, parts }
    this.biotope = null;           // the habitat the player is aiming at (for the Curator)
    this.lastMinute = null;
    this._t = 0; this._curT = 0; this._saveT = 0;
    this.metrics = null;
    game.tickHooks.push((dt) => this.tick(dt));
    game.events.on('unload', (w) => { this.events?.cancel(w); this.curator = null; this._bill = null; });
    game.events.on('placed', (kind, id) => { if (kind === 'animal') this.stockWarning(id); });
    game.controls.addEventListener('controlstart', () => game.events.emit('looked'));
  }

  // --- Starting ----------------------------------------------------------------------------------
  attach(career) {
    const g = this.game;
    this.career = career;
    ctx.career = career;
    g.career = career;
    this.commissions = new Commissions(career);
    this.tutorial = new Tutorial(career);
    this.tutorial.bind(g.events);
    this.events = new EventDirector((Math.random() * 1e6) | 0);
    this.commissions.onGoal = (c, goal) => toast(`${c.title}: ${goal.text}`, 'good');
    this.commissions.onReady = (c) => toast(`Commission ready to claim: ${c.title}`, 'gold', 5000);
    this.commissions.onComplete = (c) => toast(`${c.title} complete: +¤${c.reward.funds}, +${c.reward.rep} reputation`, 'gold', 5000);
    career.onLevelUp = (lv, name, unlocks, bonus) => toast(`Promoted: ${name}! Bonus ¤${bonus}. ${unlocks.length ? `Unlocked: ${unlocks.slice(0, 4).map((u) => u.name).join(', ')}${unlocks.length > 4 ? '…' : ''}` : ''}`, 'gold', 7000);
    career.onAchievement = (a) => toast(`Achievement: ${a.name}`, 'gold', 5000);
    career.onSell = (a, price) => { g.world.animals.remove(a, 'sold'); toast(`Sold for ¤${price}.`, 'good'); S.selection.value = null; };
    this.events.onEvent = (e, reward) => {
      let text = e.text;
      // Visitors are impressed by what the tank shows for its size: a big, varied tank, or a small one kept perfectly.
      if (reward && e.id === 'visitors') {
        const m = this.metrics;
        reward = visitorAppeal(reward, { litres: sizeFactors().litres, grade: this.curator?.grade, species: m?.animals.species ?? 0, target: m?.speciesTarget ?? 8 });
        text += ' ' + reward.text;
      }
      S.coach.value = { title: e.title, text: text + (e.fix ? `\n\nWhat to do: ${e.fix}` : ''), concept: e.concept, kind: e.kind, event: true };
      if (reward) { career.addFunds(reward.funds, e.title); career.addRep(reward.rep, e.title); }
    };
    this.events.onEnd = () => { if (S.coach.value?.event) S.coach.value = null; };
    this.syncGear();
    S.career.value = career.snapshot();
  }

  // The tank's fitted gear follows what the career owns.
  syncGear() {
    const W = this.game.world, c = this.career;
    if (!W || !c) return;
    W.equipment.all = c.sandbox;
    for (const id of c.gear) W.equipment.buy(id);
  }

  async startCareer() {
    S.tankTitle.value = null;
    const career = new Career({ mode: 'career' });
    this.attach(career);
    await this.game.loadTank(START_TANK, { layout: 'empty' });
    this.syncGear();
    this.commissions.accept(FIRST_COMMISSION, this.game.world);
    this.tutorial.step = 0; this.tutorial.finished = false;
    this.showCoach(TUTORIAL[0]);
    this.game.setSpeed(1);
    this.publish();
  }

  async startSandbox(kind = 'starter', tank = 'standard', preset = null) {
    const career = new Career({ mode: 'sandbox' });
    this.attach(career);
    if (kind === 'preset' && preset) {
      const world = await this.game.loadTank(tank, { layout: 'empty' });
      const gen = await loadGenerator();
      if (!gen) throw new Error('The terrarium generator is not available yet.');
      const made = gen.generateTerrarium(world, { preset: preset.id, seed: preset.seed, tier: tank });
      S.tankTitle.value = made?.name ?? null;
      world.log(`Welcome! ${gen.describePreset?.(preset.id, preset.seed) ?? 'A generated terrarium'}. Everything is unlocked in sandbox mode.`);
    } else {
      S.tankTitle.value = null;
      await this.game.loadTank(tank, { layout: kind === 'starter' && tank === 'standard' ? 'starter' : 'empty' });
    }
    this.syncGear();
    this.tutorial.finished = true;
    this.publish();
  }

  showCoach(step) {
    S.coach.value = step ? { title: step.title, text: step.text, hint: step.hint, step: this.tutorial.step + 1, total: TUTORIAL.length, tutorial: true } : null;
  }

  // --- The per-second loop ----------------------------------------------------------------------------------
  tick(dt) {
    if (S.screen.value !== 'play' || !this.game.world || !this.career) return;
    this._t += dt; this._curT += dt; this._saveT += dt;
    if (this._t < 1) return;
    this._t = 0;
    const W = this.game.world, E = W.env, c = this.career;
    const m = this.metrics = computeMetrics(W);
    m.grade = this.curator ? GRADE_ORDER.indexOf(this.curator.grade) + 1 : 0;   // for goals about this tank's grade
    c.day = E.day + 1;
    this.bill(W);
    c.stats.births = W.stats.births; c.stats.deaths = W.stats.deaths; c.stats.metamorphs = W.stats.metamorphs;
    if (this.lastMinute != null && (W.animals.by.axolotl?.some((a) => a.health > 0.7))) c.stats.axolotlDays += Math.max(0, E.minute - this.lastMinute) / 1440;
    this.lastMinute = E.minute;
    if (!c.sandbox) {
      this.commissions.tick(m, E.minute);
      this.commissions.updateProgressText(m);
    }
    this.record(W);
    this.events.tick(W, m);
    if (this.tutorial && !this.tutorial.finished && !c.sandbox) {
      const before = this.tutorial.step;
      this.tutorial.tick(m);
      if (this.tutorial.step !== before || (this.tutorial.finished && S.coach.value?.tutorial)) this.showCoach(this.tutorial.current());
    }
    if (this._curT > 20) { this._curT = 0; this.curator = score(W, { biotope: this.biotope }); c.setStatMax('bestGrade', GRADE_ORDER.indexOf(this.curator.grade) + 1); }
    c.checkAchievements(m);
    if (W.animals.by.springtail) this.trackBreeding(W);
    S.career.value = c.snapshot();
    if (this._saveT > 60) { this._saveT = 0; this.save().catch(() => {}); }
  }

  // Running costs (content/upkeep.js): charged for the game time that has passed, at what the tank costs to run now.
  // Restarts when another tank is loaded (the clock is that tank's own), and never charges for time the clock ran back.
  bill(W) {
    const c = this.career, E = W.env;
    if (c.sandbox || !RUNNING_COSTS) return;
    if (!this._bill || this._bill.world !== W || E.minute < this._bill.minute) { this._bill = { world: W, minute: E.minute }; return; }
    const days = (E.minute - this._bill.minute) / 1440;
    if (days <= 0) return;
    this._bill.minute = E.minute;
    const u = upkeepOf(W);
    c.payBills(days, u.total, u.parts, E.day + 1);
  }

  // After animals are released: say so when the tank is too small for them or they now crowd each other (the simulation's
  // own room, game/stocking.js), once per species and verdict until the tank changes.
  stockWarning(id) {
    const W = this.game.world, sp = SPECIES[id];
    if (!W || !sp) return;
    const a = stockAdvice(id, sp, W.animals.count(id), sizeFactors(), { water: W.water.volumeLitres() });
    if (!['small', 'over', 'group'].includes(a.verdict)) return;
    const key = `${W.env.tankDays | 0}|${id}|${a.verdict}`;
    this._warned ??= new Set();
    if (this._warned.has(key)) return;
    this._warned.add(key);
    toast(`${sp.name}: ${a.text}.${a.verdict === 'over' ? ' Crowded animals stress each other and foul the water: take some out, or give them a bigger tank.' : ''}`, 'bad', 6000);
  }

  // One reading per game hour for the Lab charts (kept for 14 days).
  record(W) {
    const E = W.env;
    const h = (W.history ??= []);
    const last = this._lastHist ?? -1e9;
    if (E.minute - last < 60) return;
    if (E.minute < last) h.length = 0;
    this._lastHist = E.minute;
    h.push({ m: E.minute, temp: E.temp, hum: E.humidity, nh3: E.ammonia, no2: E.nitrite, no3: E.nitrate, o2: E.oxygen, soil: E.soil, mold: E.mold });
    if (h.length > 24 * 14) h.shift();
  }

  // Breeding after a rain program counts for an achievement.
  trackBreeding(W) {
    const eggs = W.animals.by.eggs?.length ?? 0;
    if (eggs > (this._eggs ?? 0) && W.env.rain > 0.3) this.career.stat('rainBreedings');
    this._eggs = eggs;
  }

  publish() { S.career.value = this.career.snapshot(); }

  // --- Several tanks ---------------------------------------------------------------------------------------------------
  // Moving on to a new tank keeps the old one exactly as it is, in the portfolio.
  async archiveCurrent() {
    const g = this.game, W = g.world;
    if (!W || !this.career) return;
    const id = 't' + Date.now().toString(36);
    await Saves.put('tank-' + id, { tank: g.tankId, world: W.serialize() });
    const animals = Object.values(W.animals.by).reduce((s, a) => s + a.length, 0);
    this.career.portfolio.unshift({ id, tier: g.tankId, name: `${TANKS[g.tankId].name}, day ${W.env.day + 1}`, day: W.env.day + 1, animals });
    this.career.portfolio = this.career.portfolio.slice(0, 12);
  }

  async portfolio() { return this.career?.portfolio ?? []; }

  async openPortfolio(pid) {
    const entry = this.career.portfolio.find((p) => p.id === pid);
    const data = entry && await Saves.get('tank-' + pid);
    if (!data) { toast('That tank could not be opened.', 'bad'); return; }
    await this.archiveCurrent();
    this.career.portfolio = this.career.portfolio.filter((p) => p.id !== pid);
    await Saves.del('tank-' + pid);
    await this.game.loadTank(data.tank, { save: data.world });
    this.syncGear();
    this.enterPlay();
  }

  async buildTank(tier, preset = null) {
    await this.archiveCurrent();
    const world = await this.game.loadTank(tier, { layout: 'empty' });
    if (preset) {
      const gen = await loadGenerator();
      if (gen) S.tankTitle.value = gen.generateTerrarium(world, { preset: preset.id, seed: preset.seed, tier })?.name ?? null;
    } else S.tankTitle.value = null;
    if (tier === 'grand') this.career.stat('grandBuilt');
    this.syncGear();
    this.enterPlay();
    toast(`A new ${TANKS[tier].name}. Your old tank is in the portfolio.`, 'good');
  }

  enterPlay() {
    this.game.rig.stopOrbit();
    this.game.setRoom(false);
    this.game.rig.setZone('tank', true);
    ctx.tools?.setTool('view');
    S.screen.value = 'play';
    this.publish();
  }

  // --- Save and load ---------------------------------------------------------------------------------------------------
  async save() {
    const g = this.game;
    if (!g.world || !this.career) return;
    if (S.screen.value !== 'play') return;   // never write the title screen's showcase tank over the player's game
    const data = {
      v: 4, tank: g.tankId, world: g.world.serialize(), career: this.career.serialize(), commissions: this.commissions.serialize(),
      tutorial: this.tutorial.serialize(), events: this.events.serialize(), biotope: this.biotope, speed: g.speed, mode: S.mode.value,
    };
    await Saves.put(SLOT, data);
    Meta.set({ name: `${this.career.sandbox ? 'Sandbox' : this.career.levelInfo().rank} · ${TANKS[data.tank]?.name ?? 'tank'}`, day: g.world.env.day + 1, mode: this.career.mode, at: Date.now() });
    ctx.meta = Meta.get();
  }

  // Back to the title screen: save the game, clear the transient state, show the starter tank turning behind the menu.
  async goHome() {
    const g = this.game;
    try { await this.save(); } catch (e) { console.error(e); }
    const T = ctx.tools;
    if (T) { T.keys?.delete('shift'); T.selectPiece?.(null); T.select?.(null); T.setTool('view'); if (S.mirror.value) T.toggleMirror(false); }
    S.photo.value = false; S.timelapse.value = null; g.lapse = 0;
    S.lens.value = 'off'; S.selection.value = null; S.following.value = null; S.coach.value = null; S.smartBar.value = null; S.pairing.value = null;
    S.modal.value = null; S.modalArg.value = null; S.hub.value = null; S.right.value = false;
    S.tankTitle.value = null;
    g.rig.freeZone(); g.setRoom(true);
    await g.loadTank('standard', { layout: 'starter', showcase: true });
    g.rig.startOrbit(0.04);
    g.rig.view('hero', false);
    S.screen.value = 'title';
    ctx.meta = Meta.get();
  }

  async load() {
    S.tankTitle.value = null;
    const data = await Saves.get(SLOT);
    if (!data) return false;
    const career = Career.load(data.career);
    this.attach(career);
    setMode(MODES[data.mode] ? data.mode : 'naturalist', { quiet: true });   // the mode travels with the save
    await this.game.loadTank(data.tank ?? 'standard', { save: data.world });
    this.syncGear();
    this.commissions.load(data.commissions);
    this.tutorial.load(data.tutorial);
    this.events.load(data.events);
    this.biotope = data.biotope ?? null;
    this.showCoach(this.tutorial.finished ? null : this.tutorial.current());
    this.publish();
    return true;
  }
}

export { closeModal };
