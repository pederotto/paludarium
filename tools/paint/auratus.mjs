// Green and black poison frog (Dendrobates auratus): metallic mint-to-emerald blotches on black, turquoise underneath, black
// spots inside the green, the hands and feet black with green flecks.
import { skin, spots, hex, mix3, sstep, fbm, vnoise } from './frogkit.mjs';
const BLK = hex(0x07080a);
function pattern(v, f) {
  const wx = v.x + (fbm(v.x * 0.9, v.y * 0.9, v.z * 0.9) - 0.5) * 0.9, wz = v.z + (fbm(v.x * 0.9 + 5, v.y * 0.9, v.z * 0.9) - 0.5) * 0.9;
  const g = vnoise(wx * 0.75 + 1, v.y * 0.75, wz * 0.75) * 0.62 + vnoise(wx * 1.7, v.y * 1.7 + 4, wz * 1.7) * 0.38;
  const bias = 0.05 + 0.08 * f.dorsal - 0.15 * f.belly - (v.leg ? 0.04 + 0.12 * sstep(0.7, 0.95, v.legT) : 0);
  const patch = sstep(0.5, 0.545, g + bias);
  let green = mix3(hex(0x1fae58), hex(0x9cf04e), fbm(v.x * 1.4, v.y * 1.4, v.z * 1.4));
  green = mix3(green, hex(0x38d8b8), f.belly * 0.8);
  let c = mix3(BLK, green, patch);
  c = mix3(c, BLK, spots(v, 2.4, 0.1, 0.24, 0.5, 2) * patch * 0.9);
  return c;
}
export const texel = (v) => skin(v, pattern, { gran: 0.8, lip: hex(0x020303) });
export const paint = (v) => texel({ ...v, ao: 0, eyeD: 99, eyeR: 0 });
