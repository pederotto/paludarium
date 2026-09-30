// Frogs, toads, tadpoles and egg clutches. All face +z, feet on y = 0, centimetres.
//
// The frogs are sculpted the way a modeller would rough one out:
//  - Loft: trunk, neck and head are ONE lofted solid (elliptical cross-sections whose centre
//    height, half width and upper / lower half heights are splined along z), so the snout,
//    jaw line, shoulders, sacral hump and rump flow into each other. The equator of the head
//    cross-sections is the mouth line.
//  - Limbs: chains of tapered capsules with flat oval palms / soles and digits that end in
//    round toe discs; the seated pose keeps the front legs straight under the chest and the
//    back legs folded in a Z beside the body (thigh forward, shin back, foot forward again).
//  - Eyes: a ball set into the head with a lid ring; iris and pupil are painted on the ball.
// Everything is designed at a reference size and scaled per species.
//
// The mesher builds the coarse mesh first and the fine one later; reading `cell` (coarse) or
// `hiScale` (fine) on the definition tells the SDF which of the two is being built (lodDef).
import { ell, smin, smax, vnoise, hash, C, lerp3, mul3, clamp01, M } from '../kit.js';

const PI = Math.PI;
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const norm3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

// ---- Splines and the loft (after the salamander bodies) --------------------------------

// Monotone cubic (PCHIP) through (xs, ys).
function pchip(xs, ys) {
  const n = xs.length, h = [], d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) { h[i] = xs[i + 1] - xs[i]; d[i] = (ys[i + 1] - ys[i]) / h[i]; }
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0;
    else { const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1]; m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]); }
  }
  return (x) => {
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const t = (x - xs[i]) / h[i], t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1];
  };
}

// A splined table along z: rows are [z, v1, v2, …]; sampled every `step` cm.
class Table {
  constructor(rows, step = 0.02, post = null) {
    const zs = rows.map((r) => r[0]), nc = rows[0].length - 1, fs = [];
    for (let k = 1; k <= nc; k++) fs.push(pchip(zs, rows.map((r) => r[k])));
    this.z0 = zs[0]; this.z1 = zs[zs.length - 1]; this.inv = 1 / step;
    this.n = Math.ceil((this.z1 - this.z0) / step);
    this.c = fs.map(() => new Float64Array(this.n + 2));
    const tmp = new Array(nc);
    for (let i = 0; i <= this.n + 1; i++) {
      const z = Math.min(this.z1, this.z0 + i * step);
      for (let k = 0; k < nc; k++) tmp[k] = fs[k](z);
      if (post) post(z, tmp);
      for (let k = 0; k < nc; k++) this.c[k][i] = tmp[k];
    }
    this.i = 0; this.f = 0;
  }
  at(z) {
    let s = (z - this.z0) * this.inv;
    s = s < 0 ? 0 : s > this.n ? this.n : s;
    const i = Math.floor(s);
    this.i = i; this.f = s - i;
    return this;
  }
  get(k) { const c = this.c[k]; return c[this.i] + (c[this.i + 1] - c[this.i]) * this.f; }
  slope(k) { const c = this.c[k]; return (c[this.i + 1] - c[this.i]) * this.inv; }
  v(k, z) { return this.at(z).get(k); }
}

