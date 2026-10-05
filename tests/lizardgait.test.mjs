// The lizard gait (src/util/lizardgait.js, G4): leg phases, duty, stride and frequency from the motion sheet
// (docs/agents/lizards/MOTION_gecko.md, "Published gait numbers"), the trunk's S-bend, the head held steady, the tail's
// counter-sway, foot targets that do not slide, start, stop, idle and the toe peel. Pure numbers, runs under Node.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GAIT, gaitAt, legU, stanceOf, peelOf, axialAt, neutralFeet, openFeet, lgNew, lgStep, lgFeet, bellyDrop, toBody, toWorld, reachFit, lgDraw, geckoDraw } from '../src/util/lizardgait.js';
import { surfaceFrame } from '../src/util/contain.js';

const P = GAIT.gecko, TAU = Math.PI * 2, DEG = Math.PI / 180;
const frac = (x) => x - Math.floor(x);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);
// a stand-in for the gecko's limb chains (model cm): shoulders and hips, the limb's reach
const CHAINS = [
  { limb: 1, side: -1, A: [-0.25, 0.45, 1.3], reach: 1.0 }, { limb: 2, side: 1, A: [0.25, 0.45, 1.3], reach: 1.0 },
  { limb: 3, side: -1, A: [-0.3, 0.5, -0.6], reach: 1.2 }, { limb: 4, side: 1, A: [0.3, 0.5, -0.6], reach: 1.2 },
];
const FEET0 = neutralFeet(P, CHAINS);

test('diagonal pairs half a cycle apart, offsets as published (sheet :58)', () => {
  const o = P.off, d = (a, b) => frac(o[a] - o[b]);
  near(d(2, 1), 0.5, 1e-9, 'RF against LF');
  near(d(4, 1), 0.93, 0.06, 'diagonal LF / RH in phase 0.93');
  near(d(3, 2), 0.93, 0.06, 'diagonal RF / LH in phase 0.93');
  near(d(3, 1), 0.45, 0.05, 'same side left antiphase 0.45');
  near(d(4, 2), 0.45, 0.05, 'same side right antiphase 0.45');
  const mid = (a, b) => frac(o[a] + (frac(o[b] - o[a] + 0.5) - 0.5) / 2);
  near(frac(mid(2, 3) - mid(1, 4)), 0.5, 1e-9, 'pair centres');
  for (const ph of [0, 1, 2.5, 7]) for (const leg of [1, 2, 3, 4]) near(legU(P, ph, leg), frac(ph / TAU - o[leg]), 1e-12, 'legU');
});

test('stride, frequency and duty from the sheet (:31, :32, :59, :60, :68)', () => {
  const walk = gaitAt(P, 4.5, 0);
  assert.ok(walk.f >= 1.5 && walk.f <= 3, `walk ${walk.f} Hz in the sheet's 1.5-3`);
  assert.ok(walk.duty > 0.6, `slow duty ${walk.duty} above 0.6`);
  const creep = gaitAt(P, 1.6, 0);
  assert.ok(creep.f >= 0.5 && creep.f <= 1.5, `creep ${creep.f} Hz near the climb's 1 Hz`);
  const dash = gaitAt(P, 60, 0);                     // 13.6 SVL/s, inside the published 5.6-15 SVL/s
  assert.ok(dash.f >= 11 && dash.f <= 16, `dash ${dash.f} Hz near the scaled 13.6`);
  near(dash.duty, 0.5, 0.06, 'dash duty');
  for (const g of [walk, creep, dash]) {
    const s = g.stride / P.svl;
    assert.ok(s >= 0.45 - 1e-9 && s <= 1.2 + 1e-9, `stride ${s} SVL in 0.45-1.2`);
    near(g.f * g.stride, g.veff, 1e-9, 'f x stride = speed');
    near(g.rate, TAU / g.stride, 1e-12, 'phase per cm');
  }
  near(gaitAt(P, 0, 2, 1.0).veff, 2, 1e-12, 'turning on the spot steps by the feet\'s speed');
  near(gaitAt(P, 4.5, 0, 0, 0.5).stride, walk.stride * 0.5, 1e-9, 'a half-size animal takes half the stride');
});

