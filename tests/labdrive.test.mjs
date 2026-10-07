// The test lab's drives (src/sim/labdrive.js): paths, dots and the step from a drive to a goal. Pure numbers, no scene.
import test from 'node:test';
import assert from 'node:assert/strict';
import { circle, figure8, square, zigzag, line, pathLength, resample, clampTo, crossTrack, makeDot, dotStep, makeDrive, driveStep, dist2, PANES, panePoint, GLASS_OFF } from '../src/sim/labdrive.js';

const B = { x0: -45, x1: 45, z0: -22, z1: 22 };

test('a figure of eight starts at its crossing, reaches both lobes, and crosses itself once more', () => {
  const p = figure8(0, 0, 30, 12, 72);
  assert.ok(dist2(p[0], { x: 0, z: 0 }) < 1e-9, 'starts at the middle');
  assert.ok(Math.max(...p.map((q) => q.x)) > 29.9 && Math.min(...p.map((q) => q.x)) < -29.9, 'x reaches both lobes');
  assert.ok(Math.max(...p.map((q) => q.z)) > 11.9 && Math.min(...p.map((q) => q.z)) < -11.9, 'z swings both ways');
  // it passes through the middle twice a lap: at t = 0 and t = pi
  const near = p.filter((q) => dist2(q, { x: 0, z: 0 }) < 1.5);
  assert.equal(near.length, 2, 'points at the crossing: the start and the half-lap');
});

test('a circle has the radius asked for and a square four corners', () => {
  for (const q of circle(5, -3, 10, 10, 40)) assert.ok(Math.abs(Math.hypot(q.x - 5, q.z + 3) - 10) < 1e-9);
  assert.equal(square(0, 0, 20, 10).length, 4);
  assert.ok(Math.abs(pathLength(square(0, 0, 20, 10), true) - 60) < 1e-9);
});

test('a zig-zag goes along z in each column and steps across x between them', () => {
  const z = zigzag(0, 0, 40, 20, 4);
  assert.equal(z.length, 10);
  assert.deepEqual(z[0], { x: -20, z: -10 }); assert.deepEqual(z[1], { x: -20, z: 10 });
  assert.deepEqual(z[2], { x: -10, z: 10 }); assert.deepEqual(z[3], { x: -10, z: -10 });
});

test('resample keeps the corners and puts no two points further apart than the spacing', () => {
  const sq = square(0, 0, 20, 20), r = resample(sq, 3, true);
  for (let i = 0; i < r.length; i++) assert.ok(dist2(r[i], r[(i + 1) % r.length]) <= 3 + 1e-9);
  for (const c of sq) assert.ok(r.some((q) => dist2(q, c) < 1e-9), 'a corner was lost');
  assert.ok(Math.abs(pathLength(r, true) - 80) < 1e-6, 'the length changed');
});

test('clampTo keeps every point inside the floor', () => {
  for (const q of clampTo(figure8(0, 0, 80, 40), B, 3)) assert.ok(q.x >= -42 && q.x <= 42 && q.z >= -19 && q.z <= 19);
});

test('cross-track error is the distance to the line, not to the waypoints', () => {
  const l = line(0, 0, 10, 0);
  assert.equal(crossTrack(l, { x: 5, z: 3 }), 3);
  assert.equal(crossTrack(l, { x: -4, z: 3 }), 5);
  const sq = square(0, 0, 10, 10);
  assert.ok(Math.abs(crossTrack(sq, { x: 0, z: -5 }, true)) < 1e-9, 'on the closing edge of a closed path');
  assert.equal(crossTrack(sq, { x: 0, z: 0 }, true), 5);
});

test('a goto drive names its goal until the animal is within tolerance, then is done', () => {
  const d = makeDrive({ type: 'goto', x: 10, z: 0, tol: 1.5 });
  assert.deepEqual(driveStep(d, { x: 0, z: 0 }).goal, { x: 10, z: 0 });
  const r = driveStep(d, { x: 9, z: 0.5 });
  assert.equal(r.done, true); assert.equal(r.goal, null);
  assert.equal(driveStep(d, { x: 0, z: 0 }).goal, null, 'stays done');
});

test('a looping path goes round: each waypoint in turn, counting laps', () => {
  const pts = square(0, 0, 10, 10);
  const d = makeDrive({ type: 'path', pts, mode: 'loop', tol: 1 });
  let p = { x: -5, z: -5 }, order = [];
  for (let k = 0; k < 9; k++) { const r = driveStep(d, p); order.push(`${r.goal.x},${r.goal.z}`); p = { ...r.goal }; }
  assert.deepEqual(order.slice(0, 5), ['5,-5', '5,5', '-5,5', '-5,-5', '5,-5']);
  assert.ok(d.laps >= 2, `laps ${d.laps}`);
});

test('a once path ends done; a ping-pong path turns round at the end', () => {
  const pts = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 20, z: 0 }];
  const once = makeDrive({ type: 'path', pts, mode: 'once', tol: 1 });
  let p = { x: 0, z: 0 }, goals = [];
  for (let k = 0; k < 6 && !once.done; k++) { const r = driveStep(once, p); if (r.goal) { goals.push(r.goal.x); p = { ...r.goal }; } }
  assert.equal(once.done, true); assert.deepEqual(goals, [10, 20]);
  const pp = makeDrive({ type: 'path', pts, mode: 'pingpong', tol: 1 });
  p = { x: 0, z: 0 }; goals = [];
  for (let k = 0; k < 8; k++) { const r = driveStep(pp, p); goals.push(r.goal.x); p = { ...r.goal }; }
  assert.deepEqual(goals, [10, 20, 10, 0, 10, 20, 10, 0]);
  assert.equal(pp.done, false);
});

