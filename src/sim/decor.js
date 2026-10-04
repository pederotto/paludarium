// Hardscape and ground cover.
//
//  - Photoscanned pieces from Poly Haven (CC0): 13 mossy boulders, a cliff
//    face, a root cluster, a tree stump and a piece of driftwood. They keep
//    their scanned textures (but the driftwood, which wears the baked bark of
//    the procedural wood: barkMaterial) and grow moss on their upper faces.
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
import { float, vec2, vec3, vec4, normalView, normalize, cameraViewMatrix, positionWorld, positionView, smoothstep, normalWorld, mix, texture, uv, modelScale, varying, normalMap, attribute } from 'three/tsl';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { computeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { TEX, modelParts, loadBinary } from '../render/assets.js';
import { plantMaterial, hardscapeMaterial, mouldMix, wet, triplanar, blendWeights, noise3 } from '../render/shaders.js';
import { U } from '../render/uniforms.js';
import { MAT, NMAT, TANK } from './tank.js';
import { rng, clamp, hash3 } from '../util/math.js';
import { TINTS, PROC, rollLook, hullPoints, transformedBox, boxShift, nearestWall, faceQuat, faceOrigin, FACE_EMBED, SLOPE_NORMAL_Y, restLift, lieLift, plantLift, groundNormal } from './placement.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// Catalogue of placeable pieces. `size` is the default largest dimension in cm. How a piece meets the ground (settle):
// `lie` pieces rest on their lowest contact and sink by a share of their thickness (unless stood on end, then they are
// planted like the rest: the whole base at or under the ground, sunk by a share of the height); `slope` pieces placed
// without a tilt turn to the slope of the ground under them (a slab, a cork tube, a log, a patch of pebbles).
export const PIECES = {
  boulder: { name: 'Mossy boulder', model: ['rock_moss_set_01', 'rock_moss_set_02'], size: 10, stamp: true, moss: 0.55 },
  spire: { name: 'Stone spire', procedural: true, size: 30, stamp: true, moss: 0.5 },
  cliff: { name: 'Cliff face', model: ['rock_face_01'], size: 26, stamp: true, moss: 0.45, face: true },
  // (sink: the scan is a root ball dug out with its soil plug, cut flat underneath: sunk deeper, the plug's cut sides are buried
  // instead of hanging over a slope or in the water)
  roots: { name: 'Roots', model: ['root_cluster_01'], size: 30, stamp: false, moss: 0.25, sink: 0.3 },
  stump: { name: 'Tree stump', model: ['tree_stump_01'], size: 16, stamp: true, moss: 0.4 },
  wood: { name: 'Driftwood', model: ['dead_tree_trunk'], size: 36, stamp: false, moss: 0.3, lie: true, slope: true },
  // From the keeper's care sheets (2026-10): a hide and a cave-or-ramp stone. Not stamped, so animals walk under them
  // (the occupancy grid keeps an arch's inside free) and count them as cover.
  cork: { name: 'Cork bark tube', procedural: true, size: 16, stamp: false, moss: 0.2, lie: true, slope: true },
  slate: { name: 'Slate slab', procedural: true, size: 18, stamp: false, moss: 0.15, lie: true, slope: true },
  // A bamboo pole for reed frogs to perch on (upright or leaning), and a log that floats at the water line (`float`: it rides
  // the water level and rests on the bottom only where the water is too shallow to hold it).
  bamboopole: { name: 'Bamboo pole', procedural: true, size: 40, stamp: false, moss: 0.05 },
  floatlog: { name: 'Floating log', procedural: true, size: 22, stamp: false, moss: 0.25, float: true, lie: true, slope: true },
  // Smooth river pebbles: a low patch that makes a gentle, textured slope out of the water (bumblebee toads, isopods).
  pebbles: { name: 'River pebbles', procedural: true, size: 14, stamp: true, moss: 0.05, slope: true },
};

export { TINTS, PROC, rollLook };
const HULLS = new WeakMap();
const UP = new THREE.Vector3(0, 1, 0);
const IDENTITY = new THREE.Matrix4().elements;
// cm between a piece's underside and what is below it beyond which the piece overhangs there (see restamp).
const STAMP_GAP = 1.2;
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
// A split cork-bark tube lying on its side: half a rough cylinder, bark outside and in, open underneath so an animal can
// creep in. Length 1 along x, radius 0.3, base at y = 0. r: seeded random (rng).
function corkGeo(r, { arc = Math.PI, rad = 0.3, wall = 0.05, n = 26, m = 14, cmPer = PIECES.cork.size } = {}) {
  const k = cmPer / BARK_TILE_CM;
  const pos = [], uv = [], idx = [];
  const bump = Array.from({ length: 5 }, () => ({ k: 3 + Math.floor(r() * 6), ph: r() * 6.28, a: 0.02 + r() * 0.04 }));
  const sag = (r() - 0.5) * 0.12, a0 = (Math.PI - arc) / 2;
  const ring = (inner) => {
    const o = pos.length / 3;
    for (let i = 0; i <= m; i++) {
      const u = i / m, x = u - 0.5;
      for (let j = 0; j <= n; j++) {
        const th = a0 + (j / n) * arc;
        let R = inner ? rad - wall : rad;
        if (!inner) for (const b of bump) R += b.a * rad * Math.sin(b.k * th + b.ph + u * 3);   // furrowed bark
        R *= 1 - 0.08 * Math.cos(u * Math.PI * 2);                                           // a little waist
        pos.push(x, Math.sin(th) * R + sag * Math.sin(u * Math.PI) * 0.3, Math.cos(th) * R);
        // Bark coordinates (barkMaterial): u round the arc, v along the tube, the grain of cork-oak bark; the inside has the
        // same coordinates as the outside, so the cut edges between them carry the bark's streaks straight through.
        uv.push(th * rad * k, u * k);
      }
    }
    for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) {
      const a = o + i * (n + 1) + j, b = a + n + 1;
      if (inner) idx.push(a, a + 1, b, a + 1, b + 1, b); else idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    return o;
  };
  const out = ring(false), inn = ring(true);
  // Close the cut edges along the bottom and the two end arcs.
  for (let i = 0; i < m; i++) for (const j of [0, n]) {
    const a = out + i * (n + 1) + j, b = out + (i + 1) * (n + 1) + j, c = inn + i * (n + 1) + j, d = inn + (i + 1) * (n + 1) + j;
    if (j === 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
  }
  for (const i of [0, m]) for (let j = 0; j < n; j++) {
    const a = out + i * (n + 1) + j, b = a + 1, c = inn + i * (n + 1) + j, d = c + 1;
    if (i === 0) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.translate(0, -g.boundingBox.min.y, 0);
  return g;
}

// A slab of slate: a thin, flat plate with a broken outline and a gently stepped top (cleavage layers). Width 1.
function slateGeo(r, { thick = 0.08, n = 16 } = {}) {
  const g = new THREE.CylinderGeometry(0.5, 0.5, 1, n, 2);
  const lobes = Array.from({ length: 4 }, () => ({ k: 2 + Math.floor(r() * 4), ph: r() * 6.28, a: 0.05 + r() * 0.08 }));
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), a = Math.atan2(z, x);
    let k = 1;
    for (const l of lobes) k += l.a * Math.sin(l.k * a + l.ph);
    k *= 1 + 0.35 * Math.cos(a) ** 2;                                      // longer than wide
    const top = y > 0 ? thick * (0.85 + 0.3 * (Math.sin(x * 9 + lobes[0].ph) > 0.4 ? 1 : 0)) : 0;
    pos.setXYZ(i, x * k, y > 0 ? top : 0, z * k * 0.8);
  }
  g.computeVertexNormals();
  g.computeBoundingBox();
  return g;
}

// A bamboo pole: a thin cane of internodes with a raised ring and a darker band at every node, its foot at the origin, height 1.
// `lean` tilts it (radians, toward +x) so the same pole can stand or lean by turning it.
function bambooGeo(r, { lean = 0, rad = 0.032, nodes = 6 } = {}) {
  const g = new THREE.CylinderGeometry(rad, rad * 1.08, 1, 14, 60, false);
  g.translate(0, 0.5, 0);
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
  const ph = r() * 0.4, cBody = new THREE.Color(0xb8a55c), cDry = new THREE.Color(0xa08a4a), cNode = new THREE.Color(0x6e5a2c), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const u = y * nodes + ph, f = u - Math.floor(u), node = Math.exp(-(((f < 0.5 ? f : f - 1) / 0.035) ** 2));
    const k = 1 + node * 0.12;
    pos.setXYZ(i, x * k + Math.sin(lean) * y, y * Math.cos(lean), z * k);
    c.copy(cBody).lerp(cDry, 0.5 + 0.5 * Math.sin(y * 13 + ph * 9)).lerp(cNode, node * 0.8);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.translate(-(g.boundingBox.min.x + g.boundingBox.max.x) / 2, 0, 0);
  g.computeBoundingBox();
  return g;
}

// A patch of smooth, water-worn pebbles: flattened, rounded stones packed into a low mound (width 1, base at y = 0).
function pebblesGeo(r, { n = 26, spread = 0.42 } = {}) {
  const list = [];
  for (let k = 0; k < n; k++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * spread, rad = 0.05 + r() * 0.07;
    const g = new THREE.IcosahedronGeometry(1, 2);
    g.scale(rad * (1 + r() * 0.5), rad * (0.4 + r() * 0.2), rad * (0.8 + r() * 0.4));
    g.rotateY(r() * Math.PI);
    g.translate(Math.cos(a) * d, rad * 0.25 * (1 - d / spread) + rad * 0.15, Math.sin(a) * d);
    list.push(g);
  }
  const g = mergeVertices(mergeGeos(list));
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.translate(0, -g.boundingBox.min.y, 0);
  g.computeBoundingBox();
  return g;
}

// A log to float: a lumpy bark cylinder along x with broken ends, length 1, base at y = 0.
function logGeo(r, { rad = 0.12, bend = 0 } = {}) {
  const g = new THREE.CylinderGeometry(rad, rad, 1, 20, 16, false);
  g.rotateZ(Math.PI / 2);
  const lobes = Array.from({ length: 4 }, () => ({ k: 2 + Math.floor(r() * 5), ph: r() * 6.28, a: 0.05 + r() * 0.08 }));
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), a = Math.atan2(z, y);
    let k = 1;
    for (const l of lobes) k += l.a * Math.sin(l.k * a + l.ph + x * 4);
    k *= 1 - 0.25 * Math.max(0, Math.abs(x) - 0.42) / 0.08 * (0.5 + 0.5 * Math.sin(a * 3 + lobes[0].ph));   // ragged ends
    pos.setXYZ(i, x, y * k + bend * (0.25 - x * x), z * k);
  }
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.translate(0, -g.boundingBox.min.y, 0);
  g.computeBoundingBox();
  return g;
}

