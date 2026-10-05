// Resting spells for tadpoles (pure: no three.js, so it runs under Node; tests/tadpole-rest.test.mjs).
// A tadpole alternates swim bouts and rest bouts on the floor. Animals.swim calls restStep once per move for species with
// `young` (only the tadpole) and lets the answer override the wander.
//
// The shares of time spent resting are GUESSES, not from a source: by day about 40 % (the range 30-50 % is what the check
// accepts), by night about 68 % (55-80 %). Real tadpoles graze and sit on the bottom between short swims, and are quieter in
// the dark; the project's species data holds nothing on it. Change DAY_SHARE / NIGHT_SHARE to correct them.
// B2x: these are the shares of an UNDISTURBED tadpole (45 % / 78 %). In the game, feeding (about 15-20 % of the time) and wakes
// by passing fish (about one per 20 s of rest in the 12-fish test mix) take a share off: the karst dump read 32 % / 44 % at 40 / 68.
//
// The timer uses the animal's own seeded stream (from `a.phase`), never the global Math.random stream: a state dump stays
// reproducible and the fish that share swim() keep their own random numbers.

export const REST_LABEL = 'Resting on the bottom';
export const DAY_SHARE = 0.45, NIGHT_SHARE = 0.78;
const REST_MEAN = 14;            // s, the mean rest bout (each bout is 0.5-1.5 x the mean); the swim bout is sized for the share
const WAKE_CHECK = 0.3;          // s between two looks for a threat while resting
const FLEE_FOR = 1.5;            // s of fleeing after a wake
const MIN_SWIM_AFTER_WAKE = 4;   // s before it may settle again
// The tadpole profile is the default (ctx.profile unset). Fields: day/night share of time resting (undisturbed), mean rest
// bout (s), ambush (a hungry resting animal stays down unless ctx.foodNear), wakeR (cm: only a threat this close wakes it),
// settle (s of swimming after a wake before it may settle again).
export const TADPOLE_REST = { day: DAY_SHARE, night: NIGHT_SHARE, restMean: REST_MEAN, ambush: false, wakeR: Infinity, settle: MIN_SWIM_AFTER_WAKE };
// N19: salamander larvae are bottom-dwelling sit-and-wait hunters (general knowledge, "check": target >= 60 % on the floor by
// day and night). The shares, bout length, wake radius and settle time are GUESSES sized so the game keeps >= 60 % after
// feeding swims and wakes; no project source gives them.
export const LARVA_REST = { day: 0.82, night: 0.86, restMean: 40, ambush: true, wakeR: 4, settle: 1.5 };

export function seededRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function isNight(minute, lightsOn = 480, lightsOff = 1200) {
  const m = ((minute % 1440) + 1440) % 1440;
  return m < lightsOn || m >= lightsOff;
}

const restBout = (rnd, m = REST_MEAN) => m * (0.5 + rnd());
const swimBout = (share, rnd, m = REST_MEAN) => (m * (1 - share) / share) * (0.5 + rnd());

// a: the animal ({ phase, pos: {x, z}, rest? } is all it reads; its state is kept in a.rest).
// ctx: { profile? (TADPOLE_REST when unset), foodNear? (food within strike reach: wakes an ambushing animal), night, hungry (food in the tank and it wants it: it swims to feed), danger() -> {x, z} | null (only asked while resting), bh (half body height, cm) }.
// Returns { resting, y (height of the body centre above the floor while resting), flee: {x, z} unit vector away from the threat | null }.
export function restStep(a, dt, ctx) {
  const P = ctx.profile ?? TADPOLE_REST, m = P.restMean;
  const share = ctx.night ? P.night : P.day;
  let r = a.rest;
  if (!r) {
    const rnd = seededRng((Math.floor((a.phase ?? 0) * 1e6) ^ 0x9E3779B1) >>> 0);
    r = a.rest = { rnd, resting: rnd() < share, left: 0, dT: 0, fleeT: 0, flee: null };
    r.left = (r.resting ? restBout(rnd, m) : swimBout(share, rnd, m)) * rnd();      // (start part way through a bout: a group does not settle together)
  }
  const y = Math.min(0.5, Math.max(0.1, ctx.bh ?? 0.25));
  if (r.fleeT > 0) { r.fleeT -= dt; if (r.fleeT <= 0) r.flee = null; }
  r.left -= dt;
  if (ctx.hungry && (!P.ambush || ctx.foodNear)) {                               // feeding comes first (an ambusher only for food in reach)
    if (r.resting) { r.resting = false; r.left = 3 + 3 * r.rnd(); }
    else if (r.left <= 0) r.left = swimBout(share, r.rnd, m);
    return { resting: false, y, flee: r.flee };
  }
  if (r.left <= 0) {
    r.resting = !r.resting;
    r.left = r.resting ? restBout(r.rnd, m) : swimBout(share, r.rnd, m);
  }
  if (r.resting) {
    r.dT -= dt;
    if (r.dT <= 0) {
      r.dT = WAKE_CHECK;
      const d = ctx.danger();
      const dx = d ? a.pos.x - d.x : 0, dz = d ? a.pos.z - d.z : 0, l = Math.hypot(dx, dz);
      if (d && l <= P.wakeR) {
        r.resting = false; r.left = P.settle + r.rnd();
        r.flee = l > 1e-6 ? { x: dx / l, z: dz / l } : { x: Math.sin(a.phase ?? 0), z: Math.cos(a.phase ?? 0) };
        r.fleeT = FLEE_FOR;
      }
    }
  }
  return { resting: r.resting, y, flee: r.flee };
}
