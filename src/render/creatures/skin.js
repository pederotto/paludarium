// Runtime skinning for the near level of detail of scanned vertebrates (docs/SKELETON.md "Runtime"): bones posed each frame on the
// CPU (skeleton.js), one row of a shared float texture an instance, and the creature vertex shader blending two bones a vertex
// (render/creatures/instanced.js, `skin`). Far instances keep the vertex rig.
//
//   texture   64 texels a row (21 bones x 3 texels: rows of an affine [R | t]), SKIN_ROWS rows shared by every skinned mesh; each
//             mesh holds a run of rows (one an instance it may skin, `cap`), and an instance's row rides in its anim.y (which the
//             rig uses for the body wave or the turning mix: the bones carry both). Uploaded once a frame when anything changed.
//   vertex    the bake's binding (`_SKIN`: bone 0, bone 1, bone 0's weight) beside the rig attribute in ONE interleaved buffer, so
//             the pipeline keeps to WebGPU's 8 vertex buffers.
//   switch    SKIN.on: off with ?noskin, on the Low preset and on weak GPUs (engine/gfx.js); the near instances then draw with the
//             rig on the fine mesh, as before. SKIN.swim (a frog's swimming body, a handful of instances at most): off only with
//             ?noskin.
import * as THREE from 'three/webgpu';
import { attribute, textureLoad, ivec2, int, vec3, vec4, dot, normalize } from 'three/tsl';
import { ROW_TEXELS, ROW_FLOATS, RowAllocator } from './skeleton.js';

// on: near vertebrates drawn by their bones; swim: a frog's swimming body drawn by its stroke (at any distance: without its bones it
// is one frozen pose); cap: rows a species' mesh may hold (more of it near the camera draw with the rig)
export const SKIN = { on: true, swim: true, cap: 8 };
export const SKIN_ROWS = 64;          // instances skinned at once in the whole scene (64 KB of texture)

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
  const rig = geo.attributes.rig, sk = geo.attributes.skin, n = rig.count, arr = new Float32Array(n * 8);
  for (let i = 0; i < n; i++) {
    arr[i * 8] = rig.getX(i); arr[i * 8 + 1] = rig.getY(i); arr[i * 8 + 2] = rig.getZ(i); arr[i * 8 + 3] = rig.getW(i);
    arr[i * 8 + 4] = sk.getX(i); arr[i * 8 + 5] = sk.getY(i); arr[i * 8 + 6] = sk.getZ(i);
  }
  const ib = new THREE.InterleavedBuffer(arr, 8);
  const g = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(geo.attributes)) if (k !== 'rig' && k !== 'skin') g.setAttribute(k, a);
  g.setAttribute('rig', new THREE.InterleavedBufferAttribute(ib, 4, 0));
  g.setAttribute('skin', new THREE.InterleavedBufferAttribute(ib, 4, 4));
  g.setIndex(geo.index);
  g.boundingBox = geo.boundingBox;
  g.userData = geo.userData;
  SKIN_GEO.set(geo, g);
  return g;
}

// The skinned position and normal of a vertex (nodes, vertex stage): `p` and `n` in the rest pose (after the rig's breathing,
// throat and eyes), the instance's row in anim.y.
export function skinVertex(p, n) {
  const sk = attribute('skin', 'vec4'), row = int(attribute('iAnim', 'vec4').y);
  const b0 = int(sk.x).mul(3), b1 = int(sk.y).mul(3), w0 = sk.z, w1 = sk.z.oneMinus();
  const r = (k) => textureLoad(boneTexture, ivec2(b0.add(k), row)).mul(w0).add(textureLoad(boneTexture, ivec2(b1.add(k), row)).mul(w1));
  const r0 = r(0).toVar(), r1 = r(1).toVar(), r2 = r(2).toVar();
  const p1 = vec4(p, 1);
  return {
    pos: vec3(dot(r0, p1), dot(r1, p1), dot(r2, p1)),
    nrm: normalize(vec3(dot(r0.xyz, n), dot(r1.xyz, n), dot(r2.xyz, n))),
  };
}
