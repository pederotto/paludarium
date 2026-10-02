// Habitat rules (pure: no three.js, so it runs under Node, tests/habitat.test.mjs). The data is content/habitats.js; this
// turns it into answers: may this animal be put here, how well does it suit the animal, what is wrong, and where is the
// nearest place that suits it.
//
// A SAMPLE describes a spot (animals.js builds one from the world with Animals.habitatSample):
//   depth      water depth over the ground, cm (0 or less: dry)
//   waterDist  distance to the nearest open water, cm (0 in water, Infinity if none was found)
//   landDist   distance to the nearest dry ground, cm (0 on land)
//   rh, temp   local relative humidity (%) and temperature (°C)
//   cover      0 … 1: how much hiding cover is here (a hardscape overhang, wood, leaf litter, moss, dense plants)
//   wall       the spot is on the background wall
// Fields a species does not care about may be left out (see needsOf).
//
// A VIOLATION is { why, hint, sev, hard }: `why` a short reason that fits the animal's status list ("in deep water"),
// `hint` what the species needs, as a predicate ("can't swim well: it needs dry ground"), `sev` 0 … 1 how bad it is for
// the animal, `hard` that the animal may not be put there at all (otherwise it is only a warning).

import { HABITAT } from '../content/habitats.js';
import { clamp, smooth } from '../util/math.js';

const WET = 0.3;                       // water at least this deep over the ground counts as "in water"
export const COVER_OK = 0.25;          // how much cover counts as a hide

const article = (noun) => (/^[aeiou]/i.test(noun) ? 'an' : 'a');
export const sentence = (id, frag) => { const h = HABITAT[id]; const n = h?.noun ?? id; return `${article(n)[0].toUpperCase()}${article(n).slice(1)} ${n} ${frag}.`; };

// Which sample fields does this species' rule read? The world only measures what is asked for.
export function needsOf(id) {
  const h = HABITAT[id];
  if (!h) return {};
  return {
    cover: !!h.cover,
    water: h.water != null || h.zone === 'shore',
    land: h.reach != null,
    rh: h.rhMin != null,
    temp: h.tMax != null,
  };
}

const V = (why, hint, sev, hard = true) => ({ why, hint, sev, hard });

// Violations of where the animal is standing: its medium, its depth, how far it is from water, whether it has cover.
// `cover: false` skips the hide test (an animal that is out and about at night does not need one right now).
export function zoneViolations(id, s, { cover = true } = {}) {
  const h = HABITAT[id];
  const out = [];
  if (!h || h.zone === 'any' || h.zone === 'air') return out;
  const depth = s.depth ?? 0, wet = depth > WET;
  switch (h.zone) {
    case 'water':
      if (s.wall) out.push(V('out of water', 'lives in the water, not on the background', 1));
      else if (depth < h.minDepth) out.push(V(wet ? 'water too shallow' : 'out of water', `needs ${h.need}`, wet ? 0.5 : 1));
      break;
    case 'shore':
      if (s.wall) out.push(V('on the glass', 'stays on the ground and in the water', 1));
      else if (wet) {
        if (depth > h.maxDepth) out.push(V('water too deep', `is out of its depth in water over ${h.maxDepth} cm`, 0.6));
        else if (h.reach != null && depth > 2 && (s.landDist ?? 0) > h.reach) out.push(V('no bank to climb out', `needs a bank within ${h.reach} cm to climb out on`, 0.4, false));
      } else if ((s.waterDist ?? Infinity) > h.water) out.push(V('far from water', `needs open water within ${h.water} cm`, 0.5));
      break;
    case 'land':
    case 'wall':
      if (s.wall && h.zone === 'land') out.push(V('on the glass', 'lives on the ground', 1));
      else if (!s.wall) {
        if (depth > h.maxDepth) out.push(V('in deep water', "can't swim well: it needs dry ground", 0.8));
        else if (h.water != null && !wet && (s.waterDist ?? Infinity) > h.water) out.push(V('far from water', `wants water within ${h.water} cm`, 0.15, false));
        if (cover && h.cover && (s.cover ?? 0) < COVER_OK && depth <= h.maxDepth) out.push(V('no cover', `needs a hide (wood, a rock, leaf litter or moss) within ${h.cover} cm`, 0.35));
      }
      break;
  }
  return out;
}