test('stance, swing and the toe peel (sheet :61)', () => {
  near(stanceOf(0.1, 0.6), 0.1 / 0.6, 1e-12, 'stance fraction');
  assert.equal(stanceOf(0.7, 0.6), -1);
  assert.equal(peelOf(P, -1), 0);
  assert.equal(peelOf(P, 0), 0);
  near(peelOf(P, P.attach), 1, 1e-9, 'attached after 13 %');
  assert.equal(peelOf(P, 0.5), 1);
  near(peelOf(P, 1 - P.peel / 2), 0.5, 1e-9, 'half peeled');
  near(peelOf(P, 1), 0, 1e-12, 'off at lift-off');
  near(P.attach, 0.13, 0.02, 'attach'); near(P.peel, 0.36, 0.04, 'peel');
});

test('trunk S-bend flips with each diagonal pair, head stays, tail counters (:25, :36, :65, :66)', () => {
  const o = P.off, cL = frac(o[3] + (frac(o[2] - o[3] + 0.5) - 0.5) / 2);   // LH + RF land
  const at = (c, calm = 0) => axialAt(P, c * TAU, calm, {});
  const A = P.wave.spine + P.wave.neck;
  assert.ok(A >= 15 * DEG && A <= 20 * DEG, `head against pelvis ${A / DEG} deg in 15-20`);
  assert.ok(P.wave.spine <= 12 * DEG, 'mid-trunk about 10 deg');
  const a0 = at(cL), a1 = at(cL + 0.5), aq = at(cL + 0.25);
  near(a0.spine + a0.neck, -A, 1e-9, 'convex right (front turned to -x) as LH + RF land');
  near(a1.spine + a1.neck, A, 1e-9, 'convex left as the other pair lands');
  near(aq.spine + aq.neck, 0, 1e-9, 'straight at mid-stance');
  let corr = 0, tMax = 0, hMax = 0, tPeak = 0, bPeak = 0, tBest = -1, bBest = -1;
  for (let i = 0; i < 400; i++) {
    const c = i / 400, a = at(c), b = a.spine + a.neck, t = a.tail.reduce((m, v) => m + v, 0);
    assert.ok(Math.abs(a.head + b) < 2 * DEG, 'head yaw residual under 2 deg');
    hMax = Math.max(hMax, Math.abs(a.head)); tMax = Math.max(tMax, Math.abs(t)); corr += b * t;
    if (b > bBest) { bBest = b; bPeak = c; }
    if (-t > tBest) { tBest = -t; tPeak = c; }
  }
  assert.ok(hMax >= 15 * DEG && hMax <= 20 * DEG, `head yaw against the trunk ${hMax / DEG} deg`);
  assert.ok(tMax <= 10 * DEG + 1e-9 && tMax > 2 * DEG, `tail lateral ${tMax / DEG} deg, at most 10`);
  assert.ok(corr < 0, 'the tail swings against the front');
  const lag = frac(tPeak - bPeak);
  assert.ok(lag > 0 && lag < 0.35, `the tail lags the trunk (${lag} cycle)`);
  const still = at(0.3, 1);
  for (const v of [still.spine, still.neck, still.head, ...still.tail]) assert.equal(v, 0);
});

test('open feet: a stance foot moves back at the body\'s speed (no slip), swings lift', () => {
  const v = 4.5, g = gaitAt(P, v, 0), dt = 1 / 240, out = {};
  let ph = 0.3, z = 0, prev = null, maxLift = 0;
  for (let i = 0; i < 480; i++) {
    openFeet(P, FEET0, ph, v, 0, 1, out);
    const w = out.feet.map((p) => [p[0], p[2] + z]);
    for (let k = 0; k < 4; k++) {
      if (out.stance[k]) assert.equal(out.lift[k], 0);
      else maxLift = Math.max(maxLift, out.lift[k]);
      if (prev && prev.st[k] && out.stance[k]) {
        near(w[k][0], prev.w[k][0], 1e-9, 'stance x');
        near(w[k][1], prev.w[k][1], 1e-6, 'stance z in the world');
      }
    }
    assert.ok(out.stance.reduce((m, s) => m + s, 0) >= 2, 'at least a diagonal pair on the ground');
    prev = { w, st: [...out.stance] };
    ph += g.rate * v * dt; z += v * dt;
  }
  near(maxLift, P.lift * P.svl, 0.01, 'swing height');
});

