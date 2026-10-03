// Schooling and show fish: neon, cardinal and ember tetras, guppy and betta. Face +z, centred on the origin, cm.
// The tail end undulates in the shader (rig.x: 0 at the snout … 1 at the tail tip); the rest pose is straight.
//
// Every fish is a LOFT (a body cross-section that changes along z: back, belly and width curves) plus fins built
// as thin SHEETS: an exact extrusion of a 2D outline. A sheet must be at least ~1.5 mesher cells thick or the
// surface nets tears it, so each species picks `cell` and the fin half-thickness `t` together (t * 2 >= 1.5 * cell).
// Fins carry material M.FIN (see-through, second blended pass), the stripe of a neon is M.IRIDESCENT, and the eyes
// are analytic (finish.eyes) so the pupil and the catchlight are exact at any mesh detail.
// bottom-fish.js reuses fishBody, sheet, pairFin, caudalPoly and fanPaint from here.
import { smin, clamp01, lerp3, mul3, C, cells, cap, M } from '../kit.js';

export const sm = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const norm3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// Cubic Hermite through control points [[s, value], …] (Catmull-Rom tangents), flat beyond both ends.
export function curve(pts) {
  const n = pts.length, m = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    m.push(b[0] === a[0] ? 0 : (b[1] - a[1]) / (b[0] - a[0]));
  }
  return (s) => {
    if (s <= pts[0][0]) return pts[0][1];
    if (s >= pts[n - 1][0]) return pts[n - 1][1];
    let i = 0;
    while (s > pts[i + 1][0]) i++;
    const h = pts[i + 1][0] - pts[i][0], t = (s - pts[i][0]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * pts[i][1] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * pts[i + 1][1] + (t3 - t2) * h * m[i + 1];
  };
}

// Signed distance to a polygon (exact, negative inside).
function polySD(P, u, v) {
  let d = (u - P[0][0]) ** 2 + (v - P[0][1]) ** 2, s = 1;
  for (let i = 0, j = P.length - 1; i < P.length; j = i, i++) {
    const ex = P[j][0] - P[i][0], ey = P[j][1] - P[i][1], wx = u - P[i][0], wy = v - P[i][1];
    const h = clamp01((wx * ex + wy * ey) / (ex * ex + ey * ey || 1));
    const bx = wx - ex * h, by = wy - ey * h;
    d = Math.min(d, bx * bx + by * by);
    const c1 = v >= P[i][1], c2 = v < P[j][1], c3 = ex * wy > ey * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
  }
  return s * Math.sqrt(d);
}

