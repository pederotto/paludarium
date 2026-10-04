// Blue dart frog (Dendrobates tinctorius "azureus"), four morphs from one painter: cobalt (deep blue) or sky (light cyan-blue),
// spotted (black spots of mixed sizes over the back, head and limbs) or clean (a few at most). Darker blue limbs with a fine
// black speckle, a dark navy belly marbled with blue, a black mouth line.
import { skin, spots, hex, mix3, sstep, fbm } from './frogkit.mjs';
const MORPHS = {
  cobalt_spotted: { lo: 0x163fb4, hi: 0x2f6ef0, limb: 0x10308e, bLo: 0x1a3aa4, bHi: 0x070c26, spot: 0x020409, prob: [0.85, 0.5, 0.75] },
  cobalt_clean: { lo: 0x163fb4, hi: 0x2f6ef0, limb: 0x10308e, bLo: 0x1a3aa4, bHi: 0x070c26, spot: 0x020409, prob: [0.06, 0.03, 0.08] },
  sky_spotted: { lo: 0x2f84e2, hi: 0x78c8fa, limb: 0x2260b0, bLo: 0x2a78c8, bHi: 0x123c78, spot: 0x050f24, prob: [0.85, 0.5, 0.75] },
  sky_clean: { lo: 0x2f84e2, hi: 0x78c8fa, limb: 0x2260b0, bLo: 0x2a78c8, bHi: 0x123c78, spot: 0x050f24, prob: [0.06, 0.03, 0.08] },
};
export function texelFor(k) {
  const m = MORPHS[k]; if (!m) throw new Error('azureus morph ' + k);
  const lo = hex(m.lo), hi = hex(m.hi), limbC = hex(m.limb), bLo = hex(m.bLo), bHi = hex(m.bHi), spot = hex(m.spot);
  const pattern = (v, f) => {
    let c = mix3(lo, hi, f.dorsal * (0.45 + 0.55 * fbm(v.x * 0.9, v.y * 0.9, v.z * 0.9)));
    if (v.leg) c = mix3(c, limbC, sstep(0.25, 0.6, v.legT) * 0.8);
    c = mix3(c, mix3(bLo, bHi, sstep(0.4, 0.62, fbm(v.x * 2.4 + 4, v.y * 2.4, v.z * 2.4))), f.belly);
    const head = !v.leg && v.u < 0.3;
    const sp = v.leg ? spots(v, 3.0, 0.36, 0.56, m.prob[2], 7) : spots(v, 2.2, 0.4, 0.66, head ? m.prob[1] : m.prob[0], 1);
    c = mix3(c, spot, sp * (1 - f.belly * 0.5));
    if (v.leg) c = mix3(c, spot, spots(v, 9, 0.12, 0.22, 0.35 * m.prob[2], 3, 0.04) * sstep(0.35, 0.6, v.legT) * 0.8);   // fine speckle on the limbs
    return c;
  };
  return (v) => skin(v, pattern, { gran: 0.9, lip: hex(0x03050c) });
}
export const paintFor = (k) => { const t = texelFor(k); return (v) => t({ ...v, ao: 0, eyeD: 99, eyeR: 0 }); };
