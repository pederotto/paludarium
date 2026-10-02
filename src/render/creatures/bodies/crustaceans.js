// Shrimp, crabs and isopods. Face +z, feet on y = 0, centimetres.
//
//  shrimp   cherry shrimp, ~2.5 cm: an arched translucent body lofted along a planar curve, a carapace with
//           rostrum, six overlapping abdominal segments with side plates, a fan tail, stalked eyes, long
//           antennae, short antennules and five pairs of legs (the front two with tiny claws).
//  crab     vampire crab, carapace ~2.2 cm wide: a squarish domed shell, two orange claws of unequal size,
//           yellow eyes on stalks and four jointed walking legs per side with orange joints.
//  isopod   dwarf white isopod, ~0.7 cm: a domed oval of head, seven overlapping tergites, a narrow tail
//           section, two antennae, tiny black eyes, seven pairs of short legs and two uropods.
//
// CRAB ORIENTATION. sim/animals.js crawl() turns a crab by yaw + PI/2 (yaw = atan2(dx, dz) is "model +z
// points along the travel direction"). A rotation about y by yaw + PI/2 sends the model's -x axis onto the
// travel direction, so the crab travels toward local -x (its left side leads) while the face, eyes and claws
// point along +z, 90 degrees away from the travel direction: the natural sideways crab walk.
//
// Legs beyond four share the nearest of the four leg ids, alternating so neighbours on one side are out of
// phase (left: 1, 3, 1, 3 ... ; right: 2, 4, 2, 4 ...) and each leg is out of phase with the one opposite it.
import { ell, smin, smax, vnoise, fbm, C, lerp3, mul3, clamp01, M } from '../kit.js';

const PI = Math.PI, RAD = PI / 180;
const { sqrt, abs, cos, sin, max, min } = Math;
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// An analytic eye (material.js finish.eyes) on the +x side (mirrored by the material): ball centre c, radius r, looking along
// `axis`; h is the horizontal tangent and w the other one.
function eyeSpec(c, r, axis, o) {
  const l = Math.hypot(...axis), a = axis.map((v) => v / l);
  let h = [-a[2], 0, a[0]];                                             // a x up
  const hl = Math.hypot(...h) || 1; h = h.map((v) => v / hl);
  const w = [a[1] * h[2] - a[2] * h[1], a[2] * h[0] - a[0] * h[2], a[0] * h[1] - a[1] * h[0]];
  return { c, r, axis: a, h, w, ...o };
}

// ---- allocation-free distance helpers ----------------------------------------------------------------
let TT = 0;       // parameter along the last chain / capsule that was measured (0 at the start … 1 at the tip)
function segD(px, py, pz, ax, ay, az, bx, by, bz, ra, rb) {
  const bax = bx - ax, bay = by - ay, baz = bz - az, pax = px - ax, pay = py - ay, paz = pz - az;
  let t = (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz || 1);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  TT = t;
  const dx = pax - bax * t, dy = pay - bay * t, dz = paz - baz * t;
  return sqrt(dx * dx + dy * dy + dz * dz) - (ra + (rb - ra) * t);
}
// A limb: chain of capsules through the flat point list P (x,y,z,…) with a radius per joint. Far points get
// a cheap lower bound from the limb's bounding box instead of the exact distance.
function mkChain(P, R) {
  const n = R.length - 1;
  let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9, rm = 0;
  for (let i = 0; i <= n; i++) {
    x0 = min(x0, P[i * 3]); x1 = max(x1, P[i * 3]); y0 = min(y0, P[i * 3 + 1]); y1 = max(y1, P[i * 3 + 1]); z0 = min(z0, P[i * 3 + 2]); z1 = max(z1, P[i * 3 + 2]);
    rm = max(rm, R[i]);
  }
  x0 -= rm; y0 -= rm; z0 -= rm; x1 += rm; y1 += rm; z1 += rm;
  return (x, y, z) => {
    const ex = max(x0 - x, 0, x - x1), ey = max(y0 - y, 0, y - y1), ez = max(z0 - z, 0, z - z1), q = ex * ex + ey * ey + ez * ez;
    if (q > 0.04) { TT = 0; return sqrt(q); }
    let best = 1e9, bt = 0;
    for (let i = 0; i < n; i++) {
      const d = segD(x, y, z, P[i * 3], P[i * 3 + 1], P[i * 3 + 2], P[i * 3 + 3], P[i * 3 + 4], P[i * 3 + 5], R[i], R[i + 1]);
      if (d < best) { best = d; bt = (i + TT) / n; }
    }
    TT = bt;
    return best;
  };
}
// An oriented ellipsoid: world = Rx(pitch) · Ry(yaw) · Rz(roll) · local. Positive pitch tips the long (z) axis
// up in front; yaw swings it about the pitched frame's vertical; roll turns the x axis toward +y.
function mkEll(cx, cy, cz, rx, ry, rz, yaw = 0, pitch = 0, roll = 0) {
  const cw = cos(yaw), sw = sin(yaw), cp = cos(pitch), sp = sin(pitch), cr = cos(roll), sr = sin(roll);
  const R = max(rx, ry, rz), lim = (R + 0.25) * (R + 0.25);
  return (x, y, z) => {
    x -= cx; y -= cy; z -= cz;
    const q = x * x + y * y + z * z;
    if (q > lim) return sqrt(q) - R;
    const y2 = y * cp - z * sp, z2 = y * sp + z * cp;
    const x3 = x * cw - z2 * sw, z3 = x * sw + z2 * cw;
    return ell(x3 * cr + y2 * sr, -x3 * sr + y2 * cr, z3, rx, ry, rz);
  };
}
// Smooth union bookkeeping: which part is nearest (ID) and where along it (WT).
let D = 0, RAW = 0, ID = 0, WT = 0;
const first = (v, id, t = 0) => { D = v; RAW = v; ID = id; WT = t; };
const add = (v, id, k, t = 0) => { if (v < RAW) { RAW = v; ID = id; WT = t; } D = smin(D, v, k); };
const sph = (x, y, z, cx, cy, cz, r) => { const dx = x - cx, dy = y - cy, dz = z - cz; return sqrt(dx * dx + dy * dy + dz * dz) - r; };
// Leg id for the nth leg of a side (see the header): alternate 1/3 on the left and 2/4 on the right.
const legId = (i, left) => (left ? (i % 2 ? 3 : 1) : (i % 2 ? 4 : 2));

