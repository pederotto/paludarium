// Lizards. Face +z, feet on y = 0, centimetres.
//
//  skink   red-eyed crocodile skink (Tribolonotus gracilis), ~17 cm, half of it tail: a stocky dark brown lizard with a
//          triangular, helmeted head, four short legs with five toes, a long tapering tail, four rows of big keeled
//          (spiky) scales down the back that run on along the tail, a creamy underside and the signature: a bright
//          orange ring around each eye.
//
// Built the way the gecko and the newt are (salamanders.js): a lofted trunk (elliptical sections splined along z),
// limbs as chains of tapered capsules with flat pads, an eyeball set into the head, a lid socket. The helpers are
// copied here on purpose (salamanders.js is rewritten separately). The rig is the gecko's: rig.x = spine 0 at the
// snout … 1 at the tail tip (the body wave), leg ids 1 front-left, 2 front-right, 3 back-left, 4 back-right (the
// diagonal pairs 1+4 and 2+3 step together, instanced.js), legT 0 at the shoulder / hip … 1 at the toe tip.
//
// The keeled scales are a displacement of the loft's upper surface (cheap: a tent across each row times a saw-tooth
// along it, so every scale rises toward its rear edge and drops off: a backward-pointing spike) and the same field
// lightens the crests in the paint, so the rows still read on the coarse mesh where the relief is only a cell high.
import { smin, vnoise, C, lerp3, mul3, clamp01, ell, M } from '../kit.js';

const sm = (a, b, x) => { let t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
const norm3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// ---- Splines, the loft and limbs (copies of the salamanders.js helpers) ----------------------------------------

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

// The lofted solid: rows [z, cy, a, bu, bd] = centre height, half width, upper and lower half height; `front` / `back`
// are the lengths of the rounded end caps.
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
  top(x, z) { const s = this.sect(z, [0, 0, 0, 0]); return s[0] + s[2] * Math.sqrt(Math.max(0, 1 - (x * x) / (s[1] * s[1]))); }
}

// Tapered capsules carrying a 0…1 parameter along the whole limb (legT).
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
  // Distance; also leaves the along-limb parameter of the nearest segment in this.t.
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
}

// A limb: rods plus flat pads [cx, cy, cz, dirX, dirZ, halfLength, halfThickness, halfWidth, t] (palm / sole).
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
  d(x, y, z) { const d = this.dt(x, y, z); return d; }
  dt(x, y, z) {
    let d = this.rods.dt(x, y, z);
    this.t = this.rods.t;
    for (const p of this.pads) { const q = this.padD(p, x, y, z); if (q < d) { d = q; this.t = p[8]; } }
    return d;
  }
  near(x, y, z) { return Math.hypot(x - this.c[0], y - this.c[1], z - this.c[2]) - this.R; }
}

// Which detail level is being built: set by reading `cell` (coarse) or `hiScale` (fine) on the definition.
function lodDef(def, cell, hiScale, st) {
  Object.defineProperties(def, {
    cell: { enumerable: true, get() { st.hi = false; return cell; } },
    hiScale: { enumerable: true, get() { st.hi = true; return hiScale; } },
  });
  return def;
}
// The limb (if any) whose surface is nearest to a point: { id, t } with t = legT for the rig (gecko convention).
function legAt(legs, x, y, z, dc) {
  const left = x < 0;
  let bl = null, bd = 1e9, bt = 0;
  for (const l of legs) {
    if ((l.id === 1 || l.id === 3) !== left) continue;
    if (l.near(x, y, z) > 0.3) continue;
    const dl = l.dt(x, y, z);
    if (dl < bd) { bd = dl; bl = l; bt = l.t; }
  }
  if (bl && bd < dc + 0.01 && dc > 0) return { id: bl.id, t: clamp01((bt - 0.08) / 0.92) * sm(0.0, 0.45, dc) };
  return null;
}
function eyeSpec(e, o) {
  const a = norm3(e.axis), h = norm3(cross3(a, Math.abs(a[1]) > 0.85 ? [0, 0, 1] : [0, 1, 0]));
  return { c: e.c, r: e.r, axis: a, h, w: norm3(cross3(a, h)), ...o };
}

