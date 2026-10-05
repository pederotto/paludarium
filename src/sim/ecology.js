// How a tank settles in over weeks, the way real ones do:
//
//  1. New: the substrate is bare and the water is raw. Bacteria colonise
//     the filter and substrate once there is ammonia to eat (sim.js).
//  2. Diatoms: a brown film on everything under water in the first weeks,
//     until the silicate in new substrate runs out.
//  3. Algae: green water and green film whenever light and nitrate are high
//     and the plants aren't yet using them up. Plants, floating cover,
//     shrimp and tadpoles and water changes push it back.
//  4. Moss spreads over damp ground, stone and the background (and takes
//     hold on its own in the spray of waterfalls), and dies back where the
//     air is dry. Plants put out runners and plantlets.
//  5. Established, then mature: a stable cycle, little algae, moss and
//     plants filling in.
//
// Moss is a material on the substrate and background fields, grown with a
// simple reaction-diffusion rule (logistic growth plus spreading to
// neighbours, scaled by how good each spot is).

import * as THREE from 'three/webgpu';
import { MAT, NMAT, sizeFactors } from './tank.js';
import { U, SOIL } from '../render/uniforms.js';
import { Humus } from './humus.js';
import { LitterView } from '../render/litter.js';
import { clamp, lerp } from '../util/math.js';

const CLEAR = new THREE.Color(0.3, 0.62, 0.62);
const GREEN = new THREE.Color(0.32, 0.55, 0.2);
const BROWN = new THREE.Color(0.3, 0.2, 0.08);
const ALGAE = new THREE.Color(0.16, 0.3, 0.07);

export const STAGES = [
  { id: 'bare', name: 'Bare', tip: 'Sculpt the ground, add hardscape and fill it with water.' },
  { id: 'new', name: 'New', tip: 'Bacteria are settling in. Plant it now; hold off on fish until the cycle is done.' },
  { id: 'cycling', name: 'Cycling', tip: 'Ammonia turns to nitrite, then nitrate. Brown diatoms are normal now.' },
  { id: 'bloom', name: 'Algae bloom', tip: 'More light and nitrate than the plants can use: add plants or floating cover, shorten the light, change water, add shrimp.' },
  { id: 'settling', name: 'Settling in', tip: 'Moss and plants are spreading. Animals can move in.' },
  { id: 'established', name: 'Established', tip: 'A stable tank. It keeps filling in.' },
  { id: 'mature', name: 'Mature', tip: 'Fully grown in.' },
];

export class Ecology {
  constructor(world) {
    this.world = world;
    this.acc = 0;
    this.mossAcc = 0;
    this.stage = null;
    // Litter, humus and fertility on the ground (humus.js); the world reaches it as world.humus.
    this.humus = world.humus = new Humus(world);
    this.humus.texture = SOIL.tex;
    if (world.scene) this.humus.view = new LitterView(world.scene, world);
  }