function stumpGeo(r, { flare = 0.5, rag = 0.2, taper = 0.12 } = {}) {
  const g = new THREE.CylinderGeometry(0.5, 0.5, 1, 64, 28);   // (bark coordinates: tubeBarkUV, once it has its height)
  const lobes = Array.from({ length: 4 }, () => ({ k: 2 + Math.floor(r() * 5), ph: r() * 6.28, a: 0.04 + r() * 0.07 }));
  const topPh = r() * 6.28, tilt = (r() - 0.5) * 0.25;
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const t = y + 0.5, a = Math.atan2(z, x), rr = Math.hypot(x, z);
    let rad = 1 + flare * Math.pow(1 - t, 4) * (0.6 + 0.4 * Math.sin(a * 5 + topPh));
    for (const l of lobes) rad += l.a * Math.sin(a * l.k + l.ph);
    rad += 0.025 * Math.pow(Math.abs(Math.sin(a * 11 + Math.sin(t * 5 + topPh) * 0.6)), 0.5) - 0.02;   // bark furrows
    rad *= 1 - taper * t;
    const top = t > 0.97 ? rag * (Math.sin(a * 3 + topPh) * 0.5 + Math.sin(a * 7) * 0.3 + tilt * Math.cos(a)) * rr * 2 : 0;
    pos.setXYZ(i, x * rad, t + top, z * rad);
  }
  g.computeVertexNormals();
  g.computeBoundingBox();
  return g;
}

