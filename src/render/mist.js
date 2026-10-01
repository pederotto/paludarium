// Mist: soft sprites rising from where waterfalls land and drifting over the
// water and moss. More humidity (or misting) means more and denser mist.
// The sprite texture is generated (a blurred noise puff), so there is nothing
// to download.

import * as THREE from 'three/webgpu';
import { texture, uv, vec2, vec3, vec4, attribute, cos, sin, positionGeometry, cameraViewMatrix, cameraProjectionMatrix, instanceIndex } from 'three/tsl';
import { TANK } from '../sim/tank.js';
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
    // One draw for all of it: every puff is an instance of a quad that the vertex shader turns to face the camera.
    // Per instance: centre + size, and fade + spin.
    const N = this.N;
    const g = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    g.index = quad.index;
    g.setAttribute('position', quad.attributes.position);
    g.setAttribute('uv', quad.attributes.uv);
    this.posA = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);
    this.fadeA = new THREE.InstancedBufferAttribute(new Float32Array(N * 2), 2);
    this.posA.setUsage(THREE.DynamicDrawUsage); this.fadeA.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('mpos', this.posA); g.setAttribute('mfade', this.fadeA);
    g.instanceCount = 0;
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    const cen = attribute('mpos', 'vec4'), fa = attribute('mfade', 'vec2');
    const vc = cameraViewMatrix.mul(vec4(cen.xyz, 1));
    const sp = positionGeometry.xy.mul(cen.w);
    const c = cos(fa.y), sn = sin(fa.y);
    const rot = vec2(sp.x.mul(c).sub(sp.y.mul(sn)), sp.x.mul(sn).add(sp.y.mul(c)));
    m.vertexNode = cameraProjectionMatrix.mul(vec4(vc.xy.add(rot), vc.z, 1));
    m.colorNode = vec3(0.88, 0.93, 0.95);
    m.opacityNode = texture(this.tex, uv()).a.mul(fa.x).mul(U.daylight.mul(0.7).add(0.3));
    this.geo = g;
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    this.mesh.name = 'mist';
    scene.add(this.mesh);
    this.sprites = Array.from({ length: N }, () => ({ pos: new THREE.Vector3(), life: 0, max: 1, vel: new THREE.Vector3(), size: 1, alpha: 0, rot: 0 }));
    this.acc = 0;
  }

  spawn(p, size, up = 0.6) {
    const q = this.sprites.find((q) => q.life <= 0);
    if (!q) return;
    q.pos.copy(p);
    q.vel.set((Math.random() - 0.5) * 0.8, up * (0.5 + Math.random()), (Math.random() - 0.3) * 0.6);
    q.max = q.life = 5 + Math.random() * 6;
    q.size = size;
    q.rot = Math.random() * 6.28;
  }

  update(dt) {
    const W = this.world, E = W.env;
    const hum = Math.min(1, Math.max(0, (E.humidity - 55) / 40)) * 0.8 + E.mist;
    U.mist.value = hum;
    // Emitters: the foot of each waterfall, plus the open water and moss.
    this.acc += dt * (3 + hum * 6);
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
    // Live puffs are packed to the front, so the draw covers exactly them.
    let k = 0;
    const P = this.posA.array, F = this.fadeA.array;
    for (const q of this.sprites) {
      if (q.life <= 0) continue;
      q.life -= dt;
      if (q.life <= 0 || q.pos.y > TANK.h - 2) { q.life = 0; continue; }
      q.pos.addScaledVector(q.vel, dt);
      q.vel.multiplyScalar(1 - dt * 0.15);
      const t = 1 - q.life / q.max;
      const grow = q.size * (0.6 + t * 0.9);
      // Fade in, then out.
      q.alpha = Math.sin(Math.PI * t) * (0.035 + hum * 0.07);
      P[k * 4] = q.pos.x; P[k * 4 + 1] = q.pos.y; P[k * 4 + 2] = q.pos.z; P[k * 4 + 3] = grow;
      F[k * 2] = q.alpha; F[k * 2 + 1] = q.rot;
      k++;
    }
    this.geo.instanceCount = k;
    if (k) { this.posA.needsUpdate = true; this.fadeA.needsUpdate = true; }
  }
}

export { instanceIndex };
