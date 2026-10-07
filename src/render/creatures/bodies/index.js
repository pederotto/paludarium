import { FROGS } from './frogs.js';
import { SALAMANDERS } from './salamanders.js';
import { TETRAS } from './tetras.js';
import { STREAMFISH } from './streamfish.js';
import { BOTTOM_FISH } from './bottom-fish.js';
import { CRUSTACEANS } from './crustaceans.js';
import { SMALL } from './small.js';
import { LIZARDS } from './lizards.js';

// Every species' body definition, by id. Each entry is a function returning a
// definition (see ../kit.js), so nothing is built until it is needed.
const RAW = { ...FROGS, ...SALAMANDERS, ...TETRAS, ...STREAMFISH, ...BOTTOM_FISH, ...CRUSTACEANS, ...SMALL, ...LIZARDS };
// Each definition is stamped with the id it was built from (def.bodyKey), so a worker can rebuild it from the id alone:
// defs hold functions and cannot be posted.
export const BODIES = Object.fromEntries(Object.entries(RAW).map(([k, f]) => [k, (...a) => { const d = f(...a); d.bodyKey = k; return d; }]));

// Morph bodies are registered as BODIES['<species>:<morph>'] (same factory signature as BODIES['<species>']).
// morphsOf('axolotl') lists the morph ids that have a body: ['leucistic', 'wild', ...].
export const morphsOf = (species) => Object.keys(BODIES).filter((k) => k.startsWith(species + ':')).map((k) => k.slice(species.length + 1));
