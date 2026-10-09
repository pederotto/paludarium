// A coarse occupancy grid of the hardscape that is NOT stamped into the ground
// (roots, driftwood, anything floating or overhanging). Animals only know the
// height field, so without this they push straight into these pieces and wedge.
//
// The grid covers the whole tank in CELL-cm voxels. Each piece is voxelised
// from its triangles (surface cells, thickened by one cell so a fast animal
// cannot step through a thin shell), and closed volumes are filled by casting
// rays down every column and filling between pairs of hits.
// Rebuild with `rebuild(decor)` whenever `decor.occupancyVersion` changes.

import * as THREE from 'three/webgpu';
import { TANK } from './tank.js';
import { SurfaceMap, layersOf, MAX_LAYERS } from './surfaces.js';

export const CELL = 1.5;

// --- The spatial contract (R8): ONE predicate for where a body may be ------------------------------------------------------------
// The movers' step test (Animals.canStep), every goal a mind commits (Animals.isValidGoal) and insideSolid's first gate all ask
// canOccupy, with the same layer and the same body, so a step the movers take can never be found inside a piece on the next tick (the
// snail that stepped under a ledge because the step tested 0.5 cm and insideSolid 0.8 of its shell). It reads the 2.5D layer map
// (sim/surfaces.js, baked from these voxels when the pieces change): O(1), no rays, no allocation.
// A body is anything with `bh` (its height, cm) and `rad` (its radius, cm): an animal, or ANON for a caller with none.
export const ANON = { bh: 0.5, rad: 0 };
// A body stands on a layer whose surface is at most this far above its feet. A climber's feet are read from the exact layer standOn put it
// on (Animals.standY), so only rounding is allowed for; a bigger allowance had ground walkers "on" a buried stone whose top was above their feet.
export const LAYER_TOL = 0.05;
// A piece's top layer is no floor where the voxels above it run on higher than this (two cells and a slanted surface's third: runTop).
export const WALL_IN_CELL = 3 * CELL;
// The room a body needs above the surface it stands on: its height (half a centimetre at least: the old fixed test).
export const clearNeed = (b) => Math.max(0.5, b.bh ?? 0.5);
// How far above its feet its belly is: insideBody's lowest sample for a body this tall.
export const bellyOf = (b) => Math.min(0.5, Math.max(0.2, b.bh ?? 0.5) * 0.5);

const A = new THREE.Vector3(), B = new THREE.Vector3(), Cc = new THREE.Vector3(), P = new THREE.Vector3();
const SHELL = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
const RAY = new THREE.Raycaster(); RAY.firstHitOnly = false;
const RAY1 = new THREE.Raycaster(); RAY1.firstHitOnly = true;      // (inside(): the nearest face only)
const N = new THREE.Vector3(), DOWN = new THREE.Vector3(0, -1, 0);
const DIRS = [[0, 1, 0], [0.6, 0.2, 0.77], [-0.7, 0.3, -0.65], [0.1, -0.2, 0.97], [-0.9, -0.1, 0.4]].map(([x, y, z]) => new THREE.Vector3(x, y, z).normalize());

export class Occupancy {
  constructor() {
    this.version = -1;
    this.sig = '';
    this.resize();
  }

  resize() {
    this.nx = Math.ceil(TANK.w / CELL); this.ny = Math.ceil(TANK.h / CELL); this.nz = Math.ceil(TANK.d / CELL);
    this.data = new Uint8Array(this.nx * this.ny * this.nz);
    this.count = 0;
    this.dims = [TANK.w, TANK.h, TANK.d].join();
  }

  idx(i, j, k) { return (k * this.ny + j) * this.nx + i; }
  cellX(x) { return Math.floor((x + TANK.w / 2) / CELL); }
  cellY(y) { return Math.floor(y / CELL); }
  cellZ(z) { return Math.floor((z + TANK.d / 2) / CELL); }
  worldX(i) { return (i + 0.5) * CELL - TANK.w / 2; }
  worldY(j) { return (j + 0.5) * CELL; }
  worldZ(k) { return (k + 0.5) * CELL - TANK.d / 2; }

