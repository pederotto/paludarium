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