// The lofted solid: rows [z, cy, a, bu, bd] = equator height, half width, upper and lower half height.
class Loft {
  constructor(rows, { front = 0.8, back = 0.5, minR = 0.015 } = {}) {
    const z0 = rows[0][0], z1 = rows[rows.length - 1][0];
    this.t = new Table(rows, 0.02, (z, v) => {
      let env = 1;
      if (z > z1 - front) { const t = (z1 - z) / front; env = Math.min(env, Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t)))); }
      if (z < z0 + back) { const t = (z - z0) / back; env = Math.min(env, Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t)))); }
      for (let k = 1; k < 4; k++) v[k] = Math.max(minR, v[k] * env);
    });
    this.z0 = z0; this.z1 = z1;
  }
  // First-order distance to the lofted surface (negative inside).
  d(x, y, z) {
    const T = this.t;
    let zc = z, dz = 0;
    if (z < this.z0) { zc = this.z0; dz = this.z0 - z; } else if (z > this.z1) { zc = this.z1; dz = z - this.z1; }
    T.at(zc);
    const cy = T.get(0), a = T.get(1), yy = y - cy, up = yy >= 0;
    const b = up ? T.get(2) : T.get(3);
    const da = T.slope(1), db = up ? T.slope(2) : T.slope(3), dcy = T.slope(0);
    const u = x / a, v = yy / b;
    const k0 = Math.sqrt(u * u + v * v);
    const k1 = Math.sqrt(u * u / (a * a) + v * v / (b * b));
    let d2;
    if (k1 < 1e-9) d2 = -Math.min(a, b);
    else {
      d2 = (k0 * (k0 - 1)) / k1;
      const N = u * u * da / a + v * v * db / b + v * dcy / b, r = N / k1;
      d2 /= Math.sqrt(1 + r * r);
    }
    if (dz > 0) return Math.hypot(Math.max(d2, 0), dz) + Math.min(d2, 0);
    return d2;
  }
  sect(z, out) { const T = this.t.at(Math.min(this.z1, Math.max(this.z0, z))); out[0] = T.get(0); out[1] = T.get(1); out[2] = T.get(2); out[3] = T.get(3); return out; }
  // Height of the upper surface at (x, z).
  top(x, z) { const s = this.sect(z, [0, 0, 0, 0]); return s[0] + s[2] * Math.sqrt(Math.max(0, 1 - (x * x) / (s[1] * s[1]))); }
}

// ---- Limbs: capsules, flat ovals (palms, soles, toe discs) and webs -----------------------

// Closest distance from p to triangle abc (Ericson).
function triDist(p, a, b, c) {
  const ab = sub3(b, a), ac = sub3(c, a), ap = sub3(p, a);
  const d1 = dot3(ab, ap), d2 = dot3(ac, ap);
  let q;
  if (d1 <= 0 && d2 <= 0) q = a;
  else {
    const bp = sub3(p, b), d3 = dot3(ab, bp), d4 = dot3(ac, bp);
    if (d3 >= 0 && d4 <= d3) q = b;
    else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); q = [a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v]; }
      else {
        const cp = sub3(p, c), d5 = dot3(ab, cp), d6 = dot3(ac, cp);
        if (d6 >= 0 && d5 <= d6) q = c;
        else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); q = [a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w]; }
          else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + d5 - d6); q = [b[0] + (c[0] - b[0]) * w, b[1] + (c[1] - b[1]) * w, b[2] + (c[2] - b[2]) * w]; }
            else { const den = 1 / (va + vb + vc), v = vb * den, w = vc * den; q = [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w]; }
          }
        }
      }
    }
    return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  }
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

