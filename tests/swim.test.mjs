// The anuran swimming blueprint's motion layer (util/gait.js, util/bodyplan.js SWIM): a frog kicks and travels with the stroke.
import test from 'node:test';
import assert from 'node:assert/strict';
import { swimState, swimStep, swimPose, kickRate, strokeAngles, armAngles, armOpen, legExtension, leapStroke, HIND, FORE, STROKE, STROKE_KEYS } from '../src/util/gait.js';
import { SWIM, swimProfile, PLANS } from '../src/util/bodyplan.js';
import { skeletonRig, poseStroke, applyBone, ROW_FLOATS } from '../src/render/creatures/skeleton.js';
import fs from 'node:fs';

const seeded = (s = 7) => () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
// Swims for `secs` at 30 ticks a second: distance, kicks, the speeds, the share of ticks with no stroke (resting between bursts).
function run(id, { urgency = 0.95, floating = false, bodyLen = 4.2, secs = 30 } = {}) {
  const prof = swimProfile(id), st = swimState(seeded()), rnd = seeded(11), dt = 1 / 30;
  let d = 0, still = 0;
  const vs = [];
  for (let i = 0; i < secs * 30; i++) {
    const v = swimStep(st, prof, { urgency, floating, bodyLen, rnd }, dt);
    d += v * dt; vs.push(v);
    if (st.rest > 0) still++;          // (between bursts: no stroke)
  }
  vs.sort((a, b) => a - b);
  return { d, kicks: st.kicks, still: still / (secs * 30), p50: vs[vs.length >> 1], p95: vs[Math.floor(vs.length * 0.95)] };
}

test('every frog profile is complete and the toad out-swims a poison frog', () => {
  for (const id of Object.keys(SWIM)) {
    const p = swimProfile(id);
    for (const k of ['kickHz', 'reach', 'burst', 'rest', 'drag', 'sink', 'level', 'headUp']) assert.ok(p[k] != null, `${id}.${k}`);
    assert.ok(p.kickHz[1] > p.kickHz[0] && p.kickHz[1] <= 3.2, `${id}: urgent kicks a second`);
  }
  assert.ok(swimProfile('toad').reach > swimProfile('dartfrog').reach && swimProfile('toad').float && !swimProfile('dartfrog').float);
  assert.ok(kickRate(swimProfile('dartfrog'), 1) >= 2 && kickRate(swimProfile('dartfrog'), 1) <= 3, 'a small frog fleeing kicks 2-3 times a second');
});

test('a frog travels by its kicks: about `reach` body lengths a kick, in pulses', () => {
  for (const id of ['dartfrog', 'strawberry', 'bumblebee', 'redeye', 'toad']) {
    const r = run(id), prof = swimProfile(id), perKick = r.d / r.kicks / 4.2;
    assert.ok(Math.abs(perKick - prof.reach) < prof.reach * (prof.float ? 0.4 : 0.25), `${id}: ${perKick.toFixed(2)} body lengths a kick, want ${prof.reach}`);
    assert.ok(r.p95 > 2 * r.p50, `${id}: surges (p95 ${r.p95.toFixed(2)} vs median ${r.p50.toFixed(2)} cm/s)`);
  }
  // a dart frog of 4.2 cm making for the bank: 3 to 6 cm a second
  const r = run('dartfrog');
  assert.ok(r.d / 30 > 3 && r.d / 30 < 6, `${(r.d / 30).toFixed(2)} cm/s`);
});

test('swimming, the legs work: little of the time without a stroke', () => {
  // (the toad, a strong swimmer at home in the water, glides and rests longer: not held to this)
  for (const id of ['dartfrog', 'strawberry', 'bumblebee', 'reedfrog', 'redeye']) {
    const r = run(id, { urgency: 0.95 });
    assert.ok(r.still < 0.25, `${id}: no stroke ${(r.still * 100).toFixed(0)}% of the time`);
  }
});

