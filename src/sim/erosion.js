// Erosion, sediment and deposition on top of the shallow-water step (hydro.js).
//
// The model is the Mei, Decaudin & Hu (2007) family used by LanLou123/Webgl-Erosion
// and bshishov/UnityTerrainErosionGPU, run as a coarse, mostly local pass:
//  * every wet cell carries suspended sediment `s` (cm of soil spread over the cell);
//  * the water's transport capacity grows with flow speed and slope and shrinks in
//    thin or still water; below capacity the bed gives up soil (rate by material
//    hardness: rock and dark stone never, gravel a little, sand and soil a lot,
//    moss, root mats and anything stamped by hardscape resist), above capacity
//    the sediment settles (sand fans at the mouth of a stream, silt in still ponds);
//  * sediment rides the same pipe fluxes as the water (so it falls down ledges
//    and lands in plunge pools) and settles slowly in the main pool;
//  * loose ground that is too steep slumps (support.js).
// Soil volume is conserved: sum(base) + sum(s) only changes by player edits.
//
// Time: the flow field is the steady circuit, so one game minute is treated as one
// "virtual second" of flow (never less than the real step). That keeps results the
// same whatever the game speed; the work per frame is bounded (at most 24 sweeps
// over the wet cells, a few times per second).
//
// Pure data and arithmetic (no scene): the tests run it under Node.

import { MAT, NMAT } from './tank.js';
import { NODE } from './waterbodies.js';
import { retainMap, slumpPass, stressMap, paintMat, dominant } from './support.js';
import { clamp } from '../util/math.js';

export const WET = 0.05;
const WINDOW = 0.2;                     // seconds of hydro time that make one run
export const HARD = [1.0, 1.5, 0.3, 0, 0.12, 0];   // soil, sand, gravel, rock, moss, dark stone
export const ERO = {
  Kc: 0.03,        // cm of sediment a fast, steep, deep-enough flow carries
  vCrit: 5,        // cm/s: slower water carries nothing
  Kr: 0.0045,      // erosion rate per virtual second (towards capacity)
  Kd: 0.35,        // deposition rate in flowing water
  KdStill: 0.12,   // ... in still ponds
  Kpool: 0.03,     // settling rate in the main pool
  floor: 0.5,      // cm: the bed never goes below this
  armor: 1.5,      // cm eroded at which the bed has half its first resistance
  maxCum: 4,       // cm: the soil layer over the false bottom
  turbK: 15,       // sediment per depth of water in one cell (cm per cm) to cloudiness
  bodyK: 4e4,      // sediment per volume of a whole body (cm3 per cm3) to cloudiness (a pond dilutes it)
};
const NN = NODE.MAX;

export class Erosion {
  constructor(H, opt = {}) {
    this.H = H;
    const f = this.f = H.f;
    const N = this.N = H.N;
    this.area = f.da * f.db;
    this.s = new Float32Array(N);        // suspended sediment (cm)
    this.cum = new Float32Array(N);      // net depth eroded so far (cm): the bed armours as it goes
    this.last = f.base.slice();          // the ground as we left it (to notice the player's edits)
    this.committed = f.base.slice();     // the ground as the water and the mesh last saw it (see markCommitted)
    this.root = new Float32Array(N);     // 0..1 root mat cover
    this.ret = new Float32Array(N);      // 0..1 retained by rock or roots
    this.grand = new Float32Array(N).fill(1);   // as-built allowance on the angle of repose (see run)
    this.cap = new Float32Array(N);
    this.eroda = new Float32Array(N);
    this.risk = new Float32Array(N);     // 0..1+ how hard the flow works on the bed (for the lens)
    this.eT = new Float32Array(N);
    this.dT = new Float32Array(N);
    this.dz = new Float32Array(N);
    this.add = new Float32Array(N);
    this.wet = new Int32Array(N);
    this.pool = new Int32Array(N);
    this.touched = new Int32Array(N * 4);
    this.nWet = 0; this.nPool = 0;
    this.strength = opt.strength ?? 1;   // 0 off, 0.5, 1, 2
    this.acc = { dt: 0, gm: 0 };
    this.age = 0;
    this.retT = 0;
    this.events = [];                    // slumps to show: { x, z, y, v }
    this.sedNode = new Float64Array(NN);
    this.volNode = new Float64Array(NN);
    this.depNode = new Float64Array(NN);
    this.turb = 0;                       // 0..1 mean cloudiness of all the water
    this.filterK = 0;                    // share of the main pool's silt the filter takes out per second of flow (sim.js)
    this.caught = 0;                     // silt it took (cm3), collected by sim.js
    this.stats = { eroded: 0, deposited: 0, slumped: 0, suspended: 0, runs: 0 };
    this.ev = [];
  }

