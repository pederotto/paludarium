// Salamanders, newts, axolotls and geckos. All face +z, feet on y = 0, centimetres.
//
// The bodies are built the way a sculptor would rough them out:
//  - Loft: the trunk, head and tail are ONE lofted solid (elliptical cross-sections whose
//    centre height, width and upper/lower half-heights are splined along z, with rounded
//    ends), so the snout, jaw, neck, shoulders, ribcage and tail flow into each other.
//  - Rods: limbs, digits and gill filaments are chains of tapered capsules.
//  - Fin: a thin slab standing on the spine profile (axolotl tail fin, newt keel).
//  - small parts (eyes, brows, pads) are ellipsoids, blended in with a smooth minimum.
// Every part sits in a bounding sphere so the SDF only evaluates what is near the query.
//
// The mesher builds the coarse mesh first and the fine one later. Reading `cell` and
// `hiScale` on the definition tells the SDF which of the two it is being asked for
// (see lodDef), so the coarse mesh can use fewer, thicker gill filaments and toes.
import { ell, smin, cap, vnoise, fbm, cells, C, lerp3, mul3, clamp01, M } from '../kit.js';

const TAU = Math.PI * 2;
const sstep = (a, b, x) => { const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a); return t * t * (3 - 2 * t); };
const norm3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const add3 = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const hash1 = (n) => { const s = Math.sin(n * 91.3458) * 47453.5453; return s - Math.floor(s); };

// Monotone cubic (PCHIP) through (xs, ys): smooth, no overshoot between stations.
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

// The lofted solid: rows [z, cy, a, bu, bd] = centre height, half width, upper and lower half height.
// `front` / `back` are the lengths of the rounded end caps at the +z and -z ends.
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
  // Cross-section parameters at z (for painting): fills out = [cy, a, bu, bd].
  sect(z, out) { const T = this.t.at(Math.min(this.z1, Math.max(this.z0, z))); out[0] = T.get(0); out[1] = T.get(1); out[2] = T.get(2); out[3] = T.get(3); return out; }
  // Height of the upper surface at (x, z).
  top(x, z) { const s = this.sect(z, [0, 0, 0, 0]); return s[0] + s[2] * Math.sqrt(Math.max(0, 1 - (x * x) / (s[1] * s[1]))); }
  bottom(x, z) { const s = this.sect(z, [0, 0, 0, 0]); return s[0] - s[3] * Math.sqrt(Math.max(0, 1 - (x * x) / (s[1] * s[1]))); }
}

// A thin standing slab (fin or keel): rows [z, yLow, yTop, halfThickness]; the free edge is rounded.
class Fin {
  constructor(rows, step = 0.02) { this.t = new Table(rows, step); this.z0 = rows[0][0]; this.z1 = rows[rows.length - 1][0]; }
  d(x, y, z) {
    const T = this.t;
    T.at(z);
    const yl = T.get(0), yt = T.get(1), th = T.get(2), sl = T.slope(0), st = T.slope(1);
    let dp = Math.max((y - yt) / Math.sqrt(1 + st * st), (yl - y) / Math.sqrt(1 + sl * sl));
    if (z < this.z0 || z > this.z1) dp = Math.max(dp, this.z0 - z, z - this.z1);
    const qx = Math.abs(x) - th + th, qy = dp + th;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - th;
  }
}

