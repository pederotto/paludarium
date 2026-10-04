// Shader uniforms shared by every material (kept in their own module so the
// shader and water modules can both import them without a cycle).

import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';

export const U = {
  waterLevel: uniform(14),
  daylight: uniform(1),         // 0 night … 1 full light
  caustics: uniform(1),         // strength
  tint: uniform(new THREE.Color(0.3, 0.62, 0.62)),
  mist: uniform(0.3),           // 0 … 1, drives fog and haze
  turbidity: uniform(0),        // 0 clear … 1 green or cloudy water
  algaeFilm: uniform(0),        // 0 … 1, film on submerged surfaces and glass
  algaeColor: uniform(new THREE.Color(0.18, 0.3, 0.08)),
  condense: uniform(0),         // 0 … 1, dew on the glass (dew point above the glass temperature)
  mold: uniform(0),             // 0 … 1, white mould on wood and stone in stale, wet air
  creatureWater: uniform(0.3), // 0 … 1: how much of the water's colour absorption animals get (1 = same as the sand)
  plantWater: uniform(0.42),   // 0 … 1: how much of the water's colour absorption plants get (1 = same as the sand); tuned by eye
  rockMoss: uniform(1),         // 0 bare … 1 mossy: how far moss has grown over the hardscape
  surfaceDetail: uniform(1),    // 0 on the Low preset: rock skips its relief, cracks and grain (engine/gfx.js build; a branch, no new shader)
  backdrop: uniform(0),         // 0 the painted relief … 1 black expanding foam dusted with coir (Env.backdrop)
  focus: uniform(new THREE.Vector4(0, 0, 0, 0)),   // a followed animal: xyz its position, w the radius of the see-through (0 off)
};

// The ground's chemistry for the soil shader (sim/humus.js writes it): R humus, G leaf litter, B fertility,
// over the whole floor (u = x / width + 0.5, v = z / depth + 0.5).
const SOIL_W = 64, SOIL_H = 32;
const soilData = new Uint8Array(SOIL_W * SOIL_H * 4);
export const SOIL = { tex: new THREE.DataTexture(soilData, SOIL_W, SOIL_H, THREE.RGBAFormat) };
SOIL.tex.minFilter = SOIL.tex.magFilter = THREE.LinearFilter;
SOIL.tex.wrapS = SOIL.tex.wrapT = THREE.ClampToEdgeWrapping;
SOIL.tex.needsUpdate = true;