// Violations of the air at the spot: too dry, too hot.
export function envViolations(id, s) {
  const h = HABITAT[id];
  const out = [];
  if (!h) return out;
  if (h.rhMin != null && s.rh != null && s.rh < h.rhMin) out.push(V('air too dry here', `needs damper air: here it is ${Math.round(s.rh)}% and it wants at least ${h.rhMin}%`, 0.5));
  if (h.tMax != null && s.temp != null && s.temp > h.tMax) out.push(V('too hot here', `is too warm here (${s.temp.toFixed(0)} °C, over ${h.tMax} °C is dangerous for it)`, 0.6));
  return out;
}

// The verdict for a spot: { ok, level 'good' | 'warn' | 'bad', fit 0 … 1, why: [short reasons], hint, need }.
// `env: false` leaves the air out (the simulation already judges temperature and humidity against the species' comfort range).
export function habitatCheck(id, s, { env = true, cover = true } = {}) {
  const h = HABITAT[id];
  if (!h) return { ok: true, level: 'good', fit: 1, why: [], hint: '', need: '' };
  const v = [...zoneViolations(id, s, { cover }), ...(env ? envViolations(id, s) : [])];
  const bad = v.filter((x) => x.hard);
  let fit = 1;
  for (const x of v) fit *= 1 - x.sev * 0.85;
  const first = bad[0] ?? v[0];
  const hint = first ? sentence(id, first.hint) : '';
  return { ok: bad.length === 0, level: bad.length ? 'bad' : v.length ? 'warn' : 'good', fit: clamp(fit, 0, 1), why: v.map((x) => x.why), hint, need: h.need };
}

// The nearest spot (within maxR cm of x, z) that suits the animal: { x, z, dist } or null. `sample(x, z)` returns a sample
// or null for a point outside the tank. Rings of points outward from the animal; the first ring with a suitable point wins
// and the best-fitting point on it is returned, with `prefer(x, z)` (0 … 1, optional) breaking ties.
export function findHabitat(id, x, z, sample, { maxR = 40, step = 2, env = false, cover = true, prefer = null, ok = null } = {}) {
  for (let r = step; r <= maxR; r += step) {
    const n = Math.max(8, Math.ceil(r * 1.6));
    let best = null, bs = -1;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + r * 0.37;     // the rings are turned a little so the search has no favourite direction
      const px = x + Math.sin(a) * r, pz = z + Math.cos(a) * r;
      const s = sample(px, pz);
      if (!s) continue;
      const c = habitatCheck(id, s, { env, cover });
      if (!c.ok || (ok && !ok(px, pz, s))) continue;
      const sc = c.fit + (prefer ? prefer(px, pz, s) * 0.5 : 0);
      if (sc > bs) { bs = sc; best = { x: px, z: pz, dist: r }; }
    }
    if (best) return best;
  }
  return null;
}

// --- Behaviour scores ----------------------------------------------------------------------------------------------
// How inclined a nocturnal or crepuscular animal is to be out and about, 0 … 1. `light` 0 (dark) … 1 (the lamp is on),
// `rain` 0 … 1, `rh` the local humidity, `rhIdeal` what the species wants. A fire salamander is out on dark, damp nights and
// after rain, and sits in its hide in the light unless the air is saturated.
export function nightActivity(light, rain, rh, rhIdeal) {
  const dark = 1 - smooth(0.05, 0.55, light);
  const damp = smooth(rhIdeal - 18, rhIdeal + 6, rh);
  return clamp(0.06 + dark * 0.8 * (0.35 + 0.65 * damp) + rain * 0.6 * damp, 0, 1);
}

// How good a spot is to sit out the day in, 0 … 1: covered, shaded, damp, cool and not far to walk.
//   cover 0 … 1, light 0 (deep shade) … 1, rh and rhIdeal (%), temp and tIdeal (°C), dist cm to walk there.
export function hideScore({ cover = 0, light = 1, rh = 70, rhIdeal = 70, temp = 20, tIdeal = 18, dist = 0 }) {
  const damp = smooth(rhIdeal - 20, rhIdeal + 5, rh);
  const cool = 1 - smooth(0, 8, temp - tIdeal);
  const shade = 1 - clamp(light, 0, 1);
  return clamp(cover * 0.55 + shade * 0.15 + damp * 0.15 + cool * 0.15 - dist * 0.004, 0, 1);
}
