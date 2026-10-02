// Microclimate: a tank is not one number. Air is damper beside a waterfall
// than on a dry ledge, warmer under the lamp, and the floor is dark under a
// canopy of ferns. These coarse maps (about 3 cm per cell) hold the local
// humidity, temperature, light and soil moisture. The tank-wide values in
// Env (sim.js) stay the average; the maps carry the structure around them.
//
//   humidity  water, waterfalls, plants and moss raise it; rain and fogger
//             raise it a lot; a fan mixes the air and pulls it toward the room
//   temperature  the lamp warms the top, a basking lamp makes a hot spot,
//             water cools its surroundings (evaporation)
//   light     the LED bar, less what leaves and floating plants shade
//   soil      wetted by rain, mist, spray and the neighbourhood of water;
//             dried by drainage, evaporation, heat and airflow
//
// Animals move to where their needs are met (a dart frog crowds into the
// spray zone when the air is dry) and plants read their own cell. The lens
// overlays (ui/lens.js) draw these maps, which is how you learn to read a
// tank's microclimates.

import { TANK, MAT, NMAT } from './tank.js';
import { PLANTS } from './plants.js';
import { clamp, lerp } from '../util/math.js';

const CELL = 3;

export class Climate {
  constructor(world) {
    this.world = world;
    this.cs = CELL;
    this.nx = Math.max(4, Math.ceil(TANK.w / CELL));
    this.nz = Math.max(4, Math.ceil(TANK.d / CELL));
    const n = this.nx * this.nz;
    this.hum = new Float32Array(n).fill(70);
    this.temp = new Float32Array(n).fill(23);
    this.light = new Float32Array(n).fill(1);
    this.soil = new Float32Array(n).fill(0.5);
    // The ground's slow chemistry (sim/humus.js): leaf litter, humus, fertility. Saved with the tank.
    this.litter = new Float32Array(n);
    this.humus = new Float32Array(n);
    this.fert = new Float32Array(n);
    // Feature maps (rebuilt by scan()).
    this.f = {
      water: new Float32Array(n), spray: new Float32Array(n), plants: new Float32Array(n),
      canopy: new Float32Array(n), moss: new Float32Array(n), fog: new Float32Array(n), bask: new Float32Array(n),
    };
    this.acc = 1e9;   // minutes since the last refresh
    this.scanAcc = 1e9;
    this.mean = { hum: 70, temp: 23, light: 1, soil: 0.5 };
  }

  idx(x, z) {
    const i = clamp(Math.floor((x + TANK.w / 2) / this.cs), 0, this.nx - 1);
    const j = clamp(Math.floor((z + TANK.d / 2) / this.cs), 0, this.nz - 1);
    return j * this.nx + i;
  }

