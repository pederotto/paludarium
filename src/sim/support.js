// Structure that stands: what holds the ground up.
//
// Loose ground can only keep a slope up to its angle of repose, plus a little
// cohesion that lets a short vertical step stand (soil more, sand barely).
// Anything steeper than that slumps: material slides to the lower neighbour
// until the face is stable again. A face is held where a RETAINING element is
// close: rock stamped into the ground (hardscape and stone walls) or a root
// mat of plants. This file has the maths (pure, runs under Node), the
// stability map the lens paints, and the check that settles hardscape pieces
// whose ground eroded away.

import { MAT, NMAT } from './tank.js';

// Per material: [tan(angle of repose), cohesion in cm of face that stands unaided]
export const REPOSE = [
  [0.95, 0.45],   // soil
  [0.62, 0.12],   // sand
  [0.80, 0.15],   // gravel
  [3.0, 3.0],     // rock
  [1.3, 0.6],     // moss (a mat of roots)
  [3.0, 3.0],     // dark stone
];
export const HOLD = 2.5;          // how much more a retained face holds
const FLOOR = 0.5;                // cm: ground never goes lower than this
const NB8 = [[1, 0, 1, 0], [-1, 0, 1, 0], [0, 1, 0, 1], [0, -1, 0, 1], [1, 1, 1, 1], [1, -1, 1, 1], [-1, 1, 1, 1], [-1, -1, 1, 1]];

// How steep a face between cell n and a neighbour `dist` cm away may be (cm of height difference).
export function limit(f, n, dist) {
  const mat = f.mat;
  if (!mat) return REPOSE[0][0] * dist + REPOSE[0][1];
  let a = 0, w = 0;
  const o = n * NMAT;
  for (let m = 0; m < NMAT; m++) {
    const q = mat[o + m];
    if (q > 0.001) { a += q * (REPOSE[m][0] * dist + REPOSE[m][1]); w += q; }
  }
  return w > 0 ? a / w : REPOSE[0][0] * dist + REPOSE[0][1];
}

export function dominant(f, n) {
  const mat = f.mat;
  if (!mat) return MAT.soil;
  let best = 0, bw = -1;
  for (let m = 0; m < NMAT; m++) if (mat[n * NMAT + m] > bw) { bw = mat[n * NMAT + m]; best = m; }
  return best;
}

// Blend material k into vertex n (weights stay normalised).
export function paintMat(f, n, k, amt) {
  const mat = f.mat;
  if (!mat || amt <= 0) return;
  let sum = 0;
  for (let m = 0; m < NMAT; m++) {
    const o = n * NMAT + m;
    mat[o] = mat[o] * (1 - amt) + (m === k ? amt : 0);
    sum += mat[o];
  }
  if (sum > 0) for (let m = 0; m < NMAT; m++) mat[n * NMAT + m] /= sum;
}

// 0 loose … 1 held: ground next to stamped rock (two cells deep) or under a root mat.
export function retainMap(f, root, out) {
  const N = f.cols * f.rows, st = f.stamped;
  if (root) out.set(root); else out.fill(0);
  if (!st) return out;
  const { cols, nx, ny } = f;
  for (let n = 0; n < N; n++) {
    if (!st[n]) continue;
    out[n] = 1;
    const i = n % cols, j = (n / cols) | 0;
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni > nx || nj > ny) continue;
      const v = 1 - 0.3 * Math.max(Math.abs(di), Math.abs(dj));
      const q = nj * cols + ni;
      if (v > out[q]) out[q] = v;
    }
  }
  return out;
}

