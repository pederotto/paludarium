// Flowering: the bloom cycle of one plant, rest → bud → open → fade (the petals brown, droop and drop) → rest again, and the
// daily opening and closing of the open flower. Pure numbers: no scene. Plants (sim/plants.js) steps it from the plant's own
// light, air, health and size and the tank's season, and draws what bloomLook() says (render/flowers.js).
//
// A species' `flower.cycle` (docs: FLOWER CONTRACT) gives the stage lengths in game days and what the plant needs to flower:
//   minLight     on the scale of a species' `light` need (0 … 1): the plant flowers only where a plant needing that much light
//                would grow well (the same test Plants.step makes for growth: daily light at its spot / (need × 0.55) ≥ 1)
//   minHumidity  % relative humidity of the air at the plant (land and wall plants; water plants ignore it)
//   season       'any' | 'wet' | 'dry': the tank's season (Env.season) a new bud waits for
import { clamp, smooth } from '../util/math.js';

export const STAGES = ['rest', 'bud', 'open', 'fade'];
const DEF = { budDays: 4, openDays: 3, fadeDays: 2, restDays: 10, season: 'any', minLight: 0, minHumidity: 0 };
export const MATURE = 0.85;        // p.grown a plant needs before it sets buds
export const START_HEALTH = 0.6;   // health a plant needs to set a bud
export const BLAST_HEALTH = 0.35;  // below this a bud withers and drops unopened (bud blast)

export const cycleOf = (flower) => ({ ...DEF, ...(flower?.cycle ?? {}) });

// Why the plant cannot set a bud now (a short reason), or null. c = { light, humidity (null: not read), season, health, grown }.
export function bloomBlock(cycle, c) {
  if (c.grown < MATURE) return 'too young to flower';
  if (c.health < START_HEALTH) return 'too weak to flower';
  if (cycle.season !== 'any' && c.season && c.season !== cycle.season) return `flowers in the ${cycle.season} season`;
  if (c.light < cycle.minLight) return 'too little light to flower';
  if (c.humidity != null && c.humidity < cycle.minHumidity) return 'air too dry to flower';
  return null;
}

// A new plant's flowering state. A mature plant from the shop or the generator mostly arrives in flower or in bud (part way
// through), a young one rests; every plant gets its colour form (`palette`), a small colour jitter (`j`, also the seed of where its heads sit) and a
// length factor for this cycle (`k`), so neighbours drift out of step.
export function newBloom(flower, grown, rand = Math.random) {
  const n = flower?.palettes?.length ?? 1;
  const r = rand(), stage = grown < MATURE ? 'rest' : r < 0.6 ? 'open' : r < 0.85 ? 'bud' : 'rest';
  return { stage, t: 0.1 + rand() * 0.6, palette: Math.floor(rand() * n) % n, j: rand(), k: 0.8 + rand() * 0.45, why: null };
}

// Advance by `days` game days under conditions c. Returns what happened: 'bud' | 'open' | 'fade' | 'drop' (the petals fell: the
// cycle is over) | 'blast' (a bud withered) | null.
export function stepBloom(b, cycle, c, days, rand = Math.random) {
  const block = bloomBlock(cycle, c);
  b.why = block;
  const k = b.k ?? 1;
  const go = (stage) => { b.stage = stage; b.t = 0; return stage; };
  switch (b.stage) {
    case 'rest':
      if (!block) b.t += days / Math.max(0.05, cycle.restDays * k);
      if (b.t >= 1) return go('bud');
      return null;
    case 'bud':
      if (c.health < BLAST_HEALTH) { b.k = 0.8 + rand() * 0.45; go('rest'); return 'blast'; }
      b.t += days / Math.max(0.05, cycle.budDays * k) * (block ? 0.25 : 1);    // a bud stalls in poor conditions
      if (b.t >= 1) return go('open');
      return null;
    case 'open':
      b.t += days / Math.max(0.05, cycle.openDays * k) * (c.health < 0.5 ? 2 : 1);   // a weak plant drops its flowers sooner
      if (b.t >= 1) return go('fade');
      return null;
    case 'fade':
      b.t += days / Math.max(0.05, cycle.fadeDays);
      if (b.t >= 1) { b.k = 0.8 + rand() * 0.45; go('rest'); return 'drop'; }
      return null;
    default:
      go('rest');
      return null;
  }
}

// What the flower looks like now: show (any head drawn), open (0 a shut bud … 1 open), green (0 … 1 an unripe bud's green),
// fade (0 … 1 browning and drooping), petals (1 … 0 as they drop), scale (of the head: a bud swells).
export function bloomLook(b) {
  const t = clamp(b?.t ?? 0, 0, 1);
  switch (b?.stage) {
    case 'bud': return { show: true, open: 0.22 * smooth(0.8, 1, t), green: 1 - smooth(0.45, 0.97, t), fade: 0, petals: 1, scale: 0.3 + 0.55 * smooth(0, 1, t) };
    case 'open': return { show: true, open: 0.22 + 0.78 * smooth(0, 0.12, t), green: 0, fade: 0, petals: 1, scale: 0.85 + 0.15 * smooth(0, 0.2, t) };
    case 'fade': return { show: true, open: 1, green: 0, fade: smooth(0, 0.7, t), petals: 1 - smooth(0.55, 1, t), scale: 1 - 0.1 * t };
    default: return { show: false, open: 0, green: 0, fade: 0, petals: 0, scale: 0 };
  }
}

// How open a 'day' flower is at minute-of-day m (0 … 1; a 'night' flower is the opposite): it opens over the hour after the lamp
// has been on half an hour and shuts over the hour before the lamp goes off, as a water lily shuts in the late afternoon.
export function dayOpen(m, env) {
  if (env.lights === 'on') return 1;
  if (env.lights === 'off') return 0;
  const on = env.lightsOn ?? 480, len = (((env.lightsOff ?? 1200) - on) % 1440 + 1440) % 1440;
  const s = (((m - on) % 1440) + 1440) % 1440;    // minutes since the lamp came on
  return smooth(30, 90, s) * (1 - smooth(len - 90, len - 30, s));
}

// What follows a bloom: the chance of a new plant, how far from the parent (cm) and how big it starts.
export const AFTER = {
  keiki: { chance: 0.35, reach: 3, grown: 0.15 },   // a plantlet on the old flower stem
  pup: { chance: 0.5, reach: 4, grown: 0.12 },      // a bromeliad pup at the base
  seed: { chance: 0.12, reach: 10, grown: 0.04 },   // a seedling a little way off
  berry: { chance: 0.15, reach: 8, grown: 0.04 },   // a seedling where a berry fell
};

// Save form: [stage, t, palette, j]; anything else (an old save) gives null and the plant starts afresh.
export const packBloom = (b) => [STAGES.indexOf(b.stage), +b.t.toFixed(3), b.palette, +b.j.toFixed(3)];
export function unpackBloom(a, flower, rand = Math.random) {
  if (!Array.isArray(a) || a.length < 4 || !(a[0] >= 0 && a[0] < STAGES.length)) return null;
  const n = flower?.palettes?.length ?? 1;
  return { stage: STAGES[a[0] | 0], t: clamp(+a[1] || 0, 0, 1), palette: clamp(a[2] | 0, 0, n - 1), j: clamp(+a[3] || 0, 0, 1), k: 0.8 + rand() * 0.45, why: null };
}
