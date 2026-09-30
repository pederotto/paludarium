// Instanced, procedurally animated creatures. Every species is one mesh (or
// two: a coarse one for the usual view and a fine one built in the background
// for when the camera comes close). Per instance: position, rotation
// (quaternion), scale, and anim = (phase, undulation amplitude, gait phase,
// hop extension). The vertex shader bends the body along its spine, swings
// legs in a walking gait, unfolds a frog's back legs in a hop and flutters
// membranes; the body definition's `rig` attribute says which vertex is what.

import * as THREE from 'three/webgpu';
import { Fn, attribute, positionLocal, normalLocal, float, sin, cos, max, abs, select, cross, transformNormalToView } from 'three/tsl';
import { bodyGeometry } from './mesher.js';
import { creatureMaterial, qrot } from './material.js';

export class CreatureMesh {
  constructor(scene, geometry, { cap = 64, wave = 2.2, legLift = 0.25, legStride = 0.35, finish = {}, material = null, textures = null } = {}) {
    const g = new THREE.InstancedBufferGeometry();
    for (const k of Object.keys(geometry.attributes)) g.setAttribute(k, geometry.attributes[k]);
    g.setIndex(geometry.index);
    this.cap = cap;
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);   // xyz position, w scale
    this.iRot = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    this.iAnim = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    for (const a of [this.iPos, this.iRot, this.iAnim]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.iPos);
    g.setAttribute('iRot', this.iRot);
    g.setAttribute('iAnim', this.iAnim);
    g.instanceCount = 0;
    this.geometry = g;

    if (material) this.material = material;
    else this.material = buildMaterial(finish, wave, legLift, legStride, textures);
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.userData.keepGeometry = true;   // its attributes are shared with the species' cached geometry: never dispose them on unload
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
    this.n = 0;
  }

  begin() { this.n = 0; }

  put(pos, quat, scale, a0 = 0, a1 = 0, a2 = 0, a3 = 0) {
    if (this.n >= this.cap) return;
    const i = this.n++;
    this.iPos.setXYZW(i, pos.x, pos.y, pos.z, scale);
    this.iRot.setXYZW(i, quat.x, quat.y, quat.z, quat.w);
    this.iAnim.setXYZW(i, a0, a1, a2, a3);
  }

  end() {
    this.geometry.instanceCount = this.n;
    for (const a of [this.iPos, this.iRot, this.iAnim]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.n * a.itemSize);
      a.needsUpdate = true;
    }
  }

  dispose() { this.geometry.dispose(); this.mesh.removeFromParent(); }
}

function buildMaterial(finish, wave, legLift, legStride, textures = null) {
  const { material: m, n } = creatureMaterial(finish, textures ?? {});
  const rig = attribute('rig', 'vec4');
  const anim = attribute('iAnim', 'vec4');
  const q = attribute('iRot', 'vec4');
  const matId = rig.w;
  const iPos = attribute('iPos', 'vec4');
  const flutter = float(finish.flutter ?? 0.04);
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
    // Membranes (fins, gills, tail fringes) ripple along the normal.
    const isFin = abs(matId.sub(2)).lessThan(0.5);
    p.addAssign(normalLocal.mul(sin(anim.x.mul(1.7).add(positionLocal.z.mul(4)).add(positionLocal.y.mul(3))).mul(flutter).mul(isFin.select(float(1), float(0)))));
    return qrot(q, p.mul(iPos.w)).add(iPos.xyz);
  })();
  m.normalNode = transformNormalToView(qrot(q, n));
  return m;
}

// A species with a coarse mesh now and a fine one on demand. Instances closer
// to the camera than `near` cm use the fine mesh once it exists.
const LO = new WeakMap(), HI = new WeakMap();   // geometry caches, shared by every tank

export class CreatureLOD {
  constructor(scene, source, opts) {
    this.scene = scene;
    this.opts = opts;
    this.def = source.isBufferGeometry ? null : source;
    let loGeo = source;
    if (this.def) { if (!LO.has(this.def)) LO.set(this.def, bodyGeometry(this.def, 'lo')); loGeo = LO.get(this.def); }
    this.lo = new CreatureMesh(scene, loGeo, opts);
    this.hi = null;
    if (opts.hiGeometry) this.hi = new CreatureMesh(scene, opts.hiGeometry, { ...opts, material: this.lo.material });
    else if (this.def && HI.has(this.def)) this.hi = new CreatureMesh(scene, HI.get(this.def), { ...opts, material: this.lo.material });
    this.near = opts.near ?? 55;
    this.near2 = this.near * this.near;
    this.cap = opts.cap;
  }

  get canRefine() { return !!this.def && !this.hi; }

  // Builds the fine mesh (takes tens of milliseconds to a second). Sharing the
  // material keeps the two meshes shading identically.
  refine() {
    if (!this.canRefine) return false;
    if (!HI.has(this.def)) HI.set(this.def, bodyGeometry(this.def, 'hi'));
    const geo = HI.get(this.def);
    this.hi = new CreatureMesh(this.scene, geo, { ...this.opts, material: this.lo.material });
    return true;
  }

  begin() { this.lo.begin(); this.hi?.begin(); }
  // `d2` is the squared distance from the camera to the animal.
  put(pos, quat, scale, a0, a1, a2, a3, d2 = 1e9) {
    if (d2 < this.near2) {
      if (this.hi) { this.hi.put(pos, quat, scale, a0, a1, a2, a3); return; }
      this.wants = true;
    }
    this.lo.put(pos, quat, scale, a0, a1, a2, a3);
  }
  end() { this.lo.end(); this.hi?.end(); }
  get mesh() { return this.lo.mesh; }
  dispose() { this.lo.dispose(); this.hi?.dispose(); }
}