  // Is this point inside a piece? Outside the grid counts as free (the tank walls are handled elsewhere).
  solidAt(x, y, z) {
    if (!this.count) return false;
    const i = this.cellX(x), j = this.cellY(y), k = this.cellZ(z);
    if (i < 0 || j < 0 || k < 0 || i >= this.nx || j >= this.ny || k >= this.nz) return false;
    return this.data[this.idx(i, j, k)] !== 0;
  }

  // Swept move test (B4b): how much of the move from (x0, y0, z0) to (x1, y1, z1) a body can make before it enters a solid cell,
  // as a fraction; 1 = all of it. An exact voxel walk (every cell the segment crosses, Amanatides-Woo), so no piece is stepped
  // through however long the step. Cells solid at the start are ignored until the segment has left them (one standing inside a
  // piece is keepFree's business and is never held here). A move shorter than `min` (default a third of a cell, the fuzz
  // detector's floor) returns 1: it cannot cross a cell, and every caller tests its end point itself. No allocation.
  segmentFree(a, from, to) { return this.segmentFreeAt(a, from.x, from.y, from.z, to.x, to.y, to.z); }
  segmentFreeAt(a, x0, y0, z0, x1, y1, z1, min = CELL / 3) {
    if (!this.count) return 1;
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, len = Math.hypot(dx, dy, dz);
    if (!(len >= min) || len === 0) return 1;
    const ox = TANK.w / 2, oz = TANK.d / 2, gx = (x0 + ox) / CELL, gy = y0 / CELL, gz = (z0 + oz) / CELL;
    const ux = dx / CELL, uy = dy / CELL, uz = dz / CELL;
    let i = Math.floor(gx), j = Math.floor(gy), k = Math.floor(gz);
    let n = Math.abs(Math.floor((x1 + ox) / CELL) - i) + Math.abs(Math.floor(y1 / CELL) - j) + Math.abs(Math.floor((z1 + oz) / CELL) - k);
    const si = Math.sign(ux), sj = Math.sign(uy), sk = Math.sign(uz);
    const ddx = si ? 1 / Math.abs(ux) : Infinity, ddy = sj ? 1 / Math.abs(uy) : Infinity, ddz = sk ? 1 / Math.abs(uz) : Infinity;
    let tx = si > 0 ? (i + 1 - gx) / ux : si < 0 ? (i - gx) / ux : Infinity;
    let ty = sj > 0 ? (j + 1 - gy) / uy : sj < 0 ? (j - gy) / uy : Infinity;
    let tz = sk > 0 ? (k + 1 - gz) / uz : sk < 0 ? (k - gz) / uz : Infinity;
    let inside = this.cellSolid(i, j, k);
    for (; n > 0; n--) {
      let t;
      if (tx <= ty && tx <= tz) { t = tx; i += si; tx += ddx; } else if (ty <= tz) { t = ty; j += sj; ty += ddy; } else { t = tz; k += sk; tz += ddz; }
      if (!this.cellSolid(i, j, k)) inside = false;
      else if (!inside) {
        if (a) { const s = (this.sweepStats ??= {}); s[a.sp] = (s[a.sp] ?? 0) + 1; }
        return Math.max(0, Math.min(t, 1) - 0.05 / len);
      }
    }
    return 1;
  }
  cellSolid(i, j, k) { return i >= 0 && j >= 0 && k >= 0 && i < this.nx && j < this.ny && k < this.nz && this.data[this.idx(i, j, k)] !== 0; }
  // A walker's step (B4b): swept to where it will end: at its height if a piece is under the far end (it stays on the piece),
  // otherwise on the ground there (gy), as the walk code settles it. A sweep at the old height missed a step down through a corner.
  walkFree(a, x0, y0, z0, x1, gy, z1, lift = 0.5) {
    const y1 = y0 > gy + 0.05 && this.solidAt(x1, y0 - 0.5, z1) ? y0 : gy;
    return this.segmentFreeAt(a, x0, y0 + lift, z0, x1, y1 + lift, z1);
  }

  // The layer a body whose feet are at height `y` stands on in the cell at (x, z): the highest surface at most LAYER_TOL above its feet
  // (0, the ground, when there are no pieces or no layer map yet).
  layerAt(x, z, y) {
    const S = this.surf;
    if (!S) return 0;
    const i = S.ci(x), k = S.ck(z);
    if (!S.has(i, k)) return 0;
    const c = k * S.nx + i, m = S.n[c];
    let best = 0;
    for (let l = 1; l < m; l++) if (S.y[c * MAX_LAYERS + l] <= y + LAYER_TOL) best = l;
    return best;
  }

