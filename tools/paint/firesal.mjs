// Fire salamander (Salamandra salamandra): glossy blue-black skin with irregular bright orange-yellow blotches in two
// rows along the back, orange parotoid glands behind the eyes, blotched limbs, bars on the tail and a few red warts.
import { hex, mix3, sstep, fbm, cells } from './common.mjs';
const BLK = hex(0x0b0d22), BLK2 = hex(0x1b2040), ORA = hex(0xf49a0c), ORA2 = hex(0xffb81c), RED = hex(0xd8142a);
export function paint(v) {
  const w = fbm(v.x * 0.35, v.y * 0.35, v.z * 0.35) - 0.5;
  let c = mix3(BLK, BLK2, sstep(0.3, 0.8, fbm(v.x * 0.5, v.y * 0.5, v.z * 0.5)) * 0.7);
  let orange = 0;
  const back = sstep(0.45, 0.65, v.h);                     // the dorsal half of the trunk
  const [d, id] = cells(v.x * 0.8, v.y * 0.8, v.z * 0.6);
  if (v.leg) {
    const [dl] = cells(v.x * 0.6 + 4, v.y * 0.6, v.z * 0.6);
    orange = Math.max(sstep(0.45, 0.32, dl) * sstep(0.1, 0.25, v.legT) * (1 - sstep(0.75, 0.9, v.legT)), sstep(0.08, 0.2, v.legT) * (1 - sstep(0.2, 0.35, v.legT)) * 0.9);
  } else if (v.u < 0.24) {
    // head: parotoid gland and a patch above each eye, blue-black snout
    const gland = sstep(0.5, 0.35, Math.hypot((v.u - 0.2) * 6, (v.s - 0.78) * 2.2, (v.h - 0.55) * 2));
    const brow = sstep(0.4, 0.25, Math.hypot((v.u - 0.1) * 6, (v.s - 0.5) * 3, (v.h - 0.62) * 3));
    orange = Math.max(gland, brow * 0.9, sstep(0.55, 0.35, d) * 0.4 * back);
  } else if (v.u < 0.62) {
    // trunk: blotches, strongest on the back, with a darker midline
    const limit = 0.17 + 0.13 * back + w * 0.2;
    orange = sstep(limit + 0.05, limit - 0.02, d) * (0.35 + 0.65 * back) * (1 - sstep(0.1, 0.0, Math.abs(v.s) - 0.08) * 0.0);
    // flank blotches
    orange = Math.max(orange, sstep(0.22, 0.16, d) * sstep(0.2, 0.45, v.h) * 0.7);
    // a yellow-orange belly edge
    orange *= 1 - sstep(0.3, 0.18, v.h);
  } else {
    // tail: bars across the top
    const bar = Math.sin((v.u + w * 0.08) * Math.PI * 2 * 5.2);
    orange = sstep(0.1, 0.5, bar) * sstep(0.35, 0.6, v.h) * (1 - sstep(0.94, 1.0, v.u));
  }
  c = mix3(c, mix3(ORA, ORA2, sstep(0.3, 0.8, fbm(v.x * 0.8, v.y * 0.8, v.z * 0.8))), Math.min(1, orange));
  // red warts on the flanks
  const [dw, iw] = cells(v.x * 1.3 + 9, v.y * 1.3, v.z * 1.3);
  if (!v.leg && v.u > 0.15 && v.u < 0.6 && v.h > 0.3 && iw > 0.75) c = mix3(c, RED, sstep(0.1, 0.06, dw) * (1 - orange));
  // pale underside
  c = mix3(c, hex(0x4a4f6a), sstep(0.3, 0.12, v.h) * 0.8 * (1 - orange));
  return c;
}
