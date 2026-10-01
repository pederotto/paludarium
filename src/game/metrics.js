// A plain-object snapshot of a tank for goals, achievements and the curator.
// Cheap enough to call once a second. Everything a commission can ask about
// is a field here, so goals stay one-liners.

import { SPECIES } from '../sim/animals.js';
import { PLANTS } from '../sim/plants.js';
import { STAGES } from '../sim/ecology.js';
import { TANK } from '../sim/tank.js';
import { hasGenetics } from '../sim/genetics.js';
import { morphRarity } from '../content/morphs.js';

const WOOD = ['wood', 'roots', 'stump'];
const STONE = ['boulder', 'spire', 'cliff'];
const AQUATIC = ['aquatic', 'floating', 'emergent'];
const clamp01 = (v) => Math.max(0, Math.min(1, v));

export function computeMetrics(world) {
  const W = world, E = W.env, C = W.climate;
  const H = W.water.hydro;

  // Animals.
  const byId = {}, healthyById = {}, byGroup = {};
  let total = 0, adults = 0, juveniles = 0, healthy = 0;
  const stress = [];
  for (const [id, arr] of Object.entries(W.animals.by)) {
    const sp = SPECIES[id];
    if (!arr.length || id === 'eggs') continue;
    byId[id] = arr.length;
    const ok = arr.filter((a) => a.health > 0.6).length;
    healthyById[id] = ok;
    byGroup[sp.group] = (byGroup[sp.group] ?? 0) + arr.length;
    total += arr.length; healthy += ok;
    for (const a of arr) (a.age / 1440 >= (sp.adultDays ?? 10) ? adults++ : juveniles++);
    const why = {};
    for (const a of arr) for (const w of a.why ?? []) why[w] = (why[w] ?? 0) + 1;
    const top = Object.entries(why).sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] >= Math.max(1, arr.length * 0.3)) stress.push({ species: id, reason: top[0], n: top[1] });
  }
  const frogs = (byId.dartfrog ?? 0) + (byId.strawberry ?? 0) + (byId.leucomelas ?? 0) + (byId.auratus ?? 0);
  const healthyFrogs = (healthyById.dartfrog ?? 0) + (healthyById.strawberry ?? 0) + (healthyById.leucomelas ?? 0) + (healthyById.auratus ?? 0);
  const species = Object.keys(byId).filter((id) => !SPECIES[id].young).length;

  // Genetics: healthy animals by 'species:morph', those born in this tank (generation 1 or later), and what has been bred so far.
  const morphs = {}, bredMorphs = {};
  let bredRarity = W.stats.maxRarityBred ?? 0;
  for (const a of W.animals.all) {
    if (!a.morph || !hasGenetics(a.sp) || a.health <= 0.6) continue;
    const k = `${a.sp}:${a.morph}`;
    morphs[k] = (morphs[k] ?? 0) + 1;
    if ((a.gen ?? 0) >= 1) { bredMorphs[k] = (bredMorphs[k] ?? 0) + 1; bredRarity = Math.max(bredRarity, morphRarity(a.sp, a.morph)); }
  }

  // Plants.
  const pById = {}; let wallPlants = 0, healthyPlants = 0, waterPlants = 0;
  const heights = { low: 0, mid: 0, tall: 0 };
  for (const p of W.plants.list) {
    pById[p.id] = (pById[p.id] ?? 0) + 1;
    if (p.surface === 'wall') wallPlants++;
    if (p.health > 0.6) healthyPlants++;
    const hab = PLANTS[p.id].habitat.split('|')[0];
    if (AQUATIC.includes(hab)) waterPlants++;
    const y = p.pos.y;
    (p.surface === 'wall' || y > TANK.h * 0.55 ? heights.tall++ : y > TANK.h * 0.3 ? heights.mid++ : heights.low++);
  }

  // Hardscape.
  const counts = {};
  for (const p of W.decor.pieces) counts[p.type] = (counts[p.type] ?? 0) + 1;
  const wood = WOOD.reduce((s, t) => s + (counts[t] ?? 0), 0);
  const stone = STONE.reduce((s, t) => s + (counts[t] ?? 0), 0);

  // Water: a stream is water moving outside the main pool.
  let streamCells = 0;
  for (let n = 0; n < H.N; n++) if (!H.res[n] && H.d[n] > 0.05 && (Math.abs(H.vx[n]) + Math.abs(H.vz[n]) > 0.5)) streamCells++;
  const falls = W.water.falls.length;
  const pools = W.water.pools.length;
  const litres = W.water.volumeLitres();
  const mossPct = W.mossFraction() * 100;
  const cycled = E.cycle > 0.85 && E.ammonia < 0.1 && E.nitrite < 0.1;
  const waterQuality = clamp01(1 - (E.ammonia / 0.6 + E.nitrite / 0.8 + Math.max(0, E.nitrate - 40) / 80));

  // Deaths since a while ago (uses the world's counters).
  const daysSinceDeath = Math.max(0, (E.minute - W.stats.lastDeathMinute) / 1440);

  const m = {
    day: E.day + 1, tankDays: E.tankDays, stage: W.sim.eco.stage, stageName: STAGES.find((s) => s.id === W.sim.eco.stage)?.name,
    temp: E.temp, humidity: E.humidity, humRange: C.mean.humRange ?? [E.humidity, E.humidity], tempRange: C.mean.tempRange ?? [E.temp, E.temp],
    roomTemp: E.room, ammonia: E.ammonia, nitrite: E.nitrite, nitrate: E.nitrate, oxygen: E.oxygen, cycle: E.cycle, algae: E.algae,
    mold: E.mold, soil: E.soil, condense: E.condense, photoperiod: E.photoperiod, light: E.bright(),
    litres, waterLevel: W.water.level, pools, falls, outlets: H.outlets.length, pumpRunning: H.pump.running, streamCells,
    mossPct, waterQuality, cycled,
    plants: { total: W.plants.list.length, healthy: healthyPlants, species: Object.keys(pById).length, byId: pById, water: waterPlants, heights },
    animals: { total, healthy, species, byId, healthyById, byGroup, adults, juveniles, frogs, healthyFrogs },
    genetics: { morphs, bred: bredMorphs, maxBredRarity: bredRarity, mutations: W.stats.mutations ?? 0, recessivesBred: W.stats.recessivesBred ?? 0, babiesByMorph: { ...(W.stats.babiesByMorph ?? {}) } },
    hardscape: { pieces: W.decor.pieces.length, stone, wood, spires: counts.spire ?? 0, byType: counts },
    wall: { plants: wallPlants },
    equipment: { fan: E.fan, fogger: E.fogger, basking: E.basking, drainage: E.drainage, rules: W.equipment.rules.length, rainProgram: E.rainProgram.length, rain: E.rain, lampPower: E.lampPower },
    stress, deaths: W.stats.deaths, births: W.stats.births, metamorphs: W.stats.metamorphs, daysSinceDeath, size: { w: TANK.w, d: TANK.d, h: TANK.h, closed: TANK.closed },
  };

  // Feature flags used by the biotopes (content/biotopes.js `features`).
  m.features = {
    bromeliad2: (pById.bromeliad ?? 0) >= 2, bromeliad3: (pById.bromeliad ?? 0) >= 3,
    leaflitter: mossPct >= 8, shallowpool: pools >= 1 || (litres > 1 && W.water.level < 6),
    moss15: mossPct >= 15, stream: streamCells >= 8 || (falls >= 1 && H.outlets.length >= 1), wood: wood >= 1, deep: W.water.level >= 10,
    cycled, falls: falls >= 1, oxygen: E.oxygen >= 7, stones: stone >= 3, cool: E.temp <= 22, tall4: heights.tall >= 4,
    basking: E.basking > 0,
  };
  return m;
}
