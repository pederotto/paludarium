// Shared frog skin for the textured frog bakes (tools/bake-creature.mjs jobs with rig: 'frog' and texture). Each species paint
// is skin(v, pattern): `pattern(v, f)` returns the species' colour at the texel; skin() adds what every frog has, at texel scale
// (a 1024 texture over a 4 cm frog is about 200 texels per cm):
//   granules     the fine pebbled skin of a dart frog: tiny lighter caps with darker gaps, strongest on the back
//   toe discs    the pale-rimmed adhesive pads at the finger and toe tips
//   lips         a thin dark line along the mouth, the pale throat behind it
//   gloss AO     creases (armpit, groin, under the jaw, between the toes) darken by the baked occlusion
// v: { x, y, z (cm), n, u (snout 0 … 1), h (0 … 1), s, leg (0 body, 1 … 4), legT, part, ao, eyeD (cm to the eye centre), eyeR }
import { hex, mix3, sstep, fbm, cells, vnoise } from './common.mjs';
export { hex, mix3, sstep, fbm, cells, vnoise };

// Spots on a jittered grid: 1 inside a spot of radius r (in cells; r varies per spot between r0 and r1), soft edge, a fraction
// `prob` of the cells have one. scale: cells per cm.
export function spots(v, scale, r0, r1, prob, seed = 0, soft = 0.06) {
  const w = (fbm(v.x * 2.3 + seed, v.y * 2.3, v.z * 2.3) - 0.5) * 0.35;      // wobbly edges
  const [d, id] = cells(v.x * scale + seed * 13.1, v.y * scale + seed * 7.7, v.z * scale - seed * 3.3);
  if (id > prob) return 0;
  const r = r0 + (r1 - r0) * ((id / Math.max(prob, 1e-6)) % 1);
  return 1 - sstep(r - soft, r + soft, d + w * r);
}

// Bands that wrap round the body: 1 inside, along u (snout to vent) at centres cs with half widths hw, wobbly edges.
export function bands(v, cs, hw, wob = 0.05) {
  const uw = v.u + (fbm(v.x * 0.9, v.y * 0.9, v.z * 0.9) - 0.5) * wob * 4 + (0.5 - v.h) * 0.05;
  let k = 0;
  for (let i = 0; i < cs.length; i++) k = Math.max(k, sstep(cs[i] - hw[i] - 0.02, cs[i] - hw[i] + 0.02, uw) * (1 - sstep(cs[i] + hw[i] - 0.02, cs[i] + hw[i] + 0.02, uw)));
  return k;
}

export const dorsal = (v) => sstep(-0.3, 0.6, v.n[1]);
export const belly = (v) => (v.leg ? sstep(-0.2, -0.7, v.n[1]) * 0.6 : sstep(-0.15, -0.6, v.n[1]) * sstep(0.55, 0.3, v.h));
export const disc = (v) => (v.leg ? sstep(0.9, 0.965, v.legT) : 0);       // the toe-pad end of each finger and toe

export function skin(v, pattern, { gran = 1, granCol = null, discCol = null, lip = hex(0x080808), throat = null, aoK = 0.7, wart = 0 } = {}) {
  const f = { dorsal: dorsal(v), belly: belly(v), disc: disc(v) };
  let c = pattern(v, f);
  // granules: 0.25 mm caps on the back and flanks, a little lighter, the gaps a little darker
  if (gran && !v.noGran) {                                                 // (noGran: vertex paint, too coarse for granules)
    const [d, id] = cells(v.x * 38, v.y * 38, v.z * 38);
    const cap = 1 - sstep(0.18, 0.42, d), gap = sstep(0.42, 0.62, d);
    const k = gran * (0.35 + 0.65 * f.dorsal) * (1 - f.belly * 0.7);
    const lighter = granCol ?? c.map((q) => Math.min(1, q * 1.35 + 0.012));
    c = mix3(c, lighter, cap * k * 0.28 * (0.6 + 0.4 * id));
    c = c.map((q) => q * (1 - gap * k * 0.16));
  }
  // warts (toads): raised tubercles with a darker tip and a pale base ring
  if (wart) {
    const [d, id] = cells(v.x * 7, v.y * 7, v.z * 7);
    const on = sstep(0.2, 0.6, id) * (0.3 + 0.7 * f.dorsal) * (1 - f.belly);
    c = mix3(c, c.map((q) => q * 0.4), (1 - sstep(0.12, 0.26, d)) * on * wart);
    c = mix3(c, c.map((q) => Math.min(1, q * 1.35 + 0.01)), (sstep(0.24, 0.32, d) - sstep(0.4, 0.5, d)) * on * wart * 0.5);
  }
  // toe discs: pale rim, slightly darker centre underneath
  if (f.disc > 0) {
    const pad = discCol ?? c.map((q) => Math.min(1, q * 1.25 + 0.03));
    c = mix3(c, pad, f.disc * (0.5 + 0.5 * sstep(-0.2, -0.8, v.n[1])) * 0.6);
  }
  // the mouth line: a thin dark line low on the side of the head, from the snout tip back past the eye
  if (!v.leg && v.u < 0.32) {
    const mouthY = 0.3 + 0.07 * (v.u / 0.32);
    const ln = 1 - sstep(0.008, 0.022, Math.abs(v.h - mouthY));
    c = mix3(c, lip, ln * sstep(0.32, 0.22, v.u) * sstep(0.35, 0.75, v.s + 0.25 * (1 - v.u / 0.32)) * 0.9);
    if (throat) c = mix3(c, throat, sstep(mouthY - 0.02, mouthY - 0.08, v.h) * sstep(-0.3, -0.75, v.n[1]) * 0.85);
  }
  // eyelid ring: the skin right round the analytic eye is a little darker (the eye socket)
  if (v.eyeR) c = c.map((q) => q * (1 - 0.3 * (1 - sstep(v.eyeR * 0.95, v.eyeR * 1.5, v.eyeD))));
  const shade = 1 - aoK * Math.pow(Math.min(1, (v.ao ?? 0) * 1.15), 0.8);
  return c.map((q) => q * shade);
}
