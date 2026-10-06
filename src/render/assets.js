// Loads the textures and models in assets/ (see CREDITS.md: Poly Haven CC0,
// SeedThree MIT). Everything still renders while they stream in.

import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const loader = new THREE.TextureLoader();
const base = new URL(`${import.meta.env.BASE_URL}assets/`, location.href);

function load(path, { srgb = true, repeat = true } = {}) {
  const t = loader.load(new URL(path, base).href);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 16;   // the floor is seen at a grazing angle; the renderer clamps to what the GPU allows
  return t;
}

// A texture whose alpha channel is DATA, not transparency (the orchid petal relief): decoded unpremultiplied and flipped at decode, filled in
// when the file arrives like the others.
const bitmapLoader = new THREE.ImageBitmapLoader().setOptions({ imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
function loadData(path) {
  const t = new THREE.Texture();
  t.colorSpace = THREE.NoColorSpace; t.flipY = false; t.generateMipmaps = true; t.anisotropy = 4;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  bitmapLoader.load(new URL(path, base).href, (bmp) => { t.image = bmp; t.needsUpdate = true; }, undefined, (e) => console.warn('texture', path, e));
  return t;
}

export const TEX = {
  // Same order as MATERIALS in config.js.
  ground: [
    load('ground/forest_ground_04.jpg'),
    load('ground/clean_pebbles.jpg'),
    load('ground/gravel.jpg'),
    load('ground/mossy_rock.jpg'),
    load('ground/moss.jpg'),
    load('ground/lichen_rock.jpg'),
  ],
  cliff: load('ground/cliff_side.jpg'),
  cliffNormal: load('ground/cliff_side_normal.jpg', { srgb: false }),
  lichen: load('ground/lichen_rock.jpg'),
  lichenNormal: load('ground/lichen_rock_normal.jpg', { srgb: false }),
  mossyRock: load('ground/mossy_rock.jpg'),
  mossyRockNormal: load('ground/mossy_rock_normal.jpg', { srgb: false }),
  rockNormal: load('ground/rock_normal.jpg', { srgb: false }),
  // Furrowed bark for every wood piece, baked by tools/bake-bark.mjs (the height is in the alpha channel; sim/decor.js barkMaterial).
  bark: load('ground/bark_furrowed.webp'),
  barkNormal: load('ground/bark_furrowed_normal.webp', { srgb: false }),
  // The orchid petal atlas (Blender bake, art-src/orchids/petal_bake.py): R ink, G tone, B glint per tile; render/flowers.js reads it.
  petals: load('orchids/petals.webp', { srgb: false, repeat: false }),
  // and its relief: R,G slopes, B roughness x2, A thickness (petal_relief_bake.py)
  petalsN: loadData('orchids/petals_n.webp'),
  cards: {
    fern: load('cards/fern.png', { repeat: false }),
    cattail: load('cards/cattail.png', { repeat: false }),
    grassTuft: load('cards/grass_tuft.png', { repeat: false }),
    bilberry: load('cards/bilberry.png', { repeat: false }),
  },
};

// A binary file under assets/ as an ArrayBuffer, or null when it cannot be had (the caller draws without it).
export async function loadBinary(path) {
  try { const r = await fetch(new URL(path, base).href); return r.ok ? await r.arrayBuffer() : null; } catch { return null; }
}

// glTF models (Poly Haven), loaded once and shared.
// Meshes are meshopt-compressed and textures WebP (tools/compress-models.mjs): 3.1 MB instead of 5 MB to download.
const gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const cache = new Map();
export function loadModel(name) {
  if (!cache.has(name)) cache.set(name, gltf.loadAsync(new URL(`models/${name}.glb`, base).href));
  return cache.get(name);
}

// Every mesh in a model as { name, geometry, material }, with the model's
// node transforms baked in and converted from metres to centimetres.
export async function modelParts(name) {
  const g = await loadModel(name);
  g.scene.updateMatrixWorld(true);
  const parts = [];
  const cm = new THREE.Matrix4().makeScale(100, 100, 100);
  g.scene.traverse((o) => {
    if (!o.isMesh) return;
    const geo = o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(cm, o.matrixWorld));
    geo.computeBoundingBox();
    parts.push({ name: o.name, geometry: geo, material: o.material });
  });
  return parts;
}
