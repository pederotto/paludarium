// Turning like an animal (src/util/turn.js) and the body plans' joint limits and muscles (src/util/bodyplan.js,
// tools/rig/skeleton.mjs). The promises: a walker pivots about its support and never yaws without its legs stepping, a planted
// foot stays where it was put through a turn on the spot, the spine bends into the turn with the head leading and the tail
// following, a swimmer swings round an arc, and no pose bends a joint further than the animal can.
import test from 'node:test';
import assert from 'node:assert/strict';
import { limbFrame, turnFrame, turnStep, pivotShift, turnSteps, turnPose, steerLimit, footRig, angDiff } from '../src/util/turn.js';
import { PLANS, planOf, limitDir, bendAngle, limitRig, muscleBulge, jointLimit } from '../src/util/bodyplan.js';
import { poseMatrices, poseAngles, frogBones, moveBy, bindSkin, skin, applyMuscles } from '../tools/rig/skeleton.mjs';

const TAU = Math.PI * 2;

// A four-legged mesh: a trunk along z (spine 0 at the snout, +z), hips at z = -1, shoulders at z = 1, feet out to the sides.
function quadMesh() {
  const P = [], R = [];
  for (let i = 0; i <= 20; i++) { P.push(0, 0.5, 2 - i * 0.25); R.push(i / 20, 0, 0, 0); }
  const leg = (id, x0, z0, x1, z1) => { for (let k = 0; k <= 10; k++) { const t = k / 10; P.push(x0 + (x1 - x0) * t, 0.4 * (1 - t), z0 + (z1 - z0) * t); R.push(0.5, id, t, 0); } };
  leg(1, -0.3, 1, -1.2, 1.4); leg(2, 0.3, 1, 1.2, 1.4); leg(3, -0.3, -1, -1.1, -1.3); leg(4, 0.3, -1, 1.1, -1.3);
  return { P: Float32Array.from(P), R: Float32Array.from(R) };
}

test('limbFrame finds hips, shoulders and feet on the mesh', () => {
  const { P, R } = quadMesh(), f = limbFrame(P, R);
  assert.ok(Math.abs(f.hipZ + 1) < 0.05 && Math.abs(f.shoulderZ - 1) < 0.05, `${f.hipZ} ${f.shoulderZ}`);
  assert.ok(Math.abs(f.feet[2][0] - 1.2) < 0.15 && Math.abs(f.feet[3][1] + 1.3) < 0.15);
  assert.equal(limbFrame(P, null), null);
});

test('a walker turns about its hips: its fastest yaw is set by its legs, the pivot point does not move', () => {
  const { P, R } = quadMesh(), f = limbFrame(P, R);
  const tf = turnFrame(PLANS.caudate, f, 0.5);
  assert.equal(tf.pz, f.hipZ);
  assert.ok(Math.abs(tf.R - Math.hypot(1.2, 2.4)) < 0.2, `R ${tf.R}`);
  assert.ok(Math.abs(tf.theta - 2 / tf.R) < 1e-9 && Math.abs(tf.maxRate - tf.theta * PLANS.caudate.turn.stepHz) < 1e-9);
  // a lizard steps faster than a salamander: it may turn faster
  assert.ok(turnFrame(PLANS.lizard, f, 0.5).maxRate > tf.maxRate);
  // the pivot (z = pz on the axis) stays where it is through a turn
  let x = 3, z = -2, yaw = 0.3;
  const piv = (yw) => [x + Math.sin(yw) * tf.pz * 1.7, z + Math.cos(yw) * tf.pz * 1.7];
  const p0 = piv(yaw);
  for (let i = 0; i < 40; i++) { const y1 = yaw + 0.08; const [dx, dz] = pivotShift(yaw, y1, tf.pz, 1.7); x += dx; z += dz; yaw = y1; }
  const p1 = piv(yaw);
  assert.ok(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) < 1e-9);
  // a swimmer has no legs to step with: it turns at its plan's rate, about nothing (it moves while it turns)
  const fish = turnFrame(PLANS.fish, null, 0);
  assert.equal(fish.legs, false); assert.equal(fish.maxRate, PLANS.fish.turn.swimRate);
});

