// The living part: day/night, climate (temperature, humidity), water
// chemistry (the nitrogen cycle, oxygen), food and detritus, and each
// animal's hunger, health, growth, breeding and death. How the tank as a
// whole settles in over weeks is in ecology.js.
//
// The numbers are simplified but follow real husbandry: fish waste becomes
// ammonia; bacteria that colonise a new tank over days turn it into nitrite
// and then nitrate; plants and water changes remove nitrate. Frogs need damp
// air, fish need clean water, and everyone needs food.

import * as THREE from 'three/webgpu';
import { SPECIES, FOOD_VALUE, one } from './animals.js';
import { Ecology } from './ecology.js';
import { Env } from './env.js';
import { Climate } from './climate.js';
import { U } from '../render/uniforms.js';
import { PLANTS } from './plants.js';
import { clamp, lerp } from '../render/geo.js';
import { TANK } from './tank.js';
import { hasGenetics, breed, morphOf, isSurprise, recessiveFromCarriers } from './genetics.js';
import { morphName, morphRarity } from '../content/morphs.js';

export { Env };

export class Sim {
  constructor(world) {
    this.world = world;
    this.env = world.env;
    this.acc = 0;
    this.stats = {};
    this.eco = new Ecology(world);
    this.climate = world.climate;
  }

  // dtMin: game minutes elapsed this frame.
  step(dtMin) {
    const W = this.world, E = this.env;
    if (dtMin <= 0) return;
    // Run in chunks of at most 5 minutes so fast-forward stays stable.
    while (dtMin > 0) {
      const d = Math.min(5, dtMin);
      dtMin -= d;
      this.tick(d);
    }
    W.animals.food = W.animals.food.filter((f) => !f.eaten);
    W.animals.food.forEach((f) => { if (f.settled) f.floorAge = (f.floorAge ?? 0) + 1; });
  }

