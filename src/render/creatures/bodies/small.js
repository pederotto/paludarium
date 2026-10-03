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
    // Colour blends across the seam; the two materials are neighbours in the id list (4 and 5), because ids are
    // interpolated across triangles and skin (0) to chitin (4) would pass through the eye, fin and film materials.
    color: (x, y, z) => {
      const t = smoothstep(-0.05, 0.05, bodyD(x, y, z) - shellD(x, y, z));
      return t >= 1 ? shellColor(x, y, z) : t <= 0 ? skinColor(x, y, z) : lerp3(skinColor(x, y, z), shellColor(x, y, z), t);
    },
    mat: (x, y, z) => (shellD(x, y, z) < bodyD(x, y, z) ? M.CHITIN : M.GLOSS),
    rig: (x, y, z) => [clamp01((1.4 - z) / 2.6), 0, 0],
    finish: { rough: 0.5, coat: 0.7, coatRough: 0.1, grain: 45, bump: 0.05, tone: 0.03 },
  };
}

// ---------------------------------------------------------------------------------
// Helpers for the insects
// ---------------------------------------------------------------------------------
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
// Orthonormal frame [u, n, w]: u along `dir`, n as close to `hint` as it can be.
const frameOf = (dir, hint) => { const u = norm(dir), w = norm(cross(hint, u)); return [u, cross(u, w), w]; };
// Ellipsoid with radii (a, b, c) along the frame's u, n, w axes, centred at c0.
const oell = (x, y, z, c0, F, a, b, c) => {
  const dx = x - c0[0], dy = y - c0[1], dz = z - c0[2];
  return ell(dx * F[0][0] + dy * F[0][1] + dz * F[0][2], dx * F[1][0] + dy * F[1][1] + dz * F[1][2], dx * F[2][0] + dy * F[2][1] + dz * F[2][2], a, b, c);
};
// Six legs as chains: [id, points, radii]. Ids follow the rig: 1 / 2 front-left / right, 3 / 4 back-left / right;
// the middle legs take 3 / 4 and the hind legs 1 / 2 so that the tripods (1, 4, 1) and (2, 3, 2) alternate.
const sixLegs = (pts, radii) => {
  const out = [];
  pts.forEach((P, k) => {
    for (const s of [-1, 1]) out.push({ id: s < 0 ? [1, 3, 1][k] : [2, 4, 2][k], pts: P(s), radii });
  });
  return out;
};
// The leg nearest to a point: [id, legT] with legT ramped along the leg and scaled by `amp`,
// because the rig's default stride and lift are in centimetres and these animals are a few millimetres long.
const legRig = (legs, x, y, z, dBody, amp) => {
  let best = 1e9, id = 0, t = 0;
  for (const l of legs) { const [d, tt] = chain([x, y, z], l.pts, l.radii); if (d < best) { best = d; id = l.id; t = tt; } }
  return best < dBody ? [id, clamp01((t - 0.2) / 0.8) * amp] : [0, 0];
};

