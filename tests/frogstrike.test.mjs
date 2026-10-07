// The frog's tongue strike as one movement (src/util/frogstrike.js; gate 4, the common frog, 7 Oct 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import { FROG_STRIKE, strikeCurves, tongueAngles, strikeTime } from '../src/util/frogstrike.js';

const T = Array.from({ length: 201 }, (_, i) => i / 200);

test('the mouth is shut and the tongue in at both ends of the strike', () => {
  for (const t of [0, 1]) {
    const c = strikeCurves(t);
    assert.ok(Math.abs(c.gape) < 1e-6 && Math.abs(c.p) < 1e-6 && Math.abs(c.s - 1) < 1e-6 && Math.abs(c.h) < 1e-6, JSON.stringify(c));
  }
});

test('bounds: gape at most the plan, stretch at most 1.3, projection 0..1', () => {
  for (const t of T) {
    const c = strikeCurves(t);
    assert.ok(c.gape >= -1e-9 && c.gape <= FROG_STRIKE.gapeDeg * Math.PI / 180 + 1e-9);
    assert.ok(c.s >= 1 - 1e-9 && c.s <= 1.3 + 1e-9, `stretch ${c.s} at ${t}`);
    assert.ok(c.p >= -1e-9 && c.p <= 1 + 1e-9);
  }
});

test('the jaw is open before the tongue leaves and does not close on it', () => {
  for (const t of T) {
    const c = strikeCurves(t);
    // (the jaws start to close while the tongue is drawn back, as the frog's do: wide open while a third of it is out, half open while any of it is)
    const need = c.p > 0.33 ? 0.8 : c.p > 0.05 ? 0.5 : 0;
    assert.ok(c.gape >= need * FROG_STRIKE.gapeDeg * Math.PI / 180, `tongue ${c.p.toFixed(2)} out with the jaw at ${(c.gape * 180 / Math.PI).toFixed(1)} deg (t ${t})`);
  }
});

test('the tongue is a whip: the base turns first, every segment after its proximal neighbour', () => {
  for (const p of [0.1, 0.3, 0.5, 0.7]) {
    const a = tongueAngles(p), f = a.map((v, k) => v / ((FROG_STRIKE.a0Deg + k * FROG_STRIKE.dDeg) * Math.PI / 180));
    for (let k = 1; k < 4; k++) assert.ok(f[k] <= f[k - 1] + 1e-9, `segment ${k} ahead of ${k - 1} at p ${p}`);
  }
  const full = tongueAngles(1);
  assert.ok(full.every((v, k) => Math.abs(v - (FROG_STRIKE.a0Deg + k * FROG_STRIKE.dDeg) * Math.PI / 180) < 1e-6), 'fully out: the plan\'s angles');
  assert.ok(full[0] > 140 * Math.PI / 180, 'flipped over the jaw tip (more than 140 deg at the base)');
});

test('the sim\'s phases map onto the timeline in order', () => {
  assert.equal(strikeTime('aim', 0.2, 0.3), 0);
  assert.equal(strikeTime('out', 0.15, 0.15), 0.40);
  assert.ok(Math.abs(strikeTime('back', 0.3, 0.3) - 0.84) < 1e-9);
  assert.equal(strikeTime('gulp', 1, 1), 1);
  let prev = -1;
  for (const [ph, k] of [['aim', 0.5], ['out', 0], ['out', 0.5], ['out', 1], ['back', 0.5], ['back', 1], ['gulp', 0.5], ['gulp', 1]]) { const t = strikeTime(ph, k, 1); assert.ok(t >= prev, `${ph} ${k}`); prev = t; }
});

test('the muscles that make it: the jaw opener before the tongue thrower, the retractor with the closer, the eyes in the gulp', async () => {
  const { strikeMuscles } = await import('../src/util/frogstrike.js');
  const first = (id) => T.find((t) => strikeMuscles(t)[id] > 0.2);
  assert.ok(first('DM') < first('GG'), `DM ${first('DM')} GG ${first('GG')}`);
  assert.ok(first('GG') < first('HG') && first('HG') <= first('AM') + 0.1, `GG ${first('GG')} HG ${first('HG')} AM ${first('AM')}`);
  assert.ok(first('RB') > 0.84, 'the eyes press down only in the gulp');
  for (const t of T) { const m = strikeMuscles(t); for (const [k, v] of Object.entries(m)) assert.ok(v >= 0 && v <= 1, `${k} ${v}`); }
  // every movement of the timeline has a muscle making it (the movement rule)
  for (const t of T) { const c = strikeCurves(t), d = strikeCurves(Math.min(1, t + 0.01)), m = strikeMuscles(t);
    if (d.gape - c.gape > 0.01) assert.ok(m.DM > 0, `the jaw opens at ${t} with DM off`);
    if (c.gape - d.gape > 0.01) assert.ok(m.AM > 0, `the jaw closes at ${t} with AM off`);
    if (d.p - c.p > 0.02) assert.ok(m.GG > 0, `the tongue goes out at ${t} with GG off`);
    if (c.p - d.p > 0.02) assert.ok(m.HG > 0, `the tongue comes back at ${t} with HG off`); }
});

