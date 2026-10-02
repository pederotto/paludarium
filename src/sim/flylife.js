// The fruit fly's life cycle, the first micro-fauna of the decay chain (see humus.js).
//
//   adult --lays--> egg (hidden, a batch counter) --hatch--> larva (maggot) --pupates--> pupa --emerges--> adult
//
// * Adults (species 'fly') lay eggs on rotting matter: leaf litter, fallen fruit, humus-rich damp ground. They need
//   warmth (no laying under 17 C) and the egg needs a damp, dry-enough cell. The number of eggs is limited by the food
//   there is (litter and fruit in cells, shared with the maggots already in them), not by a bare population cap.
// * Development is temperature dependent: about 1 + 4.5 + 4.3 = ten days at 25 C, twice as long near 18 C, none under
//   12 C or over 34 C (rateOf).
// * Maggots (species 'flylarva') live in the litter layer of a cell, crawl slowly toward rot, eat the litter and fruit
//   there (which is faster rotting: eaten litter becomes humus, frass raises fertility and a little nitrogen is
//   released), die in flooded or dry cells, and starve when the food runs out.
// * Pupae (species 'flypupa') are still: stuck to the background wall near the maggot or on the ground, then adults emerge.
//
// Fruit pieces (addFruit) are the player's way to start and sustain a culture: they rot slowly into humus and feed
// maggots and adults. Boom and bust follows: fruit and litter feed a burst of maggots, then the food runs out.
//
// Plain arithmetic on the Climate fields and the animals' lists, so it runs under Node for the tests: `world` needs
// climate, env, animals (by, add, remove, count), terrain.heightAt/normalAt, wall.zAt/field.gradient, water.surfaceAt.

import { clamp } from '../util/math.js';

export const FLY = {
  egg: 1, larva: 4.5, pupa: 4.3,      // development days at 25 C
  mature: 1.0,                         // adult age (days) before it lays
  layPerDay: 0.9, clutch: 4,           // laying events per adult per day at 25 C, eggs per event
  eat: 0.026,                          // litter units a maggot eats per day at full speed
  yield: 0.5, frass: 0.18,            // share of eaten litter that becomes humus and fertility
  nitrogen: 0.08,                      // nitrate released to the tank per litter unit eaten (ppm)
  fruit: 4,                            // litter units in a fresh piece of fruit
  maxFruit: 12, maxEggs: 600,
};

// Development speed relative to 25 C: nothing under 12 C or over 34 C.
export const rateOf = (T) => (T <= 12 || T >= 34 ? 0 : T < 25 ? (T - 12) / 13 : T < 30 ? 1 + (T - 25) * 0.05 : 1.25 * (34 - T) / 4);

export class FlyLife {
  constructor(world, vec = null) {
    this.world = world;
    this.V = vec;               // (x, y, z) -> Vector3 (Sim passes THREE.Vector3; tests pass a stub)
    this.acc = 0;
    this.eggs = [];             // { c, x, z, n, dev, age }
    this.fruit = [];            // { x, z, amt, age }
    this.rev = 0;               // bumped when the fruit changed (the view redraws)
    this.view = null;
    this.stats = { eggs: 0, larvae: 0, pupae: 0, adults: 0, fruit: 0, laid: 0, hatched: 0, emerged: 0 };
  }

  get C() { return this.world.climate; }

  // A piece of rotting fruit on the ground at (x, z).
  addFruit(x, z, amt = FLY.fruit) {
    if (this.fruit.length >= FLY.maxFruit) this.fruit.shift();
    this.fruit.push({ x, z, amt, age: 0 });
    this.rev++;
    return true;
  }
  fruitTotal() { let s = 0; for (const f of this.fruit) s += f.amt; return s; }

  reset() { this.eggs.length = 0; this.fruit.length = 0; this.acc = 0; this.rev++; this.stats = { eggs: 0, larvae: 0, pupae: 0, adults: 0, fruit: 0, laid: 0, hatched: 0, emerged: 0 }; this.view?.update(this); }