test('a path does not skip far ahead: only the next two waypoints count as reached', () => {
  const pts = resample(figure8(0, 0, 30, 12, 72), 3, true);
  const d = makeDrive({ type: 'path', pts, mode: 'loop', tol: 1.5 });
  // standing at the crossing at the start, the drive must not jump to the half-lap point that is also at the crossing
  const r = driveStep(d, { x: 0, z: 0 });
  assert.ok(d.i <= 2, `jumped to waypoint ${d.i}`);
  assert.ok(r.goal);
});

test('a follow drive waits inside the keep distance and chases outside it', () => {
  const d = makeDrive({ type: 'follow', dot: 'a', keep: 4 });
  assert.equal(driveStep(d, { x: 0, z: 0 }, {}).goal, null, 'no dot, no goal');
  assert.equal(driveStep(d, { x: 0, z: 0 }, { a: { x: 3, z: 0 } }).goal, null);
  assert.deepEqual(driveStep(d, { x: 0, z: 0 }, { a: { x: 9, z: 0 } }).goal, { x: 9, z: 0 });
});

test('a wandering dot stays inside the floor, moves at its speed, and repeats for a seed', () => {
  const run = (seed) => {
    const d = makeDot({ kind: 'wander', x: 0, z: 0, speed: 4, seed }), trail = [];
    for (let k = 0; k < 4000; k++) { const px = d.x, pz = d.z; dotStep(d, 0.05, B); trail.push([d.x, d.z]); assert.ok(Math.hypot(d.x - px, d.z - pz) <= 4 * 0.05 + 1e-9, 'faster than its speed'); }
    return trail;
  };
  const a = run(7), b = run(7), c = run(8);
  for (const [x, z] of a) assert.ok(x >= B.x0 && x <= B.x1 && z >= B.z0 && z <= B.z1);
  assert.deepEqual(a, b, 'the same seed must give the same walk');
  assert.notDeepEqual(a, c, 'a different seed must differ');
  assert.ok(Math.hypot(a.at(-1)[0], a.at(-1)[1]) + Math.max(...a.map(([x]) => Math.abs(x))) > 5, 'it did move');
});

test('an orbiting dot keeps its radius and goes round at speed / radius', () => {
  const d = makeDot({ kind: 'orbit', cx: 0, cz: 0, r: 10, speed: 5, ang: 0 });
  for (let k = 0; k < 200; k++) { dotStep(d, 0.1, B); assert.ok(Math.abs(Math.hypot(d.x, d.z) - 10) < 1e-9); }
  assert.ok(Math.abs(d.ang - (5 / 10) * 20) < 1e-9);
});

test('a go-to on the wall names its goal across and up, and is done only once the animal is on the wall within tolerance', () => {
  const d = makeDrive({ type: 'goto', wall: true, x: 10, y: 30, z: -22, tol: 2 });
  const r0 = driveStep(d, { x: 10, y: 3, z: 0 }, {}, 0, false);
  assert.deepEqual(r0.goal, { x: 10, y: 30, z: -22, wall: true });
  assert.equal(driveStep(d, { x: 10, y: 29, z: 0 }, {}, 0, false).done, false, 'on the floor below the point it is not there');
  assert.equal(driveStep(d, { x: 15, y: 30, z: -21 }, {}, 0, true).done, false, '5 cm along the wall is not there');
  const r = driveStep(d, { x: 10.5, y: 29.2, z: -21.9 }, {}, 0, true);
  assert.equal(r.done, true); assert.equal(r.goal, null);
});

// --- the glass panes a climbing frog is sent up ---
test('a pane\'s top of the climb is 0.12 cm off the glass, inside the tank, the normal turned into it, the place across the pane kept (clamped off the corners)', () => {
  const hx = 45, hz = 22;
  const f = panePoint('front', { x: 12, z: 3 }, hx, hz, 28), l = panePoint('left', { x: 0, z: -4 }, hx, hz), r = panePoint('right', { x: 0, z: 40 }, hx, hz, 20);
  assert.deepEqual(PANES, ['front', 'left', 'right']);
  assert.equal(f.top.z, hz - GLASS_OFF); assert.equal(f.top.x, 12); assert.equal(f.top.y, 28); assert.deepEqual(f.N, { x: 0, y: 0, z: -1 });
  assert.equal(l.top.x, -hx + GLASS_OFF); assert.equal(l.top.z, -4); assert.deepEqual(l.N, { x: 1, y: 0, z: 0 }); assert.equal(l.yaw, -Math.PI / 2);
  assert.equal(r.top.x, hx - GLASS_OFF); assert.equal(r.top.z, hz - 10, 'a place past the corner is brought 10 cm in'); assert.equal(r.top.y, 20); assert.equal(r.yaw, Math.PI / 2);
  // (the normal points into the tank: from the pane toward the frog)
  assert.ok(f.N.z < 0 && l.N.x > 0 && r.N.x < 0);
  assert.equal(panePoint('nonsense', { x: 100, z: 0 }, hx, hz).top.x, hx - 10, 'an unknown pane is the front, clamped');
});
test('a climb drive is plain data the sim reads: it is not finished by driveStep', () => {
  const d = makeDrive({ type: 'climb', pane: 'right', top: 28 });
  assert.equal(d.type, 'climb'); assert.equal(d.pane, 'right'); assert.equal(d.done, false);
});
