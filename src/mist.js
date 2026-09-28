// Mist: soft sprites rising from where waterfalls land and drifting over the
// water and moss. More humidity (or misting) means more and denser mist.
// The sprite texture is generated (a blurred noise puff), so there is nothing
// to download.

import * as THREE from 'three/webgpu';
import { texture, uv, float, vec3, uniform, instanceIndex } from 'three/tsl';
import { TANK } from './config.js';
import { U } from './uniforms.js';

function puffTexture(size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  // A few overlapping soft blobs give an irregular puff.
  const blobs = Array.from({ length: 7 }, () => [0.3 + Math.random() * 0.4, 0.3 + Math.random() * 0.4, 0.12 + Math.random() * 0.18]);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    let a = 0;
    for (const [bx, by, br] of blobs) {
      const d = Math.hypot(u - bx, v - by) / br;
      a += Math.exp(-d * d * 2);
    }
    const edge = Math.max(0, 1 - Math.hypot(u - 0.5, v - 0.5) * 2);
    a = Math.min(1, a * 0.45) * edge;
    const i = (y * size + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
    img.data[i + 3] = a * 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Mist {
  constructor(scene, world) {
    this.world = world;
    this.N = 140;
    this.tex = puffTexture();
    this.sprites = [];
    for (let i = 0; i < this.N; i++) {
      const alpha = uniform(0);
      const m = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
      m.colorNode = vec3(0.88, 0.93, 0.95);
      m.opacityNode = texture(this.tex, uv()).a.mul(alpha).mul(U.daylight.mul(0.7).add(0.3));
      const s = new THREE.Sprite(m);
      s.visible = false;
      s.renderOrder = 8;
      scene.add(s);
      this.sprites.push({ s, life: 0, max: 1, vel: new THREE.Vector3(), size: 1, alpha });
    }
    this.acc = 0;
  }

  spawn(p, size, up = 0.6) {
    const q = this.sprites.find((q) => q.life <= 0);
    if (!q) return;
    q.s.position.copy(p);
    q.vel.set((Math.random() - 0.5) * 0.8, up * (0.5 + Math.random()), (Math.random() - 0.3) * 0.6);
    q.max = q.life = 5 + Math.random() * 6;
    q.size = size;
    q.s.material.rotation = Math.random() * 6.28;
    q.s.visible = true;
  }

  update(dt) {
    const W = this.world, E = W.env;
    const hum = Math.min(1, Math.max(0, (E.humidity - 55) / 40)) * 0.8 + E.mist;
    U.mist.value = hum;
    // Emitters: the foot of each waterfall, plus the open water and moss.
    this.acc += dt * (4 + hum * 10);
    while (this.acc > 1) {
      this.acc -= 1;
      const fall = W.water.falls[Math.floor(Math.random() * Math.max(1, W.water.falls.length))];
      if (fall && Math.random() < 0.6) {
        const e = fall.pts[fall.pts.length - 1];
        this.spawn(new THREE.Vector3(e.x + (Math.random() - 0.5) * 3, e.y + 0.8, e.z + (Math.random() - 0.5) * 3), 5 + Math.random() * 5, 0.8);
      } else if (Math.random() < hum) {
        const x = (Math.random() - 0.5) * (TANK.w - 8), z = (Math.random() - 0.7) * (TANK.d - 8);
        const y = Math.max(W.terrain.heightAt(x, z), W.water.level) + 1 + Math.random() * 3;
        this.spawn(new THREE.Vector3(x, y, z), 8 + Math.random() * 10, 0.25);
      }
    }
    for (const q of this.sprites) {
      if (q.life <= 0) continue;
      q.life -= dt;
      if (q.life <= 0 || q.s.position.y > TANK.h - 2) { q.life = 0; q.s.visible = false; continue; }
      q.s.position.addScaledVector(q.vel, dt);
      q.vel.multiplyScalar(1 - dt * 0.15);
      const t = 1 - q.life / q.max;
      const grow = q.size * (0.6 + t * 0.9);
      q.s.scale.set(grow, grow, 1);
      // Fade in, then out.
      q.alpha.value = Math.sin(Math.PI * t) * (0.06 + hum * 0.14);
    }
  }
}

export { instanceIndex };
