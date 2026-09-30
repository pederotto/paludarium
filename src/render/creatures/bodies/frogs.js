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

// Distance from (px, py, pz) to triangle abc (Ericson's closest point).
function triDist(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz) {
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  let qx, qy, qz;
  if (d1 <= 0 && d2 <= 0) { qx = ax; qy = ay; qz = az; }
  else {
    const bpx = px - bx, bpy = py - by, bpz = pz - bz, d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) { qx = bx; qy = by; qz = bz; }
    else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); qx = ax + abx * v; qy = ay + aby * v; qz = az + abz * v; }
      else {
        const cpx = px - cx, cpy = py - cy, cpz = pz - cz, d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
        if (d6 >= 0 && d5 <= d6) { qx = cx; qy = cy; qz = cz; }
        else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); qx = ax + acx * w; qy = ay + acy * w; qz = az + acz * w; }
          else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + d5 - d6); qx = bx + (cx - bx) * w; qy = by + (cy - by) * w; qz = bz + (cz - bz) * w; }
            else { const den = 1 / (va + vb + vc), v = vb * den, w = vc * den; qx = ax + abx * v + acx * w; qy = ay + aby * v + acy * w; qz = az + abz * v + acz * w; }
          }
        }
      }
    }
  }
  const dx = px - qx, dy = py - qy, dz = pz - qz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

class Limb {
  constructor(st = null) { this.g = []; this.cur = null; this.t = 0; this.st = st; this.hiK = 1; this.group(); }
  // Starts a new group of parts with its own bounding sphere (so a far-away toe costs one sphere test).
  group() { this.cur = { a: [], p: [], w: [] }; this.g.push(this.cur); return this; }
  cap(a, b, ra, rb, t0 = 0, t1 = 1) { this.cur.a.push(a[0], a[1], a[2], b[0], b[1], b[2], ra, rb, t0, t1); return this; }
  chain(pts, radii, t0 = 0, t1 = 1) {
    const n = pts.length - 1;
    for (let i = 0; i < n; i++) this.cap(pts[i], pts[i + 1], radii[i], radii[i + 1], t0 + ((t1 - t0) * i) / n, t0 + ((t1 - t0) * (i + 1)) / n);
    return this;
  }
  // A flat oval lying on the ground plane (long axis at angle `ang` from +z toward +x).
  pad(c, ang, hl, ht, hw, t) { this.cur.p.push(c[0], c[1], c[2], Math.sin(ang), Math.cos(ang), hl, ht, hw, t); return this; }
  web(a, b, c, th, t) { this.cur.w.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], th, t); return this; }
  done() {
    const all = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9];
    this.g = this.g.filter((g) => g.a.length || g.p.length || g.w.length);
    for (const g of this.g) {
      const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
      const grow = (x, y, z, r) => { const q = [x, y, z]; for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], q[k] - r); mx[k] = Math.max(mx[k], q[k] + r); } };
      const A = g.A = Float64Array.from(g.a), Pd = g.P = Float64Array.from(g.p), W = g.W = Float64Array.from(g.w);
      for (let i = 0; i < A.length; i += 10) { grow(A[i], A[i + 1], A[i + 2], A[i + 6]); grow(A[i + 3], A[i + 4], A[i + 5], A[i + 7]); }
      for (let i = 0; i < Pd.length; i += 9) grow(Pd[i], Pd[i + 1], Pd[i + 2], Math.max(Pd[i + 5], Pd[i + 7]));
      for (let i = 0; i < W.length; i += 11) { grow(W[i], W[i + 1], W[i + 2], W[i + 9]); grow(W[i + 3], W[i + 4], W[i + 5], W[i + 9]); grow(W[i + 6], W[i + 7], W[i + 8], W[i + 9]); }
      g.cx = (mn[0] + mx[0]) / 2; g.cy = (mn[1] + mx[1]) / 2; g.cz = (mn[2] + mx[2]) / 2;
      g.R = Math.sqrt((mx[0] - mn[0]) ** 2 + (mx[1] - mn[1]) ** 2 + (mx[2] - mn[2]) ** 2) / 2;
      for (let k = 0; k < 3; k++) { all[k] = Math.min(all[k], mn[k]); all[k + 3] = Math.max(all[k + 3], mx[k]); }
    }
    this.c = [(all[0] + all[3]) / 2, (all[1] + all[4]) / 2, (all[2] + all[5]) / 2];
    this.R = Math.sqrt((all[3] - all[0]) ** 2 + (all[4] - all[1]) ** 2 + (all[5] - all[2]) ** 2) / 2;
    return this;
  }
  // Squared distance to the bounding sphere centre minus radius squared (cheap reject for the whole limb).
  near(x, y, z) { const dx = x - this.c[0], dy = y - this.c[1], dz = z - this.c[2]; return Math.sqrt(dx * dx + dy * dy + dz * dz) - this.R; }
  // Distance to the limb, or `cut` when it is farther than that. With `wantT` also leaves the
  // along-limb parameter of the nearest part in this.t.
  d(x, y, z, cut = 1e9, wantT = false) {
    let best = cut, bt = 0;
    const G = this.g;
    for (let gi = 0; gi < G.length; gi++) {
      const g = G[gi];
      const gx = x - g.cx, gy = y - g.cy, gz = z - g.cz, dsq = gx * gx + gy * gy + gz * gz, lim = best + g.R;
      if (lim <= 0 || dsq >= lim * lim) continue;
      const A = g.A, Pd = g.P, W = g.W;
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
        const d = triDist(x, y, z, W[i], W[i + 1], W[i + 2], W[i + 3], W[i + 4], W[i + 5], W[i + 6], W[i + 7], W[i + 8]) - W[i + 9] * (this.st && this.st.hi ? this.hiK : 1);
        if (d < best) { best = d; if (wantT) bt = W[i + 10]; }
      }
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
    limb.group();
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
  [-1.75, 1.52, 0.16, 0.84, 0.68],
  [-1.25, 1.78, 0.18, 0.98, 0.91],
  [-0.65, 1.84, 0.26, 1.05, 0.98],
  [0.00, 1.82, 0.40, 1.11, 0.94],
  [0.55, 1.76, 0.48, 1.12, 0.87],
  [0.92, 1.60, 0.58, 1.06, 0.81],
  [1.28, 1.48, 0.70, 1.00, 0.86],
  [1.62, 1.40, 0.77, 0.97, 0.76],
  [1.92, 1.34, 0.83, 0.94, 0.56],
  [2.14, 1.18, 0.88, 0.96, 0.30],
];

