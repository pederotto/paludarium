// Hydraulics: where the tank's water is and how it moves.
//
// The tank holds a fixed amount of water. Most of it sits in the main pool
// (the "reservoir": every cell connected to the pump that lies below its
// flat surface). A pump in the main pool lifts water to outlets on the
// hardscape or the background; from there it runs over the substrate,
// fills hollows until they spill, runs down channels, pours off ledges and
// finally returns to the main pool. Water in pools and streams is taken out
// of the main pool, so its level drops as the upper pools fill.
//
// Water outside the main pool is simulated with the "virtual pipes" shallow
// water model (Mei, Decaudin & Hu, "Fast Hydraulic Erosion Simulation and
// Visualization on GPU", 2007), the method used by open-source terrain
// simulators such as LanLou123/Webgl-Erosion and bshishov/UnityTerrainErosionGPU:
// every cell keeps the flow through four virtual pipes to its neighbours; the
// flow accelerates with the difference in water surface height, and it is
// scaled down so a cell never gives away more water than it holds. Where the
// ground drops away steeply (a ledge), the water leaves the surface and lands
// at the foot of the drop, which is how waterfalls form.

import * as THREE from 'three/webgpu';
import { TANK } from './tank.js';

const G = 981;                // cm/s²
const DAMP = 0.992;           // pipe friction per sub-step
const SUB_DT = 1 / 240;       // s
const JUMP = 1.6;             // cm of drop between neighbouring cells that makes water leave the surface
export const WET = 0.05;      // cm: thinner films count as dry
const NB8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

export class Hydro {
  constructor(world) {
    this.world = world;
    const f = world.terrain.field;
    this.f = f;
    const N = f.cols * f.rows;
    this.N = N;
    this.area = f.da * f.db;
    this.d = new Float32Array(N);          // water depth outside the main pool (cm)
    this.flux = new Float32Array(N * 4);   // outflow through each pipe (cm³/s): +x, -x, +z, -z
    this.vx = new Float32Array(N);         // flow velocity (cm/s), for shading
    this.vz = new Float32Array(N);
    this.res = new Uint8Array(N);          // 1: part of the main pool
    this.fl = new Float32Array(N);         // level the main pool must reach to flood this cell
    this.jump = new Int32Array(N * 4).fill(-1);
    this.nb = new Int32Array(N * 4).fill(-1);
    for (let j = 0; j < f.rows; j++) for (let i = 0; i < f.cols; i++) {
      const n = j * f.cols + i, o = n * 4;
      if (i < f.nx) this.nb[o] = n + 1;
      if (i > 0) this.nb[o + 1] = n - 1;
      if (j < f.ny) this.nb[o + 2] = n + f.cols;
      if (j > 0) this.nb[o + 3] = n - f.cols;
    }
    this.level = 0;
    this.resVol = 0;                       // cm³ in the main pool
    this.pump = { on: true, rate: 160, intake: null, running: false }; // rate in L/h
    this.outlets = [];                     // { pos, wall, cell, pts }
    this.topUp = true;
    this.targetTotal = 0;                  // cm³ the top-up keeps
    this.pools = [];
    this.falls = [];
    this.flowOut = 0;                      // cm³/s currently pumped
    this._poolT = 0;
    this.rebuild();
  }

  cellOf(x, z) {
    const f = this.f;
    const [fi, fj] = f.toGrid(x, z);
    const i = Math.max(0, Math.min(f.nx, Math.round(fi))), j = Math.max(0, Math.min(f.ny, Math.round(fj)));
    return j * f.cols + i;
  }
  cellXZ(n) { return this.f.toWorld(n % this.f.cols, Math.floor(n / this.f.cols)); }

  // Where the pump sits: its own cell, or the deepest point of the tank.
  intakeCell() {
    if (this.pump.intake) return this.cellOf(this.pump.intake.x, this.pump.intake.z);
    const h = this.f.h;
    let best = 0;
    for (let n = 1; n < this.N; n++) if (h[n] < h[best]) best = n;
    return best;
  }