class Limb {
  constructor() { this.a = []; this.p = []; this.w = []; this.t = 0; this.pt = [0, 0, 0]; }
  cap(a, b, ra, rb, t0 = 0, t1 = 1) { this.a.push(a[0], a[1], a[2], b[0], b[1], b[2], ra, rb, t0, t1); return this; }
  chain(pts, radii, t0 = 0, t1 = 1) {
    const n = pts.length - 1;
    for (let i = 0; i < n; i++) this.cap(pts[i], pts[i + 1], radii[i], radii[i + 1], t0 + ((t1 - t0) * i) / n, t0 + ((t1 - t0) * (i + 1)) / n);
    return this;
  }
  // A flat oval lying on the ground plane (long axis at angle `ang` from +z toward +x).
  pad(c, ang, hl, ht, hw, t) { this.p.push(c[0], c[1], c[2], Math.sin(ang), Math.cos(ang), hl, ht, hw, t); return this; }
  web(a, b, c, th, t) { this.w.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], th, t); return this; }
  done() {
    const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    const grow = (x, y, z, r) => { const q = [x, y, z]; for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], q[k] - r); mx[k] = Math.max(mx[k], q[k] + r); } };
    const A = this.A = Float64Array.from(this.a), Pd = this.P = Float64Array.from(this.p), W = this.W = Float64Array.from(this.w);
    for (let i = 0; i < A.length; i += 10) { grow(A[i], A[i + 1], A[i + 2], A[i + 6]); grow(A[i + 3], A[i + 4], A[i + 5], A[i + 7]); }
    for (let i = 0; i < Pd.length; i += 9) grow(Pd[i], Pd[i + 1], Pd[i + 2], Math.max(Pd[i + 5], Pd[i + 7]));
    for (let i = 0; i < W.length; i += 11) { grow(W[i], W[i + 1], W[i + 2], W[i + 9]); grow(W[i + 3], W[i + 4], W[i + 5], W[i + 9]); grow(W[i + 6], W[i + 7], W[i + 8], W[i + 9]); }
    this.c = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
    this.R = Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) / 2;
    return this;
  }
  near(x, y, z) { return Math.hypot(x - this.c[0], y - this.c[1], z - this.c[2]) - this.R; }
  // Distance; with `wantT` also leaves the along-limb parameter of the nearest part in this.t.
  d(x, y, z, wantT = false) {
    const A = this.A, Pd = this.P, W = this.W;
    let best = 1e9, bt = 0;
    for (let i = 0; i < A.length; i += 10) {
      const ax = A[i], ay = A[i + 1], az = A[i + 2], bax = A[i + 3] - ax, bay = A[i + 4] - ay, baz = A[i + 5] - az;
      const pax = x - ax, pay = y - ay, paz = z - az;
      let t = (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz + 1e-12);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = pax - bax * t, dy = pay - bay * t, dz = paz - baz * t;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - (A[i + 6] + (A[i + 7] - A[i + 6]) * t);
      if (d < best) { best = d; if (wantT) bt = A[i + 8] + (A[i + 9] - A[i + 8]) * t; }
    }
    for (let i = 0; i < Pd.length; i += 9) {
      const rx = x - Pd[i], rz = z - Pd[i + 2];
      const d = ell(rx * Pd[i + 3] + rz * Pd[i + 4], y - Pd[i + 1], rx * Pd[i + 4] - rz * Pd[i + 3], Pd[i + 5], Pd[i + 6], Pd[i + 7]);
      if (d < best) { best = d; if (wantT) bt = Pd[i + 8]; }
    }
    for (let i = 0; i < W.length; i += 11) {
      const d = triDist([x, y, z], [W[i], W[i + 1], W[i + 2]], [W[i + 3], W[i + 4], W[i + 5]], [W[i + 6], W[i + 7], W[i + 8]]) - W[i + 9];
      if (d < best) { best = d; if (wantT) bt = W[i + 10]; }
    }
    this.t = bt;
    return best;
  }
}

// A fan of digits from a base point. Angles are degrees from straight ahead (+z), positive outward (+x);
// each digit is two capsules ending in a round disc.
function addDigits(limb, o) {
  const n = o.angles.length;
  for (let i = 0; i < n; i++) {
    const a = (o.angles[i] * PI) / 180, dx = Math.sin(a), dz = Math.cos(a), len = o.lens[i];
    const r0 = o.r0 * (o.rk?.[i] ?? 1), r1 = o.r1 * (o.rk?.[i] ?? 1);
    const b = [o.base[0] + (o.offs?.[i] ?? 0), o.base[1] * 0 + r0 * 0.82, o.base[2] + (o.zoff?.[i] ?? 0)];
    const dr = o.disc * (o.dk?.[i] ?? 1);
    const reach = len - dr * 0.45;
    const j = [b[0] + dx * reach * 0.5, r0 * 0.8, b[2] + dz * reach * 0.5], tp = [b[0] + dx * reach, r1 * 0.8, b[2] + dz * reach];
    limb.cap(b, j, r0, (r0 + r1) * 0.55, o.t0, o.t0 + (o.t1 - o.t0) * 0.5);
    limb.cap(j, tp, (r0 + r1) * 0.55, r1, o.t0 + (o.t1 - o.t0) * 0.5, o.t1);
    const dc = [b[0] + dx * len, o.discY, b[2] + dz * len];
    limb.pad(dc, a, dr, o.discT, dr * 0.96, o.t1);
  }
}