test('turnStep: the yaw rate never exceeds the limit, builds up, and the turn ends on the heading without overshoot', () => {
  const st = {}, max = 2, dt = 0.02;
  let yaw = 0, prev = 0, first = null, maxSeen = 0;
  for (let i = 0; i < 400; i++) {
    yaw = turnStep(yaw, Math.PI, dt, max, st);
    const r = Math.abs(yaw - prev) / dt; prev = yaw;
    maxSeen = Math.max(maxSeen, r); first ??= r;
    assert.ok(Math.abs(angDiff(Math.PI, yaw)) <= Math.PI + 1e-9);
    assert.ok(yaw <= Math.PI + 1e-9, 'overshoot');
  }
  assert.ok(maxSeen <= max + 1e-9, `rate ${maxSeen}`);
  assert.ok(first < max * 0.5, `the first step is a jerk (${first} rad/s)`);
  assert.ok(Math.abs(yaw - Math.PI) < 1e-3);
});

test('no yaw without leg motion: every bit of turning drives the leg cycle; on the spot the mix is all turn', () => {
  const R = 2.5;
  for (const dyaw of [0.001, 0.05, -0.2]) assert.ok(turnSteps(0, dyaw, R).steps > 0);
  assert.equal(turnSteps(0, 0.1, R).tau, 1); assert.equal(turnSteps(0, -0.1, R).tau, -1);
  assert.equal(turnSteps(0.3, 0, R).tau, 0);
  const t = turnSteps(0.25, 0.1, R).tau;
  assert.ok(t > 0.45 && t < 0.55);
});

test('a frog turns in a few long quick steps: its turn sweep scales the yaw a leg cycle and the fastest yaw, not the reach', () => {
  const { P, R } = quadMesh(), f = limbFrame(P, R), k = PLANS.anuran.turn.sweep;
  const frog = turnFrame(PLANS.anuran, f, 0.5), sal = turnFrame(PLANS.caudate, f, 0.5);
  assert.ok(k > 1, `sweep ${k}`);
  assert.ok(Math.abs(frog.reach - sal.reach) < 1e-9 && Math.abs(frog.R * k - frog.reach) < 1e-9);
  assert.ok(Math.abs(frog.theta - k * sal.theta) < 1e-9);
  assert.ok(Math.abs(frog.maxRate - frog.theta * PLANS.anuran.turn.stepHz) < 1e-9);
});

// Foot slip through a half turn on the spot: the feet drawn by the rig formula, in the world, summed while they are down.
function halfTurnSlip({ sweep }) {
  const { P, R } = quadMesh(), f = limbFrame(P, R), stride = 0.5, tf = turnFrame(PLANS.anuran, f, stride);
  const pz = sweep ? tf.pz : 0, rate = TAU / (4 * stride);
  let x = 0, z = 0, yaw = 0, gait = 0;
  const legs = [1, 2, 3, 4], ph = { 1: 0, 4: 0, 2: Math.PI, 3: Math.PI };
  const world = (k) => {
    const r = footRig(f.feet[k][0], f.feet[k][1], gait + ph[k], 1, stride, sweep ? 1 : 0, tf.pz, tf.R);
    return { x: x + r.x * Math.cos(yaw) + r.z * Math.sin(yaw), z: z - r.x * Math.sin(yaw) + r.z * Math.cos(yaw), down: r.down };
  };
  let prev = legs.map(world), slip = 0;
  for (let i = 0; i < 200; i++) {
    const dy = Math.PI / 200;
    const [dx, dz] = pivotShift(yaw, yaw + dy, pz); x += dx; z += dz; yaw += dy;
    // the old rig: the legs stepped at 0.45 x size cm a radian (size 1.4) and swept back along the body
    gait += (sweep ? turnSteps(0, dy, tf.R).steps : dy * 0.45 * 1.4) * rate;
    const now = legs.map(world);
    for (let k = 0; k < 4; k++) if (prev[k].down && now[k].down) slip += Math.hypot(now[k].x - prev[k].x, now[k].z - prev[k].z);
    prev = now;
  }
  return slip;
}

test('a planted foot stays put through a turn on the spot (and slid a lot with a spin about the middle)', () => {
  const before = halfTurnSlip({ sweep: false }), after = halfTurnSlip({ sweep: true });
  assert.ok(before > 2, `before ${before}`);
  assert.ok(after < 0.05, `after ${after}`);
});

