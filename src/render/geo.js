// Small helpers for building low-poly, vertex-coloured meshes out of primitive
// parts. Every creature and plant is made this way, so nothing has to be
// downloaded and a whole species shares one geometry.

import * as THREE from 'three/webgpu';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();

export class Builder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.col = [];
    this.sway = [];
  }

  // Adds `geo` transformed by position/rotation/scale. `color` may be a hex
  // number, a THREE.Color or a function (localPosition) → THREE.Color.
  // `sway` is a number or function (worldPosition) → 0..1 used by plants.
  add(geo, { p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1], color = 0xffffff, sway = 0, jitter = 0 } = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.computeVertexNormals();
    const sc = typeof s === 'number' ? [s, s, s] : s;
    _m.compose(_p.set(...p), _q.setFromEuler(_e.set(...r)), _s.set(...sc));
    const nm = new THREE.Matrix3().getNormalMatrix(_m);
    const pa = g.attributes.position;
    const na = g.attributes.normal;
    const v = new THREE.Vector3();
    const lv = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (let i = 0; i < pa.count; i++) {
      lv.fromBufferAttribute(pa, i);
      v.copy(lv).applyMatrix4(_m);
      n.fromBufferAttribute(na, i).applyMatrix3(nm).normalize();
      this.pos.push(v.x, v.y, v.z);
      this.nor.push(n.x, n.y, n.z);
      if (typeof color === 'function') _c.copy(color(lv, v));
      else _c.set(color);
      if (jitter) {
        const j = 1 + (hash3(v.x, v.y, v.z) - 0.5) * jitter;
        _c.multiplyScalar(j);
      }
      this.col.push(_c.r, _c.g, _c.b);
      this.sway.push(typeof sway === 'function' ? sway(v) : sway);
    }
    g.dispose();
    return this;
  }

  // Flat-shaded triangle strip ribbon along a list of points; widths per point.
  ribbon(points, widths, side, { color = 0xffffff, sway = null, twist = 0 } = {}) {
    const g = new THREE.BufferGeometry();
    const verts = [];
    const cols = [];
    const sw = [];
    for (let i = 0; i < points.length; i++) {
      const w = widths[i] * 0.5;
      const pt = points[i];
      const sd = side[i] ?? side;
      verts.push(pt.x - sd.x * w, pt.y - sd.y * w, pt.z - sd.z * w);
      verts.push(pt.x + sd.x * w, pt.y + sd.y * w, pt.z + sd.z * w);
      const t = i / (points.length - 1);
      _c.set(typeof color === 'function' ? color(t) : color);
      cols.push(_c.r, _c.g, _c.b, _c.r, _c.g, _c.b);
      const s = sway ? sway(t) : t;
      sw.push(s, s);
    }
    const idx = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, c, b, b, c, d);
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    g.setAttribute('sway', new THREE.Float32BufferAttribute(sw, 1));
    g.setIndex(idx);
    g.computeVertexNormals();           // smooth: shared ring vertices average their faces, so a bent blade is not faceted
    const ng = g.toNonIndexed();
    const pa = ng.attributes.position, na = ng.attributes.normal, ca = ng.attributes.color, sa = ng.attributes.sway;
    for (let i = 0; i < pa.count; i++) {
      this.pos.push(pa.getX(i), pa.getY(i), pa.getZ(i));
      this.nor.push(na.getX(i), na.getY(i), na.getZ(i));
      this.col.push(ca.getX(i), ca.getY(i), ca.getZ(i));
      this.sway.push(sa.getX(i));
    }
    g.dispose();
    ng.dispose();
    return this;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('sway', new THREE.Float32BufferAttribute(this.sway, 1));
    g.computeBoundingSphere();
    return g;
  }
}

export function hash3(x, y, z) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

// Deterministic PRNG so generated scenes and plants are repeatable.
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// Shared low-poly primitives.
export const PRIM = {
  sphere: new THREE.IcosahedronGeometry(1, 1),
  sphereLo: new THREE.IcosahedronGeometry(1, 0),
  box: new THREE.BoxGeometry(1, 1, 1),
  cone: new THREE.ConeGeometry(1, 1, 5, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 5, 1),
  tri: (() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 1, -1, 0, -1, -1], 3));
    return g;
  })(),
  plane: new THREE.PlaneGeometry(1, 1),
};
