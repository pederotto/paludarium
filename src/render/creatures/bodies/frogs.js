// Frogs and toads. All face +z, feet on y = 0, centimetres.
import { ell, smin, cap, vnoise, C, lerp3, M } from '../kit.js';

// A frog sitting the way frogs sit: body tilted up at the front, the
// front legs straight under the chest, the long back legs folded in a Z
// beside the body (thigh forward, shin back, foot forward again) with
// splayed toes ending in round pads. The back legs unfold in a hop (see
// the vertex shader in CreatureMesh).
function frogBody(o) {
  const k = o.size ?? 1;
  const P = (x, y, z) => [x * k, y * k, z * k];
  const tilt = 0.35, ct = Math.cos(tilt), st = Math.sin(tilt);
  const legs = [];
  for (const s of [-1, 1]) {
    // Front: shoulder, elbow, wrist, then three fingers.
    legs.push({ k: s < 0 ? 1 : 2, chain: [P(s * 0.55, 0.95, 0.62), P(s * 0.85, 0.5, 0.78), P(s * 0.8, 0.12, 1.15)], r: [0.17, 0.14, 0.12].map((v) => v * k),
      toes: [[0.28, 0.3], [0.05, 0.4], [-0.25, 0.28]].map(([dx, dz]) => P(s * (0.8 + dx), 0.07, 1.15 + dz)) });
    // Back: hip, knee (forward and out), ankle (back), toes (forward).
    legs.push({ k: s < 0 ? 3 : 4, chain: [P(s * 0.55, 0.62, -1.15), P(s * 1.38, 0.62, -0.35), P(s * 1.05, 0.2, -1.4), P(s * 1.28, 0.08, -0.45)], r: [0.34, 0.24, 0.17, 0.12].map((v) => v * k),
      toes: [[0.35, 0.55], [0.12, 0.72], [-0.12, 0.62], [-0.3, 0.35]].map(([dx, dz]) => P(s * (1.28 + dx), 0.06, -0.45 + dz)) });
  }
  const legDist = (x, y, z, l) => {
    let d = 9, t = 0;
    const n = l.chain.length - 1;
    for (let i = 0; i < n; i++) {
      const [dd, tt] = cap([x, y, z], l.chain[i], l.chain[i + 1], l.r[i], l.r[i + 1] ?? l.r[i] * 0.8);
      if (dd < d) { d = dd; t = (i + tt) / (n + 0.5); }
    }
    const tip = l.chain[n];
    for (const q of l.toes) {
      const [dd, tt] = cap([x, y, z], tip, q, 0.07 * k, 0.05 * k);
      const pad = Math.hypot(x - q[0], y - q[1], z - q[2]) - 0.1 * k;
      const d2 = Math.min(dd, pad);
      if (d2 < d) { d = d2; t = (n + tt * 0.5) / (n + 0.5); }
    }
    return [d, Math.min(1, t)];
  };
  const bodyD = (x, y, z) => {
    const dy = y - 0.85 * k, dz = z + 0.25 * k;
    let d = ell(x, dy * ct - dz * st, dy * st + dz * ct, 0.9 * k, 0.7 * k, 1.22 * k);
    d = smin(d, ell(x, y - 1.18 * k, z - 0.95 * k, 0.8 * k, 0.52 * k, 0.72 * k), 0.35 * k);
    // Throat and a slightly pointed snout.
    d = smin(d, ell(x, y - 0.95 * k, z - 1.35 * k, 0.45 * k, 0.3 * k, 0.4 * k), 0.2 * k);
    return d;
  };
  const eyes = [-1, 1].map((s) => P(s * 0.53, 1.42, 1.08));
  const sdf = (x, y, z) => {
    let d = bodyD(x, y, z);
    for (const e of eyes) d = smin(d, Math.hypot(x - e[0], y - e[1], z - e[2]) - 0.23 * k, 0.12 * k);
    for (const l of legs) d = smin(d, legDist(x, y, z, l)[0], 0.12 * k);
    return d;
  };
  const whichLeg = (x, y, z) => {
    const b = bodyD(x, y, z);
    let best = 0, bd = b - 0.05 * k, bt = 0;
    for (const l of legs) {
      const [d, t] = legDist(x, y, z, l);
      if (d < bd) { bd = d; best = l.k; bt = t; }
    }
    return [best, bt];
  };
  const isEye = (x, y, z) => eyes.some((e) => Math.hypot(x - e[0], y - e[1], z - e[2]) < 0.26 * k);
  return {
    sdf, lo: P(-2.3, -0.2, -2.2), hi: P(2.3, 2.1, 2.2), cell: 0.075 * k,
    rig: (x, y, z) => {
      const [leg, t] = whichLeg(x, y, z);
      return [Math.max(0, Math.min(1, (1.9 * k - z) / (3.8 * k))), leg, t];
    },
    color: (x, y, z) => {
      if (isEye(x, y, z)) return Math.hypot(x - Math.sign(x) * 0.56 * k, y - 1.55 * k, z - 1.2 * k) < 0.07 * k ? C(0x4a4a4a) : C(0x050505);
      const [leg] = whichLeg(x, y, z);
      return o.color({ x: x / k, y: y / k, z: z / k, leg, belly: y < 0.45 * k && !leg });
    },
  };
}