  // Can body `b` be in layer `l` of the cell at (x, z), its feet at height `y`? On the ground (layer 0) the voxels of the column are free from
  // its belly to the top of its back (the ground is a height field, not in the grid, and it is not flat across a cell: the feet's own height
  // is used, not the layer's); on a piece's top the room the layer was baked with (from the piece's exact top, where the voxels are the
  // piece's thickened shell) is at least its height. A body wider than the shells' one-cell thickening finds that room at its radius as
  // well. Outside the grid, or with no pieces: yes. No allocation.
  canOccupy(x, z, l, b = ANON, y = NaN) {
    const S = this.surf;
    if (!this.count || !S) return true;
    const i = S.ci(x), k = S.ck(z);
    if (!S.has(i, k)) return true;
    const c = k * S.nx + i;
    if (!(l >= 0 && l < S.n[c])) return false;
    // (from its belly, insideBody's lowest sample, to its height: every point insideBody looks at is in a cell tested here)
    const o = c * MAX_LAYERS + l, need = clearNeed(b), y0 = l === 0 && y === y ? y : S.y[o], lo = y0 + bellyOf(b), top = y0 + need;
    if (l === 0 ? !this.columnFree(x, z, lo, top) : S.clr[o] < need || this.runTop(x, z, S.y[o]) - S.y[o] > WALL_IN_CELL) return false;
    const rr = (b.rad ?? 0) - CELL;
    if (rr > 0.05 && (!this.roomAt(x + rr, z, y0, lo, top) || !this.roomAt(x - rr, z, y0, lo, top) || !this.roomAt(x, z + rr, y0, lo, top) || !this.roomAt(x, z - rr, y0, lo, top))) return false;
    return true;
  }

  // The top of the solid run of voxels at (x, z) that holds height y (y itself when the cell there is free). A piece's top layer is baked
  // from a ray at the cell's centre; the run above it is that surface's cell and its one-cell thickening, so at most WALL_IN_CELL higher.
  // Higher than that, something taller stands in the same cell (the side of a spire beside a low root): the layer is no floor there.
  runTop(x, z, y) {
    const i = this.cellX(x), k = this.cellZ(z);
    if (i < 0 || k < 0 || i >= this.nx || k >= this.nz) return y;
    let j = Math.max(0, this.cellY(y));
    if (!this.data[this.idx(i, j, k)]) return y;
    while (j + 1 < this.ny && this.data[this.idx(i, j + 1, k)]) j++;
    return (j + 1) * CELL;
  }

  // No solid cell in the column at (x, z) from height y0 to y1.
  columnFree(x, z, y0, y1) {
    const i = this.cellX(x), k = this.cellZ(z);
    if (i < 0 || k < 0 || i >= this.nx || k >= this.nz) return true;
    for (let j = Math.max(0, this.cellY(y0)), j1 = Math.min(this.ny - 1, this.cellY(y1)); j <= j1; j++) if (this.data[this.idx(i, j, k)]) return false;
    return true;
  }

  // Room for body `b` with its feet at height y at (x, z), wherever that is (a leaf in the air, a piece's top): the same column and layer test
  // as canOccupy (a perch spot, Animals.perchFits).
  roomFor(x, z, y, b = ANON) {
    if (!this.count || !this.surf) return true;
    return this.roomAt(x, z, y, y + bellyOf(b), y + clearNeed(b));
  }

  // Room in the column at (x, z) for a body's flank from its feet at y0 up to `top`: free voxels there, or a piece's top it stands level with.
  roomAt(x, z, y0, lo, top) {
    if (this.columnFree(x, z, lo, top)) return true;
    const S = this.surf, i = S.ci(x), k = S.ck(z);
    if (!S.has(i, k)) return true;
    const c = k * S.nx + i, m = S.n[c];
    for (let l = 1; l < m; l++) {
      const o = c * MAX_LAYERS + l;
      if (y0 >= S.y[o] - LAYER_TOL && top <= S.y[o] + S.clr[o]) return true;
    }
    return false;
  }

