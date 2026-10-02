// Burrows: animals that dig into the substrate (the vampire crab). Pure data and arithmetic on the terrain Field (no scene),
// so the tests run it under Node.
//
// Digging works on the same ground the erosion works on (`field.base`, cm of soil over the tank floor) and keeps its rule:
// soil is moved, never made or destroyed (the sum of base heights only changes by player edits and by these moves). A load
// is scraped from a bowl around the burrow and dropped on a crescent of spoil beside the mouth, so a burrow is a real pit with
// a little heap next to it, which the mesh, the water and the plants see once the water commits the change (render/water.js).
// Because a dug cell differs from what erosion last saw, erosion takes it as an edit: the pit's walls lose the as-built
// allowance and slump where the ground cannot hold them (support.js): the steepest part of the wall slides back in (more in
// sand than in soil) and rock or a root mat at the edge holds the face.
//
//   digRate(f, x, z, root)     0 … 1 how easily the ground here gives (material, hardscape, roots)
//   pitDepth(f, x, z, r)       how far the centre lies below the ring round it (cm): a burrow is found again from the ground
//   burrowSpot(f, x, z, ...)   the depth it can still dig to here and the side its spoil goes (away from the nearest hard edge)
//   excavate(f, x, z, opt)     moves one load: { moved, cells } (cm3 and the cells changed)

import { NMAT } from './tank.js';

