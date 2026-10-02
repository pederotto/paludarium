// Instanced, procedurally animated creatures. Every species is one mesh (or
// two: a coarse one for the usual view and a fine one built in the background
// for when the camera comes close). Per instance: position, rotation
// (quaternion), scale, and anim = (phase, undulation amplitude, gait phase,
// hop extension + packed pose bits: see `packAnim`). The vertex shader bends the body along its spine, swings
// legs in a walking gait, unfolds a frog's back legs in a hop and flutters
// membranes; the body definition's `rig` attribute says which vertex is what.
//
// RIG MODES. Everything a pose needs rides in those four per-instance floats, so one material serves every pose
// (no shader variants, no extra vertex buffers):
//   leg ids   1 front-left, 2 front-right, 3 back-left, 4 back-right (diagonal pairs 1+4, 2+3 move together);
//             5 and 6 are a crab's claws. legT is 0 at the shoulder / hip and 1 at the toe.
//   walk      anim.z is the gait phase: a foot is up while sin > 0 and swings forward, so it is planted while it
//             moves back relative to the body at a constant speed (legStride = a quarter of the stride, and the
//             phase advances 2 pi per stride, give a foot that does not slide). `calm` (0 … 1, in anim.w) stills
//             the legs: standing, swimming.
//   hop       anim.w's fraction: the back legs stretch out behind (0 folded, 1 extended): a leap, or one frog kick.
//   pose      0 … 1 in anim.w. For frogs and salamanders: swimming (the forelegs sweep back along the flanks and the
//             hind legs splay and close as they extend: with hop driven by a kick cycle this is the breaststroke;
//             for a newt hop = 1 trails the hind legs along the tail). For a crab (legAxis 'x'): the claws wave.
//   legAxis   'x' for a sideways walker (crab): the gait swings feet along the body's x axis, in the direction given
//             by the sign of anim.y (the body wave is not used).

import * as THREE from 'three/webgpu';
import { Fn, attribute, positionLocal, normalLocal, float, sin, cos, max, min, abs, floor, fract, select, sign, cross, transformNormalToView } from 'three/tsl';
import { bodyGeometry } from './mesher.js';
import { packAnim } from '../../util/gait.js';
import { requestBody } from './meshpool.js';
import { creatureMaterial, qrot } from './material.js';

// anim.w carries the hop extension and, above it, the packed pose bits (packAnim, in util/gait.js, which says how).
export { packAnim };

