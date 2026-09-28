// Substrate (a heightfield over the tank floor) and the background wall (a
// relief over the back glass). Both are sculpted and painted with the same
// brush code, so they share the Field class.
//
// The substrate keeps two heights per point: `base`, the ground you sculpt,
// and `h`, what everything else sees: the ground with the hardscape stamped
// on top (the highest of the two). Moving or removing a rock simply stamps
// the pieces again over the untouched base.

import * as THREE from 'three/webgpu';
import { TANK, TERRAIN_RES, WALL_RES, WALL_MAX_DEPTH, MATERIALS, NMAT, MAT } from './config.js';
import { substrateMaterial } from './shaders.js';
import { hash3, clamp, smooth } from './geo.js';

export class Field {
  // (a, b) are the two plane axes in world units; h is the height/offset.
  constructor(nx, ny, sizeA, sizeB, originA, originB, maxH) {
    this.nx = nx; this.ny = ny;
    this.cols = nx + 1; this.rows = ny + 1;
    this.sizeA = sizeA; this.sizeB = sizeB;
    this.oa = originA; this.ob = originB;
    this.maxH = maxH;
    this.da = sizeA / nx; this.db = sizeB / ny;
    this.h = new Float32Array(this.cols * this.rows);
    this.base = this.h;        // the wall has no stamps: both are the same array
    this.stamped = null;       // Uint8Array on the substrate: 1 under hardscape
    this.mat = new Float32Array(this.cols * this.rows * NMAT);
    this.dirty = true;
  }

  idx(i, j) { return j * this.cols + i; }

  get(i, j, arr = this.h) {
    i = clamp(i, 0, this.nx); j = clamp(j, 0, this.ny);
    return arr[j * this.cols + i];
  }

  toGrid(a, b) { return [(a - this.oa) / this.da, (b - this.ob) / this.db]; }
  toWorld(i, j) { return [this.oa + i * this.da, this.ob + j * this.db]; }

  sample(a, b, arr = this.h) {
    let [fi, fj] = this.toGrid(a, b);
    fi = clamp(fi, 0, this.nx - 1e-4); fj = clamp(fj, 0, this.ny - 1e-4);
    const i = Math.floor(fi), j = Math.floor(fj);
    const u = fi - i, v = fj - j;
    const c = this.cols;
    const h00 = arr[j * c + i], h10 = arr[j * c + i + 1], h01 = arr[(j + 1) * c + i], h11 = arr[(j + 1) * c + i + 1];
    return (h00 * (1 - u) + h10 * u) * (1 - v) + (h01 * (1 - u) + h11 * u) * v;
  }

  // Material weight at a point (stone under the hardscape).
  matAt(a, b, k) {
    const [fi, fj] = this.toGrid(a, b);
    const i = clamp(Math.round(fi), 0, this.nx), j = clamp(Math.round(fj), 0, this.ny);
    const n = j * this.cols + i;
    if (this.stamped?.[n]) return k === MAT.rock ? 1 : 0;
    return this.mat[n * NMAT + k];
  }

  gradient(a, b) {
    const e = this.da;
    return [
      (this.sample(a + e, b) - this.sample(a - e, b)) / (2 * e),
      (this.sample(a, b + e) - this.sample(a, b - e)) / (2 * e),
    ];
  }

  setMaterial(k, mask = null) {
    for (let n = 0; n < this.cols * this.rows; n++) {
      if (mask && !mask(n)) continue;
      for (let m = 0; m < NMAT; m++) this.mat[n * NMAT + m] = m === k ? 1 : 0;
    }
    this.dirty = true;
  }

  // Adds `amt` of material k at vertex n (weights stay normalised).
  paintAt(n, k, amt) {
    let sum = 0;
    for (let m = 0; m < NMAT; m++) {
      const o = n * NMAT + m;
      this.mat[o] = this.mat[o] * (1 - amt) + (m === k ? amt : 0);
      sum += this.mat[o];
    }
    if (sum > 0) for (let m = 0; m < NMAT; m++) this.mat[n * NMAT + m] /= sum;
  }

