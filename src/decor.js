// Hardscape and ground cover:
//  - Rocks you place. The boulder shapes are adapted from SeedThree's
//    rocks.js (MIT, https://github.com/SkyeShark/SeedThree): welded,
//    noise-displaced icosahedra textured by triplanar projection. A placed
//    rock is also stamped into the substrate heightfield, so animals walk
//    over it and water pools around it.
//  - Moss tufts, scattered automatically wherever moss is painted.

import * as THREE from 'three/webgpu';
import { texture, triplanarTexture, float, vec3, vec4, normalView, normalize, cameraViewMatrix, positionWorld, smoothstep, normalWorld } from 'three/tsl';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { TEX } from './assets.js';
import { plantMaterial, U, causticsAt } from './shaders.js';
import { MAT, NMAT, TANK } from './config.js';
import { rng, clamp } from './geo.js';

function displaceRock(rawGeo, r, squash) {
  const geo = mergeVertices(rawGeo);
  rawGeo.dispose();
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  const waves = Array.from({ length: 4 }, () => ({
    dir: new THREE.Vector3(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).normalize(),
    freq: 1 + r() * 1.4,
    amp: 0.05 + r() * 0.08,
    phase: r() * Math.PI * 2,
  }));
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    const n = v.clone().normalize();
    let d = 1;
    for (const w of waves) d += w.amp * Math.sin(n.dot(w.dir) * w.freq * Math.PI + w.phase);
    v.copy(n).multiplyScalar(d);
    v.y *= squash;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

function rockMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0 });
  m.shadowSide = THREE.BackSide;
  const scale = float(1 / 14);
  const col = triplanarTexture(texture(TEX.ground[3]), texture(TEX.mossyRock), null, scale, positionWorld, normalWorld);
  const d = triplanarTexture(texture(TEX.rockNormal), null, null, scale, positionWorld, normalWorld).xyz.mul(2).sub(vec3(1, 1, 2));
  m.normalNode = normalize(normalView.add(cameraViewMatrix.mul(vec4(d, 0)).xyz.mul(0.7)));
  const depth = U.waterLevel.sub(positionWorld.y);
  const under = smoothstep(-0.1, 0.6, depth);
  m.colorNode = col.rgb.mul(vec3(0.9, 0.88, 0.85));
  m.emissiveNode = col.rgb.mul(causticsAt(positionWorld.xz)).mul(under).mul(U.daylight).mul(U.caustics).mul(0.5);
  return m;
}

export class Decor {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    const r = rng(42);
    this.variants = [0.7, 0.55, 0.85, 0.65].map((sq) => displaceRock(new THREE.IcosahedronGeometry(1, 3), r, sq));
    this.rockMat = rockMaterial();
    this.rockMeshes = this.variants.map((g) => {
      const im = new THREE.InstancedMesh(g, this.rockMat, 120);
      im.count = 0; im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false;
      im.name = 'rocks';
      scene.add(im);
      return im;
    });
    this.rocks = [];

