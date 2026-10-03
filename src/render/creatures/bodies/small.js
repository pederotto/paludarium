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
// Springtail (Collembola, ~0.25 cm). The tropical white (Folsomia candida) is a slim waxy cylinder four or five times as long as
// it is wide: a forward-pointing head with short four-jointed antennae and no eyes, three thoracic and six abdominal segments
// that show as faint rings, short legs under the body, and the furcula (the spring) folded forward under the belly. The pink is
// the same build in pink with eye patches; the seashore springtail (Anurida maritima type) is stout, blue-grey and granular,
// with thick short antennae and no spring.
// ---------------------------------------------------------------------------------
const SPRING_PAL = {
  white: { c: [0xf3eedf, 0xe2dccb, 0xe9e2cf, 0xd8d0bb], gut: 0xd8cfae, r: 0.029, len: 0.27, eyes: false, furc: true, ant: 0.06, antR: 0.006 },
  pink: { c: [0xf0b9b0, 0xdca39b, 0xe8aba3, 0xd3958c], gut: 0xd88f86, r: 0.031, len: 0.27, eyes: true, furc: true, ant: 0.065, antR: 0.0065 },
  sea: { c: [0x5f7290, 0x4b5a76, 0x56688a, 0x46546e], gut: 0x4a5a78, r: 0.042, len: 0.25, eyes: true, furc: false, ant: 0.04, antR: 0.009 },
};
function springtail(pal = 'white') {
  const SP = SPRING_PAL[pal];
  const R = SP.r, Lh = SP.len / 2, Y0 = R + 0.01, ZH = Lh - 0.035;       // body radius, half length, axis height, neck
  // Radius along the body: rounded tail, full abdomen, a slightly narrower thorax and a neck before the egg-shaped head.
  const radius = (z) => {
    const t = (z + Lh) / (2 * Lh);                                         // 0 tail, 1 snout
    const tail = Math.pow(clamp01(t / 0.16), 0.55), snout = Math.pow(clamp01((1 - t) / 0.07), 0.5);
    const thorax = 1 - 0.07 * smoothstep(0.55, 0.62, t), neck = 1 - 0.08 * Math.exp(-(((z - ZH) / 0.016) ** 2));
    const ring = 1 - 0.035 * Math.pow(0.5 + 0.5 * Math.cos(TAU * (t * 9.2 + 0.3)), 6) * smoothstep(0.1, 0.2, t) * (1 - smoothstep(0.78, 0.85, t));
    return R * Math.min(tail, snout) * thorax * neck * ring;
  };
  const bodyD = (x, y, z) => {
    if (Math.abs(z) > Lh + 0.02) return Math.abs(z) - Lh;
    const r = Math.max(radius(z), 0.002);
    return smax((Math.hypot(x, (y - Y0) * 1.08) - r) * 0.9, Math.abs(z) - Lh, 0.008);
  };
  // Legs: coxa under the flank, knee out and up a little, foot just outside the body line.
  const LZ = [ZH - 0.018, ZH - 0.045, ZH - 0.072];
  const legs = sixLegs(LZ.map((zl, k) => (s) => [[s * R * 0.45, Y0 - R * 0.7, zl], [s * R * 1.3, Y0 - R * 0.2, zl + (1 - k) * 0.01], [s * R * 1.7, 0.003, zl + (1 - k) * 0.022]]), [R * 0.2, R * 0.16, R * 0.12]);
  const an = SP.ant;
  const feelers = [-1, 1].map((s) => ({ pts: [[s * R * 0.3, Y0 + R * 0.1, Lh - 0.006], [s * R * 0.55, Y0 + R * 0.3, Lh + an * 0.3], [s * R * 0.9, Y0 + R * 0.38, Lh + an * 0.62], [s * R * 1.25, Y0 + R * 0.25, Lh + an]], radii: [SP.antR, SP.antR * 0.85, SP.antR * 0.8, SP.antR * 0.9] }));
  const furcula = SP.furc ? { pts: [[0, Y0 - R * 0.85, -Lh + 0.05], [0, Y0 - R * 0.95, -Lh + 0.1], [0, Y0 - R * 0.95, -Lh + 0.15]], radii: [R * 0.22, R * 0.17, R * 0.12] } : null;
  const limbD = (x, y, z) => {
    let d = 1e9;
    for (const l of legs) d = Math.min(d, chain([x, y, z], l.pts, l.radii)[0]);
    return d;
  };
  const antD = (x, y, z) => Math.min(...feelers.map((a) => chain([x, y, z], a.pts, a.radii)[0]));
  const furD = (x, y, z) => (furcula ? chain([x, y, z], furcula.pts, furcula.radii)[0] : 1e9);
  const [CREAM, LEG, HEAD, FURC] = SP.c.map(C), GUT = C(SP.gut), EYE = C(0x24222a);
  return {
    sdf: (x, y, z) => smin(smin(smin(bodyD(x, y, z), limbD(x, y, z), 0.006), antD(x, y, z), 0.005), furD(x, y, z), 0.004),
    lo: [-0.1, -0.02, -0.17], hi: [0.1, 0.12, 0.25], cell: 0.0055, hiScale: 0.5,
    color: (x, y, z) => {
      const db = bodyD(x, y, z);
      if (furD(x, y, z) < db - 0.001) return FURC;
      if (Math.min(limbD(x, y, z), antD(x, y, z)) < db - 0.001) return LEG;
      const t = (z + Lh) / (2 * Lh);
      let c = lerp3(CREAM, HEAD, smoothstep(0.84, 0.9, t) * 0.7);
      // the gut shows faintly through the back of a pale animal; the rings are a shade darker
      c = lerp3(c, GUT, smoothstep(0.012, 0.0, Math.abs(x)) * smoothstep(0.2, 0.3, t) * (1 - smoothstep(0.7, 0.8, t)) * smoothstep(Y0, Y0 + R, y) * 0.35);
      c = mul3(c, 1 - 0.07 * Math.pow(0.5 + 0.5 * Math.cos(TAU * (t * 9.2 + 0.3)), 6));
      if (pal === 'sea') c = mul3(c, 0.85 + 0.3 * cells(x, y, z, 160));          // the seashore springtail's granular skin
      if (SP.eyes) { const de = Math.hypot((Math.abs(x) - R * 0.7) * 1.2, y - Y0 - R * 0.25, z - (Lh - 0.022)); c = lerp3(c, EYE, smoothstep(0.012, 0.006, de)); }
      return c;
    },
    mat: () => M.SKIN,
    rig: (x, y, z) => {
      const db = bodyD(x, y, z), spine = clamp01((Lh + 0.03 - z) / (2 * Lh + 0.03));
      if (antD(x, y, z) < Math.min(db, limbD(x, y, z))) { const [, t] = chain([x, y, z], feelers[x < 0 ? 0 : 1].pts, feelers[0].radii); return [0, x < 0 ? 7 : 8, clamp01((t - 0.15) / 0.85) * 0.03]; }
      if (furD(x, y, z) < db) { const [, t] = chain([x, y, z], furcula.pts, furcula.radii); return [spine, 13, t * 0.07]; }
      const [id, t] = legRig(legs, x, y, z, db, 0.1);
      return [spine, id, t];
    },
    finish: { rough: 0.62, coat: 0.18, coatRough: 0.4, grain: 0.6, bump: 0.003, tone: 0.01, invert: { antenna: 1 } },
  };
}

