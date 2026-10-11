// School separation by body axes (sim/schoolsep.js, R7).
import test from 'node:test';
import assert from 'node:assert/strict';
import { axisGap, pushMag, softStep, capLen, SOFT_CAP, SCHOOL_MARGIN } from '../src/sim/schoolsep.js';

const o = () => ({ d: 0, nx: 0, ny: 0, nz: 0 });
// bedotia: z0 -4.8 .. z1 4.8, half-width 1.5; both facing +z (yaw 0)
test('side by side: the gap is the lateral distance, normal points from B to A', () => {
  const r = axisGap(o(), 2, 0, 0, 0, -4.8, 4.8, 0, 0, 0, 0, -4.8, 4.8);
  assert.ok(Math.abs(r.d - 2) < 1e-9); assert.ok(Math.abs(r.nx - 1) < 1e-9 && Math.abs(r.nz) < 1e-9);
});
test('in line: bodies 5.6 apart overlap by 4 cm (gap 0), 9.6 apart just touch, 12 apart have a 2.4 gap', () => {
  assert.equal(axisGap(o(), 0, 0, 5.6, 0, -4.8, 4.8, 0, 0, 0, 0, -4.8, 4.8).d < 1e-9, true);
  assert.ok(Math.abs(axisGap(o(), 0, 0, 9.6, 0, -4.8, 4.8, 0, 0, 0, 0, -4.8, 4.8).d) < 1e-9);
  assert.ok(Math.abs(axisGap(o(), 0, 0, 12, 0, -4.8, 4.8, 0, 0, 0, 0, -4.8, 4.8).d - 2.4) < 1e-9);
});
test('axes on each other: the normal is a unit vector along the centres, else sideways (never NaN)', () => {
  let r = axisGap(o(), 0, 0, 5.6, 0, -4.8, 4.8, 0, 0, 0, 0, -4.8, 4.8);
  assert.ok(Math.abs(r.nz - 1) < 1e-9);
  r = axisGap(o(), 1, 2, 3, 0.7, -4.8, 4.8, 1, 2, 3, 0.7, -4.8, 4.8, -1);
  assert.ok(Math.abs(Math.hypot(r.nx, r.ny, r.nz) - 1) < 1e-9 && r.d === 0);
});
test('crossing axes and 3D: vertical offset counts, symmetric in A and B', () => {
  const r1 = axisGap(o(), 0, 1, 0, 0, -4.8, 4.8, 0, 0, 0, Math.PI / 2, -4.8, 4.8), r2 = axisGap(o(), 0, 0, 0, Math.PI / 2, -4.8, 4.8, 0, 1, 0, 0, -4.8, 4.8);
  assert.ok(Math.abs(r1.d - 1) < 1e-9 && Math.abs(r2.d - 1) < 1e-9 && r1.ny === 1 && r2.ny === -1);
});
test('the push grows with depth and is zero at no overlap', () => {
  assert.equal(pushMag(0), 0); assert.equal(pushMag(-1), 0);
  let p = 0; for (let k = 1; k <= 10; k++) { const m = pushMag(k / 10); assert.ok(m > p); p = m; }
  assert.ok(pushMag(0.5) > 0.35 * 9 / 5 + 0.6, 'beats cohesion (0.35 x 9 cm) + alignment (0.6 x speed) at half depth');
});
test('the soft position correction is zero unless deep, and never more than SOFT_CAP cm a call', () => {
  const lim = SCHOOL_MARGIN * 1.5;
  for (const g of [lim, 0.9 * lim, 0.5 * lim, 0.5 * lim + 1e-6]) assert.equal(softStep(g, lim), 0);
  for (let g = 0; g < 0.5 * lim; g += 0.01) { const s = softStep(g, lim); assert.ok(s > 0 && s <= SOFT_CAP); }
  assert.equal(softStep(0, 100), SOFT_CAP);
});
test('the summed correction of many neighbours is capped as one step', () => {
  const v = capLen({}, 3, 4, 0); assert.ok(Math.abs(Math.hypot(v.x, v.y, v.z) - SOFT_CAP) < 1e-9);
  const w = capLen({}, 0.01, 0, 0.02); assert.equal(w.x, 0.01); assert.equal(w.z, 0.02);
});
test('micro-benchmark: 24 fish, all pairs (no allocation per pair)', () => {
  const P = Array.from({ length: 24 }, (_, i) => ({ x: (i % 6) * 2, y: (i % 3) * 0.5, z: Math.floor(i / 6) * 2, yaw: i * 0.3 })), out = o();
  const t0 = process.hrtime.bigint(); let hits = 0;
  for (let rep = 0; rep < 2000; rep++) for (let i = 0; i < 24; i++) for (let j = 0; j < 24; j++) if (i !== j) { axisGap(out, P[i].x, P[i].y, P[i].z, P[i].yaw, -4.8, 4.8, P[j].x, P[j].y, P[j].z, P[j].yaw, -4.8, 4.8); if (out.d < 2.4) hits++; }
  const us = Number(process.hrtime.bigint() - t0) / 1e3 / 2000;
  console.log(`# axisGap 24 fish all pairs (552 calls): ${us.toFixed(1)} us per tick`);
  assert.ok(hits > 0 && us < 2000);
});
