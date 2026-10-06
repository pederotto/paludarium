// Activation modes (docs/MUSCLES.md 'Activation modes'): step, climb, turn with a left/right channel; hop, leap, swim, walk, sit unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { motionOf } from '../src/render/creatures/muscles.js';
import { excitation, ANURAN_MUSCLES } from '../src/content/anuranmuscles.js';

const D = (id) => ANURAN_MUSCLES.find((d) => d.id === id), PL = D('PL'), ILI = D('ILI');
const ex = (def, st, stroke, side) => excitation(def, motionOf(st, stroke, side));

test('swim, leap, hop, walk, sit: a state without move gives the unchanged values', () => {
  for (const d of ANURAN_MUSCLES) for (let t = 0; t < 1; t += 0.05) {
    const sw = excitation(d, { mode: 'swim', t });
    assert.equal(ex(d, { pL: t, pR: t }, true, 'L'), sw);
    assert.equal(ex(d, { pL: 0, pR: t }, true, 'R'), sw);
    assert.equal(ex(d, { legA: [], t }, true, 'L'), excitation(d, { mode: 'leap', t }));
  }
  const push = (d) => d.drive === 'push';
  assert.equal(ex(PL, { calm: 0 }, false, 'L'), 0.2);                       // walk
  assert.equal(ex(PL, { calm: 1 }, false, 'R'), 0.05);                      // sit: tone
  assert.equal(ex(PL, { hop: 0.5 }, false, 'L'), excitation(PL, { mode: 'hop', t: 0 }));
  assert.equal(ex(PL, { pL: 0.05, pR: 0.5 }, true, 'L'), 1);
  assert.ok(push(PL));
});

test('modes: left and right differ with their own phase', () => {
  for (const mode of ['step', 'climb', 'turn']) {
    const st = { move: { mode, pL: 0.1, pR: 0.7 } };
    assert.equal(motionOf(st, false, 'L').mode, mode);
    assert.ok(ex(ILI, st, false, 'L') > ex(ILI, st, false, 'R'), mode + ' swing: the left recovers, the right stands');
    assert.ok(ex(PL, st, false, 'R') > ex(PL, st, false, 'L'), mode + ' stance: the right push holds the load');
    // the same state mirrored swaps the sides
    const m = { move: { mode, pL: 0.7, pR: 0.1 } };
    assert.equal(ex(PL, m, false, 'L'), ex(PL, st, false, 'R'));
  }
});

test('climb stretch is the strongest push; step and turn match', () => {
  const at = (mode, t) => excitation(PL, { mode, t });
  assert.equal(at('climb', 0.5), 1);
  assert.equal(at('step', 0.5), 0.35);
  for (let t = 0; t < 1; t += 0.05) assert.equal(at('turn', t), at('step', t));
});

test('turn: amp scales the phasic part; climb: the driving left leg exceeds the trailing right by more than 0.3', () => {
  const st = { move: { mode: 'turn', pL: 0.5, pR: 0.5, ampL: 1, ampR: 0.3 } };
  const l = ex(PL, st, false, 'L'), r = ex(PL, st, false, 'R'), tone = 0.05;
  assert.ok(Math.abs(r - (tone + 0.3 * (l - tone))) < 1e-12);
  const c = { move: { mode: 'climb', pL: 0.5, pR: 0.5, ampL: 1, ampR: 0.3 } };
  assert.ok(ex(PL, c, false, 'L') - ex(PL, c, false, 'R') > 0.3);
  assert.equal(ex(PL, { move: { mode: 'step', pL: 0.5, pR: 0.5, ampL: 0, ampR: 0 } }, false, 'L'), tone);
});
