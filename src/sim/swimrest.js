// Resting spells for tadpoles (pure: no three.js, so it runs under Node; tests/tadpole-rest.test.mjs).
// A tadpole alternates swim bouts and rest bouts on the floor. Animals.swim calls restStep once per move for species with
// `young` (only the tadpole) and lets the answer override the wander.
//
// The shares of time spent resting are GUESSES, not from a source: by day about 40 % (the range 30-50 % is what the check
// accepts), by night about 68 % (55-80 %). Real tadpoles graze and sit on the bottom between short swims, and are quieter in
// the dark; the project's species data holds nothing on it. Change DAY_SHARE / NIGHT_SHARE to correct them.
//
// The timer uses the animal's own seeded stream (from `a.phase`), never the global Math.random stream: a state dump stays
// reproducible and the fish that share swim() keep their own random numbers.

export const REST_LABEL = 'Resting on the bottom';
export const DAY_SHARE = 0.4, NIGHT_SHARE = 0.68;
const REST_MEAN = 14;            // s, the mean rest bout (each bout is 0.5-1.5 x the mean); the swim bout is sized for the share
const WAKE_CHECK = 0.3;          // s between two looks for a threat while resting
const FLEE_FOR = 1.5;            // s of fleeing after a wake
const MIN_SWIM_AFTER_WAKE = 4;   // s before it may settle again

export function seededRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function isNight(minute, lightsOn = 480, lightsOff = 1200) {
  const m = ((minute % 1440) + 1440) % 1440;
  return m < lightsOn || m >= lightsOff;
}

const restBout = (rnd) => REST_MEAN * (0.5 + rnd());
const swimBout = (share, rnd) => (REST_MEAN * (1 - share) / share) * (0.5 + rnd());

// a: the animal ({ phase, pos: {x, z}, rest? } is all it reads; its state is kept in a.rest).
// ctx: { night, hungry (food in the tank and it wants it: it swims to feed), danger() -> {x, z} | null (only asked while resting), bh (half body height, cm) }.
// Returns { resting, y (height of the body centre above the floor while resting), flee: {x, z} unit vector away from the threat | null }.
export function restStep(a, dt, ctx) {
  const share = ctx.night ? NIGHT_SHARE : DAY_SHARE;
  let r = a.rest;
  if (!r) {
    const rnd = seededRng((Math.floor((a.phase ?? 0) * 1e6) ^ 0x9E3779B1) >>> 0);
    r = a.rest = { rnd, resting: rnd() < share, left: 0, dT: 0, fleeT: 0, flee: null };
    r.left = (r.resting ? restBout(rnd) : swimBout(share, rnd)) * rnd();      // (start part way through a bout: a group does not settle together)
  }
  const y = Math.min(0.5, Math.max(0.1, ctx.bh ?? 0.25));
  if (r.fleeT > 0) { r.fleeT -= dt; if (r.fleeT <= 0) r.flee = null; }
  r.left -= dt;
  if (ctx.hungry) {                                                              // feeding comes first
    if (r.resting) { r.resting = false; r.left = 3 + 3 * r.rnd(); }
    else if (r.left <= 0) r.left = swimBout(share, r.rnd);
    return { resting: false, y, flee: r.flee };
  }
  if (r.left <= 0) {
    r.resting = !r.resting;
    r.left = r.resting ? restBout(r.rnd) : swimBout(share, r.rnd);
  }
  if (r.resting) {
    r.dT -= dt;
    if (r.dT <= 0) {
      r.dT = WAKE_CHECK;
      const d = ctx.danger();
      if (d) {
        const dx = a.pos.x - d.x, dz = a.pos.z - d.z, l = Math.hypot(dx, dz);
        r.resting = false; r.left = MIN_SWIM_AFTER_WAKE + 3 * r.rnd();
        r.flee = l > 1e-6 ? { x: dx / l, z: dz / l } : { x: Math.sin(a.phase ?? 0), z: Math.cos(a.phase ?? 0) };
        r.fleeT = FLEE_FOR;
      }
    }
  }
  return { resting: r.resting, y, flee: r.flee };
}