// =================================================================================================
// Cherry shrimp
// =================================================================================================
// Shrimp colour morphs (sRGB hex): base = plate rim colour, dark = shaded rim, light = soft plate front, pink = pale belly and
// legs, clear = the glassy patches, clearAmt = how much of the body is glassy, speck = dark specks over the body (or null).
const SHRIMP_MORPHS = {
  red: { base: 0xb80f18, dark: 0x7c0810, light: 0xe03c3c, pink: 0xe6908a, clear: 0xf6cfc6, clearAmt: 0.4, speck: null },
  wild: { base: 0x7a6047, dark: 0x3e2f22, light: 0xa08b72, pink: 0xc9baa4, clear: 0xd9d4c8, clearAmt: 0.6, speck: 0x2c2118 },
  yellow: { base: 0xf0b40a, dark: 0xc08400, light: 0xffd640, pink: 0xffe592, clear: 0xfff3c8, clearAmt: 0.4, speck: null },
  orange: { base: 0xee5a0e, dark: 0xaa3606, light: 0xff8a34, pink: 0xffb07a, clear: 0xffe2c6, clearAmt: 0.4, speck: null },
};

// Blue dream (a Neocaridina line bred for a deep blue): a separate species in the game, so it is not in SHRIMP_MORPHS (genes).
const BLUE_DREAM = { base: 0x1a3fb8, dark: 0x0c2070, light: 0x3f78ee, pink: 0x8fb0e8, clear: 0xc8d8f4, clearAmt: 0.35, speck: null };

