// Pure placement maths (no three.js, so it runs under Node: tests/placement.test.mjs).
//
// World units are centimetres; the tank sits on the origin (see tank.js): x in [-w/2, w/2],
// z in [-d/2, d/2], y in [0, h]. `tank` is any { w, d, h }.

export const GLASS_MARGIN = 0.4;     // a piece stops this far inside the glass
export const LID_GAP = 1;

const clampN = (v, a, b) => Math.min(b, Math.max(a, v));

// A sparse set of the vertices of a mesh that is good enough to bound it after any rotation:
// the extremes in 13 directions plus an even stride through the rest. positions: flat xyz array.
export function hullPoints(positions, max = 8000) {
  const n = Math.floor(positions.length / 3);
  const dirs = [];
  for (const a of [-1, 0, 1]) for (const b of [-1, 0, 1]) for (const c of [-1, 0, 1]) if (a || b || c) dirs.push([a, b, c]);
  const best = dirs.map(() => -Infinity), at = dirs.map(() => 0);
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    for (let k = 0; k < dirs.length; k++) {
      const d = dirs[k][0] * x + dirs[k][1] * y + dirs[k][2] * z;
      if (d > best[k]) { best[k] = d; at[k] = i; }
    }
  }
  const pick = new Set(at);
  const stride = Math.max(1, Math.ceil(n / max));
  for (let i = 0; i < n; i += stride) pick.add(i);
  const out = new Float32Array(pick.size * 3);
  let o = 0;
  for (const i of pick) { out[o++] = positions[i * 3]; out[o++] = positions[i * 3 + 1]; out[o++] = positions[i * 3 + 2]; }
  return out;
}

// World-space axis-aligned box of `points` after the column-major 4x4 matrix `e` (three's
// Matrix4.elements). Scale, rotation (and flips, which are negative scales) are all included.
export function transformedBox(points, e) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < points.length; i += 3) {
    const x = points[i], y = points[i + 1], z = points[i + 2];
    const p0 = e[0] * x + e[4] * y + e[8] * z + e[12];
    const p1 = e[1] * x + e[5] * y + e[9] * z + e[13];
    const p2 = e[2] * x + e[6] * y + e[10] * z + e[14];
    if (p0 < min[0]) min[0] = p0; if (p0 > max[0]) max[0] = p0;
    if (p1 < min[1]) min[1] = p1; if (p1 > max[1]) max[1] = p1;
    if (p2 < min[2]) min[2] = p2; if (p2 > max[2]) max[2] = p2;
  }
  return { min, max };
}

function shift1(lo, hi, a, b) {
  if (b - a >= hi - lo) return (lo + hi) / 2 - (a + b) / 2;     // wider than the tank: centre it
  if (a < lo) return lo - a;
  if (b > hi) return hi - b;
  return 0;
}

// How far to move a box so that it lies inside the glass: [dx, dy, dz]. The floor is y = 0 (a
// piece may sink into the substrate but not through the glass base); the top keeps a small gap
// to the lid when the piece fits under it, and otherwise only the floor is enforced.
export function boxShift(box, tank, margin = GLASS_MARGIN) {
  const dx = shift1(-tank.w / 2 + margin, tank.w / 2 - margin, box.min[0], box.max[0]);
  const dz = shift1(-tank.d / 2 + margin, tank.d / 2 - margin, box.min[2], box.max[2]);
  let dy = 0;
  if (box.min[1] < 0) dy = -box.min[1];
  else if (box.max[1] > tank.h - LID_GAP) dy = -Math.min(box.max[1] - (tank.h - LID_GAP), box.min[1]);
  return [dx, dy, dz];
}

// Is the box inside the glass (within `eps`)?
export function boxInside(box, tank, eps = 1e-6) {
  return box.min[0] >= -tank.w / 2 - eps && box.max[0] <= tank.w / 2 + eps
    && box.min[2] >= -tank.d / 2 - eps && box.max[2] <= tank.d / 2 + eps && box.min[1] >= -eps;
}

// --- Plants ----------------------------------------------------------------------------------
// A plant whose canopy reaches `reach` cm sideways from its stem. The stem is kept at least
// 0.8 x reach from the glass (never more than a third of the tank), and what still overhangs
// is removed by leaning the plant inward: a plant tilted by t has its canopy reach*cos(t)
// towards the wall. Returns the clamped position and the lean (angle in radians, and the
// horizontal unit direction (dx, dz) it leans towards, pointing away from the wall).
export function plantFit(x, z, reach, tank, { clampZ = true } = {}) {
  const R = Math.min(reach, Math.min(tank.w, tank.d) / 3);
  const m = Math.max(0.4, R * 0.8);
  const nx = clampN(x, -tank.w / 2 + m, tank.w / 2 - m);
  const nz = clampZ ? clampN(z, -tank.d / 2 + m, tank.d / 2 - m) : z;
  // Distances to the four walls and the lean needed against each.
  const walls = [[nx + tank.w / 2, 1, 0], [tank.w / 2 - nx, -1, 0]];
  if (clampZ) walls.push([nz + tank.d / 2, 0, 1], [tank.d / 2 - nz, 0, -1]);
  let lx = 0, lz = 0;
  for (const [dist, ix, iz] of walls) {
    if (dist >= R) continue;
    const t = Math.acos(clampN(Math.max(0, dist - 0.2) / R, 0, 1));
    lx += ix * t; lz += iz * t;
  }
  const angle = Math.hypot(lx, lz);
  return { x: nx, z: nz, lean: Math.min(angle, 0.75), dx: angle > 1e-6 ? lx / angle : 0, dz: angle > 1e-6 ? lz / angle : 0 };
}

