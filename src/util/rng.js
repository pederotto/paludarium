// The simulation's random numbers: one seeded stream (mulberry32), so the same tank started from the same seed replays exactly
// (the same animal paths, the same events), and a change can be measured on identical runs instead of noisy ones.
// Everything the simulation decides draws from `rand()`; rendering, audio and the UI keep Math.random (they never feed back into
// the simulation, and must not draw from this stream, or a camera move would change what the animals do).
// A world seeds it when it is made (World: a fresh seed from Math.random in normal play, a fixed one in tests and probes: seedRng).
let s = (Math.random() * 4294967296) >>> 0;
let seed0 = s;

export function rand() {
  s = (s + 0x6D2B79F5) | 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// Restart the stream from `seed` (an integer; any number is folded to 32 bits). replay: also run the simulation's throttles on its own
// clock (simClock), for runs that must come out the same every time (tests, probes).
export function seedRng(seed, replay = false) { s = seed0 = (seed >>> 0) || 1; simClock.fixed = !!replay; simClock.ms = 0; }
// The seed the stream was last started from, and where it is now (a state dump can carry both).
export const rngSeed = () => seed0;
export const rngState = () => s >>> 0;
export function setRngState(v) { s = v | 0; }

// The simulation's clock for its own throttles (how often a map is rebuilt, the fast-forward factor). In normal play it is the wall
// clock; in a replay (seedRng(seed, true)) it is the simulation's own time (Animals.move sets simClock.ms), so the throttles fire at
// the same simulated moments in every run instead of depending on how fast this computer happens to be.
export const simClock = { fixed: false, ms: 0 };
export const simNow = () => (simClock.fixed ? simClock.ms : globalThis.performance?.now() ?? Date.now());