  step(dtMin) {
    this.acc += dtMin;
    if (this.acc < 15) return;
    const dt = this.acc; this.acc = 0;
    this.process(dt);
  }

  // dtMin game minutes of life.
  process(dtMin) {
    const W = this.world, C = this.C, E = W.env, A = W.animals, days = dtMin / 1440;
    const adults = A.by.fly ?? [], larvae = A.by.flylarva ?? [], pupae = A.by.flypupa ?? [];
    if (!adults.length && !larvae.length && !pupae.length && !this.eggs.length && !this.fruit.length) { this.stats.adults = this.stats.larvae = this.stats.pupae = this.stats.eggs = 0; return; }
    const { nx, nz, litter: L, humus: H, fert: F } = C;
    const n = nx * nz;
    const rand = Math.random;
    const T0 = (c) => C.temp[c];
    const cellOk = (c) => (C.f.water[c] ?? 0) < 0.4 && C.soil[c] > 0.22 && C.soil[c] < 0.95;

    // --- Fruit: rots slowly into humus, faster when warm ---------------------------------------
    let fruitChanged = false;
    for (let k = this.fruit.length - 1; k >= 0; k--) {
      const f = this.fruit[k], c = C.idx(f.x, f.z);
      f.age += days;
      const loss = Math.min(f.amt, f.amt * 0.03 * days * clamp(Math.pow(2, (T0(c) - 22) / 10), 0.1, 2) + 0.01 * days);
      f.amt -= loss; H[c] = Math.min(1, H[c] + loss * 0.2); L[c] = Math.min(4, L[c] + loss * 0.1);
      if (f.amt < 0.05) { this.fruit.splice(k, 1); fruitChanged = true; }
    }
    if (fruitChanged) this.rev++;

    // --- Where is the food? Per-cell larval load and the rot score used by egg laying and feeding -----
    const load = new Uint16Array(n);
    for (const a of larvae) load[C.idx(a.pos.x, a.pos.z)]++;
    const fruitAt = new Float32Array(n);
    for (const f of this.fruit) fruitAt[C.idx(f.x, f.z)] += f.amt;
    const sites = [];
    let total = 0, heaps = 0;
    for (let c = 0; c < n; c++) {
      const food = L[c] + fruitAt[c] * 1.5;
      if (food > 0.08 && cellOk(c)) heaps += food - 0.08;
      if (food < 0.04 || !cellOk(c) || rateOf(T0(c)) <= 0) continue;
      const s = food / (1 + load[c] * 0.35);
      sites.push(c, s); total += s;
    }
    const pickSite = () => {
      if (total <= 0.03) return -1;
      let r = rand() * total;
      for (let i = 0; i < sites.length; i += 2) { r -= sites[i + 1]; if (r <= 0) return sites[i]; }
      return sites[sites.length - 2] ?? -1;
    };
    const cellPos = (c) => {
      const i = c % nx, j = (c / nx) | 0;
      return [(i + rand()) * C.cs - C.nx * C.cs / 2, (j + rand()) * C.cs - C.nz * C.cs / 2];
    };
    // How much adults can eat: rotting fruit and heaps of litter, or a culture dish.
    const avail = clamp((this.fruitTotal() * 2 + heaps * 0.4) / Math.max(1, adults.length * 0.12), 0, 1);
    const fed = Math.max(avail, E.culture ? 0.5 : 0);

    // --- Adults: eat, lay, starve ----------------------------------------------------------------
    for (let i = adults.length - 1; i >= 0; i--) {
      const a = adults[i];
      if (a.dead) continue;
      a.hunger = clamp(a.hunger - fed * dtMin * 0.0018, 0, 1);
      if (a.hunger > 0.88) { this.kill(a, 'starved'); continue; }
      if (a.age < FLY.mature * 1440 || a.hunger > 0.6 || a.health < 0.6 || this.eggs.length >= FLY.maxEggs) continue;
      const T = a.T ?? E.temp;
      const rate = T < 17 || T > 32 ? 0 : clamp(rateOf(T), 0.3, 1.2);
      if (rand() > 1 - Math.exp(-FLY.layPerDay * rate * days)) continue;
      const c = pickSite();
      if (c < 0) continue;
      const [x, z] = cellPos(c);
      const e = this.eggs.find((q) => q.c === c && q.dev < 0.3);
      if (e) e.n += FLY.clutch; else this.eggs.push({ c, x, z, n: FLY.clutch, dev: 0, age: 0 });
      load[c]++;
      this.stats.laid += FLY.clutch;
    }

    // --- Eggs: develop, hatch into maggots ---------------------------------------------------------
    for (let k = this.eggs.length - 1; k >= 0; k--) {
      const e = this.eggs[k], c = e.c;
      e.age += days;
      if (!cellOk(c)) { e.n *= Math.exp(-4 * days); }
      e.dev += days * rateOf(T0(c));
      if (e.n < 0.6 || e.age > 14) { this.eggs.splice(k, 1); continue; }
      if (e.dev < FLY.egg) continue;
      const fed2 = L[c] + fruitAt[c] > 0.05;
      const m = Math.round(e.n * (fed2 ? 0.85 : 0.2));
      this.eggs.splice(k, 1);
      const g = W.terrain.heightAt(e.x, e.z);
      for (let q = 0; q < m; q++) {
        const p = this.V(e.x + (rand() - 0.5) * 1.5, g, e.z + (rand() - 0.5) * 1.5);
        const lv = A.add('flylarva', p, { age: 0, hunger: 0.15 });
        if (!lv) break;
        lv.dev = 0; lv.timer = rand() * 3; this.stats.hatched++;
      }
    }

    // --- Maggots: eat the litter, speed its rot, pupate, die dry or flooded or hungry -------------
    const fruitNear = (x, z) => { let best = null, bd = 25; for (const f of this.fruit) { const d = (f.x - x) ** 2 + (f.z - z) ** 2; if (d < bd) { bd = d; best = f; } } return best; };
    let eatenAll = 0;
    for (let i = larvae.length - 1; i >= 0; i--) {
      const a = larvae[i];
      if (a.dead) continue;
      const c = C.idx(a.pos.x, a.pos.z), T = T0(c), rate = rateOf(T), s = C.soil[c];
      if (W.water.surfaceAt(a.pos.x, a.pos.z) > a.pos.y + 0.2) { this.kill(a, 'drowned'); continue; }   // really under water, not just in a damp cell
      if (s < 0.16) { a.dry = (a.dry ?? 0) + days; if (a.dry > 0.25) { this.kill(a, 'dried out'); continue; } } else a.dry = Math.max(0, (a.dry ?? 0) - days);
      // Eating: the fruit it is on first, else the litter of its cell shared with the other maggots there.
      const want = FLY.eat * days * clamp(rate, 0.15, 1.25) * (0.4 + 0.6 * clamp(a.dev / FLY.larva, 0, 1) + 0.2);
      let ate = 0;
      const f = fruitNear(a.pos.x, a.pos.z);
      if (f && f.amt > 0.03) { ate = Math.min(want, f.amt); f.amt -= ate; this.rev++; }
      if (ate < want && L[c] > 0.01) { const share = Math.min(want - ate, L[c] * 0.6 / Math.max(1, load[c])); L[c] -= share; ate += share; }
      if (ate > 0) {
        H[c] = Math.min(1, H[c] + ate * FLY.yield);
        F[c] = clamp(F[c] + ate * FLY.frass, 0, 1);
        eatenAll += ate;
      }
      const ratio = want > 0 ? ate / want : 0;
      a.hunger = clamp(a.hunger - ratio * dtMin * 0.0017, 0, 1);
      a.dev += days * rate * (ratio > 0.3 ? 1 : 0.5);   // a starving maggot grows slowly
      if (a.hunger > 0.82) { this.kill(a, 'starved'); continue; }
      if (a.dev >= FLY.larva) this.pupate(a);
    }
    if (eatenAll > 0) { E.nitrate += eatenAll * FLY.nitrogen; this.world.humus && (this.world.humus.rev++); }

    // --- Pupae: sit still, then adults emerge --------------------------------------------------------
    for (let i = pupae.length - 1; i >= 0; i--) {
      const a = pupae[i];
      if (a.dead) continue;
      const T = a.onWall ? C.tempAt(a.pos.x, a.pos.y, a.pos.z) : T0(C.idx(a.pos.x, a.pos.z));
      a.dev += days * rateOf(T);
      if (T < 8 || T > 38) a.health -= days * 0.5;
      if (a.dev >= FLY.pupa) {
        const p = this.V(a.pos.x, a.pos.y + 0.6, a.pos.z + (a.onWall ? 0.8 : 0));
        A.remove(a, 'emerged');
        const fl = A.add('fly', p, { age: 0.25 * 1440, hunger: 0.3 });
        if (fl) { fl.state = 'rest'; fl.timer = 1 + rand() * 3; this.stats.emerged++; }
      }
    }
    this.summarise();
    this.view?.update(this);
  }