// Which detail level is being built: set by reading `cell` (coarse) or `hiScale` (fine) on the definition.
function lodDef(def, cell, hiScale, st) {
  Object.defineProperties(def, {
    cell: { enumerable: true, get() { st.hi = false; return cell; } },
    hiScale: { enumerable: true, get() { st.hi = true; return hiScale; } },
  });
  return def;
}

// ---- Skin pattern helpers ------------------------------------------------------------------

const h31 = (i, j, k, s) => { const v = Math.sin(i * 127.1 + j * 311.7 + k * 74.7 + s * 19.19) * 43758.5453; return v - Math.floor(v); };
// Round spots of varying size scattered in 3D: returns 0…1 coverage (soft edged).
function spots(x, y, z, scale, rmin, rmax, prob, soft = 0.04, seed = 0) {
  const px = x * scale, py = y * scale, pz = z * scale;
  const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
  let cover = 0;
  for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = ix + i, cy = iy + j, cz = iz + k;
    if (h31(cx, cy, cz, seed) > prob) continue;
    const fx = cx + 0.15 + 0.7 * h31(cx, cy, cz, seed + 1), fy = cy + 0.15 + 0.7 * h31(cx, cy, cz, seed + 2), fz = cz + 0.15 + 0.7 * h31(cx, cy, cz, seed + 3);
    const r = rmin + (rmax - rmin) * h31(cx, cy, cz, seed + 4);
    const d = Math.hypot(px - fx, py - fy, pz - fz) / scale;
    const c = sstep(r + soft, r - soft, d);
    if (c > cover) cover = c;
  }
  return cover;
}
// Slightly warped 3D noise (0…1), for organic edges.
const wnoise = (x, y, z, f) => vnoise(x * f + 3.1, y * f - 1.7, z * f + 8.3);

// ---- Reference frog geometry (designed at a snout-vent length of 4.2 cm) -------------------

// Trunk rows [z, top, bottom, equator, half width] (converted to loft rows below).
const DART_ROWS = [
  [-2.05, 1.10, 0.24, 0.66, 0.42],
  [-1.75, 1.54, 0.16, 0.84, 0.68],
  [-1.25, 1.80, 0.18, 0.99, 0.91],
  [-0.65, 1.86, 0.30, 1.08, 0.98],
  [0.00, 1.86, 0.46, 1.16, 0.95],
  [0.55, 1.84, 0.58, 1.21, 0.89],
  [0.95, 1.72, 0.72, 1.18, 0.81],
  [1.30, 1.62, 0.82, 1.10, 0.82],
  [1.62, 1.50, 0.86, 1.05, 0.64],
  [1.90, 1.36, 0.90, 1.00, 0.37],
  [2.10, 1.15, 0.94, 1.02, 0.13],
];

const DART = {
  svl: 4.2,
  rows: DART_ROWS, front: 0.6, back: 0.6,
  eye: { x: 0.5, z: 1.36, r: 0.245, lift: 0.0, axis: [0.62, 0.5, 0.6] },
  fore: {
    sh: [0.72, 1.0, 0.85], el: [0.98, 0.56, 0.42], wr: [0.74, 0.15, 0.92], r: [0.29, 0.22, 0.145],
    palm: { c: [0.72, 0.075, 1.06], ang: -0.2, hl: 0.22, ht: 0.065, hw: 0.16 },
    fingers: { base: [0.69, 0, 1.2], angles: [-36, -14, 6, 26], offs: [-0.14, -0.05, 0.05, 0.14], lens: [0.42, 0.5, 0.58, 0.44], r0: 0.064, r1: 0.05, disc: 0.115, discT: 0.048, discY: 0.045 },
  },
  hind: {
    hip: [0.78, 0.95, -1.35], knee: [1.32, 0.72, -0.1], ank: [1.2, 0.3, -1.5], mt: [1.08, 0.12, -0.98], r: [0.42, 0.28, 0.16, 0.115],
    sole: { c: [1.06, 0.065, -0.75], ang: 0, hl: 0.4, ht: 0.065, hw: 0.2 },
    toes: { base: [1.05, 0, -0.42], angles: [-24, -10, 4, 18, 34], offs: [-0.2, -0.1, 0, 0.1, 0.2], lens: [0.42, 0.62, 0.84, 1.0, 0.72], r0: 0.066, r1: 0.05, disc: 0.1, discT: 0.048, discY: 0.045 },
  },
};

