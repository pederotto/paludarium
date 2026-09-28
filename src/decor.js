// Hardscape and ground cover.
//
//  - Photoscanned pieces from Poly Haven (CC0): 13 mossy boulders, a cliff
//    face, a root cluster, a tree stump and a piece of driftwood. They keep
//    their scanned textures and grow moss on their upper faces.
//  - Stone spires: tall, layered rocks like the "dragon stone" cliffs of
//    aquascapes. Their shape is adapted from SeedThree's rocks.js (MIT,
//    https://github.com/SkyeShark/SeedThree): a welded icosahedron displaced
//    by low-frequency waves, here stretched upwards, tapered and cut with
//    horizontal strata.
//  - Moss tufts, scattered wherever moss is painted.
//
// Every solid piece is stamped into the substrate heightfield: the ground
// under it is raised to its top surface (found by casting rays down onto the
// mesh), so animals climb it, waterfalls run down it and ponds pool against
// it. Removing a piece restores the ground.

import * as THREE from 'three/webgpu';
import { texture, float, vec3, vec4, normalView, normalize, cameraViewMatrix, positionWorld, smoothstep, normalWorld, mix, mx_noise_float } from 'three/tsl';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { TEX, modelParts } from './assets.js';
import { plantMaterial, hardscapeMaterial, wet, triplanar, blendWeights } from './shaders.js';
import { U } from './uniforms.js';
import { MAT, NMAT, TANK } from './config.js';
import { rng, clamp } from './geo.js';

// Catalogue of placeable pieces. `size` is the default largest dimension in cm.
export const PIECES = {
  boulder: { name: 'Mossy boulder', model: ['rock_moss_set_01', 'rock_moss_set_02'], size: 10, stamp: true, moss: 0.55 },
  spire: { name: 'Stone spire', procedural: true, size: 30, stamp: true, moss: 0.5 },
  cliff: { name: 'Cliff face', model: ['rock_face_01'], size: 26, stamp: true, moss: 0.45 },
  roots: { name: 'Roots', model: ['root_cluster_01'], size: 30, stamp: false, moss: 0.25 },
  stump: { name: 'Tree stump', model: ['tree_stump_01'], size: 16, stamp: true, moss: 0.4 },
  wood: { name: 'Driftwood', model: ['dead_tree_trunk'], size: 36, stamp: false, moss: 0.3 },
};

function displace(rawGeo, r, { squash = 1, stretch = 1, taper = 0, strata = 0 } = {}) {
  const geo = mergeVertices(rawGeo);
  rawGeo.dispose();
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  const waves = Array.from({ length: 5 }, () => ({
    dir: new THREE.Vector3(r() * 2 - 1, (r() * 2 - 1) * 0.4, r() * 2 - 1).normalize(),
    freq: 1 + r() * 1.8,
    amp: 0.05 + r() * 0.1,
    phase: r() * Math.PI * 2,
  }));
  const sf = 5 + r() * 4, sp = r() * 6;
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    const n = v.clone().normalize();
    let d = 1;
    for (const w of waves) d += w.amp * Math.sin(n.dot(w.dir) * w.freq * Math.PI + w.phase);
    // Horizontal strata: layered ledges, sharp-edged like weathered stone.
    if (strata) d += strata * Math.pow(Math.abs(Math.sin(n.y * sf + sp)), 3) - strata * 0.5;
    v.copy(n).multiplyScalar(d);
    const t = (v.y + 1) / 2;                    // 0 at the base, 1 at the top
    const k = 1 - taper * t * t;
    v.x *= k; v.z *= k;
    v.y = (v.y * squash + 1) * stretch;        // base at y ≈ 0
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  return geo;
}

