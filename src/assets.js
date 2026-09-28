// Loads the textures and models in assets/ (see CREDITS.md: Poly Haven CC0,
// SeedThree MIT). Everything still renders while they stream in.

import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new THREE.TextureLoader();
const base = new URL('../assets/', import.meta.url);

function load(path, { srgb = true, repeat = true } = {}) {
  const t = loader.load(new URL(path, base).href);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
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
  cards: {
    fern: load('cards/fern.png', { repeat: false }),
    cattail: load('cards/cattail.png', { repeat: false }),
    grassTuft: load('cards/grass_tuft.png', { repeat: false }),
    bilberry: load('cards/bilberry.png', { repeat: false }),
  },
};

// glTF models (Poly Haven), loaded once and shared.
const gltf = new GLTFLoader();
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
