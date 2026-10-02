// The water you see: the main pool's rippled surface and tinted volume,
// the pools and streams outside it (a mesh that follows the simulated water
// depth, with foam and streaks that move with the flow), waterfalls pouring
// off ledges and down the background, the pump and its outlets, and a
// preview of where water from a point would run.
//
// The physics lives in hydro.js; this file draws it and offers the calls
// the rest of the game uses (surfaceAt, pools, falls…).

import * as THREE from 'three/webgpu';
import {
  float, vec3, vec2, uv, time, mix, smoothstep, positionWorld, cameraPosition, pow, dot, normalize, clamp, abs, sin,
  attribute, fract, length, max, Fn, reflect,
} from 'three/tsl';
import { noise3 } from './noise3.js';
import { TANK, MINUTES_PER_SECOND } from '../sim/tank.js';
import { U } from './uniforms.js';
import { waterSurfaceMaterial, SIM, FX } from './waterfx.js';
import { Hydro, WET } from '../sim/hydro.js';
import { Erosion, ERO } from '../sim/erosion.js';
import { Jobs } from '../sim/jobs.js';
import { Support } from '../sim/support.js';
import { PLANTS } from '../sim/plants.js';
import { SedimentFX } from './sedimentfx.js';

// Erosion setting (Settings > Simulation realism): 0 off, 0.5, 1 or 2 times the strength.
const EROSION_KEY = 'paludarium.erosion';
export function loadErosionSetting() {
  try { const v = parseFloat(localStorage.getItem(EROSION_KEY)); if ([0, 0.5, 1, 2].includes(v)) return v; } catch { /* private window */ }
  return 1;
}
export function saveErosionSetting(v) { try { localStorage.setItem(EROSION_KEY, String(v)); } catch { /* ignore */ } }
const rootedPlant = (p) => p.surface === 'terrain' && !String(PLANTS[p.id]?.habitat ?? '').includes('floating');

// When erosion's changes are applied to the mesh and the water (Water._commitDue).
const COMMIT = { gap: 4, drift: 0.05, max: 20 };

let ribbonId = 1;

export class Water {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.terrain = world.terrain;
    this.hydro = new Hydro(world);
    this.fx = null; // WaterFX, set by main.js
    // Erosion and sediment (sim/erosion.js), the support model (sim/support.js) and the specks.
    this.erosion = new Erosion(this.hydro, { strength: loadErosionSetting() });
    this.support = new Support(world);
    this.sedFx = new SedimentFX(scene, world);
    this._tur = 0; this._rootT = 0; this._puffT = 0; this._lastSlump = -1e9;
    // Erosion is slow and needs no real time. Its runs and the commit of what they changed are background jobs that share
    // a slice of every frame (sim/jobs.js); the commit waits until the ground has really moved (see COMMIT below).
    this.jobs = new Jobs();
    this._pend = false;      // erosion changed the ground since the last commit
    this._commitT = 0;       // seconds since the last commit
    this._driftT = 0;

    // Main pool: a fine grid moved by the ripples (one vertex per ripple cell).
    const g = new THREE.PlaneGeometry(TANK.w - 0.1, TANK.d - 0.1, SIM[0], SIM[1]);
    g.rotateX(-Math.PI / 2);
    this.surface = new THREE.Mesh(g, waterSurfaceMaterial({ ripples: true }));
    this.surface.frustumCulled = false;
    this.surface.renderOrder = 5;
    this.surface.name = 'water';
    this.surface.userData.surface = 'water';
    scene.add(this.surface);

