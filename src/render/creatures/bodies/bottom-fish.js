// Bottom and top dwellers: corydoras, otocinclus and betta. Face +z, centred on the origin.
import { ell, smin, cap, vnoise, hash, cells, fbm, chain, box, sphere, C, lerp3, mul3, mix, clamp01, M } from '../kit.js';

function fish(o) {
  const L = o.len / 2, H = o.h / 2, W = o.w / 2;
  const ts = o.tailScale ?? 1;
  const sdf = (x, y, z) => {
    let d = ell(x, o.flatBelly ? Math.max(y, -H * 0.6) : y, z, W, H, L);
    // Tail fin: a thin, forked fan behind the body.
    const tz = z + L * 1.05;
    const fork = Math.abs(y) - (0.1 + Math.max(0, -tz) * 0.55 * ts);
    const tail = Math.max(ell(x, y, tz + 0.35 * ts, 0.04, H * 1.1 * ts, 0.55 * ts), fork * 0.3 > 0.2 ? fork : -0.01);
    d = smin(d, tail, 0.12);
    // Dorsal, anal and pectoral fins.
    d = smin(d, ell(x, y - H * 0.95, z + L * 0.1, 0.03, H * (o.dorsal ?? 0.5), L * 0.25), 0.08);
    d = smin(d, ell(x, y + H * 0.8, z + L * 0.35, 0.03, H * 0.35, L * 0.25), 0.08);
    for (const s of [-1, 1]) d = smin(d, ell(x - s * W * 0.9, y + H * 0.3, z - L * 0.35, W * 0.6, 0.03, L * 0.18), 0.06);
    // Eyes.
    for (const s of [-1, 1]) d = smin(d, Math.hypot(x - s * W * 0.7, y - H * 0.2, z - L * 0.62) - Math.min(W, H) * 0.3, 0.03);
    return d;
  };
  return {
    sdf, lo: [-W * 2.2, -H * 2 * ts, -L * 2.2 - 0.6 * ts], hi: [W * 2.2, H * 2 * ts, L * 1.3], cell: Math.min(W, H) / 5,
    color: (x, y, z) => (Math.abs(x) > W * 0.45 && Math.hypot(Math.abs(x) - W * 0.7, y - H * 0.2, z - L * 0.62) < Math.min(W, H) * 0.33 ? C(0x080808) : o.color(x, y, z)),
    rig: (x, y, z) => [Math.max(0, Math.min(1, (L - z) / (L * 2 + 0.8 * ts))), 0, 0],
  };
}

export const BOTTOM_FISH = {
  cory: () => fish({ len: 4, h: 1.3, w: 0.9, dorsal: 0.9, flatBelly: true, color: (x, y, z) => (vnoise(x * 3, y * 3, z * 3) > 0.62 ? C(0x3c3a33) : lerp3(C(0x9a8f78), C(0xc9b89a), Math.max(0, -y))) }),
};

BOTTOM_FISH.oto = () => fish({ len: 3, h: 0.7, w: 0.6, flatBelly: true, color: (x, y, z) => (Math.abs(y + 0.05) < 0.1 && z > -1.1 ? C(0x2a2a20) : lerp3(C(0x8a8a5a), C(0xd8d6b0), Math.max(0, -y * 2))) });
BOTTOM_FISH.betta = () => fish({ len: 4.4, h: 1.1, w: 0.6, tailScale: 2.6, dorsal: 1.2, color: (x, y, z) => (z < -0.8 ? lerp3(C(0x1a2fa8), C(0xd0203a), vnoise(x * 3, y * 3, z * 3)) : lerp3(C(0x2a3fc0), C(0x8a1a4a), Math.max(0, y))) });
