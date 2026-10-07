// Textured leaves for plants (run sets, S3 plants pilot: the hart's-tongue). The same channel contract as the orchids' baked leaf maps
// (sim/orchid-leaves.js, render/shaders.js plantMaterial leafMap / leafHue / leafRelief), loaded from public/assets/plants/<id>-<part>.webp
// (made by art-src/plants/<id>_bake.py; the tint map is resampled reference data, owner-approved). Row 0 of a file = the leaf's tip.
import * as THREE from 'three/webgpu';

const PENDING = [];
// resolves when every map asked for so far has arrived (tools/bake-portraits.mjs waits for it: an unloaded map reads as transparent)
export const plantMapsReady = () => Promise.all(PENDING);
const BAKED = typeof document !== 'undefined' && typeof createImageBitmap === 'function' ? {} : null;
export function plantLeafMap(id, part) {   // part: 'leaf' | 'relief' | 'tint'; null in node (the unit tests): the plant then keeps its vertex colours
  if (!BAKED) return null;
  const key = id + '-' + part;
  if (BAKED[key]) return BAKED[key];
  const tx = new THREE.Texture();
  tx.colorSpace = THREE.NoColorSpace; tx.flipY = false; tx.generateMipmaps = true; tx.anisotropy = 4;
  tx.wrapS = tx.wrapT = THREE.ClampToEdgeWrapping; tx.magFilter = THREE.LinearFilter; tx.minFilter = THREE.LinearMipmapLinearFilter;
  const base = new URL(`${import.meta.env?.BASE_URL ?? './'}assets/plants/`, location.href);
  PENDING.push(new Promise((res) => new THREE.ImageBitmapLoader().setOptions({ imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
    .load(new URL(`${key}.webp`, base).href, (bmp) => { tx.image = bmp; tx.needsUpdate = true; res(); }, undefined, (e) => { console.warn('plant map', key, e); res(); })));
  return (BAKED[key] = tx);
}

// The three maps of a plant as plantMaterial options (leafMap, leafHue, leafRelief).
export const plantMaps = (id) => ({ leafMap: plantLeafMap(id, 'leaf'), leafHue: plantLeafMap(id, 'tint'), leafRelief: plantLeafMap(id, 'relief') });

// Hart's-tongue outline (keep in step with art-src/plants/hartstongue_bake.py): the true half width (a fraction of `width`) and the
// coarse envelope the blade is cut from (the alpha channel draws the true margin: heart-shaped base, wavy edge, tapering tip).
const sst = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export function hartstongueTrue(t) {
  const base = 0.28 + 0.72 * sst(0, 0.07, t) + 0.12 * Math.exp(-(((t - 0.07) / 0.035) ** 2));
  const mid = Math.pow(Math.sin(Math.PI * Math.min(1, 0.04 + t * 0.96)), 0.3) * (1 - 0.25 * t);
  return 0.5 * base * mid * (1 + 0.035 * Math.sin(t * 52 + 1) + 0.02 * Math.sin(t * 23));
}
const HS_NR = 16, HS_W = [];
for (let i = 0; i <= HS_NR; i++) {
  const a = Math.max(0, i - 1) / HS_NR, b = Math.min(HS_NR, i + 1) / HS_NR;
  let m = 0;
  for (let k = 0; k <= 48; k++) m = Math.max(m, hartstongueTrue(a + ((b - a) * k) / 48));
  HS_W.push(m + 0.03);
}
export function hartstongueEnv(t) {
  const x = Math.min(HS_NR, Math.max(0, t * HS_NR)), i = Math.min(HS_NR - 1, Math.floor(x));
  return HS_W[i] + (HS_W[i + 1] - HS_W[i]) * (x - i);
}