  // --- After the ground changed ----------------------------------------------
  rebuild() {
    this.computeFlood();
    this.computeJumps();
    for (const o of this.outlets) this.placeOutlet(o);
    this.solveLevel();
    this.updateMembership();
  }

  // Priority flood from the pump: the lowest level at which the main pool
  // reaches each cell (the highest ground on the best path to it).
  computeFlood() {
    const { h } = this.f, fl = this.fl, nb = this.nb;
    fl.fill(Infinity);
    const heap = new MinHeap();
    const s = this.intakeCell();
    this.seed = s;
    fl[s] = h[s];
    heap.push(h[s], s);
    while (heap.size) {
      const [lv, n] = heap.pop();
      if (lv > fl[n]) continue;
      for (let k = 0; k < 4; k++) {
        const m = nb[n * 4 + k];
        if (m < 0) continue;
        const v = Math.max(lv, h[m]);
        if (v < fl[m]) { fl[m] = v; heap.push(v, m); }
      }
    }
    this.order = Uint32Array.from({ length: this.N }, (_, i) => i).sort((a, b) => fl[a] - fl[b]);
  }

  // Steep drops: water leaving cell n toward neighbour k falls to the foot
  // of the slope instead of trickling down its face.
  computeJumps() {
    const { h, cols, nx, ny } = this.f;
    const jump = this.jump.fill(-1);
    this.dropH = this.dropH ?? new Float32Array(this.N * 4);
    for (let n = 0; n < this.N; n++) {
      for (let k = 0; k < 4; k++) {
        const m = this.nb[n * 4 + k];
        if (m < 0 || h[n] - h[m] < JUMP) continue;
        let cur = m;
        for (let s = 0; s < 80; s++) {
          const i = cur % cols, j = Math.floor(cur / cols);
          let best = -1, bd = 0.5;
          for (const [di, dj] of NB8) {
            const ni = i + di, nj = j + dj;
            if (ni < 0 || nj < 0 || ni > nx || nj > ny) continue;
            const q = nj * cols + ni;
            const drop = (h[cur] - h[q]) / (di && dj ? 1.414 : 1);
            if (drop > bd) { bd = drop; best = q; }
          }
          if (best < 0) break;
          cur = best;
        }
        jump[n * 4 + k] = cur;
        this.dropH[n * 4 + k] = h[n] - h[cur];
      }
    }
  }

  // --- Main pool volume ↔ level ------------------------------------------------
  volumeAt(L) {
    const { h } = this.f, fl = this.fl;
    let v = 0;
    for (const n of this.order) { if (!(fl[n] < L)) break; v += L - h[n]; }
    return v * this.area;
  }

  levelFor(V) {
    const { h } = this.f, fl = this.fl, o = this.order;
    const base = h[this.seed];
    if (V <= 0) return base;
    let c = 0, sum = 0;
    const va = V / this.area;
    for (let i = 0; i < o.length; i++) {
      const n = o[i];
      if (!Number.isFinite(fl[n])) break;
      c++; sum += h[n];
      const L = (va + sum) / c;
      const next = i + 1 < o.length ? fl[o[i + 1]] : Infinity;
      if (L <= next) return Math.min(L, TANK.h - 1);
    }
    return TANK.h - 1;
  }

  solveLevel() { this.level = this.levelFor(this.resVol); }

  setLevel(y) {
    this.resVol = this.volumeAt(Math.max(this.f.h[this.seed], Math.min(TANK.h - 6, y)));
    this.solveLevel();
    this.updateMembership();
    this.targetTotal = this.total();
  }

  // Cells join the main pool when it rises over them (their water merges
  // into it) and leave it when it drops (a cut-off hollow keeps its water).
  updateMembership() {
    const { h } = this.f, fl = this.fl, d = this.d, res = this.res;
    const L = this.level;
    let changed = false;
    for (let n = 0; n < this.N; n++) {
      const inside = fl[n] < L ? 1 : 0;
      if (inside === res[n]) continue;
      if (inside) { this.resVol += d[n] * this.area; d[n] = 0; } else {
        // Only a hollow behind a sill keeps water (up to the sill).
        d[n] = Math.max(0, Math.min(this.prevLevel ?? L, fl[n]) - h[n]);
        this.resVol = Math.max(0, this.resVol - d[n] * this.area);
      }
      res[n] = inside;
      changed = true;
    }
    if (changed) this.solveLevel();
    this.prevLevel = this.level;
  }