// a slope (the surface frame tilted) and a body walking and turning on it
function walkOn(n, v, w, secs, dt, s, cb, t0 = { yaw: 0.3, p: [1, 0, 2] }) {
  const pose = { p: [...t0.p], f: surfaceFrame(n[0], n[1], n[2], t0.yaw) };
  const surf = (x, y, z, _n, out) => { const d = x * n[0] + y * n[1] + z * n[2]; out[0] = x - d * n[0]; out[1] = y - d * n[1]; out[2] = z - d * n[2]; out[3] = n[0]; out[4] = n[1]; out[5] = n[2]; return out; };
  let yaw = t0.yaw;
  const vv = typeof v === 'function' ? v : () => v;
  for (let i = 0; i * dt < secs; i++) {
    const sp = vv(i * dt);
    yaw += w * dt; surfaceFrame(n[0], n[1], n[2], yaw, pose.f);
    for (let j = 0; j < 3; j++) pose.p[j] += pose.f[j] * sp * dt;
    lgStep(s, P, pose, sp, w, dt, surf, 1);
    cb?.(pose, i * dt, sp);
  }
  return pose;
}

test('planted feet hold their world point while the body walks and turns on a slope', () => {
  const l = Math.hypot(0, 0.8, 0.6), n = [0, 0.8 / l, 0.6 / l], s = lgNew(P, FEET0), out = {};
  let prev = null, touch = [0, 0, 0, 0], stanceFrames = 0;
  walkOn(n, 4.5, 0.8, 3, 1 / 60, s, (pose) => {
    lgFeet(s, P, pose, 1, out);
    const cur = [0, 1, 2, 3].map((k) => [s.feet[k * 12], s.feet[k * 12 + 1], s.feet[k * 12 + 2]]);
    for (let k = 0; k < 4; k++) {
      const back = toWorld(pose, out.feet[k], [0, 0, 0]);
      for (let j = 0; j < 3; j++) near(back[j], cur[k][j], 1e-4, 'body target maps back to the foot');
      if (out.stance[k]) {
        near(cur[k][0] * n[0] + cur[k][1] * n[1] + cur[k][2] * n[2], 0, 1e-4, 'stance foot on the surface');
        if (prev?.st[k]) { stanceFrames++; for (let j = 0; j < 3; j++) assert.equal(cur[k][j], prev.p[k][j], 'planted foot moved'); }
        else if (prev) touch[k]++;
      }
    }
    prev = { p: cur, st: [...out.stance] };
  });
  const cycles = 3 * gaitAt(P, 4.5, 0.8, s.reach).f;
  for (const t of touch) assert.ok(t >= Math.floor(cycles) - 1 && t <= Math.ceil(cycles) + 1, `touchdowns ${t} for ${cycles} cycles`);
  assert.ok(stanceFrames > 300, 'stance frames seen');
});

test('stop, idle and start: swings finish, the wave settles, the pair furthest back steps first', () => {
  const n = [0, 1, 0], s = lgNew(P, FEET0), out = {};
  let tStop = null, tAll = null, lastPhase = null, frozen = true;
  const pose = walkOn(n, (t) => (t < 1.37 ? 4.5 : 0), 0, 2.6, 1 / 60, s, (pose, t, sp) => {
    lgFeet(s, P, pose, 1, out);
    if (sp === 0 && tStop == null) tStop = t;
    if (tStop != null && tAll == null && out.stance.every((x) => x === 1)) tAll = t;
    if (tAll != null && t > tAll + 0.05) { if (lastPhase != null && s.phase !== lastPhase) frozen = false; lastPhase = s.phase; }
  });
  const g = gaitAt(P, 4.5, 0);
  assert.ok(tAll != null && tAll - tStop <= (1 - g.duty) / g.f + 0.04, `all feet down ${tAll - tStop} s after the stop`);
  assert.ok(frozen, 'phase frozen while still');
  assert.ok(s.calm > 0.95, `calm ${s.calm}`);
  const ax = axialAt(P, s.phase, s.calm, {});
  assert.ok(Math.abs(ax.spine) < 0.5 * DEG && Math.abs(ax.head) < 1 * DEG, 'trunk straight at rest');
  for (let k = 0; k < 4; k++) { assert.equal(out.stance[k], 1); assert.equal(out.peel[k], 1, 'toes stuck while idle'); }
  // which pair stands further back (against the neutral sprawl)
  const back = (a, b) => (out.feet[a][2] - FEET0[a][2] + out.feet[b][2] - FEET0[b][2]) / 2;
  const first = back(0, 3) <= back(1, 2) ? [0, 3] : [1, 2];
  assert.ok(Math.abs(back(0, 3) - back(1, 2)) > 0.05, 'one pair stopped further back');
  // restart from where it stands
  const surf = (x, y, z, _n, o) => { o[0] = x; o[1] = 0; o[2] = z; o[3] = 0; o[4] = 1; o[5] = 0; return o; };
  lgStep(s, P, pose, 4.5, 0, 1 / 60, surf, 1);
  lgFeet(s, P, pose, 1, out);
  const up = [0, 1, 2, 3].filter((k) => out.stance[k] === 0);
  assert.ok(up.length > 0 && up.every((k) => first.includes(k)), `first lift-off ${up} from the pair further back ${first}`);
});

