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
//  - Moss tufts, scattered wherever moss grows.
//
// Every solid piece is stamped into the substrate: the ground under it is
// raised to its top surface (found by casting rays down onto the mesh), so
// animals climb it, water runs over it and pools against it, and pieces can
// be stacked. Stamps sit on top of the sculpted ground (terrain.js), so a
// piece can be moved, turned, scaled or removed at any time. Ray casts use
// three-mesh-bvh (MIT, https://github.com/gkjohnson/three-mesh-bvh), which
// makes re-stamping fast enough to follow a piece while you drag it.

import * as THREE from 'three/webgpu';
import { float, vec3, vec4, normalView, normalize, cameraViewMatrix, positionWorld, smoothstep, normalWorld, mix, mx_noise_float } from 'three/tsl';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { computeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { TEX, modelParts } from '../render/assets.js';
import { plantMaterial, hardscapeMaterial, mouldMix, wet, triplanar, blendWeights } from '../render/shaders.js';
import { U } from '../render/uniforms.js';
import { MAT, NMAT, TANK } from './tank.js';
import { rng, clamp } from '../render/geo.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

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
  const cover = smoothstep(0.45, 0.8, up.add(n).sub(float(1).sub(U.rockMoss).mul(0.9))).mul(aboveWater);
  const mossCol = triplanar(TEX.ground[4], 1 / 8, pw, bf).mul(vec3(0.55, 0.8, 0.42));
  const [color, emissive] = wet(mouldMix(mix(stone, mossCol, cover), pw), pw);
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
    this.ray.firstHitOnly = true;

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
    this.tuftCap = 5000;
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
          g.computeBoundsTree();
          list.push({ geometry: g, material: mat(p.material, def.moss), name: p.name });
        }
      }
      this.parts[type] = list;
    }
    const r = rng(7);
    const sm = spireMaterial();
    this.parts.spire = Array.from({ length: 5 }, (_, i) => {
      const geometry = displace(new THREE.IcosahedronGeometry(1, 5), r, { squash: 1, stretch: 1.8 + r() * 0.9, taper: 0.45 + r() * 0.3, strata: 0.1 + r() * 0.08 });
      geometry.computeBoundsTree();
      return { geometry, material: sm, name: 'spire' + i };
    });
  }

  // Adds a piece at (x, z) sitting on the ground (or on whatever is there,
  // so pieces stack). opt: variant, size, rot, tilt, scale [sx, sy, sz], y, sink.
  addPiece(type, x, z, opt = {}) {
    const def = PIECES[type];
    const list = this.parts[type];
    if (!def || !list?.length) return null;
    const variant = (opt.variant ?? Math.floor(Math.random() * list.length)) % list.length;
    const bb = list[variant].geometry.boundingBox;
    const ext = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z);
    const k = (opt.size ?? def.size) / ext;
    const sc = opt.scale ?? [1, 1, 1];
    const scale = new THREE.Vector3(k * sc[0], k * sc[1], k * sc[2]);
    const rot = opt.rot ?? Math.random() * Math.PI * 2;
    const tilt = opt.tilt ?? [0, 0];
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt[0], rot, tilt[1], 'YXZ'));
    const piece = this.placePiece(type, variant, new THREE.Vector3(x, 0, z), q, scale);
    if (opt.y !== undefined) piece.mesh.position.y = opt.y;
    else this.settle(piece, opt.sink ?? 0.08);
    this.restamp(piece);
    return piece;
  }

  // Low level: a piece with an exact transform (no settling).
  placePiece(type, variant, pos, quat, scale) {
    const part = this.parts[type][variant % this.parts[type].length];
    const mesh = new THREE.Mesh(part.geometry, part.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.copy(pos);
    mesh.quaternion.copy(quat);
    mesh.scale.copy(scale);
    mesh.updateMatrixWorld(true);
    mesh.name = 'piece';
    const piece = { type, variant, mesh, stamp: null };
    mesh.userData.piece = piece;
    this.group.add(mesh);
    this.pieces.push(piece);
    return piece;
  }

  // Sits the piece on the lowest ground under its footprint, sunk in a
  // little, ignoring its own stamp.
  settle(piece, sink = 0.08) {
    const T = this.world.terrain;
    const own = piece.stamp;
    if (own) { piece.stamp = null; T.compose(this.stamps()); }
    const m = piece.mesh;
    m.position.y = 0;
    m.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(m);
    const cx = m.position.x, cz = m.position.z;
    const fr = Math.min(box.max.x - box.min.x, box.max.z - box.min.z) * 0.35;
    let g = Infinity;
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) g = Math.min(g, T.heightAt(cx + dx * fr, cz + dz * fr));
    m.position.y = g - box.min.y - sink * (box.max.y - box.min.y);
    m.updateMatrixWorld(true);
    if (own) piece.stamp = own;
  }

  stamps() { return this.pieces.map((p) => p.stamp); }

  // The ground under the piece rises to its top surface.
  restamp(piece) {
    const def = PIECES[piece.type];
    const T = this.world.terrain;
    if (def.stamp) {
      const f = T.field;
      piece.mesh.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(piece.mesh);
      const down = new THREE.Vector3(0, -1, 0);
      const o = new THREE.Vector3();
      const [i0, j0] = f.toGrid(box.min.x, box.min.z).map(Math.floor);
      const [i1, j1] = f.toGrid(box.max.x, box.max.z).map(Math.ceil);
      const idx = [], top = [];
      for (let j = Math.max(0, j0); j <= Math.min(f.ny, j1); j++) {
        for (let i = Math.max(0, i0); i <= Math.min(f.nx, i1); i++) {
          const [x, z] = f.toWorld(i, j);
          this.ray.set(o.set(x, box.max.y + 1, z), down);
          const hit = this.ray.intersectObject(piece.mesh, false)[0];
          if (!hit) continue;
          idx.push(f.idx(i, j));
          top.push(Math.min(f.maxH, hit.point.y - 0.15));
        }
      }
      piece.stamp = { idx: Int32Array.from(idx), top: Float32Array.from(top) };
    } else piece.stamp = null;
    T.compose(this.stamps());
  }

  // Keep the piece inside the tank after it was dragged.
  clampPiece(piece) {
    const p = piece.mesh.position;
    p.x = clamp(p.x, -TANK.w / 2 + 1, TANK.w / 2 - 1);
    p.z = clamp(p.z, -TANK.d / 2 + 1, TANK.d / 2 - 1);
    p.y = clamp(p.y, -20, TANK.h);
    piece.mesh.updateMatrixWorld(true);
  }

  duplicate(piece) {
    const m = piece.mesh;
    const off = new THREE.Vector3(4 + Math.random() * 2, 0, 2 + Math.random() * 2);
    const np = this.placePiece(piece.type, piece.variant, m.position.clone().add(off), m.quaternion.clone(), m.scale.clone());
    this.clampPiece(np);
    this.settle(np, 0.05);
    this.restamp(np);
    return np;
  }

  pieceAt(object) {
    let o = object;
    while (o && !o.userData.piece) o = o.parent;
    return o?.userData.piece ?? null;
  }

  removePiece(piece) {
    this.group.remove(piece.mesh);
    this.pieces.splice(this.pieces.indexOf(piece), 1);
    this.world.terrain.compose(this.stamps());
  }

  get meshes() { return this.group.children; }

  // --- Moss tufts --------------------------------------------------------
  scatterMoss() {
    const W = this.world;
    const r = rng(99);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const c = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    let k = 0;
    const put = (pos, normal, size) => {
      if (k >= this.tuftCap) return;
      q.setFromUnitVectors(up, normal);
      q.multiply(new THREE.Quaternion().setFromAxisAngle(up, r() * 6.28));
      m.compose(pos, q, s.set(size * (0.8 + r() * 0.5), size * (0.5 + r() * 0.4), size));
      this.tufts.setMatrixAt(k, m);
      c.setRGB(0.55 + r() * 0.15, 0.7 + r() * 0.2, 0.35 + r() * 0.1);
      this.tufts.setColorAt(k, c);
      k++;
    };
    const tf = W.terrain.field;
    for (let j = 0; j <= tf.ny; j++) for (let i = 0; i <= tf.nx; i++) {
      const n = tf.idx(i, j);
      if (tf.stamped[n]) continue;
      const w = tf.mat[n * NMAT + MAT.moss];
      if (w < 0.45 || r() > (w - 0.35) * 0.6) continue;
      const [x, z] = tf.toWorld(i + (r() - 0.5), j + (r() - 0.5));
      const y = W.terrain.heightAt(x, z);
      if (W.water.surfaceAt(x, z, 0.4) > y + 0.5) continue;
      put(p.set(x, y - 0.1, z), W.terrain.normalAt(x, z).lerp(up, 0.5).normalize(), (1.2 + r() * 1.1) * Math.min(1, w + 0.2));
    }
    const wf = W.wall.field;
    for (let j = 0; j <= wf.ny; j++) for (let i = 0; i <= wf.nx; i++) {
      const n = wf.idx(i, j);
      const w = wf.mat[n * NMAT + MAT.moss];
      if (w < 0.45 || r() > (w - 0.35) * 0.5) continue;
      const [x, y] = wf.toWorld(i + (r() - 0.5), j + (r() - 0.5));
      if (y < W.water.level || y < W.terrain.heightAt(x, W.wall.zAt(x, y) + 0.5) - 0.3) continue;
      const [gx, gy] = wf.gradient(x, y);
      const nrm = new THREE.Vector3(-gx, -gy, 1).normalize().lerp(up, 0.35).normalize();
      put(p.set(x, y, W.wall.zAt(x, y) - 0.1), nrm, (1.2 + r() * 1.0) * Math.min(1, w + 0.2));
    }
    this.tufts.count = k;
    this.tufts.instanceMatrix.needsUpdate = true;
    this.tufts.instanceColor.needsUpdate = true;
  }

  serialize() {
    const f = (v) => +v.toFixed(4);
    return this.pieces.map((p) => ({ t: p.type, v: p.variant, p: p.mesh.position.toArray().map(f), q: p.mesh.quaternion.toArray().map(f), s: p.mesh.scale.toArray().map(f) }));
  }

  // Re-creates pieces from a save (and stamps them again).
  restore(list) {
    for (const o of list) {
      if (!PIECES[o.t] || !this.parts[o.t]?.length) continue;
      let piece;
      if (o.q) piece = this.placePiece(o.t, o.v, new THREE.Vector3(...o.p), new THREE.Quaternion(...o.q), new THREE.Vector3(...o.s));
      else piece = this.addPiece(o.t, o.x, o.z, { variant: o.v, y: o.y, rot: o.r, tilt: o.tl, size: o.s, scale: o.sc });
      if (piece && o.q) this.restamp(piece);
    }
  }

  clear() {
    for (const p of [...this.pieces]) this.group.remove(p.mesh);
    this.pieces = [];
    this.world.terrain.compose([]);
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