  // Applies a brush around (a, b) to the base heights. `strength` is per call.
  brush(a, b, radius, op, strength, opt = {}) {
    const B = this.base;
    const [ci, cj] = this.toGrid(a, b);
    const ri = Math.ceil(radius / this.da) + 1, rj = Math.ceil(radius / this.db) + 1;
    const i0 = Math.max(0, Math.floor(ci - ri)), i1 = Math.min(this.nx, Math.ceil(ci + ri));
    const j0 = Math.max(0, Math.floor(cj - rj)), j1 = Math.min(this.ny, Math.ceil(cj + rj));
    let avg = 0;
    if (op === 'smooth') {
      // Average over the brush, used as a pull target.
      let n = 0;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { avg += B[this.idx(i, j)]; n++; }
      avg /= Math.max(1, n);
    }
    const target = opt.target ?? 0;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const [wa, wb] = this.toWorld(i, j);
        const d = Math.hypot(wa - a, wb - b) / radius;
        if (d >= 1) continue;
        const f = (1 - d * d) * (1 - d * d); // soft falloff
        const n = this.idx(i, j);
        if (op === 'raise') B[n] = Math.min(this.maxH, B[n] + strength * f);
        else if (op === 'lower') B[n] = Math.max(0.3, B[n] - strength * f);
        else if (op === 'smooth') {
          const nb = (this.get(i - 1, j, B) + this.get(i + 1, j, B) + this.get(i, j - 1, B) + this.get(i, j + 1, B)) * 0.25;
          B[n] += (nb * 0.7 + avg * 0.3 - B[n]) * Math.min(1, strength * 0.25) * f;
        } else if (op === 'flatten') B[n] += (target - B[n]) * Math.min(1, strength * 0.2) * f;
        else if (op === 'paint') this.paintAt(n, opt.mat, Math.min(1, strength * 0.35 * f));
      }
    }
    this.dirty = true;
  }

  // Writes the six material weights of vertex n into two vec3 attributes.
  weightsTo(n, w0, w1, v) {
    if (this.stamped?.[n]) { w0.setXYZ(v, 0, 0, 0); w1.setXYZ(v, 1, 0, 0); return; }
    const o = n * NMAT;
    w0.setXYZ(v, this.mat[o], this.mat[o + 1], this.mat[o + 2]);
    w1.setXYZ(v, this.mat[o + 3], this.mat[o + 4], this.mat[o + 5]);
  }

  colorAt(n, out, extra = 0) {
    let r = 0, g = 0, b = 0;
    const [wa, wb] = [n % this.cols, Math.floor(n / this.cols)];
    const hn = hash3(wa * 1.7, wb * 2.3, this.h[n]);
    for (let m = 0; m < NMAT; m++) {
      const w = this.mat[n * NMAT + m];
      if (!w) continue;
      const c = MATERIALS[m].color;
      const k = 0.9 + hn * 0.2;
      r += c[0] * w * k; g += c[1] * w * k; b += c[2] * w * k;
    }
    out.setRGB(r + extra, g + extra, b + extra);
    return out;
  }

  snapshot() { return { base: this.base.slice(), mat: this.mat.slice() }; }
  restoreSnapshot(s) {
    this.base.set(s.base);
    this.mat.set(s.mat);
    this.dirty = true;
  }

  serialize() {
    const hq = new Uint16Array(this.base.length);
    for (let i = 0; i < this.base.length; i++) hq[i] = Math.round(clamp(this.base[i], 0, 600) * 100);
    const mq = new Uint8Array(this.mat.length);
    for (let i = 0; i < this.mat.length; i++) mq[i] = Math.round(this.mat[i] * 255);
    return { h: b64(hq.buffer), m: b64(mq.buffer) };
  }

  deserialize(o) {
    const hq = new Uint16Array(unb64(o.h));
    const mq = new Uint8Array(unb64(o.m));
    if (hq.length !== this.base.length || mq.length !== this.mat.length) return false;
    for (let i = 0; i < hq.length; i++) this.base[i] = hq[i] / 100;
    for (let i = 0; i < mq.length; i++) this.mat[i] = mq[i] / 255;
    if (this.base !== this.h) this.h.set(this.base);
    this.dirty = true;
    return true;
  }
}

function b64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(str) {
  const s = atob(str);
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b.buffer;
}

const MARGIN = 0.02;

// Evenly spaced points along a polyline (x, z).
export function resample(pts, step) {
  const out = [new THREE.Vector3(pts[0].x, 0, pts[0].z)];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 1e-6) continue;
    let t = step - carry;
    while (t <= len) {
      out.push(new THREE.Vector3(a.x + ((b.x - a.x) * t) / len, 0, a.z + ((b.z - a.z) * t) / len));
      t += step;
    }
    carry = len - (t - step);
  }
  const last = pts[pts.length - 1];
  if (out.length < 2 || Math.hypot(out[out.length - 1].x - last.x, out[out.length - 1].z - last.z) > step * 0.3) out.push(new THREE.Vector3(last.x, 0, last.z));
  return out;
}

