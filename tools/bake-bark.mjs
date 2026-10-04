// Bakes the tileable bark used on every wood piece (sim/decor.js barkMaterial): furrowed bark of long plates split by deep
// fissures, with fibres along the grain, a few lichen flecks and the height in the alpha channel (the material grows moss in
// the furrows first). One tile is BARK_TILE_CM of bark (sim/decor.js), grain along v (the second texture axis).
//   node tools/bake-bark.mjs  ->  public/assets/ground/bark_furrowed.webp (colour + height) and bark_furrowed_normal.webp
// Everything is periodic over the tile (wrapped cells and lattices), so it repeats with no seam.
// It also lays the bark on the root strands of the scanned root ball (see bakeRoots below):
//   node tools/bake-bark.mjs roots  ->  public/assets/ground/root_cluster_01_bark.bin (that step alone)
import sharp from 'sharp';
import * as THREE from 'three';
import { computeBoundsTree } from 'three-mesh-bvh';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const N = 512;
const OUT = new URL('../public/assets/ground/', import.meta.url);
// The root ball's bark (bakeRoots): PIECES.roots.size, cm of bark per tile, cm of scan a strand is thinner than, the fewest
// vertices of a strand, and the step its coordinates are stored in (tiles).
const ROOTS_SIZE_CM = 30, ROOT_TILE_CM = 3, THIN = 12, MIN_STRAND = 40, STEP = 1 / 2048;
if (process.argv[2] === 'roots') { await bakeRoots(); process.exit(0); }

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hash = (i, j, s) => { let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(s, 2147483647); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const wrap = (i, n) => ((i % n) + n) % n;
const sm = (t) => t * t * (3 - 2 * t);
// Periodic value noise: nx x ny lattice cells over the unit tile.
function vnoise(u, v, nx, ny, s) {
  const x = u * nx, y = v * ny, i = Math.floor(x), j = Math.floor(y), fx = sm(x - i), fy = sm(y - j);
  const h = (a, b) => hash(wrap(i + a, nx), wrap(j + b, ny), s);
  return (h(0, 0) * (1 - fx) + h(1, 0) * fx) * (1 - fy) + (h(0, 1) * (1 - fx) + h(1, 1) * fx) * fy;
}
const fbm = (u, v, nx, ny, s, oct = 4) => { let a = 0, w = 0.5, t = 0; for (let o = 0; o < oct; o++) { a += w * vnoise(u, v, nx << o, ny << o, s + o * 17); t += w; w *= 0.5; } return a / t; };

// Plates: periodic Worley cells, long along the grain. Returns [F1, F2, id of the nearest cell].
const CX = 10, CY = 2, r = rng(1234);
const pts = [];
for (let j = 0; j < CY; j++) for (let i = 0; i < CX; i++) pts.push([(i + 0.15 + r() * 0.7) / CX, (j + 0.1 + r() * 0.8) / CY, r()]);
function cells(u, v) {
  let f1 = 9, f2 = 9, id = 0;
  const ci = Math.floor(u * CX), cj = Math.floor(v * CY);
  for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
    const ii = ci + di, jj = cj + dj, p = pts[wrap(jj, CY) * CX + wrap(ii, CX)];
    const px = p[0] + Math.floor(ii / CX), py = p[1] + Math.floor(jj / CY);
    const dx = (u - px) * CX, dy = (v - py) * CY * 0.4;      // cells stretched along v
    const d = Math.hypot(dx, dy);
    if (d < f1) { f2 = f1; f1 = d; id = wrap(jj, CY) * CX + wrap(ii, CX); } else if (d < f2) f2 = d;
  }
  return [f1, f2, id];
}

