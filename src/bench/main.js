// Creature bench: one species, lit like the tank, seen from any angle.
//   /bench.html?sp=dartfrog&view=front|side|back|top|three|low|closeup&lod=lo|hi&water=0|1&size=640&anim=0|1
//   &wl=<cm>    a water surface at that height (the animal is tinted below it, a pane marks the surface)
//   window.bench.pose('swim'|'walk'|'hop'|'stand'|'claw', t) puts the animal in that pose at phase t (0 … 1), the same
//   rig inputs the game computes (util/gait.js); bench.setState({...}) sets any of them by hand.
//   sp may name a genetic morph: sp=axolotl:golden (BODIES['axolotl:golden'], see bodies/index.js).
//   &src=glb&body=swim   the species' pose model instead of its sitting body (manifest key '<species>.swim', made by tools/bake-frogpose.mjs).
// window.bench.setView(name) etc. drive it from tools/bench.mjs, which builds contact sheets.
import * as THREE from 'three/webgpu';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { SPECIES, createSpeciesMesh, paletteFinish, turnRigFinish } from '../sim/animals.js';
import { PLANS, planOf } from '../util/bodyplan.js';
import { pivotShift } from '../util/turn.js';
import { U } from '../render/uniforms.js';
import { loadManifest, loadCreatureGLB } from '../render/creatures/glb.js';
import { guppyModel } from '../render/creatures/guppymodel.js';
import { CreatureLOD } from '../render/creatures/instanced.js';
import { SKIN } from '../render/creatures/skin.js';
import { FINISH } from '../render/creatures/material.js';
import { BODIES } from '../render/creatures/bodies/index.js';
import { packAnim } from '../render/creatures/instanced.js';
import { frogSwimPose, salamanderSwimPose, hopLegs, swimPose, TAU, leapPose, HIND, FORE } from '../util/gait.js';
import { hopPlan, hopFrame, svlOf } from '../util/hop.js';
import { swimProfile } from '../util/bodyplan.js';
import { strikeGape } from '../util/lizardgait.js';
import { FROG_LUNGE, lungePose } from '../util/frogstrike.js';

const q = new URLSearchParams(location.search);
if (q.has('noskin')) SKIN.on = SKIN.swim = false;              // (the near mesh drawn by the vertex rig, as before runtime skinning)
const fullId = q.get('sp') ?? 'dartfrog';
const [id, morph] = fullId.split(':');      // species id and optional morph id
const size = +(q.get('size') ?? 640);
const info = document.getElementById('info');

const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL: q.has('webgl') });
renderer.setPixelRatio(1);
renderer.setSize(size, size);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
document.getElementById('c').appendChild(renderer.domElement);
renderer.domElement.style.width = size + 'px'; renderer.domElement.style.height = size + 'px';
await renderer.init();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0e10);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.28;
// The tank's lighting: an LED overhead, a cool fill, a dim warm bounce from the front.
const led = new THREE.DirectionalLight(0xf4f7ff, 3.4);
led.position.set(8, 120, 30); led.castShadow = true;
led.shadow.mapSize.set(2048, 2048);
Object.assign(led.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 60, far: 200 });
led.shadow.camera.updateProjectionMatrix();
scene.add(led, led.target);
scene.add(new THREE.HemisphereLight(0xdfeeff, 0x1a1510, 0.5));
const fill = new THREE.DirectionalLight(0xffe2c0, 0.7); fill.position.set(-30, 20, 60); scene.add(fill);

const wl = q.has('wl') ? +q.get('wl') : null;
const wet = q.get('water') === '1';
U.waterLevel.value = wl !== null ? wl : wet ? 1000 : -1000;
U.daylight.value = 1;