  tick(d) {
    const W = this.world, E = this.env;
    E.minute += d;
    const light = E.bright();
    E.lightAvg = lerp(E.lightAvg, light, d / 1440);
    const closed = TANK.closed;

    // --- Equipment -----------------------------------------------------
    // Rain: programmed showers and hand-triggered ones. The rain system
    // pumps water from the main pool, so it stops if the pool runs dry.
    const tod = E.minute % 1440;
    let showering = E.minute < E.rainUntil;
    for (const r of E.rainProgram) if (tod >= r.at && tod < r.at + r.len) showering = true;
    if (showering && W.water.level < 1.5 && W.water.volumeLitres() < 2) showering = false;
    E.rain = lerp(E.rain, showering ? 1 : 0, clamp(d / 6, 0, 1));
    if (E.rain < 0.02) E.rain = 0;

    // --- Climate ------------------------------------------------------
    const area = W.water.surfaceArea();
    const floor = TANK.w * TANK.d;
    const waterFrac = clamp(area / floor, 0, 1);
    // Falls wet the air and the water (up to a point); less when the pump stops.
    const falls = Math.min(4, W.water.falls.length) * (W.water.hydro.pump.running ? 1 : 0.3);
    const open = !(E.lid || closed);
    let tTarget = E.room + light * 1.3 + (open ? 0 : 0.8) - E.rain * 1.2 - E.fogger * 0.8 + E.basking * 1.5;
    if (E.heater && tTarget < E.setpoint) tTarget = E.setpoint;
    tTarget = lerp(tTarget, E.room, E.fan * 0.5);
    if (E.chill) tTarget = Math.min(tTarget, E.coolSet);
    E.temp = lerp(E.temp, tTarget, clamp(d * 0.004, 0, 1));
    // Humidity: water, falls, moss and plants add it; an open lid, a fan and a
    // warm tank take it away. Rain and a fogger add a lot.
    let hTarget = 35 + waterFrac * 36 + falls * 3.5 + E.mist * 30 + (open ? -8 : 12) + (closed ? 14 : 0) + W.mossFraction() * 10 + Math.min(8, W.plants.list.length * 0.06)
      + E.rain * 26 + E.fogger * 22;
    hTarget -= Math.max(0, E.temp - 24) * 1.2;
    hTarget = lerp(hTarget, E.roomHumidity, E.fan * 0.55);
    E.humidity = clamp(lerp(E.humidity, clamp(hTarget, 20, 100), clamp(d * 0.01, 0, 1)), 15, 100);
    E.mist = Math.max(0, E.mist - d / 90);
    // Evaporation. A sealed jar loses almost nothing: it condenses and runs back down.
    const evapArea = area * (open ? 1 : 0.4) * (1 + E.fan * 0.8) + E.fogger * 250;
    W.water.hydro.evaporate(d, E.humidity, E.temp, evapArea * (closed ? 0.06 : 1));
    this.climate.step(d, light);
    E.soil = this.climate.mean.soil;
    E.updateGlass(d);
    this.mould(d);

    W.equipment.evaluate();

    // --- Water chemistry ---------------------------------------------
    const litres = Math.max(1, W.water.volumeLitres());
    let waste = 0;
    for (const a of W.animals.all) {
      const sp = SPECIES[a.sp];
      if (sp.kind === 'swim') waste += sp.size * 0.00035;
      else if (sp.kind === 'crawlWater') waste += 0.00006;
      else if (sp.kind === 'toad' || sp.kind === 'crab') waste += 0.0002;
    }
    // Uneaten food and detritus in water rot into ammonia.
    const rotting = E.detritus * 0.0004 * (0.5 + waterFrac);
    // Scaled so ~18 small fish in 20 L make ~0.5 ppm/day in an uncycled tank.
    E.ammonia += ((waste + rotting) * d * 0.25) / litres;
    E.detritus = Math.max(0, E.detritus - rotting * d * 0.4);
    const media = 0.6 + E.mediaBio * 0.9;
    const toNitrite = E.ammonia * clamp(E.cycle * 0.012 * media * d, 0, 0.9);
    E.ammonia -= toNitrite;
    E.nitrite += toNitrite;
    const toNitrate = E.nitrite * clamp(E.cycle * 0.01 * media * d, 0, 0.9);
    E.nitrite -= toNitrate;
    E.nitrate += toNitrate * 2.7;
    // Bacteria colonise a new tank over two to three weeks when they have
    // ammonia to eat, and hardly at all without it.
    E.cycle = clamp(E.cycle + d / (1440 * 16) * (E.ammonia > 0.02 || E.nitrite > 0.02 ? 1 : 0.1), 0, 1);
    // Plants take up nitrate (and a little ammonia).
    const pl = this.plantOut ?? { nitrateUse: 0, shade: 0 };
    const uptake = pl.nitrateUse * 0.004 * d * (0.3 + light) / litres;
    E.nitrate = Math.max(0, E.nitrate - uptake);
    E.ammonia = Math.max(0, E.ammonia - uptake * 0.05);
    // Oxygen: surface exchange, waterfalls and the filter add it; plants
    // add it by day and use it by night; animals breathe it.
    let fishLoad = 0;
    for (const a of W.animals.all) if (SPECIES[a.sp].kind === 'swim' || SPECIES[a.sp].kind === 'crawlWater') fishLoad += SPECIES[a.sp].size;
    const oTarget = 5.2 + falls * 0.9 + (E.filter ? 1.6 : 0) + E.fan * 0.4 + E.rain * 0.5 + (light - 0.4) * pl.nitrateUse * 0.02 - fishLoad * 0.8 / litres - Math.max(0, E.temp - 24) * 0.12;
    E.oxygen = clamp(lerp(E.oxygen, oTarget, clamp(d * 0.01, 0, 1)), 0.5, 10);
    // Biofilm grows with light and nutrients; grazers eat it.
    E.biofilm = clamp(E.biofilm + d * 0.0004 * light * clamp(E.nitrate / 10, 0.2, 1.5), 0, 1);

    // --- Plants ------------------------------------------------------
    const pout = W.plants.step(d, E, W);
    this.plantOut = pout;
    E.detritus += pout.deaths.length * 0.8;
    for (const p of pout.deaths) W.log(`A ${plantName(p.id)} died.`, 'bad');
    for (const p of pout.born) if (Math.random() < 0.3) W.log(`A ${plantName(p.id)} spread and put out a new plant.`, 'good');
    this.eco.step(d, light);

    // --- Auto-feeder: once a day at 10:00 if there are fish.
    if (E.autoFeed && E.day !== E.lastFed && E.minute % 1440 >= 600) {
      E.lastFed = E.day;
      const fish = ['neon', 'guppy', 'cory'].some((id) => W.animals.count(id) > 0);
      if (fish && W.animals.feed()) W.log('Auto-feeder dropped food.');
    }
    // Fruit fly culture: a few flies hatch every other day, if anyone eats them.
    if (E.culture && E.day - E.lastCulture >= 2 && E.minute % 1440 >= 660) {
      E.lastCulture = E.day;
      const hunters = ['dartfrog', 'strawberry', 'toad', 'gecko', 'newt'].some((id) => W.animals.count(id) > 0);
      if (hunters) {
        let n = 0;
        for (let k = 0; k < 8; k++) {
          const p = W.randomSpot((x, y, z, s) => s === -Infinity);
          if (p && W.animals.add('fly', p.setY(p.y + 3))) n++;
        }
        if (n) W.log(`${n} fruit flies hatched from the culture.`);
      }
    }

    // --- Food on the floor rots --------------------------------------
    for (const f of W.animals.food) {
      f.gameAge = (f.gameAge ?? 0) + d;
      if (!f.eaten && f.gameAge > 240) { f.eaten = true; E.detritus += 0.05; }
    }

    // --- Animals -----------------------------------------------------
    this.animals(d, light);
  }

