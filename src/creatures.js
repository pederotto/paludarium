// Creature bodies and their animation.
//
// Shapes: each species is a signed distance function (SDF) built from
// ellipsoids and capsules merged with a smooth minimum, turned into a mesh by
// naive surface nets. The mesher is ported from CAUSTIC//VOLUME's lite
// version (https://github.com/scottiefox/caustic-volume, MIT), where it
// builds the rubber duck. Colours (spots, stripes, bellies) are painted per
// vertex from the same model space.
//
// Rig: each vertex also records where it is on the body: `spine` (0 at the
// snout, 1 at the tail tip), which leg it belongs to (1 front left, 2 front
// right, 3 back left, 4 back right, 0 none) and how far down that leg it is.
// The vertex shader uses that to undulate tails and bodies, swing legs in a
// diagonal walking gait and stretch a frog's back legs in a hop, per
// instance, without skeletons.

import * as THREE from 'three/webgpu';
import {
  Fn, attribute, positionLocal, normalLocal, vec3, vec4, float, sin, cos, max, cross, transformNormalToView, mix, clamp, abs,
} from 'three/tsl';
import { wet } from './shaders.js';

// --- SDF helpers (model space, centimetres) ---------------------------------
export const ell = (x, y, z, a, b, c) => {
  x /= a; y /= b; z /= c;
  const k0 = Math.sqrt(x * x + y * y + z * z), k1 = Math.sqrt(x * x / (a * a) + y * y / (b * b) + z * z / (c * c));
  return k1 ? (k0 * (k0 - 1)) / k1 : -Math.min(a, b, c);
};
export const smin = (a, b, k) => {
  const h = Math.min(Math.max(0.5 + (0.5 * (b - a)) / k, 0), 1);
  return b + (a - b) * h - k * h * (1 - h);
};
// Capsule from A to B with radii ra → rb; also returns t (0 at A, 1 at B).
export function cap(p, a, b, ra, rb) {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const pax = p[0] - a[0], pay = p[1] - a[1], paz = p[2] - a[2];
  const t = Math.max(0, Math.min(1, (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz)));
  const dx = pax - bax * t, dy = pay - bay * t, dz = paz - baz * t;
  return [Math.hypot(dx, dy, dz) - (ra + (rb - ra) * t), t];
}
export const hash = (x, y, z) => {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
};
// Smooth 3D value noise for skin patterns.
export function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const s = (t) => t * t * (3 - 2 * t);
  const u = s(xf), v = s(yf), w = s(zf);
  let r = 0;
  for (let k = 0; k < 8; k++) {
    const dx = k & 1, dy = (k >> 1) & 1, dz = k >> 2;
    r += hash(xi + dx, yi + dy, zi + dz) * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
  }
  return r;
}