const H = new Float32Array(N * N), C = new Float32Array(N * N * 3);
const furrow = [0.025, 0.017, 0.012], plate = [0.34, 0.3, 0.25], plate2 = [0.22, 0.165, 0.115], lichen = [0.44, 0.47, 0.38];
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  const u = x / N, v = y / N;
  // Warp the lookup a little so fissures wander instead of running straight.
  const wu = u + (fbm(u, v, 3, 4, 7) - 0.5) * 0.12 + (fbm(u, v, 8, 6, 8) - 0.5) * 0.03, wv = v + (fbm(u, v, 3, 3, 9) - 0.5) * 0.05;
  const [f1, f2, id] = cells(wu, wv);
  const edge = f2 - f1;                                          // 0 on a fissure
  const fiss = Math.min(1, edge / (0.5 + 0.25 * fbm(u, v, 6, 3, 11)));   // 0 in the fissure, 1 on the ridge
  // Ridges: rounded tops cut across by short horizontal cracks; the fissures between them deep and V-shaped.
  const crack = Math.max(0, fbm(u, v, 22, 48, 13, 2) - 0.6) * 2.5;
  const plateTop = Math.pow(sm(fiss), 0.85) * (1 - Math.min(0.6, crack));
  const pv = pts[id][2];
  const fibre = fbm(u, v, 64, 6, 3, 3);                          // fine streaks along the grain
  const rough = fbm(u, v, 40, 28, 5, 3);
  const h = plateTop * (0.72 + 0.2 * pv) + (fibre - 0.5) * 0.3 * plateTop + (rough - 0.5) * 0.18;
  H[y * N + x] = Math.max(0, Math.min(1, h));
  // Colour: dark furrows, grey-brown plates (each plate its own shade), fibres, a few lichen flecks on plate tops.
  const k = plateTop, tone = 0.85 + 0.5 * (fibre - 0.5) + 0.3 * (rough - 0.5) + 0.25 * (pv - 0.5);
  const lf = Math.max(0, fbm(u, v, 16, 10, 21, 3) - 0.66) * 3 * k;
  for (let c = 0; c < 3; c++) {
    let col = furrow[c] + (plate[c] * (1 - pv * 0.6) + plate2[c] * pv * 0.6 - furrow[c]) * k;
    col *= tone;
    col = col + (lichen[c] - col) * Math.min(0.55, lf);
    C[(y * N + x) * 3 + c] = col;
  }
}

const toS = (l) => Math.round(255 * Math.min(1, Math.max(0, l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055)));
const rgba = Buffer.alloc(N * N * 4), nrm = Buffer.alloc(N * N * 3);
const STRENGTH = 7;
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  const n = y * N + x;
  for (let c = 0; c < 3; c++) rgba[n * 4 + c] = toS(C[n * 3 + c]);
  rgba[n * 4 + 3] = Math.round(255 * H[n]);
  const hx = H[y * N + wrap(x + 1, N)] - H[y * N + wrap(x - 1, N)], hy = H[wrap(y + 1, N) * N + x] - H[wrap(y - 1, N) * N + x];
  // OpenGL convention (+y up in tangent space). Image rows run down while v runs up (flipY), hence +hy.
  let nx = -hx * STRENGTH, ny = hy * STRENGTH, nz = 1;
  const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
  nrm[n * 3] = Math.round((nx * 0.5 + 0.5) * 255); nrm[n * 3 + 1] = Math.round((ny * 0.5 + 0.5) * 255); nrm[n * 3 + 2] = Math.round((nz * 0.5 + 0.5) * 255);
}
await sharp(rgba, { raw: { width: N, height: N, channels: 4 } }).webp({ quality: 86, alphaQuality: 90 }).toFile(new URL('bark_furrowed.webp', OUT).pathname);
await sharp(nrm, { raw: { width: N, height: N, channels: 3 } }).webp({ quality: 90 }).toFile(new URL('bark_furrowed_normal.webp', OUT).pathname);
console.log('wrote bark_furrowed.webp and bark_furrowed_normal.webp', N + 'px');
await bakeRoots();

