// Yellow-banded poison frog (Dendrobates leucomelas): bright yellow with broad black bands across the back
// that continue down the flanks, a black head cap and eye mask, and banded black-and-yellow legs.
import { hex, mix3, sstep, fbm, vnoise } from './common.mjs';
const YEL = hex(0xf2b80e), YEL2 = hex(0xe39a08), BLK = hex(0x050505);
export function paint(v) {
  const w = fbm(v.x * 0.5, v.y * 0.5, v.z * 0.5) - 0.5;
  let black = 0;
  if (v.leg) {
    // legs: rings, with black toes and black upper-leg joint
    const r = Math.sin((v.legT + w * 0.25) * Math.PI * 2 * 3.1 + 1.0);
    black = Math.max(sstep(-0.1, 0.25, r), sstep(0.8, 0.9, v.legT));
  } else {
    // trunk bands: angle across the back so they wrap down the flanks
    const side = v.x >= 0 ? 1 : -1;
    const uw = v.u + w * 0.1 + (0.5 - v.h) * 0.07;
    const band = Math.sin(uw * Math.PI * 2 * 4.2 + 0.25);
    const trunk = sstep(0.12, 0.28, v.u) * (1 - sstep(0.86, 0.96, v.u));
    black = sstep(-0.05, 0.2, band) * trunk;
    // belly is yellow-and-black marbled, the throat yellow
    const belly = 1 - sstep(0.1, 0.32, v.h);
    black = black * (1 - belly * 0.5);
    // head: black cap behind a yellow snout, black eye mask running to the nostril
    const cap = sstep(0.5, 0.62, v.h) * sstep(0.0, 0.05, v.u) * (1 - sstep(0.17, 0.25, v.u));
    const snout = 1 - sstep(0.02, 0.07, v.u);
    const mask = sstep(0.55, 0.9, v.s) * sstep(0.03, 0.08, v.u) * (1 - sstep(0.16, 0.26, v.u)) * (1 - sstep(0.62, 0.45, v.h));
    black = Math.max(black, cap * (1 - snout * 0.9), mask * 0.9);
    // little black spot on the snout
    if (v.u < 0.05 && v.h > 0.55 && v.s < 0.2) black = Math.max(black, 0.8);
  }
  const base = mix3(YEL, YEL2, sstep(0.3, 0.7, vnoise(v.x * 1.2, v.y * 1.2, v.z * 1.2)) * 0.5);
  return mix3(base, BLK, Math.min(1, black));
}

// Per texel (tools/paint/frogkit.mjs), after the reference photo (art-src/raw/reference/frog_leaping_leucomelas.jpg): slanted black
// bands over the back and down the flanks with ragged edges, a black belly, a yellow band over the snout and between the eyes,
// a black mask round each eye with a yellow streak under it along the jaw, evenly black-ringed limbs, dark toes.
import { skin } from './frogkit.mjs';
function pattern(v, f) {
  const w = fbm(v.x * 0.8, v.y * 0.8, v.z * 0.8) - 0.5, w2 = fbm(v.x * 2.4 + 3, v.y * 2.4, v.z * 2.4) - 0.5;
  let black = 0;
  if (v.leg) {
    const r = Math.sin((v.legT * 4.4 + w * 0.4 + w2 * 0.1) * Math.PI * 2);
    black = sstep(0.05, 0.3, r);
    black = Math.max(black, sstep(0.88, 0.96, v.legT) * 0.85);                     // dark toe tips
    black = Math.max(black, f.belly * 0.6);
  } else {
    const uw = v.u + w * 0.12 + w2 * 0.03 + (0.55 - v.h) * 0.16;                     // bands slant down and back
    const band = Math.sin((uw - 0.18) * Math.PI * 2 * 3.6);
    black = sstep(0.0, 0.28, band) * sstep(0.2, 0.3, v.u);
    black = Math.max(black, sstep(0.25, 0.08, v.h + w * 0.1) * 0.95);              // black belly and lower flanks
    black = Math.max(black, f.belly);
    if (v.u < 0.32) {
      // head: yellow over the snout and between the eyes, black mask round the eyes, a yellow streak under the eye
      const r = v.eyeR || 0.3;
      const mask = 1 - sstep(r * 1.5, r * 2.2, v.eyeD + w2 * r * 0.8);
      const top = sstep(0.62, 0.75, v.h) * (1 - sstep(0.5, 0.9, v.s));
      const jaw = sstep(0.3, 0.4, v.h) * (1 - sstep(0.44, 0.52, v.h)) * sstep(0.04, 0.1, v.u);
      black = Math.max(black * sstep(0.18, 0.3, v.u) * (1 - top), mask, (1 - sstep(0.3, 0.38, v.h)) * sstep(0.02, 0.08, v.u));
      black *= 1 - jaw * 0.85 * (1 - mask * 0.6);
    }
  }
  const base = mix3(YEL, YEL2, sstep(0.3, 0.7, vnoise(v.x * 1.2, v.y * 1.2, v.z * 1.2)) * 0.5);
  return mix3(base, BLK, Math.min(1, black));
}
export const texel = (v) => skin(v, pattern, { gran: 0.8 });
