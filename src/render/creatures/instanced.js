// Instanced, procedurally animated creatures. Every species is one mesh (or
// two: a coarse one for the usual view and a fine one built in the background
// for when the camera comes close). Per instance: position, rotation
// (quaternion), scale, and anim = (phase, undulation amplitude, gait phase,
// hop extension + packed idle pulses: see `packAnim`). The vertex shader bends the body along its spine, swings
// legs in a walking gait, unfolds a frog's back legs in a hop and flutters
// membranes; the body definition's `rig` attribute says which vertex is what.

import * as THREE from 'three/webgpu';
import { Fn, attribute, positionLocal, normalLocal, float, sin, cos, max, min, abs, floor, select, cross, transformNormalToView } from 'three/tsl';
import { bodyGeometry } from './mesher.js';
import { requestBody } from './meshpool.js';
import { creatureMaterial, qrot } from './material.js';

// anim.w carries the hop extension (0..1) and, backward compatibly, three 4-bit idle pulses above it:
// w = hop + 2 * (breath + 16 * (throat + 16 * eye)), each pulse 0..15. A plain hop value (< 2) decodes as
// no pulses, so callers that only pass a hop are unchanged.
export function packAnim(hop, breath = 0, throat = 0, eye = 0) {
  const q = (v) => Math.max(0, Math.min(15, Math.round(v * 15)));
  return Math.max(0, Math.min(1, hop)) + 2 * (q(breath) + 16 * (q(throat) + 16 * q(eye)));
}

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
    else this.material = buildMaterial(finish, wave, legLift, legStride, textures, hasTranslucent(geometry, finish));
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.userData.keepGeometry = true;   // its attributes are shared with the species' cached geometry: never dispose them on unload
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    // Translucent parts (fins, glass shells) are drawn by a second, alpha-blended mesh sharing the geometry; it is a
    // child of the main mesh so hiding, moving or removing that one takes it along.
    const bm = this.material.userData.blendMaterial;
    if (bm) {
      this.blend = new THREE.Mesh(g, bm);
      this.blend.frustumCulled = false;
      this.blend.userData.keepGeometry = true;
      this.blend.castShadow = false;
      this.blend.receiveShadow = true;
      this.mesh.add(this.blend);
    }
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

// Does the geometry carry membrane (2) or glass (7) material ids? Then it needs the second, blended pass.
// (A glass shell that is nearly opaque, finish.glassOpacity >= 0.9, is drawn solid, so only membranes count then.)
function hasTranslucent(geometry, finish) {
  const rig = geometry.attributes.rig;
  if (!rig) return false;
  const glass = (finish.glassOpacity ?? 0.55) < 0.9;
  for (let i = 0; i < rig.count; i++) { const id = rig.getW(i); if (id > 1.5 && id < 2.5 || glass && id > 6.5) return true; }
  return false;
}

// Species whose finish, animation numbers and textures are identical draw with ONE material: building a node graph
// into a shader is the expensive part of loading a tank (tens of milliseconds each), and the graph depends only on
// these values. The materials live in a registry for the whole session and every tank reuses them. (A tank unload still
// disposes them: that is what frees the render data of the meshes that were using them, and three re-creates a disposed
// material's GPU side the next time it is drawn.)
const MATERIALS = new Map();
const texIds = new WeakMap();
let nextTexId = 1;
const texId = (t) => { if (!t) return 0; if (!texIds.has(t)) texIds.set(t, nextTexId++); return texIds.get(t); };
const finishKey = (_, v) => (v && v.isTexture ? 'tex' + texId(v) : v);

function buildMaterial(finish, wave, legLift, legStride, textures = null, translucent = false) {
  const key = JSON.stringify([finish, wave, legLift, legStride, translucent, textures && Object.entries(textures).map(([k, t]) => [k, texId(t)])], finishKey);
  let m = MATERIALS.get(key);
  if (!m) { m = buildUncached(finish, wave, legLift, legStride, textures, translucent); MATERIALS.set(key, m); }
  return m;
}

function buildUncached(finish, wave, legLift, legStride, textures = null, translucent = false) {
  const m = buildPass(finish, wave, legLift, legStride, textures, translucent ? 'opaque' : 'solid');
  if (translucent) m.userData.blendMaterial = buildPass(finish, wave, legLift, legStride, textures, 'blend');
  return m;
}