  // Game minutes.
  step(d, light) {
    const W = this.world, E = W.env;
    const days = d / 1440;
    const hasWater = W.water.level > 0.5 || W.water.pools.length > 0;
    // Grazers, plants and floating cover work on so much glass, stone and water each: what they do to the tank-wide algae goes
    // by how many there are for the tank's size (floor for surfaces and cover, volume for the water the plants feed from).
    const size = sizeFactors();
    const grazers = (W.animals.count('shrimp') * 0.02 + W.animals.count('tadpole') * 0.015 + W.animals.count('cory') * 0.01 + W.animals.count('oto') * 0.02 + W.animals.count('snail') * 0.006) / size.area;
    // Fresh substrate leaches ammonia (which feeds the first bacteria and,
    // once they turn it into nitrate, the first algae) and silicate (which
    // feeds diatoms) for about three weeks.
    const young = Math.max(0, 1 - E.tankDays / 21);
    if (hasWater && young > 0) E.ammonia += days * 0.5 * young * Math.min(1, 25 / Math.max(5, W.water.volumeLitres()));
    if (hasWater) E.diatoms = clamp(E.diatoms + days * (young * light * 0.9 - grazers - E.diatoms * 0.25), 0, 1);
    // Green algae: light × spare nutrients, minus what plants take and what
    // floating plants shade out.
    const plantUse = clamp((W.sim.plantOut?.nitrateUse ?? 0) / (25 * size.vol), 0, 0.85);
    const shade = clamp((W.sim.plantOut?.shade ?? 0) / (600 * size.area), 0, 0.6);
    const food = clamp((E.nitrate + E.ammonia * 20 + young * 12) / 18, 0, 1.6) * (1 - plantUse) * (1 - shade);
    const grow = light * food * (E.lights === 'on' ? 1.6 : 1) - 0.12;
    if (hasWater) E.algae = clamp(E.algae + days * (grow * 3 * (E.algae + 0.04) * (1 - E.algae) - grazers * 1.5 - E.algae * 0.05), 0, 1);
    // Hardscape moss (the covering on rock tops) follows the damp air.
    E.rockMoss = clamp(E.rockMoss + days * ((E.humidity - 72) / 30) * 0.05, 0, 1);
    if (E.mold > 0.5) E.rockMoss = clamp(E.rockMoss - days * (E.mold - 0.5) * 0.04, 0, 1);
    E.tankDays += days;

    // Litter rots into humus, humus into fertility.
    this.humus.step(d);
    this.humus.view?.update(this.humus);

    // Moss on the ground and the background, every game hour.
    this.mossAcc += d;
    if (this.mossAcc >= 60) {
      const hours = Math.min(24 * 5, this.mossAcc / 60);
      this.mossAcc = 0;
      if (this.growMoss(hours, light)) this.dirty = true;
    }
    this.acc += d;
    if (this.acc >= 360 && this.dirty) {
      // Re-shade the fields and redo the tufts every six game hours.
      this.acc = 0;
      this.dirty = false;
      W.terrain.field.dirty = true;
      W.wall.field.dirty = true;
      W.terrain.update();
      W.wall.update();
      W.updateMoss();
      W.decor.scatterMoss();
    }
    this.updateLook();
    this.updateStage();
  }

  updateLook() {
    const E = this.world.env;
    U.turbidity.value = clamp(E.algae * 0.9 + E.detritus / 60, 0, 1);
    U.algaeFilm.value = clamp(Math.max(E.algae, E.diatoms * 0.9) * 0.85, 0, 1);
    const brownish = E.diatoms / Math.max(0.01, E.diatoms + E.algae);
    U.algaeColor.value.copy(ALGAE).lerp(BROWN, brownish);
    U.tint.value.copy(CLEAR).lerp(GREEN, clamp(E.algae * 0.8, 0, 0.8));
    U.rockMoss.value = E.rockMoss;
  }

