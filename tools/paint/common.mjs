// Shared helpers for painting untextured creature meshes with vertex colours (tools/bake-creature.mjs).
// Colours are written in linear space (glTF COLOR_0). Every paint function receives one vertex:
//   { u, x, y, z, s, h, leg, legT, n } with u = 0 at the snout … 1 at the tail tip, x/y/z in cm (z forward, y up),
//   s = |x| / half width (0 on the midline … 1 at the widest point), h = height 0 … 1, leg = 0 (none) or 1..4,
//   legT = distance down the leg 0 … 1, n = unit vertex normal.
export const lin = (c) => c.map((v) => Math.pow(v, 2.2));
export const hex = (h) => lin([(h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255]);
export const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const fract = (v) => v - Math.floor(v);
const hash3 = (x, y, z) => { let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
// Smooth value noise in 3D (cheap and good enough for skin).
export function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const L = (a, b, t) => a + (b - a) * t;
  return L(L(L(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u), L(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u), v),
    L(L(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u), L(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u), v), w);
}
export const fbm = (x, y, z) => vnoise(x, y, z) * 0.6 + vnoise(x * 2.1, y * 2.1, z * 2.1) * 0.28 + vnoise(x * 4.3, y * 4.3, z * 4.3) * 0.12;
// Nearest-feature distance of a jittered 3D grid: blotches and spots. Returns [d1, id of the nearest cell].
export function cells(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let d1 = 9, id = 0;
  for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = xi + i, cy = yi + j, cz = zi + k;
    const px = cx + hash3(cx, cy, cz), py = cy + hash3(cx + 7, cy, cz), pz = cz + hash3(cx, cy + 13, cz);
    const d = Math.hypot(x - px, y - py, z - pz);
    if (d < d1) { d1 = d; id = hash3(cx + 3, cy + 5, cz + 9); }
  }
  return [d1, id];
}
