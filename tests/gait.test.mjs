// The pure animation arithmetic behind the creature rig (util/gait.js): the frog's kick, a walking foot that does not slide,
// the crab's scuttle and the packed per-instance word the vertex shader reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  frogKick, kickSpeed, KICK, KICK_MEAN, kickPeriod, bob, gaitRate, sweepFor, strideFor, footSwing, footLift, footGrounded, TROT, TAU,
  scuttleSpeed, crabStride, clawRaise, frogSwimPose, salamanderSwimPose, packAnim, unpackAnim, strideRate, hopLegs, HOP, callSac, toeTap,
} from '../src/util/gait.js';

const grid = (n, f) => { for (let i = 0; i <= n; i++) f(i / n, i); };

test('a frog kick is periodic, bounded and has no jumps', () => {
  grid(200, (p) => {
    const a = frogKick(p), b = frogKick(p + 1), c = frogKick(p - 3);
    for (const k of ['ext', 'push', 'splay']) { assert.ok(a[k] >= -1e-9 && a[k] <= 1 + 1e-9, `${k} out of range at ${p}`); assert.ok(Math.abs(a[k] - b[k]) < 1e-9 && Math.abs(a[k] - c[k]) < 1e-9, `${k} not periodic`); }
  });
  let prev = frogKick(0), worst = 0;
  for (let i = 1; i <= 4000; i++) { const k = frogKick(i / 4000); worst = Math.max(worst, Math.abs(k.ext - prev.ext)); prev = k; }
  assert.ok(worst < 0.01, `ext jumps by ${worst} between 1/4000 phase steps`);
});

test('the kick folds, thrusts out, glides and recovers in that order, and only the thrust pushes', () => {
  assert.equal(frogKick(0).ext, 0);                                  // folded, about to kick
  assert.ok(frogKick(KICK.thrust).ext > 0.999);                      // fully extended at the end of the thrust
  assert.ok(frogKick((KICK.thrust + KICK.glide) / 2).ext > 0.95);    // legs trail while it glides
  assert.ok(frogKick((KICK.glide + KICK.recover) / 2).ext < 0.7);    // recovering
  assert.equal(frogKick(KICK.recover + 0.02).ext, 0);                // gathered
  let pushed = 0, peak = 0, peakAt = 0;
  grid(1000, (p) => { const k = frogKick(p); if (k.push > 0) pushed++; if (k.push > peak) { peak = k.push; peakAt = p; } if (p > KICK.thrust + 1e-9 && p < 1) assert.equal(k.push, 0); });
  assert.ok(peak > 0.99 && peakAt > 0.03 && peakAt < KICK.thrust, `push peaks at ${peakAt}`);
  assert.ok(pushed / 1000 <= KICK.thrust + 0.01);
  // The feet splay outward most halfway through the extension (and the recovery), never when folded or fully stretched.
  assert.ok(frogKick(0).splay < 1e-9 && frogKick(KICK.thrust).splay < 1e-3);
  let sMax = 0; grid(400, (p) => { sMax = Math.max(sMax, frogKick(p).splay); });
  assert.ok(sMax > 0.95);
});

test('a kicking frog surges after each thrust and coasts: continuous speed, mean well under the peak', () => {
  assert.ok(Math.abs(kickSpeed(0) - kickSpeed(1 - 1e-9)) < 1e-6, 'speed jumps at the cycle boundary');
  let max = 0, at = 0; grid(500, (p) => { const v = kickSpeed(p); assert.ok(v > 0 && v <= 1 + 1e-9); if (v > max) { max = v; at = p; } });
  assert.ok(Math.abs(max - 1) < 1e-6 && Math.abs(at - KICK.thrust) < 0.01, `peak ${max} at ${at}`);
  assert.ok(KICK_MEAN > 0.3 && KICK_MEAN < 0.5, `mean ${KICK_MEAN}`);
  assert.ok(kickPeriod(1) < kickPeriod(0) && kickPeriod(1) > 0.5);
});

test('buoyancy bob stays small and shrinks with the animal', () => {
  let m = 0; for (let t = 0; t < 30; t += 0.05) m = Math.max(m, Math.abs(bob(t, 3.5, (t * 0.7) % 1, 1)));
  assert.ok(m > 0.02 && m < 0.5, `bob up to ${m} cm for a 3.5 cm frog`);
  assert.ok(Math.abs(bob(7, 1.2)) < Math.abs(bob(7, 6)) + 1e-12);
});

