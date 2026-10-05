// Painted orchid leaves (run orchids, T1; in sim/ so sim/flowering.js may import it: the layer rule): one small texture per species, made in code at first use (no photo pixels:
// the owner's reference photos are web pictures and the game is for sale). render/shaders.js plantMaterial reads it as
// `leafMap` at the leaf coordinates (u across -1..1, t base to tip):
//   R  shade, x2 in the shader (0.5 = the vertex colour as it is): midrib, faint veins, a soft mottling, a darker margin
//   G  how far toward the material's `leafPale` (pale midrib, the silver warts of D. cuthbertsonii)
//   B  how much the back face takes the material's `leafBack` tint (paler, or flushed red-brown underneath)
//   A  the true outline: each blade is a coarse envelope (`env`, piecewise linear over `rows`, always outside the outline),
//      and the alpha cut (plantMaterial alphaTest 0.45) draws the smooth margin, lobes, notch and tip.
// Each species: `T(t)` the true half-width (a fraction of the sheet's `width`, 0.5 = full, like the OVAL outlines in
// sim/flowering.js), `rows` (the sheet's rows), `asp` (length / width, so dots and lines come out round in the world).
import * as THREE from 'three/webgpu';

const N = 256;
const sst = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hash = (x, y, s) => {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 982451653)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const vnoise = (x, y, s) => {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};
const fbm = (x, y, s) => 0.6 * vnoise(x, y, s) + 0.3 * vnoise(x * 2.1, y * 2.1, s + 7) + 0.1 * vnoise(x * 4.3, y * 4.3, s + 13);

// The envelope over `rows`: each row as wide as the outline's widest point on both neighbouring intervals (plus a pad),
// so the straight blade edge between two rows never cuts into the leaf.
function envelope(T, rows, pad = 0.03) {
  const W = rows.map((_, i) => {
    const a = rows[Math.max(0, i - 1)], b = rows[Math.min(rows.length - 1, i + 1)];
    let m = 0;
    for (let k = 0; k <= 48; k++) m = Math.max(m, T(a + ((b - a) * k) / 48));
    return m + pad;
  });
  return (t) => {
    for (let i = 0; i < rows.length - 1; i++) if (t <= rows[i + 1]) return W[i] + ((W[i + 1] - W[i]) * (t - rows[i])) / (rows[i + 1] - rows[i]);
    return W[W.length - 1];
  };
}

// Heart-leaf Pleurothallis: rounded basal lobes behind the stalk (the sheet starts 0.2 of its length behind it) closing into
// a narrow notch, widest at about 0.35, the tip drawn out (acuminate). One clear pale midrib, very faint arcuate veins.
const PL_T = (t) => (t < 0.3 ? 0.5 * Math.pow(Math.sin((Math.PI / 2) * Math.min(1, (t + 0.012) / 0.3)), 0.5)
  : 0.5 * Math.pow(Math.cos((Math.PI / 2) * (t - 0.3) / 0.7), 1.15) * (1 - 0.35 * sst(0.72, 1, t)));
// Masdevallia: a narrow channelled petiole (about a third), then an oblanceolate spoon with a blunt, rounded tip.
const MA_T = (t) => (t < 0.26 ? 0.075 + 0.02 * t / 0.26
  : (0.095 + 0.385 * Math.pow(sst(0.26, 0.72, t), 0.8)) * Math.pow(Math.max(0, 1 - Math.pow(Math.max(0, t - 0.74) / 0.26, 2)), 0.55));
// Dracula: a long keeled strap from a narrow base, the sides parallel, an acute tip.
const DR_T = (t) => (0.06 + 0.37 * sst(0, 0.28, t)) * Math.pow(Math.max(0, 1 - Math.pow(Math.max(0, t - 0.55) / 0.45, 2.2)), 0.6);
// D. cuthbertsonii: lanceolate-elliptic, widest a little below the middle, acute.
const CU_T = (t) => 0.5 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.03 + 0.97 * t)), 0.75) * (1 - 0.25 * sst(0.6, 1, t));