test('the spine bends into the turn, the head leads, the tail follows late, all inside the joint limits', () => {
  const st = {}, max = 2;
  let pose;
  for (let i = 0; i < 3; i++) pose = turnPose(PLANS.caudate, 2, max, 0.02, st);
  const [head, bend, tail] = pose;
  assert.ok(head > 0 && bend > 0 && tail > 0, 'all toward the turn (+x as yaw grows)');
  assert.ok(head <= PLANS.caudate.rig.head + 1e-9 && bend <= PLANS.caudate.rig.bend + 1e-9);
  const tailTarget = PLANS.caudate.turn.tail * PLANS.caudate.rig.tail;
  assert.ok(tail < tailTarget * 0.5, 'the tail lags behind the bend');
  for (let i = 0; i < 100; i++) pose = turnPose(PLANS.caudate, 2, max, 0.02, st);
  assert.ok(Math.abs(pose[2] - tailTarget) < 1e-3);
  pose = turnPose(PLANS.caudate, 0, max, 0.02, st);
  assert.equal(pose[1], 0); assert.ok(pose[2] > 0, 'the tail is still swinging back when the turn has stopped');
  const neg = turnPose(PLANS.caudate, -9, max, 0.02, {});
  assert.ok(neg[1] < 0 && neg[1] >= -PLANS.caudate.rig.bend);
  // a frog's stiff trunk hardly bends
  assert.ok(Math.abs(turnPose(PLANS.anuran, 2, max, 0.02, {})[1]) < 1e-9);
  assert.deepEqual(limitRig('caudate', 9, 9, -9), [PLANS.caudate.rig.head, PLANS.caudate.rig.bend, -PLANS.caudate.rig.tail]);
});

test('a swimmer swings round an arc instead of reversing on the spot', () => {
  const v = steerLimit({ x: 0, y: 0, z: 3 }, { x: 0, y: 0.5, z: -3 }, 0.2);
  assert.ok(Math.abs(Math.atan2(v.x, v.z)) - 0.2 < 1e-9 && Math.abs(Math.hypot(v.x, v.z) - 3) < 1e-9 && v.y === 0.5);
  const same = steerLimit({ x: 0, y: 0, z: 3 }, { x: 0.1, y: 0, z: 3 }, 0.2);
  assert.equal(same.x, 0.1);
});

test('every species has a body plan', () => {
  assert.equal(planOf({ kind: 'frog' }), 'anuran'); assert.equal(planOf({ kind: 'newt' }), 'caudate');
  assert.equal(planOf({ kind: 'skink' }), 'lizard'); assert.equal(planOf({ kind: 'swim' }), 'fish');
  assert.equal(planOf({ kind: 'crab' }), 'decapod'); assert.equal(planOf({ kind: 'crawlWater', shrimp: true }), 'decapod');
  assert.equal(planOf({ kind: 'crawlLand', anim: { stride: 0.1 } }), 'arthropod'); assert.equal(planOf({ kind: 'crawlWater' }), 'soft');
});

test('joint limits: a target past the limit is brought back to it in the same plane', () => {
  const lim = { min: 10, max: 90 };
  const d = limitDir([0, 0, 1], [0, -0.1, -1], lim);
  assert.ok(Math.abs(bendAngle([0, 0, 1], d) - 90) < 1e-6 && Math.abs(d[0]) < 1e-9 && d[1] < 0);
  const s = limitDir([0, 0, 1], [0, 0.01, 1], lim);
  assert.ok(Math.abs(bendAngle([0, 0, 1], s) - 10) < 1e-6);
  const ok = [0, 1, 1];
  assert.equal(limitDir([0, 0, 1], ok, lim), ok);
  assert.deepEqual(jointLimit('anuran', 'shinR'), PLANS.anuran.joints.shin);
});

