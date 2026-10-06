// The test lab's random paths and scenarios (src/sim/labrandom.js): repeatable from a seed, always inside the floor, and shaped as asked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomPath, randomScenario, STYLES, pathLen, mix } from '../src/sim/labrandom.js';
import { resample, makeDrive, driveStep } from '../src/sim/labdrive.js';

const B = { x0: -45, x1: 45, z0: -22.5, z1: 22.5 };
const inside = (pts, m = 3) => pts.every((p) => p.x >= B.x0 + m - 1e-9 && p.x <= B.x1 - m + 1e-9 && p.z >= B.z0 + m - 1e-9 && p.z <= B.z1 - m + 1e-9);

test('the same seed gives the same path, another seed another', () => {
  for (const style of Object.keys(STYLES)) {
    const a = randomPath(42, { style, bounds: B, obstacles: [{ x: 0, z: 0, r: 6 }] }), b = randomPath(42, { style, bounds: B, obstacles: [{ x: 0, z: 0, r: 6 }] }), c = randomPath(43, { style, bounds: B, obstacles: [{ x: 0, z: 0, r: 6 }] });
    assert.deepEqual(a, b, `${style}: not repeatable`);
    assert.notDeepEqual(a.pts, c.pts, `${style}: two seeds gave one path`);
  }
});

test('nearby seeds are not nearby paths: the seed is spread before it is used', () => {
  const heads = new Set();
  for (let s = 1; s <= 20; s++) { const p = randomPath(s, { style: 'wander', bounds: B, start: { x: 0, z: 0 } }); heads.add(Math.round(Math.atan2(p.pts[1].x, p.pts[1].z) * 4)); }
  assert.ok(heads.size >= 8, `20 seeds started in only ${heads.size} directions`);
  assert.notEqual(mix(1), mix(2));
});

test('every style stays inside the floor and runs about as long as asked', () => {
  for (const style of Object.keys(STYLES)) for (let s = 1; s <= 25; s++) {
    const p = randomPath(s, { style, length: 240, bounds: B, start: { x: (s * 7) % 60 - 30, z: (s * 3) % 30 - 15 }, obstacles: [{ x: -10, z: 3, r: 5 }, { x: 15, z: -8, r: 8 }] });
    assert.ok(inside(p.pts), `${style} seed ${s} left the floor`);
    assert.ok(p.pts.length >= 2, `${style} seed ${s}: no path`);
    if (style !== 'obstacles') assert.ok(pathLen(p.pts) >= 150, `${style} seed ${s}: only ${pathLen(p.pts).toFixed(0)} cm`);
  }
});

test('a mixed path mixes: across seeds it has straights, arcs, u-turns, zig-zags, loops, stops and changes of pace', () => {
  const seen = new Set();
  let waits = 0, paces = 0;
  for (let s = 1; s <= 40; s++) {
    const p = randomPath(s, { style: 'mixed', length: 300, bounds: B });
    for (const m of p.moves) seen.add(m.replace(/ [\d.]+$/, ''));
    waits += p.pts.filter((q) => q.wait > 0).length; paces += p.pts.filter((q) => q.pace != null).length;
  }
  for (const m of ['straight', 'arc', 'uturn', 'zigzag', 'loop', 'stop', 'pace']) assert.ok(seen.has(m), `never made a ${m}`);
  assert.ok(waits > 20 && paces > 20, `waits ${waits}, paces ${paces}`);
});

