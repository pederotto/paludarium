// Pure placement maths: clamping a rotated, scaled piece inside the glass, plant canopies, and
// the face placement frame. Run with: node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { hullPoints, transformedBox, boxShift, boxInside, plantFit, nearestWall, faceQuat, faceOrigin, GLASS_MARGIN, FACE_EMBED, rollLook, TINTS, restLift, lieLift, plantLift, groundNormal } from '../src/sim/placement.js';

const TANKS = [{ w: 90, d: 45, h: 60 }, { w: 30, d: 30, h: 30 }, { w: 150, d: 60, h: 70 }];

// A column-major matrix for yaw, tilt (about x), non-uniform scale and a position.
function matrix({ yaw = 0, tilt = 0, s = [1, 1, 1], p = [0, 0, 0] }) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cx = Math.cos(tilt), sx = Math.sin(tilt);
  // R = Ry * Rx, then M = T * R * S
  const r = [
    [cy, sy * sx, sy * cx],
    [0, cx, -sx],
    [-sy, cy * sx, cy * cx],
  ];
  const e = new Array(16).fill(0);
  for (let c = 0; c < 3; c++) for (let rr = 0; rr < 3; rr++) e[c * 4 + rr] = r[rr][c] * s[c];
  e[12] = p[0]; e[13] = p[1]; e[14] = p[2]; e[15] = 1;
  return e;
}

// A lumpy "rock": a box of random points with a long thin spike, so the extremes matter.
function rock(n = 4000) {
  const a = new Float32Array(n * 3);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let i = 0; i < n; i++) { a[i * 3] = (rnd() - 0.5) * 10; a[i * 3 + 1] = rnd() * 6; a[i * 3 + 2] = (rnd() - 0.5) * 7; }
  a.set([16, 3, 0.2], 0);       // a spike far out along +x
  return a;
}

test('hullPoints keeps the extremes of a mesh', () => {
  const pts = rock(20000);
  const hull = hullPoints(pts, 300);
  assert.ok(hull.length / 3 <= 300 + 30);
  const max = (a, k) => { let m = -Infinity; for (let i = k; i < a.length; i += 3) m = Math.max(m, a[i]); return m; };
  assert.equal(max(hull, 0), 16);
});

test('every piece type at every wall, in any turn and scale, ends up inside the glass', () => {
  const pts = hullPoints(rock());
  for (const tank of TANKS) {
    for (const yaw of [0, 0.7, 1.9, 3.14, -2.2]) for (const tilt of [0, 0.3, -0.4]) for (const s of [[1, 1, 1], [2.5, 1, 0.5], [-1.4, 1.2, 1.1], [0.4, 3, 0.4]]) {
      for (const p of [[-1e3, 5, 0], [1e3, 5, 0], [0, 5, -1e3], [0, 5, 1e3], [1e3, 5, 1e3], [-1e3, 5, -1e3], [0, 0, 0], [0, -30, 0]]) {
        const box = transformedBox(pts, matrix({ yaw, tilt, s, p }));
        const [dx, dy, dz] = boxShift(box, tank);
        const moved = { min: [box.min[0] + dx, box.min[1] + dy, box.min[2] + dz], max: [box.max[0] + dx, box.max[1] + dy, box.max[2] + dz] };
        const fits = box.max[0] - box.min[0] <= tank.w - 2 * GLASS_MARGIN && box.max[2] - box.min[2] <= tank.d - 2 * GLASS_MARGIN;
        if (fits) assert.ok(boxInside(moved, tank), `yaw ${yaw} tilt ${tilt} s ${s} p ${p} in ${tank.w}x${tank.d}: ${JSON.stringify(moved)}`);
        else assert.ok(moved.min[1] >= -1e-6);
        // A piece already inside is left alone.
        const [ex, , ez] = boxShift(moved, tank);
        if (fits) assert.ok(Math.abs(ex) < 1e-9 && Math.abs(ez) < 1e-9);
      }
    }
  }
});

test('the old centre-only clamp let a big piece through the glass; the box clamp does not', () => {
  const tank = TANKS[0];
  const box = transformedBox(hullPoints(rock()), matrix({ yaw: 0.4, s: [3, 1, 3], p: [tank.w / 2 - 1, 3, 0] }));   // centre exactly at the old limit
  assert.ok(box.max[0] > tank.w / 2);
  const [dx] = boxShift(box, tank);
  assert.ok(dx < 0 && box.max[0] + dx <= tank.w / 2 - GLASS_MARGIN + 1e-9);
});

test('a piece never ends up below the glass floor, and keeps off the lid when it fits', () => {
  const tank = TANKS[0];
  const pts = hullPoints(rock());
  const low = transformedBox(pts, matrix({ p: [0, -12, 0] }));
  assert.ok(low.min[1] + boxShift(low, tank)[1] >= -1e-9);
  const high = transformedBox(pts, matrix({ p: [0, 58, 0] }));
  assert.ok(high.max[1] + boxShift(high, tank)[1] <= tank.h - 0.99);
});

