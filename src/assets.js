// Loads the textures in assets/ (imported from SeedThree, MIT; see CREDITS.md).
// Everything still renders while they stream in, just untextured for a moment.

import * as THREE from 'three/webgpu';

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
    load('ground/soil.jpg'),
    load('ground/soil.jpg'),
    load('ground/gravel.jpg'),
    load('ground/rock.jpg'),
    load('ground/moss.jpg'),
    load('ground/bark.jpg'),
  ],
  mossyRock: load('ground/mossy_rock.jpg'),
  rockNormal: load('ground/rock_normal.jpg', { srgb: false }),
  cards: {
    fern: load('cards/fern.png', { repeat: false }),
    cattail: load('cards/cattail.png', { repeat: false }),
    grassTuft: load('cards/grass_tuft.png', { repeat: false }),
    bilberry: load('cards/bilberry.png', { repeat: false }),
  },
};