// Spire stone: triplanar cliff and lichen textures with moss on ledges.
function spireMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0 });
  m.shadowSide = THREE.BackSide;
  const pw = positionWorld;
  const bf = blendWeights();
  const s = 1 / 16;
  const stone = mix(
    triplanar(TEX.lichen, s, pw, bf).mul(vec3(0.85, 0.85, 0.88)),
    triplanar(TEX.cliff, 1 / 30, pw, bf).dot(vec3(0.3, 0.5, 0.2)).mul(vec3(0.5, 0.5, 0.52)),
    smoothstep(-0.3, 0.3, mx_noise_float(pw.mul(0.06))),
  );
  const nd = triplanar(TEX.lichenNormal, s, pw, bf).mul(2).sub(vec3(1, 1, 2));
  m.normalNode = normalize(normalView.add(cameraViewMatrix.mul(vec4(nd, 0)).xyz.mul(0.8)));
  const up = normalWorld.y;
  const n = mx_noise_float(pw.mul(0.3)).mul(0.4).add(mx_noise_float(pw.mul(1.1)).mul(0.2));
  const aboveWater = smoothstep(0.0, 1.5, pw.y.sub(U.waterLevel));
  const cover = smoothstep(0.45, 0.8, up.add(n)).mul(aboveWater);
  const mossCol = triplanar(TEX.ground[4], 1 / 8, pw, bf).mul(vec3(0.55, 0.8, 0.42));
  const [color, emissive] = wet(mix(stone, mossCol, cover), pw);
  m.colorNode = color;
  m.emissiveNode = emissive;
  return m;
}