// ---------------------------------------------------------------------------------
// Springtail (Collembola, ~0.25 cm): a cream-white segmented body, a rounded head with
// dark eye spots, short antennae, six legs and the furcula folded under the abdomen.
// ---------------------------------------------------------------------------------
// Springtail colours: the tropical white (Folsomia candida, default), the tropical pink (Pseudosinella sp.) and the blue-grey
// seashore springtail of the water's surface film (Anurida maritima type).
const SPRING_PAL = { white: [0xf0e8d2, 0xd8d1bd, 0xe2d9c4, 0xcfc6ae], pink: [0xf2b8b0, 0xe0a49c, 0xeaaaa2, 0xd8968e], sea: [0x5d6f8c, 0x4a5873, 0x55667f, 0x48566c] };
function springtail(pal = 'white') {
  const SP = SPRING_PAL[pal];
  const Y0 = 0.055;
  const R = [0.034, 0.036, 0.039, 0.041, 0.042, 0.042, 0.041, 0.038, 0.033, 0.026];   // head, 3 thorax, 6 abdomen segments
  const Z = R.map((_, i) => 0.10 - i * 0.022), RZ = 0.017;
  const legs = sixLegs([
    (s) => [[s * 0.02, 0.043, 0.078], [s * 0.055, 0.052, 0.09], [s * 0.068, 0.005, 0.104]],
    (s) => [[s * 0.02, 0.043, 0.056], [s * 0.057, 0.052, 0.056], [s * 0.072, 0.005, 0.056]],
    (s) => [[s * 0.02, 0.043, 0.034], [s * 0.055, 0.052, 0.02], [s * 0.068, 0.005, 0.008]],
  ], [0.0085, 0.0065, 0.0055]);
  const feelers = [-1, 1].map((s) => ({ pts: [[s * 0.014, 0.066, 0.12], [s * 0.028, 0.078, 0.15], [s * 0.036, 0.075, 0.172]], radii: [0.008, 0.0065, 0.0055] }));
  const furcula = { pts: [[0, 0.022, -0.07], [0, 0.012, -0.02], [0, 0.010, 0.008]], radii: [0.010, 0.008, 0.0065] };
  const tines = [-1, 1].map((s) => ({ pts: [[0, 0.010, 0.008], [s * 0.012, 0.009, 0.03]], radii: [0.0065, 0.0055] }));
  const bodyD = (x, y, z) => {
    let d = 1e9;
    for (let i = 0; i < 10; i++) {
      if (Math.abs(z - Z[i]) > 0.06) continue;
      const e = ell(x, y - Y0, z - Z[i], R[i], R[i] * 0.95, RZ + (i === 0 ? 0.01 : 0));
      d = d > 1e8 ? e : smin(d, e, 0.006);
    }
    return d;
  };
  const limbD = (x, y, z) => {
    let d = 1e9;
    for (const l of legs) d = Math.min(d, chain([x, y, z], l.pts, l.radii)[0]);
    for (const a of feelers) d = Math.min(d, chain([x, y, z], a.pts, a.radii)[0]);
    d = Math.min(d, chain([x, y, z], furcula.pts, furcula.radii)[0]);
    for (const t of tines) d = Math.min(d, chain([x, y, z], t.pts, t.radii)[0]);
    return d;
  };
  const CREAM = C(SP[0]), LEG = C(SP[1]), EYE = C(0x2b2932), HEAD = C(SP[2]), FURC = C(SP[3]);
  return {
    sdf: (x, y, z) => smin(bodyD(x, y, z), limbD(x, y, z), 0.008),
    lo: [-0.1, -0.02, -0.15], hi: [0.1, 0.13, 0.22], cell: 0.006, hiScale: 0.5,
    color: (x, y, z) => {
      const db = bodyD(x, y, z), dl = limbD(x, y, z);
      if (dl < db - 0.002) return z < 0.0 && y < 0.04 && Math.abs(x) < 0.02 ? FURC : LEG;
      const groove = 0.5 + 0.5 * Math.cos(TAU * (0.10 - z) / 0.022);
      let c = lerp3(CREAM, HEAD, smoothstep(0.085, 0.11, z) * 0.7);
      c = mul3(c, 0.9 + 0.1 * groove);
      // eye spots on the sides of the head
      const de = Math.hypot((Math.abs(x) - 0.03) * 1.3, (y - Y0 - 0.006) * 1.3, z - 0.108);
      return lerp3(c, EYE, smoothstep(0.014, 0.006, de) * 0.9);
    },
    mat: () => M.SKIN,
    rig: (x, y, z) => { const [id, t] = legRig(legs, x, y, z, bodyD(x, y, z), 0.1); return [clamp01((0.13 - z) / 0.245), id, t]; },
    finish: { rough: 0.5, coat: 0.25, coatRough: 0.3, grain: 0.6, bump: 0.004, tone: 0.01 },
  };
}