// --- Surface nets (from CAUSTIC//VOLUME) -------------------------------------
const EDGES = [];
for (let c = 0; c < 8; c++) for (const b of [1, 2, 4]) if (!(c & b)) EDGES.push(c, c | b);
export function surfaceNet(sdf, lo, hi, h) {
  const nx = Math.ceil((hi[0] - lo[0]) / h) + 1, ny = Math.ceil((hi[1] - lo[1]) / h) + 1, nz = Math.ceil((hi[2] - lo[2]) / h) + 1, S = [1, nx, nx * ny];
  const V = new Float32Array(nx * ny * nz), id = new Int32Array(nx * ny * nz).fill(-1), P = [], N = [], I = [];
  for (let k = 0, q = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++, q++) V[q] = sdf(lo[0] + i * h, lo[1] + j * h, lo[2] + k * h);
  const corner = [0, 1, 2, 3, 4, 5, 6, 7].map((c) => (c & 1) + ((c >> 1) & 1) * S[1] + (c >> 2) * S[2]), e = h * 0.05;
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0, q = (k * ny + j) * nx; i < nx - 1; i++, q++) {
    let n = 0, sx = 0, sy = 0, sz = 0;
    for (let a = 0; a < 24; a += 2) {
      const c0 = EDGES[a], c1 = EDGES[a + 1], v0 = V[q + corner[c0]], v1 = V[q + corner[c1]];
      if ((v0 < 0) === (v1 < 0)) continue;
      const t = v0 / (v0 - v1);
      sx += (c0 & 1) + ((c1 & 1) - (c0 & 1)) * t; sy += ((c0 >> 1) & 1) + (((c1 >> 1) & 1) - ((c0 >> 1) & 1)) * t; sz += (c0 >> 2) + ((c1 >> 2) - (c0 >> 2)) * t; n++;
    }
    if (!n) continue;
    let x = lo[0] + (i + sx / n) * h, y = lo[1] + (j + sy / n) * h, z = lo[2] + (k + sz / n) * h;
    for (let it = 0; it < 2; it++) {
      const d = sdf(x, y, z), gx = sdf(x + e, y, z) - d, gy = sdf(x, y + e, z) - d, gz = sdf(x, y, z + e) - d, l = Math.hypot(gx, gy, gz) || 1;
      if (it) N.push(gx / l, gy / l, gz / l); else { const m = Math.max(-h / 2, Math.min(h / 2, d)) / l; x -= m * gx; y -= m * gy; z -= m * gz; }
    }
    id[q] = P.length / 3; P.push(x, y, z);
  }
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1, q = (k * ny + j) * nx + 1; i < nx - 1; i++, q++) {
    const inside = V[q] < 0;
    for (let a = 0; a < 3; a++) {
      if ((V[q + S[a]] < 0) === inside) continue;
      const b = S[(a + 1) % 3], c = S[(a + 2) % 3], q00 = id[q - b - c], q10 = id[q - c], q11 = id[q], q01 = id[q - b];
      if (q00 < 0 || q10 < 0 || q11 < 0 || q01 < 0) continue;
      if (inside) I.push(q00, q10, q11, q00, q11, q01); else I.push(q00, q11, q10, q00, q01, q11);
    }
  }
  return { P, N, I };
}