function buildFrog(P, st) {
  const rows = P.rows.map(([z, T, B, E, a]) => [z, E, a, T - E, E - B]);
  const loft = new Loft(rows, { front: P.front, back: P.back });

  // Eyes (right eye here; the left is its mirror).
  const e = P.eye, ey = loft.top(e.x, e.z) + e.lift;
  const eye = { c: [e.x, ey, e.z], r: e.r, axis: norm3(e.axis) };
  eye.h = norm3(cross3(eye.axis, [0, 1, 0]));           // horizontal tangent
  eye.w = norm3(cross3(eye.axis, eye.h));               // the other tangent (up-ish)
  // Canthus ridge and nostril pits.
  const snoutZ = P.rows[P.rows.length - 1][0];
  const nos = [0.17, loft.top(0.17, snoutZ - 0.2) - 0.01, snoutZ - 0.2];
  const brow = [[e.x - 0.1, ey + 0.02, e.z + 0.12], [0.22, loft.top(0.22, snoutZ - 0.28) - 0.02, snoutZ - 0.28]];

  // Limbs (right side; mirrored by folding x).
  const F = P.fore, H = P.hind;
  const fore = new Limb();
  fore.chain([F.sh, F.el], [F.r[0], F.r[1]], 0, 0.3);
  fore.chain([F.el, F.wr], [F.r[1], F.r[2]], 0.3, 0.62);
  fore.pad(F.palm.c, F.palm.ang, F.palm.hl, F.palm.ht, F.palm.hw, 0.68);
  addDigits(fore, { ...F.fingers, t0: 0.7, t1: 1 });
  fore.done();
  const hind = new Limb();
  hind.chain([H.hip, H.knee], [H.r[0], H.r[1]], 0, 0.28);
  hind.chain([H.knee, H.ank], [H.r[1], H.r[2]], 0.28, 0.72);
  hind.cap(H.ank, H.mt, H.r[2], H.r[3], 0.72, 0.78);
  hind.pad(H.sole.c, H.sole.ang, H.sole.hl, H.sole.ht, H.sole.hw, 0.78);
  addDigits(hind, { ...H.toes, t0: 0.8, t1: 1 });
  if (P.webs) {
    // Webbing between neighbouring toes: a thin sheet from the toe bases to about 70% of the shorter toe.
    const T = H.toes, th = st.hi ? P.webs.hi : P.webs.lo;
    const tip = (i, f) => { const a = (T.angles[i] * PI) / 180; return [T.base[0] + (T.offs?.[i] ?? 0) + Math.sin(a) * T.lens[i] * f, th * 0.9, T.base[2] + Math.cos(a) * T.lens[i] * f]; };
    for (let i = 0; i < T.angles.length - 1; i++) {
      const f = P.webs.f;
      const a0 = tip(i, 0.12), b0 = tip(i + 1, 0.12), a1 = tip(i, f), b1 = tip(i + 1, f);
      hind.web(a0, b0, a1, th, 0.9); hind.web(b0, b1, a1, th, 0.9);
    }
  }
  hind.done();
  return { P, loft, eye, nos, brow, fore, hind };
}

// ---- Assemble a frog definition -------------------------------------------------------------