export const ORCHID_LEAF = {
  pleurothallis: { T: PL_T, rows: [0, 0.07, 0.17, 0.3, 0.46, 0.63, 0.81, 1], asp: 1.4, notch: 0.2 },
  masdevallia: { T: MA_T, rows: [0, 0.26, 0.45, 0.65, 0.85, 1], asp: 5 },
  dracula: { T: DR_T, rows: [0, 0.15, 0.4, 0.65, 0.85, 1], asp: 10 },
  cuthbertsonii: { T: CU_T, rows: [0, 0.35, 0.7, 1], asp: 3.4 },
};
for (const k in ORCHID_LEAF) ORCHID_LEAF[k].env = envelope(ORCHID_LEAF[k].T, ORCHID_LEAF[k].rows);

// What each species paints at one point: lat = distance from the midrib and rel = lat / half-width (0 midrib, 1 margin),
// both in units of the leaf's width; y = t * asp (along, same units). Returns [shade, pale, back].
// (T2: the detail is stronger than T1's, around the same mean shade 0.5, so each leaf keeps its hue and value: veins that
// follow the blade, a midrib, two scales of mottling, a darker margin, a soft base-to-tip tone.)
// Veins: lines of constant rel (they run from the stalk to the tip and close in toward it: arcuate in a heart blade,
// parallel in a strap). `c` the vein positions, `w` the half-width of a line in rel.
const veinsAt = (rel, c, w) => { let v = 0; for (const k of c) v = Math.max(v, sst(w, 0, Math.abs(rel - k))); return v; };
const PL_V = [0.2, 0.37, 0.53, 0.68, 0.81, 0.92];
const PAR = (rel, n, from) => Math.pow(0.5 + 0.5 * Math.cos(rel * n * Math.PI * 2), 14) * sst(from, from + 0.08, rel) * sst(1, 0.88, rel);
// D. cuthbertsonii's warts (photo 1): silver-white raised specks in loose lengthwise rows, denser along the midrib.
// Returns [dot, rim, height]; the relief map raises them, so the paint keeps only a faint dark foot below each.
function warts(sx, y, rel) {
  const cx = 0.12, cy = 0.15, gx = sx / cx, gy = y / cy;   // (T3: larger cells, larger dots: a speckle at 40 cm)
  let dot = 0, rim = 0, h = 0;
  for (let i = Math.floor(gx) - 1; i <= Math.floor(gx) + 1; i++) for (let j = Math.floor(gy) - 1; j <= Math.floor(gy) + 1; j++) {
    if (hash(i, j, 21) < 0.12 + 0.4 * rel) continue;
    const px = (i + 0.5 + (hash(i, j, 22) - 0.5) * 0.8) * cx, py = (j + 0.5 + (hash(i, j, 23) - 0.5) * 0.8) * cy;
    const rad = 0.026 + 0.022 * hash(i, j, 24);
    const dx = sx - px, dy = y - py, d = Math.sqrt(dx * dx + dy * dy);
    dot = Math.max(dot, sst(rad, rad * 0.45, d) * (0.65 + 0.35 * sst(-rad, rad, -dy)));
    rim = Math.max(rim, sst(rad * 1.7, rad, d) * sst(0, rad, dy) * (1 - sst(rad, rad * 0.45, d)));
    h = Math.max(h, 0.75 * rad * sst(rad * 1.15, 0, d));
  }
  return [dot, rim, h];
}
const PAINT = {
  pleurothallis(t, lat, rel, y, notch) {
    const tip = 1 - 0.6 * t, onBlade = t > notch - 0.02 ? 1 : 0;
    const rib = sst(0.014, 0.004, lat) * tip * onBlade;
    const vein = veinsAt(rel, PL_V, 0.022) * (t > notch ? 1 : 0.6) * sst(1, 0.9, t);
    const mott = fbm(lat * 9, y * 6, 3) - 0.5, fine = fbm(lat * 46, y * 46, 4) - 0.5;
    const shade = 0.51 + 0.07 * rib + 0.04 * vein - 0.085 * sst(0.78, 1, rel) + 0.1 * mott + 0.035 * fine + 0.05 * (0.45 - t) * (1 - 0.5 * rel);
    return [shade, 0.15 * rib, 0.7];
  },
  masdevallia(t, lat, rel, y) {
    // the channel: a dark groove down the middle with lighter shoulders, deeper on the petiole; fine parallel veins
    const groove = sst(0.022, 0.004, lat) * (1 - 0.7 * t + 0.3 * sst(0.32, 0.2, t)), shoulder = sst(0.015, 0.035, lat) * sst(0.075, 0.04, lat);
    const vein = PAR(rel, 6, 0.12);
    const mott = fbm(lat * 7, y * 3, 5) - 0.5, fine = fbm(lat * 40, y * 12, 6) - 0.5;
    const shade = 0.51 - 0.13 * groove + 0.05 * shoulder + 0.035 * vein + 0.1 * mott + 0.03 * fine - 0.08 * sst(0.8, 1, rel) + 0.05 * sst(0.32, 0.12, t) - 0.03 * sst(0.6, 1, t);
    return [shade, 0.12 * shoulder + 0.05 * sst(0.3, 0.05, t), 0.6];
  },
  dracula(t, lat, rel, y) {
    // the keel: a dark fold line with a pale edge either side, and parallel veins along the strap
    const fold = sst(0.014, 0.003, lat), edge = sst(0.012, 0.024, lat) * sst(0.045, 0.026, lat);
    const vein = PAR(rel, 7, 0.1);
    const mott = fbm(lat * 8, y * 1.5, 9) - 0.5, fine = fbm(lat * 36, y * 6, 10) - 0.5;
    const shade = 0.51 - 0.1 * fold + 0.03 * edge + 0.04 * vein + 0.09 * mott + 0.03 * fine - 0.07 * sst(0.85, 1, rel) + 0.04 * sst(0.25, 0.05, t) - 0.03 * sst(0.6, 1, t);
    return [shade, 0.16 * edge, 1];
  },
  cuthbertsonii(t, lat, rel, y, _n, sx) {
    const [dot, rim] = warts(sx, y, rel);
    const fade = sst(0.97, 0.75, rel) * sst(0.02, 0.1, t) * sst(1, 0.85, t);
    const mott = fbm(lat * 10, y * 4, 11) - 0.5, fine = fbm(lat * 40, y * 16, 12) - 0.5;
    const shade = 0.5 + 0.08 * mott + 0.03 * fine - 0.1 * rim * fade - 0.07 * sst(0.8, 1, rel) + 0.04 * sst(0.012, 0, lat) + 0.03 * (0.5 - t);
    return [shade + 0.08 * dot * fade, 0.9 * dot * fade, 1];
  },
};
// The same painter's relief: the height of the front face at one point (width units), for the slope map below.
// Each half of the blade gently domed (so the wax highlight is a band that moves over the leaf, never the whole flat
// blade at once), a midrib groove, faint vein ridges, the raised warts of D. cuthbertsonii.
const dome = (rel, hw, k) => k * hw * Math.sin(Math.PI * Math.min(1, rel));
// (T3) and bowed along its length (largest slope k at base and tip), so the overhead lamp's highlight falls in a band
// inside the upper blade of a hanging or arching leaf, not on its margin. y / t = the sheet's length in width units.
export const BOW = { pleurothallis: 0.5, masdevallia: 0.3, dracula: 0.15, cuthbertsonii: 0.2 };
const bow = (t, y, k) => (k * (y / Math.max(t, 1e-4)) * Math.sin(Math.PI * t)) / Math.PI;
const RELIEF = {
  pleurothallis(t, lat, rel, y, notch, sx, hw) {
    const rib = sst(0.03, 0, lat) * (1 - 0.6 * t) * (t > notch - 0.02 ? 1 : 0);
    const vein = veinsAt(rel, PL_V, 0.03) * (t > notch ? 1 : 0.6) * sst(1, 0.9, t);
    return bow(t, y, BOW.pleurothallis) + dome(rel, hw, 0.1) - 0.012 * rib + 0.0018 * vein + 0.0012 * (fbm(lat * 46, y * 46, 4) - 0.5);
  },
  masdevallia(t, lat, rel, y, _n, sx, hw) {
    const groove = sst(0.03, 0, lat) * (1 - 0.6 * t + 0.4 * sst(0.32, 0.2, t));
    return bow(t, y, BOW.masdevallia) + dome(rel, hw, 0.08) - 0.012 * groove + 0.0012 * PAR(rel, 6, 0.12) + 0.0008 * (fbm(lat * 40, y * 12, 6) - 0.5);
  },
  dracula(t, lat, rel, y, _n, sx, hw) {
    return bow(t, y, BOW.dracula) + dome(rel, hw, 0.05) - 0.008 * sst(0.02, 0, lat) + 0.001 * PAR(rel, 7, 0.1) + 0.0008 * (fbm(lat * 36, y * 6, 10) - 0.5);
  },
  cuthbertsonii(t, lat, rel, y, _n, sx, hw) {
    const fade = sst(0.97, 0.75, rel) * sst(0.02, 0.1, t) * sst(1, 0.85, t);
    return bow(t, y, BOW.cuthbertsonii) + dome(rel, hw, 0.07) - 0.006 * sst(0.02, 0, lat) + warts(sx, y, rel)[2] * fade;
  },
};

