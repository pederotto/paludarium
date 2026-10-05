// Decay and fertility on the ground: the slow chain that makes a terrarium
// soil rich.
//
//   dying plant parts, leaf drop, dead animals, uneaten food
//        -> litter (per cell)  -- rots, fast when warm and damp, slowly when
//                                cold, dry or waterlogged; stale and wet litter
//                                grows mould (env.mold) unless a clean-up crew
//                                (isopods, springtails) eats it
//        -> humus (per cell)   -- dark, rich soil; mineralises slowly
//        -> fertility (per cell) -- what plants and moss draw on; creeps
//                                downhill with soil water and diffuses a little
//
// The three fields live beside the soil moisture map in Climate (climate.js,
// 3 cm cells) and are saved with the tank. Everything here is plain arithmetic
// on those arrays, so it runs under Node for the tests: `world` only needs
// climate, env, animals.count(id), terrain.heightAt and plants.list.

import { TANK, sizeFactors } from './tank.js';
import { clamp } from '../util/math.js';


export const HUMUS = {
  rot: 0.28,          // litter lost per day at 22 C, damp, with air
  yield: 0.34,        // share of rotted litter that becomes humus (the rest is CO2)
  crewYield: 0.2,     // extra share when the crew eats it (frass)
  mineral: 0.06,      // humus mineralised into fertility per day
  humusLoss: 0.0015,  // humus lost per day regardless
  leach: 0.015,       // fertility washed away per day in wet soil
  cap: 4,             // most litter in one cell
};

// Temperature factor: doubles every 10 degrees, almost nothing when cold.
export const tempFactor = (T) => clamp(Math.pow(2, (T - 22) / 10), 0.06, 2.2);
// Moisture factor: dry soil keeps litter for months; waterlogged soil rots it slowly without air.
export const moistFactor = (s) => clamp(s * 1.7, 0.04, 1) * (s > 0.93 ? 0.7 : 1);

export class Humus {
  constructor(world) {
    this.world = world;
    this.acc = 0;
    this.rev = 0;           // bumped whenever the litter changed (the view re-scatters)
    this.crew = 0;
    this.stats = { litter: 0, humus: 0, fert: 0, crew: 0 };
    this.view = null;
  }
  get C() { return this.world.climate; }

  // --- Reading and writing the fields ------------------------------------------
  litterAt(x, z) { return this.C.sample(this.C.litter, x, z); }
  humusAt(x, z) { return this.C.sample(this.C.humus, x, z); }
  fertilityAt(x, z) { return this.C.sample(this.C.fert, x, z); }

  // Something rotting lands at (x, z): leaf litter on the ground, detritus if the cell is under water.
  // `landOnly` skips water cells (the caller already counted the detritus).
  drop(x, z, amount, landOnly = false) {
    const C = this.C, c = C.idx(x, z);
    if (!(amount > 0)) return;
    if ((C.f.water[c] ?? 0) > 0.4) {
      if (!landOnly && this.world.env) this.world.env.detritus += amount * 0.05;
      return;
    }
    C.litter[c] = Math.min(HUMUS.cap, C.litter[c] + amount);
    this.rev++;
  }

  // Plants (and moss) use up fertility where they stand.
  take(x, z, amount) {
    const C = this.C, c = C.idx(x, z);
    C.fert[c] = Math.max(0, C.fert[c] - amount);
  }

