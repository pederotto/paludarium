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

// --- Size ------------------------------------------------------------------------------------------------
// The standard tank is the one every number in the simulation was tuned in, so every size factor is measured
// against it: 1 in the standard tank, less in a smaller one, more in a bigger one.
export const STANDARD = { w: 90, d: 45, h: 60 };
const glassOf = (t) => 2 * (t.w * t.d + t.w * t.h + t.d * t.h);
let sizeKey = '', sizeMemo = null;

// How big the tank is, and what that does to it.
//   litres, floor (cm²), glass (cm², all six faces): the plain measures.
//   vol, area, wall, glassR: the same against the standard tank (wall is the background, w × h, for climbers).
//   heat: how fast the temperature follows its target. The water, soil and stone hold the heat (about the volume) and lose it
//         through the glass, so a small tank warms and cools fast and a big one takes its time; (V/Vstd)^-0.6, kept between
//         0.3 and 4 so a show tank still settles within a game day and a jar does not jump at 60× speed.
//   air:  how fast the humidity follows its target: the air is changed through the lid and the vents, which grow more slowly
//         than the volume; (V/Vstd)^-0.5, between 0.35 and 3.2.
//   push: how hard a device with a fixed output (a fogger, a fan, a spray bottle) moves the air. Gear for small tanks is not
//         made much smaller, so the same fogger fills a 27-litre cube with fog; a big tank's keeper buys the bigger model,
//         which still falls a little short. (V/Vstd)^-0.5 like air, but never below 0.7, so a show tank stays humid enough.
//   spot: what one basking lamp (a fixed spot bulb) adds to the whole tank's temperature: its heat leaves through the glass,
//         so it is the standard glass area over this one's. A jar under a basking lamp overheats; between 0.3 and 3.
//   bar:  what the LED bar adds: it runs most of the tank's width (engine/stage.js), so its heat grows with the width and leaves
//         through the glass; between 0.5 and 2.
// Cached until the tank changes (it is read every tick and for every animal).
export function sizeFactors(t = TANK) {
  const key = `${t.w}|${t.d}|${t.h}`;
  if (key === sizeKey && t === TANK) return sizeMemo;
  const S = STANDARD, cl = (v, a, b) => Math.max(a, Math.min(b, v));
  const litres = (t.w * t.d * t.h) / 1000, floor = t.w * t.d, glass = glassOf(t);
  const vol = (t.w * t.d * t.h) / (S.w * S.d * S.h), area = floor / (S.w * S.d), glassR = glass / glassOf(S);
  const f = {
    litres, floor, glass, vol, area, wall: (t.w * t.h) / (S.w * S.h), glassR,
    heat: cl(vol ** -0.6, 0.3, 4),
    air: cl(vol ** -0.5, 0.35, 3.2),
    push: cl(vol ** -0.5, 0.7, 3),
    spot: cl(1 / glassR, 0.3, 3),
    bar: cl(t.w / S.w / glassR, 0.5, 2),
  };
  if (t === TANK) { sizeKey = key; sizeMemo = f; }
  return f;
}

// Room for one species. The keeper's-sheet numbers in sim/animals.js (`cap`: the most that keep breeding; `flock`: the
// group that keeps it well) are for the standard tank. A swimmer's share grows with the water (the tank's volume), a climber's
// (geckos) with the background, everyone else's with the floor: three dart frogs are a crowd in a 30 cm cube and lost in a
// show tank. Never below the smallest group the species needs (or a pair), never more than 20 over the sheet (the creature
// meshes hold that many). `crowd`: more than this many and they stress each other (1.5 times the breeding room, or the top of
// the flock). `territories`: how many adult males of a territorial species can keep out of each other's way (one in the
// standard tank; a male needs about the standard tank's floor).
export function roomFor(sp, f = sizeFactors()) {
  const k = sp.kind === 'swim' || sp.kind === 'crawlWater' ? f.vol : sp.kind === 'gecko' ? f.wall : f.area;
  const lo = Math.max(2, sp.flock?.[0] ?? 0);
  const cap = Math.max(Math.min(sp.cap, lo), Math.min(sp.cap + 20, Math.round(sp.cap * k)));
  const most = sp.flock ? Math.max(sp.flock[0], Math.min(sp.flock[1] + 20, Math.round(sp.flock[1] * k))) : null;
  return { k, cap, most, crowd: most ?? Math.round(cap * 1.5), territories: Math.max(1, Math.floor(f.area + 0.25)) };
}

// The kinds of animal that mind a crowd of their own kind (the rest are crew, feeders and larvae, kept in check by their
// breeding room). Sim.careStress stresses them past `roomFor().crowd`; game/stocking.js warns the player at the same point.
export const CROWDS = new Set(['frog', 'toad', 'newt', 'axolotl', 'gecko', 'skink', 'crab', 'swim']);

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
