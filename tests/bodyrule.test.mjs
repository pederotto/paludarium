// The body-first movement rule (owner, 6 Oct 2026; CLAUDE.md "Movement rule"): a frog moves itself only while a body movement is playing
// (skeleton keys + the muscles that drive them), and root motion comes out of that movement, never the other way round.
import test from 'node:test';
import assert from 'node:assert/strict';
import { swimState, swimStep, strokeAngles, KICK } from '../src/util/gait.js';
import { swimProfile } from '../src/util/bodyplan.js';
import { swimMotion, queuePush, DRIFT_MAX } from '../src/util/swimturn.js';
import { climbState, climbStep } from '../src/util/climb.js';

const prof = swimProfile('toad'), dt = 0.05;
let seed = 11; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

test('no stroke playing: no yaw, no side step, speed only decays, a passive drift is bounded', () => {
  const st = swimState(rnd); let idle = 0, v0 = 0, act0 = 1;
  for (let i = 0; i < 6000; i++) {
    if (i % 200 === 0) { st.steer = rnd() * 2 - 1; st.hold = rnd() < 0.3 ? 1 : 0; }
    if (i % 90 === 0) queuePush(st, rnd() * 3 - 1.5, rnd() * 3 - 1.5);
    const floating = (i % 700) > 400;
    swimStep(st, prof, { urgency: rnd(), steer: st.steer, floating, rnd }, dt);
    const m = swimMotion(st, prof, {}, dt), speed = Math.hypot(m.px, m.pz) / dt;
    if (!st.act) {
      idle++;
      assert.equal(m.dyaw, 0, 'turned with no stroke');
      assert.equal(m.side, 0, 'slid sideways with no stroke');
      if (speed > 0) {                                                // a push moves a body with no stroke only as a bounded passive drift of a floater or sitter
        assert.ok((st.fl ?? 0) > 0.5 || (st.sit ?? 0) > 0.5, 'a swimmer was pushed along with no kick');
        assert.ok(speed <= DRIFT_MAX + 1e-9, `drift ${speed} cm/s`);
      }
      // (the first tick of a diamond hold is the last tick of the stroke: its phase still advanced; a start from rest is the todo below)
      if (act0 === 0 && v0 > 1e-6) assert.ok(st.v <= v0 + 1e-9, `speed grew with no stroke: ${v0} -> ${st.v}`);
    }
    v0 = st.v; act0 = st.act;
  }
  assert.ok(idle > 500, `too few idle ticks to mean anything: ${idle}`);
});

test('the legs move while they drive: the stroke pose changes through the kick window', () => {
  const a = new Float32Array(9), b = new Float32Array(9);
  strokeAngles(0.10, a); strokeAngles(0.16, b);
  let d = 0; for (let k = 0; k < 8; k++) d = Math.max(d, Math.abs(a[k] - b[k]));
  assert.ok(d > 5, `the legs hardly move during the kick: ${d} deg`);
});