// ---------------------------------------------------------------------------------
// Fruit fly (Drosophila melanogaster, ~0.3 cm): dominant red compound eyes, a tan thorax,
// a banded abdomen, six legs and translucent wings folded back over the abdomen.
// ---------------------------------------------------------------------------------
function fly() {
  const legs = sixLegs([
    (s) => [[s * 0.022, 0.108, 0.06], [s * 0.072, 0.098, 0.095], [s * 0.088, 0.045, 0.125], [s * 0.092, 0.006, 0.15]],
    (s) => [[s * 0.026, 0.104, 0.012], [s * 0.085, 0.10, 0.016], [s * 0.108, 0.045, 0.0], [s * 0.115, 0.006, -0.004]],
    (s) => [[s * 0.024, 0.104, -0.035], [s * 0.07, 0.095, -0.07], [s * 0.09, 0.05, -0.12], [s * 0.095, 0.006, -0.15]],
  ], [0.011, 0.009, 0.0075, 0.0065]);
  const wings = [-1, 1].map((s) => {
    const u = norm([s * 0.24, -0.11, -1]), base = [s * 0.03, 0.19, 0.03];
    return { C: [base[0] + u[0] * 0.11, base[1] + u[1] * 0.11, base[2] + u[2] * 0.11], F: frameOf(u, [s * 0.3, 1, 0]) };
  });
  const headD = (x, y, z) => ell(x, y - 0.135, z - 0.105, 0.044, 0.045, 0.04);
  const eyeD = (x, y, z) => Math.min(ell(x - 0.041, y - 0.14, z - 0.113, 0.034, 0.044, 0.042), ell(x + 0.041, y - 0.14, z - 0.113, 0.034, 0.044, 0.042));
  const thoraxD = (x, y, z) => ell(x, y - 0.15, z - 0.02, 0.055, 0.06, 0.078);
  const abdD = (x, y, z) => ell(x, y - 0.135, z + 0.085, 0.05, 0.047, 0.088);
  const wingD = (x, y, z) => Math.min(oell(x, y, z, wings[0].C, wings[0].F, 0.115, 0.007, 0.045), oell(x, y, z, wings[1].C, wings[1].F, 0.115, 0.007, 0.045));
  const legD = (x, y, z) => { let d = 1e9; for (const l of legs) d = Math.min(d, chain([x, y, z], l.pts, l.radii)[0]); return d; };
  const nubD = (x, y, z) => Math.hypot(Math.abs(x) - 0.014, y - 0.163, z - 0.148) - 0.012;
  const bodyD = (x, y, z) => {
    let d = smin(headD(x, y, z), eyeD(x, y, z), 0.014);
    d = smin(d, thoraxD(x, y, z), 0.015);
    d = smin(d, abdD(x, y, z), 0.012);
    return smin(d, nubD(x, y, z), 0.006);
  };
  const TAN = C(0xc9a25e), THORAX = C(0xb98a48), ABD = C(0xd3ac68), BAND = C(0x2d2117), RED = C(0xa4131a), WING = C(0xcfd6d9), LEGC = C(0xb59d6c), FOOT = C(0x6e5a3a), HEADC = C(0xc0995a);
  const part = (x, y, z) => {
    const p = [[bodyD(x, y, z), 'body'], [wingD(x, y, z), 'wing'], [legD(x, y, z), 'leg']];
    p.sort((a, b) => a[0] - b[0]);
    return p[0][1];
  };
  return {
    sdf: (x, y, z) => smin(Math.min(bodyD(x, y, z), wingD(x, y, z)), legD(x, y, z), 0.012),
    lo: [-0.2, -0.03, -0.32], hi: [0.2, 0.26, 0.22], cell: 0.008, hiScale: 0.5,
    color: (x, y, z) => {
      const dw = wingD(x, y, z), dl = legD(x, y, z), db = bodyD(x, y, z);
      if (dw < db && dw < dl) return lerp3(WING, C(0x9a8e78), smoothstep(0.02, -0.02, y - 0.19) * 0.0 + 0.08 * hash(x * 90, 1, z * 90));
      if (dl < db - 0.002) return lerp3(LEGC, FOOT, smoothstep(0.02, 0.0, y));
      const de = eyeD(x, y, z), dh = headD(x, y, z), dt = thoraxD(x, y, z), da = abdD(x, y, z);
      if (de < dh && de < dt && de < da) return mul3(RED, 0.85 + 0.3 * vnoise(x * 70, y * 70, z * 70));
      if (dh < dt && dh < da) return HEADC;
      if (dt < da) return lerp3(THORAX, mul3(THORAX, 0.7), smoothstep(-0.03, -0.06, z) * 0.6 + 0.25 * smoothstep(0.02, 0.0, Math.abs(Math.abs(x) - 0.02)));
      // abdomen: the hind edge of every segment is a dark band, the belly stays pale, the last segments are dark
      const f = fract((z + 0.17) / 0.034), top = smoothstep(0.1, 0.16, y);
      const band = smoothstep(0.55, 0.7, f) * top;
      return lerp3(lerp3(ABD, C(0xe6d6a8), smoothstep(0.13, 0.09, y)), BAND, Math.max(band * 0.85, smoothstep(-0.12, -0.15, z) * 0.9));
    },
    mat: (x, y, z) => {
      const p = part(x, y, z);
      // ids 4, 5 and 7 are used because they are close together: ids are interpolated across triangles, so
      // skin (0) next to a wing (2) or a glossy eye (5) would flash through the black eye material (1).
      if (p === 'wing') return M.TRANSLUCENT;
      if (p === 'body' && eyeD(x, y, z) < Math.min(headD(x, y, z), thoraxD(x, y, z), abdD(x, y, z))) return M.GLOSS;
      return M.CHITIN;
    },
    rig: (x, y, z) => { const [id, t] = legRig(legs, x, y, z, Math.min(bodyD(x, y, z), wingD(x, y, z)), 0.1); return [clamp01((0.16 - z) / 0.33), id, t]; },
    finish: { rough: 0.45, coat: 0.3, coatRough: 0.3, grain: 0.6, bump: 0.004, tone: 0.01, glassOpacity: 0.45 },
  };
}

