// Textured creature models from .glb files (generated or scanned), used in
// place of the procedural bodies when a file is present.
//
// Files live in public/assets/creatures/ and are listed in manifest.json (written
// by tools/import-creatures.mjs):  { "dartfrog": { "file": "dartfrog.glb", "lo": "dartfrog.lo.glb", "legs": true } }
//
// The animation shader needs a `rig` attribute per vertex (spine position, which
// leg, how far down the leg); models come without one, so it is derived from the
// shape: the spine from the position along z (head at +z), legs from the parts of
// a standing/sitting animal that stick out sideways from the body, split into
// front/back at the middle and left/right by the sign of x. Meshes may name their
// materials "eye" or "fin"/"gill" to get the eye and membrane shading.
//
// A model baked with its rig (tools/bake-creature.mjs jobs with `rig`, e.g. the vampire crab: claws, eight legs) carries
// it as a `_RIG` attribute: spine, leg / 8 (or / meta.rigLeg), legT, material id / 8, quantised to 0 … 1. It is used as it is.

import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// The vertex attributes a creature model keeps (everything else in the file is dropped): the bake's rig, skin binding (two and four
// bones a vertex) and muscle binding. tests/glb-keep.test.mjs checks every attribute the bakes write is here.
export const KEEP = ['position', 'normal', 'uv', 'color', '_rig', '_skin', '_skinx', '_musc', '_musu'];

const base = new URL(`${import.meta.env.BASE_URL}assets/creatures/`, location.href);
let manifestPromise = null;

export function loadManifest() {
  manifestPromise ??= fetch(new URL('manifest.json', base)).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  return manifestPromise;
}

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

// ("eye" as a word or after a separator: the red-eyed tree frog's body material is called "redeye" and was taken for an eye, which
// left the model without a body texture and the game drawing the procedural stand-in instead of the scan)
const matIdFor = (name = '') => (/(^|[^a-z])eye/i.test(name) ? 1 : /fin|gill|wing/i.test(name) ? 2 : /glass|shell|carapace/i.test(name) ? 4 : 0);

// Merge every mesh of a glTF scene into one geometry in centimetres, with a
// per-vertex material id in `matId` (temporary, moved into rig.w by addRig).
async function geometryFrom(url, { rotY = 0, scale = 1 } = {}) {
  const gltf = await loader.loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  const parts = [];
  let body = null;
  const rot = new THREE.Matrix4().makeRotationY(THREE.MathUtils.degToRad(rotY));
  const sc = new THREE.Matrix4().makeScale(100 * scale, 100 * scale, 100 * scale);
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    let g = o.geometry.clone();
    // Meshopt/quantised files store positions as normalised integers: make them real floats before scaling.
    // (three.js names custom attributes in lower case: _SKINX -> _skinx; a name missing here was dropped below, so the game skinned
    // with two bones while the files carried four, 5 Oct; _musc / _musu: the muscle binding, tools/rig/muscles.mjs)
    for (const k of KEEP) {
      const a = g.attributes[k];
      if (!a || a.array instanceof Float32Array) continue;
      const f = new Float32Array(a.count * a.itemSize);
      for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) f[i * a.itemSize + c] = a.getComponent(i, c);
      g.setAttribute(k, new THREE.BufferAttribute(f, a.itemSize));
    }
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(sc, new THREE.Matrix4().multiplyMatrices(rot, o.matrixWorld)));
    // Keep only what the shader uses; a missing uv becomes zeros so parts can merge.
    for (const k of Object.keys(g.attributes)) if (!KEEP.includes(k)) g.deleteAttribute(k);
    if (g.attributes.color && g.attributes.color.itemSize === 4) {   // RGBA: keep RGB
      const c4 = g.attributes.color, c3 = new Float32Array(c4.count * 3);
      for (let i = 0; i < c4.count; i++) { c3[i * 3] = c4.getX(i); c3[i * 3 + 1] = c4.getY(i); c3[i * 3 + 2] = c4.getZ(i); }
      g.setAttribute('color', new THREE.BufferAttribute(c3, 3));
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    const id = matIdFor(mat?.name) || matIdFor(o.name);
    g.setAttribute('matId', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(id), 1));
    parts.push(g);
    if (!body && id === 0 && mat?.map) body = mat;
    body ??= id === 0 ? mat : null;
  });
  if (!parts.length) throw new Error('no meshes in ' + url);
  const same = parts.every((p) => !!p.index === !!parts[0].index);
  const geo = mergeGeometries(same ? parts : parts.map((p) => p.toNonIndexed()), false);
  geo.computeBoundingBox();
  return { geo, material: body };
}

