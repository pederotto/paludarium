// Real sizes in any tank. A stone, a log, a bromeliad and a frog are the same size in a 30 cm cube and in a 180 cm show
// tank: a big tank holds more of them (more stones, more plant groups, longer water), a small tank fewer, smaller pieces.
// Every factor here is measured against the standard tank (sim/tank.js STANDARD, 90 x 45 x 60 cm), where it is 1, so the
// standard tank's generated scenes and kits stay exactly as they were tuned. The simulation's own size factors (floor,
// background, volume, how hard a device pushes the air, the room a species has) are sizeFactors and roomFor in sim/tank.js;
// this file adds what the generator and the kits need on top of them.
//
// Plain arithmetic on a tank's size ({ w, d, h } in cm), so the unit tests run it under Node (tests/scale.test.mjs).

import { STANDARD, sizeFactors, roomFor } from './tank.js';
import { clamp } from '../util/math.js';

// How much the generator's tall structural pieces (spires, roots, big logs, sized for the standard tank's 60 cm height
// and 45 cm depth) must shrink to fit under this tank's lid. Never above 1: the same piece is the same size in centimetres
// in every tank (a big tank gets more of them, coverCount/extra), and a piece shrinks only where it does not fit (a low,
// shallow or small tank). Small pieces (scree stones, kits that fit, plants, animals) are not scaled by this at all.
export function pieceScale(t) {
  return clamp(Math.min(1, t.h / STANDARD.h, t.d / STANDARD.d), 0.4, 1);
}

// A piece `cm` long along an axis with `room` cm free: its real size, or shrunk just enough to fit (0.95 of the room).
export const fitScale = (cm, room) => (cm > 0 && room > 0 ? Math.min(1, (0.95 * room) / cm) : 1);

// A kit (content/kits.js) in tank `t`: real size, shrunk only when its spread (2 x kitReach, cm) does not lie across the width.
export const kitFit = (reach, t) => fitScale(2 * reach, t.w);

// How many pieces of `pieceScale` size cover what `n` pieces cover in the standard tank (the dressing on a rock face that
// grows with the tank, a scree of stones): the floor over the area one piece covers.
export const coverCount = (n, t) => Math.max(1, Math.round(n * sizeFactors(t).area / pieceScale(t) ** 2));

// A fixed-output device in a tank of another size: the same fogger fills a small tank with fog and falls short in a big one
// (sizeFactors().push), so a generated tank turns it down in a small tank and a little up in a big one, to land near the
// humidity the standard tank's recipe was tuned for (a big tank's fogger stays a little short, as a keeper's would).
export const fogScale = (t) => Math.min(1.25, 1 / sizeFactors(t).push);

// How many of an aquatic species the water can hold: about two centimetres of fish per litre of filtered, planted water
// (twice the old keeper's rule of thumb) and three dwarf shrimp per litre. Land animals are not limited by the water.
export function waterRoom(sp, litres) {
  if (sp.kind === 'swim') return Math.floor(litres * 2 / Math.max(1, sp.size ?? 3));
  if (sp.kind === 'crawlWater') return Math.floor(litres * 3 / Math.max(0.5, sp.size ?? 1));
  return Infinity;
}

// How many of a species a generated tank should get when its recipe asks for `want`: none if the tank is too small or too
// low for it (the keeper's sheet, minL and minH, with the same margins the simulation's tankRules use) or if the water cannot
// hold even its smallest group (its `flock`, three of a schooling fish); otherwise at least that group and at most what the
// water allows and the room the simulation gives it (roomFor: more than `crowd` and they stress each other).
export function stockCount(sp, want, t, litres = Infinity) {
  if (want <= 0) return 0;
  if (sp.minL && (t.w * t.d * t.h) / 1000 < sp.minL * 0.8) return 0;
  if (sp.minH && t.h < sp.minH * 0.85) return 0;
  const lo = sp.flock?.[0] ?? (sp.school ? 3 : 1);
  const fits = Math.min(roomFor(sp, sizeFactors(t)).crowd, waterRoom(sp, litres));
  if (fits < lo) return 0;
  return clamp(Math.round(want), lo, fits);
}
