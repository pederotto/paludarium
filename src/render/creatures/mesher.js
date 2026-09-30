// Turns a body definition (kit.js) into a mesh with naive surface nets (from
// CAUSTIC//VOLUME's lite version, MIT), with two speed-ups so that fine, close-up
// meshes are affordable:
//
//  - adaptive sampling: a coarse grid is sampled first, and blocks that are
//    clearly far from the surface are skipped, so only a thin shell of the
//    volume is evaluated;
//  - smooth normals from the SDF gradient, so shading is smooth at any cell size.

import * as THREE from 'three/webgpu';

const EDGES = [];
for (let c = 0; c < 8; c++) for (const b of [1, 2, 4]) if (!(c & b)) EDGES.push(c, c | b);
const BLOCK = 4;

export function surfaceNet(sdf, lo, hi, h) {
  const nx = Math.ceil((hi[0] - lo[0]) / h) + 1, ny = Math.ceil((hi[1] - lo[1]) / h) + 1, nz = Math.ceil((hi[2] - lo[2]) / h) + 1, S = [1, nx, nx * ny];
  const V = new Float32Array(nx * ny * nz).fill(NaN), id = new Int32Array(nx * ny * nz).fill(-1), P = [], N = [], I = [];
  // Coarse pass: sample every BLOCK-th point; skip blocks whose corners are all far from the surface.
  const bx = Math.ceil((nx - 1) / BLOCK), by = Math.ceil((ny - 1) / BLOCK), bz = Math.ceil((nz - 1) / BLOCK);
  const cnx = bx + 1, cny = by + 1;
  const CV = new Float32Array(cnx * cny * (bz + 1));
  for (let k = 0; k <= bz; k++) for (let j = 0; j <= by; j++) for (let i = 0; i <= bx; i++) CV[(k * cny + j) * cnx + i] = sdf(lo[0] + Math.min(i * BLOCK, nx - 1) * h, lo[1] + Math.min(j * BLOCK, ny - 1) * h, lo[2] + Math.min(k * BLOCK, nz - 1) * h);
  const reach = BLOCK * h * 1.732 * 1.6;   // SDFs built from smooth unions are not exact distances: stay generous
  for (let kb = 0; kb < bz; kb++) for (let jb = 0; jb < by; jb++) for (let ib = 0; ib < bx; ib++) {
    let mn = 1e9, neg = 0, pos = 0;
    for (let c = 0; c < 8; c++) {
      const v = CV[((kb + (c >> 2)) * cny + jb + ((c >> 1) & 1)) * cnx + ib + (c & 1)];
      mn = Math.min(mn, Math.abs(v));
      if (v < 0) neg++; else pos++;
    }
    const far = mn > reach && (neg === 0 || pos === 0);
    const i0 = ib * BLOCK, j0 = jb * BLOCK, k0 = kb * BLOCK;
    const i1 = Math.min(nx - 1, i0 + BLOCK), j1 = Math.min(ny - 1, j0 + BLOCK), k1 = Math.min(nz - 1, k0 + BLOCK);
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const q = (k * ny + j) * nx + i;
      if (far) { if (Number.isNaN(V[q])) V[q] = neg ? -mn : mn; }
      else if (Number.isNaN(V[q])) V[q] = sdf(lo[0] + i * h, lo[1] + j * h, lo[2] + k * h);
    }
  }
  // Safety net: every sample belongs to a block, but make sure none is left unset.
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const q = (k * ny + j) * nx + i;
    if (Number.isNaN(V[q])) V[q] = sdf(lo[0] + i * h, lo[1] + j * h, lo[2] + k * h);
  }
  const corner = [0, 1, 2, 3, 4, 5, 6, 7].map((c) => (c & 1) + ((c >> 1) & 1) * S[1] + (c >> 2) * S[2]), e = h * 0.05;
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0, q = (k * ny + j) * nx; i < nx - 1; i++, q++) {
    let n = 0, sx = 0, sy = 0, sz = 0;
    for (let a = 0; a < 24; a += 2) {
      const c0 = EDGES[a], c1 = EDGES[a + 1], v0 = V[q + corner[c0]], v1 = V[q + corner[c1]];
      if ((v0 < 0) === (v1 < 0)) continue;
      const t = v0 / (v0 - v1);
      sx += (c0 & 1) + ((c1 & 1) - (c0 & 1)) * t; sy += ((c0 >> 1) & 1) + (((c1 >> 1) & 1) - ((c0 >> 1) & 1)) * t; sz += (c0 >> 2) + ((c1 >> 2) - (c0 >> 2)) * t; n++;
    }
    if (!n) continue;
    let x = lo[0] + (i + sx / n) * h, y = lo[1] + (j + sy / n) * h, z = lo[2] + (k + sz / n) * h;
    for (let it = 0; it < 2; it++) {
      const d = sdf(x, y, z), gx = sdf(x + e, y, z) - d, gy = sdf(x, y + e, z) - d, gz = sdf(x, y, z + e) - d, l = Math.hypot(gx, gy, gz) || 1;
      if (it) N.push(gx / l, gy / l, gz / l); else { const m = Math.max(-h / 2, Math.min(h / 2, d)) / l; x -= m * gx; y -= m * gy; z -= m * gz; }
    }
    id[q] = P.length / 3; P.push(x, y, z);
  }
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1, q = (k * ny + j) * nx + 1; i < nx - 1; i++, q++) {
    const inside = V[q] < 0;
    for (let a = 0; a < 3; a++) {
      if ((V[q + S[a]] < 0) === inside) continue;
      const b = S[(a + 1) % 3], c = S[(a + 2) % 3], q00 = id[q - b - c], q10 = id[q - c], q11 = id[q], q01 = id[q - b];
      if (q00 < 0 || q10 < 0 || q11 < 0 || q01 < 0) continue;
      if (inside) I.push(q00, q10, q11, q00, q11, q01); else I.push(q00, q11, q10, q00, q01, q11);
    }
  }
  return { P, N, I };
}

