// Who frightens a walking animal, and how, as pure numbers (tests/threat.test.mjs runs it under Node).
//
// The owner's design (6 Oct 2026): the explicit pairs already in animals.js (the skink's, the crab's, the amphibians' lists, and the
// keeper's camera) keep their priority and are never switched off by anything here. This adds triggers for pairs that are on no list:
// a neighbour of another kind that is much bigger than the animal AND moving (or right beside it) frightens it, a crab's claws count as
// extra size, and an animal of its own kind never does. Animals.threatPlus applies it when no listed pair already has.

export const THREAT = {
  size: 1.3,        // the other must be this many times its size (length) to frighten it
  claws: 1.5,       // a crab's claws count for this much extra size against anything soft
  move: 0.6,        // cm/s: faster than this is "moving"
  near: 3.5,        // cm: a still neighbour this close frightens as well (it is on top of it)
  dy: 6,            // cm: a neighbour on another level (a gecko on the glass, a body in the water) is not a threat
  every: 0.2,       // s: how often the choice of the threatening neighbour is looked at again (staggered by animal)
};

// The kinds that can frighten a walker (fish, insects and eggs cannot).
export const MOVERS = new Set(['frog', 'toad', 'newt', 'axolotl', 'gecko', 'skink', 'crab']);

// How frightening `o` (the other: { id, kind, size, speed, y }) is to `p` (the animal: { id, size, y }) at distance `d` cm, within its
// awareness `radius`: 0 (not at all) up to 2. d is the planar distance.
export function threatScore(p, o, d, radius, T = THREAT) {
  if (p.id === o.id) return 0;                                  // its own kind: spacing and courtship, not panic
  if (!MOVERS.has(o.kind) || !(d < radius)) return 0;
  if (Math.abs(p.y - o.y) > T.dy) return 0;
  if (!(o.speed > T.move || d < T.near)) return 0;              // a still neighbour at a distance is furniture
  const k = sizeFactor(p, o, T);
  if (k === 0) return 0;
  return (1 - d / radius) * k;
}

// How much bigger than the animal the other counts (claws included) in units of the trigger size: 0 below it, 1 at it, at most 2. A threat of factor k
// is reported to the animal's mind at 1/k of its real distance, so a much bigger neighbour frightens it from further off than a slightly bigger one does
// (the minds' own fear curves are all a function of distance).
export function sizeFactor(p, o, T = THREAT) {
  const ratio = (o.size / p.size) * (o.kind === 'crab' ? T.claws : 1);
  return ratio < T.size ? 0 : Math.min(2, ratio / T.size);
}

// The escape spot among candidates [{ x, z, dThreat, niche, len }]: far from the threat, in the animal's own refuge niche, and not a long
// way round to get to. Higher is better; weights are the owner's design (distance 1, niche 1, path cost 0.6).
export const ESCAPE = { dist: 1, niche: 1, cost: 0.6 };
export function escapeScore(c, W = ESCAPE) { return W.dist * c.dThreat + W.niche * c.niche - W.cost * c.len; }
