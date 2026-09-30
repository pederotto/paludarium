// Springtails, flies and the trumpet snail. Face +z.
import { ell, smin, smax, cap, chain, box, sphere, vnoise, hash, cells, fbm, C, lerp3, mul3, mix, clamp01, M } from '../kit.js';

const PI = Math.PI, TAU = Math.PI * 2;
const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const fract = (v) => v - Math.floor(v);

// ---------------------------------------------------------------------------------
// Malaysian trumpet snail (Melanoides tuberculata), ~2.5 cm. A tall turreted shell of
// nine whorls, cocked up and back over the foot, with the soft body reaching forward.
// ---------------------------------------------------------------------------------
function snail() {
  // Shell frame: A points from the aperture to the apex and leans back, E1 is the
  // animal's right, E2 = A x E1 completes a right-handed set (the shell is dextral).
  const AL = 50 * PI / 180, sa = Math.sin(AL), ca = Math.cos(AL);
  const O = [0.0, 0.5, 0.0];                       // centre of the shell's mouth
  const GAM = 18 * PI / 180, BETA = AL - GAM;      // the mouth looks forward and a little down
  const nrm = [0, -Math.sin(GAM), Math.cos(GAM)];
  const Lc = 2.55, Rb = 0.4, Ut = 2.34;            // cone length, base radius, apex position (cm)
  const P0 = 0.62, P1 = 0.54;                      // whorl pitch: P0 at the mouth, shrinking up the spire
  const N_RIB = 15;

  const R = (u) => {
    const uu = Math.max(u, 0);
    return Rb * Math.pow(Math.max(1 - uu / Lc, 0.01), 0.94) * (1 + 0.13 * Math.exp(-(((uu - 0.4) / 0.4) ** 2)));
  };
  const turns = (u) => -(Lc / P1) * Math.log((P0 - (P1 * Math.max(u, -0.4)) / Lc) / P0);   // whorls counted up the spire

  // Shell surface in shell coordinates: returns [distance, whorl phase s, rib phase, radius, u].
  const frame = (x, y, z) => {
    const qx = x - O[0], qy = y - O[1], qz = z - O[2];
    const u = qy * sa - qz * ca, b = -qy * ca - qz * sa;
    return [qx, b, u];
  };
  const shellD = (x, y, z) => {
    const [a, b, u] = frame(x, y, z);
    const rho = Math.hypot(a, b);
    const uu = Math.min(u, Ut);
    const Re = R(uu);
    const phi = Math.atan2(b, a);
    const w = turns(uu) - phi / TAU;
    const s = fract(w);
    const hump = Math.pow(Math.sin(PI * s), 0.55);
    const fade = smoothstep(0.25, 0.8, uu) * smoothstep(0.05, 0.16, Re);
    const rib = 0.5 + 0.5 * Math.cos(TAU * (N_RIB * phi / TAU + 0.8 * s));
    const cord = 0.5 + 0.5 * Math.cos(TAU * 3 * s);
    const ribF = smoothstep(0.1, 0.25, Re);
    const r = Re * (1 - 0.15 * fade * (1 - hump) + ribF * 0.035 * (rib - 0.5) * hump + 0.02 * (cord - 0.5) * hump);
    let d = (rho - r) * 0.8;
    d = smax(d, u - Ut, 0.04);
    // The mouth: cut by a plane that faces forward, then hollowed so the neck sits inside a rim.
    const dpl = -u * Math.cos(BETA) - b * Math.sin(BETA);
    d = smax(d, dpl, 0.05);
    return d;
  };
  const bodyD = (x, y, z) => {
    // Foot and trunk: low, with a flat sole and a tapering tail.
    let d = ell(x, y - 0.17, z + 0.1, 0.27, 0.19, 0.95);
    d = smin(d, ell(x, y - 0.2, z - 0.95, 0.2, 0.17, 0.3), 0.18);
    d = smin(d, cap([x, y, z], [0, 0.13, -0.6], [0, 0.06, -1.15], 0.17, 0.02)[0], 0.15);
    d = smax(d, -y, 0.04);
    // Neck rising into the shell's mouth.
    d = smin(d, cap([x, y, z], [0, 0.42, 0.28], [0, 0.34, 0.75], 0.31, 0.24)[0], 0.15);
    for (const s of [-1, 1]) {
      d = smin(d, cap([x, y, z], [s * 0.1, 0.3, 1.1], [s * 0.19, 0.42, 1.62], 0.05, 0.026)[0], 0.05);
      d = smin(d, sphere(x, y, z, s * 0.17, 0.3, 1.13, 0.05), 0.04);
    }
    return d;
  };
  const sdf = (x, y, z) => smin(shellD(x, y, z), bodyD(x, y, z), 0.05);

  const shellColor = (x, y, z) => {
    const [a, b, u] = frame(x, y, z);
    const uu = Math.min(u, Ut), phi = Math.atan2(b, a);
    const w = turns(uu) - phi / TAU, s = fract(w);
    const rib = 0.5 + 0.5 * Math.cos(TAU * (N_RIB * phi / TAU + 0.8 * s));
    let c = lerp3(C(0xb59a66), C(0xd2b984), 0.5 + 0.5 * Math.sin(TAU * s * 2));
    const dash = smoothstep(0.25, 0.75, rib);
    const band = (c0, wd) => smoothstep(wd, 0, Math.abs(s - c0));
    const bands = Math.max(band(0.42, 0.13) * (0.45 + 0.55 * dash), band(0.78, 0.09) * (0.3 + 0.7 * dash));
    c = lerp3(c, C(0x4b2a16), clamp01(bands));
    c = lerp3(c, C(0x33200f), smoothstep(0.12, 0.02, Math.min(s, 1 - s)) * 0.9);
    c = lerp3(c, C(0x5d4b38), smoothstep(1.75, 2.3, uu));
    return c;
  };
  const skinColor = (x, y, z) => {
    const belly = smoothstep(0.16, 0.02, y);
    let c = lerp3(C(0x9a9384), C(0xb9b1a0), belly);
    c = lerp3(c, C(0x6d675b), smoothstep(0.85, 1.4, z) * 0.5);
    return c;
  };
  return {
    sdf,
    lo: [-0.75, -0.06, -1.6], hi: [0.75, 2.55, 1.9], cell: 0.04, hiScale: 0.5,
    color: (x, y, z) => (shellD(x, y, z) < bodyD(x, y, z) ? shellColor(x, y, z) : skinColor(x, y, z)),
    mat: (x, y, z) => (shellD(x, y, z) < bodyD(x, y, z) ? M.CHITIN : M.SKIN),
    rig: (x, y, z) => [clamp01((1.4 - z) / 2.6), 0, 0],
    finish: { rough: 0.5, coat: 0.7, coatRough: 0.1, grain: 45, bump: 0.05, tone: 0.03 },
  };
}

export const SMALL = { snail };
