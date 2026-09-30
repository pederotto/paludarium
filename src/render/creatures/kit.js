// The creature modelling kit: signed-distance-function (SDF) primitives,
// noise for skin patterns and the material ids a body can paint.
//
// A body definition (see ../mesher.js bodyGeometry) is a plain object, in
// centimetres, facing +z with walkers' feet on y = 0 and swimmers centred:
//
//   sdf(x, y, z)   distance to the surface: negative inside
//   lo, hi         [x, y, z] corners of a box that contains the whole animal
//   cell           voxel size of the LOW-detail mesh; the HIGH one uses cell * hiScale
//   hiScale        0.5 by default: close-up meshes are twice as fine
//   color(x,y,z)   [r, g, b] linear 0…1
//   mat(x,y,z)     material id (M.SKIN, M.EYE, M.FIN …) — how the surface is shaded
//   rig(x,y,z)     [spine, leg, legT] for the animation shader:
//                    spine 0 at the snout … 1 at the tail tip (drives the swimming wave),
//                    leg 0 none, 1 front-left, 2 front-right, 3 back-left, 4 back-right,
//                    legT 0 at the shoulder/hip … 1 at the toe tip
//   finish         { rough, coat, coatRough, grain, bump, flutter, sheen } shading
//
// The mesher only asks the SDF for values, so anything expressible as a
// distance works: capsules, ellipsoids, smooth unions, twists, noise.

import * as THREE from 'three/webgpu';

// Material ids: how the shader treats a vertex.
export const M = {
  SKIN: 0,        // ordinary skin or fur; grain and bump apply
  EYE: 1,         // wet, glossy, near-black; a bright specular glint
  FIN: 2,         // thin translucent membrane; flutters in the water
  IRIDESCENT: 3,  // thin-film colour that shifts with view angle (neon tetra stripe)
  CHITIN: 4,      // hard glossy shell (shrimp, crab, isopod, snail shell)
  GLOSS: 5,       // very wet mucous skin (frog, axolotl): strong clear-coat
  KERATIN: 6,     // claws, beaks, teeth: matte and pale
  TRANSLUCENT: 7, // glassy see-through shell (shrimp body, larvae): hashed alpha
};

// --- Distance helpers --------------------------------------------------------
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const mix = (a, b, t) => a + (b - a) * t;

// Approximate distance to an axis-aligned ellipsoid with radii a, b, c.
export const ell = (x, y, z, a, b, c) => {
  x /= a; y /= b; z /= c;
  const k0 = Math.sqrt(x * x + y * y + z * z), k1 = Math.sqrt(x * x / (a * a) + y * y / (b * b) + z * z / (c * c));
  return k1 ? (k0 * (k0 - 1)) / k1 : -Math.min(a, b, c);
};
// Smooth minimum (union with a blend of width k), and smooth maximum (intersection).
export const smin = (a, b, k) => {
  const h = Math.min(Math.max(0.5 + (0.5 * (b - a)) / k, 0), 1);
  return b + (a - b) * h - k * h * (1 - h);
};
export const smax = (a, b, k) => -smin(-a, -b, k);
// Capsule from A to B with radii ra → rb; returns [distance, t] (t: 0 at A, 1 at B).
export function cap(p, a, b, ra, rb) {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const pax = p[0] - a[0], pay = p[1] - a[1], paz = p[2] - a[2];
  const t = Math.max(0, Math.min(1, (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz || 1)));
  const dx = pax - bax * t, dy = pay - bay * t, dz = paz - baz * t;
  return [Math.hypot(dx, dy, dz) - (ra + (rb - ra) * t), t];
}
// A limb or tail: a chain of capsules through `pts` with a radius at each joint.
// Returns [distance, t] with t 0 at the first joint … 1 at the last.
export function chain(p, pts, radii) {
  let best = 1e9, bt = 0;
  const n = pts.length - 1;
  for (let i = 0; i < n; i++) {
    const [d, t] = cap(p, pts[i], pts[i + 1], radii[i], radii[i + 1]);
    if (d < best) { best = d; bt = (i + t) / n; }
  }
  return [best, bt];
}
export const sphere = (x, y, z, cx, cy, cz, r) => Math.hypot(x - cx, y - cy, z - cz) - r;
// Rounded box: half-extents (a, b, c), corner radius r.
export function box(x, y, z, a, b, c, r = 0) {
  const qx = Math.abs(x) - a + r, qy = Math.abs(y) - b + r, qz = Math.abs(z) - c + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
}

// --- Noise ---------------------------------------------------------------------
export const hash = (x, y, z) => {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
};
// Smooth 3D value noise 0…1 for skin patterns.
export function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const s = (t) => t * t * (3 - 2 * t);
  const u = s(xf), v = s(yf), w = s(zf);
  let r = 0;
  for (let k = 0; k < 8; k++) {
    const dx = k & 1, dy = (k >> 1) & 1, dz = k >> 2;
    r += hash(xi + dx, yi + dy, zi + dz) * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
  }
  return r;
}
// Fractal noise 0…1 (three octaves).
export const fbm = (x, y, z) => (vnoise(x, y, z) * 0.55 + vnoise(x * 2.1, y * 2.1, z * 2.1) * 0.28 + vnoise(x * 4.3, y * 4.3, z * 4.3) * 0.17);
// Distance to the nearest of a set of jittered points on a grid (cells / scales / spots).
export function cells(x, y, z, scale) {
  const px = x * scale, py = y * scale, pz = z * scale;
  const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
  let d = 9;
  for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = ix + i, cy = iy + j, cz = iz + k;
    const fx = cx + hash(cx, cy, cz), fy = cy + hash(cx + 7.3, cy, cz), fz = cz + hash(cx, cy + 3.1, cz + 9.2);
    d = Math.min(d, Math.hypot(px - fx, py - fy, pz - fz));
  }
  return d;
}

// --- Colour -----------------------------------------------------------------------
export const C = (h) => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };
export const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const mul3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