function buildPass(finish, wave, legLift, legStride, textures, pass) {
  const { material: m, n } = creatureMaterial(finish, { ...(textures ?? {}), pass });
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
    // anim.w = hop + packed idle pulses (see packAnim).
    const n0 = floor(anim.w.mul(0.5));
    const hopv = anim.w.sub(n0.mul(2));
    const n1 = floor(n0.mul(1 / 16)), n2 = floor(n1.mul(1 / 16));
    const breath = n0.sub(n1.mul(16)).div(15), throat = n1.sub(n2.mul(16)).div(15), eyeRet = n2.div(15);
    // Hop: back legs stretch out behind.
    p.z.subAssign(isLeg.and(back).select(hopv.mul(legT).mul(1.6), float(0)));
    p.y.subAssign(isLeg.and(back).select(hopv.mul(legT).mul(0.4), float(0)));
    // Breathing: the flanks swell and sink; throat: the underside of the head bulges; eyes sink into the head.
    const flank = sin(min(max(spine.sub(0.15).mul(2), float(0)), float(1)).mul(3.14159));
    const k = breath.mul(0.045).mul(flank).mul(isLeg.select(float(0), float(1)));
    p.x.addAssign(p.x.mul(k)); p.y.addAssign(p.y.mul(k));
    const head = max(float(1).sub(spine.mul(3.3)), float(0));
    const under = min(max(normalLocal.y.mul(-1.6), float(0)), float(1));
    p.addAssign(normalLocal.mul(throat.mul(0.2).mul(head).mul(under).mul(isLeg.select(float(0), float(1)))));
    p.y.subAssign(abs(matId.sub(1)).lessThan(0.5).select(eyeRet.mul(0.22), float(0)));
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
//
// Meshing runs in workers (meshpool.js): `lo` stays null until the coarse mesh arrives (put() draws nothing meanwhile,
// `ready` resolves when it has), and refine() returns at once and swaps the fine mesh in when it arrives. Callers that
// need the meshes right now (tools, portraits) read `.lo`, which meshes synchronously if it must, and call refine(true).
const LO = new WeakMap(), HI = new WeakMap();   // geometry caches, shared by every tank
const LOP = new WeakMap(), HIP = new WeakMap(); // in-flight requests, so two tanks asking for one body share one job

function geometryOf(def, detail) {
  const cache = detail === 'hi' ? HI : LO, jobs = detail === 'hi' ? HIP : LOP;
  if (cache.has(def)) return Promise.resolve(cache.get(def));
  if (!jobs.has(def)) jobs.set(def, requestBody(def, detail).then((g) => { if (!cache.has(def)) cache.set(def, g); return cache.get(def); }));
  return jobs.get(def);
}

export class CreatureLOD {
  constructor(scene, source, opts) {
    this.scene = scene;
    this.opts = opts;
    this.def = source.isBufferGeometry ? null : source;
    this._lo = null;
    this.hi = null;
    this.refining = false;
    this.removed = false;
    this.pendingHi = null;
    this.near = opts.near ?? 55;
    this.near2 = this.near * this.near;
    this.cap = opts.cap;
    if (!this.def) { this.setLo(source); this.ready = Promise.resolve(this); }
    else if (LO.has(this.def)) { this.setLo(LO.get(this.def)); this.ready = Promise.resolve(this); }
    else this.ready = geometryOf(this.def, 'lo').then((g) => { this.setLo(g); return this; });
  }

  // The coarse mesh. Forces it to be built right here if it has not arrived (legacy callers); the game never does.
  get lo() {
    if (!this._lo && this.def && !this.removed) this.setLo(LO.get(this.def) ?? (LO.set(this.def, bodyGeometry(this.def, 'lo')), LO.get(this.def)));
    return this._lo;
  }

  setLo(geo) {
    if (this._lo || this.removed) return;
    const opts = this.opts;
    this._lo = new CreatureMesh(this.scene, geo, opts);
    if (opts.hiGeometry) this.hi = new CreatureMesh(this.scene, opts.hiGeometry, { ...opts, material: this._lo.material });
    else if (this.def && HI.has(this.def)) this.hi = new CreatureMesh(this.scene, HI.get(this.def), { ...opts, material: this._lo.material });
    else if (this.pendingHi) this.setHi(this.pendingHi);
    this.pendingHi = null;
  }

  setHi(geo) {
    if (this.removed || this.hi) return;
    if (!this._lo) { this.pendingHi = geo; return; }
    this.hi = new CreatureMesh(this.scene, geo, { ...this.opts, material: this._lo.material });
  }

  get canRefine() { return !!this.def && !this.hi && !this.refining && !this.removed; }

  // Asks for the fine mesh and returns at once; it appears when a worker has built it. Sharing the material keeps the
  // two meshes shading identically. `sync` builds it here and now (tools and portraits that shoot immediately).
  refine(sync = false) {
    if (!this.canRefine) return false;
    if (sync) {
      if (!HI.has(this.def)) HI.set(this.def, bodyGeometry(this.def, 'hi'));
      void this.lo;
      this.setHi(HI.get(this.def));
      return true;
    }
    this.refining = true;
    geometryOf(this.def, 'hi').then((g) => { this.refining = false; this.setHi(g); });
    return true;
  }

  begin() { this._lo?.begin(); this.hi?.begin(); }
  // `d2` is the squared distance from the camera to the animal.
  put(pos, quat, scale, a0, a1, a2, a3, d2 = 1e9) {
    const lo = this._lo;
    if (!lo) return;
    if (d2 < this.near2) {
      if (this.hi) { this.hi.put(pos, quat, scale, a0, a1, a2, a3); return; }
      this.wants = true;
    }
    lo.put(pos, quat, scale, a0, a1, a2, a3);
  }
  end() { this._lo?.end(); this.hi?.end(); }
  get mesh() { return this._lo?.mesh; }
  // Takes the meshes out of the scene without freeing the (shared) geometry; anything still in flight is dropped.
  remove() { this.removed = true; this._lo?.mesh.removeFromParent(); this.hi?.mesh.removeFromParent(); }
  dispose() { this.removed = true; this._lo?.dispose(); this.hi?.dispose(); }
}
