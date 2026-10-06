// The stream on rock and the fall it pours (repos doc, "Stream path and waterfall"): a film on a rock ledge too thin to count as
// wet (sim/hydro.js WET) still pours a fall once enough runs over the lip (FALL_Q). Every cell a fall pours from must be drawn
// (drawnWater), so the path feeding a fall never vanishes before it. Outlet flows from 5 to 50 cm³/s on a stamped ledge.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { Hydro, WET, FALL_Q, drawnWater } from '../src/sim/hydro.js';

const NX = 120, NY = 60, W = 90, D = 45;
function ledgeWorld() {
  const f = { nx: NX, ny: NY, cols: NX + 1, rows: NY + 1, da: W / NX, db: D / NY, oa: -W / 2, ob: -D / 2 };
  f.toGrid = (a, b) => [(a - f.oa) / f.da, (b - f.ob) / f.db];
  f.toWorld = (i, j) => [f.oa + i * f.da, f.ob + j * f.db];
  f.idx = (i, j) => j * f.cols + i;
  f.h = new Float32Array(f.cols * f.rows); f.base = new Float32Array(f.cols * f.rows); f.stamped = new Uint8Array(f.cols * f.rows);
  for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) {
    const [x, z] = f.toWorld(i, j), n = f.idx(i, j);
    // a rock slab (stamped over a low base) at the back, its top tilted 3 % toward its front edge at z = -6, a 9 cm drop to the floor
    const rock = z < -6 && Math.abs(x) < 20;
    f.base[n] = 2;
    // (a shallow groove down its middle gathers the water to one lip, as on a real ledge)
    f.h[n] = rock ? 11 + (-6 - z) * 0.03 - 0.6 * Math.exp(-(x * x) / (2 * 1.5 * 1.5)) : 2;
    f.stamped[n] = rock ? 1 : 0;
  }
  const world = { terrain: { field: f, heightAt: (x, z) => { const [a, b] = f.toGrid(x, z); return f.h[f.idx(Math.max(0, Math.min(NX, Math.round(a))), Math.max(0, Math.min(NY, Math.round(b))))]; } }, wall: { zAt: () => -D / 2 }, log: () => {}, env: {} };
  const H = new Hydro(world);
  H.pump.intake = { x: 0, z: 18 };
  H.rebuild();
  H.setLevel(4);
  H.addOutlet(new THREE.Vector3(0, 11.6, -18), false);
  return { H, f };
}

test('every cell a fall pours from is drawn, from a trickle to a full pump', () => {
  let oldHidden = 0, newHidden = 0, lips = 0;
  for (const cms of [5, 10, 20, 35, 50]) {
    const { H } = ledgeWorld();
    H.pump.rate = cms * 3.6;
    for (let t = 0; t < 40; t += 0.05) H.step(0.05);
    for (let n = 0; n < H.N; n++) for (let k = 0; k < 4; k++) {
      const o = n * 4 + k;
      if (H.res[n] || !(H.jump[o] >= 0 && H.flux[o] > FALL_Q && H.dropH[o] > 2.2)) continue;
      lips++;
      if (!(H.d[n] > WET)) oldHidden++;
      if (!drawnWater(H, n)) newHidden++;
    }
  }
  console.log(`lip cells ${lips}; hidden by the depth rule alone ${oldHidden}; hidden now ${newHidden}`);
  assert.ok(lips > 0, 'the ledge makes falls');
  assert.equal(newHidden, 0, 'no fall pours from water that is not drawn');
});