const texOf = (data) => {
  const tx = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tx.colorSpace = THREE.NoColorSpace;   // data, not colour: the shader reads the numbers as painted
  tx.wrapS = tx.wrapT = THREE.ClampToEdgeWrapping;
  tx.magFilter = THREE.LinearFilter;
  tx.minFilter = THREE.LinearMipmapLinearFilter;
  tx.generateMipmaps = true;
  tx.anisotropy = 4;
  tx.needsUpdate = true;
  return tx;
};
// One pass over the sheet: (t, u) of each texel and what the painter needs there.
function eachTexel(S, fn) {
  for (let j = 0; j < N; j++) {
    const t = (j + 0.5) / N, hw = S.T(t), env = S.env(t), y = t * S.asp;
    for (let i = 0; i < N; i++) {
      const u = ((i + 0.5) / N) * 2 - 1, lat = Math.abs(u) * env;
      fn(j * N + i, t, u, lat, Math.min(1, lat / Math.max(hw, 1e-3)), y, hw, env);
    }
  }
}

const cache = {}, rcache = {};
// The species' leaf texture (256 x 256 RGBA, linear data, mipmapped), made once.
export function orchidLeafMap(kind) {
  if (cache[kind]) return cache[kind];
  const S = ORCHID_LEAF[kind], paint = PAINT[kind], data = new Uint8Array(N * N * 4);
  eachTexel(S, (p, t, u, lat, rel, y, hw, env) => {
    const aa = (1.6 * 2 * env) / N;
    let d = hw - lat;
    // the notch: the lobes meet in a narrow closed sinus behind the stalk
    if (S.notch) d = Math.min(d, lat - 0.11 * Math.pow(Math.max(0, 1 - t / S.notch), 0.7) + (t >= S.notch ? 1 : 0));
    const [sh, pale, back] = paint(t, lat, rel, y, S.notch, u * env);
    const o = p * 4;
    data[o] = Math.round(255 * Math.min(1, Math.max(0, sh)));
    data[o + 1] = Math.round(255 * Math.min(1, Math.max(0, pale)));
    data[o + 2] = Math.round(255 * back);
    data[o + 3] = Math.round(255 * sst(-aa, aa, d));
  });
  return (cache[kind] = texOf(data));
}

