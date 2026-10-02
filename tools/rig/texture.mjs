// UV atlas and painted colour texture for a baked creature (tools/bake-creature.mjs jobs with `texture`).
//
//   unwrap(pos, idx, size)   xatlas charts and packs the mesh: { uv, idx, from } with `from` the source vertex of each new
//                            vertex (seams split vertices, so there are more of them)
//   paintTexture(...)        rasterises every triangle into UV space and calls the paint for each texel with the 3D point,
//                            normal and interpolated per-vertex data, so detail is as fine as the texture, not the mesh;
//                            then pads every chart outward so mipmaps and bilinear filtering never pick up the background
//   simplifyKeepingSeams()   a coarse level of detail that keeps the same UVs (chart borders locked), so both levels of
//                            detail share ONE texture and one material
import { createRequire } from 'node:module';
import { Api } from 'xatlasjs/dist/node/api.mjs';
import { MeshoptSimplifier } from 'meshoptimizer';

const require = createRequire(import.meta.url);
let api = null;
async function xatlas() {
  if (!api) { const XA = Api(require('xatlasjs/dist/node/xatlas.js')); api = await new Promise((res) => { const x = new XA(() => res(x)); }); }
  return api;
}

export async function unwrap(pos, idx, size = 1024) {
  if (pos.length / 3 > 65535) throw new Error('unwrap: more than 65535 vertices');
  const xa = await xatlas();
  xa.createAtlas();
  // Charts are cut on a smoothed copy (same vertices and triangles): a scan's bumpy surface otherwise splits into hundreds
  // of slivers (350 charts for the crab, 183 smoothed), and the UVs are then used on the real surface.
  xa.addMesh(new Uint16Array(idx), smoothed(pos, idx, 10));
  // UVs come back normalised to the atlas, which xatlas sizes near `size`; the texture is then painted at exactly `size`.
  const at = xa.generateAtlas({}, { padding: 4, bilinear: true, resolution: size });
  const m = at.meshes[0];
  const out = { uv: Float32Array.from(m.vertex.coords1), idx: Uint32Array.from(m.index), from: Uint32Array.from(m.oldIndexes), width: at.width, height: at.height };
  xa.destroyAtlas();
  return out;
}

function smoothed(pos, idx, iterations) {
  const n = pos.length / 3, adj = Array.from({ length: n }, () => new Set());
  for (let t = 0; t < idx.length; t += 3) for (let k = 0; k < 3; k++) { adj[idx[t + k]].add(idx[t + (k + 1) % 3]); adj[idx[t + k]].add(idx[t + (k + 2) % 3]); }
  let a = Float32Array.from(pos);
  for (let it = 0; it < iterations; it++) {
    const b = new Float32Array(a.length);
    for (let v = 0; v < n; v++) {
      let c = 0, x = 0, y = 0, z = 0;
      for (const j of adj[v]) { x += a[j * 3]; y += a[j * 3 + 1]; z += a[j * 3 + 2]; c++; }
      b[v * 3] = 0.5 * a[v * 3] + 0.5 * x / c; b[v * 3 + 1] = 0.5 * a[v * 3 + 1] + 0.5 * y / c; b[v * 3 + 2] = 0.5 * a[v * 3 + 2] + 0.5 * z / c;
    }
    a = b;
  }
  return a;
}