  get enabled() { return this.strength > 0; }

  setStrength(v) {
    this.strength = v;
    if (v <= 0) this.flush();
  }

  // Drops all suspended sediment onto the bed where it is (erosion switched off).
  flush() {
    const B = this.f.base, s = this.s;
    let any = false;
    for (let n = 0; n < this.N; n++) if (s[n] > 0) { const nb2 = Math.fround(B[n] + s[n]); s[n] -= nb2 - B[n]; B[n] = nb2; any = true; }
    this.last.set(B);
    this.turb = 0;
    return any;
  }

  // Root mats: rooted plants hold the ground around them. `list` has { pos, grown, scale }.
  setRoots(list, rooted = () => true) {
    const f = this.f, root = this.root;
    root.fill(0);
    for (const p of list) {
      if (!rooted(p)) continue;
      const r = clamp(1.5 + 2.5 * (p.grown ?? 0.5) * Math.min(1.5, p.scale ?? 1), 1.5, 5.5);
      const [ci, cj] = f.toGrid(p.pos.x, p.pos.z);
      const ri = Math.ceil(r / f.da), rj = Math.ceil(r / f.db);
      for (let j = Math.max(0, Math.floor(cj) - rj); j <= Math.min(f.ny, Math.ceil(cj) + rj); j++) {
        for (let i = Math.max(0, Math.floor(ci) - ri); i <= Math.min(f.nx, Math.ceil(ci) + ri); i++) {
          const dd = Math.hypot((i - ci) * f.da, (j - cj) * f.db) / r;
          if (dd >= 1) continue;
          const v = 0.8 * (1 - dd * dd);
          const n = j * f.cols + i;
          if (v > root[n]) root[n] = v;
        }
      }
    }
    this.retT = 0;
  }

  hardness(n) {
    const mat = this.f.mat;
    if (!mat) return 1;
    let a = 0;
    for (let m = 0; m < NMAT; m++) a += mat[n * NMAT + m] * HARD[m];
    return a;
  }

  // Called every frame with the hydro seconds and game minutes elapsed; they gather until take() has a window.
  gather(dt, gm) { this.acc.dt += dt; this.acc.gm += gm; }

  // The live game's way in: flow time is accumulated every frame (cheap), and when a window has gathered it becomes a job
  // (a generator, see steps) that the caller shares out in small pieces (jobs.js). Erosion is slow and needs no real time:
  // while a job is still working, further flow time simply keeps adding up and the next job covers all of it.
  // Returns null until a window is ready, then { dt, T } (and clears the accumulator).
  take() {
    const A = this.acc;
    if (A.dt < WINDOW) return null;
    const T = Math.max(A.dt, A.gm), dt = A.dt;
    A.dt = 0; A.gm = 0;
    return { dt, T };
  }

  // Forgets the flow time gathered so far and everything pending (the ground is about to be replaced). The ground as we
  // left it is forgotten too, so the next run takes whatever it finds as a whole new ground, built that way and stable as it
  // stands, as in a new world, and not as a few cells the player sculpted (which lose their allowance on the angle of repose).
  reset() {
    this.acc.dt = 0; this.acc.gm = 0;
    this.events.length = 0; this.ev.length = 0;
    this.eT.fill(0); this.dT.fill(0);
    this.last.fill(NaN);
  }

  // The ground as the water and the mesh last saw it (set when a change is applied, see Water.commit).
  markCommitted() { this.committed.set(this.f.base); }

  // The largest change to any cell since then, in cm: how much a refresh would actually show.
  drift() {
    const B = this.f.base, C = this.committed;
    let m = 0;
    for (let n = 0; n < B.length; n++) { const d = Math.abs(B[n] - C[n]); if (d > m) m = d; }
    return m;
  }

  // dt: hydro seconds; T: virtual seconds of flow they stand for. Returns true when the ground changed.
  // All in one go (tests, tools); the game uses steps() so a run never costs a frame more than a slice.
  run(dt, T) {
    const g = this.steps(dt, T);
    for (;;) { const r = g.next(); if (r.done) return r.value; }
  }