// Builds a geometry from a body definition. `detail` 'lo' uses def.cell, 'hi' uses
// def.cell * (def.hiScale ?? 0.5).
export function bodyGeometry(def, detail = 'lo') {
  const cell = def.cell * (detail === 'hi' ? def.hiScale ?? 0.5 : 1);
  const { P, N, I } = surfaceNet(def.sdf, def.lo, def.hi, cell);
  const n = P.length / 3;
  const col = new Float32Array(n * 3), rig = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    col.set(def.color(x, y, z), i * 3);
    const r = def.rig ? def.rig(x, y, z) : [0, 0, 0];
    rig[i * 4] = r[0]; rig[i * 4 + 1] = r[1]; rig[i * 4 + 2] = r[2];
    rig[i * 4 + 3] = def.mat ? def.mat(x, y, z) : 0;      // material id rides in rig.w (the GPU allows only 8 vertex buffers)
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('rig', new THREE.BufferAttribute(rig, 4));
  g.setIndex(I);
  g.computeBoundingSphere();
  g.userData.verts = n;
  return g;
}

// Adds a neutral rig attribute to a geometry built elsewhere (legacy low-poly bugs).
export function withRig(g, spineAxis = 'z') {
  const n = g.attributes.position.count;
  const rig = new Float32Array(n * 4);
  g.computeBoundingBox();
  const bb = g.boundingBox;
  for (let i = 0; i < n; i++) {
    const v = g.attributes.position.getComponent(i, spineAxis === 'z' ? 2 : 0);
    rig[i * 4] = 1 - (v - bb.min.z) / Math.max(1e-3, bb.max.z - bb.min.z);
  }
  g.setAttribute('rig', new THREE.BufferAttribute(rig, 4));
  return g;
}