// KNOWN VIOLATIONS (kept as todo so they show in the report and cannot be forgotten):
test('a resting frog does not start moving before its first kick', () => {
  // a floater woken at any phase of its idle paddle (the diamond hold, the glide, mid-kick) is at 0 until a leg drives
  const st = swimState(() => 0.5);
  for (let k = 0; k < 100; k++) {
    st.fl = 1; st.v = 0; st.phase = k / 100; st.hold = 0; st.rest = 0; st.alt = 0;
    swimStep(st, prof, { urgency: 0.5, floating: false, wake: true, rnd: () => 0.5 }, dt);
    const p = st.phase - Math.floor(st.phase);
    if (!(p < KICK.thrust && st.act)) assert.equal(st.v, 0, `phase ${(k / 100).toFixed(2)}: ${st.v} cm/s with no leg driving`);
  }
  // and from rest it does get going: a few strokes later it moves
  const s2 = swimState(() => 0.5); s2.fl = 1; s2.v = 0; let top = 0;
  for (let i = 0; i < 100; i++) { swimStep(s2, prof, { urgency: 0.5, wake: true, rnd: () => 0.5 }, dt); top = Math.max(top, s2.v); }
  assert.ok(top > 1, `never got going: ${top}`);
});
test('spin on the spot turns only with a stroke playing', () => {
  const st = swimState(rnd); st.act = 0;
  assert.equal(swimMotion(st, prof, { intent: 'spin', dir: 1 }, dt).dyaw, 0);                      // no spin movement at all: no yaw
  for (const style of ['pivot', 'opposed']) {
    const s = swimState(rnd); let out = 0, any = 0;
    for (let k = 0; k < 200; k++) {
      swimStep(s, prof, { spin: 1, spinStyle: style, rnd }, dt);
      const d = swimMotion(s, prof, { intent: 'spin', dir: 1 }, dt).dyaw;
      if (d) { any++; if (!s.act) out++; }
    }
    assert.ok(any > 0 && out === 0, `${style}: ${any} turning ticks, ${out} outside a thrust`);
  }
});
// The climb (util/climb.js; sim/animals.js perchFrog, belly to the pane or a piece's side): advance and yaw come only out of a pulse of the limbs, the frog is
// drawn on its swimming body posed by the same phases, the muscles read them (tests/climb.test.mjs has the rest). Known violations: a stem, the background
// and the bare ground still step toward their goal and write yaw and pitch (the old climb), see the todo below.
test('a climbing frog moves and turns only while a pulse of its limbs plays', () => {
  const st = climbState(rnd); let moved = 0;
  for (let i = 0; i < 4000; i++) {
    const wasIn = st.t >= 0, p0 = st.pulses, m = climbStep(st, { go: i % 700 < 500 ? 1 : 0, steer: Math.sin(i / 90), urgency: rnd(), rnd }, dt);
    if (m.adv || m.dyaw) { moved++; assert.ok(wasIn || st.pulses > p0, 'moved with no pulse playing'); }
  }
  assert.ok(moved > 100);
});
test('a frog climbing a stem, the background or bare ground moves and turns by the sim, not by its limbs', { todo: 'perchFrog still steps toward the goal and writes yaw and pitch there (no belly-to-surface contact to pose it on): needs the stem and background climbs on the pulse gait' }, () => {
  assert.fail('not written');
});
// (owner, 6 Oct 2026, the trunk muscles go in once the skinning pilot was judged: the longissimus dorsi pair, one belly a side from the sacrum to the skull,
// in the row's last belly texel (slot 20 in .xy, slot 21 in .zw; skin.js belly()), bound into the two toad bodies only so far; its activation comes from the
// stroke's trunk channels (anuranmuscles.js trunkExcitation), tests/trunk-muscles.test.mjs. The flank wall (external oblique) and the forelimbs have no belly.)
test('every moving frog has its muscles active', { todo: 'the hind-limb and the trunk (longissimus) bellies are tied to the stroke (tests/anuran-muscles.test.mjs, tests/trunk-muscles.test.mjs); the forelimbs and the flank wall have no belly yet: write the test with them' }, () => {
  assert.fail('not written');
});

test('a one-body frog turns on land with its legs', { todo: 'the common frog (sp.oneBody) turns on the spot to face prey or a hop\'s heading with its body held in the sit stance: its yaw is written while the legs stay in the crouch (needs a sitting turn stroke: the hind feet stepping round, util/gait.js)' }, () => {
  assert.fail('not written');
});

