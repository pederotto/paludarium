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
//   rig2      (finish.rig2 = { neck, s0, s1, neckY, len }) a second per-instance vec4, iAnim2 = (head yaw, head pitch, body bend,
//             tail swing), for animals that steer the head apart from the body: a salamander sweeping its snout, a gecko looking
//             up the wall, the C-curve of a turn or a warning arch, a tail that waves. Yaw and pitch (radians, + = toward +x /
//             nose up) rotate the part of the body ahead of the neck (`neck`: spine fraction of the pivot; the weight is 1 at
//             `s0` and 0 at `s1`; `neckY` the pivot height; `len` the model length, cm); bend and tail are fractions of `len`.
//             Two more numbers ride in the same vector (material.js rig2Pack): the tail's length 0 … 1 and the skin's dullness 0 … 1, and
//             the spine fraction a dropped tail piece was cut at (0 for a whole animal). A gecko that dropped its tail has a blunt
//             stump (`rig2.tail0`: the spine fraction of the vent; `tailY`: the height of the tail's axis); the dropped tail is another
//             instance of the same mesh with the piece set, which shows only the part beyond the cut and thrashes about it. The dullness
//             is a milky tint in the material before a shed. The tail's lift (rig2Pack) curves the tail up or down, so a body standing
//             on a stone or a slope lays its tail along the ground instead of through it.
//   turn      (finish.turnSweep, a body plan: frogs, salamanders, lizards) in a turn the legs swing round the pivot (the hips, measured
//             on the mesh) instead of back along the body, by the turning mix tau (util/turn.js footRig: a planted foot stays put while
//             the body turns over it). tau rides in rig2's A word, or in anim.y for a body without rig2 (frogs). See turnFinish.
//   legAxis   'x' for a sideways walker (crab): the gait swings feet along the body's x axis, in the direction given
//             by the sign of anim.y (the body wave is not used).
//   invert    (finish.invert = { antenna, wave, curl }) insects, isopods and shrimp. The packed bits a frog spends on breath,
//             throat and eyes mean other things here: breath = how busy the antennae are, throat = a beat (wings buzzing, a shrimp's
//             swimmerets paddling), eye = feeding (a shrimp's pincers picking at the ground and back to its mouth), pose = the
//             wings spread from folded; hop = the jumping hind legs and a springtail's furcula kicking out, or the body curling
//             (`curl`: { z0, y0, len, flick }: a panda king isopod rolls into a ball, a shrimp flicks its tail under, about the
//             belly line y0 at z0 over `len` cm). Leg ids beyond the four walking ones: 7 / 8 antennae, 9 wings, 10 swimmerets,
//             11 / 12 jumping hind legs (walk with the tripod of 1 and 4 / 2 and 3), 13 furcula, 14 a shrimp's eggs (shown while `spread`
//             is up, folded to `invert.eggs` inside the abdomen otherwise), 15 / 16 a shrimp's pincers.
//             `wave` (radians per spine length): legs step in a wave from tail to head, opposite sides half a cycle apart,
//             instead of in diagonal pairs (seven pairs of isopod legs or five of a shrimp's walking in two groups shuffled).

import * as THREE from 'three/webgpu';
import { Fn, attribute, positionLocal, normalLocal, float, vec3, vec4, sin, cos, max, min, abs, floor, fract, select, sign, cross, smoothstep, transformNormalToView, varyingProperty, varying } from 'three/tsl';
import { bodyGeometry } from './mesher.js';
import { packAnim, unpackAnim, rig2Pack, TURN_Q } from '../../util/gait.js';
import { limbFrame, turnFrame } from '../../util/turn.js';

const SWIM_WAVE = 2.2;     // waves per body length x 2 of a swimming caudate (wavelength 0.9 of the body)
import { PLANS } from '../../util/bodyplan.js';
import { requestBody } from './meshpool.js';
import { creatureMaterial, qrot, rig2Unpack } from './material.js';
import { skeletonRig, poseBones, poseStroke, ROW_FLOATS } from './skeleton.js';
import { SKIN, boneData, boneTexture, rows, live, skinGeometry, skinVertex } from './skin.js';

// anim.w carries the hop extension and, above it, the packed pose bits (packAnim, in util/gait.js, which says how).
export { packAnim };

