// Fallen leaves on the ground: one InstancedMesh of small leaf cards scattered
// over the cells that hold litter (sim/humus.js). Fresh litter is bigger and
// browner-green; as it rots the leaves shrink and darken, then vanish into the
// humus (the soil shader darkens). Rebuilt every few game hours, never per frame.

import * as THREE from 'three/webgpu';
import { plantMaterial } from './shaders.js';
import { TANK } from '../sim/tank.js';
import { rng } from '../util/math.js';

const CAP = 420;   // leaf cards on the ground at most (one draw call)

function leafGeometry() {
  // A flat pointed oval lying in the xz plane, 1 long, 0.55 wide.
  const pts = [[0, -0.5], [0.22, -0.28], [0.27, 0.05], [0.14, 0.34], [0, 0.5], [-0.14, 0.34], [-0.27, 0.05], [-0.22, -0.28]];
  const pos = [], idx = [];
  pts.forEach(([x, z]) => pos.push(x, 0, z));
  pos.push(0, 0.015, 0);
  for (let i = 0; i < pts.length; i++) idx.push(8, i, (i + 1) % pts.length);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(pos.length).fill(1), 3));
  g.setAttribute('sway', new THREE.Float32BufferAttribute(new Array(pos.length / 3).fill(0), 1));
  g.setIndex(idx);
  return g;
}

export class LitterView {
  constructor(scene, world) {
    this.world = world;
    const mat = plantMaterial({ amp: 0, underwaterAmp: 0 });
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
    for (let c = 0; c < n; c++) total += Math.min(1.2, L[c]) > 0.06 ? Math.round(Math.min(1.2, L[c]) * 5) : 0;
    const keep = total > CAP ? CAP / total : 1;
    let k = 0;
    for (let c = 0; c < n && k < CAP; c++) {
      const l = Math.min(1.2, L[c]);
      if (l <= 0.06) continue;
      const i = c % C.nx, j = (c / C.nx) | 0;
      const r = rng(c * 7919 + 13);
      const cnt = Math.round(l * 5);
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
        const size = (1.0 + r() * 1.1) * (0.45 + 0.55 * Math.min(1, l * 1.4));
        m.compose(p.set(x, y + 0.08 + r() * 0.1, z), q, s.set(size, size, size));
        this.mesh.setMatrixAt(k, m);
        const fresh = Math.min(1, l * 1.3) * (0.6 + r() * 0.4);
        // dark brown (old) -> warm brown / olive (fresh)
        col.setRGB(0.2 + 0.32 * fresh + r() * 0.06, 0.12 + 0.2 * fresh + r() * 0.05, 0.05 + 0.05 * fresh);
        this.mesh.setColorAt(k, col);
        k++;
      }
    }
    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
}