test('the stroke: the legs kick out, close and trail through the glide, draw up in the recovery; posture level, head up', () => {
  const prof = swimProfile('leucomelas'), at = (phase) => swimPose({ phase, rest: 0 }, prof);
  // (the glide 0.26-0.55, the diamond held 0.68-0.74 half drawn, the turn-out from 0.9: STROKE_KEYS since 5 Oct 15:2x)
  assert.ok(at(0.01).hop < 0.1 && at(STROKE.thrust).hop > 0.75 && at(0.3).hop === 1 && at(0.5).hop === 1 && at(0.8).hop < 0.5 && at(0.99).hop < 0.05);
  // the legs are drawn up (a sitting frog's fold) only briefly before each thrust: about a quarter of the stroke
  let folded = 0; for (let p = 0; p < 1; p += 0.001) if (at(p).hop < 0.3) folded++;
  assert.ok(folded < 260, `${folded / 10}% of the stroke folded`);
  for (let p = 0; p < 1; p += 0.05) {
    const s = at(p);
    assert.ok(s.calm === 1 && s.stroke.ampL === 1 && s.stroke.ampR === 1 && s.stroke.pL === s.stroke.pR, 'both legs together, the walk off');
    assert.ok(s.pitch < prof.level && s.pitch > prof.level - 0.3, 'trunk flat with the nose a little up');
  }
  // the forelegs are braced forward as it draws its legs up (at most halfway) and laid back as it drives
  assert.ok(at(0.95).stroke.arms > at(0.4).stroke.arms + 0.35 && at(0.95).stroke.arms <= 0.5);
});

test('the stroke as joint angles: cocked, a wide kick, legs together in the glide, a diamond in the recovery', () => {
  const A = (p, amp = 1, fl = 0) => Array.from(strokeAngles(p, new Float32Array(9), 0, amp, fl));
  // periodic and smooth: no joint jumps more than 12 degrees in a hundredth of a stroke
  for (let c = 0; c < 9; c++) assert.ok(Math.abs(A(0)[c] - A(0.99999)[c]) < 0.1);
  let worst = 0, prev = A(0);
  for (let i = 1; i <= 400; i++) { const a = A(i / 400); for (let c = 0; c < 9; c++) worst = Math.max(worst, Math.abs(a[c] - prev[c])); prev = a; }
  assert.ok(worst < 5, `largest step ${worst.toFixed(1)} degrees in 1/400 of a stroke`);
  // it passes through its keys
  for (const [t, k] of STROKE_KEYS) for (let c = 0; c < 9; c++) assert.ok(Math.abs(A(t % 1)[c] - HIND[t === 1 ? 'cock' : k][c]) < 0.6, `${k} channel ${c}`);
  // cocked: the knees at the sides at or a little ahead of the hips (thigh 95-110: the owner's pool frog 14.7 s and toad 3.2 s,
  // .agents/muscles/refs/SWIM.md; until 5 Oct > 110), the feet turned out to the sides; the kick drives the thigh back (proximal
  // first: half way through the thrust the thigh has moved further than the foot); the glide: every segment within 15 degrees of
  // straight back
  const cock = A(0), mid = A(STROKE.thrust / 2), open = A(STROKE.thrust), glide = A(0.4), draw = A(0.74);
  assert.ok(cock[0] >= 95 && cock[0] <= 110 && cock[2] >= 80);
  assert.ok(cock[0] - mid[0] > cock[2] - mid[2], 'the hip leads the ankle');
  assert.ok(open[0] < 45 && open[0] > 25, 'legs straight in a V at the end of the thrust');
  for (let c = 0; c < 4; c++) assert.ok(Math.abs(glide[c]) < 15, `glide: segment ${c} at ${glide[c].toFixed(0)}`);
  // the diamond (pool 12.6-13.7 s: thigh 40-50 out of straight back, shins angled back in to the heels) at 0.72, held there by a frog
  // pottering (swimStep's DIAMOND_HOLD, tested below)
  const dia = A(0.72);
  assert.ok(dia[0] > 40 && dia[1] < -25 && draw[0] > 40, 'recovery: knees out, shins angled back in (a diamond from above)');
  for (let c = 0; c < 9; c++) assert.ok(Math.abs(dia[c] - HIND.draw[c]) < 0.6, `the diamond at 0.72: channel ${c}`);
  // the turn-out: the heels part as the feet turn out (pool 14.6-14.7: no X behind the body), the shin no further in than -25
  const turn = A(0.92); assert.ok(turn[1] >= -25.5 && turn[2] >= 40, `turn-out: shin ${turn[1].toFixed(0)}, foot ${turn[2].toFixed(0)}`);
  // a leg that kicks less holds the diamond (pool 13.8-14.4 s: one leg kicks to turn, the other holds); floating is the species'
  // floating posture (the owner, 5 Oct: "species based mix")
  for (let c = 0; c < 9; c++) {
    assert.ok(Math.abs(A(0.4, 0)[c] - HIND.draw[c]) < 1e-3);
    assert.ok(Math.abs(A(0.1, 1, 1)[c] - HIND.float[c]) < 1e-3);
    assert.ok(Math.abs(Array.from(strokeAngles(0.1, new Float32Array(9), 0, 1, 1, 'trail'))[c] - HIND.floatTrail[c]) < 1e-3);
  }
  assert.ok(legExtension(0) === 0 && legExtension(0.4) === 1);
  // forelegs: laid back to braced forward with the elbow bent (never out like wings: the pool frog's arms lie along the body in the
  // glide; A2, control/anatomy-A2.md 26); floating, the spread-eagled toad hangs them, the others keep them back
  const F = (o, fl = 0, fp = 'spread') => Array.from(armAngles(o, new Float32Array(6), 0, fl, fp));
  assert.deepEqual(F(0), FORE.tuck); assert.deepEqual(F(1), FORE.brace); assert.deepEqual(F(0.3, 1), FORE.hang); assert.deepEqual(F(0.3, 1, 'trail'), FORE.tuck);
  assert.ok(armOpen(0.95, 1, 0.3) === 1 && Math.abs(armOpen(0.4, 1, 0.3) - 0.3) < 1e-9);
});

