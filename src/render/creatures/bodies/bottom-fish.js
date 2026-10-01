// Bottom dwellers: corydoras and otocinclus. Face +z, centred on the origin, cm. They reuse the loft + fin-sheet
// builder of tetras.js (see the notes there: fin sheets must be >= ~1.5 mesher cells thick). The betta lives in tetras.js.
import { ell, cap, cells, vnoise, C, lerp3, mul3, clamp01 } from '../kit.js';
import { fishBody, medianFin, pairFin, caudalPoly, fanPaint, sm } from './tetras.js';

export const BOTTOM_FISH = {
  // Corydoras aeneus: an armoured catfish, humped back, flat belly, big round head, barbels, big eyes, spiny fins.
  cory: () => {
    const t = 0.05, tan = C(0xc79a58), olive = C(0x7a6a3a), belly = C(0xf0deb0), bronze = C(0x9aa040), speck = C(0x352f26), FIN = C(0xc4b48c), FRAY = C(0x6a5c3e);
    return fishBody({
      sl: 3.45, total: 4.1, cell: 0.065, eyeRing: mul3(C(0xb08a50), 1.4), box: [0.75, -1.1, 1.25], nose: 0.075,
      top: [[0, 0.03], [0.06, 0.085], [0.2, 0.16], [0.4, 0.21], [0.55, 0.19], [0.8, 0.105], [1, 0.05]],
      bot: [[0, -0.035], [0.06, -0.07], [0.2, -0.1], [0.45, -0.115], [0.7, -0.095], [0.85, -0.065], [1, -0.04]],
      wid: [[0, 0.03], [0.06, 0.075], [0.2, 0.105], [0.4, 0.108], [0.7, 0.078], [1, 0.03]],
      eyes: [{ s: 0.13, v: 0.4, r: 0.2, up: 0.25, inner: C(0xc9a24a), outer: C(0x5a3d14), limb: C(0x1a1206), pupil: [0.5, 0.5] }],
      // Barbels: two thin whiskers on each side under the snout.
      extra: (x, y, z, ax) => {
        if (z < 1.45 || y > 0.1) return 1;
        const p = [ax, y, z];
        return Math.min(cap(p, [0.1, -0.2, 1.95], [0.3, -0.34, 2.08], 0.058, 0.04)[0], cap(p, [0.15, -0.2, 1.88], [0.5, -0.42, 1.98], 0.058, 0.04)[0]);
      },
      fins: ({ Z, TY, BY, sec }) => {
        const [cy, hy, ww] = sec(0.26);
        const p = (fz, fy, n = 16) => fanPaint({ f: [fz, fy], base: FIN, ray: FRAY, n, amt: 0.4, edge: speck, edgeAmt: 0.15 });
        const y0 = TY(0.4);
        return [
          medianFin(caudalPoly(Z(0.94), Z(0.94) + 2.05, 0.11, 0.62, (r) => 1 - 0.4 * (1 - r) ** 1.3), t, p(Z(0.94), 0, 20)),
          // Dorsal: tall, with a stiff spine on its leading edge.
          medianFin([[Z(0.33), TY(0.33) - 0.08], [Z(0.36), y0 + 0.9], [Z(0.42), y0 + 0.98], [Z(0.5), y0 + 0.55], [Z(0.56), TY(0.56) - 0.08]], t, p(Z(0.45), y0, 12)),
          medianFin([[Z(0.62), BY(0.62) + 0.08], [Z(0.65), BY(0.68) - 0.3], [Z(0.76), BY(0.75) - 0.2], [Z(0.82), BY(0.82) + 0.08]], t, p(Z(0.72), BY(0.7), 12)),
          // Broad pectorals with a spine, and pelvics.
          ...pairFin({ x: ww * 0.85, y: cy - hy * 0.62, z: Z(0.25), dir: [0.55, -0.2, -1], poly: [[-0.08, -0.06], [0.05, 0.17], [0.4, 0.28], [0.85, 0.25], [1.0, 0.05], [0.8, -0.14], [0.35, -0.14]], t, paint: p(Z(0.25), cy, 10) }),
          ...pairFin({ x: ww * 0.5, y: BY(0.5) + 0.05, z: Z(0.5), dir: [0.2, -0.35, -1], poly: [[-0.05, -0.05], [0.05, 0.1], [0.4, 0.12], [0.6, 0.0], [0.4, -0.1], [0.05, -0.1]], t, paint: p(Z(0.5), BY(0.5), 8) }),
        ];
      },
      paint: (s, v, x, y, z) => {
        let c = lerp3(tan, olive, sm(0.15, 0.95, v) * 0.85);
        c = lerp3(c, bronze, sm(-0.15, 0.05, v) * (1 - sm(0.35, 0.6, v)) * sm(0.15, 0.3, s) * 0.5);
        c = lerp3(c, belly, sm(-0.25, -0.85, v));
        c = lerp3(c, speck, sm(0.2, 0.1, cells(x * 1.0, y * 1.0, z * 1.0, 5.5)) * sm(-0.7, -0.2, v) * sm(0.1, 0.3, s) * 0.8);
        return mul3(lerp3(c, olive, (1 - sm(0.0, 0.16, s)) * 0.3), 1.6);
      },
      finish: { finOpacity: 0.55, coat: 0.45, sheen: 0 },
    });
  },
  // Otocinclus: a small, slender armoured sucker-mouth catfish with a dark lateral stripe.
  oto: () => {
    const t = 0.045, fawn = C(0xb59d62), pale = C(0xe4dcbc), dark = C(0x0e0c08), FIN = C(0xc9c6b0), FRAY = C(0x7a7660), lip = C(0xd9c9a0);
    return fishBody({
      sl: 2.5, total: 3.0, cell: 0.058, eyeRing: mul3(C(0xa89a68), 1.3), box: [0.5, -0.6, 0.65], nose: 0.08,
      top: [[0, 0.025], [0.06, 0.06], [0.2, 0.1], [0.4, 0.118], [0.6, 0.1], [0.8, 0.065], [1, 0.04]],
      bot: [[0, -0.02], [0.06, -0.04], [0.2, -0.06], [0.4, -0.066], [0.7, -0.056], [1, -0.035]],
      wid: [[0, 0.035], [0.06, 0.065], [0.2, 0.09], [0.4, 0.092], [0.7, 0.056], [1, 0.025]],
      eyes: [{ s: 0.16, v: 0.62, r: 0.13, up: 0.7, fwd: 0.1, inner: C(0xc9b060), outer: C(0x50401a), limb: C(0x120e06), pupil: [0.5, 0.5] }],
      // The sucker mouth: a round pad on the underside of the snout.
      extra: (x, y, z, ax) => (z > 0.95 ? ell(ax, y + 0.12, z - 1.32, 0.15, 0.06, 0.2) : 1),
      fins: ({ Z, TY, BY, sec }) => {
        const [cy, hy, ww] = sec(0.27);
        const p = (fz, fy, n = 14) => fanPaint({ f: [fz, fy], base: FIN, ray: FRAY, n, amt: 0.35 });
        const y0 = TY(0.45);
        return [
          medianFin(caudalPoly(Z(0.93), Z(0.93) + 1.5, 0.09, 0.3, (r) => 1 - 0.4 * (1 - r) ** 1.3), t, (u, v, ds, x, y, z) => lerp3(p(Z(0.93), 0, 16)(u, v, ds), dark, sm(0.3, 0.0, Z(0.93) - z) * 0.85)),
          medianFin([[Z(0.44), TY(0.44) - 0.06], [Z(0.47), y0 + 0.4], [Z(0.54), y0 + 0.44], [Z(0.62), y0 + 0.15], [Z(0.66), TY(0.66) - 0.06]], t, p(Z(0.55), y0, 10)),
          medianFin([[Z(0.66), BY(0.66) + 0.06], [Z(0.69), BY(0.72) - 0.16], [Z(0.8), BY(0.8) - 0.1], [Z(0.86), BY(0.86) + 0.06]], t, p(Z(0.75), BY(0.75), 8)),
          ...pairFin({ x: ww * 0.85, y: cy - hy * 0.6, z: Z(0.26), dir: [0.6, -0.15, -1], poly: [[-0.06, -0.05], [0.05, 0.13], [0.3, 0.2], [0.6, 0.15], [0.7, 0.02], [0.5, -0.1], [0.2, -0.1]], t, paint: p(Z(0.26), cy, 10) }),
        ];
      },
      paint: (s, v, x, y, z) => {
        let c = lerp3(fawn, pale, sm(-0.05, -0.85, v));
        c = lerp3(c, lerp3(fawn, dark, 0.35), sm(0.4, 0.9, v) * 0.6);
        const band = sm(-0.32, -0.16, v) * (1 - sm(0.18, 0.34, v)) * (1 - sm(0.94, 1.0, s));
        c = lerp3(c, dark, Math.min(1, band * 1.2));
        c = lerp3(c, lip, sm(-0.05, -0.12, y) * sm(1.05, 1.2, z) * 0.5);
        return mul3(lerp3(c, dark, sm(0.35, 0.2, vnoise(x * 5, y * 5, z * 5)) * 0.15 * sm(0.0, 0.3, v)), 1.5);
      },
      finish: { finOpacity: 0.45, coat: 0.4, sheen: 0 },
    });
  },
};
