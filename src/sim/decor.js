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
import { float, vec3, vec4, normalView, normalize, cameraViewMatrix, positionWorld, smoothstep, normalWorld, mix } from 'three/tsl';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { computeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { TEX, modelParts } from '../render/assets.js';
import { plantMaterial, hardscapeMaterial, mouldMix, wet, triplanar, blendWeights, noise3 } from '../render/shaders.js';
import { U } from '../render/uniforms.js';
import { MAT, NMAT, TANK } from './tank.js';
import { rng, clamp } from '../util/math.js';
import { TINTS, PROC, rollLook, hullPoints, transformedBox, boxShift, nearestWall, faceQuat, faceOrigin, FACE_EMBED, SLOPE_NORMAL_Y } from './placement.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// Catalogue of placeable pieces. `size` is the default largest dimension in cm.
export const PIECES = {
  boulder: { name: 'Mossy boulder', model: ['rock_moss_set_01', 'rock_moss_set_02'], size: 10, stamp: true, moss: 0.55 },
  spire: { name: 'Stone spire', procedural: true, size: 30, stamp: true, moss: 0.5 },
  cliff: { name: 'Cliff face', model: ['rock_face_01'], size: 26, stamp: true, moss: 0.45, face: true },
  roots: { name: 'Roots', model: ['root_cluster_01'], size: 30, stamp: false, moss: 0.25 },
  stump: { name: 'Tree stump', model: ['tree_stump_01'], size: 16, stamp: true, moss: 0.4 },
  wood: { name: 'Driftwood', model: ['dead_tree_trunk'], size: 36, stamp: false, moss: 0.3 },
};

export { TINTS, PROC, rollLook };
const HULLS = new WeakMap();
const ROUND_BOULDERS = [6, 7, 8, 10, 11, 12];

// Copy of a geometry, every vertex moved by fn(v), re-seated on the origin (footprint centred,
// base at y = 0) with a fresh bounds tree.
function warp(src, fn) {
  const g = src.clone();
  delete g.boundsTree;
  const pos = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i); fn(v); pos.setXYZ(i, v.x, v.y, v.z); }
  if (g.index) g.computeVertexNormals();
  g.computeBoundingBox();
  const bb = g.boundingBox;
  g.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
  g.computeBoundingBox(); g.computeBoundingSphere(); g.computeBoundsTree();
  return g;
}

// A weathered tree stump: a flared, uneven cylinder with a ragged top.
function stumpGeo(r, { flare = 0.5, rag = 0.2, taper = 0.12 } = {}) {
  const g = new THREE.CylinderGeometry(0.5, 0.5, 1, 28, 12);
  const lobes = Array.from({ length: 4 }, () => ({ k: 2 + Math.floor(r() * 5), ph: r() * 6.28, a: 0.04 + r() * 0.07 }));
  const topPh = r() * 6.28, tilt = (r() - 0.5) * 0.25;
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const t = y + 0.5, a = Math.atan2(z, x), rr = Math.hypot(x, z);
    let rad = 1 + flare * Math.pow(1 - t, 4) * (0.6 + 0.4 * Math.sin(a * 5 + topPh));
    for (const l of lobes) rad += l.a * Math.sin(a * l.k + l.ph);
    rad *= 1 - taper * t;
    const top = t > 0.97 ? rag * (Math.sin(a * 3 + topPh) * 0.5 + Math.sin(a * 7) * 0.3 + tilt * Math.cos(a)) * rr * 2 : 0;
    pos.setXYZ(i, x * rad, t + top, z * rad);
  }
  g.computeVertexNormals();
  g.computeBoundingBox();
  return g;
}

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
function spireMaterial(tint = null) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0 });
  m.shadowSide = THREE.BackSide;
  const pw = positionWorld;
  const bf = blendWeights();
  const s = 1 / 16;
  const stone = mix(
    triplanar(TEX.lichen, s, pw, bf).mul(vec3(0.85, 0.85, 0.88)),
    triplanar(TEX.cliff, 1 / 30, pw, bf).dot(vec3(0.3, 0.5, 0.2)).mul(vec3(0.5, 0.5, 0.52)),
    smoothstep(-0.3, 0.3, noise3(pw.mul(0.06))),
  );
  const nd = triplanar(TEX.lichenNormal, s, pw, bf).mul(2).sub(vec3(1, 1, 2));
  m.normalNode = normalize(normalView.add(cameraViewMatrix.mul(vec4(nd, 0)).xyz.mul(0.8)));
  const up = normalWorld.y;
  const n = noise3(pw.mul(0.3)).mul(0.4).add(noise3(pw.mul(1.1)).mul(0.2));
  const aboveWater = smoothstep(0.0, 1.5, pw.y.sub(U.waterLevel));
  const cover = smoothstep(0.45, 0.8, up.add(n).sub(float(1).sub(U.rockMoss).mul(0.9))).mul(aboveWater);
  const mossCol = triplanar(TEX.ground[4], 1 / 8, pw, bf).mul(vec3(0.55, 0.8, 0.42));
  const tinted = tint ? stone.mul(vec3(tint[0], tint[1], tint[2])) : stone;
  const [color, emissive] = wet(mouldMix(mix(tinted, mossCol, cover), pw), pw);
  m.colorNode = color;
  m.emissiveNode = emissive;
  return m;
}