// ---------------------------------------------------------------------------------
// Fruit fly (Drosophila, ~0.3 cm; a flightless culture walks and hops). A round head mostly taken up by two red compound eyes
// set flush in its sides, a tan domed thorax with a small shield (scutellum) behind, an abdomen ringed with dark bands, two clear
// veined wings lying flat over the abdomen and overlapping, six thin legs, and a pair of short feathery antennae.
// ---------------------------------------------------------------------------------
function fly() {
  const legs = sixLegs([
    (s) => [[s * 0.02, 0.105, 0.075], [s * 0.06, 0.12, 0.1], [s * 0.085, 0.05, 0.13], [s * 0.095, 0.004, 0.155]],
    (s) => [[s * 0.03, 0.1, 0.035], [s * 0.085, 0.125, 0.04], [s * 0.115, 0.05, 0.03], [s * 0.128, 0.004, 0.02]],
    (s) => [[s * 0.03, 0.1, -0.005], [s * 0.08, 0.125, -0.04], [s * 0.1, 0.05, -0.09], [s * 0.11, 0.004, -0.13]],
  ], [0.0085, 0.0075, 0.006, 0.005]);
  // Wings: a long rounded blade from the root on the thorax back over the abdomen, crossing a little at the midline.
  const wings = [-1, 1].map((s) => {
    const u = norm([s * 0.16, -0.06, -1]), root = [s * 0.035, 0.195, 0.035];
    return { root, u, C: [root[0] + u[0] * 0.115, root[1] + u[1] * 0.115, root[2] + u[2] * 0.115], F: frameOf(u, [s * 0.15, 1, 0]) };
  });
  const headD = (x, y, z) => ell(x, y - 0.14, z - 0.125, 0.048, 0.047, 0.038);
  const eyeD = (x, y, z) => ell(Math.abs(x) - 0.03, y - 0.142, z - 0.128, 0.026, 0.04, 0.034);
  const thoraxD = (x, y, z) => smin(ell(x, y - 0.145, z - 0.035, 0.054, 0.056, 0.07), ell(x, y - 0.185, z + 0.025, 0.026, 0.016, 0.022), 0.02);
  const abdD = (x, y, z) => ell(x, y - 0.13 - (z + 0.05) * 0.15, z + 0.085, 0.05, 0.045, 0.085);
  const wingD = (x, y, z) => Math.min(...wings.map((w) => oell(x, y, z, w.C, w.F, 0.125, 0.0065, 0.042)));
  const legD = (x, y, z) => { let d = 1e9; for (const l of legs) d = Math.min(d, chain([x, y, z], l.pts, l.radii)[0]); return d; };
  const ants = [-1, 1].map((s) => ({ pts: [[s * 0.012, 0.15, 0.158], [s * 0.022, 0.158, 0.172], [s * 0.034, 0.17, 0.18]], radii: [0.009, 0.007, 0.004] }));
  const antD = (x, y, z) => Math.min(...ants.map((a) => chain([x, y, z], a.pts, a.radii)[0]));
  const bodyD = (x, y, z) => smin(smin(smin(headD(x, y, z), eyeD(x, y, z), 0.008), thoraxD(x, y, z), 0.015), abdD(x, y, z), 0.014);
  const RED = C(0x9e1218), RED_D = C(0x5e0a0e), THORAX = C(0xb8894a), ABD = C(0xd2ab6a), BAND = C(0x2a1d14), WING = C(0xd3dade), VEIN = C(0x8b7d66), LEGC = C(0xb59a68), FOOT = C(0x5f4c30), HEADC = C(0xc69c58);
  const part = (x, y, z) => {
    const p = [[bodyD(x, y, z), 'body'], [wingD(x, y, z), 'wing'], [legD(x, y, z), 'leg'], [antD(x, y, z), 'ant']];
    p.sort((a, b) => a[0] - b[0]);
    return p[0][1];
  };
  return {
    sdf: (x, y, z) => smin(smin(Math.min(bodyD(x, y, z), wingD(x, y, z)), legD(x, y, z), 0.01), antD(x, y, z), 0.006),
    lo: [-0.19, -0.02, -0.3], hi: [0.19, 0.25, 0.22], cell: 0.007, hiScale: 0.5,
    color: (x, y, z) => {
      const pt = part(x, y, z);
      if (pt === 'wing') {
        // clear membrane with the long veins running out from the root
        const w = wings[x < 0 ? 0 : 1], dx = x - w.root[0], dz = z - w.root[2], along = -(dx * w.u[0] + dz * w.u[2]), across = Math.abs(dx * w.u[2] - dz * w.u[0]);
        const vein = Math.max(...[0.012, 0.024, 0.036].map((v) => smoothstep(0.004, 0.0, Math.abs(across - v * (0.4 + 0.6 * clamp01(-along / 0.2))))));
        return lerp3(WING, VEIN, vein * 0.7);
      }
      if (pt === 'leg') return lerp3(LEGC, FOOT, smoothstep(0.02, 0.0, y));
      if (pt === 'ant') return HEADC;
      const de = eyeD(x, y, z), dh = headD(x, y, z), dt = thoraxD(x, y, z), da = abdD(x, y, z);
      if (de < dh + 0.002 && de < dt && de < da) return lerp3(RED, RED_D, 0.35 * smoothstep(0.35, 0.5, cells(x, y, z, 260)) + 0.25 * smoothstep(0.12, 0.1, z));   // facets
      if (dh < dt && dh < da) return HEADC;
      if (dt < da) return lerp3(THORAX, mul3(THORAX, 0.72), 0.3 * smoothstep(0.008, 0.0, Math.abs(Math.abs(x) - 0.02)) + 0.25 * vnoise(x * 60, y * 60, z * 60));
      // abdomen: the hind edge of every segment is a dark band across the back; the belly stays pale; the tip is dark
      const f = fract((z + 0.18) / 0.034), top = smoothstep(0.1, 0.16, y);
      return lerp3(lerp3(ABD, C(0xe8d9ae), smoothstep(0.13, 0.09, y)), BAND, Math.max(smoothstep(0.55, 0.72, f) * top * 0.9, smoothstep(-0.14, -0.165, z) * 0.85));
    },
    mat: (x, y, z) => (part(x, y, z) === 'wing' ? M.TRANSLUCENT : M.CHITIN),
    rig: (x, y, z) => {
      const pt = part(x, y, z), spine = clamp01((0.17 - z) / 0.34);
      if (pt === 'wing') { const w = wings[x < 0 ? 0 : 1], t = clamp01(-((x - w.root[0]) * w.u[0] + (y - w.root[1]) * w.u[1] + (z - w.root[2]) * w.u[2]) / -0.23); return [spine, 9, t * 0.1]; }
      if (pt === 'ant') return [0, x < 0 ? 7 : 8, 0.01];
      const [id, t] = legRig(legs, x, y, z, Math.min(bodyD(x, y, z), wingD(x, y, z)), 0.1);
      return [spine, id, t];
    },
    finish: { rough: 0.45, coat: 0.3, coatRough: 0.3, grain: 0.6, bump: 0.004, tone: 0.01, glassOpacity: 0.4, invert: { antenna: 1 } },
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
// Feeders (2026-10). Banded cricket (Gryllodes sigillatus, a ~1.2 cm feeder): a round head with big dark eyes and a dark band
// between them, a saddle-shaped pronotum, short wings lying over the front of a banded abdomen, two long cerci and (a female's)
// ovipositor, long thin antennae, slender front and middle legs, and the jumping hind legs: a thick drumstick femur raised along
// the body and a long spined tibia folded back down to the ground. Rig: the hind legs are ids 11 / 12 (they kick out on a jump,
// finish.invert), the antennae 7 / 8.
// ---------------------------------------------------------------------------------
function cricket() {
  const Y = 0.24;                                                          // body axis height
  const legDefs = [
    { id: 1, pts: (s) => [[s * 0.1, Y - 0.08, 0.36], [s * 0.2, Y + 0.02, 0.44], [s * 0.27, 0.08, 0.55], [s * 0.3, 0.01, 0.62]], radii: [0.034, 0.028, 0.022, 0.016] },
    { id: 3, pts: (s) => [[s * 0.12, Y - 0.08, 0.2], [s * 0.26, Y + 0.02, 0.2], [s * 0.36, 0.08, 0.13], [s * 0.4, 0.01, 0.08]], radii: [0.034, 0.028, 0.022, 0.016] },
    // the jumping leg: hip, knee high behind, tibia back down to the ground, foot
    { id: 11, pts: (s) => [[s * 0.13, Y - 0.07, 0.04], [s * 0.25, Y + 0.17, -0.34], [s * 0.29, 0.07, -0.66], [s * 0.31, 0.01, -0.74]], radii: [0.075, 0.042, 0.026, 0.02] },
  ];
  const legs = legDefs.flatMap((l) => [-1, 1].map((s) => ({ id: s < 0 ? l.id : l.id + 1, pts: l.pts(s), radii: l.radii })));
  const ants = [-1, 1].map((s) => ({ pts: [[s * 0.06, Y + 0.08, 0.6], [s * 0.15, Y + 0.2, 0.85], [s * 0.3, Y + 0.24, 1.12], [s * 0.48, Y + 0.18, 1.36], [s * 0.62, Y + 0.08, 1.55]], radii: [0.022, 0.018, 0.015, 0.012, 0.01] }));
  const cerci = [-1, 1].map((s) => ({ pts: [[s * 0.05, Y + 0.0, -0.58], [s * 0.13, Y + 0.03, -0.9]], radii: [0.022, 0.012] }));
  const ovi = { pts: [[0, Y - 0.02, -0.56], [0, Y + 0.0, -1.0]], radii: [0.02, 0.012] };
  const headD = (x, y, z) => ell(x, y - Y - 0.02, z - 0.47, 0.14, 0.15, 0.12);
  const eyeD = (x, y, z) => ell(Math.abs(x) - 0.105, y - Y - 0.08, z - 0.52, 0.045, 0.06, 0.05);
  const pronD = (x, y, z) => smax(box(x, y - Y - 0.01, z - 0.29, 0.155, 0.12, 0.1, 0.06), -(y - Y + 0.14), 0.04);
  const abdD = (x, y, z) => { const t = clamp01((0.15 - z) / 0.75); return ell(x, y - Y + 0.02 * t, z + 0.22, 0.165 * (1 - 0.35 * t * t), 0.15 * (1 - 0.25 * t), 0.4); };
  const wingD = (x, y, z) => smax(ell(x, y - Y - 0.115, z - 0.0, 0.15, 0.03, 0.2), -(z + 0.17), 0.02);
  const bodyD = (x, y, z) => smin(smin(smin(smin(headD(x, y, z), eyeD(x, y, z), 0.015), pronD(x, y, z), 0.03), abdD(x, y, z), 0.04), wingD(x, y, z), 0.02);
  const chainsD = (list, x, y, z) => { let d = 1e9; for (const l of list) d = Math.min(d, chain([x, y, z], l.pts, l.radii)[0]); return d; };
  const legD = (x, y, z) => chainsD(legs, x, y, z), antD = (x, y, z) => chainsD(ants, x, y, z), tailD = (x, y, z) => Math.min(chainsD(cerci, x, y, z), chain([x, y, z], ovi.pts, ovi.radii)[0]);
  const TAN = C(0xb88d58), DARK = C(0x3b2a1a), PALE = C(0xd7b98a), LEG = C(0xa98352), WINGC = C(0x8a6a44);
  const part = (x, y, z) => {
    const p = [[bodyD(x, y, z), 'body'], [legD(x, y, z), 'leg'], [antD(x, y, z), 'ant'], [tailD(x, y, z), 'tail']];
    p.sort((a, b) => a[0] - b[0]);
    return p[0][1];
  };
  return {
    sdf: (x, y, z) => smin(smin(bodyD(x, y, z), legD(x, y, z), 0.02), Math.min(antD(x, y, z), tailD(x, y, z)), 0.015),
    lo: [-0.72, -0.03, -1.08], hi: [0.72, 0.56, 1.62], cell: 0.026, hiScale: 0.5,
    color: (x, y, z) => {
      const pt = part(x, y, z), n = vnoise(x * 30, y * 30, z * 30);
      if (pt === 'leg') { const hind = Math.abs(x) > 0.12 && z < 0.0 && y > 0.12; return lerp3(LEG, DARK, (hind ? 0.5 * smoothstep(0.45, 0.6, fract(z * 9 + y * 3)) : 0.15) + 0.25 * smoothstep(0.65, 0.8, n)); }
      if (pt === 'ant') return lerp3(LEG, DARK, 0.35);
      if (pt === 'tail') return lerp3(PALE, DARK, z < -0.8 ? 0.5 : 0.2);
      if (eyeD(x, y, z) < headD(x, y, z) + 0.004) return C(0x18110b);
      const dh = headD(x, y, z), dp = pronD(x, y, z), da = abdD(x, y, z), dw = wingD(x, y, z);
      if (dh < dp && dh < da && dh < dw) return lerp3(TAN, DARK, smoothstep(0.05, 0.01, Math.abs(z - 0.52)) * smoothstep(Y + 0.08, Y + 0.12, y) * 0.9);   // the band between the eyes
      if (dp < da && dp < dw) return lerp3(TAN, DARK, smoothstep(0.06, 0.12, Math.abs(x)) * 0.6 + 0.2 * n);
      if (dw < da) return lerp3(WINGC, DARK, 0.4 * smoothstep(0.45, 0.6, fract(Math.abs(x) * 14 + z * 4)));
      const f = fract((z + 0.6) / 0.105), top = smoothstep(Y - 0.02, Y + 0.08, y);
      return lerp3(lerp3(PALE, TAN, top), DARK, smoothstep(0.55, 0.8, f) * top * 0.85);
    },
    mat: (x, y, z) => (eyeD(x, y, z) < headD(x, y, z) ? M.GLOSS : M.CHITIN),
    rig: (x, y, z) => {
      const pt = part(x, y, z);
      if (pt === 'ant') { const [, t] = chain([x, y, z], ants[x < 0 ? 0 : 1].pts, ants[0].radii); return [0, x < 0 ? 7 : 8, clamp01((t - 0.1) / 0.9) * 0.22]; }
      if (pt === 'leg') {
        let best = 1e9, l = null, tt = 0;
        for (const q of legs) { const [d, t] = chain([x, y, z], q.pts, q.radii); if (d < best) { best = d; l = q; tt = t; } }
        return [clamp01((0.6 - l.pts[0][2]) / 1.4), l.id, clamp01((tt - 0.15) / 0.85) * 0.6];
      }
      return [clamp01((0.6 - z) / 1.4), 0, 0];
    },
    finish: { rough: 0.5, coat: 0.35, coatRough: 0.3, grain: 0.6, bump: 0.01, tone: 0.02, invert: { antenna: 1 } },
  };
}

// ---------------------------------------------------------------------------------
// Dubia roach nymph (Blaptica dubia, ~1.4 cm): a broad, flat oval of overlapping plates. A big half-moon pronotum covers the
// head; behind it two thoracic plates and six abdominal ones, each with a slightly paler hind edge; the edges are thin flanges
// close to the ground. Dark chocolate with a mottled tan pattern, glossy. Six flattened, spiny legs splay out past the rim, two
// long thin antennae come from under the front edge, two short cerci at the back.
// ---------------------------------------------------------------------------------
function dubia() {
  const ZF = 0.72, ZR = -0.68, L = ZF - ZR, A = 0.5, Y0 = 0.05, DOME = 0.36;
  const ZB = [ZF, 0.36, 0.2, 0.04, -0.07, -0.18, -0.29, -0.4, -0.51, ZR];
  const outline = (z) => { const zc = 0.06, t = z > zc ? (z - zc) / (ZF - zc) : (zc - z) / (zc - ZR); return A * Math.pow(Math.max(0, 1 - t * t), 0.5); };
  let BK = 0, BF = 0, BU = 0;
  const shellD = (x, y, z) => {
    if (z > ZF + 0.05 || z < ZR - 0.05) return Math.max(z - ZF, ZR - z);
    let k = 0;
    while (k < ZB.length - 2 && z <= ZB[k + 1]) k++;
    const f = clamp01((ZB[k] - z) / (ZB[k] - ZB[k + 1]));
    const lap = k === 0 ? 1 : 0.965 + 0.035 * Math.pow(f, 1.5) * (1 - smoothstep(0.8, 1, f));
    const a = Math.max(outline(z) * lap, 0.01), h = a * DOME * lap;
    const u = Math.abs(x) / a, v = (y - Y0) / h;
    const k0 = Math.sqrt(u * u + v * v), k1 = Math.sqrt(u * u / (a * a) + v * v / (h * h));
    BK = k; BF = f; BU = u;
    return smax(smax((k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(a, h)) * 0.8, Y0 - y, 0.02), Math.max(z - ZF, ZR - z), 0.02);
  };
  const legs = sixLegs([
    (s) => [[s * 0.2, Y0, 0.36], [s * 0.42, Y0 + 0.04, 0.46], [s * 0.56, 0.05, 0.58], [s * 0.62, 0.005, 0.66]],
    (s) => [[s * 0.22, Y0, 0.12], [s * 0.48, Y0 + 0.04, 0.12], [s * 0.62, 0.05, 0.06], [s * 0.7, 0.005, 0.0]],
    (s) => [[s * 0.2, Y0, -0.12], [s * 0.44, Y0 + 0.04, -0.28], [s * 0.58, 0.05, -0.48], [s * 0.64, 0.005, -0.62]],
  ], [0.05, 0.042, 0.03, 0.02]);
  const ants = [-1, 1].map((s) => ({ pts: [[s * 0.08, Y0 + 0.02, 0.66], [s * 0.18, Y0 + 0.06, 0.86], [s * 0.36, Y0 + 0.07, 1.06], [s * 0.52, Y0 + 0.03, 1.2]], radii: [0.02, 0.016, 0.013, 0.01] }));
  const cerci = [-1, 1].map((s) => ({ pts: [[s * 0.08, Y0 + 0.02, ZR + 0.06], [s * 0.14, Y0 + 0.03, ZR - 0.06]], radii: [0.03, 0.018] }));
  const chainsD = (list, x, y, z) => { let d = 1e9; for (const l of list) d = Math.min(d, chain([x, y, z], l.pts, l.radii)[0]); return d; };
  const legD = (x, y, z) => chainsD(legs, x, y, z), antD = (x, y, z) => chainsD(ants, x, y, z), cerD = (x, y, z) => chainsD(cerci, x, y, z);
  const BROWN = C(0x34201a), MOTTLE = C(0x9a6a3c), EDGE = C(0x7a5434), BELLY = C(0x4e3526), LEG = C(0x5e3f2a);
  return {
    sdf: (x, y, z) => smin(smin(shellD(x, y, z), legD(x, y, z), 0.02), Math.min(antD(x, y, z), cerD(x, y, z)), 0.015),
    lo: [-0.78, -0.03, -0.82], hi: [0.78, 0.3, 1.26], cell: 0.03, hiScale: 0.5,
    color: (x, y, z) => {
      const ds = shellD(x, y, z), dl = legD(x, y, z), da = antD(x, y, z);
      if (da < ds && da < dl) return lerp3(LEG, EDGE, 0.3);
      if (dl < ds - 0.004) return lerp3(LEG, BROWN, 0.3 * vnoise(x * 40, y * 40, z * 40));
      if (cerD(x, y, z) < ds) return EDGE;
      shellD(x, y, z);
      const n = fbm(x * 9, y * 9, z * 9), sp = smoothstep(0.45, 0.75, vnoise(x * 12 + 3, y * 12, z * 12) * 0.7 + vnoise(x * 26, y * 26, z * 26 + 4) * 0.3);
      // the pronotum and thoracic plates carry the mottled tan pattern; each plate's hind edge is paler
      let c = lerp3(BROWN, MOTTLE, (BK <= 2 ? 0.55 : 0.25) * sp + 0.15 * n);
      c = lerp3(c, EDGE, Math.max(smoothstep(0.75, 0.95, BF) * 0.55, smoothstep(0.82, 0.98, BU) * 0.6));
      return lerp3(c, BELLY, smoothstep(Y0 + 0.03, Y0, y) * 0.6);
    },
    mat: () => M.CHITIN,
    rig: (x, y, z) => {
      const ds = shellD(x, y, z), da = antD(x, y, z);
      if (da < Math.min(ds, legD(x, y, z))) { const [, t] = chain([x, y, z], ants[x < 0 ? 0 : 1].pts, ants[0].radii); return [0, x < 0 ? 7 : 8, clamp01((t - 0.1) / 0.9) * 0.14]; }
      const [id, t] = legRig(legs, x, y, z, Math.min(ds, cerD(x, y, z)), 0.4);
      return [clamp01((ZF - z) / L), id, t];
    },
    finish: { rough: 0.35, coat: 0.6, coatRough: 0.15, grain: 0.6, bump: 0.01, tone: 0.02, invert: { antenna: 1 } },
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
