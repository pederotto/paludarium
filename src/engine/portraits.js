// Species portraits for the Add menu, the Field Guide and Kids mode.
//
// They are baked ahead of time into public/assets/portraits/ (tools/bake-portraits.mjs), so the game shows a file. Only a
// species or plant without a file is rendered here, live, from the game's own models by a small second renderer with a
// transparent canvas (cached as a PNG data URL, one at a time): that costs a renderer, every plant model and the species'
// body and shaders, about a minute and freezes of seconds the first time the animal menu opened, so keep the files current.

import * as THREE from 'three/webgpu';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { SPECIES, createSpeciesMesh } from '../sim/animals.js';
import { PLANTS, Plants } from '../sim/plants.js';
import { U } from '../render/uniforms.js';
import { setFoliageMRT } from '../render/shaders.js';

const SIZE = 320;
const VIEW = new THREE.Vector3(0.62, 0.34, 0.8).normalize();

const DIR = (import.meta.env?.BASE_URL ?? './') + 'assets/portraits/';
let baked = null;   // Promise<Set of '<kind>-<id>'>
function bakedSet() {
  return (baked ??= fetch(DIR + 'index.json').then((r) => (r.ok ? r.json() : [])).then((a) => new Set(a)).catch(() => new Set()));
}

export class Portraits {
  constructor({ live = false } = {}) {
    this.live = live;              // true: always render (the baking tool)
    this.cache = new Map();
    this.queue = Promise.resolve();
    this.ready = null;
  }

  async init() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const r = this.renderer = new THREE.WebGPURenderer({ canvas, alpha: true, antialias: true });
    r.setPixelRatio(1);
    r.setSize(SIZE, SIZE, false);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.setClearColor(0x000000, 0);
    await r.init();
    const scene = this.scene = new THREE.Scene();
    scene.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.55;
    const key = new THREE.DirectionalLight(0xfff4e6, 3.4); key.position.set(30, 60, 40); scene.add(key);
    const rim = new THREE.DirectionalLight(0x9cc8ff, 1.6); rim.position.set(-40, 20, -30); scene.add(rim);
    scene.add(new THREE.HemisphereLight(0xdfeeff, 0x30281c, 0.9));
    this.cam = new THREE.PerspectiveCamera(26, 1, 0.05, 900);
    this.plants = new Plants(scene);
    await this.plants.preload();
    this.plants.meshes && Object.values(this.plants.meshes).forEach((m) => { m.castShadow = false; });
  }

  get(kind, id) {
    const key = kind + ':' + id;
    if (this.cache.has(key)) return this.cache.get(key);
    if (!this.live) {
      const p = bakedSet().then((set) => (set.has(kind + '-' + id) ? DIR + kind + '-' + id + '.webp' : this.render(kind, id, key)));
      this.cache.set(key, p);
      return p;
    }
    return this.render(kind, id, key);
  }

  render(kind, id, key) {
    const p = this.queue.then(async () => {
      this.ready ??= this.init();
      await this.ready;
      return kind === 'animal' ? this.animal(id) : this.plant(id);
    }).catch((e) => { console.warn('portrait failed', key, e); return null; });
    this.queue = p.then(() => new Promise((r) => setTimeout(r, 30)));
    this.cache.set(key, p);
    return p;
  }

  frame(box, dir = VIEW, pad = 2.3) {
    const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
    const ext = Math.max(s.x, s.y, s.z);
    this.cam.position.copy(c).addScaledVector(dir, ext * pad);
    this.cam.lookAt(c);
    this.cam.updateProjectionMatrix();
  }

  async shot() {
    U.waterLevel.value = -1000;
    // This renderer has no MRT, so foliage materials (built while the main view had one) must not write to it.
    this.scene.traverse((o) => { if (o.material?.userData?.foliage && o.material.mrtNode) setFoliageMRT(o.material, false); });
    this.renderer.render(this.scene, this.cam);
    await new Promise((r) => requestAnimationFrame(r));
    this.renderer.render(this.scene, this.cam);
    return this.renderer.domElement.toDataURL('image/png');
  }

  async animal(id) {
    if (!SPECIES[id]) return null;
    const lod = createSpeciesMesh(this.scene, id, { cap: 2 });
    lod.refine(true);
    lod.near2 = 1e12;
    lod.begin();
    lod.put(new THREE.Vector3(0, 300, 0), new THREE.Quaternion(), SPECIES[id].scale ?? 1, 0, 0, 0, 0, 0);
    lod.end();
    lod.lo.geometry.computeBoundingBox();
    const b = lod.lo.geometry.boundingBox.clone();
    b.translate(new THREE.Vector3(0, 300, 0));
    this.frame(b);
    const url = await this.shot();
    lod.dispose();
    return url;
  }

  async plant(id) {
    const sp = PLANTS[id];
    if (!sp) return null;
    const p = this.plants.add(id, new THREE.Vector3(0, 300, 0), { grown: 1, scale: 1, rot: 0.6 });
    if (!p) return null;
    const box = new THREE.Box3(new THREE.Vector3(-8, 300, -8), new THREE.Vector3(8, 316, 8));
    const m = this.plants.meshes[this.plants.key(p)];
    // This renderer has no MRT, so foliage materials (which may have been built while the main view had one) must not write to it.
    m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox.clone();
    const s = p.scale * (0.3 + 0.7 * p.grown) * (sp.modelSize ?? 1);
    bb.min.multiplyScalar(s); bb.max.multiplyScalar(s);
    bb.translate(new THREE.Vector3(0, 300, 0));
    void box;
    this.frame(bb, new THREE.Vector3(0.35, 0.28, 0.9).normalize(), 2.1);
    const url = await this.shot();
    this.plants.remove(p);
    return url;
  }
}