test('a walking foot does not slide: it moves back at exactly the body speed while planted', () => {
  for (const stride of [0.8, 2.4, 5, 11]) {
    const A = sweepFor(stride), rate = gaitRate(stride);
    assert.ok(Math.abs(strideFor(A) - stride) < 1e-12);
    // Walk 20 strides in small steps; whenever the foot is down at both ends of a step, its ground position must not move.
    let s = 0, phi = 1.3, worst = 0, down = 0;
    const step = stride / 400;
    let foot = footSwing(phi, A) + s;
    for (let i = 0; i < 8000; i++) {
      const ph2 = phi + rate * step;
      const was = footGrounded(phi), now = footGrounded(ph2);
      const f2 = footSwing(ph2, A) + (s + step);
      if (was && now) { worst = Math.max(worst, Math.abs(f2 - foot)); down++; }
      foot = f2; phi = ph2; s += step;
    }
    assert.ok(down > 3000);
    assert.ok(worst < 1e-6 * stride + 1e-9, `stride ${stride}: planted foot slid ${worst} cm in one step`);
  }
});

test('the foot is up while it swings forward, planted while it moves back (not the other way round)', () => {
  const A = 1;
  grid(100, (u) => {
    const phi = u * TAU, d = 1e-4;
    const v = (footSwing(phi + d, A) - footSwing(phi, A)) / d;          // forward speed of the foot relative to the body
    if (footLift(phi, A) > 1e-3) assert.ok(v >= -1e-6, `lifted foot moves backward at phase ${u}`);
    if (footGrounded(phi) && Math.sin(phi) < -1e-3) assert.ok(v <= 1e-6, `planted foot moves forward at phase ${u}`);
  });
  assert.ok(Math.abs(footSwing(0, A) + A) < 1e-12 && Math.abs(footSwing(Math.PI, A) - A) < 1e-12);
});

test('diagonal legs move together and opposite diagonals are half a cycle apart', () => {
  assert.equal(TROT[1], TROT[4]); assert.equal(TROT[2], TROT[3]);
  assert.ok(Math.abs(Math.abs(TROT[1] - TROT[2]) - Math.PI) < 1e-12);
});

test('a crab scuttles in bursts: starts and ends at rest, a plateau between', () => {
  assert.equal(scuttleSpeed(0), 0); assert.equal(scuttleSpeed(1), 0);
  assert.ok(scuttleSpeed(0.5) > 0.999);
  grid(100, (u) => { const v = scuttleSpeed(u); assert.ok(v >= 0 && v <= 1); });
  assert.ok(crabStride(2.2) > 1.5 && crabStride(2.2) < 2.5);
  assert.equal(clawRaise(-1, 2), 0); assert.equal(clawRaise(2.5, 2), 0);
  assert.ok(clawRaise(1, 2) > 0.99);
  grid(40, (u) => { const v = clawRaise(u * 2, 2); assert.ok(v >= 0 && v <= 1); });
});

test('swim poses stay inside what the rig can show', () => {
  grid(100, (p, i) => {
    for (const floating of [0, 0.5, 1]) {
      const s = frogSwimPose(p, { floating, t: i * 0.1 });
      assert.ok(s.hop >= 0 && s.hop <= 1 && s.pose >= 0 && s.pose <= 1 && s.calm === 1);
      assert.ok(Math.abs(s.pitch) < 0.6 && Math.abs(s.roll) < 0.2);
    }
  });
  assert.ok(frogSwimPose(0.3, { floating: 1 }).pose < frogSwimPose(0.3, { floating: 0 }).pose);
  const sal = salamanderSwimPose(1);
  assert.equal(sal.hop, 1); assert.equal(sal.pose, 1); assert.ok(sal.ampScale > salamanderSwimPose(0).ampScale);
});