  // Mould: stale, saturated air with something to feed on. Springtails and
  // isopods eat it, a fan starves it, dry air stops it.
  mould(d) {
    const W = this.world, E = this.env;
    const stale = clamp((E.humidity - 90) / 8, 0, 1) * (1 - E.fan) * (E.lid || TANK.closed ? 1 : 0.5);
    const food = clamp(E.detritus / 8, 0, 1) * 0.7 + clamp((E.soil - 0.8) * 5, 0, 1) * 0.6;
    const crew = (W.animals.count('isopod') + W.animals.count('springtail') * 0.25) / 40;
    const rate = stale * food * 0.9 - crew * 0.6 - E.fan * 0.25 - 0.04;
    E.mold = clamp(E.mold + (rate * d) / 1440 * 1.2, 0, 1);
    U.mold.value = E.mold;
    U.condense.value = E.condense;
  }

  animals(d, light) {
    const W = this.world, E = this.env;
    const births = [];
    for (const a of [...W.animals.all]) {
      if (a.dead) continue;
      const sp = SPECIES[a.sp];
      a.age += d;
      a.hunger = clamp(a.hunger + d / (sp.hungerHours * 60), 0, 1);
      // Grazers and scavengers feed from the shared pools.
      if (a.hunger > 0.15) {
        if (sp.eats.includes('detritus') && E.detritus > 0.01) {
          const bite = Math.min(E.detritus, d * 0.0006 * sp.size);
          E.detritus -= bite;
          a.hunger = Math.max(0, a.hunger - bite * 40);
        }
        if (sp.eats.includes('biofilm') && E.biofilm > 0.05) {
          E.biofilm -= d * 0.00002;
          a.hunger = Math.max(0, a.hunger - d * 0.0016);
        }
        if (sp.kind === 'fly' && E.detritus > 0.05) a.hunger = Math.max(0, a.hunger - d * 0.002);
        // At high speed fish may not reach the flakes on screen before they
        // rot, so hungry fish also find food here, a bite at a time.
        if (sp.kind === 'swim' && a.hunger > 0.3 && Math.random() < d / 20) {
          const f = W.animals.food.find((f) => !f.eaten && (!f.settled || sp.band === 'bottom'));
          if (f) { f.eaten = true; a.hunger = Math.max(0, a.hunger - FOOD_VALUE.flake); }
        }
        // Hunters (frogs, newts, axolotls, geckos) also find prey here, so
        // they eat at any simulation speed. The chance grows with how much
        // prey there is.
        if (['frog', 'toad', 'newt', 'axolotl', 'gecko'].includes(sp.kind) && a.hunger > 0.3) {
          for (const pid of sp.eats) {
            const prey = pid === 'flake' ? W.animals.food.filter((f) => !f.eaten) : W.animals.by[pid] ?? [];
            // Refuge: moss and litter hide the last few of any prey species.
            const hidden = pid === 'flake' ? 0 : 6 + Math.round(W.mossFraction() * 20);
            if (prey.length <= hidden || Math.random() > (d / 420) * Math.min(1, (prey.length - hidden) / 10)) continue;
            const p = prey[Math.floor(Math.random() * prey.length)];
            if (pid === 'flake') p.eaten = true; else W.animals.remove(p, `eaten by a ${one(a.sp)}`);
            a.hunger = Math.max(0, a.hunger - (FOOD_VALUE[pid] ?? 0.1));
            break;
          }
        }
        if (sp.eats.includes('flake') && sp.kind !== 'swim') {
          for (const f of W.animals.food) {
            if (!f.eaten && f.settled && f.pos.distanceTo(a.pos) < 3) { f.eaten = true; a.hunger = Math.max(0, a.hunger - FOOD_VALUE.flake); break; }
          }
        }
      }
      // Stress from the environment.
      let stress = 0;
      const why = [];
      const [tmin, tmax] = sp.temp;
      const aquatic = sp.kind === 'swim' || sp.kind === 'crawlWater';
      // Land animals feel the air where they are: warmer under the lamp,
      // damper by the waterfall. (Smoothed so a hop across a boundary doesn't flicker.)
      let T = E.temp, RH = E.humidity;
      if (!aquatic && sp.kind !== 'egg') {
        const C = W.climate;
        a.lt = lerp(a.lt ?? E.temp, C.tempAt(a.pos.x, a.pos.y, a.pos.z), 0.25);
        a.lh = lerp(a.lh ?? E.humidity, C.humidityAt(a.pos.x, a.pos.y, a.pos.z), 0.25);
        T = a.lt; RH = a.lh;
      }
      a.T = T; a.RH = RH;
      if (T < tmin) { stress += (tmin - T) / 4; why.push('too cold'); }
      if (T > tmax) { stress += (T - tmax) / 3; why.push('too hot'); }
      if (aquatic) {
        if (a.stranded) { stress += 6; why.push('out of water'); }
        if (E.ammonia > 0.25) { stress += (E.ammonia - 0.25) * 3; why.push('ammonia'); }
        if (E.nitrite > 0.3) { stress += (E.nitrite - 0.3) * 2.5; why.push('nitrite'); }
        if (E.nitrate > 60) { stress += (E.nitrate - 60) / 40; why.push('nitrate'); }
        if (E.oxygen < 4.5) { stress += (4.5 - E.oxygen) * 0.8; why.push('low oxygen'); }
        if (sp.kind === 'crawlWater' && W.water.surfaceAt(a.pos.x, a.pos.z) < a.pos.y) { stress += 4; why.push('out of water'); }
      } else if (sp.humidity) {
        if (RH < sp.humidity) { stress += (sp.humidity - RH) / 12; why.push('air too dry'); }
        if (E.mold > 0.8 && sp.group === 'Amphibians') { stress += 0.4; why.push('mould'); }
      }
      if (sp.kind === 'toad' && W.water.surfaceArea() < 200) { stress += 0.5; why.push('no water to swim in'); }
      if (sp.kind === 'crab' && W.water.surfaceArea() < 100) { stress += 0.5; why.push('no water'); }
      if (a.hunger > 0.75) { stress += (a.hunger - 0.75) * 4; why.push('hungry'); }
      a.why = why;
      if (stress > 0.05) a.health -= stress * d / (60 * 10);
      else a.health = Math.min(1, a.health + d / (60 * 24));
      // Death.
      // Life cycle: clutches hatch, tadpoles metamorphose.
      if (sp.kind === 'egg') {
        const wetOk = a.where === 'wall' || W.water.surfaceAt(a.pos.x, a.pos.z) > a.pos.y - 1.5;
        if (!wetOk && a.where !== 'shallow') a.health -= d / 600;
        if (a.age >= (a.hatch ?? 7) * 1440) {
          W.animals.remove(a, 'hatched');
        W.stats.hatched++;
          births.push({ hatch: true, sp: a.into ?? 'tadpole', parent: a.parent, n: a.n ?? 4, pos: a.pos.clone(), pg: a.pg, gp: a.gp, gen: a.gen });
          continue;
        }
      }
      if (sp.metamorphDays && a.age >= sp.metamorphDays * 1440 && a.parent && SPECIES[a.parent]) {
        W.animals.remove(a, 'metamorphosed');
        W.stats.metamorphs++;
        births.push({ meta: true, sp: a.parent, pos: a.pos.clone(), genes: a.genes, gen: a.gen, parents: a.parents, mut: a.mut });
        continue;
      }
      const life = sp.lifeDays * 1440;
      if (a.health <= 0 || a.age > life) {
        const cause = a.health <= 0 ? (why[0] ?? 'poor health') : 'old age';
        W.animals.remove(a, cause);
        // Only real losses count for goals and the vacation report: live-food species and old age are the normal cycle.
        if (cause !== 'old age' && a.sp !== 'fly' && a.sp !== 'springtail') { W.stats.deaths++; W.stats.lastDeathMinute = E.minute; }
        E.detritus += sp.size * (sp.kind === 'swim' || sp.kind === 'frog' || sp.kind === 'toad' ? 0.6 : 0.08);
        if (sp.cap < 60 || Math.random() < 0.05) W.log(`A ${one(a.sp)} died (${cause}).`, 'bad');
        continue;
      }
      // Breeding.
      if (sp.breed && a.age > (sp.adultDays ?? 10) * 1440 && a.hunger < 0.5 && a.health > 0.7) {
        const pop = W.animals.count(a.sp) + births.filter((b) => b.sp === a.sp).length;
        const room = 1 - pop / sp.cap;
        // Amphibians need damp air to breed; clutches count toward the limit.
        const damp = !sp.eggs || sp.group !== 'Amphibians' || E.humidity > (sp.humidity ?? 60) + 5;
        const clutches = W.animals.by.eggs.filter((e) => e.parent === a.sp).length * (sp.eggs?.n ?? 0);
        const room2 = room - clutches / sp.cap;
        if (damp && room2 > 0 && Math.random() < sp.breed * (d / 1440) * room2 * (sp.kind === 'crawlWater' ? E.cycle : 1)) {
          // Species with genes need two parents: a marked pair if there is one, else any fit adult.
          const mate = hasGenetics(a.sp) ? W.animals.partnerFor(a) : null;
          if (!hasGenetics(a.sp) || mate) {
            if (sp.eggs) births.push({ lay: true, parent: a.sp, pos: a.pos.clone(), onWall: a.onWall, pa: a, pb: mate });
            else births.push({ sp: a.sp, pos: a.pos.clone(), pa: a, pb: mate });
          }
        }
      }
    }
    for (const b of births) {
      if (!b.lay && !b.hatch && !b.meta) W.stats.births++;
      if (b.lay) this.layEggs(b);
      else if (b.hatch) {
        let n = 0;
        const babies = [];
        for (let k = 0; k < b.n; k++) {
          const p = b.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 0.3, (Math.random() - 0.5) * 2));
          const gene = b.pg ? this.childGenes(b.parent, b.pg[0], b.pg[1]) : null;
          const opt = { age: 0, hunger: 0.3 };
          if (gene) Object.assign(opt, hasGenetics(b.sp) ? { genes: gene.genes } : { genes: gene.genes, gsp: b.parent }, { gen: b.gen ?? 1, parents: b.gp ?? null });
          const c = W.animals.add(b.sp, p, opt);
          if (c) { c.parent = b.parent; n++; if (gene) { c.mut = gene.surprise || undefined; babies.push(gene); } }
        }
        if (n) W.log(`${n} ${b.sp === 'tadpole' ? 'tadpoles' : one(b.sp) + 's'} hatched from a ${one(b.parent)} clutch.`, 'good');
        this.logBabies(b.parent, babies, 'hatched');
      } else if (b.meta) {
        // Climb out: the nearest dry ground.
        const p = W.randomSpot((x, y, z, s) => s === -Infinity && Math.hypot(x - b.pos.x, z - b.pos.z) < 25) ?? b.pos;
        const c = W.animals.add(b.sp, p, { age: 0, hunger: 0.4, genes: b.genes, gen: b.gen ?? 0, parents: b.parents ?? null });
        if (c) { c.mut = b.mut; W.log(`A tadpole turned into a young ${one(b.sp)} and left the water.`, 'good'); }
      } else {
        const gene = b.pa && b.pb ? this.childGenes(b.sp, b.pa.genes, b.pb.genes) : null;
        const opt = { age: 0, hunger: 0.3 };
        if (gene) Object.assign(opt, { genes: gene.genes, gen: Math.max(b.pa.gen ?? 0, b.pb.gen ?? 0) + 1, parents: [b.pa.id, b.pb.id] });
        const child = W.animals.add(b.sp, b.pos, opt);
        if (child && gene) { child.mut = gene.surprise || undefined; this.logBabies(b.sp, [gene], 'was born'); }
        if (child && (SPECIES[b.sp].cap <= 40 || Math.random() < 0.08) && !(gene && (gene.surprise || gene.rare))) W.log(`A ${one(b.sp)} was born.`, 'good');
      }
    }
  }

  // One child of two genotypes (species `id`): its genes, and what it means for the player's counters.
  // Counts babies by morph, mutations ("surprises": a colour its parents could not make) and recessives bred.
  childGenes(id, genesA, genesB) {
    if (!hasGenetics(id) || !genesA || !genesB) return null;
    const S = this.world.stats;
    S.babiesByMorph ??= {}; S.mutations ??= 0; S.recessivesBred ??= 0; S.maxRarityBred ??= 0;
    const genes = breed(id, genesA, genesB);
    const morph = morphOf(id, genes), rarity = morphRarity(id, morph);
    const surprise = isSurprise(id, genesA, genesB, genes);
    const recessive = !surprise && recessiveFromCarriers(id, genesA, genesB, genes);
    const key = `${id}:${morph}`;
    S.babiesByMorph[key] = (S.babiesByMorph[key] ?? 0) + 1;
    if (surprise) S.mutations++;
    if (recessive) S.recessivesBred++;
    if (rarity > S.maxRarityBred) S.maxRarityBred = rarity;
    return { genes, morph, rarity, surprise, recessive, rare: rarity >= 3 };
  }

  // A friendly line for babies worth noticing: rare colours, surprise mutations, hidden genes that showed up.
  logBabies(id, babies, verb) {
    const W = this.world;
    const first = (f) => babies.find(f);
    const s = first((x) => x.surprise);
    if (s) W.log(`Surprise! A baby ${one(id)} (${morphName(id, s.morph)}) came from a mutation: its parents could not make that colour.`, 'good');
    const r = first((x) => x.recessive);
    if (r) W.log(`Two carriers had a baby ${one(id)} that shows the hidden gene: ${morphName(id, r.morph)}!`, 'good');
    const rare = babies.filter((x) => x.rare && !x.surprise).sort((p, q) => q.rarity - p.rarity)[0];
    if (rare && !r) W.log(`Rare colour! A baby ${one(id)} (${morphName(id, rare.morph)}) ${verb}.`, 'good');
  }

  // Put a clutch where this species lays: in the water, at the water's
  // edge, or (geckos) on the background.
  layEggs(b) {
    const W = this.world;
    const sp = SPECIES[b.parent];
    const where = sp.eggs.where;
    let pos = null;
    if (where === 'wall' && b.onWall) pos = b.pos.clone();
    else {
      const test = where === 'water' ? (x, y, z, s) => s - y > 1.5 && s - y < 10
        : where === 'shallow' ? (x, y, z, s) => (s - y > 0 && s - y < 2.5) || (s === -Infinity && W.nearWater(new THREE.Vector3(x, y, z), 3))
        : (x, y, z, s) => s === -Infinity;
      for (let k = 0; k < 200 && !pos; k++) {
        const x = b.pos.x + (Math.random() - 0.5) * 40, z = b.pos.z + (Math.random() - 0.5) * 30;
        if (Math.abs(x) > TANK.w / 2 - 2 || Math.abs(z) > TANK.d / 2 - 2) continue;
        const y = W.terrain.heightAt(x, z), s = W.water.surfaceAt(x, z);
        if (test(x, y, z, s)) pos = new THREE.Vector3(x, y, z);
      }
    }
    if (!pos) return;
    const e = W.animals.add('eggs', pos, { age: 0, hunger: 0 });
    if (!e) return;
    Object.assign(e, { parent: b.parent, into: sp.eggs.into, n: sp.eggs.n, hatch: sp.eggs.days, where });
    // The clutch carries both parents' genotypes; each hatchling draws its own.
    if (b.pa?.genes && b.pb?.genes) {
      e.pg = [[...b.pa.genes], [...b.pb.genes]];
      e.gp = [b.pa.id, b.pb.id];
      e.gen = Math.max(b.pa.gen ?? 0, b.pb.gen ?? 0) + 1;
    }
    if (where === 'wall') { e.onWall = true; e.normal = new THREE.Vector3(0, 0, 1); e.wallMode = true; }
    W.log(`A ${one(b.parent)} laid eggs.`, 'good');
  }
}

function plantName(id) {
  const n = PLANTS[id]?.name ?? id;
  return /^[A-Z][a-z]+ [A-Z]/.test(n) ? n : n.toLowerCase().replace('java', 'Java').replace('amazon', 'Amazon');
}
