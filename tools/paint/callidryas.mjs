// Red-eyed tree frog (Agalychnis callidryas), from the reference pictures in art-src/raw/reference/agalychnis_*.jpg:
//   back      leaf green, finely granular, with a scatter of tiny white flecks; the green runs down onto the tops of the limbs
//   flanks    blue to violet, crossed by five to seven creamy-yellow bars between the arm and the leg, which meet a pale line
//             along the lower flank (the colours a sleeping frog hides under its folded legs and flashes when it wakes)
//   limbs     green on top and on the outer sides, blue-violet on the faces hidden when it sits folded (undersides, the backs
//             of the thighs and shanks)
//   hands and feet   orange all round (soles too), with broad orange toe discs
//   belly     white to cream, the throat white; a thin pale line along the upper lip
// The eyes (red, with a vertical slit pupil) are analytic (tools/paint/eyes.mjs).
import { skin, spots, hex, mix3, sstep, fbm } from './frogkit.mjs';

const GREEN = hex(0x4c9633), GREEN_L = hex(0x7fb447), GREEN_D = hex(0x336b22);
const BLUE = hex(0x1f3c96), VIOLET = hex(0x4a3c9c), CREAM = hex(0xeadb62), WHITE = hex(0xf2f0e2), BELLY = hex(0xece3c9);
const ORANGE = hex(0xf07a0e), ORANGE_D = hex(0xd2560c);

function pattern(v, f) {
  const w = fbm(v.x * 2.5, v.y * 2.5, v.z * 2.5);
  // leaf green: lighter and a little yellower on top of the head and along the back, darker low on the sides
  let c = mix3(GREEN, GREEN_L, sstep(0.55, 0.85, w) * 0.4 + sstep(0.55, 0.95, v.n[1]) * (v.u < 0.35 ? 0.3 : 0.15));
  c = mix3(c, GREEN_D, sstep(0.3, 0.1, w) * 0.35 + sstep(0.25, -0.3, v.n[1]) * 0.2);
  // tiny white flecks on the back
  c = mix3(c, WHITE, spots(v, 11, 0.06, 0.13, 0.22, 5, 0.03) * f.dorsal * 0.85);
  if (!v.leg) {
    // the flank: blue-violet between the arm and the leg, from the belly's edge to two thirds up the side, with the cream bars
    const side = sstep(0.55, 0.15, v.n[1]) * (1 - f.belly * 0.8);
    const flank = side * sstep(0.26, 0.36, v.u) * (1 - sstep(0.9, 0.98, v.u)) * sstep(0.08, 0.18, v.h) * (1 - sstep(0.52, 0.62, v.h));
    let fc = mix3(BLUE, VIOLET, sstep(0.4, 0.8, v.u) * 0.6 + (w - 0.5) * 0.3);
    const uw = v.u + (fbm(v.x * 1.4 + 3, v.y * 1.4, v.z * 1.4) - 0.5) * 0.03;
    const bar = Math.abs(((uw - 0.4) / 0.072) % 1 - 0.5) * 2;               // 0 at a bar's middle … 1 between bars
    const barK = (1 - sstep(0.22, 0.36, bar)) * sstep(0.34, 0.4, uw) * (1 - sstep(0.86, 0.92, uw)) * sstep(0.16, 0.24, v.h);
    fc = mix3(fc, CREAM, barK * 0.95);
    fc = mix3(fc, CREAM, (1 - sstep(0.0, 0.04, Math.abs(v.h - 0.14))) * 0.75);   // the pale line low on the flank
    c = mix3(c, fc, flank);
    // the pale yellow border where the green back meets the blue flank
    const edge = side * sstep(0.3, 0.38, v.u) * (1 - sstep(0.86, 0.94, v.u)) * (1 - sstep(0.012, 0.03, Math.abs(v.h - 0.58)));
    c = mix3(c, CREAM, edge * 0.8);
    // the pale upper lip
    if (v.u < 0.3) c = mix3(c, WHITE, (1 - sstep(0.01, 0.03, Math.abs(v.h - (0.33 + 0.06 * v.u / 0.3)))) * sstep(0.45, 0.8, v.s) * 0.7);
    // the belly: cream, the whole underside (the scan's belly is lumpy, so the downward faces alone left green blotches on it)
    const under = Math.max(f.belly, sstep(0.24, 0.12, v.h) * sstep(0.35, -0.05, v.n[1]), sstep(0.32, 0.2, v.h) * sstep(-0.1, -0.4, v.n[1]));
    c = mix3(c, BELLY, under * 0.95);
  } else {
    // Limbs: green on top and on the outer sides; blue-violet only on the faces hidden when the frog sits folded up (the
    // undersides, and the backs of the thighs and shanks). Hands and feet orange all round, soles and toe pads too.
    const down = sstep(0.1, -0.5, v.n[1]);
    const back = v.leg >= 3 ? sstep(-0.3, -0.75, v.n[2]) * (1 - sstep(0.4, 0.55, v.legT)) : 0;
    const hidden = Math.min(1, down * (v.leg >= 3 ? 1 : 0.75) + back) * sstep(0.04, 0.18, v.legT);
    c = mix3(c, mix3(BLUE, VIOLET, w * 0.7), hidden);
    c = mix3(c, BELLY, f.belly * 0.6 * (1 - sstep(0.06, 0.2, v.legT)));     // the cream of the belly runs a little way onto the limbs
    const footT = v.leg >= 3 ? 0.58 : 0.6;
    const foot = sstep(footT - 0.05, footT + 0.06, v.legT);
    c = mix3(c, mix3(ORANGE, ORANGE_D, down * 0.35 + (w - 0.5) * 0.3), foot);
  }
  return c;
}

export const texel = (v) => skin(v, pattern, { gran: 0.45, lip: hex(0x2a3a14), discCol: hex(0xffa236), throat: BELLY, aoK: 0.55 });
export const paint = (v) => texel({ ...v, ao: 0, eyeD: 99, eyeR: 0 });