// Per material (soil, sand, gravel, rock, moss, dark stone): how readily a crab's claws loosen it, 0 … 1.
export const DIG = [1, 1, 0.3, 0, 0.45, 0];
export const BURROW = {
  r: 1.6,          // cm: radius of the bowl (a 2.1 cm crab sits in it up to the eyes)
  depth: 1.3,      // cm: how deep it wants it (molting: 1.7)
  floor: 0.9,      // cm: never closer than this to the tank floor (the erosion's floor is 0.5)
  spoil: 2.9,      // cm from the centre to the middle of the spoil heap
  load: 0.35,      // cm3 of soil per load (claws and the first legs full)
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function cell(f, x, z) {
  const [fi, fj] = f.toGrid(x, z);
  return clamp(Math.round(fj), 0, f.ny) * f.cols + clamp(Math.round(fi), 0, f.nx);
}

// Hardscape sits on the ground as a stamp (field.stamped); the cells under it cannot be dug, and neither can their ground.
export function digRate(f, x, z, root = null) {
  const n = cell(f, x, z);
  if (f.stamped?.[n]) return 0;
  let r = 0;
  if (f.mat) for (let m = 0; m < NMAT; m++) r += f.mat[n * NMAT + m] * (DIG[m] ?? 0);
  else r = 1;
  return clamp(r * (1 - 0.75 * (root?.[n] ?? 0)), 0, 1);
}

// The ground on a ring of radius r minus the ground at the centre (cm, on the base heights: a stone on the rim does not make
// a burrow). The ring is the mean of its lower two thirds, so the burrow's own spoil heap on one side does not count as depth.
const RING = new Float64Array(12);
export function pitDepth(f, x, z, r = BURROW.r * 1.4) {
  for (let k = 0; k < 12; k++) { const t = (k / 12) * Math.PI * 2; RING[k] = f.sample(x + Math.sin(t) * r, z + Math.cos(t) * r, f.base); }
  RING.sort();
  let s = 0;
  for (let k = 0; k < 8; k++) s += RING[k];
  return s / 8 - f.sample(x, z, f.base);
}

// What digging here would give: `room` cm of soil left above the floor at the centre, the dig rate, and the direction
// (unit x, z) of the mouth and the spoil: away from the nearest hard cell (a burrow runs in under a stone or a root), else
// downhill. Returns null where it cannot dig at all.
export function burrowSpot(f, x, z, root = null) {
  const rate = digRate(f, x, z, root);
  if (rate <= 0.05) return null;
  const room = f.sample(x, z, f.base) - BURROW.floor;
  let hx = 0, hz = 0;
  for (let k = 0; k < 16; k++) {
    const t = (k / 16) * Math.PI * 2, sx = Math.sin(t), sz = Math.cos(t);
    for (const d of [1.5, 2.5, 3.5]) {
      if (digRate(f, x + sx * d, z + sz * d, root) < 0.15) { hx += sx / d; hz += sz / d; break; }
    }
  }
  let dx = -hx, dz = -hz;
  if (Math.hypot(dx, dz) < 1e-3) {                          // nothing hard round it: the spoil goes downhill
    const [gx, gz] = f.gradient(x, z);
    dx = -gx; dz = -gz;
    if (Math.hypot(dx, dz) < 1e-3) { dx = 0; dz = 1; }      // flat: towards the front glass
  }
  const l = Math.hypot(dx, dz);
  return { rate, room, dir: { x: dx / l, z: dz / l } };
}

// One load out of the burrow at (x, z): up to `amount` cm3 (scaled by the dig rate) is taken from a bowl of radius r (most
// from the middle), no cell below `bottom` or the floor, no hardscape cell touched; the same volume goes onto the spoil
// crescent around (x, z) + dir * spoil, cells weighted by a soft bump, and that heap takes the soil's material.
// opt: { r, amount, dir: {x, z}, spoil, bottom (cm, absolute: the centre's lowest point), wall (cm the bowl rises to its rim
// above `bottom`), root, paint (fn(cell, weight) for each spoil cell, or null) }
// Returns { moved, cells: Set of changed cell indices }.
export function excavate(f, x, z, opt = {}) {
  const B = f.base, st = f.stamped;
  const r = opt.r ?? BURROW.r, rate = digRate(f, x, z, opt.root);
  const want = (opt.amount ?? BURROW.load) * rate;
  const cells = new Set();
  if (want <= 0) return { moved: 0, cells };
  const area = f.da * f.db;
  const bottom = Math.max(opt.bottom ?? -Infinity, BURROW.floor);
  // Take: weights over the bowl, each cell's share capped by what it has above the bottom.
  const take = [], [ci, cj] = f.toGrid(x, z);
  const ri = Math.ceil(r / f.da), rj = Math.ceil(r / f.db);
  let wsum = 0;
  for (let j = Math.max(0, Math.floor(cj) - rj); j <= Math.min(f.ny, Math.ceil(cj) + rj); j++) {
    for (let i = Math.max(0, Math.floor(ci) - ri); i <= Math.min(f.nx, Math.ceil(ci) + ri); i++) {
      const n = j * f.cols + i;
      if (st?.[n]) continue;
      const d = Math.hypot((i - ci) * f.da, (j - cj) * f.db) / r;
      if (d >= 1) continue;
      // Deepest in the middle: no cell goes below bottom + wall * d², so the walls stay sloped (a funnel, not a shaft).
      const w = (1 - d * d), cap = Math.max(0, B[n] - (bottom + (opt.wall ?? 1.2) * d * d));
      if (cap <= 1e-4) continue;
      take.push([n, w, cap]); wsum += w;
    }
  }
  if (!take.length) return { moved: 0, cells };
  let moved = 0;
  for (const [n, w, cap] of take) {
    const dh = Math.min(cap, (want / area) * (w / wsum));
    B[n] -= dh; moved += dh * area; cells.add(n);
  }
  if (moved <= 0) return { moved: 0, cells };
  // Drop: a crescent of spoil beside the mouth (centre at `spoil` cm along dir, spread across it).
  const dir = opt.dir ?? { x: 0, z: 1 }, sd = opt.spoil ?? BURROW.spoil;
  const sx = x + dir.x * sd, sz = z + dir.z * sd, sr = r * 1.1;
  const drop = [];
  let dsum = 0;
  const [si, sj] = f.toGrid(sx, sz);
  const qi = Math.ceil(sr * 1.6 / f.da), qj = Math.ceil(sr * 1.6 / f.db);
  for (let j = Math.max(0, Math.floor(sj) - qj); j <= Math.min(f.ny, Math.ceil(sj) + qj); j++) {
    for (let i = Math.max(0, Math.floor(si) - qi); i <= Math.min(f.nx, Math.ceil(si) + qi); i++) {
      const n = j * f.cols + i;
      if (st?.[n]) continue;
      const [wx, wz] = f.toWorld(i, j);
      const ax = wx - sx, az = wz - sz;
      const along = ax * dir.x + az * dir.z, across = -ax * dir.z + az * dir.x;   // a heap longer across the mouth than along it
      const d = Math.hypot(along / sr, across / (sr * 1.6));
      if (d >= 1) continue;
      if (Math.hypot(wx - x, wz - z) < r * 0.9) continue;      // never back into the bowl
      const w = (1 - d * d) * (1 - d * d);
      drop.push([n, w]); dsum += w;
    }
  }
  if (!drop.length) {                                        // nowhere to put it (a wall of hardscape all round): undo
    for (const [n, w, cap] of take) B[n] += Math.min(cap, (want / area) * (w / wsum));
    return { moved: 0, cells: new Set() };
  }
  const maxH = f.maxH ?? Infinity;
  let left = moved / area;
  for (const [n, w] of drop) {
    const dh = Math.min((moved / area) * (w / dsum), maxH - B[n]);
    B[n] += dh; left -= dh; cells.add(n);
    if (opt.paint) opt.paint(n, w);
  }
  if (left > 1e-7) for (const [n] of take) { B[n] += left / take.length; }   // a heap at the lid (never in practice): put it back
  f.dirty = true;
  return { moved, cells };
}