  kill(a, cause) { this.world.animals.remove(a, cause); const d = this.stats.deaths ??= {}; const k = a.sp + ':' + cause; d[k] = (d[k] ?? 0) + 1; }

  // The maggot leaves the litter: a pupa on the background wall if it is near, else stuck to the ground.
  pupate(a) {
    const W = this.world, A = W.animals, T = W.terrain, rand = Math.random;
    const x = a.pos.x, z = a.pos.z, g = T.heightAt(x, z);
    const wz = W.wall.zAt(x, g + 1.5);
    let opt = { age: 0, hunger: 0 };
    A.remove(a, 'pupated');
    let p, onWall = false;
    if (z - wz < 16) {
      const px = x + (rand() - 0.5) * 5, py = Math.max(g, W.water.surfaceAt(x, z) ?? -Infinity, 0) + 1.5 + rand() * 6;
      p = this.V(px, py, W.wall.zAt(px, py) + 0.25);
      onWall = true;
    } else p = this.V(x, g, z);
    const pu = A.add('flypupa', p, opt);
    if (!pu) return;
    pu.dev = 0; pu.yaw = rand() * Math.PI * 2;
    if (onWall) {
      const [gx, gy] = W.wall.field.gradient(p.x, p.y);
      const nv = this.V(-gx, -gy, 1); const l = Math.hypot(nv.x, nv.y, nv.z) || 1;
      pu.normal = this.V(nv.x / l, nv.y / l, nv.z / l);
      pu.onWall = true; pu.wallMode = true;
    } else pu.normal = T.normalAt(x, z);
  }

  summarise() {
    const A = this.world.animals;
    let eggs = 0;
    for (const e of this.eggs) eggs += e.n;
    Object.assign(this.stats, { eggs: Math.round(eggs), larvae: A.by.flylarva?.length ?? 0, pupae: A.by.flypupa?.length ?? 0, adults: A.by.fly?.length ?? 0, fruit: +this.fruitTotal().toFixed(2) });
  }

  // --- Saving ---------------------------------------------------------------------------------------
  serialize() {
    const r = (v) => Math.round(v * 100) / 100;
    return { eggs: this.eggs.map((e) => [r(e.x), r(e.z), r(e.n), r(e.dev), r(e.age)]), fruit: this.fruit.map((f) => [r(f.x), r(f.z), r(f.amt), r(f.age)]) };
  }
  load(o) {
    this.reset();
    if (!o) return;
    const C = this.C;
    for (const [x, z, n, dev, age] of o.eggs ?? []) this.eggs.push({ c: C.idx(x, z), x, z, n, dev, age });
    for (const [x, z, amt, age] of o.fruit ?? []) this.fruit.push({ x, z, amt, age });
    this.rev++;
    this.summarise();
    this.view?.update(this);
  }
}
