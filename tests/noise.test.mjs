// The baked noise behind the glass's dew: it has to tile, and have the statistics the 3D noise it replaces had.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { worleyPlane, perlinPlane, toHalf } from '../src/util/noise.js';

const fill = (gen) => { for (const _ of gen); };   // eslint-disable-line no-unused-vars

test('worleyPlane tiles: no jump across the seams, only the smooth change of a distance field', () => {
  const size = 256, cells = 8, f = new Float32Array(size * size);
  fill(worleyPlane(f, size, cells, 3));
  const step = (cells / size) * 1.0001;           // a distance field changes by at most the distance moved (in cell units)
  for (let y = 0; y < size; y++) assert.ok(Math.abs(f[y * size] - f[y * size + size - 1]) <= step, `left/right seam, row ${y}`);
  for (let x = 0; x < size; x++) assert.ok(Math.abs(f[x] - f[(size - 1) * size + x]) <= step, `top/bottom seam, column ${x}`);
});

test('worleyPlane has the distribution of a 3D Worley field cut by a plane: P(F1 < r) = 1 - exp(-4/3 pi r^3)', () => {
  const size = 600, cells = 60, f = new Float32Array(size * size);
  fill(worleyPlane(f, size, cells, 17));
  for (const r of [0.2, 0.3, 0.4, 0.5]) {
    let n = 0; for (let i = 0; i < f.length; i++) if (f[i] < r) n++;
    const got = n / f.length, want = 1 - Math.exp(-(4 / 3) * Math.PI * r ** 3);
    assert.ok(Math.abs(got - want) < 0.12 * want + 0.002, `r=${r}: ${got.toFixed(4)} vs ${want.toFixed(4)}`);
  }
  let max = 0; for (let i = 0; i < f.length; i++) max = Math.max(max, f[i]);
  assert.ok(max < 1.3, `no distance beyond ${max.toFixed(2)} cells`);
});

test('worleyPlane is deterministic and the seed changes it', () => {
  const a = new Float32Array(64 * 64), b = new Float32Array(64 * 64), c = new Float32Array(64 * 64);
  fill(worleyPlane(a, 64, 4, 9)); fill(worleyPlane(b, 64, 4, 9)); fill(worleyPlane(c, 64, 4, 10));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test('perlinPlane tiles, stays in about -1..1 and is centred on zero', () => {
  const size = 256, cells = 5, f = new Float32Array(size * size);
  fill(perlinPlane(f, size, cells, 5));
  let lo = 9, hi = -9, sum = 0;
  for (const v of f) { lo = Math.min(lo, v); hi = Math.max(hi, v); sum += v; }
  assert.ok(lo > -1.05 && hi < 1.05, `range ${lo.toFixed(2)} .. ${hi.toFixed(2)}`);
  assert.ok(hi > 0.5 && lo < -0.5, 'it uses the range');
  assert.ok(Math.abs(sum / f.length) < 0.1, 'mean near zero');
  const step = (cells / size) * 2.2;              // the gradient is bounded: no jumps, including across the seams
  for (let y = 0; y < size; y++) assert.ok(Math.abs(f[y * size] - f[y * size + size - 1]) <= step, `seam row ${y}`);
  for (let x = 0; x < size; x++) assert.ok(Math.abs(f[x] - f[(size - 1) * size + x]) <= step, `seam column ${x}`);
});

test('toHalf matches three.js for the values the textures hold', () => {
  for (let v = 0; v <= 2; v += 0.0137) assert.equal(toHalf(v), THREE.DataUtils.toHalfFloat(v), `v=${v}`);
  for (const v of [0, 1, 0.5, 1.5, -1, -0.25, 1e-6, 65000]) assert.equal(toHalf(v), THREE.DataUtils.toHalfFloat(v), `v=${v}`);
});

// The baked Perlin volume (render/noise3.js): range and spread of mx_noise_float, periodic, and smooth between texels.
test('perlinVolume: Perlin range and spread, periodic, smooth', async () => {
  const { perlinVolume } = await import('../src/util/noise.js');
  const size = 32, cells = 4, f = new Float32Array(size ** 3);
  for (const _ of perlinVolume(f, size, cells, 7));
  let mean = 0, sq = 0, lo = Infinity, hi = -Infinity;
  for (const v of f) { mean += v; sq += v * v; lo = Math.min(lo, v); hi = Math.max(hi, v); }
  mean /= f.length; const sd = Math.sqrt(sq / f.length - mean * mean);
  assert.ok(Math.abs(mean) < 0.05, 'mean ' + mean);
  assert.ok(sd > 0.15 && sd < 0.4, 'spread ' + sd);
  assert.ok(lo > -1.05 && hi < 1.05 && hi - lo > 0.9, `range ${lo}..${hi}`);
  // Zero at every lattice point, as gradient noise is.
  for (let k = 0; k < cells; k++) assert.ok(Math.abs(f[(k * 8) * size * size + (k * 8) * size + k * 8]) < 1e-6);
  // Neighbouring texels differ little (8 texels a cell), including across the wrap.
  let maxStep = 0;
  for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const a = f[(z * size + y) * size + x], b = f[(z * size + y) * size + (x + 1) % size];
    maxStep = Math.max(maxStep, Math.abs(a - b));
  }
  assert.ok(maxStep < 0.45, 'step ' + maxStep);   // a jump at the wrap would be about 1
});
