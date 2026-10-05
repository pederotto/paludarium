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
import { SPECIES, FOOD_VALUE, one, dietOf, isItem, eatsItem } from './animals.js';
import { Ecology } from './ecology.js';
import { Env } from './env.js';
import { Climate } from './climate.js';
import { FlyLife } from './flylife.js';
import { FruitView } from '../render/fruit.js';
import { U } from '../render/uniforms.js';
import { PLANTS } from './plants.js';
import { clamp, lerp } from '../util/math.js';
import { TANK, tankLitres } from './tank.js';
import { HABITAT } from '../content/habitats.js';
import { filterOf, filterClog, filterEff, substrateOf } from '../content/equipment.js';
import { filterFlow } from './filterflow.js';
import { hasGenetics, breed, morphOf, isSurprise, recessiveFromCarriers } from './genetics.js';
import { morphName, morphRarity } from '../content/morphs.js';
import { stepPlenum } from './plenum.js';

export { Env };

export class Sim {
  constructor(world) {
    this.world = world;
    this.env = world.env;
    this.acc = 0;
    this.stats = {};
    this.eco = new Ecology(world);
    // Fruit fly life cycle: egg, maggot, pupa, adult (flylife.js); its state is saved with the humus.
    this.flies = world.flies = new FlyLife(world, (x, y, z) => new THREE.Vector3(x, y, z));
    if (world.scene) this.flies.view = new FruitView(world.scene);
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
    // Kept per body of water (the main pool, each pond and stream) in
    // sim/waterbodies.js: fish waste and plant uptake in the body they are in,
    // mixing along the pump's flows. env holds the volume-weighted mean.
    // Uneaten food and detritus in water rot into ammonia.
    // The filter: its own pump pushes the main pool's water through the media, which keep a share of the particles: the
    // detritus floating in it here, the silt the water carries in erosion.js (filterK). What it keeps clogs it, a little more
    // every day it runs (fish waste, biofilm), until it is rinsed (Care > Water); the dirt in it still rots into the water.
    // Its flow is its pump's working point against the lift from the cabinet, the media's clog and the hoses (sim/filterflow.js).
    E.filterFlow = filterFlow(E, W.water.level);
    const F = filterOf(E), eff = filterEff(E);
    E.filterLph = E.filterFlow.lph;
    const poolL = Math.max(1, W.water.hydro.resVol / 1000);
    const passed = 1 - Math.exp(-E.filterLph / 60 * d / poolL);
    const caught = E.detritus * 0.02 * passed * F.catch;
    E.detritus -= caught;
    const ero = W.water.erosion;
    if (ero) { E.filterDirt += (ero.caught ?? 0); ero.caught = 0; ero.filterK = E.filterLph / 3600 / poolL * F.catch; }
    E.filterDirt += caught + (E.filter ? F.hold / 60 * d / 1440 : 0);
    const inFilter = E.filterDirt * 0.00005;   // the dirt in the media rots slowly (a sponge needs a rinse every two or three weeks)
    E.filterDirt = Math.max(0, E.filterDirt - inFilter * d * 0.4);
    if (E.filter && filterClog(E) > 0.8 && E.day !== E._clogLogged) { E._clogLogged = E.day; W.log(`The ${F.name.toLowerCase()} is clogged: it passes only ${Math.round(eff * 100)}% of its flow. Rinse it in old tank water (Care > Water).`, 'warn'); }
    const rotting = E.detritus * 0.0004 * (0.5 + waterFrac) + inFilter;
    E.detritus = Math.max(0, E.detritus - (rotting - inFilter) * d * 0.4);
    W.water.bodies.chemistry(d, { SPECIES, PLANTS, light, rotting, waterFrac });
    // Bacteria colonise a new tank over two to three weeks when they have
    // ammonia to eat, and hardly at all without it.
    E.cycle = clamp(E.cycle + d / (1440 * 16) * (E.ammonia > 0.02 || E.nitrite > 0.02 ? 1 : 0.1), 0, 1);
    // Biofilm grows with light and nutrients; grazers eat it.
    E.biofilm = clamp(E.biofilm + d * 0.0004 * light * clamp(E.nitrate / 10, 0.2, 1.5), 0, 1);
    // The false bottom: fitted, its mesh sits just over the water; water over the mesh floods the land (mud), a plenum run
    // dry loses most of its filter bed (waterbodies.js).
    const pl = stepPlenum(W, E, d);   // sim/plenum.js: its own water, drained into from the soil, pumped, open to the pool
    E.plenum = pl;
    E.drainEff = pl?.state === 'mud' ? 0 : E.drainage;
    if (pl?.state === 'mud' && E.day !== E._mudLogged) { E._mudLogged = E.day; W.log('The water is over the false bottom\'s mesh: the soil above is soaking it up and turning to mud. ' + (pl.open ? 'Lower the water or raise the egg-crate.' : 'Siphon it out through the access tower (Care > Foundation).'), 'warn'); }
    // Surface film: a skin of protein and oil on still water (rotting food, detritus). It slows the oxygen the water takes up
    // (waterbodies.js). Current at the surface breaks it; seashore springtails (`film`) graze it off.
    let grazers = 0;
    for (const id in SPECIES) if (SPECIES[id].film) grazers += W.animals.count(id) * SPECIES[id].film;
    const flowNow = E.flow ?? 0.1;   // the filter's current and the pump's turnover (waterbodies.js)
    E.film = clamp((E.film ?? 0) + d * (0.00012 * clamp(E.detritus / 4, 0, 2) - 0.0005 * flowNow - grazers * 0.000012 - (E.film ?? 0) * 0.0002), 0, 1);

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
      const fish = Object.keys(SPECIES).some((id) => SPECIES[id].kind === 'swim' && SPECIES[id].eats.includes('flake') && W.animals.count(id) > 0);
      if (fish && W.animals.feed()) W.log('Auto-feeder dropped food.');
      // Fish that refuse flakes (the pygmy sunfish) get freeze-dried bloodworms from the second chamber.
      const picky = Object.keys(SPECIES).some((id) => SPECIES[id].kind === 'swim' && !SPECIES[id].eats.includes('flake') && SPECIES[id].eats.includes('bloodworm') && W.animals.count(id) > 0);
      if (picky && W.animals.feed('bloodworm')) W.log('Auto-feeder dropped freeze-dried bloodworms.');
    }
    // Fruit fly culture: a few flies hatch every other day, if anyone eats them.
    if (E.culture && E.day - E.lastCulture >= 2 && E.minute % 1440 >= 660) {
      E.lastCulture = E.day;
      const hunters = Object.keys(SPECIES).some((id) => SPECIES[id].eats.includes('fly') && SPECIES[id].kind !== 'crab' && W.animals.count(id) > 0);
      if (hunters) {
        let n = 0;
        for (let k = 0; k < 8; k++) {
          const p = W.randomSpot((x, y, z, s) => s === -Infinity);
          if (p && W.animals.add('fly', p.setY(p.y + 3))) n++;
        }
        // The culture's spent fruit goes in the tank too: a little to lay eggs on and feed the maggots.
        const q = W.randomSpot((x, y, z, s) => s === -Infinity && y > W.water.level + 1);
        if (q && W.flies) W.flies.addFruit(q.x, q.z, 0.9);
        if (n) W.log(`${n} fruit flies hatched from the culture.`);
      }
    }

