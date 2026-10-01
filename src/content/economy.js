// Career economy: what everything costs, when it unlocks and how it arrives.
//
// Plain id-keyed tables with no imports from the simulation, so the career
// code runs (and is unit tested) under plain Node. Gear and tank prices and
// unlock ranks are NOT repeated here: they live with the items in
// equipment.js and tanks.js (`price`, `level`, `owned`) and `entry()` reads
// them from there. tests/career.test.mjs and the browser check in the
// report make sure every species, plant and piece id in the simulation has a
// row here, and no row is left over.
//
// Money is the coin symbol ¤. Prices are per unit (one animal, one plant, one
// piece); buying several at once gets a small bulk discount (`bulkFactor`).
// Keep buy prices stable: only selling fluctuates (see game/market.js).
//
//   rank      career rank needed to buy it (see levels.js)
//   price     per unit, in ¤
//   batch     how many the tool releases per click (mirrors tools/defs.js BATCH)
//   resale    fraction of the price a healthy adult sells for on an average day
//   sold      false: never on sale (tadpoles and egg clutches come from breeding)
//   sellable  false: nobody buys it (cultures, pest snails, young)
//   source    where it comes from, which sets how stressed it arrives (SOURCES)
//   adult     days to reach adulthood (mirrors sim/animals.js adultDays)
//   group     species group (mirrors sim/animals.js), sets how much demand swings
//   frog      counts for the Frog Parent achievements
//
// Colour morphs (content/morphs.js) multiply the price: buying a chosen morph costs `price × morphFactor(id, morph)`,
// and a bred animal of that morph sells for the same factor more (see game/market.js).

import { GEAR } from './equipment.js';
import { TANKS } from './tanks.js';
import { morphFactor } from './morphs.js';

export { morphFactor };

export const START_FUNDS = 350;

// The career always starts with a finished jar (its build cost is ¤0).
export const START_TANK = 'jar';

// ---------------------------------------------------------------------------
// Animals. Rank order follows the biotopes: cleanup crew, then fish, then
// frogs, then the rarer species.

