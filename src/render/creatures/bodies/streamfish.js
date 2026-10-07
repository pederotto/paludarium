// Fish of clear, cool or fast streams (run "sets"): White Cloud Mountain minnow, pale chub, hillstream loach, European bullhead.
// All four are PROCEDURAL SDF bodies from the loft + fin-sheet builder of tetras.js (see the notes there: a fin sheet must be
// >= ~1.5 mesher cells thick, so each fish picks `cell` and the fin half-thickness `t` together). No scan, no claim of scan
// fidelity. Face +z, centred on the origin, cm. Real sizes: tanichthys 4 cm SL, zacco 11 cm, hillloach 5.5 cm, bullhead 9 cm.
import { cells, vnoise, C, lerp3, mul3 } from '../kit.js';
import { fishBody, medianFin, pairFin, caudalPoly, fanPaint, sm } from './tetras.js';
import { COLORMAPS } from './colormaps.js';

// ---- Reference colour maps (colormaps.js, tools/bake-colormap.mjs): body colour per vertex, fin colour gradients ----
const LIN = Array.from({ length: 256 }, (_, i) => C(i * 65536)[0]);   // sRGB byte -> linear
const GRIDS = new Map();
const gridOf = (m) => {
  let g = GRIDS.get(m);
  if (g) return g;
  const pal = atob(m.pal), ix = atob(m.idx), n = m.w * m.h, d = new Float32Array(n * 3);   // 16-colour palette, 4-bit indices
  for (let i = 0; i < n; i++) {
    const b = ix.charCodeAt(i >> 1), k = (i & 1 ? b & 15 : b >> 4) * 3;
    d[i * 3] = LIN[pal.charCodeAt(k)]; d[i * 3 + 1] = LIN[pal.charCodeAt(k + 1)]; d[i * 3 + 2] = LIN[pal.charCodeAt(k + 2)];
  }
  GRIDS.set(m, g = d);
  return g;
};
// Bilinear sample of a map at column u (0 snout .. 1 tail base) and row v (0 dorsal edge .. 1 ventral edge).
const sampleMap = (m, u, v) => {
  const g = gridOf(m), x = Math.min(Math.max(u, 0), 1) * (m.w - 1), y = Math.min(Math.max(v, 0), 1) * (m.h - 1);
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(x0 + 1, m.w - 1), y1 = Math.min(y0 + 1, m.h - 1), fx = x - x0, fy = y - y0;
  const at = (i, j, k) => g[(j * m.w + i) * 3 + k];
  return [0, 1, 2].map((k) => (at(x0, y0, k) * (1 - fx) + at(x1, y0, k) * fx) * (1 - fy) + (at(x0, y1, k) * (1 - fx) + at(x1, y1, k) * fx) * fy);
};
// Body paint from the side map (rows: v +1 back .. -1 belly); the hillstream loach adds its top and belly views.
const mapPaint = (id, bright = 1.15, contrast = 1) => {
  const M = COLORMAPS[id], dor = M.views?.dorsal, bel = M.views?.belly;
  const gg = gridOf(M); let piv = 0; for (let i = 0; i < gg.length; i++) piv += gg[i]; piv /= gg.length;
  return (s, v, x, y, z, lat) => {
    const row = (1 - Math.max(-1, Math.min(1, v))) / 2;
    let c = sampleMap(M, s, row);
    if (dor || bel) {
      const across = (Math.max(-1, Math.min(1, lat ?? 0)) + 1) / 2;
      if (dor) c = lerp3(c, sampleMap(dor, s, across), sm(0.1, 0.65, v));
      if (bel) c = lerp3(c, sampleMap(bel, s, across), sm(-0.45, -0.9, v));
    }
    if (contrast !== 1) c = c.map((q) => Math.max(0, piv + (q - piv) * contrast));   // contrast about the map's mean: per-vertex colour is blurred by the mesh, this keeps the pattern readable
    return mul3(c, bright);
  };
};
const hexLin = (h) => C(parseInt(h.slice(1), 16));
// Fin colour: the measured base -> tip gradient from the join point (fu, fv) over R, darkened along fanning rays.
const finGrad = (id, name, fu, fv, R, o = {}) => {
  const spec = COLORMAPS[id]?.fins?.[name];
  if (!spec) return fanPaint({ f: [fu, fv], base: C(0x9a8a60), ray: C(0x3a2e18), n: 12, amt: 0.3 });
  const stops = spec.g.map(hexLin), dark = hexLin(spec.dark), k = o.bright ?? 1.45, n = o.rays ?? 12, amt = o.amt ?? 0.3;
  return (u, v) => {
    const t = Math.min(1, Math.hypot(u - fu, v - fv) / R) * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(t));
    const c = lerp3(stops[i], stops[i + 1], t - i), ray = 0.5 + 0.5 * Math.cos(Math.atan2(v - fv, Math.abs(u - fu) + 0.05) * n);
    return mul3(lerp3(c, dark, ray * amt), k);
  };
};