  total() {
    let v = this.resVol;
    const d = this.d, a = this.area;
    for (let n = 0; n < this.N; n++) v += d[n] * a;
    return v;
  }

  // --- Outlets -------------------------------------------------------------------
  // An outlet on the background runs down the wall face first and lands on
  // the substrate; one on the ground or a rock wells up where it is.
  addOutlet(pos, wall = false) {
    const o = { pos: pos.clone(), wall, share: 1 };
    this.placeOutlet(o);
    this.outlets.push(o);
    return o;
  }

  removeOutlet(o) { this.outlets.splice(this.outlets.indexOf(o), 1); }

  placeOutlet(o) {
    const W = this.world;
    if (!o.wall) { o.cell = this.cellOf(o.pos.x, o.pos.z); o.pts = null; return; }
    const T = W.terrain, Wl = W.wall;
    const pts = [];
    const p = o.pos.clone();
    for (let s = 0; s < 200; s++) {
      p.z = Math.max(p.z, Wl.zAt(p.x, p.y) + 0.7);
      pts.push(p.clone());
      if (p.y <= T.heightAt(p.x, p.z) + 0.2 || p.y <= 0.2) break;
      if (this.level > p.y && this.res[this.cellOf(p.x, p.z)]) break;
      p.y -= 0.6;
    }
    o.pts = pts;
    o.cell = this.cellOf(p.x, p.z);
  }

  nearestOutlet(p, maxD = 3) {
    let best = null, bd = maxD;
    for (const o of this.outlets) {
      const pts = o.pts ?? [o.pos];
      for (const q of pts) { const d = q.distanceTo(p); if (d < bd) { bd = d; best = o; } }
    }
    return best;
  }

  // --- Simulation ------------------------------------------------------------------
  step(dt) {
    if (dt <= 0) return;
    const { h } = this.f, d = this.d, F = this.flux, res = this.res, nb = this.nb, jump = this.jump;
    const area = this.area, N = this.N;
    const kA = G * this.f.da;
    // The pump runs while its intake is under water.
    const Q = this.pump.rate * 1000 / 3600;
    const pumpOk = this.pump.on && this.outlets.length > 0 && this.level > h[this.seed] + 2.5;
    this.pump.running = pumpOk;
    this.flowOut = pumpOk ? Q : 0;
    const steps = Math.min(10, Math.ceil(dt / SUB_DT));
    const sdt = dt / steps;
    let intoPool = 0;
    for (let s = 0; s < steps; s++) {
      // Sources.
      if (pumpOk) {
        const q = Math.min(Q * sdt, this.resVol);
        this.resVol -= q;
        const per = q / this.outlets.length;
        for (const o of this.outlets) {
          if (res[o.cell]) intoPool += per; else d[o.cell] += per / area;
        }
      }
      // Pipe flows.
      for (let n = 0; n < N; n++) {
        const o = n * 4;
        if (res[n] || d[n] <= 1e-6) { F[o] = F[o + 1] = F[o + 2] = F[o + 3] = 0; continue; }
        const sn = h[n] + d[n];
        let tot = 0;
        for (let k = 0; k < 4; k++) {
          const m = nb[o + k];
          if (m < 0) { F[o + k] = 0; continue; }
          const sm = res[m] ? Math.max(this.level, h[m]) : h[m] + d[m];
          let v = F[o + k] * DAMP + sdt * kA * (sn - sm);
          if (v < 0) v = 0;
          F[o + k] = v;
          tot += v;
        }
        const maxOut = d[n] * area / sdt;
        if (tot > maxOut) {
          const K = maxOut / tot;
          F[o] *= K; F[o + 1] *= K; F[o + 2] *= K; F[o + 3] *= K;
        }
      }
      // Move the water.
      for (let n = 0; n < N; n++) {
        const o = n * 4;
        for (let k = 0; k < 4; k++) {
          const f = F[o + k];
          if (!f) continue;
          const q = f * sdt;
          d[n] -= q / area;
          const t = jump[o + k] >= 0 ? jump[o + k] : nb[o + k];
          if (res[t]) intoPool += q; else d[t] += q / area;
        }
        if (d[n] < 0) d[n] = 0;
      }
    }
    // Thin films soak into the substrate and drain down to the main pool
    // (a real paludarium's substrate sits on a drainage layer).
    for (let n = 0; n < N; n++) {
      if (!res[n] && d[n] > 0 && d[n] < 0.004) { intoPool += d[n] * area; d[n] = 0; }
    }
    this.resVol += intoPool;
    this.solveLevel();
    this.updateMembership();
    this.velocities();
    this._poolT -= dt;
    if (this._poolT <= 0) { this._poolT = 0.4; this.findPools(); this.findFalls(); }
  }

