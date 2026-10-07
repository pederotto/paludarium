// A plain-object snapshot of the tank for the UI, taken a few times a second.

import { SPECIES } from '../sim/animals.js';
import { STAGES } from '../sim/ecology.js';
import { TANK, tankLitres, sizeFactors } from '../sim/tank.js';
import { crowding } from '../game/stocking.js';
import { runningCosts } from '../content/upkeep.js';

// Who lives in this tank and who is crowded for its size (game/stocking.js), for the stocking advice.
export function stockOf(W) {
  const counts = {};
  for (const [id, arr] of Object.entries(W.animals.by)) if (arr.length && id !== 'eggs') counts[id] = arr.length;
  return { counts, ...crowding(counts, SPECIES, sizeFactors()) };
}

// What this tank costs to run per day with its gear as it is set now (content/upkeep.js): { total, parts }.
export function upkeepOf(W) {
  const E = W.env, has = (id) => W.equipment.has(id);
  const animals = Object.entries(W.animals.by).filter(([, a]) => a.length).map(([id, a]) => [SPECIES[id], a.length]);
  return runningCosts(TANK, E, has, { water: W.water.volumeLitres(), pump: !!W.water.hydro.pump.running && W.water.hydro.outlets.length > 0, animals });
}

export function snapshot(game) {
  const W = game.world;
  if (!W) return null;
  const E = W.env;
  const stageId = W.sim.eco.updateStage();
  const stage = STAGES.find((s) => s.id === stageId);
  const census = [];
  for (const [id, sp] of Object.entries(SPECIES)) {
    const arr = W.animals.by[id];
    if (!arr.length) continue;
    const hp = arr.reduce((s, a) => s + a.health, 0) / arr.length;
    const hu = arr.reduce((s, a) => s + a.hunger, 0) / arr.length;
    const counts = {};
    for (const a of arr) for (const w of a.why ?? []) counts[w] = (counts[w] ?? 0) + 1;
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    const morphs = {};
    for (const a of arr) if (a.morph && !a.gsp) morphs[a.morph] = (morphs[a.morph] ?? 0) + 1;
    census.push({ id, name: sp.name, n: arr.length, hp, hunger: hu, why: top, morphs: Object.keys(morphs).length ? morphs : undefined });
  }
  const C = W.climate.mean;
  return {
    t: performance.now(),
    clock: { day: E.day + 1, time: E.clock, light: E.light(), bright: E.bright(), photoperiod: E.photoperiod },
    tank: { id: TANK.id, name: TANK.name, w: TANK.w, d: TANK.d, h: TANK.h, litres: Math.round(tankLitres()), closed: TANK.closed, land: W.landShare() },
    stock: stockOf(W),
    upkeep: upkeepOf(W),
    env: {
      temp: E.temp, humidity: E.humidity, ammonia: E.ammonia, nitrite: E.nitrite, nitrate: E.nitrate, oxygen: E.oxygen, cycle: E.cycle,
      algae: E.algae, diatoms: E.diatoms, detritus: E.detritus, mold: E.mold, soil: E.soil, condense: E.condense, drainage: E.drainage,
      fan: E.fan, fogger: E.fogger, air: E.air, rain: E.rain, basking: E.basking, lampPower: E.lampPower, lampWarmth: E.lampWarmth,
      moonlight: E.moonlight, heater: E.heater, setpoint: E.setpoint, lid: E.lid, filter: E.filter, autoFeed: E.autoFeed, culture: E.culture,
      lights: E.lights, lightsOn: E.lightsOn, lightsOff: E.lightsOff, room: E.room, mediaBio: E.mediaBio, chill: E.chill, coolSet: E.coolSet, tankDays: E.tankDays,
      ph: E.ph, gh: E.gh, flow: E.flow, uvb: E.uvb, filterKind: E.filterKind, waterSource: E.waterSource,
    },
    micro: { humRange: C.humRange, tempRange: C.tempRange, hum: C.hum, temp: C.temp, light: C.light, soil: C.soil },
    stage: { id: stageId, name: stage.name, tip: stage.tip, progress: W.sim.eco.progress() },
    water: { litres: W.water.volumeLitres(), level: W.water.level, pumpOn: W.water.hydro.pump.on, pumpRunning: W.water.hydro.pump.running, outlets: W.water.hydro.outlets.length, pools: W.water.pools.length, falls: W.water.falls.length },
    moss: W.mossFraction(),
    census,
    plants: { n: W.plants.list.length, sick: W.plants.list.filter((p) => p.health < 0.6).length },
    logs: W.logs.slice(0, 14),
  };
}