  // A cheap signature of the piece transforms: catches a piece that was dragged without a version bump.
  static signature(decor) {
    let s = decor.pieces.length;
    for (const p of decor.pieces) {
      const m = p.mesh;
      s += m.position.x * 1.7 + m.position.y * 2.3 + m.position.z * 3.1 + m.quaternion.x * 5 + m.quaternion.y * 7 + m.quaternion.z * 11 + m.quaternion.w * 13 + m.scale.x * 17 + m.scale.y * 19;
    }
    return s.toFixed(3);
  }

  stale(decor) {
    if (!decor) return false;
    return this.version !== decor.occupancyVersion || this.dims !== [TANK.w, TANK.h, TANK.d].join();
  }

  mark(i, j, k) {
    if (i < 0 || j < 0 || k < 0 || i >= this.nx || j >= this.ny || k >= this.nz) return;
    const n = this.idx(i, j, k);
    if (!this.data[n]) { this.data[n] = 1; this.count++; }
  }

  // Marks a cell and its six neighbours.
  thick(i, j, k) {
    this.mark(i, j, k);
    this.mark(i + 1, j, k); this.mark(i - 1, j, k);
    this.mark(i, j + 1, k); this.mark(i, j - 1, k);
    this.mark(i, j, k + 1); this.mark(i, j, k - 1);
  }

  rebuild(decor, pieceDefs) {
    if (this.dims !== [TANK.w, TANK.h, TANK.d].join()) this.resize();
    else { this.data.fill(0); this.count = 0; }
    this.version = decor.occupancyVersion;
    this.sig = Occupancy.signature(decor);
    this.shells = [];
    for (const piece of decor.pieces) {
      if (pieceDefs?.[piece.type]?.stamp) continue;       // stamped pieces are already part of the height field
      this.addPiece(piece);
      const g = piece.mesh.geometry;
      if (g.boundsTree) {
        const proxy = new THREE.Mesh(g, SHELL);
        proxy.matrixAutoUpdate = false; proxy.matrixWorldAutoUpdate = false;
        proxy.matrixWorld.copy(piece.mesh.matrixWorld);
        this.shells.push({ proxy, piece, box: new THREE.Box3().setFromObject(piece.mesh) });
      } else this.shells.push({ proxy: null, piece, box: new THREE.Box3().setFromObject(piece.mesh) });
    }
  }

  // Really inside a piece, not only in a solid cell: the cells are 1.5 cm and the shells are thickened by one, so a newt hiding under
  // a root or an isopod walking along it is "in" a solid cell while its body is outside the wood (it was moved out every tick, and
  // back to its hide by its brain: a body flickering 20-60 cm to and fro). In at least three of five directions the nearest face of
  // the shell is seen from behind (its outward normal points the way the ray goes): the point is under that surface. Counting crossings
  // instead was fooled by open and hollow meshes (a root's cavity, an unclosed log): a skink standing on bark read as inside the log.
  // A piece without a BVH: the cell decides. `skip`: a piece not to test (the one a frog is clinging to).
  // A body standing at (x, y0, z), h tall: inside at its belly (0.5 cm up, a small one at its middle), its middle or its back (a frog
  // under a root lying 0.6 cm off the ground has its belly clear and its back in the wood; a fruit fly is all below 0.5 cm).
  insideBody(x, y0, z, h = 0.5) {
    return this.inside(x, y0 + Math.min(0.5, h * 0.5), z) || (h > 1 && this.inside(x, y0 + h * 0.5, z)) || (h > 0.6 && this.inside(x, y0 + h * 0.8, z));
  }

  inside(x, y, z, skip = null) {
    if (!this.solidAt(x, y, z)) return false;
    if (!this.shells) return true;
    for (const s of this.shells) {
      if (s.piece === skip && skip || !s.box.containsPoint(P.set(x, y, z))) continue;
      if (!s.proxy) return true;
      let back = 0;
      for (let k = 0; k < DIRS.length && back < 3 && back + DIRS.length - k >= 3; k++) {
        RAY1.set(P.set(x, y, z), DIRS[k]); RAY1.near = 0; RAY1.far = 400;
        const h = RAY1.intersectObject(s.proxy, false)[0];
        if (h && N.copy(h.face.normal).transformDirection(s.proxy.matrixWorld).dot(DIRS[k]) > 0) back++;
      }
      if (back >= 3) return true;
    }
    return false;
  }