  velocities() {
    const F = this.flux, nb = this.nb, d = this.d, l = this.f.da;
    for (let n = 0; n < this.N; n++) {
      if (d[n] < WET) { this.vx[n] = this.vz[n] = 0; continue; }
      const o = n * 4;
      const L = nb[o + 1], R = nb[o], B = nb[o + 3], Fr = nb[o + 2];
      const fx = F[o] - F[o + 1] + (L >= 0 ? F[L * 4] : 0) - (R >= 0 ? F[R * 4 + 1] : 0);
      const fz = F[o + 2] - F[o + 3] + (B >= 0 ? F[B * 4 + 2] : 0) - (Fr >= 0 ? F[Fr * 4 + 3] : 0);
      const k = 1 / (2 * Math.max(d[n], 0.1) * l);
      this.vx[n] = fx * k;
      this.vz[n] = fz * k;
    }
  }

  // Evaporation (game minutes), with an optional automatic top-up like the
  // float valve of a real tank.
  evaporate(minutes, humidity, temp, openArea) {
    const rate = openArea * 1e-5 * Math.max(0.05, 1 - humidity / 100) * (1 + Math.max(0, temp - 20) * 0.05);
    this.resVol = Math.max(0, this.resVol - rate * minutes * 60);
    if (this.topUp && this.targetTotal > 0) {
      const lack = this.targetTotal - this.total();
      if (lack > 0) this.resVol += lack;
    }
  }

  // --- Reading the water ----------------------------------------------------------
  depthAt(x, z) {
    const n = this.cellOf(x, z);
    if (this.res[n]) return Math.max(0, this.level - this.world.terrain.heightAt(x, z));
    return this.d[n];
  }

  // Surface height at (x, z) or -Infinity when dry (films thinner than minD).
  surfaceAt(x, z, minD = 0.3) {
    const n = this.cellOf(x, z);
    const g = this.world.terrain.heightAt(x, z);
    if (this.res[n]) return this.level > g + 0.05 ? this.level : -Infinity;
    return this.d[n] > minD ? Math.max(g, this.f.h[n]) + this.d[n] : -Infinity;
  }

  // Connected bodies of standing water outside the main pool.
  findPools() {
    const d = this.d, res = this.res, nb = this.nb, h = this.f.h;
    const seen = new Uint8Array(this.N);
    const pools = [];
    for (let n = 0; n < this.N; n++) {
      if (seen[n] || res[n] || d[n] < 0.6) continue;
      const cells = [];
      const stack = [n];
      seen[n] = 1;
      let lv = 0, vol = 0;
      while (stack.length) {
        const c = stack.pop();
        cells.push(c);
        lv += h[c] + d[c];
        vol += d[c];
        for (let k = 0; k < 4; k++) {
          const m = nb[c * 4 + k];
          if (m >= 0 && !seen[m] && !res[m] && d[m] >= 0.6) { seen[m] = 1; stack.push(m); }
        }
      }
      if (cells.length < 5) continue;
      pools.push({ cells, level: lv / cells.length, litres: vol * this.area / 1000, area: cells.length * this.area });
    }
    this.pools = pools;
  }

