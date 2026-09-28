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
};