// --- The root ball's bark ---------------------------------------------------------------------------------------------------
// The scanned root ball (public/assets/models/root_cluster_01.glb: an open sheet of soil, a bank face, with the roots on it as
// closed tubes) has one 512 px photo for 4 m of scan: on the roots, its strips are a few texels across and smeared with the
// soil's colour. This finds the root strands and gives them bark coordinates in tiles of ROOT_TILE_CM, grain along each strand,
// which sim/decor.js draws with the furrowed bark (the soil keeps its photo):
//   - a strand is where the surface is thin: a ray in along the normal meets the other side within THIN cm of scan (the soil
//     sheet has no other side), in connected patches of at least MIN_STRAND vertices (smaller ones are folds of the soil);
//   - the grain runs the way the strand's normals do not turn (the smallest axis of their spread over three rings);
//   - v is fitted to that direction (least squares over the strand's triangles, so it runs smoothly through bends and forks),
//     and u to v turned a quarter round the surface, on each chart of the scan's own atlas (its seams cut each tube open along
//     its length), so the bark is the same size both ways.
// Out: Uint32 vertex count, Float32 tile step, Int16 u[n], Int16 v[n] (tiles / step), Uint8 strand[n] (0 … 255, softened over one
// ring so the bark fades into the soil), in the GLB's own vertex order. Drawn at the catalogue size (PIECES.roots.size);
// the constants are at the top (ROOTS_SIZE_CM ...).
async function bakeRoots() {
  THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.read(new URL('../public/assets/models/root_cluster_01.glb', import.meta.url).pathname);
  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  const PA = prim.getAttribute('POSITION'), NA = prim.getAttribute('NORMAL'), n = PA.getCount(), e = [];
  const pos = new Float64Array(n * 3), nrm = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) { PA.getElement(i, e); for (let c = 0; c < 3; c++) pos[i * 3 + c] = e[c] * 100; NA.getElement(i, e); for (let c = 0; c < 3; c++) nrm[i * 3 + c] = e[c]; }
  const idx = Uint32Array.from(prim.getIndices().getArray());
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], pos[i * 3 + c]); hi[c] = Math.max(hi[c], pos[i * 3 + c]); }
  const kv = ROOTS_SIZE_CM / Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / ROOT_TILE_CM;      // tiles per cm of scan

  // Weld: the scan's vertices are split along its atlas seams, which the strands cross.
  const key = new Map(), weld = new Int32Array(n), first = [];
  for (let i = 0; i < n; i++) {
    const s = Math.round(pos[i * 3] * 10) + ',' + Math.round(pos[i * 3 + 1] * 10) + ',' + Math.round(pos[i * 3 + 2] * 10);
    let w = key.get(s);
    if (w === undefined) { w = first.length; key.set(s, w); first.push(i); }
    weld[i] = w;
  }
  const m = first.length, P = new Float64Array(m * 3), Nw = new Float64Array(m * 3);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) { P[weld[i] * 3 + c] = pos[i * 3 + c]; Nw[weld[i] * 3 + c] += nrm[i * 3 + c]; }
  for (let w = 0; w < m; w++) { const l = Math.hypot(Nw[w * 3], Nw[w * 3 + 1], Nw[w * 3 + 2]) || 1; for (let c = 0; c < 3; c++) Nw[w * 3 + c] /= l; }
  const adjS = Array.from({ length: m }, () => new Set());
  for (let t = 0; t < idx.length; t += 3) for (let k = 0; k < 3; k++) { const a = weld[idx[t + k]], b = weld[idx[t + (k + 1) % 3]]; if (a !== b) { adjS[a].add(b); adjS[b].add(a); } }
  const adj = adjS.map((s) => Int32Array.from(s));

  // Thickness under each point, and the strands.
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(pos), 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundsTree();
  const ray = new THREE.Ray(), o = new THREE.Vector3(), d = new THREE.Vector3(), th = new Float64Array(m).fill(Infinity);
  for (let w = 0; w < m; w++) {
    d.set(-Nw[w * 3], -Nw[w * 3 + 1], -Nw[w * 3 + 2]);
    ray.set(o.set(P[w * 3], P[w * 3 + 1], P[w * 3 + 2]).addScaledVector(d, 0.05), d);
    const h = g.boundsTree.raycastFirst(ray, THREE.DoubleSide);
    if (h) th[w] = h.distance + 0.05;
  }
  const mask = new Uint8Array(m), seen = new Uint8Array(m);
  let strands = 0;
  for (let s = 0; s < m; s++) {
    if (seen[s] || !(th[s] < THIN)) continue;
    const list = [s]; seen[s] = 1;
    for (let q = 0; q < list.length; q++) for (const b of adj[list[q]]) if (!seen[b] && th[b] < THIN) { seen[b] = 1; list.push(b); }
    if (list.length >= MIN_STRAND) { strands++; for (const w of list) mask[w] = 1; }
  }

  // The grain: the smallest axis of the normals' spread over three rings of the strand, signed alike along it, smoothed.
  const T = new Float64Array(m * 3);
  for (let w = 0; w < m; w++) {
    if (!mask[w]) continue;
    const ring = new Set([w]);
    let front = [w];
    for (let r = 0; r < 3; r++) { const next = []; for (const a of front) for (const b of adj[a]) if (mask[b] && !ring.has(b)) { ring.add(b); next.push(b); } front = next; }
    let c00 = 0, c01 = 0, c02 = 0, c11 = 0, c12 = 0, c22 = 0;
    for (const j of ring) { const x = Nw[j * 3], y = Nw[j * 3 + 1], z = Nw[j * 3 + 2]; c00 += x * x; c01 += x * y; c02 += x * z; c11 += y * y; c12 += y * z; c22 += z * z; }
    const tr = c00 + c11 + c22;           // power iteration on (trace I - C): its largest axis is C's smallest
    let x = 0.57, y = 0.59, z = 0.57;
    for (let it = 0; it < 30; it++) {
      const nx = (tr - c00) * x - c01 * y - c02 * z, ny = -c01 * x + (tr - c11) * y - c12 * z, nz = -c02 * x - c12 * y + (tr - c22) * z;
      const l = Math.hypot(nx, ny, nz) || 1; x = nx / l; y = ny / l; z = nz / l;
    }
    T[w * 3] = x; T[w * 3 + 1] = y; T[w * 3 + 2] = z;
  }
  const signed = new Uint8Array(m);
  for (let s = 0; s < m; s++) {
    if (!mask[s] || signed[s]) continue;
    signed[s] = 1;
    const list = [s];
    for (let q = 0; q < list.length; q++) {
      const a = list[q];
      for (const b of adj[a]) {
        if (!mask[b] || signed[b]) continue;
        if (T[a * 3] * T[b * 3] + T[a * 3 + 1] * T[b * 3 + 1] + T[a * 3 + 2] * T[b * 3 + 2] < 0) for (let c = 0; c < 3; c++) T[b * 3 + c] *= -1;
        signed[b] = 1; list.push(b);
      }
    }
  }
  for (let it = 0; it < 4; it++) {
    const S = T.slice();
    for (let w = 0; w < m; w++) {
      if (!mask[w]) continue;
      let x = S[w * 3], y = S[w * 3 + 1], z = S[w * 3 + 2];
      for (const b of adj[w]) if (mask[b]) { x += S[b * 3]; y += S[b * 3 + 1]; z += S[b * 3 + 2]; }
      const l = Math.hypot(x, y, z) || 1; T[w * 3] = x / l; T[w * 3 + 1] = y / l; T[w * 3 + 2] = z / l;
    }
  }

  // v over the welded strands (continuous across the atlas seams), then u on each atlas chart.
  const touch = (t) => mask[weld[idx[t]]] + mask[weld[idx[t + 1]]] + mask[weld[idx[t + 2]]];
  const wt = [], ow = [], tri = [];
  for (let t = 0; t < idx.length; t += 3) { const c = touch(t); if (!c) continue; tri.push(idx[t], idx[t + 1], idx[t + 2]); wt.push(weld[idx[t]], weld[idx[t + 1]], weld[idx[t + 2]]); ow.push(c / 3); }
  const V = fitGradient(wt, ow, (w) => [P[w * 3], P[w * 3 + 1], P[w * 3 + 2]], (I, nh) => {
    let x = 0, y = 0, z = 0;
    for (const w of I) if (mask[w]) { x += T[w * 3]; y += T[w * 3 + 1]; z += T[w * 3 + 2]; }
    const dn = x * nh[0] + y * nh[1] + z * nh[2]; x -= dn * nh[0]; y -= dn * nh[1]; z -= dn * nh[2];
    const l = Math.hypot(x, y, z) || 1;
    return [(x / l) * kv, (y / l) * kv, (z / l) * kv];
  });
  const vAt = (i) => V.get(weld[i]) ?? 0;
  const U = fitGradient(tri, ow, (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]], (I, nh, gp) => {
    const gv = [0, 1, 2].reduce((s, k) => { const v = vAt(I[k]); return [s[0] + v * gp[k][0], s[1] + v * gp[k][1], s[2] + v * gp[k][2]]; }, [0, 0, 0]);
    return [nh[1] * gv[2] - nh[2] * gv[1], nh[2] * gv[0] - nh[0] * gv[2], nh[0] * gv[1] - nh[1] * gv[0]];
  });

  // Write.
  const buf = Buffer.alloc(8 + n * 4 + n + ((4 - (n % 4)) % 4));
  buf.writeUInt32LE(n, 0); buf.writeFloatLE(STEP, 4);
  let big = 0;
  for (let i = 0; i < n; i++) {
    const u = (U.get(i) ?? 0) / STEP, v = vAt(i) / STEP;
    big = Math.max(big, Math.abs(u), Math.abs(v));
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(u))), 8 + i * 2);
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(v))), 8 + n * 2 + i * 2);
    const w = weld[i];
    let s = mask[w], c = 1;
    for (const b of adj[w]) { s += mask[b]; c++; }
    buf.writeUInt8(Math.round((255 * s) / c), 8 + n * 4 + i);
  }
  if (big > 32767) throw new Error('bark coordinates out of range: ' + (big * STEP).toFixed(1) + ' tiles');
  const fs = await import('node:fs');
  fs.writeFileSync(new URL('root_cluster_01_bark.bin', OUT), buf);
  console.log(`wrote root_cluster_01_bark.bin: ${strands} strands, ${mask.reduce((a, b) => a + b, 0)} of ${m} vertices, ${tri.length / 3} triangles with bark, ${(buf.length / 1024).toFixed(0)} KB`);
}