    // The water body seen through the front glass: its faces carry a little
    // of the water column's haze (the depth fog in shaders.js does the rest).
    const vm = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.FrontSide });
    vm.colorNode = U.tint.mul(0.3).mul(U.daylight.mul(0.8).add(0.2));
    vm.opacityNode = float(0.05);
    const vg = new THREE.BoxGeometry(TANK.w - 0.12, 1, TANK.d - 0.12);
    vg.translate(0, 0.5, 0);
    this.volume = new THREE.Mesh(vg, vm);
    this.volume.renderOrder = 4;
    scene.add(this.volume);

    this.buildFlowMesh();
    this.fallMat = makeFallMaterial();
    this.splashMat = makeSplashMaterial();
    this.ribbons = new Map();   // key → { mesh, splash, pts, curve, len, q, width, end }
    const dg = new THREE.IcosahedronGeometry(0.16, 0);
    this.drops = new THREE.InstancedMesh(dg, new THREE.MeshStandardNodeMaterial({ color: 0xe8f6ff, roughness: 0.05, transparent: true, opacity: 0.7 }), 500);
    this.drops.frustumCulled = false;
    this.drops.count = 0;
    scene.add(this.drops);
    this.buildMarkers();
    this.previewMat = new THREE.LineBasicNodeMaterial({ color: 0x8fdcff, depthTest: false, transparent: true, opacity: 0.95 });
    this.ringMat = new THREE.MeshBasicNodeMaterial({ color: 0x8fdcff, depthTest: false, transparent: true, opacity: 0.6, side: THREE.DoubleSide });
    this.preview = new THREE.Line(new THREE.BufferGeometry(), this.previewMat);
    this.preview.renderOrder = 22;
    this.preview.frustumCulled = false;
    this.preview.visible = false;
    scene.add(this.preview);
    this.pitMarks = [];
    this._t = 0;
    this.syncLevel();
  }

  get level() { return this.hydro.level; }
  get bodies() { return this.hydro.bodies; }   // the water-body graph (per-pond chemistry)
  get outlets() { return this.hydro.outlets; }
  get pools() { return this.hydro.pools; }
  get ponds() { return this.hydro.pools; }   // older name
  // Every place water pours: off ledges, and down the background from outlets.
  get falls() { return [...this.ribbons.values()]; }

  syncLevel() {
    const L = this.hydro.level;
    U.waterLevel.value = L;
    const on = L > this.terrain.field.h[this.hydro.seed] + 0.3;
    this.surface.position.y = L;
    this.surface.visible = on;
    this.volume.scale.y = Math.max(0.001, L);
    this.volume.visible = on;
  }

  setLevel(y) {
    this.hydro.setLevel(y);
    this.syncLevel();
  }

  // Something other than the water moved the ground a little (a crab digging, sim/burrow.js): it reaches the mesh and the water
  // by the same commit as erosion's changes, when a few millimetres have added up (see _commitDue), even with erosion off.
  groundDisturbed() { this._pend = true; }

  groundChanged() {
    this._pend = false; this._commitT = 0;   // sculpting applies whatever erosion had moved too
    this.erosion.markCommitted();
    this.hydro.rebuild();
    this.syncLevel();
    this.syncFalls(true);
    this.updateMarkers();
  }

  // --- Queries used by plants, animals and the simulation --------------------
  isWater(x, z, minDepth = 0.5) {
    const n = this.hydro.cellOf(x, z);
    return this.hydro.res[n] === 1 && this.level - this.terrain.heightAt(x, z) > minDepth;
  }
  inMainPool(x, z) { return this.hydro.res[this.hydro.cellOf(x, z)] === 1; }
  surfaceAt(x, z, minD) { return this.hydro.surfaceAt(x, z, minD); }
  depthAt(x, z) { return this.hydro.depthAt(x, z); }
  pondAt(x, z) { return this.hydro.poolAt(x, z); }

  surfaceArea() {
    const h = this.hydro;
    let n = 0;
    for (let c = 0; c < h.N; c++) if (h.res[c] || h.d[c] > WET) n++;
    return n * h.area;
  }
  volumeLitres() { return this.hydro.total() / 1000; }
  // Litres per hour splashing through falls and streams right now.
  flowLitresPerHour() { return this.hydro.flowOut * 3.6; }

  nearestFall(p, maxD = 4) {
    let best = null, bd = maxD;
    for (const r of this.ribbons.values()) for (const q of r.pts) {
      const d = q.distanceTo(p);
      if (d < bd) { bd = d; best = r; }
    }
    return best;
  }

  // --- Editing ------------------------------------------------------------
  addOutlet(pos, wall) {
    const o = this.hydro.addOutlet(pos, wall);
    this.updateMarkers();
    this.syncFalls(true);
    return o;
  }
  removeOutlet(o) {
    this.hydro.removeOutlet(o);
    this.updateMarkers();
    this.syncFalls(true);
  }
  fillAt(x, z) { const r = this.hydro.fillAt(x, z); this.syncLevel(); return r; }
  drainPool(p) { this.hydro.drainPool(p); this.syncLevel(); }
  setPump(x, z) {
    this.hydro.pump.intake = { x, z };
    const tot = this.hydro.total();
    this.hydro.rebuild();
    // Keep the same amount of water in the tank.
    this.hydro.resVol = Math.max(0, this.hydro.resVol + tot - this.hydro.total());
    this.hydro.solveLevel();
    this.hydro.updateMembership();
    this.syncLevel();
    this.updateMarkers();
  }

  // --- Pools and streams -------------------------------------------------------
  // Same grid as the substrate. Wet vertices sit on the water surface; dry
  // ones tuck just under the ground, so the surface meets the banks.
  buildFlowMesh() {
    const f = this.terrain.field;
    const g = new THREE.PlaneGeometry(1, 1, f.nx, f.ny);
    g.rotateX(-Math.PI / 2);
    const nv = f.cols * f.rows;
    this.wdata = new THREE.BufferAttribute(new Float32Array(nv * 4), 4);
    this.wdata.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('wdata', this.wdata);
    this.wtur = new THREE.BufferAttribute(new Float32Array(nv), 1);   // cloudiness of the water at each vertex (sediment)
    this.wtur.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('wtur', this.wtur);
    g.attributes.position.setUsage(THREE.DynamicDrawUsage);
    this.flowGeo = g;
    this.flowMesh = new THREE.Mesh(g, makeFlowMaterial());
    this.flowMesh.frustumCulled = false;
    this.flowMesh.renderOrder = 6;
    this.flowMesh.name = 'pond';
    this.flowMesh.userData.surface = 'pond';
    this.scene.add(this.flowMesh);
  }

  updateFlowMesh() {
    const H = this.hydro, f = this.terrain.field;
    const pa = this.flowGeo.attributes.position, wd = this.wdata;
    const h = f.h, d = H.d, res = H.res, L = H.level, sed = this.erosion.s, wt = this.wtur.array;
    for (let n = 0; n < H.N; n++) {
      const [x, z] = H.cellXZ(n);
      let y, show;
      if (res[n]) { y = L - 0.05; show = 0; } else if (d[n] > WET) { y = h[n] + d[n]; show = 1; } else { y = h[n] - 0.25; show = 0; }
      pa.setXYZ(n, x, y, z);
      wd.setXYZW(n, d[n], H.vx[n], H.vz[n], show);
      wt[n] = show && sed[n] > 1e-6 ? 1 - Math.exp(-ERO.turbK * sed[n] / Math.max(0.3, d[n])) : 0;
    }
    pa.needsUpdate = true;
    wd.needsUpdate = true;
    this.wtur.needsUpdate = true;
    this.flowGeo.computeBoundingSphere();
    // The substrate under pools and streams is shaded as wet and submerged.
    const ws = this.terrain.geo.attributes.wsurf;
    if (ws) {
      for (let n = 0; n < H.N; n++) ws.array[n] = res[n] ? L : d[n] > WET ? h[n] + d[n] : -50;
      ws.needsUpdate = true;
    }
  }

  // --- Falls ---------------------------------------------------------------------
  syncFalls(force = false) {
    const H = this.hydro;
    const want = new Map();
    for (const f of H.falls) want.set('f' + f.key, f);
    for (const o of H.outlets) if (o.wall && o.pts?.length > 2) want.set('o' + (o.id ??= ribbonId++), o);
    for (const [k, r] of this.ribbons) {
      const w = want.get(k);
      const qChanged = w && w.q !== undefined && Math.abs(w.q - r.q) > Math.max(3, r.q * 0.35);
      if (!w || force || qChanged) { this.dropRibbon(r); this.ribbons.delete(k); }
    }
    for (const [k, w] of want) {
      if (this.ribbons.has(k)) continue;
      const r = k[0] === 'f' ? this.ledgeRibbon(w) : this.outletRibbon(w);
      if (r) this.ribbons.set(k, r);
    }
  }

  // Water leaving a ledge flies out in an arc (it falls 20 cm in a fifth of
  // a second), then slides down whatever slope it lands on.
  ledgeRibbon(fall) {
    const T = this.terrain;
    const dir = new THREE.Vector3(fall.dir[0], 0, fall.dir[1]);
    const p = fall.from.clone();
    p.addScaledVector(dir, T.field.da * 0.5);
    const v0 = Math.min(45, Math.max(8, fall.q / (fall.width * 0.5)));
    const vel = dir.clone().multiplyScalar(v0);
    const pts = [p.clone()];
    const dt = 0.008;
    for (let s = 0; s < 400; s++) {
      vel.y -= 981 * dt;
      p.addScaledVector(vel, dt);
      const g = T.heightAt(p.x, p.z);
      const surf = this.hydro.surfaceAt(p.x, p.z, 0.3);
      if (surf > -Infinity && p.y <= surf) { p.y = surf; pts.push(p.clone()); break; }
      if (p.y < g + 0.35) {
        p.y = g + 0.35;
        const nrm = T.normalAt(p.x, p.z);
        const vn = vel.dot(nrm);
        if (vn < 0) vel.addScaledVector(nrm, -vn);
        vel.multiplyScalar(0.95);
        if (nrm.y > 0.8 || vel.length() < 6) { pts.push(p.clone()); break; }
      }
      if (s % 2 === 1) pts.push(p.clone());
    }
    if (pts.length < 3 || pts[0].y - pts[pts.length - 1].y < 1.5) return null;
    const w = Math.min(10, Math.max(2.2, fall.width * 1.2));
    return this.makeRibbon(pts, new THREE.Vector3(-dir.z, 0, dir.x), w, fall.q);
  }

  outletRibbon(o) {
    const q = Math.max(1, o.q ?? this.hydro.pump.rate * 1000 / 3600 / Math.max(1, this.hydro.outlets.length));
    return this.makeRibbon(o.pts, new THREE.Vector3(1, 0, 0), 2.2, q, new THREE.Vector3(0, 0, 0.5));
  }

  // Two crossed sheets: one across the lip, and a narrower one along the
  // flow, so a fall has body from any side (one sheet alone vanishes when
  // seen edge-on).
  makeRibbon(pts, side, width, q, lift = new THREE.Vector3()) {
    const pos = [], uvs = [], idx = [];
    const strength = Math.min(1, 0.5 + q / 50);
    const strip = (sideOf, wScale) => {
      const base = pos.length / 3;
      let len = 0;
      for (let i = 0; i < pts.length; i++) {
        if (i > 0) len += pts[i].distanceTo(pts[i - 1]);
        // A little wider as it falls and spreads.
        const w = width * wScale * (0.85 + Math.min(0.5, (i / pts.length) * 0.5));
        const s = sideOf(i);
        const l = pts[i].clone().addScaledVector(s, -w / 2).add(lift);
        const r = pts[i].clone().addScaledVector(s, w / 2).add(lift);
        pos.push(l.x, l.y, l.z, r.x, r.y, r.z);
        uvs.push(0, len, 1, len);
      }
      for (let i = 0; i < pts.length - 1; i++) { const a = base + i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      return len;
    };
    const len = strip(() => side, 1);
    const along = new THREE.Vector3();
    strip((i) => {
      along.subVectors(pts[Math.min(pts.length - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize();
      return new THREE.Vector3().crossVectors(along, side).normalize();
    }, 0.45);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setAttribute('fstr', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3).fill(strength), 1));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, this.fallMat);
    mesh.renderOrder = 7;
    mesh.name = 'fall';
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    const end = pts[pts.length - 1];
    const sg = new THREE.CircleGeometry(Math.min(4, 1.2 + width * 0.4), 20);
    sg.rotateX(-Math.PI / 2);
    const splash = new THREE.Mesh(sg, this.splashMat);
    splash.position.copy(end).add(new THREE.Vector3(0, 0.08, 0));
    splash.renderOrder = 8;
    this.scene.add(splash);
    return { mesh, splash, pts, curve: new THREE.CatmullRomCurve3(pts), len, q, width, end };
  }

  dropRibbon(r) {
    for (const o of [r.mesh, r.splash]) { this.scene.remove(o); o.geometry.dispose(); }
  }

  // --- Pump and outlet markers ------------------------------------------------
  buildMarkers() {
    const dark = new THREE.MeshStandardNodeMaterial({ color: 0x15181b, roughness: 0.6, metalness: 0.2 });
    const pg = new THREE.BoxGeometry(4, 3, 3);
    pg.translate(0, 1.5, 0);
    this.pumpMesh = new THREE.Mesh(pg, dark);
    this.pumpMesh.castShadow = true;
    this.pumpMesh.name = 'pump';
    this.scene.add(this.pumpMesh);
    this.outletGeo = new THREE.CylinderGeometry(0.55, 0.7, 1.4, 10);
    this.outletMat = dark;
    this.outletMeshes = [];
    this.updateMarkers();
  }

  updateMarkers() {
    const H = this.hydro;
    const [x, z] = H.cellXZ(H.seed ?? H.intakeCell());
    this.pumpMesh.position.set(x, this.terrain.heightAt(x, z) - 0.3, z);
    for (const m of this.outletMeshes) this.scene.remove(m);
    this.outletMeshes = H.outlets.map((o) => {
      const m = new THREE.Mesh(this.outletGeo, this.outletMat);
      m.position.copy(o.pos);
      if (o.wall) { m.rotation.x = Math.PI / 2; m.position.z += 0.2; } else m.position.y -= 0.3;
      m.name = 'outlet';
      m.userData.outlet = o;
      this.scene.add(m);
      return m;
    });
  }

  // --- Where would water go from here? --------------------------------------
  showTrace(x, z) {
    const t = this.hydro.trace(x, z);
    const pts = t.path.length > 1 ? t.path : [];
    this.preview.geometry.dispose();
    this.preview.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    this.preview.visible = pts.length > 1;
    this.clearPitMarks();
    this.pitMarks = t.pits.map((p) => {
      let cx = 0, cz = 0;
      for (const c of p.cells) { const [a, b] = this.hydro.cellXZ(c); cx += a; cz += b; }
      const k = Math.max(1, p.cells.length);
      const r = Math.sqrt((p.cells.length * this.hydro.area) / Math.PI);
      const m = new THREE.Mesh(new THREE.RingGeometry(Math.max(0.4, r - 0.4), Math.max(0.9, r), 32).rotateX(-Math.PI / 2), this.ringMat);
      m.position.set(cx / k, p.level + 0.1, cz / k);
      m.renderOrder = 22;
      this.scene.add(m);
      return m;
    });
    return t;
  }
  clearPitMarks() {
    for (const m of this.pitMarks) { this.scene.remove(m); m.geometry.dispose(); }
    this.pitMarks = [];
  }
  hideTrace() {
    this.preview.visible = false;
    this.clearPitMarks();
  }

  // --- Per frame ------------------------------------------------------------------
  // `budget`: milliseconds of this frame the background jobs (erosion) may use.
  animate(dt, speed = 1, budget = 1.2) {
    const H = this.hydro;
    const hs = dt * Math.max(1, Math.min(3, speed));
    H.step(hs);
    this.erode(hs, dt * speed * MINUTES_PER_SECOND, dt, budget);
    this.syncLevel();
    // The surface mesh and its three uploads change slowly; every second frame is indistinguishable.
    if ((this._flowTick = (this._flowTick || 0) + 1) % 2 === 0 || this._flowTick === 1) this.updateFlowMesh();
    this._t -= dt;
    if (this._t <= 0) { this._t = 0.4; this.syncFalls(); }
    // Droplets riding the falls; splashes stir the main pool's ripples.
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    let k = 0;
    const now = performance.now() * 0.001;
    for (const r of this.ribbons.values()) {
      const n = Math.min(40, Math.round(8 + r.len * 0.6));
      const speedK = 30 / Math.max(4, r.len);
      for (let i = 0; i < n && k < 500; i++) {
        const t = (now * speedK * (0.8 + (i % 5) * 0.08) + i / n) % 1;
        const p = r.curve.getPointAt(t);
        p.x += Math.sin(i * 12.9) * r.width * 0.3;
        p.z += Math.cos(i * 7.3) * 0.3;
        const kk = 0.6 + (i % 3) * 0.3;
        m.compose(p, q, s.set(kk, kk * 1.8, kk));
        this.drops.setMatrixAt(k++, m);
      }
      const sc = 1 + Math.sin(now * 6 + r.len) * 0.06;
      r.splash.scale.set(sc, 1, sc);
      if (this.fx && Math.abs(r.end.y - H.level) < 0.8 && Math.random() < 0.7) {
        this.fx.addDrop(r.end.x + (Math.random() - 0.5) * 1.5, r.end.z + (Math.random() - 0.5) * 1.5, -2.5 - Math.random() * 3, 0.6 + Math.random() * 0.5);
      }
    }
    this.drops.count = k;
    this.drops.instanceMatrix.needsUpdate = true;
  }

  // --- Erosion, sediment and what stands ---------------------------------------------
  // hs: seconds of flow simulated this frame, gm: game minutes, dt: real seconds, budget: ms for background jobs.
  erode(hs, gm, dt, budget) {
    const W = this.world, E = this.erosion, eco = W.env;
    this.sedFx.update(dt, E.enabled);
    // Cloudy water: sediment adds to the algae and detritus turbidity (ecology.js sets that one each tick).
    this._tur += ((E.enabled ? E.turb : 0) - this._tur) * Math.min(1, dt * 1.5);
    if (eco && Number.isFinite(eco.algae)) U.turbidity.value = Math.min(1, Math.max(0, eco.algae * 0.9 + (eco.detritus ?? 0) / 60) + this._tur * 0.8);
    if (!W.decor) return;
    if (E.enabled) {
      this._rootT -= dt;
      if (this._rootT <= 0) { this._rootT = 4; E.setRoots(W.plants?.list ?? [], rootedPlant); }
      this._commitT += dt;
      E.gather(hs, gm);
      // One job at a time: a run of erosion over the flow gathered so far, or the commit of what the runs have changed.
      if (!this.jobs.busy) {
        if (this._commitDue(dt)) this.jobs.add(this._commit());
        else { const w = E.take(); if (w) this.jobs.add(this._run(w)); }
      }
      this.jobs.pump(budget);
      for (const ev of E.events.splice(0)) {
        if (this._puffT <= 0) { this.sedFx.puff(ev.x, ev.y, ev.z, ev.v); this._puffT = 0.6; }
        if (eco && eco.minute - this._lastSlump > 30) { this._lastSlump = eco.minute; W.log?.('A bank slumped.', 'info'); }
      }
      this._puffT -= dt;
    } else if (this._pend) {
      this._commitT += dt;
      if (!this.jobs.busy && this._commitDue(dt)) this.jobs.add(this._commit());
      this.jobs.pump(budget);
    }
    this.support.update(dt);
  }

  // The eroded ground reaches the mesh and the water only now and then: after COMMIT.gap seconds, and then only once some
  // cell has moved by COMMIT.drift cm (or COMMIT.max seconds have passed): a millimetre of bank is not worth a rebuild.
  _commitDue(dt) {
    if (!this._pend || this._commitT < COMMIT.gap) return false;
    if (this._commitT >= COMMIT.max) return true;
    this._driftT -= dt;
    if (this._driftT > 0) return false;
    this._driftT = 0.5;
    return this.erosion.drift() >= COMMIT.drift;
  }

  // A run of erosion over a window of flow (a job: see sim/jobs.js).
  *_run(w) {
    if (yield* this.erosion.steps(w.dt, w.T)) this._pend = true;
  }

  // Applies what erosion changed to the terrain mesh and the water, in pieces: the ground and its mesh, then the water's
  // books (the heavy one), then everything that follows the ground.
  *_commit() {
    const W = this.world;
    this._pend = false; this._commitT = 0;
    W.terrain.compose(W.decor.stamps());
    W.terrain.update();
    yield;
    this.hydro.rebuild(true);
    this.syncLevel();
    this.erosion.markCommitted();
    yield;
    W.fx?.updateTerrain?.();
    this.reseatPlants();
    this.updateMarkers();
  }

  // Plants follow the ground as it erodes.
  reseatPlants() {
    const W = this.world, T = W.terrain;
    for (const p of W.plants?.list ?? []) {
      if (p.surface !== 'terrain' || String(PLANTS[p.id]?.habitat ?? '').includes('floating')) continue;
      const y = T.heightAt(p.pos.x, p.pos.z);
      if (Math.abs(y - p.pos.y) < 0.03) continue;
      p.pos.y = y;
      p.normal.copy(T.normalAt(p.pos.x, p.pos.z));
      W.plants.writeInstance(p);
    }
  }

  setErosion(v) {
    this.erosion.setStrength(v);
    saveErosionSetting(v);
    if (v <= 0) { const W = this.world; W.terrain.compose(W.decor.stamps()); W.terrain.update(); this.hydro.rebuild(true); this.syncLevel(); }
  }

  serialize() {
    return { level: this.level, hydro: this.hydro.serialize() };
  }

  load(o) {
    this.jobs.clear(); this.erosion.reset();
    this._pend = false; this._commitT = 0;
    this.erosion.s.fill(0); this.erosion.cum.fill(0);
    if (o.hydro) this.hydro.deserialize(o.hydro);
    else {
      // Saves from before the water simulation: a level plus waterfall sources.
      this.hydro.outlets = [];
      this.hydro.d.fill(0);
      this.hydro.rebuild();
      this.hydro.setLevel(o.level ?? 0);
      for (const s of o.falls ?? []) this.hydro.addOutlet(new THREE.Vector3(...s), s[2] < -TANK.d / 2 + 16);
      this.hydro.prime();
    }
    this.syncLevel();
    this.updateMarkers();
    this.syncFalls(true);
  }

  clear() {
    this.jobs.clear(); this.erosion.reset();
    this._pend = false; this._commitT = 0; this._lastSlump = -1e9; this._puffT = 0;
    this.erosion.s.fill(0); this.erosion.cum.fill(0);
    this.hydro.outlets = [];
    this.hydro.d.fill(0);
    this.hydro.flux.fill(0);
    this.hydro.pump.intake = null;
    this.hydro.rebuild();
    this.hydro.setLevel(0);
    this.hydro.d.fill(0);
    this.hydro.targetTotal = 0;
    this.hydro.resetLedger();
    for (const r of this.ribbons.values()) this.dropRibbon(r);
    this.ribbons.clear();
    this.updateMarkers();
    this.syncLevel();
  }
}