// A set of tapered capsules (limb segments, digits, gill filaments) with a bounding sphere.
// Each segment also carries the range of a 0…1 parameter along the whole limb (legT).
class Rods {
  constructor() { this.a = []; }
  add(a, b, ra, rb, t0 = 0, t1 = 1) { this.a.push(a[0], a[1], a[2], b[0], b[1], b[2], ra, rb, t0, t1); return this; }
  chain(pts, radii, t0 = 0, t1 = 1) {
    const n = pts.length - 1;
    for (let i = 0; i < n; i++) this.add(pts[i], pts[i + 1], radii[i], radii[i + 1], t0 + ((t1 - t0) * i) / n, t0 + ((t1 - t0) * (i + 1)) / n);
    return this;
  }
  done() {
    const A = this.A = Float64Array.from(this.a);
    const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (let i = 0; i < A.length; i += 10) for (let k = 0; k < 3; k++) for (const [o, r] of [[0, A[i + 6]], [3, A[i + 7]]]) { mn[k] = Math.min(mn[k], A[i + o + k] - r); mx[k] = Math.max(mx[k], A[i + o + k] + r); }
    this.c = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
    this.R = Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) / 2;
    this.t = 0;
    return this;
  }
  d(x, y, z) {
    const A = this.A;
    let best = 1e9;
    for (let i = 0; i < A.length; i += 10) {
      const ax = A[i], ay = A[i + 1], az = A[i + 2], bax = A[i + 3] - ax, bay = A[i + 4] - ay, baz = A[i + 5] - az;
      const pax = x - ax, pay = y - ay, paz = z - az;
      let t = (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz + 1e-12);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = pax - bax * t, dy = pay - bay * t, dz = paz - baz * t;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - (A[i + 6] + (A[i + 7] - A[i + 6]) * t);
      if (d < best) best = d;
    }
    return best;
  }
  // Like d, but also leaves the along-limb parameter of the nearest segment in this.t.
  dt(x, y, z) {
    const A = this.A;
    let best = 1e9;
    for (let i = 0; i < A.length; i += 10) {
      const ax = A[i], ay = A[i + 1], az = A[i + 2], bax = A[i + 3] - ax, bay = A[i + 4] - ay, baz = A[i + 5] - az;
      const pax = x - ax, pay = y - ay, paz = z - az;
      let t = (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz + 1e-12);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = pax - bax * t, dy = pay - bay * t, dz = paz - baz * t;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - (A[i + 6] + (A[i + 7] - A[i + 6]) * t);
      if (d < best) { best = d; this.t = A[i + 8] + (A[i + 9] - A[i + 8]) * t; }
    }
    return best;
  }
  near(x, y, z) { return Math.hypot(x - this.c[0], y - this.c[1], z - this.c[2]) - this.R; }
}

// A limb: rods plus optional flat pads (toe pads, palms), as oriented flattened ellipsoids
// [cx, cy, cz, dirX, dirZ, halfLength, halfThickness, halfWidth, t].
class Limb {
  constructor(id, rods, pads = []) {
    this.id = id; this.rods = rods.done(); this.pads = pads;
    this.c = rods.c; this.R = rods.R;
    for (const p of pads) this.R = Math.max(this.R, Math.hypot(p[0] - this.c[0], p[1] - this.c[1], p[2] - this.c[2]) + Math.max(p[5], p[7]) + 0.05);
    this.t = 0;
  }
  padD(p, x, y, z) {
    const rx = x - p[0], rz = z - p[2];
    return ell(rx * p[3] + rz * p[4], y - p[1], -rx * p[4] + rz * p[3], p[5], p[6], p[7]);
  }
  d(x, y, z) {
    let d = this.rods.d(x, y, z);
    for (const p of this.pads) d = Math.min(d, this.padD(p, x, y, z));
    return d;
  }
  dt(x, y, z) {
    let d = this.rods.dt(x, y, z);
    this.t = this.rods.t;
    for (const p of this.pads) { const q = this.padD(p, x, y, z); if (q < d) { d = q; this.t = p[8]; } }
    return d;
  }
  near(x, y, z) { return Math.hypot(x - this.c[0], y - this.c[1], z - this.c[2]) - this.R; }
}

// Mirror a point list across x = 0 for the left-hand limbs.
const flipX = (pts, s) => pts.map((p) => [p[0] * s, p[1], p[2]]);