  // A fresh tank starts with a little leaf litter and humus under the plants.
  seed({ litter = 1, humus = 1 } = {}) {
    const W = this.world, C = this.C;
    C.litter.fill(0); C.humus.fill(0); C.fert.fill(0);
    const n = C.nx * C.nz;
    for (let c = 0; c < n; c++) {
      if ((C.f.water[c] ?? 0) > 0.4) continue;
      const i = c % C.nx, j = (c / C.nx) | 0;
      const noise = 0.5 + 0.5 * Math.sin(i * 1.7 + j * 0.9) * Math.cos(j * 1.3 - i * 0.4);
      C.humus[c] = humus * (0.08 + 0.1 * noise);
      C.litter[c] = litter * 0.05 * noise;
    }
    for (const p of W.plants.list) {
      if (p.surface === 'wall') continue;
      const size = Math.max(0.3, p.grown * p.scale);
      C.splat(C.litter, p.pos.x, p.pos.z, 7, litter * 0.28 * size);
      C.splat(C.humus, p.pos.x, p.pos.z, 8, humus * 0.22 * size);
    }
    for (let c = 0; c < n; c++) {
      if ((C.f.water[c] ?? 0) > 0.4) { C.litter[c] = C.humus[c] = 0; continue; }
      C.litter[c] = clamp(C.litter[c], 0, 1.5);
      C.humus[c] = clamp(C.humus[c], 0, 0.8);
      C.fert[c] = C.humus[c] * 0.75;
    }
    this.rev++;
    this.summarise();
    this.writeTexture();
  }

  reset() { const C = this.C; C.litter.fill(0); C.humus.fill(0); C.fert.fill(0); this.world.flies?.reset(); this.rev++; this.summarise(); this.writeTexture(); }

  // --- The clock -----------------------------------------------------------------
  step(dtMin) {
    this.acc += dtMin;
    if (this.acc < 30) return;
    const dt = this.acc; this.acc = 0;
    this.process(dt);
  }

  // dtMin game minutes of decay over every cell.
  process(dtMin) {
    const W = this.world, C = this.C, E = W.env, days = dtMin / 1440;
    const n = C.nx * C.nz, { litter: L, humus: H, fert: F } = C;
    const count = (id) => { try { return W.animals?.count?.(id) ?? 0; } catch { return 0; } };
    // The clean-up crew: isopods and springtails eat litter and leave frass (humus). Each works so much floor, so what they do
    // for a cell goes by how many there are for the tank's floor (the same ten isopods are a lot in a cube, few in a show tank).
    const crew = clamp((count('isopod') * 0.05 + count('purpleiso') * 0.05 + count('pandaking') * 0.12 + count('springtail') * 0.012 + count('springpink') * 0.014 + count('springsea') * 0.004 + count('earthworm') * 0.08 + count('flylarva') * 0.006) / sizeFactors().area, 0, 2.5);
    this.crew = crew;
    const crewShare = crew / (1 + crew);
    let moldLoad = 0, changed = false;
    for (let c = 0; c < n; c++) {
      const s = C.soil[c], T = C.temp[c];
      if ((C.f.water[c] ?? 0) > 0.4) {
        // Flooded ground: litter dissolves into the water as detritus, humus stays.
        if (L[c] > 0.001) { E.detritus += L[c] * 0.05; L[c] = 0; changed = true; }
        F[c] *= 1 - Math.min(0.5, 0.2 * days);
        continue;
      }
      const tf = tempFactor(T), mf = moistFactor(s);
      const k = HUMUS.rot * tf * mf * (1 + crew * 0.7);
      if (L[c] > 1e-4) {
        const rotted = L[c] * (1 - Math.exp(-k * days));
        L[c] -= rotted;
        if (L[c] < 0.004) { H[c] += L[c] * 0.3; L[c] = 0; }
        H[c] = Math.min(1, H[c] + rotted * (HUMUS.yield + HUMUS.crewYield * crewShare));
        if (L[c] > 0.6 && s > 0.6) moldLoad += (L[c] - 0.6);
        changed = true;
      }
      // Humus feeds the soil slowly (faster when warm and damp) and settles with time.
      const m = H[c] * HUMUS.mineral * tf * mf * days;
      H[c] = Math.max(0, H[c] - m * 0.6 - H[c] * HUMUS.humusLoss * days);
      F[c] = clamp(F[c] + m - F[c] * HUMUS.leach * s * days, 0, 1);
    }
    // Fertility creeps downhill with the soil water and diffuses a little.
    this.spread(days);
    // Stale, wet litter grows mould (the crew and a fan keep it down).
    const stale = clamp((E.humidity - 88) / 10, 0, 1) * (1 - (E.fan ?? 0)) * (E.lid || TANK.closed ? 1 : 0.6);
    if (moldLoad > 0 && stale > 0) E.mold = clamp(E.mold + (moldLoad / n) * 6 * stale * (1 - crewShare) * days * 0.5, 0, 1);
    if (changed) this.rev++;
    this.summarise();
    this.writeTexture();
  }

