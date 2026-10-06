// The swimming body's pose channels (render/creatures/skeleton.js poseStroke): trunk yaw / pitch / twist, per-side arms (12 numbers) and
// limb roll, all optional; absent or zero = the body as it rests, byte for byte. Signs: yaw + toward +x, pitch + nose down, twist + right side down.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { skeletonRig, poseStroke, GLIDING } from '../src/render/creatures/skeleton.js';
import { PLANS } from '../src/util/bodyplan.js';

const manifest = JSON.parse(fs.readFileSync(new URL('../public/assets/creatures/manifest.json', import.meta.url), 'utf8'));
const rig = skeletonRig(manifest['dartfrog.swim'].skeleton, {}), bi = rig.byName, rom = PLANS.anuran.rom, RAD = Math.PI / 180;
const row = (st, info = null) => { const b = new Float32Array(300); poseStroke(rig, st, b, 0, info); return b; };
const at = (r, b, p) => [0, 1, 2].map((i) => r[b * 12 + i * 4] * p[0] + r[b * 12 + i * 4 + 1] * p[1] + r[b * 12 + i * 4 + 2] * p[2] + r[b * 12 + i * 4 + 3]);
const sub = (a, b) => a.map((x, i) => x - b[i]);
const ang = (a, b) => Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / Math.hypot(...a) / Math.hypot(...b)))) / RAD;
const same = (a, b) => a.every((x, i) => x === b[i]);
const base = row(GLIDING), J = rig.head[bi.spine];