// The diamond held longer by a frog pottering than by one fleeing (the pool frog held it about twice its draw: SWIM.md; A2 25 asks for
// a hold that varies, none for a fleeing frog).
test('a frog pottering holds the diamond a moment; one fleeing goes straight through', () => {
  const held = (urgency) => {
    const prof = swimProfile('dartfrog'), st = swimState(seeded()); let inHold = 0, n = 0;
    for (let i = 0; i < 30 * 60; i++) { swimStep(st, prof, { urgency, bodyLen: 4.2, rnd: seeded(5) }, 1 / 60); if (st.rest > 0) continue; n++; if (st.hold > 0) inHold++; }
    return inHold / n;
  };
  const slow = held(0.1), fast = held(1);
  assert.ok(fast === 0 && slow > 0.05, `diamond held ${(slow * 100).toFixed(0)} % of the time pottering, ${(fast * 100).toFixed(0)} % fleeing`);
});

test('pottering it kicks one leg after the other; turning, the inner leg trails', () => {
  const prof = swimProfile('toad'), st = swimState(seeded());
  for (let i = 0; i < 90; i++) swimStep(st, prof, { urgency: 0.2, bodyLen: 4.5, rnd: seeded(3) }, 1 / 30);
  assert.ok(st.alt > 0.9);
  const s = swimPose(st, prof).stroke;
  assert.ok(Math.abs(s.pR - s.pL - 0.5) < 0.06, 'the legs half a stroke apart');
  for (let i = 0; i < 90; i++) swimStep(st, prof, { urgency: 0.95, steer: 1, bodyLen: 4.5, rnd: seeded(3) }, 1 / 30);
  const t = swimPose(st, prof).stroke;
  assert.ok(st.alt < 0.1 && t.ampR < 0.4 && t.ampL > 0.9, 'turning toward +x: the +x leg trails, the other drives');
  // slower when it potters than when it means to get somewhere
  const fast = run('toad', { urgency: 0.95 }).d, slow = run('toad', { urgency: 0.2 }).d;
  assert.ok(slow < fast * 0.6, `${slow.toFixed(0)} cm against ${fast.toFixed(0)} cm in 30 s`);
});

test('the fire-bellied toad rests floating, limbs spread, hardly moving', () => {
  const r = run('toad', { floating: true, secs: 20 });
  assert.ok(r.d < 2, `drifted ${r.d.toFixed(2)} cm`);
  const st = swimState(seeded());
  for (let i = 0; i < 90; i++) swimStep(st, swimProfile('toad'), { floating: true, bodyLen: 4.5 }, 1 / 30);
  const s = swimPose(st, swimProfile('toad'), { level: 0 });
  assert.ok(st.fl > 0.95 && s.stroke.float > 0.95 && s.hop > 0.35 && s.hop < 0.75 && s.pose < 1);
  assert.ok(s.pitch < -0.3, 'it hangs head up');
});

// The swimming body's skeleton, posed by the stroke (render/creatures/skeleton.js poseStroke).
const man = JSON.parse(fs.readFileSync(new URL('../public/assets/creatures/manifest.json', import.meta.url), 'utf8'));
test('every frog with a sitting skeleton has a swimming body with its own', () => {
  for (const [id, m] of Object.entries(man)) {
    if (m.skeleton?.bind === 'swim' || !m.skeleton || m.pose || (m.skeleton.plan ?? 'anuran') !== 'anuran') continue;   // (frogs only: a lizard has no swimming body)
    const sw = man[`${id}.swim`] ?? man[`${id.split(':')[0]}.swim`];      // (a morph without its own swims in the species' one)
    assert.ok(sw?.skeleton?.bind === 'swim' && sw.skeleton.bones.length === 17, `${id}.swim`);
    assert.ok(skeletonRig(sw.skeleton)?.stroke, `${id}.swim rig`);
  }
});

