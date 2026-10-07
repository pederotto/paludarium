// What the test lab (src/lab) asks an animal to do, as pure numbers: paths, a dot to follow, and the step that turns a drive into
// "go to this point". No scene, no DOM: the unit tests run it under Node (tests/labdrive.test.mjs).
//
// A drive never moves an animal. It only names a goal (x, z in cm); `Animals.labDrive` hands the goal to the species' own
// movement (its hop or step cycle, its turning, its bumping), so a drive tests the body, it does not stand in for it.
// Positions are on the tank floor plane: x across, z front to back, as everywhere in the sim.

import { clamp, rng } from '../util/math.js';

const TAU = Math.PI * 2;
export const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// --- Paths -------------------------------------------------------------------------------------------------------------------
// Each returns waypoints [{ x, z }]; `closed` ones end where they began (the last point is not repeated).
export function circle(cx, cz, rx, rz = rx, n = 48) {
  return Array.from({ length: n }, (_, k) => { const t = (k / n) * TAU; return { x: cx + rx * Math.sin(t), z: cz - rz * Math.cos(t) }; });
}

// A figure of eight lying on its side (the lemniscate of Gerono): it crosses itself at the middle, which is also where it starts,
// x reaching ±rx and z reaching ±rz, so two lobes with a crossing. n points a lap.
export function figure8(cx, cz, rx, rz = rx * 0.5, n = 72) {
  return Array.from({ length: n }, (_, k) => { const t = (k / n) * TAU; return { x: cx + rx * Math.sin(t), z: cz + rz * Math.sin(2 * t) }; });
}

export function square(cx, cz, w, d = w) {
  const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
  return [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
}

// Back and forth along z, one column of the zig-zag per leg, `legs + 1` columns across x: an open path, one pass.
export function zigzag(cx, cz, w, d, legs = 5) {
  const out = [], z0 = cz - d / 2, z1 = cz + d / 2;
  for (let k = 0; k <= legs; k++) {
    const x = cx - w / 2 + (w * k) / legs;
    out.push({ x, z: k % 2 ? z1 : z0 }, { x, z: k % 2 ? z0 : z1 });
  }
  return out;
}

export function line(x0, z0, x1, z1) { return [{ x: x0, z: z0 }, { x: x1, z: z1 }]; }

export const pathLength = (pts, closed) => {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += dist2(pts[i - 1], pts[i]);
  return closed && pts.length > 2 ? s + dist2(pts[pts.length - 1], pts[0]) : s;
};

// Points along the path every `spacing` cm at most (corners kept), so an animal with a wide arrival circle cannot cut a corner.
export function resample(pts, spacing, closed = false) {
  const out = [];
  const n = pts.length, last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = pts[i], b = pts[(i + 1) % n], len = dist2(a, b), k = Math.max(1, Math.ceil(len / spacing));
    // (the waypoint itself keeps what it carries: a pause, a pace; the points between only keep the pace)
    for (let j = 0; j < k; j++) out.push(j === 0 ? { ...a } : { x: a.x + ((b.x - a.x) * j) / k, z: a.z + ((b.z - a.z) * j) / k, ...(a.pace != null ? { pace: a.pace } : {}) });
  }
  if (!closed) out.push({ ...pts[n - 1] });
  return out;
}

// Keep every point inside the floor, `margin` cm from the glass: { x0, x1, z0, z1 }.
export function clampTo(pts, b, margin = 2) {
  return pts.map((p) => ({ x: clamp(p.x, b.x0 + margin, b.x1 - margin), z: clamp(p.z, b.z0 + margin, b.z1 - margin) }));
}

// Distance from `p` to the nearest point of the path (as a line, not just its waypoints): how far off the track it is.
export function crossTrack(pts, p, closed = false) {
  const n = pts.length;
  if (!n) return 0;
  if (n === 1) return dist2(pts[0], p);
  let best = Infinity;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = pts[i], b = pts[(i + 1) % n], vx = b.x - a.x, vz = b.z - a.z, l2 = vx * vx + vz * vz;
    const t = l2 > 0 ? clamp(((p.x - a.x) * vx + (p.z - a.z) * vz) / l2, 0, 1) : 0;
    best = Math.min(best, Math.hypot(p.x - (a.x + vx * t), p.z - (a.z + vz * t)));
  }
  return best;
}

