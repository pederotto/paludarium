// Stocking advice: how many of a species this tank holds before they crowd each other, in the words the panels use.
//
// The numbers are the simulation's own (sim/tank.js roomFor, which sim.js uses to stress a crowded animal), so the Add
// menu, the Field guide, the warnings and the Curator say exactly what the animals will feel: a swimmer's room grows with
// the tank's volume, a gecko's with the background, everyone else's with the floor. The tank's height and litres against
// the keeper's sheet (minL, minH) use the same tolerances as Sim.tankRules.
//
// Plain functions of species records and size factors (sim/tank.js sizeFactors), so this runs under Node.

import { roomFor, sizeFactors, CROWDS } from '../sim/tank.js';

// The kinds of animal that mind a crowd of their own kind are the simulation's (sim/tank.js CROWDS); a species with a
// `flock` minds one whatever its kind.
export const CROWD_KINDS = CROWDS;
export const mindsCrowd = (id, sp) => !!sp.flock || (CROWD_KINDS.has(sp.kind) && id !== 'tadpole' && !sp.young);

// The tank's litres and height against the keeper's sheet (Sim.tankRules): a reason, or null.
export function tooSmall(sp, f) {
  const h = f.floor ? (f.litres * 1000) / f.floor : 60;
  if (sp.minL && f.litres < sp.minL * 0.8) return `needs ${sp.minL} L or more (this tank: ${Math.round(f.litres)} L)`;
  if (sp.minH && h < sp.minH * 0.85) return `needs ${sp.minH} cm of height (this tank: ${Math.round(h)} cm)`;
  return null;
}

// How a species does at `have` animals in a tank with size factors `f`:
// { room, have, more, lo, verdict, text, territories }. `room` is how many fit before they crowd (Infinity for the crew,
// snails and feeders, which only stop breeding). verdict: 'small' (the tank is too small or too low for it, or has no water
// for a swimmer), 'over' (more than the room: they stress each other), 'full' (as many as fit), 'group' (room for fewer
// than its group), 'lonely' (fewer than its group: add more), 'ok', or 'free' (it never crowds).
// `o.water`: litres of water in the tank now (a swimmer needs some), `o.name`: what to call it.
export function stockAdvice(id, sp, have = 0, f = sizeFactors(), o = {}) {
  const R = roomFor(sp, f);
  const lo = sp.flock?.[0] ?? 1;
  const aquatic = sp.kind === 'swim' || sp.kind === 'crawlWater';
  const base = { have, lo, cap: R.cap, territories: sp.territorial ? R.territories : null };
  const small = tooSmall(sp, f);
  if (small) return { ...base, room: R.crowd, more: 0, verdict: 'small', text: small };
  if (aquatic && o.water != null && o.water < 0.5) return { ...base, room: R.crowd, more: 0, verdict: 'small', text: 'no water for it here yet' };
  if (!mindsCrowd(id, sp)) {
    return { ...base, room: Infinity, more: Infinity, verdict: 'free', text: sp.feeder ? 'food: it never crowds the tank' : `never crowds; breeds up to about ${R.cap} here` };
  }
  const room = R.crowd, more = Math.max(0, room - have);
  const terr = sp.territorial ? `; room for ${R.territories} adult male${R.territories > 1 ? 's' : ''}` : '';
  let verdict, text;
  if (have > room) { verdict = 'over'; text = `crowded (${have} here, room for ${room})`; }
  else if (room < lo) { verdict = 'group'; text = `room for ${room}, too few for a group of ${lo}`; }
  else if (more === 0) { verdict = 'full'; text = `full (room for ${room})`; }
  else if (have && have < lo) { verdict = 'lonely'; text = `lonely (keep ${lo} or more; room for ${room})`; }
  else { verdict = 'ok'; text = have ? `room for about ${room} here (${have} now)${terr}` : `room for about ${room} here${lo > 1 ? `; keep at least ${lo}` : ''}${terr}`; }
  return { ...base, room, more, verdict, text };
}

// The species in a tank that are over their room: [{ id, n, room }] and the worst ratio n / room (0 when none mind a crowd).
// `counts` is { speciesId: n }, `species` the SPECIES table.
export function crowding(counts, species, f = sizeFactors()) {
  const over = [];
  let worst = 0;
  for (const [id, n] of Object.entries(counts)) {
    const sp = species[id];
    if (!sp || !n || !mindsCrowd(id, sp)) continue;
    const room = roomFor(sp, f).crowd;
    worst = Math.max(worst, n / Math.max(1, room));
    if (n > room) over.push({ id, n, room });
  }
  return { over, worst };
}

// Whether a tank could hold what a commission's goals ask for: { ok, why: [text] }. `needs` lists { id, n } (n animals of a
// species) and { minL, maxL } (the tank's own litres); `species` is the SPECIES table and `tank` a size ({ w, d, h }).
export function canHold(tank, needs, species) {
  const f = sizeFactors(tank), why = [];
  for (const nd of needs) {
    if (nd.minL && f.litres < nd.minL) { why.push(`it needs a tank of ${nd.minL} L or more`); continue; }
    if (nd.maxL && f.litres > nd.maxL) { why.push(`it needs a tank of ${nd.maxL} L or less`); continue; }
    const sp = nd.id && species[nd.id];
    if (!sp) continue;
    const name = sp.name.toLowerCase();
    const small = tooSmall(sp, f);
    if (small) { why.push(`the ${name} ${small}`); continue; }
    if (mindsCrowd(nd.id, sp)) {
      const room = roomFor(sp, f).crowd;
      if (nd.n > room) why.push(`${nd.n} of the ${name} would crowd it (room for about ${room})`);
    }
  }
  return { ok: !why.length, why };
}

// How many species a tank of this size can show off (the Curator's diversity target): 8 in the standard tank, about 4 in a
// jar or a cube, 12 in the show tank. It grows slowly with the volume: a big tank has more niches, not more of each.
export function speciesTarget(f = sizeFactors()) {
  return Math.max(3, Math.min(12, Math.round(8 * Math.pow(f.vol, 0.35))));
}

// The size class of a tank, for the Curator and the commissions: small tanks (the jar, the cube and the nano) are judged on
// being perfect, large ones (the wide, grand and show tanks) on what only room makes possible.
export function sizeClass(litres) {
  return litres <= 120 ? 'small' : litres >= 400 ? 'large' : 'medium';
}
