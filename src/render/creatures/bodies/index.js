import { FROGS } from './frogs.js';
import { SALAMANDERS } from './salamanders.js';
import { TETRAS } from './tetras.js';
import { STREAMFISH } from './streamfish.js';
import { BOTTOM_FISH } from './bottom-fish.js';
import { CRUSTACEANS } from './crustaceans.js';
import { SMALL } from './small.js';
import { LIZARDS } from './lizards.js';
import { GUPPY, lookupGuppy } from './guppy.js';

// Every species' body definition, by id. Each entry is a function returning a
// definition (see ../kit.js), so nothing is built until it is needed.
const RAW = { ...FROGS, ...SALAMANDERS, ...TETRAS, ...GUPPY, ...STREAMFISH, ...BOTTOM_FISH, ...CRUSTACEANS, ...SMALL, ...LIZARDS };
// Each definition is stamped with the id it was built from (def.bodyKey), so a worker can rebuild it from the id alone:
// defs hold functions and cannot be posted.
const stamp = (k, f) => (...a) => { const d = f(...a); d.bodyKey = k; return d; };
const LISTED = Object.fromEntries(Object.entries(RAW).map(([k, f]) => [k, stamp(k, f)]));
// The guppy has too many looks to list (every strain a tank can breed, females, gravid females, fry: content/guppy.js): a
// 'guppy:<look>' entry is made the first time it is asked for, and an id that is not a look reads as missing (meshKeyFor then
// falls back to the species' default body, as for any morph without a body).
export const BODIES = new Proxy(LISTED, {
  get(t, k) {
    if (typeof k !== 'string' || k in t || !k.startsWith('guppy:')) return t[k];
    const f = lookupGuppy(k.slice(6));
    return f ? (t[k] = stamp(k, f)) : undefined;
  },
  has(t, k) { return k in t || (typeof k === 'string' && k.startsWith('guppy:') && !!lookupGuppy(k.slice(6))); },
});

// Morph bodies are registered as BODIES['<species>:<morph>'] (same factory signature as BODIES['<species>']).
// morphsOf('axolotl') lists the morph ids that have a body: ['leucistic', 'wild', ...].
export const morphsOf = (species) => Object.keys(BODIES).filter((k) => k.startsWith(species + ':')).map((k) => k.slice(species.length + 1));