  // Reaction–diffusion of the moss weight on one field.
  growMoss(hours, light) {
    const W = this.world, E = W.env;
    const C = W.climate;
    let changed = false;
    const H = W.water.hydro;
    // Spray zones around falls and splashes.
    const spray = [];
    for (const r of W.water.falls) spray.push(r.end, r.pts[0]);
    for (const f of [W.terrain.field, W.wall.field]) {
      const isWall = f === W.wall.field;
      const N = f.cols * f.rows;
      const m = f.mat;
      const w = new Float32Array(N);
      for (let n = 0; n < N; n++) w[n] = m[n * NMAT + MAT.moss];
      const next = w.slice();
      for (let j = 0; j <= f.ny; j++) for (let i = 0; i <= f.nx; i++) {
        const n = j * f.cols + i;
        let good;
        let x, y, z;
        if (isWall) {
          [x, y] = f.toWorld(i, j);
          z = W.wall.zAt(x, y);
          if (y < W.water.level + 0.5 || y < W.terrain.heightAt(x, z + 1) - 0.5) continue;
          good = 0.8;
        } else {
          if (f.stamped[n]) continue;
          [x, z] = f.toWorld(i, j);
          y = f.h[n];
          if (H.res[n] || H.d[n] > 0.4) {
            // Drowned moss rots away.
            if (w[n] > 0) { next[n] = Math.max(0, w[n] - hours * 0.02); changed = true; }
            continue;
          }
          const o = n * NMAT;
          good = m[o + MAT.soil] * 1 + m[o + MAT.stone] * 0.9 + m[o + MAT.rock] * 0.8 + m[o + MAT.moss] + m[o + MAT.gravel] * 0.35 + m[o + MAT.sand] * 0.15;
          if (H.d[n] > 0.02 || (i > 0 && H.d[n - 1] > 0.1) || (i < f.nx && H.d[n + 1] > 0.1)) good += 0.4;
          good *= 1 + 0.6 * C.fert[C.idx(x, z)];   // moss prefers fertile ground
        }
        let wetBonus = 0;
        for (const p of spray) {
          const dd = Math.hypot(p.x - x, p.y - y, p.z - z);
          if (dd < 9) wetBonus = Math.max(wetBonus, 1 - dd / 9);
        }
        // Moss reads its own spot: local air, the light that reaches it, and how wet the ground is.
        const air = clamp((C.humidityAt(x, y, z) - 62) / 25, -1, 1) + (isWall ? 0 : (C.soilAt(x, z) - 0.5) * 0.5);
        const lightOk = clamp(E.lightAvg * (C.lightAt(x, z) / Math.max(0.2, E.lampPower)) * 2.5, 0.2, 1);
        const s = (air + wetBonus * 0.8) * good * lightOk;
        const nb = (f.get(i - 1, j, w) + f.get(i + 1, j, w) + f.get(i, j - 1, w) + f.get(i, j + 1, w)) * 0.25;
        let dw;
        if (s > 0) {
          dw = hours * (0.012 * s * w[n] * (1 - w[n]) + 0.02 * s * Math.max(0, nb - w[n]));
          // Spores take hold on their own where it's wettest.
          if (wetBonus > 0.3 && air > 0) dw += hours * 0.0015 * wetBonus;
        } else dw = hours * 0.006 * s * w[n];
        if (Math.abs(dw) > 1e-5) { next[n] = clamp(w[n] + dw, 0, 1); changed = true; }
      }
      if (!changed) continue;
      for (let n = 0; n < N; n++) {
        if (next[n] === w[n]) continue;
        const o = n * NMAT;
        const rest = 1 - w[n], k = rest > 1e-4 ? (1 - next[n]) / rest : 0;
        for (let q = 0; q < NMAT; q++) m[o + q] = q === MAT.moss ? next[n] : m[o + q] * k;
        if (rest <= 1e-4 && next[n] < 1) m[o + (isWall ? MAT.stone : MAT.soil)] = 1 - next[n];
      }
    }
    return changed;
  }

  // Where the tank is on its way to maturity.
  updateStage() {
    const W = this.world, E = W.env;
    const hasWater = W.water.volumeLitres() > 1;
    let id;
    if (!hasWater && W.plants.list.length === 0) id = 'bare';
    else if (E.cycle < 0.2) id = 'new';
    else if (E.cycle < 0.5 || E.ammonia > 0.1 || E.nitrite > 0.1) id = 'cycling';
    else if (E.algae > 0.3) id = 'bloom';
    else if (E.tankDays < 30 || W.mossFraction() < 0.08) id = 'settling';
    else if (E.tankDays < 90) id = 'established';
    else id = 'mature';
    if (id !== this.stage) {
      if (this.stage) {
        const st = STAGES.find((s) => s.id === id);
        W.log(`The tank is now: ${st.name}. ${st.tip}`, id === 'bloom' ? 'bad' : 'good');
      }
      this.stage = id;
    }
    return id;
  }

  // 0 … 1 progress toward a mature tank (for the panel).
  progress() {
    const W = this.world, E = W.env;
    // Sixty plants fill a standard tank; a cube is full with about thirteen.
    return clamp(E.cycle * 0.3 + clamp(E.tankDays / 90, 0, 1) * 0.3 + clamp(W.mossFraction() * 4, 0, 1) * 0.2 + clamp(W.plants.list.length / (60 * sizeFactors().area), 0, 1) * 0.2 - E.algae * 0.2, 0, 1);
  }
}

export { lerp };