export class Decor {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.pieces = [];
    this.occupancyVersion = 0;   // bumped whenever a piece is added, moved or removed (animals rebuild their occupancy grid)
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

  // Material of a part in a tint (cached: each tint is its own shader).
  partMaterial(part, tint = 0) {
    const key = tint | 0;
    if (!part.mats.has(key)) part.mats.set(key, part.make(key ? TINTS[key] : null));
    return part.mats.get(key);
  }

  // Loads every model once and builds the procedural variants (appended after the scanned ones,
  // so saves that remember a variant index keep their look).
  async preload() {
    const srcMats = new Map();
    const stoneMats = new Map();
    const scanned = (src, moss) => (tint) => {
      const k = src.uuid + '/' + moss + '/' + (tint ? tint.join() : '');
      if (!srcMats.has(k)) srcMats.set(k, hardscapeMaterial(src, { moss, tint }));
      return srcMats.get(k);
    };
    const stone = (tint) => {
      const k = tint ? tint.join() : '';
      if (!stoneMats.has(k)) stoneMats.set(k, spireMaterial(tint));
      return stoneMats.get(k);
    };
    const part = (geometry, make, name) => ({ geometry, make, name, mats: new Map(), get material() { return this.mats.get(0) ?? (this.mats.set(0, make(null)), this.mats.get(0)); } });
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
          list.push({ ...part(g, scanned(p.material, def.moss), p.name), src: p.material });
        }
      }
      this.parts[type] = list;
    }
    const R = (seed) => rng(seed);
    const P = this.parts;
    const sm = stone;

    // Spires: the original five, then a thin shard, a fat butte and a crooked one.
    const r = R(7);
    P.spire = Array.from({ length: 5 }, (_, i) => {
      const geometry = displace(new THREE.IcosahedronGeometry(1, 5), r, { squash: 1, stretch: 1.8 + r() * 0.9, taper: 0.45 + r() * 0.3, strata: 0.1 + r() * 0.08 });
      geometry.computeBoundsTree();
      return part(geometry, sm, 'spire' + i);
    });
    const r2 = R(311);
    const spireX = [
      { stretch: 3.0, taper: 0.75, strata: 0.2 },
      { stretch: 1.25, taper: 0.2, strata: 0.14 },
      { stretch: 2.2, taper: 0.5, strata: 0.16, lean: 0.28 },
    ];
    spireX.forEach((o, i) => {
      let geometry = displace(new THREE.IcosahedronGeometry(1, 5), r2, o);
      if (o.lean) geometry = warp(geometry, (v) => { v.x += v.y * o.lean; });
      geometry.computeBoundsTree();
      P.spire.push(part(geometry, sm, 'spire' + (5 + i)));
    });

    // Boulders: a flat slab, a round cobble, a blocky ledge-stone and a tall knuckle.
    const r3 = R(523);
    const boulderX = [
      { squash: 0.45, stretch: 0.55, taper: 0.1, strata: 0.05 },
      { squash: 0.85, stretch: 0.75, taper: 0.05, strata: 0.0 },
      { squash: 0.7, stretch: 0.7, taper: 0.15, strata: 0.16 },
      { squash: 1.0, stretch: 1.0, taper: 0.3, strata: 0.08 },
    ];
    boulderX.forEach((o, i) => {
      const geometry = displace(new THREE.IcosahedronGeometry(1, 5), r3, o);
      geometry.computeBoundsTree();
      P.boulder.push(part(geometry, sm, 'boulderx' + i));
    });

    // Stumps: a broad flared one, a slim tall one and a ragged broken one.
    const r4 = R(719);
    const stumpSrc = P.stump[0];
    [{ flare: 0.7, rag: 0.12, taper: 0.05, h: 0.5 }, { flare: 0.3, rag: 0.1, taper: 0.2, h: 1.1 }, { flare: 0.5, rag: 0.4, taper: 0.1, h: 0.8 }].forEach((o, i) => {
      const geometry = stumpGeo(r4, o);
      geometry.scale(1, o.h, 1);
      geometry.computeBoundingBox(); geometry.computeBoundingSphere(); geometry.computeBoundsTree();
      const bb = geometry.boundingBox;
      geometry.translate(0, -bb.min.y, 0);
      geometry.computeBoundingBox(); geometry.computeBoundsTree();
      P.stump.push({ ...part(geometry, stumpSrc.make, 'stumpx' + i), src: stumpSrc.src });
    });

    // Scanned shapes bent, sheared and rippled into new silhouettes.
    const derive = (type, count, seed, fn) => {
      const base = P[type][0], rr = R(seed);
      for (let i = 0; i < count; i++) {
        const o = fn(rr, i);
        P[type].push({ ...part(warp(base.geometry, o), base.make, base.name + 'x' + i), src: base.src });
      }
    };
    derive('cliff', 3, 831, (rr) => {
      const sh = (rr() - 0.5) * 0.4, f1 = 0.008 + rr() * 0.01, p1 = rr() * 6.28, p2 = rr() * 6.28, am = 14 + rr() * 14, nar = 0.75 + rr() * 0.3;
      return (v) => { v.x = (v.x + v.y * sh) * nar; v.x += Math.sin(v.y * f1 + p1) * am; v.y += Math.cos(v.x * f1 + p2) * am * 0.4; if (v.z > 0) v.z += Math.sin(v.x * 0.012 + p1) * (v.z / 190) * am * 0.5; };
    });
    derive('roots', 2, 947, (rr) => {
      const tw = (rr() - 0.5) * 0.9, am = 8 + rr() * 8, p1 = rr() * 6.28;
      return (v) => { const a = (v.y / 150) * tw, c = Math.cos(a), s2 = Math.sin(a), x = v.x * c - v.z * s2, z = v.x * s2 + v.z * c; v.x = x + Math.sin(v.z * 0.02 + p1) * am; v.z = z + Math.cos(v.x * 0.02 + p1) * am; };
    });
    derive('wood', 3, 1051, (rr, i) => {
      const bend = [0.22, -0.18, 0.1][i], tw = (rr() - 0.5) * 0.8, p1 = rr() * 6.28;
      return (v) => { const t = v.x / 150; v.y += bend * 150 * t * t; v.z += Math.sin(v.x * 0.03 + p1) * 3; const a = tw * t, c = Math.cos(a), s2 = Math.sin(a), y = v.y * c - v.z * s2; v.z = v.y * s2 + v.z * c; v.y = y; };
    });
  }

  // The indices worth drawing for general use (the scanned set-01 boulders are huge and flat).
  pool(type) {
    const n = this.parts[type]?.length ?? 0;
    if (type === 'boulder') return [...ROUND_BOULDERS, ...Array.from({ length: Math.min(PROC.boulder, Math.max(0, n - 13)) }, (_, i) => 13 + i)].filter((i) => i < n);
    return Array.from({ length: n }, (_, i) => i);
  }

  // Everything that varies from piece to piece, from one seed: see rollLook().
  look(type, seed) {
    return rollLook(type, seed, this.parts[type]?.length ?? 1, this.pool(type));
  }

  // Adds a piece at (x, z) sitting on the ground (or on whatever is there,
  // so pieces stack). opt: variant, size, rot, tilt, scale [sx, sy, sz], y, sink,
  // and for variety: seed (or vary: true) rolls variant, scale, flip, tint and yaw for whatever
  // is not given; flip, tint set those directly. Face pieces (cliffs) snap to a wall or slope
  // (opt.face = false stamps them like a boulder).
  addPiece(type, x, z, opt = {}) {
    const def = PIECES[type];
    const list = this.parts[type];
    if (!def || !list?.length) return null;
    const roll = opt.seed !== undefined || opt.vary ? this.look(type, opt.seed ?? Math.floor(Math.random() * 2 ** 31)) : null;
    const variant = ((opt.variant ?? roll?.variant ?? Math.floor(Math.random() * list.length)) % list.length + list.length) % list.length;
    const bb = list[variant].geometry.boundingBox;
    const ext = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z);
    const k = (opt.size ?? def.size) / ext;
    const sc = opt.scale ?? (roll ? roll.scale : [1, 1, 1]);
    const flip = opt.flip ?? (roll ? roll.flip : false);
    const tint = opt.tint ?? roll?.tint ?? 0;
    const scale = new THREE.Vector3(k * sc[0] * (flip ? -1 : 1), k * sc[1], k * sc[2]);
    const rot = opt.rot ?? roll?.rot ?? Math.random() * Math.PI * 2;
    const tilt = opt.tilt ?? [0, 0];
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt[0], rot, tilt[1], 'YXZ'));
    const piece = this.placePiece(type, variant, new THREE.Vector3(x, 0, z), q, scale, tint);
    if (def.face && opt.face !== false) {
      piece.rot = rot;
      piece.snap = opt.snap;
      this.placeFace(piece, x, z, { snap: opt.snap, sink: opt.sink });
      this.restamp(piece);
      return piece;
    }
    if (opt.y !== undefined) piece.mesh.position.y = opt.y;
    else this.settle(piece, opt.sink ?? 0.08);
    // Inside the glass, whatever the size, turn and scale; re-seat after a sideways move.
    if (this.clampPiece(piece) && opt.y === undefined) { this.settle(piece, opt.sink ?? 0.08); this.clampPiece(piece); }
    this.restamp(piece);
    return piece;
  }

  // Low level: a piece with an exact transform (no settling).
  placePiece(type, variant, pos, quat, scale, tint = 0) {
    const part = this.parts[type][variant % this.parts[type].length];
    const mesh = new THREE.Mesh(part.geometry, this.partMaterial(part, tint));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.copy(pos);
    mesh.quaternion.copy(quat);
    mesh.scale.copy(scale);
    mesh.updateMatrixWorld(true);
    mesh.name = 'piece';
    const piece = { type, variant, tint, mesh, stamp: null };
    mesh.userData.piece = piece;
    this.group.add(mesh);
    this.pieces.push(piece);
    return piece;
  }

  setTint(piece, tint) {
    const part = this.parts[piece.type][piece.variant % this.parts[piece.type].length];
    piece.tint = tint | 0;
    piece.mesh.material = this.partMaterial(part, piece.tint);
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

  // How far the piece hangs over the ground under it (cm): its bottom minus the highest ground (or
  // other piece) beneath its footprint. With drop > 0 it is also lowered by that much (at most the gap)
  // and tilted a hair toward the slope of the new ground (a piece whose ground eroded settles).
  reground(piece, drop = 0) {
    const T = this.world.terrain, f = T.field;
    const m = piece.mesh;
    m.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(m);
    const tmp = f.base.slice();
    for (const o of this.pieces) {
      const s = o.stamp;
      if (o === piece || !s) continue;
      for (let k = 0; k < s.idx.length; k++) if (s.top[k] > tmp[s.idx[k]]) tmp[s.idx[k]] = s.top[k];
    }
    const cx = m.position.x, cz = m.position.z;
    const fr = Math.max(f.da, Math.min(box.max.x - box.min.x, box.max.z - box.min.z) * 0.35);
    let gmax = -Infinity;
    const at = (dx, dz) => f.sample(cx + dx * fr, cz + dz * fr, tmp);
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) gmax = Math.max(gmax, at(dx, dz));
    const gap = box.min.y - gmax;
    if (drop > 0 && gap > 0) {
      m.position.y -= Math.min(drop, gap);
      const sx = (at(1, 0) - at(-1, 0)) / (2 * fr), sz = (at(0, 1) - at(0, -1)) / (2 * fr);
      const mag = Math.hypot(sx, sz);
      if (mag > 0.02) {
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(-sz, 0, sx).normalize(), Math.min(0.05, Math.atan(mag) * 0.12));
        m.quaternion.premultiply(q);
      }
      m.updateMatrixWorld(true);
      this.restamp(piece);
    }
    return gap;
  }

  stamps() { return this.pieces.map((p) => p.stamp); }

  // The ground under the piece rises to its top surface.
  restamp(piece) {
    this.occupancyVersion++;
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

  // The world-space box of the piece (its rotated, scaled, flipped mesh), from a sparse sample of
  // the vertices that is cached per geometry.
  pieceBox(piece) {
    const m = piece.mesh, g = m.geometry;
    m.updateMatrixWorld(true);
    // Cached per geometry (not in userData: clone() copies that), and re-made if the geometry changed.
    const sig = g.boundingBox ? g.boundingBox.min.toArray().concat(g.boundingBox.max.toArray()).join() : '';
    let h = HULLS.get(g);
    if (!h || h.sig !== sig || h.n !== g.attributes.position.count) {
      // Scanned models store positions interleaved with normals and UVs: read them one by one.
      const a = g.attributes.position, flat = new Float32Array(a.count * 3);
      for (let i = 0; i < a.count; i++) { flat[i * 3] = a.getX(i); flat[i * 3 + 1] = a.getY(i); flat[i * 3 + 2] = a.getZ(i); }
      h = { sig, n: a.count, pts: hullPoints(flat) };
      HULLS.set(g, h);
    }
    return transformedBox(h.pts, m.matrixWorld.elements);
  }

  // Keep the whole piece inside the glass (not just its centre) after it was dragged, scaled,
  // turned, copied or loaded. Returns true when it had to be moved sideways.
  clampPiece(piece) {
    const m = piece.mesh;
    const [dx, dy, dz] = boxShift(this.pieceBox(piece), TANK);
    if (dx || dy || dz) { m.position.x += dx; m.position.y += dy; m.position.z += dz; m.updateMatrixWorld(true); }
    return !!(dx || dz);
  }

  // The surface a face piece would stand on at (x, z): the nearest of the back and side walls, or
  // a slope when the ground is steep there. `snap` is how far from a wall (cm) a piece still
  // snaps to it; farther away it stands upright where it is ('free').
  // Returns { kind, n: [x, y, z], anchor: [x, y, z] }, the anchor being on the surface at the base.
  faceSurface(x, z, { snap = Infinity } = {}) {
    const W = this.world, T = W.terrain;
    const gy = T.heightAt(x, z), nrm = T.normalAt(x, z);
    if (nrm.y < SLOPE_NORMAL_Y) return { kind: 'slope', n: [nrm.x, nrm.y, nrm.z], anchor: [x, gy, z] };
    const w = nearestWall(x, z, TANK);
    if (w.dist > snap) return { kind: 'free', n: [0, 0, 1], anchor: [x, gy, z] };
    if (w.wall === 'back') return { kind: 'back', n: w.n, anchor: [x, gy, Math.max(-TANK.d / 2 + FACE_EMBED + 0.3, W.wall.zAt(x, gy + 6))] };
    return { kind: w.wall, n: w.n, anchor: [w.wall === 'left' ? -TANK.w / 2 : TANK.w / 2, gy, z] };
  }

  // Stands a face piece on its surface: turned along the surface normal, its back sunk a fixed
  // depth into the wall or ground (or touching the side glass), its base on the ground.
  // `piece.rot` is the yaw it keeps when it stands free.
  placeFace(piece, x, z, { snap, sink } = {}) {
    const W = this.world, T = W.terrain, m = piece.mesh;
    const bb = m.geometry.boundingBox;
    const sx = Math.abs(m.scale.x), sy = Math.abs(m.scale.y), sz = Math.abs(m.scale.z);
    const half = ((bb.max.x - bb.min.x) * sx) / 2, high = (bb.max.y - bb.min.y) * sy, back = -bb.min.z * sz;
    const sf = this.faceSurface(x, z, { snap });
    piece.face = sf.kind;
    if (sf.kind === 'free') {
      m.quaternion.setFromEuler(new THREE.Euler(0, piece.rot ?? 0, 0, 'YXZ'));
      m.position.set(x, 0, z);
      this.settle(piece, sink ?? 0.06);
    } else {
      const n = sf.n;
      m.quaternion.fromArray(faceQuat(n));
      let anchor = sf.anchor;
      const along = sf.kind === 'back' || sf.kind === 'slope' ? [1, 0] : [0, 1];    // direction along the wall
      if (sf.kind === 'back') {
        // The relief bulges in places: stand on its average over the width of the piece.
        let zs = 0;
        for (const u of [-1, -0.5, 0, 0.5, 1]) zs += W.wall.zAt(x + u * half, anchor[1] + high / 2);
        anchor = [x, anchor[1], Math.max(-TANK.d / 2 + FACE_EMBED + 0.3, zs / 5)];
      }
      const embed = sf.kind === 'left' || sf.kind === 'right' ? -0.3 : FACE_EMBED;
      const o = faceOrigin(anchor, n, back, embed);
      if (sf.kind !== 'slope') {
        // Auto-ground: the base sits on the lowest ground along the wall under the piece.
        let g = Infinity;
        for (const u of [-1, -0.5, 0, 0.5, 1]) g = Math.min(g, T.heightAt(o[0] + along[0] * u * half + n[0] * 1.5, o[2] + along[1] * u * half + n[2] * 1.5));
        o[1] = g - (sink ?? 0.05) * high;
      }
      m.position.set(o[0], o[1], o[2]);
    }
    m.updateMatrixWorld(true);
    this.clampPiece(piece);
    return sf;
  }

  // Re-seats a face piece after it was dragged: snaps to the nearest wall or slope again.
  snapFace(piece) {
    const p = piece.mesh.position;
    const f = piece.face;
    // A piece that stands free keeps its yaw; the others take their turn from the surface.
    if (f === 'free' || f === undefined) { const e = new THREE.Euler().setFromQuaternion(piece.mesh.quaternion, 'YXZ'); piece.rot = e.y; }
    this.placeFace(piece, p.x, p.z, { snap: piece.snap });
  }

  duplicate(piece) {
    const m = piece.mesh;
    const off = new THREE.Vector3(4 + Math.random() * 2, 0, 2 + Math.random() * 2);
    const np = this.placePiece(piece.type, piece.variant, m.position.clone().add(off), m.quaternion.clone(), m.scale.clone(), piece.tint);
    if (PIECES[piece.type].face && piece.face && piece.face !== 'free') { np.rot = piece.rot; this.snapFace(np); } else {
      this.clampPiece(np);
      this.settle(np, 0.05);
      this.clampPiece(np);
    }
    this.restamp(np);
    return np;
  }

  pieceAt(object) {
    let o = object;
    while (o && !o.userData.piece) o = o.parent;
    return o?.userData.piece ?? null;
  }

  removePiece(piece) {
    this.occupancyVersion++;
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
    return this.pieces.map((p) => ({ t: p.type, v: p.variant, c: p.tint || undefined, p: p.mesh.position.toArray().map(f), q: p.mesh.quaternion.toArray().map(f), s: p.mesh.scale.toArray().map((v) => +v.toPrecision(6)) }));
  }

  // Re-creates pieces from a save (and stamps them again).
  restore(list) {
    for (const o of list) {
      if (!PIECES[o.t] || !this.parts[o.t]?.length) continue;
      let piece;
      if (o.q) {
        piece = this.placePiece(o.t, o.v, new THREE.Vector3(...o.p), new THREE.Quaternion(...o.q), new THREE.Vector3(...o.s), o.c ?? 0);
        this.clampPiece(piece);          // old saves: pull pieces that crossed the glass back in
        this.restamp(piece);
      } else piece = this.addPiece(o.t, o.x, o.z, { variant: o.v, y: o.y, rot: o.r, tilt: o.tl, size: o.s, scale: o.sc, tint: o.c, face: false });
    }
  }

  clear() {
    this.occupancyVersion++;
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
