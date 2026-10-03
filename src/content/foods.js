// Prepared foods and diets: plain data and two helpers, no simulation imports (sim/animals.js, sim.js and the UI use it).
//
// Food the keeper drops into the water (Animals.food, not animals): flakes float a while and sink slowly, pellets sink at
// once, a thawed cube of bloodworms falls apart into worms that wriggle down. 'flake' in a species' `eats` stands for
// prepared food and takes in all three; 'pellet' or 'bloodworm' can also be listed alone (the pygmy sunfish ignores flakes
// and pellets but takes bloodworms). Live feeders (crickets, dubia, earthworms, waxworms) are species with `feeder: true`.
export const ITEMS = {
  flake: { name: 'flakes', color: 0xc9772f, sink: [0.15, 0.45], float: 20, per: 2, min: 10 },
  pellet: { name: 'pellets', color: 0x6b4426, sink: [0.9, 1.3], float: 2, per: 1, min: 4 },
  bloodworm: { name: 'bloodworms', color: 0x8e1418, sink: [0.3, 0.5], float: 4, per: 2.5, min: 10 },
};
export const isItem = (pid) => pid === 'flake' || pid === 'pellet' || pid === 'bloodworm';
const DIET = new Map();
// A species' food list with 'flake' expanded into every prepared food (flakes, pellets, bloodworms).
export function dietOf(sp) {
  let d = DIET.get(sp);
  if (!d) {
    d = [];
    for (const pid of sp.eats) { if (pid === 'flake') { for (const k of Object.keys(ITEMS)) if (!d.includes(k)) d.push(k); } else if (!d.includes(pid)) d.push(pid); }
    DIET.set(sp, d);
  }
  return d;
}
export const eatsItem = (sp, f) => dietOf(sp).includes(f.kind ?? 'flake');