const TWO_PI = Math.PI * 2;
const hsc = (arr, k) => arr.map(([s, v]) => [s, v * k]);   // height scale of a profile (silhouette fit to the reference)
const PROF = {
  tetra: {
    top: [[0, 0.015], [0.05, 0.05], [0.12, 0.09], [0.25, 0.128], [0.4, 0.14], [0.6, 0.125], [0.8, 0.075], [1, 0.04]],
    bot: [[0, -0.02], [0.05, -0.045], [0.12, -0.07], [0.25, -0.095], [0.4, -0.105], [0.6, -0.095], [0.8, -0.055], [1, -0.03]],
    wid: [[0, 0.012], [0.05, 0.035], [0.12, 0.056], [0.25, 0.074], [0.4, 0.079], [0.6, 0.068], [0.8, 0.04], [1, 0.02]],
  },
  chub: {   // slimmer, longer-bodied: a rapids swimmer
    top: [[0, 0.015], [0.05, 0.05], [0.12, 0.088], [0.25, 0.115], [0.4, 0.124], [0.6, 0.11], [0.8, 0.07], [1, 0.04]],
    bot: [[0, -0.02], [0.05, -0.045], [0.12, -0.066], [0.25, -0.086], [0.4, -0.092], [0.6, -0.085], [0.8, -0.055], [1, -0.035]],
    wid: [[0, 0.012], [0.05, 0.03], [0.12, 0.05], [0.25, 0.064], [0.4, 0.068], [0.6, 0.058], [0.8, 0.036], [1, 0.02]],
  },
};