// Builds a geometry from a body definition:
// { sdf(x,y,z), lo, hi, cell, color(x,y,z) → [r,g,b], rig(x,y,z) → [spine, leg, legT] }
export function bodyGeometry(def) {
  const { P, N, I } = surfaceNet(def.sdf, def.lo, def.hi, def.cell);
  const n = P.length / 3;
  const col = new Float32Array(n * 3), rig = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    const c = def.color(x, y, z);
    col.set(c, i * 3);
    rig.set(def.rig ? def.rig(x, y, z) : [0, 0, 0], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('rig', new THREE.BufferAttribute(rig, 3));
  g.setIndex(I);
  g.computeBoundingSphere();
  return g;
}

// Adds a neutral rig attribute to a geometry built elsewhere (low-poly bugs).
export function withRig(g, spineAxis = 'z') {
  const n = g.attributes.position.count;
  const rig = new Float32Array(n * 3);
  g.computeBoundingBox();
  const bb = g.boundingBox;
  for (let i = 0; i < n; i++) {
    const v = g.attributes.position.getComponent(i, spineAxis === 'z' ? 2 : 0);
    rig[i * 3] = 1 - (v - bb.min.z) / Math.max(1e-3, bb.max.z - bb.min.z);
  }
  g.setAttribute('rig', new THREE.BufferAttribute(rig, 3));
  return g;
}

// --- Instanced, procedurally animated rendering -------------------------------
// Per instance: position, rotation (quaternion), scale, and anim =
// (phase, undulation amplitude, gait phase, hop extension).
const qrot = (q, v) => v.add(cross(q.xyz, cross(q.xyz, v).add(v.mul(q.w))).mul(2));

export class CreatureMesh {
  constructor(scene, geometry, { cap = 64, rough = 0.5, wave = 2.2, legLift = 0.25, legStride = 0.35 } = {}) {
    const g = new THREE.InstancedBufferGeometry();
    for (const k of Object.keys(geometry.attributes)) g.setAttribute(k, geometry.attributes[k]);
    g.setIndex(geometry.index);
    this.cap = cap;
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.iRot = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    this.iScale = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    this.iAnim = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    for (const a of [this.iPos, this.iRot, this.iScale, this.iAnim]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.iPos);
    g.setAttribute('iRot', this.iRot);
    g.setAttribute('iScale', this.iScale);
    g.setAttribute('iAnim', this.iAnim);
    g.instanceCount = 0;
    this.geometry = g;

    const m = new THREE.MeshStandardNodeMaterial({ roughness: rough, metalness: 0.02, vertexColors: true });
    const rig = attribute('rig', 'vec3');
    const anim = attribute('iAnim', 'vec4');
    const q = attribute('iRot', 'vec4');
    m.positionNode = Fn(() => {
    const spine = rig.x, leg = rig.y, legT = rig.z;
    const p = positionLocal.toVar();
    // Body wave: a travelling sine along the spine, growing toward the tail.
    const w = sin(spine.mul(wave * 3.14159).sub(anim.x)).mul(anim.y).mul(spine.mul(spine));
    p.x.addAssign(w);
    // Legs: diagonal pairs (front left + back right) move together.
    const isLeg = leg.greaterThan(0.5);
    const diag = abs(leg.sub(1)).lessThan(0.5).or(abs(leg.sub(4)).lessThan(0.5));
    const lp = anim.z.add(diag.select(float(0), float(3.14159)));
    const lift = max(sin(lp), 0).mul(legT).mul(legLift);
    const swing = cos(lp).mul(legT).mul(legStride);
    const back = leg.greaterThan(2.5);
    p.y.addAssign(isLeg.select(lift, float(0)));
    p.z.addAssign(isLeg.select(swing, float(0)));
    // Hop: back legs stretch out behind.
    p.z.subAssign(isLeg.and(back).select(anim.w.mul(legT).mul(1.6), float(0)));
    p.y.subAssign(isLeg.and(back).select(anim.w.mul(legT).mul(0.4), float(0)));
    return qrot(q, p.mul(attribute('iScale', 'float'))).add(attribute('iPos', 'vec3'));
    })();
    m.normalNode = transformNormalToView(qrot(q, normalLocal));
    const [color, emissive] = wet(vec3(1));
    m.colorNode = color;
    m.emissiveNode = emissive;
    this.material = m;

    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
    this.n = 0;
  }

  begin() { this.n = 0; }

  put(pos, quat, scale, a0 = 0, a1 = 0, a2 = 0, a3 = 0) {
    if (this.n >= this.cap) return;
    const i = this.n++;
    this.iPos.setXYZ(i, pos.x, pos.y, pos.z);
    this.iRot.setXYZW(i, quat.x, quat.y, quat.z, quat.w);
    this.iScale.setX(i, scale);
    this.iAnim.setXYZW(i, a0, a1, a2, a3);
  }

  end() {
    this.geometry.instanceCount = this.n;
    for (const a of [this.iPos, this.iRot, this.iScale, this.iAnim]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.n * a.itemSize);
      a.needsUpdate = true;
    }
  }
}