test('poseStroke: bones keep their length and stay in the joints\' ranges, the legs mirror, feet together but not through each other', () => {
  const skel = man['leucomelas.swim'].skeleton, rig = skeletonRig(skel), row = new Float32Array(ROW_FLOATS);
  const P = PLANS.anuran.joints, tipOf = (b, info) => info.tips[rig.B[b].limb];
  const pt = (b, p) => applyBone(row, 0, b, p), d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  let closest = 9, widest = 0;
  for (let i = 0; i < 100; i++) {
    const p = i / 100, w = swimPose({ phase: p }, swimProfile('leucomelas'), { level: 0 }), info = poseStroke(rig, w.stroke, row, 0, {});
    for (let b = 0; b < rig.n; b++) {
      // rigid: a bone's ends stay its length apart, and a child starts where its parent ends (within the scan's own gaps)
      assert.ok(Math.abs(d(pt(b, rig.head[b]), pt(b, rig.tail[b])) - rig.L[b]) < 1e-4, `${rig.B[b].name} length at ${p}`);
      const pa = rig.parent[b];
      if (pa >= 0 && rig.B[b].limb && rig.B[pa].limb) assert.ok(d(pt(b, rig.head[b]), pt(pa, rig.tail[pa])) < 1e-4, `${rig.B[b].name} joined to ${rig.B[pa].name} at ${p}`);
    }
    for (const [name, a] of Object.entries(info.bend)) { const lim = P[name.replace(/[LR]$/, '')]; assert.ok(a >= lim.min - 0.5 && a <= lim.max + 0.5, `${name} bent ${a.toFixed(0)} at ${p} (range ${lim.min}-${lim.max})`); }
    // mirror: left and right toe tips at the same height and distance back, opposite sides
    const L = info.tips[3], R = info.tips[4];
    // (the scan's two legs are not quite the same length: within half a centimetre)
    assert.ok(Math.abs(L[0] + R[0]) < 0.5 && Math.abs(L[1] - R[1]) < 0.5 && Math.abs(L[2] - R[2]) < 0.5, `mirror at ${p}`);
    const gap = Math.min(pt(rig.byName.footR, rig.head[rig.byName.footR])[0] - pt(rig.byName.footL, rig.head[rig.byName.footL])[0], R[0] - L[0]);
    closest = Math.min(closest, gap); widest = Math.max(widest, R[0] - L[0]);
  }
  const r = skel.bones.find((b) => b.name === 'footR').r;
  assert.ok(closest > 2 * r * 0.8, `feet ${closest.toFixed(2)} cm apart at the closest (foot radius ${r})`);
  assert.ok(widest > 4.5, `the kick spreads the feet ${widest.toFixed(1)} cm`);
  // the glide: toes trail more than a trunk length behind the vent; a missing stroke is the glide
  const vent = rig.head[rig.byName.pelvis][2], g = poseStroke(rig, null, row, 0, {});
  assert.ok(vent - g.tips[4][2] > 3.5, `toes ${(vent - g.tips[4][2]).toFixed(1)} cm behind the vent`);
});

test('a leap, by the same body: cocked on the ground, legs straight and trailing in the air, folded and arms forward to land', () => {
  const skel = man['leucomelas.swim'].skeleton, rig = skeletonRig(skel), row = new Float32Array(ROW_FLOATS), P = PLANS.anuran.joints;
  const at = (t) => { const s = leapStroke(t); return { s, info: poseStroke(rig, s, row, 0, {}) }; };
  const hipZ = rig.head[rig.byName.thighR][2], sh = rig.head[rig.byName.armR];
  // on the ground the legs are cocked and the hands under the shoulders; mid-air the toes trail far behind the hips, the hands are
  // drawn back behind the shoulders; landing, the hands are ahead of and below the shoulders and the legs folded again
  assert.deepEqual(Array.from(at(0).s.legA), HIND.fold); assert.deepEqual(Array.from(at(0).s.armA), FORE.stand);
  const air = at(0.35), land = at(0.82), end = at(1);
  assert.ok(hipZ - air.info.tips[4][2] > 3.5, `toes ${(hipZ - air.info.tips[4][2]).toFixed(1)} cm behind the hips in the air`);
  assert.ok(air.info.tips[2][2] < sh[2], 'hands behind the shoulders in the air');
  assert.ok(land.info.tips[2][2] > sh[2] + 0.5 && land.info.tips[2][1] < sh[1] - 0.4, 'hands forward and down to land');
  assert.ok(hipZ - end.info.tips[4][2] < 2.5, 'legs folded at the landing');
  // the hips and knees straighten before the ankles and feet
  const e = at(0.07).s.legA;
  assert.ok((HIND.fold[0] - e[0]) / (HIND.fold[0] - HIND.leap[0]) > (HIND.fold[2] - e[2]) / (HIND.fold[2] - HIND.leap[2]) + 0.1);
  // continuous, and every joint inside a frog's range all the way
  let prev = at(0).s, worst = 0;
  for (let i = 1; i <= 200; i++) {
    const { s, info } = at(i / 200);
    for (let c = 0; c < 9; c++) worst = Math.max(worst, Math.abs(s.legA[c] - prev.legA[c]));
    for (let c = 0; c < 6; c++) worst = Math.max(worst, Math.abs(s.armA[c] - prev.armA[c]));
    prev = { legA: Float32Array.from(s.legA), armA: Float32Array.from(s.armA) };
    for (const [name, a] of Object.entries(info.bend)) { const lim = P[name.replace(/[LR]$/, '')]; assert.ok(a >= lim.min - 0.5 && a <= lim.max + 0.5, `${name} bent ${a.toFixed(0)} at ${i / 200}`); }
  }
  assert.ok(worst < 12, `largest step ${worst.toFixed(1)} degrees in 1/200 of a leap`);
});