// paint(texel) -> linear [r, g, b]. texel = { p: [x, y, z], n: [x, y, z], w: [w0, w1, w2], v: [i0, i1, i2] } (barycentric
// weights and the three vertices, so the caller interpolates whatever it carries). Returns sRGB RGBA bytes, size x size.
export function paintTexture(size, uv, idx, pos, nor, paint, { pad = 48 } = {}) {
  const img = new Uint8ClampedArray(size * size * 4);
  const filled = new Uint8Array(size * size), own = new Uint8Array(size * size);
  const enc = (c) => Math.round(255 * Math.pow(Math.min(1, Math.max(0, c)), 1 / 2.2));
  for (let t = 0; t < idx.length; t += 3) {
    const v = [idx[t], idx[t + 1], idx[t + 2]];
    const P = v.map((i) => [uv[i * 2] * size - 0.5, uv[i * 2 + 1] * size - 0.5]);
    const d = (P[1][1] - P[2][1]) * (P[0][0] - P[2][0]) + (P[2][0] - P[1][0]) * (P[0][1] - P[2][1]);
    if (Math.abs(d) < 1e-12) continue;
    const x0 = Math.max(0, Math.floor(Math.min(P[0][0], P[1][0], P[2][0])) - 1), x1 = Math.min(size - 1, Math.ceil(Math.max(P[0][0], P[1][0], P[2][0])) + 1);
    const y0 = Math.max(0, Math.floor(Math.min(P[0][1], P[1][1], P[2][1])) - 1), y1 = Math.min(size - 1, Math.ceil(Math.max(P[0][1], P[1][1], P[2][1])) + 1);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      let a = ((P[1][1] - P[2][1]) * (x - P[2][0]) + (P[2][0] - P[1][0]) * (y - P[2][1])) / d;
      let b = ((P[2][1] - P[0][1]) * (x - P[2][0]) + (P[0][0] - P[2][0]) * (y - P[2][1])) / d;
      let c = 1 - a - b;
      const inside = a >= 0 && b >= 0 && c >= 0;
      // Conservative: a texel the triangle only grazes (within 0.75 texel) is painted too, from the nearest point of the
      // triangle; slivers thinner than a texel would otherwise get no colour at all.
      if (!inside) {
        const q = closest([x, y], P[0], P[1], P[2]);
        if (Math.hypot(q.p[0] - x, q.p[1] - y) > 0.75 || own[y * size + x]) continue;
        [a, b, c] = q.w;
      }
      const p = [0, 1, 2].map((k) => a * pos[v[0] * 3 + k] + b * pos[v[1] * 3 + k] + c * pos[v[2] * 3 + k]);
      let n = [0, 1, 2].map((k) => a * nor[v[0] * 3 + k] + b * nor[v[1] * 3 + k] + c * nor[v[2] * 3 + k]);
      const nl = Math.hypot(...n) || 1; n = n.map((q) => q / nl);
      const col = paint({ p, n, w: [a, b, c], v });
      const o = (y * size + x) * 4;
      img[o] = enc(col[0]); img[o + 1] = enc(col[1]); img[o + 2] = enc(col[2]); img[o + 3] = 255;
      filled[y * size + x] = 1;
      if (inside) own[y * size + x] = 1;                              // a texel a triangle covers is never repainted by a neighbour's graze
    }
  }
  // Pad: grow every chart outward a texel at a time with the mean of its filled neighbours.
  for (let it = 0; it < pad; it++) {
    const add = [];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (filled[y * size + x]) continue;
      let r = 0, g = 0, bb = 0, k = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Y = y + dy;
        if (X < 0 || Y < 0 || X >= size || Y >= size || filled[Y * size + X] !== 1) continue;
        const o = (Y * size + X) * 4; r += img[o]; g += img[o + 1]; bb += img[o + 2]; k++;
      }
      if (k) add.push([y * size + x, r / k, g / k, bb / k]);
    }
    for (const [i, r, g, bb] of add) { img[i * 4] = r; img[i * 4 + 1] = g; img[i * 4 + 2] = bb; img[i * 4 + 3] = 255; filled[i] = 2; }
    for (const [i] of add) filled[i] = 1;
  }
  // Whatever is still empty gets the mean colour (no black bleeding into the smallest mips).
  let m = [0, 0, 0], k = 0;
  for (let i = 0; i < size * size; i++) if (filled[i]) { m[0] += img[i * 4]; m[1] += img[i * 4 + 1]; m[2] += img[i * 4 + 2]; k++; }
  m = m.map((v) => v / Math.max(1, k));
  for (let i = 0; i < size * size; i++) if (!filled[i]) { img[i * 4] = m[0]; img[i * 4 + 1] = m[1]; img[i * 4 + 2] = m[2]; img[i * 4 + 3] = 255; }
  return img;
}

// The point of triangle abc nearest to p (2D) and its barycentric weights.
function closest(p, a, b, c) {
  const sub = (u, v) => [u[0] - v[0], u[1] - v[1]], dot = (u, v) => u[0] * v[0] + u[1] * v[1];
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return { p: a, w: [1, 0, 0] };
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return { p: b, w: [0, 1, 0] };
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return { p: [a[0] + ab[0] * v, a[1] + ab[1] * v], w: [1 - v, v, 0] }; }
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return { p: c, w: [0, 0, 1] };
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return { p: [a[0] + ac[0] * w, a[1] + ac[1] * w], w: [1 - w, 0, w] }; }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return { p: [b[0] + (c[0] - b[0]) * w, b[1] + (c[1] - b[1]) * w], w: [0, 1 - w, w] }; }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  return { p: [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w], w: [1 - v - w, v, w] };
}

// Coarse level of detail on the unwrapped mesh: chart borders (the UV seams) are locked so the texture still fits.
// Returns { idx, from } with `from` the vertex of the input each kept vertex is.
export function simplifyKeepingSeams(pos, idx, targetTris) {
  const [out] = MeshoptSimplifier.simplify(idx, pos, 3, Math.floor(targetTris * 3), 0.03, ['LockBorder']);
  const [remap, count] = MeshoptSimplifier.compactMesh(out);
  const from = new Uint32Array(count);
  for (let i = 0; i < pos.length / 3; i++) if (remap[i] !== 0xffffffff) from[remap[i]] = i;
  return { idx: out, from };
}