  // Waterfalls: groups of neighbouring ledge cells pouring the same way.
  findFalls() {
    const F = this.flux, jump = this.jump, cols = this.f.cols;
    const lip = new Map();
    for (let n = 0; n < this.N; n++) {
      if (this.res[n]) continue;
      for (let k = 0; k < 4; k++) {
        const o = n * 4 + k;
        if (jump[o] >= 0 && F[o] > 1.5 && this.dropH[o] > 2.2) lip.set(o, F[o]);
      }
    }
    const falls = [];
    const used = new Set();
    for (const [o0] of lip) {
      if (used.has(o0)) continue;
      const k = o0 % 4;
      // Walk sideways (across the flow) to collect the whole lip.
      const side = k < 2 ? cols : 1;
      const group = [];
      const stack = [o0];
      used.add(o0);
      while (stack.length) {
        const o = stack.pop();
        group.push(o);
        const n = (o - k) / 4;
        for (const m of [n + side, n - side]) {
          const q = m * 4 + k;
          if (m >= 0 && m < this.N && lip.has(q) && !used.has(q)) { used.add(q); stack.push(q); }
        }
      }
      let q = 0, x = 0, z = 0, y = 0, lx = 0, lz = 0, ly = 0;
      for (const o of group) {
        const n = (o - k) / 4;
        const w = F[o];
        const [cx, cz] = this.cellXZ(n);
        q += w; x += cx * w; z += cz * w; y += (this.f.h[n] + this.d[n]) * w;
        const t = jump[o];
        const [tx, tz] = this.cellXZ(t);
        lx += tx * w; lz += tz * w; ly += this.f.h[t] * w;
      }
      const dir = [[1, 0], [-1, 0], [0, 1], [0, -1]][k];
      falls.push({
        q, dir, width: Math.max(1, group.length * this.f.da),
        from: new THREE.Vector3(x / q, y / q, z / q),
        to: new THREE.Vector3(lx / q, ly / q, lz / q),
        key: `${k}:${Math.round(x / q / 2)}:${Math.round(z / q / 2)}:${group.length}`,
      });
    }
    this.falls = falls.sort((a, b) => b.q - a.q).slice(0, 12);
  }

