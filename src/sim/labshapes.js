// Exact-size obstacles for the test lab, as numbers: a shape edits the height of the ground (cm) under its footprint, so every animal
// meets it as it meets real ground (heightAt, cliffs, slopes). Pure: no scene, the unit tests run it under Node (tests/labshapes.test.mjs).
//
// A shape is { kind, x, z, w, d, h, rot }: centre (x, z), w along its own x axis and d along its own z (cm), h the height or depth
// (cm), rot the turn about the vertical (radians). Kinds:
//   step, wall, post   a raised block (a wall and a post are just thin ones: the lab offers sensible sizes)
//   ramp               rises along its x axis from 0 to h over w, then drops at the top edge
//   trench             lowers the ground by h (never below FLOOR_MIN)
//   mound              a hill, an ellipse w x d across, h high in the middle

export const KINDS = { step: 'Step', wall: 'Wall', post: 'Post', ramp: 'Ramp', trench: 'Trench', mound: 'Mound' };
export const EDGE = 0.8;         // cm over which a block's side rises: the ground is a grid, so a face cannot be steeper than about one cell
export const FLOOR_MIN = 0.3;    // cm: a trench leaves at least this much ground

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// The point in the shape's own frame.
export function local(s, x, z) {
  const dx = x - s.x, dz = z - s.z, c = Math.cos(s.rot ?? 0), n = Math.sin(s.rot ?? 0);
  return [dx * c - dz * n, dx * n + dz * c];
}

// How much of the shape's height is at (x, z): 0 outside, 1 on a block's top, in between on its side.
export function maskAt(s, x, z) {
  const [lx, lz] = local(s, x, z);
  if (s.kind === 'mound') {
    const r = Math.hypot(lx / (s.w / 2), lz / (s.d / 2));
    return r >= 1 ? 0 : 0.5 * (1 + Math.cos(Math.PI * r));
  }
  const qx = Math.abs(lx) - s.w / 2, qz = Math.abs(lz) - s.d / 2;
  const out = Math.hypot(Math.max(qx, 0), Math.max(qz, 0));
  const edge = clamp01(1 - out / EDGE);
  if (s.kind === 'ramp') return clamp01((lx + s.w / 2) / s.w) * edge;
  return edge;
}

// The ground height at (x, z) once `shapes` are applied, in order, to a ground that is `g` cm high there.
export function heightAfter(g, shapes, x, z) {
  let h = g;
  for (const s of shapes) {
    const m = maskAt(s, x, z);
    if (m <= 0) continue;
    if (s.kind === 'trench') h = Math.min(h, Math.max(FLOOR_MIN, g - s.h * m));
    else h = Math.max(h, g + s.h * m);
  }
  return h;
}

// Sensible starting sizes for each kind (cm): what the panel offers before anyone touches a slider.
export const DEFAULTS = {
  step: { w: 14, d: 14, h: 3 },
  wall: { w: 30, d: 2, h: 6 },
  post: { w: 2.5, d: 2.5, h: 8 },
  ramp: { w: 18, d: 12, h: 5 },
  trench: { w: 30, d: 4, h: 2 },
  mound: { w: 20, d: 20, h: 5 },
};
