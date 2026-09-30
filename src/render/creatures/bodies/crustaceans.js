// Shrimp, crabs and isopods. Face +z. rig.x is 0 at the head … 1 at the tail; rig.y/z drive legs (see ../kit.js).
// Empty until modelled: sim/animals.js falls back to low-poly models for missing ids.
import { ell, smin, smax, cap, chain, box, sphere, vnoise, hash, cells, fbm, C, lerp3, mul3, mix, clamp01, M } from '../kit.js';

export const CRUSTACEANS = {};
