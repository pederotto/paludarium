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
// Smoothstep that accepts reversed edges (a > b gives a falling ramp).
const sm = (a, b, x) => { let t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
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
    this.pad = null;
    for (const p of this.pads) { const q = this.padD(p, x, y, z); if (q < d) { d = q; this.t = p[8]; this.pad = p; } }
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

// Morph palettes (sRGB hex; C() converts to linear). Spec morph ids: wild, leucistic, golden, melanoid, white_albino.
// skin/back/belly: body tints; fin/finEdge: tail fin; gill/gillBase: gill tip/root; lip: mouth line;
// eye/iris/ring: pupil+limbus, outer iris, inner iris (eye palette); spots: gold flecks; blotch: dark patches.
export const AXOLOTL_MORPHS = {
  // Leucistic ("pink"): pale pink-white body, deep red gills, black eyes.
  leucistic: { name: 'leucistic', skin: 0xf3cdc9, back: 0xf1c6c4, belly: 0xfae7e1, fin: 0xf6cfcf, finEdge: 0xf0b3b6, gill: 0xc41e3a, gillBase: 0xe05a6e, lip: 0xd99aa0, eye: 0x080506, iris: 0x24120e, ring: 0x40261c, spots: null, blotch: null },
  // Wild type: dark olive-brown with darker blotches and gold iridophore flecks; dusky gills, dark eyes.
  wild: { name: 'wild', skin: 0x5a4d36, back: 0x382f22, belly: 0x82755e, fin: 0x4a4030, finEdge: 0x2a251d, gill: 0x5b2a33, gillBase: 0x6a4038, lip: 0x554a3a, eye: 0x070605, iris: 0x2a2010, ring: 0xa88a30, spots: { col: 0xc2a84a, amt: 0.35, scale: 5.5 }, blotch: { col: 0x171612, scale: 1.3, thr: 0.5 } },
  // Golden albino: yellow-gold, orange gills, pale pink eyes.
  golden: { name: 'golden', skin: 0xe8b640, back: 0xe2a838, belly: 0xf6dc86, fin: 0xeec860, finEdge: 0xeaa638, gill: 0xe8602a, gillBase: 0xf49a5c, lip: 0xcc9238, eye: 0x93303e, iris: 0xd9707e, ring: 0xf2a8b2, spots: null, blotch: null },
  // Melanoid: all-over slate black, no reflective flecks, dark plum gills, black eyes.
  melanoid: { name: 'melanoid', skin: 0x1c1b20, back: 0x121216, belly: 0x2a2a30, fin: 0x1a191e, finEdge: 0x101014, gill: 0x3c2438, gillBase: 0x3a2a3a, lip: 0x2a2a30, eye: 0x030304, iris: 0x0c0b0d, ring: 0x1a1a20, spots: null, blotch: null },
  // White albino: cream-white body, pale pink gills, pink-red eyes.
  white_albino: { name: 'white_albino', skin: 0xf6efe2, back: 0xf1e8d8, belly: 0xfdf8ee, fin: 0xf8f1e6, finEdge: 0xf4e0da, gill: 0xf4a2b2, gillBase: 0xf9cfd2, lip: 0xeac6bf, eye: 0x93303e, iris: 0xdc7284, ring: 0xf6b0ba, spots: null, blotch: null },
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
    { base: [0.80, 0.34, 2.2], dir: [0.55, 0.52, -0.66], len: 1.75, curl: [0.12, -0.12, -0.28] },
    { base: [0.90, 0.06, 2.15], dir: [0.86, 0.18, -0.5], len: 1.95, curl: [0.14, -0.14, -0.3] },
    { base: [0.90, -0.24, 2.05], dir: [0.84, -0.12, -0.55], len: 1.5, curl: [0.12, -0.12, -0.3] },
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
      const n = fine ? 26 : 10;
      const fr0 = fine ? 0.04 : 0.075, fr1 = fine ? 0.02 : 0.045;
      for (let i = 0; i < n; i++) {
        const s = 0.12 + (0.86 * i) / (n - 1);
        // point on the (quadratic) rachis
        const q = s < 0.5 ? add3(B, add3(Mid, B, -1), s / 0.5) : add3(Mid, add3(T, Mid, -1), (s - 0.5) / 0.5);
        const phi = i * 2.4 + gi * 1.3 + (side < 0 ? 0.7 : 0);
        const th = 0.9 + 0.25 * (hash1(i + gi * 7) - 0.5);
        const dir = norm3(add3(add3(D, [0, 0, 0], 0), add3(P0.map((v) => v * Math.cos(phi)), Q0, Math.sin(phi)), Math.tan(th) * 0.95));
        const len = (fine ? 0.78 : 0.66) * (1 - 0.45 * s) * (0.8 + 0.4 * hash1(i * 3 + gi));
        const swept = [dir[0], dir[1] - 0.22, dir[2] - 0.3];
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
      a.legT = clamp01((a.lt - 0.08) / 0.92) * sm(0.0, 0.45, dc);
    }
    return (last = a);
  };

  const spatter = (x, y, z, scale, thr) => {
    const c = cells(x, y, z, scale);
    return sm(thr + 0.06, thr - 0.06, c + (vnoise(x * 3, y * 3, z * 3) - 0.5) * 0.35);
  };

  const color = (x, y, z) => {
    const a = analyze(x, y, z);
    if (a.kind === 'eye') {
      const { c, e } = a.eye, th = Math.acos(Math.min(1, c));
      const pupil = sm(0.42, 0.34, th), ring = sm(0.95, 0.6, th);
      let col = lerp3(cs.ring, cs.iris, sm(0.3, 0.7, th));
      col = lerp3(col, cs.eye, pupil);
      return lerp3(cs.eye, col, ring);
    }
    if (a.kind === 'gill') {
      const t = clamp01((Math.hypot(x - a.gill.B[0], y - a.gill.B[1], z - a.gill.B[2])) / 1.6);
      return lerp3(cs.gillBase, cs.gill, sm(0.05, 0.4, t));
    }
    if (a.kind === 'fin') {
      const e = sm(0.0, 0.5, a.fin === 0 ? 0.3 : 0);
      return lerp3(cs.fin, cs.finEdge, sm(0.25, 0.7, clamp01(a.dc / 1.1)));
    }
    // body: dorsal to ventral tint from the loft cross-section
    loft.sect(z, sc);
    const yy = y - sc[0], v = yy / (yy >= 0 ? sc[2] : sc[3]);
    let col = lerp3(cs.belly, cs.back, sm(-0.75, 0.25, v));
    col = lerp3(col, cs.skin, 0.35);
    // head: soft flush; mouth line and nostrils
    if (z > 2.1) {
      const e = y - mouthY(z);
      const line = Math.exp(-(e * e) / 0.0035) * sm(2.1, 2.6, z);
      col = lerp3(col, cs.lip, line * 0.75);
      for (const s of [-1, 1]) {
        const dn = Math.hypot(x - s * 0.3, y - (loft.top(0.3, 4.05) - 0.03), z - 4.05);
        col = lerp3(col, mul3(cs.back, 0.25), sm(0.09, 0.03, dn) * 0.9);
      }
    }
    // cloaca
    const cl = Math.hypot(x * 1.6, (y - sc[0] + sc[3]) * 1.4, (z + 2.95) * 0.9);
    if (cl < 0.4 && v < -0.7) col = lerp3(col, mul3(cs.lip, 0.85), sm(0.4, 0.15, cl) * 0.8);
    if (cs.blotch) {
      const b = spatter(x, y, z, m.blotch.scale, m.blotch.thr) * sm(-0.9, 0.0, v);
      col = lerp3(col, cs.blotch, b * 0.85);
    }
    if (cs.spot) {
      const dsp = cells(x, y, z, m.spots.scale);
      col = lerp3(col, cs.spot, sm(0.24, 0.16, dsp) * m.spots.amt * 2 * sm(-0.5, 0.2, v));
    }
    return col;
  };

  // (Skin, not GLOSS: the material id is interpolated across a triangle, and 5 to 2 would pass through the iridescent id 3.)
  const mat = (x, y, z) => {
    const a = analyze(x, y, z);
    return a.kind === 'gill' || a.kind === 'fin' ? M.FIN : M.SKIN;
  };

  const rig = (x, y, z) => {
    const a = analyze(x, y, z);
    return [clamp01((zS - z) / (zS - zT)), a.leg, a.legT];
  };

  const def = { sdf, lo: [-3.4, -0.25, -8.1], hi: [3.4, 2.5, 4.7], color, mat, rig, finish: {
    rough: 0.36, coat: 0.55, coatRough: 0.2, coatBump: 0.004, grain: 14, bump: 0.0005, tone: 0.02, flutter: 0.045, finOpacity: 0.55,
    eyes: [eyeSpec(eyes[1], { pupil: [0.5, 0.5], inner: C(m.ring), outer: C(m.iris), rim: C(m.eye), seed: 5 })],
  } };
  return lodDef(def, 0.1, 0.5, st);
}