// `grand`: faces as built (a generated, loaded or restored tank) count as compacted and rooted
// already, so only what the player sculpts or erosion undercuts afterwards slumps: per cell, a
// multiplier on the limit (1 = no allowance). See Erosion.
// One relaxation pass: faces steeper than the ground can hold lose material to the
// lower neighbour. `dz` is scratch (Float32Array N). Volume is conserved exactly
// (what one cell loses another gains). Returns the volume moved (cm3); `ev` gets
// the cells that lost the most [cell, cm].
export function slumpPass(f, ret, rate, dz, ev = null, grand = null) {
  const B = f.base, st = f.stamped, { cols, rows, nx, ny } = f;
  const N = cols * rows;
  dz.fill(0);
  let moved = 0;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const n = j * cols + i;
      if (st?.[n]) continue;
      for (let k = 0; k < 8; k++) {
        const nb = NB8[k], ni = i + nb[0], nj = j + nb[1];
        if (ni < 0 || nj < 0 || ni > nx || nj > ny) continue;
        const m = nj * cols + ni;
        if (st?.[m]) continue;
        const diff = B[n] - B[m];
        if (diff <= 0.04) continue;
        const dist = Math.hypot(nb[2] * f.da, nb[3] * f.db);
        if (diff <= 0.62 * dist + 0.12) continue;   // stable on any loose ground
        const L = limit(f, n, dist) * (1 + HOLD * Math.max(ret[n], ret[m])) * (grand ? grand[n] : 1);
        if (diff <= L) continue;
        // Never move more than would level the pair, and keep the ground above the floor.
        const a = Math.min(rate * (diff - L) * 0.2, (diff - 0.01) * 0.25, Math.max(0, B[n] - FLOOR) * 0.25);
        if (a <= 0) continue;
        dz[n] -= a; dz[m] += a;
        moved += a;
      }
    }
  }
  if (moved <= 0) return 0;
  const area = f.da * f.db;
  for (let n = 0; n < N; n++) {
    const a = dz[n];
    if (!a) continue;
    B[n] += a;
    if (a < 0) {
      if (ev && -a > 0.012) ev.push([n, -a]);
    } else if (a > 0.004) {
      // The slumped soil lands on the lower ground and mixes into it.
      paintMat(f, n, MAT.soil, Math.min(0.25, a * 2));
    }
  }
  return moved * area;
}

// Stress per cell: how far the steepest face is past (1) or short of (0) what the ground can hold.
export function stressMap(f, ret, out, grand = null) {
  const B = f.base, st = f.stamped, { cols, rows, nx, ny } = f;
  out.fill(0);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const n = j * cols + i;
      if (st?.[n]) continue;
      let s = 0;
      for (let k = 0; k < 8; k++) {
        const nb = NB8[k], ni = i + nb[0], nj = j + nb[1];
        if (ni < 0 || nj < 0 || ni > nx || nj > ny) continue;
        const m = nj * cols + ni;
        if (st?.[m]) continue;
        const diff = B[n] - B[m];
        if (diff <= 0.04) continue;
        const dist = Math.hypot(nb[2] * f.da, nb[3] * f.db);
        const L = limit(f, n, dist) * (1 + HOLD * Math.max(ret[n], ret[m])) * (grand ? grand[n] : 1);
        const q = diff / L;
        if (q > s) s = q;
      }
      out[n] = s;
    }
  }
  return out;
}

// Keeps hardscape in contact with the ground (or with another piece). Every
// second or so each piece is compared with the ground under it; a piece whose
// ground eroded or was dug away from under it is flagged `unsupported` and
// lowered onto the new ground a little at a time, tilting slightly.
export class Support {
  constructor(world) {
    this.world = world;
    this.t = 0;
    this.stats = { settled: 0, hanging: 0 };
  }

  update(dt, force = false) {
    this.t -= dt;
    if (this.t > 0 && !force) return false;
    this.t = 1.2;
    const W = this.world, D = W.decor;
    if (!D?.reground) return false;
    let moved = false, hanging = 0;
    for (const p of D.pieces) {
      if (p.held || (p.face && p.face !== 'free')) continue;
      const y = p.mesh.position.y;
      const gap = D.reground(p, 0);
      let s = p._sup;
      // First sight, or the player moved it: this is its resting state.
      if (!s || Math.abs(s.y - y) > 0.02 || s.x !== p.mesh.position.x || s.z !== p.mesh.position.z) s = p._sup = { x: p.mesh.position.x, z: p.mesh.position.z, y, gap0: gap };
      if (gap - s.gap0 > (p.unsupported ? 0.25 : 1.0) * (W.realism?.support === 'gentle' ? 1.8 : 1)) {
        p.unsupported = true;
        hanging++;
        D.reground(p, Math.min(0.5, gap - s.gap0 - 0.1));
        s.y = p.mesh.position.y;
        moved = true;
        if (!s.said) { s.said = true; W.log?.('A piece of hardscape settled as the ground under it washed away.', 'info'); this.stats.settled++; }
      } else if (p.unsupported) { p.unsupported = false; s.said = false; }
    }
    this.stats.hanging = hanging;
    if (moved) W.groundChanged?.();
    return moved;
  }
}