test('absent or zero channels leave every float as it was', () => {
  assert.ok(same(row({ ...GLIDING, trunk: [0, 0, 0, 0, 0, 0], roll: [0, 0, 0, 0, 0, 0] }), base));
  assert.ok(same(row({ ...GLIDING, trunk: new Float32Array(6) }), base));
});
test('trunk yaw / pitch / twist: the head point turns by that angle about the spine joint, with the signs', () => {
  const plane = (rel, i, j) => Math.atan2(rel[i], rel[j]) / RAD;       // angle in the plane of axes (i, j)
  const set = (k, v) => { const t = [0, 0, 0, 0, 0, 0]; t[k] = v; return at(row({ ...GLIDING, trunk: t }), bi.head, rig.head[bi.head]); };
  const p0 = sub(at(base, bi.head, rig.head[bi.head]), J);
  const dy = plane(sub(set(0, 20), J), 0, 2) - plane(p0, 0, 2);
  assert.ok(Math.abs(dy - 20) < 0.01, 'yaw 20 about the vertical, + toward +x: ' + dy);
  const dp = plane(sub(set(1, 15), J), 1, 2) - plane(p0, 1, 2);
  assert.ok(Math.abs(dp + 15) < 0.01, 'pitch 15, + nose down (y falls as z grows): ' + dp);
  // twist: the spine's +x axis tips down for +, about its own long axis (the bone's own direction stays)
  const t = row({ ...GLIDING, trunk: [0, 0, 20, 0, 0, 0] }), x = [t[bi.spine * 12], t[bi.spine * 12 + 4], t[bi.spine * 12 + 8]];
  assert.ok(x[1] < 0 && Math.abs(Math.asin(-x[1]) / RAD - 20) < 0.5, 'twist + right side down, 20 deg');
});
test('children follow: arms and head turn with the spine, the hind legs and pelvis do not, the hull moves', () => {
  const i0 = {}, i1 = {}; row(GLIDING, i0); const r = row({ ...GLIDING, trunk: [20, 0, 0, 0, 0, 0] }, i1);
  assert.ok(same(r.subarray(0, 12), base.subarray(0, 12)), 'pelvis');
  for (const n of ['thighL', 'thighR', 'shinL', 'footR']) assert.ok(same(r.subarray(bi[n] * 12, bi[n] * 12 + 12), base.subarray(bi[n] * 12, bi[n] * 12 + 12)), n);
  const h = [0, 1, 2].map((i) => at(r, bi.armL, rig.head[bi.armL])[i] - J[i]), h0 = [0, 1, 2].map((i) => at(base, bi.armL, rig.head[bi.armL])[i] - J[i]);
  assert.ok(Math.abs(ang(h, h0) - 20) < 0.5 || Math.hypot(...h) < 1e-6 || Math.abs(Math.hypot(...h) - Math.hypot(...h0)) < 1e-4, 'arm joint stays at its distance from the spine joint');
  const dTip = Math.hypot(...sub(i1.tips[rig.B[bi.armL].limb], i0.tips[rig.B[bi.armL].limb]));
  assert.ok(dTip > 0.05, 'the fore tip moved with the spine');
  assert.ok(Math.hypot(...sub(i1.hull[2], i0.hull[2])) > 0.05 && Math.hypot(...sub(i1.hull[0], i0.hull[0])) === 0, 'hull: head sphere moves, pelvis stays');
  assert.equal(i1.hull.length, i0.hull.length);
});
test('head channels turn about the head joint, on top of the spine', () => {
  const r = row({ ...GLIDING, trunk: [10, 0, 0, 20, 0, 0] }), Jh = rig.head[bi.head];
  const q = at(r, bi.head, [Jh[0], Jh[1], Jh[2] + 1]), p = at(r, bi.head, Jh), q0 = at(base, bi.head, [Jh[0], Jh[1], Jh[2] + 1]), p0 = at(base, bi.head, Jh);
  assert.ok(Math.abs(ang(sub(q, p), sub(q0, p0)) - 30) < 0.01, 'head direction turned 10 + 20');
});
test('limits clamp to the plan rom', () => {
  const big = row({ ...GLIDING, trunk: [90, 0, 0, 0, 0, 0] }), lim = row({ ...GLIDING, trunk: [rom.spine.yaw[1], 0, 0, 0, 0, 0] });
  assert.ok(same(big, lim));
  const bp = row({ ...GLIDING, trunk: [0, -90, 0, 0, 90, 0] }), lp = row({ ...GLIDING, trunk: [0, rom.spine.pitch[0], 0, 0, rom.head.pitch[1], 0] });
  assert.ok(same(bp, lp));
});
test('per-side arms: 12 numbers, left then right; 6 stay shared', () => {
  const A6 = [30, 40, 50, 0, 0, 0], A12 = [...A6, ...A6];
  const a = row({ ...GLIDING, armA: Float32Array.from(A6) }), b = row({ ...GLIDING, armA: Float32Array.from(A12) });
  assert.ok(same(a, b), '12 equal = 6 shared');
  const c = row({ ...GLIDING, armA: Float32Array.from([...A6, 100, 20, 30, 0, 0, 0]) });
  assert.ok(same(c.subarray(bi.armL * 12, bi.armL * 12 + 36), b.subarray(bi.armL * 12, bi.armL * 12 + 36)), 'left unchanged');
  assert.ok(!same(c.subarray(bi.armR * 12, bi.armR * 12 + 12), b.subarray(bi.armR * 12, bi.armR * 12 + 12)), 'right differs');
});
test('roll: about the segment axis, joints stay, clamped', () => {
  const r0 = row(GLIDING), r = row({ ...GLIDING, roll: [0, 40, 0, 0, 25, 0] });
  const tip = (m, b) => at(m, b, rig.tail[b]);
  assert.ok(!same(r.subarray(bi.handL * 12, bi.handL * 12 + 12), r0.subarray(bi.handL * 12, bi.handL * 12 + 12)), 'hand rolled');
  assert.ok(!same(r.subarray(bi.thighL * 12, bi.thighL * 12 + 12), r0.subarray(bi.thighL * 12, bi.thighL * 12 + 12)), 'thigh rolled');
  assert.ok(Math.hypot(...sub(tip(r, bi.thighL), tip(r0, bi.thighL))) < 1e-4 && Math.hypot(...sub(tip(r, bi.handL), tip(r0, bi.handL))) < 1e-4, 'axis points stay');
  assert.ok(same(row({ ...GLIDING, roll: [0, 0, 0, 0, 90, 0] }), row({ ...GLIDING, roll: [0, 0, 0, 0, rom.thigh.roll[1], 0] })), 'thigh clamp');
  assert.ok(same(row({ ...GLIDING, roll: [0, 0, 200, 0, 0, 0] }), row({ ...GLIDING, roll: [0, 0, rom.forearm.roll[1], 0, 0, 0] })), 'forearm clamp');
});