// Skin patterns: blue dart frog (Dendrobates tinctorius "azureus"),
// strawberry dart frog (Oophaga pumilio, red with "blue jeans" legs) and
// fire-bellied toad (Bombina orientalis).
const azureus = ({ x, y, z, leg, belly }) => {
  const spot = vnoise(x * 4.2 + 3, y * 4.2, z * 4.2) > 0.72 && y > 0.5;
  if (spot) return C(0x03050a);
  if (belly) return C(0x10286e);
  if (leg) return lerp3(C(0x16338c), C(0x2350c4), Math.min(1, y));
  return lerp3(C(0x1f4fc8), C(0x4f8cf5), Math.max(0, Math.min(1, (y - 0.8) * 1.2)));
};
const pumilio = ({ x, y, z, leg, belly }) => {
  if (leg) return lerp3(C(0x16288a), C(0x2d4fc4), Math.min(1, y * 1.2));
  const fleck = vnoise(x * 5, y * 5, z * 5) > 0.74;
  if (belly) return C(0xb3261e);
  return fleck ? C(0x3a0a08) : lerp3(C(0xc41f16), C(0xf0402a), Math.max(0, Math.min(1, (y - 0.7))));
};
const bombina = ({ x, y, z, leg, belly }) => {
  if (belly || (leg && y < 0.18)) return vnoise(x * 3, y * 3, z * 3) > 0.62 ? C(0x111111) : C(0xf2641a);
  const blotch = vnoise(x * 2.2, y * 2.2, z * 2.2) > 0.66;
  const wart = vnoise(x * 7, y * 7, z * 7) > 0.72;
  return blotch ? C(0x0f1a08) : wart ? C(0x2b4d17) : lerp3(C(0x3f7a26), C(0x6aa83a), vnoise(x, y, z));
};

export const FROGS = {
  dartfrog: () => frogBody({ size: 1, color: azureus }),
  strawberry: () => frogBody({ size: 0.72, color: pumilio }),
  toad: () => frogBody({ size: 1.3, color: bombina }),
};

// New species share the frog body with their own skin pattern (refined by the frog modelling pass).
const leucomelas = ({ x, y, z, leg, belly }) => {
  if (belly) return C(0x1a1a1a);
  const band = Math.sin(z * 2.6) > 0.15 || (leg && y > 0.3);
  return band ? C(0xf2c81a) : C(0x0c0c0c);
};
const auratus = ({ x, y, z, leg, belly }) => {
  if (belly) return C(0x142018);
  const patch = vnoise(x * 2.4 + 5, y * 2.4, z * 2.4) > 0.5;
  return patch ? lerp3(C(0x3fd07a), C(0x9fe04a), vnoise(x, y, z)) : C(0x0a0a0a);
};
FROGS.leucomelas = () => frogBody({ size: 1.1, color: leucomelas });
FROGS.auratus = () => frogBody({ size: 1.05, color: auratus });

// Larvae and eggs (owned by the frog pass).
Object.assign(FROGS, {
  tadpole: () => ({
    sdf: (x, y, z) => smin(ell(x, y, z - 0.35, 0.42, 0.36, 0.5), Math.min(ell(x, y, z + 0.8, 0.06, 0.3, 0.8), cap([x, y, z], [0, 0, 0], [0, 0, -1.4], 0.14, 0.02)[0]), 0.2),
    lo: [-0.7, -0.6, -1.8], hi: [0.7, 0.6, 1.0], cell: 0.05,
    color: (x, y, z) => (z < -0.1 ? C(0x5a5040) : Math.abs(x) > 0.25 && z > 0.6 && y > 0.05 ? C(0x080808) : lerp3(C(0x2e2a22), C(0x4a4032), vnoise(x * 6, y * 6, z * 6))),
    rig: (x, y, z) => [Math.max(0, Math.min(1, (0.85 - z) / 2.25)), 0, 0],
  }),
  eggs: () => {
    const pts = Array.from({ length: 14 }, (_, i) => [Math.sin(i * 2.4) * (0.3 + (i % 3) * 0.35), 0.25 + (i % 4) * 0.22, Math.cos(i * 2.4) * (0.3 + (i % 3) * 0.35)]);
    return {
      sdf: (x, y, z) => { let d = 9; for (const [a, b, c] of pts) d = smin(d, Math.hypot(x - a, y - b, z - c) - 0.3, 0.12); return d; },
      lo: [-1.4, -0.2, -1.4], hi: [1.4, 1.4, 1.4], cell: 0.07,
      color: (x, y, z) => { let dm = 9; for (const [a, b, c] of pts) dm = Math.min(dm, Math.hypot(x - a, y - b, z - c)); return dm < 0.14 ? C(0x1a1a14) : C(0xd8dcc8); },
    };
  },
});