  // The same run as a generator: it yields between its phases (scan, capacity, each sweep, the pool, the paint, each slump
  // pass) and returns whether the ground changed. Every yield is a point where soil is conserved (bed + suspended).
  *steps(dt, T) {
    const S = this.strength * (this.scale ?? 1);   // scale: the mode's multiplier (modes.js), 1 by default
    if (S <= 0) return false;
    const H = this.H, f = this.f, B = f.base, h = f.h, st = f.stamped, N = this.N, area = this.area, cols = f.cols;
    const d = H.d, res = H.res, nb = H.nb, F = H.flux, jump = H.jump, vx = H.vx, vz = H.vz;
    const s = this.s, cum = this.cum, last = this.last, cap = this.cap, eroda = this.eroda, risk = this.risk;
    const wet = this.wet, pool = this.pool, add = this.add, touched = this.touched;
    const maxH = f.maxH ?? 1e9;
    this.age += dt;
    this.retT -= dt;
    if (this.retT <= 0) { this.retT = 2.5; retainMap(f, this.root, this.ret); yield; }
    this.depNode.fill(0);
    let ero = 0, dep = 0;
    // --- Scan: which cells are wet, which pool cells hold sediment; the player's edits reset the armour.
    let nW = 0, nP = 0, nCh = 0;
    for (let n = 0; n < N; n++) {
      if (B[n] !== last[n]) { cum[n] = 0; nCh++; this.dz[n] = 1; } else this.dz[n] = 0;
      if (res[n]) { if (s[n] > 1e-7) pool[nP++] = n; continue; }
      if (d[n] > WET) { wet[nW++] = n; continue; }
      if (s[n] > 0) { const nb2 = Math.fround(B[n] + s[n]), real = nb2 - B[n]; B[n] = nb2; s[n] -= real; dep += real; this.depNode[H.grp[n]] += real * area; }   // the water left: it settles where it is
    }
    this.nWet = nW; this.nPool = nP;
    yield;
    // The player's sculpting (a few cells) loses the as-built allowance; a whole new ground (a generated,
    // loaded or restored tank: most cells changed at once) is taken as built and stable as it stands.
    if (nCh > 0) {
      if (nCh > 0.25 * N) {
        retainMap(f, this.root, this.ret); this.retT = 2.5;
        this.grand.fill(1);
        const st0 = stressMap(f, this.ret, this.add);
        for (let n = 0; n < N; n++) this.grand[n] = 1.6 * Math.max(1, st0[n]);
        this.add.fill(0);
        this.stats.rebuilt = (this.stats.rebuilt ?? 0) + 1;
      } else {
        const { nx, ny } = f;
        for (let n = 0; n < N; n++) {
          if (!this.dz[n]) continue;
          const i = n % cols, j = (n / cols) | 0;
          for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
            const ni = i + di, nj = j + dj;
            if (ni >= 0 && nj >= 0 && ni <= nx && nj <= ny) this.grand[nj * cols + ni] = 1;
          }
        }
      }
    }
    yield;
    // --- Capacity and erodibility, once per run (the flow field is steady over it).
    const da = f.da;
    risk.fill(0);
    for (let q = 0; q < nW; q++) {
      const n = wet[q];
      const v = Math.hypot(vx[n], vz[n]);
      let c = 0;
      if (v > ERO.vCrit) {
        const i = n % cols, j = (n / cols) | 0;
        const gx = (h[i < f.nx ? n + 1 : n] - h[i > 0 ? n - 1 : n]) / (da * ((i > 0 && i < f.nx) ? 2 : 1));
        const gz = (h[j < f.ny ? n + cols : n] - h[j > 0 ? n - cols : n]) / (f.db * ((j > 0 && j < f.ny) ? 2 : 1));
        const slope = Math.min(1, Math.hypot(gx, gz));
        const sp = Math.min(1.6, v / 30);
        c = ERO.Kc * sp * sp * (0.2 + slope) * clamp(d[n] / 0.5, 0.3, 1);
      }
      cap[n] = c;
      const hard = (st && st[n]) ? 0 : this.hardness(n) * (1 - 0.85 * this.root[n]) / (1 + Math.max(0, cum[n]) / ERO.armor) * (cum[n] > ERO.maxCum ? 0 : 1);
      eroda[n] = ERO.Kr * S * hard;
      risk[n] = Math.min(2, c * hard * S / 0.004);
    }
    yield;
    // --- Sweeps: exchange with the bed, then ride the pipes.
    const sweeps = clamp(Math.ceil(T / 0.25), 1, 24), ds = T / sweeps;
    for (let w = 0; w < sweeps; w++) {
      for (let q = 0; q < nW; q++) {
        const n = wet[q];
        const sn = s[n], c = cap[n];
        const stamped = st && st[n];
        if (sn < c) {
          const e0 = eroda[n];
          if (e0 > 0) {
            let e = e0 * (c - sn) * ds;
            const avail = Math.max(0, B[n] - ERO.floor);
            if (e > avail * 0.5) e = avail * 0.5;
            if (e > 0) { const nb2 = Math.fround(B[n] - e), real = B[n] - nb2; B[n] = nb2; s[n] = sn + real; cum[n] += real; this.eT[n] += real; ero += real; }
          }
          // Scour: fast water at the foot of a rock digs under it a little.
          if (c > 0.002 && !stamped) {
            const o = n * 4;
            for (let k = 0; k < 4; k++) {
              const m = nb[o + k];
              if (m < 0 || !st || !st[m] || cum[m] > 2.5) continue;
              let e = 0.3 * ERO.Kr * S * c * ds;
              const avail = Math.max(0, B[m] - ERO.floor);
              if (e > avail * 0.5) e = avail * 0.5;
              if (e > 0) { const nb2 = Math.fround(B[m] - e), real = B[m] - nb2; B[m] = nb2; s[n] += real; cum[m] += real; ero += real; }
            }
          }
        } else if (!stamped && sn > 0) {
          const rate = c > 0 ? ERO.Kd : ERO.KdStill;
          let dp = (sn - c) * Math.min(0.9, rate * ds);
          if (B[n] + dp > maxH) dp = Math.max(0, maxH - B[n]);
          if (dp > 0) {
            const nb2 = Math.fround(B[n] + dp), real = nb2 - B[n];
            B[n] = nb2; s[n] = sn - real; cum[n] -= real; this.dT[n] += real; dep += real;
            this.depNode[H.grp[n]] += real * area;
          }
        }
      }
      // Advection along the pipes (water leaving a cell takes its share of the sediment).
      let nt = 0;
      for (let q = 0; q < nW; q++) {
        const n = wet[q];
        const sn = s[n];
        if (sn < 1e-9) continue;
        const o = n * 4;
        const tot = F[o] + F[o + 1] + F[o + 2] + F[o + 3];
        if (tot <= 1e-6) continue;
        const frac = Math.min(0.95, (tot * ds) / (d[n] * area));
        const mv = sn * frac;
        s[n] = sn - mv;
        for (let k = 0; k < 4; k++) {
          const fk = F[o + k];
          if (!fk) continue;
          const t = jump[o + k] >= 0 ? jump[o + k] : nb[o + k];
          if (add[t] === 0) touched[nt++] = t;
          add[t] += mv * fk / tot;
        }
      }
      for (let i = 0; i < nt; i++) { const t = touched[i]; s[t] += add[t]; add[t] = 0; }
      yield;
    }
    // --- The main pool: sediment spreads a little and settles slowly.
    {
      let nt = 0;
      for (let i = 0; i < nP; i++) touched[nt++] = pool[i];
      for (let it = 0; it < 3; it++) {
        const m0 = nt;
        for (let i = 0; i < nt; i++) {
          const n = touched[i];
          if (!(s[n] > 1e-9)) continue;
          for (let k = 0; k < 4; k++) {
            const m = nb[n * 4 + k];
            if (m < 0 || !res[m]) continue;
            const fl = 0.12 * (s[n] - s[m]);
            if (fl <= 0) continue;
            if (add[m] === 0 && nt < touched.length) touched[nt++] = m;
            add[m] += fl; add[n] -= fl;
          }
        }
        for (let i = 0; i < nt; i++) { const t = touched[i]; if (add[t] !== 0) { s[t] += add[t]; add[t] = 0; } }
        void m0;
        yield;
      }
      const L = H.level;
      for (let i = 0; i < nt; i++) {
        const n = touched[i];
        const sn = s[n];
        if (!(sn > 1e-9) || !res[n]) continue;
        const depth = Math.max(0.2, L - h[n]);
        // The filter takes its share first: water it pumps comes back without the silt.
        const kf = this.filterK > 0 ? 1 - Math.exp(-this.filterK * T) : 0;
        if (kf > 0) { const c = sn * kf; s[n] = sn - c; this.caught += c * area; }
        const k = 1 - Math.exp(-ERO.Kpool * T / clamp(depth / 4, 0.3, 3));
        let dp = s[n] * k;
        if (st && st[n]) dp = 0;
        if (B[n] + dp > maxH) dp = Math.max(0, maxH - B[n]);
        if (dp > 0) { const nb2 = Math.fround(B[n] + dp), real = nb2 - B[n]; B[n] = nb2; s[n] -= real; cum[n] -= real; this.dT[n] += real; dep += real; this.depNode[NODE.SUMP] += real * area; }
      }
      // Remember where the pool's sediment is for the next run.
      let np = 0;
      for (let i = 0; i < nt; i++) { const n = touched[i]; if (s[n] > 1e-7 && res[n] && add[n] === 0) { add[n] = 1; pool[np++] = n; } }
      for (let i = 0; i < np; i++) add[pool[i]] = 0;
      this.nPool = np;
    }
    yield;
    // --- Material: sand fans where moving water drops its load, silt where it is still, lag gravel where it dug.
    const paint = (n) => {
      const dT = this.dT[n], eT = this.eT[n];
      if (dT > 0.0015) {
        const v = Math.hypot(vx[n], vz[n]);
        paintMat(f, n, v > ERO.vCrit * 1.2 ? MAT.sand : MAT.soil, clamp(dT * 25, 0, 0.5));
        this.dT[n] = 0;
      }
      if (eT > 0.002) {
        const dm = dominant(f, n);
        if (dm === MAT.soil || dm === MAT.sand) paintMat(f, n, MAT.gravel, clamp(eT * 6, 0, 0.25));
        this.eT[n] = 0;
      }
    };
    for (let q = 0; q < nW; q++) paint(wet[q]);
    for (let q = 0; q < this.nPool; q++) paint(this.pool[q]);
    yield;
    // --- Slumping.
    let slumped = 0;
    const passes = clamp(1 + Math.floor(T / 4), 1, 4);
    this.ev.length = 0;
    for (let p = 0; p < passes; p++) { slumped += slumpPass(f, this.ret, 0.35 * (this.slump ?? 1), this.dz, p === 0 ? this.ev : null, this.grand); yield; }
    if (this.ev.length) {
      this.ev.sort((a, b) => b[1] - a[1]);
      for (const [n, a] of this.ev.slice(0, 3)) {
        const [x, z] = H.cellXZ(n);
        this.events.push({ x, z, y: B[n], v: a * area });
      }
      if (this.events.length > 12) this.events.splice(0, this.events.length - 12);
    }
    last.set(B);
    // --- Books for the water bodies and the numbers shown.
    const sedNode = this.sedNode, volNode = this.volNode;
    sedNode.fill(0); volNode.fill(0);
    let sTot = 0;
    const grp = H.grp;
    for (let q = 0; q < nW; q++) { const n = wet[q]; sedNode[grp[n]] += s[n] * area; volNode[grp[n]] += d[n] * area; sTot += s[n]; }
    for (let q = 0; q < this.nPool; q++) { const n = this.pool[q]; sedNode[NODE.SUMP] += s[n] * area; sTot += s[n]; }
    volNode[NODE.SUMP] = H.resVol;
    let vTot = H.resVol;
    for (let q = 0; q < nW; q++) vTot += d[wet[q]] * area;
    this.turb = vTot > 1 ? 1 - Math.exp(-ERO.bodyK * (sTot * area) / vTot) : 0;
    H.bodies?.setSediment?.(sedNode, volNode, this.depNode, ERO.bodyK);
    const st2 = this.stats;
    st2.eroded += ero * area; st2.deposited += dep * area; st2.slumped += slumped; st2.suspended = sTot * area; st2.runs++;
    return ero > 0 || dep > 0 || slumped > 0;
  }

  // Cubic centimetres of soil in the ground and in suspension (should only change when you sculpt).
  volume() {
    let v = 0;
    const B = this.f.base, s = this.s;
    for (let n = 0; n < this.N; n++) v += B[n] + s[n];
    return v * this.area;
  }

  // A cloudiness 0..1 for one cell's water (for the pond mesh).
  turbAt(n) {
    const dd = this.H.res[n] ? Math.max(0.3, this.H.level - this.f.h[n]) : Math.max(0.3, this.H.d[n]);
    return 1 - Math.exp(-ERO.turbK * this.s[n] / dd);
  }
}
