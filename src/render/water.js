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
  attribute, fract, length, max, min, Fn, reflect, screenUV, positionLocal, normalLocal,
} from 'three/tsl';
import { noise3 } from './noise3.js';
import { TANK, MINUTES_PER_SECOND } from '../sim/tank.js';
import { U } from './uniforms.js';
import { waterSurfaceMaterial, SIM, FX, rippleAt, sceneBehind } from './waterfx.js';
import { Hydro, WET, drawnWater } from '../sim/hydro.js';
import { Erosion, ERO } from '../sim/erosion.js';
import { Jobs } from '../sim/jobs.js';
import { Support } from '../sim/support.js';
import { PLANTS } from '../sim/plants.js';
import { SedimentFX } from './sedimentfx.js';
import { plungeGeometry, makePlungeMaterial } from './falls.js';

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

// The ground's stored height on a rock piece is ROCK_TOP under the rock's drawn face (sim/decor.js stamps the hit point less
// 0.15 cm). Water on rock is drawn this much over the stored height, so a thin film runs over the face instead of inside it.
const ROCK_LIFT = 0.19;
const onRock = (f, n) => !!f.stamped?.[n] && f.h[n] > f.base[n] + 0.05;

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
    this.splashMat = makePlungeMaterial();
    this.ribbons = new Map();   // key → { mesh, splash (the plunge, render/falls.js), pts, curve, len, q, width, end, R }
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
    const h = f.h, d = H.d, res = H.res, L = H.level, sed = this.erosion.s, wt = this.wtur.array, nb = H.nb;
    // One rule for what is drawn (sim/hydro.js drawnWater): deep enough to see, or enough running through to feed a fall.
    const drawn = this._drawn ??= new Uint8Array(H.N);
    for (let n = 0; n < H.N; n++) drawn[n] = drawnWater(H, n) ? 1 : 0;
    const wet = (m) => m >= 0 && (res[m] || drawn[m]);
    // The water's surface over a drawn cell: on rock, over the rock's face.
    const surf = (m) => h[m] + Math.max(d[m], 0.03) + (onRock(f, m) ? ROCK_LIFT : 0);
    const [vx, vz] = this.smoothVelocities();
    const cols = f.cols, nx = f.nx, ny = f.ny;
    for (let n = 0; n < H.N; n++) {
      const [x, z] = H.cellXZ(n);
      let y, show;
      if (res[n]) { y = L - 0.05; show = 0; } else if (drawn[n]) {
        y = surf(n);
        // Fainter where the bank is (dry neighbours), so a stream a cell or two wide fades out at its sides instead of
        // ending in the hard zigzag of the grid's triangles.
        const o = n * 4;
        show = 0.4 + 0.15 * (wet(nb[o]) + wet(nb[o + 1]) + wet(nb[o + 2]) + wet(nb[o + 3]));
      } else {
        // Dry: tucked just under the ground, so the surface meets a bank that rises. Where the ground drops away from
        // the water instead (the lip of a fall) the edge stays near the water's level: tucked under the ground it hung
        // down the whole face of the drop as a sheet with a straight lower edge.
        let s = -Infinity;
        const i = n % cols, j = (n - i) / cols;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const a = i + di, b = j + dj;
          if ((di || dj) && a >= 0 && b >= 0 && a <= nx && b <= ny) { const m = b * cols + a; if (!res[m] && drawn[m] && surf(m) > s) s = surf(m); }
        }
        y = Math.max(h[n] - 0.25, s - 0.3); show = 0;
      }
      pa.setXYZ(n, x, y, z);
      wd.setXYZW(n, drawn[n] && !res[n] ? Math.max(d[n], 0.02) : d[n], vx[n], vz[n], show);
      wt[n] = show && sed[n] > 1e-6 ? 1 - Math.exp(-ERO.turbK * sed[n] / Math.max(0.3, d[n])) : 0;
    }
    pa.needsUpdate = true;
    wd.needsUpdate = true;
    this.wtur.needsUpdate = true;
    this.flowGeo.computeBoundingSphere();
    // The substrate under pools and streams is shaded as wet and submerged; not where the ground is drawn below the
    // stamped height (under an overhang): a stream on the rock does not flood the ground beneath it.
    const ws = this.terrain.geo.attributes.wsurf, hv = f.hv ?? h;
    if (ws) {
      for (let n = 0; n < H.N; n++) ws.array[n] = res[n] ? L : d[n] > WET && hv[n] > h[n] - 0.3 ? h[n] + d[n] : -50;
      ws.needsUpdate = true;
    }
  }

  // The flow as the surface pattern sees it: the simulated velocities averaged twice over each cell and its wet
  // neighbours. Cell to cell they swing in direction, and a pattern carried along them tears into angular stripes
  // along the grid's triangles.
  smoothVelocities() {
    const H = this.hydro, N = H.N, nb = H.nb, d = H.d;
    if (this._sv?.[0].length !== N) this._sv = [0, 1, 2, 3].map(() => new Float32Array(N));
    const [ax, az, bx, bz] = this._sv;
    const blur = (ix, iz, ox, oz) => {
      for (let n = 0; n < N; n++) {
        if (!(d[n] > WET)) { ox[n] = oz[n] = 0; continue; }
        let x = ix[n], z = iz[n], k = 1;
        for (let j = n * 4; j < n * 4 + 4; j++) { const m = nb[j]; if (m >= 0 && d[m] > WET) { x += ix[m]; z += iz[m]; k++; } }
        ox[n] = x / k; oz[n] = z / k;
      }
    };
    blur(H.vx, H.vz, ax, az);
    blur(ax, az, bx, bz);
    return [bx, bz];
  }

  // --- Falls ---------------------------------------------------------------------
  syncFalls(force = false) {
    const H = this.hydro;
    const want = new Map();
    for (const f of H.falls) want.set('f' + f.key, f);
    // A spring on the background pours only while the pump sends it water (pump on, intake under water, valve open).
    for (const o of H.outlets) if (o.wall && o.pts?.length > 2 && o.q > 0.5) want.set('o' + (o.id ??= ribbonId++), o);
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
    // (a lip on rock: the water runs over the rock's face, as the stream above it is drawn)
    const fc = this.hydro.cellOf(p.x, p.z);
    if (onRock(T.field, fc)) p.y += ROCK_LIFT;
    p.addScaledVector(dir, T.field.da * 0.5);
    const v0 = Math.min(45, Math.max(8, fall.q / (fall.width * 0.5)));
    const vel = dir.clone().multiplyScalar(v0);
    // The sheet starts on the stream a cell short of the lip and bends over it, so the fall grows out of the water
    // above instead of beginning at a straight cut.
    const da = T.field.da;
    const pts = [p.clone().addScaledVector(dir, -1.4 * da), p.clone().addScaledVector(dir, -0.7 * da), p.clone()];
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
    if (pts.length < 5 || pts[0].y - pts[pts.length - 1].y < 1.5) return null;
    const w = Math.min(10, Math.max(2.2, fall.width * 1.2));
    return this.makeRibbon(pts, new THREE.Vector3(-dir.z, 0, dir.x), w, fall.q, { lip: 2, bulge: dir, fadeIn: 1.4 * da });
  }

  outletRibbon(o) {
    const q = Math.max(1, o.q);
    return this.makeRibbon(o.pts, new THREE.Vector3(1, 0, 0), 2.2, q, { lift: new THREE.Vector3(0, 0, 0.5), bulge: new THREE.Vector3(0, 0, 1) });
  }

  // Two crossed sheets: one across the lip, and a narrower one along the
  // flow, so a fall has body from any side (one sheet alone vanishes when
  // seen edge-on). The sheet across has several columns, so the middle of the
  // tongue can run ahead of its sides (water is slowed at the ends of a lip).
  // Per vertex (`fdat`): the flow's strength, how aerated the water is (glassy
  // at the lip and where it slides over the ground, white once it has fallen a
  // few centimetres), how far in from the ends it is (soft start and end) and how far it has torn into ropes; uv.y is
  // the water's time of flight from the lip.
  makeRibbon(path, side, width, q, { lift = new THREE.Vector3(), bulge = null, lip = 0, fadeIn = 0.6 } = {}) {
    const pos = [], uvs = [], dat = [], idx = [];
    const strength = Math.min(1, 0.5 + q / 50);
    // A fall that lands in water goes on into it: the sheet runs a centimetre under the surface and fades out there, so
    // it meets its foam instead of stopping in the air above the pool.
    const foot = path[path.length - 1], fs = this.hydro.surfaceAt(foot.x, foot.z, 0.2);
    const sink = fs > -Infinity && Math.abs(foot.y - fs) < 1.2;
    const pts = sink ? [...path, foot.clone().add(new THREE.Vector3(foot.x - path[path.length - 2].x, 0, foot.z - path[path.length - 2].z).clampLength(0, 0.4)).setY(fs - 1.2)] : path;
    const n = pts.length;
    const lens = [0];
    for (let i = 1; i < n; i++) lens.push(lens[i - 1] + pts[i].distanceTo(pts[i - 1]));
    const len = lens[n - 1];
    const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const top = pts[Math.min(lip, n - 1)].y;
    const drop = pts.map((p) => Math.max(0, top - p.y));
    const aer = pts.map((p, i) => {
      const a = pts[Math.min(n - 1, i + 1)], b = pts[Math.max(0, i - 1)];
      const steep = Math.abs(a.y - b.y) / Math.max(1e-4, a.distanceTo(b));
      return sm(1.2, 6, drop[i]) * (0.35 + 0.65 * sm(0.25, 0.75, steep));
    });
    // Time of flight from the lip (s), the pattern's coordinate along the sheet: water leaves the lip slowly and speeds
    // up as it falls (v² = v0² + 2gh), so what rides on it runs faster and is drawn out into streaks lower down. Slowed
    // (6 cm/s at the lip, 24 after 9 cm) so the streaks still read at 30 frames a second.
    const tof = [0];
    for (let i = 1; i < n; i++) tof.push(tof[i - 1] + (lens[i] - lens[i - 1]) / (6 + 6 * Math.sqrt((drop[i] + drop[i - 1]) / 2)));
    // Where the sheet tears into ropes with air between them: after a few centimetres of fall, and only a sheet wide enough
    // to tear (a narrow jet stays one column).
    const brk = drop.map((d) => sm(2.5, 10, d) * sm(1.5, 5, width));
    const fade = lens.map((l, i) => sm(0, fadeIn, l) * (sink ? (i < n - 1 ? 1 : 0) : sm(0, 1.6, len - l)));
    const lead = Math.min(0.8, width * 0.12);
    // Water stands higher in the middle of a lip than at its ends, so seen from the front the top of the sheet is an
    // arch: the sides drop a little sooner.
    const sag = Math.min(0.7, width * 0.09);
    const strip = (sideOf, wScale, cols, bulgeDir) => {
      const base = pos.length / 3;
      for (let i = 0; i < n; i++) {
        // Drawn in a little by surface tension as it leaves the lip, then fraying outward as it breaks up.
        const w = width * wScale * (1 - 0.15 * sm(0, 4, drop[i]) + 0.14 * brk[i]);
        const sd = sideOf(i);
        const ahead = bulgeDir ? lead * sm(0, 2, lens[i] - lens[Math.min(lip, n - 1)]) : 0;
        for (let c = 0; c <= cols; c++) {
          const u = c / cols, x = u * 2 - 1;
          const v = pts[i].clone().addScaledVector(sd, (x * w) / 2).add(lift);
          if (ahead) v.addScaledVector(bulgeDir, ahead * (1 - x * x));
          if (bulgeDir && cols > 1) v.y -= sag * x * x * sm(-0.5, 1.5, lens[i] - lens[Math.min(lip, n - 1)]);
          pos.push(v.x, v.y, v.z);
          uvs.push(u, tof[i]);
          dat.push(strength, aer[i], fade[i], brk[i]);
        }
      }
      for (let i = 0; i < n - 1; i++) for (let c = 0; c < cols; c++) {
        const a = base + i * (cols + 1) + c, d = a + cols + 1;
        idx.push(a, d, a + 1, a + 1, d, d + 1);
      }
    };
    strip(() => side, 1, 6, bulge);
    const along = new THREE.Vector3();
    strip((i) => {
      along.subVectors(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize();
      return new THREE.Vector3().crossVectors(along, side).normalize();
    }, 0.45, 1, null);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setAttribute('fdat', new THREE.Float32BufferAttribute(dat, 4));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, this.fallMat);
    mesh.renderOrder = 7;
    mesh.name = 'fall';
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    const end = foot, m = path.length;
    // The plunge (render/falls.js): foam where it lands, and in standing water a trail of foam carried off toward the
    // pool's outlet (the pump's intake in the main pool). Heading: the fall's own, or straight out from a wall it runs down.
    const H = this.hydro, hh = this.terrain.field.h, a = path[Math.max(0, m - 4)];
    const head = new THREE.Vector2(end.x - a.x, end.z - a.z);
    if (head.length() < 0.2) head.set(bulge?.x ?? -side.z, bulge?.z ?? side.x);
    head.normalize();
    const inPool = sink && H.res[H.cellOf(end.x, end.z)];
    const intake = inPool ? H.pump.intake ?? (H.seed !== undefined ? { x: H.cellXZ(H.seed)[0], z: H.cellXZ(H.seed)[1] } : null) : null;
    const wetAt = (x, z) => { const c = H.cellOf(x, z); return H.res[c] ? H.level - hh[c] > 0.4 : H.d[c] > 0.4; };
    const R = Math.min(3.4, 1 + width * 0.3 + q * 0.015);
    const sg = plungeGeometry({ foot: new THREE.Vector3(end.x, (sink ? fs : end.y) + 0.08, end.z), dir: [head.x, head.y], toward: intake, R, q, wet: sink ? wetAt : () => false });
    const splash = new THREE.Mesh(sg, this.splashMat);
    splash.renderOrder = 8;
    this.scene.add(splash);
    return { mesh, splash, pts: path, curve: new THREE.CatmullRomCurve3(path.slice(lip)), len: lens[m - 1] - lens[Math.min(lip, m - 1)], q, width, end, R };
  }

  // Which falls land in still water (the main pool or a pond), and the ponds for the ripple simulation (WaterFX.setStill):
  // standing water outside the main pool, not the streams (the current sweeps ripples away).
  syncStill() {
    const H = this.hydro, h = this.terrain.field.h, d = H.d, res = H.res, vx = H.vx, vz = H.vz;
    for (const r of this.ribbons.values()) {
      const s = H.surfaceAt(r.end.x, r.end.z, 0.2);
      r.wet = s > -Infinity && Math.abs(r.end.y - s) < 1.2;
    }
    this.fx?.setStill((n) => (!res[n] && d[n] > 0.25 && vx[n] * vx[n] + vz[n] * vz[n] < 64 ? h[n] + d[n] : -Infinity));
    // Rock that water runs over looks wet: the cells on rock whose water is drawn (a film too thin to see as water reads as a
    // dark, glossy streak, as a real one on stone does), wetter the more runs over it; it dries over a minute and a half once the
    // water stops (this runs every 0.4 s).
    const f = this.terrain.field, F = H.flux, drawn = this._drawn;
    if (!drawn) return;
    const wr = this._wetRock?.length === H.N ? this._wetRock : (this._wetRock = new Float32Array(H.N));
    for (let n = 0; n < H.N; n++) {
      const t = drawn[n] && !res[n] && onRock(f, n) ? Math.min(1, 0.55 + d[n] * 1.5 + (F[n * 4] + F[n * 4 + 1] + F[n * 4 + 2] + F[n * 4 + 3]) / 12) : 0;
      wr[n] = t >= wr[n] ? t : Math.max(t, wr[n] - 0.4 / 90);
    }
    this.fx?.setWet((n) => wr[n]);
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
    this.markerVis = { outlets: false, pump: false };   // set by the editor for the tool in use
    this.updateMarkers();
  }

  // Which markers the editor wants shown (the Water tool shows both, Erase the outlets); kept when they are rebuilt.
  showMarkers(outlets, pump) {
    this.markerVis = { outlets, pump };
    this.pumpMesh.visible = pump;
    for (const m of this.outletMeshes) m.visible = outlets;
  }

  updateMarkers() {
    const H = this.hydro;
    const [x, z] = H.cellXZ(H.seed ?? H.intakeCell());
    this.pumpMesh.position.set(x, this.terrain.heightAt(x, z) - 0.3, z);
    this.pumpMesh.visible = this.markerVis.pump;
    for (const m of this.outletMeshes) this.scene.remove(m);
    this.outletMeshes = H.outlets.map((o) => {
      const m = new THREE.Mesh(this.outletGeo, this.outletMat);
      m.position.copy(o.pos);
      if (o.wall) { m.rotation.x = Math.PI / 2; m.position.z += 0.2; } else m.position.y -= 0.3;
      m.name = 'outlet';
      m.visible = this.markerVis.outlets;
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
    if (this._t <= 0) { this._t = 0.4; this.syncFalls(); this.syncStill(); }
    // Droplets torn off the falls and thrown up where they land; where a fall lands in the main pool or a still pond it
    // stirs the ripples.
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    let k = 0;
    const now = performance.now() * 0.001;
    for (const r of this.ribbons.values()) {
      // Only off the lower sheet, where it breaks into ropes (none on the glassy top), riding just outside it.
      const n = Math.min(24, Math.round(4 + r.len * 0.4));
      const speedK = 30 / Math.max(4, r.len);
      for (let i = 0; i < n && k < 500; i++) {
        const t = 0.4 + 0.6 * ((now * speedK * (0.8 + (i % 5) * 0.08) + i / n) % 1);
        p.copy(r.curve.getPointAt(t));
        p.x += Math.sin(i * 12.9) * r.width * 0.4;
        p.z += Math.cos(i * 7.3) * 0.4;
        const kk = 0.4 + (i % 3) * 0.2;
        m.compose(p, q, s.set(kk, kk * 2.2, kk));
        this.drops.setMatrixAt(k++, m);
      }
      // Spray: short hops out of the boil at the foot, each in a new direction (a little slowed).
      if (r.wet) for (let i = 0, ns = Math.min(14, 4 + Math.round(r.q / 4)); i < ns && k < 500; i++) {
        const life = 0.3 + (i % 4) * 0.06, c = (now + i * 0.137) / life, t = c % 1, a = i * 2.399 + Math.floor(c) * 1.7;
        const out = (0.3 + (i % 3) * 0.25) * r.R, hgt = Math.min(2.5, 0.4 + r.q / 30 + (i % 2) * 0.4);
        p.set(r.end.x + Math.cos(a) * out * t, r.end.y + 4 * hgt * t * (1 - t), r.end.z + Math.sin(a) * out * t);
        const kk = 0.3 + (i % 3) * 0.12;
        m.compose(p, q, s.set(kk, kk, kk));
        this.drops.setMatrixAt(k++, m);
      }
      // The plunge: a few drops a frame scattered over the foot, harder for a bigger flow, so rings keep spreading
      // from it and run into each other instead of one steady pulse; a big fall also stirs the edge of its foam ring.
      if (this.fx && r.wet && Math.random() < 0.85) {
        const sp = Math.min(2.5, 0.8 + r.width * 0.2), k = Math.min(1.6, 0.6 + r.q / 40);
        this.fx.addDrop(r.end.x + (Math.random() - 0.5) * sp, r.end.z + (Math.random() - 0.5) * sp, -(1.5 + Math.random() * 3.5) * k, 0.45 + Math.random() * 0.6);
        if (r.q > 12 && Math.random() < 0.5) {
          const a = Math.random() * 6.283;
          this.fx.addDrop(r.end.x + Math.cos(a) * r.R * 0.85, r.end.z + Math.sin(a) * r.R * 0.85, -(1 + Math.random() * 2) * k, 0.4 + Math.random() * 0.3);
        }
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
      const y = W.plants.seatY?.(p.pos.x, p.pos.z) ?? T.heightAt(p.pos.x, p.pos.z);     // (the drawn ground, sim/plants.js)
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
    // The roots are the new world's: refresh them before the first erosion run (a reused tank kept the old plants' roots,
    // and a bank the old plants held could slump the moment the new game started).
    this._rootT = 0; this.erosion.root.fill(0);
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
    this._rootT = 0; this.erosion.root.fill(0);   // the new world's roots before the first erosion run, as in load()
    this.erosion.s.fill(0); this.erosion.cum.fill(0);
    this.hydro.outlets = [];
    this.hydro.d.fill(0);
    this.hydro.flux.fill(0);
    this.hydro.pump.intake = null;
    this.hydro.resVol = 0;   // an empty tank: the pump goes back to the deepest point (hydro.rebuild pins it only over water)
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
  // The pattern drifts with the flow but no faster than 15 cm/s: water running down a slope reaches 1-2 m/s in the
  // simulation, and a pattern carried that far each cycle is squeezed into stripes wherever the flow bends (and is only
  // flicker at a phone's 30 fps). It is not turned to the flow either: turning world coordinates by a direction that
  // changes from cell to cell swirls the noise into rings.
  const drift = vel.mul(min(float(1), float(15).div(max(speed, 0.001))));
  const pattern = Fn(([ph]) => {
    const p = pw.xz.sub(drift.mul(ph.mul(cycle)));
    return noise3(vec3(p.x.mul(1.1), p.y.mul(1.1), 0.5)).add(noise3(vec3(p.x.mul(2.7), p.y.mul(2.7), 3.1)).mul(0.5));
  });
  const n = mix(pattern(ph0), pattern(ph1), blend);
  // Normal from the pattern (plus a gentle ripple).
  const bump = n.mul(0.25).add(sin(pw.x.mul(0.8).add(time.mul(1.3))).mul(0.03));
  const k = clamp(speed.div(10), 0.2, 1);
  // Still water also carries the ripple simulation's waves (render/waterfx.js: rings from the falls' plunge, animals,
  // clicks), steeper than the main pool's so a small pond reads them; the current of a stream sweeps them away.
  const rip = rippleAt(pw.xz).mul(FX.on).mul(clamp(float(1).sub(speed.div(8)), 0, 1).mul(2.5));
  const nrm = normalize(vec3(bump.mul(dir.x).mul(k).sub(rip.y), 1, bump.mul(dir.y).mul(k).sub(rip.z)));
  // White water: streaks where the pattern runs high, more of them the faster the flow, never a solid sheet (speed
  // alone used to push every fragment past the threshold, and a stream on a slope was a flat white band). A film a
  // millimetre or two deep holds little foam: it shows the wet ground through it.
  const body = smoothstep(0.1, 1.5, depth).mul(0.5).add(0.5);
  const flowK = clamp(speed.div(40), 0, 1);
  // Foam along the banks, as in Arnklit's Waterways (the idea, not the code): foam gathers where moving water meets the edge
  // and slows. `show` counts a cell's wet neighbours (updateFlowMesh), so it falls toward a bank; there, in a thin film, a
  // line of foam broken up by the same pattern, more of it where faster water runs into the bank, a faint scum on a pond.
  const edge = clamp(float(1).sub(show).div(0.6), 0, 1);
  const shoal = smoothstep(0.9, 0.05, depth);
  const bank = edge.mul(edge).mul(shoal.mul(0.6).add(0.4)).mul(smoothstep(0.0, 0.5, n.add(0.15))).mul(clamp(speed.div(14), 0.15, 1));
  const foam = max(smoothstep(0.2, 0.9, n.add(clamp(speed.div(100), 0, 0.3))).mul(clamp(speed.div(30).sub(0.1), 0, 1)).mul(body), bank.mul(0.75));
  // Running water between the streaks: a lighter sheen that moves with the pattern, so a shallow stream still reads as
  // water over the wet ground. Still water (pools) has none.
  const sheen = smoothstep(-0.15, 0.5, n).mul(flowK);
  const view = normalize(cameraPosition.sub(pw));
  const fres = pow(float(1).sub(clamp(abs(dot(view, nrm)), 0, 1)), 5).mul(0.9).add(0.03);
  const deep = clamp(depth.div(6), 0, 1);
  const lit = U.daylight.mul(0.85).add(0.08);
  // Silt: what erosion has put in the water (wtur), and the fine soil a fast, shallow run lifts off its bed as it goes, so a
  // stream's channel reads as a muddier line than the still pool it runs into (full at 40 cm/s, 0.3 at most).
  const tur = clamp(attribute('wtur', 'float').add(flowK.mul(float(1).sub(clamp(depth.div(6), 0, 1))).mul(0.3)), 0, 1);
  const water = mix(mix(U.tint.mul(0.18), U.tint.mul(0.06), deep).mul(lit), vec3(0.34, 0.24, 0.13).mul(lit), tur.mul(0.85));
  const rl = max(dot(reflect(view.negate(), nrm), FX.lightDir.negate()), 0);
  const glint = pow(rl, 500).mul(4).add(pow(rl, 40).mul(0.2)).mul(U.daylight);
  const room = vec3(0.025, 0.03, 0.034);
  const flowing = mix(water, vec3(0.42, 0.52, 0.56).mul(lit), sheen.mul(0.45));
  // Seen through the water: the rendered scene behind the surface, as the main pool does (render/waterfx.js), bent by
  // the ripples, so the bed wavers as the stream runs over it; running water bends it more. The water's own colour lies
  // over it (more of it with depth, cloudiness and the sheen), the reflection with the angle, foam on top. Opaque, so
  // nothing is drawn twice; at the banks it fades out to the plain ground.
  const bendK = mix(float(0.02), float(0.06), flowK);
  const below = sceneBehind(screenUV.add(nrm.xz.mul(bendK))).rgb;
  const veil = clamp(float(0.12).add(flowK.mul(0.1)).add(sheen.mul(0.15)).add(deep.mul(0.35)).add(tur.mul(0.3)), 0, 0.85);
  const under = mix(below.mul(vec3(0.9, 0.96, 0.97)), flowing, veil);
  m.colorNode = mix(mix(under, room, fres), vec3(0.8, 0.85, 0.88).mul(lit), foam).add(glint);
  m.opacityNode = smoothstep(0.05, 1, show);
  return m;
}

// Falling water. At the lip and where it slides over the ground it is a glassy sheet: what lies behind it shows
// through, bent by the streaks (the same screen copy the pools refract, render/waterfx.js), with a sheen that moves with
// the water. The pattern rides the water (its coordinate along the sheet is the time of flight, see makeRibbon), so it
// creeps over the lip and races at the foot, drawn out into streaks. Once the water has fallen a few centimetres air
// gets in and it turns white in streaks, and lower still the sheet tears into ropes with air between them. The top and
// the sides are ragged and move, so the sheet is never a rectangle with a straight upper edge.
function makeFallMaterial() {
  // Lit here rather than by the standard lighting, as the pools are: its bright environment map turned any part of the
  // sheet that faces up (the lip, a slide down a slope) into a flat white slab, and its highlight ran along the fold at
  // the lip as a straight bright line.
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const u = uv();
  const fd = attribute('fdat', 'vec4');
  const str = fd.x, aer = fd.y, fade = fd.z, brk = fd.w;
  const ride = u.y.sub(time);
  const streak = noise3(vec3(u.x.mul(14.0), ride.mul(2.2), 0.5)).add(noise3(vec3(u.x.mul(31.0), ride.mul(5.0), 2.5)).mul(0.6));
  const fine = noise3(vec3(u.x.mul(60.0), ride.mul(14.0), 7.0));
  const wob = noise3(vec3(ride.mul(0.9), u.x.mul(3.0), 4.4));
  const side = abs(u.x.mul(2).sub(1)).add(wob.mul(0.12).add(brk.mul(0.08)));
  const edge = smoothstep(1.0, 0.62, side);
  const core = smoothstep(0.7, 0.0, side);
  const ends = smoothstep(0.1, 0.9, fade.add(wob.mul(0.35)));
  // Ropes: a pattern across the sheet, long along the fall (it rides the water too), whose gaps open as it breaks up.
  const rope = noise3(vec3(u.x.mul(8.0).add(wob.mul(0.5)), ride.mul(0.6), 6.1));
  const solid = mix(float(1), smoothstep(-0.22, -0.02, rope), brk);
  // The sheet is no flat ribbon: it bulges and ripples as it falls, more once air is in it and most where it tears into
  // ropes (two reads of the baked noise per vertex, riding the water like the pattern; nothing added per fragment). The
  // pattern's coordinate is the time of flight (makeRibbon), so it already speeds up down the fall as v² = v0² + 2gh.
  const dn = noise3(vec3(u.x.mul(4.0), ride.mul(1.6), 9.3)).add(noise3(vec3(u.x.mul(9.0), ride.mul(3.4), 12.7)).mul(0.5));
  m.positionNode = positionLocal.add(normalLocal.mul(dn.mul(aer.mul(0.22).add(brk.mul(0.3)).add(0.03))));
  const froth = smoothstep(-0.05, 0.6, streak.add(fine.mul(0.3)));
  const white = aer.mul(mix(float(0.3), float(1), froth)).mul(solid.mul(0.4).add(0.6));
  const glass = float(1).sub(aer).mul(float(1).sub(white));
  const lit = U.daylight.mul(0.8).add(0.12);
  const below = sceneBehind(screenUV.add(vec2(streak.mul(0.01), fine.mul(0.005)))).rgb;
  const sheen = smoothstep(0.25, 0.65, streak).mul(glass).mul(0.22).mul(lit);
  const airyCol = mix(vec3(0.5, 0.64, 0.68), vec3(0.9, 0.93, 0.95), white).mul(lit);
  m.colorNode = mix(below.mul(vec3(0.86, 0.95, 0.97)), airyCol, float(1).sub(glass)).add(sheen);
  const airy = white.mul(0.7).add(core.mul(0.2)).add(0.14);
  m.opacityNode = edge.mul(ends).mul(str).mul(solid).mul(mix(float(0.9), airy, aer));
  return m;
}