// Smooth value noise in 3D (seeded through the offset), for the stone's fine relief.
function vnoise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const h = (a, b, c) => hash3(xi + a, yi + b, zi + c);
  const L = (a, b, t) => a + (b - a) * t;
  return L(L(L(h(0, 0, 0), h(1, 0, 0), u), L(h(0, 1, 0), h(1, 1, 0), u), v), L(L(h(0, 0, 1), h(1, 0, 1), u), L(h(0, 1, 1), h(1, 1, 1), u), v), w);
}

// `detail` (2026-10-03): the stones used to be IcosahedronGeometry(1, 5), which in three.js is only 720 triangles (detail
// subdivides each edge linearly): smooth blobs. Now 8.8k triangles (detail 20: 32 cost 0.6 s of loading and 1 ms a frame), with relief to use them: sharp ridges (the folded
// noise of weathered limestone), vertical fissures, and the strata as stepped ledges.
function displace(rawGeo, r, { squash = 1, stretch = 1, taper = 0, strata = 0, ridge = 0.07, fissure = 0.05 } = {}) {
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
  const sf = 5 + r() * 4, sp = r() * 6, o = [r() * 100, r() * 100, r() * 100], fk = 5 + Math.floor(r() * 5), fph = r() * 6.28;
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    const n = v.clone().normalize();
    let d = 1;
    for (const w of waves) d += w.amp * Math.sin(n.dot(w.dir) * w.freq * Math.PI + w.phase);
    // Horizontal strata: layered ledges, sharp-edged like weathered stone (a smoothed staircase: flat treads, steep risers).
    if (strata) {
      const q = n.y * sf + sp, f = q - Math.floor(q), step = f < 0.75 ? 0 : (f - 0.75) / 0.25;
      d += strata * (Math.pow(Math.abs(Math.sin(q)), 3) * 0.6 + step * step * 0.8) - strata * 0.6;
    }
    // Ridged relief: 1 - |noise| makes sharp crests and rounded hollows, at two scales.
    if (ridge) {
      const a = 1 - Math.abs(vnoise3(n.x * 3.2 + o[0], n.y * 3.2 + o[1], n.z * 3.2 + o[2]) * 2 - 1);
      const b = 1 - Math.abs(vnoise3(n.x * 8 + o[1], n.y * 8 + o[2], n.z * 8 + o[0]) * 2 - 1);
      d += ridge * (a * a * 0.7 + b * b * 0.35 - 0.45) + ridge * 0.25 * (vnoise3(n.x * 19 + o[2], n.y * 19, n.z * 19 + o[1]) - 0.5);
    }
    // Vertical fissures: narrow grooves running up the stone, wandering a little.
    if (fissure) {
      const ang = Math.atan2(n.z, n.x) * fk + fph + (vnoise3(n.y * 3 + o[0], 0, 0) - 0.5) * 3;
      const g = Math.pow(Math.max(0, Math.cos(ang)), 24) * (0.5 + vnoise3(n.x * 2 + o[1], n.y * 2, n.z * 2));
      d -= fissure * g;
    }
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

// --- Bark ------------------------------------------------------------------------------------------------
// Every wood piece but the two scans that keep their photo (the root ball and the stump on its patch of forest floor) wears
// one baked, tileable furrowed bark (tools/bake-bark.mjs: colour, height in alpha, normal map). The geometry carries bark
// coordinates in tiles of BARK_TILE_CM: u round the wood, a whole number of tiles round a closed trunk so the seam
// closes, v along the grain, laid out at the piece's catalogue size (so a piece drawn bigger or smaller has bark a little
// coarser or finer, like a real thicker or thinner trunk). Before 2026-10-04 these pieces sampled the stump scan's photo
// atlas (mostly forest floor, with the atlas' smeared island edges) at 2-3x stretch.
export const BARK_TILE_CM = 10;
const barkMats = new Map();

// `along`: the local axis of the grain ('x' logs, cork, driftwood; 'y' stumps). A piece scaled more along its length than
// round it (the generator draws logs 1.5x thicker) gets its v rescaled from the object's scale, so the plates keep their
// shape (u, which closes round the trunk, is left alone). Moss grows in the furrows first, on faces turned up and in the
// wet band just above the water line, from the bark's own height at two scales (no noise lookups).
export function barkMaterial(along, tint = null, moss = 0.3) {
  const key = along + '/' + moss + '/' + (tint ? tint.join() : '');
  if (barkMats.has(key)) return barkMats.get(key);
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0 });
  m.shadowSide = THREE.BackSide;
  const S = modelScale.abs();
  const stretch = along === 'x' ? S.x.mul(2).div(S.y.add(S.z)) : S.y.mul(2).div(S.x.add(S.z));
  const buv = varying(uv().mul(vec2(1, stretch)), 'vBarkUV');
  const tx = texture(TEX.bark, buv);
  const pw = positionWorld;
  let base = tx.rgb;
  if (tint) base = base.mul(vec3(tint[0], tint[1], tint[2]));
  const above = pw.y.sub(U.waterLevel);
  const patches = texture(TEX.bark, buv.mul(0.21).add(vec2(0.37, 0.11))).a;          // coarse patches: the bark's height, 5x larger
  const want = normalWorld.y.mul(0.6)
    .add(float(1).sub(smoothstep(0.5, 9, above)).mul(0.45))                          // wet band above the water line
    .add(float(1).sub(tx.a).mul(0.4))                                                // furrows before ridges
    .add(patches.mul(0.35)).add(moss * 0.5)
    .sub(float(1).sub(U.rockMoss).mul(0.9));
  const cover = smoothstep(0.85, 1.15, want).mul(smoothstep(0, 1, above));
  const mossCol = texture(TEX.ground[4], buv.mul(1.6)).rgb.mul(vec3(0.5, 0.74, 0.38));
  base = mix(base, mossCol, cover);
  const film = float(1).sub(smoothstep(-0.5, 0.2, above)).mul(U.algaeFilm).mul(patches.mul(0.4).add(0.6));
  base = mix(base, U.algaeColor, film.clamp(0, 0.7));
  base = mouldMix(base, pw);
  const [color, emissive] = wet(base, pw);
  m.colorNode = color;
  m.emissiveNode = emissive;
  m.normalNode = normalMap(texture(TEX.barkNormal, buv), vec2(float(1).sub(cover.mul(0.7))));
  m.userData.barkUV = { size: 512, along };     // for tools/steps/decor-ground.mjs (texel density)
  barkMats.set(key, m);
  return m;
}

