// Strawberry poison frog, "blue jeans" morph (Oophaga pumilio): red-orange body with fine dark speckle,
// blue legs with black speckle, a paler orange belly.
import { hex, mix3, sstep, fbm, cells } from './common.mjs';
const RED = hex(0xe6200c), ORA = hex(0xf26a14), BLUE = hex(0x1c2fa8), DBLUE = hex(0x0d1670), SPOT = hex(0x120a08);
export function paint(v) {
  const [d] = cells(v.x * 1.4, v.y * 1.4, v.z * 1.4);
  const speck = 1 - sstep(0.08, 0.16, d);
  let c = mix3(RED, ORA, sstep(0.15, 0.45, 1 - v.h) * 0.7 + sstep(0.35, 0.8, fbm(v.x * 0.6, v.y * 0.6, v.z * 0.6)) * 0.3);
  if (v.leg) {
    const blue = sstep(0.1, 0.32, v.legT) ;
    c = mix3(c, mix3(BLUE, DBLUE, sstep(0.4, 1, fbm(v.x, v.y, v.z) )), blue);
    c = mix3(c, SPOT, speck * 0.55 * blue);
  } else {
    c = mix3(c, SPOT, speck * 0.4 * sstep(0.35, 0.5, v.h));
    // blue wash on the hips and the rear of the body
    c = mix3(c, BLUE, sstep(0.72, 0.9, v.u) * sstep(0.5, 0.2, v.h) * 0.8);
  }
  return c;
}

// Per texel (tools/paint/frogkit.mjs): the same pattern with granules, toe discs, the mouth line and the baked creases.
import { skin } from './frogkit.mjs';
export const texel = (v) => skin(v, (q) => paint(q), { gran: 0.8 });
