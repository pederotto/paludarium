// Random paths and random scenarios for the test lab, from a seed: the same seed always gives the same path and the same scenario, so
// a combination that shows a bug can be sent as a number. Pure (no scene): the unit tests run it under Node (tests/labrandom.test.mjs).
// Positions are cm on the floor plane, headings are radians as the sim uses them (direction = (sin h, cos h)).
//
// A random path is made of moves an animal meets in life: straights, arcs, U-turns, zig-zags, loops, stops and changes of pace.

import { rng, clamp } from '../util/math.js';

const TAU = Math.PI * 2;

// A seed spread over 32 bits (the small numbers a person types would start the generator in nearly the same place).
export function mix(seed) {
  let h = (Math.imul((seed | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ 0x27d4eb2f) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return (h ^ (h >>> 15)) >>> 0 || 1;
}
export const seeded = (seed) => rng(mix(seed));
const gauss = (r) => (r() + r() + r() - 1.5) * 1.1547;
const between = (r, a, b) => a + (b - a) * r();
const pick = (r, list) => list[Math.min(list.length - 1, Math.floor(r() * list.length))];
const wrap = (a) => ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;

export const STYLES = { mixed: 'Mixed moves', wander: 'Wander', dashes: 'Long dashes', tight: 'Tight turns', edges: 'Along the glass', obstacles: 'At the obstacles' };

export const pathLen = (pts) => { let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z); return s; };

// A walker: a pose that appends waypoints, and refuses a move that would leave the floor (the caller tries another).
function walker(start, h, b, margin) {
  const w = { x: start.x, z: start.z, h, pts: [{ x: start.x, z: start.z }], moves: [], pace: 1 };
  const inside = (x, z) => x >= b.x0 + margin && x <= b.x1 - margin && z >= b.z0 + margin && z <= b.z1 - margin;
  const add = (x, z) => { w.x = x; w.z = z; w.pts.push({ x, z, ...(w.pace !== 1 ? { pace: w.pace } : {}) }); };
  w.inside = inside;
  w.line = (len) => {
    const x = w.x + Math.sin(w.h) * len, z = w.z + Math.cos(w.h) * len;
    if (!inside(x, z)) return false;
    add(x, z); w.moves.push('straight'); return true;
  };
  // An arc turning through `turn` radians (+ right) on a circle of radius r.
  w.arc = (turn, r, name = 'arc') => {
    const n = Math.max(2, Math.ceil(Math.abs(turn) / 0.35)), side = Math.sign(turn) || 1;
    const cx = w.x + Math.cos(w.h) * r * side, cz = w.z - Math.sin(w.h) * r * side;
    const pts = [];
    for (let k = 1; k <= n; k++) {
      const a = w.h + (turn * k) / n, x = cx - Math.cos(a) * r * side, z = cz + Math.sin(a) * r * side;
      if (!inside(x, z)) return false;
      pts.push([x, z]);
    }
    for (const [x, z] of pts) add(x, z);
    w.h = wrap(w.h + turn); w.moves.push(name); return true;
  };
  w.turnTo = (h) => { w.h = h; };
  w.pause = (s) => { const last = w.pts[w.pts.length - 1]; if (last) last.wait = s; w.moves.push('stop'); };
  w.toCentre = () => { w.h = Math.atan2(-(w.x - (b.x0 + b.x1) / 2), -(w.z - (b.z0 + b.z1) / 2)); };
  return w;
}

function walk(r, w, length, moveFor) {
  let guard = 0;
  while (pathLen(w.pts) < length && guard++ < 400) {
    let done = false;
    for (let t = 0; t < 7 && !done; t++) done = moveFor(w, r);
    if (!done) { w.toCentre(); w.line(between(r, 6, 12)) || w.line(3); }
  }
}

// What a random path is built of, one move at a time.
const MIXED = [
  ['straight', 3, (w, r) => w.line(between(r, 10, 35))],
  ['arc', 3, (w, r) => w.arc(pick(r, [-1, 1]) * between(r, 0.8, 3), between(r, 6, 18))],
  ['uturn', 1.5, (w, r) => w.arc(pick(r, [-1, 1]) * Math.PI, between(r, 4, 8), 'uturn')],
  ['zigzag', 1.5, (w, r) => { const legs = 3 + ((r() * 3) | 0), ang = between(r, 0.7, 1.2), len = between(r, 6, 10), h0 = w.h; let ok = true; for (let k = 0; k < legs && ok; k++) { w.h = h0 + (k % 2 ? -ang : ang); ok = w.line(len); } w.h = h0; if (ok) w.moves.push('zigzag'); return ok; }],
  ['loop', 1, (w, r) => w.arc(pick(r, [-1, 1]) * TAU, between(r, 5, 10), 'loop')],
  ['stop', 1.5, (w, r) => { w.pause(between(r, 0.8, 4)); return true; }],
  ['pace', 1.5, (w, r) => { w.pace = pick(r, [0.5, 0.7, 1, 1.4, 1.7]); w.moves.push(`pace ${w.pace}`); return true; }],
];
const mixedMove = (w, r) => {
  let t = r() * MIXED.reduce((s, m) => s + m[1], 0);
  for (const [, wt, fn] of MIXED) { if ((t -= wt) <= 0) return fn(w, r); }
  return MIXED[0][2](w, r);
};

// A random path of about `length` cm for an animal at `start`.
//   opts: { style, length, bounds: { x0, x1, z0, z1 }, heading, margin, obstacles: [{ x, z, r }] }
// Returns { pts: [{ x, z, wait?, pace? }], moves: [names], style, seed }.
export function randomPath(seed, opts = {}) {
  const r = seeded(seed), b = opts.bounds ?? { x0: -45, x1: 45, z0: -22.5, z1: 22.5 }, margin = opts.margin ?? 3;
  const style = opts.style && STYLES[opts.style] ? opts.style : 'mixed', length = opts.length ?? 240;
  const start = { x: clamp(opts.start?.x ?? 0, b.x0 + margin, b.x1 - margin), z: clamp(opts.start?.z ?? 0, b.z0 + margin, b.z1 - margin) };
  const w = walker(start, opts.heading ?? r() * TAU, b, margin);
  switch (style) {
    case 'wander': {
      let h = w.h;
      while (pathLen(w.pts) < length && w.pts.length < 400) {
        h = wrap(h + gauss(r) * 0.45);
        w.h = h;
        if (!w.line(4)) { w.toCentre(); h = wrap(w.h + gauss(r) * 0.5); w.h = h; w.line(4); }
      }
      w.moves = ['wander'];
      break;
    }
    case 'dashes': {
      let guard = 0;
      while (pathLen(w.pts) < length && guard++ < 200) {
        const x = between(r, b.x0 + margin, b.x1 - margin), z = between(r, b.z0 + margin, b.z1 - margin);
        if (Math.hypot(x - w.x, z - w.z) < 18) continue;
        w.pts.push({ x, z, ...(r() < 0.35 ? { wait: between(r, 0.5, 2.5) } : {}) }); w.x = x; w.z = z;
      }
      w.moves = ['dashes'];
      break;
    }
    case 'tight': {
      let guard = 0;
      while (pathLen(w.pts) < length && guard++ < 400) {
        const turn = pick(r, [-1, 1]) * between(r, 1.2, 3.0), len = between(r, 3, 6);
        w.h = wrap(w.h + turn);
        if (!w.line(len)) { w.toCentre(); w.line(len); }
      }
      w.moves = ['tight turns'];
      break;
    }
    case 'edges': {
      const inset = 4, x0 = b.x0 + inset, x1 = b.x1 - inset, z0 = b.z0 + inset, z1 = b.z1 - inset;
      const ring = [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
      const dir = pick(r, [1, -1]), s0 = (r() * 4) | 0, out = [];
      let len = 0, i = 0;
      out.push({ x: start.x, z: start.z });
      while (len < length && i < 80) {
        const a = ring[(((s0 + i * dir) % 4) + 4) % 4], q = out[out.length - 1];
        // along the glass, with now and then a step in from it
        if (r() < 0.4) { const inX = a.x < 0 ? a.x + between(r, 4, 14) : a.x - between(r, 4, 14), inZ = a.z < 0 ? a.z + between(r, 3, 8) : a.z - between(r, 3, 8); out.push({ x: clamp(inX, b.x0 + margin, b.x1 - margin), z: clamp(inZ, b.z0 + margin, b.z1 - margin) }); }
        out.push({ x: a.x, z: a.z });
        len = pathLen(out); i++;
        void q;
      }
      w.pts = out; w.moves = ['along the glass'];
      break;
    }
    case 'obstacles': {
      const obs = (opts.obstacles ?? []).slice();
      if (!obs.length) return randomPath(seed, { ...opts, style: 'mixed' });
      for (let i = obs.length - 1; i > 0; i--) { const j = (r() * (i + 1)) | 0; [obs[i], obs[j]] = [obs[j], obs[i]]; }
      const put = (x, z) => w.pts.push({ x: clamp(x, b.x0 + margin, b.x1 - margin), z: clamp(z, b.z0 + margin, b.z1 - margin) });
      for (const o of obs.slice(0, 6)) {
        const th = r() * TAU, ux = Math.sin(th), uz = Math.cos(th), pr = o.r ?? 5;
        put(o.x + ux * (pr + 6), o.z + uz * (pr + 6));            // the near side
        put(o.x - ux * (pr + 4), o.z - uz * (pr + 4));            // the far side: straight through it
        put(o.x - uz * (pr + 2), o.z + ux * (pr + 2));            // then along its flank
      }
      w.moves = ['at the obstacles'];
      break;
    }
    default:
      walk(r, w, length, mixedMove);
  }
  // Never two waypoints on the same spot.
  const pts = w.pts.filter((p, i) => i === 0 || Math.hypot(p.x - w.pts[i - 1].x, p.z - w.pts[i - 1].z) > 0.05);
  return { pts, moves: [...new Set(w.moves)], style, seed };
}

// --- Scenarios ---------------------------------------------------------------------------------------------------------------
// A whole random situation in the lab's scenario format (src/lab/scenario.js): the ground and its water, obstacles, a mix of
// animals, and a drive for each. `pool`: { land: [ids], water: [ids], shore: [ids] }, the species that live in each place (the lab
// reads them from the game's species table, so this stays free of it). `tank`: { w, d }.
const SHAPES = ['step', 'wall', 'post', 'ramp', 'trench', 'mound'];
const PIECES = ['boulder', 'spire', 'roots', 'stump', 'wood', 'cork', 'slate', 'bamboopole', 'pebbles'];
const SIZES = { step: [[8, 22], [6, 22], [1.5, 5]], wall: [[16, 40], [1.5, 3], [3, 8]], post: [[1.5, 4], [1.5, 4], [4, 12]], ramp: [[10, 24], [8, 16], [2, 7]], trench: [[16, 40], [2, 6], [1, 3]], mound: [[10, 26], [10, 26], [2, 7]] };

export function randomScenario(seed, { pool, tank = { w: 90, d: 45 }, animals = [2, 8], obstacles = [0, 5], water = 0.3 } = {}) {
  const r = seeded(seed + 7919), hw = tank.w / 2, hd = tank.d / 2;
  const wet = r() < water && pool.water?.length;
  const shore = !wet && r() < 0.5 && (pool.shore?.length || pool.land?.length);
  const ground = wet ? 'flat' : shore ? 'shore' : 'flat';
  const depth = wet ? pick(r, [8, 12, 16]) : shore ? pick(r, [3, 4, 5, 6]) : 0;
  const landX = shore ? [-hw + 4, -6] : [-hw + 4, hw - 4];       // where animals that live on land may start
  const spec = { v: 1, seed, tank: 'standard', ground, depth, rate: 4, obstacles: [], animals: [], dots: [] };

  const nOb = wet ? 0 : (r() * (obstacles[1] - obstacles[0] + 1) | 0) + obstacles[0];
  for (let i = 0; i < nOb; i++) {
    const x = between(r, landX[0] + 8, landX[1] - 4), z = between(r, -hd + 6, hd - 6);
    if (r() < 0.6) {
      const kind = pick(r, SHAPES), [w, d, h] = SIZES[kind].map(([a, b]) => Math.round(between(r, a, b) * 2) / 2);
      spec.obstacles.push({ kind, x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, w, d, h, rot: Math.round(r() * 6.28 * 100) / 100 });
    } else spec.obstacles.push({ kind: pick(r, PIECES), x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, size: Math.round(between(r, 6, 24)), rot: Math.round(r() * 6.28 * 100) / 100 });
  }

  const n = (r() * (animals[1] - animals[0] + 1) | 0) + animals[0];
  const where = wet ? [-hw + 6, hw - 6] : landX;
  const used = [];
  for (let i = 0; i < n; i++) {
    const list = wet ? pool.water : (r() < 0.18 && pool.shore?.length ? pool.shore : pool.land);
    if (!list?.length) continue;
    const sp = pick(r, list), amph = list === pool.shore;
    let x = 0, z = 0;
    for (let t = 0; t < 12; t++) {
      x = amph ? between(r, 2, 8) : between(r, where[0], where[1]); z = between(r, -hd + 5, hd - 5);
      if (used.every((u) => Math.hypot(u[0] - x, u[1] - z) > 4) && !spec.obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < (o.size ?? Math.max(o.w, o.d)) / 2 + 3)) break;
    }
    used.push([x, z]);
    const a = { sp, x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, yaw: Math.round(r() * 6.28 * 100) / 100, drive: null };
    const u = r();
    if (u < 0.72) a.drive = { type: 'path', shape: 'random', style: pick(r, Object.keys(STYLES)), seed: (r() * 1e6) | 0, length: pick(r, [120, 240, 400]), mode: pick(r, ['loop', 'pingpong', 'once']), pace: Math.round(between(r, 0.7, 1.4) * 10) / 10 };
    else if (u < 0.87) a.drive = { type: 'goto', x: Math.round(between(r, where[0], where[1]) * 10) / 10, z: Math.round(between(r, -hd + 5, hd - 5) * 10) / 10, pace: 1 };
    else if (u < 0.97) { const id = `d${spec.dots.length + 1}`; spec.dots.push({ id, kind: pick(r, ['wander', 'orbit']), x: Math.round(between(r, where[0], where[1]) * 10) / 10, z: Math.round(between(r, -hd + 5, hd - 5) * 10) / 10, speed: pick(r, [2, 3, 5]), seed: (r() * 1e6) | 0 }); a.drive = { type: 'follow', dot: id, keep: pick(r, [3, 4, 6]), pace: 1 }; }
    spec.animals.push(a);
  }
  return spec;
}
