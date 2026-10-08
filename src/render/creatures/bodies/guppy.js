// The fancy guppy (Poecilia reticulata): one body builder for every look a guppy can have (content/guppy.js): an adult male of
// any strain, a female (plain or gravid) and a fry. Face +z, centred on the origin, cm, built with fishBody (tetras.js): a loft
// for the body, thin sheets for the fins.
//
// Targets (docs/GENETICS_SPEC.md "guppy", sources there): body depth 23-29 % of standard length (SL), head 24-30 % SL (plazi,
// Poecilia reticulata Peters 1859, "depth 3.4-4.4, head 3.3-4.1 in SL"); show males SL about 2.2 cm, females about 3.2 cm and
// deeper, deepest when gravid (guess, from the owner's reference sheets); the eye about a third of the head (guess); a delta tail
// spreads 70 degrees and is about 3/4 of the body long, a veil/fan 45 degrees (IFGA standard as quoted by breeders); the male's
// anal fin is the gonopodium, a rod under the belly pointing back; the female's dark gravid spot sits above her anal fin.
//
// Colour: the strain's tail colour runs from a light root to a deep rim with faint rays; the rear body takes the tail colour in
// fancy males; patterns are painted per vertex (fine enough on the near mesh, cell 0.022 cm): mosaic = dark blotches spreading
// from the tail root, snakeskin = a chain of rings on the body and lace on the fins, half-black = a black rear half, Moscow = a
// dark velvet body in the tail colour, platinum = a white metallic head (iridescent shading). Albino has no black anywhere and red
// eyes. All variants share their finish (one shader per sex and eye colour), so a tank of many strains compiles few shaders.
import { clamp01, lerp3, mul3, C, cells, cap, fbm, vnoise } from '../kit.js';
import { fishBody, medianFin, pairFin, sm, curve } from './tetras.js';
import { parseGuppyLook, GUPPY_HEX, tailSize } from '../../../content/guppy.js';

const SL_MALE = 2.2, SL_FEMALE = 3.2, SL_JUV = 3.2;           // juveniles are drawn on the female body, scaled down by age
const T = 0.035;                                              // fin half-thickness (>= 0.75 cell: the mesher needs ~1.5 cells)
const CELL = 0.045;

const DARK = C(0x0c0c10);
const GROUND = {
  wild: { back: C(0x5c6048), flank: C(0xb4b8a2), belly: C(0xe6e4d4), net: C(0x3e4234), netAmt: 0.35, black: DARK, spot: C(0x141210) },
  gold: { back: C(0xc49a4c), flank: C(0xf0d696), belly: C(0xfff0cc), net: C(0xa07028), netAmt: 0.25, black: C(0x3a2410), spot: C(0x5a3a18) },
  albino: { back: C(0xeac2b4), flank: C(0xf6e2da), belly: C(0xfff2ec), net: C(0xe0b0a0), netAmt: 0.12, black: C(0xe8b8a8), spot: C(0xf0a080) },
};
const tailHex = (p) => (p.ground === 'albino' && p.colour !== 'red' ? (p.colour === 'blue' ? GUPPY_HEX.albinoBlue : GUPPY_HEX.albinoPurple) : GUPPY_HEX[p.colour]);

// Scale net: guppies are "reticulated": every scale edged darker. A ring around each cell centre on a slanted grid.
const scaleNet = (x, y, z) => { const d = cells(Math.abs(x) * 0.6, y * 1.15 + z * 0.35, z * 1.0, 13); return sm(0.32, 0.5, d) * (1 - sm(0.5, 0.7, d)); };
// Snakeskin: a chain of rings and bars (vermiculation) on the rear body.
const chain = (x, y, z) => { const d = cells(Math.abs(x) * 0.5, y * 1.2, z, 7.5); return sm(0.3, 0.38, d) * (1 - sm(0.47, 0.56, d)); };
// Lace: a fine dark web over a fin.
const lace = (y, z) => 1 - sm(0.02, 0.07, Math.abs(vnoise(y * 11 + 3.1, z * 11, 1.7) - 0.5));
// Mosaic: dark irregular blotches, densest at the root of the fin (f 0 root … 1 rim).
const mosaic = (y, z, f) => sm(0.5, 0.6, fbm(y * 4.2 + 7, z * 4.2, 2.3) + 0.22 * (1 - f) - 0.12 * f) * (1 - sm(0.7, 1.0, f));