  spread(days) {
    const C = this.C, { nx, nz } = C, F = C.fert, W = this.world;
    if (!this.hgt || this.hgt.length !== nx * nz) this.hgt = new Float32Array(nx * nz);
    const h = this.hgt;
    const T = W.terrain;
    if (T?.heightAt) for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) h[j * nx + i] = T.heightAt((i + 0.5) * C.cs - TANK.w / 2, (j + 0.5) * C.cs - TANK.d / 2);
    const src = F.slice();
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const c = j * nx + i;
      if (src[c] < 1e-4) continue;
      const s = C.soil[c];
      // The lowest neighbour and the drop to it.
      let best = -1, drop = 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
        const d = h[c] - h[b * nx + a];
        if (d > drop) { drop = d; best = b * nx + a; }
      }
      if (best >= 0 && (C.f.water[best] ?? 0) < 0.4) {
        const q = src[c] * clamp(0.03 * s * days * clamp(drop / 3, 0.2, 1.5), 0, 0.2);
        F[c] -= q; F[best] += q;
      }
      // Diffusion toward the neighbours in wet soil.
      for (const [di, dj] of [[1, 0], [0, 1]]) {
        const a = i + di, b = j + dj;
        if (a >= nx || b >= nz) continue;
        const o = b * nx + a;
        if ((C.f.water[o] ?? 0) > 0.4) continue;
        const q = (src[c] - src[o]) * clamp(0.04 * (0.3 + s) * days, 0, 0.25);
        F[c] -= q; F[o] += q;
      }
    }
    for (let c = 0; c < nx * nz; c++) F[c] = clamp(F[c], 0, 1);
  }

  summarise() {
    const C = this.C, n = C.nx * C.nz;
    let a = 0, b = 0, c = 0;
    for (let k = 0; k < n; k++) { a += C.litter[k]; b += C.humus[k]; c += C.fert[k]; }
    this.stats = { litter: a / n, humus: b / n, fert: c / n, crew: this.crew, litterTotal: a, humusTotal: b };
  }

  // Resamples the fields into the small texture the soil shader reads (R humus, G litter, B fertility).
  writeTexture() {
    const tex = this.texture;
    if (!tex) return;
    const C = this.C, d = tex.image.data, w = tex.image.width, h = tex.image.height;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const x = ((i + 0.5) / w - 0.5) * TANK.w, z = ((j + 0.5) / h - 0.5) * TANK.d;
      const q = (j * w + i) * 4;
      d[q] = clamp(C.sample(C.humus, x, z) * 255 * 1.4, 0, 255);
      d[q + 1] = clamp(C.sample(C.litter, x, z) * 255 * 0.8, 0, 255);
      d[q + 2] = clamp(C.sample(C.fert, x, z) * 255, 0, 255);
      d[q + 3] = 255;
    }
    tex.needsUpdate = true;
  }

  // --- Saving --------------------------------------------------------------------
  serialize() {
    const C = this.C, q = (a) => Array.from(a, (v) => Math.round(v * 1000) / 1000);
    return { nx: C.nx, nz: C.nz, litter: q(C.litter), humus: q(C.humus), fert: q(C.fert), flies: this.world.flies?.serialize() };
  }
  load(o) {
    const C = this.C;
    if (!o || o.nx !== C.nx || o.nz !== C.nz) { this.reset(); return false; }
    this.world.flies?.load(o.flies);
    C.litter.set(o.litter); C.humus.set(o.humus); C.fert.set(o.fert);
    this.rev++; this.summarise(); this.writeTexture();
    return true;
  }
}
