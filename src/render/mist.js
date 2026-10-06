// Mist: soft sprites rising from where waterfalls land, round the fogger, and
// drifting over the tank after a misting. More humidity means denser mist.
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
    // Game.unloadTank disposes the tank's materials but not their textures: the puff goes with its material.
    m.addEventListener('dispose', () => this.tex.dispose());
    this.geo = g;
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    this.mesh.name = 'mist';
    scene.add(this.mesh);
    this.sprites = Array.from({ length: N }, () => ({ pos: new THREE.Vector3(), life: 0, max: 1, vel: new THREE.Vector3(), size: 1, alpha: 0, rot: 0, k: 1 }));
    this.acc = 0;
  }

  // `k` scales the puff's opacity: where many are born in one place (a fall's foot, the fogger) they overlap, and a stack of
  // full-strength puffs is a white blob, not a haze.
  spawn(p, size, up = 0.6, k = 1) {
    const q = this.sprites.find((q) => q.life <= 0);
    if (!q) return;
    q.pos.copy(p);
    q.k = k;
    q.vel.set((Math.random() - 0.5) * 0.8, up * (0.5 + Math.random()), (Math.random() - 0.3) * 0.6);
    q.max = q.life = 5 + Math.random() * 6;
    q.size = size;
    q.rot = Math.random() * 6.28;
  }

  update(dt) {
    const W = this.world, E = W.env;
    const hum = Math.min(1, Math.max(0, (E.humidity - 55) / 40)) * 0.8 + E.mist;
    U.mist.value = hum;
    // Emitters: the spray at the foot of each waterfall, the fogger (low fog round it) and a misting (drifting everywhere).
    // Humid air by itself is clear: puffs spawned all over the floor of any humid tank read as white blobs at the foot of
    // the rocks and plants (the user's photos, 2026-10-04).
    this.acc += dt * (3 + hum * 6);
    const fog = E.fogger > 0 ? W.equipment?.pos?.fogger : null;
    // The plunge: a fall breaks into spray where it lands, and the finest of it hangs over the foot as a low mist, as much as
    // the fall has energy (its flow times its height): small puffs low over the foam, rising slowly; more in humid air,
    // where the droplets do not dry off. A trickle off a low lip makes none.
    for (const fall of W.water.falls) {
      if (!fall.wet) continue;
      const e = fall.end ?? fall.pts[fall.pts.length - 1], hgt = Math.max(0, (fall.pts[0]?.y ?? e.y) - e.y);
      fall.mistAcc = (fall.mistAcc ?? 0) + dt * Math.min(4, (fall.q * hgt) / 160) * (0.6 + hum * 0.6);
      while (fall.mistAcc > 1) {
        fall.mistAcc -= 1;
        const r = (fall.R ?? 2) * (0.4 + Math.random() * 0.8), a = Math.random() * 6.283;
        this.spawn(new THREE.Vector3(e.x + Math.cos(a) * r, e.y + 0.4 + Math.random() * 0.6, e.z + Math.sin(a) * r), 2.5 + Math.min(4, fall.q / 10) + Math.random() * 2, 0.35, 0.45);
      }
    }
    while (this.acc > 1) {
      this.acc -= 1;
      if (fog && Math.random() < E.fogger) {
        // (over the fogger's reach, as sim/climate.js spreads its humidity; lifted by a third of its size, so the quad does
        // not cut into the ground under it in a hard line)
        const x = fog.x + (Math.random() - 0.5) * 24, z = fog.z + (Math.random() - 0.5) * 24, size = 10 + Math.random() * 8;
        const y = Math.max(W.terrain.heightAt(x, z), W.water.level) + size * 0.3 + Math.random() * 2;
        this.spawn(new THREE.Vector3(x, y, z), size, 0.15, 0.4);
      } else if (Math.random() < E.mist) {
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
      q.alpha = Math.sin(Math.PI * t) * (0.035 + hum * 0.07) * q.k;
      P[k * 4] = q.pos.x; P[k * 4 + 1] = q.pos.y; P[k * 4 + 2] = q.pos.z; P[k * 4 + 3] = grow;
      F[k * 2] = q.alpha; F[k * 2 + 1] = q.rot;
      k++;
    }
    this.geo.instanceCount = k;
    if (k) { this.posA.needsUpdate = true; this.fadeA.needsUpdate = true; }
  }
}

export { instanceIndex };
