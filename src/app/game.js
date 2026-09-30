// The game shell: owns the renderer, the camera, the scene and the current
// tank, and runs the frame loop. A tank is a Stage (glass, lights, cabinet),
// a World (ground, water, plants, animals, simulation), WaterFX and Mist;
// loadTank() throws the old ones away and builds new ones for any size.

import * as THREE from 'three/webgpu';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Gfx, QUALITY } from '../engine/gfx.js';
import { Stage } from '../engine/stage.js';
import { CameraRig } from '../engine/camera.js';
import { Emitter } from '../engine/emitter.js';
import { configureTank, TANK, SPEEDS, MINUTES_PER_SECOND } from '../sim/tank.js';
import { TANKS } from '../content/tanks.js';
import { World } from '../sim/world.js';
import { WaterFX, FX } from '../render/waterfx.js';
import { Mist } from '../render/mist.js';
import { U } from '../render/uniforms.js';
import { Lens } from '../render/lens.js';

export class Game {
  constructor(host, params = new URLSearchParams(location.search)) {
    this.host = host;
    this.params = params;
    this.events = new Emitter();
    this.speed = 1;                // index into SPEEDS
    this.lapse = 0;                // time-lapse: game minutes per real second, overrides the speed buttons
    this.frozen = false;           // paused by a menu, independent of the speed buttons
    this.world = null;
    this.stage = null;
    this.tankId = null;
    this.frameHooks = [];          // (dt) callbacks run each frame after the simulation
    this.tickHooks = [];           // (dt) callbacks at ~4 Hz
    this._tickT = 0;
  }

  async boot() {
    const gfx = this.gfx = new Gfx(this.host, this.params);
    await gfx.init();
    this.renderer = gfx.renderer;
    const scene = this.scene = new THREE.Scene();
    // A dark room, so the lit tank is the only bright thing.
    scene.background = new THREE.Color(0x050607);
    try {
      const pm = new THREE.PMREMGenerator(this.renderer);
      scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environmentIntensity = 0.15;
    } catch (e) { console.warn('No environment map', e); }
    this.rig = new CameraRig(this.renderer, gfx.aspect);
    this.camera = this.rig.camera;
    this.controls = this.rig.controls;
    window.addEventListener('resize', () => this.resize());
    return this;
  }

  resize() {
    const [w, h] = this.gfx.resize();
    this.rig.size = { w, h };
    this.rig.resize(w / h);
    this.events.emit('resize', w, h);
  }

  // Builds a tank of the given kind and fills it. `layout`: 'empty', 'starter'
  // (only the standard tank has one) or a saved world object to load.
  async loadTank(id, { layout = 'empty', save = null } = {}) {
    this.unloadTank();
    const spec = TANKS[id] ?? TANKS.standard;
    configureTank(spec);
    this.tankId = spec.id;
    this.stage = new Stage(this.scene);
    this.worldRoot = new THREE.Group();
    this.worldRoot.name = 'world';
    this.scene.add(this.worldRoot);
    const world = this.world = new World(this.worldRoot);
    window.paludarium = world;
    await world.init();
    this.fx = new WaterFX(this.renderer, world);
    world.fx = this.fx;
    world.water.fx = this.fx;
    this.mist = new Mist(this.worldRoot, world);
    world.mist = this.mist;
    world.stage = this.stage;
    world.animals.camera = this.camera;
    this.lens = new Lens(this.worldRoot, world);
    world.lens = this.lens;
    FX.lightDir.value.copy(this.stage.lightDir);
    if (save) world.load(save);
    else if (layout === 'starter' && spec.id === 'standard') world.starter();
    else world.empty();
    this.rig.fit();
    this.gfx.build(this.scene, this.camera);
    this.stage.setLid(world.env.lid);
    this.events.emit('tank', world, spec);
    return world;
  }

  unloadTank() {
    if (!this.world) return;
    this.events.emit('unload', this.world);
    this.fx?.dispose();
    this.stage?.dispose();
    const kill = (o) => {
      // Sprites all share one geometry, and creature meshes share attribute buffers with a cache: leave those alone.
      if (o.userData?.keepGeometry || o.isSprite) { (Array.isArray(o.material) ? o.material : o.material ? [o.material] : []).forEach((m) => m.dispose?.()); return; }
      o.geometry?.dispose?.();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) m.dispose?.();
    };
    this.worldRoot.traverse(kill);
    this.worldRoot.removeFromParent();
    this.world = null;
  }

  // Photo mode adds depth of field to the post pipeline.
  setPhoto(on) {
    if (this.gfx.photo === on) return;
    this.gfx.photo = on;
    if (this.scene && this.camera) this.gfx.build(this.scene, this.camera);
  }

  // The simulated speed multiplier right now (0 while paused).
  get rate() { return this.frozen ? 0 : this.lapse || SPEEDS[this.speed]; }
  setSpeed(i) { this.speed = Math.max(0, Math.min(SPEEDS.length - 1, i)); this.events.emit('speed', this.speed); }

  start() {
    let last = performance.now();
    this.renderer.setAnimationLoop(() => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      this.frame(dt);
    });
  }

  frame(dt) {
    const W = this.world;
    if (W) {
      const speed = this.rate;
      if (this.lapse) {
        // Time-lapse: animals keep moving between the sim steps, as at 20x, so they still find food and comfort.
        for (let m = dt * speed * MINUTES_PER_SECOND; m > 0; m -= 10) { const d = Math.min(10, m); W.sim.step(d); for (let k = 0; k < 5; k++) W.animals.move(0.1 * d / 10); }
      } else {
        W.sim.step(dt * speed * MINUTES_PER_SECOND);
        W.animals.move(dt * Math.min(speed, 4));
      }
      W.water.animate(dt, speed);
      this.mist.update(dt);
      for (const f of this.frameHooks) f(dt);
      this.fx.step();
      this.lens?.update(dt);
      this.lens?.update(dt);
      const E = W.env, light = Math.max(E.bright(), this.lapse ? 0.34 : 0);   // a time-lapse keeps nights readable
      U.daylight.value = Math.min(1, light);
      this.stage.setDaylight(light, E.lampWarmth, E.moonlight);
    }
    this.rig.update(dt);
    this.gfx.render();
    this.gfx.frame(dt);
    this._tickT += dt;
    if (this._tickT > 0.25) {
      const step = this._tickT;
      this._tickT = 0;
      for (const f of this.tickHooks) f(step);
    }
  }
}

export { QUALITY, TANK };