// A small schooling cyprinid: forked tail, one dorsal, one anal fin, a lateral band (tanichthys) or vertical bars (zacco).
function minnow(o) {
  const t = o.t, hs = o.hs ?? 1, P0 = PROF[o.prof], P = { top: P0.top.map(([s, v]) => [s, v * hs]), bot: P0.bot.map(([s, v]) => [s, v * hs]), wid: P0.wid }, M = o.map;
  const fg = (name, fu, fv, R, edge, base, ray) => (M ? finGrad(M, name, fu, fv, R, { bright: o.fbright }) : fanPaint({ f: [fu, fv], base, ray, edge, n: 10, amt: 0.25, edgeAmt: 0.55 }));
  return fishBody({
    sl: o.sl, total: o.total, cell: o.cell, box: o.box, nose: 0.08, ...P, eyeRing: o.ring,
    eyes: [{ s: 0.1, v: 0.14, r: o.eye, sink: 0.55, inner: o.iris, outer: o.irisEdge, limb: C(0x2a2a22) }],
    fins: ({ Z, TY, BY, sec }) => {
      const fp = (fz, fy, edge, name = 'dorsal', R = o.dor * 1.4) => fg(name, fz, fy, R, edge, o.finBase, o.finRay);
      const zc = Z(0.93), y0 = TY(0.5), y1 = BY(0.7), [cy, hy, ww] = sec(0.27);
      return [
        medianFin(caudalPoly(zc, o.total / 2 + zc - 0.02 + 0.02, 0.1 * o.fs, o.tailH, (r) => 1 - 0.5 * (1 - r) ** 1.4), t, M ? finGrad(M, 'caudal', Z(0.9), 0, zc + o.total / 2, { bright: o.fbright, rays: 14 }) : fanPaint({ f: [Z(0.9), 0], base: o.tailBase, ray: o.finRay, edge: o.edge, n: 14, amt: 0.25, edgeAmt: 0.5 })),
        ...(o.split ? [   // two dorsals (rainbowfish): a short spiny one, then a longer soft one
          medianFin([[Z(0.4), TY(0.4) - 0.07 * o.fs], [Z(0.42), y0 + o.dor * 0.7], [Z(0.46), y0 + o.dor * 0.8], [Z(0.5), TY(0.5) - 0.07 * o.fs]], t, fp(Z(0.45), y0, o.edge, 'dorsal1', o.dor)),
          medianFin([[Z(0.62), TY(0.62) - 0.07 * o.fs], [Z(0.64), y0 + o.dor * 0.6], [Z(0.7), y0 + o.dor * 0.95], [Z(0.78), y0 + o.dor * 0.5], [Z(0.82), TY(0.82) - 0.07 * o.fs]], t, fp(Z(0.7), y0, o.edge, 'dorsal2', o.dor * 1.5)),
        ] : [medianFin([[Z(0.44), TY(0.44) - 0.07 * o.fs], [Z(0.455), y0 + o.dor * 0.4], [Z(0.49), y0 + o.dor * 0.85], [Z(0.54), y0 + o.dor], [Z(0.6), y0 + o.dor * 0.6], [Z(0.66), TY(0.66) - 0.07 * o.fs]], t, fp(Z(0.55), y0, o.edge, 'dorsal', o.dor * 1.4))]),
        medianFin([[Z(0.53), BY(0.53) + 0.07 * o.fs], [Z(0.55), y1 - o.anal], [Z(0.62), y1 - o.anal * 0.85], [Z(0.72), y1 - o.anal * 0.5], [Z(0.82), y1 - o.anal * 0.2], [Z(0.9), BY(0.9) + 0.07 * o.fs]], t, fp(Z(0.7), y1, o.analEdge ?? o.edge, 'anal', o.anal * 1.6)),
        ...pairFin({ x: ww * 0.8, y: cy - hy * 0.45, z: Z(0.27), dir: [0.45, -0.1, -1], poly: [[-0.06 * o.fs, -0.05 * o.fs], [0.05 * o.fs, 0.1 * o.fs], [0.26 * o.fs, 0.11 * o.fs], [0.4 * o.fs, 0.02 * o.fs], [0.3 * o.fs, -0.08 * o.fs], [0.08 * o.fs, -0.09 * o.fs]], t, paint: fp(Z(0.27), cy, null, 'pelvic', o.fs * 0.5) }),
      ];
    },
    paint: M ? mapPaint(M, o.bright ?? 1.15, o.contrast ?? 1) : o.paint, iri: M ? undefined : o.iri,
    finish: { sheen: 0, finOpacity: o.finOp ?? 0.42 },
  });
}

// ---- White Cloud Mountain minnow (Tanichthys albonubes) ----
const tanichthys = () => {
  const back = C(0x4e4326), flank = C(0xa88f52), belly = C(0xe8e2cc), dark = C(0x16120a), red = C(0xd8281a), teal = C(0x28d0c0);
  const band = (s, v) => sm(0.06, 0.14, s) * (1 - sm(0.9, 0.98, s)) * sm(-0.16, -0.02, v) * (1 - sm(0.16, 0.3, v));
  const line = (s, v) => sm(0.08, 0.16, s) * (1 - sm(0.9, 0.97, s)) * sm(0.16, 0.26, v) * (1 - sm(0.4, 0.5, v));
  return minnow({
    prof: 'tetra', map: 'tanichthys', contrast: 1.4, hs: 1.04, sl: 3.9, total: 4.8, cell: 0.064, t: 0.052, box: [0.6, -1.0, 1.0], eye: 0.19, fs: 1.45, tailH: 0.48, dor: 0.46, anal: 0.4,
    ring: C(0xd6c38a), iris: C(0xe8d9a0), irisEdge: C(0x6a5a30),
    finBase: C(0xe0c07a), finRay: C(0xa08040), tailBase: C(0xe23a1c), edge: C(0xe02a14),
    paint: (s, v) => {
      let c = lerp3(flank, back, sm(0.25, 0.95, v));
      c = lerp3(c, belly, sm(-0.25, -0.95, v) * 0.9);
      c = lerp3(c, dark, band(s, v) * 0.95);
      c = lerp3(c, mul3(red, 1.6), sm(0.82, 0.9, s) * (1 - sm(0.97, 1, s)) * 0.55 * (1 - sm(0.3, 0.7, v)));   // the red patch at the tail base
      return lerp3(c, mul3(teal, 1.7), line(s, v));
    },
    iri: (s, v) => line(s, v) > 0.5,
  });
};

