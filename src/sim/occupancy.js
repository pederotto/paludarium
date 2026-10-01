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

export const CELL = 1.5;

const A = new THREE.Vector3(), B = new THREE.Vector3(), Cc = new THREE.Vector3(), P = new THREE.Vector3();

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
    for (const piece of decor.pieces) {
      if (pieceDefs?.[piece.type]?.stamp) continue;       // stamped pieces are already part of the height field
      this.addPiece(piece);
    }
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
