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

import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const base = new URL(`${import.meta.env.BASE_URL}assets/creatures/`, location.href);
let manifestPromise = null;

export function loadManifest() {
  manifestPromise ??= fetch(new URL('manifest.json', base)).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  return manifestPromise;
}

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

const matIdFor = (name = '') => (/eye/i.test(name) ? 1 : /fin|gill|wing/i.test(name) ? 2 : /glass|shell|carapace/i.test(name) ? 4 : 0);

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
    for (const k of ['position', 'normal', 'uv', 'color']) {
      const a = g.attributes[k];
      if (!a || a.array instanceof Float32Array) continue;
      const f = new Float32Array(a.count * a.itemSize);
      for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) f[i * a.itemSize + c] = a.getComponent(i, c);
      g.setAttribute(k, new THREE.BufferAttribute(f, a.itemSize));
    }
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(sc, new THREE.Matrix4().multiplyMatrices(rot, o.matrixWorld)));
    // Keep only what the shader uses; a missing uv becomes zeros so parts can merge.
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
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

// Derive the animation rig from the shape (see the header).
export function addRig(geo, { legs = false, xFrac = 0.32, yFrac = 0.62 } = {}) {
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
    const rigOpt = { legs: !!meta.legs, xFrac: meta.xFrac, yFrac: meta.yFrac };
    const hi = await geometryFrom(new URL(meta.file, base).href, opt);
    const lo = meta.lo ? await geometryFrom(new URL(meta.lo, base).href, opt) : hi;
    addRig(hi.geo, rigOpt);
    if (lo !== hi) addRig(lo.geo, rigOpt);
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
