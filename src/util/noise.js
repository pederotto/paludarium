// Tileable noise fields, generated on the CPU into typed arrays. No scene, no DOM: Node tests check their statistics.
//
// The glass's dew (engine/stage.js) used to evaluate two 3D Worley fields and a simplex noise in the fragment shader, for every
// fragment of the big panes, and that cost about half of a frame on a retina screen. The pattern never changes (only how much
// of it shows), so it is baked once into textures that tile.

// A well-mixed 32-bit integer hash of three integers (Wang/Jenkins style), as a float in 0..1.
function hash3i(x, y, z, seed) {
  let h = (Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(z, 0x9e3779b1) ^ Math.imul(seed, 0x85ebca6b)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// Distance to the nearest of a set of jittered points, one in every cell of a 3D grid (a Worley/cellular F1 field), on the
// plane z = 0 and periodic in x and y: `cells` cells to a period, `size` x `size` texels. Distances are in cell units.
// Taking the plane out of a 3D field (not a 2D field) gives beads of all sizes, as a 3D noise sliced by a pane did.
// Returns a generator that fills `out` (Float32Array, size*size) a few rows at a time and yields after each batch, so a
// caller can spread the work over frames; run it to completion with `for (const _ of gen);`.
export function* worleyPlane(out, size, cells, seed = 1, rowsPerBatch = 16) {
  // The jittered point of every cell (in x, y, and three z layers: -1, 0, 1).
  const pts = new Float32Array(cells * cells * 3 * 3);
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) for (let k = 0; k < 3; k++) {
    const o = ((j * cells + i) * 3 + k) * 3;
    pts[o] = hash3i(i, j, k - 1, seed); pts[o + 1] = hash3i(i, j, k - 1, seed + 101); pts[o + 2] = hash3i(i, j, k - 1, seed + 211);
  }
  const wrap = (v) => ((v % cells) + cells) % cells;
  for (let y0 = 0; y0 < size; y0 += rowsPerBatch) {
    for (let y = y0; y < Math.min(size, y0 + rowsPerBatch); y++) {
      const v = ((y + 0.5) / size) * cells, cj = Math.floor(v);
      for (let x = 0; x < size; x++) {
        const u = ((x + 0.5) / size) * cells, ci = Math.floor(u);
        let best = 1e9;
        for (let dj = -1; dj <= 1; dj++) {
          const nj = cj + dj, wj = wrap(nj);
          for (let di = -1; di <= 1; di++) {
            const ni = ci + di, base = (wj * cells + wrap(ni)) * 9;
            const dx = ni + pts[base] - u, dy = nj + pts[base + 1] - v;
            const d2xy = dx * dx + dy * dy;
            for (let k = 0; k < 3; k++) {
              const dz = (k - 1) + pts[base + k * 3 + 2];   // layer k - 1, jittered; the plane is z = 0
              const d2 = d2xy + dz * dz;
              if (d2 < best) best = d2;
            }
          }
        }
        out[y * size + x] = Math.sqrt(best);
      }
    }
    yield;
  }
}

// Smooth gradient noise in about -1..1, periodic in x and y: `cells` lattice cells to a period, `size` x `size` texels.
export function* perlinPlane(out, size, cells, seed = 1, rowsPerBatch = 32) {
  const gx = new Float32Array(cells * cells), gy = new Float32Array(cells * cells);
  for (let n = 0; n < cells * cells; n++) { const a = hash3i(n % cells, (n / cells) | 0, 7, seed) * Math.PI * 2; gx[n] = Math.cos(a); gy[n] = Math.sin(a); }
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  for (let y0 = 0; y0 < size; y0 += rowsPerBatch) {
    for (let y = y0; y < Math.min(size, y0 + rowsPerBatch); y++) {
      const v = (y / size) * cells, j0 = Math.floor(v), fy = v - j0, j1 = (j0 + 1) % cells, sv = fade(fy);
      for (let x = 0; x < size; x++) {
        const u = (x / size) * cells, i0 = Math.floor(u), fx = u - i0, i1 = (i0 + 1) % cells, su = fade(fx);
        const g = (i, j, dx, dy) => gx[j * cells + i] * dx + gy[j * cells + i] * dy;
        const a = g(i0, j0, fx, fy), b = g(i1, j0, fx - 1, fy), c = g(i0, j1, fx, fy - 1), d = g(i1, j1, fx - 1, fy - 1);
        out[y * size + x] = (a + (b - a) * su + (c + (d - c) * su - (a + (b - a) * su)) * sv) * 1.41;   // x1.41: gradient noise spans about +-0.7
      }
    }
    yield;
  }
}

// float -> IEEE half float bits (for textures: WebGPU can filter 16-bit floats everywhere).
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
export function toHalf(v) {
  f32[0] = v;
  const x = u32[0], sign = (x >>> 16) & 0x8000, e = ((x >>> 23) & 0xff) - 127 + 15, m = x & 0x7fffff;
  if (e <= 0) return e < -10 ? sign : sign | ((m | 0x800000) >> (14 - e));
  if (e >= 31) return sign | 0x7c00;
  return sign | (e << 10) | (m >> 13);
}