// The red-eyed tree frog's skeleton as the bake measured it (tools/bake-creature.mjs jobs.redeye.skeleton), and its sleep pose.
const J = {
  vent: [0.02, -0.18, -0.82], mid: [0, -0.12, -0.2], chest: [0, -0.05, 0.3], neck: [0, -0.02, 0.42], snout: [0, 0.1, 0.9],
  hipL: [-0.14, -0.2, -0.74], kneeL: [-0.54, -0.25, -0.24], heelL: [-0.24, -0.33, -0.9], ankleL: [-0.47, -0.38, -0.5], toeL: [-0.88, -0.4, 0.12],
  hipR: [0.16, -0.2, -0.74], kneeR: [0.5, -0.25, -0.22], heelR: [0.14, -0.33, -0.88], ankleR: [0.47, -0.38, -0.52], toeR: [0.84, -0.4, 0],
  shoulderL: [-0.33, -0.04, 0.27], elbowL: [-0.48, -0.2, 0.16], wristL: [-0.48, -0.36, 0.45], fingerL: [-0.45, -0.4, 0.95],
  shoulderR: [0.32, -0.04, 0.27], elbowR: [0.45, -0.2, 0.14], wristR: [0.47, -0.36, 0.36], fingerR: [0.42, -0.4, 0.78],
};
const SLEEP = { mirror: true, spine: [0, -0.2, 0.3], head: [0, -0.07, 0.88], armR: [0.4, -0.27, 0.14], forearmR: [0.18, -0.36, 0.36], handR: [0.22, -0.4, -0.15],
  thighR: [0.4, -0.25, -0.1], shinR: [0.2, -0.33, -0.75], footR: [0.3, -0.4, -0.38], toesR: [0.24, -0.42, 0.02] };

test('the frog skeleton: the scan pose and the baked sleep pose are inside the anuran limits; a pose past them is clamped', () => {
  const B = frogBones(J);
  for (const pose of [{}, SLEEP]) {
    const m = poseMatrices(B, pose, { plan: 'anuran' });
    assert.deepEqual(m.clamped, []);
    for (const [bone, a] of Object.entries(poseAngles(B, m))) { const L = jointLimit('anuran', bone); if (L) assert.ok(a >= L.min - 1e-6 && a <= L.max + 1e-6, `${bone} ${a}`); }
  }
  // the head cannot be turned round to look over the shoulder: a frog has almost no neck
  const m = poseMatrices(B, { head: [0.9, -0.02, 0.0] }, { plan: 'anuran' });
  assert.deepEqual(m.clamped, ['head']);
  assert.ok(poseAngles(B, m).head <= PLANS.anuran.joints.head.max + 1e-6);
  const free = poseMatrices(B, { head: [0.9, -0.02, 0.0] });
  assert.ok(poseAngles(B, free).head > PLANS.anuran.joints.head.max, 'without a plan nothing is clamped');
  void moveBy;
});

test('muscles swell as their joint bends, nowhere else, and not at all with the joint straight', () => {
  const m = { bone: 'thigh', joint: 'shin', from: 0.1, to: 0.7, gain: 0.1 }, lim = { min: 0, max: 180 };
  assert.equal(muscleBulge(m, 0, lim, 0.4), 0);
  assert.equal(muscleBulge(m, 180, lim, 0.05), 0);
  assert.ok(muscleBulge(m, 180, lim, 0.4) > muscleBulge(m, 90, lim, 0.4) && muscleBulge(m, 90, lim, 0.4) > 0);
  // on a skinned leg: folding the knee pushes the thigh's skin out along its normal, the shin's not
  const bones = [
    { name: 'pelvis', parent: null, head: [0, 0, -1], tail: [0, 0, 0], limb: 0 },
    { name: 'thighR', parent: 'pelvis', head: [0, 0, 0], tail: [1, 0, 0], limb: 4 },
    { name: 'shinR', parent: 'thighR', head: [1, 0, 0], tail: [2, 0, 0], limb: 4 },
  ];
  const pts = [], leg = [], legT = [], nor = [];
  for (let i = 0; i <= 20; i++) { pts.push(i * 0.1, 0.1, 0); nor.push(0, 1, 0); leg.push(4); legT.push(i / 20); }
  const pos = Float32Array.from(pts), N = Float32Array.from(nor), rig = { leg: Uint8Array.from(leg), legT: Float32Array.from(legT) };
  const bind = bindSkin(pos, bones, rig);
  const mats = poseMatrices(bones, { shinR: [0.2, 0, 0.2] }, { plan: 'anuran' });
  const out = skin(pos, N, bind, mats), before = Float32Array.from(out.pos);
  const moved = applyMuscles(out.pos, out.nor, pos, bind, bones, mats, 'anuran');
  assert.ok(moved > 0);
  const d = (i) => Math.hypot(out.pos[i * 3] - before[i * 3], out.pos[i * 3 + 1] - before[i * 3 + 1], out.pos[i * 3 + 2] - before[i * 3 + 2]);
  assert.ok(d(4) > 0.01, `mid-thigh ${d(4)}`);
  assert.equal(d(16), 0);
});
