// The climb as a body movement (util/climb.js, owner's Movement rule): the advance and the yaw come out of the limbs' pulses, never from the sim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CLIMB, CLIMB_KEYS, climbState, climbStep, climbPose, climbMove } from '../src/util/climb.js';
import { HIND, FORE } from '../src/util/gait.js';
import { excitation, ANURAN_MUSCLES } from '../src/content/anuranmuscles.js';
import { motionOf } from '../src/render/creatures/muscles.js';

const dt = 0.02, PL = ANURAN_MUSCLES.find((d) => d.id === 'PL');
let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const run = (st, intent, secs) => { let adv = 0, dyaw = 0; for (let i = 0; i < secs / dt; i++) { const m = climbStep(st, { rnd, ...intent }, dt); adv += m.adv; dyaw += m.dyaw; } return { adv, dyaw }; };

test('the key poses are gait.js\'s (util copies them by hand)', () => {
  for (const k of Object.keys(CLIMB_KEYS.HIND)) assert.deepEqual(CLIMB_KEYS.HIND[k], HIND[k], 'HIND.' + k);
  for (const k of Object.keys(CLIMB_KEYS.FORE)) assert.deepEqual(CLIMB_KEYS.FORE[k], FORE[k], 'FORE.' + k);
});

test('no climb asked: the body is still, however long it waits', () => {
  const st = climbState(rnd), m = run(st, { go: 0, steer: 1 }, 20);
  assert.equal(m.adv, 0); assert.equal(m.dyaw, 0); assert.equal(st.pulses, 0); assert.equal(st.act, 0);
  assert.deepEqual([st.fL, st.fR, st.hL, st.hR], [0, 0, 0, 0]);
});

test('it moves and turns only inside a pulse, from the limbs: every tick of motion has a limb moving', () => {
  const st = climbState(rnd); let moved = 0, idle = 0;
  for (let i = 0; i < 6000; i++) {
    if (i % 300 === 0) st.steerWas = rnd() * 2 - 1;
    const wasIn = st.t >= 0, p0 = st.pulses, m = climbStep(st, { go: i % 1500 < 1000 ? 1 : 0, steer: st.steerWas ?? 0, urgency: rnd(), bodyLen: 3, rnd }, dt);
    if (m.adv || m.dyaw) {
      moved++;
      assert.ok(wasIn || st.pulses > p0, 'moved with no pulse playing');
      assert.ok([st.fL, st.fR, st.hL, st.hR].some((p) => p > 0 && p < 1) || st.t < 0, 'moved with every limb held');
    } else idle++;
  }
  assert.ok(moved > 200 && idle > 2000, `moved ${moved}, idle ${idle}`);
});

test('a pulse advances the body its stride in body lengths; the fore pair move before the hind pair, the lead side first', () => {
  for (const lead of [-1, 1]) {
    const st = climbState(rnd); st.hold = 0; st.lead = -lead;       // (a straight pulse alternates its lead)
    let adv = 0, order = [], first = {}, n0 = 0;
    for (let i = 0; i < 100 && st.pulses < 2; i++) {
      const m = climbStep(st, { go: 1, steer: lead * 0.3, bodyLen: 4, rnd }, dt);
      if (st.pulses === 1) { adv += m.adv; for (const k of ['fL', 'fR', 'hL', 'hR']) if (st[k] > 0 && first[k] == null) { first[k] = st.t; order.push(k); } }
    }
    assert.ok(Math.abs(adv - CLIMB.stride * 4) < 0.02 * CLIMB.stride * 4, `lead ${lead}: advanced ${adv.toFixed(3)} cm, wanted ${CLIMB.stride * 4}`);
    const [a, b, c, d] = order, leadS = lead > 0 ? 'R' : 'L', other = lead > 0 ? 'L' : 'R';
    assert.deepEqual([a, b, c, d], ['f' + leadS, 'f' + other, 'h' + leadS, 'h' + other], `lead ${lead}: ${order}`);
    assert.ok(first[a] < first[b] && first[b] < first[c] && first[c] < first[d]);
  }
});