// --- Bodies ---------------------------------------------------------------------
// All face +z with the belly on y = 0 (walkers) or centred (swimmers).
const C = (h) => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Four-legged amphibian/lizard: body, head, tail and legs with feet.
function quadruped(o) {
  const L = o.len, legs = [];
  // Shoulder and hip anchors; legs splay out and down.
  for (const [k, z, side] of [[1, o.shoulder, -1], [2, o.shoulder, 1], [3, o.hip, -1], [4, o.hip, 1]]) {
    const back = k > 2;
    const top = [side * o.bodyW * 0.8, o.bodyH * 0.8, z];
    const knee = [side * (o.bodyW + o.leg * 0.7), o.bodyH * 0.9, z + (back ? -o.leg * 0.2 : o.leg * 0.15)];
    const foot = [side * (o.bodyW + o.leg * 0.9), o.foot, z + (back ? -o.leg * (o.backReach ?? 0.3) : o.leg * 0.35)];
    legs.push({ k, top, knee, foot, r: back ? o.legR * (o.thigh ?? 1.2) : o.legR });
  }
  const sdf = (x, y, z) => {
    let d = ell(x, y - o.bodyH, z - o.bodyZ, o.bodyW, o.bodyH * (o.bodyTall ?? 1), o.bodyL);
    d = smin(d, ell(x, y - o.headY, z - o.headZ, o.headW, o.headH, o.headL), o.neck);
    if (o.tail) {
      const [t] = cap([x, y, z], [0, o.bodyH * 0.9, o.bodyZ - o.bodyL * 0.6], [o.tailCurl ?? 0, o.bodyH * 0.6, o.bodyZ - o.bodyL - o.tail], o.tailR, 0.05);
      let td = t;
      if (o.tailFin) td = smin(td, ell(x, y - o.bodyH * 0.8, z - (o.bodyZ - o.bodyL - o.tail * 0.5), 0.08, o.tailFin, o.tail * 0.55), 0.2);
      d = smin(d, td, o.tailBlend ?? 0.4);
    }
    for (const l of legs) {
      const [a] = cap([x, y, z], l.top, l.knee, l.r, l.r * 0.85);
      const [b] = cap([x, y, z], l.knee, l.foot, l.r * 0.8, l.r * 0.6);
      d = smin(d, Math.min(a, b), 0.18);
      if (o.toes) d = smin(d, ell(x - l.foot[0], y - o.foot, z - l.foot[2], o.toes, 0.06, o.toes * 0.9), 0.1);
    }
    for (const s of [-1, 1]) {
      d = smin(d, ell(x - s * o.eyeX, y - o.eyeY, z - o.eyeZ, o.eyeR, o.eyeR, o.eyeR), 0.08);
      if (o.gills) {
        for (let g = 0; g < 3; g++) {
          const base = [s * o.headW * 0.85, o.headY + 0.25 - g * 0.3, o.headZ - o.headL * 0.4];
          const tip = [s * (o.headW + o.gills), o.headY + 0.9 - g * 0.55, o.headZ - o.headL * 0.9 - g * 0.2];
          d = Math.min(d, cap([x, y, z], base, tip, 0.12, 0.06)[0] - (Math.sin((x + y + z) * 22) * 0.02));
        }
      }
    }
    return d;
  };
  const rig = (x, y, z) => {
    let best = 0, bt = 0, bd = 0.6;
    for (const l of legs) {
      const [a, ta] = cap([x, y, z], l.top, l.knee, l.r, l.r);
      const [b, tb] = cap([x, y, z], l.knee, l.foot, l.r, l.r);
      const d = Math.min(a, b);
      if (d < bd && Math.abs(x) > o.bodyW * 0.7) { bd = d; best = l.k; bt = a < b ? ta * 0.5 : 0.5 + tb * 0.5; }
    }
    const spine = Math.max(0, Math.min(1, (o.headZ + o.headL - z) / (o.headZ + o.headL - (o.bodyZ - o.bodyL - (o.tail ?? 0)))));
    return [spine, best, bt];
  };
  return { sdf, rig, lo: o.lo, hi: o.hi, cell: o.cell ?? 0.12 };
}