// --- Face placement (cliffs) ---------------------------------------------------------------------
// The nearest of the back wall and the two side walls to (x, z): the inward normal and the
// distance to the glass.
export function nearestWall(x, z, tank) {
  const c = [
    { wall: 'back', n: [0, 0, 1], dist: z + tank.d / 2 },
    { wall: 'left', n: [1, 0, 0], dist: x + tank.w / 2 },
    { wall: 'right', n: [-1, 0, 0], dist: tank.w / 2 - x },
  ];
  c.sort((a, b) => a.dist - b.dist);
  return c[0];
}

// Quaternion [x, y, z, w] that turns local +z onto the unit normal n and keeps local +y as
// close to world up as it can (no roll).
export function faceQuat(n) {
  let zx = n[0], zy = n[1], zz = n[2];
  const zl = Math.hypot(zx, zy, zz) || 1; zx /= zl; zy /= zl; zz /= zl;
  // x = up cross z
  let xx = zz, xy = 0, xz = -zx;
  let xl = Math.hypot(xx, xz);
  if (xl < 1e-5) { xx = 1; xz = 0; xl = 1; }       // looking straight up or down
  xx /= xl; xz /= xl;
  // y = z cross x
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  // rotation matrix columns (x, y, z) to quaternion
  const m00 = xx, m10 = xy, m20 = xz, m01 = yx, m11 = yy, m21 = yz, m02 = zx, m12 = zy, m22 = zz;
  const tr = m00 + m11 + m22;
  let qx, qy, qz, qw;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    qw = s / 4; qx = (m21 - m12) / s; qy = (m02 - m20) / s; qz = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    qw = (m21 - m12) / s; qx = s / 4; qy = (m01 + m10) / s; qz = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    qw = (m02 - m20) / s; qx = (m01 + m10) / s; qy = s / 4; qz = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    qw = (m10 - m01) / s; qx = (m02 + m20) / s; qy = (m12 + m21) / s; qz = s / 4;
  }
  return [qx, qy, qz, qw];
}

// The depth (cm) a face piece sinks into the surface behind it.
export const FACE_EMBED = 2;

// Where the piece origin goes so that its back plane (at local z = backZ, scaled by the
// thickness `back` = distance from the origin to the back plane, positive) lies `embed` cm
// inside the surface at `anchor`, with the piece standing out along the normal n.
export function faceOrigin(anchor, n, back, embed = FACE_EMBED) {
  const d = back - embed;
  return [anchor[0] + n[0] * d, anchor[1] + n[1] * d, anchor[2] + n[2] * d];
}

// A face is a slope when the ground normal tilts this far from the vertical.
export const SLOPE_NORMAL_Y = 0.78;

// --- Variety ---------------------------------------------------------------------------------------

function seeded(seed) {
  let a = (seed >>> 0) || 1;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Per-piece colour tints (multipliers on the stone/wood texture). Index 0 is untinted.
export const TINTS = [[1, 1, 1], [1.12, 1.04, 0.92], [0.88, 0.95, 1.08], [0.76, 0.77, 0.8], [1.16, 1.14, 1.08], [0.93, 1.08, 0.88], [1.06, 0.9, 0.84]];

// How many procedural variants are appended after the scanned models of each type, and which
// variants read as "round" boulders (the scanned set 1 rocks are big and flat).
export const PROC = { boulder: 4, spire: 3, stump: 3, cliff: 3, roots: 2, wood: 3 };

// One seeded roll of everything that makes a piece look different from the next:
// { variant, scale: [sx, sy, sz], flip, tint, rot }. Pure given (type, seed, count).
export function rollLook(type, seed, count, pool = null) {
  const r = seeded(seed);
  const v = r(), a = r(), b = r(), c = r(), f = r(), t = r(), yaw = r(), t0 = r();
  const ids = pool?.length ? pool : null;
  const variant = ids ? ids[Math.floor(v * ids.length) % ids.length] : Math.floor(v * Math.max(1, count));
  const sx = 0.82 + a * 0.4, sy = 0.86 + b * 0.32, sz = 0.82 + c * 0.4;
  const tint = t0 < 0.3 ? 0 : 1 + Math.floor(t * (TINTS.length - 1));
  return { variant, scale: [sx, sy, sz], flip: f < 0.5, tint: Math.min(tint, TINTS.length - 1), rot: yaw * Math.PI * 2 };
}