export class Decor {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.pieces = [];
    this.parts = {};        // type → [{ geometry, material }]
    this.group = new THREE.Group();
    this.group.name = 'hardscape';
    scene.add(this.group);
    this.ray = new THREE.Raycaster();

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
    this.tuftCap = 4000;
    this.tufts = new THREE.InstancedMesh(tg, plantMaterial({ amp: 0.08, underwaterAmp: 0.3, map: TEX.cards.grassTuft }), this.tuftCap);
    this.tufts.count = 0; this.tufts.frustumCulled = false; this.tufts.receiveShadow = true;
    this.tufts.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.tuftCap * 3), 3);
    scene.add(this.tufts);
  }

  // Loads every model once and builds the spire variants.
  async preload() {
    const matCache = new Map();
    const mat = (src, moss) => {
      const k = src.uuid + moss;
      if (!matCache.has(k)) matCache.set(k, hardscapeMaterial(src, { moss }));
      return matCache.get(k);
    };
    for (const [type, def] of Object.entries(PIECES)) {
      if (def.procedural) continue;
      const list = [];
      for (const name of def.model) {
        for (const p of await modelParts(name)) {
          // Recentre each part: footprint centred on the origin, base at y = 0.
          const g = p.geometry;
          const bb = g.boundingBox;
          g.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
          g.computeBoundingBox();
          g.computeBoundingSphere();
          list.push({ geometry: g, material: mat(p.material, def.moss), name: p.name });
        }
      }
      this.parts[type] = list;
    }
    const r = rng(7);
    const sm = spireMaterial();
    this.parts.spire = Array.from({ length: 5 }, (_, i) => ({
      geometry: displace(new THREE.IcosahedronGeometry(1, 5), r, { squash: 1, stretch: 1.8 + r() * 0.9, taper: 0.45 + r() * 0.3, strata: 0.1 + r() * 0.08 }),
      material: sm,
      name: 'spire' + i,
    }));
  }

  // Adds a piece at (x, z). opt: variant, size, rot, tilt, scale [sx, sy, sz], y.
  addPiece(type, x, z, opt = {}) {
    const def = PIECES[type];
    const list = this.parts[type];
    if (!def || !list?.length) return null;
    const variant = opt.variant ?? Math.floor(Math.random() * list.length);
    const part = list[variant % list.length];
    const bb = part.geometry.boundingBox;
    const ext = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z);
    const size = opt.size ?? def.size;
    const k = size / ext;
    const sc = opt.scale ?? [1, 1, 1];
    const scale = new THREE.Vector3(k * sc[0], k * sc[1], k * sc[2]);
    const rot = opt.rot ?? Math.random() * Math.PI * 2;
    const tilt = opt.tilt ?? [0, 0];
    const mesh = new THREE.Mesh(part.geometry, part.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.rotation.set(tilt[0], rot, tilt[1], 'YXZ');
    mesh.scale.copy(scale);
    // Seat it on the lowest ground under its footprint so no edge floats.
    const T = this.world.terrain;
    const fr = Math.min(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * Math.min(scale.x, scale.z) * 0.35;
    let g = Infinity;
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) g = Math.min(g, T.heightAt(x + dx * fr, z + dz * fr));
    const y = opt.y ?? g - (opt.sink ?? 0.08) * (bb.max.y - bb.min.y) * scale.y;
    mesh.position.set(x, y, z);
    mesh.updateMatrixWorld(true);
    mesh.name = 'piece';
    const piece = { type, variant, x, y, z, rot, tilt, scale: scale.toArray(), size, sc, saved: [], mesh };
    mesh.userData.piece = piece;
    this.group.add(mesh);
    if (def.stamp) this.stamp(piece);
    this.pieces.push(piece);
    return piece;
  }

  // Raise the ground under the piece to its top surface.
  stamp(piece) {
    const f = this.world.terrain.field;
    const box = new THREE.Box3().setFromObject(piece.mesh);
    const down = new THREE.Vector3(0, -1, 0);
    const o = new THREE.Vector3();
    const [i0, j0] = f.toGrid(box.min.x, box.min.z).map(Math.floor);
    const [i1, j1] = f.toGrid(box.max.x, box.max.z).map(Math.ceil);
    for (let j = Math.max(0, j0); j <= Math.min(f.ny, j1); j++) {
      for (let i = Math.max(0, i0); i <= Math.min(f.nx, i1); i++) {
        const [x, z] = f.toWorld(i, j);
        this.ray.set(o.set(x, box.max.y + 1, z), down);
        const hit = this.ray.intersectObject(piece.mesh, false)[0];
        if (!hit) continue;
        const n = f.idx(i, j);
        const top = hit.point.y - 0.15;
        if (top <= f.h[n]) continue;
        piece.saved.push([n, f.h[n], Array.from(f.mat.subarray(n * NMAT, n * NMAT + NMAT))]);
        f.h[n] = Math.min(f.maxH, top);
        for (let m = 0; m < NMAT; m++) f.mat[n * NMAT + m] = m === MAT.rock ? 1 : 0;
      }
    }
    f.dirty = true;
  }

  pieceAt(object) {
    let o = object;
    while (o && !o.userData.piece) o = o.parent;
    return o?.userData.piece ?? null;
  }

  removePiece(piece) {
    const f = this.world.terrain.field;
    for (let k = piece.saved.length - 1; k >= 0; k--) {
      const [n, h, m] = piece.saved[k];
      f.h[n] = h;
      f.mat.set(m, n * NMAT);
    }
    f.dirty = true;
    this.group.remove(piece.mesh);
    this.pieces.splice(this.pieces.indexOf(piece), 1);
  }

  get meshes() { return this.group.children; }

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
      if (w < 0.5 || r() > (w - 0.4) * 0.6) continue;
      const [x, z] = tf.toWorld(i + (r() - 0.5), j + (r() - 0.5));
      const y = W.terrain.heightAt(x, z);
      if (W.water.level - y > 3) continue;
      put(p.set(x, y - 0.1, z), W.terrain.normalAt(x, z).lerp(new THREE.Vector3(0, 1, 0), 0.5).normalize(), 1.2 + r() * 1.1);
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
      put(p.set(x, y, W.wall.zAt(x, y) - 0.1), nrm, 1.2 + r() * 1.0);
    }
    this.tufts.count = k;
    this.tufts.instanceMatrix.needsUpdate = true;
    this.tufts.instanceColor.needsUpdate = true;
  }

  serialize() {
    return this.pieces.map((p) => ({ t: p.type, v: p.variant, x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), r: +p.rot.toFixed(3), tl: p.tilt.map((v) => +v.toFixed(3)), s: p.size, sc: p.sc }));
  }

  // Re-create pieces from a save. The saved heightfield already contains
  // their stamps, so they are added without stamping again.
  restore(list) {
    for (const o of list) {
      const def = PIECES[o.t];
      if (!def) continue;
      const stamp = def.stamp;
      def.stamp = false;
      this.addPiece(o.t, o.x, o.z, { variant: o.v, y: o.y, rot: o.r, tilt: o.tl, size: o.s, scale: o.sc });
      def.stamp = stamp;
    }
  }

  clear() {
    for (const p of [...this.pieces]) this.group.remove(p.mesh);
    this.pieces = [];
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

export { clamp, TANK, float };