// A frog sitting the way frogs sit: body tilted up at the front, the
// front legs straight under the chest, the long back legs folded in a Z
// beside the body (thigh forward, shin back, foot forward again) with
// splayed toes ending in round pads. The back legs unfold in a hop (see
// the vertex shader in CreatureMesh).
function frogBody(o) {
  const k = o.size ?? 1;
  const P = (x, y, z) => [x * k, y * k, z * k];
  const tilt = 0.35, ct = Math.cos(tilt), st = Math.sin(tilt);
  const legs = [];
  for (const s of [-1, 1]) {
    // Front: shoulder, elbow, wrist, then three fingers.
    legs.push({ k: s < 0 ? 1 : 2, chain: [P(s * 0.55, 0.95, 0.62), P(s * 0.85, 0.5, 0.78), P(s * 0.8, 0.12, 1.15)], r: [0.17, 0.14, 0.12].map((v) => v * k),
      toes: [[0.28, 0.3], [0.05, 0.4], [-0.25, 0.28]].map(([dx, dz]) => P(s * (0.8 + dx), 0.07, 1.15 + dz)) });
    // Back: hip, knee (forward and out), ankle (back), toes (forward).
    legs.push({ k: s < 0 ? 3 : 4, chain: [P(s * 0.55, 0.62, -1.15), P(s * 1.38, 0.62, -0.35), P(s * 1.05, 0.2, -1.4), P(s * 1.28, 0.08, -0.45)], r: [0.34, 0.24, 0.17, 0.12].map((v) => v * k),
      toes: [[0.35, 0.55], [0.12, 0.72], [-0.12, 0.62], [-0.3, 0.35]].map(([dx, dz]) => P(s * (1.28 + dx), 0.06, -0.45 + dz)) });
  }
  const legDist = (x, y, z, l) => {
    let d = 9, t = 0;
    const n = l.chain.length - 1;
    for (let i = 0; i < n; i++) {
      const [dd, tt] = cap([x, y, z], l.chain[i], l.chain[i + 1], l.r[i], l.r[i + 1] ?? l.r[i] * 0.8);
      if (dd < d) { d = dd; t = (i + tt) / (n + 0.5); }
    }
    const tip = l.chain[n];
    for (const q of l.toes) {
      const [dd, tt] = cap([x, y, z], tip, q, 0.07 * k, 0.05 * k);
      const pad = Math.hypot(x - q[0], y - q[1], z - q[2]) - 0.1 * k;
      const d2 = Math.min(dd, pad);
      if (d2 < d) { d = d2; t = (n + tt * 0.5) / (n + 0.5); }
    }
    return [d, Math.min(1, t)];
  };
  const bodyD = (x, y, z) => {
    const dy = y - 0.85 * k, dz = z + 0.25 * k;
    let d = ell(x, dy * ct - dz * st, dy * st + dz * ct, 0.9 * k, 0.7 * k, 1.22 * k);
    d = smin(d, ell(x, y - 1.18 * k, z - 0.95 * k, 0.8 * k, 0.52 * k, 0.72 * k), 0.35 * k);
    // Throat and a slightly pointed snout.
    d = smin(d, ell(x, y - 0.95 * k, z - 1.35 * k, 0.45 * k, 0.3 * k, 0.4 * k), 0.2 * k);
    return d;
  };
  const eyes = [-1, 1].map((s) => P(s * 0.53, 1.42, 1.08));
  const sdf = (x, y, z) => {
    let d = bodyD(x, y, z);
    for (const e of eyes) d = smin(d, Math.hypot(x - e[0], y - e[1], z - e[2]) - 0.23 * k, 0.12 * k);
    for (const l of legs) d = smin(d, legDist(x, y, z, l)[0], 0.12 * k);
    return d;
  };
  const whichLeg = (x, y, z) => {
    const b = bodyD(x, y, z);
    let best = 0, bd = b - 0.05 * k, bt = 0;
    for (const l of legs) {
      const [d, t] = legDist(x, y, z, l);
      if (d < bd) { bd = d; best = l.k; bt = t; }
    }
    return [best, bt];
  };
  const isEye = (x, y, z) => eyes.some((e) => Math.hypot(x - e[0], y - e[1], z - e[2]) < 0.26 * k);
  return {
    sdf, lo: P(-2.3, -0.2, -2.2), hi: P(2.3, 2.1, 2.2), cell: 0.075 * k,
    rig: (x, y, z) => {
      const [leg, t] = whichLeg(x, y, z);
      return [Math.max(0, Math.min(1, (1.9 * k - z) / (3.8 * k))), leg, t];
    },
    color: (x, y, z) => {
      if (isEye(x, y, z)) return Math.hypot(x - Math.sign(x) * 0.56 * k, y - 1.55 * k, z - 1.2 * k) < 0.07 * k ? C(0x4a4a4a) : C(0x050505);
      const [leg] = whichLeg(x, y, z);
      return o.color({ x: x / k, y: y / k, z: z / k, leg, belly: y < 0.45 * k && !leg });
    },
  };
}