const DART = {
  svl: 4.2, box: [1.85, 2.2, -2.15, 2.3],
  rows: DART_ROWS, front: 0.42, back: 0.6,
  eye: { x: 0.52, z: 1.34, r: 0.27, lift: 0.07, axis: [0.6, 0.55, 0.58] },
  fore: {
    sh: [0.72, 0.92, 0.85], el: [0.98, 0.5, 0.42], wr: [0.74, 0.14, 0.92], r: [0.28, 0.21, 0.15],
    palm: { c: [0.72, 0.075, 1.04], ang: -0.2, hl: 0.2, ht: 0.07, hw: 0.17 },
    fingers: { base: [0.69, 0, 1.16], angles: [-36, -14, 6, 26], offs: [-0.14, -0.05, 0.05, 0.14], lens: [0.34, 0.42, 0.48, 0.36], r0: 0.07, r1: 0.056, disc: 0.13, discT: 0.05, discY: 0.048 },
  },
  hind: {
    hip: [0.78, 0.95, -1.35], knee: [1.32, 0.72, -0.1], ank: [1.2, 0.3, -1.5], mt: [1.08, 0.12, -0.98], r: [0.38, 0.22, 0.15, 0.115],
    sole: { c: [1.06, 0.065, -0.75], ang: 0, hl: 0.4, ht: 0.065, hw: 0.2 },
    toes: { base: [1.05, 0, -0.42], angles: [-24, -10, 4, 18, 34], offs: [-0.2, -0.1, 0, 0.1, 0.2], lens: [0.36, 0.52, 0.72, 0.86, 0.62], r0: 0.07, r1: 0.055, disc: 0.115, discT: 0.05, discY: 0.048 },
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
  const fore = new Limb(st);
  fore.chain([F.sh, F.el], [F.r[0], F.r[1]], 0, 0.3);
  fore.chain([F.el, F.wr], [F.r[1], F.r[2]], 0.3, 0.62);
  fore.pad(F.palm.c, F.palm.ang, F.palm.hl, F.palm.ht, F.palm.hw, 0.68);
  addDigits(fore, { ...F.fingers, t0: 0.7, t1: 1 });
  fore.done();
  const hind = new Limb(st);
  hind.chain([H.hip, H.knee], [H.r[0], H.r[1]], 0, 0.28);
  hind.chain([H.knee, H.ank], [H.r[1], H.r[2]], 0.28, 0.72);
  hind.cap(H.ank, H.mt, H.r[2], H.r[3], 0.72, 0.78);
  hind.pad(H.sole.c, H.sole.ang, H.sole.hl, H.sole.ht, H.sole.hw, 0.78);
  addDigits(hind, { ...H.toes, t0: 0.8, t1: 1 });
  if (P.webs) {
    hind.group();
    // Webbing between neighbouring toes: a thin sheet from the toe bases to about 70% of the shorter toe.
    const T = H.toes, th = P.webs.lo;
    hind.hiK = P.webs.hi / P.webs.lo;
    hind.group();
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
  const P = spec.geo ?? DART;
  const S = spec.size / P.svl;
  const G = buildFrog(P, st);
  const { loft, eye, nos, brow, fore, hind } = G;
  P.nosY = nos[1]; P.nosZ = nos[2];
  const legK = spec.legK ?? 1;
  const ek = spec.eyeSmooth ?? 0.07;

  // Trunk alone: loft, eyes, canthus ridge, nostril pits.
  const bxv = brow[1][0] - brow[0][0], byv = brow[1][1] - brow[0][1], bzv = brow[1][2] - brow[0][2], bden = 1 / (bxv * bxv + byv * byv + bzv * bzv);
  const trunk = (x, y, z) => {
    const ax = Math.abs(x);
    let d = loft.d(x, y, z);
    if (z > 0.7) {
      const ex = ax - eye.c[0], ey2 = y - eye.c[1], ez = z - eye.c[2];
      d = smin(d, Math.sqrt(ex * ex + ey2 * ey2 + ez * ez) - eye.r, ek);
      if (P.brow !== false) {
        const px = ax - brow[0][0], py = y - brow[0][1], pz = z - brow[0][2];
        const t = clamp01((px * bxv + py * byv + pz * bzv) * bden);
        const qx = px - bxv * t, qy = py - byv * t, qz = pz - bzv * t;
        d = smin(d, Math.sqrt(qx * qx + qy * qy + qz * qz) - (0.085 - 0.04 * t), 0.09);
      }
      if (st.hi && z > 1.6) { const nx = ax - nos[0], ny = y - nos[1], nz = z - nos[2]; d = smax(d, 0.05 - Math.sqrt(nx * nx + ny * ny + nz * nz), 0.03); }
    }
    return d;
  };
  const sdfRef = (x, y, z) => {
    const ax = Math.abs(x);
    let d = trunk(x, y, z);
    if (fore.near(ax, y, z) < d + 0.1) d = smin(d, fore.d(ax, y, z, d + 0.1), 0.1);
    if (hind.near(ax, y, z) < d + 0.11) d = smin(d, hind.d(ax, y, z, d + 0.11), 0.11);
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
    const a = { S, P, eyeCfg: eye, pal: spec.eyePal, x, y, z, ax, side: x < 0 ? -1 : 1, kind: 'body', leg: 0, legT: 0, t: 0, dT: 0, dL: 9, n: [0, 1, 0], eye: null, sect: sc };
    a.dT = trunk(x, y, z);
    // Eye ball?
    const rx = ax - eye.c[0], ry = y - eye.c[1], rz = z - eye.c[2], dd = Math.hypot(rx, ry, rz);
    a.eyeD = dd - eye.r;
    if (dd < eye.r + 0.05) {
      const cs = (rx * eye.axis[0] + ry * eye.axis[1] + rz * eye.axis[2]) / (dd || 1);
      if (cs > 0.0) {
        const th = Math.acos(Math.min(1, cs));
        a.eye = { th, u: rx * eye.h[0] + ry * eye.h[1] + rz * eye.h[2], v: rx * eye.w[0] + ry * eye.w[1] + rz * eye.w[2], dd };
      }
    }
    // Limbs
    let dl = 9, lk = 0, lt = 0;
    if (fore.near(ax, y, z) < 0.3) { const d = fore.d(ax, y, z, 9, true); if (d < dl) { dl = d; lk = 1; lt = fore.t; } }
    if (hind.near(ax, y, z) < 0.3) { const d = hind.d(ax, y, z, 9, true); if (d < dl) { dl = d; lk = 2; lt = hind.t; } }
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
    if (a.eye && a.eye.th < CAP && pupilTest(a, a.pal) < 1) return M.EYE;
    return spec.mat ? spec.mat(a) : M.SKIN;
  };
  const color = (X, Y, Z) => {
    const a = analyze(X, Y, Z);
    return spec.paint(a);
  };
  const m = 0.3;
  const def = {
    sdf, lo: [-P.box[0] * S, -0.1 * S, P.box[2] * S], hi: [P.box[0] * S, P.box[1] * S, P.box[3] * S], color, mat, rig,
    finish: { rough: 0.35, coat: 0.4, coatRough: 0.15, grain: 0.35, bump: 0.0005, tone: 0.02, flutter: 0.0, ...(spec.finish ?? {}) },
  };
  void m;
  return lodDef(def, spec.cell, 0.5, st);
}

// ---- Species ----------------------------------------------------------------------------------

// Eye ball: a cap of iris and pupil (angle < CAP from the eye axis); the rest is the eyelid. The pupil
// is the only M.EYE (glossy black) part, the iris is skin material with colour, so its colour shows.
const CAP = 1.0;
const RIM = C(0x020203);
// < 1 inside the pupil. shape 'h' is a horizontal ellipse, 'tri' the heart / triangle of a Bombina.
function pupilTest(a, pal) {
  const r = a.eyeCfg.r, ps = pal.pupil ?? [0.45, 0.28];
  const { u, v } = a.eye;
  const x = u / (ps[0] * r), y = v / (ps[1] * r);
  if (pal.shape === 'tri') {
    // rounded triangle pointing down, flat on top (in the eye's tangent plane)
    const q = Math.max(Math.abs(x) * 0.9 + (y + 0.15) * 0.75, -y * 1.15 - 0.2);
    return q * q;
  }
  return x * x + y * y;
}
function paintEye(a, pal) {
  const th = a.eye.th, r = a.eyeCfg.r;
  if (th >= CAP) return null;                    // eyelid: skin colour (see headMarks for the rim)
  const { u, v } = a.eye;
  const rho = Math.hypot(u, v) / r;
  const pup = pupilTest(a, pal);
  if (pup < 1) return RIM;
  // iris: a bright ring at the pupil fading to a dark limbus, with fine radial streaks
  const ang = Math.atan2(v, u);
  const streak = 0.8 + 0.4 * vnoise(Math.cos(ang) * 7 + 5, Math.sin(ang) * 7, rho * 2);
  let c = lerp3(pal.inner, pal.outer, sstep(0.25, 0.75, rho));
  c = mul3(c, streak);
  c = lerp3(c, RIM, sstep(1.3, 1.0, pup) * 0.5);
  return lerp3(c, RIM, sstep(0.76, 0.88, rho));   // black limbus, so the cap edge is hidden
}

// Marks every frog has: dark mouth line along the equator of the head, nostrils, a faint tympanum ring,
// and a dark eyelid rim.
function headMarks(a, col, dark) {
  const { y, z, ax, sect } = a;
  if (z > 0.85) {
    const e = y - sect[0];
    const line = sstep(0.034, 0.012, Math.abs(e)) * sstep(0.85, 1.15, z);
    col = lerp3(col, dark, line * 0.85);
    const dn = Math.hypot(ax - 0.17, y - a.P.nosY, z - a.P.nosZ);
    col = lerp3(col, C(0x040405), sstep(0.075, 0.035, dn) * 0.9);
    const dt = Math.hypot(ax - 0.75, (y - sect[0] - 0.17) * 1.1, z - 0.98);
    col = lerp3(col, dark, sstep(0.14, 0.11, dt) * sstep(0.07, 0.1, dt) * 0.35);
  }
  if (a.eye && a.eye.th >= CAP && a.eye.th < CAP + 0.3) col = lerp3(col, dark, sstep(CAP + 0.3, CAP + 0.02, a.eye.th) * 0.9);
  return col;
}

// A copy of a frog geometry with its proportions stretched: kx width, ky height, kz length,
// kr limb / digit thickness, ke eye size, kd disc size.
function scaleGeo(P, { kx = 1, ky = 1, kz = 1, kr = 1, ke = 1, kd = 1, hind = 1, fore = 1 } = {}) {
  const pt = (q, k = 1) => [q[0] * kx, q[1] * ky, q[2] * kz];
  const F = P.fore, H = P.hind;
  const dig = (d, kk) => ({ ...d, base: pt(d.base), offs: d.offs?.map((v) => v * kx), lens: d.lens.map((v) => v * kk), r0: d.r0 * kr, r1: d.r1 * kr, disc: d.disc * kd });
  return {
    ...P,
    rows: P.rows.map(([z, T, B, E, a]) => [z * kz, T * ky, B * ky, E * ky, a * kx]),
    box: [P.box[0] * kx, P.box[1] * ky, P.box[2] * kz, P.box[3] * kz],
    eye: { ...P.eye, x: P.eye.x * kx, z: P.eye.z * kz, r: P.eye.r * ke },
    fore: { ...F, sh: pt(F.sh), el: pt(F.el), wr: pt(F.wr), r: F.r.map((v) => v * kr), palm: { ...F.palm, c: pt(F.palm.c), hl: F.palm.hl * fore, hw: F.palm.hw * kr }, fingers: dig(F.fingers, fore) },
    hind: { ...H, hip: pt(H.hip), knee: pt(H.knee), ank: pt(H.ank), mt: pt(H.mt), r: H.r.map((v) => v * kr), sole: { ...H.sole, c: pt(H.sole.c), hl: H.sole.hl * hind, hw: H.sole.hw * kr }, toes: dig(H.toes, hind) },
  };
}

// Eye palettes: iris colour near the pupil, near the rim, and the pupil shape / size.
const EYE_DART = { inner: C(0x9c7434), outer: C(0x2a1a0c), pupil: [0.5, 0.3] };
const EYE_PUM = { inner: C(0x8a6a3a), outer: C(0x1e140b), pupil: [0.5, 0.31] };
const EYE_LEU = { inner: C(0x7a5a2c), outer: C(0x150e08), pupil: [0.5, 0.3] };
const EYE_AUR = { inner: C(0xa07a36), outer: C(0x22160b), pupil: [0.5, 0.3] };
const EYE_BOMB = { inner: C(0xe6b23c), outer: C(0x8e5f20), pupil: [0.5, 0.36], shape: 'tri' };

// Common skin helpers.
const dorsalOf = (a) => sstep(-0.5, 0.4, a.n[1]);
const bellyOf = (a) => sstep(-0.25, -0.65, a.n[1]);

// -- Blue dart frog (Dendrobates tinctorius "azureus"): cobalt blue with black spots
const azureus = (a) => {
  const { x, y, z, n } = a;
  const eyeC = a.eye ? paintEye(a, EYE_DART) : null;
  if (eyeC) return eyeC;
  const dorsal = dorsalOf(a);
  const w = wnoise(x, y, z, 1.1);
  let col = lerp3(C(0x1a44bc), C(0x2f70ee), dorsal * (0.5 + 0.5 * w));
  const belly = bellyOf(a);
  const mar = sstep(0.44, 0.6, wnoise(x + 4, y, z, 3.4));
  col = lerp3(col, lerp3(C(0x1a3aa4), C(0x080d2a), mar), belly * 0.9);
  const limb = a.kind !== 'body';
  const head = z > 0.95 && !limb;
  const sp = limb ? spots(x, y, z, 2.6, 0.05, 0.15, 0.7, 0.03, 7) : spots(x, y, z, 1.45, 0.1, 0.3, head ? 0.45 : 0.8, 0.03);
  col = lerp3(col, C(0x03050c), sp * (1 - belly * 0.5));
  if (limb) col = lerp3(col, C(0x0a1440), sstep(0.8, 1.0, a.t) * 0.7);
  return headMarks(a, col, C(0x040816));
};

// -- Strawberry dart frog (Oophaga pumilio "blue jeans"): red-orange body, blue speckled legs
const pumilio = (a) => {
  const { x, y, z, n } = a;
  const eyeC = a.eye ? paintEye(a, EYE_PUM) : null;
  if (eyeC) return eyeC;
  const dorsal = dorsalOf(a), belly = bellyOf(a);
  const w = wnoise(x, y, z, 1.3);
  let red = lerp3(C(0xd6261a), C(0xf25a20), dorsal * (0.45 + 0.55 * w));
  red = lerp3(red, lerp3(C(0xe8501c), C(0x9c1a12), sstep(0.45, 0.62, wnoise(x + 2, y, z, 3.6))), belly * 0.7);
  // blue: the whole hind leg below the hip, the forearm and hand below the elbow
  const hindBlue = a.kind === 'hind' ? sstep(0.06, 0.2, a.t) : 0;
  const foreBlue = a.kind === 'fore' ? sstep(0.3, 0.42, a.t) : 0;
  const blueK = Math.max(hindBlue, foreBlue);
  const blue = lerp3(C(0x1a3cb0), C(0x3f78ee), (0.35 + 0.65 * wnoise(x, y, z, 1.6)) * (0.5 + 0.5 * dorsal));
  let col = lerp3(red, blue, blueK);
  const limb = a.kind !== 'body';
  const spB = spots(x, y, z, 3.4, 0.06, 0.13, 0.3, 0.03, 3) * (1 - blueK) * (1 - belly * 0.6);
  const spL = spots(x, y, z, 4.2, 0.06, 0.14, 0.65, 0.03, 9) * blueK;
  col = lerp3(col, C(0x160505), spB * 0.9);
  col = lerp3(col, C(0x04061a), spL * 0.95);
  if (limb && a.t > 0.85) col = lerp3(col, C(0x101c58), sstep(0.85, 1, a.t) * 0.55);
  return headMarks(a, col, C(0x3a0a06));
};

// -- Yellow-banded poison frog (Dendrobates leucomelas): yellow with black bands and a black head cap
const leucomelas = (a) => {
  const { x, y, z, n } = a;
  const eyeC = a.eye ? paintEye(a, EYE_LEU) : null;
  if (eyeC) return eyeC;
  const dorsal = dorsalOf(a), belly = bellyOf(a);
  const yellow = lerp3(C(0xeab20e), C(0xffd626), dorsal * (0.4 + 0.6 * wnoise(x, y, z, 1.2)));
  const black = C(0x090909);
  const limb = a.kind !== 'body';
  let k = 0;
  if (!limb) {
    // bands across the back: irregular edges from a warped z
    const zw = z + (wnoise(x, y, z, 1.9) - 0.5) * 0.5 + (wnoise(x + 9, y, z, 4.3) - 0.5) * 0.14;
    const band = (c, hw) => sstep(c - hw - 0.05, c - hw + 0.05, zw) * sstep(c + hw + 0.05, c + hw - 0.05, zw);
    const ventral = sstep(-0.6, -0.1, n[1]);                       // bands fade out toward the belly
    k = Math.max(band(0.1, 0.32), band(-1.0, 0.36)) * ventral;
    // head cap: black from the snout over the eyes down to the mouth line
    const cap = sstep(0.92, 0.78, z + (wnoise(x, y, z, 3) - 0.5) * 0.24) * sstep(-0.35, -0.1, y - a.sect[0] + 0.25);
    k = Math.max(k, cap);
    // yellow flecks inside the black head
    k *= 1 - 0.7 * spots(x, y, z, 5, 0.03, 0.06, 0.25, 0.02, 4) * cap;
  } else {
    const sp = spots(x, y, z, 2.4, 0.07, 0.18, 0.62, 0.03, 5);
    const bnd = a.kind === 'hind' ? Math.max(sstep(0.2, 0.24, a.t) * sstep(0.32, 0.28, a.t), sstep(0.5, 0.54, a.t) * sstep(0.64, 0.6, a.t)) : sstep(0.4, 0.44, a.t) * sstep(0.56, 0.52, a.t);
    k = Math.max(sp, bnd * (0.6 + 0.4 * wnoise(x, y, z, 3)) * 0.9);
    k = Math.max(k, sstep(0.86, 0.98, a.t));
  }
  let col = lerp3(yellow, black, k);
  // belly: yellow-cream with black marbling
  col = lerp3(col, lerp3(C(0xe6c22a), black, sstep(0.42, 0.56, wnoise(x + 4, y, z, 3.4))), belly * 0.85 * (1 - k));
  return headMarks(a, col, C(0x120c04));
};

// -- Green and black poison frog (Dendrobates auratus): metallic green patches on black
const auratus = (a) => {
  const { x, y, z, n } = a;
  const eyeC = a.eye ? paintEye(a, EYE_AUR) : null;
  if (eyeC) return eyeC;
  const dorsal = dorsalOf(a), belly = bellyOf(a);
  const limb = a.kind !== 'body';
  const black = C(0x08090a);
  const wx = x + (wnoise(x, y, z, 2.2) - 0.5) * 0.7, wz = z + (wnoise(x + 5, y, z, 2.2) - 0.5) * 0.7;
  const f = vnoise(wx * 1.05 + 1, y * 1.05, wz * 1.05) * 0.62 + vnoise(wx * 2.3, y * 2.3 + 4, wz * 2.3) * 0.38;
  const bias = 0.04 + 0.1 * dorsal - 0.22 * belly - (limb ? 0.03 : 0);
  const patch = sstep(0.5, 0.56, f + bias);
  const g = wnoise(x, y, z, 1.8);
  let green = lerp3(C(0x22b85a), C(0x9ff04c), g);
  green = lerp3(green, C(0x35d6b4), belly * 0.7);                   // turquoise underneath
  let col = lerp3(black, green, patch);
  // black spots inside the green
  col = lerp3(col, black, spots(x, y, z, 2.2, 0.05, 0.14, 0.55, 0.03, 2) * patch * 0.9);
  if (limb && a.t > 0.85) col = lerp3(col, black, sstep(0.85, 1, a.t) * 0.7);
  return headMarks(a, col, C(0x020303));
};

// -- Fire-bellied toad (Bombina orientalis): warty olive back with black blotches, red-orange spotted belly
const bombina = (a) => {
  const { x, y, z, n } = a;
  const eyeC = a.eye ? paintEye(a, EYE_BOMB) : null;
  if (eyeC) return eyeC;
  const limb = a.kind !== 'body';
  // ragged boundary between back and belly colour
  const edge = n[1] + (vnoise(x * 2.6, y * 2.6, z * 2.6) - 0.5) * 0.7 + (vnoise(x * 6, y * 6, z * 6) - 0.5) * 0.22;
  const ventral = sstep(-0.05, -0.32, edge);
  const w = wnoise(x, y, z, 1.4);
  let green = lerp3(C(0x486f26), C(0x86ad3c), w);
  const blot = sstep(0.55, 0.62, vnoise(x * 1.5 + 4, y * 1.5, z * 1.5) * 0.7 + vnoise(x * 3.4, y * 3.4, z * 3.4) * 0.3);
  green = lerp3(green, C(0x131c0a), blot * 0.92);
  // wart tips: small darker dots
  green = lerp3(green, C(0x1c2a0e), spots(x, y, z, 5.5, 0.05, 0.1, 0.5, 0.03, 6) * 0.8);
  // belly: orange-red with black blotches
  const org = lerp3(C(0xe24c12), C(0xf58a1c), wnoise(x + 3, y, z, 2));
  const bl = sstep(0.5, 0.58, vnoise(x * 2.2 + 8, y * 2.2, z * 2.2) * 0.7 + vnoise(x * 5, y * 5, z * 5) * 0.3);
  const belly = lerp3(org, C(0x0d0d0d), bl * 0.94);
  let col = lerp3(green, belly, ventral);
  if (limb) col = lerp3(col, C(0x18160e), sstep(0.9, 1, a.t) * 0.7);
  return headMarks(a, col, C(0x0a0e04));
};

// ---- The frogs ---------------------------------------------------------------------------------

// A seated toad: flat and wide, short legs, blunt fingers, webbed hind feet, eyes up on the head.
const TOAD = {
  svl: 4.5, box: [2.35, 1.75, -2.45, 2.45],
  rows: [
    [-2.25, 0.86, 0.14, 0.50, 0.40],
    [-1.95, 1.08, 0.08, 0.58, 0.76],
    [-1.40, 1.26, 0.08, 0.66, 1.14],
    [-0.70, 1.32, 0.12, 0.72, 1.26],
    [0.00, 1.32, 0.18, 0.75, 1.24],
    [0.70, 1.28, 0.26, 0.77, 1.12],
    [1.15, 1.22, 0.36, 0.78, 0.98],
    [1.55, 1.16, 0.44, 0.74, 0.94],
    [1.92, 1.08, 0.50, 0.72, 0.70],
    [2.25, 0.92, 0.56, 0.72, 0.30],
  ],
  front: 0.5, back: 0.65, brow: false,
  eye: { x: 0.56, z: 1.5, r: 0.3, lift: 0.06, axis: [0.4, 0.85, 0.35] },
  fore: {
    sh: [0.98, 0.7, 0.8], el: [1.22, 0.36, 0.5], wr: [0.96, 0.1, 0.98], r: [0.3, 0.23, 0.17],
    palm: { c: [0.94, 0.06, 1.14], ang: -0.15, hl: 0.2, ht: 0.06, hw: 0.2 },
    fingers: { base: [0.9, 0, 1.24], angles: [-34, -12, 8, 30], offs: [-0.15, -0.05, 0.06, 0.16], lens: [0.34, 0.46, 0.52, 0.38], r0: 0.08, r1: 0.062, disc: 0.075, discT: 0.06, discY: 0.055 },
  },
  hind: {
    hip: [1.02, 0.68, -1.45], knee: [1.72, 0.5, -0.5], ank: [1.5, 0.2, -1.65], mt: [1.32, 0.1, -1.25], r: [0.44, 0.26, 0.18, 0.14],
    sole: { c: [1.32, 0.06, -1.0], ang: 0, hl: 0.34, ht: 0.06, hw: 0.26 },
    toes: { base: [1.3, 0, -0.72], angles: [-30, -14, 1, 15, 31], offs: [-0.24, -0.12, 0, 0.12, 0.24], lens: [0.5, 0.74, 0.98, 1.16, 0.86], r0: 0.08, r1: 0.062, disc: 0.075, discT: 0.06, discY: 0.055 },
  },
  webs: { lo: 0.05, hi: 0.03, f: 0.75 },
};

export const FROGS = {
  dartfrog: () => frogDef({ size: 4.2, cell: 0.068, paint: azureus, eyePal: EYE_DART, geo: DART }),
  strawberry: () => frogDef({ size: 2.3, cell: 0.048, paint: pumilio, eyePal: EYE_PUM, legK: 0.8, geo: scaleGeo(DART, { kx: 1.03, ky: 1.06, kz: 0.94, kr: 1.05, ke: 1.16, kd: 1.15 }) }),
  leucomelas: () => frogDef({ size: 4.5, cell: 0.072, paint: leucomelas, eyePal: EYE_LEU, geo: scaleGeo(DART, { kx: 1.03, ky: 1.03, kz: 1.0, kr: 1.06 }) }),
  auratus: () => frogDef({ size: 4.0, cell: 0.066, paint: auratus, eyePal: EYE_AUR, geo: scaleGeo(DART, { kx: 0.97, ky: 0.98, kz: 1.03, kr: 0.95 }) }),
  toad: () => frogDef({ size: 4.5, cell: 0.072, paint: bombina, eyePal: EYE_BOMB, geo: TOAD, finish: { rough: 0.42, coat: 0.5, coatRough: 0.2, grain: 10, bump: 0.05, tone: 0.03 } }),
};

// ---- Tadpole: dark oval body, eyes on top, a muscular tail with a tall translucent fin -----------------

FROGS.tadpole = () => {
  const dorsalFin = (x, y, z) => ell(x, y - 0.02, z + 0.62, 0.05, 0.3, 0.62);
  const sdf = (x, y, z) => {
    let d = ell(x, y - 0.02, z - 0.55, 0.36, 0.3, 0.5);
    // muscular tail: tapered capsule from the body to the tip
    const t = clamp01((0.15 - z) / 1.05), ty = y - 0.02, tz = z - (0.15 - t * 1.05);
    d = smin(d, Math.sqrt(x * x + ty * ty + tz * tz) - (0.15 - 0.11 * t), 0.12);
    d = smin(d, dorsalFin(x, y, z), 0.03);
    const ex = Math.abs(x) - 0.2, ey = y - 0.3, ez = z - 0.85;
    d = smin(d, Math.sqrt(ex * ex + ey * ey + ez * ez) - 0.07, 0.04);
    return smax(d, -(y + 0.36), 0.02);
  };
  const isFin = (x, y, z) => z < 0.05 && Math.abs(y - 0.02) > 0.12 - 0.09 * clamp01((0.15 - z) / 1.0);
  const isEye = (x, y, z) => Math.hypot(Math.abs(x) - 0.2, y - 0.3, z - 0.85) < 0.085;
  return {
    sdf, lo: [-0.5, -0.4, -1.4], hi: [0.5, 0.65, 1.15], cell: 0.03,
    color: (x, y, z) => {
      if (isEye(x, y, z)) return C(0x030303);
      if (isFin(x, y, z)) return lerp3(C(0xb8a888), C(0x5a4a36), sstep(0.5, 0.62, vnoise(x * 9, y * 9, z * 9)) * 0.7);
      const belly = sstep(0.0, -0.22, y - 0.02);
      const base = lerp3(C(0x2a2018), C(0x4a3a2a), vnoise(x * 5, y * 5, z * 5));
      return lerp3(base, C(0x9a8a70), belly * (z > -0.1 ? 0.9 : 0.3));
    },
    mat: (x, y, z) => (isEye(x, y, z) ? M.EYE : isFin(x, y, z) ? M.FIN : M.SKIN),
    rig: (x, y, z) => [clamp01((1.0 - z) / 2.0), 0, 0],
    finish: { rough: 0.35, coat: 0.5, coatRough: 0.15, grain: 0.35, bump: 0.0005, tone: 0.02, flutter: 0.01 },
  };
};

// ---- Egg clutch: translucent jelly capsules with a dark embryo in each ----------------------------------

FROGS.eggs = () => {
  const R = 0.3;
  const pts = [[0.5, R, 0], [0.16, R, 0.48], [-0.4, R, 0.3], [-0.45, R, -0.25], [0.12, R, -0.5], [0.42, R, -0.42], [0.0, R * 2.05, 0.02], [-0.22, R * 1.9, -0.05]];
  const shell = (x, y, z) => { let d = 9; for (const [a, b, c] of pts) d = Math.min(d, Math.sqrt((x - a) ** 2 + (y - b) ** 2 + (z - c) ** 2) - R); return d; };
  const emb = (x, y, z) => { let d = 9; for (const [a, b, c] of pts) d = Math.min(d, Math.sqrt((x - a) ** 2 + (y - b + 0.02) ** 2 + (z - c) ** 2) - 0.115); return d; };
  const sdf = (x, y, z) => {
    // hollow jelly shell (wall 0.075) plus the embryos inside
    const s = shell(x, y, z), wall = Math.max(s, -s - 0.075);
    return Math.min(smax(wall, -y - 0.02, 0.02), emb(x, y, z));
  };
  const isEmb = (x, y, z) => emb(x, y, z) < 0.02 && shell(x, y, z) < -0.06;
  return {
    sdf, lo: [-1.0, -0.1, -1.0], hi: [1.0, 1.0, 1.0], cell: 0.056,
    color: (x, y, z) => {
      if (isEmb(x, y, z)) {
        let c0 = 0, bc = 9;
        for (const p of pts) { const d = Math.hypot(x - p[0], z - p[2]) + Math.abs(y - p[1]); if (d < bc) { bc = d; c0 = p[1]; } }
        return y > c0 - 0.01 ? C(0x16120c) : C(0xe6d9a4);
      }
      return lerp3(C(0xdce8e0), C(0xf0f4e6), vnoise(x * 4, y * 4, z * 4));
    },
    mat: (x, y, z) => (isEmb(x, y, z) ? M.SKIN : M.TRANSLUCENT),
    finish: { rough: 0.3, coat: 0.5, coatRough: 0.1, grain: 0.35, bump: 0.0005, tone: 0.01, glassOpacity: 0.45 },
  };
};
void hash;
