// Where a frightened animal is safe, by what it is: the owner's design (9 Oct 2026). Pure numbers (tests/refuge.test.mjs runs it under Node).
// Every walker's flight goes through one search (Animals.escapeGoal: rings of spots, routed, scored by escapeScore in threat.js); what differs
// between kinds is only this: how good a spot is as a refuge. 0 = no refuge.
//   high      : up, out of reach (a gecko: the top of a log, cork or a root at least HIGH_CM above the ground)
//   low       : low cover or a crevice (an overhang, moss, a burrow), or shallow water (a crab)
//   waterline : the water's edge, water 0.3-3 cm deep, or deeper water (a newt slips in)
//   water     : water deep enough to swim down into (an axolotl)
//   cover     : cover, or the crest of a log the heavier animals cannot follow it onto (a skink)
export const REFUGE = { gecko: 'high', crab: 'low', newt: 'waterline', axolotl: 'water', skink: 'cover' };
export const HIGH_CM = 3;

// s = { cover 0..1, wcover 0..1 (cover under water), height (cm the highest surface it can stand on there rises above the ground),
//       depth (water depth there, cm; <= 0 dry), crest (a piece top it can step onto), shallowMax (cm: a crab's safe depth) }
export function refugeScore(profile, s) {
  switch (profile) {
    case 'high': return s.height >= HIGH_CM ? 4 + Math.min(8, s.height) : 0;
    case 'low': return (s.cover >= 0.5 ? 8 : 0) + (s.depth >= 0.5 && s.depth <= s.shallowMax ? 5 : 0);
    case 'waterline': return s.depth >= 0.3 && s.depth <= 3 ? 8 + 2 * s.wcover : s.depth > 3 ? 5 + 2 * s.wcover : 0;
    case 'water': return s.depth >= 1.6 ? 5 + 3 * s.wcover : 0;
    case 'cover': return (s.cover >= 0.5 ? 8 : 0) + (s.crest ? 4 : 0);
  }
  return 0;
}