// Least squares: the scalar field f on the vertices of `tri` (flat vertex ids) whose gradient on each triangle is closest to
// target(I, unit normal, the three hat functions' gradients), weighted by area x w. Cotangent Laplacian, Jacobi-preconditioned
// conjugate gradients; every vertex is held weakly at 0, so each connected piece comes out centred. Returns Map(id -> f).
function fitGradient(tri, w, posOf, target) {
  const loc = new Map(), ids = [];
  for (const i of tri) if (!loc.has(i)) { loc.set(i, ids.length); ids.push(i); }
  const m = ids.length, A = Array.from({ length: m }, () => new Map()), b = new Float64Array(m);
  const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]], cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]], dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  for (let k = 0; k < tri.length / 3; k++) {
    const I = [tri[k * 3], tri[k * 3 + 1], tri[k * 3 + 2]], p = I.map(posOf);
    const nn = cross(sub(p[1], p[0]), sub(p[2], p[0])), a2 = Math.hypot(nn[0], nn[1], nn[2]);
    if (a2 < 1e-10 || !(w[k] > 0)) continue;
    const nh = nn.map((x) => x / a2);
    const gp = [0, 1, 2].map((i) => cross(nh, sub(p[(i + 2) % 3], p[(i + 1) % 3])).map((x) => x / a2));
    const t = target(I, nh, gp), area = (a2 / 2) * w[k];
    for (let i = 0; i < 3; i++) {
      const li = loc.get(I[i]);
      b[li] += area * dot(gp[i], t);
      for (let j = 0; j < 3; j++) { const lj = loc.get(I[j]); A[li].set(lj, (A[li].get(lj) ?? 0) + area * dot(gp[i], gp[j])); }
    }
  }
  let tr = 0;
  for (let i = 0; i < m; i++) tr += A[i].get(i) ?? 0;
  const D = new Float64Array(m);
  for (let i = 0; i < m; i++) { A[i].set(i, (A[i].get(i) ?? 0) + (1e-7 * tr) / m); D[i] = A[i].get(i); }
  const rows = A.map((r) => [Int32Array.from(r.keys()), Float64Array.from(r.values())]);
  const x = new Float64Array(m), r = Float64Array.from(b), z = r.map((v, i) => v / D[i]), p = Float64Array.from(z), Ap = new Float64Array(m);
  let rz = r.reduce((s, v, i) => s + v * z[i], 0);
  const rz0 = rz;
  for (let it = 0; it < 600 && rz > 1e-12 * rz0; it++) {
    for (let i = 0; i < m; i++) { const [js, as] = rows[i]; let s = 0; for (let q = 0; q < js.length; q++) s += as[q] * p[js[q]]; Ap[i] = s; }
    const al = rz / p.reduce((s, v, i) => s + v * Ap[i], 0);
    let rz2 = 0;
    for (let i = 0; i < m; i++) { x[i] += al * p[i]; r[i] -= al * Ap[i]; z[i] = r[i] / D[i]; rz2 += r[i] * z[i]; }
    const be = rz2 / rz; rz = rz2;
    for (let i = 0; i < m; i++) p[i] = z[i] + be * p[i];
  }
  return new Map(ids.map((id, i) => [id, x[i]]));
}
