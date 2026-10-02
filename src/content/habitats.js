// Where each animal can live: data only. sim/habitat.js turns it into rules that the Animals tool (a spot that does not
// suit the animal is refused, with the reason), the generator (it only stocks where an animal fits) and the simulation
// (an animal in the wrong place walks or swims to a right one, and is stressed until it does) all use.
// The ranges the simulation uses for comfort (temperature, humidity) stay with each species in sim/animals.js; the limits
// below are the HARD ones: past them the animal cannot be put there at all.
//
//   noun     the animal in a sentence ("a fire salamander")
//   zone     where it lives:
//              'water'  swims or walks the bottom: open water at least `minDepth` cm deep
//              'shore'  at the water's edge: on land with open water within `water` cm, or in water up to `maxDepth` cm deep
//              'land'   dry ground (it can stand in a puddle up to `maxDepth` cm)
//              'wall'   the background as well as dry ground (geckos)
//              'air'    flies over land
//              'any'    wherever the sim puts it (egg clutches)
//   minDepth / maxDepth   water depth range at the spot, cm
//   water    land and shore zones: open water must be within this many cm
//   cover    a hide (an overhang, wood, a rock, leaf litter, moss or dense plants) must be within this many cm: the amount of
//            cover is measured by Animals.coverAt
//   rhMin    local relative humidity (%) under which it is refused
//   tMax     local temperature (°C) over which it is refused
//   reach    a swimmer that can only climb out to land within this many cm (toads, frogs)
//   need     what it needs, in a phrase, for hints and the Field guide

export const HABITAT = {
  neon: { noun: 'neon tetra', zone: 'water', minDepth: 3, need: 'open water at least 3 cm deep' },
  cardinal: { noun: 'cardinal tetra', zone: 'water', minDepth: 3, need: 'open water at least 3 cm deep' },
  ember: { noun: 'ember tetra', zone: 'water', minDepth: 3, need: 'open water at least 3 cm deep' },
  guppy: { noun: 'guppy', zone: 'water', minDepth: 3, need: 'open water at least 3 cm deep' },
  betta: { noun: 'betta', zone: 'water', minDepth: 3, need: 'open water at least 3 cm deep' },
  cory: { noun: 'corydoras', zone: 'water', minDepth: 3, need: 'open water at least 3 cm deep' },
  loach: { noun: 'clown loach', zone: 'water', minDepth: 3, need: 'open water at least 3 cm deep' },
  oto: { noun: 'otocinclus', zone: 'water', minDepth: 3, need: 'open water at least 3 cm deep' },
  tadpole: { noun: 'tadpole', zone: 'water', minDepth: 3, need: 'open water at least 3 cm deep' },
  shrimp: { noun: 'cherry shrimp', zone: 'water', minDepth: 1, need: 'water at least 1 cm deep' },
  snail: { noun: 'trumpet snail', zone: 'water', minDepth: 1, need: 'water at least 1 cm deep' },
  axolotl: { noun: 'axolotl', zone: 'water', minDepth: 4, tMax: 26, need: 'cold, open water at least 4 cm deep' },

  // Keeper's sheet: 80% land, a shallow pool (5-10 cm) it can climb out of, 80-90% humidity (src/sim/crab.js).
  crab: { noun: 'vampire crab', zone: 'shore', water: 14, maxDepth: 6, rhMin: 65, rhIdeal: 85, tMax: 30, need: 'damp land (80-90% humidity) with shallow water within reach (14 cm), no deeper than 6 cm, and a ramp out' },
  newt: { noun: 'paddle-tail newt', zone: 'shore', water: 8, maxDepth: Infinity, tMax: 28, need: 'cool water, or land beside it (within 8 cm)' },
  toad: { noun: 'fire-bellied toad', zone: 'shore', water: 25, maxDepth: Infinity, reach: 30, rhMin: 40, tMax: 30, need: 'open water to swim in and a bank to climb out on' },

  dartfrog: { noun: 'blue dart frog', zone: 'land', maxDepth: 1.2, rhMin: 50, tMax: 31, need: 'damp, dry-footed ground (it swims only briefly)' },
  strawberry: { noun: 'strawberry dart frog', zone: 'land', maxDepth: 1.0, rhMin: 55, tMax: 31, need: 'damp, dry-footed ground (it swims only briefly)' },
  leucomelas: { noun: 'yellow-banded poison frog', zone: 'land', maxDepth: 1.2, rhMin: 45, tMax: 32, need: 'damp, dry-footed ground (it swims only briefly)' },
  auratus: { noun: 'green and black poison frog', zone: 'land', maxDepth: 1.2, rhMin: 50, tMax: 32, need: 'damp, dry-footed ground (it swims only briefly)' },
  // A forest salamander: cool, damp ground with a hide. Its water is a shallow dish or the stream's edge, not a pool.
  firesal: { noun: 'fire salamander', zone: 'land', maxDepth: 0.6, water: 40, cover: 7, rhMin: 52, tMax: 25, need: 'cool (under 22 °C), damp ground with a hide: wood, a rock, leaf litter or moss' },
  gecko: { noun: 'mourning gecko', zone: 'wall', maxDepth: 0.3, rhMin: 30, tMax: 36, need: 'the background wall or dry ground' },
  isopod: { noun: 'isopod', zone: 'land', maxDepth: 0.2, rhMin: 40, need: 'damp ground on land' },
  springtail: { noun: 'springtail', zone: 'land', maxDepth: 0.2, rhMin: 40, need: 'damp ground on land' },
  flylarva: { noun: 'fruit fly maggot', zone: 'land', maxDepth: 0.2, need: 'rotting litter on land' },
  flypupa: { noun: 'fruit fly pupa', zone: 'land', maxDepth: 0.2, need: 'a dry surface' },
  fly: { noun: 'fruit fly', zone: 'air', need: 'air over dry ground' },
  eggs: { noun: 'egg clutch', zone: 'any', need: 'a damp place' },
};
