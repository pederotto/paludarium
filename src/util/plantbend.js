// How a submerged plant leans in the water's push (B5b). Pure numbers: the plant shader (render/shaders.js plantMaterial) repeats
// this formula in TSL and imports the same constants, render/airflow.js `plantFlow` feeds it each plant's flow, and
// tests/plantbend.test.mjs pins it.
//
// Lengths come out in units of the plant's `reach` (how far the tip of the species goes at full lean, in its own units); the
// shader multiplies them by it.
//   lean   = BEND_MAX * tanh(ATANH_HALF * speed / (V50 * stiffness)) * height01^2
//   the lean is along the flow; the tip (height01 = 1) trails the most, the root (0) does not move, and a stiffer plant
//   (stiffness > 1) leans less in the same flow. `sag`: a blade that bends keeps its length, so its tip comes down by lean^2 / 2.

export const BEND_MAX = 1;        // the most a tip can lean, in reach units (at any speed)
export const V50 = 4;             // cm/s: the water speed that leans a stiffness-1 plant's tip half of BEND_MAX (a gentle stream)
export const ATANH_HALF = Math.atanh(0.5);

// flowX, flowZ: the water's push (only its direction counts; no direction, no lean). speed: cm/s. height01: 0 at the root,
// 1 at the tip of the leaf (the shader's `sway` attribute). stiffness: 1 an average aquatic leaf, 0.3 limp, 3 a stiff sword.
export function plantBend(flowX, flowZ, speed, height01, stiffness = 1, out = { x: 0, z: 0, sag: 0 }) {
  const len = Math.hypot(flowX, flowZ);
  out.x = out.z = out.sag = 0;
  if (!(len > 1e-9) || !(speed > 0)) return out;
  const h = Math.min(1, Math.max(0, height01));
  const lean = BEND_MAX * Math.tanh(ATANH_HALF * speed / (V50 * Math.max(0.05, stiffness))) * h * h;
  out.x = flowX / len * lean;
  out.z = flowZ / len * lean;
  out.sag = lean * lean * 0.5;
  return out;
}

// The water's flow (wx, wz in the tank's frame) in the frame of a plant whose instance rotation is the quaternion q
// ({ x, y, z, w }): the shader's offsets are made before the instance matrix turns the plant, so they must be given in the
// plant's own axes. Returns [x, z] in `out`; the length is kept for a plant that stands upright.
export function localFlow(q, wx, wz, out = [0, 0]) {
  // v' = q^-1 v q for v = (wx, 0, wz): the conjugate has the vector part -q.
  const ux = -q.x, uy = -q.y, uz = -q.z, w = q.w;
  const cx = uy * wz, cy = uz * wx - ux * wz, cz = -uy * wx;                  // u x v
  const dx = uy * cz - uz * cy, dz = ux * cy - uy * cx;                       // u x (u x v), x and z parts
  out[0] = wx + 2 * (w * cx + dx);
  out[1] = wz + 2 * (w * cz + dz);
  return out;
}