  // Bilinear lookup of a map at a world point.
  sample(map, x, z) {
    const fx = clamp((x + TANK.w / 2) / this.cs - 0.5, 0, this.nx - 1.001), fz = clamp((z + TANK.d / 2) / this.cs - 0.5, 0, this.nz - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, nx = this.nx;
    return (map[j * nx + i] * (1 - u) + map[j * nx + i + 1] * u) * (1 - v) + (map[(j + 1) * nx + i] * (1 - u) + map[(j + 1) * nx + i + 1] * u) * v;
  }

  // Local values include a vertical gradient: air is a little damper near
  // the floor and water, and hot air rises under the lamp.
  humidityAt(x, y, z) {
    const W = this.world;
    const up = clamp((y - W.terrain.heightAt(x, z)) / (TANK.h * 0.8), 0, 1);
    return clamp(this.sample(this.hum, x, z) - up * 6 * (W.env.lid ? 0.6 : 1.2), 10, 100);
  }
  tempAt(x, y, z) {
    const W = this.world, E = W.env;
    const top = clamp(y / TANK.h, 0, 1);
    // Warm air rises: a little cooler than average at the floor, warmer under the lamp.
    return this.sample(this.temp, x, z) + (top * top - 0.2) * 2 * E.lampPower * E.light();
  }
  lightAt(x, z) { return this.sample(this.light, x, z); }
  soilAt(x, z) { return this.sample(this.soil, x, z); }

  // --- Reading the tank into feature maps ---------------------------------
  scan() {
    const W = this.world, F = this.f, n = this.nx * this.nz;
    for (const k of Object.keys(F)) F[k].fill(0);
    const T = W.terrain.field, H = W.water.hydro;
    const cellsPer = new Float32Array(n);
    // Water and moss from the fine grid.
    for (let j = 0; j <= T.ny; j++) for (let i = 0; i <= T.nx; i++) {
      const fi = j * T.cols + i;
      const [x, z] = T.toWorld(i, j);
      const c = this.idx(x, z);
      cellsPer[c]++;
      if (H.res[fi] || H.d[fi] > 0.05) F.water[c]++;
      if (!T.stamped[fi]) F.moss[c] += T.mat[fi * NMAT + MAT.moss];
    }
    for (let c = 0; c < n; c++) { const k = Math.max(1, cellsPer[c]); F.water[c] /= k; F.moss[c] /= k; }
    // Spray around waterfalls and springs.
    for (const r of W.water.falls) {
      for (const p of [r.end, r.pts[0]]) this.splat(F.spray, p.x, p.z, 8, 1);
    }
    // Plants: transpiration adds humidity, and leaves shade what is below.
    for (const p of W.plants.list) {
      const sp = PLANTS[p.id];
      const size = p.grown * p.scale * (sp.canopy ?? 1);
      if (p.surface === 'wall') continue;
      this.splat(F.plants, p.pos.x, p.pos.z, 4, 0.5 * size * (sp.habitat.startsWith('floating') ? 2 : 1));
      // Leaves shade what is below them: a modest amount each, more for floating
      // and tall plants, none for plants that live under the water line.
      const tall = sp.habitat === 'floating' ? 0.34 : sp.habitat === 'aquatic' ? 0.03 : (sp.tall ?? 0.13);
      this.splat(F.canopy, p.pos.x, p.pos.z, 4 + 2.5 * size, tall * clamp(size, 0.2, 1.4));
    }
    // Equipment.
    const E = W.env, eq = W.equipment;
    const fog = eq?.pos.fogger;
    if (fog && E.fogger > 0) this.splat(F.fog, fog.x, fog.z, 12, E.fogger);
    const bk = eq?.pos.basking;
    if (bk && E.basking > 0) this.splat(F.bask, bk.x, bk.z ?? 0, 9, E.basking);
    this.scanAcc = 0;
  }

  splat(map, x, z, radius, amount) {
    const i0 = clamp(Math.floor((x - radius + TANK.w / 2) / this.cs), 0, this.nx - 1), i1 = clamp(Math.floor((x + radius + TANK.w / 2) / this.cs), 0, this.nx - 1);
    const j0 = clamp(Math.floor((z - radius + TANK.d / 2) / this.cs), 0, this.nz - 1), j1 = clamp(Math.floor((z + radius + TANK.d / 2) / this.cs), 0, this.nz - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const cx = (i + 0.5) * this.cs - TANK.w / 2, cz = (j + 0.5) * this.cs - TANK.d / 2;
      const d = Math.hypot(cx - x, cz - z) / radius;
      if (d < 1) map[j * this.nx + i] += amount * (1 - d * d);
    }
  }

  // Refreshes the maps. dtMin: game minutes since last call. `base` is the
  // tank-wide target humidity before local structure; `light` is 0…1 now.
  step(dtMin, light) {
    this.acc += dtMin; this.scanAcc += dtMin;
    if (this.acc < 8) return;
    const dt = this.acc; this.acc = 0;
    if (this.scanAcc > 30) this.scan();
    const W = this.world, E = W.env, F = this.f, n = this.nx * this.nz;
    const fan = E.fan;
    const raining = E.rain > 0 ? 1 : 0;
    // Structure of each map: local terms minus their average, so the map's
    // mean stays the tank-wide value in Env.
    const hs = new Float32Array(n), ts = new Float32Array(n), ls = new Float32Array(n), so = new Float32Array(n);
    let hm = 0, tm = 0;
    for (let c = 0; c < n; c++) {
      hs[c] = F.water[c] * 12 + F.spray[c] * 16 + Math.min(1, F.plants[c]) * 7 + F.moss[c] * 5 + raining * 18 + F.fog[c] * 32;
      ts[c] = -F.water[c] * 1.0 - F.spray[c] * 0.6 - Math.min(1, F.canopy[c]) * 0.6 + F.bask[c] * 9 + F.fog[c] * -1.2;
      hm += hs[c]; tm += ts[c];
    }
    hm /= n; tm /= n;
    // Lamp coverage is even, fading toward the ends of the bar, and canopy
    // shades what is beneath it.
    const lampP = E.lampPower;
    for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) {
      const c = j * this.nx + i;
      const edge = 1 - 0.28 * Math.pow(Math.abs((i + 0.5) / this.nx - 0.5) * 2, 2);
      ls[c] = lampP * edge * (1 - Math.min(0.6, F.canopy[c])) * (1 + F.bask[c] * 0.6);
    }
    for (let c = 0; c < n; c++) {
      // Dry air pulls dry spots further down; a fan flattens the differences.
      const mix = 1 - fan * 0.65;
      const hTarget = clamp(E.humidity + (hs[c] - hm) * mix, 15, 100);
      const tTarget = E.temp + (ts[c] - tm) * mix;
      this.hum[c] = lerp(this.hum[c], hTarget, clamp(dt * 0.05, 0, 1));
      this.temp[c] = lerp(this.temp[c], tTarget, clamp(dt * 0.03, 0, 1));
      this.light[c] = lerp(this.light[c], ls[c], clamp(dt * 0.2, 0, 1));
      // Soil moisture (per day): wetting from rain, mist, spray and nearby
      // water; drying by drainage, heat, light and moving air.
      const wet = F.water[c] > 0.3 ? 1 : 0;
      const nearWater = Math.min(1, F.water[c] * 3 + F.spray[c] * 0.6);
      const input = raining * 1.4 + E.mist * 0.5 + nearWater * 0.55 + (E.humidity / 100) * 0.12;
      const dry = 0.25 + E.drainage * 1.5 + fan * 0.5 + Math.max(0, E.temp - 22) * 0.04 + light * 0.25 * (1 - E.humidity / 100) + (TANK.closed ? -0.1 : 0);
      const s = this.soil[c];
      let d = (input * (1 - s) * 1.6 - dry * s * 0.9) * dt / 1440;
      this.soil[c] = wet ? Math.max(s, 0.95) : clamp(s + d, 0, 1);
    }
    // A little mixing between neighbours, so features bleed into their surroundings.
    for (const map of [this.hum, this.temp, this.light, this.soil]) this.blur(map);
    this.summarise();
  }

