// Runtime skinning for the near level of detail of scanned vertebrates (docs/SKELETON.md "Runtime"): bones posed each frame on the
// CPU (skeleton.js), one row of a shared float texture an instance, and the creature vertex shader blending four bones a vertex
// (render/creatures/instanced.js, `skin`). Far instances keep the vertex rig.
//
//   texture   64 texels a row (21 bones x 3 texels: rows of an affine [R | t]), SKIN_ROWS rows shared by every skinned mesh; each
//             mesh holds a run of rows (one an instance it may skin, `cap`), and an instance's row rides in its anim.y (which the
//             rig uses for the body wave or the turning mix: the bones carry both). Uploaded once a frame when anything changed.
//   vertex    the bake's binding (`_SKIN`: bone 0, bone 1, w0, w1; `_SKINX`: bone 2, bone 3, w2, w3; tools/rig/skeleton.mjs skinFour)
//             beside the rig attribute in ONE interleaved buffer (rig, skin = b0 b1 w0 w1, skin2 = b2 b3 w2 w3), so the pipeline keeps
//             to WebGPU's 8 vertex buffers. A file without `_SKINX` (two bones) draws as before: b1 at 1 - w0, b2/b3 at 0.
//   switch    SKIN.on: off with ?noskin, on the Low preset and on weak GPUs (engine/gfx.js); the near instances then draw with the
//             rig on the fine mesh, as before. SKIN.swim (a frog's swimming body, a handful of instances at most): off only with
//             ?noskin.
import * as THREE from 'three/webgpu';
import { attribute, textureLoad, ivec2, int, vec3, vec4, dot, normalize } from 'three/tsl';
import { ROW_TEXELS, ROW_FLOATS, RowAllocator } from './skeleton.js';

// on: near vertebrates drawn by their bones; swim: a frog's swimming body drawn by its stroke (at any distance: without its bones it
// is one frozen pose); cap: rows a species' mesh may hold (more of it near the camera draw with the rig)
export const SKIN = { on: true, swim: true, cap: 8, strokes: 6 };       // (strokes: rows a swimming body's mesh holds)
// Instances skinned at once in the whole scene (rows of the bone texture, 1 KB each). A frog species holds two runs: its sitting
// body's (SKIN.cap) and its swimming body's (SKIN.strokes: it swims and leaps in that one), so a tank with every frog and morph
// needs about 150; when the rows ran out (64 once) the last species to arrive swam as a frozen pose.
export const SKIN_ROWS = 192;

export const boneData = new Float32Array(ROW_FLOATS * SKIN_ROWS);
export const boneTexture = new THREE.DataTexture(boneData, ROW_TEXELS, SKIN_ROWS, THREE.RGBAFormat, THREE.FloatType);
boneTexture.minFilter = boneTexture.magFilter = THREE.NearestFilter;
boneTexture.generateMipmaps = false;
boneTexture.needsUpdate = true;
export const rows = new RowAllocator(SKIN_ROWS);

// Skinned meshes alive (for the probe tools/steps/skin-perf.mjs: window.__skin.drawn).
export const live = new Set();
if (typeof window !== 'undefined') window.__skin = { get drawn() { let s = 0; for (const m of live) s += m.n; return s; }, SKIN };

// The fine mesh's geometry with the rig and the skin binding in one interleaved buffer (cached per source geometry).
const SKIN_GEO = new WeakMap();
export function skinGeometry(geo) {
  if (SKIN_GEO.has(geo)) return SKIN_GEO.get(geo);
  const rig = geo.attributes.rig, sk = geo.attributes.skin, sx = geo.attributes._skinx, n = rig.count, S = 12, arr = new Float32Array(n * S);
  for (let i = 0; i < n; i++) {
    const o = i * S, w0 = sk.getZ(i), w2 = sx ? sx.getZ(i) : 0, w3 = sx ? sx.getW(i) : 0, w1 = Math.max(0, 1 - w0 - w2 - w3);   // (glb.js keeps x y z of _SKIN)
    arr[o] = rig.getX(i); arr[o + 1] = rig.getY(i); arr[o + 2] = rig.getZ(i); arr[o + 3] = rig.getW(i);
    arr[o + 4] = sk.getX(i); arr[o + 5] = sk.getY(i); arr[o + 6] = w0; arr[o + 7] = w1;
    arr[o + 8] = sx ? Math.round(sx.getX(i) * 32) : sk.getX(i); arr[o + 9] = sx ? Math.round(sx.getY(i) * 32) : sk.getX(i);
    arr[o + 10] = w2; arr[o + 11] = w3;
  }
  const ib = new THREE.InterleavedBuffer(arr, S);
  const g = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(geo.attributes)) if (k !== 'rig' && k !== 'skin' && k !== '_skinx') g.setAttribute(k, a);
  g.setAttribute('rig', new THREE.InterleavedBufferAttribute(ib, 4, 0));
  g.setAttribute('skin', new THREE.InterleavedBufferAttribute(ib, 4, 4));
  g.setAttribute('skin2', new THREE.InterleavedBufferAttribute(ib, 4, 8));
  g.setIndex(geo.index);
  g.boundingBox = geo.boundingBox;
  g.userData = geo.userData;
  SKIN_GEO.set(geo, g);
  return g;
}

// The skinned position and normal of a vertex (nodes, vertex stage): `p` and `n` in the rest pose (after the rig's breathing,
// throat and eyes), the instance's row in anim.y.
export function skinVertex(p, n) {
  const sk = attribute('skin', 'vec4'), s2 = attribute('skin2', 'vec4'), row = int(attribute('iAnim', 'vec4').y);
  const b = [sk.x, sk.y, s2.x, s2.y].map((x) => int(x).mul(3)), w = [sk.z, sk.w, s2.z, s2.w];
  const r = (k) => b.map((bi, j) => textureLoad(boneTexture, ivec2(bi.add(k), row)).mul(w[j])).reduce((a, c) => a.add(c));
  const r0 = r(0).toVar(), r1 = r(1).toVar(), r2 = r(2).toVar();
  const p1 = vec4(p, 1);
  return {
    pos: vec3(dot(r0, p1), dot(r1, p1), dot(r2, p1)),
    nrm: normalize(vec3(dot(r0.xyz, n), dot(r1.xyz, n), dot(r2.xyz, n))),
  };
}
