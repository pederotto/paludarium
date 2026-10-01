// The visible plumbing of the pump circuit (sim/hydro.js, nothing here changes the hydrology):
//
//   main pool: screened intake -> pump housing -> hose -> (buried under the substrate) -> up the background wall -> outlet
//                                                  \-> an overflow standpipe at the pool edge: what the valves do not
//                                                      pass goes back to the pool over its lip (the bypass)
//
// Everything static (housing, intake grill, hoses, wall clips, standpipe) is merged into ONE mesh and rebuilt only when the
// intake, an outlet, the water level or the ground changed (at most once every couple of seconds). Hoses follow the
// ground a little under its surface, so they vanish into the substrate and rocks and show only where they run through
// open air: up the background wall, and at the pump. Water in the hoses is a highlight that travels along them while the
// pump runs; the overflow shows a thin falling sheet when there is bypass flow. Hidden in photo mode and Kids mode, and
// with Care > Water > Show equipment off.

import * as THREE from 'three/webgpu';
import { attribute, uniform, time, sin, smoothstep, vec3, float, positionLocal } from 'three/tsl';
import { creatureMaterial } from './shaders.js';
import { TANK } from '../sim/tank.js';

const HOSE_R = 0.38;
const HOSE = new THREE.Color(0x2e3b41), CLIP = new THREE.Color(0xa6aeb2), BODY = new THREE.Color(0x242b30), CAPC = new THREE.Color(0x39444b);
const GRILL = new THREE.Color(0x86979c), SLOT = new THREE.Color(0x151a1d), PIPE = new THREE.Color(0xc9ccc6), RIM = new THREE.Color(0xe4e6e0), INNER = new THREE.Color(0x101517);
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
    this.sig = ''; this.t = 1e9; this.weir = null;
  }

  // Where the pump sits (same cell as the marker in render/water.js).
  pumpXZ() {
    const H = this.world.water.hydro;
    return H.cellXZ(H.seed ?? H.intakeCell());
  }

  signature() {
    const W = this.world, H = W.water.hydro;
    const [px, pz] = this.pumpXZ();
    return [px.toFixed(1), pz.toFixed(1), Math.round(H.level * 2), H.groundVer, H.outlets.map((o) => `${o.pos.x.toFixed(1)},${o.pos.y.toFixed(1)},${o.pos.z.toFixed(1)},${o.wall ? 1 : 0}`).join(';')].join('|');
  }

  update(dt) {
    const W = this.world, H = W.water.hydro;
    const poolOk = H.resVol > 2 && H.level > 0.5;
    const vis = this.show && poolOk && !(this.hidden?.());
    this.group.visible = vis;
    if (!vis) return;
    this.t += dt;
    if (this.t > 1.6) {
      this.t = 0;
      const s = this.signature();
      if (s !== this.sig) { this.sig = s; this.rebuild(); }
    }
    const P = H.pump;
    this.run.value += ((P.running ? 1 : 0) - this.run.value) * Math.min(1, dt * 2.5);
    // A steady trickle while it runs (the pool's own overflow), a full sheet when the valves send the rest back (the bypass).
    const frac = P.running ? 0.22 + 0.78 * (P.lph > 1 ? Math.min(1, (P.bypass ?? 0) / P.lph) : 0) : 0;
    this.spillAmt.value += (frac - this.spillAmt.value) * Math.min(1, dt * 2);
    this.spill.visible = !!this.weir && this.spillAmt.value > 0.02;
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

    // --- Overflow standpipe: the bypass goes back into the pool over its lip ------------------------------------------
    this.weir = null;
    const cand = [[7, 0], [-7, 0], [0, -7], [10, -4], [-10, -4], [5, 6], [-5, 6], [3, 0]];
    for (const [dx, dz] of cand) {
      const x = px + dx, z = pz + dz;
      if (Math.abs(x) > wx - 1 || Math.abs(z) > TANK.d / 2 - 2) continue;
      const gh = T.heightAt(x, z);
      if (!W.water.inMainPool(x, z) || level - gh < 2.2) continue;
      const top = level + 0.7;
      S.geo(new THREE.CylinderGeometry(0.85, 0.95, top - gh + 0.5, 14, 1, true), cylM(x, (top + gh - 0.5) / 2, z), PIPE);
      S.geo(new THREE.TorusGeometry(0.9, 0.16, 6, 16), new THREE.Matrix4().compose(V(x, top, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)), V(1, 1, 1)), RIM);
      S.geo(new THREE.CircleGeometry(0.78, 14), new THREE.Matrix4().compose(V(x, top - 0.55, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)), V(1, 1, 1)), INNER);
      S.geo(new THREE.CylinderGeometry(0.28, 0.28, 3.0, 8), cylM(x, gh + 0.4, z), HOSE);   // the return line going into the substrate
      this.weir = { x, z, top };
      this.spill.position.set(x, top - 0.3 - 0.0, z);
      this.spill.scale.set(1, Math.max(1, top - 0.5 - Math.max(gh, level - 0.3)), 1);
      this.spill.position.y = top - this.spill.scale.y / 2 - 0.05;
      break;
    }
    const old = this.mesh.geometry;
    this.mesh.geometry = S.build();
    old.dispose();
  }

  dispose() {
    this.group.removeFromParent();
    this.mesh.geometry.dispose(); this.spill.geometry.dispose();
  }
}
