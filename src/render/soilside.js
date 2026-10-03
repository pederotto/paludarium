// The soil profile seen through the front and side glass: what a keeper sees of the build below the surface. From the
// bottom up: the drainage (none, a layer of LECA clay balls, or a false bottom: the white egg-crate grid with bio-rings in
// the plenum's water), the fibreglass mesh over it, then the substrate (content/equipment.js SUBSTRATES: topsoil, ABG mix,
// coco coir, coir under sphagnum) with its leaf litter on top. Where the plenum's water is over the mesh the soil above it
// shows dark and soaked (mud). The water in the drainage stands at the pool's level (they are one body of water).
//
// One mesh of vertical strips just inside the glass, from the floor to the ground (the sculpted base, not the rocks on it),
// rebuilt when the ground changes; one material whose layers are all drawn from uniforms in the fragment, so changing the
// build or the substrate costs no rebuild and no shader compile. The patterns are cheap hashes (no noise per fragment).

import * as THREE from 'three/webgpu';
import { uniform, attribute, positionWorld, vec2, vec3, float, fract, floor, sin, dot, mix, smoothstep, step, length, abs, max, min, clamp } from 'three/tsl';
import { TANK } from '../sim/tank.js';
import { U } from './uniforms.js';
import { SUBSTRATE_ORDER } from '../content/equipment.js';

const STEP = 0.75;       // cm between columns
const INSET = 0.04;      // cm inside the glass

const hash = (p) => fract(sin(dot(p, vec2(12.9898, 78.233))).mul(43758.5453));