// Fan of digits from a base point: `angles` are degrees from straight ahead (+z), positive = outward (+x for a
// right limb), `lens` the digit lengths. Digits lie along the ground and rise slightly toward the tip.
function digits({ base, angles, lens, r0, r1, lift = 0, bend = 0 }, side, rods, t0, t1) {
  const n = angles.length;
  for (let i = 0; i < n; i++) {
    const a = (angles[i] * Math.PI) / 180, dx = Math.sin(a) * side, dz = Math.cos(a);
    const b = [base[0] * side, base[1], base[2]];
    const mid = [b[0] + dx * lens[i] * 0.5, b[1] + lift * 0.4, b[2] + dz * lens[i] * 0.5];
    // the tip curls a little toward the ground-plane normal by `bend`
    const tip = [b[0] + dx * lens[i] * (1 - bend * 0.3), b[1] + lift + bend * lens[i] * 0.25, b[2] + dz * lens[i] * (1 - bend * 0.3)];
    rods.chain([b, mid, tip], [r0[i] ?? r0, ((r0[i] ?? r0) + (r1[i] ?? r1)) / 2 + 0.004, r1[i] ?? r1], t0, t1);
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

// Smooth union of a base distance with gated parts: parts = [{ near, d, k }] where near(x,y,z) is a lower bound
// of the part's distance. A part farther than k from the surface cannot change the union, so it is skipped.
function unite(d, x, y, z, parts) {
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.near(x, y, z) - d >= p.k) continue;
    d = smin(d, p.d(x, y, z), p.k);
  }
  return d;
}
const sphereNear = (c, R) => (x, y, z) => Math.hypot(x - c[0], y - c[1], z - c[2]) - R;

// Eye: a ball set into the head. `axis` is the outward normal at the eye, used for painting the iris and pupil.
function makeEye(loft, x, dz, z, r, sink = 0.35) {
  const y0 = loft.top(Math.abs(x), z) - r * sink;
  const c = [x, y0, z];
  const e = 0.02, sd = (a, b, c2) => loft.d(a, b, c2);
  const axis = norm3([sd(x + e, y0, z) - sd(x - e, y0, z), sd(x, y0 + e, z) - sd(x, y0 - e, z), sd(x, y0, z + e) - sd(x, y0, z - e)]);
  return { c, r, axis };
}

// ==================================================================================================
// AXOLOTL  (Ambystoma mexicanum, juvenile about 12 cm)
// ==================================================================================================

export const AXOLOTL_MORPHS = {
  // Leucistic ("pink"): pale pink-white body, deep red gills, black eyes.
  leucistic: { name: 'leucistic', skin: 0xf3cdc9, back: 0xf1c6c4, belly: 0xfae7e1, fin: 0xf6cfcf, finEdge: 0xf0b3b6, gill: 0xc41e3a, gillBase: 0xe05a6e, lip: 0xd99aa0, eye: 0x080506, iris: 0x24120e, ring: 0x40261c, spots: null, blotch: null },
  // Wild type: dark olive-brown with darker blotches and gold iridophore flecks; dusky gills.
  wild: { name: 'wild', skin: 0x4a3f30, back: 0x2c2820, belly: 0x6b6152, fin: 0x3c352b, finEdge: 0x2a251d, gill: 0x5b2a33, gillBase: 0x6a4038, lip: 0x554a3a, eye: 0x070605, iris: 0x2a2010, ring: 0xa88a30, spots: { col: 0xb8a458, amt: 0.35, scale: 5.5 }, blotch: { col: 0x171612, scale: 1.3, thr: 0.5 } },
  // Golden albino: yellow-gold, orange gills, pink-red eyes.
  golden: { name: 'golden', skin: 0xe4b442, back: 0xdea63a, belly: 0xf3d67e, fin: 0xeac35c, finEdge: 0xe6a23a, gill: 0xe06a32, gillBase: 0xf29a58, lip: 0xc9903a, eye: 0x7a1f26, iris: 0xa63a3a, ring: 0xd9a25a, spots: null, blotch: null },
  // Melanoid: all-over slate black, no reflective flecks, dark plum gills.
  melanoid: { name: 'melanoid', skin: 0x1c1b20, back: 0x121216, belly: 0x2a2a30, fin: 0x1a191e, finEdge: 0x101014, gill: 0x3c2438, gillBase: 0x3a2a3a, lip: 0x2a2a30, eye: 0x030304, iris: 0x0c0b0d, ring: 0x1a1a20, spots: null, blotch: null },
};

