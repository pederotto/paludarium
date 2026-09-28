// Open water: the main water level (anything below it is submerged), ponds
// (small basins that fill up to their spill point) and waterfalls (streams
// that run from a source down walls and slopes into water).

import * as THREE from 'three/webgpu';
import {
  Fn, float, vec3, vec2, uv, time, mix, smoothstep, mx_noise_float, positionWorld, normalWorld,
  cameraPosition, pow, dot, normalize, clamp, abs, sin, transformNormalToView, uniform, attribute,
} from 'three/tsl';
import { TANK } from './config.js';
import { U } from './uniforms.js';
import { waterSurfaceMaterial, SIM } from './waterfx.js';
import { clamp as clampN } from './geo.js';

export class Water {
  constructor(scene, terrain) {
    this.scene = scene;
    this.terrain = terrain;
    this.level = 14;
    this.ponds = [];
    this.falls = [];

    // A fine grid so the ripples can move it (one vertex per ripple cell).
    const g = new THREE.PlaneGeometry(TANK.w - 0.1, TANK.d - 0.1, SIM[0], SIM[1]);
    g.rotateX(-Math.PI / 2);
    this.surface = new THREE.Mesh(g, waterSurfaceMaterial({ ripples: true }));
    this.surface.frustumCulled = false;
    this.fx = null; // WaterFX, set by main.js
    this.surface.renderOrder = 5;
    this.surface.name = 'water';
    this.surface.userData.surface = 'water';
    scene.add(this.surface);

    // Tinted water seen through the glass: front and side faces of the volume.
    const vm = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.FrontSide });
    vm.colorNode = U.tint.mul(0.22).mul(U.daylight.mul(0.8).add(0.2));
    vm.opacityNode = float(0.1);
    const vg = new THREE.BoxGeometry(TANK.w - 0.12, 1, TANK.d - 0.12);
    vg.translate(0, 0.5, 0);
    this.volume = new THREE.Mesh(vg, vm);
    this.volume.renderOrder = 4;
    scene.add(this.volume);

    this.pondMat = waterSurfaceMaterial({ ripples: false, opacity: 0.2 });
    this.fallMat = this.makeFallMaterial();
    this.splashMat = this.makeSplashMaterial();
    this.setLevel(this.level);
  }

  setLevel(y) {
    this.level = clampN(y, 0, TANK.h - 6);
    U.waterLevel.value = this.level;
    this.surface.position.y = this.level;
    this.surface.visible = this.level > 0.4;
    this.volume.scale.y = Math.max(0.001, this.level);
    this.volume.visible = this.level > 0.4;
  }

  // Is the point (x, z) open water of the main tank (substrate below the line)?
  isWater(x, z, minDepth = 0.5) {
    return this.level - this.terrain.heightAt(x, z) > minDepth;
  }

  pondAt(x, z) {
    const f = this.terrain.field;
    const [fi, fj] = f.toGrid(x, z);
    const i = Math.round(fi), j = Math.round(fj);
    for (const p of this.ponds) if (p.cells.has(f.idx(clampN(i, 0, f.nx), clampN(j, 0, f.ny)))) return p;
    return null;
  }

  // Surface height of any water at (x, z), or -Infinity if dry.
  surfaceAt(x, z) {
    const h = this.terrain.heightAt(x, z);
    if (this.level - h > 0.05) return this.level;
    const p = this.pondAt(x, z);
    if (p && p.level - h > 0.05) return p.level;
    return -Infinity;
  }

  // Total open water area in cm² (main + ponds) — drives humidity.
  surfaceArea() {
    const f = this.terrain.field;
    let wet = 0;
    for (let n = 0; n < f.h.length; n++) if (f.h[n] < this.level) wet++;
    let a = wet * f.da * f.db;
    for (const p of this.ponds) a += p.cells.size * f.da * f.db;
    return a;
  }

  volumeLitres() {
    const f = this.terrain.field;
    let v = 0;
    for (let n = 0; n < f.h.length; n++) v += Math.max(0, this.level - f.h[n]);
    v *= f.da * f.db;
    for (const p of this.ponds) for (const n of p.cells) v += Math.max(0, p.level - f.h[n]) * f.da * f.db;
    return v / 1000;
  }

  // --- Ponds -------------------------------------------------------------
  // Fills the basin around (x, z) the way rain would: grow from the lowest
  // neighbour each time and remember the highest ground crossed. Once the
  // next cell is lower than that, water would spill out there, so the pond's
  // surface is the spill height.
  addPond(x, z) {
    const f = this.terrain.field;
    let [fi, fj] = f.toGrid(x, z);
    let i = clampN(Math.round(fi), 1, f.nx - 1), j = clampN(Math.round(fj), 1, f.ny - 1);
    // Walk down to the local minimum first.
    for (let k = 0; k < 400; k++) {
      let best = f.idx(i, j), bi = i, bj = j;
      for (const [di, dj] of NB8) {
        const ni = i + di, nj = j + dj;
        if (ni < 1 || nj < 1 || ni >= f.nx || nj >= f.ny) continue;
        if (f.h[f.idx(ni, nj)] < f.h[best]) { best = f.idx(ni, nj); bi = ni; bj = nj; }
      }
      if (bi === i && bj === j) break;
      i = bi; j = bj;
    }
    const start = f.idx(i, j);
    if (f.h[start] < this.level) return { error: 'That spot is already under the main water.' };
    const heap = new MinHeap();
    const seen = new Set([start]);
    const order = [];
    heap.push(f.h[start], start);
    let spill = f.h[start];
    let spillCell = start;
    const MAX = 900;
    while (heap.size) {
      const [h, n] = heap.pop();
      if (h < spill - 0.001 && order.length > 0) { spillCell = n; break; }
      spill = Math.max(spill, h);
      order.push(n);
      if (order.length > MAX) return { error: 'That basin is too big or open. Dig a deeper hollow first.' };
      const ci = n % f.cols, cj = Math.floor(n / f.cols);
      if (ci <= 0 || cj <= 0 || ci >= f.nx || cj >= f.ny) { spillCell = n; break; }
      for (const [di, dj] of NB4) {
        const m = f.idx(ci + di, cj + dj);
        if (seen.has(m)) continue;
        seen.add(m);
        heap.push(f.h[m], m);
      }
    }
    const level = spill - 0.15;
    const cells = new Set();
    for (const n of order) if (f.h[n] < level) cells.add(n);
    if (cells.size < 6 || level - f.h[start] < 0.6) return { error: 'Too shallow for a pond here. Lower the ground to make a hollow.' };
    if (level <= this.level) return { error: 'This hollow overflows into the main water.' };
    // Grow the mesh region by one ring so the edge hides under the banks.
    const region = new Set(cells);
    for (const n of cells) {
      const ci = n % f.cols, cj = Math.floor(n / f.cols);
      for (const [di, dj] of NB8) {
        const ni = ci + di, nj = cj + dj;
        if (ni >= 0 && nj >= 0 && ni <= f.nx && nj <= f.ny) region.add(f.idx(ni, nj));
      }
    }
    const pond = { level, cells, region, spillCell, mesh: null };
    pond.mesh = this.buildPondMesh(pond);
    this.scene.add(pond.mesh);
    this.ponds.push(pond);
    return { pond };
  }

  buildPondMesh(pond) {
    const f = this.terrain.field;
    const pos = [];
    for (const n of pond.region) {
      const i = n % f.cols, j = Math.floor(n / f.cols);
      if (i >= f.nx || j >= f.ny) continue;
      const [x0, z0] = f.toWorld(i, j);
      const [x1, z1] = f.toWorld(i + 1, j + 1);
      const y = pond.level;
      pos.push(x0, y, z0, x0, y, z1, x1, y, z0, x1, y, z0, x0, y, z1, x1, y, z1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, this.pondMat);
    m.renderOrder = 5;
    m.name = 'pond';
    m.userData.surface = 'pond';
    return m;
  }

  removePond(p) {
    this.scene.remove(p.mesh);
    p.mesh.geometry.dispose();
    this.ponds.splice(this.ponds.indexOf(p), 1);
  }

  // Re-fill ponds after the ground changed (keeps their seed points).
  refreshPonds() {
    const seeds = this.ponds.map((p) => {
      const n = [...p.cells][0];
      const f = this.terrain.field;
      return f.toWorld(n % f.cols, Math.floor(n / f.cols));
    });
    for (const p of [...this.ponds]) this.removePond(p);
    for (const [x, z] of seeds) this.addPond(x, z);
  }

  // --- Waterfalls --------------------------------------------------------
  // A source at a point on the wall or ground. Water runs straight down the
  // wall face, then down the steepest slope of the substrate until it
  // reaches a pond or the main water.
  addFall(src, wall) {
    const pts = this.tracePath(src, wall);
    if (pts.length < 3) return { error: 'Water from here has nowhere to run.' };
    const fall = { src: src.clone(), pts, mesh: null, splash: null, drops: null, t: [] };
    this.buildFall(fall);
    this.falls.push(fall);
    return { fall };
  }

  tracePath(src, wall) {
    const T = this.terrain;
    const pts = [];
    const p = src.clone();
    // On the wall: fall down its face.
    if (wall && p.z < -TANK.d / 2 + wall.field.maxH + 1 && p.y > T.heightAt(p.x, p.z) + 0.5) {
      const step = 0.8;
      while (p.y > 0) {
        const wz = wall.zAt(p.x, p.y) + 0.6;
        const ground = T.heightAt(p.x, Math.max(wz, p.z));
        pts.push(new THREE.Vector3(p.x, p.y, Math.max(wz, p.z - 0.2)));
        if (p.y <= ground + 0.2 || this.surfaceAt(p.x, wz) > p.y) break;
        p.z = Math.max(p.z, wz);
        p.y -= step;
      }
      p.y = T.heightAt(p.x, p.z);
    } else {
      p.y = T.heightAt(p.x, p.z);
      pts.push(p.clone().setY(p.y + 0.25));
    }
    // On the ground: steepest descent with a little momentum.
    let dir = new THREE.Vector2(0, 1);
    const lim = new THREE.Vector2(TANK.w / 2 - 1, TANK.d / 2 - 1);
    for (let k = 0; k < 260; k++) {
      const surf = this.surfaceAt(p.x, p.z);
      if (surf > T.heightAt(p.x, p.z) && k > 0) { pts.push(new THREE.Vector3(p.x, surf, p.z)); break; }
      const [gx, gz] = T.field.gradient(p.x, p.z);
      const g = new THREE.Vector2(-gx, -gz);
      if (g.length() < 0.02) {
        // Flat: keep going the same way and hope for a downhill.
        g.copy(dir);
      } else g.normalize();
      dir.lerp(g, 0.6).normalize();
      p.x = clampN(p.x + dir.x * 0.6, -lim.x, lim.x);
      p.z = clampN(p.z + dir.y * 0.6, -lim.y, lim.y);
      p.y = T.heightAt(p.x, p.z) + 0.25;
      pts.push(p.clone());
    }
    return pts;
  }

  buildFall(fall) {
    const pts = fall.pts;
    // Ribbon: faces the camera-ish; on the wall the width is along x, on the
    // ground perpendicular to the flow.
    const pos = [], uvs = [];
    let len = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const d = b.clone().sub(a);
      if (i > 0) len += pts[i].distanceTo(pts[i - 1]);
      const vertical = Math.abs(d.y) > Math.hypot(d.x, d.z);
      const side = vertical ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(-d.z, 0, d.x).normalize();
      const w = vertical ? 2.6 : 1.8;
      // Keep the sheet just outside the rock it runs over (the heightfield is
      // coarser than the scanned mesh).
      const lift = vertical ? new THREE.Vector3(0, 0, 1.1) : new THREE.Vector3(0, 0.45, 0);
      const l = pts[i].clone().addScaledVector(side, -w / 2).add(lift);
      const r = pts[i].clone().addScaledVector(side, w / 2).add(lift);
      pos.push(l.x, l.y, l.z, r.x, r.y, r.z);
      uvs.push(0, len, 1, len);
    }
    const idx = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    fall.mesh = new THREE.Mesh(g, this.fallMat);
    fall.mesh.renderOrder = 6;
    fall.mesh.name = 'fall';
    this.scene.add(fall.mesh);

    const end = pts[pts.length - 1];
    const sg = new THREE.CircleGeometry(2.4, 20);
    sg.rotateX(-Math.PI / 2);
    fall.splash = new THREE.Mesh(sg, this.splashMat);
    fall.splash.position.copy(end).add(new THREE.Vector3(0, 0.06, 0));
    fall.splash.renderOrder = 7;
    this.scene.add(fall.splash);

    // Droplets riding the stream.
    const N = 36;
    const dg = new THREE.IcosahedronGeometry(0.18, 0);
    const dm = new THREE.MeshStandardNodeMaterial({ color: 0xdff4ff, roughness: 0.05, transparent: true, opacity: 0.75 });
    fall.drops = new THREE.InstancedMesh(dg, dm, N);
    fall.drops.frustumCulled = false;
    fall.curve = new THREE.CatmullRomCurve3(pts);
    fall.len = len;
    fall.t = Array.from({ length: N }, () => Math.random());
    this.scene.add(fall.drops);
  }

  removeFall(fall) {
    for (const o of [fall.mesh, fall.splash, fall.drops]) { this.scene.remove(o); o.geometry.dispose(); }
    this.falls.splice(this.falls.indexOf(fall), 1);
  }

  refreshFalls(wall) {
    const srcs = this.falls.map((f) => f.src);
    for (const f of [...this.falls]) this.removeFall(f);
    for (const s of srcs) this.addFall(s, wall);
  }

  nearestFall(p, maxD = 4) {
    let best = null, bd = maxD;
    for (const f of this.falls) for (const q of f.pts) {
      const d = q.distanceTo(p);
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  }

  nearestPond(x, z) { return this.pondAt(x, z); }

  // Falling water: thin streaks racing down (noise stretched along the flow),
  // a whiter core, and see-through edges.
  makeFallMaterial() {
    const m = new THREE.MeshStandardNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, roughness: 0.05 });
    const u = uv();
    const streak = mx_noise_float(vec3(u.x.mul(14.0), u.y.mul(0.35).sub(time.mul(6.0)), 0.5))
      .add(mx_noise_float(vec3(u.x.mul(31.0), u.y.mul(0.8).sub(time.mul(9.0)), 2.5)).mul(0.6));
    const fine = mx_noise_float(vec3(u.x.mul(60.0), u.y.mul(3.0).sub(time.mul(16.0)), 7.0));
    const edge = smoothstep(0.0, 0.3, u.x).mul(smoothstep(1.0, 0.7, u.x));
    const core = smoothstep(0.15, 0.5, u.x).mul(smoothstep(0.85, 0.5, u.x));
    const white = smoothstep(-0.1, 0.8, streak.add(fine.mul(0.3)));
    m.colorNode = mix(vec3(0.62, 0.8, 0.84), vec3(0.97, 0.99, 1.0), white);
    m.opacityNode = edge.mul(white.mul(0.6).add(core.mul(0.25)).add(0.12));
    m.emissiveNode = vec3(0.16, 0.18, 0.19).mul(white).mul(U.daylight.mul(0.8).add(0.2));
    return m;
  }

  makeSplashMaterial() {
    const m = new THREE.MeshStandardNodeMaterial({ transparent: true, depthWrite: false, roughness: 0.2 });
    const u = uv().sub(0.5);
    const r = u.length().mul(2);
    const ring = sin(r.mul(18).sub(time.mul(7))).mul(0.5).add(0.5);
    const n = mx_noise_float(vec3(u.x.mul(9), u.y.mul(9), time.mul(2)));
    m.colorNode = vec3(0.95, 0.98, 1);
    m.opacityNode = smoothstep(1.0, 0.2, r).mul(ring.mul(0.35).add(n.mul(0.35)).add(0.15));
    return m;
  }

  animate(dt) {
    const m = new THREE.Matrix4();
    const s = new THREE.Vector3();
    for (const f of this.falls) {
      const speed = 22 / Math.max(4, f.len);
      for (let i = 0; i < f.t.length; i++) {
        f.t[i] = (f.t[i] + dt * speed * (0.8 + (i % 5) * 0.08)) % 1;
        const p = f.curve.getPointAt(f.t[i]);
        p.x += Math.sin(i * 12.9) * 0.45;
        p.z += Math.cos(i * 7.3) * 0.25;
        const k = 0.6 + (i % 3) * 0.3;
        m.compose(p, new THREE.Quaternion(), s.set(k, k * 1.8, k));
        f.drops.setMatrixAt(i, m);
      }
      f.drops.instanceMatrix.needsUpdate = true;
      const sc = 1 + Math.sin(performance.now() * 0.006) * 0.06;
      f.splash.scale.set(sc, 1, sc);
      // Where it lands in the main water it keeps stirring ripples.
      const end = f.pts[f.pts.length - 1];
      if (this.fx && Math.abs(end.y - this.level) < 0.6 && Math.random() < 0.7) {
        this.fx.addDrop(end.x + (Math.random() - 0.5) * 1.5, end.z + (Math.random() - 0.5) * 1.5, -2.5 - Math.random() * 3, 0.6 + Math.random() * 0.5);
      }
      f.mistT = (f.mistT ?? 0) + dt;
    }
  }

  serialize() {
    return {
      level: this.level,
      ponds: this.ponds.map((p) => {
        const f = this.terrain.field;
        const n = [...p.cells][0];
        return f.toWorld(n % f.cols, Math.floor(n / f.cols));
      }),
      falls: this.falls.map((f) => f.src.toArray()),
    };
  }
}

const NB4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const NB8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [k[p], k[i]] = [k[i], k[p]]; [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop() {
    const k = this.k, v = this.v;
    const top = [k[0], v[0]];
    const lk = k.pop(), lv = v.pop();
    if (k.length) {
      k[0] = lk; v[0] = lv;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < k.length && k[l] < k[m]) m = l;
        if (r < k.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]]; [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}
