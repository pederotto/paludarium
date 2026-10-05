// What visitors make of a tank: plain numbers, so it is unit tested under Node (game/curator.js re-exports it).

export const GRADE_ORDER = ['D', 'C', 'B', 'A', 'S'];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const clamp01 = (v) => clamp(v, 0, 1);

// What visitors make of a tank (the "school group visits" event): the base reward scaled by how much there is to see and
// how well it is kept. A big tank impresses by size and variety; a small one only if it is perfect, and then it charms
// them more than its size suggests. `grade` is the Curator's letter (or null), `litres` the tank's volume, `species` and
// `target` the species kept and the number that suit the tank (metrics speciesTarget). Returns { funds, rep, text }.
export function visitorAppeal(base, { litres = 243, grade = null, species = 0, target = 8 } = {}) {
  const g = grade ? Math.max(0, GRADE_ORDER.indexOf(grade)) : 2;  // D 0 … S 4 (not judged yet: as a B)
  const size = clamp(Math.sqrt(litres / 243), 0.5, 2.2);         // 1 for the standard tank
  const variety = 0.6 + 0.4 * clamp01(species / Math.max(1, target));
  const care = 0.75 + 0.125 * g;                                  // D 0.75, B 1 (the standard tank's old reward), S 1.25
  const perfectSmall = litres <= 120 && g >= 3;
  const k = (perfectSmall ? Math.max(1.3, size * 2) : size) * variety * care;
  const text = perfectSmall ? 'They crowded round the little tank: a whole world in a box, and not a thing wrong with it.'
    : litres >= 400 && g >= 2 ? 'The size of it stopped them in their tracks: a river, a forest floor and animals everywhere they looked.'
      : g >= 3 ? 'They pointed out the animals one by one.' : 'They looked, and moved on a little quickly.';
  return { funds: Math.max(5, Math.round(base.funds * k)), rep: Math.max(5, Math.round(base.rep * k)), text };
}