function frogDef(spec) {
  const st = { hi: false };
  const P = { ...DART, ...(spec.geo ?? {}) };
  const S = spec.size / P.svl;
  const G = buildFrog(P, st);
  const { loft, eye, nos, brow, fore, hind } = G;
  const legK = spec.legK ?? 1;
  const ek = spec.eyeSmooth ?? 0.07;

  // Trunk alone: loft, eyes, canthus ridge, nostril pits.
  const trunk = (x, y, z) => {
    const ax = Math.abs(x);
    let d = loft.d(x, y, z);
    d = smin(d, Math.hypot(ax - eye.c[0], y - eye.c[1], z - eye.c[2]) - eye.r, ek);
    if (P.brow !== false) {
      const bx = brow[1][0] - brow[0][0], by = brow[1][1] - brow[0][1], bz = brow[1][2] - brow[0][2];
      const px = ax - brow[0][0], py = y - brow[0][1], pz = z - brow[0][2];
      const t = clamp01((px * bx + py * by + pz * bz) / (bx * bx + by * by + bz * bz));
      d = smin(d, Math.hypot(px - bx * t, py - by * t, pz - bz * t) - (0.085 - 0.04 * t), 0.09);
    }
    if (st.hi) d = smax(d, 0.05 - Math.hypot(ax - nos[0], y - nos[1], z - nos[2]), 0.03);
    return d;
  };
  const sdfRef = (x, y, z) => {
    const ax = Math.abs(x);
    let d = trunk(x, y, z);
    if (fore.near(ax, y, z) < 0.3) d = smin(d, fore.d(ax, y, z), 0.1);
    if (hind.near(ax, y, z) < 0.3) d = smin(d, hind.d(ax, y, z), 0.11);
    return smax(d, -y, 0.02);
  };
  const sdf = (x, y, z) => S * sdfRef(x / S, y / S, z / S);

  // Per-vertex analysis (ref frame), cached because color, rig and mat are asked in turn.
  let last = null, lx = NaN, ly = NaN, lz = NaN;
  const sc = [0, 0, 0, 0];
  const analyze = (X, Y, Z) => {
    if (X === lx && Y === ly && Z === lz) return last;
    lx = X; ly = Y; lz = Z;
    const x = X / S, y = Y / S, z = Z / S, ax = Math.abs(x);
    const a = { x, y, z, ax, side: x < 0 ? -1 : 1, kind: 'body', leg: 0, legT: 0, t: 0, dT: 0, dL: 9, n: [0, 1, 0], eye: null, sect: sc };
    a.dT = trunk(x, y, z);
    // Eye ball?
    const rx = ax - eye.c[0], ry = y - eye.c[1], rz = z - eye.c[2], dd = Math.hypot(rx, ry, rz);
    if (dd < eye.r + 0.05) {
      const cs = (rx * eye.axis[0] + ry * eye.axis[1] + rz * eye.axis[2]) / (dd || 1);
      if (cs > 0.25) {
        const th = Math.acos(Math.min(1, cs));
        a.eye = { th, u: rx * eye.h[0] + ry * eye.h[1] + rz * eye.h[2], v: rx * eye.w[0] + ry * eye.w[1] + rz * eye.w[2], dd };
      }
    }
    // Limbs
    let dl = 9, lk = 0, lt = 0;
    if (fore.near(ax, y, z) < 0.3) { const d = fore.d(ax, y, z, true); if (d < dl) { dl = d; lk = 1; lt = fore.t; } }
    if (hind.near(ax, y, z) < 0.3) { const d = hind.d(ax, y, z, true); if (d < dl) { dl = d; lk = 2; lt = hind.t; } }
    a.dL = dl;
    if (lk && dl < a.dT + 0.02) {
      a.kind = lk === 1 ? 'fore' : 'hind';
      a.leg = lk === 1 ? (x < 0 ? 1 : 2) : (x < 0 ? 3 : 4);
      a.t = lt;
      a.legT = clamp01(lt) * sstep(0.02, 0.34, a.dT) * legK;
    }
    // Normal (for dorsal / ventral shading)
    const e2 = 0.02, d0 = sdfRef(x, y, z);
    a.n = norm3([sdfRef(x + e2, y, z) - d0, sdfRef(x, y + e2, z) - d0, sdfRef(x, y, z + e2) - d0]);
    loft.sect(z, sc);
    return (last = a);
  };

  const zS = P.rows[P.rows.length - 1][0] + 0.2, zT = P.rows[0][0] - 0.3;
  const rig = (X, Y, Z) => {
    const a = analyze(X, Y, Z);
    return [clamp01((zS - a.z) / (zS - zT)), a.leg, a.legT];
  };
  const mat = (X, Y, Z) => {
    const a = analyze(X, Y, Z);
    if (a.eye && a.eye.th < spec.eyeCap) return M.EYE;
    return spec.mat ? spec.mat(a) : M.GLOSS;
  };
  const color = (X, Y, Z) => {
    const a = analyze(X, Y, Z);
    a.S = S; a.P = P; a.eyeCfg = eye;
    return spec.paint(a);
  };
  const m = 0.3;
  const def = {
    sdf, lo: [-2.2 * S, -0.12 * S, -2.5 * S], hi: [2.2 * S, 2.3 * S, 2.6 * S], color, mat, rig,
    finish: { rough: 0.3, coat: 1, coatRough: 0.06, grain: 14, bump: 0.0005, tone: 0.02, flutter: 0.0, ...(spec.finish ?? {}) },
  };
  void m;
  return lodDef(def, spec.cell, 0.5, st);
}