test('the body turns with the drive: the yaw of a pulse follows the steer, none at 0', () => {
  const turn = (steer) => { const st = climbState(rnd); st.hold = 0; let dyaw = 0, tr = 0; for (let i = 0; i < 70; i++) { const m = climbStep(st, { go: 1, steer, rnd }, dt); dyaw += m.dyaw; tr = Math.max(tr, Math.abs(st.trunk[0])); } return { dyaw, tr }; };
  const r = turn(1), l = turn(-1), s = turn(0);
  assert.ok(Math.abs(r.dyaw - CLIMB.yawPulse) < 0.02 * CLIMB.yawPulse, `right ${r.dyaw}`);
  assert.ok(Math.abs(l.dyaw + CLIMB.yawPulse) < 0.02 * CLIMB.yawPulse, `left ${l.dyaw}`);
  assert.equal(s.dyaw, 0);
  assert.ok(r.tr > 20 && l.tr > 20 && s.tr > 8 && s.tr < 15, `torso bends: ${r.tr} ${l.tr} ${s.tr}`);        // (toward the reaching hand even straight: clip 2, 10-20 deg)
  // the torso bends toward the way it turns, and the head more than the torso
  const st = climbState(rnd); st.hold = 0; let seen = 0;
  for (let i = 0; i < 40; i++) { climbStep(st, { go: 1, steer: 1, rnd }, dt); if (Math.abs(st.trunk[0]) > 5) { assert.ok(st.trunk[0] > 0 && st.trunk[3] > st.trunk[0]); seen++; } }
  assert.ok(seen > 5);
});

test('the pose: held limbs are the key poses, the stretch is the open leg, the angles stay finite and move with the phases', () => {
  const st = climbState(rnd), P = climbPose(st);
  for (let k = 0; k < 9; k++) { assert.ok(Math.abs(P.legA[k] - HIND.cock[k]) < 1e-4); assert.ok(Math.abs(P.legA[9 + k] - HIND.cock[k]) < 1e-4); }
  for (let k = 0; k < 6; k++) { assert.ok(Math.abs(P.armA[k] - FORE.spread[k]) < 1e-4); assert.ok(Math.abs(P.armA[6 + k] - FORE.spread[k]) < 1e-4); }
  st.hL = 0.60; st.hR = 0.30; st.fL = 0.3; st.fR = 0.12; climbPose(st, P);
  for (let k = 0; k < 9; k++) assert.ok(Math.abs(P.legA[k] - HIND.open[k]) < 1e-3, 'the stretch is the open leg');
  for (let k = 0; k < 6; k++) assert.ok(Math.abs(P.armA[k] - FORE.reach[k]) < 1e-3, 'the planted hand is the reach');
  assert.ok([...P.legA, ...P.armA].every(Number.isFinite));
  // through a whole pulse the legs really change
  const s2 = climbState(rnd); s2.hold = 0; let dMax = 0; const A = climbPose(s2).legA.slice();
  for (let i = 0; i < 60; i++) { climbStep(s2, { go: 1, rnd }, dt); const B = climbPose(s2); for (let k = 0; k < 18; k++) dMax = Math.max(dMax, Math.abs(B.legA[k] - A[k])); }
  assert.ok(dMax > 30, `the legs hardly move: ${dMax}`);
});

test('the muscles follow the limbs: a hind leg in its stretch fires the push group fully, the other side at its own phase', () => {
  const st = climbState(rnd); st.hL = 0.5; st.hR = 0.1; st.act = 1;
  const stroke = climbPose(st);
  const L = excitation(PL, motionOf(stroke, true, 'L')), R = excitation(PL, motionOf(stroke, true, 'R'));
  assert.equal(L, 1, 'the stretching leg'); assert.ok(R < 0.2, `the swinging leg ${R}`);
  assert.equal(climbMove({ hL: 0.5, hR: 0.5, act: 0 }).ampL, 0);        // held: tone only
});

