// Entry point: renderer (WebGPU, with three.js's automatic WebGL 2
// fallback), camera, lights, the glass tank, the frame loop and the tools.

import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { TANK, SPEEDS, MINUTES_PER_SECOND } from './config.js';
import { pass, screenUV, float, smoothstep, vec3 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { U } from './shaders.js';
import { World } from './world.js';
import { UI } from './ui.js';
import { WaterFX, FX } from './waterfx.js';
import { Mist } from './mist.js';

const params = new URLSearchParams(location.search);
const canvasHost = document.getElementById('view');

const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL: params.has('webgl') });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, params.has('lowres') ? 1 : 1.5));
renderer.setSize(canvasHost.clientWidth, canvasHost.clientHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
canvasHost.appendChild(renderer.domElement);

await renderer.init();
const backend = renderer.backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL 2';
document.getElementById('backend').textContent = backend;

const scene = new THREE.Scene();
// A dark room, so the lit tank is the only bright thing (as in the photos).
scene.background = new THREE.Color(0x050607);
try {
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.15;
} catch (e) { console.warn('No environment map', e); }

const camera = new THREE.PerspectiveCamera(36, canvasHost.clientWidth / canvasHost.clientHeight, 1, 1000);
camera.position.set(0, 40, 158);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 25, -2);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.62;
controls.minDistance = 25;
controls.maxDistance = 260;

// --- Lights: an LED bar over the tank, room fill, and night moonlight. ---
const led = new THREE.DirectionalLight(0xf4f7ff, 3.2);
led.position.set(8, 120, 22);
led.target.position.set(0, 0, 0);
led.castShadow = true;
led.shadow.mapSize.set(2048, 2048);
led.shadow.camera.left = -55; led.shadow.camera.right = 55;
led.shadow.camera.top = 40; led.shadow.camera.bottom = -40;
led.shadow.camera.near = 40; led.shadow.camera.far = 180;
led.shadow.bias = -0.0005;
led.shadow.normalBias = 0.05;
scene.add(led, led.target);
const hemi = new THREE.HemisphereLight(0xdfeeff, 0x1a1510, 0.35);
scene.add(hemi);
const moon = new THREE.DirectionalLight(0x5c7cff, 0.0);
moon.position.set(-30, 90, 40);
scene.add(moon);

// --- The tank: glass, frame, cabinet, room. ---
buildTank(scene);

const world = new World(scene);
window.paludarium = world; // handy in the console
await world.init();
const fx = new WaterFX(renderer, world);
world.fx = fx;
world.water.fx = fx;
const mist = new Mist(scene, world);
world.mist = mist;
FX.lightDir.value.copy(led.position).negate().normalize();

// Post-processing: a soft bloom on the brightest highlights (water glints,
// the LED) and a vignette that falls off into the dark room.
const post = new THREE.RenderPipeline(renderer);
const scenePass = pass(scene, camera);
const bloomPass = bloom(scenePass, 0.22, 0.4, 0.9);
const vignette = smoothstep(float(1.05), float(0.35), screenUV.sub(0.5).length().mul(1.35));
post.outputNode = scenePass.add(bloomPass).mul(vec3(vignette.mul(0.55).add(0.45)));
const usePost = !params.has('nopost');

let loaded = false;
if (!params.has('fresh')) {
  try {
    const saved = localStorage.getItem('paludarium.save');
    if (saved) { world.load(JSON.parse(saved)); loaded = true; }
  } catch (e) { console.warn('Could not load autosave', e); }
}
if (!loaded) world.starter();

const ui = new UI({ world, camera, renderer, controls, scene });
window.paludariumUI = ui;