  // The real top of the pieces under (x, z) at or below `y`: the highest upward-facing face a ray down meets there, or -Infinity. The layer
  // map is baked at each cell's centre; a body's contact with bark or stone is here (Animals.standOn).
  topBelow(x, z, y) {
    let best = -Infinity;
    for (const s of this.shells ?? []) {
      if (!s.proxy || x < s.box.min.x || x > s.box.max.x || z < s.box.min.z || z > s.box.max.z || s.box.min.y > y) continue;
      RAY.set(P.set(x, Math.min(y, s.box.max.y + 0.1), z), DOWN); RAY.near = 0; RAY.far = 400;
      for (const h of RAY.intersectObject(s.proxy, false)) {
        if (h.point.y <= best) break;
        if (N.copy(h.face.normal).transformDirection(s.proxy.matrixWorld).y > 0) { best = h.point.y; break; }
      }
    }
    return best;
  }

  // The index of the layer of the cell at (x, z) whose surface is nearest height y (0 with no layer map).
  nearestLayer(x, z, y) {
    const S = this.surf;
    if (!S) return 0;
    const i = S.ci(x), k = S.ck(z);
    if (!S.has(i, k)) return 0;
    const c = k * S.nx + i, m = S.n[c];
    let best = 0, bd = Infinity;
    for (let l = 0; l < m; l++) { const d = Math.abs(S.y[c * MAX_LAYERS + l] - y); if (d < bd) { bd = d; best = l; } }
    return best;
  }

  addPiece(piece) {
    const mesh = piece.mesh;
    mesh.updateMatrixWorld(true);
    const geo = mesh.geometry;
    const pos = geo.attributes.position;
    const index = geo.index;
    const tri = index ? index.count / 3 : pos.count / 3;
    const surface = new Set();
    const mw = mesh.matrixWorld;
    for (let t = 0; t < tri; t++) {
      const a = index ? index.getX(t * 3) : t * 3, b = index ? index.getX(t * 3 + 1) : t * 3 + 1, c = index ? index.getX(t * 3 + 2) : t * 3 + 2;
      A.fromBufferAttribute(pos, a).applyMatrix4(mw);
      B.fromBufferAttribute(pos, b).applyMatrix4(mw);
      Cc.fromBufferAttribute(pos, c).applyMatrix4(mw);
      const e = Math.max(A.distanceTo(B), B.distanceTo(Cc), Cc.distanceTo(A));
      const n = Math.min(40, Math.max(1, Math.ceil(e / (CELL * 0.6))));
      for (let u = 0; u <= n; u++) for (let v = 0; v <= n - u; v++) {
        const w = n - u - v;
        P.set((A.x * u + B.x * v + Cc.x * w) / n, (A.y * u + B.y * v + Cc.y * w) / n, (A.z * u + B.z * v + Cc.z * w) / n);
        surface.add((this.cellX(P.x) + 1000) * 4000000 + (this.cellY(P.y) + 1000) * 2000 + (this.cellZ(P.z) + 1000));
      }
    }
    for (const key of surface) {
      const i = Math.floor(key / 4000000) - 1000, j = Math.floor((key % 4000000) / 2000) - 1000, k = (key % 2000) - 1000;
      this.thick(i, j, k);
    }
    this.fill(mesh);
  }

