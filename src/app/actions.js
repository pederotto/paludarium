// Care actions: the things a keeper does by hand. Each returns a short
// message for a toast. They live here (not in the UI) so tutorials,
// commissions and the automation controller can call them too.

import * as THREE from 'three/webgpu';
import { sourceOf } from '../content/equipment.js';
import { SPECIES, dietOf } from '../sim/animals.js';

// Live feeders by the cup (sim/animals.js `feeder` species): how many, and where they go.
export const FEEDERS = {
  cricket: { n: 8, label: 'Crickets', where: 'dry' },
  dubia: { n: 5, label: 'Dubia roaches', where: 'dry' },
  earthworm: { n: 5, label: 'Earthworms', where: 'damp' },
  waxworm: { n: 4, label: 'Waxworms', where: 'dry' },
};

// Who in the tank eats a food (species ids with animals present).
export function eatersOf(game, food) {
  const A = game.world.animals;
  return Object.keys(SPECIES).filter((id) => A.count(id) > 0 && SPECIES[id].kind !== 'egg' && dietOf(SPECIES[id]).includes(food));
}

export const Care = {
  feed(game, kind = 'flake') {
    const n = game.world.animals.feed(kind);
    if (!n) return 'No open water to feed.';
    return kind === 'pellet' ? 'Pellets dropped: they sink straight to the bottom.' : kind === 'bloodworm' ? 'A cube of bloodworms thaws and the worms drift down.' : 'Fish food scattered on the water.';
  },
  // A cup of live feeders, let go near the animals that eat them (on dry land, or damp soil for worms).
  feeders(game, id) {
    const W = game.world, F = FEEDERS[id];
    if (!F) return '';
    const eaters = eatersOf(game, id).flatMap((e) => W.animals.by[e]).filter((a) => a.pos.y >= W.terrain.heightAt(a.pos.x, a.pos.z) - 0.5);
    const near = eaters.length ? eaters[Math.floor(Math.random() * eaters.length)].pos : null;
    const land = (x, y, z, s) => s === -Infinity && (!near || Math.hypot(x - near.x, z - near.z) < 14) && (F.where !== 'damp' || W.climate.sample(W.climate.humus, x, z) > 0.05 || W.nearWater({ x, y, z }, 10));
    let n = 0;
    for (let k = 0; k < F.n; k++) {
      const p = W.randomSpot(land) ?? W.randomSpot((x, y, z, s) => s === -Infinity);
      if (p && W.animals.add(id, p, { age: 1440, hunger: 0.2 })) n++;
    }
    if (!n) return 'No dry land to put them on.';
    W.log(`Fed ${n} ${SPECIES[id].name.toLowerCase()}.`);
    return eaters.length ? `${n} ${F.label.toLowerCase()} let go near the ${SPECIES[eaters[0].sp].name.toLowerCase()}.` : `${n} ${F.label.toLowerCase()} added, but nothing here eats them: they will hide and live on.`;
  },
  flies(game) {
    const W = game.world;
    let n = 0;
    for (let k = 0; k < 10; k++) {
      const p = W.randomSpot((x, y, z, s) => s === -Infinity);
      if (p && W.animals.add('fly', p.clone().setY(p.y + 4))) n++;
    }
    if (!n) return 'No dry land for flies to land on.';
    // A culture is flies and a bit of rotting fruit: the flies lay eggs on it and the maggots eat it (sim/flylife.js).
    let fruit = 0;
    const spot = W.randomSpot((x, y, z, s) => s === -Infinity && y > W.water.level + 1) ?? W.randomSpot((x, y, z, s) => s === -Infinity);
    if (spot && W.flies) for (let k = 0; k < 2; k++) { W.flies.addFruit(spot.x + (k ? 3 : 0), spot.z + (k ? 2 : 0)); fruit++; }
    return fruit ? `Added ${n} fruit flies and ${fruit} pieces of rotting fruit: they lay eggs on it and the maggots eat it.` : `Added ${n} fruit flies.`;
  },
  mist(game) {
    const E = game.world.env;
    E.mist = 1; E.humidity = Math.min(100, E.humidity + 12);
    game.world.log('Misted the tank by hand.');
    game.world.climate.acc = 1e9;
    return 'Misted.';
  },
  fertilise(game) {
    game.world.env.nitrate += 10;
    game.world.log('Added liquid fertiliser.');
    return 'Fertiliser added: +10 ppm nitrate.';
  },
  ammonia(game) {
    game.world.env.ammonia += 1;
    game.world.log('Dosed ammonia to feed the bacteria.');
    return 'Ammonia dosed (fishless cycling): +1 ppm.';
  },
  waterChange(game) {
    const E = game.world.env;
    E.ammonia *= 0.6; E.nitrite *= 0.6; E.nitrate *= 0.6; E.detritus *= 0.8; E.algae *= 0.7;
    // The new water brings the source's hardness and pH (content/equipment.js WATER_SOURCES).
    const src = sourceOf(E);
    for (const b of game.world.water.bodies?.list ?? []) { b.ph = b.ph + (src.ph - b.ph) * 0.4; b.gh = b.gh + (src.gh - b.gh) * 0.4; }
    E.ph += (src.ph - E.ph) * 0.4; E.gh += (src.gh - E.gh) * 0.4;
    game.world.log('Changed 40% of the water.');
    return 'Changed 40% of the water.';
  },
  wipe(game) {
    game.world.env.wipe = 1;
    return 'Wiped the glass clear.';
  },
  rain(game, minutes = 5) {
    const E = game.world.env;
    E.rainUntil = E.minute + minutes;
    return 'A shower begins.';
  },
  scrubAlgae(game) {
    const E = game.world.env;
    E.algae *= 0.5; E.diatoms *= 0.5;
    game.world.log('Scrubbed algae off the glass and stone.');
    return 'Scrubbed the algae.';
  },
};

export { THREE };