// ==================================================================================================
// exports
// ==================================================================================================

export const SALAMANDERS = {
  newt: () => newtBody(),
  marbled: () => marbledBody(),
  axolotl: () => axolotlBody('leucistic'),
  gecko: () => geckoBody(),
};
// One body per axolotl morph: BODIES['axolotl:golden'] etc. (same geometry, different palette).
for (const k of Object.keys(AXOLOTL_MORPHS)) SALAMANDERS[`axolotl:${k}`] = () => axolotlBody(k);

// The limb (if any) whose surface is nearest to a point: { id, t, pad } with t = legT for the rig.
// An analytic eye (material.js finish.eyes) for the +x eye of `e` (makeEye); the material mirrors it to -x.
// h is the horizontal tangent, w the other one (vertical in the eye's frame).
function eyeSpec(e, o) {
  const a = norm3(e.axis), h = norm3(cross3(a, Math.abs(a[1]) > 0.85 ? [0, 0, 1] : [0, 1, 0]));
  return { c: e.c, r: e.r, axis: a, h, w: norm3(cross3(a, h)), ...o };
}
function legAt(legs, x, y, z, dc) {
  const left = x < 0;
  let bl = null, bd = 1e9, bt = 0, bp = null;
  for (const l of legs) {
    if ((l.id === 1 || l.id === 3) !== left) continue;
    if (l.near(x, y, z) > 0.3) continue;
    const dl = l.dt(x, y, z);
    if (dl < bd) { bd = dl; bl = l; bt = l.t; bp = l.pad; }
  }
  if (bl && bd < dc + 0.01 && dc > 0) return { id: bl.id, t: clamp01((bt - 0.08) / 0.92) * sm(0.0, 0.45, dc), pad: bp };
  return null;
}

// A dark spatter of round blotches (cells noise with a wobbly edge).
const spatter = (x, y, z, scale, thr) => {
  const c = cells(x, y, z, scale);
  return sm(thr + 0.05, thr - 0.05, c + (vnoise(x * 3, y * 3, z * 3) - 0.5) * 0.3);
};

// ==================================================================================================
// PADDLE-TAIL NEWT  (Pachytriton labiatus, about 11 cm)
// A stocky stream newt built for the bottom of cold, fast water: a broad, flat head with a rounded snout, small eyes set high
// and lobes of the upper lip folding over the lower jaw at the corners of the mouth; a trunk wider than it is high; short,
// fleshy limbs (four fingers, five toes, blunt and pad-less); and the paddle that names it: a tail as long as the trunk,
// flattened from the sides into a deep blade with thin edges and a rounded end. The skin is smooth and slick, not warty.
// Above it is dark chocolate brown with fine black dots and a few orange-red flecks along the sides of the back and tail;
// below, bright orange-red marbled with black, the orange running out along the lower edge of the tail and under the limbs.
// ==================================================================================================