// Slopes of the relief stored per texel (T2): R = dh/dx across (+u), G = dh/dy along (+t), both in the leaf's own units
// (height per distance, so a slope of 1 is 45 degrees), stored as 0.5 + slope / (2 * SLOPE). render/shaders.js turns
// them into a normal with a frame built from the `leaf` coordinate (no uv or tangent buffer). Mipmaps average slopes, so
// a far leaf is smoother, never noisier. B = how much wax highlight (T3: 0 at the margin, so the lamp never lights a rim). 256 x 256 RGBA, made once.
export const SLOPE = 2;
export function orchidLeafRelief(kind) {
  if (rcache[kind]) return rcache[kind];
  const S = ORCHID_LEAF[kind], relief = RELIEF[kind], H = new Float32Array(N * N), E = new Float32Array(N), Wx = new Uint8Array(N * N);
  eachTexel(S, (p, t, u, lat, rel, y, hw, env) => { H[p] = relief(t, lat, rel, y, S.notch, u * env, hw); E[p >> 8] = env; Wx[p] = Math.round(255 * sst(0.95, 0.55, rel) * sst(0, 0.06, t)); });
  const data = new Uint8Array(N * N * 4), enc = (s) => Math.round(255 * Math.min(1, Math.max(0, 0.5 + s / (2 * SLOPE))));
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const i0 = Math.max(0, i - 1), i1 = Math.min(N - 1, i + 1), j0 = Math.max(0, j - 1), j1 = Math.min(N - 1, j + 1);
    const sx = (H[j * N + i1] - H[j * N + i0]) / (((i1 - i0) * 2 * E[j]) / N);
    const sy = (H[j1 * N + i] - H[j0 * N + i]) / (((j1 - j0) * S.asp) / N);
    const o = (j * N + i) * 4;
    data[o] = enc(sx); data[o + 1] = enc(sy); data[o + 2] = Wx[j * N + i]; data[o + 3] = 255;
  }
  return (rcache[kind] = texOf(data));
}