// ---------------------------------------------------------------------------------
// Fruit fly maggot (the larva, ~0.3 cm): a cream, tapered, legless body of eleven soft
// segments, blunt at the tail and narrowing to the head, with a pair of dark mouth hooks
// and two dark breathing spots at the tail. The spine wave makes it wriggle.
// ---------------------------------------------------------------------------------
function flylarva() {
  const Y0 = 0.05, ZC = 0.0, H = 0.15, RMAX = 0.046, NSEG = 11;
  const profile = (z) => {
    const t = clamp01((z - ZC + H) / (2 * H));                   // 0 at the tail, 1 at the head
    const tt = (z - ZC) / H;
    const env = Math.pow(Math.max(1 - tt * tt, 0), 0.3);        // blunt, rounded ends
    const taper = mix(1.0, 0.36, smoothstep(0.35, 1.0, t));      // narrows toward the head
    const seg = 0.5 + 0.5 * Math.cos(TAU * t * NSEG);             // 1 at the middle of a segment, 0 in the groove
    return RMAX * env * taper * (0.93 + 0.07 * seg);
  };
  const bodyD = (x, y, z) => {
    const rho = Math.hypot(x, (y - Y0) * 1.08);
    let d = (rho - profile(z)) * 0.85;
    d = smax(d, Math.abs(z - ZC) - H, 0.012);
    return smax(d, -y + 0.004, 0.02);                              // a flattish belly that rests on the ground
  };
  const hookD = (x, y, z) => {
    let d = 1e9;
    for (const s of [-1, 1]) d = Math.min(d, cap([x, y, z], [s * 0.006, Y0 - 0.004, 0.138], [s * 0.008, Y0 - 0.012, 0.157], 0.0048, 0.0028)[0]);
    return d;
  };
  const spiracleD = (x, y, z) => Math.min(Math.hypot(x - 0.013, (y - Y0 - 0.02) * 1.4, z + 0.143), Math.hypot(x + 0.013, (y - Y0 - 0.02) * 1.4, z + 0.143)) - 0.0055;
  const CREAM = C(0xf2e8c8), GUT = C(0xd9c690), DARK = C(0x2a1f18);
  return {
    sdf: (x, y, z) => smin(smin(bodyD(x, y, z), hookD(x, y, z), 0.006), spiracleD(x, y, z), 0.004),
    lo: [-0.08, -0.02, -0.19], hi: [0.08, 0.11, 0.2], cell: 0.006, hiScale: 0.5,
    color: (x, y, z) => {
      if (hookD(x, y, z) < bodyD(x, y, z) - 0.001) return DARK;
      if (spiracleD(x, y, z) < bodyD(x, y, z) - 0.001) return C(0x6b4a2a);
      const t = clamp01((z + H) / (2 * H));
      const groove = 0.5 + 0.5 * Math.cos(TAU * t * NSEG);
      let c = lerp3(CREAM, GUT, smoothstep(0.1, 0.17, y) * 0.55 * smoothstep(0.05, 0.3, t) * (1 - smoothstep(0.7, 0.95, t)));   // gut shows through the back
      c = mul3(c, 0.88 + 0.12 * groove);
      return lerp3(c, C(0xb69e6c), smoothstep(0.82, 0.98, t) * 0.55);                                             // the head is a little darker
    },
    mat: () => M.SKIN,
    rig: (x, y, z) => [clamp01((H - z) / (2 * H)), 0, 0],
    finish: { rough: 0.5, coat: 0.45, coatRough: 0.25, grain: 0.5, bump: 0.003, tone: 0.01 },
  };
}