function shrimp(morph = 'red') {
  const PAL = morph === 'blue' ? BLUE_DREAM : SHRIMP_MORPHS[morph] ?? SHRIMP_MORPHS.red;
  // Body axis: a planar curve in the yz plane, rows [z, y, half width, half height, segment, fraction].
  // Every abdominal segment starts a little smaller (hidden under the one before) and grows to its rim, then
  // steps down again: that is what makes the overlapping plates.
  const rows = [];
  const push = (z, y, a, b, seg, f) => rows.push([z, y, a, b, seg, f]);
  for (const [z, y, a, b] of [[0.92, 0.535, 0.05, 0.06], [0.8, 0.54, 0.14, 0.16], [0.62, 0.55, 0.205, 0.235], [0.35, 0.56, 0.24, 0.275], [0.1, 0.575, 0.24, 0.275], [-0.04, 0.585, 0.22, 0.255]]) push(z, y, a, b, -1, 0);
  const PHI = [24, 16, 4, -14, -36, -58].map((v) => v * RAD);   // heading of each segment (0 = straight back)
  const LEN = [0.18, 0.19, 0.19, 0.18, 0.17, 0.19];
  const AW = [0.17, 0.195, 0.19, 0.165, 0.14, 0.11], BH = [0.225, 0.255, 0.25, 0.21, 0.175, 0.135];
  let z = -0.05, y = 0.59, endZ = 0, endY = 0;
  const abd = [];
  for (let k = 0; k < 6; k++) {
    const hz = -cos(PHI[k]), hy = sin(PHI[k]);
    push(z, y, AW[k] * 0.9, BH[k] * 0.9, k, 0);
    const z0 = z, y0 = y;
    z += hz * LEN[k]; y += hy * LEN[k];
    push(z, y, AW[k], BH[k], k, 1);
    abd.push({ zm: (z0 + z) / 2, ym: (y0 + y) / 2, phi: PHI[k], len: LEN[k], a: AW[k], b: BH[k] });
    endZ = z; endY = y;
    z += hz * 0.028; y += hy * 0.028;
  }
  push(z, y, 0.07, 0.08, 5, 1);
  const n = rows.length - 1;
  const LZ = rows.map((r) => r[0]), LY = rows.map((r) => r[1]), LA = rows.map((r) => r[2]), LB = rows.map((r) => r[3]);
  const DZ = [], DY = [], TZ = [], TY = [], INV = [], SG = [], FA = [], FB = [], SLP = [];
  for (let i = 0; i < n; i++) {
    const dz = LZ[i + 1] - LZ[i], dy = LY[i + 1] - LY[i], len = sqrt(dz * dz + dy * dy);
    DZ[i] = dz; DY[i] = dy; TZ[i] = dz / len; TY[i] = dy / len; INV[i] = 1 / (len * len);
    const same = rows[i][4] === rows[i + 1][4];
    SG[i] = rows[i][4]; FA[i] = same ? rows[i][5] : 1; FB[i] = same ? rows[i + 1][5] : 1;
    const sl = max(abs(LA[i + 1] - LA[i]), abs(LB[i + 1] - LB[i])) / len;
    SLP[i] = 1 / sqrt(1 + sl * sl);
  }
  let LSEG = -1, LF = 0, LV = 0;
  const loft = (x, y, z) => {
    const ex = max(abs(x) - 0.3, 0), ey = max(0.1 - y, y - 1.05, 0), ez = max(-1.3 - z, z - 1.0, 0), q = ex * ex + ey * ey + ez * ez;
    if (q > 0.05) return sqrt(q);
    let best = 1e9, bi = 0, bt = 0;
    for (let i = 0; i < n; i++) {
      const pz = z - LZ[i], py = y - LY[i];
      let t = (pz * DZ[i] + py * DY[i]) * INV[i];
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const a = pz - DZ[i] * t, b = py - DY[i] * t, dd = a * a + b * b;
      if (dd < best) { best = dd; bi = i; bt = t; }
    }
    const i = bi, t = bt;
    const oz = z - (LZ[i] + DZ[i] * t), oy = y - (LY[i] + DY[i] * t);
    const w = oz * TY[i] - oy * TZ[i], l = oz * TZ[i] + oy * TY[i];       // up-normal is (TY, -TZ) in (z, y)
    const a = LA[i] + (LA[i + 1] - LA[i]) * t, b = LB[i] + (LB[i + 1] - LB[i]) * t;
    const u = x / a, v = w / b;
    const k0 = sqrt(u * u + v * v), k1 = sqrt(u * u / (a * a) + v * v / (b * b));
    let d2 = (k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -min(a, b)) * SLP[i];
    const dl = i === 0 && t === 0 ? -l : i === n - 1 && t === 1 ? l : 0;
    if (dl > 0) { const m = max(d2, 0); d2 = sqrt(m * m + dl * dl) + min(d2, 0); }
    LSEG = SG[i]; LF = FA[i] + (FB[i] - FA[i]) * t; LV = v;
    return d2;
  };

  // Head parts.
  const rostrum = mkEll(0, 0.7, 1.08, 0.04, 0.075, 0.25, 0, 0.16);
  const eyeStalk = mkChain([0.1, 0.6, 0.72, 0.2, 0.65, 0.86], [0.06, 0.05]);
  const EYE = [0.21, 0.65, 0.88, 0.075];
  const antenna = mkChain([0.1, 0.6, 0.86, 0.28, 0.68, 1.45, 0.5, 0.67, 2.0, 0.78, 0.58, 2.45], [0.05, 0.042, 0.035, 0.03]);
  const antennule = mkChain([0.07, 0.62, 0.93, 0.13, 0.74, 1.35, 0.17, 0.82, 1.68], [0.048, 0.038, 0.03]);
  const antFork = mkChain([0.13, 0.74, 1.35, 0.06, 0.8, 1.62], [0.034, 0.03]);
  // Side plates and swimmerets of the abdomen.
  const pleura = abd.map((s) => {
    const nz = sin(s.phi), ny = cos(s.phi);
    return mkEll(s.a * 0.86, s.ym - ny * s.b * 0.5, s.zm - nz * s.b * 0.5, 0.048, s.b * 0.56, s.len * 0.62 + 0.03, 0, -s.phi, 22 * RAD);
  });
  const pleopods = abd.slice(0, 5).map((s) => {
    const nz = sin(s.phi), ny = cos(s.phi);
    return mkEll(s.a * 0.5, s.ym - ny * s.b * 0.92, s.zm - nz * s.b * 0.92 - 0.03, 0.045, 0.09, 0.055, 0, -s.phi, 0);
  });
  // Tail fan: a telson and two pairs of uropods, lying in a plane that slopes back and down.
  const phiF = PHI[5] - 8 * RAD, pF = -phiF, fz = -cos(phiF), fy = sin(phiF);
  const bz = endZ + fz * 0.02, by = endY + fy * 0.02;
  const telson = mkEll(0, by + fy * 0.17, bz + fz * 0.17, 0.08, 0.036, 0.2, 0, pF);
  const uropod = (Y, rx) => {
    const yw = -Y * RAD, dy = cos(yw) * sin(pF), dz = cos(yw) * cos(pF), dx = sin(yw);
    return mkEll(0.05 - dx * 0.19, by - dy * 0.19, bz - dz * 0.19, rx, 0.036, 0.2, yw, pF);
  };
  const endopod = uropod(20, 0.085), exopod = uropod(42, 0.092);
  // Legs: five pairs of pereiopods, the first two ending in a tiny pincer.
  const LEGP = [
    [0.12, 0.34, 0.68, 0.25, 0.3, 0.9, 0.22, 0.16, 1.03, 0.17, 0.08, 1.11],
    [0.13, 0.33, 0.49, 0.27, 0.3, 0.68, 0.24, 0.15, 0.8, 0.19, 0.07, 0.89],
    [0.14, 0.32, 0.3, 0.35, 0.4, 0.25, 0.44, 0.17, 0.14, 0.44, 0.03, 0.02],
    [0.14, 0.32, 0.11, 0.35, 0.4, -0.05, 0.44, 0.17, -0.19, 0.44, 0.03, -0.32],
    [0.13, 0.32, -0.07, 0.32, 0.38, -0.27, 0.4, 0.16, -0.43, 0.38, 0.03, -0.58],
  ];
  const legs = LEGP.map((P) => mkChain(P, [0.055, 0.045, 0.038, 0.034]));
  const claws = [[0.155, 0.06, 1.14, 0.13, 0.035, 1.28], [0.155, 0.078, 1.14, 0.19, 0.06, 1.28], [0.175, 0.05, 0.92, 0.155, 0.03, 1.05], [0.175, 0.068, 0.92, 0.215, 0.055, 1.04]]
    .map((P) => mkChain(P, [0.036, 0.02]));

  const sdf = (x, y, z) => {
    const ax = abs(x);
    first(loft(x, y, z), 0);
    add(rostrum(ax, y, z), 1, 0.05);
    for (let k = 0; k < 6; k++) add(pleura[k](ax, y, z), 2, 0.04);
    for (let k = 0; k < 5; k++) add(pleopods[k](ax, y, z), 3, 0.04);
    add(telson(ax, y, z), 4, 0.03);
    add(endopod(ax, y, z), 4, 0.03);
    add(exopod(ax, y, z), 4, 0.03);
    for (let i = 0; i < 5; i++) add(legs[i](ax, y, z), 10 + i, 0.05, TT);
    for (let i = 0; i < 4; i++) add(claws[i](ax, y, z), 10 + (i >> 1), 0.03, 1);
    add(antenna(ax, y, z), 20, 0.05, TT);
    add(antennule(ax, y, z), 21, 0.04, TT);
    add(antFork(ax, y, z), 21, 0.03, TT);
    add(eyeStalk(ax, y, z), 31, 0.04);
    add(sph(ax, y, z, EYE[0], EYE[1], EYE[2], EYE[3]), 30, 0.025);
    return D;
  };

  const RED = C(PAL.base), RED_D = C(PAL.dark), RED_L = C(PAL.light), PINK = C(PAL.pink), CLEAR = C(PAL.clear), BLACK = C(0x060606), SPECK = PAL.speck && C(PAL.speck);
  const color = (x, y, z) => {
    sdf(x, y, z);
    const n = fbm(x * 5 + 2, y * 5, z * 5);
    let c;
    if (ID === 0) {
      if (LSEG >= 0) {
        c = lerp3(RED_L, RED, sstep(0, 0.6, LF));                   // soft front of each plate, saturated rim
        c = lerp3(c, RED_D, sstep(0.82, 1, LF) * 0.55);
      } else c = lerp3(RED, RED_L, 0.15 + 0.45 * sstep(0.1, -0.9, LV));
      c = mul3(c, 1 - 0.22 * sstep(0.35, 0.95, LV));                 // darker saddle along the back
      c = lerp3(c, PINK, sstep(-0.25, -0.9, LV) * 0.45);            // pale belly
      c = lerp3(c, CLEAR, sstep(0.62, 0.82, vnoise(x * 7 + 3, y * 7, z * 7)) * PAL.clearAmt);
      if (SPECK) c = lerp3(c, SPECK, sstep(0.66, 0.78, vnoise(x * 19 + 5, y * 19, z * 19)) * 0.85);
    } else if (ID === 1) c = lerp3(RED, RED_L, 0.4);
    else if (ID === 2) c = lerp3(RED_L, PINK, 0.35);
    else if (ID === 3) c = lerp3(PINK, RED_L, 0.4);
    else if (ID === 4) {
      const r = sqrt((z - bz) * (z - bz) + (y - by) * (y - by));
      c = lerp3(lerp3(RED, RED_L, 0.35), CLEAR, sstep(0.08, 0.42, r) * 0.75);
    } else if (ID >= 10 && ID < 20) c = lerp3(PINK, RED_L, 0.3 + 0.3 * (1 - WT));
    else if (ID === 20 || ID === 21) c = lerp3(RED_L, PINK, sstep(0.05, 0.6, WT));
    else if (ID === 30) c = BLACK;
    else c = lerp3(RED_L, PINK, 0.4);
    return ID === 30 ? c : mul3(c, 0.9 + 0.2 * n);
  };
  return {
    sdf, lo: [-0.95, -0.05, -1.6], hi: [0.95, 1.15, 2.6], cell: 0.05, hiScale: 0.5,
    color, mat: () => M.TRANSLUCENT,          // one id everywhere: the eyes are analytic, and interpolating 7 to 1 would cross the fin id
    rig: (x, y, z) => {
      sdf(x, y, z);
      const leg = ID >= 10 && ID < 20 ? legId(ID - 10, x < 0) : 0;
      return [clamp01((1.0 - z) / 2.5), leg, leg ? WT : 0];
    },
    finish: { rough: 0.3, coat: 0.5, coatRough: 0.15, grain: 60, bump: 0.006, grainAmt: 0.15, tone: 0.03, glassOpacity: 0.95,
      // black bead eyes with a catchlight
      eyes: [eyeSpec(EYE.slice(0, 3), EYE[3], [0.75, 0.3, 0.6], { pupil: [0.3, 0.3], inner: C(0x0c0a0a), outer: C(0x050404), rim: C(0x030303), cap: 0.95 })],
    },
  };
}