  // --- Where would water from here go? ---------------------------------------------
  // Follows the steepest way down; in a hollow it fills the basin up to its
  // spill point and carries on from there. Used by the preview and by Fill.
  trace(x, z, { maxPits = 6 } = {}) {
    const { h, cols, nx, ny } = this.f;
    let n = this.cellOf(x, z);
    const path = [];
    const pits = [];
    const seen = new Set();
    for (let s = 0; s < 3000; s++) {
      const [cx, cz] = this.cellXZ(n);
      path.push(new THREE.Vector3(cx, h[n] + 0.35, cz));
      if (this.res[n]) return { path, pits, end: 'pool' };
      seen.add(n);
      const i = n % cols, j = Math.floor(n / cols);
      let best = -1, bh = h[n] - 1e-4;
      for (const [di, dj] of NB8) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni > nx || nj > ny) continue;
        const q = nj * cols + ni;
        if (h[q] < bh) { bh = h[q]; best = q; }
      }
      if (best >= 0) { n = best; continue; }
      if (pits.length >= maxPits) return { path, pits, end: 'pits' };
      const pit = this.basin(n);
      if (!pit) return { path, pits, end: 'open' };
      pits.push(pit);
      if (pit.spillCell < 0 || seen.has(pit.spillCell)) return { path, pits, end: 'full' };
      n = pit.spillCell;
    }
    return { path, pits, end: 'far' };
  }

  // The basin around cell `start`: grow from the lowest neighbour and
  // remember the highest ground crossed; once the next cell is lower than
  // that, water would spill out there.
  basin(start, MAX = 4000) {
    const { h } = this.f, nb = this.nb;
    const heap = new MinHeap();
    const seen = new Set([start]);
    const order = [];
    heap.push(h[start], start);
    let spill = h[start], spillCell = -1;
    while (heap.size) {
      const [hv, n] = heap.pop();
      if (hv < spill - 0.001 && order.length) { spillCell = n; break; }
      if (this.res[n]) { spillCell = n; break; }
      spill = Math.max(spill, hv);
      order.push(n);
      if (order.length > MAX) return null;
      for (let k = 0; k < 4; k++) {
        const m = nb[n * 4 + k];
        if (m < 0 || seen.has(m)) continue;
        seen.add(m);
        heap.push(h[m], m);
      }
    }
    const level = spill;
    const cells = order.filter((c) => h[c] < level);
    let vol = 0;
    for (const c of cells) vol += level - h[c];
    return { level, cells, spillCell, litres: vol * this.area / 1000, bottom: h[start] };
  }

  // Fills the hollow under (x, z) right away with water from the main pool.
  fillAt(x, z) {
    const t = this.trace(x, z, { maxPits: 1 });
    const pit = t.pits[0];
    if (!pit) return { error: t.end === 'pool' ? 'Water from there runs straight into the main pool.' : 'No hollow there to hold water. Dig one first.' };
    return this.fillPit(pit);
  }

  fillPit(pit) {
    const { h } = this.f, d = this.d;
    let need = 0;
    const lv = pit.level - 0.05;
    for (const c of pit.cells) need += Math.max(0, lv - h[c] - d[c]);
    need *= this.area;
    if (need < 1) return { error: 'That hollow is already full.' };
    if (need > this.resVol * 0.8) return { error: 'Not enough water in the main pool for that. Raise the water level first.' };
    for (const c of pit.cells) d[c] = Math.max(d[c], lv - h[c]);
    this.resVol -= need;
    this.solveLevel();
    this.updateMembership();
    this.findPools();
    return { litres: need / 1000 };
  }

  // Fills every hollow the outlets feed, in order, so a new layout starts
  // with its pools full instead of taking minutes to fill.
  prime() {
    for (const o of this.outlets) {
      const [x, z] = this.cellXZ(o.cell);
      const t = this.trace(x, z);
      for (const pit of t.pits) this.fillPit(pit);
    }
  }

  drainPool(pool) {
    let v = 0;
    for (const c of pool.cells) { v += this.d[c]; this.d[c] = 0; }
    this.resVol += v * this.area;
    this.solveLevel();
    this.updateMembership();
    this.findPools();
  }

  poolAt(x, z) {
    const n = this.cellOf(x, z);
    return this.pools.find((p) => p.cells.includes(n)) ?? null;
  }

  // --- Save / load -----------------------------------------------------------------
  serialize() {
    const q = new Uint16Array(this.N);
    for (let n = 0; n < this.N; n++) q[n] = Math.min(65535, Math.round(this.d[n] * 200));
    return {
      resVol: Math.round(this.resVol), d: b64(q.buffer), target: Math.round(this.targetTotal), topUp: this.topUp,
      pump: { on: this.pump.on, rate: this.pump.rate, intake: this.pump.intake ? [this.pump.intake.x, this.pump.intake.z] : null },
      outlets: this.outlets.map((o) => ({ p: o.pos.toArray().map((v) => +v.toFixed(2)), w: o.wall })),
    };
  }

  deserialize(o) {
    this.pump.on = o.pump?.on ?? true;
    this.pump.rate = o.pump?.rate ?? 160;
    this.pump.intake = o.pump?.intake ? { x: o.pump.intake[0], z: o.pump.intake[1] } : null;
    this.topUp = o.topUp ?? true;
    this.outlets = [];
    this.computeFlood();
    this.computeJumps();
    for (const q of o.outlets ?? []) this.addOutlet(new THREE.Vector3(...q.p), q.w);
    this.d.fill(0);
    if (o.d) {
      const q = new Uint16Array(unb64(o.d));
      if (q.length === this.N) for (let n = 0; n < this.N; n++) this.d[n] = q[n] / 200;
    }
    this.res.fill(0);
    this.resVol = o.resVol ?? 0;
    this.solveLevel();
    this.updateMembership();
    this.targetTotal = o.target || this.total();
    this.findPools();
  }
}

function b64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(str) {
  const s = atob(str);
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b.buffer;
}

export class MinHeap {
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
