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
import { SPECIES, createSpeciesMesh } from '../sim/animals.js';
import { U } from '../render/uniforms.js';
import { loadManifest, loadCreatureGLB } from '../render/creatures/glb.js';
import { CreatureLOD } from '../render/creatures/instanced.js';
import { FINISH } from '../render/creatures/material.js';
import { BODIES } from '../render/creatures/bodies/index.js';
import { packAnim } from '../render/creatures/instanced.js';
import { frogSwimPose, salamanderSwimPose, hopLegs, TAU } from '../util/gait.js';

const q = new URLSearchParams(location.search);
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
  return new CreatureLOD(scene, src, { cap: 4, wave: a.wave ?? 1, legLift: a.lift ?? 0.25, legStride: a.stride ?? 0.35, finish: { ...FINISH[group], ...(src.finish ?? {}), ...(a.rig2 ? { rig2: a.rig2 } : {}) }, near: 34 + sp.size * 10 });
}
let lod = makeLod();
if (q.get('src') === 'glb') {
  const man = await loadManifest();
  const key = q.has('body') ? `${id}.${q.get('body')}` : id;      // &body=swim: a pose model ('<species>.swim' in the manifest)
  const g = man[key] && await loadCreatureGLB(key, { legs: !q.has('body') && ['frog', 'toad', 'newt', 'axolotl', 'gecko', 'crab'].includes(sp.kind), ...man[key] });
  if (g) {
    lod.lo.mesh.removeFromParent();
    const group = sp.group === 'Fish' ? 'fish' : sp.group === 'Amphibians' ? 'amphibian' : sp.group === 'Reptiles' ? 'reptile' : 'invert';
    lod = new CreatureLOD(scene, g.lo, { cap: 4, wave: sp.anim?.wave ?? 1, legLift: sp.anim?.lift ?? 0.25, legStride: sp.anim?.stride ?? 0.35, legAxis: sp.anim?.legAxis ?? 'z', limb: sp.anim?.limb ?? 1, finish: { ...FINISH[group], bump: 0, tone: 0.02, grain: 1, ...(man[key].finish ?? {}), ...(sp.anim?.rig2 ? { rig2: sp.anim.rig2 } : {}) }, near: 1e6, hiGeometry: g.hi === g.lo ? null : g.hi, textures: g.textures });
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
const R = ext * 2.5;                      // framing distance from the mesh's real size
const center = bb.getCenter(new THREE.Vector3());
const VIEWS = {
  front: [0, 0.15, 1], side: [1, 0.12, 0], back: [0, 0.2, -1], top: [0.001, 1, 0.05], three: [0.75, 0.42, 0.8], low: [0.6, -0.35, 0.7],
  closeup: [0.55, 0.22, 0.85],
};
function setView(name) {
  const v = new THREE.Vector3(...(VIEWS[name] ?? VIEWS.three)).normalize();
  const r = name === 'closeup' ? R * 0.55 : R;
  cam.position.copy(center).addScaledVector(v, r);
  cam.lookAt(center);
  if (name === 'closeup') { const h = new THREE.Vector3(0, 0, ext * 0.28); cam.lookAt(center.clone().add(h)); }
  cam.updateProjectionMatrix();
}
let animOn = q.get('anim') === '1', t0 = performance.now();
const quat = new THREE.Quaternion(), euler = new THREE.Euler(0, 0, 0, 'YXZ');
// The animal's state as the game would hand it to the rig: pose (hop, pose, calm …) plus body angles and height.
const state = { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0, phase: 0, amp: 0, gait: 0, hop: 0, breath: 0, throat: 0, eye: 0, pose: 0, calm: 1, hy: 0, hp: 0, bend: 0, tail: 0, tf: 1, dull: 0, piece: 0 };   // hy hp bend tail: the rig2 channel; tf dull piece: iAnim3 (tail length, skin dullness, tail piece)
// Named poses at phase t (0 … 1). `swim` is a frog kick (or a salamander's glide for kinds that undulate), `walk` a leg cycle.
const POSES = {
  stand: () => ({ calm: 1 }),
  swim: (t) => (sp.kind === 'frog' || sp.kind === 'toad'
    ? { ...frogSwimPose(t, { level: sp.anim?.level ?? 0.28 }), phase: 0, amp: 0, gait: 0 }
    : { ...salamanderSwimPose(0.6), amp: (sp.anim?.amp ?? 0.6) * 2.5, phase: -t * TAU, gait: 0 }),
  walk: (t) => ({ calm: 0, gait: t * TAU, phase: t * TAU, amp: (sp.anim?.amp ?? 0), hop: 0, pose: 0, hy: sp.anim?.rig2 ? 0.2 * Math.sin(t * TAU + 1) : 0 }),       // (hy: the head swings against the body wave, as Animals.draw does)
  hop: (t) => ({ calm: 1, hop: hopLegs(t), pose: 0, gait: 0, y: 4 * 1.2 * t * (1 - t), pitch: -0.35 * Math.cos(Math.PI * t) }),   // the game's leg timing (util/gait.js hopLegs) on a 1.2 cm arc
  claw: (t) => ({ calm: 1, pose: 1, phase: t * TAU * 3, gait: 0 }),
  // rig2: head sweeps (yaw over a cycle), head up/down, a C-curve, a tail swing
  look: (t) => ({ calm: 1, hy: 0.55 * Math.sin(t * TAU), hp: 0 }),
  nod: (t) => ({ calm: 1, hp: 0.5 * Math.sin(t * TAU) }),
  arch: (t) => ({ calm: 1, bend: 0.5 * Math.sin(t * TAU), tail: 0 }),
  tailwave: (t) => ({ calm: 1, tail: 0.18 * Math.sin(t * TAU) }),
  stump: (t) => ({ calm: 1, tf: 0.1 + 0.9 * (1 - t) }),                 // the tail cut short, growing back (t = 0: a stump, 1: whole)
  piece: (t) => ({ calm: 1, piece: 0.55, tail: 0.26 * Math.sin(t * TAU * 2) }),   // the dropped tail alone, thrashing
  dull: (t) => ({ calm: 1, dull: 0.85 * t }),                         // the skin going milky before a shed
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
  else lod.put(pos, quat, scale, state.phase, state.amp, state.gait, packed, 0, state.hy, state.hp, state.bend, state.tail, state.tf, state.dull, state.piece, 0);
  lod.end();
  renderer.render(scene, cam);
}
window.bench = {
  id: fullId, setView, setLod, frame, verts: () => ({ lo: lod.lo.geometry.attributes.position.count, hi: lod.hi?.geometry.attributes.position.count ?? 0 }),
  water: (on) => { U.waterLevel.value = on ? 1000 : -1000; },
  anim: (on) => { animOn = on; },
  state, setState: (o) => { Object.assign(state, o); animOn = false; },
  pose: (name, t = 0, extra = {}) => { Object.assign(state, { hop: 0, pose: 0, calm: 1, amp: 0, gait: 0, phase: 0, pitch: 0, roll: 0, y: 0, hy: 0, hp: 0, bend: 0, tail: 0, tf: 1, dull: 0, piece: 0 }, POSES[name]?.(t) ?? {}, extra); animOn = false; },
  ready: true,
};
setView(q.get('view') ?? 'three');
await setLod(q.get('lod') ?? 'lo');
const v = window.bench.verts();
info.textContent = `${sp.name}  [${fullId}]  lo ${v.lo} verts${v.hi ? `, hi ${v.hi}` : ''}`;
renderer.setAnimationLoop(frame);