// ---- Species ----------------------------------------------------------------------------------

const IRIS = { th: 1.0 };
// Paints the eye ball (a cap of iris and pupil; the rest is eyelid skin).
function paintEye(a, iris, gold, pupilSize = [0.105, 0.06], lidCol = null) {
  const th = a.eye.th, r = 0.245;
  if (th >= 1.0) return null;                    // eyelid
  const { u, v } = a.eye;
  const rho = Math.hypot(u, v) / r;
  const pup = (u * u) / (pupilSize[0] * pupilSize[0]) + (v * v) / (pupilSize[1] * pupilSize[1]);
  if (pup < 1) return C(0x030303);
  let c = lerp3(gold, iris, sstep(0.28, 0.72, rho));
  c = lerp3(c, mul3(iris, 0.3), sstep(0.7, 0.95, rho));
  return lerp3(c, C(0x030303), sstep(1.1, 0.95, pup) * 0.5);
}

const azureus = (a) => {
  const { x, y, z, ax, n } = a;
  const eyeC = a.eye ? paintEye(a, C(0x120c08), C(0x5a4a26)) : null;
  if (eyeC) return eyeC;
  const dorsal = sstep(-0.45, 0.35, n[1]);
  const w = wnoise(x, y, z, 1.3);
  let col = lerp3(C(0x1a44b8), C(0x2f6ae8), dorsal * (0.55 + 0.45 * w));
  const belly = sstep(-0.3, -0.7, n[1]);
  col = lerp3(col, lerp3(C(0x16308a), C(0x0a1030), sstep(0.45, 0.62, wnoise(x, y, z, 3.2))), belly * 0.85);
  const sp = spots(x, y, z, 1.6, 0.09, 0.27, 0.8, 0.035);
  col = lerp3(col, C(0x04060e), sp * (1 - belly * 0.4) * 0.97);
  return col;
};

export const FROGS = {
  dartfrog: () => frogDef({ size: 4.2, cell: 0.065, paint: azureus, eyeCap: 1.0, mat: null }),
};

// Placeholders until the other species are rebuilt below.
const legacy = (o) => () => frogDef({ size: 4.2, cell: 0.065, paint: () => C(0x808080), eyeCap: 1.0 });
FROGS.strawberry = legacy();
FROGS.toad = legacy();
FROGS.leucomelas = legacy();
FROGS.auratus = legacy();
FROGS.tadpole = legacy();
FROGS.eggs = legacy();
void IRIS; void hash; void ell;
