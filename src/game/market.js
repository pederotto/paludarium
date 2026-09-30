// Selling animals. Buy prices are fixed (content/economy.js); what people pay
// for your animals moves with demand, which follows a slow, deterministic
// cycle per species (so a good keeper can plan: breed the frogs that are
// about to be in demand).

import { ANIMALS, SELL_CAP } from '../content/economy.js';

const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967296; };

// 0.7 … 1.4: how much the market wants this species on this day.
export function demand(id, day) {
  const g = ANIMALS[id]?.group ?? '';
  const swing = g === 'Amphibians' || g === 'Reptiles' ? 0.32 : 0.2;   // rare things swing more
  const a = hash(id) * 6.283;
  return 1.05 + swing * Math.sin(day / 11 + a) + 0.08 * Math.sin(day / 3.1 + a * 2);
}

export const isSellable = (id) => { const a = ANIMALS[id]; return !!a && a.sellable !== false && a.sold !== false; };

// What a healthy adult fetches; juveniles and unwell animals less.
export function sellPrice(animal, day) {
  const a = ANIMALS[animal.sp];
  if (!isSellable(animal.sp)) return 0;
  const adultDays = a.adult ?? 10;
  const grown = Math.min(1, (animal.age / 1440) / adultDays);
  if (grown < 0.6) return 0;
  const health = Math.max(0, Math.min(1, (animal.health - 0.3) / 0.7));
  const raw = a.price * (a.resale ?? 0.4) * (0.55 + 0.45 * grown) * health * demand(animal.sp, day);
  return Math.max(0, Math.min(Math.round(raw), Math.floor(a.price * SELL_CAP)));
}

// { price, note } for the banner: why it is worth what it is.
export function sellQuote(animal, day) {
  const price = sellPrice(animal, day);
  const d = demand(animal.sp, day);
  const grown = Math.min(1, (animal.age / 1440) / (ANIMALS[animal.sp]?.adult ?? 10));
  let note;
  if (!isSellable(animal.sp)) note = 'Nobody buys these.';
  else if (grown < 0.6) note = 'Too young to sell: buyers want adults.';
  else if (animal.health < 0.6) note = 'Buyers pay less for animals that are not in good health.';
  else note = d > 1.15 ? 'High demand right now.' : d < 0.9 ? 'Demand is low this week.' : 'A fair market.';
  return { price, note };
}