export const ANIMALS = {
  // Cleanup crew and live food: sold as cultures, so cheap per animal.
  springtail: { name: 'Springtails', price: 0.3, rank: 1, batch: 20, source: 'captive', sellable: false, adult: 5, group: 'Insects' },
  isopod: { name: 'Dwarf isopods', price: 0.7, rank: 1, batch: 10, source: 'captive', sellable: false, adult: 12, group: 'Crustaceans' },
  fly: { name: 'Fruit flies', price: 0.4, rank: 3, batch: 10, source: 'captive', sellable: false, adult: 2, group: 'Insects' },
  // The fruit fly's young come from its own life cycle (sim/flylife.js): never bought or sold.
  flylarva: { name: 'Fruit fly maggots', price: 0, rank: 1, sold: false, sellable: false, source: 'captive', adult: 4.5, group: 'Insects' },
  flypupa: { name: 'Fruit fly pupae', price: 0, rank: 1, sold: false, sellable: false, source: 'captive', adult: 0.2, group: 'Insects' },
  // Fish and other aquarium life.
  neon: { name: 'Neon tetra', price: 3, rank: 2, batch: 6, resale: 0.4, source: 'shop', adult: 10, group: 'Fish' },
  guppy: { name: 'Guppy', price: 2, rank: 2, batch: 3, resale: 0.4, source: 'captive', adult: 8, group: 'Fish' },
  shrimp: { name: 'Cherry shrimp', price: 3, rank: 2, batch: 5, resale: 0.4, source: 'captive', adult: 20, group: 'Crustaceans' },
  snail: { name: 'Trumpet snail', price: 2, rank: 2, source: 'captive', sellable: false, adult: 14, group: 'Molluscs' },
  loach: { name: 'Clown loach', price: 22, rank: 5, batch: 2, resale: 0.4, source: 'shop', adult: 30, group: 'Fish' },
  cory: { name: 'Corydoras', price: 6, rank: 3, batch: 3, resale: 0.4, source: 'shop', adult: 10, group: 'Fish' },
  ember: { name: 'Ember tetra', price: 4, rank: 3, batch: 8, resale: 0.4, source: 'shop', adult: 10, group: 'Fish' },
  betta: { name: 'Betta', price: 10, rank: 3, resale: 0.4, source: 'captive', adult: 40, group: 'Fish' },
  cardinal: { name: 'Cardinal tetra', price: 5, rank: 4, batch: 6, resale: 0.4, source: 'wild', adult: 10, group: 'Fish' },
  oto: { name: 'Otocinclus', price: 6, rank: 4, resale: 0.35, source: 'wild', adult: 10, group: 'Fish' },
  // Poison frogs, geckos, toads, newts and the axolotl.
  leucomelas: { name: 'Yellow-banded poison frog', price: 55, rank: 4, resale: 0.5, source: 'captive', adult: 25, group: 'Amphibians', frog: true },
  dartfrog: { name: 'Blue dart frog', price: 70, rank: 4, resale: 0.55, source: 'captive', adult: 25, group: 'Amphibians', frog: true },
  auratus: { name: 'Green and black poison frog', price: 60, rank: 5, resale: 0.5, source: 'captive', adult: 25, group: 'Amphibians', frog: true },
  strawberry: { name: 'Strawberry dart frog', price: 90, rank: 5, resale: 0.58, source: 'captive', adult: 25, group: 'Amphibians', frog: true },
  gecko: { name: 'Mourning gecko', price: 25, rank: 5, resale: 0.45, source: 'captive', adult: 25, group: 'Reptiles' },
  crab: { name: 'Vampire crab', price: 15, rank: 5, resale: 0.4, source: 'wild', adult: 10, group: 'Crustaceans' },
  toad: { name: 'Fire-bellied toad', price: 20, rank: 6, resale: 0.4, source: 'captive', adult: 30, group: 'Amphibians', frog: true },
  firesal: { name: 'Fire salamander', price: 60, rank: 8, resale: 0.45, source: 'wild', adult: 40, group: 'Amphibians' },
  newt: { name: 'Paddle-tail newt', price: 35, rank: 7, resale: 0.45, source: 'wild', adult: 30, group: 'Amphibians' },
  axolotl: { name: 'Axolotl', price: 60, rank: 8, resale: 0.5, source: 'captive', adult: 30, group: 'Amphibians' },
  // Young stock: raised, never bought.
  tadpole: { name: 'Tadpoles', price: 0, rank: 1, sold: false, sellable: false, source: 'captive', adult: 10, group: 'Amphibians' },
  eggs: { name: 'Egg clutches', price: 0, rank: 1, sold: false, sellable: false, source: 'captive', adult: 10, group: 'Amphibians' },
};

// How stressed a newcomer arrives (Animals.add options). Captive-bred stock
// is healthy; shop stock has had a stressful trip; wild-caught is worst.
export const SOURCES = {
  captive: { health: 1, hunger: 0.2, label: 'captive-bred' },
  shop: { health: 0.92, hunger: 0.3, label: 'shop-bought' },
  wild: { health: 0.82, hunger: 0.4, label: 'wild-caught' },
};

// ---------------------------------------------------------------------------
// Plants. `hidden` ones are not in the shop (kept so every sim id has a row).