test('plant canopies stay inside: stem clear of the glass, the rest leaned inward', () => {
  for (const tank of TANKS) for (const reach of [2, 6, 13, 30]) {
    for (let x = -tank.w / 2 - 5; x <= tank.w / 2 + 5; x += 3.7) for (let z = -tank.d / 2 - 5; z <= tank.d / 2 + 5; z += 3.1) {
      const f = plantFit(x, z, reach, tank);
      const R = Math.min(reach, Math.min(tank.w, tank.d) / 3);
      assert.ok(f.x >= -tank.w / 2 && f.x <= tank.w / 2 && f.z >= -tank.d / 2 && f.z <= tank.d / 2);
      // the canopy reach*cos(lean) towards each wall is no more than the distance to it
      const c = Math.cos(f.lean);
      for (const dist of [f.x + tank.w / 2, tank.w / 2 - f.x, f.z + tank.d / 2, tank.d / 2 - f.z]) {
        if (dist >= R) continue;
        assert.ok(f.lean > 0, 'near a wall it leans');
        assert.ok(R * c <= dist * 1.0001 + 0.25 + R * (1 - c) * 0.35 || f.lean >= 0.75 - 1e-9, `reach ${R} dist ${dist} lean ${f.lean}`);
      }
    }
  }
  // Wall plants are only held in x.
  const f = plantFit(0, -22.5, 8, TANKS[0], { clampZ: false });
  assert.equal(f.z, -22.5);
  // Mid-tank plants stand straight.
  assert.equal(plantFit(0, 0, 8, TANKS[0]).lean, 0);
});

test('nearestWall picks the back or a side', () => {
  const t = TANKS[0];
  assert.equal(nearestWall(0, -20, t).wall, 'back');
  assert.equal(nearestWall(-40, 0, t).wall, 'left');
  assert.equal(nearestWall(40, 0, t).wall, 'right');
  assert.deepEqual(nearestWall(-40, 0, t).n, [1, 0, 0]);
});

test('faceQuat turns local +z onto the normal without rolling', () => {
  const rotate = (q, v) => {
    const [x, y, z, w] = q, [vx, vy, vz] = v;
    const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
    return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
  };
  for (const n of [[0, 0, 1], [1, 0, 0], [-1, 0, 0], [0.6, 0.8, 0], [0, 0.7, 0.7], [0.3, 0.5, -0.8], [0, 1, 0], [0, -1, 0]]) {
    const l = Math.hypot(...n), nn = n.map((v) => v / l);
    const q = faceQuat(nn);
    assert.ok(Math.abs(q.reduce((a, v) => a + v * v, 0) - 1) < 1e-9);
    const z = rotate(q, [0, 0, 1]);
    nn.forEach((v, i) => assert.ok(Math.abs(z[i] - v) < 1e-9, `n ${n} -> ${z}`));
    // roll-free: local x stays horizontal
    assert.ok(Math.abs(rotate(q, [1, 0, 0])[1]) < 1e-9);
  }
});

test('a face piece sinks a fixed depth into the wall behind it', () => {
  const o = faceOrigin([0, 5, -22], [0, 0, 1], 10);
  assert.ok(Math.abs(o[2] - (-22 + 10 - FACE_EMBED)) < 1e-9);
  assert.equal(o[1], 5);
  // the back plane (origin minus 10 along n) is FACE_EMBED behind the surface
  assert.ok(Math.abs((o[2] - 10) - (-22 - FACE_EMBED)) < 1e-9);
});

test('rollLook is deterministic, covers every variant, and varies scale, flip and tint', () => {
  assert.deepEqual(rollLook('boulder', 99, 17), rollLook('boulder', 99, 17));
  const seen = new Set(), tints = new Set(), flips = new Set();
  for (let s = 1; s < 400; s++) {
    const l = rollLook('spire', s, 8);
    assert.ok(l.variant >= 0 && l.variant < 8);
    assert.ok(l.tint >= 0 && l.tint < TINTS.length);
    assert.ok(l.scale.every((v) => v > 0.8 && v < 1.25));
    seen.add(l.variant); tints.add(l.tint); flips.add(l.flip);
  }
  assert.equal(seen.size, 8);
  assert.ok(tints.size >= 5 && flips.size === 2);
  // a pool restricts the choice
  for (let s = 1; s < 50; s++) assert.ok([3, 5].includes(rollLook('boulder', s, 17, [3, 5]).variant));
});

// --- Sitting on the ground (decor.js settle) ---
// A flat slab 10 x 10 cm, 1 cm thick, its bottom at y = 0, as points; and a log lying along x, radius 2, tilted up by `t`.
const slab = () => { const a = []; for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) a.push(i - 5, 0, j - 5, i - 5, 1, j - 5); return a; };
function log(t) {
  const a = [];
  for (let i = 0; i <= 20; i++) for (let k = 0; k < 12; k++) {
    const x = i - 10, th = (k / 12) * Math.PI * 2, y = 2 + 2 * Math.cos(th), z = 2 * Math.sin(th);
    a.push(x * Math.cos(t) - y * Math.sin(t), x * Math.sin(t) + y * Math.cos(t), z);
  }
  return a;
}
const lowestGap = (pts, lift, ground) => { let g = Infinity; for (let i = 0; i < pts.length; i += 3) g = Math.min(g, pts[i + 1] + lift - ground(pts[i], pts[i + 2])); return g; };