  // Fill closed volumes: cast down each column and fill between the 1st and 2nd, 3rd and 4th ... hits.
  fill(mesh) {
    const geo = mesh.geometry;
    if (!geo.boundsTree) return;
    const proxy = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    proxy.matrixAutoUpdate = false; proxy.matrixWorldAutoUpdate = false;
    proxy.matrixWorld.copy(mesh.matrixWorld);
    const ray = new THREE.Raycaster();
    ray.firstHitOnly = false;
    const box = new THREE.Box3().setFromObject(mesh);
    const i0 = Math.max(0, this.cellX(box.min.x)), i1 = Math.min(this.nx - 1, this.cellX(box.max.x));
    const k0 = Math.max(0, this.cellZ(box.min.z)), k1 = Math.min(this.nz - 1, this.cellZ(box.max.z));
    const down = new THREE.Vector3(0, -1, 0), o = new THREE.Vector3();
    for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) {
      ray.set(o.set(this.worldX(i), box.max.y + 1, this.worldZ(k)), down);
      const hits = ray.intersectObject(proxy, false);
      if (hits.length < 2 || hits.length % 2) continue;
      hits.sort((p, q) => q.point.y - p.point.y);
      for (let h = 0; h + 1 < hits.length; h += 2) {
        const j1 = this.cellY(hits[h].point.y), j0 = this.cellY(hits[h + 1].point.y);
        for (let j = j0; j <= j1; j++) this.mark(i, j, k);
      }
    }
    proxy.material.dispose();
  }

  // The layers a body can stand on, per cell (sim/surfaces.js), baked from the pieces as they are now: each column's solid stretches give the
  // tops of the pieces, and the exact top and its normal come from a ray down onto the piece's mesh (the voxels are CELL thick and thickened
  // by a cell, so a log's top read from them alone is up to 1.5 cm too high). `groundAt(x, z)` is the ground's height. One map, kept and
  // refilled; a column with nothing solid in it costs one height lookup, so a tank with few pieces bakes in a few milliseconds.
  bakeSurfaces(groundAt) {
    const sm = this.surf && this.surf.nx === this.nx && this.surf.nz === this.nz ? this.surf : (this.surf = new SurfaceMap(-TANK.w / 2, -TANK.d / 2, CELL, this.nx, this.nz));
    const down = new THREE.Vector3(0, -1, 0), o = new THREE.Vector3(), nrm = new THREE.Vector3(), shells = this.shells ?? [];
    for (let k = 0; k < this.nz; k++) for (let i = 0; i < this.nx; i++) {
      const x = this.worldX(i), z = this.worldZ(k), runs = [];
      if (this.count) {
        for (let j = 0, j0 = -1; j <= this.ny; j++) {
          const solid = j < this.ny && this.data[this.idx(i, j, k)] !== 0;
          if (solid && j0 < 0) j0 = j;
          else if (!solid && j0 >= 0) { runs.push([j0 * CELL, j * CELL]); j0 = -1; }
        }
      }
      const topAt = (run) => {
        // the highest hit of a ray down the column that lies within a cell of the run (a piece's top; not another piece's, nor the underside)
        let best = null;
        for (const sh of shells) {
          if (!sh.proxy || x < sh.box.min.x || x > sh.box.max.x || z < sh.box.min.z || z > sh.box.max.z) continue;
          RAY.set(o.set(x, run[1] + 1, z), down); RAY.near = 0; RAY.far = run[1] - run[0] + 3;
          for (const h of RAY.intersectObject(sh.proxy, false)) {
            if (h.point.y > run[1] + CELL || h.point.y < run[0] - CELL || (best && h.point.y <= best.y)) continue;
            nrm.copy(h.face.normal).transformDirection(sh.proxy.matrixWorld);
            if (nrm.y < 0) nrm.negate();
            best = { y: h.point.y, n: [nrm.x, nrm.y, nrm.z] };
          }
        }
        return best ?? { y: run[1] - CELL * 0.5, n: [0, 1, 0] };
      };
      sm.set(i, k, layersOf(groundAt(x, z), runs, TANK.h, topAt));
    }
    return sm;
  }

  // The nearest cell centre (within `maxR` cells) that is free and accepted by `ok(x, y, z)`; null if none.
  nearestFree(x, y, z, ok = null, maxR = 10) {
    const i0 = this.cellX(x), j0 = this.cellY(y), k0 = this.cellZ(z);
    let best = null, bd = Infinity;
    for (let r = 0; r <= maxR; r++) {
      if (best && r * CELL > Math.sqrt(bd) + CELL) break;
      for (let dk = -r; dk <= r; dk++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj), Math.abs(dk)) !== r) continue;
        const i = i0 + di, j = j0 + dj, k = k0 + dk;
        if (i < 0 || j < 0 || k < 0 || i >= this.nx || j >= this.ny || k >= this.nz) continue;
        if (this.data[this.idx(i, j, k)]) continue;
        const wx = this.worldX(i), wy = this.worldY(j), wz = this.worldZ(k);
        if (ok && !ok(wx, wy, wz)) continue;
        const d = (wx - x) ** 2 + (wy - y) ** 2 + (wz - z) ** 2;
        if (d < bd) { bd = d; best = [wx, wy, wz]; }
      }
    }
    return best;
  }
}