// =================================================================================================
// Vampire crab
// =================================================================================================
// Crab palettes (sRGB hex): shell / shellL / shellD = carapace mid, light and dark, legs = leg colour (joints take `joint`),
// claw / clawD = claws, tip = claw finger tips, eye / pupil = eye ball and its dark patch, flap = the abdomen flap,
// spots = leopard spots over shell and legs (null: none).
const CRAB_PAL = {
  vampire: { shell: 0x3a1462, shellL: 0x6a2ea0, shellD: 0x220a3a, joint: 0xf5821a, claw: 0xf5821a, clawD: 0xd85a0c, tip: 0xf6dfc0, eye: 0xffd21c, pupil: 0x050505, under: 0x6a5a80, flap: 0x8a6aa8, spots: null },
  // Panther crab (Parathelphusa pantherina): pale gold with dark brown leopard spots; cream claw tips, dark eyes.
  panther: { shell: 0xc9a660, shellL: 0xe8cf8a, shellD: 0x9a7a3c, joint: 0xd8b878, claw: 0xd9b872, clawD: 0xb08a48, tip: 0xf4ead2, eye: 0x2a2018, pupil: 0x050505, under: 0xe6d6b0, flap: 0xe0cca0, spots: 0x3a2412 },
};

function crab(pal = 'vampire') {
  const P = CRAB_PAL[pal];
  const PURP = C(P.shell), PURP_L = C(P.shellL), PURP_D = C(P.shellD), ORANGE = C(P.claw), ORANGE_D = C(P.clawD), CREAM = C(P.tip), YEL = C(P.eye), BLACK = C(P.pupil), JOINT = C(P.joint), SPOT = P.spots != null ? C(P.spots) : null;
  const leopard = (x, y, z, k) => (SPOT ? Math.min(1, sstep(0.62, 0.7, vnoise(x * k + 3, y * k, z * k)) * (1 - sstep(0.72, 0.8, vnoise(x * k + 3, y * k, z * k))) + sstep(0.74, 0.8, vnoise(x * k * 1.7, y * k * 1.7 + 5, z * k * 1.7))) : 0);
  const hw = (z) => 1.03 + 0.09 * z;                       // half width of the shell: a little wider at the front
  const carapace = (x, y, z) => {
    const ax = abs(x), w = hw(z);
    const qx = ax - (w - 0.34), qz = abs(z) - 0.52, mx = max(qx, 0), mz = max(qz, 0);
    const dp = sqrt(mx * mx + mz * mz) + min(max(qx, qz), 0) - 0.34;           // rounded rectangle in plan
    const u = ax / w, v = z / 0.86;
    let d = smax(dp, (y - (1.12 - 0.26 * u * u - 0.22 * v * v)) * 0.85, 0.22);  // domed top
    d = smax(d, 0.46 - y, 0.1);                                                // nearly flat underside
    const g = (z - 0.22) / 0.07;
    return d + 0.03 * Math.exp(-g * g) * sstep(0.7, 0.95, y);                   // shallow cervical groove
  };
  // Walking legs (x > 0; mirrored): hip on the flank, up to the highest joint, out and down to a pointed toe.
  const Z0 = [0.5, 0.15, -0.2, -0.55], SH = [0.6, 0.2, -0.2, -0.6], LR = [0.1, 0.085, 0.065, 0.05, 0.022], JR = [0.105, 0.085, 0.068];
  let JO = 0;       // 1 where an orange joint ball forms the surface
  const legs = Z0.map((z0, i) => {
    const s = SH[i];
    const J = [0.95 + 0.62, 0.6 + 0.42, z0 + s * 0.22, 0.95 + 1.12, 0.6 + 0.2, z0 + s * 0.55, 0.95 + 1.36, 0.6 - 0.28, z0 + s * 0.72];
    const chain = mkChain([0.95, 0.6, z0, ...J, 0.95 + 1.4, 0.6 - 0.58, z0 + s * 0.85], LR);
    return (x, y, z) => {
      const d = chain(x, y, z), t = TT;
      if (d > 0.25) { JO = 0; return d; }
      let jd = 1e9;
      for (let j = 0; j < 3; j++) jd = min(jd, sph(x, y, z, J[j * 3], J[j * 3 + 1], J[j * 3 + 2], JR[j]));
      JO = clamp01((d - jd) / 0.05 + 0.5);
      TT = t;
      return smin(d, jd, 0.02);
    };
  });
  // Claws (x > 0): arm, palm and two fingers, scaled about the shoulder by k.
  let CP = 0, CT = 0;
  const mkClaw = (k) => {
    const S = [0.8, 0.6, 0.6];
    const sc = (...p) => [S[0] + (p[0] - S[0]) * k, S[1] + (p[1] - S[1]) * k, S[2] + (p[2] - S[2]) * k];
    const arm = mkChain([...S, ...sc(1.2, 0.64, 0.98), ...sc(1.1, 0.68, 1.38)], [0.12, max(0.12 * k, 0.06), max(0.11 * k, 0.055)]);
    const pc = sc(0.92, 0.68, 1.68);
    const palm = mkEll(pc[0], pc[1], pc[2], 0.27 * k, 0.25 * k, 0.33 * k, -10 * RAD);
    const fixd = mkChain([...sc(0.85, 0.55, 1.85), ...sc(0.74, 0.5, 2.18), ...sc(0.62, 0.47, 2.42)], [max(0.1 * k, 0.05), max(0.07 * k, 0.04), 0.028]);
    const mov = mkChain([...sc(0.95, 0.82, 1.8), ...sc(0.82, 0.74, 2.14), ...sc(0.65, 0.53, 2.44)], [max(0.09 * k, 0.05), max(0.065 * k, 0.04), 0.028]);
    return (x, y, z) => {
      if (x < 0.3) return 1;
      let d = arm(x, y, z); CP = 0; CT = TT;
      const p = palm(x, y, z); if (p < d) { CP = 1; }
      d = smin(d, p, 0.08);
      const f = fixd(x, y, z); if (f < min(d, p)) { CP = 2; CT = TT; }
      d = smin(d, f, 0.05);
      const m = mov(x, y, z); if (m < min(f, p)) { CP = 3; CT = TT; }
      return smin(d, m, 0.05);
    };
  };
  const clawBig = mkClaw(1), clawSmall = mkClaw(0.62);
  const stalk = mkChain([0.42, 0.98, 0.76, 0.5, 1.1, 0.9], [0.07, 0.06]);
  const EYE = [0.52, 1.13, 0.95, 0.13];
  const flap = mkEll(0, 0.44, -0.2, 0.24, 0.05, 0.42);

  const sdf = (x, y, z) => {
    const ax = abs(x);
    first(carapace(x, y, z), 0);
    add(stalk(ax, y, z), 2, 0.05);
    add(sph(ax, y, z, EYE[0], EYE[1], EYE[2], EYE[3]), 1, 0.03);
    add(flap(x, y, z), 7, 0.05);
    add(clawBig(x, y, z), 3, 0.06, 0);
    add(clawSmall(-x, y, z), 4, 0.06, 0);
    for (let i = 0; i < 4; i++) add(legs[i](ax, y, z), 10 + i, 0.05, TT);
    return D;
  };
  const color = (x, y, z) => {
    sdf(x, y, z);
    const n = fbm(x * 2, y * 2, z * 2);
    if (ID === 0) {
      let c = lerp3(PURP_D, PURP_L, sstep(0.5, 1.12, y) * (0.75 + 0.5 * n));
      c = lerp3(c, PURP, 0.3 + 0.3 * sstep(0.2, 0.8, abs(x)));
      if (SPOT) c = lerp3(c, SPOT, leopard(x, y, z, 3.2) * sstep(0.5, 0.7, y) * 0.9);
      return lerp3(c, C(P.under), sstep(0.5, 0.42, y) * 0.5);
    }
    if (ID === 1) {
      const dx = x < 0 ? -x : x;
      const px = dx - EYE[0], py = y - EYE[1], pz = z - EYE[2];
      const l = sqrt(px * px + py * py + pz * pz) || 1;
      return (px * 0.4 + py * 0.15 + pz * 0.9) / l / 1.0 > 0.93 * 0.99 ? BLACK : YEL;
    }
    if (ID === 2) return PURP;
    if (ID === 3 || ID === 4) {
      if (CP >= 2 && CT > 0.72) return CREAM;
      const cc = lerp3(ORANGE, ORANGE_D, 0.2 * n + (CP === 0 ? 0.2 : 0));
      return SPOT ? lerp3(cc, SPOT, leopard(x, y, z, 4) * 0.7) : cc;
    }
    if (ID === 7) return lerp3(PURP, C(P.flap), 0.4);
    if (ID >= 10 && ID < 20) { const lc = lerp3(lerp3(PURP, PURP_L, 0.2 + 0.4 * n), JOINT, JO); return SPOT ? lerp3(lc, SPOT, leopard(x, y, z, 5) * 0.75 * (1 - JO)) : lc; }
    return PURP;
  };
  return {
    sdf, lo: [-2.6, -0.05, -1.5], hi: [2.6, 1.45, 2.6], cell: 0.06, hiScale: 0.5,
    color, mat: (x, y, z) => { sdf(x, y, z); return M.CHITIN; },
    rig: (x, y, z) => {
      sdf(x, y, z);
      const leg = ID >= 10 && ID < 20 ? legId(ID - 10, x < 0) : 0;
      return [clamp01((0.9 - z) / 1.8), leg, leg ? WT : 0];
    },
    finish: {
      rough: 0.4, coat: 0.6, coatRough: 0.2, grain: 60, bump: 0.006, grainAmt: 0.15, tone: 0.02,
      // glossy yellow eyes on stalks with a dark central pupil patch
      eyes: [eyeSpec(EYE.slice(0, 3), EYE[3], [0.4, 0.15, 0.9], { pupil: [0.34, 0.34], inner: C(0xf4d030), outer: C(0xd39a14), rim: C(0x0a0805), limb: C(0x9c6a0e), cap: 0.97, seed: 4 })],
    },
  };
}