// Skin patterns: blue dart frog (Dendrobates tinctorius "azureus"),
// strawberry dart frog (Oophaga pumilio, red with "blue jeans" legs) and
// fire-bellied toad (Bombina orientalis).
const azureus = ({ x, y, z, leg, belly }) => {
  const spot = vnoise(x * 4.2 + 3, y * 4.2, z * 4.2) > 0.72 && y > 0.5;
  if (spot) return C(0x03050a);
  if (belly) return C(0x10286e);
  if (leg) return lerp3(C(0x16338c), C(0x2350c4), Math.min(1, y));
  return lerp3(C(0x1f4fc8), C(0x4f8cf5), Math.max(0, Math.min(1, (y - 0.8) * 1.2)));
};
const pumilio = ({ x, y, z, leg, belly }) => {
  if (leg) return lerp3(C(0x16288a), C(0x2d4fc4), Math.min(1, y * 1.2));
  const fleck = vnoise(x * 5, y * 5, z * 5) > 0.74;
  if (belly) return C(0xb3261e);
  return fleck ? C(0x3a0a08) : lerp3(C(0xc41f16), C(0xf0402a), Math.max(0, Math.min(1, (y - 0.7))));
};
const bombina = ({ x, y, z, leg, belly }) => {
  if (belly || (leg && y < 0.18)) return vnoise(x * 3, y * 3, z * 3) > 0.62 ? C(0x111111) : C(0xf2641a);
  const blotch = vnoise(x * 2.2, y * 2.2, z * 2.2) > 0.66;
  const wart = vnoise(x * 7, y * 7, z * 7) > 0.72;
  return blotch ? C(0x0f1a08) : wart ? C(0x2b4d17) : lerp3(C(0x3f7a26), C(0x6aa83a), vnoise(x, y, z));
};