export class CreatureMesh {
  // `skin` (a skeleton, skeleton.js; the geometry from skin.js skinGeometry): this mesh draws its instances skinned by their
  // bones (the near level of detail), up to SKIN.cap of them; null if no rows of the bone texture were free.
  constructor(scene, geometry, { cap = 64, wave = 2.2, legLift = 0.25, legStride = 0.35, finish = {}, material = null, textures = null, legAxis = 'z', limb = 1, skin = null } = {}) {
    finish = turnFinish(finish, geometry);
    if (skin) {
      this.skinRig = skeletonRig(skin, { legLift, legStride, limb, turn: finish.turnSweep && typeof finish.turnSweep === 'object' ? finish.turnSweep : null });
      this.skinCap = Math.min(cap, this.skinRig?.stroke ? SKIN.strokes : SKIN.cap);
      this.row0 = this.skinRig ? rows.take(this.skinCap) : -1;
      if (this.row0 < 0) { if (this.skinRig) console.warn('skin: no rows of the bone texture left (SKIN_ROWS): this body draws without its bones'); this.skinRig = null; this.skinCap = 0; }
      else { cap = this.skinCap; live.add(this); }
      this.inY = !!finish.turnSweep?.inY;
    }
    this.finish = finish;                 // (as resolved for this geometry: Animals.draw reads which turning channels it has)
    const g = new THREE.InstancedBufferGeometry();
    for (const k of Object.keys(geometry.attributes)) g.setAttribute(k, geometry.attributes[k]);
    g.setIndex(geometry.index);
    this.cap = cap;
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);   // xyz position, w scale
    this.iRot = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    this.iAnim = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    this.iAnim2 = finish.rig2 ? new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4) : null;   // only the species that steer the head (finish.rig2)
    for (const a of [this.iPos, this.iRot, this.iAnim, this.iAnim2]) a?.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.iPos);
    g.setAttribute('iRot', this.iRot);
    g.setAttribute('iAnim', this.iAnim);
    if (this.iAnim2) g.setAttribute('iAnim2', this.iAnim2);
    g.instanceCount = 0;
    this.geometry = g;

    if (material) this.material = material;
    else this.material = buildMaterial(finish, wave, legLift, legStride, textures, hasTranslucent(geometry, finish), legAxis, limb, !!this.skinRig);
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

  // `st`: the stroke of a swimming body (util/gait.js swimPose().stroke), for a mesh skinned by a `bind: 'swim'` skeleton.
  put(pos, quat, scale, a0 = 0, a1 = 0, a2 = 0, a3 = 0, b0 = 0, b1 = 0, b2 = 0, b3 = 0, c0 = 1, c1 = 0, c2 = 0, c3 = 0, c4 = 0, st = null) {
    if (this.n >= this.cap) return;
    const i = this.n++;
    this.iPos.setXYZW(i, pos.x, pos.y, pos.z, scale);
    this.iRot.setXYZW(i, quat.x, quat.y, quat.z, quat.w);
    if (this.skinRig) {
      // the bones from the state the rig would have drawn (anim.y then carries the instance's row of the bone texture)
      const row = this.row0 + i;
      if (this.skinRig.stroke) poseStroke(this.skinRig, st, boneData, row * ROW_FLOATS, st?.info ?? null);    // (info: the limbs' tips, for whoever asked)
      else { const u = unpackAnim(a3); poseBones(this.skinRig, { phase: a2, tau: this.inY ? a1 : c4, hop: u.hop, calm: u.calm, pose: u.pose, yaw: b0, pitch: b1, bend: b2, tail: b3, tailF: c0, piece: c2, lift: c3, feet: st?.feet, peel: st?.peel }, boneData, row * ROW_FLOATS); }   // (b0 … c3: the rig2 channels, a lizard's axial bones: lizardpose.js)
      a1 = row;
    }
    this.iAnim.setXYZW(i, a0, a1, a2, a3);
    if (this.iAnim2) { const [pa, pb] = rig2Pack(b2, b3, c0, c1, c2, c3, c4); this.iAnim2.setXYZW(i, b0, b1, pa, pb); }
  }

  end() {
    this.geometry.instanceCount = this.n;
    for (const a of [this.iPos, this.iRot, this.iAnim, this.iAnim2]) {
      if (!a) continue;
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.n * a.itemSize);
      a.needsUpdate = true;
    }
    if (this.skinRig && this.n) boneTexture.needsUpdate = true;
  }

  // (gives its rows of the bone texture back)
  releaseSkin() { if (this.skinRig) { rows.free(this.row0, this.skinCap); live.delete(this); this.skinRig = null; this.skinCap = 0; } }

  dispose() { this.releaseSkin(); this.geometry.dispose(); this.mesh.removeFromParent(); }
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

