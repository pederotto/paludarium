// Colour from the owner's textured model, carried onto a re-meshed one: `colorSource(glbPath, toFrame)` reads the original GLB
// (full resolution, UVs and base-colour texture, here a Meshy model whose texture is a patchwork of tiny charts that no
// decimation can keep), puts its vertices in the baked frame with `toFrame([x, y, z]) -> [x, y, z]`, and returns
// `sample(x, y, z) -> linear [r, g, b]`: the colour at the nearest point of the original surface (nearest triangle on a
// grid, then the barycentric UV, then a bilinear texture lookup). Used for the panther crab (tools/bake-creature.mjs `colorSrc`).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

export async function colorSource(file, toFrame, { grid: cellsAcross = 220 } = {}) {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.read(file);
  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  const P0 = prim.getAttribute('POSITION').getArray(), UV = prim.getAttribute('TEXCOORD_0').getArray(), I = prim.getIndices().getArray();
  const tex = prim.getMaterial().getBaseColorTexture();
  const { data, info } = await sharp(Buffer.from(tex.getImage())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const lin = new Float32Array(256); for (let i = 0; i < 256; i++) lin[i] = Math.pow(i / 255, 2.2);
  const n = P0.length / 3, P = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const q = toFrame([P0[i * 3], P0[i * 3 + 1], P0[i * 3 + 2]]); P[i * 3] = q[0]; P[i * 3 + 1] = q[1]; P[i * 3 + 2] = q[2]; }
  let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], P[i * 3 + k]); hi[k] = Math.max(hi[k], P[i * 3 + k]); }
  const cell = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / cellsAcross;      // about 3 triangles a cell on the full model
  const D = [0, 1, 2].map((k) => Math.ceil((hi[k] - lo[k]) / cell) + 1);
  const cellOf = (x, k) => Math.max(0, Math.min(D[k] - 1, Math.floor((x - lo[k]) / cell)));
  const key = (a, b, c) => (a * D[1] + b) * D[2] + c;
  const grid = new Map(), T = I.length / 3;
  for (let t = 0; t < T; t++) {
    const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2];
    const mn = [0, 1, 2].map((k) => cellOf(Math.min(P[a * 3 + k], P[b * 3 + k], P[c * 3 + k]), k)), mx = [0, 1, 2].map((k) => cellOf(Math.max(P[a * 3 + k], P[b * 3 + k], P[c * 3 + k]), k));
    for (let x = mn[0]; x <= mx[0]; x++) for (let y = mn[1]; y <= mx[1]; y++) for (let z = mn[2]; z <= mx[2]; z++) { const kk = key(x, y, z); let l = grid.get(kk); if (!l) grid.set(kk, (l = [])); l.push(t); }
  }
  // closest point of triangle abc to p: barycentric weights and squared distance (Ericson, Real-Time Collision Detection)
  const closest = (p, a, b, c) => {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    const d1 = dot(ab, ap), d2 = dot(ac, ap);
    let w;
    if (d1 <= 0 && d2 <= 0) w = [1, 0, 0];
    else {
      const bp = [p[0] - b[0], p[1] - b[1], p[2] - b[2]], d3 = dot(ab, bp), d4 = dot(ac, bp);
      if (d3 >= 0 && d4 <= d3) w = [0, 1, 0];
      else {
        const vc = d1 * d4 - d3 * d2;
        if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); w = [1 - v, v, 0]; }
        else {
          const cp = [p[0] - c[0], p[1] - c[1], p[2] - c[2]], d5 = dot(ab, cp), d6 = dot(ac, cp);
          if (d6 >= 0 && d5 <= d6) w = [0, 0, 1];
          else {
            const vb = d5 * d2 - d1 * d6;
            if (vb <= 0 && d2 >= 0 && d6 <= 0) { const v = d2 / (d2 - d6); w = [1 - v, 0, v]; }
            else {
              const va = d3 * d6 - d5 * d4;
              if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const v = (d4 - d3) / ((d4 - d3) + (d5 - d6)); w = [0, 1 - v, v]; }
              else { const den = 1 / (va + vb + vc), v = vb * den, u = vc * den; w = [1 - v - u, v, u]; }
            }
          }
        }
      }
    }
    const q = [0, 1, 2].map((k) => w[0] * a[k] + w[1] * b[k] + w[2] * c[k]);
    return { w, d2: (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2 };
  };
  const vtx = (i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
  const tap = (u, v) => {                                  // bilinear, repeat, v runs down the image (glTF)
    const x = u * W - 0.5, y = v * H - 0.5, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, out = [0, 0, 0];
    for (const [dx, dy, w] of [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]]) {
      const X = ((x0 + dx) % W + W) % W, Y = ((y0 + dy) % H + H) % H, o = (Y * W + X) * 3;
      out[0] += w * lin[data[o]]; out[1] += w * lin[data[o + 1]]; out[2] += w * lin[data[o + 2]];
    }
    return out;
  };
  return (x, y, z) => {
    const p = [x, y, z], c = [cellOf(x, 0), cellOf(y, 1), cellOf(z, 2)];
    let best = null;
    for (let r = 0; r < 12 && !(best && best.d2 <= ((r - 1) * cell) ** 2); r++) {
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue;
        const X = c[0] + dx, Y = c[1] + dy, Z = c[2] + dz;
        if (X < 0 || Y < 0 || Z < 0 || X >= D[0] || Y >= D[1] || Z >= D[2]) continue;
        const l = grid.get(key(X, Y, Z)); if (!l) continue;
        for (const t of l) { const a = I[t * 3], b = I[t * 3 + 1], cc = I[t * 3 + 2], q = closest(p, vtx(a), vtx(b), vtx(cc)); if (!best || q.d2 < best.d2) best = { d2: q.d2, w: q.w, a, b, c: cc }; }
      }
    }
    if (!best) return [0.5, 0.35, 0.1];
    const u = best.w[0] * UV[best.a * 2] + best.w[1] * UV[best.b * 2] + best.w[2] * UV[best.c * 2];
    const v = best.w[0] * UV[best.a * 2 + 1] + best.w[1] * UV[best.b * 2 + 1] + best.w[2] * UV[best.c * 2 + 1];
    return tap(u, v);
  };
}