export const BODIES = {
  dartfrog: () => frogBody({ size: 1, color: azureus }),
  strawberry: () => frogBody({ size: 0.72, color: pumilio }),
  toad: () => frogBody({ size: 1.3, color: bombina }),
  newt: () => {
    const b = quadruped({
      bodyW: 0.55, bodyH: 0.55, bodyL: 1.9, bodyZ: 0, bodyTall: 0.9, headW: 0.55, headH: 0.38, headL: 0.8, headY: 0.55, headZ: 2.2, neck: 0.4,
      eyeX: 0.35, eyeY: 0.85, eyeZ: 2.5, eyeR: 0.15, shoulder: 1.3, hip: -1.3, leg: 0.8, legR: 0.13, foot: 0.08, toes: 0.14,
      tail: 4.2, tailR: 0.42, tailFin: 0.5, lo: [-1.8, -0.3, -6.8], hi: [1.8, 1.6, 3.4], cell: 0.1,
    });
    b.color = (x, y, z) => {
      if (Math.abs(x) > 0.2 && y > 0.75 && z > 2.3) return C(0x050505);
      if (y < 0.3 && z > -2) return vnoise(x * 3, y, z * 3) > 0.6 ? C(0x1a120a) : C(0xef6a1c);
      return lerp3(C(0x2b2218), C(0x4a3a26), vnoise(x * 2, y * 2, z * 2));
    };
    return b;
  },
  axolotl: () => {
    const b = quadruped({
      bodyW: 0.9, bodyH: 0.85, bodyL: 2.4, bodyZ: 0, bodyTall: 0.85, headW: 1.25, headH: 0.7, headL: 1.1, headY: 0.85, headZ: 2.8, neck: 0.55,
      eyeX: 0.75, eyeY: 1.2, eyeZ: 3.2, eyeR: 0.13, shoulder: 1.5, hip: -1.6, leg: 1.0, legR: 0.18, foot: 0.08, toes: 0.2,
      tail: 5, tailR: 0.6, tailFin: 0.9, gills: 1.1, lo: [-3, -0.3, -8.4], hi: [3, 2.6, 4.2], cell: 0.12,
    });
    b.color = (x, y, z) => {
      const gill = Math.abs(x) > 1.0 && z > 1.2 && z < 3 && y > 0.6;
      if (gill) return C(0xd0304a);
      if (Math.abs(x) > 0.5 && y > 1.2 && z > 3.1) return C(0x1a1a1a);
      return lerp3(C(0xf2c6c6), C(0xffe0dc), vnoise(x * 2, y * 2, z * 2) * 0.7);
    };
    return b;
  },
  gecko: () => {
    const b = quadruped({
      bodyW: 0.5, bodyH: 0.45, bodyL: 1.5, bodyZ: 0, bodyTall: 0.8, headW: 0.5, headH: 0.35, headL: 0.75, headY: 0.5, headZ: 1.9, neck: 0.35,
      eyeX: 0.35, eyeY: 0.72, eyeZ: 2.05, eyeR: 0.2, shoulder: 1.0, hip: -1.0, leg: 0.8, legR: 0.1, foot: 0.05, toes: 0.2,
      tail: 3.4, tailR: 0.3, lo: [-1.7, -0.25, -5.4], hi: [1.7, 1.3, 2.9], cell: 0.08,
    });
    b.color = (x, y, z) => {
      if (Math.abs(x) > 0.2 && y > 0.6 && z > 1.9) return C(0x2a1a0a);
      if (y < 0.2) return C(0xe8dcc0);
      const chevron = Math.sin(z * 3.2 + Math.abs(x) * 5) > 0.6;
      return chevron ? C(0x5a4630) : lerp3(C(0xa8906a), C(0xc2ab82), vnoise(x * 3, y * 3, z * 3));
    };
    return b;
  },
  tadpole: () => ({
    sdf: (x, y, z) => smin(ell(x, y, z - 0.35, 0.42, 0.36, 0.5), Math.min(ell(x, y, z + 0.8, 0.06, 0.3, 0.8), cap([x, y, z], [0, 0, 0], [0, 0, -1.4], 0.14, 0.02)[0]), 0.2),
    lo: [-0.7, -0.6, -1.8], hi: [0.7, 0.6, 1.0], cell: 0.05,
    color: (x, y, z) => (z < -0.1 ? C(0x5a5040) : Math.abs(x) > 0.25 && z > 0.6 && y > 0.05 ? C(0x080808) : lerp3(C(0x2e2a22), C(0x4a4032), vnoise(x * 6, y * 6, z * 6))),
    rig: (x, y, z) => [Math.max(0, Math.min(1, (0.85 - z) / 2.25)), 0, 0],
  }),
  eggs: () => {
    const pts = Array.from({ length: 14 }, (_, i) => [Math.sin(i * 2.4) * (0.3 + (i % 3) * 0.35), 0.25 + (i % 4) * 0.22, Math.cos(i * 2.4) * (0.3 + (i % 3) * 0.35)]);
    return {
      sdf: (x, y, z) => { let d = 9; for (const [a, b, c] of pts) d = smin(d, Math.hypot(x - a, y - b, z - c) - 0.3, 0.12); return d; },
      lo: [-1.4, -0.2, -1.4], hi: [1.4, 1.4, 1.4], cell: 0.07,
      color: (x, y, z) => { let dm = 9; for (const [a, b, c] of pts) dm = Math.min(dm, Math.hypot(x - a, y - b, z - c)); return dm < 0.14 ? C(0x1a1a14) : C(0xd8dcc8); },
    };
  },
  // Fish: body plus fins as thin ellipsoids (the tail undulates in the shader).
  neon: () => fish({ len: 3.2, h: 0.85, w: 0.5, color: (x, y, z) => {
    const u = y / 0.42, v = z / 1.6;
    if (u > 0.05 && u < 0.4 && v > -0.75) return C(0x2fc2ff);
    if (u < 0.05 && u > -0.6 && v < 0.2 && v > -0.8) return C(0xe3332f);
    if (u >= 0.4) return C(0x6b6a4e);
    return C(0xd8dfe3);
  } }),
  cory: () => fish({ len: 4, h: 1.3, w: 0.9, dorsal: 0.9, flatBelly: true, color: (x, y, z) => (vnoise(x * 3, y * 3, z * 3) > 0.62 ? C(0x3c3a33) : lerp3(C(0x9a8f78), C(0xc9b89a), Math.max(0, -y))) }),
  guppy: () => fish({ len: 3, h: 0.8, w: 0.5, tailScale: 1.8, color: (x, y, z) => (z < -1.4 ? (vnoise(x * 5, y * 5, z * 5) > 0.5 ? C(0x3a7ae0) : C(0xff6a1a)) : z < -0.4 ? C(0xff7a2a) : C(0xb7c4c9)) }),
};

