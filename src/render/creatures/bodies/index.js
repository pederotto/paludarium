import { FROGS } from './frogs.js';
import { SALAMANDERS } from './salamanders.js';
import { TETRAS } from './tetras.js';
import { BOTTOM_FISH } from './bottom-fish.js';
import { CRUSTACEANS } from './crustaceans.js';
import { SMALL } from './small.js';

// Every species' body definition, by id. Each entry is a function returning a
// definition (see ../kit.js), so nothing is built until it is needed.
export const BODIES = { ...FROGS, ...SALAMANDERS, ...TETRAS, ...BOTTOM_FISH, ...CRUSTACEANS, ...SMALL };