function newtShape(st) {
  // The muscular core: head, trunk and the base and axis of the tail (rows [z, centre height, half width, upper and lower half
  // height]). The deep paddle of the tail is a thin blade (Fin) blended onto it, so its edges are a millimetre thick.
  const loft = new Loft([
    [-6.3, 0.56, 0.05, 0.12, 0.10],
    [-5.6, 0.57, 0.09, 0.30, 0.22],
    [-4.6, 0.58, 0.14, 0.40, 0.30],
    [-3.6, 0.60, 0.23, 0.46, 0.34],
    [-2.7, 0.62, 0.38, 0.50, 0.38],
    [-1.9, 0.63, 0.58, 0.52, 0.42],
    [-1.2, 0.64, 0.76, 0.54, 0.45],
    [-0.2, 0.65, 0.86, 0.56, 0.47],
    [0.9, 0.65, 0.87, 0.56, 0.46],
    [1.8, 0.64, 0.81, 0.54, 0.44],
    [2.5, 0.63, 0.71, 0.48, 0.40],
    [3.1, 0.62, 0.78, 0.42, 0.37],
    [3.7, 0.61, 0.72, 0.38, 0.33],
    [4.2, 0.59, 0.59, 0.32, 0.28],
    [4.7, 0.57, 0.41, 0.24, 0.21],
  ], { front: 0.45, back: 0.3 });
  // The paddle: [z, lower edge, upper edge, half thickness]; low over the hips, deepest two thirds of the way back, rounded off.
  const blade = new Fin([
    [-6.3, 0.44, 0.74, 0.05],
    [-5.95, 0.22, 1.04, 0.05],
    [-5.4, 0.12, 1.24, 0.05],
    [-4.6, 0.09, 1.33, 0.055],
    [-3.6, 0.1, 1.32, 0.06],
    [-2.6, 0.16, 1.24, 0.065],
    [-1.7, 0.28, 1.12, 0.07],
  ]);
  const legs = [];
  for (const side of [-1, 1]) {
    for (const back of [false, true]) {
      // Upper limb out sideways from the body, the lower one down to the ground, the hand or foot flat with the digits fanned
      // forward and out (a sprawling stance, elbows and knees above the body's lower edge).
      const pts = back ? [[0.6, 0.52, -1.3], [1.28, 0.48, -1.08], [1.48, 0.13, -1.38]] : [[0.58, 0.52, 1.85], [1.18, 0.48, 1.95], [1.36, 0.13, 2.13]];
      const rads = back ? [0.34, 0.26, 0.185] : [0.3, 0.235, 0.17];
      const rods = new Rods();
      rods.chain(flipX(pts, side), rads, 0, 0.55);
      const w = pts[2], fr = st.hi ? [0.088, 0.066] : [0.1, 0.08];
      if (back) digits({ base: [w[0] + 0.03, 0.075, w[2] + 0.08], angles: [-34, -12, 8, 28, 50], lens: [0.34, 0.54, 0.66, 0.58, 0.36], r0: fr[0], r1: fr[1], lift: 0.01 }, side, rods, 0.55, 1);
      else digits({ base: [w[0] + 0.03, 0.075, w[2] + 0.08], angles: [-26, -4, 18, 42], lens: [0.36, 0.54, 0.58, 0.4], r0: fr[0], r1: fr[1], lift: 0.01 }, side, rods, 0.55, 1);
      const pad = [(w[0] + 0.03) * side, 0.075, w[2] + 0.05, 0, 1, back ? 0.24 : 0.21, 0.075, back ? 0.23 : 0.2, 0.6];
      legs.push(new Limb(back ? (side < 0 ? 3 : 4) : side < 0 ? 1 : 2, rods, [pad]));
    }
  }
  // Small eyes set high on the sides of the flat head.
  const eyes = [-1, 1].map((s) => makeEye(loft, 0.5 * s, 0, 3.78, 0.15, 0.45));
  // The labial lobes: a fold of the upper lip hanging over the lower jaw at each corner of the mouth.
  const lobes = [-1, 1].map((s) => ({ c: [0.62 * s, 0.44, 3.0], r: [0.17, 0.13, 0.38] }));
  const mouth = new Table([[2.75, 0.44], [3.2, 0.43], [3.8, 0.44], [4.3, 0.46], [4.75, 0.49]], 0.02);
  const parts = [];
  for (const l of legs) parts.push({ near: (x, y, z) => l.near(x, y, z), d: (x, y, z) => l.d(x, y, z), k: 0.18 });
  for (const e of eyes) parts.push({ near: sphereNear(e.c, e.r), d: (x, y, z) => Math.hypot(x - e.c[0], y - e.c[1], z - e.c[2]) - e.r, k: 0.06 });
  for (const b of lobes) parts.push({ near: sphereNear(b.c, b.r[2]), d: (x, y, z) => ell(x - b.c[0], y - b.c[1], z - b.c[2], b.r[0], b.r[1], b.r[2]), k: 0.1 });
  parts.push({ near: (x, y, z) => (z > -1.5 ? z + 1.5 : Math.max(0, Math.abs(x) - 0.4)), d: (x, y, z) => blade.d(x, y, z), k: 0.16 });
  const core = (x, y, z) => loft.d(x, y, z);
  const sdf = (x, y, z) => unite(core(x, y, z), x, y, z, parts);
  return { loft, legs, eyes, mouthY: (z) => mouth.v(0, z), sdf, core };
}