// --- Dots --------------------------------------------------------------------------------------------------------------------
// Something to chase. kind: 'fixed' (stays where it is put), 'wander' (a seeded random walk across the floor: a new place every
// time it gets there), 'orbit' (a circle at a steady speed). `speed` in cm/s; bounds { x0, x1, z0, z1 }.
export function makeDot(spec) {
  const d = { id: spec.id, kind: spec.kind ?? 'fixed', x: spec.x ?? 0, z: spec.z ?? 0, speed: spec.speed ?? 3, pause: spec.pause ?? 0.6,
    cx: spec.cx ?? spec.x ?? 0, cz: spec.cz ?? spec.z ?? 0, r: spec.r ?? 15, ang: spec.ang ?? 0, tx: null, tz: null, wait: 0 };
  d.seed0 = spec.seed ?? 1;
  d.rnd = rng(d.seed0);
  return d;
}

export function dotStep(d, dt, b) {
  if (d.kind === 'orbit') {
    d.ang += (d.speed / Math.max(1, d.r)) * dt;
    d.x = clamp(d.cx + d.r * Math.cos(d.ang), b.x0 + 1, b.x1 - 1); d.z = clamp(d.cz + d.r * Math.sin(d.ang), b.z0 + 1, b.z1 - 1);
  } else if (d.kind === 'wander') {
    if (d.wait > 0) { d.wait -= dt; return; }
    if (d.tx == null) { d.tx = b.x0 + 4 + d.rnd() * (b.x1 - b.x0 - 8); d.tz = b.z0 + 4 + d.rnd() * (b.z1 - b.z0 - 8); }
    const dx = d.tx - d.x, dz = d.tz - d.z, len = Math.hypot(dx, dz), step = d.speed * dt;
    if (len <= step) { d.x = d.tx; d.z = d.tz; d.tx = null; d.wait = d.pause * (0.5 + d.rnd()); }
    else { d.x += (dx / len) * step; d.z += (dz / len) * step; }
  }
}

// --- Glass panes --------------------------------------------------------------------------------------------------------------
// The panes a climbing frog can be sent up by the lab: the front glass and the two sides (the back is the relief). `panePoint` is the top of the climb on a pane, as the sim's own
// perch candidates make them (animals.js perchSpot): a point GLASS_OFF (the sim's GLASS_GAP, 0.12 cm) off the glass, level with the frog's place across the pane (clamped `edge` cm in
// from the corners), `top` cm up, and the pane's inward normal and the heading a frog sits at on it. x across, z front to back, as everywhere in the sim.
export const PANES = ['front', 'left', 'right'];
export const GLASS_OFF = 0.12;
export function panePoint(pane, p, hx, hz, top = 28, edge = 10) {
  switch (pane) {
    case 'left': return { top: { x: -hx + GLASS_OFF, y: top, z: clamp(p.z, -hz + edge, hz - edge) }, N: { x: 1, y: 0, z: 0 }, yaw: -Math.PI / 2 };
    case 'right': return { top: { x: hx - GLASS_OFF, y: top, z: clamp(p.z, -hz + edge, hz - edge) }, N: { x: -1, y: 0, z: 0 }, yaw: Math.PI / 2 };
    default: return { top: { x: clamp(p.x, -hx + edge, hx - edge), y: top, z: hz - GLASS_OFF }, N: { x: 0, y: 0, z: -1 }, yaw: 0 };
  }
}