// ---- Pale chub (Zacco platypus-type, Opsariichthys): brassy flanks, blue-green bars, the male's long orange anal fin ----
const zacco = () => {
  const back = C(0x4c5a3c), brass = C(0xb9a45e), belly = C(0xe9e6d4), bar = C(0x2f9a98), orange = C(0xe2873a);
  const bars = (s, v) => sm(0.55, 0.85, Math.cos(s * TWO_PI * 7.5)) * sm(0.2, 0.3, s) * (1 - sm(0.8, 0.9, s)) * sm(-0.55, -0.3, v) * (1 - sm(0.5, 0.7, v));
  return minnow({
    prof: 'chub', map: 'zacco', bright: 0.8, contrast: 1.3, hs: 1.18, sl: 10.6, total: 13.0, cell: 0.16, t: 0.125, box: [1.5, -2.6, 2.7], eye: 0.46, fs: 3.4, tailH: 1.5, dor: 1.2, anal: 1.55,
    ring: C(0xc9c2a0), iris: C(0xe0cf8a), irisEdge: C(0x6a5a2a),
    finBase: C(0xcfc4a0), finRay: C(0x8a8060), tailBase: C(0xd3b27a), edge: C(0xe08440), analEdge: orange, finOp: 0.45,
    paint: (s, v, x, y, z) => {
      let c = lerp3(brass, back, sm(0.2, 0.95, v));
      c = lerp3(c, belly, sm(-0.2, -0.9, v) * 0.9);
      c = lerp3(c, mul3(bar, 1.5), bars(s, v) * 0.8);
      c = lerp3(c, orange, sm(0.17, 0.2, s) * (1 - sm(0.23, 0.27, s)) * sm(-0.7, -0.3, v) * (1 - sm(0.1, 0.4, v)) * 0.4);   // blush behind the gill cover
      return lerp3(c, mul3(back, 0.7), (1 - sm(0.12, 0.2, vnoise(x * 3, y * 3, z * 3))) * 0.1 * sm(0.0, 0.5, v));
    },
  });
};

// ---- Madagascar rainbowfish (Bedotia geayi): slim, olive-gold, dark eye-to-tail line, two dorsals, black-edged yellow fins ----
const bedotia = () => {
  const back = C(0x5e6234), gold = C(0xc4a652), belly = C(0xe8e2c2), line = C(0x1c1c10);
  return minnow({
    prof: 'chub', map: 'bedotia', bright: 1, contrast: 1.6, hs: 1.3, split: true, sl: 7.6, total: 9.4, cell: 0.115, t: 0.092, box: [1.1, -1.9, 2.0], eye: 0.36, fs: 2.6, tailH: 1.15, dor: 0.95, anal: 1.2,
    ring: C(0xd8c88a), iris: C(0xe8d890), irisEdge: C(0x4a3a18),
    finBase: C(0xf0c24a), finRay: C(0xbe8a24), tailBase: C(0xf0b434), edge: C(0x20201a), analEdge: C(0x20201a), finOp: 0.5,
    paint: (s, v) => {
      let c = lerp3(gold, back, sm(0.2, 0.95, v));
      c = lerp3(c, belly, sm(-0.2, -0.9, v) * 0.9);
      return lerp3(c, line, sm(0.1, 0.2, s) * (1 - sm(0.92, 0.98, s)) * sm(-0.2, -0.05, v) * (1 - sm(0.05, 0.2, v)) * 0.8);
    },
  });
};