// The axolotl's shape. Built once per definition; `st.hi` selects the fine detail level.
function axolotlShape(st) {
  const loft = new Loft([
    [-7.7, 0.60, 0.05, 0.12, 0.12],
    [-7.0, 0.64, 0.10, 0.24, 0.22],
    [-6.0, 0.72, 0.19, 0.34, 0.30],
    [-4.8, 0.82, 0.30, 0.46, 0.40],
    [-3.6, 0.90, 0.43, 0.54, 0.47],
    [-2.8, 0.92, 0.58, 0.60, 0.52],
    [-1.8, 0.90, 0.78, 0.63, 0.56],
    [-0.2, 0.90, 0.86, 0.66, 0.58],
    [1.0, 0.89, 0.86, 0.65, 0.56],
    [1.8, 0.85, 0.90, 0.60, 0.49],
    [2.4, 0.78, 1.00, 0.50, 0.42],
    [3.0, 0.73, 1.00, 0.45, 0.38],
    [3.6, 0.71, 0.93, 0.42, 0.36],
    [4.3, 0.70, 0.80, 0.40, 0.34],
  ], { front: 0.95, back: 0.7 });

  // Tail fin: dorsal from the back of the head to the tail tip, ventral from the vent.
  const dorsal = new Fin([
    [-7.5, 0.60, 0.72, 0.05], [-7.0, 0.66, 0.98, 0.05], [-6.0, 0.72, 1.15, 0.05], [-4.8, 0.80, 1.36, 0.05], [-3.6, 0.90, 1.5, 0.05],
    [-2.8, 0.92, 1.50, 0.05], [-1.8, 0.95, 1.47, 0.05], [-0.4, 0.98, 1.42, 0.05], [0.8, 1.0, 1.36, 0.045], [1.8, 0.95, 1.27, 0.04],
  ]);
  const ventral = new Fin([
    [-7.4, 0.42, 0.62, 0.05], [-6.6, 0.28, 0.66, 0.05], [-5.6, 0.14, 0.72, 0.05], [-4.6, 0.10, 0.74, 0.05], [-3.7, 0.16, 0.66, 0.05], [-3.0, 0.3, 0.5, 0.045],
  ]);

  // Legs: right side, then mirrored. Shoulder, elbow, wrist / hip, knee, ankle.
  const legs = [];
  for (const side of [-1, 1]) {
    for (const back of [false, true]) {
      const pts = back
        ? [[0.62, 0.72, -2.4], [1.5, 0.46, -1.95], [1.95, 0.10, -2.55]]
        : [[0.66, 0.72, 1.55], [1.45, 0.44, 1.12], [1.88, 0.09, 1.66]];
      const rads = back ? [0.30, 0.2, 0.14] : [0.27, 0.18, 0.13];
      const rods = new Rods();
      rods.chain(flipX(pts, side), rads, 0, 0.55);
      const w = pts[2];
      const fine = st.hi;
      const fr = fine ? [0.075, 0.042] : [0.085, 0.06];
      if (back) digits({ base: [w[0] + 0.02, 0.085, w[2] + 0.12], angles: [-42, -22, -2, 20, 42], lens: [0.5, 0.7, 0.82, 0.74, 0.55], r0: fr[0], r1: fr[1] }, side, rods, 0.55, 1);
      else digits({ base: [w[0] + 0.02, 0.085, w[2] + 0.1], angles: [-30, -10, 10, 30], lens: [0.66, 0.86, 0.84, 0.6], r0: fr[0], r1: fr[1] }, side, rods, 0.55, 1);
      // palm / sole
      const pad = [w[0] * side + 0.02 * side, 0.075, w[2] + 0.06, 0, 1, back ? 0.2 : 0.17, 0.075, back ? 0.2 : 0.16, 0.6];
      legs.push(new Limb(back ? (side < 0 ? 3 : 4) : side < 0 ? 1 : 2, rods, [pad]));
    }
  }

  // Gills: three stalks per side, each a bottle-brush of filaments.
  const GILLS = [
    { base: [0.80, 0.36, 2.2], dir: [0.42, 0.78, -0.46], len: 1.5, curl: [0.05, 0.14, -0.2] },
    { base: [0.90, 0.06, 2.15], dir: [0.86, 0.34, -0.38], len: 1.7, curl: [0.1, 0.16, -0.25] },
    { base: [0.90, -0.24, 2.05], dir: [0.88, -0.05, -0.47], len: 1.35, curl: [0.1, 0.1, -0.25] },
  ];
  const gills = [];
  for (const side of [-1, 1]) {
    GILLS.forEach((g, gi) => {
      const rods = new Rods();
      const cy = loft.t.v(0, g.base[2]);
      const B = [g.base[0] * side, cy + g.base[1], g.base[2]];
      const D = norm3([g.dir[0] * side, g.dir[1], g.dir[2]]);
      const cv = [g.curl[0] * side, g.curl[1], g.curl[2]];
      const Mid = add3(add3(B, D, g.len * 0.5), cv, 0.4), T = add3(add3(B, D, g.len), cv, 1);
      const fine = st.hi;
      const rr = fine ? [0.115, 0.08, 0.05] : [0.14, 0.1, 0.07];
      rods.chain([B, Mid, T], rr);
      // frame for the filament fan
      const P0 = norm3(cross3(D, [0, 1, 0.01])), Q0 = cross3(D, P0);
      const n = fine ? 15 : 7;
      const fr0 = fine ? 0.047 : 0.08, fr1 = fine ? 0.026 : 0.05;
      for (let i = 0; i < n; i++) {
        const s = 0.12 + (0.86 * i) / (n - 1);
        // point on the (quadratic) rachis
        const q = s < 0.5 ? add3(B, add3(Mid, B, -1), s / 0.5) : add3(Mid, add3(T, Mid, -1), (s - 0.5) / 0.5);
        const phi = i * 2.4 + gi * 1.3 + (side < 0 ? 0.7 : 0);
        const th = 0.9 + 0.25 * (hash1(i + gi * 7) - 0.5);
        const dir = norm3(add3(add3(D, [0, 0, 0], 0), add3(P0.map((v) => v * Math.cos(phi)), Q0, Math.sin(phi)), Math.tan(th) * 0.95));
        const len = (fine ? 0.62 : 0.55) * (1 - 0.5 * s) * (0.85 + 0.3 * hash1(i * 3 + gi));
        const swept = [dir[0], dir[1] - 0.05, dir[2] - 0.15];
        const dd = norm3(swept);
        rods.add(q, add3(q, dd, len), fr0, fr1);
      }
      rods.done();
      gills.push({ side, gi, rods, B, D, T });
    });
  }

  // Eyes: tiny, lidless, set on the top of the head, well apart.
  const eyes = [-1, 1].map((s) => makeEye(loft, 0.52 * s, 0, 3.32, 0.15, 0.4));
  // Mouth line: a wide smile whose corners rise toward the eyes.
  const mouth = new Table([[2.2, 1.06], [2.5, 0.98], [2.8, 0.86], [3.2, 0.7], [3.8, 0.66], [4.3, 0.66]], 0.02);
  const mouthY = (z) => mouth.v(0, z);

  const parts = [
    { near: (x, y, z) => -1, d: () => 9, k: 0.1 },
  ];
  parts.length = 0;
  for (const l of legs) parts.push({ near: (x, y, z) => l.near(x, y, z), d: (x, y, z) => l.d(x, y, z), k: 0.2 });
  for (const g of gills) parts.push({ near: (x, y, z) => g.rods.near(x, y, z), d: (x, y, z) => g.rods.d(x, y, z), k: 0.1 });
  for (const e of eyes) parts.push({ near: sphereNear(e.c, e.r), d: (x, y, z) => Math.hypot(x - e.c[0], y - e.c[1], z - e.c[2]) - e.r, k: 0.05 });
  const dorsalNear = (x, y, z) => (z < dorsal.z0 - 0.3 || z > dorsal.z1 + 0.3 || y < 0.7 ? 1 : 0) * 1 - 0.0;
  parts.push({ near: (x, y, z) => (Math.abs(x) > 0.3 ? Math.abs(x) - 0.3 : 0) + (y < 0.6 ? 0.6 - y : 0), d: (x, y, z) => dorsal.d(x, y, z), k: 0.12 });
  parts.push({ near: (x, y, z) => (Math.abs(x) > 0.3 ? Math.abs(x) - 0.3 : 0) + (z > -2.4 ? z + 2.4 : 0) + (y > 1.0 ? y - 1.0 : 0), d: (x, y, z) => ventral.d(x, y, z), k: 0.12 });

  const core = (x, y, z) => {
    let d = loft.d(x, y, z);
    // the mouth line: a fine groove around the front and along the jaw
    if (z > 2.1) {
      const e = y - mouthY(z);
      if (e * e < 0.02) d += 0.03 * Math.exp(-(e * e) / 0.0045) * sstep(2.1, 2.5, z);
    }
    return d;
  };
  const sdf = (x, y, z) => unite(core(x, y, z), x, y, z, parts);
  return { loft, dorsal, ventral, legs, gills, eyes, mouthY, sdf, core };
}

