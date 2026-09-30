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
  rockMoss: uniform(1),         // 0 bare … 1 mossy: how far moss has grown over the hardscape
};
