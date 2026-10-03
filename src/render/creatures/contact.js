// Contact shadows: a soft dark oval on the ground under every animal that stands on it. The lamp is straight overhead, so
// its shadow hides under the body, and on the WebGL 2 path there is no ambient occlusion to darken where the feet meet the
// ground: without this an animal reads as hovering a little above the moss. One instanced quad, one draw call; the owner
// calls begin(), put(pos, up, yaw, width, length, strength) for each animal, then end().

import * as THREE from 'three/webgpu';
import { uv, float, smoothstep, length, attribute } from 'three/tsl';

const UP = new THREE.Vector3(0, 1, 0);

export class ContactShadows {
  constructor(scene, cap = 256) {
    const g = new THREE.PlaneGeometry(1, 1);
    g.rotateX(-Math.PI / 2);                                  // lying in the ground plane, facing up
    this.strength = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    this.strength.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('cs', this.strength);
    const m = new THREE.MeshBasicNodeMaterial({ color: 0x000000, transparent: true, depthWrite: false });
    // Dark in the middle, gone at the rim of the oval.
    const r = length(uv().sub(0.5).mul(2));
    m.opacityNode = float(1).sub(smoothstep(0.15, 1, r)).pow(1.6).mul(attribute('cs', 'float'));
    m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2;   // above the ground it lies on
    this.mesh = new THREE.InstancedMesh(g, m, cap);
    this.mesh.name = 'contact-shadows';
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = 1;
    this.cap = cap;
    this.n = 0;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._t = new THREE.Quaternion();
    this._s = new THREE.Vector3(); this._p = new THREE.Vector3();
    scene.add(this.mesh);
  }

  begin() { this.n = 0; }

  // pos: the ground under the animal; up: the ground's normal; width and length of the body (cm); strength 0..1.
  put(pos, up, yaw, width, len, strength) {
    if (this.n >= this.cap || strength < 0.02) return;
    const q = this._q.setFromUnitVectors(UP, up).multiply(this._t.setFromAxisAngle(UP, yaw));
    this._p.copy(pos).addScaledVector(up, 0.03);
    this._m.compose(this._p, q, this._s.set(width, 1, len));
    this.mesh.setMatrixAt(this.n, this._m);
    this.strength.array[this.n] = strength;
    this.n++;
  }

  end() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.strength.needsUpdate = true;
  }

  set visible(v) { this.mesh.visible = v; }

  dispose() { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