// The scanned root ball (an open sheet of soil, a bank face, with roots on it): its photo is 512 px for 4 m of scan, so on the
// roots it was a few smeared texels across (17 texels/cm at the catalogue size, in the soil's colour). tools/bake-bark.mjs
// (`roots`) finds the root strands and lays bark coordinates along each, in tiles of 3 cm (finer plates than a trunk's, as on
// a thin root), stored per vertex: they go in as 'uv1' and how much of a strand each vertex is as 'barkMask'. Returns false
// (and the piece keeps its photo) when the file is missing or was made for another mesh.
function rootBarkAttributes(g, buf) {
  if (!buf || buf.byteLength < 8) return false;
  const dv = new DataView(buf), n = dv.getUint32(0, true);
  if (n !== g.attributes.position.count || buf.byteLength < 8 + n * 5) return false;
  const step = dv.getFloat32(4, true), u = new Int16Array(buf, 8, n), v = new Int16Array(buf, 8 + n * 2, n), s = new Uint8Array(buf, 8 + n * 4, n);
  const uv1 = new Float32Array(n * 2), k = new Float32Array(n);
  for (let i = 0; i < n; i++) { uv1[i * 2] = u[i] * step; uv1[i * 2 + 1] = v[i] * step; k[i] = s[i] / 255; }
  g.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
  g.setAttribute('barkMask', new THREE.BufferAttribute(k, 1));
  return true;
}

// Its material: the scan's photo and normal map on the soil (moss, algae, mould and wetness as hardscapeMaterial), the furrowed
// bark on the strands, warmed toward the scan's root colour. The bark's normal map is turned into the strand's own frame from
// the screen derivatives of 'uv1' (three's normal map takes its frame from the first uv set, the photo's atlas).
const ROOT_TINT = [1.6, 1.15, 0.82];
function rootsMaterial(src, moss, tint) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0 });
  m.shadowSide = THREE.BackSide;
  if (src.roughnessMap) m.roughnessMap = src.roughnessMap;
  const pw = positionWorld, buv = uv(1), k = smoothstep(0.3, 0.8, attribute('barkMask', 'float'));
  const bark = texture(TEX.bark, buv);
  let base = mix(src.map ? texture(src.map, uv()).rgb : vec3(0.3, 0.17, 0.1), bark.rgb.mul(vec3(...ROOT_TINT)), k);
  if (tint) base = base.mul(vec3(tint[0], tint[1], tint[2]));
  const n = noise3(pw.mul(0.25)).mul(0.5).add(noise3(pw.mul(0.9)).mul(0.25));
  const aboveWater = smoothstep(0.0, 1.5, pw.y.sub(U.waterLevel));
  const cover = smoothstep(0.75 - moss * 0.6, 0.95 - moss * 0.5, normalWorld.y.add(n).add(float(1).sub(bark.a).mul(k).mul(0.25)).sub(float(1).sub(U.rockMoss).mul(0.9))).mul(aboveWater);
  base = mix(base, triplanar(TEX.ground[4], 1 / 9, pw, blendWeights()).mul(vec3(0.55, 0.8, 0.42)), cover);
  const film = smoothstep(0.2, -0.5, pw.y.sub(U.waterLevel)).mul(U.algaeFilm).mul(noise3(pw.mul(0.5)).mul(0.4).add(0.6));
  base = mix(base, U.algaeColor, film.clamp(0, 0.7));
  const [color, emissive] = wet(mouldMix(base, pw), pw);
  m.colorNode = color;
  m.emissiveNode = emissive;
  // Bark normal in the strand's frame (http://www.thetenthplanet.de/archives/1180, as three's TangentUtils, on uv1).
  const q0 = positionView.dFdx(), q1 = positionView.dFdy(), s0 = buv.dFdx(), s1 = buv.dFdy(), N = normalView;
  const q1p = q1.cross(N), q0p = N.cross(q0);
  const T = q1p.mul(s0.x).add(q0p.mul(s1.x)), B = q1p.mul(s0.y).add(q0p.mul(s1.y));
  const sc = T.dot(T).max(B.dot(B)).max(1e-20).inverseSqrt();
  const tn = texture(TEX.barkNormal, buv).xyz.mul(2).sub(1);
  const barkN = T.mul(sc.mul(tn.x)).add(B.mul(sc.mul(tn.y))).add(N.mul(tn.z));
  const soilN = src.normalMap ? normalMap(texture(src.normalMap, uv())) : N;
  m.normalNode = normalize(mix(soilN, barkN, k));
  m.userData.barkUV = { size: 512, attr: 'uv1', mask: 'barkMask' };     // for tools/steps/decor-ground.mjs (texel density)
  return m;
}

// v along a trunk whose girth changes (a flared foot, a tapering log): with a whole number of tiles round it, the bark keeps
// its shape only if v advances by tiles / girth per unit of length where it is. `along[i]`, `rad[i]`: each vertex's position
// along the axis and distance from it. Returns v(position), integrated over 40 slabs (each slab's girth smoothed over its
// neighbours), so plates are smaller on the thin parts and larger on the thick ones, as on a real trunk.
function barkV(along, rad, tiles) {
  let lo = Infinity, hi = -Infinity;
  for (const a of along) { if (a < lo) lo = a; if (a > hi) hi = a; }
  const nb = 40, w = Math.max((hi - lo) / nb, 1e-6), rs = new Float64Array(nb), rn = new Float64Array(nb);
  for (let i = 0; i < along.length; i++) { const j = Math.min(nb - 1, Math.floor((along[i] - lo) / w)); rs[j] += rad[i]; rn[j]++; }
  const cum = new Float64Array(nb + 1);
  for (let j = 0; j < nb; j++) {
    let r = 0, c = 0;
    for (let d = -2; d <= 2; d++) { const q = j + d; if (q >= 0 && q < nb) { r += rs[q]; c += rn[q]; } }
    cum[j + 1] = cum[j] + (tiles / (2 * Math.PI * Math.max(r / Math.max(c, 1), 1e-6))) * w;
  }
  return (a) => { const f = Math.min(nb, Math.max(0, (a - lo) / w)), j = Math.min(nb - 1, Math.floor(f)); return cum[j] + (cum[j + 1] - cum[j]) * (f - j); };
}