// (T3) A small tileable noise for the mottling (render/shaders.js `leafNoise`, read at the object-space position): R = soft
// blobs about a leaf across (each blade sits in another part of the field, so no two leaves have the same tone), G = patches
// a quarter of that. Periodic value noise (no seam), each channel set to mean 0.5, +-2 sigma = 0..1. 64 x 64, made once.
let ncache = null;
export function orchidLeafNoise() {
  if (ncache) return ncache;
  const M = 64, raw = [new Float32Array(M * M), new Float32Array(M * M)];
  const pv = (x, y, P, s) => {
    const xi = Math.floor(x), yi = Math.floor(y), ux = sst(0, 1, x - xi), uy = sst(0, 1, y - yi);
    const h = (i, j) => hash(((i % P) + P) % P, ((j % P) + P) % P, s);
    return (h(xi, yi) * (1 - ux) + h(xi + 1, yi) * ux) * (1 - uy) + (h(xi, yi + 1) * (1 - ux) + h(xi + 1, yi + 1) * ux) * uy;
  };
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    const x = i / M, y = j / M;
    raw[0][j * M + i] = 0.7 * pv(x * 4, y * 4, 4, 31) + 0.3 * pv(x * 8, y * 8, 8, 32);
    raw[1][j * M + i] = 0.6 * pv(x * 16, y * 16, 16, 33) + 0.4 * pv(x * 32, y * 32, 32, 34);
  }
  const data = new Uint8Array(M * M * 4).fill(255);
  raw.forEach((a, c) => {
    let s = 0, q = 0; for (const v of a) { s += v; q += v * v; }
    const mu = s / a.length, sd = Math.sqrt(Math.max(1e-9, q / a.length - mu * mu));
    a.forEach((v, p) => { data[p * 4 + c] = Math.round(255 * Math.min(1, Math.max(0, 0.5 + (v - mu) / (4 * sd)))); });
  });
  const tx = new THREE.DataTexture(data, M, M, THREE.RGBAFormat);
  tx.colorSpace = THREE.NoColorSpace;
  tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
  tx.magFilter = THREE.LinearFilter; tx.minFilter = THREE.LinearMipmapLinearFilter; tx.generateMipmaps = true;
  tx.needsUpdate = true;
  return (ncache = tx);
}