function newtBody() {
  const st = { hi: false };
  const S = newtShape(st);
  const { loft, legs, eyes, mouthY, sdf } = S;
  const cs = {
    back: C(0x33261a), dark: C(0x150f0a), flank: C(0x453221), belly: C(0xe2561c), belly2: C(0xc8401a), black: C(0x120d0a),
    fleck: C(0xd64a1a), edge: C(0xe86a22), lip: C(0x120d09), eye: C(0x050403), ring: C(0x6a5224),
  };
  const zS = 4.7, zT = -6.3, sc = [0, 0, 0, 0];
  let last = null, lx = NaN, ly = NaN, lz = NaN;
  const analyze = (x, y, z) => {
    if (x === lx && y === ly && z === lz) return last;
    lx = x; ly = y; lz = z;
    const a = { kind: 'body', leg: 0, legT: 0, eye: null };
    for (const e of eyes) {
      const rx = x - e.c[0], ry = y - e.c[1], rz = z - e.c[2], dd = Math.hypot(rx, ry, rz);
      if (dd < e.r + 0.03) {
        const c = (rx * e.axis[0] + ry * e.axis[1] + rz * e.axis[2]) / (dd || 1);
        if (c > 0.15) { a.kind = 'eye'; a.eye = { c }; return (last = a); }
      }
    }
    const dc = loft.d(x, y, z);
    const L = legAt(legs, x, y, z, dc);
    if (L) { a.kind = 'limb'; a.leg = L.id; a.legT = L.t; }
    return (last = a);
  };
  // Sparse round flecks (cells noise): only the cells whose hash is high get one, so they are few and scattered.
  const fleck = (x, y, z, scale, r) => {
    const c = cells(x, y, z, scale);
    const h = hash1(Math.floor(x * scale * 0.7) * 7.1 + Math.floor(y * scale * 0.7) * 13.3 + Math.floor(z * scale * 0.7) * 3.7);
    return h > 0.55 ? sm(r + 0.05, r - 0.03, c) : 0;
  };
  const color = (x, y, z) => {
    const a = analyze(x, y, z);
    if (a.kind === 'eye') {
      const th = Math.acos(Math.min(1, a.eye.c));
      const iris = lerp3(cs.ring, cs.eye, sm(0.35, 0.75, th));
      return lerp3(cs.eye, iris, sm(1.0, 0.7, th) * 0.8 + 0.1);
    }
    if (a.kind === 'limb') {
      // Brown on top, orange underneath and on the soles; the digits' tips paler.
      // (the upper side of the limb is brown like the back; the orange of the belly shows underneath, on the palms and soles,
      // and dusts the digits, whose tips are paler)
      let col = lerp3(cs.back, cs.flank, 0.5);
      const under = sm(0.3, 0.08, y) * 0.75 + sm(0.62, 0.95, a.legT) * 0.25;
      col = lerp3(col, lerp3(cs.belly2, cs.flank, 0.35), under);
      col = lerp3(col, cs.edge, sm(0.9, 1.0, a.legT) * 0.35);
      col = lerp3(col, cs.dark, spatter(x * 2.6, y * 2.6, z * 2.6, 2.8, 0.16) * (1 - under) * 0.6);
      return mul3(col, 0.94 + 0.12 * vnoise(x * 6, y * 6, z * 6));
    }
    loft.sect(z, sc);
    const yy = y - sc[0], v = yy / (yy >= 0 ? sc[2] : sc[3]);          // -1 the belly, 1 the back, beyond: the tail's blade
    // Brown above, orange-red below, the line between them low on the flanks and wavering.
    const edge = -0.38 + 0.18 * (vnoise(x * 1.3 + 4, y * 1.3, z * 1.1) - 0.5);
    let col = lerp3(lerp3(cs.belly, cs.belly2, vnoise(x * 2, y * 2, z * 2)), cs.flank, sm(edge - 0.1, edge + 0.14, v));
    col = lerp3(col, cs.back, sm(0.05, 0.65, v));
    // Black marbling on the belly and throat.
    // (vermiculation: the black follows the level lines of a noise field and pools into blotches where it is high)
    const mf = fbm(x * 1.5 + 9, y * 1.5, z * 1.15);
    const marb = Math.max(sm(0.055, 0.02, Math.abs(mf - 0.5)), sm(0.64, 0.7, mf));
    col = lerp3(col, cs.black, marb * sm(edge - 0.06, edge - 0.3, v) * 0.92);
    // Fine black dots over the back and sides.
    col = lerp3(col, cs.dark, spatter(x * 2.2, y * 2.2, z * 2.2, 2.6, 0.17) * sm(edge, edge + 0.4, v) * 0.75);
    // A few orange-red flecks along the sides of the back, and on the tail.
    const fl = fleck(x, y, z, 2.1, 0.14) * sm(0.05, 0.3, v) * sm(0.85, 0.55, v) * sm(2.6, 1.8, z);
    col = lerp3(col, cs.fleck, fl * 0.9);
    // The tail: the orange of the belly runs back along the blade's lower edge; the upper edge darkest.
    if (z < -1.4) {
      const tailK = sm(-1.4, -2.4, z);
      col = lerp3(col, cs.edge, sm(-0.75, -1.15, v) * tailK);
      col = lerp3(col, cs.dark, sm(1.1, 1.8, v) * tailK * 0.5);
    }
    // The head: the lip line, the gular fold across the throat, the nostrils.
    if (z > 2.4) {
      const e = y - mouthY(z);
      col = lerp3(col, cs.lip, Math.exp(-(e * e) / 0.0025) * sm(2.7, 3.0, z) * 0.85);
      col = lerp3(col, cs.black, Math.exp(-((z - 2.62) ** 2) / 0.002) * sm(-0.2, -0.5, v) * 0.6);
      for (const s of [-1, 1]) {
        const dn = Math.hypot(x - s * 0.17, y - (loft.top(0.17, 4.55) - 0.03), z - 4.55);
        col = lerp3(col, cs.black, sm(0.07, 0.025, dn) * 0.95);
      }
    }
    return mul3(col, 0.93 + 0.14 * vnoise(x * 5, y * 5, z * 5));
  };
  const mat = () => M.SKIN;
  const rig = (x, y, z) => { const a = analyze(x, y, z); return [clamp01((zS - z) / (zS - zT)), a.leg, a.legT]; };
  // Smooth, slick, wet skin (a faint grain, a clear coat), and small dark eyes with a gold-flecked iris.
  const def = { sdf, lo: [-2.6, -0.25, -6.6], hi: [2.6, 1.8, 5.0], color, mat, rig, finish: {
    rough: 0.46, coat: 0.3, coatRough: 0.3, grain: 9, bump: 0.12, tone: 0.04, flutter: 0.02,
    eyes: [eyeSpec(eyes[1], { pupil: [0.4, 0.4], inner: C(0x9a7a30), outer: C(0x3a2410), rim: C(0x040302), limb: C(0x140d06), seed: 7 })],
  } };
  return lodDef(def, 0.08, 0.5, st);
}

