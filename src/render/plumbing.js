// The visible plumbing of the pump circuit (sim/hydro.js, nothing here changes the hydrology):
//
//   main pool: screened intake -> pump housing -> hose -> (buried under the substrate) -> up the background wall -> outlet
//   external filter (sponge box, canister) in the cabinet under the tank, plumbed through two bulkheads in the tank floor:
//   its own pump pulls the pool's water in through the intake (a strainer on a short pipe), through the filter, and
//   pushes it back up through the return (a short pipe with a nozzle) into the pool. Nothing goes over the rim.
//
// Everything static (housing, intake grill, hoses, wall clips, filter) is merged into ONE mesh and rebuilt only when the
// intake, an outlet, the water level or the ground changed (at most once every couple of seconds). Hoses follow the
// ground a little under its surface, so they vanish into the substrate and rocks and show only where they run through
// open air: up the background wall, and at the pump. Hoses come in real sizes (sim/filterflow.js: 9/12 mm on a small pump,
// 16/22 mm on a canister) and the water in each is a band of light that moves at the water's real speed in it, its flow
// over its bore (v = Q / A), the way the water goes: down the drain to the filter, up the return; jets show the clean water
// leaving the filter. The filter's media stages show their clog in their colour. Hidden in photo mode and Kids mode, and
// with Care > Water > Show equipment off, unless a view layer that shows the build is on (render/layers.js): then the same
// geometry is drawn a second time, glowing, only where something covers it (the `ghost`, depth test reversed), so hoses
// buried in the substrate and run behind rocks show through.

import * as THREE from 'three/webgpu';
import { attribute, uniform, sin, smoothstep, vec3, float, mix, abs, dot, normalView, normalWorld, positionWorld } from 'three/tsl';
import { wet, U } from './shaders.js';
import { TANK } from '../sim/tank.js';
import { pumpCurve } from '../sim/hydro.js';
import { filterEff, filterOf } from '../content/equipment.js';
import { filterFlow, pumpHose, hoseSpeed, CABINET_DROP, FILTER_TOP, poolCurrent } from '../sim/filterflow.js';

// The moving water: bands BAND cm apart that travel at the water's speed. The clock wraps every WRAP s and every speed is
// rounded to a whole number of bands per wrap (0.1 cm/s), so the wrap is seamless and the phase stays small.
const BAND = 10, WRAP = 100, JBAND = 2.5;
const vq = (v) => Math.round(Math.max(0, v) * WRAP / BAND) * BAND / WRAP;
const rOf = (od) => od / 20;                     // mm outer diameter -> cm radius
const HOSE = new THREE.Color(0x2e3b41), CLIP = new THREE.Color(0xa6aeb2), BODY = new THREE.Color(0x242b30), CAPC = new THREE.Color(0x39444b);
const GRILL = new THREE.Color(0x86979c), SLOT = new THREE.Color(0x151a1d), PIPE = new THREE.Color(0xc9ccc6);
const FOAM = new THREE.Color(0x27333e), FOAM2 = new THREE.Color(0x34424e), CLEAR = new THREE.Color(0x9fb4b8), PVC = new THREE.Color(0xe8e8e2);
const FHOSE = new THREE.Color(0x4c5e55), WATER = new THREE.Color(0x1f4b52), DIRT = new THREE.Color(0x4a3a24);
// Each media stage clean, and what it turns to as it fills with mulm (lerped by its clog).
const MEDIA = { mech: [0x2f6aa3, 0x4d3c25], bioSponge: [0x3d4f5f, 0x4a3f2c], bio: [0xb9b2a2, 0x5d5236], chem: [0x1a1c1e, 0x3e372c], floss: [0xe9e9e4, 0x8a7550] };
const media = (id, c) => new THREE.Color(MEDIA[id][0]).lerp(new THREE.Color(MEDIA[id][1]), Math.min(1, c) * 0.9);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Merged-geometry builder: positions, normals, vertex colours and `along` (x: distance along a hose in cm, y: the water's
// speed in it in cm/s, z: its circuit, 1 the main pump, 2 the filter; all 0 off the hoses).
class Soup {
  constructor() { this.p = []; this.n = []; this.c = []; this.a = []; this.i = []; }
  get count() { return this.p.length / 3; }
  geo(g, m, color) {
    const pos = g.attributes.position, nor = g.attributes.normal, base = this.count;
    const nm = new THREE.Matrix3().getNormalMatrix(m), v = new THREE.Vector3();
    for (let k = 0; k < pos.count; k++) {
      v.fromBufferAttribute(pos, k).applyMatrix4(m); this.p.push(v.x, v.y, v.z);
      v.fromBufferAttribute(nor, k).applyMatrix3(nm).normalize(); this.n.push(v.x, v.y, v.z);
      this.c.push(color.r, color.g, color.b); this.a.push(0, 0, 0);
    }
    const idx = g.index;
    for (let k = 0; k < idx.count; k++) this.i.push(base + idx.getX(k));
  }
  // A swept tube along `pts` (already dense), radius r, water at speed v (cm/s) from the first point to the last. Frames are
  // parallel-transported.
  tube(pts, r, color, seg = 7, v = 0, circuit = 0) {
    const n = pts.length;
    if (n < 2) return;
    const base = this.count;
    let nrm = V(0, 1, 0), len = 0;
    const tan = V(0, 0, 0), bin = V(0, 0, 0);
    for (let k = 0; k < n; k++) {
      tan.subVectors(pts[Math.min(n - 1, k + 1)], pts[Math.max(0, k - 1)]).normalize();
      if (Math.abs(tan.dot(nrm)) > 0.95) nrm = Math.abs(tan.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0);
      nrm.addScaledVector(tan, -nrm.dot(tan)).normalize();
      bin.crossVectors(tan, nrm);
      if (k) len += pts[k].distanceTo(pts[k - 1]);
      for (let s = 0; s < seg; s++) {
        const a = (s / seg) * Math.PI * 2, cx = Math.cos(a), cy = Math.sin(a);
        const nx = nrm.x * cx + bin.x * cy, ny = nrm.y * cx + bin.y * cy, nz = nrm.z * cx + bin.z * cy;
        this.p.push(pts[k].x + nx * r, pts[k].y + ny * r, pts[k].z + nz * r); this.n.push(nx, ny, nz);
        this.c.push(color.r, color.g, color.b); this.a.push(len, v, circuit);
      }
    }
    for (let k = 0; k < n - 1; k++) for (let s = 0; s < seg; s++) {
      const a = base + k * seg + s, b = base + k * seg + (s + 1) % seg, c = a + seg, d = b + seg;
      this.i.push(a, c, b, b, c, d);
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('along', new THREE.Float32BufferAttribute(this.a, 3));
    g.setIndex(this.i);
    return g;
  }
}

const cylM = (x, y, z, rx = 0, rz = 0) => new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, rz)), V(1, 1, 1));

