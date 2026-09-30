// World units are centimetres. The tank sits on the origin: x runs left→right,
// z runs back→front and y is up. The glass floor is at y = 0.
//
// The tank's size is configurable (see content/tanks.js): call configureTank()
// before building a World. Everything that needs the dimensions reads them at
// call time, so these objects are mutated in place and never replaced.

export const TANK = {
  id: 'standard',
  name: 'Standard paludarium',
  w: 90,   // inside width  (x)
  d: 45,   // inside depth  (z)
  h: 60,   // inside height (y)
  closed: false, // sealed jar: no lid to open, no top-up, and it fogs up
};

// Substrate heightfield (x,z) and background wall relief (x,y).
export const TERRAIN_RES = { nx: 120, nz: 60 };
export const WALL_RES = { nx: 120, ny: 80 };
export const LIMITS = { wallDepth: 16 }; // how far the background may bulge forward

export function configureTank(spec) {
  const cpc = spec.cellsPerCm ?? 1.33;
  Object.assign(TANK, { id: spec.id, name: spec.name, w: spec.w, d: spec.d, h: spec.h, closed: !!spec.closed });
  TERRAIN_RES.nx = Math.round(spec.w * cpc);
  TERRAIN_RES.nz = Math.round(spec.d * cpc);
  WALL_RES.nx = TERRAIN_RES.nx;
  WALL_RES.ny = Math.round(spec.h * cpc);
  LIMITS.wallDepth = Math.min(16, Math.round(spec.d * 0.36));
  return TANK;
}

export const tankLitres = () => (TANK.w * TANK.d * TANK.h) / 1000;

// Substrate/wall materials. Index order matters for saves.
export const MATERIALS = [
  { id: 'soil',   name: 'Soil',        color: [0.23, 0.16, 0.10], rough: 0.95 },
  { id: 'sand',   name: 'Sand',        color: [0.78, 0.68, 0.50], rough: 0.9 },
  { id: 'gravel', name: 'Gravel',      color: [0.46, 0.44, 0.40], rough: 0.8 },
  { id: 'rock',   name: 'Rock',        color: [0.36, 0.33, 0.30], rough: 0.7 },
  { id: 'moss',   name: 'Moss',        color: [0.20, 0.42, 0.12], rough: 1.0 },
  { id: 'stone',  name: 'Dark stone',  color: [0.20, 0.18, 0.16], rough: 1.0 },
];
export const MAT = Object.fromEntries(MATERIALS.map((m, i) => [m.id, i]));
export const NMAT = MATERIALS.length;

// One real second at 1× speed is one simulated minute.
export const MINUTES_PER_SECOND = 1;
export const SPEEDS = [0, 1, 5, 20, 60];