// ---------------------------------------------------------------------------------
// Fruit fly pupa (the puparium, ~0.25 cm): the hardened last larval skin, an amber-brown
// barrel with the old segment ridges and two tiny horns at the front. Stuck still to a wall or a leaf.
// ---------------------------------------------------------------------------------
function flypupa() {
  const Y0 = 0.048, H = 0.12, RM = 0.052, NSEG = 9;
  const bodyD = (x, y, z) => {
    const t = clamp01((z + H) / (2 * H)), tt = z / H;
    const env = Math.pow(Math.max(1 - tt * tt, 0), 0.22);
    const ridge = 0.5 + 0.5 * Math.cos(TAU * t * NSEG);
    const r = RM * env * (0.94 + 0.06 * ridge) * mix(1.0, 0.86, t);
    const rho = Math.hypot(x, (y - Y0) * 1.05);
    return smax(smax((rho - r) * 0.85, Math.abs(z) - H, 0.012), -y + 0.004, 0.02);
  };
  const hornD = (x, y, z) => {
    let d = 1e9;
    for (const s of [-1, 1]) d = Math.min(d, cap([x, y, z], [s * 0.013, Y0 + 0.03, H - 0.016], [s * 0.017, Y0 + 0.042, H - 0.002], 0.0055, 0.0035)[0]);
    return d;
  };
  const AMBER = C(0xa2692a), DEEP = C(0x6a3a17), PALE = C(0xc9923f);
  return {
    sdf: (x, y, z) => smin(bodyD(x, y, z), hornD(x, y, z), 0.006),
    lo: [-0.09, -0.02, -0.15], hi: [0.09, 0.12, 0.17], cell: 0.006, hiScale: 0.5,
    color: (x, y, z) => {
      if (hornD(x, y, z) < bodyD(x, y, z) - 0.001) return PALE;
      const t = clamp01((z + H) / (2 * H));
      const ridge = 0.5 + 0.5 * Math.cos(TAU * t * NSEG);
      let c = lerp3(DEEP, AMBER, 0.45 + 0.4 * ridge);
      c = lerp3(c, PALE, smoothstep(0.1, 0.2, y - Y0) * 0.35 + smoothstep(0.88, 1.0, t) * 0.3);
      return mul3(c, 0.92 + 0.16 * vnoise(x * 55, y * 55, z * 55));
    },
    mat: () => M.CHITIN,
    rig: () => [0, 0, 0],
    finish: { rough: 0.55, coat: 0.3, coatRough: 0.3, grain: 0.7, bump: 0.004, tone: 0.01 },
  };
}