    // Moss tufts (SeedThree grass tuft card, tinted mossy).
    const tuftGeo = new THREE.PlaneGeometry(1, 1, 1, 2);
    tuftGeo.translate(0, 0.5, 0);
    const g2 = tuftGeo.clone().rotateY(Math.PI / 2);
    const tg = mergeVertices(mergeGeos([tuftGeo, g2]));
    const n = tg.attributes.position.count;
    const sway = new Float32Array(n), col = new Float32Array(n * 3).fill(1);
    for (let i = 0; i < n; i++) sway[i] = tg.attributes.position.getY(i);
    tg.setAttribute('sway', new THREE.BufferAttribute(sway, 1));
    tg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.tuftCap = 3500;
    this.tufts = new THREE.InstancedMesh(tg, plantMaterial({ amp: 0.08, underwaterAmp: 0.3, map: TEX.cards.grassTuft }), this.tuftCap);
    this.tufts.count = 0; this.tufts.frustumCulled = false; this.tufts.receiveShadow = true;
    this.tufts.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.tuftCap * 3), 3);
    scene.add(this.tufts);
  }

  // --- Rocks -------------------------------------------------------------
  addRock(x, z, size = 4, opt = {}) {
    const T = this.world.terrain;
    const f = T.field;
    const variant = opt.variant ?? Math.floor(Math.random() * this.variants.length);
    const squash = [0.7, 0.55, 0.85, 0.65][variant];
    const sx = size * (opt.sx ?? (0.9 + Math.random() * 0.4)), sz = size * (opt.sz ?? (0.8 + Math.random() * 0.4)), sy = size;
    const rot = opt.rot ?? Math.random() * Math.PI * 2;
    // Seat on the lowest ground under the footprint so no edge floats.
    let g = Infinity;
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) g = Math.min(g, T.heightAt(x + dx * sx * 0.7, z + dz * sz * 0.7));
    const y = opt.y ?? g - sy * squash * 0.25;
    const rock = { x, y, z, sx, sy, sz, rot, variant, squash, saved: [] };
    // Stamp the rock's top into the heightfield (and paint it rock).
    const c = Math.cos(rot), s = Math.sin(rot);
    const R = Math.max(sx, sz) * 1.05;
    for (let j = 0; j <= f.ny; j++) for (let i = 0; i <= f.nx; i++) {
      const [wx, wz] = f.toWorld(i, j);
      const dx = wx - x, dz = wz - z;
      if (Math.abs(dx) > R || Math.abs(dz) > R) continue;
      const lx = (dx * c - dz * s) / (sx * 0.92), lz = (dx * s + dz * c) / (sz * 0.92);
      const d2 = lx * lx + lz * lz;
      if (d2 >= 1) continue;
      const top = y + sy * squash * Math.sqrt(1 - d2) * 0.95;
      const n = f.idx(i, j);
      if (top <= f.h[n]) continue;
      rock.saved.push([n, f.h[n], Array.from(f.mat.subarray(n * NMAT, n * NMAT + NMAT))]);
      f.h[n] = top;
      for (let m = 0; m < NMAT; m++) f.mat[n * NMAT + m] = m === MAT.rock ? 1 : 0;
    }
    f.dirty = true;
    this.rocks.push(rock);
    this.drawRocks();
    return rock;
  }

  rockNear(p, maxD = 3) {
    let best = null, bd = Infinity;
    for (const r of this.rocks) {
      const d = Math.hypot(p.x - r.x, p.z - r.z) - Math.max(r.sx, r.sz);
      if (d < maxD && d < bd) { bd = d; best = r; }
    }
    return best;
  }

  removeRock(rock) {
    const f = this.world.terrain.field;
    for (let k = rock.saved.length - 1; k >= 0; k--) {
      const [n, h, m] = rock.saved[k];
      f.h[n] = h;
      f.mat.set(m, n * NMAT);
    }
    f.dirty = true;
    this.rocks.splice(this.rocks.indexOf(rock), 1);
    this.drawRocks();
  }

  drawRocks() {
    const counts = this.rockMeshes.map(() => 0);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    for (const r of this.rocks) {
      const im = this.rockMeshes[r.variant];
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r.rot);
      m.compose(p.set(r.x, r.y, r.z), q, s.set(r.sx, r.sy, r.sz));
      im.setMatrixAt(counts[r.variant]++, m);
    }
    this.rockMeshes.forEach((im, i) => { im.count = counts[i]; im.instanceMatrix.needsUpdate = true; });
  }

  // --- Moss tufts --------------------------------------------------------
  scatterMoss() {
    const W = this.world;
    const r = rng(99);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const c = new THREE.Color();
    let k = 0;
    const put = (pos, normal, size) => {
      if (k >= this.tuftCap) return;
      q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
      q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28));
      m.compose(pos, q, s.set(size * (0.8 + r() * 0.5), size * (0.5 + r() * 0.4), size));
      this.tufts.setMatrixAt(k, m);
      c.setRGB(0.55 + r() * 0.15, 0.7 + r() * 0.2, 0.35 + r() * 0.1);
      this.tufts.setColorAt(k, c);
      k++;
    };
    const tf = W.terrain.field;
    for (let j = 0; j <= tf.ny; j++) for (let i = 0; i <= tf.nx; i++) {
      const n = tf.idx(i, j);
      const w = tf.mat[n * NMAT + MAT.moss];
      if (w < 0.5 || r() > (w - 0.4) * 0.55) continue;
      const [x, z] = tf.toWorld(i + (r() - 0.5), j + (r() - 0.5));
      const y = W.terrain.heightAt(x, z);
      if (W.water.level - y > 3) continue; // no tufts deep under water
      put(p.set(x, y - 0.1, z), W.terrain.normalAt(x, z).lerp(new THREE.Vector3(0, 1, 0), 0.5).normalize(), 1.4 + r() * 1.2);
    }
    const wf = W.wall.field;
    for (let j = 0; j <= wf.ny; j++) for (let i = 0; i <= wf.nx; i++) {
      const n = wf.idx(i, j);
      const w = wf.mat[n * NMAT + MAT.moss];
      if (w < 0.5 || r() > (w - 0.4) * 0.5) continue;
      const [x, y] = wf.toWorld(i + (r() - 0.5), j + (r() - 0.5));
      if (y < W.water.level || y < W.terrain.heightAt(x, W.wall.zAt(x, y) + 0.5) - 0.3) continue;
      const [gx, gy] = wf.gradient(x, y);
      const nrm = new THREE.Vector3(-gx, -gy, 1).normalize().lerp(new THREE.Vector3(0, 1, 0), 0.35).normalize();
      put(p.set(x, y, W.wall.zAt(x, y) - 0.1), nrm, 1.3 + r() * 1.0);
    }
    this.tufts.count = k;
    this.tufts.instanceMatrix.needsUpdate = true;
    this.tufts.instanceColor.needsUpdate = true;
  }

  serialize() {
    return this.rocks.map((r) => ({ x: +r.x.toFixed(2), y: +r.y.toFixed(2), z: +r.z.toFixed(2), sx: +r.sx.toFixed(2), sy: +r.sy.toFixed(2), sz: +r.sz.toFixed(2), rot: +r.rot.toFixed(2), v: r.variant }));
  }

  clear() {
    this.rocks = [];
    this.drawRocks();
  }
}

function mergeGeos(list) {
  const pos = [], nor = [], uv = [];
  for (const g0 of list) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
    uv.push(...g.attributes.uv.array);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

export { clamp, TANK };
