// What an animal means to do right now, read for the stuck watchdog (Animals.wantsMove / keepFree, animals.js). Pure: no imports, no game state.
// The watchdog's displacement timer runs only while the animal means to travel ('go'). A fish that holds station in the lee of a rock,
// rests in slack water, nibbles a flake or creeps the last 2 cm to its spot is not stuck; nor is a shrimp grazing on its way, a snail
// resting, an isopod with nowhere to go. One that heads for a spot and does not get there is.
//   stuckIntent(a, sp, ctx) -> 'rest' | 'hold' | 'creep' | 'go' | 'idle' | 'none'
//     rest  : a tadpole or larva resting on the floor (a.rest.resting) or a fish the mind calls tired in slack water (fm.resting)
//     hold  : a fish within 1 cm of its chosen spot (fm.I.hold) or nibbling (a.nib); a crawler grazing at its spot (a.grazing); a Lab-driven animal with no goal
//     creep : a fish's spot 1-2.5 cm away (the mind slows over the last 2 cm); a crawler within CRAWL_CREEP_CM of its spot
//     go    : a Lab goal, flee / escape / dart, a spot further than that, or any asleep intent held longer than ctx.cap seconds
//     (crawlers, grazers and skinks: their destination is a.dest when the mover publishes it, else a.target)
//     idle  : a crawler with no spot to walk to (resting, grazing where it stands, eating): nothing to be stuck on the way to
//     none  : a swimmer with no mind to read (a.fm missing): the watchdog treats it as awake, as before
//   ctx = { holdS, cap }: seconds the animal has been in an asleep intent in a row (keepFree counts it) and the longest allowed.
// insideSolid is NOT read here: keepFree checks penetration first and it is never exempt.
export const HOLD_CAP = 150;           // s (RECOVER_S 120 + 30; the owner approved 150 on 8 Oct 2026)
export const CREEP_CM = 2.5;           // a fish: beyond this the mind's spot is a real goal
export const CRAWL_CREEP_CM = 0.5;     // a crawler: within this of its spot it is there (the walkers' old "there: not stuck")
export const STILL_CM = 0.25;          // the watchdog wakes when 'go' moves the body less than this ...
export const STILL_S = 3.5;            // ... in this many seconds
export const asleep = (k) => k === 'rest' || k === 'hold' || k === 'creep';

export function stuckIntent(a, sp, ctx = NO_CAP) {
  if (a.rest?.resting) return capped('rest', ctx);
  const L = a.lab;
  if (L?.drive) return L.goal ? 'go' : capped('hold', ctx);          // (the mind is muted under a Lab drive: its intent is stale)
  const m = a.fm;
  if (m) {
    if (a.dart || m.fleeT > 0 || m.I?.escape) return 'go';
    if (a.nib) return capped('hold', ctx);
    if (m.resting) return capped('rest', ctx);
    const g = m.goal, d = g ? Math.hypot(g.x - a.pos.x, g.z - a.pos.z) : 0;
    if (d > CREEP_CM) return 'go';
    if (d >= 1) return capped('creep', ctx);
    return capped('hold', ctx);
  }
  if (sp.kind === 'swim') return 'none';
  // A crawler or grazer (shrimp, snails, isopods, springtails, crabs): the spot it walks to.
  // (a grazing shuffle toward a spot is travel: 0.35 cm/s goes 1.2 cm in STILL_S; grazing where it stands is not)
  const t = a.dest !== undefined ? a.dest : a.target;               // (a mover that publishes its destination, a.dest: the skink)
  if (a.state !== 'walk' || !t) return 'idle';
  if (Math.hypot(t.x - a.pos.x, t.z - a.pos.z) > CRAWL_CREEP_CM) return 'go';
  return capped(a.grazing ? 'hold' : 'creep', ctx);
}

const NO_CAP = { holdS: 0, cap: Infinity };
function capped(k, ctx) { return (ctx.holdS ?? 0) > (ctx.cap ?? HOLD_CAP) ? 'go' : k; }
