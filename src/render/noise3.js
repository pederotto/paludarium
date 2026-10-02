// Gradient noise for materials, read from a baked volume instead of computed per fragment.
//
// mx_noise_float (MaterialX Perlin noise) costs a few dozen operations and eight hashed gradients each time a fragment
// evaluates it, and the ground, the rocks and wood, the plants, the animals' skin and the water evaluated it 3 to 6 times
// per fragment: a large part of the frame on a weak GPU (docs/DESIGN.md, Performance notes). The noise never changes, so it
// is baked once (util/noise.js perlinVolume, the same gradients, fade and scale) into a small tileable 3D texture, and
// noise3(p) is one filtered read of it. Same argument, same range as mx_noise_float: a drop-in replacement.
//
//   64^3 half floats (512 kB), 8 lattice cells to a period: 8 texels per cell, trilinear. The pattern repeats every 8 units
//   of the argument (8 cm at a frequency of 1 a cm), far wider than any of the uses' features.

import * as THREE from 'three/webgpu';
import { texture3D, float } from 'three/tsl';
import { perlinVolume, toHalf } from '../util/noise.js';

const SIZE = 64, CELLS = 8;
let tex = null;

function bake() {
  const f = new Float32Array(SIZE * SIZE * SIZE);
  for (const _ of perlinVolume(f, SIZE, CELLS, 7)) { /* all at once: about 30 ms */ }
  const h = new Uint16Array(f.length);
  for (let i = 0; i < f.length; i++) h[i] = toHalf(f[i]);
  const t = new THREE.Data3DTexture(h, SIZE, SIZE, SIZE);
  t.format = THREE.RedFormat;
  t.type = THREE.HalfFloatType;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}

export function noiseVolume() { return (tex ??= bake()); }

// Perlin noise at p (a vec3 node), about -1..1 like mx_noise_float.
export function noise3(p) {
  return texture3D(noiseVolume(), p.mul(float(1 / CELLS))).r;
}
