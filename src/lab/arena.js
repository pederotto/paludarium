// The lab arena: an empty tank of any size with a flat floor, the light on, and a world that is held still: no hunger, no
// hunts, no breeding, no deaths, no flies (World.labFreeze, read by sim/sim.js), so what an animal does is its movement and
// nothing else. The climate, the water and the ground carry on as in the game.

import { TANKS } from '../content/tanks.js';
import { TANK } from '../sim/tank.js';
import { smooth } from '../util/math.js';
import { heightAfter } from '../sim/labshapes.js';
import { L } from './state.js';

// The grounds the arena comes with. Flat: the whole floor at FLOOR cm. Shore: dry land at LAND cm on the left, a ramp of a bank
// in the middle and a pool floor at POOL cm on the right, so animals that need a shore (newts, seashore springtails) can be released.
export const GROUNDS = { flat: 'Flat floor', shore: 'Pool and bank' };
export const FLOOR = 3, LAND = 8, POOL = 0.5;
export const maxDepth = (ground) => (ground === 'shore' ? LAND - POOL - 1 : 30);

export const tankChoices = () => Object.values(TANKS).filter((t) => t.id !== 'custom').map((t) => ({ id: t.id, name: `${t.name} ${t.w}×${t.d}×${t.h}` }));

// (Re)build the arena. Everything in the tank before goes.
export async function buildArena(game, { tank = 'standard', ground = 'flat', depth = 0, settle = true } = {}) {
  game.rig.stopOrbit();
  game.setRoom(false);
  await game.loadTank(tank, { layout: 'empty' });
  const W = game.world;
  W.labFreeze = true;
  const E = W.env;
  E.lights = 'on'; E.autoFeed = false; E.culture = false; E.minute = 12 * 60;
  game.rig.setZone('tank', false);
  L.tank.value = game.tankId;
  L.sel.value = null;
  shapeGround(game, ground);
  setDepth(game, depth);
  if (settle) await game.settle();   // (needs the frame loop: the first build starts it first, see index.js start)
  return W;
}

// The ground's base height at x on the arena's own ground (before any obstacle).
export function baseHeight(kind, x) {
  if (kind !== 'shore') return FLOOR;
  const x0 = TANK.w * 0.02, ramp = TANK.w * 0.16;
  return LAND + (POOL - LAND) * smooth(0, 1, (x - x0) / ramp);
}

// Reshape the ground (the soil layer's base height) and tell the world, as sculpting does: the arena's ground with the exact-size
// obstacles (sim/labshapes.js) cut into it. Water is set after (setDepth).
export function shapeGround(game, kind, shapes = []) {
  const W = game.world, F = W.terrain.field;
  for (let j = 0; j < F.rows; j++) for (let i = 0; i < F.cols; i++) {
    const [x, z] = F.toWorld(i, j), g = baseHeight(kind, x);
    F.base[F.idx(i, j)] = shapes.length ? heightAfter(g, shapes, x, z) : g;
  }
  F.dirty = true;
  W.groundChanged();
  L.ground.value = kind === 'shore' ? 'shore' : 'flat';
}

// Water in cm (0: dry): over the whole floor on the flat ground, in the pool on the shore ground.
export function setDepth(game, depth) {
  const W = game.world;
  if (!W) return;
  const shore = L.ground.value === 'shore';
  depth = Math.max(0, Math.min(maxDepth(L.ground.value), depth));
  W.setWaterLevel(depth > 0 ? Math.min(TANK.h - 8, (shore ? POOL : FLOOR) + depth) : 0);
  L.depth.value = depth;
}

// The four framings of the game's camera menu, by the names the lab uses: top, front, low (level with the floor), back.
export const VIEWS = { top: 'top', front: 'tank', low: 'bottom', back: 'back' };
export function setView(game, id) {
  game.rig.setZone(VIEWS[id] ?? 'tank', true);
}

export function setPaused(game, on) {
  L.paused.value = on;
  game.frozen = on;
}

export function setRate(game, r) {
  L.rate.value = r;
  game.rateOverride = r;
}

// Advance `n` frames of 1/60 s at once-speed, then stay paused (the game's own frame, so everything moves as it would).
export function stepFrames(game, n = 1) {
  const rate = game.rateOverride;
  setPaused(game, true);
  game.frozen = false; game.rateOverride = 1;
  try { for (let i = 0; i < n; i++) game.frame(1 / 60); } finally { game.frozen = true; game.rateOverride = rate; }
}
