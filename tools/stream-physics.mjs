// A stream down a slope under Node (no scene): how deep, wide and fast it runs, and whether the water it carries adds up.
//
//   node tools/stream-physics.mjs
//
// Two outlets on a shelf feed two channels that join halfway down a 30% slope; a cross-section below the join counts
// the litres per hour going downhill and compares them with what the pump delivers to the outlets. Prints depth, wet
// width and speed at the cross-section, the shape a stream's look and its erosion depend on.
import * as THREE from 'three/webgpu';
import { Hydro, WET } from '../src/sim/hydro.js';

const NX = 120, NY = 60, W = 90, D = 45;
class Field {
  constructor() {
    this.nx = NX; this.ny = NY; this.cols = NX + 1; this.rows = NY + 1;
    this.da = W / NX; this.db = D / NY; this.oa = -W / 2; this.ob = -D / 2;
    this.h = new Float32Array(this.cols * this.rows);
    this.base = this.h;
    this.stamped = new Uint8Array(this.cols * this.rows);
  }
  toGrid(a, b) { return [(a - this.oa) / this.da, (b - this.ob) / this.db]; }
  toWorld(i, j) { return [this.oa + i * this.da, this.ob + j * this.db]; }
  idx(i, j) { return j * this.cols + i; }
}

export function streamWorld() {
  const f = new Field();
  for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) {
    const [x, z] = f.toWorld(i, j);
    // Shelf at the back (z < -15), a 30% slope down to the floor at z = 12, the pool floor in front.
    let h = z < -15 ? 15 : z > 12 ? 2 : 15 - (z + 15) * 0.3;
    if (z > 12) h = 2;
    // Two channels from x = -8 and x = 8 meeting at x = 0 by z = -2, then one channel on down.
    const cx = z < -2 ? Math.sign(x || 1) * 8 * Math.min(1, (-2 - z) / 13) : 0;
    h -= 1.2 * Math.exp(-((x - cx) ** 2) / (2 * 2.2 * 2.2)) * (z > -16 ? 1 : 0);
    f.h[f.idx(i, j)] = h;
  }
  const world = {
    terrain: { field: f, heightAt: (x, z) => { const [a, b] = f.toGrid(x, z); return f.h[f.idx(Math.max(0, Math.min(NX, Math.round(a))), Math.max(0, Math.min(NY, Math.round(b))))]; } },
    wall: { zAt: () => 0 }, log: () => {}, env: {},
  };
  const H = new Hydro(world);
  H.pump.intake = { x: 0, z: 18 };
  H.rebuild();
  H.setLevel(5);
  const at = (x, z) => f.h[H.cellOf(x, z)] + 0.2;
  H.addOutlet(new THREE.Vector3(-8, at(-8, -15), -15), false);
  H.addOutlet(new THREE.Vector3(8, at(8, -15), -15), false);
  return { H, f };
}

// Litres per hour crossing row z downhill (+z pipes), with the depth, width and speed of the water there.
export function crossSection(H, f, z) {
  const j = Math.round((z - f.ob) / f.db);
  let q = 0, wet = 0, dmax = 0, vSum = 0, dSum = 0;
  for (let i = 0; i <= f.nx; i++) {
    const n = j * f.cols + i;
    q += H.flux[n * 4 + 2] - H.flux[n * 4 + 3];
    if (H.d[n] > WET && !H.res[n]) { wet++; dmax = Math.max(dmax, H.d[n]); vSum += Math.hypot(H.vx[n], H.vz[n]) * H.d[n]; dSum += H.d[n]; }
  }
  return { lph: q * 3.6, width: wet * f.da, dmax, v: dSum ? vSum / dSum : 0 };
}

if (process.argv[1]?.endsWith("stream-physics.mjs")) {
  const { H, f } = streamWorld();
  for (let t = 0; t < 60; t += 0.05) H.step(0.05);
  const outs = H.outlets.map((o) => o.q * 3.6);
  console.log('outlets L/h', outs.map((v) => v.toFixed(1)).join(' + '), '=', outs.reduce((a, b) => a + b, 0).toFixed(1));
  for (const z of [-10, 0, 6]) {
    const c = crossSection(H, f, z);
    console.log(`z=${z}: ${c.lph.toFixed(1)} L/h, width ${c.width.toFixed(2)} cm, depth max ${(c.dmax * 10).toFixed(1)} mm, speed ${c.v.toFixed(0)} cm/s`);
  }
}