// --- Drives ------------------------------------------------------------------------------------------------------------------
// { type: 'goto', x, z, tol }                      go there and stop
// { type: 'goto', wall: true, x, y, z, tol }       a point on the background wall (a climber: x across, y up): there when it is on the wall within tol
// { type: 'path', pts, closed, mode, tol }         mode 'loop' (round and round), 'once', 'pingpong'
// { type: 'follow', dot, keep, tol }               chase a dot; stop `keep` cm from it
// { type: 'climb', pane, top }                     a climbing frog up the front, left or right glass (PANES): the lab only picks the pane, the frog's own perch mission does the rest
//                                                  (Animals.labClimb); done when it sits on the glass, `failed` (a sentence) when there is no way or it gives up
export function makeDrive(spec) {
  const d = { ...spec, done: false, laps: 0, i: 0, dir: 1, reached: 0 };
  d.tol = spec.tol ?? 1.5;
  if (d.type === 'path') { d.mode = spec.mode ?? 'loop'; d.closed = spec.closed ?? d.mode === 'loop'; }
  if (d.type === 'follow') d.keep = spec.keep ?? 3;
  return d;
}

// On from waypoint `idx` of a path to the one after it: a lap counted at the end of a loop, a turn round at the end of a ping-pong,
// done at the end of a pass.
function advance(d, idx) {
  const n = d.pts.length;
  let nx = idx + d.dir;
  if (d.closed) { if (nx >= n) { nx = 0; d.laps++; } else if (nx < 0) { nx = n - 1; d.laps++; } }
  else if (nx >= n || nx < 0) {
    if (d.mode === 'pingpong') { d.dir = -d.dir; nx = idx + d.dir; d.laps++; }
    else { d.done = true; d.laps++; return; }
  }
  d.i = nx;
}

// The waypoint it is heading for cannot be stood on (it lies inside an obstacle): on to the next, counted as skipped, not reached.
export function skipWaypoint(d) {
  if (d.type !== 'path' || d.done || !d.pts.length) return;
  const n = d.pts.length;
  d.skipped = (d.skipped ?? 0) + 1;
  d.hold = 0;
  advance(d, d.closed ? ((d.i % n) + n) % n : clamp(d.i, 0, n - 1));
}

// One step of a drive from position p: returns { goal: { x, z } | null, done, pace }. `dots`: { [id]: { x, z } }. `dt`: seconds since
// the last step, for a waypoint that makes the animal wait (a stop in a random path). `pace`: what the goal waypoint asks of the walking
// pace (1 = the drive's own).
export function driveStep(d, p, dots = {}, dt = 0, onWall = false) {
  if (d.done) return { goal: null, done: true };
  switch (d.type) {
    case 'goto': {
      if (d.wall) {
        // (on the wall the animal's depth is the relief's: only across and up count)
        if (onWall && Math.hypot(p.x - d.x, p.y - d.y) <= d.tol) { d.done = true; d.reached++; return { goal: null, done: true }; }
        return { goal: { x: d.x, y: d.y, z: d.z, wall: true }, done: false };
      }
      if (dist2(p, d) <= d.tol) { d.done = true; d.reached++; return { goal: null, done: true }; }
      return { goal: { x: d.x, z: d.z }, done: false };
    }
    case 'follow': {
      const t = dots[d.dot];
      if (!t) return { goal: null, done: false };
      return dist2(p, t) <= d.keep ? { goal: null, done: false } : { goal: { x: t.x, z: t.z }, done: false };
    }
    case 'path': {
      const pts = d.pts, n = pts.length;
      if (!n) return { goal: null, done: true };
      if (d.hold > 0) { d.hold -= dt; if (d.hold > 0) return { goal: null, done: false }; }
      // Reached the waypoint it is heading for (or one of the next two: a corner cut, a body slid along a rock): on to the one after.
      for (let look = 0; look < 3 && look < n; look++) {
        const j = d.i + look * d.dir;
        const idx = d.closed ? ((j % n) + n) % n : j;
        if (idx < 0 || idx >= n || dist2(p, pts[idx]) > d.tol) continue;
        d.reached++;
        if (pts[idx].wait > 0) d.hold = pts[idx].wait;
        advance(d, idx);
        if (d.done) return { goal: null, done: true };
        break;
      }
      if (d.hold > 0) return { goal: null, done: false };
      const t = pts[d.closed ? ((d.i % n) + n) % n : clamp(d.i, 0, n - 1)];
      return { goal: { x: t.x, z: t.z }, done: false, pace: t.pace ?? 1 };
    }
  }
  return { goal: null, done: true };
}
