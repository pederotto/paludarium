// Fallen leaves on the ground: one InstancedMesh of small leaf cards scattered
// over the cells that hold litter (sim/humus.js). Fresh litter is bigger and
// browner-green; as it rots the leaves shrink and darken, then vanish into the
// humus (the soil shader darkens). Rebuilt every few game hours, never per frame.

import * as THREE from 'three/webgpu';
import { plantMaterial } from './shaders.js';
import { TANK } from '../sim/tank.js';
import { rng } from '../util/math.js';

const CAP = 900;   // leaf cards on the ground at most (one draw call, a few thousand triangles)

// A dry fallen leaf, 1 long: a pointed oval, wider toward the stalk, folded a little along the midrib and curling up at the
// edges and the tip as it dries, with leaf coordinates (u across -1 … 1, v stalk 0 … tip 1) so the plant material draws its
// midrib, veins and darker margin (render/shaders.js plantMaterial `leafVeins`).
function leafGeometry() {
  const N = 6, U = [-1, -0.5, 0, 0.5, 1];
  const pos = [], leaf = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const v = i / N, w = 0.3 * Math.pow(Math.sin(Math.PI * v), 0.7) * (1.1 - 0.3 * v);
    for (const u of U) {
      pos.push(u * w, 0.02 + 0.07 * Math.pow(Math.abs(u), 1.5) + 0.12 * v * v * v, v - 0.5);
      leaf.push(u, v);
    }
  }
  for (let i = 0; i < N; i++) for (let j = 0; j < U.length - 1; j++) {
    const a = i * U.length + j, b = a + U.length;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('leaf', new THREE.Float32BufferAttribute(leaf, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(pos.length).fill(1), 3));
  g.setAttribute('sway', new THREE.Float32BufferAttribute(new Array(pos.length / 3).fill(0), 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Dead leaves of the kinds keepers use (oak, magnolia, sea grape, catappa): tan, rust, dark brown, and grey-brown when old;
// linear RGB.
const LEAF_COLORS = [[0.25, 0.16, 0.065], [0.26, 0.11, 0.04], [0.16, 0.085, 0.035], [0.1, 0.058, 0.03], [0.14, 0.115, 0.085], [0.21, 0.16, 0.08]];

export class LitterView {
  constructor(scene, world) {
    this.world = world;
    const mat = plantMaterial({ amp: 0, underwaterAmp: 0, leafVeins: true, veins: { kind: 'pinnate', n: 6, slope: 1.3, rib: 0.06, k: 0.8 } });
    mat.roughness = 1;
    this.mesh = new THREE.InstancedMesh(leafGeometry(), mat, CAP);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.name = 'litter';
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3).fill(1), 3);
    scene.add(this.mesh);
    this.rev = -1;
    this.t = 1e9;
  }

  // Called every sim tick; rebuilds when the litter changed and a little time has passed.
  update(humus) {
    this.t += 1;
    if (humus.rev === this.rev || this.t < 40) return;
    this.t = 0;
    this.rev = humus.rev;
    this.build(humus);
  }

  build(humus) {
    const W = this.world, C = W.climate, L = C.litter;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    const n = C.nx * C.nz;
    let total = 0;
    // A thin cover of old leaves wherever there is any litter, thick where a lot has fallen.
    const count = (l) => (l > 0.03 ? Math.max(1, Math.round(l * 8)) : 0);
    for (let c = 0; c < n; c++) total += count(Math.min(1.2, L[c]));
    const keep = total > CAP ? CAP / total : 1;
    let k = 0;
    for (let c = 0; c < n && k < CAP; c++) {
      const l = Math.min(1.2, L[c]);
      if (l <= 0.03) continue;
      const i = c % C.nx, j = (c / C.nx) | 0;
      const r = rng(c * 7919 + 13);
      const cnt = count(l);
      for (let a = 0; a < cnt && k < CAP; a++) {
        if (r() > keep) continue;
        const x = (i + r()) * C.cs - TANK.w / 2, z = (j + r()) * C.cs - TANK.d / 2;
        if (Math.abs(x) > TANK.w / 2 - 1 || Math.abs(z) > TANK.d / 2 - 1) continue;
        const y = W.terrain.heightAt(x, z);
        if (W.water.surfaceAt(x, z, 0.3) > y + 0.1) continue;
        const nrm = W.terrain.normalAt(x, z);
        q.setFromUnitVectors(up, nrm);
        q.multiply(new THREE.Quaternion().setFromAxisAngle(up, r() * 6.283));
        q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (r() - 0.5) * 0.5));
        // Fresh leaves are big; the more rotted, the smaller (litter in this cell is fresher when there is a lot of it).
        const size = (1.3 + r() * 1.7) * (0.5 + 0.5 * Math.min(1, l * 1.4));   // whole small leaves and broken pieces, 0.7 to 3 cm
        m.compose(p.set(x, y + 0.08 + r() * 0.1, z), q, s.set(size, size, size));
        this.mesh.setMatrixAt(k, m);
        // Where much has fallen lately more of it is fresh (tan, rust); thin old cover is dark and grey-brown.
        const fresh = Math.min(1, l * 1.3) * (0.6 + r() * 0.4);
        const k0 = Math.min(LEAF_COLORS.length - 1, Math.floor(((1 - fresh) * 0.6 + r() * 0.55) * LEAF_COLORS.length)), lc = LEAF_COLORS[k0], b = 0.7 + r() * 0.35;
        col.setRGB(lc[0] * b, lc[1] * b, lc[2] * b);
        this.mesh.setColorAt(k, col);
        k++;
      }
    }
    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
}