export class Plumbing {
  constructor(parent, world) {
    this.world = world;
    this.show = true;            // Care > Water > Show equipment
    this.hidden = null;          // () => boolean, set by the game (photo mode, Kids mode)
    this.group = new THREE.Group();
    this.group.name = 'plumbing';
    parent.add(this.group);
    this.run = uniform(0);       // 0 … 1: the pump is running (smoothed)
    this.frun = uniform(0);      // 0 … 1: the filter's pump is running (smoothed)
    this.clock = uniform(0);     // s, wrapped every WRAP
    // As creatureMaterial, but nothing under the glass floor (the cabinet) is under water: the water's tint and caustics stop
    // at the floor, and the room's light reaches into the open cabinet.
    const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.42, metalness: 0.15, vertexColors: true, side: THREE.DoubleSide });
    const below = smoothstep(-0.3, -1.3, positionWorld.y);
    const [wc, we] = wet(vec3(1), positionWorld, below.greaterThan(0.5).select(float(-1e4), U.waterLevel));
    mat.colorNode = wc;
    // Water moving in the hose: soft bright bands that travel along it at the water's speed, while its pump runs.
    // (The room's light: brighter on faces turned up. The bands are fainter on light pipes than on dark hose.)
    const col = attribute('color', 'vec3'), band = this.band();
    const room = col.mul(below).mul(normalWorld.y.mul(0.3).add(0.45));
    mat.emissiveNode = we.add(room).add(vec3(0.12, 0.5, 0.62).mul(band).mul(float(1).sub(dot(col, vec3(0.3, 0.59, 0.11)).mul(0.75))).mul(0.38));
    this.mat = mat;
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    this.mesh.frustumCulled = false; this.mesh.castShadow = true; this.mesh.receiveShadow = true; this.mesh.name = 'plumbing-mesh';
    this.group.add(this.mesh);
    // Clean water leaving the filter: short streaky jets from its outlets, as strong as the flow it still passes.
    this.fflow = uniform(0);     // 0 … 1: the filter's pump running, less what clogging takes
    const jm = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const ja = attribute('along', 'vec3');
    jm.colorNode = vec3(0.5, 0.82, 0.95);
    const streak = sin(ja.x.sub(ja.y.mul(this.clock)).mul(Math.PI * 2 / JBAND)).mul(0.5).add(0.5);
    jm.opacityNode = this.fflow.mul(smoothstep(0.35, 1.0, streak).mul(0.7).add(0.2)).mul(float(1).sub(smoothstep(0.6, 3.6, ja.x))).mul(0.55);
    this.jets = new THREE.Mesh(new THREE.BufferGeometry(), jm);
    this.jets.frustumCulled = false; this.jets.renderOrder = 7; this.jets.name = 'filter-jets';
    this.group.add(this.jets);
    this.sig = ''; this.t = 1e9; this.kept = [];
    this.layer = 'surface';      // render/layers.js
    this.ghost = null;           // made the first time the build is shown
  }

  // The bands of moving water on a hose (0 elsewhere): along.x minus the distance the water has gone, gated by its pump.
  band() {
    const al = attribute('along', 'vec3');
    const wave = sin(al.x.sub(al.y.mul(this.clock)).mul(Math.PI * 2 / BAND)).mul(0.5).add(0.5);
    const gate = al.z.greaterThan(1.5).select(this.frun, al.z.greaterThan(0.5).select(this.run, float(0)));
    return smoothstep(0.55, 1.0, wave).mul(gate);
  }

  makeGhost() {
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthFunc: THREE.GreaterDepth });
    const band = this.band();
    const rim = float(1).sub(abs(dot(normalView, vec3(0, 0, 1))));
    m.colorNode = mix(attribute('color', 'vec3'), vec3(0.35, 0.85, 1.0), 0.7).add(vec3(0.25, 0.55, 0.6).mul(band));
    m.opacityNode = rim.mul(0.45).add(0.3);
    const g = new THREE.Mesh(this.mesh.geometry, m);
    g.frustumCulled = false; g.renderOrder = 3; g.name = 'plumbing-xray';   // before the water (5), whose depth would hide all that is merely under it
    this.group.add(g);
    return g;
  }

  // Where the pump sits (same cell as the marker in render/water.js).
  pumpXZ() {
    const H = this.world.water.hydro;
    return H.cellXZ(H.seed ?? H.intakeCell());
  }

  // The water each outlet's hose carries while the pump runs (cm/s; as sim/hydro.js shares the pump's flow out), and its hose.
  outletFlows() {
    const H = this.world.water.hydro, P = H.pump, outs = H.outlets;
    let sv = 0;
    for (const o of outs) sv += o.valve ?? 1;
    const [id, od] = pumpHose(P.rate);
    return outs.map((o) => {
      const lph = P.rate * ((o.valve ?? 1) / Math.max(1, sv)) * pumpCurve(Math.max(0, o.pos.y - H.level));
      return { id, od, v: vq(hoseSpeed(lph, id)) };
    });
  }

  // The filter's flow, hoses and stages as the sim found them (Env.filterFlow), or worked out here before its first step.
  flow() {
    const E = this.world.env, f = E.filterFlow;
    return f?.kind === (E.filterKind ?? 'sponge') && f.on === !!E.filter ? f : filterFlow(E, this.world.water.hydro.level);
  }

  signature() {
    const W = this.world, H = W.water.hydro;
    const [px, pz] = this.pumpXZ();
    const E = W.env, ff = this.flow();
    // Speeds and clogs change the mesh only when they have moved by more than a step (no rebuild back and forth on an edge).
    const keep = (i, v, step) => { const k = this.kept[i]; if (k === undefined || Math.abs(v - k) > step) this.kept[i] = v; return Math.round(this.kept[i] / step); };
    const vs = [...this.outletFlows().map((f) => f.v), ...ff.hoses.map((h) => h.v)];
    const flows = [...vs.map((v, i) => keep(i, v, 1.5)), ...ff.stages.map((s, i) => keep(20 + i, s.clog, 0.1)), pumpHose(H.pump.rate)[1]].join(',');
    return [px.toFixed(1), pz.toFixed(1), Math.round(H.level * 2), H.groundVer, E.filter ? E.filterKind : 'off', E.prefilter ? 1 : 0, E.drainage, E.plenumH, keep('plenum', E.plenumLevel ?? H.level, 0.5), TANK.w, flows, H.outlets.map((o) => `${o.pos.x.toFixed(1)},${o.pos.y.toFixed(1)},${o.pos.z.toFixed(1)},${o.wall ? 1 : 0}`).join(';')].join('|');
  }

  update(dt) {
    const W = this.world, H = W.water.hydro;
    const poolOk = H.resVol > 2 && H.level > 0.5;
    if (poolOk) this.stirSurface(W, H, dt);
    const build = this.layer !== 'surface';
    const vis = (this.show || build) && poolOk && !(this.hidden?.());
    this.group.visible = vis;
    if (!vis) return;
    if (build && !this.ghost) this.ghost = this.makeGhost();
    if (this.ghost) this.ghost.visible = build;
    this.t += dt;
    if (this.t > 1.6) {
      this.t = 0;
      const s = this.signature();
      if (s !== this.sig) { this.sig = s; this.rebuild(); }
    }
    const P = H.pump;
    this.clock.value = (this.clock.value + dt) % WRAP;
    this.run.value += ((P.running ? 1 : 0) - this.run.value) * Math.min(1, dt * 2.5);
    this.frun.value += ((W.env.filter ? 1 : 0) - this.frun.value) * Math.min(1, dt * 2.5);
    this.fflow.value += (Math.min(1, filterEff(W.env)) - this.fflow.value) * Math.min(1, dt * 2);
  }

  rebuild() {
    const W = this.world, H = W.water.hydro, T = W.terrain, wall = W.wall;
    const S = new Soup();
    const [px, pz] = this.pumpXZ();
    const g = T.heightAt(px, pz);
    const level = H.level;
    const wx = TANK.w / 2 - 1.5;

    // --- Pump housing with a screened intake ---------------------------------------------------------------------
    S.geo(new THREE.CylinderGeometry(1.5, 1.6, 2.5, 18), cylM(px, g + 1.0, pz), BODY);
    S.geo(new THREE.CylinderGeometry(1.3, 1.3, 0.5, 18), cylM(px, g + 2.4, pz), CAPC);
    S.geo(new THREE.CylinderGeometry(1.72, 1.72, 1.15, 18, 1, true), cylM(px, g + 0.5, pz), GRILL);           // the strainer sleeve
    for (let k = 0; k < 16; k++) {                                                                               // its slots
      const a = (k / 16) * Math.PI * 2;
      S.geo(new THREE.BoxGeometry(0.2, 1.0, 0.16), new THREE.Matrix4().compose(V(px + Math.cos(a) * 1.76, g + 0.5, pz + Math.sin(a) * 1.76), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), -a), V(1, 1, 1)), SLOT);
    }
    for (const y of [-0.08, 1.08]) S.geo(new THREE.CylinderGeometry(1.8, 1.8, 0.14, 18), cylM(px, g + y, pz), CAPC);   // rings
    const flows = this.outletFlows(), [hid, hod] = pumpHose(H.pump.rate), HR = rOf(hod);
    S.geo(new THREE.CylinderGeometry(hid / 20, hid / 20, 1.5, 10), cylM(px, g + 2.4, pz - 1.6, Math.PI / 2), BODY);   // the hose nipple, towards the back
    S.geo(new THREE.CylinderGeometry(HR + 0.12, HR + 0.12, 0.35, 10), cylM(px, g + 2.4, pz - 2.2, Math.PI / 2), CAPC);

    // --- Hoses to the outlets -------------------------------------------------------------------------------------------
    // Smooth a list of points a little so the ground-following hose is not bumpy.
    const relax = (pts, rounds = 2) => { for (let r = 0; r < rounds; r++) for (let k = 1; k < pts.length - 1; k++) pts[k].y = (pts[k - 1].y + pts[k].y * 2 + pts[k + 1].y) / 4; return pts; };
    const outs = H.outlets;
    // Side by side up the wall: each hose clear of the wall and of its neighbour.
    const zoff = (k) => HR + 0.08 + (k % 2) * (2 * HR + 0.12);
    outs.forEach((o, k) => {
      const start = V(px, g + 2.4, pz - 2.4);
      const pts = [start];
      let tx, tz, endY;
      if (o.wall) {
        tx = o.pos.x; tz = wall.zAt(o.pos.x, T.heightAt(o.pos.x, -TANK.d / 2 + 4) + 1) + zoff(k);
      } else { tx = o.pos.x; tz = o.pos.z; }
      tx = Math.max(-wx, Math.min(wx, tx));
      const run = Math.hypot(tx - start.x, tz - start.z);
      const n = Math.max(2, Math.ceil(run / 1.2));
      for (let s = 1; s <= n; s++) {
        const t = s / n, x = start.x + (tx - start.x) * t, z = start.z + (tz - start.z) * t;
        const d = run * t, dEnd = run * (1 - t);
        // Just under the ground, rising out of it only at the pump and at a ground outlet.
        let y = T.heightAt(x, z) + 0.3 - 0.9 * smooth(0, 7, d);
        if (!o.wall) y = Math.max(y, T.heightAt(x, z) - 0.65 + 0.55 * (1 - smooth(0, 4, dEnd)));
        pts.push(V(x, Math.min(y, g + 2.4), z));
      }
      relax(pts, 3);
      if (o.wall) {
        // Up the background wall in front of its face; the visible part of the hose.
        const y0 = pts[pts.length - 1].y, y1 = o.pos.y - 0.3;
        const m = Math.max(2, Math.ceil(Math.abs(y1 - y0) / 1.2)), vis = [];
        for (let s = 1; s <= m; s++) {
          const t = s / m, y = y0 + (y1 - y0) * t, x = tx + (o.pos.x - tx) * smooth(0.85, 1, t);
          const z = wall.zAt(x, y) + zoff(k);
          pts.push(V(x, y, z)); vis.push([x, y, z]);
        }
        // Saddle clips every ~9 cm up the run, where the hose is above the ground.
        for (let s = 5; s < vis.length; s += 7) {
          const [x, y, z] = vis[s];
          if (y < T.heightAt(x, z) + 1.5) continue;
          const cd = zoff(k) + HR + 0.1;   // from the wall to just over the hose
          S.geo(new THREE.BoxGeometry(2 * HR + 0.5, 0.55, cd), new THREE.Matrix4().makeTranslation(x, y, z - zoff(k) + cd / 2), CLIP);
        }
        endY = o.pos.y;
        pts.push(V(o.pos.x, endY - 0.1, o.pos.z - 0.05));
      } else {
        pts.push(V(o.pos.x, o.pos.y - 0.2, o.pos.z));
      }
      // Dense, even spacing for the highlight and the sweep.
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      const dense = curve.getSpacedPoints(Math.max(8, Math.ceil(curve.getLength() / 0.9)));
      S.tube(dense, HR, HOSE, 8, flows[k].v, 1);
    });

    const J = new Soup();
    this.filterGear(S, px, pz, J);
    const oj = this.jets.geometry;
    this.jets.geometry = J.build();
    oj.dispose();
    const old = this.mesh.geometry;
    this.mesh.geometry = S.build();
    if (this.ghost) this.ghost.geometry = this.mesh.geometry;
    old.dispose();
  }

  // The filter (Care > Water) and the false bottom's pump tower, so the build that changes the water is there to see.
  // Each filter has its own pump (not the main pump), sized and running as sim/filterflow.js says: hoses of their real bore
  // (filter hose in its grey-green), the water in them moving at its real speed, its media stages coloured by their clog.
  //   sponge, canister  external, on the floor of the cabinet under the tank, fed by the overflow drain. Two bulkheads in the
  //            tank floor under the pool: the overflow, a standpipe up to the water line, the pool spilling over its slotted
  //            crown (through a foam sleeve with the pre-filter) and down the drain hose to the filter; and the return, the
  //            filter's pump lifting the clean water up its hose to a pipe whose nozzle jets it back into the pool.
  //            Sponge box: a clear front on the inlet chamber, coarse sponge, fine bio sponge, carbon pad and the pump chamber.
  //            Canister: a clear canister on its foot, baskets from the bottom up as the water rises through them (coarse
  //            sponge, ceramic rings, floss and carbon) under the pump head with the two hose valves.
  //   matten   inside the tank: a wall of coarse foam across a back corner of the pool, a pump behind it, its riser spilling
  //            over the top
  //   false bottom: a slotted PVC access tower standing in a back corner of the land, down to the plenum, open at the top: the
  //            water in it stands at the plenum's line (Env.plenumLevel, sim/plenum.js) or, without that, the pool's
  filterGear(S, px, pz, J) {
    const W = this.world, E = W.env, T = W.terrain, wall = W.wall, level = W.water.hydro.level;
    const hw = TANK.w / 2, back = (x, y) => wall.zAt(x, y);
    const pool = (x, z) => W.water.inMainPool(x, z) && level - T.heightAt(x, z) > 2;
    // A point in the pool well away from the pump, back if possible.
    const spot = (cands) => cands.find(([x, z]) => Math.abs(x) < hw - 2 && pool(x, z) && Math.hypot(x - px, z - pz) > 6) ?? null;
    const zb = (x) => back(x, level) + 2.5;
    const corners = [[-hw + 4, zb(-hw + 4)], [hw - 4, zb(hw - 4)], [px - 9, pz - 2], [px + 9, pz - 2], [px, pz + 8]];
    const ff = this.flow();
    W.water.hydro.ports = { lph: E.filter ? ff.lph : 0 };   // where the filter pulls and pushes (sim/filterflow.js poolCurrent)
    const st = Object.fromEntries(ff.stages.map((s) => [s.id, s.clog]));
    const hoseOf = Object.fromEntries(ff.hoses.map((h) => [h.role, h]));
    const line = (a, b, n) => Array.from({ length: n + 1 }, (_, k) => a.clone().lerp(b, k / n));
    // A jet of clean water from p along dir, as long as the water leaving the nozzle is fast (v, cm/s); its streaks move at
    // that speed, capped where they would strobe.
    const jet = (p, dir, r, v) => {
      const d = dir.clone().normalize(), len = 1.6 + Math.min(60, v) * 0.05, pts = [];
      for (let k = 0; k <= 8; k++) pts.push(p.clone().addScaledVector(d, (k / 8) * len));
      J.tube(pts, r, CLEAR, 6, vq(Math.min(30, v)), 2);
    };
    // External filters stand on the floor of the cabinet under the tank (sim/filterflow.js CABINET_DROP).
    const FLOOR = -CABINET_DROP;
    // A hose between a bulkhead in the tank floor at (x, z) and the filter's fitting at `end` (it comes down into it upright),
    // in the cabinet below. Its points go the way the water does: down the drain to the filter, up the return.
    const under = (x, z, end, h) => {
      const mid = V((x + end.x) / 2, (end.y - 4) / 2, (z + end.z) / 2);
      const pts = [V(x, -1.3, z), V(x, -4, z), V(x, -8, z), mid, V(end.x, end.y + 4, end.z), end.clone()];
      if (h.dir === 'up') pts.reverse();
      S.tube(new THREE.CatmullRomCurve3(pts, false, 'centripetal').getSpacedPoints(48), rOf(h.od), FHOSE, h.od > 20 ? 10 : 8, vq(h.v), 2);
    };
    // A bulkhead through the glass floor: its nut on the floor and its nut underneath.
    const bulkhead = (x, z, r) => {
      S.geo(new THREE.CylinderGeometry(r + 0.45, r + 0.45, 0.3, 14), cylM(x, T.heightAt(x, z) + 0.1, z), CAPC);
      S.geo(new THREE.CylinderGeometry(r + 0.45, r + 0.45, 0.5, 6), cylM(x, -1.05, z), CAPC);
    };
    // The overflow: a standpipe from its bulkhead up to the water line, the pool spilling in over its slotted crown (or
    // through the foam sleeve over it) and falling down it to the drain hose (the bands run down it).
    const overflow = (x, z, foam, h) => {
      const g = T.heightAt(x, z), top = Math.max(g + 1.5, level - 0.3), r = rOf(h.od) + 0.1;
      W.water.hydro.ports.intake = { x, y: top, z, r: r + 0.3 };
      S.tube(line(V(x, top - 1.2, z), V(x, -0.8, z), Math.max(2, Math.ceil(top / 0.8))), r, PIPE, 10, vq(h.v), 2);
      bulkhead(x, z, r);
      if (foam) { S.geo(new THREE.CylinderGeometry(r + 1.1, r + 1.1, 3.4, 14), cylM(x, top - 1.3, z), FOAM.clone().lerp(DIRT, (st.mech ?? 0) * 0.7)); return; }
      S.geo(new THREE.CylinderGeometry(r + 0.3, r + 0.3, 1.6, 14, 1, true), cylM(x, top - 0.6, z), GRILL);
      for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; S.geo(new THREE.BoxGeometry(0.16, 1.0, 0.12), new THREE.Matrix4().compose(V(x + Math.cos(a) * (r + 0.32), top - 0.3, z + Math.sin(a) * (r + 0.32)), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), -a), V(1, 1, 1)), SLOT); }
    };
    // The return: a pipe up from its bulkhead, a nozzle (70% of the hose's bore: twice its speed) jetting the clean water out.
    const ret = (x, z, h) => {
      const g = T.heightAt(x, z), y = Math.max(g + 0.8, Math.min(g + 2.5, level - 1.5)), r = rOf(h.od) * 0.85;
      S.tube(line(V(x, -0.8, z), V(x, y, z), Math.max(2, Math.ceil(y / 0.8))), r, PIPE, 10, vq(h.v), 2);
      bulkhead(x, z, r);
      let dir = V(-x * 0.25, 0, TANK.d * 0.3 - z);
      if (dir.lengthSq() < 1) dir.set(0, 0, 1);
      dir.normalize();
      const ang = Math.atan2(dir.x, dir.z);
      S.geo(new THREE.CylinderGeometry(r * 0.7, r, 1.4, 10), new THREE.Matrix4().compose(V(x, y, z).addScaledVector(dir, 0.6), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, ang, 0, 'YXZ')), V(1, 1, 1)), PIPE);
      jet(V(x, y, z).addScaledVector(dir, 1.3), dir.clone().setY(-0.04), r * 0.7, h.v / 0.49);
      W.water.hydro.ports.ret = { x: x + dir.x * 1.3, y, z: z + dir.z * 1.3, dx: dir.x, dz: dir.z, D: 0.07 * h.id };
    };
    // Where the two bulkheads go: the overflow in the pool away from the main pump, the return a hand's width from it; the
    // filter stands under them, `half` (its half width and depth) inside the tank's outline.
    const fittings = (half) => {
      const c = spot(corners);
      if (!c) return null;
      const [x, z] = c;
      const r = [[x + 10, z], [x - 10, z], [x + 7, z + 6], [x - 7, z + 6], [x, z + 7], [x + 5, z], [x - 5, z]].find(([a, b]) => Math.abs(a) < hw - 2 && Math.abs(b) < TANK.d / 2 - 2 && pool(a, b)) ?? [x + 2.5, z + 1.5];
      const box = V(Math.max(-hw + half[0], Math.min(hw - half[0], (x + r[0]) / 2)), 0, Math.max(-TANK.d / 2 + half[1], Math.min(TANK.d / 2 - half[1], (z + r[1]) / 2)));
      return { x, z, rx: r[0], rz: r[1], box };
    };
    const box = (w, h, d, x, y, z, c) => S.geo(new THREE.BoxGeometry(w, h, d), new THREE.Matrix4().makeTranslation(x, y, z), c);
    if (E.filter) {
      const kind = E.filterKind ?? 'sponge';
      if (kind === 'sponge') {
        const bw = 26, bh = FILTER_TOP.sponge + 3, bd = 13;
        const f = fittings([bw / 2 + 1, bd / 2 + 1]);
        if (f) {
          // The box on the cabinet floor; its front is clear (only the frame drawn), the media seen through it.
          const { x, z } = f.box, y0 = FLOOR, front = z + bd / 2;
          box(bw, bh, 0.4, x, y0 + bh / 2, z - bd / 2 + 0.2, BODY);
          for (const sx of [-1, 1]) box(0.4, bh, bd, x + sx * (bw / 2 - 0.2), y0 + bh / 2, z, BODY);
          box(bw, 0.5, bd, x, y0 + 0.25, z, BODY);
          box(bw + 0.4, 0.8, bd + 0.4, x, y0 + bh + 0.4, z, CAPC);
          for (const y of [y0 + 0.7, y0 + bh - 0.3]) box(bw, 0.5, 0.3, x, y, front, CAPC);
          box(bw - 0.8, 0.12, 0.08, x, y0 + FILTER_TOP.sponge, front - 0.1, CLEAR);                  // the water line behind the front
          // Left to right the way the water goes: the inlet chamber, coarse sponge, fine bio sponge, carbon pad, the pump.
          const parts = [['in', 3.2], ['mech', 6.5], ['bioSponge', 6.5], ['chem', 2.6], ['pump', bw - 0.8 - 18.8]];
          let cx = x - bw / 2 + 0.4;
          const hm = FILTER_TOP.sponge - 1, at = {};
          for (const [id, w] of parts) {
            at[id] = cx + w / 2;
            if (MEDIA[id]) box(w - 0.3, hm, bd - 1.2, at[id], y0 + 0.5 + hm / 2, z, media(id, st[id === 'bioSponge' ? 'bio' : id] ?? 0));
            cx += w;
            if (id !== 'pump') box(0.25, bh - 0.9, bd - 0.6, cx, y0 + bh / 2, z, CAPC);             // the dividers
          }
          const hi = hoseOf.intake, ho = hoseOf.return, top = y0 + bh + 0.8;
          // The drain comes in through the lid into the inlet chamber; the pump's outlet goes up through it to the return.
          S.tube(line(V(at.in, top + 1.5, z), V(at.in, y0 + bh - 4, z), 6), rOf(hi.od) * 0.85, PIPE, 10, vq(hi.v), 2);
          S.geo(new THREE.CylinderGeometry(2.1, 2.3, 5.5, 14), cylM(at.pump, y0 + 3.3, z), BODY);
          S.geo(new THREE.CylinderGeometry(1.4, 1.4, 1.2, 12), cylM(at.pump, y0 + 6.6, z), CAPC);
          S.tube(line(V(at.pump, y0 + 7, z), V(at.pump, top + 1.5, z), 8), rOf(ho.od) * 0.85, PIPE, 10, vq(ho.v), 2);
          overflow(f.x, f.z, false, hi);
          ret(f.rx, f.rz, ho);
          under(f.x, f.z, V(at.in, top + 1.5, z), hi);
          under(f.rx, f.rz, V(at.pump, top + 1.5, z), ho);
        }
      } else if (kind === 'matten') {
        // Across whichever back corner holds pool water; failing that, along a side glass where the pool reaches it. The
        // foam stands from the bottom to just over the surface.
        const segs = [];
        for (const sx of [-1, 1]) {
          const cx = sx * (hw - 3.5), cz = zb(cx) + 1;
          if (pool(cx, cz)) segs.push([sx, V(sx * hw, 0, back(sx * hw, level) + 8.5), V(sx * (hw - 8.5), 0, back(sx * (hw - 8.5), level))]);
        }
        for (const sx of [-1, 1]) {
          const x = sx * (hw - 2.6);
          let z1 = null, z2 = null;
          for (let z = -TANK.d / 2 + 1; z < TANK.d / 2 - 1; z += 1) {
            if (pool(x, z) && pool(x - sx * 1.6, z)) { if (z1 === null) z1 = z; z2 = z; if (z2 - z1 >= 14) break; } else if (z1 !== null) break;
          }
          if (z1 !== null && z2 - z1 >= 6) segs.push([sx, V(x, 0, z1), V(x, 0, z2)]);
        }
        const seg = segs[0];
        if (seg) {
          const [sx, a, b] = seg;
          let g = level - 2;
          for (let k = 0; k <= 4; k++) { const p = a.clone().lerp(b, k / 4); g = Math.min(g, T.heightAt(p.x, p.z)); }
          const hgt = level - g + 1.2;
          const mid = a.clone().add(b).multiplyScalar(0.5), len = a.distanceTo(b), ang = Math.atan2(b.z - a.z, b.x - a.x);
          const q = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), -ang);
          // Coarse foam: two shades in vertical bands read as a block of open-cell foam; the mulm it holds browns it.
          const dirt = (st.mech ?? 0) * 0.6 + (st.bio ?? 0) * 0.3;
          for (let k = 0; k < 6; k++) {
            const t = (k + 0.5) / 6, p = a.clone().lerp(b, t);
            S.geo(new THREE.BoxGeometry(len / 6 + 0.02, hgt, 1.6 + (k % 2) * 0.1), new THREE.Matrix4().compose(V(p.x, g + hgt / 2, p.z), q, V(1, 1, 1)), (k % 2 ? FOAM2 : FOAM).clone().lerp(DIRT, dirt));
          }
          const away = V(-(b.z - a.z), 0, b.x - a.x).normalize();
          if (away.dot(V(sx, 0, 0)) < 0 && Math.abs(away.x) > 0.3) away.negate();
          if (Math.abs(away.x) <= 0.3 && away.z > 0) away.negate();
          const tb = mid.clone().addScaledVector(away, 1.9), h = hoseOf.riser;
          // The pump on the floor behind the foam (toward the glass), its riser up over the top of the foam and a spout into
          // the pool; the water rises in the riser at its speed.
          S.geo(new THREE.BoxGeometry(3.2, 3.2, 2.4), new THREE.Matrix4().compose(V(tb.x, g + 1.6, tb.z), q, V(1, 1, 1)), BODY);
          const rp = [V(tb.x, g + 3.2, tb.z), V(tb.x, g + hgt * 0.5, tb.z), V(tb.x, g + hgt + 0.4, tb.z), V(tb.x - away.x * 1.4, g + hgt + 1.0, tb.z - away.z * 1.4), V(tb.x - away.x * 2.6, g + hgt + 0.3, tb.z - away.z * 2.6)];
          S.tube(new THREE.CatmullRomCurve3(rp, false, 'centripetal').getSpacedPoints(24), rOf(h.od), PIPE, 10, vq(h.v), 2);
          jet(V(tb.x - away.x * 2.8, g + hgt, tb.z - away.z * 2.8), V(-away.x * 0.4, -0.9, -away.z * 0.4), rOf(h.id), h.v);
        }
      } else if (kind === 'canister') {
        const R = 10;
        const f = fittings([R + 1.5, R + 1.5]);
        if (f) {
          const { x, z } = f.box, y0 = FLOOR, top = y0 + FILTER_TOP.canister;
          S.geo(new THREE.CylinderGeometry(R + 0.6, R + 0.9, 2.4, 22), cylM(x, y0 + 1.2, z), BODY);          // the foot
          // The clear shell: a ring at the foot and under the head and four slim ribs (the clear wall itself is not drawn).
          for (const y of [y0 + 2.7, top - 0.3]) S.geo(new THREE.CylinderGeometry(R + 0.3, R + 0.3, 0.6, 22, 1, true), cylM(x, y, z), CAPC);
          for (let k = 0; k < 4; k++) { const a = (k + 0.5) * Math.PI / 2; box(0.5, top - y0 - 2.4, 0.5, x + Math.cos(a) * (R + 0.3), (top + y0 + 2.4) / 2, z + Math.sin(a) * (R + 0.3), CAPC); }
          // The baskets from the bottom up, the way the water rises through them.
          let y = y0 + 2.6;
          for (const [id, h] of [['mech', 7.5], ['bio', 10.5], ['floss', 4], ['chem', 4.5]]) {
            const c = st[id === 'floss' ? 'chem' : id] ?? 0, col = media(id, c);
            S.geo(new THREE.CylinderGeometry(R - 0.4, R - 0.4, h - 0.4, 22), cylM(x, y + h / 2, z), id === 'bio' ? col.clone().multiplyScalar(0.55) : col);
            S.geo(new THREE.CylinderGeometry(R - 0.1, R - 0.1, 0.35, 22, 1, true), cylM(x, y + h - 0.2, z), BODY);   // the basket's rim
            if (id === 'bio') {
              // Ceramic rings seen through the shell: short open tubes end-on, in the front half.
              for (let k = 0; k < 24; k++) {
                const a = -Math.PI * 0.1 + ((k * 7) % 24) / 24 * Math.PI * 1.2, yy = y + 1.2 + ((k * 5) % 8) * 1.1;
                S.geo(new THREE.CylinderGeometry(0.6, 0.6, 0.9, 8, 1, true), new THREE.Matrix4().compose(V(x + Math.cos(a) * (R - 0.3), yy, z + Math.sin(a) * (R - 0.3)), new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), V(Math.cos(a), 0, Math.sin(a))), V(1, 1, 1)), col);
              }
            }
            y += h;
          }
          // The pump head: motor, cap, and the valve block with the two hose stems (in over the left, out over the right).
          S.geo(new THREE.CylinderGeometry(R + 0.4, R + 0.6, 5, 22), cylM(x, top + 2.5, z), BODY);
          S.geo(new THREE.CylinderGeometry(R - 3, R - 2, 2.2, 22), cylM(x, top + 6, z), CAPC);
          const hi = hoseOf.intake, ho = hoseOf.return, vy = top + 8.5;
          box(13, 2.2, 4, x, top + 7.4, z, BODY);
          for (const [dx, h] of [[-4.5, hi], [4.5, ho]]) S.geo(new THREE.CylinderGeometry(rOf(h.od) + 0.25, rOf(h.od) + 0.25, 2.6, 12), cylM(x + dx, vy + 0.3, z), CAPC);
          overflow(f.x, f.z, E.prefilter, hi);
          ret(f.rx, f.rz, ho);
          under(f.x, f.z, V(x - 4.5, vy + 1.6, z), hi);
          under(f.rx, f.rz, V(x + 4.5, vy + 1.6, z), ho);
        }
      } else if (kind === 'internal') {
        // The submersible: pump housing and foam cartridge in one body on the pool floor in a back corner, the foam face (the mulm browns it)
        // turned to the pool, the outlet pipe up its side to a nozzle under the surface that jets along the face.
        const c = spot(corners);
        if (c) {
          const [x, z] = c, g = T.heightAt(x, z), hgt = Math.min(14, level - g - 1), ho = hoseOf.outlet;
          const face = V(-x * 0.25, 0, TANK.d * 0.3 - z);
          if (face.lengthSq() < 1) face.set(0, 0, 1);
          face.normalize();
          const q = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), Math.atan2(face.x, face.z));
          const at = (p, dims, c2) => S.geo(new THREE.BoxGeometry(...dims), new THREE.Matrix4().compose(p, q, V(1, 1, 1)), c2);
          at(V(x, g + hgt / 2, z), [6.4, hgt, 4.4], BODY);
          at(V(x, g + 0.8, z), [6.8, 1.6, 4.8], CAPC);                                                   // the pump housing at the foot
          const fp = V(x, g + hgt * 0.5 + 0.4, z).addScaledVector(face, 2.5);
          at(fp, [5.6, Math.max(1, hgt - 3), 0.8], FOAM.clone().lerp(DIRT, (st.mech ?? 0) * 0.8));       // the foam face
          const ny = Math.max(g + 2.2, Math.min(level - 1.6, g + hgt + 0.2)), np = V(x, ny, z).addScaledVector(face, 1.0);
          S.tube([V(x, g + 1.6, z), V(x, ny, z), np], rOf(ho.od), PIPE, 10, vq(ho.v), 2);
          jet(np.clone().addScaledVector(face, 0.3), face.clone().setY(-0.03), rOf(ho.od) * 0.6, ho.v / 0.49);
          W.water.hydro.ports.intake = { x: fp.x + face.x * 0.5, y: fp.y, z: fp.z + face.z * 0.5, r: 2.4 };
          W.water.hydro.ports.ret = { x: np.x + face.x * 0.3, y: ny, z: np.z + face.z * 0.3, dx: face.x, dz: face.z, D: 0.07 * ho.id };
        }
      }
    }
    // The false bottom's pump tower: in the back corner of the land, slots down where the plenum is, open at the top.
    if (E.drainage >= 1) {
      const ph = E.plenumH || level + 1, wl = E.plenumLevel ?? level;
      for (const sx of [1, -1]) {
        const x = sx * (hw - 3.2), z = back(x, ph + 4) + 3.2, g = T.heightAt(x, z);
        if (pool(x, z) || g < ph + 1) continue;
        S.geo(new THREE.CylinderGeometry(2.1, 2.1, g + 1.6, 16, 1, true), cylM(x, (g + 1.6) / 2, z), PVC);
        S.geo(new THREE.CylinderGeometry(2.25, 2.25, 0.5, 16, 1, true), cylM(x, g + 1.7, z), CAPC);
        S.geo(new THREE.RingGeometry(2.0, 2.25, 16), new THREE.Matrix4().compose(V(x, g + 1.95, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)), V(1, 1, 1)), CAPC);
        if (wl > 0.2 && wl < g + 1.4) S.geo(new THREE.CircleGeometry(2.05, 16), new THREE.Matrix4().compose(V(x, wl, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)), V(1, 1, 1)), WATER);
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2;
          S.geo(new THREE.BoxGeometry(0.22, Math.max(0.5, ph - 1), 0.14), new THREE.Matrix4().compose(V(x + Math.cos(a) * 2.13, (ph - 1) / 2 + 0.3, z + Math.sin(a) * 2.13), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), -a), V(1, 1, 1)), SLOT);
        }
        break;
      }
    }
  }

  // The filter on the pool's surface (sim/filterflow.js poolCurrent): the return's jet roughens the water where it reaches the
  // surface (ripple drops strung out downstream, as many and as strong as the jet), and the overflow's crown draws a dimple.
  // A few drops a second into the existing ripple field (render/waterfx.js addDrop): nothing new per fragment.
  stirSurface(W, H, dt) {
    const P = H.ports, q = (P?.lph ?? 0) / 3.6;
    if (!W.fx || !(q > 0) || !(dt > 0)) return;
    const c = this._c ??= { x: 0, y: 0, z: 0 };
    this.rip = Math.min(3, (this.rip ?? 0) + dt * Math.min(30, q / 6));
    while (this.rip >= 1) {
      this.rip -= 1;
      if (P.ret) {
        const j = P.ret, s = 2 + Math.random() * 18, w = (Math.random() - 0.5) * 0.2 * s, x = j.x + j.dx * s - j.dz * w, z = j.z + j.dz * s + j.dx * w;
        poolCurrent(H, x, H.level - 0.3, z, c);
        const u = Math.hypot(c.x, c.z);
        if (u > 1 && W.water.inMainPool(x, z)) W.fx.addDrop(x, z, -Math.min(3, u * 0.06), 0.5 + s * 0.04);
      }
      if (P.intake && Math.random() < 0.3) W.fx.addDrop(P.intake.x, P.intake.z, Math.min(2, q / 60), P.intake.r + 0.6);
    }
  }

  dispose() {
    this.group.removeFromParent();
    this.mesh.geometry.dispose(); this.jets.geometry.dispose();
  }
}