// ---- Hillstream loach (Pseudogastromyzon type): flat belly, a flat head, huge horizontal paired fins that grip the rock ----
const hillloach = () => {
  const t = 0.07, brown = C(0x7a5a30), yellow = C(0xc8a550), dark = C(0x21160a), belly = C(0xe4d9b4), FIN = C(0x4a3e1c), FRAY = C(0x140e06), RIM = C(0xb8a878);
  const pf = (fu, fv) => (u, v, ds) => lerp3(lerp3(FIN, FRAY, 0.5 + 0.5 * Math.cos(Math.atan2(v - fv, Math.abs(u - fu) + 0.05) * 13) > 0.5 ? 0.55 : 0.1), RIM, sm(-0.22, 0, ds) * 0.85);   // olive-brown, barred by fin rays, pale margin
  return fishBody({
    sl: 5.3, total: 6.7, cell: 0.09, eyeRing: mul3(C(0xa88a4a), 1.2), box: [2.3, -0.6, 0.9], nose: 0.1,
    top: hsc([[0, 0.02], [0.06, 0.05], [0.2, 0.078], [0.4, 0.088], [0.6, 0.07], [0.8, 0.05], [1, 0.035]], 1.25),
    bot: hsc([[0, -0.012], [0.06, -0.022], [0.2, -0.03], [0.4, -0.036], [0.7, -0.034], [1, -0.026]], 1.25),
    wid: [[0, 0.03], [0.06, 0.075], [0.2, 0.115], [0.4, 0.125], [0.6, 0.09], [0.8, 0.05], [1, 0.03]],
    eyes: [{ s: 0.14, v: 0.7, r: 0.14, up: 0.9, fwd: 0.1, inner: C(0xc9a24a), outer: C(0x4a3410), limb: C(0x120e06), pupil: [0.5, 0.5] }],
    fins: ({ Z, TY, BY, sec }) => {
      const [cy, hy, ww] = sec(0.2), [cy2, hy2, ww2] = sec(0.46);
      const y0 = TY(0.5);
      // Pectoral and pelvic fins lie flat on the rock, fanning outward and back: u outward, v backward (-z).
      const big = [[0, -0.3], [0.5, -0.45], [1.3, -0.15], [2.0, 0.45], [2.2, 1.1], [1.7, 1.75], [0.9, 1.95], [0.25, 1.2]];
      const small = [[0, -0.2], [0.4, -0.3], [1.0, -0.05], [1.5, 0.4], [1.5, 0.95], [1.0, 1.3], [0.4, 1.0]];
      const flat = (poly, x, y, z, ez, p) => pairFin({ x, y, z, dir: [1, 0, ez], up: [0, 0, -1], poly, t, paint: p });
      return [
        medianFin(caudalPoly(Z(0.93), 1.7, 0.12, 0.62, (r) => 1 - 0.28 * (1 - r) ** 1.3), t, finGrad('hillloach', 'caudal', Z(0.9), 0, 1.8, { rays: 14, amt: 0.4 })),
        medianFin([[Z(0.42), TY(0.42) - 0.05], [Z(0.47), y0 + 0.45], [Z(0.56), y0 + 0.55], [Z(0.64), y0 + 0.25], [Z(0.68), TY(0.68) - 0.05]], t, finGrad('hillloach', 'dorsal', Z(0.54), y0, 0.75)),
        medianFin([[Z(0.7), BY(0.7) + 0.05], [Z(0.73), BY(0.74) - 0.22], [Z(0.8), BY(0.8) - 0.24], [Z(0.86), BY(0.86) + 0.05]], t, finGrad('hillloach', 'anal', Z(0.78), BY(0.78), 0.5)),
        ...flat(big.map(([u, v]) => [u * 0.5, v]), ww * 0.85, cy - hy * 0.6, Z(0.2), -0.3, finGrad('hillloach', 'pectoral', 0, 0, 2.3, { rays: 16 })),
        ...flat(small.map(([u, v]) => [u * 0.55, v]), ww2 * 0.8, cy2 - hy2 * 0.75, Z(0.46), -0.55, finGrad('hillloach', 'pelvic', 0, 0, 1.6, { rays: 14 })),
      ];
    },
    paint: mapPaint('hillloach', 1.1, 1.6),
    finish: { finOpacity: 0.95, coat: 0.45, sheen: 0 },
  });
};

