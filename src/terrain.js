// Substrate (a heightfield over the tank floor) and the background wall (a
// relief over the back glass). Both are sculpted and painted with the same
// brush code, so they share the Field class.

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
    this.mat = new Float32Array(this.cols * this.rows * NMAT);
    this.dirty = true;
  }

  idx(i, j) { return j * this.cols + i; }

  get(i, j) {
    i = clamp(i, 0, this.nx); j = clamp(j, 0, this.ny);
    return this.h[j * this.cols + i];
  }

  toGrid(a, b) { return [(a - this.oa) / this.da, (b - this.ob) / this.db]; }
  toWorld(i, j) { return [this.oa + i * this.da, this.ob + j * this.db]; }

  sample(a, b) {
    let [fi, fj] = this.toGrid(a, b);
    fi = clamp(fi, 0, this.nx - 1e-4); fj = clamp(fj, 0, this.ny - 1e-4);
    const i = Math.floor(fi), j = Math.floor(fj);
    const u = fi - i, v = fj - j;
    const h00 = this.get(i, j), h10 = this.get(i + 1, j), h01 = this.get(i, j + 1), h11 = this.get(i + 1, j + 1);
    return (h00 * (1 - u) + h10 * u) * (1 - v) + (h01 * (1 - u) + h11 * u) * v;
  }

  // Dominant material weight at a point.
  matAt(a, b, k) {
    let [fi, fj] = this.toGrid(a, b);
    const i = clamp(Math.round(fi), 0, this.nx), j = clamp(Math.round(fj), 0, this.ny);
    return this.mat[(j * this.cols + i) * NMAT + k];
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

  // Applies a brush around (a, b). `strength` is per call.
  brush(a, b, radius, op, strength, opt = {}) {
    const [ci, cj] = this.toGrid(a, b);
    const ri = Math.ceil(radius / this.da) + 1, rj = Math.ceil(radius / this.db) + 1;
    const i0 = Math.max(0, Math.floor(ci - ri)), i1 = Math.min(this.nx, Math.ceil(ci + ri));
    const j0 = Math.max(0, Math.floor(cj - rj)), j1 = Math.min(this.ny, Math.ceil(cj + rj));
    let avg = 0;
    if (op === 'smooth') {
      // Average over the brush, used as a pull target.
      let n = 0;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { avg += this.h[this.idx(i, j)]; n++; }
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
        if (op === 'raise') this.h[n] = Math.min(this.maxH, this.h[n] + strength * f);
        else if (op === 'lower') this.h[n] = Math.max(0.3, this.h[n] - strength * f);
        else if (op === 'smooth') {
          const nb = (this.get(i - 1, j) + this.get(i + 1, j) + this.get(i, j - 1) + this.get(i, j + 1)) * 0.25;
          this.h[n] += (nb * 0.7 + avg * 0.3 - this.h[n]) * Math.min(1, strength * 0.25) * f;
        } else if (op === 'flatten') this.h[n] += (target - this.h[n]) * Math.min(1, strength * 0.2) * f;
        else if (op === 'paint') {
          const k = opt.mat;
          const amt = Math.min(1, strength * 0.35 * f);
          let sum = 0;
          for (let m = 0; m < NMAT; m++) {
            const o = n * NMAT + m;
            this.mat[o] = this.mat[o] * (1 - amt) + (m === k ? amt : 0);
            sum += this.mat[o];
          }
          if (sum > 0) for (let m = 0; m < NMAT; m++) this.mat[n * NMAT + m] /= sum;
        }
      }
    }
    this.dirty = true;
  }

  // Writes the six material weights of vertex n into two vec3 attributes.
  weightsTo(n, w0, w1, v) {
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
      let k = 1;
      if (MATERIALS[m].id === 'gravel') k = 0.6 + hn * 0.9;
      else if (MATERIALS[m].id === 'moss') k = 0.75 + hash3(wb, wa, 3.1) * 0.5;
      else if (MATERIALS[m].id === 'rock') k = 0.8 + hn * 0.35;
      else k = 0.9 + hn * 0.2;
      r += c[0] * w * k; g += c[1] * w * k; b += c[2] * w * k;
    }
    out.setRGB(r + extra, g + extra, b + extra);
    return out;
  }

  serialize() {
    const hq = new Uint16Array(this.h.length);
    for (let i = 0; i < this.h.length; i++) hq[i] = Math.round(clamp(this.h[i], 0, 600) * 100);
    const mq = new Uint8Array(this.mat.length);
    for (let i = 0; i < this.mat.length; i++) mq[i] = Math.round(this.mat[i] * 255);
    return { h: b64(hq.buffer), m: b64(mq.buffer) };
  }

  deserialize(o) {
    const hq = new Uint16Array(unb64(o.h));
    const mq = new Uint8Array(unb64(o.m));
    if (hq.length !== this.h.length || mq.length !== this.mat.length) return false;
    for (let i = 0; i < hq.length; i++) this.h[i] = hq[i] / 100;
    for (let i = 0; i < mq.length; i++) this.mat[i] = mq[i] / 255;
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

// The substrate: y = h(x, z).
export class Terrain {
  constructor(scene) {
    const { nx, nz } = TERRAIN_RES;
    this.field = new Field(nx, nz, TANK.w - MARGIN * 2, TANK.d - MARGIN * 2, -TANK.w / 2 + MARGIN, -TANK.d / 2 + MARGIN, TANK.h - 8);
    const g = new THREE.PlaneGeometry(1, 1, nx, nz);
    g.rotateX(-Math.PI / 2);
    // PlaneGeometry after rotation runs x left→right and z back→front with
    // row 0 at the back, matching the field layout.
    const nv = (nx + 1) * (nz + 1);
    g.setAttribute('w0', new THREE.Float32BufferAttribute(new Float32Array(nv * 3), 3));
    g.setAttribute('w1', new THREE.Float32BufferAttribute(new Float32Array(nv * 3), 3));
    this.geo = g;
    this.mesh = new THREE.Mesh(g, substrateMaterial());
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = true;
    this.mesh.name = 'terrain';
    this.mesh.userData.surface = 'terrain';
    scene.add(this.mesh);
    this.flatDefault();
  }

  flatDefault() {
    this.field.h.fill(3);
    this.field.setMaterial(MAT.gravel);
  }

  heightAt(x, z) { return this.field.sample(x, z); }

  normalAt(x, z) {
    const [gx, gz] = this.field.gradient(x, z);
    return new THREE.Vector3(-gx, 1, -gz).normalize();
  }

  update(waterLevel) {
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
    // Plane rows run top→bottom; we rewrite every vertex in update() using
    // our own (i, j) → index mapping, so fix the index order here once.
    this.geo = g;
    this.mesh = new THREE.Mesh(g, substrateMaterial());
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = true;
    this.mesh.name = 'wall';
    this.mesh.userData.surface = 'wall';
    scene.add(this.mesh);
    this.field.h.fill(0.6);
    this.field.setMaterial(MAT.cork);
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

  // World-space point on the wall surface for field coords.
  fieldIndexFromWorld(x, y) {
    const [fi, fj] = this.field.toGrid(x, y);
    return [Math.round(fi), Math.round(fj)];
  }
}

export { smooth };