export class SoilSide {
  constructor(parent, world) {
    this.world = world;
    this.u = { L: uniform(0), mode: uniform(0), water: uniform(0), sub: uniform(0), wet: uniform(0.5), mud: uniform(0) };
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material());
    this.mesh.name = 'soil-profile';
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    parent.add(this.mesh);
    this.sig = ''; this.t = 1e9;
  }

  material() {
    const { L: Ltrue, mode, water: wTrue, sub, wet, mud } = this.u;
    const pw = positionWorld, y = pw.y, a = pw.x.add(pw.z);       // a: along the glass
    const top = attribute('top', 'float');
    // A cut-away: generated tanks slope the ground down to a few centimetres at the front glass, so the drainage is drawn at
    // most about half as deep as the ground there (its true depth where there is room), and the water line keeps its true
    // distance from the mesh. L and water below are those drawn heights.
    const L = min(Ltrue, top.mul(0.55)), water = L.sub(Ltrue.sub(wTrue));

    // --- Substrates ------------------------------------------------------------------------------------------------
    // Rounded particles: in each cell of a grid (cells per cm `k`, stretched by `sx`, `sy`) a jittered ellipse of random size.
    // Returns [mask 0 … 1, the cell's random number].
    const blob = (k, sx, sy, rMin, rMax, seed) => {
      const q = vec2(a.mul(k * sx), y.mul(k * sy)), c = floor(q), h = hash(c.add(seed));
      // Jittered well off the grid, and about a third of the cells left empty, so no rows show.
      const f = fract(q).sub(0.5).add(vec2(hash(c.add(seed + 1.7)), hash(c.add(seed + 3.1))).sub(0.5).mul(0.6));
      const r = h.mul(rMax - rMin).add(rMin);
      return [smoothstep(r, r.sub(0.08), length(f)).mul(step(0.32, hash(c.add(seed + 5.3)))), h];
    };
    const [grain, gh] = blob(5, 1, 1, 0.22, 0.42, 0);
    const [grain2] = blob(9, 1, 1, 0.2, 0.38, 11);
    const fineC = (c) => c.mul(grain.mul(gh.mul(0.35).add(0.05)).add(grain2.mul(0.08)).add(0.9));
    const [perl, ph] = blob(2.2, 1, 1, 0.12, 0.26, 21);
    const perlite = perl.mul(step(0.9, ph));
    const soilC = fineC(vec3(0.13, 0.085, 0.055));
    const [bark, bh] = blob(1.3, 0.8, 1.7, 0.2, 0.44, 31);
    let abgC = fineC(vec3(0.15, 0.095, 0.058));
    abgC = mix(abgC, vec3(0.33, 0.18, 0.09).mul(bh.mul(0.4).add(0.75)), bark.mul(step(0.42, bh)));
    abgC = mix(abgC, vec3(0.03, 0.028, 0.026), bark.mul(step(bh, 0.13)));                          // charcoal
    const [fib, fh] = blob(4, 0.16, 4.5, 0.14, 0.36, 41), [fib2] = blob(6, 0.2, 5, 0.12, 0.3, 45);
    const coirC = mix(fineC(vec3(0.19, 0.105, 0.058)), vec3(0.33, 0.185, 0.095).mul(fh.mul(0.3).add(0.85)), max(fib, fib2.mul(0.7)).mul(0.6));
    const [strand, sh] = blob(2.4, 0.5, 1.6, 0.18, 0.4, 51);
    const sphagC = mix(coirC, mix(vec3(0.34, 0.33, 0.2), vec3(0.55, 0.52, 0.34), sh).mul(strand.mul(0.4).add(0.65)), smoothstep(top.sub(3.4), top.sub(2.8), y));
    const w1 = step(0.5, sub).mul(step(sub, 1.5)), w2 = step(1.5, sub).mul(step(sub, 2.5)), w3 = step(2.5, sub);
    let subC = soilC.mul(float(1).sub(w1).sub(w2).sub(w3)).add(abgC.mul(w1)).add(coirC.mul(w2)).add(sphagC.mul(w3));
    subC = mix(subC, vec3(0.78, 0.78, 0.74), perlite.mul(float(1).sub(w2)).mul(0.85));
    // Damp soil is darker, more so near the bottom where water wicks up; a flooded false bottom soaks it to mud.
    const wick = smoothstep(L.add(4), L, y).mul(0.25);
    subC = subC.mul(float(1).sub(clamp(wet.mul(0.3).add(wick), 0, 0.55)));
    subC = mix(subC, vec3(0.07, 0.05, 0.035), mud.mul(smoothstep(water.add(3), water.sub(0.5), y)).mul(0.85));
    // Leaf litter: the top centimetre, dark leaf fragments.
    const [leafM, leafH] = blob(1.6, 0.35, 2.2, 0.25, 0.45, 61);
    const litter = mix(vec3(0.06, 0.04, 0.025), mix(vec3(0.13, 0.075, 0.035), vec3(0.2, 0.12, 0.05), leafH), leafM);
    subC = mix(subC, litter, smoothstep(top.sub(1.3), top.sub(0.7), y).mul(0.9));

    // --- LECA: clay balls in offset rows, dark gaps, water in the bottom -------------------------------------------------
    const p = vec2(a, y).div(0.95);
    const row = floor(p.y), px = p.x.add(row.mul(0.5));
    const cell = vec2(floor(px), row);
    const f = vec2(fract(px), fract(p.y)).sub(0.5).add(vec2(hash(cell), hash(cell.add(7))).sub(0.5).mul(0.16));
    const dd = length(f);
    const ball = smoothstep(0.47, 0.4, dd);
    let lecaC = mix(vec3(0.05, 0.035, 0.025), vec3(0.62, 0.33, 0.17).mul(float(1).sub(dd.mul(0.9))).mul(hash(cell.add(3)).mul(0.3).add(0.85)), ball);
    const under = step(y, water);
    lecaC = mix(lecaC, lecaC.mul(vec3(0.55, 0.75, 0.8)).add(vec3(0.02, 0.05, 0.06)), under);

    // --- False bottom: the egg-crate lattice, bio-rings in the plenum, its water ------------------------------------------
    const g = vec2(a, y).div(1.3);
    const bars = max(step(fract(g.x), 0.12), step(fract(g.y.add(0.5)), 0.12));
    const rp = vec2(a, y).div(0.8), rc = floor(rp);
    const rr = length(fract(rp).sub(0.5).add(vec2(hash(rc), hash(rc.add(5))).sub(0.5).mul(0.2)));
    const ring = smoothstep(0.09, 0.04, abs(rr.sub(0.27))).mul(step(0.35, hash(rc.add(11))));
    const voidC = mix(vec3(0.035, 0.035, 0.04), vec3(0.08, 0.19, 0.21), under);
    const crateC = mix(mix(voidC, vec3(0.62, 0.58, 0.52).mul(mix(float(1), float(0.7), under)), ring), vec3(0.86, 0.88, 0.85), bars);
    const drainC = mix(lecaC, crateC, step(1.5, mode));

    // --- Zones ------------------------------------------------------------------------------------------------------
    // The water part of the tank has no drainage under it (the ground there is lower than the layer).
    const on = step(0.5, mode).mul(step(1.6, top));
    const inDrain = on.mul(step(y, L));
    const meshBand = on.mul(step(L, y)).mul(step(y, L.add(0.3)));
    const hatch = max(step(fract(a.mul(5)), 0.3), step(fract(y.mul(5)), 0.3));
    let col = mix(subC, drainC, inDrain);
    col = mix(col, vec3(0.12, 0.12, 0.11).mul(hatch.mul(0.6).add(0.6)), meshBand);

    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0 });
    m.colorNode = col;
    m.roughnessNode = mix(float(0.92), float(0.35), max(inDrain.mul(under), mud.mul(0.6)));
    return m;
  }

  signature() {
    const W = this.world;
    return `${W.water.hydro.groundVer}|${TANK.w}|${TANK.d}`;
  }

  update(dt) {
    const W = this.world, E = W.env;
    const u = this.u;
    const mode = E.drainage >= 1 ? 2 : E.drainage > 0 ? 1 : 0;
    u.mode.value = mode;
    u.L.value = mode === 2 ? E.plenumH || W.water.level + 1 : mode === 1 ? 3 : 0;
    u.water.value = mode === 2 ? Math.min(W.water.level, u.L.value + 6) : mode === 1 ? 1.2 : -10;   // a drainage layer keeps a little water in its bottom
    u.sub.value = Math.max(0, SUBSTRATE_ORDER.indexOf(E.substrate ?? 'soil'));
    U.backdrop.value = E.backdrop === 'foam' ? 1 : 0;
    u.wet.value = E.soil ?? 0.5;
    u.mud.value += ((E.plenum?.state === 'mud' ? 1 : 0) - u.mud.value) * Math.min(1, dt * 0.5);
    this.mesh.visible = !(this.hidden?.());
    this.t += dt;
    if (this.t < 1) return;
    this.t = 0;
    const s = this.signature();
    if (s !== this.sig) { this.sig = s; this.rebuild(); }
  }

  // Strips along the front glass and both side glasses, floor to ground.
  rebuild() {
    const T = this.world.terrain;
    const pos = [], nor = [], tops = [], idx = [];
    const strip = (n, at, normal) => {
      const base = pos.length / 3;
      for (let k = 0; k <= n; k++) {
        const [x, z] = at(k / n);
        const h = Math.max(0, T.baseAt(x, z));
        pos.push(x, 0, z, x, h, z);
        nor.push(...normal, ...normal);
        tops.push(h, h);
      }
      for (let k = 0; k < n; k++) {
        const i = base + k * 2;
        // Wound to face outward (toward the glass and the viewer).
        if (normal[0] <= 0) idx.push(i, i + 2, i + 1, i + 1, i + 2, i + 3); else idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
      }
    };
    const hw = TANK.w / 2 - INSET, hd = TANK.d / 2 - INSET;
    strip(Math.ceil(TANK.w / STEP), (t) => [-hw + t * 2 * hw, hd], [0, 0, 1]);
    strip(Math.ceil(TANK.d / STEP), (t) => [-hw, -hd + t * 2 * hd], [-1, 0, 0]);
    strip(Math.ceil(TANK.d / STEP), (t) => [hw, -hd + t * 2 * hd], [1, 0, 0]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('top', new THREE.Float32BufferAttribute(tops, 1));
    geo.setIndex(idx);
    const old = this.mesh.geometry;
    this.mesh.geometry = geo;
    old.dispose();
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
  }
}
