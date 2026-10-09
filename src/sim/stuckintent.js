// What a swimmer means to do right now, read for the stuck watchdog (Animals.wantsMove / keepFree, animals.js). Pure: no imports, no game state.
// A fish that holds station in the lee of a rock, rests in slack water, nibbles a flake or creeps the last 2 cm to its spot is not stuck;
// one that swims toward a spot more than 2.5 cm away, flees, darts or is driven by the Lab to a goal, and does not get there, is.
//   stuckIntent(a, sp, ctx) -> 'rest' | 'hold' | 'creep' | 'go' | 'none'
//     rest  : a tadpole or larva resting on the floor (a.rest.resting) or a fish the mind calls tired in slack water (fm.resting)
//     hold  : within 1 cm of its chosen spot (fm.I.hold), nibbling (a.nib), or a Lab-driven animal with no goal
//     creep : its spot 1-2.5 cm away (the mind slows over the last 2 cm)
//     go    : a Lab goal, flee / escape / dart, a spot more than 2.5 cm away, or any asleep intent held longer than ctx.cap seconds
//     none  : no mind to read (a.fm missing): the watchdog treats it as awake, as before
//   ctx = { holdS, cap }: seconds the animal has been in an asleep intent in a row (keepFree counts it) and the longest allowed.
// insideSolid is NOT read here: keepFree checks penetration first and it is never exempt.
export const HOLD_CAP = 150;           // s (RECOVER_S 120 + 30; the owner approved 150 on 8 Oct 2026)
export const CREEP_CM = 2.5;           // beyond this the mind's spot is a real goal
export const asleep = (k) => k === 'rest' || k === 'hold' || k === 'creep';

export function stuckIntent(a, sp, ctx = {}) {
  if (a.rest?.resting) return capped('rest', ctx);
  const L = a.lab;
  if (L?.drive) return L.goal ? 'go' : capped('hold', ctx);          // (the mind is muted under a Lab drive: fm.I is stale)
  const m = a.fm;
  if (!m) return 'none';
  if (a.dart || m.fleeT > 0 || m.I?.escape) return 'go';
  if (a.nib) return capped('hold', ctx);
  if (m.resting) return capped('rest', ctx);
  const g = m.goal, d = g ? Math.hypot(g.x - a.pos.x, g.z - a.pos.z) : 0;
  if (d > CREEP_CM) return 'go';
  if (d >= 1) return capped('creep', ctx);
  return capped('hold', ctx);
}

function capped(k, ctx) { return (ctx.holdS ?? 0) > (ctx.cap ?? HOLD_CAP) ? 'go' : k; }
