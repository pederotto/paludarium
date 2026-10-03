// The visible plumbing of the pump circuit (sim/hydro.js, nothing here changes the hydrology):
//
//   main pool: screened intake -> pump housing -> hose -> (buried under the substrate) -> up the background wall -> outlet
//   external filter (sponge box, canister) in the cabinet under the tank: the main pool spills into an overflow drain
//   (a standpipe whose rim sits at the surface), the drain hose runs down through the tank floor to the filter, and the
//   filter's own pump sends the cleaned water back up over the back rim to a return nozzle or spray bar in the pool
//
// Everything static (housing, intake grill, hoses, wall clips, standpipe) is merged into ONE mesh and rebuilt only when the
// intake, an outlet, the water level or the ground changed (at most once every couple of seconds). Hoses follow the
// ground a little under its surface, so they vanish into the substrate and rocks and show only where they run through
// open air: up the background wall, and at the pump. Water in the hoses is a highlight that travels along them while the
// pump runs; the drain shows water going in while the filter pumps. Hidden in photo mode and Kids mode, and
// with Care > Water > Show equipment off, unless a view layer that shows the build is on (render/layers.js): then the same
// geometry is drawn a second time, glowing, only where something covers it (the `ghost`, depth test reversed), so hoses
// buried in the substrate and run behind rocks show through.

import * as THREE from 'three/webgpu';
import { attribute, uniform, time, sin, smoothstep, vec3, float, positionLocal, mix, abs, dot, normalView } from 'three/tsl';
import { creatureMaterial } from './shaders.js';
import { TANK } from '../sim/tank.js';
import { filterEff } from '../content/equipment.js';