function fish(o) {
  const L = o.len / 2, H = o.h / 2, W = o.w / 2;
  const ts = o.tailScale ?? 1;
  const sdf = (x, y, z) => {
    let d = ell(x, o.flatBelly ? Math.max(y, -H * 0.6) : y, z, W, H, L);
    // Tail fin: a thin, forked fan behind the body.
    const tz = z + L * 1.05;
    const fork = Math.abs(y) - (0.1 + Math.max(0, -tz) * 0.55 * ts);
    const tail = Math.max(ell(x, y, tz + 0.35 * ts, 0.04, H * 1.1 * ts, 0.55 * ts), fork * 0.3 > 0.2 ? fork : -0.01);
    d = smin(d, tail, 0.12);
    // Dorsal, anal and pectoral fins.
    d = smin(d, ell(x, y - H * 0.95, z + L * 0.1, 0.03, H * (o.dorsal ?? 0.5), L * 0.25), 0.08);
    d = smin(d, ell(x, y + H * 0.8, z + L * 0.35, 0.03, H * 0.35, L * 0.25), 0.08);
    for (const s of [-1, 1]) d = smin(d, ell(x - s * W * 0.9, y + H * 0.3, z - L * 0.35, W * 0.6, 0.03, L * 0.18), 0.06);
    // Eyes.
    for (const s of [-1, 1]) d = smin(d, Math.hypot(x - s * W * 0.7, y - H * 0.2, z - L * 0.62) - Math.min(W, H) * 0.3, 0.03);
    return d;
  };
  return {
    sdf, lo: [-W * 2.2, -H * 2 * ts, -L * 2.2 - 0.6 * ts], hi: [W * 2.2, H * 2 * ts, L * 1.3], cell: Math.min(W, H) / 5,
    color: (x, y, z) => (Math.abs(x) > W * 0.45 && Math.hypot(Math.abs(x) - W * 0.7, y - H * 0.2, z - L * 0.62) < Math.min(W, H) * 0.33 ? C(0x080808) : o.color(x, y, z)),
    rig: (x, y, z) => [Math.max(0, Math.min(1, (L - z) / (L * 2 + 0.8 * ts))), 0, 0],
  };
}