// ==================================================================================================
// MARBLED NEWT  (Triturus marmoratus, about 14 cm)
// The paddle-tail's frame made slimmer and longer. Velvety moss-green laced with a black net, a fine pale speckle, a dark
// belly dusted with white dots, and the female's orange stripe down the spine and tail top (drawn on every animal: most of a
// sexed group are females). Small dark eyes with a coppery ring.
// ==================================================================================================

function marbledBody() {
  const st = { hi: false };
  const S = newtShape(st);
  const { loft, legs, eyes, mouthY, sdf } = S;
  const KX = 1.14, KY = 1.06, KZ = 0.9;                             // narrower, a little lower, longer
  const cs = { green: C(0x4f6a26), moss: C(0x6c8432), black: C(0x0d0e0a), belly: C(0x24221d), dot: C(0xd8d8cc), stripe: C(0xe0782a), eye: C(0x050403), ring: C(0x9a6a2e), lip: C(0x15110c) };
  const zS = 4.7, zT = -6.3, sc = [0, 0, 0, 0];
  let last = null, lx = NaN, ly = NaN, lz = NaN;
  const analyze = (x, y, z) => {
    if (x === lx && y === ly && z === lz) return last;
    lx = x; ly = y; lz = z;
    const a = { kind: 'body', leg: 0, legT: 0, eye: null };
    for (const e of eyes) {
      const rx = x - e.c[0], ry = y - e.c[1], rz = z - e.c[2], dd = Math.hypot(rx, ry, rz);
      if (dd < e.r + 0.03) {
        const c = (rx * e.axis[0] + ry * e.axis[1] + rz * e.axis[2]) / (dd || 1);
        if (c > 0.15) { a.kind = 'eye'; a.eye = { c }; return (last = a); }
      }
    }
    const L = legAt(legs, x, y, z, loft.d(x, y, z));
    if (L) { a.kind = 'limb'; a.leg = L.id; a.legT = L.t; }
    return (last = a);
  };
  // The black net: everywhere far from the cell points (cells() is the distance to the nearest), so green blotches sit in a
  // black lace, wobbled so it reads as marbling rather than a honeycomb.
  const net = (x, y, z) => { const c = cells(x * 0.9, y * 0.9, z * 0.7, 1.4); return sm(0.4, 0.56, c + (vnoise(x * 2.6, y * 2.6, z * 2.6) - 0.5) * 0.25); };
  const color0 = (x, y, z) => {
    const a = analyze(x, y, z);
    if (a.kind === 'eye') {
      const th = Math.acos(Math.min(1, a.eye.c));
      return lerp3(cs.eye, lerp3(cs.ring, cs.eye, sm(0.35, 0.75, th)), sm(1.0, 0.7, th) * 0.8 + 0.1);
    }
    const n = net(x, y, z);
    if (a.kind === 'limb') return lerp3(lerp3(cs.green, cs.moss, vnoise(x * 4, y * 4, z * 4)), cs.black, n * 0.85);
    loft.sect(z, sc);
    const yy = y - sc[0], v = yy / (yy >= 0 ? sc[2] : sc[3]);
    let col = lerp3(cs.green, cs.moss, vnoise(x * 1.7, y * 1.7, z * 1.7) * 0.7);
    col = lerp3(col, cs.black, n * 0.9);
    col = lerp3(col, cs.dot, sm(0.86, 0.94, vnoise(x * 9, y * 9, z * 9)) * 0.45);                   // fine pale speckle
    const belly = sm(-0.35, -0.7, v);
    col = lerp3(col, lerp3(cs.belly, cs.dot, sm(0.8, 0.9, vnoise(x * 7, y * 7, z * 7)) * 0.8), belly);
    // The orange vertebral stripe from the neck to the tail tip.
    const sx = Math.abs(x) / Math.max(0.05, sc[1]);
    col = lerp3(col, cs.stripe, sm(0.2, 0.08, sx) * sm(0.7, 0.9, v) * sm(3.4, 2.6, z) * 0.95);
    if (z > 2.6) {
      const e = y - mouthY(z);
      col = lerp3(col, cs.lip, Math.exp(-(e * e) / 0.003) * sm(2.6, 3.1, z) * 0.85);
    }
    return mul3(col, 0.92 + 0.14 * vnoise(x * 5, y * 5, z * 5));
  };
  const color = (x, y, z) => color0(x * KX, y * KY, z * KZ);
  const rig = (x, y, z) => { const a = analyze(x * KX, y * KY, z * KZ); return [clamp01((zS - z * KZ) / (zS - zT)), a.leg, a.legT]; };
  const def = { sdf: (x, y, z) => sdf(x * KX, y * KY, z * KZ) * 0.88, lo: [-2.6 / KX, -0.25, -6.5 / KZ], hi: [2.6 / KX, 1.8 / KY, 4.9 / KZ], color, mat: () => M.SKIN, rig, finish: {
    rough: 0.72, coat: 0.03, coatRough: 0.6, grain: 13, bump: 0.55, tone: 0.04, flutter: 0.02,
    eyes: [eyeSpec({ ...eyes[1], c: [eyes[1].c[0] / KX, eyes[1].c[1] / KY, eyes[1].c[2] / KZ] }, { pupil: [0.42, 0.42], inner: C(0xb07a3a), outer: C(0x5a3010), rim: C(0x040302), limb: C(0x1c1208), seed: 11 })],
  } };
  return lodDef(def, 0.09, 0.5, st);
}

