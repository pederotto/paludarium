// How far the ground rises across a face (pure: a height function, no scene). A surface walker (skink, crab, newt: sim/surfaces.js CLIMB)
// steps onto a face whose rise is within its step limit, so a steep-looking rock that is low is not a cliff to it; a taller one is.
// faceRise = max - min of the height function h(x, z) over the centre and the eight points on a ring of radius r (cm) round (x, z).
export const FACE_R = 2.5;
const RING = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
export function faceRise(h, x, z, r = FACE_R) {
  let lo = h(x, z), hi = lo;
  for (const [dx, dz] of RING) { const v = h(x + dx * r, z + dz * r); if (v < lo) lo = v; if (v > hi) hi = v; }
  return hi - lo;
}
// A cell is a cliff for a surface walker only if the ground is steeper than 60 degrees (grad2 > 3) AND the face rises more than `up`.
export const isCliff = (grad2, rise, up) => grad2 > 3 && rise > up;
