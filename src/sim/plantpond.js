// What a plant makes of the water it stands in. Pure arithmetic (no scene), so
// the tests run it under Node.
//
// Submerged and floating plants live in one body of water (a pond, a stream,
// the main pool) and read *its* chemistry, not the tank-wide mean: a planted
// shallow pond is lush while a loaded fish pond burns them. Emergent plants
// stand at the waterline and reach into the nearest body with their roots.
// Land plants do not read water at all: they use the fertility of the soil
// (sim/humus.js).

import { clamp } from '../util/math.js';

// How big a plant's appetite is, in units (a full-grown plant of normal size is 1).
export function plantUnits(p, hab) {
  const size = p.grown * p.scale;
  return size * (hab === 'floating' ? 1.6 : hab === 'emergent' ? 0.35 : 1);
}

// Condition of a submerged or floating plant in water `B` (a body: ammonia,
// nitrite, nitrate, oxygen, co2 in mg/L). Returns { ok: 0 … 1.2, boost, why[] }.
//   ok     multiplies the other limits (light, ...)
//   boost  extra growth when the water is rich
export function waterCondition(sp, B) {
  const why = [];
  const need = Math.max(0.3, sp.nutrients ?? 1) * 6;
  // Ammonia is plant food too (up to the point where it burns).
  const food = (B.nitrate + 3 + Math.min(B.ammonia, 1) * 10) / need;
  let ok = clamp(food, 0.55, 1) * 1.2;
  const co2 = B.co2 ?? 4;
  if (co2 < 2) { ok *= 0.85 + co2 * 0.075; why.push('short of CO2'); }
  if (B.ammonia > 1) { ok *= Math.max(0.2, 1 - (B.ammonia - 1) * 0.6); why.push('ammonia burns the leaves'); }
  if (B.nitrite > 2) { ok *= 0.85; why.push('nitrite'); }
  if (B.oxygen < 2) { ok *= 0.6; why.push('no oxygen at the roots'); }
  const boost = clamp((B.nitrate - 5) / 40, 0, 0.25) + clamp(co2 / 10 - 0.4, 0, 0.1);
  return { ok, boost, why };
}

// Emergent plants take a modest share from the nearest body: a rich pond feeds growth a little.
export function emergentBoost(B) {
  return clamp((B.nitrate + B.ammonia * 8) / 60, 0, 0.3);
}