  blur(map) {
    const { nx, nz } = this, src = map.slice();
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      let s = src[j * nx + i] * 4, k = 4;
      if (i > 0) { s += src[j * nx + i - 1] * 2; k += 2; }
      if (i < nx - 1) { s += src[j * nx + i + 1] * 2; k += 2; }
      if (j > 0) { s += src[(j - 1) * nx + i] * 2; k += 2; }
      if (j < nz - 1) { s += src[(j + 1) * nx + i] * 2; k += 2; }
      map[j * nx + i] = s / k;
    }
  }

  summarise() {
    const n = this.nx * this.nz, m = this.mean;
    let a = 0, b = 0, c = 0, d = 0;
    for (let k = 0; k < n; k++) { a += this.hum[k]; b += this.temp[k]; c += this.light[k]; d += this.soil[k]; }
    m.hum = a / n; m.temp = b / n; m.light = c / n; m.soil = d / n;
    let lo = Infinity, hi = -Infinity, tlo = Infinity, thi = -Infinity;
    for (let k = 0; k < n; k++) { lo = Math.min(lo, this.hum[k]); hi = Math.max(hi, this.hum[k]); tlo = Math.min(tlo, this.temp[k]); thi = Math.max(thi, this.temp[k]); }
    m.humRange = [lo, hi]; m.tempRange = [tlo, thi];
  }

  // Snap every map to the current tank-wide values (a freshly loaded tank).
  settle() {
    const E = this.world.env;
    this.hum.fill(E.humidity); this.temp.fill(E.temp); this.light.fill(E.lampPower); this.soil.fill(0.5);
    this.acc = 1e9; this.scanAcc = 1e9;
    for (let k = 0; k < 6; k++) { this.acc = 1e9; this.step(1e4, E.light()); }
    this.summarise();
  }
}
