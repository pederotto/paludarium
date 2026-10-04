// Bumblebee toad (Melanophryniscus stelzneri): matte jet black with canary-yellow blotches on the back and dots on the flanks and
// limbs, fiery orange-red palms, soles and belly patches.
import { skin, spots, hex, mix3, sstep, fbm, vnoise } from './frogkit.mjs';
function pattern(v, f) {
  let c = mix3(hex(0x0a0a0c), hex(0x1a1a1c), fbm(v.x * 2, v.y * 2, v.z * 2) * 0.6);
  const sp = v.leg ? spots(v, 3.8, 0.3, 0.48, 0.5, 11) : spots(v, 3.0, 0.3, 0.52, 0.7, 13);
  c = mix3(c, mix3(hex(0xf2cc16), hex(0xffe65a), fbm(v.x * 3 + 7, v.y * 3, v.z * 3)), sp * (1 - f.belly * 0.5));
  const bl = sstep(0.5, 0.6, vnoise(v.x * 2.4 + 8, v.y * 2.4, v.z * 2.4) * 0.7 + vnoise(v.x * 5, v.y * 5, v.z * 5) * 0.3);
  c = mix3(c, hex(0xe8361a), f.belly * bl * 0.95);
  if (v.leg) c = mix3(c, hex(0xf04a18), sstep(0.72, 0.86, v.legT) * sstep(0.1, -0.5, v.n[1]));
  return c;
}
export const texel = (v) => skin(v, pattern, { gran: 0.6, wart: 0.45, lip: hex(0x020202), aoK: 0.6 });
export const paint = (v) => texel({ ...v, ao: 0, eyeD: 99, eyeR: 0 });