// The common frog's strike lunge (util/frogstrike.js lungePose, 7 Oct 2026): its root motion (the body tipped down about the vent and slid forward) comes with
// the hind legs opening over feet that stay planted (poseStroke's planted-leg solver, as in a hop's launch), and with no strike playing the body is the stance.
test('the strike lunge: the body moves over planted hind feet, and only while the strike plays', async () => {
  const fs = await import('node:fs');
  const { skeletonRig, poseStroke, ROW_FLOATS } = await import('../src/render/creatures/skeleton.js');
  const { lungePose, FROG_LUNGE } = await import('../src/util/frogstrike.js');
  const { HIND, FORE } = await import('../src/util/gait.js');
  const man = JSON.parse(fs.readFileSync('public/assets/creatures/manifest.json', 'utf8'))['commonfrog.swim'];
  const sit = { pitchDeg: 22, offsetCm: [0, 1.123, 0.237], pivotCm: [0, 1.076, -3.901], legKey: 'crouch', armDeg: [0, 0], armA: [83, -177, -170, -36, -77, -17, 74, -167, -171, -43, -68, -24], roll: [-46, -7, -14, 0, 0, 0], legA: [154, -22, 156, 127, -19, 10, -40, -19, -30] };   // (SPECIES.commonfrog.sit: checked against it below)
  const src = fs.readFileSync('src/sim/animals.js', 'utf8');
  assert.ok(src.includes("sit: { pitchDeg: 22, offsetCm: [0, 1.123, 0.237], pivotCm: [0, 1.076, -3.901], legKey: 'crouch', armDeg: [0, 0], armA: [83, -177, -170, -36, -77, -17, 74, -167, -171, -43, -68, -24], roll: [-46, -7, -14, 0, 0, 0], legA: [154, -22, 156, 127, -19, 10, -40, -19, -30]"), 'this test\'s stance is the species\'');
  const rig = skeletonRig(man.skeleton, {}), out = new Float32Array(ROW_FLOATS), N = rig.byName;
  const toes = (dip, slide, t) => { const st = lungePose(sit, t, dip, slide, HIND, FORE, {}); poseStroke(rig, st, out); const R = st.root, c = Math.cos(R.pitch), s = Math.sin(R.pitch);
    return { R, P: ['toesL', 'toesR'].map((k) => { const b = N[k], m = b * 12, p = rig.tail[b], x = out[m] * p[0] + out[m + 1] * p[1] + out[m + 2] * p[2] + out[m + 3], y = out[m + 4] * p[0] + out[m + 5] * p[1] + out[m + 6] * p[2] + out[m + 7], z = out[m + 8] * p[0] + out[m + 9] * p[1] + out[m + 10] * p[2] + out[m + 11];
      return [x + R.off[0], c * y - s * z + R.off[1], s * y + c * z + R.off[2]]; }) }; };
  const rest = toes(0, 0, 0);
  for (const [dip, slide] of [[0, 0.5], [10, 1.0], [20, 1.4], [FROG_LUNGE.maxDipDeg, FROG_LUNGE.maxSlideCm]]) {
    let moved = 0;
    for (let t = 0; t <= 1.0001; t += 0.02) {
      const { R, P } = toes(dip, slide, t);
      const slip = Math.max(...P.map((p, k) => Math.hypot(p[0] - rest.P[k][0], p[2] - rest.P[k][2])));
      assert.ok(slip < 0.3, `dip ${dip} slide ${slide} t ${t.toFixed(2)}: the toes slid ${slip.toFixed(2)} cm`);
      moved = Math.max(moved, Math.abs(R.off[2] - rest.R.off[2]) + Math.abs(R.pitch - rest.R.pitch));
    }
    if (dip || slide) assert.ok(moved > 0.1, 'the lunge moved the body');
  }
  // no strike playing (strikeT 0, or past the gulp): the stance itself, whatever the lunge was fitted to
  for (const t of [0, 0.9, 1]) { const a = toes(30, 1.2, t).R; assert.ok(Math.abs(a.pitch - rest.R.pitch) < 1e-6 && Math.abs(a.off[2] - rest.R.off[2]) < 1e-6 && Math.abs(a.off[1] - rest.R.off[1]) < 1e-6, `t ${t}`); }
});
