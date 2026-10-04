// Starry night reed frog (Heterixalus alboguttatus): glossy jet black with many small cream-yellow stars, bright orange hands,
// feet and inner thighs, a pale cream belly.
import { skin, spots, hex, mix3, sstep, fbm } from './frogkit.mjs';
function pattern(v, f) {
  let c = hex(0x08080a);
  const sp = spots(v, v.leg ? 4.6 : 3.8, 0.1, 0.22, 0.7, 17, 0.05);
  c = mix3(c, mix3(hex(0xf4eac0), hex(0xffe680), fbm(v.x * 4, v.y * 4, v.z * 4)), sp);
  c = mix3(c, hex(0xe6dcc8), f.belly * 0.9);
  if (v.leg) {
    const k = v.leg >= 3 ? sstep(0.3, 0.45, v.legT) : sstep(0.4, 0.55, v.legT);
    c = mix3(c, mix3(hex(0xff6a10), hex(0xff8a2a), fbm(v.x * 3, v.y * 3, v.z * 3)), Math.max(k, sstep(-0.1, -0.5, v.n[1]) * 0.8));
  }
  return c;
}
export const texel = (v) => skin(v, pattern, { gran: 0.35, lip: hex(0x020202), discCol: hex(0xffa040) });
export const paint = (v) => texel({ ...v, ao: 0, eyeD: 99, eyeR: 0 });