// The substrate: y = h(x, z).
export class Terrain {
  constructor(scene) {
    const { nx, nz } = TERRAIN_RES;
    this.field = new Field(nx, nz, TANK.w - MARGIN * 2, TANK.d - MARGIN * 2, -TANK.w / 2 + MARGIN, -TANK.d / 2 + MARGIN, TANK.h - 8);
    const nv = (nx + 1) * (nz + 1);
    this.field.base = new Float32Array(nv);
    this.field.stamped = new Uint8Array(nv);
    const g = new THREE.PlaneGeometry(1, 1, nx, nz);
    g.rotateX(-Math.PI / 2);
    // PlaneGeometry after rotation runs x left→right and z back→front with
    // row 0 at the back, matching the field layout.
    g.setAttribute('w0', new THREE.Float32BufferAttribute(new Float32Array(nv * 3), 3));
    g.setAttribute('w1', new THREE.Float32BufferAttribute(new Float32Array(nv * 3), 3));
    // Surface of any water over this point (pools and streams), for shading.
    const ws = new THREE.Float32BufferAttribute(new Float32Array(nv).fill(-50), 1);
    ws.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('wsurf', ws);
    this.geo = g;
    this.mesh = new THREE.Mesh(g, substrateMaterial({ perVertexWater: true }));
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = true;
    this.mesh.name = 'terrain';
    this.mesh.userData.surface = 'terrain';
    scene.add(this.mesh);
    this.stamps = [];
    this.flatDefault();
  }

  flatDefault() {
    this.field.base.fill(3);
    this.field.setMaterial(MAT.gravel);
    this.compose([]);
  }

  // h = the base ground with every piece's stamp on top.
  compose(stamps = this.stamps) {
    this.stamps = stamps;
    const f = this.field;
    f.h.set(f.base);
    f.stamped.fill(0);
    for (const s of stamps) {
      if (!s) continue;
      for (let k = 0; k < s.idx.length; k++) {
        const n = s.idx[k];
        if (s.top[k] > f.h[n]) {
          f.h[n] = s.top[k];
          if (s.top[k] > f.base[n] + 0.4) f.stamped[n] = 1;
        }
      }
    }
    f.dirty = true;
  }

  heightAt(x, z) { return this.field.sample(x, z); }
  baseAt(x, z) { return this.field.sample(x, z, this.field.base); }

  normalAt(x, z) {
    const [gx, gz] = this.field.gradient(x, z);
    return new THREE.Vector3(-gx, 1, -gz).normalize();
  }

  update() {
    if (!this.field.dirty) return false;
    const f = this.field;
    const pa = this.geo.attributes.position;
    const w0 = this.geo.attributes.w0, w1 = this.geo.attributes.w1;
    for (let j = 0; j <= f.ny; j++) {
      for (let i = 0; i <= f.nx; i++) {
        const n = f.idx(i, j);
        const [x, z] = f.toWorld(i, j);
        pa.setXYZ(n, x, f.h[n], z);
        f.weightsTo(n, w0, w1, n);
      }
    }
    pa.needsUpdate = true;
    w0.needsUpdate = true;
    w1.needsUpdate = true;
    this.geo.computeVertexNormals();
    this.geo.computeBoundingSphere();
    this.geo.computeBoundingBox();
    f.dirty = false;
    return true;
  }

  // --- Waterway tools ---------------------------------------------------------
  // Visits every vertex within `reach` of the polyline P, with its distance
  // to the path and the (fractional) index of the nearest path point.
  alongPath(P, reach, fn) {
    const f = this.field;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of P) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    const [i0, j0] = f.toGrid(x0 - reach, z0 - reach).map(Math.floor);
    const [i1, j1] = f.toGrid(x1 + reach, z1 + reach).map(Math.ceil);
    for (let j = Math.max(0, j0); j <= Math.min(f.ny, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(f.nx, i1); i++) {
      const [x, z] = f.toWorld(i, j);
      let bd = Infinity, bt = 0;
      for (let k = 0; k < P.length - 1; k++) {
        const a = P[k], b = P[k + 1];
        const ex = b.x - a.x, ez = b.z - a.z;
        const L2 = ex * ex + ez * ez || 1e-6;
        const t = clamp(((x - a.x) * ex + (z - a.z) * ez) / L2, 0, 1);
        const d = Math.hypot(x - a.x - ex * t, z - a.z - ez * t);
        if (d < bd) { bd = d; bt = k + t; }
      }
      if (bd < reach) fn(f.idx(i, j), bd, bt);
    }
    f.dirty = true;
  }