const sp = SPECIES[id];
let hiReady = false;
const swimmer = sp.kind === 'swim' || sp.kind === 'crawlWater';
function makeLod() {
  if (!morph) return createSpeciesMesh(scene, id, { cap: 4 });
  const make = BODIES[`${id}:${morph}`];
  if (!make) throw new Error(`no body registered for ${id}:${morph}`);
  const src = make();
  const group = sp.group === 'Fish' ? 'fish' : sp.group === 'Amphibians' ? 'amphibian' : sp.group === 'Reptiles' ? 'reptile' : 'invert';
  const a = sp.anim ?? {};
  return new CreatureLOD(scene, src, { cap: 4, wave: a.wave ?? 1, legLift: a.lift ?? 0.25, legStride: a.stride ?? 0.35, finish: { ...FINISH[group], ...(src.finish ?? {}), ...(a.rig2 ? { rig2: a.rig2 } : {}), ...turnRigFinish(sp) }, near: 34 + sp.size * 10 });
}
let lod = makeLod();
if (q.get('src') === 'glb') {
  const man = await loadManifest();
  const key = q.has('body') ? `${id}.${q.get('body')}` : morph && man[`${id}:${morph}`] ? `${id}:${morph}` : id;      // &body=swim: a pose model ('<species>.swim' in the manifest)
  const pal = man[key]?.palette ? { palette: paletteFinish(morph ?? man[key].paletteMorph ?? 'red', man[key]) } : {};   // a palette model coloured as the line
  // (a guppy look: the owner's male or female model with the look's painted texture, as the game draws it)
  const gup = id === 'guppy' && man.guppy?.guppy && morph ? await guppyModel(morph, man.guppy) : null;
  const g = gup ?? (man[key] && await loadCreatureGLB(key, { legs: !q.has('body') && ['frog', 'toad', 'newt', 'axolotl', 'gecko', 'crab'].includes(sp.kind), ...man[key] }));
  if (gup) man[key] = { ...man.guppy, finish: { ...man.guppy.finish, ...gup.finish } };
  if (g) {
    lod.lo.mesh.removeFromParent();
    const group = sp.group === 'Fish' ? 'fish' : sp.group === 'Amphibians' ? 'amphibian' : sp.group === 'Reptiles' ? 'reptile' : 'invert';
    lod = new CreatureLOD(scene, g.lo, { cap: 4, wave: sp.anim?.wave ?? 1, legLift: sp.anim?.lift ?? 0.25, legStride: sp.anim?.stride ?? 0.35, legAxis: sp.anim?.legAxis ?? 'z', limb: sp.anim?.limb ?? 1, finish: { ...FINISH[group], bump: 0, tone: 0.02, grain: 1, ...(man[key].finish ?? {}), ...pal, ...(sp.anim?.rig2 ? { rig2: sp.anim.rig2 } : {}), ...(q.has('body') ? {} : turnRigFinish(sp)) }, near: 1e6, hiGeometry: g.hi === g.lo ? null : g.hi, textures: g.textures });
    hiReady = true;
  } else console.warn('no GLB for', key);
}
async function setLod(name) {
  if (name === 'hi' && !hiReady) { lod.refine(true); hiReady = true; }
  lod.near2 = name === 'hi' ? 1e12 : 0;
}
const ground = new THREE.Mesh(new THREE.CircleGeometry(30, 48), new THREE.MeshStandardNodeMaterial({ color: 0x2a2a26, roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; ground.receiveShadow = true;
if (!swimmer) scene.add(ground);

if (wl !== null) {
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshBasicNodeMaterial({ color: 0x3f8fb0, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }));
  pane.rotation.x = -Math.PI / 2; pane.position.y = wl; pane.renderOrder = 5;
  scene.add(pane);
}
const cam = new THREE.PerspectiveCamera(28, 1, 0.1, 500);
lod.lo.geometry.computeBoundingBox();
const bb = lod.lo.geometry.boundingBox.clone();
const ext = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z);
const R = ext * 2.5 * +(q.get('zoom') ?? 1);          // framing distance from the mesh's real size (&zoom=1.4: further off)
const center = bb.getCenter(new THREE.Vector3());
center.z -= ext * +(q.get('back') ?? 0);           // (&back=0.2: look at a point further back, for legs stretched out behind)
const VIEWS = {
  front: [0, 0.15, 1], side: [1, 0.12, 0], back: [0, 0.2, -1], top: [0.001, 1, 0.05], three: [0.75, 0.42, 0.8], low: [0.6, -0.35, 0.7],
  closeup: [0.55, 0.22, 0.85], head: [0.9, 0.12, 0.55], headfront: [0.35, 0.1, 1],     // (head: the animal's head from the side, front a little; for the mouth)
};
function setView(name) {
  const v = new THREE.Vector3(...(VIEWS[name] ?? VIEWS.three)).normalize();
  const r = name === 'closeup' ? R * 0.55 : name === 'head' || name === 'headfront' ? R * 0.22 : R;
  cam.position.copy(center).addScaledVector(v, r);
  cam.lookAt(center);
  if (name === 'closeup') { const h = new THREE.Vector3(0, 0, ext * 0.28); cam.lookAt(center.clone().add(h)); }
  if (name === 'head' || name === 'headfront') { cam.position.add(new THREE.Vector3(0, 0, ext * 0.4)); cam.lookAt(center.clone().add(new THREE.Vector3(0, 0, ext * 0.4))); }
  cam.updateProjectionMatrix();
}
let animOn = q.get('anim') === '1', t0 = performance.now();
const quat = new THREE.Quaternion(), euler = new THREE.Euler(0, 0, 0, 'YXZ');
// The animal's state as the game would hand it to the rig: pose (hop, pose, calm …) plus body angles and height.
const state = { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0, phase: 0, amp: 0, gait: 0, hop: 0, breath: 0, throat: 0, eye: 0, pose: 0, calm: 1, hy: 0, hp: 0, bend: 0, tail: 0, tf: 1, dull: 0, piece: 0, turn: 0, gape: 0, stroke: null };   // turn: the legs' turning mix (util/turn.js); hy hp bend tail: the rig2 channel; tf dull piece: iAnim3 (tail length, skin dullness, tail piece)
// Named poses at phase t (0 … 1). `swim` is a frog kick (or a salamander's glide for kinds that undulate), `walk` a leg cycle.
const POSES = {
  stand: () => ({ calm: 1 }),
  // (&body=swim: the swimming body through the game's stroke, util/gait.js swimPose; extra { alt, steer, fl } for pottering, a turn, floating)
  swim: (t, x = {}) => (q.get('body') === 'swim'
    ? (() => { const w = swimPose({ phase: t, alt: x.alt ?? 0, steer: x.steer ?? 0, fl: x.fl ?? 0 }, swimProfile(id), { level: 0, t: t * 2 }); return { hop: w.hop * 0.5, pose: 0, calm: 1, pitch: w.pitch, roll: w.roll, yaw: w.yaw, stroke: w.stroke, phase: 0, amp: 0, gait: 0 }; })()
    : sp.kind === 'frog' || sp.kind === 'toad'
    ? { ...frogSwimPose(t, { level: sp.anim?.level ?? 0.28 }), phase: 0, amp: 0, gait: 0 }
    : { ...salamanderSwimPose(0.6), amp: (sp.anim?.amp ?? 0.6) * 1.0, phase: t * TAU, gait: 0 }),     // (as the game: amp x (0.6 + 0.6 x 0.6), the wave travelling back)
  walk: (t) => ({ calm: 0, gait: t * TAU, phase: t * TAU, amp: (sp.anim?.amp ?? 0), hop: 0, pose: 0, hy: sp.anim?.rig2 ? 0.2 * Math.sin(t * TAU + 1) : 0 }),       // (hy: the head swings against the body wave, as Animals.draw does)
  hop: (t) => ({ calm: 1, hop: hopLegs(t), pose: 0, gait: 0, y: 4 * 1.2 * t * (1 - t), pitch: -0.35 * Math.cos(Math.PI * t) }),
  // (&body=swim: the leap as a frog near the camera is drawn mid-hop, sim/animals.js leapMesh: the swimming body posed by util/gait.js
  // leapStroke, its body pitched as the game pitches it along the arc)
  // (&body=swim; extra { d: hop cm, lead: 0 … 1, lag: 0 … 1 }: the hop as the game makes it since 5 Oct, util/hop.js and leapPose,
  // the toes planted through the launch: the body placed and pitched by hopFrame about its hips)
  leap: (t, x = {}) => {
    const hop = { d: x.d ?? 3, rise: 0 }, rig = lod.skinned?.skinRig, L = rig?.byName.thighL, R = rig?.byName.thighR;
    const pv = rig && L != null && R != null ? rig.head[L].map((v, i) => (v + rig.head[R][i]) / 2) : null;
    hop.plan = hopPlan(hop, svlOf(sp.size, 1), [x.lead ?? 0.8, x.lag ?? 0.7]);
    const f = hopFrame(t, hop, sp.size, 1, pv), st = leapPose(hop.plan, f.at);
    st.frames = { f0: hopFrame(0, hop, sp.size, 1, pv), ft: f };
    return { calm: 1, hop: 0, pose: 0, gait: 0, x: f.pos[0], y: f.pos[1], z: f.pos[2] - hop.d / 2, pitch: f.pitch, roll: f.roll, stroke: st };
  },   // the game's leg timing (util/gait.js hopLegs) on a 1.2 cm arc
  claw: (t) => ({ calm: 1, pose: 1, phase: t * TAU * 3, gait: 0 }),
  feed: (t, x) => ({ calm: 1, pose: 0, eye: 1, phase: t * TAU * 2, gait: 0, ...x }),                      // the feeding cycle: both claws, one cycle over t 0 … 1 (phase 4 pi: a claw's cycle is half the clock)
  pinch: (t, x) => ({ calm: 1, pose: 0, throat: x.open ?? 1, phase: t * TAU, gait: 0 }),
  // (&body=swim, a one-body frog: the common frog) sitting in its own body (the stroke's sit) and striking with its own jaw, hyoid and tongue bones: the strip is the
  // strike's timeline (util/frogstrike.js), drawn as the game draws a one-body frog on land (sim/animals.js oneMesh)
  // (a one-body frog sitting, then striking with its lunge: util/frogstrike.js lungePose at the tools' default dip and slide)
  fstrike: (t) => { const st = lungePose(sp.sit, t, FROG_LUNGE.dipDeg, FROG_LUNGE.slideCm, HIND, FORE, {}), R = st.root;
    return { calm: 1, hop: 0, pose: 0, gait: 0, pitch: R.pitch, y: R.off[1], z: R.off[2], stroke: st }; },
  // the mouth through a tongue strike (util/lizardgait.js strikeGape): aim 0-0.4 of the strip, out 0.4-0.6, back 0.6-0.85, then shut
  strike: (t) => ({ calm: 1, gape: t < 0.4 ? strikeGape('aim', (t / 0.4) * 0.3, 0.3) : t < 0.6 ? strikeGape('out', ((t - 0.4) / 0.2) * 0.075, 0.075) : t < 0.85 ? strikeGape('back', ((t - 0.6) / 0.25) * 0.09, 0.09) : 0 }),
  // rig2: head sweeps (yaw over a cycle), head up/down, a C-curve, a tail swing
  look: (t) => ({ calm: 1, hy: 0.55 * Math.sin(t * TAU), hp: 0 }),
  nod: (t) => ({ calm: 1, hp: 0.5 * Math.sin(t * TAU) }),
  arch: (t) => ({ calm: 1, bend: 0.5 * Math.sin(t * TAU), tail: 0 }),
  tailwave: (t) => ({ calm: 1, tail: 0.18 * Math.sin(t * TAU) }),
  stump: (t) => ({ calm: 1, tf: 0.1 + 0.9 * (1 - t) }),                 // the tail cut short, growing back (t = 0: a stump, 1: whole)
  piece: (t) => ({ calm: 1, piece: 0.55, tail: 0.26 * Math.sin(t * TAU * 2) }),   // the dropped tail alone, thrashing
  dull: (t) => ({ calm: 1, dull: 0.85 * t }),                         // the skin going milky before a shed
  // A turn on the spot toward +x over one leg cycle, as the game draws it (util/turn.js, Animals.turnTo / turnPoseStep): the body
  // pivots about the hips (which stay put), the feet swing round the pivot so the planted ones stay where they are, the spine bends
  // into the turn and the head leads, at the species' fastest turn.
  turn: (t) => {
    const ts = lod._lo?.finish?.turnSweep, P = PLANS[planOf(sp)], stride = sp.anim?.stride ?? 0.35;
    if (!ts) return { calm: 0, gait: t * TAU };
    const yaw = t * (4 * stride) / ts.R, [dx, dz] = pivotShift(0, yaw, ts.pz, sp.scale ?? 1);
    return { calm: 0, gait: t * TAU, turn: 1, yaw, x: dx, z: dz, hy: P.turn.head * P.rig.head, bend: P.turn.bend * P.rig.bend, tail: P.turn.tail * P.rig.tail };
  },
};
function frame() {
  const t = (performance.now() - t0) / 1000;
  const a = sp.anim ?? {};
  lod.begin();
  const scale = sp.scale ?? 1;
  euler.set(state.pitch, state.yaw, state.roll);
  quat.setFromEuler(euler);
  const pos = new THREE.Vector3(state.x, state.y, state.z);
  const packed = packAnim(state.hop, state.breath, state.throat, state.eye, state.pose, state.calm);
  if (animOn) lod.put(pos, quat, scale, t * 8, a.amp ?? 0, t * 6, 0, 0);
  else lod.put(pos, quat, scale, state.phase, lod._lo?.finish?.turnSweep?.inY ? state.turn : state.amp, state.gait, packed, 0, state.hy, state.hp, state.bend, state.tail, state.tf, state.dull, state.piece, 0, state.turn, state.stroke ?? (state.gape ? { gape: state.gape } : null));
  lod.end();
  renderer.render(scene, cam);
}
window.bench = {
  id: fullId, setView, setLod, frame,
  bodyLen: () => bb.max.z - bb.min.z + 0,            // the drawn body's length (cm): the swimming body's snout to its toes as scanned
  // a camera by hand: eye and target in cm (the animal at the origin, head +z), the image's up direction, the lens
  cam: (eye, target, up = [0, 1, 0], fov = 28) => { cam.fov = fov; cam.up.set(...up); cam.position.set(...eye); cam.lookAt(...target); cam.updateProjectionMatrix(); }, verts: () => ({ lo: lod.lo.geometry.attributes.position.count, hi: lod.hi?.geometry.attributes.position.count ?? 0 }),
  water: (on) => { U.waterLevel.value = on ? 1000 : -1000; },
  anim: (on) => { animOn = on; },
  state, setState: (o) => { Object.assign(state, o); animOn = false; },
  pose: (name, t = 0, extra = {}) => { Object.assign(state, { hop: 0, breath: 0, throat: 0, eye: 0, pose: 0, calm: 1, amp: 0, gait: 0, phase: 0, pitch: 0, roll: 0, y: 0, x: 0, z: 0, yaw: 0, hy: 0, hp: 0, bend: 0, tail: 0, tf: 1, dull: 0, piece: 0, turn: 0, gape: 0, stroke: null }, POSES[name]?.(t, extra) ?? {}, extra); animOn = false; },
  ready: true,
};
setView(q.get('view') ?? 'three');
await setLod(q.get('lod') ?? 'lo');
const v = window.bench.verts();
info.textContent = `${sp.name}  [${fullId}]  lo ${v.lo} verts${v.hi ? `, hi ${v.hi}` : ''}`;
// ?proto=skin|rig: the skinning prototype (bench/skinproto.js, measured by tools/skin-proto.mjs) instead of the one-animal bench.
if (q.has('proto')) await (await import('./skinproto.js')).start({ renderer, scene, cam, lod, sp, q, info });
else renderer.setAnimationLoop(frame);