// ==================================================================================================
// MOURNING GECKO  (Lepidodactylus lugubris, about 9 cm)
// Slender, tan-beige with darker chevrons, big golden eyes with slit pupils, wide toe pads
// with lamellae, a long tail. Sprawled legs; climbs walls.
// ==================================================================================================

function geckoShape(st) {
  // Snout at +z = 3.9, tail tip at -5.6 (9.5 cm). A flat body wider than it is tall, a distinct triangular head on a pinched
  // neck, the tail starting thick at the vent and tapering to a fine tip.
  // (2026-10-03: a gecko's head is broad and rounded, as wide as the body, with a short blunt snout; the tail is thick and
  // flattened at the base, where the fat is stored, and the trunk is full rather than a flat strip.)
  const loft = new Loft([
    [-5.6, 0.30, 0.05, 0.04, 0.04],
    [-4.9, 0.32, 0.11, 0.08, 0.07],
    [-4.0, 0.34, 0.2, 0.13, 0.11],
    [-3.0, 0.37, 0.3, 0.18, 0.15],
    [-2.1, 0.40, 0.4, 0.23, 0.19],
    [-1.4, 0.42, 0.48, 0.27, 0.23],
    [-0.8, 0.44, 0.58, 0.32, 0.27],
    [-0.1, 0.45, 0.64, 0.35, 0.29],
    [0.7, 0.45, 0.63, 0.35, 0.29],
    [1.25, 0.45, 0.55, 0.33, 0.27],
    [1.7, 0.45, 0.47, 0.3, 0.24],
    [2.1, 0.45, 0.54, 0.32, 0.24],
    [2.55, 0.44, 0.56, 0.31, 0.22],
    [3.0, 0.42, 0.47, 0.26, 0.18],
    [3.4, 0.4, 0.34, 0.19, 0.13],
    [3.75, 0.385, 0.2, 0.12, 0.09],
  ], { front: 0.42, back: 0.3 });

  const legs = [];
  for (const side of [-1, 1]) {
    for (const back of [false, true]) {
      const pts = back ? [[0.45, 0.42, -0.75], [1.15, 0.44, -0.45], [1.5, 0.12, -0.98]] : [[0.42, 0.42, 1.2], [1.05, 0.44, 0.95], [1.4, 0.12, 1.42]];
      const rads = back ? [0.27, 0.17, 0.12] : [0.23, 0.155, 0.11];
      const rods = new Rods();
      rods.chain(flipX(pts, side), rads, 0, 0.5);
      const w = pts[2];
      const angles = back ? [-18, 5, 27, 50, 74] : [-26, 0, 25, 50, 75];
      const lens = back ? [0.38, 0.52, 0.6, 0.62, 0.5] : [0.34, 0.46, 0.5, 0.48, 0.4];
      const tr = st.hi ? [0.06, 0.05] : [0.075, 0.065], pt = st.hi ? 0.036 : 0.05;
      const pads = [];
      for (let i = 0; i < angles.length; i++) {
        const an = (angles[i] * Math.PI) / 180, dx = Math.sin(an) * side, dz = Math.cos(an), L = lens[i];
        const b = [(w[0] + 0.02) * side, 0.07, w[2] + 0.08];
        const tip = [b[0] + dx * L, 0.07, b[2] + dz * L];
        rods.chain([b, [b[0] + dx * L * 0.5, 0.07, b[2] + dz * L * 0.5], tip], [tr[0], (tr[0] + tr[1]) / 2, tr[1]], 0.5, 1);
        // the expanded adhesive pad covers the outer half of the toe, and a small claw pokes out past it
        const hl = L * 0.32 + 0.03;
        pads.push([b[0] + dx * (L - hl + 0.02), pt, b[2] + dz * (L - hl + 0.02), dx, dz, hl, pt, 0.11, 0.92]);
        if (i === 1 || i === 2 || i === 3) rods.add([tip[0], 0.06, tip[2]], [tip[0] + dx * 0.16, 0.05, tip[2] + dz * 0.16], 0.035, 0.012, 0.95, 1);
      }
      legs.push(new Limb(back ? (side < 0 ? 3 : 4) : side < 0 ? 1 : 2, rods, pads));
    }
  }
  // Big bulging eyes, looking up, out and a little forward, each under a raised brow.
  const eyes = [-1, 1].map((s) => {
    const e = makeEye(loft, 0.4 * s, 0, 2.6, 0.27, 0.3);
    e.axis = norm3([e.axis[0], e.axis[1] * 0.8, e.axis[2] + 0.5]);
    e.sock = [e.c[0] - e.axis[0] * 0.08, e.c[1] - e.axis[1] * 0.08, e.c[2] - e.axis[2] * 0.08];
    return e;
  });
  // The canthal ridge: a low crest from the nostril to the brow over each eye; the nostrils at the tip of the snout.
  const ridges = new Rods();
  for (const s of [-1, 1]) {
    const e = eyes[s < 0 ? 0 : 1];
    const top = (x, z) => loft.top(Math.abs(x), z);
    ridges.chain([[0.1 * s, top(0.1, 3.6) - 0.01, 3.6], [0.2 * s, top(0.2, 3.15) + 0.0, 3.15], [e.c[0] * 0.92, e.c[1] + e.r * 0.78, e.c[2] + 0.18], [e.c[0] * 0.98, e.c[1] + e.r * 0.74, e.c[2] - 0.2]], [0.045, 0.06, 0.1, 0.085]);
  }
  ridges.done();
  const nostrils = [-1, 1].map((s) => [0.1 * s, loft.top(0.1, 3.62) - 0.005, 3.62, 0.05]);
  const mouth = new Table([[1.85, 0.47], [2.4, 0.44], [3.0, 0.42], [3.6, 0.4]], 0.02);
  const parts = [];
  for (const l of legs) parts.push({ near: (x, y, z) => l.near(x, y, z), d: (x, y, z) => l.d(x, y, z), k: 0.14 });
  parts.push({ near: (x, y, z) => ridges.near(x, y, z), d: (x, y, z) => ridges.d(x, y, z), k: 0.07 });
  for (const n of nostrils) parts.push({ near: sphereNear(n, n[3]), d: (x, y, z) => Math.hypot(x - n[0], y - n[1], z - n[2]) - n[3], k: 0.04 });
  for (const e of eyes) {
    parts.push({ near: sphereNear(e.sock, e.r + 0.05), d: (x, y, z) => Math.hypot(x - e.sock[0], y - e.sock[1], z - e.sock[2]) - (e.r + 0.035), k: 0.07 });
    parts.push({ near: sphereNear(e.c, e.r), d: (x, y, z) => Math.hypot(x - e.c[0], y - e.c[1], z - e.c[2]) - e.r, k: 0.03 });
  }
  // Fine granular skin: a faint relief of tiny scales on the geometry itself (at the fine level only).
  const core = (x, y, z) => {
    let d = loft.d(x, y, z);
    if (st.hi && d < 0.1) d += (vnoise(x * 11, y * 11, z * 11) - 0.5) * 0.028;
    return d;
  };
  const sdf = (x, y, z) => unite(core(x, y, z), x, y, z, parts);
  return { loft, legs, eyes, mouthY: (z) => mouth.v(0, z), sdf, core, ridges };
}

