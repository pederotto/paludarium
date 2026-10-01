// What sediment looks like in motion: tiny specks that drift with the current
// where the water carries soil (fast flow, and the cloud downstream of an
// eroding bank), and a short soil puff where a bank slumps. After CAUSTIC//VOLUME's
// particulate sandbox (specks that follow the flow); here a few hundred
// instanced icospheres moved on the CPU.

import * as THREE from 'three/webgpu';

const NS = 260, NP = 72;

export class SedimentFX {
  constructor(scene, world) {
    this.world = world;
    const sg = new THREE.IcosahedronGeometry(0.1, 0);
    this.specks = new THREE.InstancedMesh(sg, new THREE.MeshBasicNodeMaterial({ color: 0xc9a56a, transparent: true, opacity: 0.6, depthWrite: false }), NS);
    const pg = new THREE.IcosahedronGeometry(0.28, 0);
    this.puffs = new THREE.InstancedMesh(pg, new THREE.MeshBasicNodeMaterial({ color: 0x6a4a2e, transparent: true, opacity: 0.5, depthWrite: false }), NP);
    for (const m of [this.specks, this.puffs]) { m.frustumCulled = false; m.count = 0; m.renderOrder = 7; scene.add(m); }
    this.sp = new Float32Array(NS * 5);     // x, y, z, life, age-scale
    this.pp = new Float32Array(NP * 8);     // x, y, z, vx, vy, vz, life, size
    this.nS = 0; this.nP = 0;
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.v = new THREE.Vector3(); this.sc = new THREE.Vector3();
  }

  puff(x, y, z, vol = 0.1) {
    const n = Math.min(NP - this.nP, Math.round(7 + Math.min(1, vol * 25) * 9));
    for (let k = 0; k < n; k++) {
      const o = this.nP++ * 8, a = Math.random() * Math.PI * 2, r = 0.4 + Math.random() * 1.8;
      this.pp[o] = x + (Math.random() - 0.5) * 0.8; this.pp[o + 1] = y + 0.2; this.pp[o + 2] = z + (Math.random() - 0.5) * 0.8;
      this.pp[o + 3] = Math.cos(a) * r; this.pp[o + 4] = 1.2 + Math.random() * 2.2; this.pp[o + 5] = Math.sin(a) * r;
      this.pp[o + 6] = 0.7 + Math.random() * 0.7; this.pp[o + 7] = 0.5 + Math.random() * 0.7;
    }
  }

  update(dt, on = true) {
    const W = this.world, H = W.water.hydro, E = W.water.erosion;
    const m = this.m, q = this.q, v = this.v, sc = this.sc;
    this.specks.visible = on;
    if (on && E) {
      // Respawn specks where the water carries soil.
      const want = Math.min(NS, Math.round(E.stats.suspended > 0.0005 || E.nWet ? 40 + Math.min(220, E.stats.suspended * 6000) : 0));
      let guard = 0;
      while (this.nS < want && guard++ < 12 && E.nWet > 0) {
        const n = E.wet[(Math.random() * E.nWet) | 0];
        const sp = Math.hypot(H.vx[n], H.vz[n]);
        if (sp < 6 && !(E.s[n] > 4e-4)) continue;
        const [x, z] = H.cellXZ(n);
        const o = this.nS++ * 5;
        this.sp[o] = x + (Math.random() - 0.5) * H.f.da; this.sp[o + 1] = H.f.h[n] + H.d[n] * (0.15 + Math.random() * 0.7); this.sp[o + 2] = z + (Math.random() - 0.5) * H.f.db;
        this.sp[o + 3] = 1.5 + Math.random() * 2.5; this.sp[o + 4] = 0.6 + Math.random() * 0.8;
      }
      let k = 0;
      for (let i = 0; i < this.nS; i++) {
        const o = i * 5;
        let life = this.sp[o + 3] - dt;
        const n = H.cellOf(this.sp[o], this.sp[o + 2]);
        if (life <= 0 || H.res[n] || H.d[n] < 0.06) { life = 0; }
        if (life <= 0) { this.sp.copyWithin(o, (this.nS - 1) * 5, this.nS * 5); this.nS--; i--; continue; }
        this.sp[o + 3] = life;
        this.sp[o] += (H.vx[n] * 0.8 + (Math.random() - 0.5) * 2) * dt;
        this.sp[o + 2] += (H.vz[n] * 0.8 + (Math.random() - 0.5) * 2) * dt;
        const g = H.f.h[n];
        this.sp[o + 1] = Math.max(g + 0.1, Math.min(g + H.d[n] - 0.05, this.sp[o + 1] + (Math.random() - 0.5) * dt * 2));
        const s = this.sp[o + 4] * Math.min(1, life * 2);
        m.compose(v.set(this.sp[o], this.sp[o + 1], this.sp[o + 2]), q, sc.set(s, s, s));
        this.specks.setMatrixAt(k++, m);
      }
      this.specks.count = k;
      this.specks.instanceMatrix.needsUpdate = true;
    } else this.specks.count = 0;
    // Slump puffs.
    let k = 0;
    for (let i = 0; i < this.nP; i++) {
      const o = i * 8;
      const life = this.pp[o + 6] - dt;
      if (life <= 0) { this.pp.copyWithin(o, (this.nP - 1) * 8, this.nP * 8); this.nP--; i--; continue; }
      this.pp[o + 6] = life;
      this.pp[o + 4] -= 6 * dt;
      this.pp[o] += this.pp[o + 3] * dt; this.pp[o + 1] += this.pp[o + 4] * dt; this.pp[o + 2] += this.pp[o + 5] * dt;
      this.pp[o + 3] *= 0.97; this.pp[o + 5] *= 0.97;
      const gy = W.terrain.heightAt(this.pp[o], this.pp[o + 2]);
      if (this.pp[o + 1] < gy) { this.pp[o + 1] = gy; this.pp[o + 4] = Math.abs(this.pp[o + 4]) * 0.2; }
      const s = this.pp[o + 7] * Math.min(1, life * 2.5) * (0.6 + 0.4 * Math.min(1, (1.4 - life)));
      m.compose(v.set(this.pp[o], this.pp[o + 1], this.pp[o + 2]), q, sc.set(s, s, s));
      this.puffs.setMatrixAt(k++, m);
    }
    this.puffs.count = k;
    if (k) this.puffs.instanceMatrix.needsUpdate = true;
  }
}
