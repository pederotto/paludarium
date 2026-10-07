// What a tank's size costs: gear sized for it and the daily running costs (electricity, water and food).
//
// Everything is normalised on the standard tank (90 × 45 × 60 cm, 243 litres): its gear costs the list price in
// content/equipment.js and its running costs are the reference, so a bigger tank costs more and a smaller one less, by
// how real equipment scales. A heater or a filter is rated by the volume it serves, but its price grows more slowly than
// the volume (a filter for four times the water costs about twice as much): the square root of the volume. A light bar
// is as long as the tank is wide. A false bottom or a drainage layer is material over the whole floor, so it scales with
// the floor area. Heat escapes through the glass, so the heater's power follows the surface (volume to the power 2/3).
//
// Plain functions of a tank spec ({ w, d, h }) and, for running costs, of a few environment settings, so the career code
// and the tests use them under Node.

import { GEAR } from './equipment.js';

// Daily running costs (electricity, water, food) are a balance choice the owner has not confirmed: off until he does.
// runningCosts and Career.payBills stay (tested); nothing charges or shows them while this is false.
export const RUNNING_COSTS = false;

export const REF = { w: 90, d: 45, h: 60, litres: 243, floor: 4050 };

const litresOf = (t) => (t.w * t.d * t.h) / 1000;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const round2 = (v) => Math.round(v * 100) / 100;

// How each sizing rule scales with the tank: 1 for the standard tank.
export const SIZE_RULES = {
  litres: (t) => clamp(Math.sqrt(litresOf(t) / REF.litres), 0.4, 2.4),
  width: (t) => clamp(t.w / REF.w, 0.4, 2.2),
  floor: (t) => clamp((t.w * t.d) / REF.floor, 0.25, 3.2),
};

// Which gear is sized for the tank, and by which rule. Instruments, the controller, the feeders and the basking spot lamp
// are the same whatever the tank; starter gear (price 0) comes with the tank.
export const GEAR_SIZING = {
  ledPro: 'width', uvb: 'width',
  fan: 'litres', fogger: 'litres', airpump: 'litres', mister: 'width', chiller: 'litres',
  filterSponge: 'litres', filterMatten: 'litres', filterCanister: 'litres',
  drainageLeca: 'floor', falseBottom: 'floor',
};

// The size factor of a piece of gear for a tank (1 when the gear is not sized).
export function gearScale(id, tank) {
  const rule = GEAR_SIZING[id];
  return rule && tank ? SIZE_RULES[rule](tank) : 1;
}

// The price of a piece of gear sized for a tank, rounded to ¤5 above ¤20 so the shop reads cleanly.
export function gearPrice(id, tank) {
  const g = GEAR[id];
  if (!g) return 0;
  const p = g.price * gearScale(id, tank);
  return p >= 20 ? Math.round(p / 5) * 5 : Math.round(p);
}

// What it costs to resize gear bought for one tank so it serves a bigger one (0 when the new tank is not bigger).
export function upsizeCost(id, from, to) {
  return Math.max(0, gearPrice(id, to) - gearPrice(id, from));
}

// --- Running costs ---------------------------------------------------------------------------------------------------------
// ¤ per day in the standard tank with its gear at full use: a 12-hour day of the LED bar, the heater holding 3 °C over the
// room, the pump and a sponge filter running. Together with food for the starter's animals that is about ¤5 a day.
export const RUN = {
  light: 2, ledPro: 1.25, uvb: 0.3, basking: 0.6,
  heater: 1.2, chiller: 1.5,
  pump: 0.6, filter: { sponge: 0.4, matten: 0.4, canister: 0.9 },
  fan: 0.2, fogger: 0.5, air: 0.15, rain: 0.03,         // rain: per minute of showers a day
  waterPerLitre: { tap: 0.002, soft: 0.012, remin: 0.014, hard: 0.006 },   // about a 40% change a week, per litre of tank water
};

// Food per animal per day, ¤, by how it eats: live food for frogs, lizards and newts costs most; grazers and the crew
// live on what the tank makes.
export function foodPerDay(sp) {
  if (!sp || sp.feeder || sp.young || sp.kind === 'egg' || sp.crew) return 0;
  const eats = sp.eats ?? [];
  if (!eats.length || eats.every((f) => f === 'detritus' || f === 'biofilm')) return 0;
  if (sp.group === 'Amphibians' || sp.group === 'Reptiles') return 0.05;
  if (sp.group === 'Fish') return 0.01;
  return 0.003;
}

// The running costs of a tank per day: { total, parts: [[label, ¤]] } (parts over ¤0.005, biggest first).
//   tank   { w, d, h }
//   E      the settings that use power: lights hours and power, heater and its set point against the room, filter, fans …
//          (sim/env.js fields; only those listed here are read)
//   has    (gearId) => whether that gear is fitted
//   o      { water: litres in the tank, pump: the main pump is running, animals: [[species record, n]] }
export function runningCosts(tank, E, has = () => true, o = {}) {
  const L = litresOf(tank), floor = (tank.w * tank.d) / REF.floor, surface = Math.pow(L / REF.litres, 2 / 3);
  const parts = [];
  const add = (label, v) => { if (v > 0.005) parts.push([label, v]); };
  const hours = E.photoperiod ?? 12;
  add('Lights', RUN.light * floor * (hours / 12) * (E.lampPower ?? 1) * (has('ledPro') ? RUN.ledPro : 1)
    + (has('uvb') && E.uvb > 0 ? RUN.uvb * SIZE_RULES.width(tank) * (hours / 12) : 0)
    + (has('basking') ? RUN.basking * (E.basking ?? 0) * (hours / 12) : 0));
  const lift = Math.max(0, (E.setpoint ?? 24) - (E.room ?? 21));
  add('Heater', E.heater !== false && has('heater') ? RUN.heater * surface * (lift / 3) : 0);
  add('Cooling', E.chill && has('chiller') ? RUN.chiller * surface * Math.max(0.5, ((E.room ?? 21) - (E.coolSet ?? 20)) / 3) : 0);
  const water = o.water ?? 0, sized = SIZE_RULES.litres(tank);
  add('Pump and filter', (o.pump ? RUN.pump * sized : 0) + (E.filter && water > 0.5 ? (RUN.filter[E.filterKind] ?? RUN.filter.sponge) * sized : 0));
  const showers = (E.rainProgram ?? []).reduce((s, r) => s + (r.len ?? 0), 0);
  add('Fans, fog and rain', (has('fan') ? RUN.fan * (E.fan ?? 0) * sized : 0) + (has('fogger') ? RUN.fogger * (E.fogger ?? 0) * sized : 0)
    + (has('mister') ? RUN.rain * showers * SIZE_RULES.width(tank) : 0));
  add('Air pump', has('airpump') ? RUN.air * (E.air ?? 0) * sized : 0);
  add('Water', water * (RUN.waterPerLitre[E.waterSource] ?? RUN.waterPerLitre.tap));
  let food = 0;
  for (const [sp, n] of o.animals ?? []) food += foodPerDay(sp) * n;
  add('Food', food);
  parts.sort((a, b) => b[1] - a[1]);
  return { total: round2(parts.reduce((s, p) => s + p[1], 0)), parts: parts.map(([k, v]) => [k, round2(v)]) };
}

// The same settings for a tank nobody has touched yet (sim/env.js defaults), for comparing tank sizes.
export const DEFAULT_RUN_SETTINGS = { photoperiod: 12, lampPower: 1, heater: true, setpoint: 24, room: 21, filter: true, filterKind: 'sponge', waterSource: 'tap' };