// Bark coordinates on a tube round local `axis` ('x' or 'y'), from a three.js cylinder whose own u runs 0 … 1 round it:
// u becomes a whole number of tiles round (the mean girth at `cmPer` cm per local unit), v the position along the axis.
// Vertices from `capFrom` on are the end caps, laid flat across the axis.
function tubeBarkUV(g, axis, cmPer, capFrom = Infinity) {
  const pos = g.attributes.position, uvA = g.attributes.uv, n = pos.count, k = cmPer / BARK_TILE_CM;
  const at = (i, c) => (c === 0 ? pos.getX(i) : c === 1 ? pos.getY(i) : pos.getZ(i));
  const a = axis === 'x' ? 0 : 1, b = axis === 'x' ? 1 : 0, c = 2;
  const m = Math.min(n, capFrom);
  let cb = 0, cc = 0;
  for (let i = 0; i < m; i++) { cb += at(i, b); cc += at(i, c); }
  cb /= m; cc /= m;
  let rs = 0;
  for (let i = 0; i < m; i++) rs += Math.hypot(at(i, b) - cb, at(i, c) - cc);
  // A thin trunk has its girth rounded to a whole number of tiles; v follows the rounded u, so the plates keep their shape and
  // only the bark's scale moves off the nominal one.
  const girth = 2 * Math.PI * (rs / m), tiles = Math.max(1, Math.round(girth * k)), kv = tiles / girth;
  const al = [], rd = [];
  for (let i = 0; i < m; i++) { al.push(at(i, a)); rd.push(Math.hypot(at(i, b) - cb, at(i, c) - cc)); }
  const vAt = barkV(al, rd, tiles);
  const out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    if (i < capFrom) { out[i * 2] = uvA.getX(i) * tiles; out[i * 2 + 1] = vAt(at(i, a)); } else { out[i * 2] = (at(i, b) - cb) * kv; out[i * 2 + 1] = (at(i, c) - cc) * kv; }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(out, 2));
  return g;
}