// ---------------------------------------------------------------------------------
// Feeders (2026-10). Banded cricket (Gryllodes sigillatus, a ~1.4 cm feeder): a round head with a dark band between the eyes,
// a boxy pronotum, a soft banded abdomen with two cerci, long antennae, and big jumping hind legs.
// ---------------------------------------------------------------------------------
function cricket() {
  const legs = [
    { id: 1, pts: (s) => [[s * 0.1, 0.17, 0.36], [s * 0.24, 0.2, 0.46], [s * 0.3, 0.02, 0.56]], radii: [0.045, 0.035, 0.028] },
    { id: 3, pts: (s) => [[s * 0.12, 0.16, 0.18], [s * 0.3, 0.2, 0.16], [s * 0.38, 0.02, 0.1]], radii: [0.045, 0.035, 0.028] },
    // The hind leg: a thick femur raised along the body, the tibia folded back down to the ground.
    { id: 1, pts: (s) => [[s * 0.13, 0.15, 0.02], [s * 0.24, 0.34, -0.3], [s * 0.27, 0.12, -0.58], [s * 0.3, 0.02, -0.66]], radii: [0.075, 0.06, 0.03, 0.025] },
  ].flatMap((l) => [-1, 1].map((s) => ({ id: s < 0 ? l.id : l.id + 1, pts: l.pts(s), radii: l.radii })));
  const ants = [-1, 1].map((s) => ({ pts: [[s * 0.07, 0.3, 0.6], [s * 0.2, 0.42, 0.95], [s * 0.4, 0.4, 1.3], [s * 0.55, 0.3, 1.55]], radii: [0.032, 0.028, 0.025, 0.022] }));
  const cerci = [-1, 1].map((s) => ({ pts: [[s * 0.05, 0.2, -0.55], [s * 0.12, 0.22, -0.85]], radii: [0.026, 0.018] }));
  const headD = (x, y, z) => ell(x, y - 0.22, z - 0.5, 0.15, 0.16, 0.13);
  const eyeD = (x, y, z) => Math.hypot(Math.abs(x) - 0.12, y - 0.29, z - 0.53) - 0.05;
  const thoD = (x, y, z) => ell(x, y - 0.22, z - 0.3, 0.17, 0.14, 0.14);
  const abdD = (x, y, z) => ell(x, y - 0.21, z + 0.15, 0.17 - Math.max(0, -z - 0.1) * 0.12, 0.15, 0.43);
  const bodyD = (x, y, z) => smin(smin(smin(headD(x, y, z), eyeD(x, y, z), 0.02), thoD(x, y, z), 0.04), abdD(x, y, z), 0.05);
  const limbD = (x, y, z) => {
    let d = 1e9;
    for (const l of legs) d = Math.min(d, chain([x, y, z], l.pts, l.radii)[0]);
    for (const a of ants) d = Math.min(d, chain([x, y, z], a.pts, a.radii)[0]);
    for (const c of cerci) d = Math.min(d, chain([x, y, z], c.pts, c.radii)[0]);
    return d;
  };
  const TAN = C(0xb08752), DARK = C(0x3a2a1a), PALE = C(0xd2b282), LEG = C(0xa07a4a);
  return {
    sdf: (x, y, z) => smin(bodyD(x, y, z), limbD(x, y, z), 0.02),
    lo: [-0.62, -0.03, -0.92], hi: [0.62, 0.5, 1.6], cell: 0.034, hiScale: 0.6,
    color: (x, y, z) => {
      const db = bodyD(x, y, z), dl = limbD(x, y, z);
      if (dl < db - 0.004) return lerp3(LEG, DARK, smoothstep(0.7, 1.2, z) * 0.6);
      if (eyeD(x, y, z) < headD(x, y, z) + 0.004) return C(0x16100c);
      if (headD(x, y, z) < thoD(x, y, z)) return lerp3(TAN, DARK, smoothstep(0.06, 0.02, Math.abs(z - 0.55)) * smoothstep(0.3, 0.36, y) * 0.9);   // the band between the eyes
      if (thoD(x, y, z) < abdD(x, y, z)) return lerp3(TAN, DARK, smoothstep(0.02, 0.1, Math.abs(x) - 0.06) * 0.5);
      const f = fract((z + 0.6) / 0.11), top = smoothstep(0.24, 0.32, y);
      return lerp3(lerp3(PALE, TAN, top), DARK, smoothstep(0.6, 0.85, f) * top * 0.75);
    },
    mat: (x, y, z) => (eyeD(x, y, z) < headD(x, y, z) ? M.GLOSS : M.CHITIN),
    rig: (x, y, z) => { const [id, t] = legRig(legs, x, y, z, bodyD(x, y, z), 0.5); return [clamp01((0.6 - z) / 1.4), id, t]; },
    finish: { rough: 0.5, coat: 0.35, coatRough: 0.3, grain: 0.6, bump: 0.01, tone: 0.02 },
  };
}