// ==================================================================================================
// RED-EYED CROCODILE SKINK  (Tribolonotus gracilis, ~17 cm)
// ==================================================================================================

function skinkShape(st) {
  // [z, centre height, half width, upper half height, lower half height]: snout at +4.15, vent near -3.9, tail tip -12.8.
  const loft = new Loft([
    [-12.8, 0.17, 0.035, 0.035, 0.035],
    [-11.6, 0.19, 0.08, 0.075, 0.065],
    [-9.8, 0.23, 0.15, 0.14, 0.12],
    [-7.8, 0.29, 0.25, 0.21, 0.18],
    [-6.0, 0.36, 0.37, 0.28, 0.24],
    [-4.7, 0.44, 0.52, 0.34, 0.3],
    [-3.7, 0.52, 0.74, 0.4, 0.36],
    [-2.5, 0.58, 0.95, 0.48, 0.4],
    [-0.9, 0.6, 1.02, 0.5, 0.42],
    [0.5, 0.6, 0.95, 0.48, 0.4],
    [1.35, 0.6, 0.74, 0.44, 0.36],
    [2.0, 0.62, 0.84, 0.46, 0.34],
    [2.55, 0.6, 0.77, 0.41, 0.3],
    [3.15, 0.56, 0.54, 0.31, 0.24],
    [3.7, 0.5, 0.31, 0.21, 0.17],
    [4.15, 0.46, 0.12, 0.12, 0.09],
  ], { front: 0.42, back: 0.3 });

  // Short, stout, sprawled legs with five toes. Points are the right side (x > 0), mirrored for the left.
  const legs = [];
  for (const side of [-1, 1]) {
    for (const back of [false, true]) {
      const pts = back ? [[0.6, 0.52, -3.35], [1.45, 0.5, -3.0], [1.72, 0.12, -3.55]] : [[0.62, 0.52, 1.0], [1.32, 0.46, 0.78], [1.5, 0.12, 1.28]];
      const rads = back ? [0.3, 0.19, 0.13] : [0.25, 0.16, 0.12];
      const rods = new Rods();
      rods.chain(pts.map((p) => [p[0] * side, p[1], p[2]]), rads, 0, 0.5);
      const w = pts[2];
      const angles = back ? [-28, -2, 22, 46, 74] : [-34, -8, 16, 42, 70];
      const lens = back ? [0.42, 0.56, 0.68, 0.74, 0.5] : [0.34, 0.46, 0.54, 0.5, 0.36];
      // Toes at least ~1.5 coarse cells thick (the surface nets tear thinner rods), finer when built for close-up.
      const tr = st.hi ? [0.06, 0.035] : [0.085, 0.07];
      const b = [(w[0] + 0.02) * side, 0.07, w[2] + 0.06];
      for (let i = 0; i < angles.length; i++) {
        const an = (angles[i] * Math.PI) / 180, dx = Math.sin(an) * side, dz = Math.cos(an), L = lens[i];
        rods.chain([b, [b[0] + dx * L * 0.5, 0.075, b[2] + dz * L * 0.5], [b[0] + dx * L, 0.05, b[2] + dz * L]], [tr[0], (tr[0] + tr[1]) / 2, tr[1]], 0.5, 1);
      }
      const pad = [b[0], 0.07, b[2] - 0.02, 0, 1, back ? 0.2 : 0.17, 0.065, back ? 0.2 : 0.17, 0.55];
      legs.push(new Limb(back ? (side < 0 ? 3 : 4) : side < 0 ? 1 : 2, rods, [pad]));
    }
  }

  // Eyes on the side of the head, looking out and a little up and forward; a lid socket around each.
  const eyes = [-1, 1].map((s) => {
    const z = 2.95, x = 0.47 * s, r = 0.2;
    const y0 = loft.top(Math.abs(x), z) - r * 0.55;
    const e = 0.02, sd = (a, b, c) => loft.d(a, b, c);
    let axis = norm3([sd(x + e, y0, z) - sd(x - e, y0, z), sd(x, y0 + e, z) - sd(x, y0 - e, z), sd(x, y0, z + e) - sd(x, y0, z - e)]);
    axis = norm3([axis[0], axis[1] * 0.7, axis[2] + 0.35]);
    const c = [x, y0, z];
    return { c, r, axis, sock: [c[0] - axis[0] * 0.07, c[1] - axis[1] * 0.07, c[2] - axis[2] * 0.07] };
  });
  const mouth = new Table([[2.0, 0.44], [2.6, 0.42], [3.3, 0.4], [4.2, 0.4]], 0.02);

  // Keeled dorsal scales: four rows (two each side of the spine) as fractions of the half width; staggered.
  const ROWS = [[0.2, 0], [0.53, 0.5]];
  const sc = [0, 0, 0, 0];
  const scales = (x, y, z) => {
    if (z > 2.25 || z < -12.4) return 0;
    loft.sect(z, sc);
    const v = (y - sc[0]) / sc[2];
    if (v < 0.1) return 0;
    const a = sc[1], ax = Math.abs(x), P = 0.24 + 0.12 * Math.min(a, 1);       // scale pitch: a little finer on the tail
    const H = (0.035 + 0.075 * Math.min(a, 1)) * sm(2.25, 1.5, z) * sm(-12.4, -10.5, z);
    let h = 0;
    for (let r = 0; r < 2; r++) {
      const xr = ROWS[r][0] * a, wr = 0.06 + 0.13 * Math.min(a, 1);
      const u = 1 - Math.abs(ax - xr) / wr;
      if (u <= 0) continue;
      const ph = (z / P) + ROWS[r][1], f = ph - Math.floor(ph);                // 0 at a scale's front … 1 at its back edge
      const along = sm(0.95, 0.15, f) * sm(1.0, 0.94, f) + sm(0.0, 0.06, f) * 0;  // high at the front (towards +z after flipping) …
      h = Math.max(h, u * along);
    }
    return H * h * sm(0.1, 0.5, v);
  };
  const legParts = legs.map((l) => ({ l, k: 0.17 }));
  const core = (x, y, z) => loft.d(x, y, z);
  const sdf = (x, y, z) => {
    let d = core(x, y, z);
    if (d < 0.3 && d > -0.3) d -= scales(x, y, z);
    // casque: two low bony bulges at the back corners of the head
    if (z > 1.4 && z < 2.8) d = smin(d, ell(Math.abs(x) - 0.52, y - 0.88, z - 2.05, 0.3, 0.17, 0.42), 0.12);
    for (const p of legParts) { if (p.l.near(x, y, z) - d >= p.k) continue; d = smin(d, p.l.d(x, y, z), p.k); }
    for (const e of eyes) {
      if (Math.abs(z - e.c[2]) > 0.5) continue;
      d = smin(d, Math.hypot(x - e.sock[0], y - e.sock[1], z - e.sock[2]) - (e.r + 0.045), 0.07);
      d = smin(d, Math.hypot(x - e.c[0], y - e.c[1], z - e.c[2]) - e.r, 0.025);
    }
    return d;
  };
  return { loft, legs, eyes, mouthY: (z) => mouth.v(0, z), sdf, core, scales };
}

