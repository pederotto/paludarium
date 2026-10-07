// The test lab's route planner (src/sim/labroute.js): a grid of the floor, A* over it, the route pulled straight. Pure numbers, no scene.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Grid, planRoute } from '../src/sim/labroute.js';

// A 45 x 45 cm floor in 1.5 cm cells with `rects` ([x0, z0, x1, z1] cm) blocked.
const floor = (rects = []) => {
  const g = new Grid(-22.5, -22.5, 1.5, 30, 30);
  g.fill((x, z) => rects.some(([x0, z0, x1, z1]) => x >= x0 && x <= x1 && z >= z0 && z <= z1));
  return g;
};
const legsOpen = (g, from, pts) => { let p = from; for (const q of pts) { if (!g.lineFree(p.x, p.z, q.x, q.z, 1)) return false; p = q; } return true; };
const length = (from, pts) => { let s = 0, p = from; for (const q of pts) { s += Math.hypot(q.x - p.x, q.z - p.z); p = q; } return s; };

test('open floor: the route is the straight line to the goal', () => {
  const r = planRoute(floor(), -10, -10, 12, 8);
  assert.deepEqual(r.pts, [{ x: 12, z: 8 }]);
  assert.equal(r.clipped, false);
});

test('a log across the way: the route goes round its end, every leg open, not much longer than it has to be', () => {
  // a log 23 cm long and 4.5 cm thick across x = 0, from z = -6 to z = 17
  const g = floor([[-2.25, -6, 2.25, 17]]);
  const from = { x: -10, z: 5 }, to = { x: 10, z: 5 };
  const r = planRoute(g, from.x, from.z, to.x, to.z);
  assert.equal(r.clipped, false);
  assert.ok(r.pts.length >= 2, 'a corner or two');
  assert.deepEqual(r.pts[r.pts.length - 1], to, 'ends at the goal');
  assert.ok(legsOpen(g, from, r.pts), 'no leg crosses the log');
  // round the near (z = -6) end: out 11 cm, across 20 and back: about 40 cm, not a wander
  assert.ok(length(from, r.pts) < 44, `route length ${length(from, r.pts).toFixed(1)}`);
});

test('a wall with a gap: the route goes through the gap', () => {
  const g = floor([[-1.5, -22.5, 1.5, -3], [-1.5, 3, 1.5, 22.5]]);   // a gap between z = -3 and z = 3
  const r = planRoute(g, -12, 15, 12, 15);
  assert.equal(r.clipped, false);
  assert.ok(legsOpen(g, { x: -12, z: 15 }, r.pts));
  assert.ok(r.pts.some((p) => Math.abs(p.z) < 3.5 && Math.abs(p.x) < 4), 'a point in the gap');
});

test('a goal inside an obstacle: the route ends at the nearest open place and says so', () => {
  const g = floor([[-2.25, -6, 2.25, 17]]);
  const r = planRoute(g, -10, 5, 0.5, 5);
  assert.equal(r.clipped, true);
  const e = r.pts[r.pts.length - 1];
  assert.ok(!g.blockedAt(e.x, e.z), 'the end is open');
  assert.ok(Math.hypot(e.x - 0.5, e.z - 5) < 4.5, `near the goal (${e.x}, ${e.z})`);
});

test('a goal in a closed pen: it goes as near as it can get', () => {
  const g = floor([[-6, -6, 6, -4], [-6, 4, 6, 6], [-6, -6, -4, 6], [4, -6, 6, 6]]);   // a ring of wall round the middle
  const r = planRoute(g, -15, 0, 0, 0);
  assert.equal(r.clipped, true);
  const e = r.pts[r.pts.length - 1];
  assert.ok(!g.blockedAt(e.x, e.z));
  assert.ok(Math.hypot(e.x, e.z) > 4, 'it stays outside the ring');
});

test('a start inside a blocked cell (its clearance overlaps one) still gets a route out', () => {
  const g = floor([[-2.25, -6, 2.25, 17]]);
  const r = planRoute(g, 1.6, 5, 10, 5);
  assert.ok(r && r.pts.length >= 1);
  assert.deepEqual(r.pts[r.pts.length - 1], { x: 10, z: 5 });
});

test('nowhere open: no route', () => {
  const g = floor([[-30, -30, 30, 30]]);
  assert.equal(planRoute(g, 0, 0, 5, 5), null);
});

test('outside the floor counts as blocked, and the nearest open cell is found in rings', () => {
  const g = floor();
  assert.equal(g.blockedAt(30, 0), true);
  const g2 = floor([[-3, -3, 3, 3]]);
  const n = g2.nearestFree(0, 0);
  assert.ok(Math.hypot(n.x, n.z) > 3 && Math.hypot(n.x, n.z) < 6);
});

// A floor with a log across x = 0 (z from -zlen to +zlen) that a body can climb over at `cost` per cell, and glass margins all round.
const climbable = (zlen, cost) => {
  const g = new Grid(-22.5, -22.5, 1.5, 30, 30);
  g.fill((x, z) => false, (x, z) => (Math.abs(x) <= 2.25 && Math.abs(z) <= zlen ? cost : 1));
  return g;
};

test('a log a body can climb over: it goes over when going round is much longer, round when that is cheap', () => {
  const from = { x: -10, z: 0 }, to = { x: 10, z: 0 };
  const longLog = planRoute(climbable(21, 3), from.x, from.z, to.x, to.z);          // a log nearly wall to wall: round is 40+ cm longer
  assert.equal(longLog.clipped, false);
  const crosses = longLog.pts.some((p, i, a) => { const q = i ? a[i - 1] : from; return (q.x < -2 && p.x > 2) || (q.x > 2 && p.x < -2) || Math.abs(p.x) < 2.25; });
  assert.ok(crosses, 'over the log');
  const shortLog = planRoute(climbable(3, 3), from.x, from.z, to.x, to.z);           // a short log: round it costs 2 cm more
  assert.ok(shortLog.pts.every((p) => Math.abs(p.x) >= 2.25 || Math.abs(p.z) > 3), 'round the short log, not over it');
});

test('a shortcut never cuts across a costly cell the route went round', () => {
  const g = climbable(3, 8);
  const r = planRoute(g, -10, 0, 10, 0);
  let p = { x: -10, z: 0 }, over = 0;
  for (const q of r.pts) { over += g.lineCost(p.x, p.z, q.x, q.z) - Math.hypot(q.x - p.x, q.z - p.z); p = q; }
  assert.ok(over < 1, `extra cost of the whole route ${over.toFixed(1)}`);
});

test('lineCost: the length on plain ground, more over a costly stretch', () => {
  const g = climbable(21, 3);
  assert.ok(Math.abs(g.lineCost(-10, 10, 10, 10) - g.lineCost(-10, 10, 10, 10)) < 1e-9);
  assert.ok(g.lineCost(-10, 0, 10, 0) > 20 + 4, 'over the log costs more than its length');
  assert.ok(Math.abs(g.lineCost(5, 0, 15, 0) - 10) < 1e-6, 'plain ground costs its length');
});