test('on the bottom it sits as on land: no stroke, legs folded and hands down; its body is spheres for the water it moves', () => {
  const prof = swimProfile('toad'), st = swimState(seeded());
  for (let i = 0; i < 60; i++) swimStep(st, prof, { urgency: 0.7, bodyLen: 4.5, rnd: seeded(3) }, 1 / 30);
  assert.ok(st.v > 0.5);
  const ph = st.phase;
  for (let i = 0; i < 60; i++) swimStep(st, prof, { sitting: true, bodyLen: 4.5 }, 1 / 30);
  assert.ok(st.sit > 0.99 && st.v < 0.01 && st.phase === ph, 'sat down: no way on, the stroke held');
  const skel = man['toad.swim'].skeleton, rig = skeletonRig(skel), row = new Float32Array(ROW_FLOATS);
  const sit = poseStroke(rig, swimPose(st, prof, { level: 0 }).stroke, row, 0, {}), land = poseStroke(rig, leapStroke(0), row, 0, {});
  for (const k of [1, 2, 3, 4]) for (let c = 0; c < 3; c++) assert.ok(Math.abs(sit.tips[k][c] - land.tips[k][c]) < 0.05, `limb ${k} as it sits on land`);
  // the hull: the trunk's three spheres and one at the end of every limb bone (2 x (4 + 3)), each inside the body's reach, the feet
  // counted wider than their bones (the web)
  assert.equal(sit.hull.length, 17);
  const size = man['toad.swim'].sizeCm;
  for (const h of sit.hull) assert.ok(h[3] > 0.1 && h[3] < 1.5 && Math.abs(h[0]) < size[0] && Math.abs(h[2]) < size[2] * 1.2, JSON.stringify(h));
  const glide = poseStroke(rig, null, row, 0, {});
  const foot = skel.bones.find((b) => b.name === 'footR').r;
  assert.ok(glide.hull.some((h) => Math.abs(h[3] - foot * 2.2) < 1e-6), 'a foot is a paddle');
  // a kick moves the feet's spheres far further than the trunk's (which do not move in the body's frame at all)
  const a = poseStroke(rig, swimPose({ phase: 0.02 }, prof, { level: 0 }).stroke, row, 0, {}).hull.map((h) => [...h]);
  const b = poseStroke(rig, swimPose({ phase: 0.14 }, prof, { level: 0 }).stroke, row, 0, {}).hull;
  const moved = a.map((h, i) => Math.hypot(h[0] - b[i][0], h[1] - b[i][1], h[2] - b[i][2]));
  assert.ok(Math.max(...moved.slice(0, 3)) < 1e-9 && Math.max(...moved.slice(3)) > 2, `feet moved ${Math.max(...moved).toFixed(1)} cm in a kick`);
});

test('only a frog at home in the water dives', () => {
  assert.ok(swimProfile('toad').dive && swimProfile('toad').float);
  for (const id of ['dartfrog', 'leucomelas', 'auratus', 'strawberry', 'bumblebee', 'reedfrog', 'redeye']) assert.ok(!swimProfile(id).dive && !swimProfile(id).float, id);
  assert.ok(man['redeye.swim']?.skeleton?.bind === 'swim', 'the red-eyed tree frog has the body it leaps in');
});
