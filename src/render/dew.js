// The dew pattern on the glass, baked into textures (see util/noise.js for why).
//
// The pattern is a function of the position on the glass only: two Worley fields (big beads, small beads) and a smooth noise
// for the haze. Both are tileable, so a texture of a few hundred texels covers any pane. They hold the *noise*, not the dew:
// how much of it shows is still the uniform U.condense, in the glass shader (engine/stage.js).
//
//   A, haze   one texture, red: the big beads' distance field (0.95 cells to the cm, 19 cells to a 20 cm tile),
//                              green: the haze noise (0.25 cells to the cm, 5 cells to the same tile)
//   B         the small beads' distance field (2.7 cells to the cm, 24 cells to a 8.9 cm tile)
//
// Baking takes a few hundred milliseconds of arithmetic, so it starts the first time there is any dew to show and runs in
// slices between frames; until it is done the textures say "no beads here" (a distance of 1 cell is farther than any bead).

import * as THREE from 'three/webgpu';
import { worleyPlane, perlinPlane, toHalf } from '../util/noise.js';

export const DEW = {
  periodA: 20, cellsA: 19, sizeA: 608, hazeCells: 5,
  periodB: 24 / 2.7, cellsB: 24, sizeB: 768,
};

const ONE = toHalf(1);
let textures = null, baking = false;

function make(size, channels) {
  const data = new Uint16Array(size * size * channels);
  for (let i = 0; i < data.length; i++) data[i] = i % channels === 0 ? ONE : 0;
  const t = new THREE.DataTexture(data, size, size, channels === 2 ? THREE.RGFormat : THREE.RedFormat, THREE.HalfFloatType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

// { a: red = big beads, green = haze; b: red = small beads }. Created at once, filled by bakeDew().
export function dewTextures() {
  return (textures ??= { a: make(DEW.sizeA, 2), b: make(DEW.sizeB, 1) });
}

// Fills the textures, a few milliseconds at a time. Safe to call every frame: it runs once.
export function bakeDew() {
  if (baking) return;
  baking = true;
  const { a, b } = dewTextures();
  const run = async () => {
    const slice = async (gen) => {
      let t0 = performance.now();
      for (const _ of gen) {                                  // eslint-disable-line no-unused-vars
        if (performance.now() - t0 > 3) { await new Promise((r) => setTimeout(r, 0)); t0 = performance.now(); }
      }
    };
    const sa = DEW.sizeA, fa = new Float32Array(sa * sa), ha = new Float32Array(sa * sa);
    await slice(worleyPlane(fa, sa, DEW.cellsA, 11));
    await slice(perlinPlane(ha, sa, DEW.hazeCells, 5));
    for (let i = 0; i < fa.length; i++) { a.image.data[i * 2] = toHalf(fa[i]); a.image.data[i * 2 + 1] = toHalf(ha[i]); }
    a.needsUpdate = true;
    const sb = DEW.sizeB, fb = new Float32Array(sb * sb);
    await slice(worleyPlane(fb, sb, DEW.cellsB, 23));
    for (let i = 0; i < fb.length; i++) b.image.data[i] = toHalf(fb[i]);
    b.needsUpdate = true;
  };
  run().catch((e) => { baking = false; console.warn('Dew baking failed', e); });
}