export function axolotlBody(morph = 'leucistic') {
  const m = typeof morph === 'string' ? AXOLOTL_MORPHS[morph] ?? AXOLOTL_MORPHS.leucistic : morph;
  const st = { hi: false };
  const S = axolotlShape(st);
  const { loft, dorsal, ventral, legs, gills, eyes, mouthY, sdf } = S;
  const cs = {
    skin: C(m.skin), back: C(m.back), belly: C(m.belly), fin: C(m.fin), finEdge: C(m.finEdge), gill: C(m.gill), gillBase: C(m.gillBase),
    lip: C(m.lip), eye: C(m.eye), iris: C(m.iris), ring: C(m.ring), spot: m.spots && C(m.spots.col), blotch: m.blotch && C(m.blotch.col),
  };
  const zS = 4.3, zT = -7.7;
  const sc = [0, 0, 0, 0];

  // Per-vertex analysis, cached because color, rig and mat are asked in turn for the same point.
  let last = null, lx = NaN, ly = NaN, lz = NaN;
  const analyze = (x, y, z) => {
    if (x === lx && y === ly && z === lz) return last;
    lx = x; ly = y; lz = z;
    const a = { kind: 'body', leg: 0, legT: 0, eye: null, gill: null, fin: 0, dBody: 0 };
    const dBody = S.core(x, y, z);
    a.dBody = dBody;
    // eyes
    for (const e of eyes) {
      const rx = x - e.c[0], ry = y - e.c[1], rz = z - e.c[2], dd = Math.hypot(rx, ry, rz);
      if (dd < e.r + 0.03) {
        const c = (rx * e.axis[0] + ry * e.axis[1] + rz * e.axis[2]) / (dd || 1);
        if (c > 0.15) { a.kind = 'eye'; a.eye = { c, e }; return (last = a); }
      }
    }
    // gills
    let bg = 1e9, bgi = null;
    for (const g of gills) {
      if (g.rods.near(x, y, z) > 0.2) continue;
      const dg = g.rods.d(x, y, z);
      if (dg < bg) { bg = dg; bgi = g; }
    }
    if (bgi && bg < 0.06 && dBody > 0.02) { a.kind = 'gill'; a.gill = bgi; a.dg = bg; return (last = a); }
    // fins
    const df = Math.min(dorsal.d(x, y, z), ventral.d(x, y, z));
    const dc = loft.d(x, y, z);
    if (df < 0.05 && dc > 0.045) { a.kind = 'fin'; a.fin = df; a.dc = dc; return (last = a); }
    // legs
    const side = x < 0 ? -1 : 1;
    let bl = null, bd = 1e9;
    for (const l of legs) {
      if ((l.id === 1 || l.id === 3) !== (side < 0)) continue;
      if (l.near(x, y, z) > 0.3) continue;
      const dl = l.dt(x, y, z);
      if (dl < bd) { bd = dl; bl = l; a.lt = l.t; }
    }
    if (bl && bd < dc + 0.01 && dc > 0) {
      a.kind = 'limb'; a.leg = bl.id;
      a.legT = clamp01((a.lt - 0.08) / 0.92) * sstep(0.0, 0.45, dc);
    }
    return (last = a);
  };

  const spatter = (x, y, z, scale, thr) => {
    const c = cells(x, y, z, scale);
    return sstep(thr + 0.06, thr - 0.06, c + (vnoise(x * 3, y * 3, z * 3) - 0.5) * 0.35);
  };

  const color = (x, y, z) => {
    const a = analyze(x, y, z);
    if (a.kind === 'eye') {
      const { c, e } = a.eye, th = Math.acos(Math.min(1, c));
      const pupil = sstep(0.42, 0.34, th), ring = sstep(0.95, 0.6, th);
      let col = lerp3(cs.ring, cs.iris, sstep(0.3, 0.7, th));
      col = lerp3(col, cs.eye, pupil);
      return lerp3(cs.eye, col, ring);
    }
    if (a.kind === 'gill') {
      const t = clamp01((Math.hypot(x - a.gill.B[0], y - a.gill.B[1], z - a.gill.B[2])) / 1.6);
      return lerp3(cs.gillBase, cs.gill, sstep(0.05, 0.4, t));
    }
    if (a.kind === 'fin') {
      const e = sstep(0.0, 0.5, a.fin === 0 ? 0.3 : 0);
      return lerp3(cs.fin, cs.finEdge, sstep(0.25, 0.7, clamp01(a.dc / 1.1)));
    }
    // body: dorsal to ventral tint from the loft cross-section
    loft.sect(z, sc);
    const yy = y - sc[0], v = yy / (yy >= 0 ? sc[2] : sc[3]);
    let col = lerp3(cs.belly, cs.back, sstep(-0.75, 0.25, v));
    col = lerp3(col, cs.skin, 0.35);
    // head: soft flush; mouth line and nostrils
    if (z > 2.1) {
      const e = y - mouthY(z);
      const line = Math.exp(-(e * e) / 0.0035) * sstep(2.1, 2.6, z);
      col = lerp3(col, cs.lip, line * 0.75);
      for (const s of [-1, 1]) {
        const dn = Math.hypot(x - s * 0.3, y - (loft.top(0.3, 4.05) - 0.03), z - 4.05);
        col = lerp3(col, mul3(cs.back, 0.25), sstep(0.09, 0.03, dn) * 0.9);
      }
    }
    // cloaca
    const cl = Math.hypot(x * 1.6, (y - sc[0] + sc[3]) * 1.4, (z + 2.95) * 0.9);
    if (cl < 0.4 && v < -0.7) col = lerp3(col, mul3(cs.lip, 0.85), sstep(0.4, 0.15, cl) * 0.8);
    if (cs.blotch) {
      const b = spatter(x, y, z, m.blotch.scale, m.blotch.thr) * sstep(-0.9, 0.0, v);
      col = lerp3(col, cs.blotch, b * 0.85);
    }
    if (cs.spot) {
      const dsp = cells(x, y, z, m.spots.scale);
      col = lerp3(col, cs.spot, sstep(0.24, 0.16, dsp) * m.spots.amt * 2 * sstep(-0.5, 0.2, v));
    }
    return col;
  };

  const mat = (x, y, z) => {
    const a = analyze(x, y, z);
    return a.kind === 'eye' ? M.EYE : a.kind === 'gill' || a.kind === 'fin' ? M.FIN : M.GLOSS;
  };

  const rig = (x, y, z) => {
    const a = analyze(x, y, z);
    return [clamp01((zS - z) / (zS - zT)), a.leg, a.legT];
  };

  const def = { sdf, lo: [-3.4, -0.25, -8.1], hi: [3.4, 2.5, 4.7], color, mat, rig, finish: { rough: 0.32, coat: 0.9, coatRough: 0.08, grain: 14, bump: 0.0005, tone: 0.02, flutter: 0.045 } };
  return lodDef(def, 0.1, 0.5, st);
}

// ==================================================================================================
// exports
// ==================================================================================================

export const SALAMANDERS = {
  newt: () => newtBody(),
  axolotl: () => axolotlBody('leucistic'),
  gecko: () => geckoBody(),
};

function newtBody() { return { sdf: (x, y, z) => ell(x, y - 1, z, 1, 1, 3), lo: [-2, -0.3, -4], hi: [2, 2.5, 4], cell: 0.1, color: () => C(0x3a3020) }; }
function geckoBody() { return { sdf: (x, y, z) => ell(x, y - 1, z, 1, 1, 3), lo: [-2, -0.3, -4], hi: [2, 2.5, 4], cell: 0.1, color: () => C(0xb89f7c) }; }
