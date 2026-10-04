// Fire-bellied toad (Bombina orientalis): a warty, bright grass-green back with black blotches, a red-orange belly marbled black,
// the ragged line between them low on the flanks, black-tipped toes.
import { skin, spots, hex, mix3, sstep, fbm, vnoise } from './frogkit.mjs';
function pattern(v, f) {
  const edge = v.n[1] + (vnoise(v.x * 2.6, v.y * 2.6, v.z * 2.6) - 0.5) * 0.6 + (vnoise(v.x * 6, v.y * 6, v.z * 6) - 0.5) * 0.2;
  const ventral = sstep(-0.1, -0.35, edge);
  let green = mix3(hex(0x3f6a1e), hex(0x8ab83a), fbm(v.x * 1.2, v.y * 1.2, v.z * 1.2));
  const blot = Math.max(sstep(0.52, 0.57, vnoise(v.x * 1.5 + 4, v.y * 1.5, v.z * 1.5) * 0.7 + vnoise(v.x * 3.2, v.y * 3.2, v.z * 3.2) * 0.3), spots(v, 2.6, 0.3, 0.55, 0.55, 5));
  green = mix3(green, hex(0x0e1608), blot * 0.92);
  const org = mix3(hex(0xdc3e10), hex(0xf58a1c), fbm(v.x * 1.6 + 3, v.y * 1.6, v.z * 1.6));
  const bl = sstep(0.5, 0.56, vnoise(v.x * 2 + 8, v.y * 2, v.z * 2) * 0.7 + vnoise(v.x * 5, v.y * 5, v.z * 5) * 0.3);
  let c = mix3(green, mix3(org, hex(0x0b0b0b), bl * 0.94), ventral);
  if (v.leg) c = mix3(c, hex(0x14120c), sstep(0.9, 0.98, v.legT) * 0.7);
  return c;
}
export const texel = (v) => skin(v, pattern, { gran: 0.4, wart: 1, lip: hex(0x0a0e04), aoK: 0.75 });
export const paint = (v) => texel({ ...v, ao: 0, eyeD: 99, eyeR: 0 });
