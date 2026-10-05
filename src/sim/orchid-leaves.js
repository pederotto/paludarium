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
const PAINT = {
  pleurothallis(t, lat, rel, y, notch) {
    const tip = 1 - 0.6 * t;
    const rib = t > notch - 0.02 ? sst(0.012, 0.003, lat) * tip : 0;
    // faint arcuate veins: lines of constant rel from the stalk to the tip, and fainter ones into the lobes
    let vein = 0;
    for (const c of [0.38, 0.66, 0.86]) vein = Math.max(vein, sst(0.05, 0, Math.abs(rel - c)) * (t > notch ? 1 : 0.5));
    const mott = fbm(lat * 9, y * 6, 3) - 0.5;
    const shade = 0.5 + 0.05 * rib + 0.018 * vein - 0.045 * sst(0.75, 1, rel) + 0.07 * mott + 0.03 * (1 - rel) * (1 - t);
    return [shade, 0.15 * rib, 0.7];
  },
  masdevallia(t, lat, rel, y) {
    // the channel: a dark groove down the middle with lighter shoulders, deeper on the petiole
    const groove = sst(0.022, 0.004, lat) * (1 - 0.7 * t + 0.3 * sst(0.32, 0.2, t)), shoulder = sst(0.015, 0.035, lat) * sst(0.075, 0.04, lat);
    const mott = fbm(lat * 7, y * 3, 5) - 0.5;
    const shade = 0.5 - 0.13 * groove + 0.05 * shoulder + 0.07 * mott - 0.05 * sst(0.8, 1, rel) + 0.04 * sst(0.32, 0.2, t);
    return [shade, 0.12 * shoulder, 0.6];
  },
  dracula(t, lat, rel, y) {
    // the keel: a dark fold line with a pale edge either side, and faint parallel veins along the strap
    const fold = sst(0.014, 0.003, lat), edge = sst(0.012, 0.024, lat) * sst(0.045, 0.026, lat);
    const vein = Math.pow(0.5 + 0.5 * Math.cos(rel * 7 * Math.PI * 2), 10) * sst(0.1, 0.2, rel) * sst(1, 0.85, rel);
    const mott = fbm(lat * 8, y * 1.5, 9) - 0.5;
    const shade = 0.5 - 0.1 * fold + 0.03 * edge + 0.022 * vein + 0.06 * mott - 0.04 * sst(0.85, 1, rel);
    return [shade, 0.16 * edge, 1];
  },
  cuthbertsonii(t, lat, rel, y, _n, sx) {
    // raised silver-white warts in loose lengthwise rows (photo 1): a bright dot, lit on its upper side, a dark rim below
    const cx = 0.085, cy = 0.11;
    const gx = sx / cx, gy = y / cy;
    let dot = 0, rim = 0;
    for (let i = Math.floor(gx) - 1; i <= Math.floor(gx) + 1; i++) for (let j = Math.floor(gy) - 1; j <= Math.floor(gy) + 1; j++) {
      if (hash(i, j, 21) < 0.3 + 0.45 * rel) continue;   // (T1b: irregular, denser along the midrib)
      const px = (i + 0.5 + (hash(i, j, 22) - 0.5) * 0.8) * cx, py = (j + 0.5 + (hash(i, j, 23) - 0.5) * 0.8) * cy;
      const rad = 0.011 + 0.014 * hash(i, j, 24);   // (T1b: fine specks, photo 1)
      const dx = sx - px, dy = y - py, d = Math.hypot(dx, dy);
      dot = Math.max(dot, sst(rad, rad * 0.45, d) * (0.65 + 0.35 * sst(-rad, rad, -dy)));
      rim = Math.max(rim, sst(rad * 1.7, rad, d) * sst(0, rad, dy) * (1 - sst(rad, rad * 0.45, d)));
    }
    const fade = sst(0.97, 0.75, rel) * sst(0.02, 0.1, t) * sst(1, 0.85, t);
    const mott = fbm(lat * 10, y * 4, 11) - 0.5;
    const shade = 0.5 + 0.06 * mott - 0.16 * rim * fade - 0.05 * sst(0.8, 1, rel) + 0.04 * sst(0.012, 0, lat);
    return [shade + 0.03 * dot * fade, 0.5 * dot * fade, 1];
  },
};

const cache = {};
// The species' leaf texture (256 x 256 RGBA, sRGB, mipmapped), made once.
export function orchidLeafMap(kind) {
  if (cache[kind]) return cache[kind];
  const S = ORCHID_LEAF[kind], paint = PAINT[kind], data = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) {
    const t = (j + 0.5) / N, hw = S.T(t), env = S.env(t), aa = (1.6 * 2 * env) / N, y = t * S.asp;
    for (let i = 0; i < N; i++) {
      const u = ((i + 0.5) / N) * 2 - 1, lat = Math.abs(u) * env;
      let d = hw - lat;
      // the notch: the lobes meet in a narrow closed sinus behind the stalk
      if (S.notch) d = Math.min(d, lat - 0.11 * Math.pow(Math.max(0, 1 - t / S.notch), 0.7) + (t >= S.notch ? 1 : 0));
      const [sh, pale, back] = paint(t, lat, Math.min(1, lat / Math.max(hw, 1e-3)), y, S.notch, u * env);
      const o = (j * N + i) * 4;
      data[o] = Math.round(255 * Math.min(1, Math.max(0, sh)));
      data[o + 1] = Math.round(255 * Math.min(1, Math.max(0, pale)));
      data[o + 2] = Math.round(255 * back);
      data[o + 3] = Math.round(255 * sst(-aa, aa, d));
    }
  }
  const tx = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tx.colorSpace = THREE.NoColorSpace;   // data, not colour: the shader reads the numbers as painted
  tx.wrapS = tx.wrapT = THREE.ClampToEdgeWrapping;
  tx.magFilter = THREE.LinearFilter;
  tx.minFilter = THREE.LinearMipmapLinearFilter;
  tx.generateMipmaps = true;
  tx.anisotropy = 4;
  tx.needsUpdate = true;
  return (cache[kind] = tx);
}