// ---------------------------------------------------------------------------------
// Dubia roach nymph (Blaptica dubia, ~1.5 cm): a flat, rounded, dark-brown oval of overlapping plates with pale edges, the
// small head tucked under the front, short antennae and six short spiny legs.
// ---------------------------------------------------------------------------------
function dubia() {
  const legs = sixLegs([
    (s) => [[s * 0.22, 0.08, 0.38], [s * 0.42, 0.08, 0.5], [s * 0.5, 0.01, 0.6]],
    (s) => [[s * 0.25, 0.08, 0.05], [s * 0.5, 0.08, 0.06], [s * 0.6, 0.01, 0.0]],
    (s) => [[s * 0.22, 0.08, -0.3], [s * 0.46, 0.08, -0.48], [s * 0.54, 0.01, -0.66]],
  ], [0.045, 0.035, 0.028]);
  const ants = [-1, 1].map((s) => ({ pts: [[s * 0.06, 0.1, 0.72], [s * 0.2, 0.12, 0.95], [s * 0.34, 0.08, 1.1]], radii: [0.025, 0.02, 0.018] }));
  const shellD = (x, y, z) => smax(ell(x, y - 0.1, z, 0.48, 0.17, 0.72), -y + 0.03, 0.03);
  const headD = (x, y, z) => ell(x, y - 0.08, z - 0.66, 0.16, 0.08, 0.1);
  const bodyD = (x, y, z) => smin(shellD(x, y, z), headD(x, y, z), 0.04);
  const limbD = (x, y, z) => { let d = 1e9; for (const l of legs) d = Math.min(d, chain([x, y, z], l.pts, l.radii)[0]); for (const a of ants) d = Math.min(d, chain([x, y, z], a.pts, a.radii)[0]); return d; };
  const BROWN = C(0x3b2416), EDGE = C(0x8a6440), BELLY = C(0x5b4030), LEG = C(0x6b4a30);
  return {
    sdf: (x, y, z) => smin(bodyD(x, y, z), limbD(x, y, z), 0.02),
    lo: [-0.66, -0.03, -0.8], hi: [0.66, 0.32, 1.16], cell: 0.036, hiScale: 0.6,
    color: (x, y, z) => {
      if (limbD(x, y, z) < bodyD(x, y, z) - 0.004) return LEG;
      if (headD(x, y, z) < shellD(x, y, z)) return C(0x2a1a10);
      const f = fract((0.72 - z) / 0.16), plate = smoothstep(0.78, 0.95, f);
      const rim = smoothstep(0.36, 0.47, Math.hypot(x / 1, z / 1.5));
      let c = lerp3(BROWN, EDGE, Math.max(plate * 0.6, rim * 0.7));
      return lerp3(c, BELLY, smoothstep(0.1, 0.04, y));
    },
    mat: () => M.CHITIN,
    rig: (x, y, z) => { const [id, t] = legRig(legs, x, y, z, bodyD(x, y, z), 0.4); return [0, id, t]; },
    finish: { rough: 0.35, coat: 0.6, coatRough: 0.15, grain: 0.6, bump: 0.01, tone: 0.02 },
  };
}