// ---- Tail outlines (z, y): root at z0 (the end of the tail stalk), half-height h0 there; all in cm ----------------------------
function mirror(up) { return up.concat(up.slice(0, -1).reverse().map(([z, y]) => [z, -y])); }
// A tail spreading at `deg` (full angle) to length `len`, its trailing edge bulging back by `bulge` × len (negative: concave),
// tips extended by `tip` × len (a lyre).
function spreadTail(z0, h0, len, deg, bulge, tip = 0) {
  const k = Math.tan((deg / 2) * Math.PI / 180), up = [], n = 6, m = 8;
  const zT = z0 - len * (1 + tip), yT = h0 + len * (1 + tip) * k;
  for (let i = 0; i <= n; i++) { const f = i / n; up.push([z0 - (z0 - zT) * f, h0 + (yT - h0) * Math.pow(f, 0.92)]); }
  for (let j = 1; j <= m; j++) { const r = 1 - j / m; up.push([z0 - len - bulge * len * (1 - r * r) + (tip ? -tip * len * r ** 3 : 0), yT * r]); }
  return mirror(up);
}
// A round (or slightly spade-shaped) tail of radius rad behind the root.
function roundTail(z0, h0, rad, spade = 0) {
  const up = [], n = 12, cz = z0 - rad * 0.95;
  up.push([z0, h0]);
  for (let i = 0; i <= n; i++) {
    const a = (Math.PI * 0.62) * (1 - i / n), r = rad * (1 + spade * (1 - Math.abs(Math.cos(a))) * 0.4);
    up.push([cz - Math.cos(a) * r, Math.max(Math.sin(a) * rad, 0)]);
  }
  return mirror(up);
}
// A sword: a narrow blade from the tail's upper (side 1) or lower (side -1) edge, out to `len` behind the root.
function swordPoly(z0, h0, len, side) {
  const s = side, w = 0.07 * len;
  return [[z0 + 0.05, s * (h0 - 0.02)], [z0 - len * 0.2, s * (h0 + len * 0.07 + w)], [z0 - len * 0.6, s * (h0 + len * 0.15 + w * 0.5)], [z0 - len, s * (h0 + len * 0.2)],
    [z0 - len * 0.6, s * (h0 + len * 0.15 - w * 0.5)], [z0 - len * 0.2, s * (h0 + len * 0.07 - w * 0.6)], [z0 - 0.1, s * Math.max(h0 - w * 2, 0.02)]];
}