  // A stream bed along the drawn path. The bed always runs downhill from
  // the first point to the last (cutting through rises on the way), with a
  // rounded cross-section and pebbles on the bottom. Where the path crosses
  // a slope, low banks are built up on the downhill side so the stream
  // doesn't spill out of its bed.
  carveChannel(pts, width = 2.5, depth = 1.2) {
    if (pts.length < 2) return;
    const P = resample(pts, 0.4);
    const bed = new Float32Array(P.length);
    for (let i = 0; i < P.length; i++) {
      const want = this.baseAt(P[i].x, P[i].z) - depth;
      bed[i] = Math.max(0.4, i ? Math.min(bed[i - 1] - 0.012, want) : want);
    }
    const B = this.field.base;
    const W = width;
    this.alongPath(P, W * 1.7, (n, r, t) => {
      const k = Math.min(P.length - 1, Math.floor(t)), u = t - k;
      const b = bed[k] * (1 - u) + bed[Math.min(P.length - 1, k + 1)] * u;
      const prof = b + depth * Math.min(1.6, (r / W) ** 2);
      const s = smooth(W, W * 1.7, r);
      const target = prof * (1 - s) + B[n] * s;
      if (target < B[n]) B[n] = target;
      else if (r > W * 0.75 && k > 1 && t < P.length - 1 - (W * 2) / 0.4) {
        // Levee: at least as high as the water would be.
        const levee = b + depth * 1.05 * (1 - smooth(W * 1.25, W * 1.7, r));
        if (levee > B[n]) B[n] = levee;
      }
      if (r < W * 0.8) this.field.paintAt(n, MAT.sand, 0.7 * (1 - r / (W * 0.8)));
    });
  }

  // A round pool: a bowl `depth` deep with a raised lip all round, built
  // up on the downhill side, so it holds water even on a slope. The water
  // stands level with the ground where you clicked.
  digBasin(x, z, R = 5, depth = 2.5) {
    const B = this.field.base;
    const g = this.baseAt(x, z);
    this.alongPath([new THREE.Vector3(x, 0, z), new THREE.Vector3(x + 1e-3, 0, z)], R * 1.7, (n, r) => {
      if (r < R) {
        B[n] = g - depth * (1 - (r / R) ** 2);
        if (r < R * 0.7) this.field.paintAt(n, MAT.sand, 0.5);
      } else {
        // The lip, then a bank sloping back down to the old ground.
        const u = (r - R) / (R * 0.7);
        const lip = g + 0.6 + 0.4 * Math.sin(Math.PI * Math.min(1, u * 1.6)) - Math.max(0, u - 0.4) * depth * 2;
        if (lip > B[n]) B[n] = lip;
      }
    });
  }

  // A raised bank along the path (to hold water in, or to steer a stream).
  raiseBank(pts, width = 2.5, height = 2) {
    if (pts.length < 2) return;
    const P = resample(pts, 0.4);
    const top = P.map((p) => this.baseAt(p.x, p.z) + height);
    const B = this.field.base;
    this.alongPath(P, width, (n, r, t) => {
      const k = Math.min(P.length - 1, Math.round(t));
      const v = top[k] - height * (r / width) ** 2;
      if (v > B[n]) B[n] = v;
    });
  }
}

// The background wall: z = -D/2 + depth(x, y).
export class Wall {
  constructor(scene) {
    const { nx, ny } = WALL_RES;
    this.field = new Field(nx, ny, TANK.w - MARGIN * 2, TANK.h, -TANK.w / 2 + MARGIN, 0, WALL_MAX_DEPTH);
    const g = new THREE.PlaneGeometry(1, 1, nx, ny);
    const nv = (nx + 1) * (ny + 1);
    g.setAttribute('w0', new THREE.Float32BufferAttribute(new Float32Array(nv * 3), 3));
    g.setAttribute('w1', new THREE.Float32BufferAttribute(new Float32Array(nv * 3), 3));
    // Plane rows run top→bottom; update() rewrites every vertex using our
    // own (i, j) → index mapping.
    this.geo = g;
    this.mesh = new THREE.Mesh(g, substrateMaterial());
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = true;
    this.mesh.name = 'wall';
    this.mesh.userData.surface = 'wall';
    scene.add(this.mesh);
    this.field.h.fill(0.6);
    this.field.setMaterial(MAT.stone);
  }

  zAt(x, y) { return -TANK.d / 2 + this.field.sample(x, y); }

  update() {
    if (!this.field.dirty) return false;
    const f = this.field;
    const pa = this.geo.attributes.position;
    const w0 = this.geo.attributes.w0, w1 = this.geo.attributes.w1;
    for (let j = 0; j <= f.ny; j++) {
      for (let i = 0; i <= f.nx; i++) {
        const n = f.idx(i, j);
        const [x, y] = f.toWorld(i, j);
        // PlaneGeometry vertex (i, row) where row 0 is the top.
        const v = (f.ny - j) * f.cols + i;
        pa.setXYZ(v, x, y, -TANK.d / 2 + f.h[n]);
        f.weightsTo(n, w0, w1, v);
      }
    }
    pa.needsUpdate = true;
    w0.needsUpdate = true;
    w1.needsUpdate = true;
    this.geo.computeVertexNormals();
    this.geo.computeBoundingSphere();
    this.geo.computeBoundingBox();
    f.dirty = false;
    return true;
  }
}

export { smooth };