// ---------------------------------------------------------------------------------
// Earthworm (a red wiggler, Eisenia / Dendrobaena, ~5 cm): a long ringed tube, pointed at the head end, flattened at the tail,
// red-brown on the back and paler below, with the swollen pale saddle (clitellum) a third of the way back.
// ---------------------------------------------------------------------------------
function earthworm() {
  const H = 2.5, R = 0.11, Y0 = 0.1, NSEG = 90;
  const profile = (z) => {
    const t = clamp01((z + H) / (2 * H));                                   // 0 tail, 1 head
    const env = Math.pow(Math.max(1 - (z / H) ** 2, 0), 0.35) * mix(0.8, 1, smoothstep(0, 0.4, t));
    const saddle = smoothstep(0.08, 0.0, Math.abs(t - 0.7)) * 0.22;
    const ring = 0.5 + 0.5 * Math.cos(TAU * t * NSEG);
    return R * env * (1 + saddle) * (0.95 + 0.05 * ring);
  };
  const bodyD = (x, y, z) => smax((Math.hypot(x, (y - Y0) * 1.1) - profile(z)) * 0.85, Math.abs(z) - H, 0.03);
  const RED = C(0x8e3b3a), PINK = C(0xc07a72), SADDLE = C(0xc98a72), DARK = C(0x5c2426);
  return {
    sdf: bodyD,
    lo: [-0.2, -0.03, -2.6], hi: [0.2, 0.26, 2.6], cell: 0.04, hiScale: 0.6,
    color: (x, y, z) => {
      const t = clamp01((z + H) / (2 * H)), ring = 0.5 + 0.5 * Math.cos(TAU * t * NSEG);
      let c = lerp3(PINK, RED, smoothstep(0.06, 0.16, y));
      c = lerp3(c, DARK, smoothstep(0.75, 1.0, t) * smoothstep(0.12, 0.2, y) * 0.5);
      c = lerp3(c, SADDLE, smoothstep(0.07, 0.0, Math.abs(t - 0.7)));
      return mul3(c, 0.9 + 0.1 * ring);
    },
    mat: () => M.GLOSS,
    rig: (x, y, z) => [clamp01((H - z) / (2 * H)), 0, 0],
    finish: { rough: 0.35, coat: 0.8, coatRough: 0.15, grain: 0.4, bump: 0.004, tone: 0.02 },
  };
}

// ---------------------------------------------------------------------------------
// Waxworm (the larva of the wax moth, Galleria mellonella, ~2 cm): a plump cream caterpillar with a small brown head capsule,
// a darker patch behind it, three pairs of tiny true legs and soft segment folds.
// ---------------------------------------------------------------------------------
function waxworm() {
  const H = 1.0, R = 0.17, Y0 = 0.16, NSEG = 12;
  const profile = (z) => {
    const t = clamp01((z + H) / (2 * H));
    const env = Math.pow(Math.max(1 - (z / H) ** 2, 0), 0.3) * mix(1, 0.75, smoothstep(0.75, 1, t));
    return R * env * (0.93 + 0.07 * (0.5 + 0.5 * Math.cos(TAU * t * NSEG)));
  };
  const bodyD = (x, y, z) => smax((Math.hypot(x, (y - Y0) * 1.05) - profile(z)) * 0.85, -y + 0.01, 0.04);
  const headD = (x, y, z) => ell(x, y - Y0 + 0.02, z - H + 0.02, 0.1, 0.09, 0.09);
  const legD = (x, y, z) => { let d = 1e9; for (const k of [0, 1, 2]) for (const s of [-1, 1]) d = Math.min(d, cap([x, y, z], [s * 0.09, 0.07, 0.72 - k * 0.1], [s * 0.11, 0.015, 0.74 - k * 0.1], 0.03, 0.02)[0]); return d; };
  const sdf = (x, y, z) => smin(smin(bodyD(x, y, z), headD(x, y, z), 0.03), legD(x, y, z), 0.02);
  const CREAM = C(0xeadcb8), FOLD = C(0xcdb98e), HEAD = C(0x5a3a20), SHIELD = C(0x9a7a50);
  return {
    sdf,
    lo: [-0.24, -0.02, -1.08], hi: [0.24, 0.38, 1.1], cell: 0.034, hiScale: 0.6,
    color: (x, y, z) => {
      if (headD(x, y, z) < bodyD(x, y, z)) return HEAD;
      if (legD(x, y, z) < bodyD(x, y, z) - 0.004) return SHIELD;
      const t = clamp01((z + H) / (2 * H)), fold = 0.5 + 0.5 * Math.cos(TAU * t * NSEG);
      let c = lerp3(FOLD, CREAM, 0.4 + 0.6 * fold);
      return lerp3(c, SHIELD, smoothstep(0.86, 0.92, t) * smoothstep(0.2, 0.28, y) * 0.8);
    },
    mat: () => M.SKIN,
    rig: (x, y, z) => [clamp01((H - z) / (2 * H)), 0, 0],
    finish: { rough: 0.5, coat: 0.45, coatRough: 0.25, grain: 0.5, bump: 0.004, tone: 0.01 },
  };
}

export const SMALL = { snail, springtail: () => springtail(), springpink: () => springtail('pink'), springsea: () => springtail('sea'), fly, flylarva, flypupa, cricket, dubia, earthworm, waxworm };
