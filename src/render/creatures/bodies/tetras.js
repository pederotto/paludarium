// Schooling fish: neon tetra, cardinal tetra, ember tetra and guppy. Face +z, centred on the origin;
// the tail end undulates in the shader (rig.x: 0 at the snout … 1 at the tail tip).
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

export const TETRAS = {
  neon: () => fish({ len: 3.2, h: 0.85, w: 0.5, color: (x, y, z) => {
    const u = y / 0.42, v = z / 1.6;
    if (u > 0.05 && u < 0.4 && v > -0.75) return C(0x2fc2ff);
    if (u < 0.05 && u > -0.6 && v < 0.2 && v > -0.8) return C(0xe3332f);
    if (u >= 0.4) return C(0x6b6a4e);
    return C(0xd8dfe3);
  } }),
  guppy: () => fish({ len: 3, h: 0.8, w: 0.5, tailScale: 1.8, color: (x, y, z) => (z < -1.4 ? (vnoise(x * 5, y * 5, z * 5) > 0.5 ? C(0x3a7ae0) : C(0xff6a1a)) : z < -0.4 ? C(0xff7a2a) : C(0xb7c4c9)) }),
};

TETRAS.cardinal = () => fish({ len: 3.4, h: 0.9, w: 0.5, color: (x, y, z) => {
  const u = y / 0.45;
  if (u > -0.3 && u < 0.28 && z > -1.5) return C(0x2f8fff);
  if (u < -0.05 && u > -0.75) return C(0xe0202a);
  if (u >= 0.28) return C(0x5a5a48);
  return C(0xd8dfe3);
} });
TETRAS.ember = () => fish({ len: 2.2, h: 0.55, w: 0.35, color: (x, y, z) => lerp3(C(0xff6a1a), C(0xffa03a), Math.max(0, Math.min(1, y * 2 + 0.5))) });