// A fin: a flat plate through `org` spanned by e1 (u) and e2 (v), outline `poly` in (u, v), half-thickness t.
// d(x,y,z) is the exact extrusion distance; local(x,y,z) gives [u, v, outline distance] for painting.
export function sheet({ org = [0, 0, 0], e1, e2, poly, t = 0.05, paint }) {
  const E1 = norm3(e1), k = dot3(e2, E1), E2 = norm3([e2[0] - E1[0] * k, e2[1] - E1[1] * k, e2[2] - E1[2] * k]), N = cross3(E1, E2);
  let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
  for (const [u, v] of poly) { u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
  const d = (x, y, z) => {
    const rx = x - org[0], ry = y - org[1], rz = z - org[2];
    const w = Math.abs(rx * N[0] + ry * N[1] + rz * N[2]) - t;
    const u = rx * E1[0] + ry * E1[1] + rz * E1[2], v = rx * E2[0] + ry * E2[1] + rz * E2[2];
    const du = Math.max(u0 - u, 0, u - u1), dv = Math.max(v0 - v, 0, v - v1);
    if (w > 0.25 || du > 0.25 || dv > 0.25) return Math.hypot(du, dv, Math.max(w, 0));   // far: a lower bound is enough
    const ds = polySD(poly, u, v) + t;                       // the outline shrunk by t, then swept by a ball of radius t: a smooth rounded rim
    return (ds > 0 ? Math.hypot(ds, w + t) : w + t) - t;
  };
  const local = (x, y, z) => {
    const rx = x - org[0], ry = y - org[1], rz = z - org[2];
    const u = rx * E1[0] + ry * E1[1] + rz * E1[2], v = rx * E2[0] + ry * E2[1] + rz * E2[2];
    return [u, v, polySD(poly, u, v)];
  };
  return { d, local, paint };
}
// A median fin drawn in the (z, y) plane of the body: poly points are [z, y] in model coordinates.
export const medianFin = (poly, t, paint) => sheet({ e1: [0, 0, 1], e2: [0, 1, 0], poly, t, paint });
// A left/right pair: dir is the outward-and-backward direction of the fin's u axis on the +x side.
export const pairFin = ({ x, y, z, dir, poly, t, paint, up = [0, 1, 0] }) => [-1, 1].map((sd) => sheet({ org: [sd * x, y, z], e1: [sd * dir[0], dir[1], dir[2]], e2: up, poly, t, paint }));

// Tail fin outline (z, y): root at z = zc with half-height h0, tips h1 high at len·trail(1) behind it, trailing edge trail(r) (r = 0 on
// the axis … 1 at the tips) as a fraction of len. The leading edge is a power curve (lead 1 = straight).
export function caudalPoly(zc, len, h0, h1, trail, lead = 1.2, n = 5, m = 7) {
  const up = [], tip = trail(1);
  for (let i = 0; i <= n; i++) { const f = i / n; up.push([zc - len * tip * f, h0 + (h1 - h0) * Math.pow(f, lead)]); }
  for (let j = 1; j <= m; j++) { const r = 1 - j / m; up.push([zc - len * trail(r), h1 * r]); }
  return up.concat(up.slice(0, -1).reverse().map(([z, y]) => [z, -y]));
}
// Faint fin rays fanning out of a focus f = [u, v], and a coloured rim.
export const fanPaint = ({ f, base, ray, edge, n = 22, amt = 0.3, edgeAmt = 0.5, edgeW = 0.09 }) => (u, v, ds) => {
  const a = Math.atan2(v - f[1], Math.abs(u - f[0]) + 0.05);
  const c = lerp3(base, ray, (0.5 + 0.5 * Math.cos(a * n)) * amt);
  return edge ? lerp3(c, edge, sm(-edgeW, 0, ds) * edgeAmt) : c;
};

const RING = C(0x9aa4a2);
// Builds a fish definition. o: sl (body length, snout to end of the tail stalk), total (snout to tail tip), top/bot/wid (profile
// curves [[s, fraction of sl]] with s 0 at the snout … 1 at the stalk; top > 0 > bot), eyes [{ s, v, r, … }], fins(ctx) → sheets,
// extra(x,y,z,|x|) → distance of extra body parts, paint(s, v, x, y, z, lat) → colour, iri(s, v) → true for the iridescent stripe,
// cell (mesher cell), box [half width, ymin, ymax].
export function fishBody(o) {
  const SL = o.sl, zs = o.total / 2, zTip = -o.total / 2, nose = o.nose ?? 0.07;
  const T = curve(o.top), B = curve(o.bot), W = curve(o.wid);
  let ps = 0, pcy = 0, phy = 0, pww = 0;
  const prof = (z) => {
    const s = (zs - z) / SL, sc = s < 0 ? 0 : s > 1 ? 1 : s;
    const q = sc < nose ? 1 - sc / nose : 0, g = Math.sqrt(Math.max(1 - q * q, 0.0016));
    const top = T(sc) * SL, bot = B(sc) * SL;
    ps = s; pcy = (top + bot) / 2; phy = Math.max(((top - bot) / 2) * g, 0.015); pww = Math.max(W(sc) * SL * g, 0.015);
  };
  const Z = (s) => zs - s * SL, TY = (s) => T(clamp01(s)) * SL, BY = (s) => B(clamp01(s)) * SL;
  const sec = (s) => { prof(Z(s)); return [pcy, phy, pww]; };

  // Eyes: a ball set into the head, drawn analytically by the material.
  const eyeList = [], eyeSpecs = [];
  for (const e of o.eyes ?? []) {
    const z = Z(e.s), [cy, hy, ww] = sec(e.s), x = ww * Math.sqrt(Math.max(1 - e.v * e.v, 0)), y = cy + hy * e.v;
    const n = norm3([x / (ww * ww), (y - cy) / (hy * hy), 0]), sink = e.sink ?? 0.45;
    const c = [x - n[0] * sink * e.r, y - n[1] * sink * e.r, z], axis = norm3([n[0], n[1] + (e.up ?? 0), (e.fwd ?? 0.3)]);
    const h = norm3(cross3(axis, Math.abs(axis[1]) > 0.85 ? [0, 0, 1] : [0, 1, 0]));
    eyeList.push({ c, r: e.r });
    eyeSpecs.push({ c, r: e.r, axis, h, w: norm3(cross3(axis, h)), pupil: e.pupil ?? [0.55, 0.55], inner: e.inner ?? C(0xd6d3bd), outer: e.outer ?? C(0x8c9694), rim: C(0x030303), limb: e.limb ?? C(0x4a5250), seed: e.seed ?? 3 });
  }

  const bodyD = (x, y, z) => {
    prof(z);
    const dy = y - pcy, k0 = Math.hypot(x / pww, dy / phy), k1 = Math.hypot(x / (pww * pww), dy / (phy * phy));
    let d = k1 > 1e-6 ? (k0 * (k0 - 1)) / k1 : -Math.min(pww, phy);
    if (ps < 0) d = Math.max(d, -ps * SL); else if (ps > 1) d = Math.max(d, (ps - 1) * SL);
    const ax = Math.abs(x);
    for (let i = 0; i < eyeList.length; i++) {
      const e = eyeList[i];
      if (Math.abs(z - e.c[2]) < e.r * 1.7) d = smin(d, Math.hypot(ax - e.c[0], y - e.c[1], z - e.c[2]) - e.r, 0.025);
    }
    if (o.extra) d = smin(d, o.extra(x, y, z, ax), 0.04);
    return d;
  };
  const fins = o.fins ? o.fins({ Z, TY, BY, sec, SL, zs, zTip }) : [];
  const sdf = (x, y, z) => {
    let d = bodyD(x, y, z);
    for (let i = 0; i < fins.length; i++) d = smin(d, fins[i].d(x, y, z), 0.06);
    return d;
  };
  const FK = 0.04;    // a surface point farther than this from the body proper is on a fin
  const onFin = (x, y, z) => {
    if (bodyD(x, y, z) <= FK) return null;
    let best = null, bd = 1e9;
    for (const f of fins) { const dd = f.d(x, y, z); if (dd < bd) { bd = dd; best = f; } }
    return best;
  };
  const color = (x, y, z) => {
    const f = onFin(x, y, z);
    if (f) { const [u, v, ds] = f.local(x, y, z); return f.paint(u, v, ds, x, y, z); }
    const ax = Math.abs(x);
    for (const e of eyeList) if (Math.hypot(ax - e.c[0], y - e.c[1], z - e.c[2]) < e.r * 1.06) return o.eyeRing ?? RING;
    prof(z);
    return o.paint(ps, Math.max(-1.2, Math.min(1.2, (y - pcy) / phy)), x, y, z, x / pww);
  };
  const mat = (x, y, z) => {
    if (onFin(x, y, z)) return M.FIN;
    if (!o.iri) return M.SKIN;
    prof(z);
    return o.iri(ps, Math.max(-1.2, Math.min(1.2, (y - pcy) / phy))) ? M.IRIDESCENT : M.SKIN;
  };
  return {
    sdf, color, mat, cell: o.cell, lo: [-o.box[0], o.box[1], zTip - 0.15], hi: [o.box[0], o.box[2], zs + 0.2],
    rig: (x, y, z) => [clamp01((zs - z) / (zs - zTip)), 0, 0],
    finish: { rough: 0.3, coat: 0.6, coatRough: 0.1, grain: 12, bump: 0.01, grainAmt: 0.3, tone: 0.03, flutter: 0.02, finOpacity: 0.42, eyes: eyeSpecs, ...o.finish },
  };
}

// ---- Tetras ---------------------------------------------------------------------------------------------------
const CLEAR = C(0xb4c0c6), CLEAR_RAY = C(0x7d8c96);
const clearFins = ({ Z, TY, BY, sec, SL }, t, o) => {
  const paint = fanPaint({ f: [Z(0.9), 0], base: CLEAR, ray: CLEAR_RAY, edge: o.edge, n: 14, amt: 0.22 });
  const fp = (fz, fy) => fanPaint({ f: [fz, fy], base: CLEAR, ray: CLEAR_RAY, edge: o.edge, n: 9, amt: 0.2, edgeAmt: 0.3 });
  const zc = Z(0.93), y0 = TY(0.5), y1 = BY(0.7);
  const [cy, hy, ww] = sec(0.27);
  return [
    // tail: forked, translucent
    medianFin(caudalPoly(zc, o.tail, 0.1, o.tailH, (r) => 1 - 0.5 * (1 - r) ** 1.4), t, o.tailPaint ?? paint),
    // dorsal: a small triangle above the middle of the back
    medianFin([[Z(0.44), TY(0.44) - 0.07], [Z(0.455), y0 + o.dor * 0.4], [Z(0.49), y0 + o.dor * 0.85], [Z(0.54), y0 + o.dor], [Z(0.6), y0 + o.dor * 0.6], [Z(0.66), TY(0.66) - 0.07]], t, fp(Z(0.55), y0)),
    // anal: a falcate fin under the rear belly
    medianFin([[Z(0.53), BY(0.53) + 0.07], [Z(0.55), y1 - o.anal], [Z(0.62), y1 - o.anal * 0.85], [Z(0.72), y1 - o.anal * 0.5], [Z(0.82), y1 - o.anal * 0.2], [Z(0.9), BY(0.9) + 0.07]], t, fp(Z(0.7), y1)),
    ...pairFin({ x: ww * 0.8, y: cy - hy * 0.45, z: Z(0.27), dir: [0.45, -0.1, -1], poly: [[-0.06, -0.05], [0.05, 0.1], [0.26, 0.11], [0.4, 0.02], [0.3, -0.08], [0.08, -0.09]], t, paint: fp(Z(0.27), cy) }),
  ];
};

// Neon and cardinal share one recipe: silver-olive body, an electric blue stripe from the eye to the tail, red on the lower flank
// (rear half in the neon, the whole length in the cardinal).
function tetraBody(o) {
  const stripe = (s, v) => sm(o.s0, o.s0 + 0.1, s) * (1 - sm(o.s1 - 0.1, o.s1, s)) * sm(-0.1, 0.14, v) * (1 - sm(0.32, 0.6, v));
  const back = C(0x3b4a2c), flank = C(0xb9c6c5), belly = C(0xe9ebe3), blue0 = C(0x22c8ff), blue1 = C(0x2f6bff);
  const t = o.t, len = o.sl * 0.98;
  return fishBody({
    sl: o.sl, total: o.total, cell: o.cell, box: [0.55, -0.9, 0.9], nose: 0.08,
    top: [[0, 0.015], [0.05, 0.05], [0.12, 0.09], [0.25, 0.128], [0.4, 0.14], [0.6, 0.125], [0.8, 0.075], [1, 0.04]],
    bot: [[0, -0.02], [0.05, -0.045], [0.12, -0.07], [0.25, -0.095], [0.4, -0.105], [0.6, -0.095], [0.8, -0.055], [1, -0.03]],
    wid: [[0, 0.012], [0.05, 0.035], [0.12, 0.056], [0.25, 0.074], [0.4, 0.079], [0.6, 0.068], [0.8, 0.04], [1, 0.02]],
    eyes: [{ s: 0.1, v: 0.14, r: 0.155, sink: 0.55 }],
    fins: (ctx) => clearFins(ctx, t, { tail: o.total / 2 + ctx.Z(0.93) - 0.02 + 0.02, tailH: o.tailH, dor: o.dor, anal: o.anal }),
    paint: (s, v) => {
      let c = lerp3(flank, back, sm(0.2, 0.95, v));
      c = lerp3(c, belly, sm(-0.3, -0.95, v) * 0.85);
      c = lerp3(c, mul3(o.red, 2.7), sm(o.redFrom, o.redFrom + 0.14, s) * (1 - sm(-0.1, 0.16, v)));
      return lerp3(c, mul3(lerp3(blue0, blue1, clamp01((s - 0.1) / 0.8)), 2.2), stripe(s, v));
    },
    finish: { sheen: 0, finOpacity: 0.4 },
  });
}
export const TETRAS = {
  neon: () => tetraBody({ sl: 2.65, total: 3.3, cell: 0.057, t: 0.048, tailH: 0.36, dor: 0.34, anal: 0.3, s0: 0.11, s1: 0.9, red: C(0xe3271c), redFrom: 0.5 }),
  cardinal: () => tetraBody({ sl: 2.85, total: 3.5, cell: 0.057, t: 0.048, tailH: 0.38, dor: 0.36, anal: 0.32, s0: 0.07, s1: 0.94, red: C(0xd8141f), redFrom: 0.1 }),
  ember: () => {
    const t = 0.043, orange = C(0xff5f0e), deep = C(0xd23a08), light = C(0xff9a3a), gold = C(0xff8a1e), FIN = C(0xffa050), FRAY = C(0xe0601a);
    return fishBody({
      sl: 1.75, total: 2.2, cell: 0.05, eyeRing: mul3(C(0xff9a3a), 2.0), box: [0.4, -0.6, 0.6], nose: 0.09,
      top: [[0, 0.02], [0.06, 0.07], [0.2, 0.12], [0.4, 0.135], [0.6, 0.12], [0.8, 0.075], [1, 0.04]],
      bot: [[0, -0.03], [0.06, -0.06], [0.2, -0.085], [0.4, -0.1], [0.6, -0.09], [0.8, -0.055], [1, -0.03]],
      wid: [[0, 0.02], [0.06, 0.05], [0.2, 0.072], [0.4, 0.078], [0.6, 0.066], [0.8, 0.04], [1, 0.02]],
      eyes: [{ s: 0.09, v: 0.1, r: 0.125, inner: C(0xffa447), outer: C(0xd85a1c), limb: C(0x7a2a10), pupil: [0.55, 0.55] }],
      fins: ({ Z, TY, BY, sec }) => {
        const p = (fz, fy) => fanPaint({ f: [fz, fy], base: FIN, ray: FRAY, n: 9, amt: 0.22 });
        const [cy, hy, ww] = sec(0.27);
        return [
          medianFin(caudalPoly(Z(0.93), Z(0.93) + 1.1, 0.08, 0.27, (r) => 1 - 0.45 * (1 - r) ** 1.4), t, p(Z(0.93), 0)),
          medianFin([[Z(0.44), TY(0.44) - 0.06], [Z(0.47), TY(0.5) + 0.34], [Z(0.62), TY(0.6) + 0.1], [Z(0.66), TY(0.66) - 0.06]], t, p(Z(0.55), TY(0.5))),
          medianFin([[Z(0.55), BY(0.55) + 0.06], [Z(0.57), BY(0.6) - 0.2], [Z(0.72), BY(0.7) - 0.1], [Z(0.9), BY(0.9) + 0.06]], t, p(Z(0.7), BY(0.7))),
          ...pairFin({ x: ww * 0.8, y: cy - hy * 0.45, z: Z(0.27), dir: [0.45, -0.1, -1], poly: [[-0.05, -0.04], [0.04, 0.08], [0.2, 0.09], [0.3, 0.01], [0.2, -0.06], [0.06, -0.07]], t, paint: p(Z(0.27), cy) }),
        ];
      },
      paint: (s, v) => {
        let c = lerp3(orange, deep, sm(0.35, 1, v));
        c = lerp3(c, light, sm(-0.3, -0.95, v) * 0.8);
        return mul3(lerp3(c, gold, (1 - sm(0.05, 0.24, s)) * 0.6), 2.9);
      },
      finish: { finOpacity: 0.38, sheen: 0 },
    });
  },
};

// ---- Celestial pearl danio (Danio margaritatus): a 2 cm steel-blue danio covered in pearly spots, with orange-red fins
// barred black and red, and an orange-red belly (the male). Same finish as the ember tetra, so it shares its material.
TETRAS.cpd = () => {
  const t = 0.043, steel = C(0x3e5468), deep = C(0x1d2a3a), pearl = C(0xf3e2b0), belly = C(0xff6a24), FIN = C(0xff6a28), BAR = C(0x1a0c08), RED = C(0xe02a14);
  // Barred fins: orange-red with two dark bars parallel to the body and a clear rim.
  const barred = (y0, dir) => (u, v, ds, x, y, z) => {
    const k = Math.abs(y - y0) * 7;                                    // distance out from the fin root
    let c = lerp3(FIN, RED, sm(1.2, 2.2, k));
    c = lerp3(c, BAR, Math.max(sm(0.35, 0.2, Math.abs(k - 0.8)), sm(0.35, 0.2, Math.abs(k - 2.0))) * 0.9);
    return lerp3(c, C(0xf8f0e0), sm(-0.06, 0.0, ds) * 0.5);
  };
  const tailPaint = (u, v, ds, x, y, z) => {
    let c = lerp3(FIN, RED, 0.4);
    c = lerp3(c, BAR, sm(0.06, 0.03, Math.abs(Math.abs(y) - 0.12)) * 0.85);   // the two dark bars of the tail
    return lerp3(c, C(0xf8f0e0), sm(-0.05, 0.0, ds) * 0.4);
  };
  return fishBody({
    sl: 1.75, total: 2.2, cell: 0.05, eyeRing: mul3(C(0x4a6070), 1.2), box: [0.4, -0.6, 0.6], nose: 0.09,
    top: [[0, 0.02], [0.06, 0.065], [0.2, 0.11], [0.4, 0.125], [0.6, 0.11], [0.8, 0.07], [1, 0.04]],
    bot: [[0, -0.03], [0.06, -0.06], [0.2, -0.085], [0.4, -0.1], [0.6, -0.085], [0.8, -0.05], [1, -0.03]],
    wid: [[0, 0.02], [0.06, 0.048], [0.2, 0.068], [0.4, 0.072], [0.6, 0.06], [0.8, 0.038], [1, 0.02]],
    eyes: [{ s: 0.09, v: 0.1, r: 0.125, inner: C(0xd8b060), outer: C(0x5a3a18), limb: C(0x1a1008), pupil: [0.55, 0.55] }],
    fins: ({ Z, TY, BY, sec }) => {
      const [cy, hy, ww] = sec(0.27);
      return [
        medianFin(caudalPoly(Z(0.93), Z(0.93) + 1.05, 0.08, 0.26, (r) => 1 - 0.45 * (1 - r) ** 1.4), t, tailPaint),
        medianFin([[Z(0.5), TY(0.5) - 0.06], [Z(0.53), TY(0.55) + 0.3], [Z(0.68), TY(0.66) + 0.14], [Z(0.72), TY(0.72) - 0.06]], t, barred(TY(0.6), 1)),
        medianFin([[Z(0.55), BY(0.55) + 0.06], [Z(0.57), BY(0.6) - 0.24], [Z(0.74), BY(0.72) - 0.12], [Z(0.88), BY(0.88) + 0.06]], t, barred(BY(0.65), -1)),
        ...pairFin({ x: ww * 0.8, y: cy - hy * 0.45, z: Z(0.27), dir: [0.45, -0.1, -1], poly: [[-0.05, -0.04], [0.04, 0.08], [0.2, 0.09], [0.3, 0.01], [0.2, -0.06], [0.06, -0.07]], t, paint: (u, v, ds) => lerp3(FIN, C(0xf8f0e0), 0.35) }),
      ];
    },
    paint: (s, v, x, y, z) => {
      let c = lerp3(steel, deep, sm(0.3, 1, v));
      c = lerp3(c, belly, sm(-0.35, -0.9, v) * sm(0.1, 0.3, s) * (1 - sm(0.6, 0.8, s)) * 0.85);
      c = lerp3(c, pearl, sm(0.3, 0.16, cells(x, y, z, 7.5)) * sm(0.08, 0.2, s) * (1 - sm(-0.4, -0.7, v)) * 0.95);   // pearl spots big enough for the coarse mesh
      return mul3(c, 2.2);
    },
    finish: { finOpacity: 0.38, sheen: 0 },
  });
};

// ---- Everglades pygmy sunfish (Elassoma evergladei): a 3 cm, deep-bodied little sunfish with a rounded tail and big soft
// dorsal and anal fins set far back; a displaying male is velvet black with electric-blue spangles on flanks and fins.
TETRAS.pygmy = () => {
  const t = 0.05, black = C(0x0c0d12), brown = C(0x2a2216), blue = C(0x3ab8ff), blue2 = C(0x7ae0ff), FIN = C(0x14161c);
  const spangles = (x, y, z, k) => sm(0.2, 0.1, cells(x * k, y * k, z * k, 6));
  const finPaint = (u, v, ds, x, y, z) => lerp3(lerp3(FIN, blue, spangles(x, y, z, 2.2) * 0.85), blue2, sm(-0.05, 0.0, ds) * 0.6);
  return fishBody({
    sl: 2.4, total: 3.1, cell: 0.058, eyeRing: mul3(C(0x2a90d0), 1.4), box: [0.55, -0.9, 0.95], nose: 0.1,
    top: [[0, 0.03], [0.06, 0.1], [0.2, 0.18], [0.4, 0.21], [0.6, 0.18], [0.8, 0.11], [1, 0.07]],
    bot: [[0, -0.04], [0.06, -0.1], [0.2, -0.16], [0.4, -0.19], [0.6, -0.16], [0.8, -0.1], [1, -0.07]],
    wid: [[0, 0.03], [0.06, 0.06], [0.2, 0.085], [0.4, 0.09], [0.6, 0.075], [0.8, 0.05], [1, 0.03]],
    eyes: [{ s: 0.1, v: 0.2, r: 0.16, inner: C(0x40a8e0), outer: C(0x1a3050), limb: C(0x080a10), pupil: [0.5, 0.5] }],
    fins: ({ Z, TY, BY, sec }) => {
      const [cy, hy, ww] = sec(0.27);
      return [
        medianFin(caudalPoly(Z(0.92), Z(0.92) + 1.0, 0.12, 0.42, (r) => 0.7 + 0.3 * Math.sqrt(Math.max(0, 1 - r * r)), 1.0), t, finPaint),
        medianFin([[Z(0.42), TY(0.42) - 0.06], [Z(0.46), TY(0.46) + 0.3], [Z(0.62), TY(0.6) + 0.5], [Z(0.8), TY(0.78) + 0.42], [Z(0.88), TY(0.88) - 0.06]], t, finPaint),
        medianFin([[Z(0.58), BY(0.58) + 0.06], [Z(0.62), BY(0.62) - 0.36], [Z(0.78), BY(0.76) - 0.34], [Z(0.88), BY(0.88) + 0.06]], t, finPaint),
        ...pairFin({ x: ww * 0.85, y: cy - hy * 0.3, z: Z(0.25), dir: [0.5, -0.1, -1], poly: [[-0.05, -0.05], [0.05, 0.12], [0.28, 0.14], [0.4, 0.02], [0.28, -0.09], [0.06, -0.1]], t, paint: (u, v, ds) => lerp3(C(0x8a9098), FIN, 0.4) }),
      ];
    },
    paint: (s, v, x, y, z) => {
      let c = lerp3(lerp3(brown, black, 0.7), black, sm(-0.3, 0.5, v));
      c = lerp3(c, lerp3(blue, blue2, sm(0.15, 0.05, cells(x * 2.4, y * 2.4, z * 2.4, 5))), spangles(x, y, z, 1.8) * sm(0.15, 0.3, s) * (1 - sm(-0.6, -0.9, v)) * 0.9);
      return mul3(c, 1.8);
    },
    finish: { finOpacity: 0.7, sheen: 0 },
  });
};

// ---- Guppy: a slender male with a big delta tail, a tall dorsal and colour spots ---------------------------------------
// Morph palettes (sRGB hex, no values above 1.0). tail = [root, middle, rim] colours across the fan, rimC = dark edge of the
// fan, spot / spotAmt = black spots on the tail and dorsal, dor = [low, middle, tip] dorsal fin colours, silver/back/belly =
// flank tints, rear = colour of the rear body, patch = iridescent flank patch, ring = eye ring.
const GUPPY_MORPHS = {
  red: { tail: [0xff7a1e, 0xff3018, 0xe01422], rimC: 0x7a1010, spot: 0x1a0a08, spotAmt: 0.8, dor: [0xffb070, 0xff6a2a, 0xe0281c], silver: 0x9ba889, back: 0x59634a, belly: 0xe1e2d0, rear: 0xff5a1a, patch: 0x3fe3a4, ring: 0xc8b46a },
  purple: { tail: [0xdc70ff, 0xa448f8, 0x7030e0], rimC: 0x3a1a78, spot: 0x140a24, spotAmt: 0.7, dor: [0xe0b0ff, 0xb060f0, 0x7a2ad0], silver: 0x9a94ac, back: 0x524a66, belly: 0xe4dcec, rear: 0x9a3ae0, patch: 0x60b0ff, ring: 0xb8a8d0 },
  blue: { tail: [0x5ad0ff, 0x2c80ff, 0x2048e8], rimC: 0x14308c, spot: 0x0a0e24, spotAmt: 0.7, dor: [0xa8e0ff, 0x4aa0ff, 0x1c44e0], silver: 0x8fa4b4, back: 0x43566a, belly: 0xdce6ec, rear: 0x2a88f0, patch: 0x3ae8ff, ring: 0x9ab8d0 },
  gold: { tail: [0xffea50, 0xffcc1c, 0xf8ac0a], rimC: 0xa87010, spot: 0x5a3a08, spotAmt: 0.3, dor: [0xfff0a0, 0xffd640, 0xf0aa10], silver: 0xe6c454, back: 0xb08a30, belly: 0xfff0b4, rear: 0xffc818, patch: 0xfff4a8, ring: 0xf0d070 },
};
const guppyMorph = (k) => () => {
  const PAL = GUPPY_MORPHS[k];
  const t = 0.05, silver = C(PAL.silver), backC = C(PAL.back), bellyC = C(PAL.belly), rearC = C(PAL.rear), patch = C(PAL.patch), spot = C(PAL.spot), rimC = C(PAL.rimC);
  const [T0, T1, T2] = PAL.tail.map(C), [D0, D1, D2] = PAL.dor.map(C);
  const tailPaint = (u, v, ds, x, y, z) => {
    const f = clamp01((-0.42 - z) / 1.13);                                           // 0 at the root ... 1 at the rim
    let c = lerp3(T0, T1, sm(0.0, 0.3, f));
    c = lerp3(c, T2, sm(0.35, 0.9, f + (y > 0 ? 0.0 : 0.12)));
    c = lerp3(c, spot, sm(0.22, 0.14, cells(x, y, z, 3.6)) * PAL.spotAmt * sm(0.15, 0.4, f));
    return lerp3(c, rimC, sm(-0.14, 0.0, ds) * 0.7);                                // dark rim
  };
  const dorPaint = (u, v, ds, x, y, z) => {
    let c = lerp3(lerp3(D0, D1, sm(0.2, 0.5, v)), D2, sm(0.4, 0.8, v) * 0.7);
    c = lerp3(c, spot, sm(0.2, 0.12, cells(x, y, z, 6)) * PAL.spotAmt * 0.8);
    return lerp3(c, rimC, sm(-0.1, 0.0, ds) * 0.4);
  };
  return fishBody({
    sl: 2.1, total: 3.1, cell: 0.058, eyeRing: C(PAL.ring), box: [0.5, -0.9, 0.95], nose: 0.08,
    top: [[0, 0.02], [0.06, 0.07], [0.2, 0.11], [0.4, 0.12], [0.6, 0.105], [0.8, 0.075], [1, 0.05]],
    bot: [[0, -0.03], [0.06, -0.06], [0.2, -0.08], [0.4, -0.09], [0.6, -0.08], [0.8, -0.055], [1, -0.04]],
    wid: [[0, 0.02], [0.06, 0.05], [0.2, 0.065], [0.4, 0.07], [0.6, 0.06], [0.8, 0.04], [1, 0.03]],
    eyes: [{ s: 0.09, v: 0.15, r: 0.14, inner: C(0xe6c46a), outer: C(0x9a7a3a), limb: C(0x3a2a10) }],
    extra: (x, y, z, ax) => (z < 0.6 && z > -0.45 ? cap([x, y, z], [0, -0.15, 0.42], [0, -0.3, -0.2], 0.056, 0.046)[0] : 1),    // gonopodium
    fins: ({ Z, TY, BY, sec }) => {
      const [cy, hy, ww] = sec(0.25);
      const clear = fanPaint({ f: [Z(0.3), cy], base: lerp3(C(0xd9d9c8), T0, 0.18), ray: C(0x8a8a78), n: 14, amt: 0.3 });
      const y0 = TY(0.5);
      return [
        medianFin(caudalPoly(Z(0.93), Z(0.93) + 1.55, 0.09, 0.66, (r) => 0.82 + 0.18 * r, 1.0), t, tailPaint),
        medianFin([[Z(0.44), TY(0.44) - 0.07], [Z(0.45), y0 + 0.22], [Z(0.48), y0 + 0.42], [Z(0.54), y0 + 0.53], [Z(0.62), y0 + 0.5], [Z(0.68), y0 + 0.36], [Z(0.72), y0 + 0.16], [Z(0.7), TY(0.7) - 0.07]], t, dorPaint),
        medianFin([[Z(0.72), BY(0.72) + 0.06], [Z(0.76), BY(0.8) - 0.22], [Z(0.88), BY(0.9) - 0.15], [Z(0.92), BY(0.92) + 0.06]], t, clear),
        ...pairFin({ x: ww * 0.8, y: cy - hy * 0.4, z: Z(0.25), dir: [0.45, -0.1, -1], poly: [[-0.05, -0.04], [0.05, 0.1], [0.28, 0.11], [0.42, 0.02], [0.3, -0.08], [0.08, -0.09]], t, paint: clear }),
      ];
    },
    paint: (s, v, x, y, z) => {
      let c = lerp3(silver, backC, sm(0.2, 0.95, v));
      c = lerp3(c, bellyC, sm(-0.3, -0.95, v) * 0.8);
      c = lerp3(c, patch, sm(0.3, 0.42, s) * (1 - sm(0.5, 0.62, s)) * sm(-0.4, 0.0, v) * (1 - sm(0.3, 0.6, v)) * 0.8);
      c = lerp3(c, rearC, sm(0.52, 0.7, s));
      return lerp3(c, spot, sm(0.2, 0.12, cells(x * 1.3, y * 1.3, z * 1.3, 4.2)) * sm(0.45, 0.65, s) * PAL.spotAmt * 0.85);
    },
    finish: { finOpacity: 0.62, flutter: 0.03 },
  });
};
TETRAS.guppy = guppyMorph('red');
for (const k of Object.keys(GUPPY_MORPHS)) TETRAS[`guppy:${k}`] = guppyMorph(k);

// ---- Betta: elongate body, huge veil tail and long flowing fins ---------------------------------------------------------------
// Morph palettes (sRGB hex, no values above 1.0). back/dark/belly = body tints (dorsal, darkest back, underside), rear = tail
// stalk, fin = [base, outer, highlight, ray, edge] of the veil fins, pale = tip of the ventral "feelers", ring = eye ring,
// finOp = fin opacity (the cellophane's fins are nearly clear), gill = pink gill / belly flush (cellophane).
const BETTA_MORPHS = {
  red: { back: 0xb0142c, dark: 0x5e0a1a, belly: 0xc02848, rear: 0xe02434, fin: [0xb81030, 0xff3444, 0xff7a66, 0x5a0618, 0x780c22], pale: 0xf0a0a8, ring: 0x7a2030, finOp: 0.62, gill: null },
  blue: { back: 0x1c34d0, dark: 0x0a1468, belly: 0x3c62e0, rear: 0x2a70f0, fin: [0x1424b8, 0x2f84ff, 0x70d0ff, 0x0a1060, 0x0c1268], pale: 0xa8c8ff, ring: 0x3a58d8, finOp: 0.62, gill: null },
  purple: { back: 0x6a22c8, dark: 0x30106c, belly: 0xa43cc8, rear: 0x9a34d8, fin: [0x4a16a0, 0xb43ee0, 0xea7cff, 0x260a5c, 0x36087a], pale: 0xe0b0f4, ring: 0x7c3cd0, finOp: 0.62, gill: null },
  cellophane: { back: 0xf0d8d8, dark: 0xddbcc6, belly: 0xf8e8e4, rear: 0xf4dcdc, fin: [0xf8e4e8, 0xfff0f2, 0xffffff, 0xd8b4c0, 0xf4ccd4], pale: 0xfff2f2, ring: 0xd8bcc6, finOp: 0.42, gill: 0xf4a0aa },
};
const bettaMorph = (k) => () => {
  const PAL = BETTA_MORPHS[k];
  const t = 0.064, backC = C(PAL.back), darkC = C(PAL.dark), bellyC = C(PAL.belly), rearC = C(PAL.rear), paleC = C(PAL.pale), gillC = PAL.gill && C(PAL.gill);
  const [navy, red, blueF, ink, crimson] = PAL.fin.map(C);
  const finPaint = (fu, fv, n = 20) => (u, v, ds, x, y, z) => {
    const a = Math.atan2(v - fv, Math.abs(u - fu) + 0.1), rad = Math.hypot(u - fu, v - fv);
    let c = lerp3(navy, red, sm(0.3, 0.9, rad * 0.7 + 0.15));
    c = lerp3(c, blueF, sm(0.1, 0.9, 0.5 + 0.5 * Math.cos(a * 5)) * 0.35 * sm(0.8, 1.6, rad));
    c = lerp3(c, ink, (0.5 + 0.5 * Math.cos(a * n)) * 0.22);
    return lerp3(c, crimson, sm(-0.25, 0.0, ds) * 0.7);
  };
  return fishBody({
    sl: 2.8, total: 5.1, cell: 0.078, eyeRing: C(PAL.ring), box: [0.9, -1.75, 1.75], nose: 0.07,
    top: [[0, 0.02], [0.07, 0.085], [0.2, 0.13], [0.45, 0.148], [0.7, 0.12], [1, 0.06]],
    bot: [[0, -0.03], [0.07, -0.07], [0.2, -0.105], [0.45, -0.125], [0.7, -0.1], [1, -0.055]],
    wid: [[0, 0.025], [0.07, 0.055], [0.2, 0.08], [0.45, 0.085], [0.7, 0.062], [1, 0.032]],
    eyes: [{ s: 0.085, v: 0.15, r: 0.21, inner: C(0xb8a25a), outer: C(0x3a3014), limb: C(0x141008), pupil: [0.5, 0.5] }],
    fins: ({ Z, TY, BY, sec }) => {
      const [cy, hy, ww] = sec(0.22);
      const y0 = TY(0.6), y1 = BY(0.6), zc = Z(0.94);
      return [
        medianFin(caudalPoly(zc, zc + 2.55, 0.14, 1.3, (r) => 0.5 + 0.5 * Math.sqrt(Math.max(1 - r * r, 0)), 1.0, 6, 9), t, finPaint(zc, 0)),
        medianFin([[Z(0.52), TY(0.52) - 0.08], [Z(0.54), y0 + 0.55], [Z(0.64), y0 + 0.95], [Z(0.78), y0 + 0.8], [Z(0.9), y0 + 0.35], [Z(0.9), TY(0.9) - 0.08]], t, finPaint(Z(0.7), y0)),
        medianFin([[Z(0.34), BY(0.34) + 0.08], [Z(0.38), y1 - 0.3], [Z(0.52), y1 - 0.85], [Z(0.68), y1 - 1.25], [Z(0.84), y1 - 1.28], [Z(0.97), BY(0.97) - 0.6], [Z(0.97), BY(0.97) + 0.08]], t, finPaint(Z(0.6), y1)),
        ...pairFin({ x: 0.15, y: BY(0.24) + 0.05, z: Z(0.24), dir: [0.12, -0.5, -0.86], poly: [[-0.03, -0.11], [0.5, -0.1], [1.2, -0.06], [1.55, 0.0], [1.2, 0.07], [0.5, 0.12], [-0.03, 0.12]], t, paint: (u, v, ds) => lerp3(lerp3(red, paleC, sm(0.4, 1.4, u)), crimson, sm(-0.06, 0, ds) * 0.5) }),
        ...pairFin({ x: ww * 0.8, y: cy - hy * 0.3, z: Z(0.22), dir: [0.5, -0.1, -1], poly: [[-0.06, -0.06], [0.06, 0.13], [0.34, 0.15], [0.52, 0.02], [0.36, -0.1], [0.1, -0.11]], t, paint: fanPaint({ f: [0, 0], base: lerp3(C(0xc8a8b8), navy, 0.3), ray: lerp3(C(0x7a5a72), ink, 0.3), n: 14, amt: 0.3 }) }),
      ];
    },
    paint: (s, v) => {
      let c = lerp3(backC, darkC, sm(0.2, 1, v));
      c = lerp3(c, bellyC, sm(-0.2, -0.95, v) * 0.85);
      if (gillC) c = lerp3(c, gillC, sm(0.08, 0.16, s) * (1 - sm(0.3, 0.42, s)) * (1 - sm(0.1, 0.7, v)) * 0.7);   // pink flush over the gills
      return lerp3(c, rearC, sm(0.75, 1.0, s) * 0.5);
    },
    finish: { finOpacity: PAL.finOp, flutter: 0.03, sheen: 0 },
  });
};
TETRAS.betta = bettaMorph('red');
for (const k of Object.keys(BETTA_MORPHS)) TETRAS[`betta:${k}`] = bettaMorph(k);
