// Pieces of rotting fruit on the ground (sim/flylife.js): a few small lumps that shrink and darken as the maggots and
// the rot take them. One InstancedMesh, redrawn only when the fruit changes.

import * as THREE from 'three/webgpu';

const CAP = 16;

export class FruitView {
  constructor(scene) {
    const g = new THREE.IcosahedronGeometry(0.5, 1);
    g.scale(1, 0.6, 1);
    this.mesh = new THREE.InstancedMesh(g, new THREE.MeshStandardNodeMaterial({ color: 0xffffff, roughness: 0.75 }), CAP);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3).fill(1), 3);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.name = 'fruit';
    this.mesh.castShadow = false; this.mesh.receiveShadow = false;
    scene.add(this.mesh);
    this.rev = -1; this.t = 0;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3();
    this._fresh = new THREE.Color(0xd8642a); this._old = new THREE.Color(0x3d2a1c); this._c = new THREE.Color();
  }

  update(fl) {
    if (!fl.fruit.length && !this.mesh.count) return;
    const T = fl.world.terrain;
    let k = 0;
    for (const f of fl.fruit) {
      if (k >= CAP) break;
      const r = 0.4 + 0.6 * Math.min(1, f.amt / 4);
      const y = T.heightAt(f.x, f.z);
      this._q.setFromAxisAngle(this._p.set(0, 1, 0), k * 2.1);
      this._m.compose(this._p.set(f.x, y + r * 0.22, f.z), this._q, this._s.set(r, r, r));
      this.mesh.setMatrixAt(k, this._m);
      this._c.copy(this._fresh).lerp(this._old, Math.min(1, f.age / 6));
      this.mesh.setColorAt(k, this._c);
      k++;
    }
    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