test('belly target from the sheet (:24, :27)', () => {
  assert.ok(P.belly.ground <= 0.05 && P.belly.wall <= 0.05, 'belly on or within a few hundredths of a cm');
  near(bellyDrop(P, 'ground', 0.27), 0.27 - P.belly.ground, 1e-12, 'drop on the ground');
  near(bellyDrop(P, 'wall', 0.39), 0.39 - P.belly.wall, 1e-12, 'drop on a wall');
  assert.equal(bellyDrop(P, 'ground', 0), 0);
  const pose = { p: [1, 2, 3], f: surfaceFrame(0, 0, 1, 0.4) }, b = toBody(pose, toWorld(pose, [0.3, -0.2, 0.7], [0, 0, 0]), [0, 0, 0]);
  near(b[0], 0.3, 1e-12, 'x'); near(b[1], -0.2, 1e-12, 'y'); near(b[2], 0.7, 1e-12, 'z');
});

test('N7 reach guard: stance centred on each leg\'s span, stride capped to the narrowest, gaitAt keeps under the cap', () => {
  const feet = [[-1, 0, 2], [1, 0, 2], [-1, 0, -0.5], [1, 0, -0.5]], spans = [[-0.8, 0.4], [-0.8, 0.4], [-0.3, 1.1], [-0.3, 1.5]];
  const fit = reachFit(feet, spans, 0.65);
  assert.deepEqual(fit.feet.map((f) => +f[2].toFixed(3)), [1.8, 1.8, -0.1, 0.1]);
  assert.ok(Math.abs(fit.cap - 1.2 / 0.65) < 1e-9, `cap ${fit.cap}`);
  const P = GAIT.gecko, g = gaitAt(P, 4.5, 0, 0, 1, {}, fit.cap), g0 = gaitAt(P, 4.5, 0, 0, 1, {});
  assert.ok(g.stride <= fit.cap + 1e-12 && g0.stride > fit.cap, `${g.stride} vs ${g0.stride}`);
  assert.ok(Math.abs(g.f * g.stride - 4.5) < 1e-9, 'the feet step faster, the body keeps its speed');
  const s = lgNew(P, fit.feet, fit.cap), surf = (x, y, z, n, o) => { o[0] = x; o[1] = 0; o[2] = z; o[3] = 0; o[4] = 1; o[5] = 0; return o; };
  const st = lgDraw(s, P, { p: [0, 0, 0], f: [0, 0, 1, 1, 0, 0, 0, 1, 0] }, 4.5, 0, 0.04, surf, 1, 0.16, {});
  assert.equal(st.drop, 0.16); assert.equal(st.phase, s.phase); assert.equal(st.feet.length, 4);
});

test('N7 geckoDraw: keeps the planted-feet state on the animal, made from the rig\'s guarded feet and cap', () => {
  const P = GAIT.gecko, feet = [[-1, 0, 2], [1, 0, 2], [-1, 0, -0.5], [1, 0, -0.5]], fit = reachFit(feet, [[-0.8, 0.4], [-0.8, 0.4], [-0.3, 1.1], [-0.3, 1.5]], P.duty[0]);
  const rig = { gait: P, feet0: feet, feetFit: fit.feet, strideCap: fit.cap, drop: 0.16 }, a = {};
  const surf = (x, y, z, n, o) => { o[0] = x; o[1] = 0; o[2] = z; o[3] = 0; o[4] = 1; o[5] = 0; return o; }, f = [0, 0, 1, 1, 0, 0, 0, 1, 0];
  let st;
  for (let i = 0; i < 50; i++) st = geckoDraw(a, rig, { p: [0, 0, 0.18 * i], f }, surf, 4.5, 0, 0.04, 1, {});
  assert.ok(a._lg && a._lg.cap === fit.cap && a._lg.feet0 === fit.feet, 'state on the animal from feetFit / strideCap');
  assert.ok(a._lg.g.stride <= fit.cap + 1e-12, `stride ${a._lg.g.stride} under the cap ${fit.cap}`);
  assert.equal(st.drop, 0.16); assert.equal(st.feet.length, 4);
});