test('tight turns turn: most steps change heading by more than a quarter turn', () => {
  const p = randomPath(5, { style: 'tight', length: 200, bounds: B }).pts;
  let big = 0, n = 0;
  for (let i = 2; i < p.length; i++) {
    const a = Math.atan2(p[i - 1].x - p[i - 2].x, p[i - 1].z - p[i - 2].z), b = Math.atan2(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z);
    const d = Math.abs(((b - a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI); n++; if (d > Math.PI / 4) big++;
  }
  assert.ok(big / n > 0.6, `${big} of ${n}`);
});

test('a path at the obstacles goes through each one it is given', () => {
  const obs = [{ x: -12, z: 4, r: 6 }, { x: 14, z: -6, r: 5 }];
  const p = randomPath(9, { style: 'obstacles', bounds: B, obstacles: obs }).pts;
  for (const o of obs) {
    let closest = Infinity;
    for (let i = 1; i < p.length; i++) {      // distance from the obstacle's centre to the path as a line
      const a = p[i - 1], b = p[i], vx = b.x - a.x, vz = b.z - a.z, l2 = vx * vx + vz * vz || 1, t = Math.max(0, Math.min(1, ((o.x - a.x) * vx + (o.z - a.z) * vz) / l2));
      closest = Math.min(closest, Math.hypot(o.x - (a.x + vx * t), o.z - (a.z + vz * t)));
    }
    assert.ok(closest < o.r, `the path stayed ${closest.toFixed(1)} cm from an obstacle of radius ${o.r}`);
  }
});

test('along the glass keeps near the edge', () => {
  const p = randomPath(3, { style: 'edges', length: 260, bounds: B }).pts.slice(1);
  const near = p.filter((q) => Math.min(q.x - B.x0, B.x1 - q.x, q.z - B.z0, B.z1 - q.z) < 16);
  assert.ok(near.length / p.length > 0.7, `${near.length} of ${p.length} points near the glass`);
});

test('a path with stops makes the drive wait there, and a path with paces asks for them', () => {
  const pts = resample([{ x: 0, z: 0 }, { x: 10, z: 0, wait: 2 }, { x: 20, z: 0, pace: 1.5 }, { x: 30, z: 0 }], 3, false);
  const d = makeDrive({ type: 'path', pts, mode: 'once', tol: 1 });
  let p = { x: 0, z: 0 }, seenPace = [], waited = 0, steps = 0;
  while (!d.done && steps++ < 400) {
    const r = driveStep(d, p, {}, 0.5);
    if (!r.goal) { waited += 0.5; continue; }
    seenPace.push(r.pace); p = { ...r.goal };
  }
  assert.ok(d.done, 'did not finish');
  assert.ok(waited >= 1.5 && waited <= 3, `waited ${waited} s for a 2 s stop`);
  assert.ok(seenPace.includes(1.5) && seenPace.includes(1), `paces ${[...new Set(seenPace)]}`);
});

test('a random scenario is repeatable, in bounds, and built from the species it was given', () => {
  const pool = { land: ['toad', 'gecko', 'skink'], water: ['neon', 'betta'], shore: ['newt'] };
  const kinds = { flat: 0, shore: 0, wet: 0 };
  for (let s = 1; s <= 60; s++) {
    const a = randomScenario(s, { pool }), b = randomScenario(s, { pool });
    assert.deepEqual(a, b, `seed ${s} not repeatable`);
    assert.ok(a.animals.length >= 1 && a.animals.length <= 8, `${a.animals.length} animals`);
    const wet = a.depth > 0 && a.ground === 'flat';
    kinds[wet ? 'wet' : a.ground]++;
    for (const an of a.animals) {
      assert.ok(Math.abs(an.x) <= 45 && Math.abs(an.z) <= 22.5, 'an animal outside the floor');
      assert.ok((wet ? pool.water : [...pool.land, ...pool.shore]).includes(an.sp), `${an.sp} in the wrong place (wet=${wet})`);
    }
    for (const o of a.obstacles) assert.ok(Math.abs(o.x) <= 45 && Math.abs(o.z) <= 22.5);
    if (wet) assert.equal(a.obstacles.length, 0);
    for (const an of a.animals) if (an.drive?.type === 'follow') assert.ok(a.dots.some((d) => d.id === an.drive.dot));
  }
  assert.ok(kinds.flat > 5 && kinds.shore > 5 && kinds.wet > 3, JSON.stringify(kinds));
});