// ---- European bullhead (Cottus gobio): broad flat head, wide mouth, huge pectoral fans, two dorsal fins, mottled ----
const bullhead = () => {
  const t = 0.095, brown = C(0x5c4a2e), tan = C(0x9a8456), dark = C(0x241a0e), pale = C(0xcfc4a2), FIN = C(0x4a3c22), FRAY = C(0x18120a);
  const BR = C(0xa89a70);
  const pf = (fu, fv) => (u, v, ds) => lerp3(lerp3(FIN, FRAY, (0.5 + 0.5 * Math.cos(Math.atan2(v - fv, Math.abs(u - fu) + 0.05) * 9)) > 0.5 ? 0.6 : 0.15), BR, sm(-0.14, 0, ds) * 0.5);   // banded rays, pale rim
  return fishBody({
    sl: 9.0, total: 11.2, cell: 0.125, eyeRing: mul3(C(0x8a7040), 1.1), box: [3.3, -1.5, 1.7], nose: 0.1,
    top: hsc([[0, 0.02], [0.04, 0.065], [0.12, 0.098], [0.25, 0.108], [0.45, 0.092], [0.7, 0.056], [1, 0.034]], 1.2),
    bot: hsc([[0, -0.03], [0.04, -0.058], [0.12, -0.072], [0.25, -0.078], [0.5, -0.062], [0.8, -0.04], [1, -0.03]], 1.2),
    wid: [[0, 0.045], [0.04, 0.09], [0.12, 0.112], [0.25, 0.1], [0.45, 0.078], [0.7, 0.05], [1, 0.025]],
    eyes: [{ s: 0.13, v: 0.72, r: 0.3, up: 0.8, fwd: 0.1, inner: C(0xb59a58), outer: C(0x3c2a0e), limb: C(0x120e06), pupil: [0.5, 0.5] }],
    fins: ({ Z, TY, BY, sec }) => {
      const [cy, hy, ww] = sec(0.2), [cy2, hy2, ww2] = sec(0.18);
      const y0 = TY(0.4), y1 = TY(0.6), by = BY(0.62);
      return [
        medianFin(caudalPoly(Z(0.93), 2.0, 0.16, 0.95, (r) => 1 - 0.14 * (1 - r) ** 1.3), t, finGrad('bullhead', 'caudal', Z(0.9), 0, 2.3, { rays: 11, amt: 0.4 })),
        medianFin([[Z(0.3), TY(0.3) - 0.1], [Z(0.33), y0 + 0.3], [Z(0.4), y0 + 0.5], [Z(0.46), y0 + 0.35], [Z(0.49), TY(0.49) - 0.1]], t, finGrad('bullhead', 'dorsal1', Z(0.4), y0, 0.8, { rays: 10 })),
        medianFin([[Z(0.51), TY(0.51) - 0.1], [Z(0.54), y1 + 0.55], [Z(0.66), y1 + 0.85], [Z(0.78), y1 + 0.55], [Z(0.88), TY(0.88) - 0.05]], t, finGrad('bullhead', 'dorsal2', Z(0.65), y1, 1.4, { rays: 14 })),
        medianFin([[Z(0.6), BY(0.6) + 0.08], [Z(0.64), by - 0.5], [Z(0.74), by - 0.62], [Z(0.84), by - 0.3], [Z(0.9), BY(0.9) + 0.06]], t, finGrad('bullhead', 'anal', Z(0.74), by, 1.1, { rays: 12 })),
        ...pairFin({ x: ww * 0.9, y: cy - hy * 0.1, z: Z(0.2), dir: [1, 0.2, -0.55], poly: [[-0.1, -0.3], [0.3, 0.5], [0.9, 0.9], [1.3, 0.75], [1.5, 1.05], [2.0, 0.85], [2.05, 0.5], [2.35, 0.3], [2.1, -0.05], [2.3, -0.35], [1.8, -0.6], [1.5, -0.95], [1.1, -0.7], [0.7, -0.9], [0.3, -0.6]].map(([u, v]) => [u * 0.78, v * 0.78]), t, paint: finGrad('bullhead', 'pectoral', 0, 0, 2.2, { rays: 12 }), up: [0, 1, 0.25] }),
        ...pairFin({ x: ww2 * 0.55, y: cy2 - hy2 * 0.9, z: Z(0.24), dir: [0.5, -0.4, -1], poly: [[-0.05, -0.1], [0.05, 0.3], [0.4, 0.55], [0.9, 0.5], [1.25, 0.15], [1.1, -0.25], [0.6, -0.4], [0.2, -0.3]], t, paint: finGrad('bullhead', 'anal', 0, 0, 1.1, { rays: 8 }) }),
      ];
    },
    paint: mapPaint('bullhead', 1.15, 1.4),
    finish: { finOpacity: 0.92, coat: 0.3, sheen: 0 },
  });
};

export const STREAMFISH = { tanichthys, zacco, bedotia, hillloach, bullhead };