// --- Materials --------------------------------------------------------------------

// Pools and streams. The surface pattern is carried along by the simulated
// flow with the two-phase flow-map trick of Vlachos (Valve, "Water Flow in
// Portal 2"), as in three.js's Water2Mesh: two copies of the pattern slide
// along the flow and cross-fade, so neither stretches too far. Fast water
// gets streaks and white foam.
function makeFlowMaterial() {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const wd = attribute('wdata', 'vec4');
  const depth = wd.x, vel = vec2(wd.y, wd.z), show = wd.w;
  const speed = length(vel);
  const pw = positionWorld;
  const cycle = 1.2;
  const ph0 = fract(time.div(cycle)), ph1 = fract(time.div(cycle).add(0.5));
  const blend = abs(ph0.mul(2).sub(1));
  const dir = vel.div(max(speed, 0.001));
  // Stretch the pattern along the flow so fast water looks streaky.
  const stretch = clamp(speed.div(25), 0, 1).mul(3).add(1);
  const pattern = Fn(([ph]) => {
    const p = pw.xz.sub(vel.mul(ph.mul(cycle)));
    const a = dot(p, dir), b = dot(p, vec2(dir.y.negate(), dir.x));
    return noise3(vec3(a.mul(0.9).div(stretch), b.mul(1.3), 0.5)).add(noise3(vec3(a.mul(2.3).div(stretch), b.mul(3.1), 3.1)).mul(0.5));
  });
  const n = mix(pattern(ph0), pattern(ph1), blend);
  // Normal from the pattern (plus a gentle ripple).
  const bump = n.mul(0.25).add(sin(pw.x.mul(0.8).add(time.mul(1.3))).mul(0.03));
  const k = clamp(speed.div(10), 0.2, 1);
  const nrm = normalize(vec3(bump.mul(dir.x).mul(k), 1, bump.mul(dir.y).mul(k)));
  const foam = smoothstep(0.35, 1.0, n.add(speed.div(45))).mul(clamp(speed.div(30).sub(0.1), 0, 1));
  const view = normalize(cameraPosition.sub(pw));
  const fres = pow(float(1).sub(clamp(abs(dot(view, nrm)), 0, 1)), 5).mul(0.9).add(0.03);
  const deep = clamp(depth.div(6), 0, 1);
  const lit = U.daylight.mul(0.85).add(0.08);
  const tur = attribute('wtur', 'float');
  const water = mix(mix(U.tint.mul(0.18), U.tint.mul(0.06), deep).mul(lit), vec3(0.34, 0.24, 0.13).mul(lit), tur.mul(0.85));
  const rl = max(dot(reflect(view.negate(), nrm), FX.lightDir.negate()), 0);
  const glint = pow(rl, 500).mul(4).add(pow(rl, 40).mul(0.2)).mul(U.daylight);
  const room = vec3(0.025, 0.03, 0.034);
  m.colorNode = mix(mix(water, room, fres), vec3(0.8, 0.85, 0.88).mul(lit), foam).add(glint);
  m.opacityNode = clamp(float(0.12).add(deep.mul(0.35)).add(foam.mul(0.75)).add(fres.mul(0.5)).add(tur.mul(0.3)).add(glint), 0, 0.92).mul(smoothstep(0.3, 0.9, show));
  return m;
}