// --- the crawl: the arboreal frog's gait (clip 3, a green tree frog up a wall: a continuous lateral-sequence walk, not the dart frog's pulse) ---
const crawler = () => { const st = climbState(rnd, 'crawl'); return st; };
test('crawl: the four limbs cycle in a lateral sequence, the hand of one side reaching while the hind leg of the other pushes', () => {
  const st = crawler(); const swing = { hR: [], fR: [], hL: [], fL: [] }; let prev = null;
  for (let i = 0; i < 400; i++) {
    climbStep(st, { go: 1, bodyLen: 4, urgency: 0, rnd }, dt);
    for (const k of Object.keys(swing)) { const sw = st[k] > 0 && st[k] < 0.25; if (sw && !(prev?.[k])) swing[k].push(st.clock); }
    prev = { hR: st.hR > 0 && st.hR < 0.25, fR: st.fR > 0 && st.fR < 0.25, hL: st.hL > 0 && st.hL < 0.25, fL: st.fL > 0 && st.fL < 0.25 };
  }
  // the order inside a cycle: hind right, fore right, hind left, fore left, a quarter of a cycle apart
  const at = (k, n) => swing[k][n] - Math.floor(swing[k][n]);
  const q = (k) => +at(k, 1).toFixed(1);
  assert.ok(swing.hR.length >= 3 && swing.fR.length >= 3 && swing.hL.length >= 3 && swing.fL.length >= 3);
  assert.deepEqual([q('hR'), q('fR'), q('hL'), q('fL')].map((v) => (v + 0.1) % 1 < 0.15 ? 0 : v), [0, 0.3, 0.5, 0.8].map((v) => v), `swing starts ${[q('hR'), q('fR'), q('hL'), q('fL')]}`);
  // never more than one limb in its swing at a time: three on the wall (duty 0.75)
  const s2 = crawler(); let maxSwing = 0;
  for (let i = 0; i < 600; i++) { climbStep(s2, { go: 1, bodyLen: 4, rnd }, dt); maxSwing = Math.max(maxSwing, ['hR', 'fR', 'hL', 'fL'].filter((k) => s2[k] > 0 && s2[k] < 0.25).length); }
  assert.ok(maxSwing <= 2, `${maxSwing} limbs in their swing at once`);
});
test('crawl: the body advances its stride a cycle from the limbs\' stance, turns with the steer, and nothing moves once asked to stop', () => {
  const a = crawler(); let adv = 0, dyaw = 0; const T = 1.6;                    // (urgency 0: a cycle lasts 1.6 s)
  for (let i = 0; i < 4 * T / dt; i++) { const m = climbStep(a, { go: 1, steer: 1, bodyLen: 4, urgency: 0, rnd }, dt); adv += m.adv; dyaw += m.dyaw; }
  assert.ok(Math.abs(adv - 4 * 4 * 0.5) < 0.1 * 4 * 4 * 0.5, `advanced ${adv.toFixed(2)} cm in 4 cycles`);
  assert.ok(dyaw > 0.8 * 4 * 40 * Math.PI / 180, `turned ${dyaw}`);
  // asked to stop: it finishes the swing it is in and stands, no foot left in the air, nothing moves after
  let still = 0, moved = 0;
  for (let i = 0; i < 400; i++) { const m = climbStep(a, { go: 0, bodyLen: 4, rnd }, dt); if (i > 100) { if (m.adv || m.dyaw) moved++; else still++; } }
  assert.equal(moved, 0); assert.ok(still > 200);
  assert.ok(['hR', 'fR', 'hL', 'fL'].every((k) => !(a[k] > 1e-6 && a[k] < 0.25 - 1e-6)), `a limb left in its swing: ${['hR', 'fR', 'hL', 'fL'].map((k) => a[k].toFixed(3))}`);
});
test('crawl: the pose hangs the hind legs stretched at the lift-off and folds them up and out in the swing; the torso sways with the steps', () => {
  const st = crawler(); st.hR = 0; st.hL = 0.12; climbPose(st); const P = climbPose(st);
  assert.ok(P.legA[9] < 40 && P.legA[0] > 110, `right leg ${P.legA[9]}, left leg ${P.legA[0]}: one stretched, one folded forward`);
  let yawMax = 0, yawMin = 0; const s3 = crawler();
  for (let i = 0; i < 100; i++) { climbStep(s3, { go: 1, rnd }, dt); yawMax = Math.max(yawMax, s3.trunk[0]); yawMin = Math.min(yawMin, s3.trunk[0]); }
  assert.ok(yawMax > 8 && yawMin < -8, `sway ${yawMin} ... ${yawMax}`);
  assert.equal(climbMove(st).mode, 'climb');
});
