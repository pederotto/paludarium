// Creature bench: one species, lit like the tank, seen from any angle.
//   /bench.html?sp=dartfrog&view=front|side|back|top|three|low|closeup&lod=lo|hi&water=0|1&size=640&anim=0|1
//   sp may name a genetic morph: sp=axolotl:golden (BODIES['axolotl:golden'], see bodies/index.js).
// window.bench.setView(name) etc. drive it from tools/bench.mjs, which builds contact sheets.
import * as THREE from 'three/webgpu';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { SPECIES, createSpeciesMesh } from '../sim/animals.js';
import { U } from '../render/uniforms.js';
import { loadManifest, loadCreatureGLB } from '../render/creatures/glb.js';
import { CreatureLOD } from '../render/creatures/instanced.js';
import { FINISH } from '../render/creatures/material.js';
import { BODIES } from '../render/creatures/bodies/index.js';

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

const wet = q.get('water') === '1';
U.waterLevel.value = wet ? 1000 : -1000;
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
  return new CreatureLOD(scene, src, { cap: 4, wave: a.wave ?? 1, legLift: a.lift ?? 0.25, legStride: a.stride ?? 0.35, finish: { ...FINISH[group], ...(src.finish ?? {}) }, near: 34 + sp.size * 10 });
}
let lod = makeLod();
if (q.get('src') === 'glb') {
  const man = await loadManifest();
  const g = man[id] && await loadCreatureGLB(id, { legs: ['frog', 'toad', 'newt', 'axolotl', 'gecko', 'crab'].includes(sp.kind), ...man[id] });
  if (g) {
    lod.lo.mesh.removeFromParent();
    const group = sp.group === 'Fish' ? 'fish' : sp.group === 'Amphibians' ? 'amphibian' : sp.group === 'Reptiles' ? 'reptile' : 'invert';
    lod = new CreatureLOD(scene, g.lo, { cap: 4, wave: sp.anim?.wave ?? 1, legLift: sp.anim?.lift ?? 0.25, legStride: sp.anim?.stride ?? 0.35, finish: { ...FINISH[group], bump: 0, tone: 0.02, grain: 1, ...(man[id].finish ?? {}) }, near: 1e6, hiGeometry: g.hi === g.lo ? null : g.hi, textures: g.textures });
    hiReady = true;
  } else console.warn('no GLB for', id);
}
async function setLod(name) {
  if (name === 'hi' && !hiReady) { lod.refine(); hiReady = true; }
  lod.near2 = name === 'hi' ? 1e12 : 0;
}
const ground = new THREE.Mesh(new THREE.CircleGeometry(30, 48), new THREE.MeshStandardNodeMaterial({ color: 0x2a2a26, roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; ground.receiveShadow = true;
if (!swimmer) scene.add(ground);

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
const quat = new THREE.Quaternion();
function frame() {
  const t = (performance.now() - t0) / 1000;
  const a = sp.anim ?? {};
  lod.begin();
  const y = swimmer ? 0 : 0;
  const scale = sp.scale ?? 1;
  lod.put(new THREE.Vector3(0, y, 0), quat, scale, animOn ? t * 8 : 0, animOn ? (a.amp ?? 0) : 0, animOn ? t * 6 : 0, 0, 0);
  lod.end();
  renderer.render(scene, cam);
}
window.bench = {
  id: fullId, setView, setLod, frame, verts: () => ({ lo: lod.lo.geometry.attributes.position.count, hi: lod.hi?.geometry.attributes.position.count ?? 0 }),
  water: (on) => { U.waterLevel.value = on ? 1000 : -1000; },
  anim: (on) => { animOn = on; },
  ready: true,
};
setView(q.get('view') ?? 'three');
await setLod(q.get('lod') ?? 'lo');
const v = window.bench.verts();
info.textContent = `${sp.name}  [${fullId}]  lo ${v.lo} verts${v.hi ? `, hi ${v.hi}` : ''}`;
renderer.setAnimationLoop(frame);