// =================================================================================================
// Dwarf white isopod
// =================================================================================================
// Isopod palettes: body / bodyD = plate colour lit and shaded, pale = legs and antennae, blot = dark side patches (null: none).
const ISO_PAL = {
  white: { body: 0xf3ecd8, bodyD: 0xd2c7aa, pale: 0xefe8d4, mottle: 0xc9bb98, blot: null },
  purple: { body: 0x9a8aa8, bodyD: 0x6a5a7c, pale: 0xc8bccf, mottle: 0x56486a, blot: null },
  // Cubaris 'Panda King': white with bold black patches on the head and down the sides.
  panda: { body: 0xf4f2ec, bodyD: 0xd8d4ca, pale: 0xe8e4dc, mottle: 0xc8c4bc, blot: 0x101010 },
};

function isopod(pal = 'white') {
  const IP = ISO_PAL[pal];
  // Segment boundaries front to back: head, seven pereonites, three visible pleon segments, telson.
  const ZB = [0.36, 0.235, 0.1807, 0.1264, 0.0721, 0.0178, -0.0365, -0.0908, -0.145, -0.185, -0.225, -0.265, -0.335];
  const RIM = [0.1, 0.125, 0.14, 0.15, 0.155, 0.155, 0.147, 0.135, 0.095, 0.08, 0.066, 0.052];
  const STEP = 0.002, ZT = 0.37, NT = Math.ceil((ZT - ZB[12] + 0.03) / STEP);
  const TA = new Float32Array(NT + 2), TH = new Float32Array(NT + 2), TF = new Float32Array(NT + 2), TK = new Int8Array(NT + 2);
  const Y0 = 0.055;
  for (let i = 0; i < NT + 2; i++) {
    const z = ZT - i * STEP;
    let k = 0;
    while (k < 11 && z <= ZB[k + 1]) k++;
    const f = clamp01((ZB[k] - z) / (ZB[k] - ZB[k + 1]));
    let a = RIM[k] * (k === 0 ? 0.92 + 0.08 * f : 0.9 + 0.1 * Math.pow(f, 1.4));
    if (z > 0.3) a *= sqrt(max(0, 1 - ((z - 0.3) / 0.06) ** 2));
    if (z < -0.29) a *= sqrt(max(0, 1 - ((-0.29 - z) / 0.045) ** 2));
    if (z > ZB[0] || z < ZB[12]) a = 0;
    a = max(a, 0.006);
    TA[i] = a; TH[i] = a * (k === 0 ? 0.8 : 0.9); TF[i] = f; TK[i] = k;
  }
  const INV = 1 / STEP;
  let BK = 0, BF = 0;
  const body = (x, y, z) => {
    const ax = abs(x);
    const ex = max(ax - 0.2, 0), ey = max(-y, y - 0.24, 0), ez = max(-0.4 - z, z - 0.4, 0), q = ex * ex + ey * ey + ez * ez;
    if (q > 0.01) return sqrt(q);
    const j = clamp01((ZT - z) * INV / (NT + 1)) * (NT + 1);
    const i = min(Math.floor(j), NT), fr = j - i;
    const a = TA[i] + (TA[i + 1] - TA[i]) * fr, h = TH[i] + (TH[i + 1] - TH[i]) * fr;
    const sl = (TA[i + 1] - TA[i]) * INV;
    const u = ax / a, v = (y - Y0) / h;
    const k0 = sqrt(u * u + v * v), k1 = sqrt(u * u / (a * a) + v * v / (h * h));
    let d = (k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -min(a, h)) / sqrt(1 + min(sl * sl, 4));
    d = smax(d, 0.04 - y, 0.012);
    BK = TK[i]; BF = TF[i] + (TF[min(i + 1, NT + 1)] - TF[i]) * fr;
    return d;
  };
  // Seven pairs of short legs tucked under the plates, feet just past the edge.
  const legs = [];
  for (let k = 0; k < 7; k++) {
    const zc = (ZB[k + 1] + ZB[k + 2]) / 2, a = RIM[k + 1], s = (3 - k) * 0.005;
    legs.push(mkChain([a * 0.55, 0.05, zc, a * 0.95, 0.03, zc + s * 0.3, a + 0.01, 0.008, zc + s * 0.6], [0.024, 0.019, 0.016]));
  }
  const antenna = mkChain([0.045, 0.11, 0.31, 0.1, 0.125, 0.43, 0.17, 0.1, 0.53, 0.2, 0.08, 0.57], [0.023, 0.019, 0.016, 0.014]);
  const uropod = mkChain([0.035, 0.065, -0.29, 0.06, 0.055, -0.36, 0.085, 0.045, -0.44], [0.03, 0.023, 0.017]);
  const EYEP = [0.076, 0.088, 0.29, 0.024];

  const sdf = (x, y, z) => {
    const ax = abs(x);
    first(body(x, y, z), 0);
    for (let k = 0; k < 7; k++) add(legs[k](ax, y, z), 10 + k, 0.02, TT);
    add(antenna(ax, y, z), 20, 0.03, TT);
    add(uropod(ax, y, z), 21, 0.03, TT);
    add(sph(ax, y, z, EYEP[0], EYEP[1], EYEP[2], EYEP[3]), 30, 0.012);
    return D;
  };
  const CREAM = C(IP.body), CREAM_D = C(IP.bodyD), PALE = C(IP.pale), BLACK = C(0x070707), BLOT = IP.blot != null ? C(IP.blot) : null;
  const color = (x, y, z) => {
    sdf(x, y, z);
    const n = fbm(x * 30, y * 30, z * 30);
    if (ID === 30) return BLACK;
    if (ID === 0) {
      let c = lerp3(CREAM_D, CREAM, sstep(0, 0.65, BF));                       // tucked-under front of each plate is shaded
      if (BK === 0) c = lerp3(CREAM, CREAM_D, 0.15);
      c = lerp3(c, C(IP.mottle), sstep(0.62, 0.85, vnoise(x * 40, y * 40, z * 40)) * 0.25);
      if (BLOT) c = lerp3(c, BLOT, Math.max(sstep(0.07, 0.1, abs(x)) * sstep(0.42, 0.5, vnoise(x * 6, y * 6, z * 6 + 2)), BK === 0 ? 1 : 0, BK >= 9 ? sstep(0.45, 0.55, vnoise(x * 5 + 4, y * 5, z * 5)) : 0));   // panda: black head, black side blotches
      c = mul3(c, 0.94 + 0.1 * n);
      return lerp3(c, CREAM_D, sstep(0.09, 0.05, y) * 0.4);
    }
    return lerp3(PALE, CREAM_D, 0.25 * n + 0.15);
  };
  return {
    sdf, lo: [-0.32, -0.03, -0.5], hi: [0.32, 0.26, 0.66], cell: 0.02, hiScale: 0.5,
    color, mat: () => M.CHITIN,
    rig: (x, y, z) => {
      sdf(x, y, z);
      const leg = ID >= 10 && ID < 20 ? legId(ID - 10, x < 0) : 0;
      return [clamp01((0.36 - z) / 0.7), leg, leg ? WT : 0];
    },
    finish: {
      rough: 0.5, coat: 0.3, coatRough: 0.5, grain: 150, bump: 0.004, grainAmt: 0.15, tone: 0.015,
      eyes: [eyeSpec(EYEP.slice(0, 3), EYEP[3], [0.7, 0.25, 0.65], { pupil: [0.3, 0.3], inner: C(0x0c0a0a), outer: C(0x050404), rim: C(0x030303), cap: 0.95 })],
    },
  };
}

// BODIES.shrimp (no morph given) stays the familiar red cherry shrimp; 'shrimp:<morph>' are the colour variants.
export const CRUSTACEANS = {
  shrimp: () => shrimp('red'), crab: () => crab(), isopod: () => isopod(),
  blueshrimp: () => shrimp('blue'), panther: () => crab('panther'), purpleiso: () => isopod('purple'), pandaking: () => isopod('panda'),
};
for (const k of Object.keys(SHRIMP_MORPHS)) CRUSTACEANS[`shrimp:${k}`] = () => shrimp(k);
