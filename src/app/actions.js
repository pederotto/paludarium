// Care actions: the things a keeper does by hand. Each returns a short
// message for a toast. They live here (not in the UI) so tutorials,
// commissions and the automation controller can call them too.

import * as THREE from 'three/webgpu';

export const Care = {
  feed(game) {
    const n = game.world.animals.feed();
    return n ? 'Fish food scattered on the water.' : 'No open water to feed.';
  },
  flies(game) {
    const W = game.world;
    let n = 0;
    for (let k = 0; k < 10; k++) {
      const p = W.randomSpot((x, y, z, s) => s === -Infinity);
      if (p && W.animals.add('fly', p.clone().setY(p.y + 4))) n++;
    }
    return n ? `Added ${n} fruit flies.` : 'No dry land for flies to land on.';
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