// Falling water: thin streaks racing down (noise stretched along the flow),
// a whiter core, see-through edges; bigger flows are more opaque.
function makeFallMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, roughness: 0.05 });
  const u = uv();
  const str = attribute('fstr', 'float');
  const streak = noise3(vec3(u.x.mul(14.0), u.y.mul(0.35).sub(time.mul(6.0)), 0.5))
    .add(noise3(vec3(u.x.mul(31.0), u.y.mul(0.8).sub(time.mul(9.0)), 2.5)).mul(0.6));
  const fine = noise3(vec3(u.x.mul(60.0), u.y.mul(3.0).sub(time.mul(16.0)), 7.0));
  const edge = smoothstep(0.0, 0.3, u.x).mul(smoothstep(1.0, 0.7, u.x));
  const core = smoothstep(0.15, 0.5, u.x).mul(smoothstep(0.85, 0.5, u.x));
  const white = smoothstep(-0.1, 0.8, streak.add(fine.mul(0.3)));
  m.colorNode = mix(vec3(0.62, 0.8, 0.84), vec3(0.97, 0.99, 1.0), white);
  m.opacityNode = edge.mul(white.mul(0.6).add(core.mul(0.25)).add(0.12)).mul(str);
  m.emissiveNode = vec3(0.16, 0.18, 0.19).mul(white).mul(U.daylight.mul(0.8).add(0.2));
  return m;
}

function makeSplashMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ transparent: true, depthWrite: false, roughness: 0.2 });
  const u = uv().sub(0.5);
  const r = u.length().mul(2);
  const ring = sin(r.mul(18).sub(time.mul(7))).mul(0.5).add(0.5);
  const n = noise3(vec3(u.x.mul(9), u.y.mul(9), time.mul(2)));
  m.colorNode = vec3(0.95, 0.98, 1);
  m.opacityNode = smoothstep(1.0, 0.2, r).mul(ring.mul(0.35).add(n.mul(0.35)).add(0.15));
  return m;
}