// Bark coordinates for the scanned driftwood (long along local x; its own UVs are a photo atlas): u from the angle round a
// smoothed centre line (the seam on the underside, where triangles that straddle it get their own copies of the vertices
// on one side), v along x. Returns a new indexed geometry with plain attributes.
export function logBarkUV(src, cmPer) {
  const pos = src.attributes.position, n = pos.count, k = cmPer / BARK_TILE_CM;
  src.computeBoundingBox();
  const x0 = src.boundingBox.min.x, len = src.boundingBox.max.x - x0, slab = Math.max(len / 40, 1e-6), nb = Math.ceil(len / slab) + 1;
  // Centre per slab: the middle of the slab's extent (a mean would lean toward where the scan has more vertices), smoothed
  // over its neighbours (empty slabs borrow from them).
  const y0 = new Float64Array(nb).fill(Infinity), y1 = new Float64Array(nb).fill(-Infinity), z0 = new Float64Array(nb).fill(Infinity), z1 = new Float64Array(nb).fill(-Infinity);
  for (let i = 0; i < n; i++) {
    const j = Math.min(nb - 1, Math.floor((pos.getX(i) - x0) / slab)), y = pos.getY(i), z = pos.getZ(i);
    if (y < y0[j]) y0[j] = y; if (y > y1[j]) y1[j] = y; if (z < z0[j]) z0[j] = z; if (z > z1[j]) z1[j] = z;
  }
  const cy = new Float64Array(nb), cz = new Float64Array(nb);
  for (let j = 0; j < nb; j++) {
    let y = 0, z = 0, w = 0;
    for (let d = -2; d <= 2; d++) { const q = j + d; if (q < 0 || q >= nb || y0[q] === Infinity) continue; const k2 = d === 0 ? 2 : 1; y += (y0[q] + y1[q]) / 2 * k2; z += (z0[q] + z1[q]) / 2 * k2; w += k2; }
    cy[j] = w ? y / w : 0; cz[j] = w ? z / w : 0;
  }
  const centre = (x) => { const f = Math.min(nb - 1.001, Math.max(0, (x - x0) / slab - 0.5)), j = Math.floor(f), t = f - j; return [cy[j] + (cy[j + 1] - cy[j]) * t, cz[j] + (cz[j + 1] - cz[j]) * t]; };
  const ang = new Float64Array(n), rd = new Float64Array(n), al = new Float64Array(n);
  let rs = 0;
  for (let i = 0; i < n; i++) { const [yc, zc] = centre(pos.getX(i)), dy = pos.getY(i) - yc, dz = pos.getZ(i) - zc; ang[i] = Math.atan2(dz, dy); rd[i] = Math.hypot(dy, dz); al[i] = pos.getX(i); rs += rd[i]; }
  const tiles = Math.max(1, Math.round(2 * Math.PI * (rs / n) * k)), vAt = barkV(al, rd, tiles);   // (as tubeBarkUV)
  // θ = 0 on top, ±π underneath: u runs 0 … tiles from the underside round over the top and back.
  const u = Array.from(ang, (t) => (t / (2 * Math.PI) + 0.5) * tiles), v = Array.from(al, vAt);
  const idx = Array.from(src.index ? src.index.array : Array.from({ length: n }, (_, i) => i));
  const copy = new Map(), from = [];
  for (let t = 0; t < idx.length; t += 3) {
    const tri = [idx[t], idx[t + 1], idx[t + 2]], us = tri.map((i) => u[i]);
    if (Math.max(...us) - Math.min(...us) <= tiles / 2) continue;
    for (let e = 0; e < 3; e++) {
      const i = tri[e];
      if (u[i] >= tiles / 2) continue;
      if (!copy.has(i)) { copy.set(i, u.length); from.push(i); u.push(u[i] + tiles); v.push(v[i]); }
      idx[t + e] = copy.get(i);
    }
  }
  const total = n + from.length, g = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(src.attributes)) {
    if (name === 'uv') continue;
    const s = attr.itemSize, out = new Float32Array(total * s);
    const get = (i, c) => attr.getComponent(i, c);
    for (let i = 0; i < total; i++) { const o = i < n ? i : from[i - n]; for (let c = 0; c < s; c++) out[i * s + c] = get(o, c); }
    g.setAttribute(name, new THREE.BufferAttribute(out, s));
  }
  const uvs = new Float32Array(total * 2);
  for (let i = 0; i < total; i++) { uvs[i * 2] = u[i]; uvs[i * 2 + 1] = v[i]; }
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
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
    const rootBin = loadBinary('ground/root_cluster_01_bark.bin');
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
      // The root ball's strands in bark (rootBarkAttributes); its warped variants below copy the attributes and material.
      if (type === 'roots' && list[0] && rootBarkAttributes(list[0].geometry, await rootBin)) {
        const r = list[0], mats = new Map();
        list[0] = { ...part(r.geometry, (tint) => { const k = tint ? tint.join() : ''; if (!mats.has(k)) mats.set(k, rootsMaterial(r.src, def.moss, tint)); return mats.get(k); }, r.name), src: r.src };
      }
      this.parts[type] = list;
    }
    const R = (seed) => rng(seed);
    const P = this.parts;
    const sm = stone;

    // Spires: the original five, then a thin shard, a fat butte and a crooked one.
    const r = R(7);
    P.spire = Array.from({ length: 5 }, (_, i) => {
      const geometry = displace(new THREE.IcosahedronGeometry(1, 20), r, { squash: 1, stretch: 1.8 + r() * 0.9, taper: 0.45 + r() * 0.3, strata: 0.1 + r() * 0.08 });
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
      let geometry = displace(new THREE.IcosahedronGeometry(1, 20), r2, o);
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
      const geometry = displace(new THREE.IcosahedronGeometry(1, 20), r3, o);
      geometry.computeBoundsTree();
      P.boulder.push(part(geometry, sm, 'boulderx' + i));
    });

    // Stumps: a broad flared one, a slim tall one and a ragged broken one, in bark (barkMaterial).
    const r4 = R(719);
    const bark = (along, moss) => (tint) => barkMaterial(along, tint, moss);
    const torso = (radial, height) => (radial + 1) * (height + 1);      // vertices of a three.js cylinder's side
    [{ flare: 0.7, rag: 0.12, taper: 0.05, h: 0.5 }, { flare: 0.3, rag: 0.1, taper: 0.2, h: 1.1 }, { flare: 0.5, rag: 0.4, taper: 0.1, h: 0.8 }].forEach((o, i) => {
      const geometry = stumpGeo(r4, o);
      geometry.scale(1, o.h, 1);
      geometry.computeBoundingBox();
      const bb = geometry.boundingBox;
      geometry.translate(0, -bb.min.y, 0);
      geometry.computeBoundingBox();
      const s = geometry.boundingBox.getSize(new THREE.Vector3());
      tubeBarkUV(geometry, 'y', PIECES.stump.size / Math.max(s.x, s.y, s.z), torso(64, 28));
      geometry.computeBoundingSphere(); geometry.computeBoundsTree();
      P.stump.push(part(geometry, bark('y', PIECES.stump.moss), 'stumpx' + i));
    });

    // Cork bark tubes and slate slabs (dark stone).
    const r6 = R(1201);
    P.cork = [{ arc: Math.PI }, { arc: Math.PI * 1.25, rad: 0.34 }, { arc: Math.PI * 0.85, rad: 0.27 }].map((o, i) => {
      const geometry = corkGeo(r6, o);
      geometry.computeBoundingSphere(); geometry.computeBoundsTree();
      return part(geometry, bark('x', PIECES.cork.moss), 'cork' + i);
    });
    const r7 = R(1301), slateTint = [0.55, 0.58, 0.62];
    P.slate = [0.07, 0.1, 0.06].map((thick, i) => {
      const geometry = slateGeo(r7, { thick });
      geometry.computeBoundingSphere(); geometry.computeBoundsTree();
      return part(geometry, (tint) => sm(tint ?? slateTint), 'slate' + i);
    });

    // Bamboo poles (upright, leaning, steep) and floating logs (in bark).
    const r8 = R(1409), bambooMats = new Map();
    const bambooMat = (tint) => {
      const k = tint ? tint.join() : '';
      if (!bambooMats.has(k)) bambooMats.set(k, new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.42, color: tint ? new THREE.Color(...tint) : 0xffffff }));
      return bambooMats.get(k);
    };
    P.bamboopole = [{ lean: 0.08 }, { lean: 0.4 }, { lean: 0.7, nodes: 5 }].map((o, i) => {
      const geometry = bambooGeo(r8, o);
      geometry.computeBoundingSphere(); geometry.computeBoundsTree();
      return part(geometry, bambooMat, 'bamboopole' + i);
    });
    P.floatlog = [{ rad: 0.12 }, { rad: 0.1, bend: 0.06 }, { rad: 0.14, bend: -0.04 }].map((o, i) => {
      const geometry = tubeBarkUV(logGeo(r8, o), 'x', PIECES.floatlog.size, torso(20, 16));
      geometry.computeBoundingSphere(); geometry.computeBoundsTree();
      return part(geometry, bark('x', PIECES.floatlog.moss), 'floatlog' + i);
    });

    const r9 = R(1511);
    P.pebbles = [{ n: 26 }, { n: 34, spread: 0.46 }, { n: 18, spread: 0.36 }].map((o, i) => {
      const geometry = pebblesGeo(r9, o);
      geometry.computeBoundingSphere(); geometry.computeBoundsTree();
      return part(geometry, (tint) => sm(tint ?? [0.72, 0.7, 0.66]), 'pebbles' + i);
    });

    // The driftwood scan in bark: coordinates round its length (its photo atlas was smeared and 20 texels/cm).
    const w0 = P.wood[0];
    if (w0) {
      const wb = w0.geometry.boundingBox, ext = Math.max(wb.max.x - wb.min.x, wb.max.y - wb.min.y, wb.max.z - wb.min.z);
      const geometry = logBarkUV(w0.geometry, PIECES.wood.size / ext);
      geometry.computeBoundsTree();
      P.wood[0] = part(geometry, bark('x', PIECES.wood.moss), w0.name);
    }

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
  // so pieces stack). opt: variant, size, rot, tilt, scale [sx, sy, sz], y, sink, rest (stacked on another piece: rests
  // on its highest contact instead of being planted, see settle),
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
    // Given no tilt, a slab, tube, log or pebble patch lies along the slope under it (settle), until it is turned by hand.
    if (def.slope && opt.tilt === undefined && opt.y === undefined) { piece.follow = true; piece.yaw = rot; }
    if (def.face && opt.face !== false) {
      piece.rot = rot;
      piece.snap = opt.snap;
      this.placeFace(piece, x, z, { snap: opt.snap, sink: opt.sink });
      this.restamp(piece);
      return piece;
    }
    if (opt.y !== undefined) piece.mesh.position.y = opt.y;
    else this.settle(piece, opt.sink ?? def.sink ?? 0.08, !!opt.rest);
    // Inside the glass, whatever the size, turn and scale; re-seat after a sideways move.
    if (this.clampPiece(piece) && opt.y === undefined) { this.settle(piece, opt.sink ?? def.sink ?? 0.08, !!opt.rest); this.clampPiece(piece); }
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

  // Sits the piece on the ground (ignoring its own stamp), from its real vertices: a `lie` piece rests on its lowest contact,
  // sunk by `sink` of its thickness; anything else (and a lying piece stood on end) is planted, its whole base at or under the
  // ground, sunk by `sink` of its height. The ground is the substrate with the other pieces' stamps, and the tops of the
  // unstamped pieces (logs, roots, cork) under it, so a piece put on a log rests on it instead of sinking into it.
  // `rest`: a piece stacked on another (a kit's bridge or stack, Shift+click in the editor) rests on its highest contact
  // like a lying piece, sunk by `sink` of its thickness; planted, its base would sink to the lowest ground round the piece
  // under it. (Before 2026-10-04 it took the lowest of five ground samples and the bounding box's bottom, which hangs below a
  // tilted piece's real bottom: logs floated up to 6 cm; kits, the starter tank and the editor set a height of their own.)
  settle(piece, sink = 0.08, rest = false) {
    const T = this.world.terrain, def = PIECES[piece.type];
    const own = piece.stamp;
    if (own) { piece.stamp = null; T.compose(this.stamps()); }
    const m = piece.mesh;
    m.position.y = 0;
    // (A log afloat lies level on the water, not along the bottom.)
    const afloat = def.float && (this.world.water?.level ?? -Infinity) > T.heightAt(m.position.x, m.position.z) + 1;
    if (piece.follow) this.followSlope(piece, afloat);
    m.updateMatrixWorld(true);
    const pts = this.hullWorld(piece);
    const box = transformedBox(pts, IDENTITY);
    const h = box.max[1] - box.min[1], wide = Math.max(box.max[0] - box.min[0], box.max[2] - box.min[2]);
    const ground = this.groundFn(piece, box);
    if (rest || (def.lie && h <= wide)) {
      const bb = m.geometry.boundingBox, sc = m.scale;
      const thick = Math.min((bb.max.x - bb.min.x) * Math.abs(sc.x), (bb.max.y - bb.min.y) * Math.abs(sc.y), (bb.max.z - bb.min.z) * Math.abs(sc.z));
      // (A piece turned to the slope under it that is steeper than it may tilt digs its high end in: lieLift.)
      m.position.y = (piece.follow && !rest ? lieLift(pts, ground, Math.max(1, 0.25 * h)) : restLift(pts, ground)) - sink * thick;
    } else m.position.y = plantLift(pts, ground, Math.max(0.5, 0.05 * h)) - sink * h;
    // A floating log rides the water with about 45% of it under, unless the water there is too shallow to float it.
    if (def.float) {
      const lvl = this.world.water?.level ?? -Infinity, fy = lvl - box.min[1] - 0.45 * h;
      if (fy > m.position.y) m.position.y = fy;
    }
    m.updateMatrixWorld(true);
    if (own) piece.stamp = own;
  }

  // Turns a `follow` piece to the plane of the ground under its footprint (its own yaw kept, at most 0.6 rad of tilt). A piece
  // turned by hand since (its rotation is not the one set here) keeps its rotation.
  followSlope(piece, level = false) {
    const m = piece.mesh;
    if (piece.followQ && m.quaternion.angleTo(piece.followQ) > 1e-3) { piece.follow = false; return; }
    const yawQ = new THREE.Quaternion().setFromAxisAngle(UP, piece.yaw ?? 0);
    m.quaternion.copy(yawQ);
    piece.followQ = m.quaternion.clone();
    if (level) return;
    m.updateMatrixWorld(true);
    const b = transformedBox(this.hullWorld(piece), IDENTITY), T = this.world.terrain, smp = [];
    for (let i = 0; i <= 3; i++) for (let j = 0; j <= 3; j++) {
      const x = b.min[0] + ((b.max[0] - b.min[0]) * i) / 3, z = b.min[2] + ((b.max[2] - b.min[2]) * j) / 3;
      smp.push(x, T.heightAt(x, z), z);
    }
    const n = groundNormal(smp);
    m.quaternion.setFromUnitVectors(UP, new THREE.Vector3(n[0], n[1], n[2])).multiply(yawQ);
    piece.followQ = m.quaternion.clone();
  }

  // The piece's sparse hull points in world space, as it is placed now (see pieceBox).
  hullWorld(piece) {
    const m = piece.mesh;
    m.updateMatrixWorld(true);
    const p = this.hullOf(m.geometry), e = m.matrixWorld.elements, out = new Float32Array(p.length);
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i], y = p[i + 1], z = p[i + 2];
      out[i] = e[0] * x + e[4] * y + e[8] * z + e[12];
      out[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      out[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
    }
    return out;
  }

  // What a piece settles on at (x, z): the substrate with the other pieces' stamps, or the top of an unstamped piece (wood,
  // roots, cork, slate) whose box overlaps the footprint `box`. Ray hits are cached on a half-centimetre grid.
  groundFn(piece, box) {
    const T = this.world.terrain, under = [];
    for (const q of this.pieces) {
      if (q === piece || PIECES[q.type].stamp) continue;
      const b = this.pieceBox(q);
      if (b.max[0] < box.min[0] || b.min[0] > box.max[0] || b.max[2] < box.min[2] || b.min[2] > box.max[2]) continue;
      under.push({ q, b });
    }
    if (!under.length) return (x, z) => T.heightAt(x, z);
    const cache = new Map(), o = new THREE.Vector3(), down = new THREE.Vector3(0, -1, 0);
    return (x, z) => {
      const g = T.heightAt(x, z), key = Math.round(x * 2) * 100003 + Math.round(z * 2);
      let top = cache.get(key);
      if (top === undefined) {
        top = -Infinity;
        for (const { q, b } of under) {
          if (x < b.min[0] || x > b.max[0] || z < b.min[2] || z > b.max[2]) continue;
          this.ray.set(o.set(x, b.max[1] + 1, z), down);
          const hit = this.ray.intersectObject(q.mesh, false)[0];
          if (hit && hit.point.y > top) top = hit.point.y;
        }
        cache.set(key, top);
      }
      return Math.max(g, top);
    };
  }

  // The water level changed: floating pieces rise or sink with it.
  refloat() {
    let moved = false;
    for (const p of this.pieces) if (PIECES[p.type].float) { this.settle(p, 0); moved = true; }
    if (moved) this.occupancyVersion++;     // not stamped: only the animals' occupancy grid needs to know
    return moved;
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

  // The ground under the piece rises to its top surface (what animals, water and stacking see), and each raised point
  // also says whether the drawn ground may rise with it (`vis`). The drawn ground is a grid of triangles, so a raised point
  // is joined straight to its unraised neighbours, and those joins showed in two places: under an overhang, where the ground
  // filled the open space under the rock with a sheet in front of its underside, and on the outer ring of the footprint,
  // where they poked out of a steep side as a row of teeth (both on a boulder overhanging a ledge). So the drawn ground rises
  // only where the piece rests on what is below it, and not on the outer ring of that (terrain.js `hv`).
  restamp(piece) {
    this.occupancyVersion++;
    const def = PIECES[piece.type];
    const T = this.world.terrain;
    if (def.stamp) {
      const f = T.field;
      piece.mesh.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(piece.mesh);
      const down = new THREE.Vector3(0, -1, 0), up = new THREE.Vector3(0, 1, 0);
      const o = new THREE.Vector3();
      // What the piece stands on: the sculpted ground and every other piece's stamp, not its own.
      const ground = f.base.slice();
      for (const p of this.pieces) {
        const s = p !== piece && p.stamp;
        if (s) for (let k = 0; k < s.idx.length; k++) if (s.top[k] > ground[s.idx[k]]) ground[s.idx[k]] = s.top[k];
      }
      const [i0, j0] = f.toGrid(box.min.x, box.min.z).map(Math.floor);
      const [i1, j1] = f.toGrid(box.max.x, box.max.z).map(Math.ceil);
      const ia = Math.max(0, i0), ib = Math.min(f.nx, i1), ja = Math.max(0, j0), jb = Math.min(f.ny, j1);
      const W = ib - ia + 1, H = jb - ja + 1;
      const tops = new Float32Array(W * H).fill(NaN);   // NaN: the piece is not over this point
      const rests = new Uint8Array(W * H);              // 1: and its underside rests on what is below
      for (let j = ja; j <= jb; j++) {
        for (let i = ia; i <= ib; i++) {
          const [x, z] = f.toWorld(i, j);
          this.ray.set(o.set(x, box.max.y + 1, z), down);
          const hit = this.ray.intersectObject(piece.mesh, false)[0];
          if (!hit) continue;
          const c = (j - ja) * W + (i - ia);
          tops[c] = Math.min(f.maxH, hit.point.y - 0.15);
          this.ray.set(o.set(x, box.min.y - 1, z), up);
          const under = this.ray.intersectObject(piece.mesh, false)[0];
          rests[c] = !under || under.point.y <= ground[f.idx(i, j)] + STAMP_GAP ? 1 : 0;
        }
      }
      const idx = [], top = [], vis = [];
      const r = (i, j) => (i < 0 || j < 0 || i >= W || j >= H ? 0 : rests[j * W + i]);
      for (let j = 0; j < H; j++) {
        for (let i = 0; i < W; i++) {
          const t = tops[j * W + i];
          if (Number.isNaN(t)) continue;
          idx.push(f.idx(i + ia, j + ja));
          top.push(t);
          vis.push(r(i, j) && r(i + 1, j) && r(i - 1, j) && r(i, j + 1) && r(i, j - 1) ? 1 : 0);
        }
      }
      piece.stamp = { idx: Int32Array.from(idx), top: Float32Array.from(top), vis: Uint8Array.from(vis) };
    } else piece.stamp = null;
    T.compose(this.stamps());
  }

  // The world-space box of the piece (its rotated, scaled, flipped mesh), from a sparse sample of
  // the vertices that is cached per geometry.
  pieceBox(piece) {
    const m = piece.mesh;
    m.updateMatrixWorld(true);
    return transformedBox(this.hullOf(m.geometry), m.matrixWorld.elements);
  }

  // A sparse set of a geometry's vertices (placement.js hullPoints), cached per geometry (not in userData: clone() copies
  // that) and re-made if the geometry changed.
  hullOf(g) {
    const sig = g.boundingBox ? g.boundingBox.min.toArray().concat(g.boundingBox.max.toArray()).join() : '';
    let h = HULLS.get(g);
    if (!h || h.sig !== sig || h.n !== g.attributes.position.count) {
      // Scanned models store positions interleaved with normals and UVs: read them one by one.
      const a = g.attributes.position, flat = new Float32Array(a.count * 3);
      for (let i = 0; i < a.count; i++) { flat[i * 3] = a.getX(i); flat[i * 3 + 1] = a.getY(i); flat[i * 3 + 2] = a.getZ(i); }
      h = { sig, n: a.count, pts: hullPoints(flat) };
      HULLS.set(g, h);
    }
    return h.pts;
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