export class CreatureMesh {
  constructor(scene, geometry, { cap = 64, wave = 2.2, legLift = 0.25, legStride = 0.35, finish = {}, material = null, textures = null, legAxis = 'z', limb = 1 } = {}) {
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
    else this.material = buildMaterial(finish, wave, legLift, legStride, textures, hasTranslucent(geometry, finish), legAxis, limb);
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

function buildMaterial(finish, wave, legLift, legStride, textures = null, translucent = false, legAxis = 'z', limb = 1) {
  const key = JSON.stringify([finish, wave, legLift, legStride, translucent, textures && Object.entries(textures).map(([k, t]) => [k, texId(t)]), legAxis, limb], finishKey);
  let m = MATERIALS.get(key);
  if (!m) { m = buildUncached(finish, wave, legLift, legStride, textures, translucent, legAxis, limb); MATERIALS.set(key, m); }
  return m;
}

function buildUncached(finish, wave, legLift, legStride, textures = null, translucent = false, legAxis = 'z', limb = 1) {
  const m = buildPass(finish, wave, legLift, legStride, textures, translucent ? 'opaque' : 'solid', legAxis, limb);
  if (translucent) m.userData.blendMaterial = buildPass(finish, wave, legLift, legStride, textures, 'blend', legAxis, limb);
  return m;
}

// `limb` scales the leg numbers below (hop reach, swim tuck, kick splay) for animals whose legs are shorter or longer than a
// 4 cm frog's; they are in centimetres of the mesh, applied before the instance scale. `finish.waveHead` (0 … 1) is how much of
// the body wave's amplitude the head keeps: 0 for a fish (the head is still), about 0.3 for a salamander walking in S-curves.
function buildPass(finish, wave, legLift, legStride, textures, pass, legAxis = 'z', limb = 1) {
  const { material: m, n } = creatureMaterial(finish, { ...(textures ?? {}), pass });
  const rig = attribute('rig', 'vec4');
  const anim = attribute('iAnim', 'vec4');
  const q = attribute('iRot', 'vec4');
  const matId = rig.w;
  const iPos = attribute('iPos', 'vec4');
  const flutter = float(finish.flutter ?? 0.04);
  const waveHead = finish.waveHead ?? 0;
  const side = legAxis === 'x';
  m.positionNode = Fn(() => {
    const spine = rig.x, leg = rig.y, legT = rig.z;
    const p = positionLocal.toVar();
    // Per-instance state, unpacked from anim.w (see packAnim).
    const n0 = floor(anim.w.mul(0.5));
    const hopv = anim.w.sub(n0.mul(2));
    const n1 = floor(n0.mul(0.125)), n2 = floor(n1.mul(0.125)), n3 = floor(n2.mul(0.125)), n4 = floor(n3.mul(0.0625));
    const breath = n0.sub(n1.mul(8)).div(7), throat = n1.sub(n2.mul(8)).div(7), eyeRet = n2.sub(n3.mul(8)).div(7);
    const pose = n3.sub(n4.mul(16)).div(15), calm = n4.div(7);
    // Body wave: a travelling sine along the spine, growing toward the tail (the head keeps `waveHead` of the amplitude).
    // A sideways walker (crab) has no body wave: anim.y is its direction of travel.
    if (!side) {
      const profile = spine.mul(spine).mul(1 - waveHead).add(waveHead);
      p.x.addAssign(sin(spine.mul(wave * 3.14159).sub(anim.x)).mul(anim.y).mul(profile));
    }
    // Legs: diagonal pairs (front left + back right) move together. The foot is up while sin(phase) > 0 and swings forward
    // then, so it is on the ground the other half of the cycle, when it moves back relative to the body at a constant speed
    // (util/gait.js footSwing: the same curve, so a foot that is down does not slide when legStride = a quarter of the stride).
    const isFore = abs(leg.sub(1.5)).lessThan(0.6), isHind = abs(leg.sub(3.5)).lessThan(0.6);
    const isWalk = isFore.or(isHind);
    const diag = abs(leg.sub(1)).lessThan(0.5).or(abs(leg.sub(4)).lessThan(0.5));
    const lp = anim.z.add(diag.select(float(0), float(3.14159)));
    const go = float(1).sub(calm);
    const lift = max(sin(lp), 0).mul(legT).mul(legLift).mul(go);
    const u = fract(lp.mul(1 / 6.283185));
    const swing = select(u.lessThan(0.5), cos(u.mul(6.283185)).negate(), float(3).sub(u.mul(4))).mul(legT).mul(legStride).mul(go);
    p.y.addAssign(isWalk.select(lift, float(0)));
    if (side) p.x.addAssign(isWalk.select(swing.mul(sign(anim.y)), float(0)));
    else p.z.addAssign(isWalk.select(swing, float(0)));
    const sgn = sign(positionLocal.x);
    const hind = isHind.select(float(1), float(0));
    // Hop (or one frog kick): the back legs stretch out behind.
    p.z.subAssign(hind.mul(hopv).mul(legT).mul(1.6 * limb));
    p.y.subAssign(hind.mul(hopv).mul(legT).mul(0.4 * limb));
    if (side) {
      // A crab's claws (ids 5, 6): raised and waved while `pose` is up (anim.x is the wave phase).
      const claw = leg.greaterThan(4.5).select(float(1), float(0)).mul(pose).mul(legT);
      const wv = sin(anim.x).mul(0.5).add(0.5);
      p.y.addAssign(claw.mul(wv.mul(0.55).add(0.35)).mul(limb));
      p.x.addAssign(sgn.mul(claw).mul(sin(anim.x.mul(0.5)).mul(0.3)).mul(limb));
      p.z.addAssign(claw.mul(0.25).mul(limb));
    } else {
      // Swimming (pose): the breaststroke splays the feet as the legs extend (largest halfway) and closes them at full
      // extension; the forelegs sweep back, up and in along the flanks.
      const kick = hopv.mul(float(1).sub(hopv)).mul(4 * 0.55 * limb).sub(hopv.mul(hopv).mul(0.35 * limb));
      p.x.addAssign(sgn.mul(hind).mul(legT).mul(pose).mul(kick));
      const fore = isFore.select(float(1), float(0)).mul(pose).mul(legT);
      p.z.subAssign(fore.mul(0.9 * limb));
      p.y.addAssign(fore.mul(0.5 * limb));
      p.x.subAssign(sgn.mul(fore).mul(0.45 * limb));
    }
    // Breathing: the flanks swell and sink; throat: the underside of the head bulges (to 0.32 cm: a calling frog's vocal sac; the
    // everyday throat pumping uses about 0.6 of that, util/gait.js callSac and Animals.vis); eyes sink into the head.
    const flank = sin(min(max(spine.sub(0.15).mul(2), float(0)), float(1)).mul(3.14159));
    const k = breath.mul(0.045).mul(flank).mul(isWalk.select(float(0), float(1)));
    p.x.addAssign(p.x.mul(k)); p.y.addAssign(p.y.mul(k));
    const head = max(float(1).sub(spine.mul(3.3)), float(0));
    const under = min(max(normalLocal.y.mul(-1.6), float(0)), float(1));
    p.addAssign(normalLocal.mul(throat.mul(0.32).mul(head).mul(under).mul(isWalk.select(float(0), float(1)))));
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