test('restLift: a piece rests on its lowest contact, nothing under the ground, on flat and sloped ground', () => {
  for (const ground of [() => 3, (x) => 3 + 0.4 * x, (x, z) => 2 + 0.2 * x - 0.3 * z]) {
    for (const pts of [slab(), log(0), log(0.6), log(-1.3)]) {
      const up = restLift(pts, ground);
      assert.ok(Math.abs(lowestGap(pts, up, ground)) < 1e-9, 'touches, no gap and no point under the ground');
    }
  }
  // a tilted log on flat ground: its lowest end touches (the old way, the box of its middle, left a raised log hanging)
  const pts = log(0.5), up = restLift(pts, () => 0);
  let lo = Infinity; for (let i = 1; i < pts.length; i += 3) lo = Math.min(lo, pts[i]);
  assert.ok(Math.abs(lo + up) < 1e-9);
});

test('plantLift: the whole base sits at or under the ground, so no edge hangs over a slope', () => {
  const ground = (x) => 5 + 0.5 * x;                 // a steep slope rising toward +x
  const pts = slab(), up = plantLift(pts, ground, 0.5);
  for (let i = 0; i < pts.length; i += 3) if (pts[i + 1] <= 0.5) assert.ok(pts[i + 1] + up <= ground(pts[i]) + 1e-9, 'base point above the ground');
  // the downhill edge just touches: the piece is not sunk deeper than it must be
  assert.ok(Math.abs(up - ground(-5)) < 1e-9);
  // on flat ground it sits exactly on it
  assert.ok(Math.abs(plantLift(pts, () => 2, 0.5) - 2) < 1e-9);
  // planted goes deeper than resting on a slope, resting never goes under the ground
  assert.ok(plantLift(pts, ground) < restLift(pts, ground));
});

test('lieLift: on a bank steeper than the piece lies, its low end comes down to the ground; elsewhere it rests', () => {
  // a slab tilted 0.6 rad up toward +x (as followSlope leaves it) on a 1.2 rad bank rising the same way: resting, it hangs on its high end
  const t = 0.6, pts = slab().map((v, i, a) => (i % 3 === 0 ? v * Math.cos(t) - a[i + 1] * Math.sin(t) : i % 3 === 1 ? a[i - 1] * Math.sin(t) + v * Math.cos(t) : v));
  const bank = (x) => 10 + Math.tan(1.2) * x, band = 1;
  const rest = restLift(pts, bank), lie = lieLift(pts, bank, band);
  let lo = Infinity; for (let i = 1; i < pts.length; i += 3) lo = Math.min(lo, pts[i]);
  let near = Infinity;
  for (let i = 0; i < pts.length; i += 3) if (pts[i + 1] <= lo + band) near = Math.min(near, pts[i + 1] + lie - bank(pts[i]));
  assert.ok(lie < rest - 1, 'digs in instead of hanging');
  assert.ok(near <= 0.25 + 1e-9, 'its low end reaches the ground');
  // on flat ground, a gentle slope and for a tilted log it is just resting
  for (const ground of [() => 3, (x) => 3 + 0.2 * x]) for (const p of [slab(), log(0.5)]) assert.ok(Math.abs(lieLift(p, ground, 1) - restLift(p, ground)) < 1e-9);
});

test('groundNormal fits the plane under a footprint and limits the tilt', () => {
  const smp = (f) => { const a = []; for (let i = 0; i <= 3; i++) for (let j = 0; j <= 3; j++) { const x = i * 4 - 6, z = j * 4 - 6; a.push(x, f(x, z), z); } return a; };
  assert.deepEqual(groundNormal(smp(() => 4)).map((v) => +v.toFixed(9)), [0, 1, 0]);
  const n = groundNormal(smp((x, z) => 1 + 0.3 * x - 0.2 * z));
  const want = [-0.3, 1, 0.2], l = Math.hypot(...want);
  n.forEach((v, i) => assert.ok(Math.abs(v - want[i] / l) < 1e-9, `normal ${n}`));
  // a cliff is clamped to the largest tilt
  const c = groundNormal(smp((x) => 5 * x), 0.6);
  assert.ok(Math.abs(Math.acos(c[1]) - 0.6) < 1e-9 && c[0] < 0 && Math.abs(c[2]) < 1e-9);
  // noise around a plane averages out
  let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32 - 0.5) * 0.2;
  const m = groundNormal(smp((x) => 0.25 * x + rnd()));
  assert.ok(Math.abs(Math.atan2(-m[0], m[1]) - Math.atan(0.25)) < 0.05);
});