// --- Frame loop ---
let last = performance.now();
let uiTimer = 0, saveTimer = 0;
let fpsAcc = 0, fpsN = 0, lowFrames = 0;
renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const speed = SPEEDS[ui.speed];
  world.sim.step(dt * speed * MINUTES_PER_SECOND);
  world.animals.move(dt * Math.min(speed, 4));
  world.water.animate(dt);
  mist.update(dt);
  ui.frame(dt);
  fx.step();

  // Day and night.
  const light = world.env.light();
  U.daylight.value = light;
  led.intensity = 3.2 * light;
  hemi.intensity = 0.06 + 0.3 * light;
  moon.intensity = (1 - light) * 0.35;
  scene.environmentIntensity = 0.04 + 0.12 * light;

  controls.update();
  if (usePost) post.render(); else renderer.render(scene, camera);

  uiTimer += dt;
  if (uiTimer > 0.25) { uiTimer = 0; ui.refresh(); }
  saveTimer += dt;
  if (saveTimer > 60) { saveTimer = 0; ui.autosave(); }

  // Adaptive resolution: drop the pixel ratio if we can't keep ~40 fps.
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 2) {
    const fps = fpsN / fpsAcc;
    fpsAcc = 0; fpsN = 0;
    document.getElementById('fps').textContent = Math.round(fps) + ' fps';
    if (fps < 38 && renderer.getPixelRatio() > 0.75) {
      if (++lowFrames > 1) { renderer.setPixelRatio(Math.max(0.75, renderer.getPixelRatio() - 0.25)); lowFrames = 0; }
    } else lowFrames = 0;
  }
});

window.addEventListener('resize', () => {
  const w = canvasHost.clientWidth, h = canvasHost.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
});

function buildTank(scene) {
  const { w, d, h } = TANK;
  const g = 0.6; // glass thickness
  // Nearly invisible glass: a faint green-blue tint; the frame gives the edges.
  const glass = new THREE.MeshBasicNodeMaterial({ color: 0xcfe8e4, transparent: true, opacity: 0.035, side: THREE.DoubleSide, depthWrite: false });
  const panes = [
    [w + g * 2, h, g, 0, h / 2, d / 2 + g / 2],       // front
    [g, h, d, -w / 2 - g / 2, h / 2, 0],              // left
    [g, h, d, w / 2 + g / 2, h / 2, 0],               // right
  ];
  for (const [sx, sy, sz, x, y, z] of panes) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), glass);
    m.position.set(x, y, z);
    m.renderOrder = 10;
    scene.add(m);
  }
  // Back glass is covered by the background; floor slab.
  const black = new THREE.MeshStandardNodeMaterial({ color: 0x14161a, roughness: 0.5, metalness: 0.3 });
  const frame = (sx, sy, sz, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), black);
    m.position.set(x, y, z);
    m.castShadow = true;
    scene.add(m);
  };
  const t = 1.2;
  for (const y of [-t / 2, h + t / 2]) {
    frame(w + t * 2 + g * 2, t, t, 0, y, d / 2 + g);
    frame(w + t * 2 + g * 2, t, t, 0, y, -d / 2 - t / 2);
    frame(t, t, d + t * 2, -w / 2 - t / 2 - g, y, 0);
    frame(t, t, d + t * 2, w / 2 + t / 2 + g, y, 0);
  }
  for (const x of [-w / 2 - g - t / 2, w / 2 + g + t / 2]) for (const z of [d / 2 + g, -d / 2 - t / 2]) frame(t, h, t, x, h / 2, z);
  frame(w + g * 2, 0.8, d + 1, 0, -0.4, 0);
  // Back panel behind the wall relief.
  frame(w + g * 2, h, 0.5, 0, h / 2, -d / 2 - 0.4);
  // Top lid (glass) and LED bar.
  const lid = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, d), glass);
  lid.position.set(0, h + 0.2, 0);
  lid.name = 'lid';
  scene.add(lid);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(w * 0.8, 1.2, 5), new THREE.MeshStandardNodeMaterial({ color: 0x1b1d20, roughness: 0.4, metalness: 0.6 }));
  bar.position.set(0, h + 3.5, -4);
  scene.add(bar);
  const glow = new THREE.Mesh(new THREE.BoxGeometry(w * 0.78, 0.2, 4), new THREE.MeshBasicNodeMaterial({ color: 0xfff6e5 }));
  glow.position.set(0, h + 2.85, -4);
  glow.name = 'ledGlow';
  scene.add(glow);
  // Cabinet and floor.
  const wood = new THREE.MeshStandardNodeMaterial({ color: 0x2a2019, roughness: 0.75 });
  const cab = new THREE.Mesh(new THREE.BoxGeometry(w + 12, 70, d + 10), wood);
  cab.position.set(0, -35.8, 0);
  cab.receiveShadow = true;
  scene.add(cab);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), new THREE.MeshStandardNodeMaterial({ color: 0x17140f, roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -71;
  floor.receiveShadow = true;
  scene.add(floor);
}
