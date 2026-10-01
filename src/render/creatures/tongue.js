// Tongue flicks: a pool of thin pink lines with a blunt tip. Each frame the owner calls begin(), then show(from, to, ext)
// for every tongue that is out (ext 0..1 = how far it has reached from `from` toward `to`), then end().

import * as THREE from 'three/webgpu';

const Z = new THREE.Vector3(0, 0, 1);

export class Tongues {
  constructor(scene, n = 12) {
    const line = new THREE.CylinderGeometry(0.06, 0.045, 1, 6, 1);
    line.rotateX(Math.PI / 2); line.translate(0, 0, 0.5);             // base at the origin, along +z, length 1
    const tip = new THREE.SphereGeometry(0.11, 6, 5);
    this.mat = new THREE.MeshBasicNodeMaterial({ color: 0xea6a86 });
    this.tipMat = new THREE.MeshBasicNodeMaterial({ color: 0xf08aa0 });
    this.slots = [];
    this.group = new THREE.Group();
    for (let i = 0; i < n; i++) {
      const g = new THREE.Group();
      const l = new THREE.Mesh(line, this.mat), t = new THREE.Mesh(tip, this.tipMat);
      for (const m of [l, t]) { m.castShadow = false; m.receiveShadow = false; m.frustumCulled = false; }
      g.add(l, t);
      g.visible = false;
      this.group.add(g);
      this.slots.push({ g, l, t });
    }
    this.n = 0;
    scene.add(this.group);
    this._d = new THREE.Vector3();
  }

  begin() { this.n = 0; }

  show(from, to, ext, thick = 1) {
    if (this.n >= this.slots.length) return;
    const s = this.slots[this.n++];
    const d = this._d.copy(to).sub(from);
    const len = d.length() * Math.max(0, Math.min(1, ext));
    if (len < 0.02) { s.g.visible = false; return; }
    s.g.visible = true;
    s.g.position.copy(from);
    s.g.quaternion.setFromUnitVectors(Z, d.normalize());
    s.l.scale.set(thick, thick, len);
    s.t.scale.setScalar(thick);
    s.t.position.set(0, 0, len);
  }

  end() { for (let i = this.n; i < this.slots.length; i++) this.slots[i].g.visible = false; }

  dispose() { this.group.removeFromParent(); }
}