function skinkBody() {
  const st = { hi: false };
  const S = skinkShape(st);
  const { loft, legs, eyes, mouthY, sdf, scales } = S;
  const cs = {
    back: C(0x2c2119), dark: C(0x17110d), keel: C(0x5a4532), flank: C(0x3b2c20), belly: C(0xcdb68c), throat: C(0xd9c49c),
    orange: C(0xff6a10), orangeD: C(0xe0480a), limb: C(0x30241a), toe: C(0x6a5440), lip: C(0x120c08), under: C(0x060403),
  };
  const zS = 4.15, zT = -12.8, sc = [0, 0, 0, 0];
  let last = null, lx = NaN, ly = NaN, lz = NaN;
  const analyze = (x, y, z) => {
    if (x === lx && y === ly && z === lz) return last;
    lx = x; ly = y; lz = z;
    const a = { kind: 'body', leg: 0, legT: 0, ring: 0 };
    for (const e of eyes) {
      const rx = x - e.c[0], ry = y - e.c[1], rz = z - e.c[2], dd = Math.hypot(rx, ry, rz);
      if (dd < e.r + 0.25) {
        const c = (rx * e.axis[0] + ry * e.axis[1] + rz * e.axis[2]) / (dd || 1);
        if (dd < e.r + 0.03 && c > 0.5) { a.kind = 'eye'; return (last = a); }
        // the orange ring: the lid socket and a band of skin around it
        a.ring = sm(e.r + 0.22, e.r + 0.15, dd) * sm(-0.2, 0.15, c);
      }
    }
    const dc = loft.d(x, y, z);
    const L = legAt(legs, x, y, z, dc);
    if (L) { a.kind = 'limb'; a.leg = L.id; a.legT = L.t; }
    return (last = a);
  };
  const color = (x, y, z) => {
    const a = analyze(x, y, z);
    if (a.kind === 'eye') return cs.under;
    const n = vnoise(x * 6, y * 6, z * 6);
    if (a.kind === 'limb') {
      let col = lerp3(cs.limb, cs.dark, 0.3 * n);
      col = lerp3(col, lerp3(cs.limb, cs.belly, 0.35), sm(0.3, 0.1, y) * 0.5);
      return lerp3(col, cs.toe, sm(0.82, 0.98, a.legT / Math.max(0.2, sm(0.0, 0.45, 1))) * 0.6);
    }
    loft.sect(z, sc);
    const yy = y - sc[0], v = yy / (yy >= 0 ? sc[2] : sc[3]);
    let col = lerp3(cs.belly, cs.flank, sm(-0.75, -0.3, v));
    col = lerp3(col, cs.back, sm(-0.3, 0.3, v));
    col = lerp3(col, cs.dark, sm(0.2, 0.9, v) * 0.5 * (0.6 + 0.8 * n));
    // keeled scale crests catch the light: lighter brown tips, darker grooves between the rows
    const k = scales(x, y, z), H = 0.035 + 0.075 * Math.min(sc[1], 1);
    if (k > 0) col = lerp3(col, cs.keel, sm(0.25, 0.9, k / H) * 0.85);
    // pale throat and chin
    if (z > 1.2) col = lerp3(col, cs.throat, sm(-0.2, -0.6, v) * sm(1.2, 2.0, z) * 0.7);
    // tail: belly colour fades out, the tail is dark all round towards its tip
    col = lerp3(col, cs.flank, sm(-6, -9, z) * sm(-0.2, -0.8, v) * 0.6);
    if (z > 1.8) {
      const m = y - mouthY(z);
      col = lerp3(col, cs.lip, Math.exp(-(m * m) / 0.003) * sm(1.9, 2.4, z) * 0.85);
      for (const s of [-1, 1]) {
        const dn = Math.hypot(x - s * 0.12, y - (loft.top(0.12, 3.95) - 0.02), z - 3.95);
        col = lerp3(col, cs.under, sm(0.07, 0.03, dn) * 0.9);
      }
    }
    if (a.ring > 0) col = lerp3(col, lerp3(cs.orange, cs.orangeD, n * 0.5), a.ring);
    return mul3(col, 0.93 + 0.14 * n);
  };
  const rig = (x, y, z) => { const a = analyze(x, y, z); return [clamp01((zS - z) / (zS - zT)), a.leg, a.legT]; };
  // Dry, dull scales: rough, almost no coat, a strong fine relief. The eye: a dark red-brown iris, round pupil.
  const def = { sdf, lo: [-2.55, -0.15, -13.0], hi: [2.55, 1.3, 4.45], color, mat: () => M.SKIN, rig, finish: {
    rough: 0.72, coat: 0.08, coatRough: 0.5, grain: 9, bump: 0.35, tone: 0.05, flutter: 0, sheen: 0,
    eyes: [eyeSpec(eyes[1], { pupil: [0.4, 0.4], inner: C(0x5a1c0c), outer: C(0x24100a), rim: C(0x040302), limb: C(0x2a0e06), cap: 0.88, seed: 5 })],
  } };
  return lodDef(def, 0.105, 0.5, st);
}

export const LIZARDS = { skink: () => skinkBody() };
