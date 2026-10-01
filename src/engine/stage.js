// Everything around the living tank that depends on its size: glass, frame,
// lid, LED bar, cabinet, the room, and the lights. Rebuilt whenever the tank
// changes (see Game.loadTank).
//
// The glass is more than a transparent box: humid air in a tank that is
// cooler outside than inside fogs up its glass with dew (the dew point rises
// above the glass temperature), and the droplets are drawn here, driven by
// U.condense. Wiping the glass is a real thing keepers do.

import * as THREE from 'three/webgpu';
import {
  float, vec2, vec3, positionWorld, normalWorld, normalView, cameraPosition, normalize, dot, abs, pow, smoothstep, mix, clamp,
  mx_worley_noise_float, mx_noise_float, max,
} from 'three/tsl';
import { TANK } from '../sim/tank.js';
import { U } from '../render/uniforms.js';

const COOL = new THREE.Color(0xf4f7ff), WARM = new THREE.Color(0xffd9a8), GLOW = new THREE.Color(1, 0.965, 0.9);

export class Stage {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.name = 'stage';
    scene.add(this.root);
    this.lights = {};
    this.parts = {};
    this.build();
  }

  // Glass with fresnel edges and dew droplets.
  glassMaterial() {
    const m = new THREE.MeshStandardNodeMaterial({ color: 0xcfe8e4, transparent: true, side: THREE.DoubleSide, depthWrite: false, roughness: 0.04, metalness: 0 });
    const view = normalize(cameraPosition.sub(positionWorld));
    const fres = pow(float(1).sub(clamp(abs(dot(view, normalWorld)), 0, 1)), 4);
    // The dew: sparse beads that grow and merge as U.condense rises, each a
    // clear centre with a bright rim (a lens catching the light), and a thin
    // haze of fog on the glass at the top of the range.
    const pp = vec2(positionWorld.x.add(positionWorld.z), positionWorld.y.mul(0.85));
    const w = mx_worley_noise_float(pp.mul(0.95).toVec3());
    const w2 = mx_worley_noise_float(pp.mul(2.7).add(17).toVec3());
    const c = U.condense;
    const R = c.mul(0.36), r2 = c.mul(0.3);
    const body = max(smoothstep(R, R.mul(0.6), w), smoothstep(r2, r2.mul(0.6), w2).mul(0.8));
    const rimA = smoothstep(R.mul(0.62), R.mul(0.92), w).mul(smoothstep(R.mul(1.08), R.mul(0.9), w));
    const rimB = smoothstep(r2.mul(0.62), r2.mul(0.92), w2).mul(smoothstep(r2.mul(1.08), r2.mul(0.9), w2));
    const rim = max(rimA, rimB.mul(0.8)).mul(smoothstep(0.03, 0.15, c));
    const haze = smoothstep(0.4, 1, c).mul(mx_noise_float(pp.mul(0.25).toVec3()).mul(0.25).add(0.7)).mul(0.22);
    m.opacityNode = float(0.035).add(fres.mul(0.12)).add(body.mul(0.09)).add(rim.mul(0.4)).add(haze);
    m.roughnessNode = mix(float(0.04), float(0.3), clamp(body.add(haze), 0, 1));
    m.colorNode = mix(vec3(0.8, 0.92, 0.9), vec3(0.96, 0.99, 1), clamp(rim.add(haze), 0, 1));
    return m;
  }

  build() {
    const { w, d, h } = TANK;
    const root = this.root;
    const g = 0.6; // glass thickness
    const glass = this.glassMaterial();
    const panes = [
      [w + g * 2, h, g, 0, h / 2, d / 2 + g / 2],       // front
      [g, h, d, -w / 2 - g / 2, h / 2, 0],              // left
      [g, h, d, w / 2 + g / 2, h / 2, 0],               // right
    ];
    for (const [sx, sy, sz, x, y, z] of panes) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), glass);
      m.position.set(x, y, z);
      m.renderOrder = 10;
      root.add(m);
    }
    const black = new THREE.MeshStandardNodeMaterial({ color: 0x14161a, roughness: 0.45, metalness: 0.35 });
    const frame = (sx, sy, sz, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), black);
      m.position.set(x, y, z);
      m.castShadow = true;
      root.add(m);
    };
    const t = Math.max(0.9, Math.min(1.4, w / 75));
    for (const y of [-t / 2, h + t / 2]) {
      frame(w + t * 2 + g * 2, t, t, 0, y, d / 2 + g);
      frame(w + t * 2 + g * 2, t, t, 0, y, -d / 2 - t / 2);
      frame(t, t, d + t * 2, -w / 2 - t / 2 - g, y, 0);
      frame(t, t, d + t * 2, w / 2 + t / 2 + g, y, 0);
    }
    for (const x of [-w / 2 - g - t / 2, w / 2 + g + t / 2]) for (const z of [d / 2 + g, -d / 2 - t / 2]) frame(t, h, t, x, h / 2, z);
    frame(w + g * 2, 0.8, d + 1, 0, -0.4, 0);
    frame(w + g * 2, h, 0.5, 0, h / 2, -d / 2 - 0.4);

    // Lid (glass) and LED bar.
    const lid = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, d), glass);
    lid.position.set(0, h + 0.2, 0);
    lid.name = 'lid';
    root.add(lid);
    this.parts.lid = lid;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w * 0.8, 1.2, 5), new THREE.MeshStandardNodeMaterial({ color: 0x1b1d20, roughness: 0.4, metalness: 0.6 }));
    bar.position.set(0, h + 3.5, -d * 0.09);
    root.add(bar);
    const glowMat = new THREE.MeshBasicNodeMaterial({ color: 0xfff6e5 });
    const glow = new THREE.Mesh(new THREE.BoxGeometry(w * 0.78, 0.2, 4), glowMat);
    glow.position.set(0, h + 2.85, -d * 0.09);
    glow.name = 'ledGlow';
    root.add(glow);
    this.parts.glow = glow;

    // Cabinet and the room's floor.
    const wood = new THREE.MeshStandardNodeMaterial({ color: 0x2a2019, roughness: 0.75 });
    const cab = new THREE.Mesh(new THREE.BoxGeometry(w + 12, 70, d + 10), wood);
    cab.position.set(0, -35.8, 0);
    cab.receiveShadow = true;
    root.add(cab);
    this.parts.cab = cab;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshStandardNodeMaterial({ color: 0x17140f, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -71;
    floor.receiveShadow = true;
    root.add(floor);
    this.parts.floor = floor;
    this.fitScreen(this.aspect ?? 1.6);

    // Lights: an LED bar over the tank, room fill, and night moonlight.
    const L = this.lights;
    L.led = new THREE.DirectionalLight(0xf4f7ff, 3.2);
    L.led.position.set(w * 0.09, h * 2, d * 0.5);
    L.led.target.position.set(0, 0, 0);
    L.led.castShadow = true;
    L.led.shadow.mapSize.set(2048, 2048);
    const sc = L.led.shadow.camera;
    sc.left = -(w / 2 + 10); sc.right = w / 2 + 10; sc.top = d / 2 + 18; sc.bottom = -(d / 2 + 18);
    sc.near = h * 0.6; sc.far = h * 3.2;
    sc.updateProjectionMatrix();
    L.led.shadow.bias = -0.0005;
    L.led.shadow.normalBias = 0.05;
    L.hemi = new THREE.HemisphereLight(0xdfeeff, 0x1a1510, 0.35);
    L.moon = new THREE.DirectionalLight(0x5c7cff, 0);
    L.moon.position.set(-w / 3, h * 1.5, d);
    root.add(L.led, L.led.target, L.hemi, L.moon);
    this.lightDir = L.led.position.clone().negate().normalize();
  }

  // On a portrait screen the tall dark cabinet wastes the view: it shrinks to a thin plinth (and the floor rises to meet it).
  fitScreen(aspect) {
    this.aspect = aspect;
    const { cab, floor } = this.parts;
    if (!cab) return;
    const k = aspect < 0.8 ? 0.1 : 1;
    cab.scale.y = k;
    cab.position.y = -0.8 - 35 * k;
    if (floor) floor.position.y = k < 1 ? -0.8 - 70 * k - 0.3 : -71;
  }

  setLid(on) { if (this.parts.lid) this.parts.lid.visible = on; }

  // Day and night: `light` is the schedule (0 … 1) times the lamp's power;
  // `warmth` (0 cool white … 1 warm) tints the LED; `moon` allows night light.
  setDaylight(light, warmth = 0.35, moon = true) {
    const L = this.lights;
    const lvl = Math.min(1.5, light);
    L.led.color.copy(COOL).lerp(WARM, warmth);
    L.led.intensity = 3.2 * lvl;
    L.hemi.intensity = 0.06 + 0.3 * Math.min(1, lvl);
    L.moon.intensity = moon ? (1 - Math.min(1, lvl)) * 0.35 : 0;
    this.parts.glow.material.color.copy(GLOW).multiplyScalar(0.06 + 0.94 * Math.min(1, lvl)).lerp(WARM, warmth * 0.4);
    this.scene.environmentIntensity = 0.04 + 0.12 * Math.min(1, lvl);
  }

  dispose() {
    this.root.traverse((o) => {
      o.geometry?.dispose?.();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) m.dispose?.();
    });
    this.root.removeFromParent();
  }
}
