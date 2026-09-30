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
  float, vec2, vec3, positionWorld, normalWorld, normalView, cameraPosition, normalize, dot, abs, pow, smoothstep, mix, clamp, time,
  dFdx, dFdy, mx_worley_noise_float, mx_noise_float, max,
} from 'three/tsl';
import { TANK } from '../sim/tank.js';
import { U } from '../render/uniforms.js';

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
    // The dew: cellular droplets, more and bigger as U.condense rises, and a
    // thin fog film at the top of the range.
    const pp = vec2(positionWorld.x.add(positionWorld.z), positionWorld.y.mul(0.8));
    const w = mx_worley_noise_float(pp.mul(0.85).toVec3());
    const w2 = mx_worley_noise_float(pp.mul(2.4).add(11).toVec3());
    const r = U.condense.mul(0.62);
    const big = smoothstep(r.add(0.05), r, w);
    const small = smoothstep(r.mul(0.8).add(0.05), r.mul(0.8), w2).mul(0.7);
    const drops = max(big, small).mul(smoothstep(0.02, 0.12, U.condense));
    const film = smoothstep(0.55, 1, U.condense).mul(mx_noise_float(pp.mul(0.3).toVec3()).mul(0.3).add(0.55)).mul(0.35);
    const mask = clamp(drops.add(film), 0, 1);
    m.opacityNode = float(0.035).add(fres.mul(0.12)).add(mask.mul(0.5));
    m.roughnessNode = mix(float(0.04), float(0.55), mask);
    m.colorNode = mix(vec3(0.8, 0.92, 0.9), vec3(0.9, 0.96, 0.98), mask);
    // Droplets bend the light: nudge the normal with the mask's gradient.
    m.normalNode = normalize(normalView.add(vec3(dFdx(drops), dFdy(drops), 0).mul(6)));
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
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshStandardNodeMaterial({ color: 0x17140f, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -71;
    floor.receiveShadow = true;
    root.add(floor);

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

  setLid(on) { if (this.parts.lid) this.parts.lid.visible = on; }

  // Day and night: light is 0 … 1.
  setDaylight(light) {
    const L = this.lights;
    L.led.intensity = 3.2 * light;
    L.hemi.intensity = 0.06 + 0.3 * light;
    L.moon.intensity = (1 - light) * 0.35;
    this.parts.glow.material.color.setScalar(0.06 + 0.94 * light).multiply(new THREE.Color(1, 0.965, 0.9));
    this.scene.environmentIntensity = 0.04 + 0.12 * light;
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
