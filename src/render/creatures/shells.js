// Cast shells: the old skin a shrimp walks out of when it moults (sim/shrimp.js), lying on its side on the bottom for a day or two
// until it has been picked to nothing. One instanced mesh per species, built from that species' own coarse mesh in its resting pose
// (a shell is the animal's shape), drawn glassy and pale: a moulted shell is clear, with a faint tint of the animal's colour.
import * as THREE from 'three/webgpu';
import { positionWorld, vec3, float } from 'three/tsl';
import { wet } from '../shaders.js';
import { U } from '../uniforms.js';

export class CastShells {
  constructor(scene) { this.scene = scene; this.meshes = new Map(); this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._e = new THREE.Euler(); }

  // list: [{ sp, pos, yaw, roll, left (1 whole … 0 gone) }]; geometryOf(sp) -> the species' mesh geometry (or null before it exists).
  draw(list, geometryOf) {
    const counts = new Map();
    for (const s of list) counts.set(s.sp, (counts.get(s.sp) ?? 0) + 1);
    for (const [sp, M] of this.meshes) if (!counts.has(sp)) M.count = 0;
    for (const [sp, n] of counts) {
      let M = this.meshes.get(sp);
      if (!M || M.instanceMatrix.count < n) {
        const src = geometryOf(sp);
        if (!src) continue;
        if (M) { M.removeFromParent(); M.dispose(); }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', src.attributes.position);
        g.setAttribute('normal', src.attributes.normal);
        if (src.index) g.setIndex(src.index);
        const mat = new THREE.MeshPhysicalNodeMaterial({ roughness: 0.25, metalness: 0, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide });
        const [c, em] = wet(vec3(0.78, 0.66, 0.62), positionWorld, U.waterLevel, U.creatureWater);
        mat.colorNode = c; mat.emissiveNode = em.add(vec3(0.03, 0.025, 0.024));
        mat.clearcoatNode = float(0.6);
        M = new THREE.InstancedMesh(g, mat, Math.max(8, n * 2));
        M.frustumCulled = false; M.castShadow = false; M.receiveShadow = true;
        M.userData.keepGeometry = true;
        this.scene.add(M);
        this.meshes.set(sp, M);
      }
      M.count = 0;
    }
    for (const s of list) {
      const M = this.meshes.get(s.sp);
      if (!M || M.count >= M.instanceMatrix.count) continue;
      this._e.set(0, s.yaw, s.roll, 'YXZ');
      this._q.setFromEuler(this._e);
      const k = 0.55 + 0.45 * Math.max(0, s.left);               // picked at, it crumbles (shrinks) away
      this._s.set(k, k, k);
      this._m.compose(s.pos, this._q, this._s);
      M.setMatrixAt(M.count++, this._m);
    }
    for (const M of this.meshes.values()) M.instanceMatrix.needsUpdate = true;
  }

  dispose() { for (const M of this.meshes.values()) { M.removeFromParent(); M.material.dispose(); } this.meshes.clear(); }
}