    // --- Food on the floor rots --------------------------------------
    for (const f of W.animals.food) {
      f.gameAge = (f.gameAge ?? 0) + d;
      if (!f.eaten && f.gameAge > 240) { f.eaten = true; E.detritus += 0.05; if (f.pos) W.humus?.drop(f.pos.x, f.pos.z, 0.05, true); }
    }

    // --- Fruit flies and their maggots, then the animals ------------------
    this.flies.step(d);
    this.animals(d, light);
  }

  // The keeper's-sheet needs (animals.js: ph, gh, flow, uvb, bask, flock, territorial, drowns). Returns extra stress and pushes
  // the reasons. Q: the water body the animal is in (or env). Cheap: a few comparisons per animal per tick.
  careStress(a, sp, Q, aquatic, why, d) {
    const W = this.world, E = this.env;
    let st = 0;
    const g = W.terrain.heightAt(a.pos.x, a.pos.z), surf = W.water.surfaceAt(a.pos.x, a.pos.z);
    const wet = aquatic || surf > a.pos.y + 0.3;
    if (wet && sp.ph) {
      const B = aquatic ? Q : W.water.bodies.at(a.pos.x, a.pos.z) ?? E;
      const ph = B.ph ?? E.ph, gh = B.gh ?? E.gh;
      if (ph < sp.ph[0] - 0.3) { st += (sp.ph[0] - 0.3 - ph) * 0.3 + 0.03; why.push('water too acid'); }
      else if (ph > sp.ph[1] + 0.3) { st += (ph - sp.ph[1] - 0.3) * 0.3 + 0.03; why.push('water too alkaline'); }
      if (sp.gh && gh < sp.gh[0] - 1) { st += (sp.gh[0] - 1 - gh) * 0.02 + 0.02; why.push('water too soft (molting)'); }
      else if (sp.gh && gh > sp.gh[1] + 3) { st += (gh - sp.gh[1] - 3) * 0.015 + 0.02; why.push('water too hard'); }
      const fl = B.flow ?? E.flow;
      if (sp.flow != null && fl > sp.flow + 0.12) { st += (fl - sp.flow - 0.12) * 0.5 + 0.02; why.push('current too strong'); }
    }
    // Without UVB the trouble (soft bones) builds over weeks; without a warm spot, digestion slows over days.
    // Both are what the animal itself gets where it sits, averaged over days: UVB under the tube and out of the leaves' shade
    // (Climate.uvbAt), warmth an hour or more a day at its warm-spot temperature.
    if (sp.uvb) {
      const ix = E.uvb > 0 ? W.climate.uvbAt(a.pos.x, a.pos.y, a.pos.z) * E.light() : 0;
      a.uvb = ix;
      a.uvAvg = lerp(a.uvAvg ?? sp.uvb * 0.1, ix, clamp(d / (1440 * 3), 0, 1));
    }
    a.noUvb = sp.uvb && a.uvAvg < sp.uvb * 0.06 ? (a.noUvb ?? 0) + d : Math.max(0, (a.noUvb ?? 0) - d * 2);
    const uvWhy = E.uvb > 0 ? 'not getting UVB (the tube is out of reach or shaded)' : 'no UVB light';
    if (a.noUvb > 1440 * 14) { st += 0.06; why.push(uvWhy + ': weak bones'); } else if (a.noUvb > 1440) why.push(uvWhy);
    if (sp.bask) a.baskAvg = lerp(a.baskAvg ?? 0.1, (a.lt ?? E.temp) >= sp.bask - 1.5 ? 1 : 0, clamp(d / (1440 * 2), 0, 1));
    a.noBask = sp.bask && a.baskAvg < 1 / 48 ? (a.noBask ?? 0) + d : Math.max(0, (a.noBask ?? 0) - d * 2);
    if (a.noBask > 1440 * 3) { st += 0.04; why.push(this.warmSpot < sp.bask - 1.5 ? 'no warm spot to bask' : 'not basking (the warm spot is out of reach)'); }
    st += this.tankRules(a, sp, why);
    if (sp.flock) {
      const n = W.animals.count(a.sp);
      if (n < sp.flock[0] && sp.flock[0] > 1) { st += 0.06 * (1 - n / sp.flock[0]); why.push(`lonely: keep ${sp.flock[0]} or more`); }
      else if (n > sp.flock[1]) { st += 0.06; why.push('too many of its kind'); }
    }
    if (sp.territorial && a.age > (sp.adultDays ?? 10) * 1440) {
      a.male ??= Math.random() < 0.5;
      if (a.male && W.animals.by[a.sp].some((b) => b !== a && b.male && b.age > (sp.adultDays ?? 10) * 1440)) { st += 0.08; why.push('rival male'); }
    }
    // Poor swimmers drown in water deeper than they can stand in (content/habitats.js maxDepth) when they cannot get out.
    if (sp.drowns) {
      const maxD = HABITAT[a.sp]?.maxDepth ?? 1;
      if (surf - g > maxD + 0.3 && surf > a.pos.y && !a.sunk?.exit) { a.under = (a.under ?? 0) + d; if (a.under > 15) { st += 4; why.push('drowning: the water is too deep'); } }
      else a.under = 0;
      // Isopods tumble in at steep banks as they walk (Animals.slipsIn) and climb out by a slope or a ramp of rock, wood or
      // bark; one with no way out stays under and drowns.
      if (a.sunk && a.under > 15) why.unshift('drowned: fell in at a steep bank with no ramp out');
    }
    return st;
  }

  // The tank's shape against the keeper's sheet: litres and height (minL, minH) and the share of land (land). Mild: a cramped
  // or mostly-wrong tank is a slow stress, not a killer.
  tankRules(a, sp, why) {
    let st = 0;
    if (sp.minL && tankLitres() < sp.minL * 0.8) { st += 0.03; why.push(`tank too small (wants ${sp.minL} litres or more)`); }
    if (sp.minH && TANK.h < sp.minH * 0.85) { st += 0.02; why.push(`tank too low (wants ${sp.minH} cm of height to climb)`); }
    if (sp.land != null) {
      const share = this.world.landShare(), off = share - sp.land;
      if (Math.abs(off) > 0.3) { st += 0.02; why.push(off > 0 ? `too little water (wants about ${Math.round((1 - sp.land) * 100)}%)` : `too little land (wants about ${Math.round(sp.land * 100)}%)`); }
    }
    return st;
  }

  // Mould: stale, saturated air with something to feed on. Springtails and
  // isopods eat it, a fan starves it, dry air stops it.
  mould(d) {
    const W = this.world, E = this.env;
    const stale = clamp((E.humidity - 90) / 8, 0, 1) * (1 - E.fan) * (E.lid || TANK.closed ? 1 : 0.5);
    const food = clamp(E.detritus / 8, 0, 1) * 0.7 + clamp((E.soil - 0.8) * 5, 0, 1) * 0.6 * substrateOf(E).mould;
    let crew = 0;
    for (const id in SPECIES) if (SPECIES[id].crew) crew += W.animals.count(id) * SPECIES[id].crew;   // isopods 1, springtails 0.25 … (animals.js `crew`)
    crew /= 40;
    const rate = stale * food * 0.9 - crew * 0.6 - E.fan * 0.25 - 0.04;
    E.mold = clamp(E.mold + (rate * d) / 1440 * 1.2 * (rate > 0 ? W.realism?.mould ?? 1 : 1), 0, 1);
    U.mold.value = E.mold;
    U.condense.value = E.condense;
  }

  animals(d, light) {
    const W = this.world, E = this.env;
    const births = [];
    // The warmest spot in the tank (the basking lamp's patch), for animals that need a warm spot (`bask`).
    let warm = -99;
    for (const t of W.climate.temp) if (t > warm) warm = t;
    this.warmSpot = warm;
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
          const f = W.animals.food.find((f) => !f.eaten && (!f.settled || sp.band === 'bottom') && eatsItem(sp, f));
          if (f) { f.eaten = true; a.hunger = Math.max(0, a.hunger - FOOD_VALUE[f.kind ?? 'flake']); }
        }
        // Hunters (frogs, newts, axolotls, geckos) also find prey here, so
        // they eat at any simulation speed. The chance grows with how much
        // prey there is.
        if (['frog', 'toad', 'newt', 'axolotl', 'gecko', 'skink'].includes(sp.kind) && a.hunger > 0.3) {
          for (const pid of dietOf(sp)) {
            const prey = isItem(pid) ? W.animals.food.filter((f) => !f.eaten && (f.kind ?? 'flake') === pid) : W.animals.by[pid] ?? [];
            // Refuge: moss and litter hide the last few of any prey species (not a cup of feeders, which do not breed).
            const hidden = isItem(pid) || SPECIES[pid]?.feeder ? 0 : 6 + Math.round(W.mossFraction() * 20);
            if (prey.length <= hidden || Math.random() > (d / 420) * Math.min(1, (prey.length - hidden) / 10)) continue;
            // The meal is due. The animal hunts a prey near it (animals.js: stalk, strike, swallow) and eats when it
            // strikes; if it cannot by the deadline (always at high speed) it eats at once, as it always did.
            if (W.animals.order(a, pid)) break;
            const p = prey[Math.floor(Math.random() * prey.length)];
            if (isItem(pid)) p.eaten = true; else W.animals.remove(p, `eaten by a ${one(a.sp)}`);
            a.hunger = Math.max(0, a.hunger - (FOOD_VALUE[pid] ?? 0.1));
            break;
          }
        }
        if (sp.kind !== 'swim' && dietOf(sp).some(isItem)) {
          for (const f of W.animals.food) {
            if (!f.eaten && f.settled && eatsItem(sp, f) && f.pos.distanceTo(a.pos) < 3) { f.eaten = true; a.hunger = Math.max(0, a.hunger - FOOD_VALUE[f.kind ?? 'flake']); break; }
          }
        }
      }
      // Micro-predators (the pygmy sunfish) pick off young shrimp: it keeps a shrimp colony in check, it does not wipe it out.
      if (sp.kind === 'swim' && a.hunger > 0.25 && Math.random() < d / 900) {
        for (const pid of sp.eats) {
          const young = (W.animals.by[pid] ?? []).filter((b) => b.age < (SPECIES[pid]?.adultDays ?? 10) * 1440 * 0.5);
          if (!young.length) continue;
          W.animals.remove(young[Math.floor(Math.random() * young.length)], `eaten by a ${one(a.sp)}`);
          a.hunger = Math.max(0, a.hunger - 0.15);
          break;
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
      // Fish feel the water of the pond they are in (see sim/waterbodies.js).
      const Q = aquatic ? W.water.bodies.at(a.pos.x, a.pos.z) ?? E : E;
      if (aquatic) T = Q.temp ?? E.temp;
      a.T = T; a.RH = RH;
      if (T < tmin) { stress += (tmin - T) / 4; why.push('too cold'); }
      if (T > tmax) { stress += (T - tmax) / 3; why.push('too hot'); }
      if (aquatic) {
        if (a.stranded) { stress += 6; why.push('out of water'); }
        if (Q.ammonia > 0.25) { stress += (Q.ammonia - 0.25) * 3; why.push('ammonia'); }
        if (Q.nitrite > 0.3) { stress += (Q.nitrite - 0.3) * 2.5; why.push('nitrite'); }
        if (Q.nitrate > 60) { stress += (Q.nitrate - 60) / 40; why.push('nitrate'); }
        if (Q.oxygen < 4.5) { stress += (4.5 - Q.oxygen) * 0.8; why.push('low oxygen'); }
        if (sp.kind === 'crawlWater' && W.water.surfaceAt(a.pos.x, a.pos.z) < a.pos.y) { stress += 4; why.push('out of water'); }
      } else if (sp.humidity) {
        if (RH < sp.humidity) { stress += (sp.humidity - RH) / 12; why.push('air too dry'); }
        if (E.mold > 0.8 && sp.group === 'Amphibians') { stress += 0.4; why.push('mould'); }
      }
      if (sp.kind === 'toad' && W.water.surfaceArea() < 200) { stress += 0.5; why.push('no water to swim in'); }
      if (sp.kind === 'crab' && W.water.surfaceArea() < 100) { stress += 0.5; why.push('no water'); }
      if (sp.crabProfile?.aquatic && W.water.level < 8) { stress += 0.4; why.push('water too shallow'); }
      stress += this.careStress(a, sp, Q, aquatic, why, d);
      if (a.hunger > 0.75) { stress += (a.hunger - 0.75) * 4; why.push('hungry'); }
      a.why = why;
      if (stress > 0.05) a.health -= stress * d / (60 * 10) * (W.realism?.harm ?? 1);
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
        births.push({ meta: true, sp: a.parent, from: a.sp, pos: a.pos.clone(), genes: a.genes, gen: a.gen, parents: a.parents, mut: a.mut });
        continue;
      }
      const life = sp.lifeDays * 1440;
      // Explorer mode (modes.js): each animal is pulled back from the brink once, with a warning in the journal.
      if (a.health <= 0 && a.age <= life && W.realism?.mercy && !a._mercy && a.sp !== 'fly' && a.sp !== 'springtail' && !sp.feeder) {
        a._mercy = 1; a.health = 0.2;
        W.log(`A ${one(a.sp)} was close to death (${why[0] ?? 'poor health'}) and has just recovered. Fix that soon.`, 'warn');
      }
      if (a.health <= 0 || a.age > life) {
        const cause = a.health <= 0 ? (why[0] ?? 'poor health') : 'old age';
        W.animals.remove(a, cause);
        // Only real losses count for goals and the vacation report: live-food species and old age are the normal cycle.
        if (cause !== 'old age' && a.sp !== 'fly' && a.sp !== 'springtail' && a.sp !== 'flylarva' && a.sp !== 'flypupa' && !sp.feeder) { W.stats.deaths++; W.stats.lastDeathMinute = E.minute; }
        E.detritus += sp.size * (sp.kind === 'swim' || sp.kind === 'frog' || sp.kind === 'toad' ? 0.6 : 0.08);
        W.humus?.drop(a.pos.x, a.pos.z, sp.size * 0.2, true);   // a dead animal on land becomes litter
        if (a.sp === 'flylarva' || a.sp === 'flypupa' || sp.feeder) continue;   // the normal toll of a boom and bust, uneaten feeders
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
        const suck = (sp.kind === 'crawlWater' || sp.kind === 'swim') && E.filter ? filterOf(E).suction * (E.prefilter ? 0.08 : 1) : 0;   // a canister intake takes babies
        if (damp && room2 > 0 && Math.random() < sp.breed * (d / 1440) * room2 * (sp.kind === 'crawlWater' ? E.cycle : 1) * (1 - suck * 0.7) * ((a.courtedUntil ?? 0) > E.minute ? 2.5 : 1)) {   // (a courted pair breeds more readily: sim/herp.js)
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
        if (n) W.log(`${n} ${b.sp === 'tadpole' ? 'tadpoles' : b.sp === 'larva' ? 'salamander larvae' : one(b.sp) + 's'} hatched from a ${one(b.parent)} clutch.`, 'good');
        this.logBabies(b.parent, babies, 'hatched');
      } else if (b.meta) {
        // Climb out: the nearest dry ground.
        const p = W.randomSpot((x, y, z, s) => s === -Infinity && Math.hypot(x - b.pos.x, z - b.pos.z) < 25) ?? b.pos;
        const c = W.animals.add(b.sp, p, { age: 0, hunger: 0.4, genes: b.genes, gen: b.gen ?? 0, parents: b.parents ?? null });
        if (c) { c.mut = b.mut; W.log(`A ${b.from === 'larva' ? 'larva' : 'tadpole'} turned into a young ${one(b.sp)} and left the water.`, 'good'); }
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
