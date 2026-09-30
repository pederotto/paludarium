// Springtails, flies and the trumpet snail. Face +z.
import { ell, smin, smax, cap, chain, box, sphere, vnoise, hash, cells, fbm, C, lerp3, mul3, mix, clamp01, M } from '../kit.js';

export const SMALL = {
  snail: () => ({
    sdf: (x, y, z) => {
      let d = ell(x, y - 0.3, z - 0.3, 0.32, 0.26, 0.85);
      d = smin(d, ell(x, y - 0.8, z + 0.25, 0.42, 0.55, 0.5), 0.25);
      d = smin(d, ell(x, y - 1.15, z + 0.3, 0.26, 0.4, 0.3), 0.2);
      return d;
    },
    lo: [-0.9, -0.1, -0.9], hi: [0.9, 1.7, 1.5], cell: 0.05,
    color: (x, y, z) => (y > 0.5 ? lerp3(C(0x6a5030), C(0xc9a86a), Math.sin(Math.atan2(x, z + 0.3) * 3 + y * 9) * 0.5 + 0.5) : lerp3(C(0x8a8064), C(0xb0a482), vnoise(x * 4, y * 4, z * 4))),
    mat: (x, y, z) => (y > 0.5 ? M.CHITIN : M.SKIN),
    rig: (x, y, z) => [Math.max(0, Math.min(1, (0.9 - z) / 1.8)), 0, 0],
  }),
};