const HOSE_R = 0.38;
const HOSE = new THREE.Color(0x2e3b41), CLIP = new THREE.Color(0xa6aeb2), BODY = new THREE.Color(0x242b30), CAPC = new THREE.Color(0x39444b);
const GRILL = new THREE.Color(0x86979c), SLOT = new THREE.Color(0x151a1d), PIPE = new THREE.Color(0xc9ccc6), RIM = new THREE.Color(0xe4e6e0), INNER = new THREE.Color(0x101517);
const FOAM = new THREE.Color(0x27333e), FOAM2 = new THREE.Color(0x34424e), CLEAR = new THREE.Color(0x9fb4b8), PVC = new THREE.Color(0xe8e8e2);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Merged-geometry builder: positions, normals, vertex colours and `along` (distance along a hose, 0 elsewhere).
class Soup {
  constructor() { this.p = []; this.n = []; this.c = []; this.a = []; this.i = []; }
  get count() { return this.p.length / 3; }
  geo(g, m, color) {
    const pos = g.attributes.position, nor = g.attributes.normal, base = this.count;
    const nm = new THREE.Matrix3().getNormalMatrix(m), v = new THREE.Vector3();
    for (let k = 0; k < pos.count; k++) {
      v.fromBufferAttribute(pos, k).applyMatrix4(m); this.p.push(v.x, v.y, v.z);
      v.fromBufferAttribute(nor, k).applyMatrix3(nm).normalize(); this.n.push(v.x, v.y, v.z);
      this.c.push(color.r, color.g, color.b); this.a.push(0);
    }
    const idx = g.index;
    for (let k = 0; k < idx.count; k++) this.i.push(base + idx.getX(k));
  }
  // A swept tube along `pts` (already dense), radius r. Frames are parallel-transported.
  tube(pts, r, color, seg = 7) {
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
        this.c.push(color.r, color.g, color.b); this.a.push(len);
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
    g.setAttribute('along', new THREE.Float32BufferAttribute(this.a, 1));
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
    this.spillAmt = uniform(0);  // 0 … 1: bypass flow over the weir
    const mat = creatureMaterial({ rough: 0.42 });
    mat.metalness = 0.15;
    const base = mat.emissiveNode;
    // Water moving in the hose: a soft bright band that travels along it.
    const along = attribute('along', 'float');
    const band = smoothstep(0.55, 1.0, sin(along.mul(0.55).sub(time.mul(5.5))).mul(0.5).add(0.5));
    const hose = attribute('color', 'vec3').x.lessThan(0.15).and(along.greaterThan(0.01)).select(float(1), float(0));
    mat.emissiveNode = base.add(vec3(0.12, 0.5, 0.62).mul(band).mul(hose).mul(this.run).mul(0.38));
    this.mat = mat;
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    this.mesh.frustumCulled = false; this.mesh.castShadow = true; this.mesh.receiveShadow = true; this.mesh.name = 'plumbing-mesh';
    this.group.add(this.mesh);
    // The sheet of water going over the weir.
    const sm = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    sm.colorNode = vec3(0.45, 0.78, 0.95);
    const streak = smoothstep(0.3, 1.0, sin(positionLocal.x.mul(17).add(positionLocal.z.mul(13))).mul(0.5).add(0.5));
    const fall = sin(positionLocal.y.mul(4.5).sub(time.mul(8))).mul(0.5).add(0.5);
    sm.opacityNode = this.spillAmt.mul(streak.mul(0.75).add(0.15)).mul(fall.mul(0.45).add(0.55)).mul(0.6);
    this.spill = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.15, 1, 14, 1, true), sm);
    this.spill.visible = false; this.spill.frustumCulled = false; this.spill.name = 'weir-spill';
    this.group.add(this.spill);
    // Clean water leaving the filter: short streaky jets from its outlets, as strong as the flow it still passes.
    this.fflow = uniform(0);     // 0 … 1: the filter's pump running, less what clogging takes
    const jm = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const ja = attribute('along', 'float');
    jm.colorNode = vec3(0.5, 0.82, 0.95);
    jm.opacityNode = this.fflow.mul(smoothstep(0.35, 1.0, sin(ja.mul(5.5).sub(time.mul(13))).mul(0.5).add(0.5)).mul(0.7).add(0.2)).mul(float(1).sub(smoothstep(0.6, 3.6, ja))).mul(0.55);
    this.jets = new THREE.Mesh(new THREE.BufferGeometry(), jm);
    this.jets.frustumCulled = false; this.jets.renderOrder = 7; this.jets.name = 'filter-jets';
    this.group.add(this.jets);
    this.sig = ''; this.t = 1e9; this.weir = null;
    this.layer = 'surface';      // render/layers.js
    this.ghost = null;           // made the first time the build is shown
  }

  makeGhost() {
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthFunc: THREE.GreaterDepth });
    const along = attribute('along', 'float');
    const band = smoothstep(0.55, 1.0, sin(along.mul(0.55).sub(time.mul(5.5))).mul(0.5).add(0.5)).mul(this.run);
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

  signature() {
    const W = this.world, H = W.water.hydro;
    const [px, pz] = this.pumpXZ();
    const E = W.env;
    return [px.toFixed(1), pz.toFixed(1), Math.round(H.level * 2), H.groundVer, E.filter ? E.filterKind : 'off', E.prefilter ? 1 : 0, E.drainage, E.plenumH, TANK.w, H.outlets.map((o) => `${o.pos.x.toFixed(1)},${o.pos.y.toFixed(1)},${o.pos.z.toFixed(1)},${o.wall ? 1 : 0}`).join(';')].join('|');
  }

  update(dt) {
    const W = this.world, H = W.water.hydro;
    const poolOk = H.resVol > 2 && H.level > 0.5;
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
    this.run.value += ((P.running ? 1 : 0) - this.run.value) * Math.min(1, dt * 2.5);
    // Water pours into the drain as fast as the external filter pumps it away.
    const frac = this.weir ? filterEff(W.env) : 0;
    this.spillAmt.value += (frac - this.spillAmt.value) * Math.min(1, dt * 2);
    this.spill.visible = !!this.weir && this.spillAmt.value > 0.02;
    this.fflow.value += (filterEff(W.env) - this.fflow.value) * Math.min(1, dt * 2);
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
    S.geo(new THREE.CylinderGeometry(0.5, 0.5, 1.5, 10), cylM(px, g + 2.4, pz - 1.6, Math.PI / 2), BODY);        // the hose nipple, towards the back
    S.geo(new THREE.CylinderGeometry(0.62, 0.62, 0.35, 10), cylM(px, g + 2.4, pz - 2.2, Math.PI / 2), CAPC);

    // --- Hoses to the outlets -------------------------------------------------------------------------------------------
    // Smooth a list of points a little so the ground-following hose is not bumpy.
    const relax = (pts, rounds = 2) => { for (let r = 0; r < rounds; r++) for (let k = 1; k < pts.length - 1; k++) pts[k].y = (pts[k - 1].y + pts[k].y * 2 + pts[k + 1].y) / 4; return pts; };
    const outs = H.outlets;
    outs.forEach((o, k) => {
      const start = V(px, g + 2.4, pz - 2.4);
      const pts = [start];
      let tx, tz, endY;
      if (o.wall) {
        tx = o.pos.x; tz = wall.zAt(o.pos.x, T.heightAt(o.pos.x, -TANK.d / 2 + 4) + 1) + 0.45 + 0.55 * (k % 2);
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
          const z = wall.zAt(x, y) + 0.45 + 0.55 * (k % 2);
          pts.push(V(x, y, z)); vis.push([x, y, z]);
        }
        // Saddle clips every ~9 cm up the run, where the hose is above the ground.
        for (let s = 5; s < vis.length; s += 7) {
          const [x, y, z] = vis[s];
          if (y < T.heightAt(x, z) + 1.5) continue;
          S.geo(new THREE.BoxGeometry(1.15, 0.55, 0.5 + 0.55 * (k % 2) + 0.55), new THREE.Matrix4().makeTranslation(x, y, z - 0.18), CLIP);
        }
        endY = o.pos.y;
        pts.push(V(o.pos.x, endY - 0.1, o.pos.z - 0.05));
      } else {
        pts.push(V(o.pos.x, o.pos.y - 0.2, o.pos.z));
      }
      // Dense, even spacing for the highlight and the sweep.
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      const dense = curve.getSpacedPoints(Math.max(8, Math.ceil(curve.getLength() / 0.9)));
      S.tube(dense, HOSE_R, HOSE);
    });

    // --- Overflow drain for an external filter: a standpipe whose rim sits just under the surface, so the pool spills
    // into it; a bulkhead under it takes the water through the tank floor (the drain hose is drawn with the filter).
    this.weir = null;
    const E0 = W.env, ext = E0.filter && (E0.filterKind ?? 'sponge') !== 'matten';
    const cand = [[7, 0], [-7, 0], [0, -7], [10, -4], [-10, -4], [5, 6], [-5, 6], [3, 0]];
    for (const [dx, dz] of ext ? cand : []) {
      const x = px + dx, z = pz + dz;
      if (Math.abs(x) > wx - 1 || Math.abs(z) > TANK.d / 2 - 2) continue;
      const gh = T.heightAt(x, z);
      if (!W.water.inMainPool(x, z) || level - gh < 2.2) continue;
      const top = level - 0.15;
      S.geo(new THREE.CylinderGeometry(0.85, 0.95, top - gh + 0.5, 14, 1, true), cylM(x, (top + gh - 0.5) / 2, z), PIPE);
      S.geo(new THREE.TorusGeometry(0.9, 0.16, 6, 16), new THREE.Matrix4().compose(V(x, top, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)), V(1, 1, 1)), RIM);
      S.geo(new THREE.CircleGeometry(0.78, 14), new THREE.Matrix4().compose(V(x, top - 1.2, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)), V(1, 1, 1)), INNER);
      this.weir = { x, z, top, gh };
      // The sheet of water going in over the rim, inside the pipe.
      this.spill.scale.set(0.78, 1.1, 0.78);
      this.spill.position.set(x, top - 0.55, z);
      break;
    }    const J = new Soup();
    this.filterGear(S, px, pz, J, this.weir);
    const oj = this.jets.geometry;
    this.jets.geometry = J.build();
    oj.dispose();
    const old = this.mesh.geometry;
    this.mesh.geometry = S.build();
    if (this.ghost) this.ghost.geometry = this.mesh.geometry;
    old.dispose();
  }

  // The filter (Care > Water) and the false bottom's pump tower, so the build that changes the water is there to see.
  // Each filter has its own small pump (not the main pump): it pulls the pool's water through the media and pushes it back
  // out clean, shown by the jets (J) at its outlets. The external ones stand on the cabinet floor under the tank and are fed
  // by the overflow drain (`drain`, from rebuild): its hose runs down through the tank floor; without a drain spot, by an
  // intake pipe with a strainer over the back rim.
  //   sponge   external: a box holding the sponge and its pump; the return comes back up over the rim to a nozzle that
  //            jets the clean water into the pool
  //   matten   inside the tank: a wall of coarse foam across a back corner of the pool, a pump behind it, its riser spilling
  //            over the top
  //   canister external: the canister (a foam pre-filter on its intake if set); the return runs to a spray bar along the
  //            back, jetting clean water
  //   false bottom: a slotted PVC access tower standing in a back corner of the land, down to the plenum
  filterGear(S, px, pz, J, drain = null) {
    const W = this.world, E = W.env, T = W.terrain, wall = W.wall, level = W.water.hydro.level;
    const hw = TANK.w / 2, back = (x, y) => wall.zAt(x, y);
    const pool = (x, z) => W.water.inMainPool(x, z) && level - T.heightAt(x, z) > 2;
    const relaxY = (pts) => { for (let k = 1; k < pts.length - 1; k++) pts[k].y = Math.max(pts[k].y, (pts[k - 1].y + pts[k].y * 2 + pts[k + 1].y) / 4); };
    // A point in the pool well away from the pump, back if possible.
    const spot = (cands) => cands.find(([x, z]) => Math.abs(x) < hw - 2 && pool(x, z) && Math.hypot(x - px, z - pz) > 6) ?? null;
    const zb = (x) => back(x, level) + 2.5;
    const corners = [[-hw + 4, zb(-hw + 4)], [hw - 4, zb(hw - 4)], [px - 9, pz - 2], [px + 9, pz - 2], [px, pz + 8]];
    // A jet of clean water from p along dir (a short tube; its `along` drives the streaks).
    const jet = (p, dir, r = 0.35) => { const d = dir.clone().normalize(), pts = []; for (let k = 0; k <= 8; k++) pts.push(p.clone().addScaledVector(d, k * 0.45)); J.tube(pts, r, CLEAR, 6); };
    // A hose (canister or external sponge filter) from (x, y0, z0) to the background just over the water (riding over any land in between), up its face,
    // over the back rim, down the outside of the back glass and in under the tank to the filter's lid at `end` (an external
    // filter stands in the cabinet under the tank).
    const over = (x, z0, y0, end) => {
      const zr = -TANK.d / 2 + 0.6, top = TANK.h + 1.5, pts = [V(x, y0, z0)];
      const zw = back(x, y0) + 1.2, n = Math.max(2, Math.ceil(Math.abs(z0 - zw) / 1.5));
      let y = y0;
      for (let k = 1; k <= n; k++) { const z = z0 + (zw - z0) * (k / n); y = Math.max(y0, T.heightAt(x, z) + 0.5); pts.push(V(x, y, z)); }
      for (y += 1.5; y < top - 1; y += 1.5) pts.push(V(x, y, back(x, y) + 1.2));
      const zo = -TANK.d / 2 - 1.4;   // just outside the back glass
      pts.push(V(x, top, Math.max(zr, back(x, top - 1) + 1)), V(x, TANK.h + 2.2, zr - 1.5), V(x, TANK.h - 3, zo), V(x, 2, zo), V(end.x, -2, zo), V(end.x, -6, end.z), end.clone());
      relaxY(pts);
      S.tube(new THREE.CatmullRomCurve3(pts, false, 'centripetal').getSpacedPoints(Math.max(24, Math.ceil(pts.length * 1.5))), 0.32, HOSE);
    };
    // External filters stand on the floor of the cabinet under the tank (it spans y -0.8 … -70.8).
    const FLOOR = -70.8;
    // The drain hose: from the bulkhead under the standpipe straight down through the tank floor into the cabinet and the
    // filter's inlet at `end`.
    const drainHose = (end) => {
      const { x, z, gh } = drain;
      const pts = [V(x, gh - 0.2, z), V(x, -1.5, z), V(x, -6, z), V(end.x, -14, end.z), end.clone()];
      S.tube(new THREE.CatmullRomCurve3(pts, false, 'centripetal').getSpacedPoints(40), HOSE_R * 1.1, HOSE);
    };
    if (E.filter) {
      const kind = E.filterKind ?? 'sponge';
      if (kind === 'sponge') {
        const c = spot(corners);
        if (c) {
          const [x, z] = c, g = T.heightAt(x, z);
          // The filter box on the cabinet floor: the sponge behind a window in its front, the pump in the box.
          const xb = Math.max(-hw + 6, Math.min(hw - 6, drain ? drain.x : x)), zbx = -TANK.d / 2 + 8, yb = FLOOR + 4.5;
          S.geo(new THREE.BoxGeometry(10, 9, 7), new THREE.Matrix4().makeTranslation(xb, yb, zbx), BODY);
          S.geo(new THREE.BoxGeometry(7.4, 5, 0.3), new THREE.Matrix4().makeTranslation(xb, yb - 0.6, zbx + 3.55), FOAM);
          S.geo(new THREE.BoxGeometry(10.3, 0.6, 7.3), new THREE.Matrix4().makeTranslation(xb, yb + 4.6, zbx), CAPC);
          // Its water comes from the overflow drain; failing one, from an intake pipe with a strainer over the back rim.
          if (drain) drainHose(V(xb - 2.5, yb + 5, zbx));
          else {
            S.geo(new THREE.CylinderGeometry(0.4, 0.4, level + 2.5 - (g + 2), 10, 1, true), cylM(x, (level + 2.5 + g + 2) / 2, z), PIPE);
            S.geo(new THREE.CylinderGeometry(0.85, 0.85, 2.4, 12, 1, true), cylM(x, g + 2.2, z), GRILL);
            for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2; S.geo(new THREE.BoxGeometry(0.16, 1.9, 0.12), new THREE.Matrix4().compose(V(x + Math.cos(a) * 0.88, g + 2.2, z + Math.sin(a) * 0.88), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), -a), V(1, 1, 1)), SLOT); }
            over(x, z, level + 2.5, V(xb - 2.5, yb + 5, zbx));
          }
          // The return: clean water back into the pool from a nozzle just under the surface.
          const rc = drain ? [x, z] : [[x + 7, z], [x - 7, z], [x, z + 5], [x + 4, z + 4], [x - 4, z + 4]].find(([a, b]) => Math.abs(a) < hw - 2 && pool(a, b)) ?? [x + 1.6, z + 1.2];
          const [rx, rz] = rc, ry = level - 0.8;
          S.geo(new THREE.CylinderGeometry(0.36, 0.36, level + 2.5 - ry, 10), cylM(rx, (level + 2.5 + ry) / 2, rz), PIPE);
          S.geo(new THREE.CylinderGeometry(0.3, 0.36, 1.2, 10), cylM(rx, ry, rz + 0.5, Math.PI / 2), PIPE);
          jet(V(rx, ry, rz + 1.1), V(0, -0.06, 1), 0.3);
          over(rx, rz, level + 2.5, V(xb + 2.5, yb + 5, zbx));
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
          // Coarse foam: two shades in vertical bands read as a block of open-cell foam.
          for (let k = 0; k < 6; k++) {
            const t = (k + 0.5) / 6, p = a.clone().lerp(b, t);
            S.geo(new THREE.BoxGeometry(len / 6 + 0.02, hgt, 1.6 + (k % 2) * 0.1), new THREE.Matrix4().compose(V(p.x, g + hgt / 2, p.z), q, V(1, 1, 1)), k % 2 ? FOAM2 : FOAM);
          }
          // The lift tube behind the foam (toward the glass) and its spout over the top.
          const away = V(-(b.z - a.z), 0, b.x - a.x).normalize();
          if (away.dot(V(sx, 0, 0)) < 0 && Math.abs(away.x) > 0.3) away.negate();
          if (Math.abs(away.x) <= 0.3 && away.z > 0) away.negate();
          const tb = mid.clone().addScaledVector(away, 1.6);
          // The pump on the floor behind the foam (toward the glass), its riser up over the top of the foam and a spout into the pool.
          S.geo(new THREE.BoxGeometry(1.4, 1.4, 1.4), new THREE.Matrix4().makeTranslation(tb.x, g + 0.7, tb.z), BODY);
          S.geo(new THREE.CylinderGeometry(0.4, 0.4, hgt + 0.1, 10), cylM(tb.x, g + 1.4 + (hgt - 1.3) / 2, tb.z), PIPE);
          S.geo(new THREE.CylinderGeometry(0.36, 0.36, 3.2, 10), cylM(tb.x - away.x * 1.3, g + hgt + 0.2, tb.z - away.z * 1.3, Math.PI / 2 * 0.6 * -away.z, Math.PI / 2 * 0.6 * away.x), PIPE);
          jet(V(tb.x - away.x * 2.6, g + hgt - 0.6, tb.z - away.z * 2.6), V(-away.x, -0.9, -away.z), 0.32);
        }
      } else if (kind === 'canister') {
        const c = spot(corners);
        if (c) {
          const [x, z] = c, g = T.heightAt(x, z);
          if (!drain) S.geo(new THREE.CylinderGeometry(0.45, 0.45, level + 2.5 - (g + 2), 10, 1, true), cylM(x, (level + 2.5 + g + 2) / 2, z), PIPE);
          if (drain) { if (E.prefilter) S.geo(new THREE.CylinderGeometry(1.25, 1.25, 1.6, 14), cylM(drain.x, drain.top - 1.1, drain.z), FOAM); }
          else if (E.prefilter) S.geo(new THREE.CylinderGeometry(1.25, 1.25, 3.2, 14), cylM(x, g + 2.4, z), FOAM);
          else {
            S.geo(new THREE.CylinderGeometry(0.9, 0.9, 2.6, 12, 1, true), cylM(x, g + 2.3, z), GRILL);
            for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2; S.geo(new THREE.BoxGeometry(0.16, 2.1, 0.12), new THREE.Matrix4().compose(V(x + Math.cos(a) * 0.93, g + 2.3, z + Math.sin(a) * 0.93), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), -a), V(1, 1, 1)), SLOT); }
          }
          // The canister stands on the cabinet floor; the drain (or an intake over the rim) feeds it, the return goes back up.
          const xc = Math.max(-hw + 5, Math.min(hw - 5, (drain ? drain.x : x) - 6)), zc = -TANK.d / 2 + 8;
          S.geo(new THREE.CylinderGeometry(3.6, 3.6, 11, 18), cylM(xc, FLOOR + 5.5, zc), BODY);
          S.geo(new THREE.CylinderGeometry(3.75, 3.75, 1.4, 18), cylM(xc, FLOOR + 11.6, zc), CAPC);
          if (drain) drainHose(V(xc - 1.4, FLOOR + 12.4, zc)); else over(x, z, level + 2.5, V(xc - 1.4, FLOOR + 12.4, zc));
          // The spray bar: along the back just under the surface, a row of holes facing forward.
          const xs = Math.max(-hw + 3, x - 14), xe = Math.min(hw - 3, x + 2), y = level - 1, zz = Math.max(back(xs, y), back(xe, y)) + 1.1;
          S.geo(new THREE.CylinderGeometry(0.4, 0.4, xe - xs, 10), cylM((xs + xe) / 2, y, zz, 0, Math.PI / 2), PIPE);
          for (let xx = xs + 1; xx < xe - 0.5; xx += 1.6) { S.geo(new THREE.CylinderGeometry(0.12, 0.12, 0.2, 6), cylM(xx, y, zz + 0.36, Math.PI / 2), SLOT); jet(V(xx, y, zz + 0.5), V(0, -0.1, 1), 0.18); }
          over(xe, zz, y, V(xc + 1.4, FLOOR + 12.4, zc));
        }
      }
    }
    // The false bottom's pump tower: in the back corner of the land, slots down where the plenum is.
    if (E.drainage >= 1) {
      const ph = E.plenumH || level + 1;
      for (const sx of [1, -1]) {
        const x = sx * (hw - 3.2), z = back(x, ph + 4) + 3.2, g = T.heightAt(x, z);
        if (pool(x, z) || g < ph + 1) continue;
        S.geo(new THREE.CylinderGeometry(2.1, 2.1, g + 1.6, 16, 1, true), cylM(x, (g + 1.6) / 2, z), PVC);
        S.geo(new THREE.CylinderGeometry(2.25, 2.25, 0.5, 16), cylM(x, g + 1.7, z), CAPC);
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2;
          S.geo(new THREE.BoxGeometry(0.22, Math.max(0.5, ph - 1), 0.14), new THREE.Matrix4().compose(V(x + Math.cos(a) * 2.13, (ph - 1) / 2 + 0.3, z + Math.sin(a) * 2.13), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), -a), V(1, 1, 1)), SLOT);
        }
        // The hidden tubing: from the tower up behind the background to the top (the waterfall feed).
        S.tube(new THREE.CatmullRomCurve3([V(x, g + 1.9, z), V(x, g + 3, z - 1.5), V(x - sx * 1.5, Math.min(TANK.h - 2, g + 10), back(x, g + 10) + 0.3)]).getSpacedPoints(16), 0.32, HOSE);
        break;
      }
    }
  }

  dispose() {
    this.group.removeFromParent();
    this.mesh.geometry.dispose(); this.spill.geometry.dispose();
  }
}