function geckoBody() {
  const st = { hi: false };
  const S = geckoShape(st);
  const { loft, legs, eyes, mouthY, sdf } = S;
  const cs = {
    tan: C(0x8c7556), grey: C(0x716757), belly: C(0xe4d6b8), bar: C(0x3b2b1b), dark: C(0x211710), pad: C(0xd8b79c), line: C(0x8f7650),
    cream: C(0xd9c7a2), gold: C(0xd4a83c), amber: C(0x9c6f22), rim: C(0x4a3a24), black: C(0x060504), limb: C(0x8e7656), lip: C(0xcdbb98),
  };
  const zS = 3.9, zT = -5.6, sc = [0, 0, 0, 0];
  let last = null, lx = NaN, ly = NaN, lz = NaN;
  const analyze = (x, y, z) => {
    if (x === lx && y === ly && z === lz) return last;
    lx = x; ly = y; lz = z;
    const a = { kind: 'body', leg: 0, legT: 0, eye: null, pad: null };
    for (const e of eyes) {
      const rx = x - e.c[0], ry = y - e.c[1], rz = z - e.c[2], dd = Math.hypot(rx, ry, rz);
      if (dd < e.r + 0.03) {
        const c = (rx * e.axis[0] + ry * e.axis[1] + rz * e.axis[2]) / (dd || 1);
        if (c > 0.3) { a.kind = 'eye'; a.eye = { c, e, rx, ry, rz }; return (last = a); }
      }
    }
    const dc = loft.d(x, y, z);
    const L = legAt(legs, x, y, z, dc);
    if (L) { a.kind = 'limb'; a.leg = L.id; a.legT = L.t; a.pad = L.pad; }
    return (last = a);
  };
  // The pattern. A mourning gecko is a pale brown to grey animal with a dark stripe from the nostril through the eye along each
  // side of the back, irregular dark blotches down the middle, small cream flecks, and a banded tail.
  const pattern = (x, y, z, lat, dorsal) => {
    const ground = lerp3(cs.tan, cs.grey, 0.4 * vnoise(x * 1.3, y * 1.3, z * 1.3) + 0.2 * vnoise(x * 4, y * 4, z * 4));
    let col = ground;
    const wob = (vnoise(x * 3, y * 3, z * 3) - 0.5) * 0.22;
    // (2026-10-03) The mourning gecko's mark: a row of dark chevrons (a W, its arms swept back) from the nape to the hips, each
    // with a pale cream edge behind it, so the back reads as bands rather than a stripe. Paired dark dots between them.
    const al = Math.abs(lat);
    const chev = z - 0.55 * al + wob;                                       // the arms sweep back towards the flanks
    const f = (chev * 1.45) - Math.floor(chev * 1.45);
    const onBack = sm(-3.0, -2.2, z) * sm(1.9, 1.5, z) * sm(1.05, 0.7, al);
    col = lerp3(col, cs.bar, sm(0.0, 0.08, f) * sm(0.3, 0.2, f) * onBack * dorsal * 0.85);
    col = lerp3(col, cs.cream, sm(0.3, 0.36, f) * sm(0.48, 0.38, f) * onBack * dorsal * 0.5);
    // paired dark dots either side of the spine
    col = lerp3(col, cs.dark, sm(0.13, 0.06, cells(x * 1.0 + 3, y, z, 2.6)) * sm(0.15, 0.3, al) * sm(0.65, 0.45, al) * onBack * dorsal * 0.8);
    // the flank below the chevrons a little darker, peppered with pale flecks
    col = lerp3(col, lerp3(cs.grey, cs.bar, 0.35), sm(0.7, 0.95, al) * sm(0.2, -0.2, y - 0.45) * 0.4);
    col = lerp3(col, cs.cream, sm(0.15, 0.08, cells(x + 7, y, z, 3.0)) * dorsal * 0.7);
    // the tail: chevron bands that continue the back's, thinning toward the tip, the underside pale
    if (z < -1.6) {
      const tf = ((z - 0.35 * al + wob) * 1.6) - Math.floor((z - 0.35 * al + wob) * 1.6);
      col = lerp3(col, cs.bar, sm(0.0, 0.1, tf) * sm(0.4, 0.28, tf) * (0.55 + 0.45 * dorsal) * 0.85);
      col = lerp3(col, cs.cream, sm(0.5, 0.58, tf) * sm(0.75, 0.65, tf) * 0.35 * dorsal);
    }
    return col;
  };
  const color = (x, y, z) => {
    const a = analyze(x, y, z);
    if (a.kind === 'eye') {
      const { c, e, rx, ry, rz } = a.eye, th = Math.acos(Math.min(1, c));
      const ay = e.axis[1], up = [-ay * e.axis[0], 1 - ay * ay, -ay * e.axis[2]], ul = Math.hypot(up[0], up[1], up[2]) || 1;
      const u = [up[0] / ul, up[1] / ul, up[2] / ul], r = cross3(u, e.axis);
      const ex = (rx * r[0] + ry * r[1] + rz * r[2]) / e.r, ey = (rx * u[0] + ry * u[1] + rz * u[2]) / e.r;
      const pupil = sm(1.0, 0.6, (ex * ex) / (0.17 * 0.17) + (ey * ey) / (0.8 * 0.8));
      let col = lerp3(cs.gold, cs.amber, sm(0.2, 0.9, th));
      col = lerp3(col, cs.rim, sm(0.95, 1.2, th));
      return lerp3(col, cs.black, pupil);
    }
    if (a.kind === 'limb') {
      if (a.pad) {
        const p = a.pad, s = ((x - p[0]) * p[3] + (z - p[2]) * p[4]) / p[5];
        const under = sm(p[1] + 0.01, p[1] - 0.015, y);
        const lam = 0.5 + 0.5 * Math.cos(TAU * s * 3.6);
        // the pad is the toe's colour on top; underneath, pale lamellae (the adhesive scansors) in rows across it
        const top = lerp3(cs.limb, cs.grey, 0.3);
        return lerp3(top, lerp3(cs.pad, cs.line, lam * 0.55 * sm(1.0, 0.75, Math.abs(s))), under);
      }
      // the leg: the body's ground colour with dark bars across it, and a pale foot
      const bars = 0.5 + 0.5 * Math.cos(TAU * (z * 2.2 + x * 1.3));
      const g = lerp3(cs.limb, cs.grey, 0.3 * vnoise(x * 3, y * 3, z * 3));
      return lerp3(lerp3(g, cs.bar, sm(0.62, 0.92, bars) * 0.5), cs.pad, sm(0.12, 0.04, y) * 0.5);
    }
    loft.sect(z, sc);
    const yy = y - sc[0], v = yy / (yy >= 0 ? sc[2] : sc[3]);
    const lat = x / Math.max(0.05, sc[1]);
    const dorsal = sm(-0.4, 0.25, v);
    let col = lerp3(cs.belly, pattern(x, y, z, lat, dorsal), sm(-0.7, -0.15, v));
    // the head: a darker W-shaped mark behind the eyes, a stripe from the nostril through the eye, pale lips with dark flecks
    if (z > 1.7) {
      const e = y - (loft.t.v(0, z) + 0.08);
      col = lerp3(col, cs.dark, sm(0.1, 0.03, Math.abs(e)) * sm(1.8, 2.3, z) * sm(0.15, 0.45, Math.abs(x) / Math.max(0.1, loft.t.v(1, z))) * 0.75);
      const m = y - mouthY(z);
      col = lerp3(col, cs.lip, sm(0.16, 0.04, Math.abs(m + 0.05)) * sm(1.8, 2.4, z) * 0.7);
      col = lerp3(col, cs.line, Math.exp(-(m * m) / 0.0022) * 0.9);
      const w = Math.abs(Math.abs(x) - 0.22 - 0.5 * Math.max(0, 2.0 - z));
      col = lerp3(col, cs.bar, sm(0.07, 0.02, Math.abs(w + 0.3 * (z - 1.95))) * sm(1.6, 1.8, z) * sm(2.3, 2.05, z) * dorsal * 0.6);
    }
    // the dark stripe from the nostril through the eye and back over the ear to the shoulder, on the side of the head
    if (z > 1.2) {
      const ax = Math.abs(x);
      const segD = (ax0, z0, ax1, z1) => { const dx = ax1 - ax0, dz = z1 - z0, t = Math.max(0, Math.min(1, ((ax - ax0) * dx + (z - z0) * dz) / (dx * dx + dz * dz))); return Math.hypot(ax - ax0 - dx * t, z - z0 - dz * t); };
      const d = Math.min(segD(0.1, 3.6, 0.36, 2.75), segD(0.36, 2.75, 0.5, 2.1), segD(0.5, 2.1, 0.62, 1.3));
      const yc = loft.t.v(0, z) + 0.05;
      col = lerp3(col, cs.dark, sm(0.09, 0.04, d) * sm(0.16, 0.06, Math.abs(y - yc)) * 0.8);
    }
    // the throat and belly: pale, finely flecked
    col = lerp3(col, mul3(cs.line, 0.9), sm(0.2, 0.1, cells(x, y, z, 5)) * sm(-0.2, -0.8, v) * 0.35);
    col = mul3(col, 0.93 + 0.14 * vnoise(x * 9, y * 9, z * 9));
    return col;
  };
  const mat = (x, y, z) => (analyze(x, y, z).kind === 'eye' ? M.GLOSS : M.KERATIN);
  const rig = (x, y, z) => { const a = analyze(x, y, z); return [clamp01((zS - z) / (zS - zT)), a.leg, a.legT]; };
  // Golden iris with a vertical lens-shaped slit pupil (drawn analytically, so it reads at the coarse mesh too).
  const def = { sdf, lo: [-3.0, -0.25, -5.9], hi: [3.0, 1.3, 4.2], color, mat, rig, finish: {
    rough: 0.68, coat: 0.08, coatRough: 0.5, grain: 14, bump: 0.35, tone: 0.025,
    eyes: [eyeSpec(eyes[1], { pupil: [0.3, 0.8], shape: 'slit', inner: C(0xe6b83a), outer: C(0xa8741f), rim: C(0x050403), limb: C(0x4a3418), cap: 0.9, seed: 2 })],
  } };
  return lodDef(def, 0.07, 0.5, st);
}