// ---- The builder -------------------------------------------------------------------------------------------------------------
export function guppyDef(look) {
  const p0 = parseGuppyLook(look) ?? parseGuppyLook('red');
  // (the stand-in draws five tails; the other seven by their size class, as the owner's model does until their tails come)
  const p = { ...p0, tail: ['delta', 'fan', 'round', 'doublesword', 'lyre'].includes(p0.tail) ? p0.tail : tailSize(p0.tail) };
  const male = p.sex === 'male', juv = p.sex === 'juv', female = !male;
  const SL = male ? SL_MALE : juv ? SL_JUV : SL_FEMALE;
  const G = GROUND[p.ground] ?? GROUND.wild, albino = p.ground === 'albino';
  const hex = tailHex(p), [T0, T1, T2] = hex.tail.map(C), bodyCol = C(hex.body);
  const fem = female && !juv ? 0.7 : 0;                      // how much of the line's tail colour a female shows
  const gravid = !!p.gravid;

  // Tail: length and spread by shape; the female's by her line's tail size.
  const z0Frac = 1;                                            // the tail root at the end of the stalk (s = 1)
  let tail;
  if (male) {
    tail = {
      delta: { len: 0.8, poly: (z0, h0) => spreadTail(z0, h0, 0.8 * SL, 70, 0.07) },
      fan: { len: 0.72, poly: (z0, h0) => spreadTail(z0, h0, 0.72 * SL, 46, 0.2) },
      round: { len: 0.46, poly: (z0, h0) => roundTail(z0, h0, 0.24 * SL) },
      doublesword: { len: 0.9, poly: (z0, h0) => roundTail(z0, h0, 0.19 * SL, 0.5), swords: 0.9 },
      lyre: { len: 0.88, poly: (z0, h0) => spreadTail(z0, h0, 0.62 * SL, 50, -0.22, 0.42) },
    }[p.tail];
  } else {
    const k = juv ? 0.3 : p.tail === 'delta' ? 0.46 : p.tail === 'fan' ? 0.38 : 0.32;
    tail = { len: k, poly: (z0, h0) => (p.tail === 'delta' && !juv ? spreadTail(z0, h0, k * SL, 46, 0.32) : roundTail(z0, h0, k * SL * 0.55, 0.25)) };
  }
  const total = SL * (1 + tail.len) + 0.05;

  // Profiles [s, fraction of SL] (s 0 snout … 1 end of the stalk). Male: depth 25.5 % SL at s 0.4, stalk 14 %; female: 30 %
  // (gravid 35 %), a rounder belly; the snout tip sits high (the mouth points up: guppies feed at the surface).
  const deep = male ? 0 : gravid ? 0.09 : 0.045;
  const top = [[0, 0.03], [0.05, 0.068], [0.12, 0.093], [0.27, 0.11], [0.4, 0.115 + deep * 0.15], [0.52, 0.11 + deep * 0.1], [0.65, 0.095], [0.8, 0.079], [0.92, 0.072], [1, 0.075]];
  const bot = [[0, 0.0], [0.05, -0.048], [0.12, -0.085], [0.27, -0.12 - deep * 0.4], [0.4, -0.14 - deep], [0.52, -0.128 - deep * 0.95], [0.65, -0.098 - deep * 0.4], [0.8, -0.072], [0.92, -0.064], [1, -0.067]];
  const wid = [[0, 0.02], [0.05, 0.042], [0.12, 0.057], [0.27, 0.066 + deep * 0.15], [0.4, 0.066 + deep * 0.35], [0.52, 0.06 + deep * 0.3], [0.65, 0.047], [0.8, 0.033], [0.92, 0.026], [1, 0.022]];
  const TY = curve(top), BY = curve(bot);

  // ---- Paint -----------------------------------------------------------------------------------------------------------------
  const zRoot = total / 2 - SL;                                 // z of the tail root
  const finCol = (f, y, z, amt = 1, swordEdge = false) => {
    // Tail colour from root to rim, faint rays, the strain's pattern; `amt` < 1 washes it toward a clear membrane (females).
    let c = lerp3(T0, T1, sm(0.0, 0.35, f));
    c = lerp3(c, T2, sm(0.45, 1.0, f));
    const ray = 0.5 + 0.5 * Math.cos(Math.atan2(y, zRoot - z + 0.3) * 38);
    c = mul3(c, 1 - 0.12 * ray);
    if (male && (p.pattern === 'mosaic' || p.pattern === 'tiger')) c = lerp3(c, albino ? mul3(T2, 0.7) : mul3(T2, 0.18), mosaic(y, z, f) * 0.9);
    if (male && (p.pattern === 'snakeskin' || p.pattern === 'tiger')) c = lerp3(c, albino ? mul3(T2, 0.75) : mul3(T2, 0.2), lace(y, z) * 0.75);
    if (p.tuxedo && !albino) c = lerp3(c, mul3(G.black, 2), (1 - sm(0.0, 0.22, f)) * 0.55);     // the black creeps onto the tail root
    if (swordEdge) c = lerp3(c, albino ? T2 : DARK, 0.5);
    return amt < 1 ? lerp3(lerp3(C(0xd8dccc), G.flank, 0.3), c, amt) : c;
  };
  const tailPaint = (u, v, ds, x, y, z) => {
    const f = clamp01((zRoot - z) / (tail.len * SL));
    const c = finCol(f, y, z, male ? 1 : juv ? 0 : fem);
    return lerp3(c, male ? mul3(T2, 0.6) : c, sm(-0.08, 0.0, ds) * 0.5);                         // a deeper rim
  };
  const swordPaint = (u, v, ds, x, y, z) => finCol(clamp01((zRoot - z) / (0.9 * SL)) * 0.6 + 0.4, y, z, 1, ds > -0.025);
  const dorPaint = (u, v, ds, x, y, z) => {
    const f = clamp01((y - TY(0.6) * SL) / (0.3 * SL));
    return finCol(0.25 + f * 0.6, y, z, male ? 0.92 : juv ? 0 : fem * 0.6);
  };
  const clearFin = (u, v, ds) => lerp3(C(0xd6dace), G.flank, 0.25);
  const earPaint = (u, v, ds) => (p.dumbo ? lerp3(lerp3(C(0xf4f2ee), T1, male ? 0.25 : 0.12), mul3(T2, 0.9), sm(-0.07, 0, ds) * (male ? 0.85 : 0.45)) : clearFin(u, v, ds));

  const paint = (s, v, x, y, z) => {
    let c = lerp3(G.flank, G.back, sm(0.25, 0.95, v));
    c = lerp3(c, G.belly, sm(-0.25, -0.9, v) * 0.85);
    if (juv) return lerp3(c, mul3(c, 0.8), scaleNet(x, y, z) * G.netAmt * 0.6);
    c = lerp3(c, mul3(G.net, 1), scaleNet(x, y, z) * G.netAmt * sm(0.12, 0.3, s) * (1 - sm(-0.4, -0.8, v)));
    if (male) {
      // Fancy males: the rear body takes the tail colour, the front stays silvery (or the whole body in a Moscow).
      const rear = sm(0.48, 0.82, s) * (1 - sm(-0.75, -1.05, v) * 0.5);
      c = lerp3(c, lerp3(bodyCol, T1, 0.5), rear * 0.85);
      if (p.moscow) c = lerp3(c, lerp3(mul3(bodyCol, 0.22), mul3(bodyCol, 0.55), sm(-0.6, 0.6, -v) * 0.6 + sm(0.1, 0.3, s) * 0.2), sm(0.1, 0.22, s) * 0.92);
      // platinum: a bright white metal sheen over the head and shoulders (painted: the thin-film shading turns it rainbow)
      if (p.platinum) c = lerp3(c, mul3(C(0xf4f6fa), 1.15), (1 - sm(0.36, 0.5, s)) * sm(-0.7, 0.1, v) * 0.92);
      if (p.pattern === 'snakeskin' || p.pattern === 'tiger') c = lerp3(c, albino ? mul3(bodyCol, 0.8) : mul3(G.black, 1.6), chain(x, y, z) * sm(0.22, 0.4, s) * (1 - sm(-0.6, -0.9, v)) * 0.85);
      // a few iridescent and black spots of the wild type, faint under the strain's colour
      if (!p.moscow && !albino) c = lerp3(c, DARK, sm(0.12, 0.06, cells(x * 1.4, y * 1.4, z * 1.4, 3.1)) * sm(0.3, 0.45, s) * (1 - sm(0.7, 0.85, s)) * 0.5);
    } else {
      // The gravid spot: a dark patch over the belly in front of the anal fin, darker and bigger when she carries a brood.
      const gs = sm(0.5, 0.56, s) * (1 - sm(0.64, 0.69, s)) * sm(-0.2, -0.45, v) * (1 - sm(-0.85, -1.05, v));
      c = lerp3(c, G.spot, gs * (gravid ? 0.9 : 0.55));
      c = lerp3(c, lerp3(c, T1, 0.6), sm(0.75, 1.0, s) * fem * 0.55);                       // a blush of the tail colour on the stalk
    }
    if (p.tuxedo && !albino) {
      const cut = 0.5 + 0.08 * v;                                                               // the boundary slants back toward the belly
      c = lerp3(c, mul3(G.black, male ? 1 : 1.3), sm(cut - 0.03, cut + 0.04, s) * (1 - sm(-0.7, -1.0, v) * 0.6) * (male ? 0.95 : 0.85));
    }
    return c;
  };

  // ---- Fins ----------------------------------------------------------------------------------------------------------------
  const eyeIris = albino ? { inner: C(0xd85a5a), outer: C(0xf0b4a8), limb: C(0x8a2a28), pupil: [0.5, 0.5] } : { inner: C(0xd8d4c4), outer: C(0x8c8a78), limb: C(0x1e1c18), pupil: [0.52, 0.52] };
  const def = fishBody({
    sl: SL, total, cell: CELL, nose: 0.07,
    eyeRing: albino ? C(0xf0c8c0) : C(0xc8c4b0),
    box: [male && p.dumbo ? 0.85 : 0.6, -SL * (male ? 0.95 : 0.55) - 0.1, SL * (male ? 0.95 : 0.55) + 0.1],
    top, bot, wid,
    eyes: [{ s: 0.105, v: 0.22, r: 0.0525 * SL, sink: 0.5, ...eyeIris }],
    extra: male ? (x, y, z, ax) => {
      // the gonopodium: the male's anal fin turned into a rod, from under the belly (s 0.42) back along it
      const zs = total / 2, z1 = zs - 0.42 * SL, y1 = BY(0.42) * SL + 0.03;
      return cap([x, y, z], [0, y1, z1], [0, y1 - 0.09 * SL, z1 - 0.28 * SL], 0.022, 0.011)[0];
    } : null,
    fins: ({ Z, TY: ty, BY: by, sec }) => {
      const z0 = Z(z0Frac), h0 = (ty(0.97) - by(0.97)) / 2 * 0.8;
      const cy0 = (ty(1) + by(1)) / 2;
      const shift = (poly) => poly.map(([zz, yy]) => [zz, yy + cy0]);
      const fins = [medianFin(shift(tail.poly(z0 + 0.12, h0)), T, tailPaint)];
      if (tail.swords) for (const sd of [1, -1]) fins.push(medianFin(shift(swordPoly(z0 + 0.1, h0, tail.swords * SL, sd)), T, swordPaint));
      // Dorsal: a male's is a long flag laid back over the stalk (longest in delta lines); a female's small and rounded.
      const yb = ty(0.6);
      if (male) {
        const dl = { delta: 1, fan: 0.85, lyre: 0.9, round: 0.6, doublesword: 0.7 }[p.tail];
        fins.push(medianFin([[Z(0.53), ty(0.53) - 0.05], [Z(0.555), yb + 0.13 * SL * dl], [Z(0.62), yb + 0.22 * SL * dl], [Z(0.62) - 0.42 * SL * dl, yb + 0.2 * SL * dl],
          [Z(0.62) - 0.5 * SL * dl, yb + 0.15 * SL * dl], [Z(0.7), ty(0.7) + 0.03], [Z(0.72), ty(0.72) - 0.05]], T, dorPaint));
      } else {
        fins.push(medianFin([[Z(0.54), ty(0.54) - 0.05], [Z(0.56), yb + 0.08 * SL], [Z(0.62), yb + 0.12 * SL], [Z(0.69), yb + 0.09 * SL], [Z(0.71), ty(0.71) + 0.02], [Z(0.71), ty(0.71) - 0.05]], T, dorPaint));
        // the female's anal fin: a small fan behind the gravid spot
        const ya = by(0.66);
        fins.push(medianFin([[Z(0.62), by(0.62) + 0.05], [Z(0.64), ya - 0.08 * SL], [Z(0.7), ya - 0.1 * SL], [Z(0.75), ya - 0.06 * SL], [Z(0.76), by(0.76) + 0.04]], T, clearFin));
      }
      // Pelvic fins (small, under the belly ahead of the gonopodium or the anal fin) and pectorals (behind the gill cover).
      const [pcy, phy, pww] = sec(0.38);
      fins.push(...pairFin({ x: pww * 0.35, y: pcy - phy * 0.85, z: Z(0.38), dir: [0.35, -0.5, -1], poly: [[-0.03, -0.03], [0.03, 0.04], [0.16, 0.035], [0.2, 0], [0.15, -0.03]].map(([u, w]) => [u * SL / 2.2, w * SL / 2.2]), t: T, paint: clearFin }));
      // Pectorals: a small clear paddle (0.14 SL); the big-ear ("dumbo") fish has a broad fan 0.32 SL long held out to the side.
      const [ecy, ehy, eww] = sec(0.27), big = p.dumbo ? (male ? 1 : 0.8) : 0;
      const pl = SL * (0.14 + 0.18 * big), pw = SL * (0.05 + 0.13 * big), paddle = [[-0.02, 0.03]];
      for (let i = 0; i <= 8; i++) { const a = Math.PI * (0.62 - 1.24 * i / 8); paddle.push([pl * 0.55 + Math.cos(a) * pl * 0.45, Math.sin(a) * pw]); }
      paddle.push([-0.02, -0.03]);
      fins.push(...pairFin({ x: eww * 0.85, y: ecy - ehy * 0.25, z: Z(0.27), dir: [0.55, -0.1, -1], poly: paddle, t: T, paint: earPaint }));
      return fins;
    },
    paint,
    finish: { finOpacity: male ? 0.8 : 0.55, flutter: 0.03, sheen: 0 },
  });
  def.ao = 0.4;
  return def;
}

// BODIES entries: the default guppy (a red delta male) and every look by id, made on demand (bodies/index.js asks lookupGuppy).
export const GUPPY = { guppy: () => guppyDef('red') };
export const lookupGuppy = (look) => (parseGuppyLook(look) ? () => guppyDef(look) : null);