// The turning rig's numbers, measured on the geometry (they are part of the finish, so they key the material):
//   finish.turnSweep = 'anuran' | 'caudate' | 'lizard' (a body plan, util/bodyplan.js) → { pz, R, inY }: in a turn the legs swing
//     round the pivot (the hips, mesh z `pz`) instead of back along the body, by the turning mix tau (util/turn.js footRig), so a
//     planted foot stays where it was put; R is the farthest foot's distance from the pivot. tau rides in the rig2 vector (A's
//     top bits, util/gait.js rig2Pack) or, for a body without one (`inY`: frogs, whose body wave is unused), in anim.y.
//   finish.rig2 without `len`: the body's length along z, from the geometry (a fish's C-bend in a turn).
// A mesh without the rig attribute (or without four legs) gets neither.
function turnFinish(finish, geometry) {
  if (!finish.turnSweep && !(finish.rig2 && finish.rig2.len == null)) return finish;
  const P = geometry.attributes.position?.array, R = geometry.attributes.rig?.array;
  const out = { ...finish };
  if (finish.rig2 && finish.rig2.len == null) {
    if (!R) delete out.rig2;
    else { let z0 = Infinity, z1 = -Infinity; for (let i = 2; i < P.length; i += 3) { if (P[i] < z0) z0 = P[i]; if (P[i] > z1) z1 = P[i]; } out.rig2 = { ...finish.rig2, len: +(z1 - z0).toFixed(3) }; }
  }
  if (typeof finish.turnSweep === 'string') {
    const tf = turnFrame(PLANS[finish.turnSweep], limbFrame(P, R), 1);
    if (tf.legs) out.turnSweep = { pz: +tf.pz.toFixed(3), R: +tf.R.toFixed(3), inY: !out.rig2 };
    else delete out.turnSweep;
  }
  return out;
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

function buildMaterial(finish, wave, legLift, legStride, textures = null, translucent = false, legAxis = 'z', limb = 1, skin = false) {
  const key = JSON.stringify([finish, wave, legLift, legStride, translucent, textures && Object.entries(textures).map(([k, t]) => [k, texId(t)]), legAxis, limb, ...(skin ? ['skin'] : [])], finishKey);
  let m = MATERIALS.get(key);
  if (!m) { m = buildUncached(finish, wave, legLift, legStride, textures, translucent, legAxis, limb, skin); MATERIALS.set(key, m); }
  return m;
}

function buildUncached(finish, wave, legLift, legStride, textures = null, translucent = false, legAxis = 'z', limb = 1, skin = false) {
  const m = buildPass(finish, wave, legLift, legStride, textures, translucent ? 'opaque' : 'solid', legAxis, limb, skin);
  if (translucent) m.userData.blendMaterial = buildPass(finish, wave, legLift, legStride, textures, 'blend', legAxis, limb, skin);
  return m;
}

// `limb` scales the leg numbers below (hop reach, swim tuck, kick splay) for animals whose legs are shorter or longer than a
// 4 cm frog's; they are in centimetres of the mesh, applied before the instance scale. `finish.waveHead` (0 … 1) is how much of
// the body wave's amplitude the head keeps: 0 for a fish (the head is still), about 0.3 for a salamander walking in S-curves.
// `skin`: the bones place the vertex (skin.js skinVertex) instead of the rig's legs, hop, swim pose, body wave and head channel; the
// breathing, throat, eyes and membranes still move the rest pose first, and the shading normal is the skinned one.
function buildPass(finish, wave, legLift, legStride, textures, pass, legAxis = 'z', limb = 1, skin = false) {
  const vSkinN = skin ? varyingProperty('vec3', 'vSkinN') : null;
  const { material: m, n, nCoat } = creatureMaterial(finish, { ...(textures ?? {}), pass, ...(skin ? { nrm: vSkinN } : {}) });
  const rig = attribute('rig', 'vec4');
  const anim = attribute('iAnim', 'vec4');
  const q = attribute('iRot', 'vec4');
  const matId = rig.w;
  const iPos = attribute('iPos', 'vec4');
  const flutter = float(finish.flutter ?? 0.04);
  const waveHead = finish.waveHead ?? 0;
  const rig2 = finish.rig2 ?? null;
  const swimmer = !!(rig2?.len && !finish.invert && legAxis !== 'x' && !skin);   // a newt, salamander or axolotl (legs, a tail; swims)
  const side = legAxis === 'x';
  const inv = finish.invert ?? null;
  const vCurl = inv?.curl ? varyingProperty('float', 'vCurl') : null;   // the curl's angle at this vertex, for its normal
  m.positionNode = Fn(() => {
    const spine = rig.x, leg = rig.y, legT = rig.z;
    const spineW = spine.toVar();      // the spine position the body wave sees (the part of a cut tail is folded into what is left)
    const p = positionLocal.toVar();
    // Head and body steering (finish.rig2): the head turns about the neck on its own, the body curves into a C, the tail swings.
    const ts = finish.turnSweep && !finish.invert && !side ? finish.turnSweep : null;
    let tau = float(0);
    if (rig2 && !skin) {
      // (A's top bits carry the turning mix, util/gait.js rig2Pack: taken off before the rest is unpacked)
      const a2r = attribute('iAnim2', 'vec4');
      const tq = floor(a2r.z.mul(1 / TURN_Q));
      const a2 = vec4(a2r.x, a2r.y, a2r.z.sub(tq.mul(TURN_Q)), a2r.w);
      if (ts) tau = tq.sub(floor(tq.mul(0.125)).mul(8)).div(7).mul(select(tq.greaterThanEqual(8), float(-1), float(1)));
      const { neck, s0, s1, neckY, len } = rig2;
      const noLeg = leg.lessThan(0.5).select(float(1), float(0));
      const hw = float(1).sub(smoothstep(s0, s1, spine)).mul(noLeg);
      const dz = float(neck).sub(spine).mul(len);                    // how far ahead of the neck pivot (cm)
      const dy = p.y.sub(neckY);
      const cy = cos(a2.x.mul(hw)), sy = sin(a2.x.mul(hw));
      const cp = cos(a2.y.mul(hw)), spn = sin(a2.y.mul(hw));
      // yaw about the vertical through the neck, then pitch about the horizontal through it
      const x0 = p.x.toVar(), dyv = dy.toVar(), dzv = dz.toVar();     // (nodes are lazy: pin the inputs before p is assigned)
      const x1 = x0.mul(cy).add(dzv.mul(sy)).toVar(), dz1 = dzv.mul(cy).sub(x0.mul(sy)).toVar();
      const dy2 = dyv.mul(cp).add(dz1.mul(spn)).toVar(), dz2 = dz1.mul(cp).sub(dyv.mul(spn)).toVar();
      p.x.assign(x1); p.y.assign(dy2.add(neckY)); p.z.addAssign(dz2.sub(dzv));
      // Tail: a gecko's cut (the stump after it dropped its tail, or the dropped piece itself, which is the part beyond the cut).
      // The spine fraction the body is bent by is clamped to what is left, so the collapsed part follows the rest.
      const u2 = rig2Unpack(a2);
      const t0 = rig2.tail0 ?? 0.5, tailY = rig2.tailY ?? neckY * 0.8;
      const piece = u2.piece.greaterThan(0.01);
      const sCut = float(t0).add(float(1 - t0).mul(u2.tailF));
      const endS = sCut.add(0.07);
      const lowS = u2.piece.sub(0.07);
      const shrink = select(piece, float(1).sub(smoothstep(lowS, u2.piece, spine)), smoothstep(sCut, endS, spine)).toVar();
      const dzCut = select(piece, max(lowS.sub(spine), float(0)).negate(), max(spine.sub(endS), float(0))).mul(len);
      p.x.assign(p.x.mul(float(1).sub(shrink)));
      p.y.assign(float(tailY).add(p.y.sub(tailY).mul(float(1).sub(shrink))));
      p.z.addAssign(dzCut);
      spineW.assign(select(piece, max(spine, lowS), min(spine, endS)));
      // C-curve about the shoulders (head and tail swing to the same side), tail swing beyond the middle (about the cut for a piece)
      const c0 = spineW.sub(0.4);
      p.x.addAssign(u2.bend.mul(len).mul(c0.mul(c0)));
      const ttBody = max(spineW.sub(0.5).mul(2), float(0));
      const ttPiece = max(spine.sub(u2.piece), float(0)).div(max(float(1).sub(u2.piece), 0.05));
      const tt = select(piece, ttPiece, ttBody);
      p.x.addAssign(u2.tail.mul(len).mul(tt.mul(tt)));
      // the tail curved up or down so it lies along the ground (Animals.tailLift): not for a dropped piece, which lies as it fell
      p.y.addAssign(select(piece, float(0), u2.lift).mul(len).mul(ttBody.mul(ttBody)));
    }
    // Per-instance state, unpacked from anim.w (see packAnim).
    const n0 = floor(anim.w.mul(0.5));
    const hopv = anim.w.sub(n0.mul(2));
    const n1 = floor(n0.mul(0.125)), n2 = floor(n1.mul(0.125)), n3 = floor(n2.mul(0.125)), n4 = floor(n3.mul(0.0625));
    const breath = n0.sub(n1.mul(8)).div(7), throat = n1.sub(n2.mul(8)).div(7), eyeRet = n2.sub(n3.mul(8)).div(7);
    const pose = n3.sub(n4.mul(16)).div(15), calm = n4.div(7);
    // Body wave: a travelling sine along the spine, growing toward the tail (the head keeps `waveHead` of the amplitude).
    // A sideways walker (crab) has no body wave: anim.y is its direction of travel.
    if (skin) { /* (anim.y is the bone row: the bones carry the turn) */ } else if (ts?.inY) tau = anim.y;    // (a frog: no body wave, anim.y is the turning mix)
    else if (!side) {
      let k = float(wave * 3.14159), profile = spineW.mul(spineW).mul(1 - waveHead).add(waveHead);
      if (swimmer) {
        // A swimming newt, salamander or axolotl (`pose`, util/gait.js salamanderSwimPose) undulates its whole body, not just the
        // tail: about one wave along it (wavelength 0.9 of the body, Gillis 1997 for salamanders), the amplitude growing from
        // nothing at the snout (the head stays steady) through the trunk to the tail tip, travelling back (anim.x rises).
        k = k.add(pose.mul(SWIM_WAVE * 3.14159 - wave * 3.14159));
        profile = profile.add(pose.mul(spineW.mul(spineW.mul(0.65).add(0.35)).sub(profile)));
      }
      p.x.addAssign(sin(spineW.mul(k).sub(anim.x)).mul(anim.y).mul(profile));
    }
    // Legs: diagonal pairs (front left + back right) move together. The foot is up while sin(phase) > 0 and swings forward
    // then, so it is on the ground the other half of the cycle, when it moves back relative to the body at a constant speed
    // (util/gait.js footSwing: the same curve, so a foot that is down does not slide when legStride = a quarter of the stride).
    const isFore = abs(leg.sub(1.5)).lessThan(0.6), isHind = abs(leg.sub(3.5)).lessThan(0.6);
    const idIs = (k) => abs(leg.sub(k)).lessThan(0.5);
    const jump = inv ? idIs(11).or(idIs(12)) : null;                    // an insect's jumping hind legs (cricket)
    const isWalk = inv ? isFore.or(isHind).or(jump) : isFore.or(isHind);
    const diag = inv ? idIs(1).or(idIs(4)).or(idIs(11)) : abs(leg.sub(1)).lessThan(0.5).or(abs(leg.sub(4)).lessThan(0.5));
    // (a wave of legs: the left legs, 1, 3 and 11, half a cycle from the right; along the body each leg a little later than the one behind it)
    const lp = inv?.wave ? anim.z.add(idIs(1).or(idIs(3)).or(idIs(11)).select(float(0), float(3.14159))).add(spine.mul(inv.wave))
      : anim.z.add(diag.select(float(0), float(3.14159)));
    const go = float(1).sub(calm);
    const lift = max(sin(lp), 0).mul(legT).mul(legLift).mul(go);
    const u = fract(lp.mul(1 / 6.283185));
    const sn = select(u.lessThan(0.5), cos(u.mul(6.283185)).negate(), float(3).sub(u.mul(4)));
    const swing = sn.mul(legT).mul(legStride).mul(go);
    if (!skin) {
    p.y.addAssign(isWalk.select(lift, float(0)));
    if (side) p.x.addAssign(isWalk.select(swing.mul(sign(anim.y)), float(0)));
    else if (ts) {
      // Walking and turning (util/turn.js footRig): the walk's share of the sweep goes back along the body, the turn's swings the
      // leg round the pivot by the same fraction of the yaw per cycle, so a planted foot stays put while the body turns over it.
      p.z.addAssign(isWalk.select(swing.mul(float(1).sub(abs(tau))), float(0)));
      const al = isWalk.select(sn.mul(legT).mul(go).mul(tau).mul(legStride / ts.R), float(0));
      const ca = cos(al), sa = sin(al), xr = p.x.toVar(), zr = p.z.sub(ts.pz).toVar();
      p.x.assign(xr.mul(ca).add(zr.mul(sa)));
      p.z.assign(zr.mul(ca).sub(xr.mul(sa)).add(ts.pz));
    } else p.z.addAssign(isWalk.select(swing, float(0)));
    const sgn = sign(positionLocal.x);
    const hind = (inv ? jump : isHind).select(float(1), float(0));
    // Hop (or one frog kick): the back legs stretch out behind. (Not a swimming newt's: its legs fold back below.)
    const hopL = swimmer ? hopv.mul(float(1).sub(pose)) : hopv;
    p.z.subAssign(hind.mul(hopL).mul(legT).mul(1.6 * limb));
    p.y.subAssign(hind.mul(hopL).mul(legT).mul(0.4 * limb));
    if (side) {
      // A crab's claws (ids 5, 6): raised and waved while `pose` is up (anim.x is the wave phase).
      const claw = leg.greaterThan(4.5).select(float(1), float(0)).mul(pose).mul(legT);
      const wv = sin(anim.x).mul(0.5).add(0.5);
      p.y.addAssign(claw.mul(wv.mul(0.55).add(0.35)).mul(limb));
      p.x.addAssign(sgn.mul(claw).mul(sin(anim.x.mul(0.5)).mul(0.3)).mul(limb));
      p.z.addAssign(claw.mul(0.25).mul(limb));
    } else if (inv) {
      const act = breath.mul(0.85).add(0.15), beat = throat, feed = eyeRet, spread = pose;
      // Antennae (7 left, 8 right): a slow sweep and dip, out of step with each other, livelier the busier the animal is.
      const antL = idIs(7), ant = antL.or(idIs(8)), sa = antL.select(float(-1), float(1));
      const sweep = sin(anim.x.mul(0.33).add(sa.mul(1.9))).mul(0.8).add(sin(anim.x.mul(0.71).add(sa)).mul(0.3));
      const dip = sin(anim.x.mul(0.27).add(sa.mul(0.8)).add(1.3));
      const ka = legT.mul(act).mul(inv.antenna ?? 1);
      p.x.addAssign(ant.select(ka.mul(sweep), float(0)));
      p.y.addAssign(ant.select(ka.mul(dip).mul(0.6), float(0)));
      // Wings (9): spread out, forward and up from folded over the back, and buzz while they beat.
      const wing = idIs(9).select(legT, float(0));
      const buzz = sin(anim.x.mul(7)).mul(beat);
      p.x.addAssign(sgn.mul(wing).mul(spread.mul(0.9).add(beat.mul(0.35))));
      p.y.addAssign(wing.mul(spread.mul(0.25).add(buzz.mul(0.6))));
      p.z.addAssign(wing.mul(spread.mul(0.35)));
      // Swimmerets (10): paddle in a wave from front to back while the shrimp swims.
      const plp = idIs(10).select(legT, float(0)), pw = sin(anim.x.mul(2.4).add(spine.mul(9)));
      p.z.addAssign(plp.mul(beat).mul(pw));
      p.y.addAssign(plp.mul(beat).mul(pw.mul(0.4).add(0.2)));
      // Pincers (15 left, 16 right): down to the ground and back up to the mouth, one side then the other, while it feeds.
      const chL = idIs(15), ch = chL.or(idIs(16)).select(legT, float(0)), pk = sin(anim.x.mul(0.9).add(chL.select(float(0), float(3.14159))));
      p.y.addAssign(ch.mul(feed).mul(pk.mul(0.5).add(0.1)));
      p.z.subAssign(ch.mul(feed).mul(pk.mul(0.3)));
      p.x.subAssign(sgn.mul(ch).mul(feed).mul(max(pk, 0)).mul(0.3));
      // Eggs (14): a berried shrimp's clutch under the tail; folded to a point inside the abdomen (invert.eggs) unless `spread` is up.
      if (inv.eggs) {
        const eg = idIs(14);
        p.assign(select(eg, vec3(0, inv.eggs.y, inv.eggs.z).add(p.sub(vec3(0, inv.eggs.y, inv.eggs.z)).mul(spread)), p));
      }
      // Furcula (13): the springtail's spring snaps down and back as it jumps.
      const fur = idIs(13).select(legT, float(0));
      p.z.subAssign(fur.mul(hopv)); p.y.subAssign(fur.mul(hopv).mul(0.8));
      if (inv.curl) {
        // Curling under: the body is laid round a circle below its belly, all of it (a ball) or the part behind z0 (a tail flick).
        const { z0, y0, len, flick } = inv.curl;      // (and h: the height of the back, for the lift)
        const c = max(hopv, 0.0015), on = hopv.greaterThan(0.002);
        const Rc = float(flick ? len / Math.PI : len / (2 * Math.PI)).div(c);
        const u = p.z.sub(z0).toVar(), uu = flick ? min(u, float(0)) : u;
        // (rolling, the side edges of the plates come round to the axis, so the sides of the ball close over the legs)
        const sx = min(abs(p.x).div(inv.curl.w ?? 1), float(1));
        const r = (flick ? Rc : Rc.mul(float(1).sub(c.mul(sx.mul(sx)).mul(0.92)))).add(p.y.sub(y0)).toVar(), phi = uu.div(Rc).toVar();
        // (a ball is lifted so its lowest point stays on the ground: the ends of a half-curled body touch down, the middle rises)
        const ce = cos(c.mul(Math.PI)), lift = flick ? float(0) : Rc.mul(float(1).sub(ce)).add(max(ce.negate(), float(0)).mul(inv.curl.h ?? 0));
        const zN = r.mul(sin(phi)).add(z0).add(flick ? max(u, float(0)) : float(0)), yN = r.mul(cos(phi)).add(y0).sub(Rc).add(lift);
        // a ball closes at the sides: the flanks fold in toward the belly as it rolls (a ring would leave a hole down the middle)
        const pinch = flick ? float(1) : float(1).sub(c.mul(0.2).mul(float(1).sub(min(max(p.y.sub(y0).div(inv.curl.h ?? 0.1), float(0)), float(1)))));
        p.x.assign(select(on, p.x.mul(pinch), p.x));
        p.z.assign(select(on, zN, p.z)); p.y.assign(select(on, yN, p.y));
        vCurl.assign(select(on, phi, float(0)));
      }
    } else if (swimmer) {
      // A swimming newt, salamander or axolotl (pose): the legs swing back about their roots and lie along the flanks, the feet
      // raised from the ground to the flank's height (a rotation about the vertical through the shoulder or hip, which keeps the
      // leg's length: the out-sideways reach from the body's side, `dx`, becomes reach backwards). Fore 75, hind 85 degrees.
      const rx = rig2.len * 0.055, ry = rig2.neckY * 0.8;
      const dx = max(abs(positionLocal.x).sub(rx), float(0));
      const th = isFore.select(float(1.31), isHind.select(float(1.48), float(0))).mul(pose);
      p.x.subAssign(sgn.mul(dx).mul(float(1).sub(cos(th))));
      p.z.subAssign(dx.mul(sin(th)));
      p.y.addAssign(isWalk.select(float(ry).sub(positionLocal.y).mul(min(legT.mul(2), float(1))).mul(pose).mul(0.85), float(0)));
    } else {
      // Swimming (pose): the breaststroke splays the feet as the legs extend (largest halfway) and closes them at full
      // extension; the forelegs sweep back, up and in along the flanks.
      const kick = hopv.mul(float(1).sub(hopv)).mul(4 * 0.55 * limb).sub(hopv.mul(hopv).mul(0.35 * limb));
      p.x.addAssign(sgn.mul(hind).mul(legT).mul(pose).mul(kick));
      const fore = isFore.select(float(1), float(0)).mul(pose).mul(legT);
      p.z.subAssign(fore.mul(0.25 * limb));
      p.y.addAssign(fore.mul(0.6 * limb));
      p.x.addAssign(sgn.mul(fore).mul(1.4 * limb));
    }
    }
    // Breathing: the flanks swell and sink; throat: the underside of the head bulges (to 0.32 cm: a calling frog's vocal sac; the
    // everyday throat pumping uses about 0.6 of that, util/gait.js callSac and Animals.vis); eyes sink into the head.
    const flank = sin(min(max(spine.sub(0.15).mul(2), float(0)), float(1)).mul(3.14159));
    if (!inv) {
      const k = breath.mul(0.045).mul(flank).mul(isWalk.select(float(0), float(1)));
      p.x.addAssign(p.x.mul(k)); p.y.addAssign(p.y.mul(k));
      const head = max(float(1).sub(spine.mul(3.3)), float(0));
      const under = min(max(normalLocal.y.mul(-1.6), float(0)), float(1));
      p.addAssign(normalLocal.mul(throat.mul(0.32).mul(head).mul(under).mul(isWalk.select(float(0), float(1)))));
      p.y.subAssign(abs(matId.sub(1)).lessThan(0.5).select(eyeRet.mul(0.22), float(0)));
    }
    // Membranes (fins, gills, tail fringes) ripple along the normal.
    const isFin = abs(matId.sub(2)).lessThan(0.5);
    p.addAssign(normalLocal.mul(sin(anim.x.mul(1.7).add(positionLocal.z.mul(4)).add(positionLocal.y.mul(3))).mul(flutter).mul(isFin.select(float(1), float(0)))));
    if (skin) {
      const sv = skinVertex(p, normalLocal);
      vSkinN.assign(sv.nrm);
      return qrot(q, sv.pos.mul(iPos.w)).add(iPos.xyz);
    }
    return qrot(q, p.mul(iPos.w)).add(iPos.xyz);
  })();
  // A curled body turns its normals with it (about x, by the angle at the vertex), or a rolled isopod is lit as if still flat.
  const curl = (v) => (vCurl ? vec3(v.x, v.y.mul(cos(vCurl)).sub(v.z.mul(sin(vCurl))), v.z.mul(cos(vCurl)).add(v.y.mul(sin(vCurl)))) : v);
  m.normalNode = transformNormalToView(qrot(q, curl(n)));
  // The clear coat gets the turned normal too: left alone, three.js lights it with the mesh's own normal in the model's unturned
  // frame, so on any animal not facing the default way the coat's highlights, reflections and Fresnel rim sat in the wrong places
  // (lit where the skin faced away: the chrome streaks and grazing glow on frogs).
  m.clearcoatNormalNode = transformNormalToView(qrot(q, curl(nCoat)));
  // A swimming frog's webbing (finish.webFold, tools/bake-frogpose.mjs): spread as the legs drive and trail, folded away along the
  // toes as they are drawn up (the toes close then): faded out with the hind legs' extension, the hop the stroke hands the rig.
  if (finish.webFold && pass === 'blend') {
    const hopIn = anim.w.sub(floor(anim.w.mul(0.5)).mul(2));
    m.opacityNode = m.opacityNode.mul(select(abs(matId.sub(2)).lessThan(0.5), varying(smoothstep(0.15, 0.4, hopIn)), float(1)));
  }
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
    // A scanned vertebrate with a baked skeleton (glb.js: the fine mesh's userData.skeleton and its `skin` binding): near instances
    // are drawn by their bones (skin.js), made now so its shader builds with the species' others while the tank loads.
    const hg = opts.hiGeometry;
    if (hg?.userData?.skeleton && hg.attributes.skin) {
      const sm = new CreatureMesh(this.scene, skinGeometry(hg), { ...opts, finish: this._lo.finish, skin: hg.userData.skeleton });
      if (sm.skinRig) this.skinned = sm; else sm.dispose();
    }
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

  begin() { this._lo?.begin(); this.hi?.begin(); this.skinned?.begin(); }
  // `d2` is the squared distance from the camera to the animal.
  // b0 … b3, c0 … c4: the second and third channels (finish.rig2: head yaw, head pitch, body bend, tail swing; tail length, skin dullness,
  // tail piece, tail lift, turning mix).
  // st: a swimming body's stroke (CreatureMesh.put).
  put(pos, quat, scale, a0, a1, a2, a3, d2 = 1e9, b0 = 0, b1 = 0, b2 = 0, b3 = 0, c0 = 1, c1 = 0, c2 = 0, c3 = 0, c4 = 0, st = null) {
    const lo = this._lo;
    if (!lo) return;
    const sk = this.skinned, stroke = !!sk?.skinRig?.stroke;
    // (a swimming body is drawn by its stroke at any distance: without its bones it is a frozen pose sliding through the water)
    if (stroke && SKIN.swim && sk.n < sk.skinCap) { sk.put(pos, quat, scale, a0, a1, a2, a3, b0, b1, b2, b3, c0, c1, c2, c3, c4, st); return; }
    if (d2 < this.near2) {
      if (sk && !stroke && SKIN.on && sk.n < sk.skinCap) { sk.put(pos, quat, scale, a0, a1, a2, a3, b0, b1, b2, b3, c0, c1, c2, c3, c4, st); return; }
      if (this.hi) { this.hi.put(pos, quat, scale, a0, a1, a2, a3, b0, b1, b2, b3, c0, c1, c2, c3, c4); return; }
      this.wants = true;
    }
    lo.put(pos, quat, scale, a0, a1, a2, a3, b0, b1, b2, b3, c0, c1, c2, c3, c4);
  }
  end() { this._lo?.end(); this.hi?.end(); this.skinned?.end(); }
  get mesh() { return this._lo?.mesh; }
  // a swimming body that is drawn by its stroke (a skeleton with `bind: 'swim'`, and bones allowed): it can be posed as a leap too
  get strokes() { return !!this.skinned?.skinRig?.stroke && SKIN.swim; }
  // Takes the meshes out of the scene without freeing the (shared) geometry; anything still in flight is dropped.
  remove() { this.removed = true; this._lo?.mesh.removeFromParent(); this.hi?.mesh.removeFromParent(); this.skinned?.mesh.removeFromParent(); this.skinned?.releaseSkin(); }
  dispose() { this.removed = true; this._lo?.dispose(); this.hi?.dispose(); this.skinned?.dispose(); }
}
