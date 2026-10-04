// Pure meshing: body definition in, typed arrays out. No three.js here, so it runs unchanged in a Web Worker
// (mesh.worker.js) and on the main thread (mesher.js bodyGeometry, the sync path used by tools and tests).
// Naive surface nets (from CAUSTIC//VOLUME's lite version, MIT) with adaptive sampling and SDF-gradient normals.

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


// Shape = what depends only on the SDF: double-precision positions (colours are evaluated at these exact values),
// float normals and indices. Reading `cell` then `hiScale` in this order matters: some defs switch their sdf's detail
// level by getter side effect (salamanders.js lodDef), so the state must be set before the sdf is sampled.
export function bodyShape(def, detail = 'lo') {
  const cell = def.cell * (detail === 'hi' ? def.hiScale ?? 0.5 : 1);
  const { P, N, I } = surfaceNet(def.sdf, def.lo, def.hi, cell);
  let big = false;
  for (let i = 0; i < I.length; i++) if (I[i] >= 65535) { big = true; break; }   // same rule as three's arrayNeedsUint32
  const index = big ? new Uint32Array(I) : new Uint16Array(I);
  return { P: Float64Array.from(P), N: Float32Array.from(N), I: index, n: P.length / 3 };
}

// Ambient occlusion from the SDF (the classic marching estimate): step out along the normal and see how much closer than the
// step the surface is. 0 in the open … 1 in a deep crease (the armpit, the gap under a leg, between the toes). Steps are set by
// the coarse cell so both levels of detail shade alike. Baked into the vertex colour: creases read without any cost at run time.
function sdfOcclusion(sdf, x, y, z, nx, ny, nz, step) {
  let occ = 0, w = 0.5;
  for (let k = 1; k <= 4; k++) {
    const t = step * k, d = sdf(x + nx * t, y + ny * t, z + nz * t);
    occ += w * Math.max(0, t - d) / t;
    w *= 0.62;
  }
  return Math.min(1, occ / 0.9);
}

// Per-vertex colour and rig/material for a shape. Sets the def's detail state the same way bodyShape does.
// def.ao (default 0.5): how much the baked occlusion darkens creases; 0 turns it off.
export function paintShape(def, shape, detail = 'lo') {
  const step = def.cell * 1.6;                                      // (read before the detail state is set: reading cell resets it)
  void (def.cell * (detail === 'hi' ? def.hiScale ?? 0.5 : 1));
  const { P, N, n } = shape;
  const col = new Float32Array(n * 3), rig = new Float32Array(n * 4);
  const aoK = def.ao ?? 0.5;
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    col.set(def.color(x, y, z), i * 3);
    if (aoK > 0 && N) {
      const k = 1 - aoK * sdfOcclusion(def.sdf, x, y, z, N[i * 3], N[i * 3 + 1], N[i * 3 + 2], step);
      col[i * 3] *= k; col[i * 3 + 1] *= k; col[i * 3 + 2] *= k;
    }
    const r = def.rig ? def.rig(x, y, z) : [0, 0, 0];
    rig[i * 4] = r[0]; rig[i * 4 + 1] = r[1]; rig[i * 4 + 2] = r[2];
    rig[i * 4 + 3] = def.mat ? def.mat(x, y, z) : 0;      // material id rides in rig.w (the GPU allows only 8 vertex buffers)
  }
  return { col, rig };
}

// The attribute arrays of a body mesh. `shape` may be passed in to reuse another def's shape (colour morphs).
export function bodyArrays(def, detail = 'lo', shape = null) {
  const s = shape ?? bodyShape(def, detail);
  const { col, rig } = paintShape(def, s, detail);
  return { position: Float32Array.from(s.P), normal: s.N, color: col, rig, index: s.I, verts: s.n };
}

// A cheap fingerprint of everything bodyShape depends on, to decide whether two defs (colour morphs of one species)
// really share their shape. Sampling the sdf is only meaningful after the detail state is set, so it reads cell first.
export function shapeSignature(def, detail = 'lo') {
  const cell = def.cell * (detail === 'hi' ? def.hiScale ?? 0.5 : 1);
  const parts = [cell, ...def.lo, ...def.hi];
  for (let i = 0; i < 64; i++) {
    const u = (i * 0.6180339887) % 1, v = (i * 0.7548776662) % 1, w = (i * 0.5698402910) % 1;
    parts.push(def.sdf(def.lo[0] + u * (def.hi[0] - def.lo[0]), def.lo[1] + v * (def.hi[1] - def.lo[1]), def.lo[2] + w * (def.hi[2] - def.lo[2])));
  }
  return parts.join(',');
}