test('the lunge: out by contact, back by the gulp; at rest the root is the sitting stance', async () => {
  const { lungeCurve, lungeRoot, lungePoint, FROG_LUNGE } = await import('../src/util/frogstrike.js');
  assert.equal(lungeCurve(0), 0); assert.ok(Math.abs(lungeCurve(FROG_LUNGE.contactT) - 1) < 1e-9); assert.ok(lungeCurve(0.84) < 1e-9 && lungeCurve(1) === 0);
  const sit = { pitchDeg: 34, offsetCm: [0, 1.698, 0.237], pivotCm: [0, 0.792, -3.801] }, r = lungeRoot(sit, 0, 30, 1);
  assert.ok(Math.abs(r.pitch + 34 * Math.PI / 180) < 1e-12 && r.off.every((v, i) => Math.abs(v - sit.offsetCm[i]) < 1e-12));
  // the snout goes down as the body tips, and forward by the slide
  const nose = (t, d, s) => lungePoint(sit, t, d, s, [0, 1.3, 3.2]);
  assert.ok(nose(FROG_LUNGE.contactT, 20, 0)[1] < nose(0, 0, 0)[1] - 1, 'the snout comes down by more than 1 cm at a 20 deg dip');
  assert.ok(Math.abs(nose(FROG_LUNGE.contactT, 0, 1)[2] - nose(0, 0, 0)[2] - 1) < 1e-9, 'the slide moves it forward by the slide');
});

test('the body points the sim uses are the shipped rig\'s: the jaw tip at rest and open, the tongue tip at contact', async () => {
  const fs = await import('node:fs');
  const { skeletonRig, poseHeadAtRest, ROW_FLOATS } = await import('../src/render/creatures/skeleton.js');
  const { FROG_LUNGE } = await import('../src/util/frogstrike.js'); const FROG_STRIKE_T = FROG_LUNGE.contactT;
  const man = JSON.parse(fs.readFileSync('public/assets/creatures/manifest.json', 'utf8'))['commonfrog.swim'], rig = skeletonRig(man.skeleton, {}), N = rig.byName;
  const src = fs.readFileSync('src/sim/animals.js', 'utf8'), num = (k) => JSON.parse(src.match(new RegExp(k + ': (\\[[^\\]]*\\])'))[1]);
  const mouth = num('mouthCm'), tip = num('tipCm');
  assert.ok(rig.tail[N.jaw].every((v, i) => Math.abs(v - mouth[i]) < 0.01), `mouthCm ${mouth} vs the jaw's tip ${rig.tail[N.jaw]}`);
  const out = new Float32Array(ROW_FLOATS); poseHeadAtRest(rig, { strikeT: FROG_LUNGE.contactT }, out);
  const b = N.tongue4, m = b * 12, p = rig.tail[b], q = [0, 1, 2].map((r) => out[m + r * 4] * p[0] + out[m + r * 4 + 1] * p[1] + out[m + r * 4 + 2] * p[2] + out[m + r * 4 + 3]);
  assert.ok(q.every((v, i) => Math.abs(v - tip[i]) < 0.02), `tipCm ${tip} vs the tongue's tip at contact ${q.map((v) => v.toFixed(3))}`);
  const at = (bn, st) => { poseHeadAtRest(rig, st, out); const b = N[bn], m = b * 12, p = rig.tail[b]; return [0, 1, 2].map((r) => out[m + r * 4] * p[0] + out[m + r * 4 + 1] * p[1] + out[m + r * 4 + 2] * p[2] + out[m + r * 4 + 3]); };
  const jaw = num('jawOpenCm'), j = at('jaw', { strikeT: FROG_STRIKE_T });
  assert.ok(j.every((v, i) => Math.abs(v - jaw[i]) < 0.02), `jawOpenCm ${jaw} vs ${j}`);
});
