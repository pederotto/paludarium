// Personal space (owner, 10 Oct 2026): every animal bears others near it for a while, by its kind's social life, and then wants room.
// Pure: no imports, no game state. Animals.spaceTick gathers the neighbours; the need lives on the animal (a.spaceNeed).
//
// A bubble of r body lengths round it (rOther for animals of another species), weighted by how far inside the bubble each neighbour is
// and by its size. The need fills while the bubble is shared (in `patience` s with one neighbour halfway in) and drains while it is alone
// (in `relief` s). Resting bodies (a pile in a hide by day, a school holding still) bear it REST times longer; the individual's own
// temper (a.spaceK, 0.7 … 1.3) scales the patience. At 1 it wants room: the engine offers its mind a goal away from the crowd
// (animal.offerGoal, sim/goals.js) and the mind takes it only when what it is doing allows (foraging, wandering: not eating, fleeing,
// hiding or asleep). Schooling fish are not exempt: a schooler's need loosens its hold on the school, it drifts out for a while, and the
// school takes it back once the need has drained.
export const SPACE = {
  school:      { r: 0.6, rOther: 0.8, patience: 240, relief: 60 },
  group:       { r: 1.0, rOther: 0.8, patience: 90,  relief: 60 },
  solitary:    { r: 1.5, rOther: 1.0, patience: 45,  relief: 45 },
  territorial: { r: 2.5, rOther: 1.0, patience: 20,  relief: 60 },
};
export const R_MIN = 1.5, R_MAX = 10;   // cm: bubble limits (a springtail-sized body still has some room; a big skink does not claim the tank)
export const REST = 3;                  // a still body bears its neighbours this many times longer
export const NEED_MAX = 1.5;            // (the need is kept a little above 1, so one accepted move does not empty it at once)
export const AFTER_MOVE = 0.45;         // the need left after a move it took: it still wants time alone before it is content
export const EVERY = 0.5;               // s between looks round (staggered by animal)

export function spaceClass(sp) {
  if (sp.school) return 'school';
  if (sp.territorial) return 'territorial';
  return (sp.flock?.[0] ?? 1) >= 3 ? 'group' : 'solitary';
}
export const spaceProfile = (sp) => SPACE[spaceClass(sp)];

// Bubble radius (cm) for a body `len` cm long, toward one of its own kind (same) or of another.
export function bubble(P, len, same) {
  const r = (same ? P.r : P.rOther) * len;
  return r < R_MIN ? R_MIN : r > R_MAX ? R_MAX : r;
}

// How much one neighbour at distance d presses on a bubble of radius R: 0 at the edge, 1 touching; a smaller body counts by its size share.
export function press(d, R, sizeShare = 1) {
  if (d >= R) return 0;
  const k = 1 - d / R;
  return k * (sizeShare < 1 ? sizeShare : 1);
}

// The need after dt s with pressure p (summed press), for a body that is still (resting) or not, of temper k.
export function needStep(need, p, dt, P, resting = false, k = 1) {
  if (p > 0.05) need += (dt * p * 2) / (P.patience * k * (resting ? REST : 1));
  else need -= dt / P.relief;
  return need < 0 ? 0 : need > NEED_MAX ? NEED_MAX : need;
}
