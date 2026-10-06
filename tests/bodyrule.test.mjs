// The body-first movement rule (owner, 6 Oct 2026; CLAUDE.md "Movement rule"): a frog moves itself only while a body movement is playing
// (skeleton keys + the muscles that drive them), and root motion comes out of that movement, never the other way round.
import test from 'node:test';
import assert from 'node:assert/strict';
import { swimState, swimStep, strokeAngles, KICK } from '../src/util/gait.js';
import { swimProfile } from '../src/util/bodyplan.js';
import { swimMotion, queuePush, DRIFT_MAX } from '../src/util/swimturn.js';

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
// (owner, 6 Oct 2026: the trunk muscles stay UNMAPPED until the skinning pilot has been judged on its own, no partial fix that breaks the belly rule.
// What it takes: the trunk pair (epaxial longissimus and the flank wall: frames on spine/spineB/head, landmarks, excitation from stroke.trunk, tests); two
// bellies in the row's last free texel, slot 20 as it is and slot 21 packed in its .z/.w (the shader reads only .x swell and .y slide of a belly texel:
// skin.js belly() picks the pair by slot, a few lines); the frog models re-bound with tools/rig/muscles.mjs --write.)
test('every moving frog has its muscles active', { todo: 'the hind-limb bellies are tied to the stroke (tests/anuran-muscles.test.mjs); the trunk and the forelimbs have no belly yet (see the note above): write the test with them' }, () => {
  assert.fail('not written');
});