test('the packed word survives a float32 and decodes to what was put in', () => {
  const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
  for (const [hop, br, th, ey, po, ca] of [[0, 0, 0, 0, 0, 0], [1, 1, 1, 1, 1, 1], [0.37, 0.5, 0.2, 0.9, 0.6, 0.3], [0.73, 0.1, 1, 0, 1, 0], [0.05, 0, 0, 0, 0.2, 1]]) {
    const u = unpackAnim(packAnim(hop, br, th, ey, po, ca));
    near(u.hop, hop, 1 / 100, 'hop'); near(u.breath, br, 0.5 / 7 + 1e-9, 'breath'); near(u.throat, th, 0.5 / 7 + 1e-9, 'throat');
    near(u.eye, ey, 0.5 / 7 + 1e-9, 'eye'); near(u.pose, po, 0.5 / 15 + 1e-9, 'pose'); near(u.calm, ca, 0.5 / 7 + 1e-9, 'calm');
  }
  // A plain hop is untouched, so old callers keep working.
  for (const h of [0, 0.25, 0.9, 1]) { const u = unpackAnim(h); assert.ok(Math.abs(u.hop - h) < 1e-6 && u.breath === 0 && u.pose === 0 && u.calm === 0); }
  // Every field combination decodes without crossing into a neighbour (exhaustive over the integer fields).
  for (let br = 0; br <= 7; br++) for (let po = 0; po <= 15; po += 5) for (let ca = 0; ca <= 7; ca += 7) for (let ey = 0; ey <= 7; ey += 7) {
    const u = unpackAnim(packAnim(0.5, br / 7, 3 / 7, ey / 7, po / 15, ca / 7));
    assert.ok(Math.abs(u.breath - br / 7) < 1e-9 && Math.abs(u.pose - po / 15) < 1e-9 && Math.abs(u.calm - ca / 7) < 1e-9 && Math.abs(u.eye - ey / 7) < 1e-9 && Math.abs(u.hop - 0.5) < 1 / 100, `fields ${br} ${po} ${ca} ${ey}`);
  }
});

test('the stride rate is one leg cycle per stride at any size: a planted foot does not slide', () => {
  for (const [stride, scale] of [[0.35, 1], [0.26, 0.6], [0.45, 1.9]]) {
    const cm = strideFor(stride) * scale;
    assert.ok(Math.abs(strideRate(stride, scale) * cm - TAU) < 1e-9);
    // Over the stance the foot moves back exactly as far as the body moves forward (in the mesh's own cm, times the scale).
    const phi0 = Math.PI * 1.1, phi1 = Math.PI * 1.9, dBody = (phi1 - phi0) / strideRate(stride, scale);
    const dFoot = (footSwing(phi0, sweepFor(strideFor(stride))) - footSwing(phi1, sweepFor(strideFor(stride)))) * scale;
    assert.ok(Math.abs(dFoot - dBody) < 1e-9, `foot ${dFoot} vs body ${dBody}`);
  }
});

test('a hop: the legs snap out at take-off, trail, and are folded before landing', () => {
  assert.equal(hopLegs(0), 0);
  assert.ok(hopLegs(HOP.push) > 0.999 && hopLegs(0.3) === 1);
  assert.ok(hopLegs(0.07) > 0.8, 'most of the extension in the first few hundredths');
  assert.ok(hopLegs(HOP.fold) < 1e-9 && hopLegs(1) === 0);
  let prev = 0, worst = 0;
  for (let i = 1; i <= 2000; i++) { const v = hopLegs(i / 2000); worst = Math.max(worst, Math.abs(v - prev)); prev = v; }
  assert.ok(worst < 0.02, `no jumps (${worst})`);
});

test('a call bout and a toe tap stay in range and end at rest', () => {
  for (let t = -1; t < 8; t += 0.01) { const v = callSac(t, 6); assert.ok(v >= 0 && v <= 1); }
  assert.equal(callSac(0, 6), 0); assert.equal(callSac(6, 6), 0);
  assert.ok(Math.max(...Array.from({ length: 300 }, (_, i) => callSac(1 + i / 100, 6))) > 0.9);
  for (let t = 0; t < 3; t += 0.01) { const v = toeTap(t); assert.ok(v >= 0 && v <= 0.08 + 1e-12); }
});

test('rig2Pack / rig2Unpack: zero is exact, values come back to within a step, and the floats stay exact in float32', async () => {
  const { rig2Pack, rig2Unpack } = await import('../src/util/gait.js');
  const z = rig2Unpack(...rig2Pack(0, 0, 1, 0, 0));
  assert.equal(z.bend, 0); assert.equal(z.tail, 0); assert.equal(z.tailF, 1); assert.equal(z.dull, 0); assert.equal(z.piece, 0);
  for (const [bend, tail, tf, du, pc] of [[0.5, -0.2, 0.1, 0.85, 0.55], [-0.8, 0.3, 0.85, 0.4, 0], [0.013, 0.26, 0.6, 0, 0.55]]) {
    const [a, b] = rig2Pack(bend, tail, tf, du, pc);
    assert.equal(Math.fround(a), a); assert.equal(Math.fround(b), b);
    const u = rig2Unpack(a, b);
    assert.ok(Math.abs(u.bend - bend) < 0.002 && Math.abs(u.tail - tail) < 0.001 && Math.abs(u.tailF - tf) < 0.01 && Math.abs(u.dull - du) < 0.01 && Math.abs(u.piece - pc) < 0.005);
  }
});
