// Red-eyed tree frog (Agalychnis callidryas), from the reference pictures in art-src/raw/reference/agalychnis_*.jpg:
//   back      bright leaf green, smooth, with a scatter of tiny white flecks; the green runs down onto the tops of the limbs
//   flanks    blue to violet, crossed by five to seven creamy-yellow bars between the arm and the leg, which meet a pale line
//             along the lower flank (the colours a sleeping frog hides under its folded legs and flashes when it wakes)
//   limbs     blue-violet on the hidden faces (inner arms, the front and back of the thighs and shanks), green on top
//   hands and feet   orange, with broad orange toe discs and pale webbing on the hind feet
//   belly     white to cream, the throat white; a thin pale line along the upper lip
// The eyes (red, with a vertical slit pupil) are analytic (tools/paint/eyes.mjs).
import { skin, spots, hex, mix3, sstep, fbm } from './frogkit.mjs';

const GREEN = hex(0x5fb92c), GREEN_L = hex(0x8fd84a), GREEN_D = hex(0x3c8a1c);
const BLUE = hex(0x2a49a8), VIOLET = hex(0x4a3a9e), CREAM = hex(0xf0dc6a), WHITE = hex(0xf2f0e2), ORANGE = hex(0xf5901c), ORANGE_D = hex(0xd8661a);

function pattern(v, f) {
  const w = fbm(v.x * 2.5, v.y * 2.5, v.z * 2.5);
  let c = mix3(mix3(GREEN, GREEN_L, sstep(0.55, 0.85, w) * 0.5), GREEN_D, sstep(0.3, 0.1, w) * 0.4);
  // tiny white flecks on the back
  c = mix3(c, WHITE, spots(v, 9, 0.08, 0.16, 0.18, 5, 0.04) * f.dorsal * 0.8);
  const side = !v.leg ? sstep(0.55, 0.15, v.n[1]) * (1 - f.belly * 0.8) : 0;
  if (!v.leg) {
    // the flank: blue-violet between the arm and the leg, from the belly's edge to two thirds up the side, with the cream bars
    const flank = side * sstep(0.26, 0.36, v.u) * (1 - sstep(0.9, 0.98, v.u)) * sstep(0.08, 0.18, v.h) * (1 - sstep(0.52, 0.62, v.h));
    let fc = mix3(BLUE, VIOLET, sstep(0.4, 0.8, v.u) * 0.6 + (w - 0.5) * 0.3);
    const uw = v.u + (fbm(v.x * 1.4 + 3, v.y * 1.4, v.z * 1.4) - 0.5) * 0.03;
    const bar = Math.abs(((uw - 0.4) / 0.072) % 1 - 0.5) * 2;               // 0 at a bar's middle … 1 between bars
    const barK = (1 - sstep(0.22, 0.36, bar)) * sstep(0.34, 0.4, uw) * (1 - sstep(0.86, 0.92, uw)) * sstep(0.16, 0.24, v.h);
    fc = mix3(fc, CREAM, barK * 0.95);
    fc = mix3(fc, CREAM, (1 - sstep(0.0, 0.04, Math.abs(v.h - 0.14))) * 0.75);   // the pale line low on the flank
    c = mix3(c, fc, flank);
    // the pale upper lip
    if (v.u < 0.3) c = mix3(c, WHITE, (1 - sstep(0.01, 0.03, Math.abs(v.h - (0.33 + 0.06 * v.u / 0.3)))) * sstep(0.45, 0.8, v.s) * 0.7);
  } else {
    // limbs: green on top, blue-violet on the hidden faces; orange hands and feet
    const top = sstep(0.3, 0.8, v.n[1]);
    const hidden = (1 - top) * (v.leg >= 3 ? 1 : 0.85) * sstep(0.04, 0.18, v.legT);
    c = mix3(c, mix3(BLUE, VIOLET, w * 0.7), hidden);
    const footT = v.leg >= 3 ? 0.58 : 0.6;
    const foot = sstep(footT - 0.05, footT + 0.06, v.legT);
    c = mix3(c, mix3(ORANGE, ORANGE_D, (1 - top) * 0.4 + (w - 0.5) * 0.3), foot);
  }
  c = mix3(c, WHITE, f.belly * 0.95);
  return c;
}

export const texel = (v) => skin(v, pattern, { gran: 0.12, lip: hex(0x2a3a14), discCol: hex(0xffa236), throat: WHITE, aoK: 0.55 });
export const paint = (v) => texel({ ...v, ao: 0, eyeD: 99, eyeR: 0 });
