// N11c: a pile is bodies that overlap (interpenetrate), not animals that touch or gather (the lead's rule; springtails, isopods
// and cory aggregate in life). The old rule linked centres within a header body length (springtail 5.6 cm = SPECIES.size x 4).
import test from 'node:test';
import assert from 'node:assert/strict';
import { pile, PILE_OVERLAP } from '../tools/steps/state-counters.mjs';

const group = (gap, sp = 'springtail') => {
  const rows = [];
  for (let t = 0; t <= 400; t += 10) for (let k = 0; k < 3; k++) rows.push({ t, id: `${sp}-${k}`, sp, x: k * gap, y: 0, z: 0, awake: 1 });
  return rows;
};
const sizes = { springtail: 5.6, cory: 16 };

test('three springtails 1 cm apart (a natural gathering): a pile by the old rule, none by the overlap rule', () => {
  assert.equal(pile(group(1), { sizes }).count, 1);
  assert.equal(pile(group(1), { sizes, overlap: PILE_OVERLAP }).count, 0);
});
test('three springtails 0.05 cm apart (bodies inside each other) for 400 s: a pile by the overlap rule', () => {
  assert.equal(pile(group(0.05), { sizes, overlap: PILE_OVERLAP }).count, 1);
});
test('cory resting side by side (3 cm) is no pile; cory 1 cm apart, inside each other, is', () => {
  assert.equal(pile(group(3, 'cory'), { sizes, overlap: PILE_OVERLAP }).count, 0);
  assert.equal(pile(group(1, 'cory'), { sizes, overlap: PILE_OVERLAP }).count, 1);
});
