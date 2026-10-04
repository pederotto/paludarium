// The geometry that keeps whole bodies inside the glass, on the plane under their feet and steady while they climb (util/contain.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { surfaceFrame, pitchFrame, glassPush, feetPlane, steadyNormal, easeAngle, angleOf } from '../src/util/contain.js';

const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);

test('the frames match how Animals.draw turns a body (UP onto the normal, then the heading; or Euler YXZ)', () => {
  const q = new THREE.Quaternion(), t = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);
  for (const [n, yaw] of [[[0, 1, 0], 0.7], [[0, 0, 1], Math.PI], [[0.6, 0.2, 0.77], -1.2], [[-1, 0, 0], 2.1], [[0.1, -0.3, 0.95], 0.4]]) {
    const N = new THREE.Vector3(...n).normalize();
    q.setFromUnitVectors(UP, N).multiply(t.setFromAxisAngle(UP, yaw));
    const f = surfaceFrame(N.x, N.y, N.z, yaw), F = new THREE.Vector3(0, 0, 1).applyQuaternion(q), R = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    near(f[0], F.x); near(f[1], F.y); near(f[2], F.z); near(f[3], R.x); near(f[4], R.y); near(f[5], R.z);
    near(f[6], N.x); near(f[7], N.y); near(f[8], N.z);
  }
  for (const [p, yaw] of [[0, 0.3], [-1.1, 2], [0.6, -0.8]]) {
    q.setFromEuler(new THREE.Euler(p, yaw, 0, 'YXZ'));
    const f = pitchFrame(p, yaw), F = new THREE.Vector3(0, 0, 1).applyQuaternion(q), U = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    near(f[0], F.x); near(f[1], F.y); near(f[2], F.z); near(f[6], U.x); near(f[7], U.y); near(f[8], U.z);
  }
});

test('a frog facing the front glass at its edge is moved back until its snout is inside (its middle was inside already)', () => {
  const body = { X: 1.4, z0: -1.6, z1: 2.0, H: 1.5 };
  const d = glassPush(5, 10, 21.6, pitchFrame(0, 0), body, 45, 22.5, 60, 0.1);   // facing +z, the front glass at z = 22.5
  near(d[0], 0); near(d[1], 0);
  near(21.6 + d[2] + 2.0, 22.4);                                               // snout at the glass less the margin
  // turned along the glass, its flank decides
  const s = glassPush(5, 10, 21.6, pitchFrame(0, Math.PI / 2), body, 45, 22.5, 60, 0.1);
  near(21.6 + s[2] + 1.4, 22.4);
  // well inside: nothing
  assert.deepEqual(glassPush(0, 10, 0, pitchFrame(0, 1), body, 45, 22.5, 60, 0.1), [0, 0, 0]);
});

test('in a corner both panes push, and a gecko on the background near the lid is moved down and in', () => {
  const body = { X: 1, z0: -3, z1: 3, H: 0.8 };
  const c = glassPush(-44, 10, 22, pitchFrame(0, -Math.PI / 4), body, 45, 22.5, 60, 0.1);
  assert.ok(c[0] > 0 && c[2] < 0);
  // on the back wall (normal +z), head up: its length runs up the wall
  const f = surfaceFrame(0, 0, 1, Math.PI);
  near(f[1], 1);                                                               // heading π on the wall is head up (as geckoMove sets it)
  const g = glassPush(44, 58, -15, f, body, 45, 22.5, 60, 0.1);
  near(58 + g[1] + 3, 59.9); near(44 + g[0] + 1, 44.9);
});

test('a body wider than the room is centred in it', () => {
  const d = glassPush(3, 5, 0, pitchFrame(0, 0), { X: 50, z0: -1, z1: 1, H: 1 }, 45, 22.5, 60, 0.1);
  near(3 + d[0], 0);
});

test('the plane under four feet: its normal faces out of the surface and passes through their middle', () => {
  // the background leaning back (z = 2 + 0.5 y, so its outward normal is (0, -0.5, 1) normalised)
  const zAt = (x, y) => 2 + 0.5 * y;
  const P = (x, y) => [x, y, zAt(x, y)];
  const r = feetPlane(P(0, 12), P(0, 8), P(1, 10), P(-1, 10), [0, 0, 1]);
  const l = Math.hypot(0.5, 1);
  near(r.n[0], 0); near(r.n[1], -0.5 / l); near(r.n[2], 1 / l);
  near(r.p[2], zAt(0, 10));
  assert.equal(feetPlane(P(0, 0), P(0, 0), P(0, 0), P(0, 0), [0, 0, 1]), null);
});

test('a climber\'s normal: small changes are ignored, a turn onto the wall takes several ticks and never a big jump', () => {
  let st = steadyNormal(null, [0, 1, 0], 1 / 30);
  st = steadyNormal(st, [Math.sin(0.05), Math.cos(0.05), 0], 1 / 30);          // 3 degrees of relief noise: held
  near(angleOf(st.n, [0, 1, 0]), 0);
  let ticks = 0, worst = 0, prev = st.n;
  while (angleOf(st.n, [0, 0, 1]) > 0.01 && ticks < 200) {
    st = steadyNormal(st, [0, 0, 1], 1 / 30);
    worst = Math.max(worst, angleOf(prev, st.n)); prev = st.n; ticks++;
  }
  assert.ok(ticks >= 8 && ticks < 60, `${ticks} ticks`);
  assert.ok(worst <= 5 / 30 + 1e-9, `largest step ${worst}`);                    // at most 5 rad/s
  near(easeAngle(0.001, 1 / 30), 0.001 * (1 - Math.exp(-12 / 30)));
  near(easeAngle(2, 1 / 30), 5 / 30);
});