// The baked rig (see the header): leg and material ids back to whole numbers. Leg ids are stored divided by 8, or by the manifest's
// `rigLeg` for a rig with higher ids (a shrimp's pincers, 15 and 16).
function bakedRig(geo, legDiv = 8) {
  const b = geo.attributes._rig, n = b.count, rig = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    rig[i * 4] = b.getX(i); rig[i * 4 + 1] = Math.round(b.getY(i) * legDiv); rig[i * 4 + 2] = b.getZ(i); rig[i * 4 + 3] = Math.round(b.getW(i) * 8);
  }
  geo.setAttribute('rig', new THREE.BufferAttribute(rig, 4));
  geo.deleteAttribute('_rig');
  geo.deleteAttribute('matId');
  // The runtime skin binding of a model with a skeleton (tools/bake-creature.mjs `_SKIN`: bone ids / 32 and the first bone's weight),
  // back to whole bone ids: render/creatures/skin.js.
  const s = geo.attributes._skin;
  if (s) {
    const sk = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { sk[i * 4] = Math.round(s.getX(i) * 32); sk[i * 4 + 1] = Math.round(s.getY(i) * 32); sk[i * 4 + 2] = s.getZ(i); }
    geo.setAttribute('skin', new THREE.BufferAttribute(sk, 4));
    geo.deleteAttribute('_skin');
  }
  return geo;
}

// Derive the animation rig from the shape (see the header).
export function addRig(geo, { legs = false, xFrac = 0.32, yFrac = 0.62, rigLeg = 8 } = {}) {
  if (geo.attributes._rig) return bakedRig(geo, rigLeg);
  const p = geo.attributes.position, n = p.count;
  const bb = geo.boundingBox;
  const zmin = bb.min.z, zmax = bb.max.z, zmid = (zmin + zmax) / 2;
  const hw = Math.max(1e-3, (bb.max.x - bb.min.x) / 2);
  const ymin = bb.min.y, ymax = bb.max.y;
  const matId = geo.attributes.matId;
  const rig = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    rig[i * 4] = Math.max(0, Math.min(1, (zmax - z) / (zmax - zmin)));
    if (legs && Math.abs(x) > xFrac * hw && y < ymin + yFrac * (ymax - ymin)) {
      const front = z > zmid;
      rig[i * 4 + 1] = (front ? 1 : 3) + (x > 0 ? 1 : 0);
      rig[i * 4 + 2] = Math.max(0, Math.min(1, (Math.abs(x) - xFrac * hw) / ((1 - xFrac) * hw)));
    }
    rig[i * 4 + 3] = matId?.getX(i) ?? 0;
  }
  geo.setAttribute('rig', new THREE.BufferAttribute(rig, 4));
  geo.deleteAttribute('matId');
  return geo;
}

// Load one species. Returns { lo, hi, textures } or null when it cannot be loaded.
export async function loadCreatureGLB(id, meta) {
  try {
    const opt = { rotY: meta.rotY ?? 0, scale: meta.scale ?? 1 };
    const rigOpt = { legs: !!meta.legs, xFrac: meta.xFrac, yFrac: meta.yFrac, rigLeg: meta.rigLeg ?? 8 };
    const hi = await geometryFrom(new URL(meta.file, base).href, opt);
    const lo = meta.lo ? await geometryFrom(new URL(meta.lo, base).href, opt) : hi;
    addRig(hi.geo, rigOpt);
    if (lo !== hi) addRig(lo.geo, rigOpt);
    if (meta.skeleton && hi.geo.attributes.skin) hi.geo.userData.skeleton = meta.skeleton;   // (skinned near the camera: skin.js)
    const m = hi.material;
    const tex = (t, srgb) => { if (!t) return null; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.flipY = t.flipY; return t; };
    const textures = { map: tex(m?.map, true), normalMap: tex(m?.normalMap, false), roughnessMap: meta.ignoreRoughMap ? null : tex(m?.roughnessMap, false) };
    const painted = !!hi.geo.attributes.color;                       // painted with vertex colours instead of a texture
    if (!textures.map && !painted) throw new Error('model has no base colour texture or vertex colours');
    return { lo: lo.geo, hi: hi.geo, textures: painted && !textures.map ? null : textures, size: hi.geo.boundingBox.getSize(new THREE.Vector3()) };
  } catch (e) {
    console.warn('creature model failed', id, e.message);
    return null;
  }
}