export const PLANTS = {
  grass: { name: 'Grass tuft', price: 2, rank: 1 },
  weed: { name: 'Creeping jenny', price: 3, rank: 1 },
  pothos: { name: 'Creeping fig', price: 4, rank: 1 },
  fern: { name: 'Fern', price: 5, rank: 1 },
  oldfern: { name: 'Fern (low-poly)', price: 5, rank: 1, hidden: true },
  vallisneria: { name: 'Vallisneria', price: 5, rank: 2 },
  cattail: { name: 'Cattail', price: 6, rank: 2 },
  javafern: { name: 'Java fern', price: 7, rank: 2 },
  fernph: { name: 'Lady fern', price: 8, rank: 2 },
  frogbit: { name: 'Frogbit', price: 4, rank: 3 },
  bamboo: { name: 'Umbrella sedge', price: 9, rank: 3 },
  bilberry: { name: 'Bilberry shrub', price: 10, rank: 3 },
  sword: { name: 'Amazon sword', price: 10, rank: 3 },
  lily: { name: 'Water lily', price: 14, rank: 4 },
  bromeliad: { name: 'Bromeliad', price: 22, rank: 4 },
};

// ---------------------------------------------------------------------------
// Hardscape pieces (Hardscape tool).

export const PIECES = {
  boulder: { name: 'Mossy boulder', price: 4, rank: 1 },
  roots: { name: 'Roots', price: 6, rank: 2 },
  stump: { name: 'Tree stump', price: 8, rank: 2 },
  wood: { name: 'Driftwood', price: 12, rank: 2 },
  spire: { name: 'Stone spire', price: 10, rank: 3 },
  cliff: { name: 'Cliff face', price: 18, rank: 4 },
};

export const ECON = { animal: ANIMALS, plant: PLANTS, piece: PIECES };
export const KINDS = ['animal', 'plant', 'piece', 'gear', 'tank'];

// ---------------------------------------------------------------------------
// Rules of trade.

// Bulk discount: `[at least n, price factor]`, biggest first.
export const BULK = [[20, 0.85], [10, 0.9], [5, 0.95]];
export function bulkFactor(n) {
  for (const [min, f] of BULK) if (n >= min) return f;
  return 1;
}

// A sale never pays more than this fraction of the buy price, so buying and
// selling again can never make money (even after the biggest bulk discount).
export const SELL_CAP = 0.8;

// Reputation for owning something for the first time (learning by doing).
export const REP_FIRST = { animal: 6, plant: 2, piece: 2, gear: 5, tank: 25 };

// A promotion bonus in funds: rank × this.
export const PROMOTION_BONUS = 25;

// ---------------------------------------------------------------------------
// One uniform view of any buyable thing, whatever table it comes from.
// `rank` is the career rank that unlocks it, `sold: false` marks things that
// are never for sale. Returns null for an unknown id.

export function entry(kind, id) {
  switch (kind) {
    case 'gear': {
      const g = GEAR[id];
      return g ? { kind, id, name: g.name, price: g.price, rank: g.level, owned: !!g.owned } : null;
    }
    case 'tank': {
      const t = TANKS[id];
      return t ? { kind, id, name: t.name, price: t.price, rank: t.level } : null;
    }
    default: {
      const e = ECON[kind]?.[id];
      return e ? { kind, id, ...e } : null;
    }
  }
}

// Everything that becomes available when a rank is reached, for the level-up
// message and the career page: `[{ kind, id, name, price }]`. Things you own
// from the start, hidden ones and things never for sale are left out.
export function unlocksAt(level) {
  const out = [];
  for (const kind of KINDS) {
    const table = kind === 'gear' ? GEAR : kind === 'tank' ? TANKS : ECON[kind];
    for (const id of Object.keys(table)) {
      const e = entry(kind, id);
      if (e.rank !== level || e.sold === false || e.hidden || e.owned) continue;
      out.push({ kind, id, name: e.name, price: e.price });
    }
  }
  return out;
}

// A guide for whoever writes commissions: what a job of a given rank and
// effort (1 = a small job, 3 = a big one) should pay. Funds grow about 38%
// per rank so they keep pace with the price of the next tank; reputation
// grows slowly so each rank takes a similar number of jobs.
export function suggestedReward(level, effort = 1) {
  const funds = Math.round((40 * Math.pow(1.38, level - 1) * effort) / 5) * 5;
  const rep = Math.round((20 + 9 * level) * effort);
  return { funds, rep };
}
